import { z } from 'zod';

/** A generation floor, not a timestamp: old audits cannot resurrect cleared history. */
export const ConversationHistoryResetSchema = z.object({
  minimumGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  clearedAt: z.number().int().nonnegative(),
}).strict();
export const conversationHistoryResetNamespace = 'management-history-resets';

/** Explicit allowlist. Configuration, long-term memory and execution audits are retained. */
export const conversationHistoryNamespaces: readonly string[] = Object.freeze([
  'management-conversations', 'management-transcript', 'management-run-links',
  'sdk-history', 'sdk-history-legacy-dynamic-archive', 'sdk-context-usage', 'sdk-context-summary', 'sdk-context-summary-cache',
  'sdk-pauses', 'paused-inputs', 'public-group-conversations', 'run-follow-ups',
  'history-continuation-seeds', 'history-continuation-receipts',
  'astrbotx-archive-conversations', 'astrbotx-archive-platform_message_history', 'astrbotx-archive-platform_sessions',
]);
