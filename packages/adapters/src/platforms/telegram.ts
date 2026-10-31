import { z } from 'zod';
import { MessageEventSchema, type ContentPart, type MessageEvent, type ReplyPlan } from '../../../contracts/src/index.js';
import { BasePlatformAdapter } from './base.js';
import { PlatformError, jsonRequest, protocolId, request } from './transport.js';
import { telegramPages } from '../messages/format.js';
import { readBoundedResponse } from '../media/download.js';
import type { AdapterDependencies, DeliveryOutcome, DownloadedMedia, PlatformTarget, TelegramConfig } from './types.js';
const userSchema = z.object({ id: protocolId, first_name: z.string().optional(), last_name: z.string().optional(), username: z.string().optional(), is_bot: z.boolean().optional() });
const quoteSchema = z.object({ message_id: protocolId, from: userSchema.optional(), text: z.string().optional(), caption: z.string().optional() });
const entitySchema = z.object({ type: z.string(), offset: z.number().int().nonnegative(), length: z.number().int().nonnegative(), user: userSchema.optional() });
const messageSchema = z.object({ message_id: protocolId, date: z.number().int(), chat: z.object({ id: protocolId, type: z.enum(['private', 'group', 'supergroup', 'channel']) }), from: userSchema.optional(), sender_chat: z.object({ id: protocolId, title: z.string().optional() }).optional(), text: z.string().optional(), caption: z.string().optional(), entities: z.array(entitySchema).default([]), caption_entities: z.array(entitySchema).default([]), photo: z.array(z.object({ file_id: z.string(), width: z.number().int().positive(), height: z.number().int().positive() })).optional(), document: z.object({ file_id: z.string(), file_name: z.string().optional(), mime_type: z.string().optional(), file_size: z.number().int().nonnegative().optional() }).optional(), reply_to_message: quoteSchema.optional(), voice: z.object({ file_id: z.string() }).optional(), audio: z.object({ file_id: z.string() }).optional() });
const updateSchema = z.object({ update_id: z.number().int(), message: z.unknown().optional() });
function envelope<T>(schema: z.ZodType<T>): z.ZodType<{ ok: true; result: T } | { ok: false; error_code?: number | undefined; parameters?: { retry_after?: number | undefined } | undefined }> {
  return z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), result: schema }), z.object({ ok: z.literal(false), error_code: z.number().optional(), parameters: z.object({ retry_after: z.number().optional() }).optional() })]);
}
export class TelegramAdapter extends BasePlatformAdapter {
  readonly capabilities = { edit: true, images: true, files: true, groups: true, audio: false } as const;
  private botId = '';
  private username = '';
  private offset = 0;
  private readonly token: string;
  constructor(private readonly config: TelegramConfig, deps: AdapterDependencies) { super(config.id, deps); this.token = deps.secret(config.tokenEnv) ?? ''; }
  private async api<T>(method: string, payload: object, schema: z.ZodType<T>, effect = false, signal = this.controller.signal): Promise<T> {
    if (!this.token) throw new PlatformError('authentication', 'Telegram token is missing');
    const body = await request(this.fetcher, `${this.config.apiBase}/bot${this.token}/${method}`, envelope(schema), jsonRequest(payload, signal), effect);
    if (!body.ok) throw new PlatformError(body.error_code === 429 ? 'rate_limit' : body.error_code === 401 ? 'authentication' : 'rejected', 'Telegram rejected request', false, (body.parameters?.retry_after ?? 0) * 1000);
    return body.result;
  }
  async start(receive: (event: MessageEvent) => Promise<void>): Promise<void> {
    this.beginStart();
    let authenticated = false;
    const raw = await this.deps.state.get(`platform:${this.id}:offset`);
    this.offset = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
    this.launch(async () => {
      if (!authenticated) {
        const me = await this.api('getMe', {}, userSchema);
        this.botId = me.id; this.username = me.username ?? ''; authenticated = true;
        this.reportStatus({ status: 'connected' });
      }
      const updates = await this.api('getUpdates', { offset: this.offset, timeout: this.config.pollingTimeoutSeconds, allowed_updates: ['message'] }, z.array(updateSchema));
      this.reportStatus({ status: 'connected' });
      for (const update of updates) {
        if (this.controller.signal.aborted) return;
        if (update.update_id < this.offset) continue;
        if (update.message) {
          let event: MessageEvent | undefined;
          try { event = this.normalize(update.message); }
          catch (error) { if (!(error instanceof z.ZodError)) throw error; this.deps.onError?.(this.id, 'invalid_payload'); }
          if (event) await receive(event);
        }
        this.offset = update.update_id + 1;
        await this.deps.state.set(`platform:${this.id}:offset`, String(this.offset));
      }
    });
  }
  normalize(raw: unknown): MessageEvent | undefined {
    const message = messageSchema.parse(raw);
    if (message.from?.is_bot || message.chat.type === 'channel') return undefined;
    // Telegram's anonymous administrator placeholder must never acquire a real user's permissions.
    const senderId = message.sender_chat ? `anonymous-chat:${message.sender_chat.id}` : message.from?.id;
    if (!senderId) return undefined;
    const parts: ContentPart[] = [];
    const text = message.text ?? message.caption ?? '';
    if (text) parts.push({ type: 'text', text });
    for (const entity of message.text ? message.entities : message.caption_entities) {
      if (entity.type === 'text_mention' && entity.user) parts.push({ type: 'mention', userId: entity.user.id, name: entity.user.first_name ?? entity.user.id });
      if (entity.type === 'mention') {
        const handle = text.slice(entity.offset, entity.offset + entity.length);
        if (this.username && handle.toLowerCase() === `@${this.username.toLowerCase()}`) parts.push({ type: 'mention', userId: this.botId, name: handle });
      }
    }
    const image = message.photo?.at(-1);
    if (image) parts.push({ type: 'image', url: `telegram-file:${encodeURIComponent(image.file_id)}`, mimeType: 'image/jpeg', width: image.width, height: image.height });
    const doc = message.document;
    if (doc) parts.push({ type: 'file', url: `telegram-file:${encodeURIComponent(doc.file_id)}`, mimeType: doc.mime_type ?? 'application/octet-stream', name: doc.file_name ?? 'attachment', ...(doc.file_size === undefined ? {} : { size: doc.file_size }) });
    if (message.reply_to_message) parts.push({ type: 'quote', messageId: message.reply_to_message.message_id, ...(message.reply_to_message.from ? { senderId: message.reply_to_message.from.id } : {}), text: message.reply_to_message.text ?? message.reply_to_message.caption ?? '' });
    if (message.voice || message.audio) parts.push({ type: 'text', text: '[音频消息：本版本不支持语音处理]' });
    return MessageEventSchema.parse({ platform: this.id, platformType: 'telegram', sessionId: message.chat.id, sessionType: message.chat.type === 'private' ? 'private' : 'group', senderId, senderName: message.sender_chat?.title ?? message.from?.first_name ?? senderId, messageId: message.message_id, timestamp: message.date * 1000, botId: this.botId || this.token.split(':')[0] || 'telegram', parts });
  }
  async send(target: PlatformTarget, reply: ReplyPlan, deliveryId: string): Promise<DeliveryOutcome> {
    const effects: (() => Promise<string>)[] = [];
    const base = { chat_id: target.chatId, ...(reply.replyTo ? { reply_parameters: { message_id: reply.replyTo, allow_sending_without_reply: true } } : {}) };
    for (const part of reply.parts) {
      if (part.type === 'text') for (const text of telegramPages(part.text)) effects.push(async () => (await this.api('sendMessage', { ...base, text, parse_mode: 'MarkdownV2' }, z.object({ message_id: protocolId }), true)).message_id);
      else if (part.type === 'image' || part.type === 'file') effects.push(async () => {
        const method = part.type === 'image' ? 'sendPhoto' : 'sendDocument';
        if (part.url.startsWith('artifact:') || part.url.startsWith('data:')) {
          const media = await this.outboundMedia(part); const form = new FormData();
          form.set('chat_id', target.chatId);
          if (reply.replyTo) form.set('reply_parameters', JSON.stringify({ message_id: reply.replyTo, allow_sending_without_reply: true }));
          form.set(part.type === 'image' ? 'photo' : 'document', new Blob([new Uint8Array(media.bytes).buffer], { type: media.mimeType }), media.name);
          const result = await request(this.fetcher, `${this.config.apiBase}/bot${this.token}/${method}`, envelope(z.object({ message_id: protocolId })), { method: 'POST', body: form, signal: this.controller.signal }, true);
          if (!result.ok) throw new PlatformError('rejected', 'Telegram rejected media upload');
          return result.result.message_id;
        }
        const media = part.url.startsWith('telegram-file:') ? decodeURIComponent(part.url.slice(14)) : part.url;
        if (!part.url.startsWith('telegram-file:') && !/^https?:\/\//.test(media)) throw new PlatformError('rejected', 'Telegram media requires an authorized artifact or HTTP URL');
        return (await this.api(method, { ...base, ...(part.type === 'image' ? { photo: media } : { document: media }) }, z.object({ message_id: protocolId }), true)).message_id;
      });
    }
    return this.deliver(deliveryId, effects);
  }
  override async edit(target: PlatformTarget, messageId: string, text: string): Promise<DeliveryOutcome> {
    const pages = telegramPages(text);
    if (pages.length !== 1) return { status: 'failed', kind: 'rejected', reason: 'Edit exceeds one message', messageIds: [messageId] };
    try { await this.api('editMessageText', { chat_id: target.chatId, message_id: messageId, text: pages[0], parse_mode: 'MarkdownV2' }, z.union([z.literal(true), z.object({ message_id: protocolId })]), true); return { status: 'confirmed', messageIds: [messageId] }; }
    catch (error) { const failure = error instanceof PlatformError ? error : new PlatformError('network', 'Edit outcome unknown', true); return failure.uncertain ? { status: 'uncertain', reason: failure.message, messageIds: [messageId] } : { status: 'failed', kind: failure.kind, reason: failure.message, messageIds: [messageId] }; }
  }
  async downloadMedia(part: Extract<ContentPart, { type: 'image' | 'file' }>, signal: AbortSignal): Promise<DownloadedMedia> {
    if (!part.url.startsWith('telegram-file:')) throw new PlatformError('rejected', 'Not a Telegram file reference');
    const file = await this.api('getFile', { file_id: decodeURIComponent(part.url.slice(14)) }, z.object({ file_path: z.string(), file_size: z.number().optional() }), false, signal);
    if (file.file_path.includes('..') || file.file_path.startsWith('/')) throw new PlatformError('invalid_payload', 'Invalid Telegram file path');
    const max = this.deps.maxMediaBytes ?? 20_000_000;
    if (file.file_size !== undefined && file.file_size > max) throw new PlatformError('rejected', 'Media exceeds size limit');
    const response = await this.fetcher(`${this.config.apiBase}/file/bot${this.token}/${file.file_path}`, { signal, redirect: 'error' });
    return { bytes: await readBoundedResponse(response, max), mimeType: part.mimeType, name: part.type === 'file' ? part.name : 'image.jpg' };
  }
}
