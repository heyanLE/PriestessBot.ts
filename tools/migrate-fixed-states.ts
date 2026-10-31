import { randomUUID } from 'node:crypto';
import { chmod, open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { LegacyGrantSchema, RuntimeConfigSchema, runtimeStateCapabilities, type RuntimeState } from '../packages/contracts/src/index.js';

const RowSchema = z.object({ revision: z.number().int(), value: z.string() });
const SourceShape = z.object({ revision: z.number().int().nonnegative().default(0), flow: z.object({ revision: z.number().int().nonnegative().default(0) }).passthrough(), grants: z.array(z.unknown()).default([]), agents: z.array(z.object({ capabilities: z.array(z.string()).optional() }).passthrough()) }).passthrough();
const ValueRow = z.object({ value: z.string() });
const PolicyMarker = 'fixed-states-v1';
export interface FixedStateMigrationOptions { database: string; apply?: boolean; runtimeStopped?: boolean; rollbackRevision?: number; }
export interface FixedStateMigrationReport {
  applied: boolean; backupCreated: boolean; backupPath?: string; sourceRevision: number; targetRevision?: number; rollbackSourceRevision?: number;
  rules: number; senderAssignments: number; uniquePlatformIdentities: number; states: Record<RuntimeState, number>;
  legacyRulesConverted: number; legacyCeilingsIgnored: number; legacyCapabilityPoliciesRetired: number; legacyResourcePoliciesRetired: number; agentCapabilityPoliciesRetired: number;
  storedRequestedStatesIgnored: number; alreadyApplied: boolean;
}
function parseJson(text: string): unknown { const value: unknown = JSON.parse(text); return value; }

/** Offline migration. Does not instantiate RuntimeStore or mutate run, persona or session records. */
export async function migrateFixedStates(options: FixedStateMigrationOptions): Promise<FixedStateMigrationReport> {
  if (options.apply && !options.runtimeStopped) throw new Error('--apply requires --runtime-stopped');
  if (options.rollbackRevision !== undefined && (!Number.isInteger(options.rollbackRevision) || options.rollbackRevision < 0)) throw new Error('Rollback revision must be a nonnegative integer');
  const database = resolve(options.database); await stat(database);
  const db = new DatabaseSync(database, { readOnly: !options.apply }); let transaction = false;
  try {
    const current = RowSchema.parse(db.prepare('SELECT revision,value FROM configuration ORDER BY revision DESC LIMIT 1').get());
    const selected = options.rollbackRevision === undefined ? current : RowSchema.parse(db.prepare('SELECT revision,value FROM configuration WHERE revision=?').get(options.rollbackRevision));
    const raw = parseJson(selected.value); const source = SourceShape.parse(raw); const normalized = RuntimeConfigSchema.parse(raw);
    const identities = new Set<string>(); const states: Record<RuntimeState, number> = { operator: 0, senior_operator: 0, elite_operator: 0 };
    let legacyRulesConverted = 0; let legacyCeilingsIgnored = 0; let legacyCapabilityPoliciesRetired = 0;
    for (const grant of source.grants) {
      const legacy = LegacyGrantSchema.safeParse(grant); if (!legacy.success) continue;
      legacyRulesConverted++;
      if (legacy.data.maximumState !== legacy.data.defaultState) legacyCeilingsIgnored++;
      const fixed = runtimeStateCapabilities[legacy.data.defaultState];
      if (fixed.length !== legacy.data.capabilities.length || fixed.some(capability => !legacy.data.capabilities.includes(capability))) legacyCapabilityPoliciesRetired++;
    }
    for (const grant of normalized.grants) for (const id of grant.senderIds) { identities.add(JSON.stringify([grant.platform, id])); states[grant.state]++; }
    const requested = db.prepare("SELECT COUNT(*) AS count FROM documents WHERE namespace='requested-state'").get();
    const requestedCount = z.object({ count: z.number() }).parse(requested).count;
    const marker = db.prepare("SELECT 1 FROM documents WHERE namespace='permission-policy' AND id=?").get(PolicyMarker) !== undefined;
    const report: FixedStateMigrationReport = {
      applied: false, backupCreated: false, sourceRevision: current.revision,
      ...(options.rollbackRevision === undefined ? {} : { rollbackSourceRevision: selected.revision }),
      rules: normalized.grants.length, senderAssignments: Object.values(states).reduce((a,b)=>a+b,0), uniquePlatformIdentities: identities.size, states,
      legacyRulesConverted, legacyCeilingsIgnored, legacyCapabilityPoliciesRetired, legacyResourcePoliciesRetired: legacyRulesConverted,
      agentCapabilityPoliciesRetired: source.agents.filter(agent => agent.capabilities !== undefined).length,
      storedRequestedStatesIgnored: requestedCount,
      alreadyApplied: options.rollbackRevision === undefined && marker && legacyRulesConverted === 0,
    };
    if (!options.apply || report.alreadyApplied) return report;
    const active = db.prepare("SELECT value FROM documents WHERE namespace='runs'").all().some(row => {
      const value = z.object({ status: z.string() }).parse(parseJson(ValueRow.parse(row).value));
      return ['running','queued','paused'].includes(value.status);
    });
    if (active) throw new Error('Active or paused tasks exist; migration refused');
    const backupPath = `${database}.fixed-states-backup-${Date.now()}-${randomUUID()}.sqlite`;
    const destination = await open(backupPath, 'wx', 0o600); await destination.close(); await backup(db, backupPath); await chmod(backupPath, 0o600);
    report.backupCreated = true; report.backupPath = backupPath;
    db.exec('BEGIN IMMEDIATE'); transaction = true;
    const latest = RowSchema.parse(db.prepare('SELECT revision,value FROM configuration ORDER BY revision DESC LIMIT 1').get());
    if (latest.revision !== current.revision || latest.value !== current.value) throw new Error('Configuration changed while preparing migration');
    const targetRevision = current.revision + 1;
    const next = options.rollbackRevision === undefined
      ? RuntimeConfigSchema.parse({ ...normalized, revision: targetRevision, flow: { ...normalized.flow, revision: targetRevision } })
      : { ...source, revision: targetRevision, flow: { ...source.flow, revision: targetRevision } };
    db.prepare('INSERT INTO configuration(revision,value,created_at) VALUES(?,?,?)').run(targetRevision, JSON.stringify(next), Date.now());
    if (options.rollbackRevision === undefined) db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value').run('permission-policy', PolicyMarker, JSON.stringify({ version: 1, revision: targetRevision, sourceRevision: current.revision, appliedAt: Date.now() }));
    else db.prepare("DELETE FROM documents WHERE namespace='permission-policy' AND id=?").run(PolicyMarker);
    report.applied = true; report.targetRevision = targetRevision;
    db.prepare('INSERT INTO documents(namespace,id,value) VALUES(?,?,?)').run('migration-reports', `fixed-states-${randomUUID()}`, JSON.stringify(report));
    db.exec('COMMIT'); transaction = false; await chmod(database, 0o600);
    return report;
  } catch (error) { if (transaction) db.exec('ROLLBACK'); throw error; } finally { db.close(); }
}

async function main(): Promise<void> {
  try {
    const { values } = parseArgs({ options: { database: { type: 'string' }, apply: { type: 'boolean', default: false }, 'runtime-stopped': { type: 'boolean', default: false }, 'rollback-revision': { type: 'string' } } });
    if (!values.database) throw new Error('Use --database <runtime.sqlite> [--apply --runtime-stopped]');
    const rollbackRevision = values['rollback-revision'] === undefined ? undefined : z.coerce.number().int().nonnegative().parse(values['rollback-revision']);
    const report = await migrateFixedStates({ database: values.database, apply: values.apply, runtimeStopped: values['runtime-stopped'], ...(rollbackRevision === undefined ? {} : { rollbackRevision }) });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch { process.stderr.write('Fixed-state migration failed. Check configuration validity, duplicate roles and stopped-runtime status. No credentials or sender IDs are printed.\n'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
