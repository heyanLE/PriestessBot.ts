import { z } from 'zod';
import { ArtifactUploadResponseSchema, FlowTraceSchema, PlatformTypeSchema, RunEventSchema, RunSummarySchema, RuntimeStateSchema } from './index.js';
import { AuditPreviewSchema } from './audit.js';

export const RouteTraceStepSchema = FlowTraceSchema.extend({ durationMs: z.number().nonnegative().nullable() });
export const RouteOutcomeSchema = z.enum(['agent', 'command', 'ignored', 'rejected', 'follow_up']);
export const RouteRecordSchema = z.object({
  schemaVersion: z.literal(1).default(1), id: z.string().min(1), createdAt: z.number(), durationMs: z.number().nonnegative().nullable(),
  configRevision: z.number().int().nonnegative().nullable(), flowRevision: z.number().int().nonnegative().nullable(),
  platform: z.string(), platformType: PlatformTypeSchema.nullable(), sessionType: z.enum(['private', 'group']), sessionId: z.string(), sessionName: z.string().default(''),
  senderId: z.string(), senderName: z.string().default(''), messageId: z.string().nullable(), inputPreview: AuditPreviewSchema.nullable(),
  outcome: RouteOutcomeSchema, reason: z.string().max(1000).default(''), agentId: z.string().nullable(), runtimeState: RuntimeStateSchema.nullable(), runId: z.string().nullable(),
  path: z.array(RouteTraceStepSchema), legacy: z.boolean().default(false),
}).strict();
export type RouteRecord = z.infer<typeof RouteRecordSchema>;
export const AgentRecordMetadataSchema = z.object({ runId: z.string(), platform: z.string(), platformType: PlatformTypeSchema, sessionType: z.enum(['private', 'group']), sessionId: z.string(), sessionName: z.string().default(''), model: z.string(), engine: z.string(), runtimeState: RuntimeStateSchema, configRevision: z.number().int(), flowRevision: z.number().int(), inputPreview: AuditPreviewSchema, startedAt: z.number(), routeRecordId: z.string().nullable(), parentRunId: z.string().nullable() }).strict();
export type AgentRecordMetadata = z.infer<typeof AgentRecordMetadataSchema>;
export const AgentRecordSchema = RunSummarySchema.extend({
  platform: z.string().nullable(), platformType: PlatformTypeSchema.nullable(), sessionType: z.enum(['private', 'group']).nullable(), sessionId: z.string().nullable(), sessionName: z.string().default(''),
  conversationId: z.string().nullable(), routeRecordIds: z.array(z.string()), model: z.string().nullable(), engine: z.string().nullable(), runtimeState: RuntimeStateSchema.nullable(),
  modelCalls: z.number().int().nonnegative().nullable(), toolCalls: z.number().int().nonnegative().nullable(), inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(), durationMs: z.number().nonnegative().nullable(), firstTokenMs: z.number().nonnegative().nullable(), telemetryComplete: z.boolean(), legacy: z.boolean(),
});
export type AgentRecord = z.infer<typeof AgentRecordSchema>;
const pagination = { total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().positive() };
export const RouteRecordsResponseSchema = z.object({ records: z.array(RouteRecordSchema), ...pagination });
export const AgentRecordsResponseSchema = z.object({ records: z.array(AgentRecordSchema), ...pagination });
export const RouteRecordDetailSchema = z.object({ record: RouteRecordSchema, run: RunSummarySchema.nullable(), relatedAgentRunIds: z.array(z.string()) });
export const AgentRecordDetailSchema = z.object({
  record: AgentRecordSchema, inputPreview: AuditPreviewSchema.nullable(), events: z.array(RunEventSchema), children: z.array(AgentRecordSchema), routes: z.array(RouteRecordSchema), artifacts: z.array(ArtifactUploadResponseSchema),
  audit: z.object({ version: z.literal(1), retainedEvents: z.number().int().nonnegative(), firstSequence: z.number().int().nullable(), lastSequence: z.number().int().nullable(), eventsTruncated: z.boolean(), redaction: z.literal('bounded_redacted'), limitations: z.array(z.string()) }).strict(),
});
export const AgentRecordExportSchema = AgentRecordDetailSchema.extend({ format: z.literal('priestessbot-agent-audit-v1'), exportedAt: z.number() });
export const RouteRecordExportSchema = RouteRecordDetailSchema.extend({ format: z.literal('priestessbot-route-audit-v1'), exportedAt: z.number() });

export const RecordLinkSchema = z.object({ kind: z.enum(['route','agent']), id: z.string() }).strict();
