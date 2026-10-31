import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GrantSchema, type Grant } from '../../typescript/packages/contracts/src/index.ts';
import { parseSenderIds, senderScopeLabel, senderAuthorizationConflicts } from '../src/components/typescript/sender-authorization.ts';

function grant(change: Partial<Grant> = {}): Grant { return GrantSchema.parse({platform:'qq',senderIds:['one'],state:'operator',...change}); }

test('sender input accepts common separators while preserving exact string identity', () => {
  assert.deepEqual(parseSenderIds(' 001,1\nOne，one;001；-123\t123 '), ['001','1','One','one','-123','123']);
  assert.deepEqual(parseSenderIds(' ,，;；\n\t '), []);
});

test('multiple IDs in one rule all share a single state without capability or maximum controls', () => {
  const row=grant({senderIds:parseSenderIds('123\n456,123'),state:'elite_operator'});
  assert.deepEqual(row.senderIds,['123','456']);
  assert.equal(row.state,'elite_operator');
  assert.deepEqual(Object.keys(row).sort(),['platform','senderIds','state']);
});

test('conflicting states are detected only for the same platform and exact scope', () => {
  const base=grant({senderIds:['001','1']});
  const conflicting=grant({senderIds:['1'],state:'senior_operator'});
  const anotherPlatform=grant({platform:'tg',senderIds:['1'],state:'elite_operator'});
  const groupOnly=grant({sessionType:'group',senderIds:['1'],state:'elite_operator'});
  assert.deepEqual(senderAuthorizationConflicts([base,conflicting,anotherPlatform,groupOnly]),[{platform:'qq',senderId:'1',firstIndex:0,secondIndex:1}]);
  assert.deepEqual(senderAuthorizationConflicts([base,grant({senderIds:['001'],state:'operator'})]),[]);
});

test('scope labels preserve narrowed rules instead of implying all conversations', () => {
  assert.equal(senderScopeLabel(grant()),'该机器人全部会话');
  assert.equal(senderScopeLabel(grant({sessionType:'private'})),'仅私聊');
  assert.equal(senderScopeLabel(GrantSchema.parse({platform:'qq',senderIds:['one'],state:'operator',sessionType:'group',sessionId:'123'})),'群聊 123');
  assert.equal(senderScopeLabel(GrantSchema.parse({platform:'qq',senderIds:['one'],state:'operator',sessionId:'123'})),'会话 123');
});

test('typing sender IDs never changes the other rule or its retained scope', () => {
  const narrowed=GrantSchema.parse({platform:'qq',senderIds:['old'],state:'senior_operator',sessionType:'group',sessionId:'123'});
  const separate=grant({senderIds:['other'],state:'operator'});const before=structuredClone(separate);
  narrowed.senderIds=parseSenderIds('new-1\nnew-2');
  assert.equal(narrowed.sessionId,'123');assert.equal(narrowed.sessionType,'group');assert.equal(narrowed.state,'senior_operator');
  assert.deepEqual(separate,before);
});
