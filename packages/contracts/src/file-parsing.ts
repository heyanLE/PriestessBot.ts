import { z } from 'zod';

/** How document text enters the model: parsed in-process, or sent to the provider. */
export const FileParsingConfigurationSchema = z.object({
  enabled: z.boolean().default(true),
  provider: z.enum(['local', 'deepseek']).default('local'),
  maxBytes: z.number().int().min(1024).max(100_000_000).default(20_000_000),
  maxTextChars: z.number().int().min(100).max(500_000).default(80_000),
  /** Remote only: text_recognition keeps plain text, rich_layout_recognition keeps layout. */
  purpose: z.enum(['text_recognition', 'rich_layout_recognition']).default('rich_layout_recognition'),
  expiresAfterSeconds: z.number().int().min(300).max(2_592_000).default(604_800),
}).strict();

export const FileParsingSettingsSchema = FileParsingConfigurationSchema.extend({ revision: z.number().int().nonnegative().default(0) });
export type FileParsingSettings = z.infer<typeof FileParsingSettingsSchema>;

export const FileParsingStatusSchema = z.object({
  settings: FileParsingSettingsSchema,
  localFormats: z.array(z.string()),
  remoteFormats: z.array(z.string()),
  remoteAvailable: z.boolean(),
});
export type FileParsingStatus = z.infer<typeof FileParsingStatusSchema>;
