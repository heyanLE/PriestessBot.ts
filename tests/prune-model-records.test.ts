import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import { pruneModelRecords } from '../tools/prune-model-records.js';
import { RuntimeStore } from '../packages/core/src/storage.js';

const DAY = 86_400;

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'prune-records-'));
  const records = join(directory, 'model-records');
  await writeFile(join(directory, 'placeholder'), '');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(records, { recursive: true });
  const store = new RuntimeStore(join(directory, 'runtime.sqlite'));
  const now = Date.now() / 1000;
  for (const [id, ageDays, size] of [['old-1', 10, 100], ['old-2', 8, 200], ['edge-7', 6, 300], ['new-1', 2, 400]] as const) {
    await writeFile(join(records, `${id}.body`), 'x'.repeat(size));
    await utimes(join(records, `${id}.body`), now - ageDays * DAY, now - ageDays * DAY);
    store.put('model-payload-documents', id, { id, runId: 'r', status: 'complete', bytes: size, createdAt: 1, updatedAt: 1 });
  }
  // A row whose file is already gone, e.g. after a manual delete.
  store.put('model-payload-documents', 'gone', { id: 'gone', runId: 'r', status: 'complete', bytes: 1, createdAt: 1, updatedAt: 1 });
  store.close();
  return { directory, records, database: join(directory, 'runtime.sqlite') };
}

void test('dry run reports stale files without touching disk or rows', async () => {
  const fixture = await setup();
  try {
    const report = await pruneModelRecords({ database: fixture.database, records: fixture.records, keepDays: 7 });
    assert.equal(report.applied, false);
    assert.equal(report.files, 2);
    assert.equal(report.bytes, 300);
    assert.equal(report.rows, 2);
    assert.equal(report.kept, 2);
    assert.equal(report.keptBytes, 700);
    assert.equal(report.orphans, 1);
    assert.equal((await readdir(fixture.records)).length, 4);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

void test('apply deletes stale bodies and their rows, keeps recent ones', async () => {
  const fixture = await setup();
  try {
    const report = await pruneModelRecords({ database: fixture.database, records: fixture.records, keepDays: 7, apply: true });
    assert.equal(report.applied, true);
    assert.equal(report.files, 2);
    assert.equal(report.rows, 2);
    assert.equal(report.failed, 0);
    assert.deepEqual((await readdir(fixture.records)).sort(), ['edge-7.body', 'new-1.body']);
    const store = new RuntimeStore(fixture.database);
    try {
      const ids = store.list('model-payload-documents', z.object({ id: z.string() })).map(row => row.id).sort();
      assert.deepEqual(ids, ['edge-7', 'gone', 'new-1']);
    } finally { store.close(); }
    // Second run is a no-op for the same cutoff.
    const again = await pruneModelRecords({ database: fixture.database, records: fixture.records, keepDays: 7, apply: true });
    assert.equal(again.files, 0);
    assert.equal(again.rows, 0);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});
