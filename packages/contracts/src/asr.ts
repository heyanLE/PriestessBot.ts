import { z } from 'zod';

/** Speech-to-text settings. The provider fixes the format and size limits. */
export const AsrConfigurationSchema = z.object({
  enabled: z.boolean().default(false),
  apiBase: z.string().url().default('https://api.deepseek.com'),
  apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/u).default('DEEPSEEK_ASR_API_KEY'),
  /** Provider hard limit is 8 MiB per request. */
  maxBytes: z.number().int().min(1024).max(8 * 1024 * 1024).default(8 * 1024 * 1024),
  timeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
  /** Provider hard limit is 120 seconds of audio. */
  maxDurationSeconds: z.number().int().min(1).max(120).default(120),
}).strict();

export const AsrSettingsSchema = AsrConfigurationSchema.extend({ revision: z.number().int().nonnegative().default(0) });
export type AsrSettings = z.infer<typeof AsrSettingsSchema>;

export const AsrStatusSchema = z.object({
  settings: AsrSettingsSchema,
  credentialConfigured: z.boolean(),
  formats: z.array(z.string()),
});
export type AsrStatus = z.infer<typeof AsrStatusSchema>;
