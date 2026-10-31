import { z } from 'zod';
/** Provider usage anchors exact request prefixes; unmeasured tails use character-weight estimates. */
export const ContextPolicySchema = z.object({
  strategy: z.enum(['semantic', 'extractive', 'truncate_by_turns']).default('semantic'),
  contextWindowTokens: z.number().int().min(2048).max(2_000_000).default(128_000),
  compactAtTokens: z.number().int().min(1024).max(1_000_000).default(32_768),
  targetTokens: z.number().int().min(512).max(500_000).default(16_384),
  keepRecentRatio: z.number().min(0).max(0.3).default(0.15),
  trimTurns: z.number().int().min(1).max(1000).default(1),
  maxTurns: z.number().int().min(-1).max(1000).refine(value => value !== 0, 'Use -1 for unlimited turns').default(-1),
  summaryModel: z.string().max(256).default(''),
  summaryConnectionId: z.string().max(128).default(''),
  summaryMaxTokens: z.number().int().min(128).max(8192).default(2048),
  summaryTimeoutMs: z.number().int().min(1000).max(120_000).default(20_000),
  summaryInstructions: z.string().max(12_000).default(''),
}).strict().superRefine((value, context) => {
  if (value.targetTokens >= value.compactAtTokens) context.addIssue({ code: 'custom', path: ['targetTokens'], message: 'Retention target must be below compaction threshold' });
  if (value.compactAtTokens >= value.contextWindowTokens) context.addIssue({ code: 'custom', path: ['compactAtTokens'], message: 'Compaction threshold must be below context window' });
  if (value.summaryMaxTokens >= value.targetTokens) context.addIssue({ code: 'custom', path: ['summaryMaxTokens'], message: 'Summary output budget must be below retention target' });
});
export type ContextPolicy = z.infer<typeof ContextPolicySchema>;
