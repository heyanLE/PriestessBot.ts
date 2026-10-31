import { z } from 'zod';
import { RuntimeStateSchema } from './index.js';

export const ToolOutputRecordSchema = z.object({
  id: z.string().uuid(), owner: z.string(), agentId: z.string(), generation: z.number().int().nonnegative(),
  grantVersion: z.number().int().nonnegative(), runtimeState: RuntimeStateSchema, sourceToolName: z.string().min(1), sourceEpoch: z.string().default(''),
  createdAt: z.number(), expiresAt: z.number(), bytes: z.number().int().nonnegative(), totalChars: z.number().int().nonnegative(), sha256: z.string().length(64),
}).strict();
export type ToolOutputRecord = z.infer<typeof ToolOutputRecordSchema>;
export const ToolOutputReadSchema = z.object({
  id: z.string().uuid(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(32_000).default(16_000),
  maxTokens: z.number().int().min(1).max(7000).optional(),
}).strict();
export type ToolOutputRead = z.input<typeof ToolOutputReadSchema>;
export const ToolOutputSearchSchema = z.object({
  id: z.string().uuid(), query: z.string().min(1).max(1000), offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(50).default(10), contextChars: z.number().int().min(0).max(1000).default(240),
  maxTokens: z.number().int().min(1).max(7000).optional(),
}).strict();
export type ToolOutputSearch = z.input<typeof ToolOutputSearchSchema>;
export interface ToolOutputPage {
  readonly id: string; readonly text: string; readonly offset: number; readonly nextOffset: number;
  readonly totalChars: number; readonly truncated: boolean; readonly eof: boolean; readonly fullResultAvailable: true;
}
export interface ToolOutputSearchPage {
  readonly id: string; readonly matches: readonly { readonly offset: number; readonly text: string }[];
  readonly nextOffset: number; readonly totalChars: number; readonly truncated: boolean; readonly eof: boolean; readonly fullResultAvailable: true;
}
