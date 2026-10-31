import { z } from 'zod';

export const GROUP_HISTORY_TOOL = 'get_group_message_history';
export const GroupHistorySearchQuerySchema = z.object({
  limit: z.number().int().min(1).max(50).default(20).describe('Maximum messages to return. The default is 20.'),
  before_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().default(null).describe('Use next_before_id from the previous result. Null starts with the newest messages. This is a local ID.'),
  keyword: z.string().max(1000).nullable().default(null).describe('Literal text filter, without case sensitivity. Null disables this filter.'),
  sender: z.string().max(256).nullable().default(null).describe('Literal sender ID or name filter, without case sensitivity. Null disables this filter.'),
}).strict();
export type GroupHistorySearchQuery = z.input<typeof GroupHistorySearchQuerySchema>;
export const GroupHistorySearchMessageSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  timestamp: z.number().int().nonnegative(),
  role: z.enum(['user', 'bot']),
  senderId: z.string().max(256),
  senderName: z.string().max(256),
  messageId: z.string().max(512),
  text: z.string().max(4000),
  truncated: z.boolean(),
}).strict();
export type GroupHistorySearchMessage = z.infer<typeof GroupHistorySearchMessageSchema>;
export const GroupHistorySearchResultSchema = z.object({
  messages: z.array(GroupHistorySearchMessageSchema).max(50),
  has_more: z.boolean(),
  next_before_id: z.number().int().positive().nullable(),
  notice: z.string(),
}).strict();
export type GroupHistorySearchResult = z.infer<typeof GroupHistorySearchResultSchema>;
