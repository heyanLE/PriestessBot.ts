import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { AuditRecordSchema, SecretNameSchema } from '../../../packages/contracts/src/operator.js';
import type { RuntimeStore } from '../../../packages/core/src/storage.js';
const SessionSchema = z.object({ expiresAt: z.number() });
const SecretSchema = z.object({ name: SecretNameSchema, value: z.string(), updatedAt: z.number() });
const cookieName = 'priestess_management';
const lifetime = 8 * 60 * 60 * 1000;

export class OperatorManagement {
  constructor(private readonly store: RuntimeStore) {}
  audit(action: string, target: string, outcome: 'success' | 'failure' = 'success'): void {
    const id = randomUUID(); this.store.put('operator-audit', id, { id, timestamp: Date.now(), action, target: target.slice(0, 500), outcome });
    const records = this.store.list('operator-audit', AuditRecordSchema).sort((a, b) => b.timestamp - a.timestamp);
    for (const record of records.slice(2000)) this.store.delete('operator-audit', record.id);
  }
  logs(): z.infer<typeof AuditRecordSchema>[] { return this.store.list('operator-audit', AuditRecordSchema).sort((a, b) => b.timestamp - a.timestamp); }
  secret(name: string): string | undefined { return this.store.get('operator-secrets', name, SecretSchema)?.value; }
  secrets(): { name: string; updatedAt: number }[] { return this.store.list('operator-secrets', SecretSchema).map(({ name, updatedAt }) => ({ name, updatedAt })); }
  setSecret(name: string, value: string): void { SecretNameSchema.parse(name); z.string().min(1).max(65_536).parse(value); this.store.put('operator-secrets', name, { name, value, updatedAt: Date.now() }); this.audit('secret.set', name); }
  deleteSecret(name: string): void { SecretNameSchema.parse(name); this.store.delete('operator-secrets', name); this.audit('secret.delete', name); }
  bearer(request: IncomingMessage, token: string): boolean { const actual = Buffer.from(request.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${token}`); return actual.length === expected.length && timingSafeEqual(actual, expected); }
  session(request: IncomingMessage): { authenticated: boolean; expiresAt?: number } {
    const token = this.cookie(request); if (!token) return { authenticated: false };
    const id = createHash('sha256').update(token).digest('hex'); const session = this.store.get('operator-sessions', id, SessionSchema);
    if (!session) return { authenticated: false };
    if (session.expiresAt <= Date.now()) { this.store.delete('operator-sessions', id); return { authenticated: false }; }
    return { authenticated: true, expiresAt: session.expiresAt };
  }
  issue(request: IncomingMessage, response: ServerResponse): { authenticated: true; expiresAt: number } {
    for (const row of this.store.db.prepare('SELECT id,value FROM documents WHERE namespace=?').all('operator-sessions')) {
      const item = z.object({ id: z.string(), value: z.string() }).parse(row); const raw: unknown = JSON.parse(item.value);
      if (SessionSchema.parse(raw).expiresAt <= Date.now()) this.store.delete('operator-sessions', item.id);
    }
    const token = randomBytes(32).toString('hex'); const expiresAt = Date.now() + lifetime;
    this.store.put('operator-sessions', createHash('sha256').update(token).digest('hex'), { expiresAt });
    response.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api/ts/; Max-Age=${lifetime / 1000}${this.secure(request) ? '; Secure' : ''}`);
    this.audit('login', 'dashboard'); return { authenticated: true, expiresAt };
  }
  logout(request: IncomingMessage, response: ServerResponse): void {
    const token = this.cookie(request); if (token) this.store.delete('operator-sessions', createHash('sha256').update(token).digest('hex'));
    response.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api/ts/; Max-Age=0${this.secure(request) ? '; Secure' : ''}`); this.audit('logout', 'dashboard');
  }
  sameOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (!origin) return request.headers['sec-fetch-site'] !== 'cross-site';
    try { const parsed = new URL(origin); return parsed.host === request.headers.host && ['http:', 'https:'].includes(parsed.protocol); } catch { return false; }
  }
  private cookie(request: IncomingMessage): string | undefined { const part = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`)); const token = part?.slice(cookieName.length + 1); return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined; }
  private secure(request: IncomingMessage): boolean { return 'encrypted' in request.socket && request.socket.encrypted === true; }
}
