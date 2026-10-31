import { z } from 'zod';
import { AgentDefinitionSchema, BudgetSchema, CapabilitySchema, MessageEventSchema, PrincipalSchema, ResourceBindingsSchema, RunIdSchema, AgentIdSchema, RuntimeStateSchema, type EngineInput } from '../../../packages/contracts/src/index.js';
export const PersistedEngineInputSchema = z.object({
  agent: AgentDefinitionSchema, message: MessageEventSchema, additionalContext: z.string(),
  session: z.object({ engine: z.string(), version: z.string(), id: z.string() }),
  context: z.object({ runId: RunIdSchema, turnId: z.string(), principal: PrincipalSchema, agentId: AgentIdSchema, generationAgentId: AgentIdSchema.optional(), generation: z.number().int(), configRevision: z.number().int(), flowRevision: z.number().int(), runtimeState: RuntimeStateSchema, effectiveCapabilities: z.array(CapabilitySchema), resources: ResourceBindingsSchema, grantVersion: z.number().int(), budget: BudgetSchema, parentRunId: RunIdSchema.optional(), depth: z.number().int() })
});
export function persistInput(input: EngineInput): z.infer<typeof PersistedEngineInputSchema> {
  return PersistedEngineInputSchema.parse({ ...input, context: input.context });
}
