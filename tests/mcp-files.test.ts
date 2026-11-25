import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentDefinitionSchema, AgentIdSchema, BudgetSchema, ResourceBindingsSchema, RunIdSchema, RuntimeConfigSchema, SessionIdSchema, type RunContext } from '../packages/contracts/src/index.js';
import { loadWorkspaceMcpServers } from '../packages/adapters/src/agents/mcp-files.js';

await test('workspace MCP files load from global and agent zones with agent precedence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-mcp-files-'));
  try {
    await mkdir(path.join(root, 'global', 'mcp'), { recursive: true });
    await mkdir(path.join(root, 'agents', 'assistant', 'mcp'), { recursive: true });
    await mkdir(path.join(root, 'conversations', 'qq', 'group', 'room', 'mcp'), { recursive: true });
    const global = { id: 'global-search', transport: 'stdio', command: 'search', args: [] };
    const agent = { id: 'agent-tool', transport: 'stdio', command: 'agent', args: [] };
    const overrideGlobal = { id: 'override', transport: 'stdio', command: 'global', args: [] };
    const overrideAgent = { id: 'override', transport: 'stdio', command: 'agent', args: [] };
    await writeFile(path.join(root, 'global', 'mcp', 'global.json'), JSON.stringify(global));
    await writeFile(path.join(root, 'global', 'mcp', 'override.json'), JSON.stringify(overrideGlobal));
    await writeFile(path.join(root, 'agents', 'assistant', 'mcp', 'agent.json'), JSON.stringify(agent));
    await writeFile(path.join(root, 'agents', 'assistant', 'mcp', 'override.json'), JSON.stringify(overrideAgent));
    await writeFile(path.join(root, 'agents', 'assistant', 'mcp', 'broken.json'), '{not-json');
    await writeFile(path.join(root, 'conversations', 'qq', 'group', 'room', 'mcp', 'conversation.json'), JSON.stringify({ id: 'conversation', transport: 'stdio', command: 'conversation' }));
    const agentDefinition = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', resources: { executionEnvironment: 'workspace' } });
    const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agentDefinition], workspace: { root, sandbox: false }, flow: { routing: { defaultAgentId: 'assistant', rules: [] } } });
    const context: RunContext = { runId: RunIdSchema.parse('mcp-files-run'), turnId: 'turn', principal: { platform: 'qq', sessionType: 'group', senderId: 'alice', sessionId: SessionIdSchema.parse('room') }, agentId: AgentIdSchema.parse('assistant'), generation: 0, configRevision: 0, flowRevision: 0, runtimeState: 'elite_operator', effectiveCapabilities: ['chat', 'external.write'], resources: ResourceBindingsSchema.parse({ executionEnvironment: 'workspace' }), grantVersion: 0, signal: new AbortController().signal, budget: BudgetSchema.parse({}), depth: 0 };
    const definitions = await loadWorkspaceMcpServers(config, context);
    assert.deepEqual(definitions.map(item => [item.id, item.command]).sort(), [['agent-tool', 'agent'], ['global-search', 'search'], ['override', 'agent']]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

await test('workspace MCP loader returns no servers when directories are absent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-mcp-files-empty-'));
  try {
    const agentDefinition = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', resources: { executionEnvironment: 'workspace' } });
    const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agentDefinition], workspace: { root, sandbox: false }, flow: { routing: { defaultAgentId: 'assistant', rules: [] } } });
    const context: RunContext = { runId: RunIdSchema.parse('mcp-files-empty'), turnId: 'turn', principal: { platform: 'qq', sessionType: 'group', senderId: 'alice', sessionId: SessionIdSchema.parse('room') }, agentId: AgentIdSchema.parse('assistant'), generation: 0, configRevision: 0, flowRevision: 0, runtimeState: 'elite_operator', effectiveCapabilities: ['chat', 'external.write'], resources: ResourceBindingsSchema.parse({ executionEnvironment: 'workspace' }), grantVersion: 0, signal: new AbortController().signal, budget: BudgetSchema.parse({}), depth: 0 };
    assert.deepEqual(await loadWorkspaceMcpServers(config, context), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
