import { z } from 'zod';
import type { ContentPart, MessageEvent, ReplyPlan } from '../../../contracts/src/index.js';
import { downloadPublic } from '../media/download.js';
import { PlatformError, delay, type HttpFetch } from './transport.js';
import type { AdapterDependencies, AdapterLifecycle, DeliveryOutcome, DownloadedMedia, PlatformAdapter, PlatformCapabilities, PlatformTarget } from './types.js';
const effectSchema = z.object({ status: z.enum(['pending', 'confirmed', 'failed']), messageId: z.string().optional() });
export abstract class BasePlatformAdapter implements PlatformAdapter {
  abstract readonly capabilities: PlatformCapabilities;
  protected readonly fetcher: HttpFetch;
  protected controller = new AbortController();
  private loop: Promise<void> | undefined;
  private readonly deliveries = new Map<string, Promise<DeliveryOutcome>>();
  constructor(readonly id: string, protected readonly deps: AdapterDependencies) { this.fetcher = deps.fetch ?? fetch; }
  abstract start(receive: (event: MessageEvent) => Promise<void>): Promise<void>;
  protected beginStart(): void {
    if (this.loop) throw new Error('Adapter already started');
    this.controller = new AbortController();
    this.reportStatus({ status: 'starting' });
  }
  protected reportStatus(state: AdapterLifecycle): void {
    if (!this.controller.signal.aborted || state.status === 'stopped') this.deps.onStatus?.(this.id, state);
  }
  protected launch(poll: () => Promise<void>): void {
    if (this.loop) throw new Error('Adapter already started');
    if (this.controller.signal.aborted) return;
    this.loop = (async () => {
      while (!this.controller.signal.aborted) {
        try { await poll(); }
        catch (error) {
          if (this.controller.signal.aborted) break;
          const failure = error instanceof PlatformError ? error : new PlatformError('network', 'Adapter processing failed');
          this.reportStatus({ status: 'error', message: failure.kind });
          this.deps.onError?.(this.id, failure.kind);
          await delay(Math.max(1000, failure.retryAfterMs), this.controller.signal);
        }
      }
    })();
  }
  async stop(): Promise<void> { this.controller.abort(); await this.loop; this.loop = undefined; this.reportStatus({ status: 'stopped' }); }
  abstract send(target: PlatformTarget, reply: ReplyPlan, deliveryId: string): Promise<DeliveryOutcome>;
  edit(...request: readonly [PlatformTarget, string, string]): Promise<DeliveryOutcome> { return Promise.resolve({ status: 'failed', kind: 'rejected', reason: `Message editing is unavailable for ${request[0].kind} chats`, messageIds: [] }); }
  abstract downloadMedia(part: Extract<ContentPart, { type: 'image' | 'file' }>, signal: AbortSignal): Promise<DownloadedMedia>;
  protected async outboundMedia(part: Extract<ContentPart, { type: 'image' | 'file' }>, signal = this.controller.signal): Promise<DownloadedMedia> {
    const maxBytes = this.deps.maxMediaBytes ?? 20_000_000;
    let media: DownloadedMedia;
    if (part.url.startsWith('artifact:')) {
      if (!this.deps.resolveMedia) throw new PlatformError('rejected', 'Artifact resolver is not configured');
      media = await this.deps.resolveMedia(part, signal);
    } else if (part.url.startsWith('data:')) {
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
      const mimeType = match?.[1]; const payload = match?.[2];
      if (!mimeType || payload === undefined || payload.length > Math.ceil(maxBytes / 3) * 4) throw new PlatformError('invalid_payload', 'Invalid media data URI');
      media = { bytes: Buffer.from(payload, 'base64'), mimeType, name: part.type === 'file' ? part.name : 'image' };
    } else if (/^(telegram-file:|napcat-image:|napcat-file:|napcat-group-file:|weixin-media:)/.test(part.url)) media = await this.downloadMedia(part, signal);
    else media = { ...await downloadPublic(this.fetcher, part.url, signal, maxBytes), name: part.type === 'file' ? part.name : 'image' };
    if (media.bytes.length > maxBytes) throw new PlatformError('rejected', 'Media exceeds size limit');
    return media;
  }
  protected deliver(deliveryId: string, effects: readonly (() => Promise<string>)[]): Promise<DeliveryOutcome> {
    const existing = this.deliveries.get(deliveryId);
    if (existing) return existing;
    const pending = this.performDelivery(deliveryId, effects).finally(() => { this.deliveries.delete(deliveryId); });
    this.deliveries.set(deliveryId, pending);
    return pending;
  }
  private async performDelivery(deliveryId: string, effects: readonly (() => Promise<string>)[]): Promise<DeliveryOutcome> {
    const messageIds: string[] = [];
    for (const [index, effect] of effects.entries()) {
      const key = `platform:${this.id}:delivery:${deliveryId}:${index}`;
      const stored = await this.deps.state.get(key);
      if (stored) {
        const parsed = effectSchema.safeParse(JSON.parse(stored));
        if (!parsed.success || parsed.data.status === 'pending') return { status: 'uncertain', reason: 'An earlier send has an unknown outcome; automatic replay blocked', messageIds };
        if (parsed.data.status === 'confirmed' && parsed.data.messageId) { messageIds.push(parsed.data.messageId); continue; }
      }
      await this.deps.state.set(key, JSON.stringify({ status: 'pending' }));
      try {
        const messageId = await effect();
        messageIds.push(messageId);
        await this.deps.state.set(key, JSON.stringify({ status: 'confirmed', messageId }));
      } catch (error) {
        const failure = error instanceof PlatformError ? error : new PlatformError('network', 'Send outcome is unknown', true);
        if (!failure.uncertain) await this.deps.state.set(key, JSON.stringify({ status: 'failed' }));
        return failure.uncertain ? { status: 'uncertain', reason: failure.message, messageIds } : { status: 'failed', kind: failure.kind, reason: failure.message, messageIds };
      }
    }
    return { status: 'confirmed', messageIds };
  }
}
