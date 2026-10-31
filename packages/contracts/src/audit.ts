import { z } from 'zod';

/** Admin-visible excerpts, never raw provider payloads or unbounded binary content. */
export const AuditPreviewSchema = z.object({ text: z.string().max(8000), originalChars: z.number().int().nonnegative(), truncated: z.boolean(), redacted: z.boolean() }).strict();
export type AuditPreview = z.infer<typeof AuditPreviewSchema>;
