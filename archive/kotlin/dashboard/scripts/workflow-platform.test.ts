import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeConfigSchema } from '../../typescript/packages/contracts/src/index';
import { createPlatformDraft, platformConfigurationIssues, preparePlatformConnection } from '../src/components/typescript/platform-workbench';
function configuration() {
  return RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [{ id: 'main', displayName: 'Main', connectionId: 'default', enabled: true }, { id: 'research', displayName: 'Research', connectionId: 'default', enabled: true }], platforms: [{ id: 'existing', type: 'telegram', displayName: 'Existing bot', tokenEnv: 'EXISTING_TOKEN' }], flow: { routing: { defaultAgentId: 'main', rules: [{ id: 'existing-global-rule', textIncludes: 'existing keyword', agentId: 'main' }] } } });
}
void test('opening and editing a wizard draft cannot change running configuration or another instance', () => {
  const config = configuration(); const before = JSON.stringify(config);
  const draft = createPlatformDraft('napcat', 'new'); draft.displayName = 'Draft only';
  if (draft.type === 'napcat') { draft.websocketUrl = 'ws://new-host:3001'; draft.preAckEmoji.enabled = true; }
  assert.equal(JSON.stringify(config), before);
  const prepared = preparePlatformConnection(config, draft, '', 'new');
  assert.equal(prepared.ok, true); assert.equal(JSON.stringify(config), before, 'Preparing a candidate must not publish or mutate the original draft');
  draft.displayName = 'Later wizard edit';
  if (prepared.ok) { assert.equal(prepared.config.platforms.at(-1)?.displayName, 'Draft only'); assert.deepEqual(prepared.config.platforms[0], config.platforms[0]); }
});
void test('duplicate IDs reject the whole connection without adding a platform or route', () => {
  const config = configuration(); const draft = createPlatformDraft('napcat', 'new'); draft.id = 'existing';
  const before = JSON.stringify(config); const result = preparePlatformConnection(config, draft, 'research', 'new');
  assert.equal(result.ok, false); if (!result.ok) assert.ok(result.issues.some(issue => issue.includes('已存在')));
  assert.equal(JSON.stringify(config), before);
});
void test('transport validation rejects syntactically valid URLs for the wrong protocol', () => {
  const napcat = createPlatformDraft('napcat', 'new'); const telegram = createPlatformDraft('telegram', 'new'); const weixin = createPlatformDraft('weixin', 'new');
  if (napcat.type === 'napcat') { napcat.websocketUrl = 'https://example.invalid/ws'; assert.ok(platformConfigurationIssues(napcat, []).some(issue => issue.includes('WebSocket'))); napcat.websocketUrl = 'wss://example.invalid/ws'; napcat.apiBase = 'file:///tmp/socket'; assert.ok(platformConfigurationIssues(napcat, []).some(issue => issue.includes('HTTP API'))); }
  if (telegram.type === 'telegram') { telegram.apiBase = 'wss://example.invalid'; assert.ok(platformConfigurationIssues(telegram, []).some(issue => issue.includes('API 地址'))); telegram.apiBase = 'https://api.telegram.org'; telegram.tokenEnv = ''; assert.ok(platformConfigurationIssues(telegram, []).length); }
  if (weixin.type === 'weixin') { weixin.apiBase = 'file:///tmp/state'; assert.ok(platformConfigurationIssues(weixin, []).some(issue => issue.includes('API 地址'))); }
});
void test('an instance-specific Agent rule precedes old rules and preserves global acceptance and permissions', () => {
  const config = configuration(); const before = JSON.stringify(config); const draft = createPlatformDraft('napcat', 'new');
  const result = preparePlatformConnection(config, draft, 'research', 'new'); assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.config.flow.routing.rules[0], { id: 'route-new', platform: draft.id, agentId: 'research' });
    assert.deepEqual(result.config.flow.routing.rules.slice(1), config.flow.routing.rules);
    assert.equal(result.config.flow.routing.defaultAgentId, config.flow.routing.defaultAgentId);
    assert.deepEqual(result.config.flow.acceptance, config.flow.acceptance);
    assert.deepEqual(result.config.grants, config.grants);
  }
  assert.equal(JSON.stringify(config), before);
});
void test('inheriting routing does not create an extra route or expand permissions', () => {
  const config = configuration(); const result = preparePlatformConnection(config, createPlatformDraft('weixin', 'new'), '', 'unused');
  assert.equal(result.ok, true); if (result.ok) { assert.deepEqual(result.config.flow, config.flow); assert.deepEqual(result.config.grants, config.grants); assert.equal(result.config.platforms.length, config.platforms.length + 1); }
});
void test('missing or disabled Agent and exhausted routing capacity leave all original objects unchanged', () => {
  const config = configuration(); const agent = config.agents.find(item => item.id === 'research'); if (agent) agent.enabled = false;
  const draft = createPlatformDraft('telegram', 'new'); const before = JSON.stringify(config);
  assert.equal(preparePlatformConnection(config, draft, 'research', 'new').ok, false);
  assert.equal(preparePlatformConnection(config, draft, 'missing', 'new').ok, false);
  assert.equal(JSON.stringify(config), before);
  const first = config.flow.routing.rules[0]; if (!first) throw new Error('Missing test rule');
  config.flow.routing.rules = Array.from({ length: 100 }, (_value, index) => ({ ...first, id: `rule-${index}` }));
  const full = JSON.stringify(config);
  assert.equal(preparePlatformConnection(config, draft, 'main', 'new').ok, false);
  assert.equal(preparePlatformConnection(config, draft, '', 'new').ok, true);
  assert.equal(JSON.stringify(config), full);
});
void test('NapCat reply settings survive preparing a new instance and invalid emoji input is rejected', () => {
  const config = configuration(); const draft = createPlatformDraft('napcat', 'new'); if (draft.type !== 'napcat') throw new Error('Wrong platform');
  draft.forwardThreshold = 2200; draft.preAckEmoji = { enabled: true, emojis: ['124', '👀'] }; draft.apiBase = 'http://localhost:3000'; draft.accessTokenEnv = 'CUSTOM_NAPCAT_TOKEN';
  const result = preparePlatformConnection(config, draft, '', 'unused'); assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.config.platforms.at(-1), draft);
  draft.preAckEmoji.emojis = ['unsupported words']; assert.equal(preparePlatformConnection(config, draft, '', 'unused').ok, false);
});
