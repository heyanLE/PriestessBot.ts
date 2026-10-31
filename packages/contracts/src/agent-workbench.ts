import { z } from 'zod';
import { AgentDefinitionSchema, AgentIdSchema, CapabilitySchema, PlatformTypeSchema, RunEventSchema, RuntimeConfigSchema } from './index.js';
import { PersonaBindingSchema } from './management.js';

export const AgentWorkbenchSaveSchema = z.object({ agent: AgentDefinitionSchema, personaId: z.string().min(1).nullable(), expectedRevision: z.number().int().nonnegative(), expectedBindingRevision: z.number().int().nonnegative() }).strict();
export type AgentWorkbenchSave = z.infer<typeof AgentWorkbenchSaveSchema>;
export const AgentWorkbenchSavedSchema = z.object({ revision: z.number().int(), config: RuntimeConfigSchema, binding: PersonaBindingSchema, impact: z.literal('running_and_queued_cancelled_approvals_invalidated') }).strict();
export const AgentDraftTestSchema = z.object({ config: RuntimeConfigSchema, agentId: AgentIdSchema, personaId: z.string().min(1).nullable(), message: z.string().trim().min(1).max(16000) }).strict();
export type AgentDraftTest = z.infer<typeof AgentDraftTestSchema>;
export const AgentDraftTestResultSchema = z.object({ mode: z.literal('draft_model_only'), saved: z.literal(false), deliveredToIm: z.literal(false), tools: z.array(z.never()), agentId: AgentIdSchema, personaId: z.string().nullable(), status: z.enum(['completed', 'failed', 'cancelled']), text: z.string(), inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), events: z.array(RunEventSchema), limits: z.object({ timeoutMs: z.number(), maxTurns: z.number(), maxTokens: z.number() }) }).strict();
export type AgentDraftTestResult = z.infer<typeof AgentDraftTestResultSchema>;

export const AgentCapabilitySchema = z.object({
  id: z.string(), label: z.string(), description: z.string(),
  kind: z.enum(['tool', 'command', 'resource', 'platform_status']),
  source: z.enum(['builtin', 'search', 'plugin', 'mcp', 'skills', 'native_extension', 'platform']), sourceId: z.string(),
  scope: z.enum(['general', 'platform']), platforms: z.array(PlatformTypeSchema), sessionTypes: z.array(z.enum(['private', 'group'])),
  toolName: z.string().optional(), bindingName: z.string().optional(), requiredCapabilities: z.array(CapabilitySchema),
  availability: z.enum(['registered', 'disabled', 'runtime_discovery', 'not_implemented']), requirements: z.array(z.string()), settingsPath: z.string(),
}).strict();
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;
export const AgentCapabilitiesSchema = z.object({ entries: z.array(AgentCapabilitySchema), note: z.string() }).strict();
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;
