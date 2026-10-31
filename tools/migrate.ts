import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { migrateConfigurationFile } from '../packages/core/src/migration.js';
import { importLegacyDatabase } from '../packages/core/src/data-migration.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { validateConfiguration } from '../packages/core/src/flow.js';

const { values } = parseArgs({ options: { source: { type: 'string' }, target: { type: 'string' }, apply: { type: 'boolean', default: false }, 'map-normal': { type: 'boolean', default: false }, database: { type: 'string', multiple: true }, 'persona-bindings': { type: 'string' }, 'memory-session-types': { type: 'string' } } });
if (!values.source || !values.target) { process.stderr.write('Usage: npm run migrate -- --source /path/config.json --target /new/directory [--apply] [--map-normal]\n'); process.exitCode = 2; }
else {
  const result = await migrateConfigurationFile(values.source, values.target, { apply: values.apply, mapNormalToAgentsSdk: values['map-normal'] });
  // Migration diagnostics intentionally exclude the source configuration and secrets.
  process.stdout.write(JSON.stringify({ canActivate: result.canActivate, diagnostics: result.diagnostics, sourceHash: result.sourceHash, outputPath: result.outputPath, backupPath: result.backupPath }, null, 2) + '\n');
  if (result.config && values.database?.length) {
    const personasRaw: unknown = values['persona-bindings'] ? JSON.parse(await readFile(values['persona-bindings'], 'utf8')) : {};
    const sessionTypesRaw: unknown = values['memory-session-types'] ? JSON.parse(await readFile(values['memory-session-types'], 'utf8')) : {};
    const personaBindings = z.record(z.string(), z.string()).parse(personasRaw);
    const memorySessionTypes = z.record(z.string(), z.enum(['private', 'group'])).parse(sessionTypesRaw);
    if (values.apply) await mkdir(values.target, { recursive: true, mode: 0o700 });
    const store = new RuntimeStore(values.apply ? path.join(values.target, 'runtime.sqlite') : ':memory:');
    try {
      let config = result.config;
      for (const database of values.database) {
        const migrated = await importLegacyDatabase(database, store, config, { apply: values.apply, backupDirectory: path.join(values.target, 'backups'), personaBindings, memorySessionTypes });
        config = migrated.config;
        process.stdout.write(JSON.stringify({ database: path.basename(database), counts: migrated.counts, diagnostics: migrated.diagnostics, backupPath: migrated.backupPath }) + '\n');
      }
      if (values.apply) { const validation = validateConfiguration(config); if (validation.valid) store.publishConfig(config, store.getConfig()?.revision ?? 0); await writeFile(path.join(values.target, 'config.with-resources.json'), JSON.stringify(config, null, 2), { mode: 0o600 }); if (!validation.valid) process.exitCode = 1; }
    } finally { store.close(); }
  }
  if (!result.canActivate) process.exitCode = 1;
}
