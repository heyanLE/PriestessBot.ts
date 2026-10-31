import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionConfig } from '../execution/environment.js';

const SKILL_RELATIVE = 'resources/.agent/skill/skill-packager/SKILL.md';
const MAX_SKILL_BYTES = 64_000;
const pending = new Map<string, Promise<{ created: boolean; path: string }>>();

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
function validateEntry(content: string): void {
  const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(content)?.[1];
  if (Buffer.byteLength(content) > MAX_SKILL_BYTES || header === undefined || !/^name:[ \t]*(?:skill-packager|"skill-packager"|'skill-packager')[ \t]*$/mu.test(header) || !/^description:[ \t]*[^\s\r\n][^\r\n]*$/mu.test(header)) {
    throw new Error('The built-in skill has invalid frontmatter or exceeds the size limit.');
  }
}
async function builtinText(): Promise<string> {
  // Resolve from this module, never from a caller-controlled working directory.
  // Source modules live in packages/...; compiled modules live in dist/packages/....
  const root = new URL(import.meta.url.endsWith('.ts') ? '../../../../' : '../../../../../', import.meta.url);
  const asset = new URL(SKILL_RELATIVE, root);
  const info = await lstat(asset);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SKILL_BYTES) throw new Error('The packaged built-in skill must be a regular file.');
  const content = await readFile(asset, 'utf8');
  validateEntry(content);
  return content;
}
async function checkOwnedDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  const uid = process.getuid?.();
  if (!info.isDirectory() || info.isSymbolicLink() || (uid !== undefined && info.uid !== uid) || (info.mode & 0o022) !== 0) {
    throw new Error('The skill directory must be owned by the service account and must not allow writes by other accounts.');
  }
}
async function existingEntry(file: string): Promise<void> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    const uid = process.getuid?.();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_SKILL_BYTES || (uid !== undefined && info.uid !== uid) || (info.mode & 0o022) !== 0) {
      throw new Error('The existing built-in skill must be an owned, unlinked regular file with no writes by other accounts.');
    }
    validateEntry(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
async function seed(rootName: string): Promise<{ created: boolean; path: string }> {
  const content = await builtinText();
  // The configured parent is an administrative location. Canonicalize its OS
  // aliases (for example /tmp on macOS), then reject links at the owned root and below.
  await mkdir(path.dirname(rootName), { recursive: true, mode: 0o700 });
  const root = path.join(await realpath(path.dirname(rootName)), path.basename(rootName));
  let directory = root;
  for (const component of ['', 'shared', '.agent', 'skill', 'skill-packager']) {
    if (component) directory = path.join(directory, component);
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
    await checkOwnedDirectory(directory);
  }
  const file = path.join(directory, 'SKILL.md');
  let handle: FileHandle;
  try { handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
    await existingEntry(file);
    return { created: false, path: file };
  }
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  return { created: true, path: file };
}

/** Administrative startup only: call before accepting executions, never as a model tool. */
export async function seedBuiltinSkills(config: ExecutionConfig): Promise<{ created: boolean; path: string }> {
  const root = path.resolve(config.root);
  const previous = pending.get(root);
  const operation = previous ? previous.then(() => seed(root)) : seed(root);
  pending.set(root, operation);
  try { return await operation; }
  finally { if (pending.get(root) === operation) pending.delete(root); }
}
