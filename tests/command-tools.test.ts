import assert from 'node:assert/strict';
import test from 'node:test';
import { RunContext as SdkContext } from '@openai/agents';
import { z } from 'zod';
import { AgentDefinitionSchema, GrantSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type EngineInput, type RunContext, type RuntimeState } from '../packages/contracts/src/index.js';
import { AuthorizationService, KnowledgeService, MemoryService, RuntimeStore, historyKey } from '../packages/core/src/index.js';
import { buildAgentTools } from '../packages/adapters/src/agents/tools.js';
import type { SdkLocalContext } from '../packages/adapters/src/agents/engine.js';
import { ExecutionService, type ProcessSnapshot } from '../packages/adapters/src/execution/environment.js';
import { SkillResources } from '../packages/adapters/src/resources/skills.js';

class RecordingExecution extends ExecutionService {
  readonly calls: string[] = [];
  constructor() { super({ backend: 'docker', root: '/unused-command-policy-workspace' }, () => undefined); }
  override execute(_context: RunContext, command: string): Promise<ProcessSnapshot> {
    this.calls.push(command);
    return Promise.resolve({ id: 'fixture-process', status: 'completed', output: 'fixture', offset: 7, truncated: false });
  }
}
function fixture(state: RuntimeState) {
  const store = new RuntimeStore(':memory:');
  const agent = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', resources: { tools: ['exec_command', 'write_stdin', 'process_poll', 'process_kill', 'process_read_output'], executionEnvironment: 'container' } });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], flow: { routing: { defaultAgentId: agent.id, rules: [] } } });
  const message = MessageEventSchema.parse({ platform: 'fixture', platformType: 'telegram', sessionId: 'room', sessionType: 'private', senderId: 'alice', botId: 'bot', messageId: 'message', timestamp: 1, parts: [{ type: 'text', text: 'Read the files' }] });
  const principal = { platform: message.platform, sessionId: message.sessionId, sessionType: message.sessionType, senderId: message.senderId };
  const auth = new AuthorizationService([GrantSchema.parse({ platform: message.platform, senderIds: [message.senderId], state })], store);
  const context: RunContext = { runId: RunIdSchema.parse('command-tool-run'), turnId: 'turn', principal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...auth.resolve(principal, agent), signal: new AbortController().signal, budget: agent.budget, depth: 0 };
  const input: EngineInput = { agent, context, message, additionalContext: '', session: { id: historyKey(context), engine: 'agents_sdk', version: '0.21.0' } };
  const execution = new RecordingExecution();
  const tools = buildAgentTools(input, { store, auth, execution: () => execution, memory: new MemoryService(store, auth), knowledge: new KnowledgeService(store, auth), skills: new SkillResources(() => config, () => undefined), delegate: () => Promise.reject(new Error('Unexpected delegation')), attachFile: () => Promise.reject(new Error('Unexpected attachment')) }, () => undefined);
  const commandTool = tools.find(item => item.name === 'exec_command');
  assert.ok(commandTool?.type === 'function');
  const invoke = (cmd: string) => commandTool.invoke(new SdkContext<SdkLocalContext>({ runId: context.runId }), JSON.stringify({ cmd }));
  return { store, context, execution, tools, commandTool, invoke };
}
function denied(value: unknown): string {
  assert.equal(typeof value, 'string');
  if (typeof value !== 'string') throw new Error('Expected serialized result');
  const parsed: unknown = JSON.parse(value);
  return z.object({ status: z.literal('failed'), error: z.object({ code: z.string() }) }).parse(parsed).error.code;
}

void test('ordinary operators receive read execution tools and supported syntax without interactive shell input', async () => {
  const f = fixture('operator');
  try {
    assert.ok(f.context.effectiveCapabilities.includes('process.execute.restricted'));
    assert.ok(!f.context.effectiveCapabilities.includes('process.execute'));
    assert.ok(!f.tools.some(tool => tool.name === 'write_stdin'));
    assert.match(f.commandTool.description, /grep \[-F\]/);
    assert.doesNotMatch(f.commandTool.description, /curl "https/);
    await f.invoke('head -n 20 notes.txt');
    for (const command of ['touch notes.txt', 'curl https://example.com -o file', 'python -c "print(1)"', 'cat notes.txt | sh', 'cat ../secret', 'find . -exec sh {}']) {
      assert.equal(denied(await f.invoke(command)), 'command_not_allowed');
    }
    assert.deepEqual(f.execution.calls, ['head -n 20 notes.txt']);
  } finally { f.store.close(); }
});

void test('senior operators may organize files and request bounded downloads but never launch scripts or shell syntax', async () => {
  const f = fixture('senior_operator');
  try {
    const commands = ['mkdir -p reports', 'cp notes.txt reports/notes.txt', 'curl "https://example.com/file" -o reports/file'];
    for (const command of commands) await f.invoke(command);
    for (const command of ['rm notes.txt', 'node task.js', 'curl -K config', 'curl https://example.com -o ../../file', 'touch notes.txt && sh script.sh']) assert.equal(denied(await f.invoke(command)), 'command_not_allowed');
    assert.deepEqual(f.execution.calls, commands);
    assert.ok(!f.tools.some(tool => tool.name === 'write_stdin'));
  } finally { f.store.close(); }
});

void test('elite operators preserve full shell and interactive tools', async () => {
  const f = fixture('elite_operator');
  try {
    const command = 'printf hello | cat > file; node task.js';
    await f.invoke(command);
    assert.deepEqual(f.execution.calls, [command]);
    assert.ok(f.tools.some(tool => tool.name === 'write_stdin'));
    assert.match(f.commandTool.description, /Full shell/);
  } finally { f.store.close(); }
});
