import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { PlatformError, type HttpFetch } from '../platforms/transport.js';
const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] satisfies [string, number][]) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 96], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32], ['2001::', 32], ['2002::', 16], ['64:ff9b::', 96]] satisfies [string, number][]) blocked.addSubnet(address, prefix, 'ipv6');
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  const family = isIP(ip);
  return family === 0 || blocked.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}
export interface ResolvedMediaTarget { readonly url: URL; readonly hostname: string; readonly addresses: readonly LookupAddress[]; }
export type MediaResolver = (hostname: string) => Promise<LookupAddress[]>;
export async function resolveMediaTarget(value: string, resolver: MediaResolver = hostname => lookup(hostname, { all: true })): Promise<ResolvedMediaTarget> {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new PlatformError('rejected', 'Media must use a credential-free HTTPS URL');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(hostname);
  const addresses = literalFamily === 0 ? await resolver(hostname) : [{ address: hostname, family: literalFamily }];
  if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) throw new PlatformError('rejected', 'Private media destinations are unavailable');
  return { url, hostname, addresses };
}
export async function validatePublicMediaUrl(value: string): Promise<URL> { return (await resolveMediaTarget(value)).url; }
/** The socket uses only the exact addresses validated before the request; DNS is never repeated. */
export function pinnedLookup(addresses: readonly LookupAddress[]): LookupFunction {
  if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) throw new PlatformError('rejected', 'Private media destinations are unavailable');
  return (_hostname, options, callback) => {
    const family = options.family;
    const candidates = addresses.filter(entry => !family || entry.family === family);
    const first = candidates[0];
    if (!first) { callback(new Error('No validated address matches the requested family'), []); return; }
    if (options.all) callback(null, [...candidates]);
    else callback(null, first.address, first.family);
  };
}
export async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok) throw new PlatformError('rejected', `Media HTTP ${response.status}`);
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maxBytes) throw new PlatformError('rejected', 'Media exceeds size limit');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new PlatformError('rejected', 'Media exceeds size limit'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function downloadPinned(target: ResolvedMediaTarget, signal: AbortSignal, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType: string }> {
  return new Promise((resolve, reject: (reason: Error) => void) => {
    const request = httpsRequest(target.url, { method: 'GET', lookup: pinnedLookup(target.addresses), servername: isIP(target.hostname) ? '' : target.hostname, agent: false, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) }, response => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) { response.destroy(); reject(new PlatformError('rejected', `Media HTTP ${status}; redirects are unavailable`)); return; }
      const length = Number(response.headers['content-length']);
      if (Number.isFinite(length) && length > maxBytes) { response.destroy(); reject(new PlatformError('rejected', 'Media exceeds size limit')); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) response.destroy(new PlatformError('rejected', 'Media exceeds size limit')); else chunks.push(chunk); });
      response.on('error', (error: Error) => { reject(error instanceof PlatformError ? error : new PlatformError(signal.aborted ? 'cancelled' : 'network', 'Media download interrupted')); });
      response.on('end', () => { resolve({ bytes: Buffer.concat(chunks, size), mimeType: response.headers['content-type']?.split(';')[0] ?? 'application/octet-stream' }); });
    });
    request.on('error', () => { reject(new PlatformError(signal.aborted ? 'cancelled' : 'network', 'Media transport interrupted')); });
    request.end();
  });
}
export async function downloadPublic(fetcher: HttpFetch, url: string, signal: AbortSignal, maxBytes: number): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const target = await resolveMediaTarget(url);
  // Production always uses the pinned TLS transport. Injection is an explicit test/host transport boundary.
  if (fetcher === fetch) return downloadPinned(target, signal, maxBytes);
  const response = await fetcher(target.url, { signal, redirect: 'error' });
  const bytes = await readBoundedResponse(response, maxBytes);
  return { bytes, mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream' };
}
