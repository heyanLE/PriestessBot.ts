import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanupWorkspaceCaches } from '../packages/adapters/src/execution/workspace-cache.js';

const DAY = 24 * 60 * 60 * 1000;

async function oldFile(file: string, content = 'old'): Promise<void> {
  await writeFile(file, content);
  const date = new Date(Date.now() - 10 * DAY);
  await utimes(file, date, date);
}

await test('cache cleanup removes only expired files under cache directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-cache-'));
  try {
    const globalCache = path.join(root, 'global', 'cache'); await mkdir(globalCache, { recursive: true });
    const agentCache = path.join(root, 'agents', 'assistant', 'cache'); await mkdir(agentCache, { recursive: true });
    const conversationCache = path.join(root, 'conversations', 'qq', 'group', 'room', 'cache'); await mkdir(conversationCache, { recursive: true });
    const globalProtected = path.join(root, 'global', 'file'); await mkdir(globalProtected, { recursive: true });
    const nested = path.join(globalCache, 'nested'); await mkdir(nested);
    await oldFile(path.join(globalCache, 'old.txt'));
    await oldFile(path.join(agentCache, 'old.txt'));
    await oldFile(path.join(conversationCache, 'old.txt'));
    await oldFile(path.join(nested, 'old.txt'));
    await oldFile(path.join(globalProtected, 'keep.txt'));
    await writeFile(path.join(globalCache, 'fresh.txt'), 'fresh');
    const result = await cleanupWorkspaceCaches(root, { ttlMs: 7 * DAY });
    assert.equal(result.removedFiles, 4);
    assert.ok(result.removedBytes > 0);
    assert.equal(await readFile(path.join(globalCache, 'fresh.txt'), 'utf8'), 'fresh');
    assert.equal(await readFile(path.join(globalProtected, 'keep.txt'), 'utf8'), 'old');
    await assert.rejects(stat(path.join(globalCache, 'old.txt')), /ENOENT/u);
    await assert.rejects(stat(path.join(nested, 'old.txt')), /ENOENT/u);
    await assert.rejects(stat(nested), /ENOENT/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

await test('cache cleanup does not follow symlinks outside cache', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-cache-links-'));
  try {
    const cache = path.join(root, 'global', 'cache'); await mkdir(cache, { recursive: true });
    const outside = path.join(root, 'outside'); await mkdir(outside);
    await oldFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(path.join(outside, 'secret.txt'), path.join(cache, 'link.txt'));
    const result = await cleanupWorkspaceCaches(root, { ttlMs: 7 * DAY });
    assert.equal(result.removedFiles, 0);
    assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'secret');
  } finally { await rm(root, { recursive: true, force: true }); }
});
