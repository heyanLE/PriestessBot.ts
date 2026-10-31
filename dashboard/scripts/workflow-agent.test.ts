import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentCapability } from '../../packages/contracts/src/agent-workbench';
import { RuntimeConfigSchema } from '../../packages/contracts/src/index.ts';
import { agentWorkbenchTab, canMountCapability, capabilityBindingName, capabilityIsMounted, isGeneralModelTool, isPlatformCapability, capabilityMinimumState, draftModelTestConfig } from '../src/components/typescript/agent-workbench-model.ts';
function entry(change: Partial<AgentCapability> = {}): AgentCapability { return { id: 'x', label: '能力', description: '说明', kind: 'tool', source: 'builtin', sourceId: 'runtime', scope: 'general', platforms: ['napcat', 'telegram'], sessionTypes: ['group'], toolName: 'history', requiredCapabilities: ['chat'], availability: 'registered', requirements: ['只允许当前群'], settingsPath: '/agents', ...change }; }

test('model testing selects only the current Agent and its model connections', () => {
  const published=RuntimeConfigSchema.parse({runtime:'priestess-ts',schemaVersion:1,agents:[{id:'a',displayName:'A'},{id:'b',displayName:'B'}],flow:{routing:{defaultAgentId:'a',rules:[]}}});
  const draft=RuntimeConfigSchema.parse(published);const other=draft.agents.find(item=>item.id==='b');assert.ok(other);other.displayName='';
  draft.connections.push({id:'unfinished',apiKeyEnv:'KEY',protocol:'responses',baseUrl:'unfinished'});
  const current=draft.agents.find(item=>item.id==='a');assert.ok(current);current.persona='当前草稿人设';
  const result=draftModelTestConfig(draft,published,'a');
  assert.deepEqual(result.agents.map(item=>item.id),['a']);
  assert.equal(result.agents[0]?.persona,'当前草稿人设');
  assert.deepEqual(result.connections.map(item=>item.id),['default']);
  assert.equal(draft.agents[1]?.displayName,'');
});

test('model test validation points to the relevant current form', () => {
  const config=RuntimeConfigSchema.parse({runtime:'priestess-ts',schemaVersion:1,agents:[{id:'a',displayName:'A'}],flow:{routing:{defaultAgentId:'a',rules:[]}}});
  const draft=RuntimeConfigSchema.parse(config);const agent=draft.agents[0];assert.ok(agent);agent.displayName='';
  assert.throws(()=>draftModelTestConfig(draft,config,'a'),/Agent 名称.*必填项/);
  agent.displayName='A';agent.contextPolicy.summaryConnectionId='missing';
  assert.throws(()=>draftModelTestConfig(draft,config,'a'),/摘要模型连接不存在/);
});
test('platform membership comes from registration rather than tool spelling or plugin source', () => {
  const general = entry({ toolName: 'napcat_looking_but_general', source: 'plugin' });
  assert.equal(isGeneralModelTool(general), true);
  assert.equal(isPlatformCapability(general, 'napcat'), false);
  const qq = entry({ toolName: 'get_files', source: 'plugin', scope: 'platform', platforms: ['napcat'] });
  assert.equal(isPlatformCapability(qq, 'napcat'), true);
  assert.equal(isPlatformCapability(qq, 'telegram'), false);
  assert.equal(isPlatformCapability(qq, 'weixin'), false);
  assert.equal(isGeneralModelTool(qq), false);
});
test('unsupported platform status and MCP discovery never become mountable model tools', () => {
  const unavailable = entry({ kind: 'platform_status', scope: 'platform', platforms: ['weixin'], availability: 'not_implemented' });
  assert.equal(canMountCapability(unavailable), false);
  const mcp = entry({ kind: 'resource', source: 'mcp', availability: 'runtime_discovery' });
  assert.equal(capabilityBindingName(mcp), undefined);
  assert.equal(canMountCapability(mcp), false);
  assert.equal(isGeneralModelTool(mcp), false);
});
test('automatic record permission and native command remain bindable without being called model tools', () => {
  const automatic = entry({ kind: 'resource', source: 'plugin', bindingName: 'reminiscence_record' });
  assert.equal(capabilityBindingName(automatic), 'reminiscence_record');
  assert.equal(canMountCapability(automatic), true);
  assert.equal(isGeneralModelTool(automatic), false);
  assert.equal(capabilityIsMounted(automatic, ['reminiscence_record']), true);
  const command = entry({ kind: 'command', source: 'native_extension', toolName: 'extension_command' });
  assert.equal(capabilityBindingName(command), 'extension_command');
  assert.equal(isGeneralModelTool(command), false);
});
test('tool requirements map to fixed roles independently of mount state', () => {
  const command = entry({ toolName: 'exec_command', requiredCapabilities: ['process.execute.restricted'] });
  assert.equal(capabilityIsMounted(command, ['exec_command']), true);
  assert.equal(capabilityMinimumState(command),'operator');
  assert.equal(capabilityMinimumState(entry({source:'native_extension',toolName:'custom_executor',requiredCapabilities:['process.execute']})),'elite_operator');
  assert.equal(capabilityMinimumState(entry({requiredCapabilities:['admin']})),'elite_operator');
  assert.equal(capabilityMinimumState(entry({requiredCapabilities:['files.read']})),'operator');
  assert.equal(command.requirements[0], '只允许当前群');
});
test('workbench URL tabs restore canonical sections and compatible old links', () => {
  assert.equal(agentWorkbenchTab('resources'), 'tools');
  assert.equal(agentWorkbenchTab('profile'), 'persona');
  assert.equal(agentWorkbenchTab('budget'), 'permissions');
  assert.equal(agentWorkbenchTab('context'), 'context');
  assert.equal(agentWorkbenchTab(['tools']), 'persona');
  assert.equal(agentWorkbenchTab(undefined), 'persona');
});
