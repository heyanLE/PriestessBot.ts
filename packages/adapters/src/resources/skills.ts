import { readFile, realpath, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { EngineInput, RunContext, RuntimeConfig } from '../../../contracts/src/index.js';
import type { ExecutionBackend } from '../execution/environment.js';
import { WorkspacePathError } from '../execution/workspace-zones.js';
import { canWriteWorkspace, workspaceLocation } from '../execution/workspace-layout.js';
import { directoryVersion } from '../execution/directory-version.js';

export type SkillZone = 'isolated' | 'shared' | 'global' | 'agent' | 'conversation';
const V2_ZONES = ['global', 'agent', 'conversation'] as const;
const LEGACY_ZONES = ['isolated', 'shared'] as const;
export interface SkillEntry { name: string; library: string; path: string; description: string; writable: boolean; }
interface CachedCatalog { readonly version: string; readonly entries: readonly SkillEntry[]; }
export class SkillResourceError extends Error {
  constructor(readonly code: 'invalid_skill' | 'not_found' | 'forbidden' | 'already_exists' | 'unavailable', message: string) { super(message); this.name = 'SkillResourceError'; }
}
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'not_found');
function reference(relative: string): { name: string; relative: string } {
  const parts = relative.split('/'); const name = parts[0];
  if (!name || name.length > 64 || !namePattern.test(name) || relative.length > 1000 || relative.includes('\\') || relative.includes('\0') || parts.some(part => !part || part === '.' || part === '..')) {
    throw new SkillResourceError('invalid_skill', 'Use a skill-relative path such as report/SKILL.md. Do not include .agent/skill or an absolute path.');
  }
  return { name, relative };
}
/** Parse the small metadata subset used for discovery. Bodies and references stay opaque text. */
export function skillMetadata(content: string, name: string): { name: string; description: string } {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)?.[1];
  if (header === undefined || Buffer.byteLength(content) > 64_000) throw new SkillResourceError('invalid_skill', 'SKILL.md must start with YAML name and description. The file limit is 64000 bytes.');
  const field = (key: string): string => {
    const value = new RegExp(`^${key}:[\\t ]*(.*)$`, 'mu').exec(header)?.[1]?.trim() ?? '';
    if (value.startsWith('"')) { try { const parsed: unknown = JSON.parse(value); return typeof parsed === 'string' ? parsed : ''; } catch { return ''; } }
    if (value.startsWith("'")) return value.endsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : '';
    if (/^[>|][-+]?$/u.test(value)) {
      const lines = header.split(/\r?\n/u); const start = lines.findIndex(line => line.startsWith(`${key}:`)); const body: string[] = [];
      for (const line of lines.slice(start + 1)) { if (line && !/^\s/u.test(line)) break; body.push(line.trim()); }
      return body.join(' ').trim();
    }
    return value;
  };
  const declaredName = field('name'); const description = field('description');
  if (declaredName !== name || !description || description.length > 4000) throw new SkillResourceError('invalid_skill', 'Set name to the skill folder name. Set description to a non-empty text of at most 4000 characters.');
  return { name, description };
}

export class SkillResources {
  private readonly writes = new Map<string, Promise<void>>();
  private readonly catalogs = new WeakMap<RunContext, Map<string, CachedCatalog>>();
  constructor(private readonly config: () => RuntimeConfig, private readonly assertCurrent: (input: EngineInput) => void, private readonly execution?: (id: string) => ExecutionBackend | undefined, private readonly pluginLibraries: (input: EngineInput) => readonly { id: string; directory: string }[] = () => []) {}
  private isV2(): boolean { return this.config().workspace !== undefined; }
  private zones(): readonly SkillZone[] { return this.isV2() ? V2_ZONES : LEGACY_ZONES; }
  private zoneRoot(input: EngineInput, zone: SkillZone): string {
    if (this.isV2()) { if (zone === 'global' || zone === 'agent' || zone === 'conversation') return workspaceLocation(input.context, zone, 'skill').virtualPath; throw new SkillResourceError('forbidden', 'This skill zone is not available in workspace v2.'); }
    return zone === 'shared' ? '/workspace/shared/.agent/skill' : '.agent/skill';
  }
  private isZone(zone: string): zone is SkillZone { return this.zones().some(item => item === zone); }
  private libraries(input: EngineInput) {
    const plugins = this.pluginLibraries(input);
    return [...this.config().skillLibraries.filter(item => input.context.resources.skills.includes(item.id) && !plugins.some(plugin => plugin.id === item.id)), ...plugins];
  }
  private allow(input: EngineInput, name: string): void {
    this.assertCurrent(input);
    if (input.agent.skillAllowlist !== null && !input.agent.skillAllowlist.includes(name)) throw new SkillResourceError('forbidden', 'The current persona does not allow this skill. Select a skill from list_skills.');
  }
  private backend(input: EngineInput): ExecutionBackend {
    const backend = this.execution?.(input.context.resources.executionEnvironment);
    if (!backend) throw new SkillResourceError('unavailable', 'No execution environment is assigned. Select an assigned library or configure an execution environment.');
    return backend;
  }
  private writable(input: EngineInput, library: string): boolean {
    if (this.isV2()) return (library === 'global' || library === 'agent' || library === 'conversation') && this.isZone(library) && canWriteWorkspace(input.context, library, 'skill');
    return (library === 'isolated' || (library === 'shared' && input.context.runtimeState === 'elite_operator' && input.context.effectiveCapabilities.includes('resources.manage'))) && input.context.effectiveCapabilities.includes('files.write');
  }
  release(context: RunContext): void { this.catalogs.delete(context); }
  private async catalogVersion(input: EngineInput, library: string, directory: string | undefined): Promise<string | undefined> {
    this.assertCurrent(input);
    if (this.isZone(library)) {
      const backend = this.backend(input);
      return backend.directoryVersion?.(input.context, this.zoneRoot(input, library), 'SKILL.md');
    }
    if (directory === undefined) return undefined;
    try { return await directoryVersion(await realpath(directory), 'SKILL.md'); }
    catch (error) { if (missing(error)) return 'missing-library'; throw error; }
  }
  private async discover(input: EngineInput, library: string, directory: string | undefined): Promise<{ entries: SkillEntry[]; cacheable: boolean }> {
    let names: string[];
    try {
      if (this.isZone(library)) names = await this.backend(input).listFiles(input.context, this.zoneRoot(input, library));
      else if (directory !== undefined) names = await readdir(await realpath(directory));
      else return { entries: [], cacheable: true };
    } catch (error) { if (missing(error)) return { entries: [], cacheable: true }; throw error; }
    const entries: SkillEntry[] = [];
    let cacheable = true;
    for (const name of names.slice(0, 100)) {
      try {
        const skillPath = `${name}/SKILL.md`;
        const text = await this.read(input, library, skillPath);
        const metadata = this.isZone(library)
          ? skillMetadata(text, name)
          : { name, description: /^description:\s*(.+)$/mu.exec(text)?.[1] ?? text.split('\n').find(line => line.trim().length > 0) ?? '' };
        entries.push({ ...metadata, description: metadata.description.slice(0, 300), library, path: skillPath, writable: this.writable(input, library) });
      } catch (error) {
        if (error instanceof WorkspacePathError && error.code === 'file_unavailable') cacheable = false;
        if (error instanceof SkillResourceError || missing(error) || (error instanceof WorkspacePathError && ['invalid_path', 'size_limit', 'file_unavailable'].includes(error.code))) continue;
        throw error;
      }
    }
    return { entries, cacheable };
  }
  async list(input: EngineInput, libraryId?: string): Promise<SkillEntry[]> {
    this.assertCurrent(input);
    const libraries = this.libraries(input);
    if (libraryId && !this.isZone(libraryId) && !libraries.some(item => item.id === libraryId)) throw new SkillResourceError('forbidden', 'The skill library is not assigned. Use a library from list_skills.');
    const sources = [...(this.execution?.(input.context.resources.executionEnvironment) ? this.zones() : []), ...libraries.map(item => item.id)];
    let cache = this.catalogs.get(input.context);
    if (cache === undefined) { cache = new Map(); this.catalogs.set(input.context, cache); }
    const result: SkillEntry[] = [];
    for (const library of sources.filter(id => libraryId === undefined || id === libraryId)) {
      const directory = libraries.find(item => item.id === library)?.directory;
      const key = JSON.stringify([input.agent.id, input.agent.skillAllowlist, input.context.runtimeState, input.context.effectiveCapabilities, library, directory]);
      const version = await this.catalogVersion(input, library, directory);
      this.assertCurrent(input);
      const saved = cache.get(key);
      if (version !== undefined && saved?.version === version) {
        result.push(...saved.entries.map(entry => ({ ...entry })));
        continue;
      }
      const { entries, cacheable } = await this.discover(input, library, directory);
      this.assertCurrent(input);
      // Concurrent edits must not cache a catalog assembled from different versions.
      const after = version === undefined ? undefined : await this.catalogVersion(input, library, directory);
      this.assertCurrent(input);
      if (cacheable && version !== undefined && version === after) cache.set(key, { version, entries });
      else cache.delete(key);
      result.push(...entries.map(entry => ({ ...entry })));
    }
    this.assertCurrent(input);
    return result;
  }
  async read(input: EngineInput, libraryId: string, relative: string): Promise<string> {
    const ref = reference(relative); this.allow(input, ref.name);
    if (this.isZone(libraryId)) {
      const content = await this.backend(input).read(input.context, `${this.zoneRoot(input, libraryId)}/${ref.relative}`);
      if (Buffer.byteLength(content) > 64_000) throw new SkillResourceError('invalid_skill', 'The skill file exceeds 64000 bytes. Split large references into smaller files.');
      this.assertCurrent(input); return content;
    }
    if (!this.libraries(input).some(item => item.id === libraryId)) throw new SkillResourceError('forbidden', 'The skill library is not authorized. Use list_skills to select an assigned library.');
    const library = this.libraries(input).find(item => item.id === libraryId);
    if (!library) throw new SkillResourceError('not_found', 'The skill library no longer exists. Call list_skills again.');
    try {
      const root = await realpath(library.directory); const file = await realpath(path.resolve(root, ref.relative));
      if (!file.startsWith(root + path.sep)) throw new SkillResourceError('forbidden', 'The skill reference leaves its assigned library.');
      const resolvedName = path.relative(root, file).split(path.sep)[0]; if (resolvedName !== ref.name) throw new SkillResourceError('forbidden', 'A skill reference cannot point to another skill or bypass the persona allowlist.');
      const info = await stat(file);
      if (info.isDirectory()) { const entries = (await readdir(file)).slice(0, 200).join('\n'); this.assertCurrent(input); return entries; }
      if (!info.isFile() || info.size > 64_000) throw new SkillResourceError('invalid_skill', 'Read a regular skill file of at most 64000 bytes.');
      const content = await readFile(file, 'utf8'); this.assertCurrent(input); if (!this.libraries(input).some(item => item.id === libraryId)) throw new SkillResourceError('forbidden', 'Skill plugin disabled during read'); return content;
    } catch (error) { if (missing(error)) throw new SkillResourceError('not_found', 'The skill file does not exist. Use the exact library and path from list_skills.'); throw error; }
  }
  private async mutation<T>(input: EngineInput, zone: SkillZone, relative: string, action: (backend: ExecutionBackend, target: string) => Promise<T>): Promise<T> {
    const ref = reference(relative); this.allow(input, ref.name);
    if (relative.split('/').length < 2) throw new SkillResourceError('invalid_skill', 'Specify one file inside a skill folder, such as report/SKILL.md.');
    if (!this.writable(input, zone)) throw new SkillResourceError('forbidden', this.isV2() ? 'Only elite_operator with resources.manage can write skill files.' : zone === 'shared' ? 'Only elite_operator can write shared skills. Use isolated if your state allows file writes.' : 'This runtime state cannot write skills. Read an existing skill.');
    const backend = this.backend(input); const target = `${this.zoneRoot(input, zone)}/${relative}`;
    const sharedScope = this.isV2() ? zone === 'conversation' || zone === 'global' : zone === 'shared';
    const ownerScope = sharedScope ? null : [input.context.principal.platform, input.context.principal.sessionType, input.context.principal.sessionId, input.context.generationAgentId ?? input.context.agentId, input.context.generation];
    const key = JSON.stringify([backend.config.root, zone, ownerScope, relative]);
    const previous = this.writes.get(key) ?? Promise.resolve(); let release = (): void => {};
    const current = new Promise<void>(resolve => { release = resolve; }); this.writes.set(key, current); await previous;
    try { this.assertCurrent(input); const result = await action(backend, target); this.assertCurrent(input); return result; }
    finally { release(); if (this.writes.get(key) === current) this.writes.delete(key); }
  }
  async write(input: EngineInput, zone: SkillZone, relative: string, content: string, overwrite = false): Promise<{ library: SkillZone; path: string; bytes: number }> {
    const ref = reference(relative);
    if (Buffer.byteLength(content) > 64_000) throw new SkillResourceError('invalid_skill', 'The skill file exceeds 64000 bytes. Split large references into smaller files.');
    if (relative === `${ref.name}/SKILL.md`) skillMetadata(content, ref.name);
    return this.mutation(input, zone, relative, async (backend, target) => {
      if (!overwrite) { let exists = true; try { await backend.read(input.context, target); } catch (error) { if (missing(error)) exists = false; else throw error; } if (exists) throw new SkillResourceError('already_exists', 'The skill file exists. Read it first. Set overwrite=true only to replace that file.'); }
      await backend.write(input.context, target, content); return { library: zone, path: relative, bytes: Buffer.byteLength(content) };
    });
  }
  async deleteFile(input: EngineInput, zone: SkillZone, relative: string): Promise<{ library: SkillZone; path: string; deleted: true }> {
    return this.mutation(input, zone, relative, async (backend, target) => {
      if (!backend.removeFile) throw new SkillResourceError('unavailable', 'This execution backend cannot delete skill files.');
      await backend.removeFile(input.context, target); return { library: zone, path: relative, deleted: true };
    });
  }
}
