import { z } from 'zod';

export const ModelFileUploadSchema = z.object({
  provider: z.literal('deepseek').default('deepseek'),
  purpose: z.enum(['text_recognition', 'rich_layout_recognition']).default('rich_layout_recognition'),
  expiresAfterSeconds: z.number().int().min(3600).max(2592000).default(604800),
}).strict();

export const ModelFileReferenceSchema = z.object({
  provider: z.literal('deepseek'), connectionId: z.string(), fileId: z.string().regex(/^file-api-[A-Za-z0-9_-]+$/),
  expiresAt: z.number().int().positive(),
}).strict();
export type ModelFileReference = z.infer<typeof ModelFileReferenceSchema>;
