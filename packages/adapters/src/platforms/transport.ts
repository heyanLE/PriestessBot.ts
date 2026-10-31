import { z } from 'zod';

export type HttpFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
export interface StateStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
export class MemoryStateStore implements StateStore {
  private readonly entries = new Map<string, string>();
  get(key: string): Promise<string | undefined> { return Promise.resolve(this.entries.get(key)); }
  set(key: string, value: string): Promise<void> { this.entries.set(key, value); return Promise.resolve(); }
  delete(key: string): Promise<void> { this.entries.delete(key); return Promise.resolve(); }
}
export type FailureKind = 'authentication' | 'rate_limit' | 'invalid_payload' | 'network' | 'rejected' | 'cancelled';
export class PlatformError extends Error {
  constructor(readonly kind: FailureKind, message: string, readonly uncertain = false, readonly retryAfterMs = 0) { super(message); }
}
export async function request<T>(fetcher: HttpFetch, url: string | URL, schema: z.ZodType<T>, init: RequestInit = {}, effect = false): Promise<T> {
  let response: Response;
  try { response = await fetcher(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(75_000)]) : AbortSignal.timeout(75_000) }); }
  catch { throw new PlatformError(init.signal?.aborted ? 'cancelled' : 'network', 'Platform transport interrupted', effect); }
  if (!response.ok) {
    const kind = response.status === 401 || response.status === 403 ? 'authentication' : response.status === 429 ? 'rate_limit' : 'rejected';
    throw new PlatformError(kind, `Platform HTTP ${response.status}`, effect && response.status >= 500, Number(response.headers.get('retry-after') ?? '0') * 1000);
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new PlatformError('invalid_payload', 'Platform returned invalid JSON', effect); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new PlatformError('invalid_payload', 'Platform response does not match protocol', effect);
  return parsed.data;
}
export function jsonRequest(payload: object, signal?: AbortSignal, headers?: Record<string, string>): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload), ...(signal ? { signal } : {}) };
}
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}
export const protocolId = z.union([z.string().min(1), z.number().int()]).transform(String);
