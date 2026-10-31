import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MessageEventSchema, type ContentPart, type MessageEvent, type ReplyPlan } from '../../../contracts/src/index.js';
import { BasePlatformAdapter } from './base.js';
import { PlatformError, delay, jsonRequest, protocolId, request } from './transport.js';
import { paginate, plainMarkdown } from '../messages/format.js';
import { readBoundedResponse } from '../media/download.js';
import type { AdapterDependencies, DeliveryOutcome, DownloadedMedia, PlatformTarget, WeixinConfig } from './types.js';
const mediaSchema = z.object({ encrypt_query_param: z.string().min(1), aes_key: z.string().optional() });
const itemSchema = z.object({ type: z.number().int(), text_item: z.object({ text: z.string() }).optional(), image_item: z.object({ media: mediaSchema, aeskey: z.string().optional() }).optional(), file_item: z.object({ media: mediaSchema, file_name: z.string().optional(), len: z.union([z.string(), z.number()]).optional() }).optional(), ref_msg: z.object({ message_id: protocolId.optional(), title: z.string().optional(), message_item: z.object({ type: z.number(), text_item: z.object({ text: z.string() }).optional() }).optional() }).optional() });
const inboundSchema = z.object({ message_id: protocolId.optional(), msg_id: protocolId.optional(), from_user_id: z.string().min(1), to_user_id: z.string().optional(), message_type: z.number().optional(), create_time_ms: z.number().optional(), create_time: z.number().optional(), context_token: z.string().optional(), item_list: z.array(itemSchema).default([]) });
const loginSchema = z.object({ qrcode: z.string().min(1), qrcode_img_content: z.string().min(1) });
const loginStatusSchema = z.object({ status: z.enum(['wait', 'scaned', 'scanned', 'confirmed', 'expired']), bot_token: z.string().optional(), ilink_bot_id: z.string().optional(), ilink_user_id: z.string().optional(), baseurl: z.string().url().optional() });
const accountSchema = z.object({ token: z.string(), accountId: z.string(), apiBase: z.string().url(), cursor: z.string(), contexts: z.record(z.string(), z.string()) });
const apiResultSchema = z.object({ ret: z.number().optional(), errcode: z.number().optional() });
const storedMediaSchema = z.object({ query: z.string(), key: z.string(), mimeType: z.string(), name: z.string() });
export type WeixinLogin = z.infer<typeof loginSchema>;
export type WeixinLoginStatus = 'wait' | 'scaned' | 'scanned' | 'confirmed' | 'expired';
export function parseWeixinKey(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-f]{32}$/i.test(decoded.toString('ascii'))) return Buffer.from(decoded.toString('ascii'), 'hex');
  throw new PlatformError('invalid_payload', 'Invalid iLink media key');
}
export function encryptWeixinMedia(bytes: Uint8Array, key: Uint8Array): Buffer { const cipher = createCipheriv('aes-128-ecb', key, null); return Buffer.concat([cipher.update(bytes), cipher.final()]); }
export function decryptWeixinMedia(bytes: Uint8Array, key: Uint8Array): Buffer {
  try { const cipher = createDecipheriv('aes-128-ecb', key, null); return Buffer.concat([cipher.update(bytes), cipher.final()]); }
  catch { throw new PlatformError('invalid_payload', 'Invalid encrypted iLink media'); }
}
export class WeixinAdapter extends BasePlatformAdapter {
  readonly capabilities = { edit: false, images: true, files: true, groups: false, audio: false } as const;
  private token: string;
  private accountId: string;
  private apiBase: string;
  private cursor = '';
  private readonly contexts = new Map<string, string>();
  private login: WeixinLogin | undefined;
  private readonly cdnBase = 'https://novac2c.cdn.weixin.qq.com/c2c';
  constructor(private readonly config: WeixinConfig, deps: AdapterDependencies) { super(config.id, deps); this.token = deps.secret(config.tokenEnv) ?? ''; this.accountId = config.accountId; this.apiBase = config.apiBase; }
  private headers(authenticated: boolean): Record<string, string> { return { AuthorizationType: 'ilink_bot_token', 'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'), ...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}) }; }
  private async api<T>(endpoint: string, schema: z.ZodType<T>, payload?: object, authenticated = true, effect = false, query?: URLSearchParams): Promise<T> {
    if (authenticated && !this.token) throw new PlatformError('authentication', 'WeChat login is required');
    const url = new URL(endpoint, `${this.apiBase.replace(/\/$/, '')}/`); if (query) url.search = query.toString();
    const init: RequestInit = payload ? jsonRequest({ ...payload, base_info: { channel_version: 'priestess-ts' } }, this.controller.signal, this.headers(authenticated)) : { headers: { ...this.headers(authenticated), 'iLink-App-ClientVersion': '1' }, signal: this.controller.signal };
    const raw = await request(this.fetcher, url, z.unknown(), init, effect);
    const result = apiResultSchema.safeParse(raw);
    if (!result.success) throw new PlatformError('invalid_payload', 'Invalid iLink response', effect);
    const code = result.data.errcode || result.data.ret || 0;
    if (code !== 0) { if (code === -14) { this.token = ''; this.accountId = ''; this.cursor = ''; this.contexts.clear(); await this.save(); } throw new PlatformError(code === -14 ? 'authentication' : 'rejected', `iLink rejected request (${code})`); }
    const parsed = schema.safeParse(raw); if (!parsed.success) throw new PlatformError('invalid_payload', 'Invalid iLink response', effect);
    return parsed.data;
  }
  private async save(): Promise<void> { await this.deps.state.set(`platform:${this.id}:account`, JSON.stringify({ token: this.token, accountId: this.accountId, apiBase: this.apiBase, cursor: this.cursor, contexts: Object.fromEntries(this.contexts) })); }
  async beginLogin(): Promise<WeixinLogin> { this.login = await this.api('ilink/bot/get_bot_qrcode', loginSchema, undefined, false, false, new URLSearchParams({ bot_type: '3' })); return this.login; }
  async pollLogin(): Promise<WeixinLoginStatus> {
    if (!this.login) throw new PlatformError('rejected', 'Start WeChat login first');
    const status = await this.api('ilink/bot/get_qrcode_status', loginStatusSchema, undefined, false, false, new URLSearchParams({ qrcode: this.login.qrcode }));
    if (status.status === 'confirmed') {
      if (!status.bot_token || !status.ilink_bot_id) throw new PlatformError('invalid_payload', 'Confirmed iLink login lacks credentials');
      if (status.baseurl) { const url = new URL(status.baseurl); if (url.protocol !== 'https:' || !url.hostname.endsWith('.weixin.qq.com')) throw new PlatformError('invalid_payload', 'Unexpected iLink account host'); this.apiBase = url.origin; }
      if (this.accountId !== status.ilink_bot_id) { this.cursor = ''; this.contexts.clear(); }
      this.token = status.bot_token; this.accountId = status.ilink_bot_id; await this.save(); this.login = undefined;
    }
    return status.status;
  }
  async start(receive: (event: MessageEvent) => Promise<void>): Promise<void> {
    this.beginStart();
    const saved = await this.deps.state.get(`platform:${this.id}:account`);
    if (saved) { const state = accountSchema.parse(JSON.parse(saved)); this.token = this.token || state.token; this.accountId = this.accountId || state.accountId; this.apiBase = state.apiBase; this.cursor = state.cursor; for (const [id, token] of Object.entries(state.contexts)) this.contexts.set(id, token); }
    this.launch(async () => {
      if (!this.token) { this.reportStatus({ status: 'starting', message: '等待微信扫码登录' }); await delay(1000, this.controller.signal); return; }
      const updates = await this.api('ilink/bot/getupdates', z.object({ get_updates_buf: z.string().optional(), msgs: z.array(z.unknown()).default([]) }), { get_updates_buf: this.cursor });
      this.reportStatus({ status: 'connected' });
      for (const raw of updates.msgs) {
        if (this.controller.signal.aborted) return;
        let event: MessageEvent | undefined;
        try { event = await this.normalize(raw); }
        catch (error) { if (!(error instanceof z.ZodError) && !(error instanceof PlatformError && error.kind === 'invalid_payload')) throw error; this.deps.onError?.(this.id, 'invalid_payload'); }
        if (this.controller.signal.aborted) return;
        if (event) await receive(event);
      }
      this.cursor = updates.get_updates_buf ?? this.cursor; await this.save();
    });
  }
  async normalize(raw: unknown): Promise<MessageEvent | undefined> {
    const msg = inboundSchema.parse(raw);
    if (msg.message_type !== undefined && msg.message_type !== 1 || msg.from_user_id === this.accountId) return undefined;
    if (msg.context_token) { this.contexts.set(msg.from_user_id, msg.context_token); await this.save(); }
    const parts: ContentPart[] = [];
    for (const item of msg.item_list) {
      if (item.type === 1 && item.text_item) parts.push({ type: 'text', text: item.text_item.text });
      if (item.ref_msg) parts.push({ type: 'quote', messageId: item.ref_msg.message_id ?? 'quoted', text: item.ref_msg.message_item?.text_item?.text ?? item.ref_msg.title ?? '' });
      const media = item.type === 2 ? item.image_item?.media : item.type === 4 ? item.file_item?.media : undefined;
      if (media) {
        const rawHex = item.image_item?.aeskey;
        const key = media.aes_key ?? (rawHex ? Buffer.from(rawHex, 'hex').toString('base64') : ''); parseWeixinKey(key);
        const name = item.file_item?.file_name ?? 'image.jpg'; const mimeType = item.type === 2 ? 'image/jpeg' : 'application/octet-stream';
        const id = createHash('sha256').update(`${msg.from_user_id}:${media.encrypt_query_param}`).digest('hex');
        await this.deps.state.set(`platform:${this.id}:media:${id}`, JSON.stringify({ query: media.encrypt_query_param, key, mimeType, name }));
        parts.push(item.type === 2 ? { type: 'image', url: `weixin-media:${id}`, mimeType } : { type: 'file', url: `weixin-media:${id}`, name, mimeType });
      }
      if (item.type === 3) parts.push({ type: 'text', text: '[音频消息：本版本不支持语音处理]' });
    }
    const time = msg.create_time_ms ?? msg.create_time ?? Date.now();
    const messageId = msg.message_id ?? msg.msg_id ?? createHash('sha256').update(JSON.stringify(msg)).digest('hex');
    return MessageEventSchema.parse({ platform: this.id, platformType: 'weixin', sessionId: msg.from_user_id, sessionType: 'private', senderId: msg.from_user_id, senderName: msg.from_user_id, messageId, timestamp: time > 1_000_000_000_000 ? time : time * 1000, botId: this.accountId || this.id, parts });
  }
  async send(target: PlatformTarget, reply: ReplyPlan, deliveryId: string): Promise<DeliveryOutcome> {
    if (target.kind !== 'private') return { status: 'failed', kind: 'rejected', reason: 'iLink supports private chats only', messageIds: [] };
    const contextToken = this.contexts.get(target.chatId);
    if (!contextToken) return { status: 'failed', kind: 'rejected', reason: 'Send a message to the bot first to establish WeChat reply context', messageIds: [] };
    const effects: (() => Promise<string>)[] = [];
    const sendItem = async (item: object, index: number): Promise<string> => {
      const clientId = createHash('sha256').update(`${this.id}:${deliveryId}:${index}`).digest('hex').slice(0, 32);
      await this.api('ilink/bot/sendmessage', apiResultSchema, { msg: { from_user_id: '', to_user_id: target.chatId, client_id: clientId, message_type: 2, message_state: 2, context_token: contextToken, item_list: [item] } }, true, true);
      return clientId;
    };
    for (const part of reply.parts) {
      if (part.type === 'text') for (const text of paginate(plainMarkdown(part.text), 2000)) { const index = effects.length; effects.push(() => sendItem({ type: 1, text_item: { text } }, index)); }
      else if (part.type === 'image' || part.type === 'file') { const index = effects.length; effects.push(async () => sendItem(await this.upload(target.chatId, part), index)); }
    }
    return this.deliver(deliveryId, effects);
  }
  private async upload(userId: string, part: Extract<ContentPart, { type: 'image' | 'file' }>): Promise<object> {
    const source = await this.outboundMedia(part);
    const key = randomBytes(16); const encrypted = encryptWeixinMedia(source.bytes, key); const filekey = randomUUID().replaceAll('-', '');
    const upload = await this.api('ilink/bot/getuploadurl', z.object({ upload_param: z.string().optional(), upload_full_url: z.string().url().optional() }), { filekey, media_type: part.type === 'image' ? 1 : 3, to_user_id: userId, rawsize: source.bytes.length, rawfilemd5: createHash('md5').update(source.bytes).digest('hex'), filesize: encrypted.length, no_need_thumb: true, aeskey: key.toString('hex') });
    const url = upload.upload_full_url ?? `${this.cdnBase}/upload?${new URLSearchParams({ encrypted_query_param: upload.upload_param ?? '', filekey }).toString()}`;
    const parsed = new URL(url); if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.weixin.qq.com')) throw new PlatformError('invalid_payload', 'Unexpected iLink CDN host');
    const response = await this.fetcher(parsed, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(encrypted).buffer, signal: this.controller.signal, redirect: 'error' });
    if (!response.ok) throw new PlatformError('rejected', 'WeChat media upload failed');
    const query = response.headers.get('x-encrypted-param'); if (!query) throw new PlatformError('invalid_payload', 'Missing iLink media upload reference');
    const media = { encrypt_query_param: query, aes_key: Buffer.from(key.toString('hex')).toString('base64'), encrypt_type: 1 };
    return part.type === 'image' ? { type: 2, image_item: { media, mid_size: encrypted.length } } : { type: 4, file_item: { media, file_name: part.name, len: String(source.bytes.length) } };
  }
  async downloadMedia(part: Extract<ContentPart, { type: 'image' | 'file' }>, signal: AbortSignal): Promise<DownloadedMedia> {
    if (!/^weixin-media:[a-f0-9]{64}$/.test(part.url)) throw new PlatformError('rejected', 'Invalid WeChat media reference');
    const raw = await this.deps.state.get(`platform:${this.id}:media:${part.url.slice(13)}`); if (!raw) throw new PlatformError('rejected', 'WeChat media reference has expired');
    const media = storedMediaSchema.parse(JSON.parse(raw));
    const response = await this.fetcher(`${this.cdnBase}/download?${new URLSearchParams({ encrypted_query_param: media.query }).toString()}`, { signal, redirect: 'error' });
    const bytes = decryptWeixinMedia(await readBoundedResponse(response, (this.deps.maxMediaBytes ?? 20_000_000) + 16), parseWeixinKey(media.key));
    return { bytes, mimeType: media.mimeType, name: media.name };
  }
}
