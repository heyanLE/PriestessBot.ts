import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateWorkspaceZones } from '../tools/migrate-workspace-zones.js';

interface Owner { platform: string; type: 'group' | 'private'; session: string; sender: string; agent: string; generation: number; }
const owner: Owner = { platform: 'qq', type: 'private', session: 'private-session', sender: 'private-sender', agent: 'assistant', generation: 2 };
const digest = (items: readonly (string | number)[]): string => createHash('sha256').update(JSON.stringify(items)).digest('hex');
const oldHash = (item: Owner): string => digest([item.platform, item.type, item.session, item.sender, item.agent, item.generation]);
const newHash = (item: Owner): string => digest([item.platform, item.type, item.session, item.agent, item.generation]);
async function fixture(): Promise<{ directory: string; root: string; database: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'priestess-zone-migrate-')); const root = path.join(directory, 'execution'); await mkdir(root, { mode: 0o700 });
  const database = path.join(directory, 'runtime.sqlite'); const db = new DatabaseSync(database);
  try { db.exec('CREATE TABLE documents(namespace TEXT,id TEXT,value TEXT,PRIMARY KEY(namespace,id)); CREATE TABLE sessions(id TEXT PRIMARY KEY,generation INTEGER);'); }
  finally { db.close(); }
  return { directory, root, database };
}
function addRun(database: string, id: string, item: Owner, status = 'completed', parentRunId?: string): void {
  const db = new DatabaseSync(database);
  try { db.prepare('INSERT INTO documents VALUES(?,?,?)').run('runs', id, JSON.stringify({ id, sessionKey: parentRunId ? `child:${id}` : JSON.stringify([item.platform, item.type, item.session, item.agent]), senderId: item.sender, agentId: item.agent, generation: item.generation, status, ...(parentRunId ? { parentRunId } : {}), summary: 'DO_NOT_PRINT_CHAT_CONTENT' })); }
  finally { db.close(); }
}
async function oldFiles(root: string, item: Owner): Promise<string> {
  const directory = path.join(root, oldHash(item)); await mkdir(path.join(directory, 'nested'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, 'nested/report.txt'), 'original private file', { mode: 0o600 });
  return directory;
}

await test('workspace migration dry-run reads only metadata and does not alter task states or files', async () => {
  const f = await fixture();
  try {
    addRun(f.database, 'running', owner, 'running'); await oldFiles(f.root, owner);
    const before = await readFile(f.database);
    const report = await migrateWorkspaceZones({ database: f.database, root: f.root });
    assert.equal(report.applied, false); assert.equal(report.activeRuns, 1); assert.equal(report.privateCopiesPlanned, 1);
    assert.doesNotMatch(JSON.stringify(report), /DO_NOT_PRINT|private-session|private-sender/);
    assert.deepEqual(await readFile(f.database), before);
    assert.deepEqual(await readdir(f.root), [oldHash(owner)]);
    await assert.rejects(migrateWorkspaceZones({ database: f.database, root: f.root, apply: true }), /runtime-stopped/);
    await assert.rejects(migrateWorkspaceZones({ database: f.database, root: f.root, apply: true, runtimeStopped: true }), /Active or paused/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

await test('offline migration copies only unique private workspaces and retains original files and group scopes', async () => {
  const f = await fixture(); const group = { ...owner, type: 'group', session: 'group-session' } satisfies Owner;
  try {
    addRun(f.database, 'private', owner); addRun(f.database, 'group', group); await oldFiles(f.root, owner); await oldFiles(f.root, group);
    const before = await readFile(f.database);
    const report = await migrateWorkspaceZones({ database: f.database, root: f.root, apply: true, runtimeStopped: true });
    assert.equal(report.applied, true); assert.equal(report.privateCopiesCompleted, 1); assert.equal(report.retainedGroup, 1); assert.equal(report.failedCopies, 0); assert.ok(report.manifestPath);
    assert.equal(await readFile(path.join(f.root, oldHash(owner), 'nested/report.txt'), 'utf8'), 'original private file');
    assert.equal(await readFile(path.join(f.root, newHash(owner), 'nested/report.txt'), 'utf8'), 'original private file');
    assert.equal(await readFile(path.join(f.root, oldHash(group), 'nested/report.txt'), 'utf8'), 'original private file');
    await assert.rejects(lstat(path.join(f.root, newHash(group))), /ENOENT/);
    assert.equal((await lstat(report.manifestPath)).mode & 0o777, 0o600);
    assert.match(await readFile(report.manifestPath, 'utf8'), /retained_group/);
    assert.ok(report.manifestPath.startsWith(path.join(await realpath(f.root), '.workspace-zone-migrations')));
    assert.deepEqual(await readFile(f.database), before);
    await writeFile(path.join(f.root, newHash(owner), 'nested/report.txt'), 'new runtime data');
    const repeated = await migrateWorkspaceZones({ database: f.database, root: f.root, apply: true, runtimeStopped: true });
    assert.equal(repeated.privateCopiesCompleted, 0); assert.equal(repeated.retainedExisting, 1);
    assert.equal(await readFile(path.join(f.root, newHash(owner), 'nested/report.txt'), 'utf8'), 'new runtime data');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

await test('multiple senders or delegated source directories cannot silently merge into one private workspace', async () => {
  const f = await fixture(); const another = { ...owner, sender: 'different-sender' };
  try {
    addRun(f.database, 'first', owner); addRun(f.database, 'second', another); await oldFiles(f.root, owner); await oldFiles(f.root, another);
    const report = await migrateWorkspaceZones({ database: f.database, root: f.root, apply: true, runtimeStopped: true });
    assert.equal(report.retainedConflicts, 2); assert.equal(report.privateCopiesCompleted, 0);
    await assert.rejects(lstat(path.join(f.root, newHash(owner))), /ENOENT/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
  const delegated = await fixture(); const child = { ...owner, agent: 'researcher' };
  try {
    addRun(delegated.database, 'parent', owner); addRun(delegated.database, 'child', child, 'completed', 'parent'); await oldFiles(delegated.root, owner); await oldFiles(delegated.root, child);
    const report = await migrateWorkspaceZones({ database: delegated.database, root: delegated.root });
    assert.equal(report.retainedConflicts, 2); assert.equal(report.privateCopiesPlanned, 0);
  } finally { await rm(delegated.directory, { recursive: true, force: true }); }
});

await test('unsafe linked workspaces remain untouched and unknown hash directories stay unmapped', async () => {
  for (const kind of ['symlink', 'hardlink'] as const) {
    const f = await fixture();
    try {
      addRun(f.database, 'source', owner); const source = await oldFiles(f.root, owner);
      const outside = path.join(f.directory, 'outside.txt'); await writeFile(outside, 'outside data', { mode: 0o600 });
      if (kind === 'symlink') await symlink(outside, path.join(source, 'linked.txt'));
      else await link(outside, path.join(source, 'linked.txt'));
      await mkdir(path.join(f.root, 'f'.repeat(64)), { mode: 0o700 });
      const report = await migrateWorkspaceZones({ database: f.database, root: f.root, apply: true, runtimeStopped: true });
      assert.equal(report.retainedUnsafe, 1); assert.equal(report.unmappedDirectories, 1); assert.equal(report.privateCopiesCompleted, 0);
      assert.equal(await readFile(outside, 'utf8'), 'outside data'); await assert.rejects(lstat(path.join(f.root, newHash(owner))), /ENOENT/);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  }
});
