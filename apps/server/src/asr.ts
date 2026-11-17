import { z } from 'zod';
import type { AsrSettings } from '../../../packages/contracts/src/asr.js';
import { AsrConfigurationSchema, AsrSettingsSchema } from '../../../packages/contracts/src/asr.js';
import type { RuntimeStore } from '../../../packages/core/src/storage.js';

export class AsrError extends Error {
  override readonly name = 'AsrError';
  constructor(readonly status: number, message: string) { super(message); }
}

const Transcribed = z.object({ text: z.string(), duration_ms: z.number().int().nonnegative() });

/** Settings live beside search and file parsing; a stale revision means someone else saved first. */
export class AsrSettingsService {
  constructor(private readonly store: RuntimeStore, private readonly secret: (name: string) => string | undefined) {}
  settings(): AsrSettings { return this.store.get('asr', 'settings', AsrSettingsSchema) ?? AsrSettingsSchema.parse({}); }
  update(input: unknown, expectedRevision: number): AsrSettings {
    const config = AsrConfigurationSchema.parse(input);
    const previous = this.settings();
    if (previous.revision !== expectedRevision) throw new AsrError(409, 'ASR settings changed; reload before saving');
    const next = AsrSettingsSchema.parse({ ...config, revision: previous.revision + 1 });
    this.store.put('asr', 'settings', next);
    return next;
  }
  status() {
    const settings = this.settings();
    return { settings, credentialConfigured: Boolean(this.secret(settings.apiKeyEnv)?.trim()), formats: ['wav', 'ogg'] };
  }
}

/** True when speech input may reach the provider at all. */
export function asrAvailable(settings: AsrSettings, credential: string | undefined): boolean {
  return settings.enabled && Boolean(credential?.trim());
}

export interface Transcription { readonly text: string; readonly durationMs: number }

/**
 * DeepSeek speech-to-text: one multipart request, whole audio, no streaming.
 * Accepts 16-bit PCM WAV or Ogg Opus only; other containers fail with 400.
 */
export class DeepSeekAsr {
  constructor(private readonly settings: () => AsrSettings, private readonly secret: (name: string) => string | undefined, private readonly transport: typeof fetch = fetch) {}

  async transcribe(bytes: Uint8Array, mimeType: string, signal: AbortSignal): Promise<Transcription> {
    const settings = this.settings();
    const key = this.secret(settings.apiKeyEnv)?.trim();
    if (!settings.enabled) throw new AsrError(400, '语音识别未启用。');
    if (!key) throw new AsrError(400, '语音识别的模型凭据未配置。');
    if (bytes.length > settings.maxBytes) throw new AsrError(413, `音频超过上限（${Math.round(settings.maxBytes / 1024 / 1024)} MiB）。`);
    const base = settings.apiBase.replace(/\/+$/u, '').replace(/\/v1$/u, '');
    const endpoint = new URL(`${base}/v1/tools/asr`);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new AsrError(400, '语音识别服务地址无效。');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), `audio.${mimeType.includes('ogg') ? 'ogg' : 'wav'}`);
    const response = await this.transport(endpoint, {
      method: 'POST', body: form, redirect: 'error',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutMs)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AsrError(response.status, this.explain(response.status));
    }
    const raw = await response.text();
    let decoded: unknown;
    try { decoded = JSON.parse(raw); } catch { throw new AsrError(502, '语音识别返回了无效响应。'); }
    const parsed = Transcribed.safeParse(decoded);
    if (!parsed.success) throw new AsrError(502, '语音识别未返回文本。');
    if (!parsed.data.text.trim()) throw new AsrError(502, '语音识别结果为空。');
    return { text: parsed.data.text.trim(), durationMs: parsed.data.duration_ms };
  }

  private explain(status: number): string {
    if (status === 400) return '音频格式不受支持：只接受 16 位 PCM WAV 或 Ogg Opus。';
    if (status === 408) return '音频上传超时。';
    if (status === 413) return '音频超过服务端 8 MiB 限制。';
    if (status === 429) return '语音识别并发数已达上限，请稍后再试。';
    if (status === 503) return '语音识别服务繁忙，请稍后再试。';
    if (status === 504) return '语音识别超时。';
    return `语音识别失败（HTTP ${status}）。`;
  }
}
