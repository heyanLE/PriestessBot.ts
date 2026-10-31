import { z } from 'zod';
import type { EngineInput } from '../../../contracts/src/index.js';
import { AgentIdSchema, PrincipalSchema, RuntimeStateSchema } from '../../../contracts/src/index.js';
import type { RuntimeStore } from '../../../core/src/storage.js';
import type { AuthorizationService } from '../../../core/src/authorization.js';
export const MediaOwnerSchema = z.object({ principal: PrincipalSchema, agentId: AgentIdSchema, runtimeState: RuntimeStateSchema, grantVersion: z.number(), generation: z.number() });
export type MediaOwner = z.infer<typeof MediaOwnerSchema>;
export interface MediaPluginDependencies { store: RuntimeStore; auth: AuthorizationService; secret: (name: string) => string | undefined; fetch?: typeof fetch; summarize?: (input: EngineInput, text: string, instruction: string) => Promise<string>; }
export interface MediaTickHost { resume: (owner: MediaOwner) => EngineInput | undefined; deliver: (input: EngineInput, text: string, id: string, beforeSend?: () => void) => Promise<void>; }
export function mediaOwner(input: EngineInput): MediaOwner { const c = input.context; return { principal: c.principal, agentId: c.agentId, runtimeState: c.runtimeState, grantVersion: c.grantVersion, generation: c.generation }; }
export function ownerKey(owner: MediaOwner): string { return JSON.stringify([owner.principal.platform, owner.principal.sessionType ?? 'private', owner.principal.sessionId, owner.principal.senderId, owner.agentId]); }
export function checkResumed(owner: MediaOwner, input: EngineInput): boolean { return ownerKey(owner) === ownerKey(mediaOwner(input)) && owner.grantVersion === input.context.grantVersion && owner.generation === input.context.generation && owner.runtimeState === input.context.runtimeState; }
export async function boundedText(response: Response, maximum = 2000000): Promise<string> { if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`); if (Number(response.headers.get('content-length')) > maximum) throw new Error('Upstream response exceeds byte limit'); if (!response.body) return ''; const reader = response.body.getReader(); const parts: Uint8Array[] = []; let length = 0; try { for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > maximum) throw new Error('Upstream response exceeds byte limit'); parts.push(next.value); } } finally { await reader.cancel(); } return Buffer.concat(parts).toString('utf8'); }
export async function parsedJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> { const raw: unknown = JSON.parse(await boundedText(response)); return schema.parse(raw); }
export function plainText(value: string): string { return value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim(); }
export function scopedSubscriptionId(input: EngineInput, target: string): string { return `${ownerKey(mediaOwner(input))}:${target}`; }
