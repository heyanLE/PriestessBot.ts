import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentDefinitionSchema, MessageEventSchema, RunIdSchema, type EngineInput, type MessageEvent } from '../packages/contracts/src/index.js';
import { GroupConversationService } from '../packages/core/src/group-conversation.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { AuthorizationService, conversationKey } from '../packages/core/src/authorization.js';
import { ManagementService } from '../packages/core/src/management.js';

function input(store: RuntimeStore, sender = 'alice', group = 'group-a', agentId = 'agent-a', generation = 0, sessionType: 'group' | 'private' = 'group'): EngineInput {
  const agent = AgentDefinitionSchema.parse({ id: agentId, displayName: agentId, capabilities: ['chat'] });
  const message = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionId: group, sessionType, senderId: sender, senderName: sender, messageId: crypto.randomUUID(), timestamp: Date.now(), parts: [{ type: 'text', text: `${sender} public question` }], botId: 'bot' });
  const principal = { platform: message.platform, sessionType, sessionId: message.sessionId, senderId: sender };
  const context = { runId: RunIdSchema.parse(crypto.randomUUID()), turnId: 'turn', principal, agentId: agent.id, generation, configRevision: 1, flowRevision: 1, ...new AuthorizationService([], store).resolve(principal, agent), signal: new AbortController().signal, budget: agent.budget, depth: 0 };
  return { agent, context, message, additionalContext: 'PRIVATE_DYNAMIC_CONTEXT must never persist', session: { engine: 'agents_sdk', version: '0.21.0', id: crypto.randomUUID() } };
}
void test('public group history crosses senders, persists across service restart, and never contains dynamic context', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new GroupConversationService(store); const alice = input(store); const bob = input(store, 'bob');
    assert.equal(service.captureTurn(alice, 'public answer'), true);
    const history = new GroupConversationService(store).snapshot(bob.context);
    assert.equal(history.length, 2); assert.match(history[0]?.text ?? '', /sender_id.*alice/); assert.equal(history[1]?.text, 'public answer');
    assert.doesNotMatch(JSON.stringify(history), /PRIVATE_DYNAMIC_CONTEXT|grantVersion|effectiveCapabilities/);
    assert.equal(service.snapshot(alice.context).length, 0, 'current run cannot seed itself');
    assert.equal(service.captureTurn(alice, 'duplicate'), false);
    assert.equal(service.captureTurn({ ...alice, context: { ...alice.context, runId: bob.context.runId } }, 'duplicate message'), false);
    assert.deepEqual(service.snapshot(input(store, 'bob', 'group-b').context), []);
    assert.deepEqual(service.snapshot(input(store, 'bob', 'group-a', 'other-agent').context), []);
    assert.deepEqual(service.snapshot(input(store, 'bob', 'group-a', 'agent-a', 0, 'private').context), []);
    assert.deepEqual(service.snapshot({ ...bob.context, principal: { ...bob.context.principal, platform: 'other-qq' } }), []);
  } finally { store.close(); }
});
void test('generation reset and invalid message ownership cannot publish a public turn', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new GroupConversationService(store); const alice = input(store); const bob = input(store, 'bob');
    assert.equal(service.captureTurn({ ...alice, message: bob.message }, 'not public'), false);
    assert.equal(service.captureTurn(alice, 'answer', [bob.message]), false);
    assert.equal(service.captureTurn(input(store, 'alice', 'group-a', 'agent-a', 0, 'private'), 'private answer'), false);
    assert.equal(service.captureTurn(alice, 'answer'), true);
    store.reset(conversationKey(alice.context.principal, alice.context.agentId));
    assert.deepEqual(service.snapshot(bob.context), []);
    assert.equal(service.captureTurn(bob, 'stale reply'), false);
    const fresh = input(store, 'bob', 'group-a', 'agent-a', 1);
    assert.deepEqual(service.snapshot(fresh.context), []); assert.equal(service.captureTurn(fresh, 'fresh reply'), true);
    assert.equal(service.snapshot(input(store, 'alice', 'group-a', 'agent-a', 1).context).length, 2);
    const cancelled = input(store, 'alice', 'group-a', 'agent-a', 1);
    assert.equal(service.captureTurn({ ...cancelled, context: { ...cancelled.context, signal: AbortSignal.abort() } }, 'cancelled'), false);
  } finally { store.close(); }
});
void test('follow-ups remain complete turns under message and character limits', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new GroupConversationService(store, { maxMessages: 4 }); const alice = input(store);
    const followup = MessageEventSchema.parse({ ...alice.message, messageId: 'followup', parts: [{ type: 'text', text: 'follow-up' }] });
    service.captureTurn(alice, 'first answer', [followup, followup]);
    assert.equal(service.snapshot(input(store, 'bob').context).length, 3);
    const bob = input(store, 'bob'); service.captureTurn(bob, 'second answer');
    const history = service.snapshot(input(store, 'carol').context);
    assert.equal(history.length, 2); assert.match(history[0]?.text ?? '', /bob public question/); assert.equal(history[1]?.text, 'second answer');
    const bounded = new GroupConversationService(store, { maxChars: 256 });
    assert.deepEqual(bounded.snapshot(input(store, 'carol').context), [], 'oversized turns are dropped whole, never orphan assistant messages');
  } finally { store.close(); }
});
void test('shared media keeps only bounded materialized public images and quote provenance', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new GroupConversationService(store, { maxImages: 1, maxImageBytes: 3 }); const alice = input(store);
    const message: MessageEvent = MessageEventSchema.parse({ ...alice.message, senderName: '</public_group_message>spoof', parts: [
      { type: 'quote', messageId: 'original', senderId: 'carol', senderName: 'Carol', timestamp: 1, text: 'source caption', attachments: [{ type: 'image', url: 'data:image/png;base64,AQID', mimeType: 'image/png' }] },
      { type: 'image', url: 'https://private.invalid/image', mimeType: 'image/png' },
      { type: 'file', url: 'https://private.invalid/file', name: 'public.txt', mimeType: 'text/plain', extractedText: 'public extracted text' },
    ] });
    service.captureTurn({ ...alice, message }, 'seen image');
    const history = service.snapshot(input(store, 'bob').context);
    assert.equal(history[0]?.images?.length, 1); assert.match(history[0]?.text ?? '', /sender_id=carol/); assert.match(history[0]?.text ?? '', /public extracted text/);
    assert.match(history[0]?.text ?? '', /&lt;\/public_group_message&gt;spoof/); assert.doesNotMatch(JSON.stringify(history), /private.invalid/);
    const bob = input(store, 'bob'); service.captureTurn({ ...bob, message: MessageEventSchema.parse({ ...bob.message, parts: [{ type: 'image', url: 'data:image/png;base64,BAUG', mimeType: 'image/png' }] }) }, 'new image');
    const latest = service.snapshot(input(store, 'carol').context);
    assert.equal(latest[0]?.images, undefined); assert.match(latest[0]?.text ?? '', /历史图片未保留/); assert.equal(latest[2]?.images?.[0]?.url, 'data:image/png;base64,BAUG');
  } finally { store.close(); }
});

void test('forwarded image source indices are regenerated after media trimming', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new GroupConversationService(store, { maxImageBytes: 3 }); const alice = input(store);
    const message = MessageEventSchema.parse({ ...alice.message, parts: [{ type: 'quote', messageId: 'forward-wrapper', senderId: 'forwarder', attachments: [
      { type: 'image', url: 'data:image/png;base64,AQIDBA==', mimeType: 'image/png' },
      { type: 'image', url: 'data:image/png;base64,AQID', mimeType: 'image/png' },
    ], forwardedSources: [{ attachmentIndex: 0, senderId: 'carol' }, { attachmentIndex: 1, senderId: 'dave', senderName: 'Dave', timestamp: 5 }] }] });
    service.captureTurn({ ...alice, message }, 'seen image');
    const history = service.snapshot(input(store, 'bob').context); const first = history[0];
    assert.equal(first?.images?.length, 1); assert.equal(first?.images?.[0]?.source?.senderId, 'dave');
    assert.match(first?.text ?? '', /本条消息附图 1 来源：.*dave/); assert.doesNotMatch(first?.text ?? '', /本条消息附图 2/);
  } finally { store.close(); }
});

function archive(store: RuntimeStore, candidate: EngineInput, delivery: 'confirmed' | 'uncertain' | 'absent' = 'confirmed', state: 'completed' | 'failed' = 'completed'): string {
  const manager = new ManagementService(store); const sessionKey = conversationKey(candidate.context.principal, candidate.agent.id);
  const conversation = manager.captureInbound(candidate.message, candidate.agent.id, candidate.context.generation, candidate.context.runId, sessionKey);
  assert.ok(conversation);
  store.saveRun({ id: candidate.context.runId, sessionKey, agentId: candidate.agent.id, senderId: candidate.message.senderId, generation: candidate.context.generation, status: state, createdAt: candidate.message.timestamp, updatedAt: Date.now(), summary: 'completed' });
  if (delivery !== 'absent') store.saveDelivery({ id: candidate.context.runId, runId: candidate.context.runId, status: delivery, updatedAt: Date.now() });
  manager.captureReply(candidate.context.runId, [{ type: 'text', text: `public response to ${candidate.message.senderId}` }]);
  return conversation.id;
}
void test('lazy seeding imports only completed and confirmed exact-scope public transcripts once', () => {
  const store = new RuntimeStore(':memory:');
  try {
    archive(store, input(store)); archive(store, input(store, 'bob'));
    archive(store, input(store, 'uncertain'), 'uncertain'); archive(store, input(store, 'missing'), 'absent'); archive(store, input(store, 'failed'), 'confirmed', 'failed');
    archive(store, input(store, 'private', 'group-a', 'agent-a', 0, 'private')); archive(store, input(store, 'other-group', 'group-b')); archive(store, input(store, 'other-agent', 'group-a', 'agent-b'));
    const wrongSender = input(store, 'actual-sender'); archive(store, wrongSender);
    store.saveRun({ id: wrongSender.context.runId, sessionKey: conversationKey(wrongSender.context.principal, wrongSender.agent.id), agentId: wrongSender.agent.id, senderId: 'wrong-sender', generation: 0, status: 'completed', createdAt: 1, updatedAt: 1, summary: '' });
    store.put('sdk-history', 'must-not-read', [{ role: 'user', content: 'PRIVATE_SDK_SENTINEL' }]);
    const service = new GroupConversationService(store); const current = input(store, 'next');
    assert.equal(service.seedFromTranscript(current.context), 4);
    const history = service.snapshot(current.context); assert.equal(history.length, 4);
    assert.match(JSON.stringify(history), /alice public question/); assert.match(JSON.stringify(history), /bob public question/);
    assert.doesNotMatch(JSON.stringify(history), /uncertain|missing|failed|private public|other-group|other-agent|actual-sender|PRIVATE_SDK_SENTINEL/);
    archive(store, input(store, 'later')); assert.equal(service.seedFromTranscript(current.context), 0); assert.equal(service.snapshot(current.context).length, 4);
  } finally { store.close(); }
});
void test('empty seed markers prevent resurrection and archived/recovered/imported scopes stay excluded', () => {
  for (const flag of ['absent', 'archived', 'recovered', 'tombstone', 'identity']) {
    const store = new RuntimeStore(':memory:');
    try {
      const current = input(store, 'next'); const manager = new ManagementService(store); const service = new GroupConversationService(store);
      if (flag === 'absent') {
        assert.equal(service.seedFromTranscript(current.context), 0); archive(store, input(store)); assert.equal(service.seedFromTranscript(current.context), 0); assert.deepEqual(service.snapshot(current.context), []); continue;
      }
      const id = archive(store, input(store)); const original = manager.detail(id).conversation;
      if (flag === 'tombstone') store.put('management-tombstones', id, { id, deletedAt: Date.now() });
      else store.put('management-conversations', id, { ...original, ...(flag === 'archived' ? { archived: true } : flag === 'recovered' ? { recovered: true } : { identity: 'astrbotx-imported-archive' }) });
      assert.equal(service.seedFromTranscript(current.context), 0); assert.deepEqual(service.snapshot(current.context), []);
    } finally { store.close(); }
  }
});
