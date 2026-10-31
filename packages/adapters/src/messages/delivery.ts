import type { DeliveryOutcome, PlatformAdapter, PlatformTarget } from '../platforms/types.js';
import type { ContentPart } from '../../../contracts/src/index.js';
import { paginate } from './format.js';
export interface StreamDeliveryOptions { readonly enabled: boolean; readonly throttleMs: number; readonly fallback: 'final' | 'chunks'; readonly chunkChars: number; readonly beforeSend?: () => void; }
/** Serialize SDK snapshots so a slower edit cannot overwrite a later final result. */
export class StreamDelivery {
  private text = '';
  private lastSent = '';
  private messageId: string | undefined;
  private lastUpdate = 0;
  private tail: Promise<void> = Promise.resolve();
  private outcome: DeliveryOutcome = { status: 'confirmed', messageIds: [] };
  private sentChars = 0;
  private sentPrefix = '';
  private chunkIndex = 0;
  private finished = false;
  private finalFallback = false;
  private finalParts: readonly ContentPart[] = [];
  private orderedReplyParts: readonly ContentPart[] | undefined;
  constructor(private readonly adapter: PlatformAdapter, private readonly target: PlatformTarget, private readonly deliveryId: string, private readonly options: StreamDeliveryOptions) {}
  push(delta: string): Promise<void> { return this.snapshot(this.text + delta); }
  snapshot(text: string): Promise<void> {
    if (this.finished) return this.tail;
    this.text = text;
    this.tail = this.tail.then(async () => { if (this.options.enabled && Date.now() - this.lastUpdate >= this.options.throttleMs) await this.flush(false); });
    return this.tail;
  }
  async finish(finalText: string, finalParts: readonly ContentPart[] = [], orderedReplyParts?: readonly ContentPart[]): Promise<DeliveryOutcome> {
    if (this.finished) { await this.tail; return this.outcome; }
    this.finished = true; this.text = finalText; this.finalParts = finalParts; this.orderedReplyParts = orderedReplyParts;
    this.tail = this.tail.then(() => this.flush(true)); await this.tail; return this.outcome;
  }
  private async sendFinalFallback(): Promise<void> {
    this.finalFallback = false;
    for (const [index, text] of paginate(this.text, 2000).entries()) {
      this.options.beforeSend?.();
      const sent = await this.adapter.send(this.target, { parts: [{ type: 'text', text }] }, `${this.deliveryId}:final-fallback:${index}`, this.options.beforeSend);
      this.outcome = merge(this.outcome, sent);
      if (sent.status !== 'confirmed') break;
    }
  }
  private async flush(final: boolean): Promise<void> {
    // NapCat must see the complete response before deciding whether to fold it.
    // Sending early chunks would irreversibly bypass its anti-flood threshold.
    if (this.adapter.capabilities.wholeReply) {
      if (!final || this.outcome.status !== 'confirmed' || !this.text && !this.finalParts.length && !this.orderedReplyParts?.length) return;
      this.options.beforeSend?.();
      this.outcome = await this.adapter.send(this.target, { parts: this.orderedReplyParts ? [...this.orderedReplyParts] : [...(this.text ? [{ type: 'text' as const, text: this.text }] : []), ...this.finalParts] }, `${this.deliveryId}:whole`, this.options.beforeSend);
      return;
    }
    if (final && this.finalFallback) { await this.sendFinalFallback(); return; }
    if (this.outcome.status !== 'confirmed' || !this.text) return;
    this.lastUpdate = Date.now();
    if (this.adapter.capabilities.edit && this.options.enabled) {
      const pages = paginate(this.text, 2000); const first = pages[0]; if (!first) return;
      if (!this.messageId) {
        this.options.beforeSend?.();
        this.outcome = await this.adapter.send(this.target, { parts: [{ type: 'text', text: first }] }, `${this.deliveryId}:stream:0`, this.options.beforeSend);
        this.messageId = this.outcome.messageIds[0]; this.lastSent = first;
      } else if (first !== this.lastSent) {
        this.options.beforeSend?.();
        this.outcome = await this.adapter.edit(this.target, this.messageId, first); this.lastSent = first;
        if (this.outcome.status === 'failed') { this.finalFallback = true; if (final) await this.sendFinalFallback(); return; }
      }
      if (final && this.outcome.status === 'confirmed') for (const [index, text] of pages.slice(1).entries()) {
        this.options.beforeSend?.();
        const next = await this.adapter.send(this.target, { parts: [{ type: 'text', text }] }, `${this.deliveryId}:stream:${index + 1}`, this.options.beforeSend);
        this.outcome = merge(this.outcome, next); if (next.status !== 'confirmed') break;
      }
    } else if (final || this.options.enabled && this.options.fallback === 'chunks') {
      if (final && this.sentPrefix && !this.text.startsWith(this.sentPrefix)) { this.text = `（以下为更新后的完整回复）\n${this.text}`; this.sentChars = 0; this.sentPrefix = ''; }
      const unsent = this.text.slice(this.sentChars);
      const pages = paginate(unsent, Math.min(this.options.chunkChars, 2000));
      if (!final) pages.pop();
      for (const text of pages) {
        this.options.beforeSend?.();
        const next = await this.adapter.send(this.target, { parts: [{ type: 'text', text }] }, `${this.deliveryId}:chunk:${this.chunkIndex}`, this.options.beforeSend);
        this.outcome = merge(this.outcome, next);
        if (next.status !== 'confirmed') break;
        this.sentChars += text.length; this.sentPrefix += text; this.chunkIndex++;
      }
    }
  }
}
function merge(previous: DeliveryOutcome, next: DeliveryOutcome): DeliveryOutcome { return { ...next, messageIds: [...previous.messageIds, ...next.messageIds] }; }
