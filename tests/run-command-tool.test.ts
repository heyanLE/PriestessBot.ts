import assert from 'node:assert/strict';
import test from 'node:test';
import { RunContext as SdkContext } from '@openai/agents';
import { AgentDefinitionSchema, BudgetSchema, GrantSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type EngineInput, type RunContext } from '../packages/contracts/src/index.js';
import { AuthorizationService, KnowledgeService, MemoryService, RuntimeStore, textReply } from '../packages/core/src/index.js';
import { buildAgentTools, type ToolServices } from '../packages/adapters/src/agents/tools.js';
import { SkillResources } from '../packages/adapters/src/resources/skills.js';
import type { SdkLocalContext } from '../packages/adapters/src/agents/engine.js';

function fixture(commands?: ToolServices['commands']) {
  const store = new RuntimeStore(':memory:');
  const agent = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', capabilities: ['chat'], resources: { tools: ['run_command'] } });
  const grant = GrantSchema.parse({ platform: 'qq', senderIds: ['alice'], state: 'operator' });
  const auth = new AuthorizationService([grant], store);
  const message = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionId: 'room', sessionType: 'private', senderId: 'alice', botId: 'bot', messageId: 'message', timestamp: 1, parts: [{ type: 'text', text: 'command' }] });
  const principal = { platform: message.platform, sessionId: message.sessionId, sessionType: message.sessionType, senderId: message.senderId };
  const context: RunContext = { runId: RunIdSchema.parse('command-run'), turnId: 'turn', principal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(principal, agent), signal: new AbortController().signal, budget: BudgetSchema.parse({}), depth: 0 };
  const input: EngineInput = { agent, context, message, additionalContext: '', session: { engine: 'agents_sdk', version: '0.21.0', id: 'session' } };
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], flow: { routing: { defaultAgentId: agent.id, rules: [] } } });
  const memory = new MemoryService(store, auth); const knowledge = new KnowledgeService(store, auth);
  const skills = new SkillResources(() => config, () => { }, () => undefined);
  const services: ToolServices = { store, auth, memory, knowledge, skills, execution: () => undefined, delegate: () => Promise.reject(new Error('unexpected')), attachFile: () => Promise.reject(new Error('unexpected')), ...(commands === undefined ? {} : { commands }) };
  return { store, agent, context, input, services };
}

await test('run_command tool invokes the command service and returns its structured outcome', async () => {
  const calls: string[] = [];
  const f = fixture({ run: (_input, command) => { calls.push(command); return Promise.resolve({ status: 'handled', reply: textReply(`executed ${command}`) }); } });
  try {
    const tool = buildAgentTools(f.input, f.services, () => undefined).find(entry => entry.name === 'run_command');
    assert.ok(tool?.type === 'function');
    const output: unknown = await tool.invoke(new SdkContext<SdkLocalContext>({ runId: f.context.runId }), JSON.stringify({ command: 'state' }));
    assert.deepEqual(calls, ['state']);
    assert.match(String(output), /executed state/u);
  } finally { f.store.close(); }
});

await test('run_command is absent when the Agent does not have the tool or command service', () => {
  const f = fixture();
  try {
    assert.equal(buildAgentTools(f.input, f.services, () => undefined).some(entry => entry.name === 'run_command'), false);
  } finally { f.store.close(); }
});
