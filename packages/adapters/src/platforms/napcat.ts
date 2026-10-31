import { NapCatActionSchema, GroupFilesSchema, GroupMembersSchema, GroupInfoSchema, AlbumListSchema, AlbumMediaSchema, GroupNoticesSchema, type NapCatAction, type NapCatActionResult } from './napcat-actions.js';
import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import WebSocket, { type RawData } from 'ws';
import { MessageEventSchema, normalizeNapCatReactionEmoji, type ContentPart, type MediaAttachment, type MessageEvent, type ReplyPlan } from '../../../contracts/src/index.js';
import { BasePlatformAdapter } from './base.js';
import { PlatformError, jsonRequest, protocolId, request } from './transport.js';
import { plainMarkdown } from '../messages/format.js';
import { downloadPublic } from '../media/download.js';
import type { AdapterDependencies, DeliveryOutcome, DownloadedMedia, NapCatConfig, PlatformTarget } from './types.js';
const segmentSchema = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) });
const eventSchema = z.object({ post_type: z.literal('message'), message_type: z.enum(['private', 'group']), message_id: protocolId, user_id: protocolId, group_id: protocolId.optional(), group_name: z.string().max(1000).optional(), self_id: protocolId, time: z.number().int().nonnegative(), sender: z.object({ nickname: z.string().optional(), card: z.string().optional() }).optional(), message: z.union([z.string(), z.array(segmentSchema)]) });
const quotedMessageSchema = z.object({ message_id: protocolId, message_type: z.enum(['private', 'group']), group_id: protocolId.optional(), target_id: protocolId.optional(), time: z.number().int().nonnegative().optional(), sender: z.object({ user_id: protocolId, nickname: z.string().optional(), card: z.string().optional() }), message: z.union([z.string(), z.array(segmentSchema)]) });
const forwardNodeSchema = z.object({ sender: z.object({ user_id: protocolId, nickname: z.string().optional(), card: z.string().optional() }).optional(), user_id: protocolId.optional(), nickname: z.string().optional(), time: z.number().int().nonnegative().optional(), content: z.union([z.string(), z.array(segmentSchema)]).optional(), message: z.union([z.string(), z.array(segmentSchema)]).optional() });
function mediaSegment(segment: z.infer<typeof segmentSchema>): MediaAttachment | undefined {
  if (segment.type === 'image') {
    const value = z.object({ url: z.string().optional(), file: z.string().optional() }).parse(segment.data);
    const reference = value.url || value.file;
    if (reference) return { type: 'image', url: reference.startsWith('https:') ? reference : `napcat-image:${encodeURIComponent(reference)}`, mimeType: 'image/jpeg' };
  } else if (segment.type === 'file') {
    const value = z.object({ file: z.string().optional(), file_id: z.string().optional(), url: z.string().optional(), name: z.string().optional(), file_size: z.coerce.number().int().nonnegative().optional() }).parse(segment.data);
    const reference = value.url || value.file_id || value.file;
    if (reference) return { type: 'file', url: reference.startsWith('https:') ? reference : `napcat-file:${encodeURIComponent(reference)}`, name: value.name || 'attachment', mimeType: 'application/octet-stream', ...(value.file_size === undefined ? {} : { size: value.file_size }) };
  }
  return undefined;
}
const uploadNoticeSchema = z.object({ post_type: z.literal('notice'), notice_type: z.literal('group_upload'), group_id: protocolId, user_id: protocolId, self_id: protocolId, time: z.number().int().nonnegative(), file: z.object({ id: z.string(), name: z.string(), size: z.number().int().nonnegative(), busid: z.number().int().optional() }) });
const inboundSchema = z.union([eventSchema, uploadNoticeSchema]);
const groupFileReferenceSchema = z.object({ groupId: z.string(), fileId: z.string(), busid: z.number().int().optional() });
const apiEnvelope = z.object({ status: z.string(), retcode: z.number(), data: z.unknown(), echo: z.string().optional() });
const messageResponse = z.object({ message_id: protocolId });
const loginInfoSchema = z.object({ user_id: protocolId, nickname: z.string().optional(), nick: z.string().optional() });
const botMemberSchema = z.object({ user_id: protocolId.optional(), card: z.string().optional(), nickname: z.string().optional(), nick: z.string().optional() });
type RichMessagePart = Extract<ContentPart, { type: 'text' | 'image' }>;
interface ForwardIdentity { readonly userId: string; readonly nickname: string; }
interface QuoteBudget { forwardCalls: number; nodeCount: number; segmentCount: number; textChars: number; attachmentCount: number; readonly visited: Set<string>; }
interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; }
function rawText(data: RawData): string { return Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('utf8'); }
export class NapCatAdapter extends BasePlatformAdapter {
  readonly capabilities = { edit: false, images: true, files: true, groups: true, audio: false, wholeReply: true } as const;
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, Pending>();
  private readonly token: string;
  private botId = '';
  private botNickname = '';
  constructor(private readonly config: NapCatConfig, deps: AdapterDependencies) { super(config.id, deps); this.token = deps.secret(config.accessTokenEnv) ?? ''; }
  start(receive: (event: MessageEvent) => Promise<void>): Promise<void> {
    this.beginStart();
    this.launch(async () => {
      await this.connect(receive);
      try { await this.loadIdentity(); }
      catch (error) { this.socket?.close(); throw error; }
      this.reportStatus({ status: 'connected' });
      await new Promise<void>((resolve) => {
        const socket = this.socket;
        const close = (): void => { socket?.close(); resolve(); };
        if (!socket || socket.readyState !== WebSocket.OPEN || this.controller.signal.aborted) { close(); return; }
        socket.once('close', () => { this.controller.signal.removeEventListener('abort', close); resolve(); });
        this.controller.signal.addEventListener('abort', close, { once: true });
      });
      if (!this.controller.signal.aborted) throw new PlatformError('network', 'NapCat connection closed');
    });
    return Promise.resolve();
  }
  private connect(receive: (event: MessageEvent) => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.config.websocketUrl, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {}, handshakeTimeout: 10_000 });
      this.socket = socket;
      let queue = Promise.resolve();
      let opened = false;
      const abort = (): void => { socket.terminate(); reject(new PlatformError('cancelled', 'NapCat connection stopped')); };
      this.controller.signal.addEventListener('abort', abort, { once: true });
      socket.once('open', () => { opened = true; this.controller.signal.removeEventListener('abort', abort); resolve(); });
      socket.on('error', () => { reject(new PlatformError('network', 'NapCat connection failed')); });
      socket.on('close', () => { this.controller.signal.removeEventListener('abort', abort); if (!opened) reject(new PlatformError('network', 'NapCat connection closed before ready')); for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new PlatformError('network', 'NapCat request outcome unknown', true)); } this.pending.clear(); });
      socket.on('message', (data) => {
        let value: unknown;
        try { value = JSON.parse(rawText(data)); } catch { this.deps.onError?.(this.id, 'invalid_payload'); return; }
        const response = apiEnvelope.safeParse(value);
        if (response.success && response.data.echo) {
          const entry = this.pending.get(response.data.echo);
          if (entry) { clearTimeout(entry.timer); this.pending.delete(response.data.echo); entry.resolve(value); }
          return;
        }
        const parsed = inboundSchema.safeParse(value);
        if (!parsed.success) return;
        queue = queue.then(async () => { if (!this.controller.signal.aborted) { const event = await this.normalize(parsed.data); if (event && !this.controller.signal.aborted) await receive(event); } }).catch(() => { this.deps.onError?.(this.id, 'invalid_payload'); });
      });
    });
  }
  async api<T>(action: string, params: object, schema: z.ZodType<T>, effect = false, signal: AbortSignal = this.controller.signal): Promise<T> {
    signal = AbortSignal.any([signal, this.controller.signal]);
    signal.throwIfAborted();
    let response: z.infer<typeof apiEnvelope>;
    if (this.config.apiBase) response = await request(this.fetcher, `${this.config.apiBase.replace(/\/$/, '')}/${action}`, apiEnvelope, jsonRequest(params, signal, this.token ? { Authorization: `Bearer ${this.token}` } : {}), effect);
    else {
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) throw new PlatformError('network', 'NapCat is disconnected');
      const echo = randomUUID();
      const body = await new Promise<unknown>((resolve, reject) => {
        const abort = (): void => { clearTimeout(timer); this.pending.delete(echo); reject(new PlatformError('cancelled', 'NapCat action cancelled', effect)); };
        const cleanup = (): void => signal.removeEventListener('abort', abort);
        const timer = setTimeout(() => { cleanup(); this.pending.delete(echo); reject(new PlatformError('network', 'NapCat API timeout', effect)); }, 30_000);
        this.pending.set(echo, { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); }, timer });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { abort(); return; }
        socket.send(JSON.stringify({ action, params, echo }), (error) => { if (error) { cleanup(); clearTimeout(timer); this.pending.delete(echo); reject(new PlatformError('network', 'NapCat request interrupted', effect)); } });
      });
      response = apiEnvelope.parse(body);
    }
    signal.throwIfAborted();
    if (response.status !== 'ok' || response.retcode !== 0) throw new PlatformError('rejected', `NapCat rejected ${action}`);
    const result = schema.safeParse(response.data);
    if (!result.success) throw new PlatformError('invalid_payload', 'NapCat returned invalid response', effect);
    return result.data;
  }
  /** A bounded acknowledgement of the real triggering group message, separate from reply delivery. */
  async onProcessingStart(message: MessageEvent, signal: AbortSignal, beforeSend: () => void): Promise<void> {
    const { enabled, emojis } = this.config.preAckEmoji;
    if (!enabled || !emojis.length || message.platform !== this.id || message.platformType !== 'napcat' || message.sessionType !== 'group' || !/^-?\d+$/.test(message.messageId)) return;
    const emoji = emojis[randomInt(emojis.length)];
    const emojiId = emoji === undefined ? undefined : normalizeNapCatReactionEmoji(emoji);
    if (emojiId === undefined) throw new PlatformError('invalid_payload', 'NapCat acknowledgement emoji is invalid');
    const boundedSignal = AbortSignal.any([signal, this.controller.signal, AbortSignal.timeout(5_000)]);
    boundedSignal.throwIfAborted();
    beforeSend();
    boundedSignal.throwIfAborted();
    await this.api('set_msg_emoji_like', { message_id: message.messageId, emoji_id: emojiId, set: true }, z.unknown(), true, boundedSignal);
  }
  /** Only reviewed group actions are exposed to native plugins; never accepts an arbitrary action from model input. */
  async executeKnownAction(action: NapCatAction, signal: AbortSignal, guard: () => void): Promise<NapCatActionResult> {
    action = NapCatActionSchema.parse(action);
    signal.throwIfAborted(); guard();
    const request = <T>(schema: z.ZodType<T>, effect = false): Promise<T> => { signal.throwIfAborted(); guard(); return this.api(action.action, action.params, schema, effect, signal); };
    let result: NapCatActionResult;
    switch (action.action) {
      case 'get_group_root_files': case 'get_group_files_by_folder': result = { kind: 'files', data: await request(GroupFilesSchema) }; break;
      case 'get_group_file_url': result = { kind: 'url', data: await request(z.object({ url: z.string().url() })) }; break;
      case 'get_group_member_list': result = { kind: 'members', data: await request(GroupMembersSchema) }; break;
      case 'get_group_info': result = { kind: 'group', data: await request(GroupInfoSchema) }; break;
      case 'get_qun_album_list': result = { kind: 'albums', data: await request(AlbumListSchema) }; break;
      case 'get_group_album_media_list': result = { kind: 'media', data: await request(AlbumMediaSchema) }; break;
      case '_get_group_notice': result = { kind: 'notices', data: await request(GroupNoticesSchema) }; break;
      default: await request(z.unknown(), true); result = { kind: 'mutation', data: { success: true } };
    }
    signal.throwIfAborted(); guard(); return result;
  }
  async normalize(raw: unknown): Promise<MessageEvent | undefined> {
    const inbound = inboundSchema.parse(raw);
    // A validated protocol event can establish identity before the login handshake finishes.
    if (!this.botId && /^[1-9]\d*$/.test(inbound.self_id)) this.botId = inbound.self_id;
    if (inbound.post_type === 'notice') {
      if (inbound.user_id === inbound.self_id) return undefined;
      const reference = encodeURIComponent(JSON.stringify({ groupId: inbound.group_id, fileId: inbound.file.id, ...(inbound.file.busid === undefined ? {} : { busid: inbound.file.busid }) }));
      return MessageEventSchema.parse({ platform: this.id, platformType: 'napcat', sessionId: inbound.group_id, sessionType: 'group', senderId: inbound.user_id, senderName: inbound.user_id, messageId: `upload:${inbound.file.id}:${inbound.time}`, timestamp: inbound.time * 1000, botId: inbound.self_id, parts: [{ type: 'file', url: `napcat-group-file:${reference}`, name: inbound.file.name, size: inbound.file.size, mimeType: 'application/octet-stream' }] });
    }
    const event = inbound; if (event.user_id === event.self_id) return undefined;
    const parts: ContentPart[] = [];
    const quoteBudget: QuoteBudget = { forwardCalls: 0, nodeCount: 0, segmentCount: 0, textChars: 0, attachmentCount: 0, visited: new Set() };
    const segments = typeof event.message === 'string' ? parseCqMessage(event.message) : event.message;
    for (const segment of segments) {
      if (segment.type === 'text') { const value = z.object({ text: z.string() }).parse(segment.data); parts.push({ type: 'text', text: value.text }); }
      else if (segment.type === 'at') { const value = z.object({ qq: protocolId }).parse(segment.data); parts.push({ type: 'mention', userId: value.qq }); }
      else if (segment.type === 'reply') {
        const value = z.object({ id: protocolId }).parse(segment.data);
        const repeated = parts.some(part => part.type === 'quote' && part.messageId === value.id);
        if (!repeated) parts.push(await this.resolveQuote(value.id, event, parts.filter(part => part.type === 'quote').length, quoteBudget));
      } else if (segment.type === 'image' || segment.type === 'file') {
        const attachment = mediaSegment(segment); if (attachment) parts.push(attachment);
      } else if (segment.type === 'record') parts.push({ type: 'text', text: '[音频消息：本版本不支持语音处理]' });
    }
    return MessageEventSchema.parse({ platform: this.id, platformType: 'napcat', sessionId: event.message_type === 'group' ? event.group_id : event.user_id, sessionType: event.message_type, ...(event.group_name === undefined ? {} : { sessionName: event.group_name }), senderId: event.user_id, senderName: event.sender?.card || event.sender?.nickname || event.user_id, messageId: event.message_id, timestamp: event.time * 1000, botId: event.self_id || this.botId, parts });
  }
  private async resolveQuote(messageId: string, event: z.infer<typeof eventSchema>, count: number, budget: QuoteBudget): Promise<Extract<ContentPart, { type: 'quote' }>> {
    const base = { type: 'quote', messageId } satisfies Extract<ContentPart, { type: 'quote' }>;
    if (count >= 8 || messageId === event.message_id) return { ...base, availability: 'unavailable', unavailableReason: 'limit' };
    try {
      const msg = await this.api('get_msg', { message_id: messageId }, quotedMessageSchema);
      const sameScope = msg.message_id === messageId && msg.message_type === event.message_type && (event.message_type === 'group'
        ? event.group_id !== undefined && msg.group_id === event.group_id
        : msg.group_id === undefined && (msg.sender.user_id === event.user_id || (msg.sender.user_id === event.self_id && msg.target_id === event.user_id)));
      if (!sameScope) return { ...base, availability: 'unavailable', unavailableReason: 'scope_mismatch' };
      const segments = typeof msg.message === 'string' ? parseCqMessage(msg.message) : msg.message;
      const texts: string[] = []; const attachments: MediaAttachment[] = [];
      const forwardedSources: NonNullable<Extract<ContentPart, { type: 'quote' }>['forwardedSources']> = [];
      let partial = false;
      const appendText = (text: string): void => { const remaining = 20_000 - budget.textChars; if (text.length > remaining) partial = true; if (remaining > 0) { texts.push(text.slice(0, remaining)); budget.textChars += Math.min(remaining, text.length); } };
      type ForwardSource = Omit<NonNullable<Extract<ContentPart, { type: 'quote' }>['forwardedSources']>[number], 'attachmentIndex'>;
      const walkNode = async (raw: unknown, depth: number): Promise<void> => {
        if (depth > 2 || budget.nodeCount >= 20) { partial = true; return; }
        const node = forwardNodeSchema.safeParse(raw);
        if (!node.success) { partial = true; return; }
        const senderId = node.data.sender?.user_id ?? node.data.user_id;
        const content = node.data.content ?? node.data.message;
        if (!senderId || content === undefined) { partial = true; return; }
        budget.nodeCount++;
        const senderName = node.data.sender?.card || node.data.sender?.nickname || node.data.nickname || senderId;
        const source: ForwardSource = { senderId, senderName, ...(node.data.time === undefined ? {} : { timestamp: node.data.time * 1000 }) };
        appendText(`\n[转发节点 ${budget.nodeCount}；原发送者ID=${senderId}；昵称=${senderName.slice(0, 120)}；非当前提问者]\n`);
        await walk(typeof content === 'string' ? parseCqMessage(content) : content, depth, source);
      };
      const walk = async (items: z.infer<typeof segmentSchema>[], depth: number, source?: ForwardSource): Promise<void> => {
        for (const segment of items) {
          if (budget.segmentCount >= 100 || budget.textChars >= 20_000) { partial = true; break; } budget.segmentCount++;
          if (segment.type === 'text') appendText(z.object({ text: z.string() }).parse(segment.data).text);
          else if (segment.type === 'at') appendText(`@${z.object({ qq: protocolId }).parse(segment.data).qq}`);
          else if (segment.type === 'image' || segment.type === 'file') {
            const part = mediaSegment(segment);
            if (part && budget.attachmentCount < 8) { const attachmentIndex = attachments.length; attachments.push(part); budget.attachmentCount++; if (source) forwardedSources.push({ ...source, attachmentIndex }); }
            else partial = true;
          } else if (segment.type === 'reply') { appendText('[嵌套引用未展开]'); partial = true; }
          else if (segment.type === 'node') await walkNode(segment.data, depth + 1);
          else if (segment.type === 'forward') {
            const id = z.object({ id: protocolId }).safeParse(segment.data);
            if (!id.success || depth >= 2 || budget.forwardCalls >= 3 || budget.visited.has(id.data.id)) { appendText('[合并转发超出展开限制]'); partial = true; continue; }
            budget.visited.add(id.data.id); budget.forwardCalls++;
            try {
              const result = await this.api('get_forward_msg', { message_id: id.data.id }, z.object({ messages: z.array(z.unknown()).max(1000) }));
              for (const node of result.messages) { if (budget.nodeCount >= 20) { partial = true; break; } await walkNode(node, depth + 1); }
            } catch { this.controller.signal.throwIfAborted(); appendText('[合并转发读取失败，未获得内容]'); partial = true; }
          } else if (segment.type === 'record') appendText('[音频消息：本版本不支持语音处理]');
        }
      };
      // The root message's verified scope authorizes only forward ids found inside its real protocol chain.
      await walk(segments, 0);
      return { ...base, senderId: msg.sender.user_id, senderName: msg.sender.card || msg.sender.nickname || msg.sender.user_id, ...(msg.time === undefined ? {} : { timestamp: msg.time * 1000 }), text: texts.join(''), attachments, ...(forwardedSources.length ? { forwardedSources } : {}), availability: partial ? 'partial' : 'available', ...(partial ? { unavailableReason: 'limit' } : {}) };
    } catch {
      this.controller.signal.throwIfAborted();
      return { ...base, availability: 'unavailable', unavailableReason: 'missing' };
    }
  }
  private async loadIdentity(): Promise<void> {
    const self = await this.api('get_login_info', {}, loginInfoSchema);
    this.botId = self.user_id;
    this.botNickname = self.nickname?.trim() || self.nick?.trim() || '';
  }
  private async forwardIdentity(target: PlatformTarget): Promise<ForwardIdentity> {
    if (!this.botId) {
      try { await this.loadIdentity(); }
      catch { throw new PlatformError('rejected', 'Cannot send a merged forward without a verified bot account'); }
    }
    const userId = this.botId;
    if (!/^[1-9]\d*$/.test(userId)) throw new PlatformError('rejected', 'Cannot send a merged forward without a verified bot account');
    if (target.kind === 'group') {
      try {
        const member = await this.api('get_group_member_info', { group_id: target.chatId, user_id: userId, no_cache: false }, botMemberSchema);
        const nickname = member.card?.trim() || member.nickname?.trim() || member.nick?.trim();
        if ((!member.user_id || member.user_id === userId) && nickname) return { userId, nickname };
      } catch { this.controller.signal.throwIfAborted(); }
    }
    if (!this.botNickname) {
      try {
        const self = await this.api('get_login_info', {}, loginInfoSchema);
        if (self.user_id === userId) this.botNickname = self.nickname?.trim() || self.nick?.trim() || '';
      } catch { this.controller.signal.throwIfAborted(); }
    }
    return { userId, nickname: this.botNickname || '普瑞赛斯' };
  }
  async send(target: PlatformTarget, reply: ReplyPlan, deliveryId: string, beforeSend?: () => void): Promise<DeliveryOutcome> {
    const effects: (() => Promise<string>)[] = [];
    const assertSendAllowed = (): void => {
      try { beforeSend?.(); }
      catch { throw new PlatformError('rejected', 'NapCat delivery authorization is no longer valid'); }
    };
    const action = target.kind === 'group' ? 'send_group_msg' : 'send_private_msg';
    const base = target.kind === 'group' ? { group_id: target.chatId } : { user_id: target.chatId };
    // Count the complete raw text chain before decoration using Unicode code points.
    const textLength = reply.parts.reduce((count, part) => count + (part.type === 'text' ? Array.from(part.text).length : 0), 0);
    const forward = this.config.forwardThreshold > 0 && textLength > this.config.forwardThreshold;
    let messageParts: RichMessagePart[] = [];
    let messageChars = 0;
    let identity: Promise<ForwardIdentity> | undefined;
    const flushMessage = (): void => {
      if (!messageParts.length) return;
      const parts = messageParts;
      messageParts = []; messageChars = 0;
      effects.push(async () => {
        const sender = forward ? await (identity ??= this.forwardIdentity(target)) : undefined;
        const content: z.infer<typeof segmentSchema>[] = [];
        for (const part of parts) {
          if (part.type === 'text') content.push({ type: 'text', data: { text: part.text } });
          else {
            const media = await this.outboundMedia(part);
            content.push({ type: 'image', data: { file: `base64://${Buffer.from(media.bytes).toString('base64')}` } });
          }
        }
        assertSendAllowed();
        const result = sender === undefined
          ? await this.api(action, { ...base, message: [...(reply.replyTo ? [{ type: 'reply', data: { id: reply.replyTo } }] : []), ...content] }, messageResponse, true)
          : await this.api(target.kind === 'group' ? 'send_group_forward_msg' : 'send_private_forward_msg', {
          ...base,
          messages: [{ type: 'node', data: { user_id: sender.userId, nickname: sender.nickname, content } }],
        }, messageResponse, true);
        return result.message_id;
      });
    };
    const appendText = (text: string): void => {
      if (forward) { messageParts.push({ type: 'text', text }); return; }
      let chunk = '';
      // The plain-message budget applies across text parts; images stay at their
      // original positions and Unicode characters never straddle two messages.
      for (const character of text) {
        if (messageChars + character.length > 3500) {
          if (chunk) messageParts.push({ type: 'text', text: chunk });
          flushMessage(); chunk = '';
        }
        chunk += character; messageChars += character.length;
      }
      if (chunk) messageParts.push({ type: 'text', text: chunk });
    };
    for (const part of reply.parts) {
      if (part.type === 'text') appendText(plainMarkdown(part.text));
      else if (part.type === 'image') messageParts.push(part);
      else if (part.type === 'file') {
        flushMessage();
        const effectIndex = effects.length;
        effects.push(async () => {
          const publicUrl = part.url.startsWith('artifact:') && this.deps.resolvePublicMediaUrl ? await this.deps.resolvePublicMediaUrl(part, this.controller.signal) : part.url;
          if (!/^https?:\/\//.test(publicUrl)) throw new PlatformError('rejected', 'NapCat file delivery requires a configured signed artifact URL accessible to the protocol peer');
          assertSendAllowed();
          await this.api(target.kind === 'group' ? 'upload_group_file' : 'upload_private_file', { ...base, file: publicUrl, name: part.name }, z.unknown(), true);
          return `file:${deliveryId}:${effectIndex}`;
        });
      }
    }
    flushMessage();
    return this.deliver(deliveryId, effects);
  }
  async downloadMedia(part: Extract<ContentPart, { type: 'image' | 'file' }>, signal: AbortSignal): Promise<DownloadedMedia> {
    let url = part.url;
    if (url.startsWith('napcat-image:')) { const result = await this.api('get_image', { file: decodeURIComponent(url.slice(13)) }, z.object({ url: z.string().url() }), false, signal); url = result.url; }
    if (url.startsWith('napcat-group-file:')) { const reference = groupFileReferenceSchema.parse(JSON.parse(decodeURIComponent(url.slice(18)))); const result = await this.api('get_group_file_url', { group_id: reference.groupId, file_id: reference.fileId, ...(reference.busid === undefined ? {} : { busid: reference.busid }) }, z.object({ url: z.string().url() }), false, signal); url = result.url; }
    if (url.startsWith('napcat-file:')) { const result = await this.api('get_file', { file_id: decodeURIComponent(url.slice(12)) }, z.object({ url: z.string().url() }), false, signal); url = result.url; }
    const result = await downloadPublic(this.fetcher, url, signal, this.deps.maxMediaBytes ?? 20_000_000);
    return { ...result, name: part.type === 'file' ? part.name : 'image.jpg' };
  }
  override async stop(): Promise<void> { this.socket?.terminate(); await super.stop(); }
  async groupMembers(groupId: string): Promise<{ userId: string; name: string }[]> { const members = await this.api('get_group_member_list', { group_id: groupId }, z.array(z.object({ user_id: protocolId, nickname: z.string(), card: z.string().optional() }))); return members.map(member => ({ userId: member.user_id, name: member.card || member.nickname })); }
}

/** OneBot may send either arrays or CQ strings; decode text only after recognizing genuine segments. */
export function parseCqMessage(message: string): z.infer<typeof segmentSchema>[] {
  const segments: z.infer<typeof segmentSchema>[] = []; let offset = 0;
  const decode = (text: string): string => text.replaceAll('&#91;', '[').replaceAll('&#93;', ']').replaceAll('&#44;', ',').replaceAll('&amp;', '&');
  for (const match of message.matchAll(/\[CQ:([a-z_]+)((?:,[^\]]*)?)\]/g)) {
    if (match.index > offset) segments.push({ type: 'text', data: { text: decode(message.slice(offset, match.index)) } });
    const type = match[1]; const fields = match[2] ?? '';
    if (type) {
      const data: Record<string, string> = {};
      for (const field of fields.slice(1).split(',')) { const split = field.indexOf('='); if (split > 0) data[field.slice(0, split)] = decode(field.slice(split + 1)); }
      segments.push({ type, data });
    }
    offset = match.index + match[0].length;
  }
  if (offset < message.length) segments.push({ type: 'text', data: { text: decode(message.slice(offset)) } });
  return segments;
}
