import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentDefinitionSchema, BudgetSchema, GrantSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, type EngineInput, type RunContext } from '../packages/contracts/src/index.js';
import { PriestessRuntime } from '../apps/server/src/runtime.js';

await test('runtime runToolCommand dispatches builtins and blocks control commands', async () => {
  const agent = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', capabilities: ['chat'], resources: { tools: ['run_command'] } });
  const grant = GrantSchema.parse({ platform: 'qq', senderIds: ['alice'], state: 'operator' });
  const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], grants: [grant], flow: { routing: { defaultAgentId: 'assistant', rules: [] } } });
  const runtime = new PriestessRuntime({ database: ':memory:', config });
  try {
    const message = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionId: 'room', sessionType: 'private', senderId: 'alice', botId: 'bot', messageId: 'message', timestamp: 1, parts: [{ type: 'text', text: 'command' }] });
    const principal = { platform: message.platform, sessionId: message.sessionId, sessionType: message.sessionType, senderId: message.senderId };
    const authorized = runtime.auth.resolve(principal, agent);
    const context: RunContext = { runId: RunIdSchema.parse('runtime-command'), turnId: 'turn', principal, agentId: agent.id, generation: 0, configRevision: 0, flowRevision: 0, ...authorized, signal: new AbortController().signal, budget: BudgetSchema.parse({}), depth: 0 };
    const input: EngineInput = { agent, context, message, additionalContext: '', session: { engine: 'agents_sdk', version: '0.21.0', id: 'session' } };
    const help = await runtime.runToolCommand(input, 'help');
    assert.equal(help.status, 'handled');
    assert.match(JSON.stringify(help.reply), /\/help/u);
    for (const command of ['stop', 'new', 'reset']) {
      const result = await runtime.runToolCommand(input, command);
      assert.equal(result.status, 'rejected');
      assert.match(JSON.stringify(result.reply), /不允许/u);
    }
  } finally { await runtime.stop(); }
});
