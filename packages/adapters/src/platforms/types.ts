import type { z } from 'zod';
import type { PlatformStatusSchema } from '../../../contracts/src/index.js';
import type { ContentPart, MessageEvent, PlatformConfig, ReplyPlan } from '../../../contracts/src/index.js';
import type { FailureKind, HttpFetch, StateStore } from './transport.js';
export interface PlatformTarget { readonly chatId: string; readonly kind: 'private' | 'group'; }
export interface PlatformCapabilities { readonly edit: boolean; readonly images: boolean; readonly files: boolean; readonly groups: boolean; readonly audio: false; /** Adapter decides folding/pagination from the complete final reply. */ readonly wholeReply?: boolean; }
export type DeliveryOutcome = { readonly status: 'confirmed'; readonly messageIds: string[] } | { readonly status: 'uncertain'; readonly reason: string; readonly messageIds: string[] } | { readonly status: 'failed'; readonly kind: FailureKind; readonly reason: string; readonly messageIds: string[] };
export interface DownloadedMedia { readonly bytes: Uint8Array; readonly mimeType: string; readonly name: string; }
export type PlatformStatus = z.infer<typeof PlatformStatusSchema>;
export type AdapterLifecycle = Pick<PlatformStatus, 'status' | 'message'>;
export interface AdapterDependencies {
  readonly onStatus?: (platformId: string, state: AdapterLifecycle) => void;
  readonly fetch?: HttpFetch;
  readonly state: StateStore;
  readonly secret: (name: string) => string | undefined;
  readonly onError?: (platformId: string, kind: FailureKind) => void;
  readonly maxMediaBytes?: number;
  readonly resolvePublicMediaUrl?: (part: Extract<ContentPart, { type: 'image' | 'file' }>, signal: AbortSignal) => Promise<string>;
  readonly resolveMedia?: (part: Extract<ContentPart, { type: 'image' | 'file' }>, signal: AbortSignal) => Promise<DownloadedMedia>;
}
export interface PlatformAdapter {
  readonly id: string;
  readonly capabilities: PlatformCapabilities;
  start(receive: (event: MessageEvent) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  send(target: PlatformTarget, reply: ReplyPlan, deliveryId: string, beforeSend?: () => void): Promise<DeliveryOutcome>;
  /** Best-effort native acknowledgement; never sends a substitute chat message. */
  onProcessingStart?(message: MessageEvent, signal: AbortSignal, beforeSend: () => void): Promise<void>;
  edit(target: PlatformTarget, messageId: string, text: string): Promise<DeliveryOutcome>;
  downloadMedia(part: Extract<ContentPart, { type: 'image' | 'file' }>, signal: AbortSignal): Promise<DownloadedMedia>;
}
export type TelegramConfig = Extract<PlatformConfig, { type: 'telegram' }>;
export type NapCatConfig = Extract<PlatformConfig, { type: 'napcat' }>;
export type WeixinConfig = Extract<PlatformConfig, { type: 'weixin' }>;
