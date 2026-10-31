import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { RunEventSchema, RuntimeConfigSchema, type RunEvent, type RuntimeConfig } from '../../contracts/src/index.js';

const ValueRow = z.object({ value: z.string() });
const RevisionRow = z.object({ revision: z.number() });
const GenerationRow = z.object({ generation: z.number() });
function freezeSnapshot<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    const children: unknown[] = Object.values(value);
    for (const child of children) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}
export const StoredRunSchema = z.object({ id: z.string(), sessionKey: z.string(), agentId: z.string(), senderId: z.string(), parentRunId: z.string().optional(), generation: z.number().int(), status: z.enum(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'interrupted']), createdAt: z.number(), updatedAt: z.number(), summary: z.string().default('') });
export type StoredRun = z.infer<typeof StoredRunSchema>;
export const DeliveryRecordSchema = z.object({ id: z.string(), runId: z.string(), status: z.enum(['pending', 'confirmed', 'uncertain', 'failed']), platformMessageId: z.string().optional(), updatedAt: z.number() });
export type DeliveryRecord = z.infer<typeof DeliveryRecordSchema>;

/** All data from SQLite is parsed at the persistence boundary. No SQL row is trusted. */
export class RuntimeStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_migrations VALUES(1);
      CREATE TABLE IF NOT EXISTS documents(namespace TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS configuration(revision INTEGER PRIMARY KEY,value TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,generation INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS dedupe(id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(run_id TEXT NOT NULL,sequence INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(run_id,sequence));`);
    for (const run of this.list('runs', StoredRunSchema)) {
      if (run.status === 'running' || run.status === 'queued') this.put('runs', run.id, { ...run, status: 'interrupted', updatedAt: Date.now(), summary: 'Runtime restarted; uncertain side effects are not replayed.' });
    }
  }
  close(): void { this.db.close(); }
  put(namespace: string, id: string, value: unknown): void {
    this.db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value').run(namespace, id, JSON.stringify(value));
  }
  get<T>(namespace: string, id: string, schema: z.ZodType<T>): T | undefined {
    const row = this.db.prepare('SELECT value FROM documents WHERE namespace=? AND id=?').get(namespace, id);
    if (row === undefined) return undefined;
    const value: unknown = JSON.parse(ValueRow.parse(row).value);
    return schema.parse(value);
  }
  list<T>(namespace: string, schema: z.ZodType<T>): T[] {
    return this.db.prepare('SELECT value FROM documents WHERE namespace=? ORDER BY id').all(namespace).map(row => {
      const value: unknown = JSON.parse(ValueRow.parse(row).value);
      return schema.parse(value);
    });
  }
  delete(namespace: string, id: string): void { this.db.prepare('DELETE FROM documents WHERE namespace=? AND id=?').run(namespace, id); }
  getConfig(revision?: number): RuntimeConfig | undefined {
    const row = revision === undefined ? this.db.prepare('SELECT value FROM configuration ORDER BY revision DESC LIMIT 1').get() : this.db.prepare('SELECT value FROM configuration WHERE revision=?').get(revision);
    if (row === undefined) return undefined;
    const value: unknown = JSON.parse(ValueRow.parse(row).value);
    return freezeSnapshot(RuntimeConfigSchema.parse(value));
  }
  publishConfig(config: RuntimeConfig, expectedRevision: number, commitRelated?: () => void): RuntimeConfig {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT revision FROM configuration ORDER BY revision DESC LIMIT 1').get();
      const actual = row === undefined ? 0 : RevisionRow.parse(row).revision;
      if (actual !== expectedRevision) throw new Error(`Revision conflict: expected ${expectedRevision}, active ${actual}`);
      const next = RuntimeConfigSchema.parse({ ...config, revision: actual + 1, flow: { ...config.flow, revision: actual + 1 } });
      this.db.prepare('INSERT INTO configuration VALUES(?,?,?)').run(next.revision, JSON.stringify(next), Date.now());
      commitRelated?.();
      this.db.exec('COMMIT');
      return freezeSnapshot(next);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  generation(sessionKey: string): number {
    const row = this.db.prepare('SELECT generation FROM sessions WHERE id=?').get(sessionKey);
    return row === undefined ? 0 : GenerationRow.parse(row).generation;
  }
  reset(sessionKey: string): number {
    this.db.prepare('INSERT INTO sessions(id,generation) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET generation=generation+1').run(sessionKey);
    return this.generation(sessionKey);
  }
  claimEvent(id: string, ttlMs: number, now = Date.now()): boolean {
    this.db.prepare('DELETE FROM dedupe WHERE expires_at<=?').run(now);
    return this.db.prepare('INSERT OR IGNORE INTO dedupe(id,expires_at) VALUES(?,?)').run(id, now + ttlMs).changes === 1;
  }
  appendEvent(event: RunEvent): void {
    const validated = RunEventSchema.parse(event);
    this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(validated.runId, validated.sequence, JSON.stringify(validated));
    this.db.prepare('DELETE FROM events WHERE run_id=? AND sequence < ?').run(validated.runId, validated.sequence - 1999);
  }
  events(runId: string, after = -1): RunEvent[] {
    return this.db.prepare('SELECT value FROM (SELECT sequence,value FROM events WHERE run_id=? AND sequence>? ORDER BY sequence DESC LIMIT 2000) ORDER BY sequence').all(runId, after).map(row => {
      const value: unknown = JSON.parse(ValueRow.parse(row).value);
      return RunEventSchema.parse(value);
    });
  }
  saveRun(run: StoredRun): void { this.put('runs', run.id, StoredRunSchema.parse(run)); }
  runs(): StoredRun[] { return this.list('runs', StoredRunSchema); }
  saveDelivery(record: DeliveryRecord): void { this.put('delivery', record.id, DeliveryRecordSchema.parse(record)); }
  delivery(id: string): DeliveryRecord | undefined { return this.get('delivery', id, DeliveryRecordSchema); }
}
