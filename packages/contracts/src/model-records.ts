import { z } from 'zod';

export const ModelPayloadKindSchema = z.enum(['sdk_request', 'sdk_response', 'provider_request', 'provider_response']);
export const ModelPayloadDocumentSchema = z.object({
  id: z.string().uuid(), runId: z.string().min(1), callId: z.string().min(1), modelCall: z.number().int().positive(),
  model: z.string(), source: z.enum(['model', 'compression', 'finalization']), kind: ModelPayloadKindSchema,
  attempt: z.number().int().nonnegative(), contentType: z.string(), httpStatus: z.number().int().optional(),
  status: z.enum(['writing', 'complete', 'failed']), bytes: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(), error: z.string().optional(),
}).strict();
export type ModelPayloadDocument = z.infer<typeof ModelPayloadDocumentSchema>;
export const ModelPayloadListSchema = z.object({ documents: z.array(ModelPayloadDocumentSchema), legacy: z.boolean() }).strict();
export type ModelPayloadList = z.infer<typeof ModelPayloadListSchema>;
