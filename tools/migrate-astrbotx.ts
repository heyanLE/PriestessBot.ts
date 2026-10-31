import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, readdir, stat, realpath, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { mapAstrBotXConfiguration, importAstrBotXDatabase, parseAstrBotXJson } from '../packages/core/src/astrbotx-migration.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { validateConfiguration } from '../packages/core/src/flow.js';

const Args = z.object({ source: z.string(), target: z.string(), 'napcat-ws': z.string().url(), 'napcat-http': z.string().url().optional(), 'napcat-token-file': z.string().optional(), 'builtin-skills': z.string().optional(), apply: z.boolean().default(false) }).strict();
async function run(): Promise<void> {
  const supplied: Record<string, string | boolean> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) { const arg = argv[i]; if (arg === '--apply') { supplied.apply = true; continue; } if (!arg?.startsWith('--') || !argv[i + 1]) throw new Error('Expected --source, --target, --napcat-ws and optional --apply/--napcat-token-file/--napcat-http'); supplied[arg.slice(2)] = argv[++i] ?? ''; }
  const args = Args.parse(supplied); const source = resolve(args.source); const target = resolve(args.target);
  if (source === target || !relative(source, target).startsWith('..') || !relative(target, source).startsWith('..')) throw new Error('Migration source and target must be separate, non-nested directories');
  const command = await readFile(join(source, 'cmd_config.json'), 'utf8');
  const skills = await readFile(join(source, 'skills.json'), 'utf8');
  const napcatToken = args['napcat-token-file'] ? (await readFile(args['napcat-token-file'], 'utf8')).trim() : undefined;
  const mapping = mapAstrBotXConfiguration(parseAstrBotXJson(command), parseAstrBotXJson(skills), { target, napcatWebsocketUrl: args['napcat-ws'], ...(args['napcat-http'] ? { napcatHttpUrl: args['napcat-http'] } : {}), ...(napcatToken === undefined ? {} : { napcatToken }) });
  const validation = validateConfiguration(mapping.config); if (!validation.valid) throw new Error(`Mapped configuration validation failed: ${validation.issues.join('; ')}`);
  const skillSources = new Map<string, string>();
  for (const name of mapping.activeSkills) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw new Error('Invalid source skill name');
    const roots = [join(source, 'skills'), ...(args['builtin-skills'] ? [resolve(args['builtin-skills'])] : [])];
    for (const root of roots) {
      try { const directory = await realpath(join(root, name)); const canonicalRoot = await realpath(root); if (!directory.startsWith(canonicalRoot + sep)) throw new Error('Skill leaves source root'); if ((await stat(join(directory, 'SKILL.md'))).isFile()) { skillSources.set(name, directory); break; } }
      catch (error) { const parsed = z.object({ code: z.string() }).safeParse(error); if (!(parsed.success && parsed.data.code === 'ENOENT')) throw error; }
    }
    if (!skillSources.has(name)) throw new Error(`Active skill ${name} was not found; provide --builtin-skills for AstrBotX bundled skills`);
  }
  const mcp = z.object({ mcpServers: z.record(z.string(), z.unknown()) }).parse(parseAstrBotXJson(await readFile(join(source, 'mcp_server.json'), 'utf8')));
  if (Object.keys(mcp.mcpServers).length) throw new Error('Nonempty MCP configuration requires an explicit transport/secret mapping before migration');
  const sourceHash = createHash('sha256').update(command).update(skills).update(await readFile(join(source, 'data_v4.db'))).update(await readFile(join(source, 'data_v4.db-wal')).catch((error: unknown) => { const parsed = z.object({ code: z.string() }).safeParse(error); if (parsed.success && parsed.data.code === 'ENOENT') return Buffer.alloc(0); throw error; })).digest('hex');
  const report = { format: 'priestess-astrbotx-migration-v1', sourceHash, source, target, applied: args.apply, agents: mapping.config.agents.length, platforms: mapping.config.platforms.map(p => ({ id: p.id, type: p.type, enabled: p.enabled })), activeSkills: mapping.activeSkills, secretCount: mapping.secrets.size, warnings: mapping.warnings, archivedExcludedDirectories: ['temp', 'site-packages'] };
  if (!args.apply) { console.log(JSON.stringify(report, null, 2)); return; }
  const existing = await readdir(target).catch((error: unknown) => { const parsed = z.object({ code: z.string() }).safeParse(error); if (parsed.success && parsed.data.code === 'ENOENT') return []; throw error; });
  if (existing.length) throw new Error('Migration target is nonempty; refusing to overwrite a previous import or running deployment');
  await mkdir(target, { recursive: true, mode: 0o700 }); await chmod(target, 0o700);
  const archive = join(target, 'imported', 'astrbotx');
  await mkdir(join(target, 'imported'), { recursive: true, mode: 0o700 });
  await cp(source, archive, { recursive: true, preserveTimestamps: true, filter: path => path === source || !['temp', 'site-packages'].includes(relative(source, path).split('/')[0] ?? '') });
  await chmod(archive, 0o700);
  await mkdir(join(target, 'imported', 'active-skills'), { recursive: true, mode: 0o700 });
  for (const name of mapping.activeSkills) { const directory = skillSources.get(name); if (!directory) throw new Error('Validated skill source missing'); await cp(directory, join(target, 'imported', 'active-skills', name), { recursive: true, preserveTimestamps: true }); }
  await mkdir(join(target, 'workspace'), { recursive: true, mode: 0o700 });
  for (const directory of ['workspaces', 'codex_workspaces']) {
    const origin = join(source, directory);
    const exists = await stat(origin).then(info => info.isDirectory()).catch(() => false);
    if (exists) await cp(origin, join(target, 'workspace', basename(origin)), { recursive: true, preserveTimestamps: true });
  }
  const store = new RuntimeStore(join(target, 'runtime.sqlite'));
  try {
    const counts = importAstrBotXDatabase(join(archive, 'data_v4.db'), store, mapping.personaId, { sourceRoot: archive, originalSourceRoot: source, targetRoot: target });
    for (const [name, value] of mapping.secrets) store.put('operator-secrets', name, { name, value, updatedAt: Date.now() });
    store.publishConfig(mapping.config, 0);
    const finished = { ...report, counts, completedAt: new Date().toISOString() };
    store.put('migration-reports', 'astrbotx', finished);
    await writeFile(join(target, 'astrbotx-migration-report.json'), JSON.stringify(finished, null, 2), { mode: 0o600 });
    await chmod(join(target, 'runtime.sqlite'), 0o600);
    console.log(JSON.stringify(finished, null, 2));
  } finally { store.close(); }
}
try { await run(); } catch (error) { console.error(error instanceof z.ZodError ? `Migration schema validation failed at ${error.issues.map(issue => issue.path.join('.')).join(', ')}` : error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; }
