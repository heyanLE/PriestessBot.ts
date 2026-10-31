import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { z } from 'zod';
import { AgentDefinitionSchema, ConnectionSchema, GrantSchema, PlatformConfigSchema, ResourceBindingsSchema, RuntimeConfigSchema, type RuntimeConfig } from '../../contracts/src/index.js';
import { validateConfiguration } from './flow.js';

const Credential = z.object({ source: z.literal('ENVIRONMENT').default('ENVIRONMENT'), key: z.string() });
const LegacyAgent = z.object({ id: z.string(), displayName: z.string().optional(), enabled: z.boolean().default(true), instructions: z.string().default(''), type: z.string().optional(), preset: z.string().optional(), llm: z.object({ providerRef: z.string(), model: z.string() }), memory: z.object({ libraryIds: z.array(z.string()).default([]) }).default({ libraryIds: [] }), skills: z.object({ platformLibraries: z.array(z.object({ libraryId: z.string(), enabled: z.boolean().default(true) })).default([]) }).default({ platformLibraries: [] }), mcpServerIds: z.array(z.string()).default([]), personaId: z.string().nullable().optional(), configDirectory: z.string().optional(), tempDirectory: z.string().optional(), execution: z.object({ maxSteps: z.number().int().optional() }).optional() }).passthrough();
const LegacyProvider = z.object({ id: z.string(), type: z.string(), enabled: z.boolean().default(true), endpoint: z.string().default(''), protocol: z.string().nullable().optional(), credentialRef: Credential.nullable().optional() }).passthrough();
const LegacyRoute = z.object({ id: z.string(), enabled: z.boolean().default(true), match: z.object({ sessionTypes: z.array(z.string()).optional(), attention: z.string().default('ANY'), attentionTarget: z.string().default('BOT'), stripMentions: z.boolean().default(true), textMode: z.string().default('GLOB'), textPattern: z.string().default('*') }).default({ attention: 'ANY', attentionTarget: 'BOT', stripMentions: true, textMode: 'GLOB', textPattern: '*' }), action: z.object({ type: z.string().default('AGENT'), agentId: z.string().nullable().optional(), commandPrefix: z.string().default('#') }) });
const LegacyIm = z.object({ id: z.string(), name: z.string().optional(), type: z.string(), enabled: z.boolean().default(true), settings: z.record(z.string(), z.string()).default({}), credentialRefs: z.record(z.string(), Credential).default({}), routes: z.array(LegacyRoute).default([]), permission: z.object({ adminIds: z.array(z.string()).default([]), superAdminIds: z.array(z.string()).default([]) }).default({ adminIds: [], superAdminIds: [] }) }).passthrough();
const LegacyConfig = z.object({ schemaVersion: z.literal(3), agents: z.array(LegacyAgent), llms: z.array(LegacyProvider).default([]), ims: z.array(LegacyIm).default([]), memoryLibraries: z.array(z.object({ id: z.string(), name: z.string().optional(), enabled: z.boolean().default(true) })).default([]), skillLibraries: z.array(z.object({ id: z.string(), directory: z.string(), enabled: z.boolean().default(true) })).default([]), mcpServers: z.array(z.object({ id: z.string() }).passthrough()).default([]) }).passthrough();
export interface MigrationDiagnostic { readonly entity: string; readonly severity: 'info' | 'warning' | 'error'; readonly message: string; }
export interface MigrationReport { readonly config?: RuntimeConfig; readonly diagnostics: MigrationDiagnostic[]; readonly canActivate: boolean; }
export interface MigrationOptions { readonly mapNormalToAgentsSdk?: boolean; readonly apply?: boolean; }
export function dryRunMigration(input: unknown, options: MigrationOptions = {}): MigrationReport {
  const native = RuntimeConfigSchema.safeParse(input);
  if (native.success) { const validation = validateConfiguration(native.data); return { config: native.data, diagnostics: validation.issues.map(message => ({ entity: 'configuration', severity: 'error', message })), canActivate: validation.valid }; }
  const parsed = LegacyConfig.safeParse(input);
  if (!parsed.success) return { diagnostics: [{ entity: 'configuration', severity: 'error', message: 'Only explicit Kotlin application schemaVersion 3 or priestess-ts schemaVersion 1 is supported. Source is untouched.' }], canActivate: false };
  const legacy = parsed.data; const diagnostics: MigrationDiagnostic[] = [];
  const issue = (entity: string, message: string, severity: MigrationDiagnostic['severity'] = 'warning'): void => { diagnostics.push({ entity, message, severity }); };
  const connections = legacy.llms.flatMap(provider => {
    if (!['openai', 'openai_compatible', 'deepseek'].includes(provider.type.toLowerCase())) { issue(`llm/${provider.id}`, `Provider ${provider.type} needs an explicit Agents SDK adapter; referenced Agents stay disabled.`, 'error'); return []; }
    const converted = ConnectionSchema.safeParse({ id: provider.id, ...(provider.endpoint ? { baseUrl: provider.endpoint } : {}), apiKeyEnv: provider.credentialRef?.key ?? 'OPENAI_API_KEY', protocol: ['responses', 'openai_responses'].includes(provider.protocol?.toLowerCase() ?? '') ? 'responses' : 'chat_completions' });
    if (!converted.success) { issue(`llm/${provider.id}`, 'Invalid provider endpoint or credential reference.', 'error'); return []; }
    return [converted.data];
  });
  const memoryLibraries = legacy.memoryLibraries.filter(library => library.enabled).map(library => ({ id: library.id, displayName: library.name ?? library.id }));
  const skillLibraries = legacy.skillLibraries.filter(library => library.enabled).map(library => ({ id: library.id, directory: library.directory }));
  const agents = legacy.agents.map(source => {
    const engine = source.type ?? source.preset ?? 'NORMAL'; const mapped = engine === 'NORMAL' && options.mapNormalToAgentsSdk === true;
    if (!mapped) issue(`agent/${source.id}`, engine === 'NORMAL' ? 'NORMAL mapping requires explicit mapNormalToAgentsSdk; Agent imported disabled.' : `${engine} behavior/native sessions are unsupported; Agent imported disabled.`, 'warning');
    if (source.personaId) issue(`agent/${source.id}/persona`, `Persona ${source.personaId} requires its separately stored content; no persona content was guessed.`);
    if (source.mcpServerIds.length > 0) issue(`agent/${source.id}/mcp`, 'Legacy MCP bindings require transport and credential migration before activation.');
    if (source.toolPolicy !== undefined) issue(`agent/${source.id}/tools`, 'Legacy tool policy is retained in source backup; migrated Agent starts with no side-effect tools.');
    return AgentDefinitionSchema.parse({ id: source.id, displayName: source.displayName ?? source.id, enabled: source.enabled && mapped && connections.some(connection => connection.id === source.llm.providerRef), model: source.llm.model, connectionId: source.llm.providerRef, instructions: source.instructions, capabilities: ['chat', 'knowledge.read', 'memory.read', 'memory.write', 'conversation.stop'], resources: { memoryLibraries: source.memory.libraryIds.filter(id => memoryLibraries.some(library => library.id === id)), skills: source.skills.platformLibraries.filter(binding => binding.enabled && skillLibraries.some(library => library.id === binding.libraryId)).map(binding => binding.libraryId), directories: [source.configDirectory, source.tempDirectory].filter((directory): directory is string => directory !== undefined) }, budget: { maxTurns: Math.min(100, Math.max(1, source.execution?.maxSteps ?? 12)) } });
  });
  const platforms = legacy.ims.flatMap(im => {
    const type = im.type.toLowerCase(); const common = { id: im.id, displayName: im.name ?? im.id, enabled: false };
    let candidate: unknown;
    if (type === 'telegram') candidate = { ...common, type, tokenEnv: im.credentialRefs.botToken?.key ?? im.credentialRefs.token?.key ?? 'TELEGRAM_BOT_TOKEN', ...(im.settings.apiBaseUrl ? { apiBase: im.settings.apiBaseUrl } : {}) };
    else if (type === 'napcat' || type === 'napcat4_18_6' || type === 'aiocqhttp') candidate = { ...common, type: 'napcat', websocketUrl: im.settings.websocketUrl ?? im.settings.wsUrl ?? 'ws://127.0.0.1:3001', accessTokenEnv: im.credentialRefs.accessToken?.key ?? 'NAPCAT_TOKEN' };
    else if (type === 'weixin' || type === 'weixin_ilink') candidate = { ...common, type: 'weixin', tokenEnv: im.credentialRefs.token?.key ?? 'WEIXIN_TOKEN', accountId: im.settings.accountId ?? '' };
    else { issue(`im/${im.id}`, `Platform ${im.type} has no qualified adapter.`, 'error'); return []; }
    const converted = PlatformConfigSchema.safeParse(candidate);
    if (!converted.success) { issue(`im/${im.id}`, 'Invalid platform settings.', 'error'); return []; }
    issue(`im/${im.id}`, 'IM imported disabled for single-consumer cutover. Verify endpoint and environment credential references before activation.', 'info'); return [converted.data];
  });
  const rules: RuntimeConfig['flow']['routing']['rules'] = [];
  const commandPrefixes = new Set<string>();
  type Acceptance = Pick<RuntimeConfig['flow']['acceptance'], 'privateEnabled' | 'groupPolicy' | 'groupCommandsRequireAttention'>;
  const policies: { im: string; acceptance: Acceptance }[] = [];
  for (const im of legacy.ims) {
    const accepted: Acceptance = { privateEnabled: false, groupPolicy: 'disabled', groupCommandsRequireAttention: false };
    const enabled = im.routes.filter(route => route.enabled);
    for (const route of enabled) {
      const sessions = route.match.sessionTypes ?? ['PRIVATE', 'GROUP'];
      if (sessions.length === 0 || sessions.some(session => session !== 'PRIVATE' && session !== 'GROUP')) issue(`route/${im.id}/${route.id}`, 'Unknown or empty session type selection.', 'error');
      if (route.match.attentionTarget !== 'BOT' || !route.match.stripMentions) issue(`route/${im.id}/${route.id}`, 'Non-bot attention or retained mention behavior cannot be represented safely.', 'error');
      if (route.action.type !== 'AGENT' && route.action.type !== 'COMMAND') issue(`route/${im.id}/${route.id}`, 'Unknown route action.', 'error');
      if (route.action.type === 'AGENT' && (route.match.textMode !== 'GLOB' || route.match.textPattern !== '*')) issue(`route/${im.id}/${route.id}`, 'Exact/prefix/complex glob Agent routing needs manual node mapping; route not approximated.', 'error');
      if (route.action.type === 'COMMAND' && (route.match.textMode !== 'PREFIX' || route.match.textPattern !== route.action.commandPrefix)) issue(`route/${im.id}/${route.id}`, 'Command routes must match their literal command prefix.', 'error');
    }
    for (const sessionType of ['private', 'group']) {
      const routes = enabled.filter(route => (route.match.sessionTypes ?? ['PRIVATE', 'GROUP']).includes(sessionType.toUpperCase()));
      const agentRoutes = routes.filter(route => route.action.type === 'AGENT');
      const commandRoutes = routes.filter(route => route.action.type === 'COMMAND');
      const agentRoute = agentRoutes[0];
      const commandRoute = commandRoutes[0];
      if (agentRoutes.length > 1 || commandRoutes.length > 1) issue(`routes/${im.id}/${sessionType}`, 'Multiple ordered handlers per session type cannot be flattened without changing matching semantics.', 'error');
      if (agentRoute === undefined) {
        if (commandRoute !== undefined) issue(`routes/${im.id}/${sessionType}`, 'Command-only routes lack the Agent selection required by the fixed flow.', 'error');
        continue;
      }
      const target = agents.find(agent => agent.id === agentRoute.action.agentId && agent.enabled);
      if (target === undefined) { issue(`route/${im.id}/${agentRoute.id}`, 'Route targets a missing/disabled Agent.', 'error'); continue; }
      if (commandRoute === undefined) issue(`routes/${im.id}/${sessionType}`, 'An enabled Agent route without its command route cannot preserve the fixed command branch; configure it explicitly before activation.', 'error');
      else {
        commandPrefixes.add(commandRoute.action.commandPrefix);
        if (routes.indexOf(commandRoute) > routes.indexOf(agentRoute)) issue(`route/${im.id}/${commandRoute.id}`, 'Command handler appears after the catch-all Agent handler; fixed command-first semantics would change its behavior.', 'error');
        if (commandRoute.action.agentId !== null && commandRoute.action.agentId !== undefined && commandRoute.action.agentId !== target.id) issue(`route/${im.id}/${commandRoute.id}`, 'Command and conversation routes select different Agents and cannot share one fixed selection.', 'error');
      }
      if (sessionType === 'private') {
        accepted.privateEnabled = true;
        if (agentRoute.match.attention !== 'ANY' || (commandRoute !== undefined && commandRoute.match.attention !== 'ANY')) issue(`routes/${im.id}/private`, 'Private attention filters cannot be represented by the fixed private acceptance switch.', 'error');
        rules.push({ id: `${im.id}:${agentRoute.id}:private`, platform: im.id, sessionType: 'private', agentId: target.id });
      } else {
        if (agentRoute.match.attention === 'ANY') accepted.groupPolicy = 'all';
        else if (agentRoute.match.attention === 'MENTION_OR_REPLY') accepted.groupPolicy = 'mention_or_reply';
        else issue(`route/${im.id}/${agentRoute.id}`, 'Only ANY or bot MENTION_OR_REPLY group acceptance is currently representable.', 'error');
        if (commandRoute !== undefined) {
          if (commandRoute.match.attention === 'MENTION_OR_REPLY') accepted.groupCommandsRequireAttention = true;
          else if (commandRoute.match.attention !== 'ANY') issue(`route/${im.id}/${commandRoute.id}`, 'Only ANY or bot MENTION_OR_REPLY group command attention is representable.', 'error');
          if (accepted.groupPolicy === 'all' && accepted.groupCommandsRequireAttention) issue(`routes/${im.id}/group`, 'Unaddressed commands previously fell through to an unrestricted Agent route; the fixed attention gate cannot preserve that fallback.', 'error');
        }
        rules.push({ id: `${im.id}:${agentRoute.id}:group`, platform: im.id, sessionType: 'group', agentId: target.id });
      }
    }
    policies.push({ im: im.id, acceptance: accepted });
  }
  if (commandPrefixes.size > 1) issue('routes/commands', 'Different command prefixes cannot be represented by one fixed flow.', 'error');
  const prefix = [...commandPrefixes][0] ?? '/';
  const acceptance: Acceptance = policies[0]?.acceptance ?? { privateEnabled: false, groupPolicy: 'disabled', groupCommandsRequireAttention: false };
  for (const policy of policies.slice(1)) if (policy.acceptance.privateEnabled !== acceptance.privateEnabled || policy.acceptance.groupPolicy !== acceptance.groupPolicy || policy.acceptance.groupCommandsRequireAttention !== acceptance.groupCommandsRequireAttention) issue(`routes/${policy.im}`, 'IM acceptance or command-attention policies differ; one fixed flow cannot represent them without broadening access.', 'error');
  const grants = legacy.ims.flatMap(im => [...new Set([...im.permission.adminIds, ...im.permission.superAdminIds])].map(senderId => GrantSchema.parse({ platform: im.id, senderId, maximumState: im.permission.superAdminIds.includes(senderId) ? 'elite_operator' : 'senior_operator', defaultState: 'operator', capabilities: ['chat', 'knowledge.read', 'memory.read', 'memory.write', 'conversation.stop'], resources: ResourceBindingsSchema.parse({ memoryLibraries: memoryLibraries.map(library => library.id) }) })));
  if (grants.length > 0) issue('permissions', 'Legacy users migrate to their configured default role. Assign a fixed role after reviewing each sender; former maximum roles do not elevate users.');
  if (legacy.mcpServers.length > 0) issue('mcpServers', 'MCP transport/secret conversion requires separate review; source definitions preserved in backup.');
  issue('data', 'This importer migrates configuration. Persona files, memories, knowledge documents and conversation history require explicit data import; source data remains untouched.');
  const defaultAgent = agents.find(agent => agent.enabled) ?? agents[0];
  if (defaultAgent === undefined) { issue('agents', 'No Agent definitions found.', 'error'); return { diagnostics, canActivate: false }; }
  const result = RuntimeConfigSchema.safeParse({ runtime: 'priestess-ts', schemaVersion: 1, agents, connections, platforms, grants, memoryLibraries, skillLibraries, flow: { routing: { defaultAgentId: defaultAgent.id, rules }, commands: { prefix }, acceptance } });
  if (!result.success) { issue('configuration', result.error.issues.map(error => `${error.path.join('.')}: ${error.message}`).join('; '), 'error'); return { diagnostics, canActivate: false }; }
  const validation = validateConfiguration(result.data);
  for (const message of validation.issues) issue('configuration', message, 'error');
  return { config: result.data, diagnostics, canActivate: validation.valid && diagnostics.every(diagnostic => diagnostic.severity !== 'error') };
}
export async function migrateConfigurationFile(sourcePath: string, targetDirectory: string, options: MigrationOptions = {}): Promise<MigrationReport & { sourceHash: string; outputPath?: string; backupPath?: string }> {
  const source = resolve(sourcePath); const target = resolve(targetDirectory);
  if (target === dirname(source)) throw new Error('Migration requires a separate target directory');
  const bytes = await readFile(source); const sourceHash = createHash('sha256').update(bytes).digest('hex'); const input: unknown = JSON.parse(bytes.toString('utf8')); const report = dryRunMigration(input, options);
  if (!options.apply) return { ...report, sourceHash };
  if (report.config === undefined) throw new Error('No valid migration candidate; review dry-run diagnostics');
  await mkdir(target, { recursive: true, mode: 0o700 });
  const backupPath = resolve(target, `${basename(source)}.${sourceHash}.backup`); const outputPath = resolve(target, `config.${sourceHash}.json`);
  for (const [path, content] of [[backupPath, bytes.toString('utf8')], [outputPath, JSON.stringify(report.config, null, 2)], [resolve(target, `migration.${sourceHash}.json`), JSON.stringify({ sourceHash, diagnostics: report.diagnostics, canActivate: report.canActivate }, null, 2)]]) {
    if (path === undefined || content === undefined) throw new Error('Invalid migration output');
    try { await writeFile(path, content, { flag: 'wx', mode: 0o600 }); } catch (error) { const parsed = z.object({ code: z.literal('EEXIST') }).safeParse(error); if (!parsed.success) throw error; if ((await readFile(path, 'utf8')) !== content) throw new Error('Existing migration output differs; refusing overwrite', { cause: error }); }
  }
  return { ...report, sourceHash, outputPath, backupPath };
}
