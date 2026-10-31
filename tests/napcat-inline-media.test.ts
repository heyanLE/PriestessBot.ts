import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { PlatformConfigSchema, type ContentPart, type ReplyPlan } from '../packages/contracts/src/index.js';
import { NapCatAdapter } from '../packages/adapters/src/platforms/napcat.js';
import { MemoryStateStore, PlatformError } from '../packages/adapters/src/platforms/transport.js';
import type { AdapterDependencies, PlatformTarget } from '../packages/adapters/src/platforms/types.js';

interface CapturedRequest { readonly action: string; readonly body: unknown; }
const group = { kind: 'group', chatId: '81' } satisfies PlatformTarget;
const privateChat = { kind: 'private', chatId: '42' } satisfies PlatformTarget;
const json = (data: unknown, status = 'ok', retcode = 0): Response => new Response(JSON.stringify({ status, retcode, data }));
const imagePart = (name: string): Extract<ContentPart, { type: 'image' }> => ({ type: 'image', url: `artifact:${name}`, mimeType: 'image/png' });
const imageSegment = (name: string): { type: 'image'; data: { file: string } } => ({ type: 'image', data: { file: `base64://${Buffer.from(`artifact:${name}`).toString('base64')}` } });
const textSegment = (text: string): { type: 'text'; data: { text: string } } => ({ type: 'text', data: { text } });
const quote = { type: 'reply', data: { id: 'original' } };
const segmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), data: z.object({ text: z.string() }).strict() }).strict(),
  z.object({ type: z.literal('image'), data: z.object({ file: z.string() }).strict() }).strict(),
  z.object({ type: z.literal('reply'), data: z.object({ id: z.string() }).strict() }).strict(),
]);
const messageSchema = z.object({ group_id: z.string().optional(), user_id: z.string().optional(), message: z.array(segmentSchema) }).strict();
type Segment = z.infer<typeof segmentSchema>;

function fixture(options: {
  state?: MemoryStateStore;
  respond?: (request: CapturedRequest) => Response | Promise<Response> | undefined;
  dependencies?: Partial<AdapterDependencies>;
} = {}): { adapter: NapCatAdapter; requests: CapturedRequest[] } {
  const config = PlatformConfigSchema.parse({ id: 'inline-qq', type: 'napcat', websocketUrl: 'ws://127.0.0.1:1', apiBase: 'http://fixture.invalid', forwardThreshold: 0 });
  if (config.type !== 'napcat') throw new Error('Invalid fixture');
  const requests: CapturedRequest[] = [];
  const adapter = new NapCatAdapter(config, {
    state: options.state ?? new MemoryStateStore(), secret: () => undefined,
    resolveMedia: part => Promise.resolve({ bytes: Buffer.from(part.url), mimeType: 'image/png', name: 'fixture.png' }),
    resolvePublicMediaUrl: part => Promise.resolve(`https://runtime.example/signed/${encodeURIComponent(part.url)}`),
    ...options.dependencies,
    fetch: async (url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Missing request body');
      const body: unknown = JSON.parse(init.body);
      const request = { action: new URL(url).pathname.slice(1), body };
      requests.push(request);
      const custom = options.respond?.(request); if (custom !== undefined) return custom;
      if (request.action.startsWith('send_')) return json({ message_id: requests.length });
      if (request.action.startsWith('upload_')) return json(null);
      throw new Error(`Unexpected fixture action: ${request.action}`);
    },
  });
  return { adapter, requests };
}

function ordinaryMessages(requests: readonly CapturedRequest[]): Segment[][] {
  return requests.filter(request => request.action === 'send_group_msg' || request.action === 'send_private_msg').map(request => messageSchema.parse(request.body).message);
}
function semanticChain(messages: readonly (readonly Segment[])[]): ({ type: 'text'; text: string } | { type: 'image'; file: string })[] {
  const chain: ({ type: 'text'; text: string } | { type: 'image'; file: string })[] = [];
  for (const message of messages) for (const segment of message) {
    if (segment.type === 'reply') continue;
    if (segment.type === 'image') { chain.push({ type: 'image', file: segment.data.file }); continue; }
    const previous = chain.at(-1);
    if (previous?.type === 'text') previous.text += segment.data.text;
    else chain.push({ type: 'text', text: segment.data.text });
  }
  return chain;
}

for (const target of [group, privateChat]) {
  await test(`NapCat ${target.kind} sends interleaved text and images as one quoted message`, async () => {
    const { adapter, requests } = fixture();
    const outcome = await adapter.send(target, { replyTo: 'original', parts: [
      { type: 'text', text: 'before' }, imagePart('one'), { type: 'text', text: 'between' }, imagePart('two'), { type: 'text', text: 'after' },
    ] }, 'inline');
    assert.equal(outcome.status, 'confirmed');
    assert.deepEqual(requests.map(request => request.action), [target.kind === 'group' ? 'send_group_msg' : 'send_private_msg']);
    const body = messageSchema.parse(requests[0]?.body);
    assert.equal(body.group_id, target.kind === 'group' ? '81' : undefined);
    assert.equal(body.user_id, target.kind === 'private' ? '42' : undefined);
    assert.deepEqual(body.message, [quote, textSegment('before'), imageSegment('one'), textSegment('between'), imageSegment('two'), textSegment('after')]);
  });
}

await test('NapCat sends image-only replies as one message and adds the quote once', async () => {
  const { adapter, requests } = fixture();
  assert.equal((await adapter.send(group, { replyTo: 'original', parts: [imagePart('one'), imagePart('two')] }, 'images-only')).status, 'confirmed');
  assert.deepEqual(requests.map(request => request.action), ['send_group_msg']);
  assert.deepEqual(ordinaryMessages(requests), [[quote, imageSegment('one'), imageSegment('two')]]);
});

for (const target of [group, privateChat]) {
  await test(`NapCat ${target.kind} preserves file boundaries between inline image/text batches`, async () => {
    const { adapter, requests } = fixture();
    const outcome = await adapter.send(target, { replyTo: 'original', parts: [
      { type: 'text', text: 'before file' }, imagePart('one'),
      { type: 'file', url: 'artifact:notes', mimeType: 'text/plain', name: 'notes.txt' },
      imagePart('two'), { type: 'text', text: 'after file' },
    ] }, 'file-boundary');
    assert.equal(outcome.status, 'confirmed');
    const sendAction = target.kind === 'group' ? 'send_group_msg' : 'send_private_msg';
    assert.deepEqual(requests.map(request => request.action), [sendAction, target.kind === 'group' ? 'upload_group_file' : 'upload_private_file', sendAction]);
    assert.deepEqual(ordinaryMessages(requests), [[quote, textSegment('before file'), imageSegment('one')], [quote, imageSegment('two'), textSegment('after file')]]);
    assert.deepEqual(requests[1]?.body, {
      ...(target.kind === 'group' ? { group_id: '81' } : { user_id: '42' }),
      file: 'https://runtime.example/signed/artifact%3Anotes', name: 'notes.txt',
    });
  });
}

await test('NapCat disabled forwarding paginates long text without losing or repeating surrounding images', async () => {
  const { adapter, requests } = fixture();
  const longText = 'a'.repeat(7001);
  const outcome = await adapter.send(group, { replyTo: 'original', parts: [imagePart('one'), { type: 'text', text: longText }, imagePart('two'), { type: 'text', text: 'tail' }] }, 'long-inline');
  assert.equal(outcome.status, 'confirmed');
  assert.deepEqual(requests.map(request => request.action), ['send_group_msg', 'send_group_msg', 'send_group_msg']);
  const messages = ordinaryMessages(requests);
  for (const message of messages) {
    assert.deepEqual(message[0], quote);
    assert.equal(message.filter(segment => segment.type === 'reply').length, 1);
    assert.ok(message.reduce((total, segment) => total + (segment.type === 'text' ? segment.data.text.length : 0), 0) <= 3500);
  }
  assert.deepEqual(semanticChain(messages), [
    { type: 'image', file: imageSegment('one').data.file }, { type: 'text', text: longText },
    { type: 'image', file: imageSegment('two').data.file }, { type: 'text', text: 'tail' },
  ]);
});

await test('NapCat pagination budgets all text parts in a chain and never splits surrogate pairs', async () => {
  const { adapter, requests } = fixture();
  const first = 'a'.repeat(3499); const second = `😀${'b'.repeat(3497)}😀`;
  const outcome = await adapter.send(privateChat, { replyTo: 'original', parts: [
    { type: 'text', text: first }, imagePart('one'), { type: 'text', text: second }, imagePart('two'), { type: 'text', text: 'end' },
  ] }, 'unicode-budget');
  assert.equal(outcome.status, 'confirmed');
  const messages = ordinaryMessages(requests);
  assert.equal(messages.length, 3);
  for (const message of messages) {
    assert.deepEqual(message[0], quote);
    assert.equal(message.filter(segment => segment.type === 'reply').length, 1);
    const texts = message.flatMap(segment => segment.type === 'text' ? [segment.data.text] : []);
    assert.ok(texts.reduce((total, text) => total + text.length, 0) <= 3500);
    for (const text of texts) assert.equal(Buffer.from(text).toString('utf8'), text, 'Every text segment must contain complete Unicode code points');
  }
  assert.deepEqual(semanticChain(messages), [
    { type: 'text', text: first }, { type: 'image', file: imageSegment('one').data.file },
    { type: 'text', text: second }, { type: 'image', file: imageSegment('two').data.file }, { type: 'text', text: 'end' },
  ]);
});

await test('NapCat uncertain inline delivery blocks replay after restart without splitting the batch', async () => {
  const state = new MemoryStateStore(); let sends = 0;
  const plan: ReplyPlan = { parts: [{ type: 'text', text: 'before' }, imagePart('one'), { type: 'text', text: 'after' }] };
  const first = fixture({ state, respond: () => { sends++; throw new Error('Connection closed after write'); } });
  assert.equal((await first.adapter.send(group, plan, 'uncertain')).status, 'uncertain');
  assert.deepEqual(first.requests.map(request => request.action), ['send_group_msg']);
  assert.deepEqual(ordinaryMessages(first.requests), [[textSegment('before'), imageSegment('one'), textSegment('after')]]);
  const restarted = fixture({ state, respond: () => { sends++; throw new Error('Must not retry'); } });
  assert.equal((await restarted.adapter.send(group, plan, 'uncertain')).status, 'uncertain');
  assert.equal(sends, 1); assert.deepEqual(restarted.requests, []);
});

await test('NapCat confirmed inline receipt remains idempotent after restart', async () => {
  const state = new MemoryStateStore();
  const plan: ReplyPlan = { parts: [{ type: 'text', text: 'caption' }, imagePart('one'), imagePart('two')] };
  const first = fixture({ state });
  const confirmed = await first.adapter.send(privateChat, plan, 'confirmed');
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(first.requests.length, 1);
  const restarted = fixture({ state });
  assert.deepEqual(await restarted.adapter.send(privateChat, plan, 'confirmed'), confirmed);
  assert.deepEqual(restarted.requests, []);
});

await test('NapCat image preparation failure does not send a partial text-only batch', async () => {
  const { adapter, requests } = fixture({ dependencies: { resolveMedia: () => Promise.reject(new PlatformError('rejected', 'Image unavailable')) } });
  const outcome = await adapter.send(group, { parts: [{ type: 'text', text: 'caption' }, imagePart('one'), { type: 'text', text: 'tail' }] }, 'failed-image');
  assert.equal(outcome.status, 'failed');
  assert.deepEqual(requests, []);
});

await test('NapCat checks authorization after preparing images before sending any of the batch', async () => {
  let revoked = false; let checks = 0;
  const { adapter, requests } = fixture({ dependencies: { resolveMedia: part => {
    revoked = true;
    return Promise.resolve({ bytes: Buffer.from(part.url), mimeType: 'image/png', name: 'fixture.png' });
  } } });
  const outcome = await adapter.send(group, { parts: [{ type: 'text', text: 'caption' }, imagePart('one')] }, 'revoked-image', () => {
    checks++; if (revoked) throw new Error('Permission revoked');
  });
  assert.equal(outcome.status, 'failed'); assert.ok(checks >= 1); assert.deepEqual(requests, []);
});

await test('NapCat revoked authorization after an inline batch prevents the following file upload', async () => {
  let revoked = false;
  const { adapter, requests } = fixture({ respond: request => {
    if (request.action === 'send_group_msg') revoked = true;
    return undefined;
  } });
  const outcome = await adapter.send(group, { parts: [
    { type: 'text', text: 'caption' }, imagePart('one'), { type: 'file', url: 'artifact:notes', mimeType: 'text/plain', name: 'notes.txt' },
  ] }, 'revoked-file', () => { if (revoked) throw new Error('Permission revoked'); });
  assert.equal(outcome.status, 'failed'); assert.equal(outcome.messageIds.length, 1);
  assert.deepEqual(requests.map(request => request.action), ['send_group_msg']);
  assert.deepEqual(ordinaryMessages(requests), [[textSegment('caption'), imageSegment('one')]]);
});
