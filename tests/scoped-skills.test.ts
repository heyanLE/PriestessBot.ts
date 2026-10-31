import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RunContext as SdkContext } from '@openai/agents';
import { z } from 'zod';
import { AgentDefinitionSchema, GrantSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type AgentDefinition, type EngineInput, type RunContext, type RunEvent, type RuntimeState } from '../packages/contracts/src/index.js';
import { AuthorizationService, KnowledgeService, MemoryService, RuntimeStore, conversationKey, historyKey } from '../packages/core/src/index.js';
import { buildAgentTools, type ToolServices } from '../packages/adapters/src/agents/tools.js';
import type { SdkLocalContext } from '../packages/adapters/src/agents/engine.js';
import { ExecutionService, type Authorize } from '../packages/adapters/src/execution/environment.js';
import { SkillResourceError, SkillResources, skillMetadata } from '../packages/adapters/src/resources/skills.js';

const skillTools = ['list_skills', 'read_skill', 'write_skill', 'delete_skill_file', 'read_file', 'list_files', 'write_file'];
function document(name = 'report', body = 'Generate the report.'): string { return `---\nname: ${name}\ndescription: Create a report from supplied data.\n---\n${body}\n`; }
class InterceptExecution extends ExecutionService {
  afterRead: ((name: string) => void | Promise<void>) | undefined;
  beforeWrite: ((name: string) => void | Promise<void>) | undefined;
  constructor(root: string, authorize: Authorize) { super({ id: 'workspace', backend: 'local', root }, authorize); }
  override async read(context: RunContext, name: string): Promise<string> { const content = await super.read(context, name); await this.afterRead?.(name); return content; }
  override async write(context: RunContext, name: string, content: string): Promise<void> { await this.beforeWrite?.(name); await super.write(context, name, content); }
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-scoped-skills-'));
  const legacy = path.join(root, 'legacy'); await mkdir(legacy);
  const store = new RuntimeStore(':memory:');
  const agent = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', resources: { tools: skillTools, skills: ['legacy'], executionEnvironment: 'workspace' } });
  const otherAgent = AgentDefinitionSchema.parse({ ...agent, id: 'other', displayName: 'Other' });
  const grants = [GrantSchema.parse({ platform: 'qq', senderIds: ['elite'], state: 'elite_operator' }), GrantSchema.parse({ platform: 'qq', senderIds: ['senior'], state: 'senior_operator' })];
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent, otherAgent], grants, skillLibraries: [{ id: 'legacy', directory: legacy }], flow: { routing: { defaultAgentId: agent.id, rules: [] } } });
  const auth = new AuthorizationService(grants, store);
  const execution = new InterceptExecution(path.join(root, 'execution'), (context, capability) => {
    const selected = config.agents.find(item => item.id === context.agentId); if (!selected) throw new Error('Unknown agent'); auth.assert(context, capability, selected);
  });
  const skills = new SkillResources(() => config, input => auth.assert(input.context, 'files.read', input.agent), id => id === 'workspace' ? execution : undefined);
  const events: RunEvent[] = [];
  const services: ToolServices = { store, auth, execution: id => id === 'workspace' ? execution : undefined, memory: new MemoryService(store, auth), knowledge: new KnowledgeService(store, auth), skills, delegate: () => Promise.reject(new Error('Unexpected delegation')), attachFile: () => Promise.reject(new Error('Unexpected attachment')) };
  const input = (options: { state?: RuntimeState; session?: string; platform?: string; sessionType?: 'private' | 'group'; agent?: AgentDefinition; generationAgentId?: AgentDefinition['id'] } = {}): EngineInput => {
    const selected = options.agent ?? agent; const sender = options.state === 'operator' ? 'ordinary' : options.state === 'senior_operator' ? 'senior' : 'elite';
    const message = MessageEventSchema.parse({ platform: options.platform ?? 'qq', platformType: 'napcat', sessionId: options.session ?? 'room', sessionType: options.sessionType ?? 'group', senderId: sender, botId: 'bot', messageId: randomUUID(), timestamp: Date.now(), parts: [{ type: 'text', text: 'Manage a skill' }] });
    const principal = { platform: message.platform, sessionId: message.sessionId, sessionType: message.sessionType, senderId: message.senderId };
    const context: RunContext = { ...auth.resolve(principal, selected), principal, runId: RunIdSchema.parse(randomUUID()), turnId: 'turn', agentId: selected.id, ...(options.generationAgentId === undefined ? {} : { generationAgentId: options.generationAgentId }), generation: store.generation(conversationKey(principal, options.generationAgentId ?? selected.id)), configRevision: 0, flowRevision: 0, signal: new AbortController().signal, budget: selected.budget, depth: 0 };
    return { agent: selected, context, message, additionalContext: '', session: { id: historyKey(context), engine: 'agents_sdk', version: '0.21.0' } };
  };
  const tools = (candidate: EngineInput) => buildAgentTools(candidate, services, event => events.push(event));
  const invoke = async (candidate: EngineInput, name: string, args: unknown): Promise<unknown> => {
    const selected = tools(candidate).find(item => item.name === name); assert.ok(selected?.type === 'function', `Missing tool ${name}`);
    return selected.invoke(new SdkContext<SdkLocalContext>({ runId: candidate.context.runId }), JSON.stringify(args));
  };
  return { root, legacy, store, agent, otherAgent, auth, grants, execution, skills, input, tools, invoke, events, close: async () => { execution.stop(); await execution.drain(); store.close(); await rm(root, { recursive: true, force: true }); } };
}
function json(value: unknown): unknown { if (typeof value !== 'string') throw new Error('Expected serialized result'); const parsed: unknown = JSON.parse(value); return parsed; }
const ErrorResult = z.object({ status: z.literal('failed'), error: z.object({ code: z.string(), message: z.string() }) });
const Entries = z.array(z.object({ name: z.string(), library: z.string(), path: z.string(), writable: z.boolean() }));

void test('skill tools create, discover, read, replace and delete isolated files through SDK arguments', async () => {
  const f = await fixture(); const input = f.input();
  try {
    assert.deepEqual(Entries.parse(json(await f.invoke(input, 'list_skills', { libraryId: null }))), []);
    const created = z.object({ library: z.literal('isolated'), path: z.literal('report/SKILL.md'), bytes: z.number() }).parse(json(await f.invoke(input, 'write_skill', { libraryId: 'isolated', path: 'report/SKILL.md', content: document() })));
    assert.equal(created.bytes, Buffer.byteLength(document()));
    const entries = Entries.parse(json(await f.invoke(input, 'list_skills', { libraryId: 'isolated' })));
    assert.deepEqual(entries, [{ name: 'report', library: 'isolated', path: 'report/SKILL.md', writable: true }]);
    assert.equal(await f.invoke(input, 'read_skill', { libraryId: 'isolated', path: entries[0]?.path }), document());
    const duplicate = ErrorResult.parse(json(await f.invoke(input, 'write_skill', { libraryId: 'isolated', path: 'report/SKILL.md', content: document('report', 'Replacement') })));
    assert.equal(duplicate.error.code, 'already_exists'); assert.equal(await f.skills.read(input, 'isolated', 'report/SKILL.md'), document());
    await f.invoke(input, 'write_skill', { libraryId: 'isolated', path: 'report/SKILL.md', content: document('report', 'Replacement'), overwrite: true });
    await f.invoke(input, 'write_skill', { libraryId: 'isolated', path: 'report/references/data.txt', content: 'Reference text' });
    await f.invoke(input, 'delete_skill_file', { libraryId: 'isolated', path: 'report/SKILL.md' });
    assert.deepEqual(await f.skills.list(input, 'isolated'), []);
    assert.equal(await f.skills.read(input, 'isolated', 'report/references/data.txt'), 'Reference text');
    assert.ok(f.events.some(event => event.type === 'tool' && event.name === 'write_skill' && event.status === 'failed'));
  } finally { await f.close(); }
});

void test('isolated skills follow conversation identity, Agent, parent generation and reset boundaries', async () => {
  const f = await fixture(); const first = f.input();
  try {
    await f.skills.write(first, 'isolated', 'report/SKILL.md', document());
    assert.equal(await f.skills.read(f.input({ state: 'senior_operator' }), 'isolated', 'report/SKILL.md'), document());
    assert.equal(await f.skills.read(f.input({ agent: f.otherAgent, generationAgentId: f.agent.id }), 'isolated', 'report/SKILL.md'), document());
    for (const other of [f.input({ session: 'other' }), f.input({ platform: 'other-platform' }), f.input({ sessionType: 'private' }), f.input({ agent: f.otherAgent })]) {
      assert.deepEqual(await f.skills.list(other, 'isolated'), []); await assert.rejects(f.skills.read(other, 'isolated', 'report/SKILL.md'));
    }
    f.store.reset(conversationKey(first.context.principal, first.agent.id));
    await assert.rejects(f.skills.read(first, 'isolated', 'report/SKILL.md'), /generation/);
    assert.deepEqual(await f.skills.list(f.input(), 'isolated'), []);
    assert.deepEqual(await f.skills.list(f.input({ agent: f.otherAgent, generationAgentId: f.agent.id }), 'isolated'), []);
  } finally { await f.close(); }
});

void test('shared skills are readable across conversations while ordinary and senior states cannot change them', async () => {
  const f = await fixture(); const elite = f.input();
  try {
    await f.skills.write(elite, 'shared', 'report/SKILL.md', document());
    for (const state of ['operator', 'senior_operator'] as const) {
      const reader = f.input({ state, session: 'other' });
      assert.equal(await f.skills.read(reader, 'shared', 'report/SKILL.md'), document());
      assert.equal((await f.skills.list(reader, 'shared'))[0]?.writable, false);
      await assert.rejects(f.skills.write(reader, 'shared', 'report/SKILL.md', document('report', 'Forbidden'), true), error => error instanceof SkillResourceError && error.code === 'forbidden');
      await assert.rejects(f.skills.deleteFile(reader, 'shared', 'report/SKILL.md'), error => error instanceof SkillResourceError && error.code === 'forbidden');
    }
    const senior = f.input({ state: 'senior_operator' });
    const manipulated: EngineInput = { ...senior, context: { ...senior.context, effectiveCapabilities: [...elite.context.effectiveCapabilities] } };
    await assert.rejects(f.skills.write(manipulated, 'shared', 'report/SKILL.md', document(), true), /elite_operator/);
    const forgedState: EngineInput = { ...manipulated, context: { ...manipulated.context, runtimeState: 'elite_operator' } };
    await assert.rejects(f.skills.write(forgedState, 'shared', 'report/SKILL.md', document(), true), /capability|forbidden|denied/i);
    await assert.rejects(f.skills.deleteFile(forgedState, 'shared', 'report/SKILL.md'), /capability|forbidden|denied/i);
    await f.skills.write(senior, 'isolated', 'report/SKILL.md', document('report', 'Private edits'));
    const ordinary = f.input({ state: 'operator' });
    assert.ok(!f.tools(ordinary).some(tool => ['write_skill', 'delete_skill_file'].includes(tool.name)));
    await assert.rejects(f.skills.write(ordinary, 'isolated', 'report/SKILL.md', document(), true), /cannot write/);
    f.store.reset(conversationKey(elite.context.principal, elite.agent.id));
    assert.equal(await f.skills.read(f.input({ session: 'other' }), 'shared', 'report/SKILL.md'), document());
    await f.skills.deleteFile(f.input(), 'shared', 'report/SKILL.md');
    assert.deepEqual(await f.skills.list(f.input({ session: 'other' }), 'shared'), []);
  } finally { await f.close(); }
});

void test('registered skill libraries stay readable and cannot be selected by mutation tools', async () => {
  const f = await fixture(); const input = f.input();
  try {
    await mkdir(path.join(f.legacy, 'legacy-report')); await writeFile(path.join(f.legacy, 'legacy-report', 'SKILL.md'), document('legacy-report'));
    const entries = await f.skills.list(input, 'legacy'); assert.equal(entries[0]?.writable, false);
    assert.equal(await f.skills.read(input, 'legacy', 'legacy-report/SKILL.md'), document('legacy-report'));
    await f.invoke(input, 'write_skill', { libraryId: 'legacy', path: 'legacy-report/SKILL.md', content: document('legacy-report', 'Forbidden'), overwrite: true });
    await f.invoke(input, 'delete_skill_file', { libraryId: 'legacy', path: 'legacy-report/SKILL.md' });
    assert.equal(await readFile(path.join(f.legacy, 'legacy-report', 'SKILL.md'), 'utf8'), document('legacy-report'));
    const unassigned: EngineInput = { ...input, context: { ...input.context, resources: { ...input.context.resources, skills: [] } } };
    await assert.rejects(f.skills.read(unassigned, 'legacy', 'legacy-report/SKILL.md'), /not assigned|not authorized/);
    assert.deepEqual(await f.skills.list(unassigned), []);
  } finally { await f.close(); }
});

void test('persona skill allowlist restricts discovery, reference reads, writes and deletion in every zone', async () => {
  const f = await fixture(); const input = f.input();
  try {
    for (const zone of ['isolated', 'shared'] as const) for (const name of ['allowed', 'denied']) await f.skills.write(input, zone, `${name}/SKILL.md`, document(name));
    const restricted: EngineInput = { ...input, agent: { ...input.agent, skillAllowlist: ['allowed'] } };
    assert.deepEqual((await f.skills.list(restricted)).map(entry => entry.name), ['allowed', 'allowed']);
    for (const zone of ['isolated', 'shared'] as const) {
      await assert.rejects(f.skills.read(restricted, zone, 'denied/SKILL.md'), /persona/);
      await assert.rejects(f.skills.write(restricted, zone, 'denied/notes.md', 'forbidden'), /persona/);
      await assert.rejects(f.skills.deleteFile(restricted, zone, 'denied/SKILL.md'), /persona/);
    }
    assert.deepEqual(await f.skills.list({ ...restricted, agent: { ...restricted.agent, skillAllowlist: [] } }), []);
  } finally { await f.close(); }
});

void test('skill paths reject traversal and cross-skill aliases with actionable tool failures', async () => {
  const f = await fixture(); const input = f.input();
  try {
    await f.skills.write(input, 'isolated', 'report/SKILL.md', document());
    for (const target of ['../report/SKILL.md', '/workspace/files/.agent/skill/report/SKILL.md', '.agent/skill/report/SKILL.md', 'report/../other/SKILL.md', 'report\\SKILL.md', 'report//SKILL.md']) {
      const failure = ErrorResult.parse(json(await f.invoke(input, 'read_skill', { libraryId: 'isolated', path: target })));
      assert.equal(failure.error.code, 'invalid_skill');
    }
    const absent = ErrorResult.parse(json(await f.invoke(input, 'read_skill', { libraryId: 'isolated', path: 'missing/SKILL.md' })));
    assert.equal(absent.error.code, 'not_found');
    await mkdir(path.join(f.legacy, 'allowed')); await mkdir(path.join(f.legacy, 'denied'));
    await writeFile(path.join(f.legacy, 'denied', 'SKILL.md'), document('denied'));
    await symlink(path.join(f.legacy, 'denied', 'SKILL.md'), path.join(f.legacy, 'allowed', 'alias.md'));
    await assert.rejects(f.skills.read(input, 'legacy', 'allowed/alias.md'), /another skill|persona/);
    const refused = ErrorResult.parse(json(await f.invoke(input, 'delete_skill_file', { libraryId: 'isolated', path: 'report' })));
    assert.equal(refused.error.code, 'invalid_skill');
    assert.equal(await f.skills.read(input, 'isolated', 'report/SKILL.md'), document());
  } finally { await f.close(); }
});

void test('new skill metadata must match the directory and have a valid non-empty description', async () => {
  const f = await fixture(); const input = f.input();
  try {
    const malformed = ['No frontmatter', document('wrong'), '---\nname: report\ndescription: "unclosed\n---\nBody', '---\nname: report\ndescription:\n---\nBody', '---\nname: report\ndescription:\nversion: 1\n---\nBody'];
    for (const content of malformed) await assert.rejects(f.skills.write(input, 'isolated', 'report/SKILL.md', content), error => error instanceof SkillResourceError && error.code === 'invalid_skill');
    assert.deepEqual(await f.skills.list(input, 'isolated'), []);
    const folded = '---\nname: report\ndescription: >-\n  Build reports from\n  supplied data.\n---\nBody';
    assert.equal(skillMetadata(folded, 'report').description, 'Build reports from supplied data.');
    await f.skills.write(input, 'isolated', 'report/SKILL.md', folded);
    await assert.rejects(f.skills.write(input, 'isolated', 'report/references/large.txt', '汉'.repeat(22000)), /64000/);
    await assert.rejects(f.skills.write(input, 'isolated', 'report/SKILL.md', document('report', '汉'.repeat(22000)), true), /64000/);
  } finally { await f.close(); }
});

void test('malformed entries cannot prevent discovery of other valid workspace skills', async () => {
  const f = await fixture(); const input = f.input();
  try {
    await f.skills.write(input, 'isolated', 'report/SKILL.md', document());
    await f.execution.write(input.context, '.agent/skill/broken/SKILL.md/child.txt', 'This makes SKILL.md a directory.');
    await f.execution.write(input.context, '.agent/skill/invalid/SKILL.md', 'Not a skill document');
    const entries = await f.skills.list(input, 'isolated');
    assert.deepEqual(entries.map(entry => entry.name), ['report']);
  } finally { await f.close(); }
});

void test('concurrent creation in the same conversation or shared zone never silently overwrites a skill', async () => {
  const f = await fixture();
  try {
    for (const zone of ['isolated', 'shared'] as const) {
      const first = f.input(); const other = f.input({ state: zone === 'isolated' ? 'senior_operator' : 'elite_operator', ...(zone === 'shared' ? { session: 'other' } : {}) });
      const outcomes = await Promise.allSettled([f.skills.write(first, zone, 'report/SKILL.md', document('report', 'First')), f.skills.write(other, zone, 'report/SKILL.md', document('report', 'Second'))]);
      assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
      const rejected = outcomes.find(item => item.status === 'rejected'); assert.ok(rejected?.status === 'rejected');
      const reason: unknown = rejected.reason; assert.ok(reason instanceof SkillResourceError && reason.code === 'already_exists');
      const saved = await f.skills.read(first, zone, 'report/SKILL.md'); assert.ok(saved === document('report', 'First') || saved === document('report', 'Second'));
    }
  } finally { await f.close(); }
});

void test('skill reads and writes recheck authorization after awaited operations', async () => {
  const f = await fixture();
  try {
    const input = f.input(); await f.skills.write(input, 'isolated', 'report/SKILL.md', document());
    f.execution.afterRead = () => { f.execution.afterRead = undefined; f.auth.replaceGrants(f.grants); };
    await assert.rejects(f.skills.read(input, 'isolated', 'report/SKILL.md'), /Authorization changed/);
    const fresh = f.input();
    f.execution.beforeWrite = () => { f.execution.beforeWrite = undefined; f.auth.replaceGrants(f.grants); };
    await assert.rejects(f.skills.write(fresh, 'isolated', 'report/new.txt', 'must not publish'), /Authorization changed/);
    await assert.rejects(f.skills.read(f.input(), 'isolated', 'report/new.txt'), /not found/);
  } finally { await f.close(); }
});

void test('queued skill writes cannot publish after their authorization is revoked', async () => {
  const f = await fixture(); const input = f.input(); let release = (): void => {};
  const gate = new Promise<void>(resolve => { release = resolve; }); let entered = (): void => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    f.execution.beforeWrite = async () => { entered(); await gate; };
    const first = f.skills.write(input, 'shared', 'report/SKILL.md', document()); await started;
    const queued = f.skills.write(input, 'shared', 'report/SKILL.md', document('report', 'Second'), true);
    f.auth.replaceGrants([]); release();
    const outcomes = await Promise.allSettled([first, queued]); assert.ok(outcomes.every(item => item.status === 'rejected'));
    assert.deepEqual(await f.skills.list(f.input({ state: 'operator' }), 'shared'), []);
  } finally { release(); await f.close(); }
});
