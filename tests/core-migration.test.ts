import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageEventSchema } from '../packages/contracts/src/index.js';
import { dryRunMigration, simulateFlow } from '../packages/core/src/index.js';

// Sanitized fixture of the four ordered routes in config.local-debug.json.
// No credentials, provider endpoints, persona text or live sender IDs are copied.
function standardRoutes(agentId = 'debug-agent', prefix = '#') {
  return [
    { id: 'group-command', enabled: true, match: { sessionTypes: ['GROUP'], attention: 'MENTION_OR_REPLY', attentionTarget: 'BOT', stripMentions: true, textMode: 'PREFIX', textPattern: prefix }, action: { type: 'COMMAND', agentId: null, commandPrefix: prefix } },
    { id: 'group-agent', enabled: true, match: { sessionTypes: ['GROUP'], attention: 'MENTION_OR_REPLY', attentionTarget: 'BOT', stripMentions: true, textMode: 'GLOB', textPattern: '*' }, action: { type: 'AGENT', agentId, commandPrefix: prefix } },
    { id: 'private-command', enabled: true, match: { sessionTypes: ['PRIVATE'], attention: 'ANY', attentionTarget: 'BOT', stripMentions: true, textMode: 'PREFIX', textPattern: prefix }, action: { type: 'COMMAND', agentId: null, commandPrefix: prefix } },
    { id: 'private-agent', enabled: true, match: { sessionTypes: ['PRIVATE'], attention: 'ANY', attentionTarget: 'BOT', stripMentions: true, textMode: 'GLOB', textPattern: '*' }, action: { type: 'AGENT', agentId, commandPrefix: prefix } },
  ];
}
function legacy() { return { schemaVersion: 3, agents: [{ id: 'debug-agent', type: 'NORMAL', instructions: '', llm: { providerRef: 'provider', model: 'test-model' } }], llms: [{ id: 'provider', type: 'openai', protocol: 'OPENAI_RESPONSES', credentialRef: { source: 'ENVIRONMENT', key: 'TEST_MODEL_KEY' } }], ims: [{ id: 'telegram-test', type: 'telegram', routes: standardRoutes() }] }; }
function message(text: string, sessionType: 'private' | 'group' = 'group', attention: 'none' | 'mention' | 'quote' | 'other' = 'none') {
  return MessageEventSchema.parse({ platform: 'telegram-test', platformType: 'telegram', sessionId: 'same-id', sessionType, senderId: 'sender', botId: 'bot', messageId: crypto.randomUUID(), timestamp: 1, parts: [{ type: 'text', text }, ...(attention === 'mention' ? [{ type: 'mention', userId: 'bot' }] : attention === 'quote' ? [{ type: 'quote', messageId: 'old-message', senderId: 'bot', text: 'quoted' }] : attention === 'other' ? [{ type: 'mention', userId: 'another-user' }] : [])] });
}

void test('standard debug routes migrate to fixed per-session Agent selection and preserve group command attention', () => {
  const report = dryRunMigration(legacy(), { mapNormalToAgentsSdk: true }); assert.equal(report.canActivate, true, JSON.stringify(report.diagnostics)); const config = report.config; if (config === undefined) throw new Error('Missing migration');
  assert.equal(report.diagnostics.some(item => item.severity === 'error'), false); assert.equal(config.connections[0]?.protocol, 'responses'); assert.equal(config.platforms[0]?.enabled, false);
  assert.deepEqual(config.flow.routing.rules.map(rule => [rule.platform, rule.sessionType, rule.agentId]), [['telegram-test', 'private', 'debug-agent'], ['telegram-test', 'group', 'debug-agent']]);
  assert.equal(config.flow.acceptance.groupPolicy, 'mention_or_reply'); assert.equal(config.flow.acceptance.groupCommandsRequireAttention, true); assert.equal(config.flow.commands.prefix, '#');
  assert.equal(simulateFlow(config, message('#help')).outcome, 'ignored'); assert.equal(simulateFlow(config, message('#help', 'group', 'other')).outcome, 'ignored');
  assert.equal(simulateFlow(config, message('#help', 'group', 'mention')).outcome, 'command'); assert.equal(simulateFlow(config, message('#help', 'group', 'quote')).outcome, 'command');
  assert.equal(simulateFlow(config, message('plain group text')).outcome, 'ignored'); assert.equal(simulateFlow(config, message('plain group text', 'group', 'mention')).agentId, 'debug-agent');
  assert.equal(simulateFlow(config, message('#help', 'private')).outcome, 'command'); assert.equal(simulateFlow(config, message('plain private text', 'private')).agentId, 'debug-agent');
  assert.equal(config.agents[0]?.capabilities.includes('admin'), false); assert.equal(config.agents[0]?.capabilities.includes('external.write'), false);
});
void test('canonical private-only and group-only routes preserve disabled session types', () => {
  for (const session of ['PRIVATE', 'GROUP']) {
    const source = legacy(); source.ims[0] = { id: 'telegram-test', type: 'telegram', routes: standardRoutes().filter(route => route.match.sessionTypes.includes(session)) };
    const report = dryRunMigration(source, { mapNormalToAgentsSdk: true }); assert.equal(report.canActivate, true, JSON.stringify(report.diagnostics)); if (report.config === undefined) throw new Error('Missing config');
    assert.equal(report.config.flow.acceptance.privateEnabled, session === 'PRIVATE');
    const rejected = session === 'PRIVATE' ? message('#help', 'group', 'mention') : message('#help', 'private'); assert.equal(simulateFlow(report.config, rejected).outcome, 'ignored');
  }
});
void test('multiple IMs may retain distinct Agents when their acceptance and prefixes are compatible', () => {
  const source = legacy(); source.agents.push({ id: 'second-agent', type: 'NORMAL', instructions: '', llm: { providerRef: 'provider', model: 'test-model' } });
  source.ims.push({ id: 'napcat-test', type: 'napcat4_18_6', routes: standardRoutes('second-agent') });
  const report = dryRunMigration(source, { mapNormalToAgentsSdk: true }); assert.equal(report.canActivate, true, JSON.stringify(report.diagnostics)); if (report.config === undefined) throw new Error('Missing config');
  assert.equal(report.config.platforms[1]?.type, 'napcat'); assert.equal(simulateFlow(report.config, { ...message('hello', 'private'), platform: 'napcat-test', platformType: 'napcat' }).agentId, 'second-agent');
});
void test('incompatible IM attention and command prefixes are explicit migration errors', () => {
  const source = legacy(); source.ims.push({ id: 'other', type: 'telegram', routes: standardRoutes().map(route => ({ ...route, match: { ...route.match, attention: 'ANY' } })) });
  const attention = dryRunMigration(source, { mapNormalToAgentsSdk: true }); assert.equal(attention.canActivate, false); assert.ok(attention.diagnostics.some(item => item.severity === 'error' && item.message.includes('differ')));
  const prefixes = legacy(); prefixes.ims[0] = { id: 'telegram-test', type: 'telegram', routes: standardRoutes('debug-agent', '/') }; prefixes.ims.push({ id: 'other', type: 'telegram', routes: standardRoutes('debug-agent', '#') });
  const prefix = dryRunMigration(prefixes, { mapNormalToAgentsSdk: true }); assert.equal(prefix.canActivate, false); assert.ok(prefix.diagnostics.some(item => item.severity === 'error' && item.message.includes('prefixes')));
});
void test('complex Agent patterns, changed command targets and shadowed command ordering are never approximated', () => {
  const patterns = legacy(); patterns.ims[0] = { id: 'telegram-test', type: 'telegram', routes: standardRoutes().map(route => route.id === 'group-agent' ? { ...route, match: { ...route.match, textPattern: '*special*' } } : route) };
  assert.equal(dryRunMigration(patterns, { mapNormalToAgentsSdk: true }).canActivate, false);
  const reordered = legacy(); reordered.ims[0] = { id: 'telegram-test', type: 'telegram', routes: [...standardRoutes()].reverse() }; assert.equal(dryRunMigration(reordered, { mapNormalToAgentsSdk: true }).canActivate, false);
  const target = legacy(); target.ims[0] = { id: 'telegram-test', type: 'telegram', routes: standardRoutes().map(route => route.action.type === 'COMMAND' ? { ...route, action: { ...route.action, agentId: 'other-agent' } } : route) }; assert.equal(dryRunMigration(target, { mapNormalToAgentsSdk: true }).canActivate, false);
});
