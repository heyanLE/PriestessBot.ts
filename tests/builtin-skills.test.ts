import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seedBuiltinSkills } from '../packages/adapters/src/resources/builtin-skills.js';

const installedRelative = 'shared/.agent/skill/skill-packager/SKILL.md';
async function fixture(): Promise<string> { return realpath(await mkdtemp(path.join(tmpdir(), 'priestess-builtin-skills-'))); }

await test('startup installs the packaged skill once and preserves valid operator edits', async () => {
  const directory = await fixture();
  const root = path.join(directory, 'workspaces');
  try {
    const first = await seedBuiltinSkills({ root, backend: 'sdk_docker' });
    assert.equal(first.created, true);
    assert.equal(first.path, path.join(root, installedRelative));
    assert.equal(await readFile(first.path, 'utf8'), await readFile(new URL('../resources/.agent/skill/skill-packager/SKILL.md', import.meta.url), 'utf8'));
    assert.equal((await lstat(first.path)).mode & 0o777, 0o600);
    const custom = '---\ndescription: Custom skill packaging process.\nname: "skill-packager"\n---\n\nKeep this operator edit.\n';
    await writeFile(first.path, custom);
    const second = await seedBuiltinSkills({ root, backend: 'sdk_docker' });
    assert.equal(second.created, false);
    assert.equal(await readFile(second.path, 'utf8'), custom);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test('concurrent startup calls cannot replace or duplicate the package', async () => {
  const directory = await fixture();
  try {
    const results = await Promise.all(Array.from({ length: 4 }, () => seedBuiltinSkills({ root: directory, backend: 'sdk_docker' })));
    assert.equal(results.filter(result => result.created).length, 1);
    assert.deepEqual(await readdir(path.dirname(results[0]?.path ?? 'missing-result')), ['SKILL.md']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test('startup refuses linked roots, intermediate directories and skill files without writing outside', async () => {
  for (const location of ['', 'shared', 'shared/.agent', 'shared/.agent/skill', 'shared/.agent/skill/skill-packager', installedRelative]) {
    const directory = await fixture();
    const root = path.join(directory, 'workspaces');
    const outside = path.join(directory, 'outside');
    try {
      await mkdir(outside);
      const linkPath = path.join(root, location);
      await mkdir(path.dirname(linkPath), { recursive: true, mode: 0o700 });
      if (location === installedRelative) {
        await writeFile(path.join(outside, 'SKILL.md'), 'Do not replace');
        await symlink(path.join(outside, 'SKILL.md'), linkPath);
      } else await symlink(outside, linkPath);
      await assert.rejects(seedBuiltinSkills({ root, backend: 'sdk_docker' }));
      assert.deepEqual(await readdir(outside), location === installedRelative ? ['SKILL.md'] : []);
      if (location === installedRelative) assert.equal(await readFile(path.join(outside, 'SKILL.md'), 'utf8'), 'Do not replace');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

await test('startup rejects invalid, writable-by-others and hard-linked existing packages without overwriting them', async () => {
  const directory = await fixture();
  try {
    const config = { root: directory, backend: 'sdk_docker' } satisfies Parameters<typeof seedBuiltinSkills>[0];
    const installed = await seedBuiltinSkills(config);
    const original = await readFile(installed.path, 'utf8');
    await writeFile(installed.path, 'broken skill');
    await assert.rejects(seedBuiltinSkills(config), /frontmatter/);
    assert.equal(await readFile(installed.path, 'utf8'), 'broken skill');
    const emptyDescription = '---\ndescription:\nname: skill-packager\n---\n\nInvalid entry.\n';
    await writeFile(installed.path, emptyDescription);
    await assert.rejects(seedBuiltinSkills(config), /frontmatter/);
    assert.equal(await readFile(installed.path, 'utf8'), emptyDescription);
    await writeFile(installed.path, original);
    await chmod(installed.path, 0o666);
    await assert.rejects(seedBuiltinSkills(config), /owned, unlinked regular file/);
    await chmod(installed.path, 0o600);
    const linked = path.join(directory, 'linked-skill.md');
    await link(installed.path, linked);
    await assert.rejects(seedBuiltinSkills(config), /owned, unlinked regular file/);
    assert.equal(await readFile(linked, 'utf8'), original);
    await rm(linked);
    await chmod(path.join(directory, 'shared'), 0o777);
    await assert.rejects(seedBuiltinSkills(config), /skill directory/);
    assert.equal(await readFile(installed.path, 'utf8'), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
