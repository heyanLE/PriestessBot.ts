import { z } from 'zod';

/** Public conversation content only. Tool traces and authority are deliberately absent. */
export const PublicGroupImageSchema = z.object({
  url: z.string().regex(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  source: z.object({ messageId: z.string(), senderId: z.string(), senderName: z.string().optional(), timestamp: z.number().int().nonnegative().optional(), quoted: z.boolean(), attachmentIndex: z.number().int().nonnegative() }).strict().optional(),
}).strict();
export type PublicGroupImage = z.infer<typeof PublicGroupImageSchema>;
export const PublicGroupMessageSchema = z.object({
  role: z.enum(['user', 'assistant']), text: z.string(),
  messageId: z.string(), senderId: z.string(), senderName: z.string(), timestamp: z.number().int().nonnegative(),
  images: z.array(PublicGroupImageSchema).optional(),
}).strict();
export type PublicGroupMessage = z.infer<typeof PublicGroupMessageSchema>;
export const PublicGroupTurnSchema = z.object({ runId: z.string(), messages: z.array(PublicGroupMessageSchema).min(2) }).strict();
export const PublicGroupConversationSchema = z.object({ turns: z.array(PublicGroupTurnSchema) }).strict();
export type PublicGroupTurn = z.infer<typeof PublicGroupTurnSchema>;
export const GroupConversationPolicySchema = z.object({
  maxMessages: z.number().int().min(2).max(1000).default(200),
  maxChars: z.number().int().min(256).max(1_000_000).default(32_000),
  maxImages: z.number().int().min(0).max(32).default(8),
  maxImageBytes: z.number().int().min(0).max(32 * 1024 * 1024).default(8 * 1024 * 1024),
}).strict();
export type GroupConversationPolicy = z.infer<typeof GroupConversationPolicySchema>;
