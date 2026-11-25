import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentDefinitionSchema, BudgetSchema, MessageEventSchema, ResourceBindingsSchema, RunIdSchema, RuntimeConfigSchema, type AgentDefinition, type EngineInput, type RunContext, type RuntimeState } from '../packages/contracts/src/index.js';
import { ExecutionService, type Authorize } from '../packages/adapters/src/execution/environment.js';
import { SkillResources } from '../packages/adapters/src/resources/skills.js';

const document = (name = 'report', body = 'Generate the report.') => `---\nname: ${name}\ndescription: Create a report from supplied data.\n---\n${body}\n`;
const allow: Authorize = () => {};

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-skills-v2-'));
  const agent = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', resources: { executionEnvironment: 'workspace' } });
  const other = AgentDefinitionSchema.parse({ ...agent, id: 'researcher', displayName: 'Researcher' });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent, other], workspace: { root, sandbox: false }, flow: { routing: { defaultAgentId: agent.id, rules: [] } } });
  const service = new ExecutionService({ root, backend: 'local', id: 'workspace', layout: 'v2' }, allow);
  const skills = new SkillResources(() => config, input => { input.context.signal.throwIfAborted(); }, id => id === 'workspace' ? service : undefined);
  const input = (selected: AgentDefinition = agent, state: RuntimeState = 'elite_operator'): EngineInput => {
    const message = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionId: 'room-1', sessionType: 'group', senderId: 'alice', botId: 'bot', messageId: `${selected.id}-${state}`, timestamp: Date.now(), parts: [{ type: 'text', text: 'Skill test' }] });
    const principal = { platform: message.platform, sessionId: message.sessionId, sessionType: message.sessionType, senderId: message.senderId };
    const context: RunContext = { runId: RunIdSchema.parse(`${selected.id}-${state}`), turnId: 'turn', principal, agentId: selected.id, generation: 0, configRevision: 0, flowRevision: 0, runtimeState: state, effectiveCapabilities: ['chat', 'files.read', 'files.write', 'resources.manage'], resources: ResourceBindingsSchema.parse({ executionEnvironment: 'workspace' }), grantVersion: 0, signal: new AbortController().signal, budget: BudgetSchema.parse({}), depth: 0 };
    return { agent: selected, context, message, additionalContext: '', session: { id: 'session', engine: 'agents_sdk', version: '0.21.0' } };
  };
  return { root, agent, other, skills, input, close: async () => { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); } };
}

await test('v2 skill resources list and read global, agent and conversation zones', async () => {
  const f = await fixture(); const elite = f.input();
  try {
    await f.skills.write(elite, 'global', 'global-skill/SKILL.md', document('global-skill'));
    await f.skills.write(elite, 'agent', 'agent-skill/SKILL.md', document('agent-skill'));
    await f.skills.write(elite, 'conversation', 'conversation-skill/SKILL.md', document('conversation-skill'));
    const entries = await f.skills.list(elite);
    assert.deepEqual(entries.map(entry => [entry.library, entry.name, entry.writable]), [['global', 'global-skill', true], ['agent', 'agent-skill', true], ['conversation', 'conversation-skill', true]]);
    assert.equal(await f.skills.read(elite, 'global', 'global-skill/SKILL.md'), document('global-skill'));
    assert.equal(await f.skills.read(elite, 'agent', 'agent-skill/SKILL.md'), document('agent-skill'));
    assert.equal(await f.skills.read(elite, 'conversation', 'conversation-skill/SKILL.md'), document('conversation-skill'));
  } finally { await f.close(); }
});

await test('v2 conversation skills are shared by Agents in the same IM session', async () => {
  const f = await fixture(); const elite = f.input(); const other = f.input(f.other);
  try {
    await f.skills.write(elite, 'conversation', 'shared-skill/SKILL.md', document('shared-skill'));
    const entries = await f.skills.list(other, 'conversation');
    assert.deepEqual(entries.map(entry => [entry.library, entry.name]), [['conversation', 'shared-skill']]);
    assert.equal(await f.skills.read(other, 'conversation', 'shared-skill/SKILL.md'), document('shared-skill'));
    await f.skills.write(other, 'agent', 'other-agent-skill/SKILL.md', document('other-agent-skill'));
    assert.deepEqual((await f.skills.list(elite)).map(entry => entry.name), ['shared-skill']);
  } finally { await f.close(); }
});

await test('v2 skill writes require elite and resources.manage', async () => {
  const f = await fixture(); const operator = f.input(f.agent, 'operator');
  try {
    await assert.rejects(f.skills.write(operator, 'global', 'blocked/SKILL.md', document('blocked')), /Only elite_operator/u);
    await assert.rejects(f.skills.write(operator, 'conversation', 'blocked/SKILL.md', document('blocked')), /Only elite_operator/u);
  } finally { await f.close(); }
});
