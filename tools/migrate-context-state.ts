import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { migrateContextState } from '../packages/core/src/context-state-migration.js';
const { values } = parseArgs({ options: { database: { type: 'string' }, apply: { type: 'boolean', default: false }, 'runtime-stopped': { type: 'boolean', default: false } } });
if (!values.database || (values.apply && !values['runtime-stopped'])) {
  process.stderr.write('Usage: migrate-context-state --database /path/runtime.sqlite [--apply --runtime-stopped]. Stop the runtime and back up its database before applying.\n'); process.exitCode = 2;
} else {
  try {
    const db = new DatabaseSync(values.database, { readOnly: !values.apply });
    try { const report = migrateContextState(db, values.apply); process.stdout.write(JSON.stringify(report) + '\n'); if (report.blockedHistories) process.exitCode = 1; }
    finally { db.close(); }
  } catch { process.stderr.write('Context migration failed validation or could not access the database; no private content is printed.\n'); process.exitCode = 1; }
}
