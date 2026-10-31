import { randomUUID } from 'node:crypto';
import { MemoryRecordSchema, type AgentDefinition, type MemoryRecord, type RunContext } from '../../contracts/src/index.js';
import type { AuthorizationService } from './authorization.js';
import type { RuntimeStore } from './storage.js';

function visible(record: MemoryRecord, context: RunContext): boolean {
  if (record.agentId !== context.agentId || record.principal.platform !== context.principal.platform || (record.principal.sessionType ?? 'private') !== (context.principal.sessionType ?? 'private')) return false;
  if (record.scope === 'agent') return true;
  if (record.scope === 'session') return record.principal.sessionId === context.principal.sessionId;
  return record.principal.senderId === context.principal.senderId && record.principal.sessionId === context.principal.sessionId;
}
export class MemoryService {
  constructor(private readonly store: RuntimeStore, private readonly auth: AuthorizationService) {}
  list(): MemoryRecord[] { return this.store.list('memories', MemoryRecordSchema); }
  remember(context: RunContext, agent: AgentDefinition, input: { libraryId: string; text: string; source: string; scope?: MemoryRecord['scope']; confidence?: number; expiresAt?: number }): MemoryRecord {
    this.auth.assert(context, 'memory.write', agent, { kind: 'memoryLibraries', id: input.libraryId });
    const scope = input.scope ?? 'sender';
    if (scope !== 'sender') this.auth.assert(context, 'resources.manage', agent);
    const now = Date.now();
    const record = MemoryRecordSchema.parse({ ...input, scope, confidence: input.confidence ?? 1, id: randomUUID(), agentId: context.agentId, principal: context.principal, createdAt: now, updatedAt: now });
    this.store.put('memories', record.id, record); return record;
  }
  recall(context: RunContext, agent: AgentDefinition, query: string, limit = 8): MemoryRecord[] {
    this.auth.assert(context, 'memory.read', agent);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.list().filter(record => context.resources.memoryLibraries.includes(record.libraryId) && visible(record, context) && (record.expiresAt === undefined || record.expiresAt > Date.now())).sort((left, right) => {
      const score = (record: MemoryRecord): number => terms.reduce((total, term) => total + (record.text.toLowerCase().includes(term) ? 1 : 0), 0) + record.confidence / 10;
      return score(right) - score(left) || right.updatedAt - left.updatedAt;
    }).slice(0, Math.max(0, Math.min(limit, 30)));
  }
  update(context: RunContext, agent: AgentDefinition, id: string, text: string): MemoryRecord {
    const record = this.requireOwned(context, agent, id);
    const changed = MemoryRecordSchema.parse({ ...record, text, updatedAt: Date.now() });
    this.store.put('memories', id, changed); return changed;
  }
  delete(context: RunContext, agent: AgentDefinition, id: string): void { this.requireOwned(context, agent, id); this.store.delete('memories', id); }
  private requireOwned(context: RunContext, agent: AgentDefinition, id: string): MemoryRecord {
    const record = this.store.get('memories', id, MemoryRecordSchema);
    if (record === undefined || !visible(record, context)) throw new Error('Memory not found');
    this.auth.assert(context, 'memory.write', agent, { kind: 'memoryLibraries', id: record.libraryId });
    if (record.scope !== 'sender') this.auth.assert(context, 'resources.manage', agent);
    return record;
  }
  async extract(context: RunContext, agent: AgentDefinition, libraryId: string, source: string, transcript: string, extractor: MemoryExtractor): Promise<MemoryRecord[]> {
    this.auth.assert(context, 'memory.write', agent, { kind: 'memoryLibraries', id: libraryId });
    const candidates = await extractor.extract(transcript.slice(0, 20_000), context.signal);
    const existing = new Set(this.recall(context, agent, '', 30).map(memory => memory.text));
    const results: MemoryRecord[] = [];
    for (const candidate of candidates.slice(0, 8)) {
      if (!existing.has(candidate.text)) { results.push(this.remember(context, agent, { libraryId, text: candidate.text, source, confidence: candidate.confidence, scope: 'sender' })); existing.add(candidate.text); }
    }
    return results;
  }
  pruneExpired(now = Date.now()): number {
    let deleted = 0; for (const record of this.list()) if (record.expiresAt !== undefined && record.expiresAt <= now) { this.store.delete('memories', record.id); deleted += 1; } return deleted;
  }
  consolidate(context: RunContext, agent: AgentDefinition, libraryId: string, limit = 100): { inspected: number; duplicatesRemoved: number; expiredRemoved: number } {
    this.auth.assert(context, 'memory.write', agent, { kind: 'memoryLibraries', id: libraryId });
    const records = this.list().filter(record => record.libraryId === libraryId && visible(record, context) && (record.scope === 'sender' || context.effectiveCapabilities.includes('resources.manage'))).sort((left, right) => right.confidence - left.confidence || right.updatedAt - left.updatedAt).slice(0, Math.max(1, Math.min(500, limit)));
    const seen = new Map<string, MemoryRecord>(); let duplicatesRemoved = 0; let expiredRemoved = 0;
    for (const record of records) {
      if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) { this.delete(context, agent, record.id); expiredRemoved += 1; continue; }
      const key = JSON.stringify([record.scope, record.principal.platform, record.principal.sessionType ?? 'private', record.principal.sessionId, record.principal.senderId, record.text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()]);
      const retained = seen.get(key);
      if (retained === undefined) { seen.set(key, record); continue; }
      // Only exact normalized duplicates merge; source provenance is retained in the survivor.
      this.auth.assert(context, 'memory.write', agent, { kind: 'memoryLibraries', id: libraryId });
      const source = [...new Set([retained.source, record.source])].join('\n').slice(0, 10_000);
      const merged = { ...retained, source, updatedAt: Date.now() };
      this.store.put('memories', retained.id, merged); seen.set(key, merged); this.delete(context, agent, record.id); duplicatesRemoved += 1;
    }
    return { inspected: records.length, duplicatesRemoved, expiredRemoved };
  }
}
export interface MemoryExtractor { extract(transcript: string, signal: AbortSignal): Promise<readonly { text: string; confidence: number }[]>; }
