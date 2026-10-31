import { ProxyAgent, type Dispatcher } from 'undici';
/** Per-plugin dispatcher: never mutates Node's global dispatcher or other providers. */
export class BangumiTransport {
  private current: { value: string; agent: ProxyAgent } | undefined;
  private readonly closing = new Set<Promise<void>>();
  constructor(private readonly secret: (name: string) => string | undefined, private readonly fetcher: typeof fetch = fetch) {}
  private retire(agent: ProxyAgent): void { const pending = agent.close().catch(() => undefined); this.closing.add(pending); void pending.finally(() => this.closing.delete(pending)); }
  async request(url: URL | string, init: RequestInit, proxySecret: string): Promise<Response> { const target = new URL(url); if (target.origin !== 'https://api.bgm.tv') throw new Error('Bangumi destination rejected'); const configured = proxySecret ? this.secret(proxySecret) : undefined; if (proxySecret && !configured) throw new Error('Bangumi proxy secret is not configured'); let dispatcher: Dispatcher | undefined;
    if (configured) { if (!this.current || this.current.value !== configured) { let proxy: URL; try { proxy = new URL(configured); } catch { throw new Error('Bangumi proxy URL is invalid'); } if (!['http:', 'https:'].includes(proxy.protocol) || proxy.pathname !== '/' || proxy.search || proxy.hash) throw new Error('Bangumi proxy must be an HTTP(S) origin'); const token = proxy.username || proxy.password ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` : undefined; const agent = new ProxyAgent({ uri: proxy.origin, ...(token ? { token } : {}) }); if (this.current) this.retire(this.current.agent); this.current = { value: configured, agent }; } dispatcher = this.current.agent; }
    else if (this.current) { this.retire(this.current.agent); this.current = undefined; }
    const options: RequestInit & { dispatcher?: Dispatcher } = { ...init, redirect: 'error', ...(dispatcher ? { dispatcher } : {}) }; try { return await this.fetcher(target, options); } catch { init.signal?.throwIfAborted(); throw new Error('Bangumi network request failed; check configured proxy and DNS'); }
  }
  async close(): Promise<void> { if (this.current) { this.retire(this.current.agent); this.current = undefined; } await Promise.all(this.closing); }
}
