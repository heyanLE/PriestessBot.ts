import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RuntimeConfigSchema, AgentIdSchema, AgentDefinitionSchema, type RuntimeConfig } from '../../packages/contracts/src/index.ts';
import { matchesRuntimeNavigation, runtimeNavGroups, runtimeNavigation, runtimeDomainFor, runtimeAreaLinks, areaLinkActive, type RuntimePage } from '../src/components/typescript/navigation.ts';
import { changedConfigPages, isRuntimeConfigEditor, mergeRuntimeConfig, runtimeConfigSignature, rebaseAgentSave, agentPublicationChanges, parseEditorConfiguration } from '../src/utils/workflow-model.ts';

function config(): RuntimeConfig { return RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [{ id: 'assistant', displayName: '助手' }], flow: { routing: { defaultAgentId: 'assistant', rules: [] } } }); }

test('all existing routes remain compatible and new hubs have unique navigation', () => {
  const expected: Record<RuntimePage, string> = { welcome: '/', chat: '/chat', conversations: '/sessions', providers: '/providers', agents: '/agents', personas: '/personas', platforms: '/platforms', flow: '/flow', permissions: '/permissions', knowledge: '/knowledge-base', memories: '/memories', search: '/search', plugins: '/plugins', extensions: '/extensions', runs: '/agent-records', execution: '/execution', files: '/files', settings: '/settings', resources:'/resources', tools:'/tools', routeRecords:'/route-records' };
  assert.equal(runtimeNavigation.length, 21);
  assert.equal(new Set(runtimeNavigation.map(item => item.id)).size, 21);
  assert.equal(new Set(runtimeNavigation.map(item => item.path)).size, 21);
  for (const item of runtimeNavigation) {
    assert.equal(item.path, expected[item.id]);
    assert.ok(runtimeNavGroups.includes(item.group));
    assert.ok(item.related.length > 0);
    assert.equal(new Set(item.related).size, item.related.length);
    for (const next of item.related) { assert.notEqual(next, item.id); assert.ok(runtimeNavigation.some(candidate => candidate.id === next)); }
  }
  assert.deepEqual(runtimeNavGroups.map(group => runtimeNavigation.filter(item => item.group === group).length), [6, 1, 3, 8, 3]);
});

test('navigation search matches familiar task terms, normalizes case and requires every word', () => {
  const find = (query: string) => runtimeNavigation.filter(item => matchesRuntimeNavigation(item, query)).map(item => item.id);
  assert.deepEqual(find('  NAPCAT 表情  '), ['platforms']);
  assert.deepEqual(find('MCP 安装'), ['extensions']);
  assert.deepEqual(find('聊天记录'), ['conversations']);
  assert.deepEqual(find('Docker 网络'), ['execution']);
  assert.ok(find('密钥').includes('settings'));
  assert.equal(find('   ').length, 21);
  assert.deepEqual(find('NapCat 不存在的词'), []);
});

test('saving scope follows selected section on mixed pages', () => {
  for (const page of ['agents', 'providers', 'platforms', 'permissions', 'flow', 'settings']) {
    const navigation = runtimeNavigation.find(item => item.id === page); assert.ok(navigation);
    assert.equal(isRuntimeConfigEditor(navigation.id), true);
  }
  assert.equal(isRuntimeConfigEditor('extensions', 'resources'), true);
  assert.equal(isRuntimeConfigEditor('extensions', 'native'), false);
  assert.equal(isRuntimeConfigEditor('extensions'), false);
  for (const page of runtimeNavigation.filter(item => ['memories', 'knowledge', 'execution'].includes(item.id)).map(item => item.id)) {
    assert.equal(isRuntimeConfigEditor(page, 'settings'), true);
    for (const section of ['content', 'maintenance', 'processes', undefined]) assert.equal(isRuntimeConfigEditor(page, section), false);
  }
  for (const page of runtimeNavigation.filter(item => ['welcome', 'chat', 'conversations', 'personas', 'plugins', 'search', 'files', 'runs'].includes(item.id)).map(item => item.id)) assert.equal(isRuntimeConfigEditor(page, 'settings'), false);
});

test('revision changes are metadata and never create dirty configuration', () => {
  const before = config(); const after = structuredClone(before); after.revision = 16; after.flow.revision = 23;
  assert.equal(runtimeConfigSignature(before), runtimeConfigSignature(after));
  assert.deepEqual(changedConfigPages(before, after), []);
  assert.equal(before.revision, 0); assert.equal(before.flow.revision, 0);
});

test('configuration comparison ignores object-key order but preserves routing order', () => {
  const before = config();
  before.flow.routing.rules = [{ id: 'first', textIncludes: 'a', agentId: AgentIdSchema.parse('assistant') }, { id: 'second', textIncludes: 'b', agentId: AgentIdSchema.parse('assistant') }];
  const reordered: RuntimeConfig = { ...before, flow: { ...before.flow, routing: { rules: before.flow.routing.rules.map(rule => ({ agentId: rule.agentId, textIncludes: rule.textIncludes, id: rule.id })), defaultAgentId: before.flow.routing.defaultAgentId } } };
  assert.equal(runtimeConfigSignature(before), runtimeConfigSignature(reordered));
  reordered.flow.routing.rules.reverse();
  assert.notEqual(runtimeConfigSignature(before), runtimeConfigSignature(reordered));
  assert.deepEqual(changedConfigPages(before, reordered), ['flow']);
});

test('every editable root is classified and multiple resources produce one page entry', () => {
  const before = config(); const after = structuredClone(before);
  after.agents = after.agents.map(agent => ({ ...agent, instructions: 'updated' }));
  after.platforms = [{ id: 'tg', type: 'telegram', enabled: false, displayName: 'TG', tokenEnv: 'TELEGRAM_TOKEN', apiBase: 'https://api.telegram.org', pollingTimeoutSeconds: 30 }];
  after.connections = after.connections.map(connection => ({ ...connection, protocol: 'chat_completions' }));
  after.grants = [{ platform: 'tg', senderIds: ['user'], state: 'operator' }];
  after.memoryLibraries = [{ id: 'memory', displayName: '记忆' }];
  after.knowledgeLibraries = [{ id: 'knowledge', displayName: '知识' }];
  after.embedding = { connectionId: 'default', model: 'embedding', dimensions: 128 };
  after.reranker = { url: 'https://example.com/rerank', apiKeyEnv: 'RERANK_KEY', model: 'rerank' };
  after.executionEnvironments = [{ id: 'sandbox', type: 'sdk_docker', root: './workspace', networkEnabled: false }];
  after.mcpServers = [{ id: 'mcp', transport: 'stdio', command: 'command', args: [], envRefs: {}, headersEnv: {} }];
  after.skillLibraries = [{ id: 'skills', directory: './skills' }];
  after.flow.commands.prefix = '!';
  assert.deepEqual(changedConfigPages(before, after), ['providers', 'agents', 'platforms', 'flow', 'permissions', 'knowledge', 'memories', 'extensions', 'execution']);
  assert.notEqual(runtimeConfigSignature(before), runtimeConfigSignature(after));
});

test('embedding and reranker changes belong to knowledge even when library definitions are unchanged', () => {
  const before = config(); const embedding = structuredClone(before); embedding.embedding = { connectionId: 'default', model: 'embed', dimensions: 128 };
  assert.deepEqual(changedConfigPages(before, embedding), ['knowledge']);
  const reranker = structuredClone(before); reranker.reranker = { url: 'https://example.com/rerank', apiKeyEnv: 'KEY', model: 'rerank' };
  assert.deepEqual(changedConfigPages(before, reranker), ['knowledge']);
  assert.deepEqual(changedConfigPages(embedding, before), ['knowledge']);
});

test('three-way merge keeps independent local and remote edits and uses remote revision metadata', () => {
  const base = config(); const local = structuredClone(base); const remote = structuredClone(base);
  local.agents = local.agents.map(agent => ({ ...agent, instructions: 'local change' }));
  remote.platforms = [{ id: 'tg', type: 'telegram', enabled: false, displayName: 'Remote bot', tokenEnv: 'TELEGRAM_TOKEN', apiBase: 'https://api.telegram.org', pollingTimeoutSeconds: 30 }];
  remote.revision = 8; remote.flow.revision = 9;
  const merged = mergeRuntimeConfig(base, local, remote);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.config.agents, local.agents);
  assert.deepEqual(merged.config.platforms, remote.platforms);
  assert.equal(merged.config.revision, 8); assert.equal(merged.config.flow.revision, 9);
  assert.deepEqual(changedConfigPages(remote, merged.config), ['agents']);
  assert.equal(base.revision, 0); assert.equal(local.revision, 0);
});

test('three-way merge reports conflicting pages for different edits to the same root', () => {
  const base = config(); const local = structuredClone(base); const remote = structuredClone(base);
  local.agents = local.agents.map(agent => ({ ...agent, instructions: 'local' }));
  remote.agents = remote.agents.map(agent => ({ ...agent, instructions: 'remote' }));
  remote.revision = 10;
  const merged = mergeRuntimeConfig(base, local, remote);
  assert.deepEqual(merged.conflicts, ['agents']);
  assert.deepEqual(local.agents.map(agent => agent.instructions), ['local']);
  assert.deepEqual(remote.agents.map(agent => agent.instructions), ['remote']);
  assert.equal(local.revision, 0);
});

test('three-way merge ignores flow revision metadata and does not conflict on identical edits', () => {
  const base = config(); const local = structuredClone(base); const remote = structuredClone(base);
  local.flow.commands.prefix = '!'; remote.revision = 5; remote.flow.revision = 5;
  const merged = mergeRuntimeConfig(base, local, remote);
  assert.deepEqual(merged.conflicts, []); assert.equal(merged.config.flow.commands.prefix, '!'); assert.equal(merged.config.flow.revision, 5);
  remote.flow.commands.prefix = '!';
  assert.deepEqual(mergeRuntimeConfig(base, local, remote).conflicts, []);
  remote.flow.commands.prefix = '#';
  assert.deepEqual(mergeRuntimeConfig(base, local, remote).conflicts, ['flow']);
});

test('three-way merge retains independent optional-field additions and removals', () => {
  const base = config(); base.embedding = { connectionId: 'default', model: 'embed', dimensions: 128 };
  const local = structuredClone(base); const remote = structuredClone(base);
  delete local.embedding;
  remote.reranker = { url: 'https://example.com/rerank', apiKeyEnv: 'KEY', model: 'rank' };
  const merged = mergeRuntimeConfig(base, local, remote);
  assert.deepEqual(merged.conflicts, []); assert.equal(merged.config.embedding, undefined); assert.deepEqual(merged.config.reranker, remote.reranker);
});

test('object navigation places every legacy page under one primary workspace', () => {
  for (const page of runtimeNavigation) assert.ok(runtimeAreaLinks[runtimeDomainFor(page.id)]);
  assert.equal(runtimeDomainFor('agents'), 'agents');
  assert.equal(runtimeDomainFor('personas'), 'resources');
  assert.equal(runtimeDomainFor('permissions'), 'platforms');
  assert.equal(runtimeDomainFor('execution', 'processes'), 'workbench');
  assert.equal(runtimeDomainFor('execution', 'settings'), 'settings');
  assert.equal(runtimeDomainFor('providers'), 'settings');
  const tools = runtimeAreaLinks.resources.find(link => link.path === '/tools'); assert.ok(tools);
  for (const page of runtimeNavigation.filter(page => ['tools','search','plugins','extensions'].includes(page.id))) assert.ok(areaLinkActive(tools, page.id));
});

test('saving one Agent preserves other Agent and resource drafts at the new revision', () => {
  const base = config();
  base.agents.push(AgentDefinitionSchema.parse({id:'second',displayName:'Second'}));
  const local = RuntimeConfigSchema.parse(base); const remote = RuntimeConfigSchema.parse(base);
  const first = local.agents.find(item=>item.id==='assistant'); const second = local.agents.find(item=>item.id==='second'); assert.ok(first); assert.ok(second);
  first.instructions = 'published update'; second.displayName = 'unfinished draft';
  local.memoryLibraries.push({id:'draft-library',displayName:'Unpublished library'});
  remote.agents = remote.agents.map(item => item.id==='assistant' ? first : item); remote.revision=5; remote.flow.revision=5;
  const result = rebaseAgentSave(base,local,remote,'assistant');
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.config.agents.find(item=>item.id==='assistant')?.instructions, 'published update');
  assert.equal(result.config.agents.find(item=>item.id==='second')?.displayName, 'unfinished draft');
  assert.deepEqual(result.config.memoryLibraries, local.memoryLibraries);
  assert.equal(result.config.revision, 5);
  assert.deepEqual(changedConfigPages(remote,result.config), ['agents','memories']);
  assert.equal(base.agents.find(item=>item.id==='second')?.displayName,'Second');
});

test('Agent rebase refuses a response that omits the saved target', () => {
  const base=config();
  assert.throws(()=>rebaseAgentSave(base,base,base,'missing'),/未包含目标 Agent/);
});

test('Agent publication keeps incomplete unrelated forms without weakening saved object validation', () => {
  const base=config(); base.agents.push(AgentDefinitionSchema.parse({id:'second',displayName:'Second'}));
  const local=RuntimeConfigSchema.parse(base); const remote=RuntimeConfigSchema.parse(base);
  const other=local.agents.find(item=>item.id==='second'); assert.ok(other); other.displayName='';
  const connection=local.connections[0]; assert.ok(connection); connection.baseUrl='unfinished';
  const saved=remote.agents.find(item=>item.id==='assistant'); assert.ok(saved); saved.displayName='Saved assistant'; remote.revision=8;
  const result=rebaseAgentSave(base,local,remote,'assistant');
  assert.equal(result.config.agents.find(item=>item.id==='second')?.displayName,'');
  assert.equal(result.config.connections[0]?.baseUrl,'unfinished');
  assert.equal(result.config.agents.find(item=>item.id==='assistant')?.displayName,'Saved assistant');
  assert.equal(result.config.revision,8);
});

test('Agent publication review distinguishes legacy fields from active approvals and execution changes', () => {
  const before=AgentDefinitionSchema.parse({id:'assistant',displayName:'Assistant'});const after=AgentDefinitionSchema.parse(before);
  after.capabilities.push('admin');after.approvalTools=['exec_command'];after.resources.executionEnvironment='sandbox';
  const labels=agentPublicationChanges(before,after);
  assert.ok(labels.some(label=>label.includes('固定运行态权限不变')));
  assert.ok(labels.every(label=>!label.includes('新增权限')));
  assert.ok(labels.some(label=>label.includes('逐次审批工具')&&label.includes('exec_command')));
  assert.ok(labels.some(label=>label.includes('执行环境')&&label.includes('sandbox')));
});

test('configuration errors identify the field and next action without echoing submitted content', () => {
  const value=config();const agent=value.agents[0];const connection=value.connections[0];assert.ok(agent);assert.ok(connection);
  agent.displayName='';connection.baseUrl='sensitive-secret-token';
  assert.throws(()=>parseEditorConfiguration(value), cause=>{
    assert.ok(cause instanceof Error);assert.match(cause.message,/Agent 1 · 名称/);assert.match(cause.message,/至少填写 1 个字符/);assert.match(cause.message,/模型连接 1 · API 地址/);assert.doesNotMatch(cause.message,/sensitive|secret-token/);return true;
  });
});
