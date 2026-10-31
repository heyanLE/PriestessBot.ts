import { z } from 'zod';
export const BilibiliSettingsSchema = z.object({
  enabled: z.boolean().default(false), cookieSecret: z.string().max(100).default('BILIBILI_COOKIE'),
  accessMode: z.enum(['blacklist', 'whitelist']).default('blacklist'), groupIds: z.array(z.string()).max(200).default([]),
  autoDetect: z.boolean().default(false), autoSummary: z.boolean().default(false), autoPush: z.boolean().default(false),
  pollMinutes: z.number().int().min(5).max(1440).default(600), maxSubscriptions: z.number().int().min(1).max(100).default(20),
  summaryStyle: z.enum(['concise', 'detailed', 'professional']).default('professional'), maxSummaryChars: z.number().int().min(500).max(10000).default(3000),
  outputImage: z.boolean().default(false), cacheHours: z.number().int().min(1).max(720).default(24),
  asr: z.object({ provider: z.enum(['disabled', 'bcut', 'local_multimodal_infra']).default('disabled'), baseUrl: z.url().default('http://127.0.0.1:17890'), tokenSecret: z.string().max(100).default('BILIBILI_ASR_TOKEN'), model: z.string().max(100).default('sensevoice-small-onnx'), timeoutSeconds: z.number().int().min(30).max(1800).default(600), granularitySeconds: z.number().int().min(1).max(120).default(10), speakerDiarization: z.boolean().default(true), maxAudioBytes: z.number().int().min(1000000).max(100000000).default(30000000), maxDurationSeconds: z.number().int().min(60).max(14400).default(3600) }).default(() => ({ provider: 'disabled' as const, baseUrl: 'http://127.0.0.1:17890', tokenSecret: 'BILIBILI_ASR_TOKEN', model: 'sensevoice-small-onnx', timeoutSeconds: 600, granularitySeconds: 10, speakerDiarization: true, maxAudioBytes: 30000000, maxDurationSeconds: 3600 })),
}).strict();
export type BilibiliSettings = z.infer<typeof BilibiliSettingsSchema>;
export const BilibiliLoginStatusSchema = z.object({ authenticated: z.boolean(), source: z.enum(['none', 'secret', 'qr']), pending: z.boolean() });
export const BilibiliQrSchema = z.object({ id: z.string(), url: z.url(), expiresAt: z.number() });
export const TranscriptSegmentSchema = z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string(), speaker: z.string().optional() });
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export const BilibiliContentSchema = z.object({ bvid: z.string(), title: z.string(), source: z.enum(['subtitle', 'bcut', 'local_multimodal_infra']), segments: z.array(TranscriptSegmentSchema), text: z.string(), truncated: z.boolean() });
