import { z } from 'zod';
import { AuditPreviewSchema } from './audit.js';
import { ContextPolicySchema } from './context-policy.js';
export { ContextPolicySchema, type ContextPolicy } from './context-policy.js';

export const AgentIdSchema = z.string().min(1).max(128).brand<'AgentId'>();
export const RunIdSchema = z.string().min(1).max(128).brand<'RunId'>();
export const SessionIdSchema = z.string().min(1).max(256).brand<'SessionId'>();
export const ArtifactIdSchema = z.string().min(1).max(128).brand<'ArtifactId'>();
export type AgentId = z.infer<typeof AgentIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export const ArtifactUploadResponseSchema = z.object({ id: ArtifactIdSchema, url: z.string().startsWith('artifact:'), name: z.string(), mimeType: z.string(), size: z.number().int().nonnegative() }).strict();
export type ArtifactUploadResponse = z.infer<typeof ArtifactUploadResponseSchema>;
export const ArtifactsResponseSchema = z.object({ artifacts: z.array(ArtifactUploadResponseSchema) });
export type ArtifactsResponse = z.infer<typeof ArtifactsResponseSchema>;
export const RuntimeStateSchema = z.enum(['operator', 'senior_operator', 'elite_operator']);
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;
export const runtimeStateLabels: Readonly<Record<RuntimeState, string>> = { operator: '普通干员态', senior_operator: '资深干员态', elite_operator: '高级资深干员态' };
export const runtimeStateRanks: Readonly<Record<RuntimeState, number>> = Object.freeze({ operator: 0, senior_operator: 1, elite_operator: 2 });
export const CapabilitySchema = z.enum(['chat', 'knowledge.read', 'memory.read', 'memory.write', 'files.read', 'files.write', 'process.execute.restricted', 'process.execute', 'process.pty', 'external.write', 'conversation.reset', 'conversation.stop', 'agent.delegate', 'resources.manage', 'admin']);
export type Capability = z.infer<typeof CapabilitySchema>;
const operatorCapabilities: readonly Capability[] = ['chat', 'knowledge.read', 'memory.read', 'memory.write', 'files.read', 'conversation.stop', 'agent.delegate', 'process.execute.restricted'];
const seniorOperatorCapabilities: readonly Capability[] = [...operatorCapabilities, 'files.write', 'external.write', 'conversation.reset'];
/** Application-owned role policy. Agent tools and resource boundaries remain separate. */
export const runtimeStateCapabilities: Readonly<Record<RuntimeState, readonly Capability[]>> = {
  operator: operatorCapabilities,
  senior_operator: seniorOperatorCapabilities,
  elite_operator: [...seniorOperatorCapabilities, 'process.execute', 'process.pty', 'resources.manage', 'admin'],
};
for (const capabilities of Object.values(runtimeStateCapabilities)) Object.freeze(capabilities);
Object.freeze(runtimeStateCapabilities);
export function requiredRuntimeState(capabilities: readonly Capability[]): RuntimeState {
  if (capabilities.every(capability => runtimeStateCapabilities.operator.includes(capability))) return 'operator';
  if (capabilities.every(capability => runtimeStateCapabilities.senior_operator.includes(capability))) return 'senior_operator';
  return 'elite_operator';
}
export const PlatformTypeSchema = z.enum(['telegram', 'napcat', 'weixin']);
export type PlatformType = z.infer<typeof PlatformTypeSchema>;
export const MediaAttachmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image'), url: z.string().min(1), mimeType: z.string().default('image/jpeg'), artifactId: ArtifactIdSchema.optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() }).strict(),
  z.object({ type: z.literal('file'), url: z.string().min(1), name: z.string().min(1), mimeType: z.string(), size: z.number().int().nonnegative().optional(), artifactId: ArtifactIdSchema.optional(), extractedText: z.string().max(200_000).optional() }).strict(),
]);
export type MediaAttachment = z.infer<typeof MediaAttachmentSchema>;
export const ContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(200_000) }).strict(),
  ...MediaAttachmentSchema.options,
  z.object({ type: z.literal('mention'), userId: z.string(), name: z.string().optional() }).strict(),
  z.object({ type: z.literal('quote'), messageId: z.string(), senderId: z.string().optional(), senderName: z.string().optional(), timestamp: z.number().int().nonnegative().optional(), text: z.string().max(200_000).optional(), attachments: z.array(MediaAttachmentSchema).max(20).optional(), forwardedSources: z.array(z.object({ attachmentIndex: z.number().int().min(0).max(19), senderId: z.string(), senderName: z.string().optional(), timestamp: z.number().int().nonnegative().optional() }).strict()).max(20).optional(), availability: z.enum(['available', 'partial', 'unavailable']).optional(), unavailableReason: z.enum(['missing', 'scope_mismatch', 'limit', 'media_unavailable']).optional() }).strict(),
  z.object({ type: z.literal('reference'), artifactId: ArtifactIdSchema, label: z.string() }).strict(),
]);
export type ContentPart = z.infer<typeof ContentPartSchema>;
export const MessageEventSchema = z.object({ platform: z.string().min(1), platformType: PlatformTypeSchema, sessionId: SessionIdSchema, sessionName: z.string().max(1000).optional(), sessionType: z.enum(['private', 'group']), senderId: z.string().min(1), senderName: z.string().default(''), messageId: z.string().min(1), timestamp: z.number().int().nonnegative(), parts: z.array(ContentPartSchema).max(100), botId: z.string().min(1) }).strict();
export type MessageEvent = z.infer<typeof MessageEventSchema>;
export const PrincipalSchema = z.object({ platform: z.string(), senderId: z.string(), sessionId: SessionIdSchema, sessionType: z.enum(['private', 'group']).optional() }).strict();
export type Principal = z.infer<typeof PrincipalSchema>;
export const ResourceBindingsSchema = z.object({ memoryLibraries: z.array(z.string()).default([]), knowledgeLibraries: z.array(z.string()).default([]), skills: z.array(z.string()).default([]), mcpServers: z.array(z.string()).default([]), tools: z.array(z.string()).default([]), directories: z.array(z.string()).default([]), executionEnvironment: z.string().default('none') }).strict();
export type ResourceBindings = z.infer<typeof ResourceBindingsSchema>;
export const BudgetSchema = z.object({ tokenLimitMode:z.enum(['cumulative','context']).default('cumulative'), maxTurns: z.number().int().min(1).max(100).default(12), maxTokens: z.number().int().positive().max(1_000_000).default(32_000), timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000), maxDelegationDepth: z.number().int().min(0).max(8).default(2), maxDelegations: z.number().int().min(0).max(32).default(4), maxConcurrentChildren: z.number().int().min(1).max(8).default(2) }).strict();
export type Budget = z.infer<typeof BudgetSchema>;
export const ExampleDialogSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(20_000), scene: z.string().trim().min(1).max(120).optional() }).strict();
export const ExampleDialogsSchema = z.array(ExampleDialogSchema).max(100).refine(dialogs => dialogs.length % 2 === 0 && dialogs.every((dialog, index) => dialog.role === (index % 2 === 0 ? 'user' : 'assistant')), 'Example dialogs must alternate complete user/assistant pairs').refine(dialogs => dialogs.reduce((total, dialog) => total + dialog.content.length, 0) <= 100_000, 'Example dialogs exceed the total character limit').refine(dialogs => dialogs.every(dialog => dialog.scene === undefined || dialog.role === 'user'), 'A scene must begin with a user message');
export type ExampleDialog = z.infer<typeof ExampleDialogSchema>;
export const AgentDefinitionSchema = z.object({ id: AgentIdSchema, displayName: z.string().min(1), enabled: z.boolean().default(true), engine: z.literal('agents_sdk').default('agents_sdk'), model: z.string().min(1).default('gpt-4.1-mini'), connectionId: z.string().default('default'), instructions: z.string().default(''), persona: z.string().default(''), exampleDialogs: ExampleDialogsSchema.default([]), skillAllowlist: z.array(z.string().min(1)).nullable().default(null), customErrorMessage: z.string().max(10_000).nullable().default(null), voicePrompt: z.string().max(20_000).nullable().default(null), permissionDenied: z.string().default('权限不足。'), capabilities: z.array(CapabilitySchema).default(['chat']), resources: ResourceBindingsSchema.default(() => ResourceBindingsSchema.parse({})), budget: BudgetSchema.default(() => BudgetSchema.parse({})), contextPolicy: ContextPolicySchema.default(() => ContextPolicySchema.parse({})), delegationTargets: z.array(AgentIdSchema).default([]), approvalTools: z.array(z.string()).default([]), memoryExtraction: z.object({ enabled: z.boolean().default(false), libraryId: z.string().optional() }).strict().default({ enabled: false }) }).strict();
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export const LegacyGrantSchema = z.object({ platform: z.string().trim().min(1), senderId: z.string().trim().min(1).max(256), sessionId: SessionIdSchema.optional(), sessionType: z.enum(['private', 'group']).optional(), maximumState: RuntimeStateSchema, defaultState: RuntimeStateSchema.default('operator'), capabilities: z.array(CapabilitySchema), resources: ResourceBindingsSchema }).strict().refine(grant => runtimeStateRanks[grant.defaultState] <= runtimeStateRanks[grant.maximumState], '旧授权默认运行态高于最高运行态。请先修正旧配置。');
export const SenderRoleSchema = z.object({ platform: z.string().trim().min(1), senderIds: z.array(z.string().trim().min(1).max(256)).min(1).max(200).transform(ids => [...new Set(ids)]), state: RuntimeStateSchema, sessionId: SessionIdSchema.optional(), sessionType: z.enum(['private', 'group']).optional() }).strict();
/** Legacy ceilings never select the new role. Explicitly preserve the former default. */
export const GrantSchema = z.union([SenderRoleSchema, LegacyGrantSchema.transform(grant => SenderRoleSchema.parse({ platform: grant.platform, senderIds: [grant.senderId], state: grant.defaultState, ...(grant.sessionId === undefined ? {} : { sessionId: grant.sessionId }), ...(grant.sessionType === undefined ? {} : { sessionType: grant.sessionType }) }))]);
export type Grant = z.infer<typeof GrantSchema>;
export const GrantListSchema = z.array(GrantSchema).superRefine((grants, context) => {
  const assigned = new Map<string, RuntimeState>();
  grants.forEach((grant, index) => {
    for (const senderId of grant.senderIds) {
      const key = JSON.stringify([grant.platform, grant.sessionType ?? null, grant.sessionId ?? null, senderId]);
      const existing = assigned.get(key);
      if (existing !== undefined && existing !== grant.state) context.addIssue({ code: 'custom', path: [index, 'senderIds'], message: `发送者 ${senderId} 在同一范围内被分配了不同运行态。请保留一条授权。` });
      assigned.set(key, grant.state);
    }
  });
});
const platformBase = { id: z.string().min(1), displayName: z.string().default(''), enabled: z.boolean().default(false) };
/** NapCat distinguishes QQ face IDs from single Unicode code points. */
export function normalizeNapCatReactionEmoji(value: string): string | undefined {
  const emoji = value.trim();
  if (/^[0-9]+$/u.test(emoji)) return emoji;
  const characters = Array.from(emoji.replaceAll('\uFE0F', ''));
  const point = characters.length === 1 ? characters[0]?.codePointAt(0) : undefined;
  return point !== undefined && point >= 1000 ? String(point) : undefined;
}
export const NapCatPreAckEmojiSchema = z.object({
  enabled: z.boolean().default(false),
  emojis: z.array(z.string().trim().min(1).max(32).refine(value => normalizeNapCatReactionEmoji(value) !== undefined, 'Use a QQ face ID or a single supported Unicode emoji')).max(32).default(['124']),
}).strict();
export const PlatformConfigSchema = z.discriminatedUnion('type', [
  z.object({ ...platformBase, type: z.literal('telegram'), tokenEnv: z.string().min(1), apiBase: z.string().url().default('https://api.telegram.org'), pollingTimeoutSeconds: z.number().int().min(1).max(60).default(30) }).strict(),
  z.object({ ...platformBase, type: z.literal('napcat'), websocketUrl: z.string().url(), accessTokenEnv: z.string().default('NAPCAT_TOKEN'), apiBase: z.string().url().optional(), forwardThreshold: z.number().int().min(0).max(200_000).default(1500), preAckEmoji: NapCatPreAckEmojiSchema.default({ enabled: false, emojis: ['124'] }) }).strict(),
  z.object({ ...platformBase, type: z.literal('weixin'), apiBase: z.string().url().default('https://ilinkai.weixin.qq.com'), tokenEnv: z.string().default('WEIXIN_TOKEN'), accountId: z.string().default(''), stateFile: z.string().default('weixin-state.json') }).strict(),
]);
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;
export const RouteRuleSchema = z.object({ id: z.string(), platform: z.string().optional(), sessionId: SessionIdSchema.optional(), sessionType: z.enum(['private', 'group']).optional(), senderId: z.string().optional(), textIncludes: z.string().optional(), agentId: AgentIdSchema }).strict();
export const MessageAllowlistSchema = z.object({ enabled: z.boolean().default(false), entries: z.array(z.object({ platform: z.string().min(1), sessionType: z.enum(['private', 'group']), sessionId: z.string().min(1) }).strict()).default([]), administrators: z.array(z.object({ platform: z.string().min(1), senderId: z.string().min(1) }).strict()).default([]), bypassAdministratorsInPrivate: z.boolean().default(false), bypassAdministratorsInGroups: z.boolean().default(false) }).strict();
const defaultMessageAllowlist = () => MessageAllowlistSchema.parse({});
export const FlowConfigSchema = z.object({ id: z.literal('default-im-flow').default('default-im-flow'), revision: z.number().int().nonnegative().default(0), normalization: z.object({ dedupeWindowMs: z.number().int().min(1000).max(86_400_000).default(300_000), maxMessageChars: z.number().int().min(1).max(200_000).default(32_000) }).strict().default(() => ({ dedupeWindowMs: 300_000, maxMessageChars: 32_000 })), acceptance: z.object({ privateEnabled: z.boolean().default(true), groupPolicy: z.enum(['mention_or_reply', 'all', 'disabled']).default('mention_or_reply'), groupCommandsRequireAttention: z.boolean().default(false), allowlist: MessageAllowlistSchema.default(defaultMessageAllowlist), rateLimitCount: z.number().int().min(0).max(1000).default(30), rateLimitWindowMs: z.number().int().min(1000).max(3_600_000).default(60_000) }).strict().default({ privateEnabled: true, groupPolicy: 'mention_or_reply', groupCommandsRequireAttention: false, allowlist: defaultMessageAllowlist(), rateLimitCount: 30, rateLimitWindowMs: 60_000 }), authorization: z.object({ maximumState: RuntimeStateSchema.default('elite_operator') }).strict().default({ maximumState: 'elite_operator' }), routing: z.object({ defaultAgentId: AgentIdSchema, rules: z.array(RouteRuleSchema).max(100) }).strict(), commands: z.object({ prefix: z.string().min(1).max(8).default('/') }).strict().default(() => ({ prefix: '/' })), context: z.object({ memoryLimit: z.number().int().min(0).max(30).default(8), knowledgeLimit: z.number().int().min(0).max(30).default(6), maxChars: z.number().int().min(100).max(100_000).default(16_000) }).strict().default(() => ({ memoryLimit: 8, knowledgeLimit: 6, maxChars: 16_000 })), execution: z.object({ globalConcurrency: z.number().int().min(1).max(128).default(4), perSessionQueueLimit: z.number().int().min(1).max(1000).default(16), globalQueueLimit: z.number().int().min(1).max(10000).default(256), timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000), maxTurns: z.number().int().min(1).max(100).default(12) }).strict().default(() => ({ globalConcurrency: 4, perSessionQueueLimit: 16, globalQueueLimit: 256, timeoutMs: 120_000, maxTurns: 12 })), delivery: z.object({ stream: z.boolean().default(true), throttleMs: z.number().int().min(100).max(10_000).default(1000), fallback: z.enum(['final', 'chunks']).default('final'), chunkChars: z.number().int().min(100).max(8000).default(2000) }).strict().default({ stream: true, throttleMs: 1000, fallback: 'final', chunkChars: 2000 }) }).strict();
export type FlowConfig = z.infer<typeof FlowConfigSchema>;
export const ConnectionSchema = z.object({ id: z.string().min(1), baseUrl: z.string().url().optional(), apiKeyEnv: z.string().min(1).default('OPENAI_API_KEY'), protocol: z.enum(['responses', 'chat_completions']).default('responses') }).strict();
export const LibrarySchema = z.object({ id: z.string().min(1), displayName: z.string().min(1) }).strict();
export const ExecutionEnvironmentSchema = z.object({ id: z.string().min(1), type: z.enum(['local', 'docker', 'sdk_docker']), root: z.string().min(1), image: z.string().optional(), networkEnabled: z.boolean().default(false) }).strict();
export const McpServerConfigSchema = z.object({ id: z.string().min(1), transport: z.enum(['stdio', 'sse', 'streamable_http']), command: z.string().optional(), args: z.array(z.string()).default([]), url: z.string().url().optional(), envRefs: z.record(z.string(), z.string()).default({}), headersEnv: z.record(z.string(), z.string()).default({}) }).strict();
export const SkillLibrarySchema = z.object({ id: z.string().min(1), directory: z.string().min(1) }).strict();
export const EmbeddingConfigSchema = z.object({ connectionId: z.string(), model: z.string(), dimensions: z.number().int().positive() }).strict();
export const RerankerConfigSchema = z.object({ url: z.string().url(), apiKeyEnv: z.string(), model: z.string() }).strict();
export const RuntimeConfigSchema = z.object({ runtime: z.literal('priestess-ts'), schemaVersion: z.literal(1), revision: z.number().int().nonnegative().default(0), agents: z.array(AgentDefinitionSchema).min(1), platforms: z.array(PlatformConfigSchema).default([]), grants: GrantListSchema.default([]), connections: z.array(ConnectionSchema).default([{ id: 'default', apiKeyEnv: 'OPENAI_API_KEY', protocol: 'responses' }]), memoryLibraries: z.array(LibrarySchema).default([]), knowledgeLibraries: z.array(LibrarySchema).default([]), executionEnvironments: z.array(ExecutionEnvironmentSchema).default([]), mcpServers: z.array(McpServerConfigSchema).default([]), skillLibraries: z.array(SkillLibrarySchema).default([]), embedding: EmbeddingConfigSchema.optional(), reranker: RerankerConfigSchema.optional(), flow: FlowConfigSchema }).strict();
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export const ReplyPlanSchema = z.object({ parts: z.array(ContentPartSchema), replyTo: z.string().optional() }).strict();
export type ReplyPlan = z.infer<typeof ReplyPlanSchema>;
export const ErrorSchema = z.object({ code: z.enum(['invalid_input', 'forbidden', 'not_found', 'conflict', 'queue_full', 'cancelled', 'timeout', 'unsupported', 'internal']), message: z.string(), retryable: z.boolean().default(false) }).strict();
export type DomainError = z.infer<typeof ErrorSchema>;
export interface RunContext { readonly runId: RunId; readonly turnId: string; readonly principal: Principal; readonly agentId: AgentId; readonly generation: number; readonly generationAgentId?: AgentId; readonly configRevision: number; readonly flowRevision: number; readonly runtimeState: RuntimeState; readonly effectiveCapabilities: readonly Capability[]; readonly resources: ResourceBindings; readonly grantVersion: number; readonly signal: AbortSignal; readonly budget: Budget; readonly parentRunId?: RunId; readonly depth: number; }
export const FlowNodeIdSchema = z.enum(['input', 'normalize', 'accept', 'authorize', 'route', 'command', 'context', 'agent', 'deliver', 'end']);
export type FlowNodeId = z.infer<typeof FlowNodeIdSchema>;
const eventBase = { runId: RunIdSchema, turnId: z.string(), sequence: z.number().int().nonnegative(), timestamp: z.number().int() };
export const RunEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('node'), nodeId: FlowNodeIdSchema, status: z.enum(['started', 'completed', 'failed']), summary: z.string(), durationMs: z.number().nonnegative() }),
  z.object({ ...eventBase, type: z.literal('started'), agentId: AgentIdSchema }),
  z.object({ ...eventBase, type: z.literal('message_delta'), text: z.string() }),
  z.object({ ...eventBase, type: z.literal('message_snapshot'), text: z.string() }),
  z.object({ ...eventBase, type: z.literal('tool'), name: z.string(), callId: z.string(), status: z.enum(['started', 'completed', 'failed']), summary: z.string(), inputPreview: AuditPreviewSchema.optional(), outputPreview: AuditPreviewSchema.optional(), durationMs: z.number().nonnegative().optional(), modelCall: z.number().int().nonnegative().optional() }),
  z.object({ ...eventBase, type: z.literal('model_call'), callId: z.string(), modelCall: z.number().int().positive().optional(), model: z.string(), source: z.enum(['model', 'compression', 'finalization']), status: z.enum(['started', 'completed', 'failed', 'cancelled']), inputPreview: AuditPreviewSchema.optional(), outputPreview: AuditPreviewSchema.optional(), durationMs: z.number().nonnegative().optional(), firstTokenMs: z.number().nonnegative().optional(), inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), error: z.string().max(500).optional() }),
  z.object({ ...eventBase, type: z.literal('usage'), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), source:z.enum(['model','compression','finalization','delegation']).optional(), modelCall:z.number().int().positive().optional() }),
  z.object({ ...eventBase, type: z.literal('completed'), text: z.string() }),
  z.object({ ...eventBase, type: z.literal('failed'), error: ErrorSchema }),
  z.object({ ...eventBase, type: z.literal('cancelled'), reason: z.string() }),
  z.object({ ...eventBase, type: z.literal('paused'), approvalId: z.string(), tools: z.array(z.string()) }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export interface EngineSessionRef { readonly engine: string; readonly version: string; readonly id: string; }
export interface EngineCapabilities { readonly streaming: boolean; readonly images: boolean; readonly files: boolean; readonly cancellation: boolean; readonly approvals: boolean; readonly steering: boolean; }
export interface EngineInput { readonly agent: AgentDefinition; readonly context: RunContext; readonly message: MessageEvent; readonly additionalContext: string; readonly session: EngineSessionRef; }
export interface EngineResult { readonly status: 'completed' | 'cancelled' | 'paused'; readonly text: string; readonly inputTokens: number; readonly outputTokens: number; readonly state?: string; }
export interface AgentEngine { readonly id: string; readonly version: string; readonly capabilities: EngineCapabilities; run(input: EngineInput, emit: (event: RunEvent) => void): Promise<EngineResult>; }
export function unreachable(value: never): never { throw new Error(`Unexpected variant: ${String(value)}`); }
export function messageText(event: MessageEvent): string { return event.parts.filter(part => part.type === 'text').map(part => part.text).join('\n'); }
export const ConfigSnapshotSchema = z.object({ revision: z.number().int(), config: RuntimeConfigSchema });
export const ConfigValidationSchema = z.object({ valid: z.boolean(), issues: z.array(z.string()) });
export const FlowTraceSchema = z.object({ nodeId: FlowNodeIdSchema, status: z.enum(['passed', 'rejected', 'ignored']), summary: z.string(), durationMs: z.number().nonnegative() });
export const FlowSimulationSchema = z.object({ revision: z.number().int(), outcome: z.enum(['agent', 'command', 'ignored', 'rejected']), agentId: AgentIdSchema.optional(), runtimeState: RuntimeStateSchema.optional(), reason: z.string().optional(), path: z.array(FlowTraceSchema) });
export type FlowSimulation = z.infer<typeof FlowSimulationSchema>;
export const RunSummarySchema = z.object({ id: z.string(), sessionKey: z.string(), agentId: z.string(), senderId: z.string(), parentRunId: z.string().optional(), generation: z.number().int(), status: z.enum(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'interrupted']), createdAt: z.number(), updatedAt: z.number(), summary: z.string().default('') });
export const RunsResponseSchema = z.object({ runs: z.array(RunSummarySchema) });
export const RunDetailSchema = z.object({ run: RunSummarySchema, events: z.array(RunEventSchema) });
export const PlatformStatusSchema = z.object({ id: z.string(), status: z.enum(['disabled', 'starting', 'connected', 'error', 'stopped']), message: z.string().optional() });
export const PlatformsResponseSchema = z.object({ platforms: z.array(PlatformStatusSchema) });
export const WeixinQrSessionSchema = z.object({ id: z.string(), qrUrl: z.string(), status: z.enum(['pending', 'scanned', 'confirmed', 'expired', 'failed']) });
export const MemoryRecordSchema = z.object({ id: z.string(), libraryId: z.string(), agentId: AgentIdSchema, principal: PrincipalSchema, scope: z.enum(['sender', 'session', 'agent']), text: z.string().min(1).max(20_000), source: z.string(), confidence: z.number().min(0).max(1), createdAt: z.number(), updatedAt: z.number(), expiresAt: z.number().optional() });
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
export const MemoriesResponseSchema = z.object({ memories: z.array(MemoryRecordSchema) });
export const KnowledgeDocumentSchema = z.object({ id: z.string(), libraryId: z.string(), name: z.string(), mimeType: z.enum(['text/plain', 'text/markdown', 'application/pdf']), version: z.number().int(), status: z.enum(['pending', 'indexing', 'ready', 'failed']), error: z.string().optional(), chunkCount: z.number().int(), createdAt: z.number(), updatedAt: z.number() });
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
export const KnowledgeResponseSchema = z.object({ documents: z.array(KnowledgeDocumentSchema) });
export const KnowledgeHitSchema = z.object({ id: z.string(), libraryId: z.string(), documentId: z.string(), documentName: z.string(), version: z.number().int(), text: z.string(), page: z.number().int().optional(), score: z.number() });
export type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>;
export const KnowledgeSearchResponseSchema = z.object({ hits: z.array(KnowledgeHitSchema) });
export const EnvironmentsResponseSchema = z.object({ environments: z.array(z.object({ id: z.string(), type: ExecutionEnvironmentSchema.shape.type, available: z.boolean(), isolation: z.enum(['trusted-host', 'container']) })) });
export type EnvironmentsResponse = z.infer<typeof EnvironmentsResponseSchema>;
export const ProcessSnapshotSchema = z.object({ id: z.string(), status: z.enum(['running', 'completed', 'failed', 'cancelled']), output: z.string(), offset: z.number().int().nonnegative(), truncated: z.boolean(), originalChars:z.number().int().nonnegative().optional(), originalEstimatedTokens:z.number().int().nonnegative().optional(), returnedFrom:z.number().int().nonnegative().optional(), nextOffset:z.number().int().nonnegative().optional(), fullOutputAvailable:z.boolean().optional(), droppedChars:z.number().int().nonnegative().optional(),retainedThrough:z.number().int().nonnegative().optional(),exitCode: z.number().int().optional() });
export const ProcessesResponseSchema = z.object({ processes: z.array(ProcessSnapshotSchema) });
export type ProcessesResponse = z.infer<typeof ProcessesResponseSchema>;
export const JobSchema = z.object({ id: z.string(), kind: z.enum(['memory_extraction', 'knowledge_import']), runId: z.string().optional(), status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']), createdAt: z.number(), updatedAt: z.number(), summary: z.string() });
export const JobsResponseSchema = z.object({ jobs: z.array(JobSchema) });
export type RuntimeJob = z.infer<typeof JobSchema>;
export type JobsResponse = z.infer<typeof JobsResponseSchema>;
