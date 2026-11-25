import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrateSharedToGlobal } from '../packages/adapters/src/execution/workspace-migrate.js';

await test('shared files move to global/file and skills to global/skill', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-migrate-shared-'));
  try {
    await mkdir(path.join(root, 'shared', '.agent', 'skill', 'report'), { recursive: true });
    await writeFile(path.join(root, 'shared', 'image.png'), 'image');
    await writeFile(path.join(root, 'shared', '.agent', 'skill', 'report', 'SKILL.md'), 'skill');
    const result = await migrateSharedToGlobal(root);
    assert.equal(await readFile(path.join(root, 'global', 'file', 'image.png'), 'utf8'), 'image');
    assert.equal(await readFile(path.join(root, 'global', 'skill', 'report', 'SKILL.md'), 'utf8'), 'skill');
    assert.equal(result.movedFiles, 1);
    assert.equal(result.movedDirectories, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

await test('migration refuses to overwrite an existing global file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-migrate-conflict-'));
  try {
    await mkdir(path.join(root, 'shared'), { recursive: true });
    await mkdir(path.join(root, 'global', 'file'), { recursive: true });
    await writeFile(path.join(root, 'shared', 'same.txt'), 'shared');
    await writeFile(path.join(root, 'global', 'file', 'same.txt'), 'global');
    await assert.rejects(migrateSharedToGlobal(root), /conflict/u);
    assert.equal(await readFile(path.join(root, 'global', 'file', 'same.txt'), 'utf8'), 'global');
    assert.equal(await readFile(path.join(root, 'shared', 'same.txt'), 'utf8'), 'shared');
  } finally { await rm(root, { recursive: true, force: true }); }
});
