import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RunContext, tool } from '@openai/agents';
import { z } from 'zod';
import { AgentDefinitionSchema, MessageEventSchema, RunIdSchema, SessionIdSchema, type EngineInput } from '../packages/contracts/src/index.js';
import { ToolOutputRecordSchema } from '../packages/contracts/src/tool-output.js';
import { AuthorizationService } from '../packages/core/src/authorization.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { ToolOutputStore, toolOutputPrefix, wrapToolOutputs, type ToolOutputStoreOptions } from '../packages/adapters/src/agents/tool-output.js';
import { estimateTextTokens } from '../packages/adapters/src/agents/token-count.js';
import type { SdkLocalContext } from '../packages/adapters/src/agents/engine.js';

function setup(options: Partial<Pick<ToolOutputStoreOptions, 'maxResultBytes' | 'maxTotalBytes' | 'ttlMs'>> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'priestess-tool-output-')); const store = new RuntimeStore(':memory:'); const auth = new AuthorizationService([], store); let now = 1000;
  const agent = AgentDefinitionSchema.parse({ id: 'agent', displayName: 'Agent', capabilities: ['chat'], resources: { tools: ['web_search', 'mcp_lookup', 'plugin_lookup'] } });
  const message = MessageEventSchema.parse({ platform: 'qq', platformType: 'napcat', sessionId: 'group', sessionType: 'group', senderId: 'alice', messageId: 'm', timestamp: 1, botId: 'bot', parts: [] });
  const principal = { platform: message.platform, sessionType: message.sessionType, sessionId: message.sessionId, senderId: message.senderId };
  const input: EngineInput = { agent, message, session: { engine: 'agents_sdk', version: '0.21.0', id: 's' }, additionalContext: '', context: { ...auth.resolve(principal, agent, 'operator', ['chat']), principal, agentId: agent.id, runId: RunIdSchema.parse('run'), turnId: 't', generation: 0, configRevision: 0, flowRevision: 0, signal: new AbortController().signal, budget: agent.budget, depth: 0 } };
  const service = new ToolOutputStore({ store, rootDir: () => dir, guard: (current, source) => auth.assert(current.context, 'chat', current.agent, { kind: 'tools', id: source }), now: () => now, ...options });
  return { dir, store, auth, input, service, advance: (ms: number) => { now += ms; }, close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function savedId(store: RuntimeStore): string { const entry = store.list('tool-output-records', ToolOutputRecordSchema)[0]; assert.ok(entry); return entry.id; }

void test('AstrBotX thresholds use token weights, preserve short values, retain complete large output and page it', () => {
  const state = setup();
  try {
    const short = { count: 2, items: ['a', 'b'] }; assert.equal(state.service.process(state.input, 'web_search', short), short);
    const english = 'e'.repeat(50_000); assert.equal(state.service.process(state.input, 'web_search', english), english);
    const chinese = '汉'.repeat(50_000); const result = state.service.process(state.input, 'web_search', chinese); assert.equal(typeof result, 'string'); assert.match(String(result), /fullResultAvailable=true/);
    const id = savedId(state.store); const file = path.join(state.dir, `${id}.txt`); assert.equal(readFileSync(file, 'utf8'), chinese); assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(statSync(state.dir).mode & 0o777, 0o700);
    assert.ok(estimateTextTokens(String(result).split('\n[Tool output')[0] ?? '') <= 7000);
    let cursor = 0; let assembled = ''; let eof = false;
    while (!eof) { const page = state.service.read(state.input, { id, offset: cursor, limit: 16_000 }); assert.ok(estimateTextTokens(page.text) <= 7000); assert.ok(page.nextOffset > cursor); assembled += page.text; cursor = page.nextOffset; eof = page.eof; assert.equal(page.truncated, !eof); }
    assert.equal(assembled, chinese); assert.equal(state.service.read(state.input, { id, offset: 999_999, limit: 1 }).eof, true);
    assert.equal(state.input.context.effectiveCapabilities.includes('files.read'), false);
  } finally { state.close(); }
});
void test('smaller run budget truncates early; literal search paginates and never interprets a regex', () => {
  const state = setup();
  try {
    const text = `${'汉'.repeat(300)}[needle].*${'漢'.repeat(100)}[needle].*tail`;
    const result = state.service.process(state.input, 'web_search', text, { inlineTokens: 100, previewTokens: 20 }); const id = savedId(state.store);
    assert.ok(estimateTextTokens(String(result).split('\n[Tool output')[0] ?? '') <= 20);
    const first = state.service.search(state.input, { id, query: '[needle].*', limit: 1, contextChars: 20, maxTokens: 50 }); assert.equal(first.matches.length, 1); assert.equal(first.matches[0]?.offset, 300); assert.equal(first.eof, false);
    const second = state.service.search(state.input, { id, query: '[needle].*', offset: first.nextOffset, limit: 1, contextChars: 20 }); assert.equal(second.matches.length, 1); assert.equal(second.eof, true); assert.equal(second.truncated, false);
    assert.equal(state.service.search(state.input, { id, query: '^.*$' }).matches.length, 0);
  } finally { state.close(); }
});
void test('multimodal images and files remain structured; JSON strings are not misinterpreted as multimodal', () => {
  const state = setup();
  try {
    const image = { type: 'image', image: { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' } }; const file = { type: 'file', file: { url: 'https://example.com/a.pdf' } };
    const value = { content: [{ type: 'text', text: '中'.repeat(500) }, image, file], isError: false };
    const output = z.object({ content: z.array(z.unknown()), isError: z.boolean() }).parse(state.service.process(state.input, 'mcp_lookup', value, { inlineTokens: 100, previewTokens: 20 }));
    assert.equal(output.content[1], image); assert.equal(output.content[2], file); assert.equal(output.isError, false); assert.match(JSON.stringify(output.content[0]), /fullResultAvailable=true/);
    assert.equal(state.service.process(state.input, 'mcp_lookup', image, { inlineTokens: 1 }), image); assert.equal(state.service.process(state.input, 'mcp_lookup', file, { inlineTokens: 1 }), file);
    const json = JSON.stringify(value); const jsonOutput = state.service.process(state.input, 'mcp_lookup', json, { inlineTokens: 100, previewTokens: 20 }); assert.equal(typeof jsonOutput, 'string');
    assert.equal(state.store.list('tool-output-records', ToolOutputRecordSchema).length, 2);
  } finally { state.close(); }
});
void test('result scopes isolate sender, group, private chat, Agent, generation and privilege epochs; revoke rechecks source', () => {
  const state = setup();
  try {
    state.service.process(state.input, 'web_search', 'secret'.repeat(200), { inlineTokens: 10 }); const id = savedId(state.store); const current = state.input.context;
    const contexts = [
      { ...current, principal: { ...current.principal, senderId: 'bob' } }, { ...current, principal: { ...current.principal, sessionId: SessionIdSchema.parse('other') } },
      { ...current, principal: { ...current.principal, sessionType: 'private' } }, { ...current, agentId: AgentDefinitionSchema.parse({ id: 'other', displayName: 'Other' }).id },
      { ...current, generation: 1 }, { ...current, grantVersion: current.grantVersion + 1 }, { ...current, runtimeState: 'senior_operator' },
    ];
    for (const context of contexts) { const parsed = { ...state.input, context: { ...context, principal: { ...context.principal, sessionType: z.enum(['group', 'private']).parse(context.principal.sessionType) }, runtimeState: z.enum(['operator', 'senior_operator', 'elite_operator']).parse(context.runtimeState) } }; assert.throws(() => state.service.read(parsed, { id }), /not found/); }
    state.auth.replaceGrants([]); assert.throws(() => state.service.read(state.input, { id }), /Authorization changed/);
  } finally { state.close(); }
});
void test('single-result and global capacity limits fail honestly without truncating retained files; expiration releases capacity', () => {
  const state = setup({ maxResultBytes: 1000, maxTotalBytes: 1200, ttlMs: 10 });
  try {
    const tooLarge = state.service.process(state.input, 'web_search', 'x'.repeat(1100), { inlineTokens: 5 }); assert.match(String(tooLarge), /fullResultAvailable=false; reason=single_result_limit/); assert.equal(state.store.list('tool-output-records', ToolOutputRecordSchema).length, 0);
    state.service.process(state.input, 'web_search', 'a'.repeat(800), { inlineTokens: 5 }); const firstId = savedId(state.store);
    const capacity = state.service.process(state.input, 'web_search', 'b'.repeat(800), { inlineTokens: 5 }); assert.match(String(capacity), /fullResultAvailable=false; reason=storage_capacity/); assert.equal(state.service.read(state.input, { id: firstId }).text, 'a'.repeat(800));
    state.advance(11); assert.throws(() => state.service.read(state.input, { id: firstId }), /expired/);
    assert.match(String(state.service.process(state.input, 'web_search', 'b'.repeat(800), { inlineTokens: 5 })), /fullResultAvailable=true/); assert.equal(readdirSync(state.dir).length, 1);
  } finally { state.close(); }
});
void test('tampered, missing and symlink result files cannot masquerade as a complete result', () => {
  const state = setup();
  try {
    state.service.process(state.input, 'web_search', 'private'.repeat(200), { inlineTokens: 10 }); const id = savedId(state.store); const file = path.join(state.dir, `${id}.txt`);
    writeFileSync(file, 'x'.repeat(1400)); assert.throws(() => state.service.read(state.input, { id }), /unavailable/);
    unlinkSync(file); assert.throws(() => state.service.read(state.input, { id }), /unavailable/);
    symlinkSync('/etc/passwd', file); assert.throws(() => state.service.read(state.input, { id }), /unavailable/);
    assert.throws(() => state.service.read(state.input, { id: '../escape' }));
  } finally { state.close(); }
});
void test('storage failure has bounded preview with no private path disclosure', () => {
  const state = setup();
  try {
    const failure = new ToolOutputStore({ store: state.store, rootDir: () => { throw new Error('/private/credential'); }, guard: () => {} });
    const result = failure.process(state.input, 'web_search', 'x'.repeat(400), { inlineTokens: 10, previewTokens: 5 }); assert.match(String(result), /fullResultAvailable=false; reason=storage_unavailable/); assert.doesNotMatch(String(result), /credential/); assert.ok(String(result).length < 400);
  } finally { state.close(); }
});
void test('unified SDK wrapper catches builtin/MCP/plugin function results once and preserves approvals and short object results', async () => {
  const state = setup(); const parameters = z.object({}); let calls = 0;
  try {
    for (const name of ['web_search', 'mcp_lookup', 'plugin_lookup']) {
      const original = tool<typeof parameters, SdkLocalContext>({ name, description: 'test', parameters, needsApproval: true, execute: () => { calls++; return '汉'.repeat(600); } });
      const wrapped = wrapToolOutputs(state.input, [original], state.service, () => ({ inlineTokens: 100, previewTokens: 30 }))[0]; assert.ok(wrapped && wrapped.type === 'function'); assert.equal(wrapped.needsApproval, original.needsApproval);
      const result: unknown = await wrapped.invoke(new RunContext({ runId: state.input.context.runId }), '{}'); assert.match(String(result), /fullResultAvailable=true/);
    }
    assert.equal(calls, 3); assert.equal(state.store.list('tool-output-records', ToolOutputRecordSchema).length, 3);
  } finally { state.close(); }
});
void test('token prefix never cuts a surrogate pair and supports multilingual text', () => {
  const text = '😀汉a'.repeat(10_000); const prefix = toolOutputPrefix(text, 100);
  assert.ok(estimateTextTokens(prefix) <= 100); assert.equal(Buffer.from(prefix).toString('utf8'), prefix); assert.equal(text.startsWith(prefix), true);
});
void test('reader guidance honors tool bindings and malformed unicode never pretends a full copy was retained', () => {
  const state = setup();
  try {
    const text = '文'.repeat(500); const unavailable = state.service.process(state.input, 'web_search', text, { inlineTokens: 100 }); assert.match(String(unavailable), /read_tool_result is not mounted/); assert.doesNotMatch(String(unavailable), /Read with read_tool_result/);
    const mounted: EngineInput = { ...state.input, context: { ...state.input.context, resources: { ...state.input.context.resources, tools: [...state.input.context.resources.tools, 'read_tool_result', 'search_tool_result'] } } };
    const available = state.service.process(mounted, 'web_search', text, { inlineTokens: 100 }); assert.match(String(available), /Read with read_tool_result/); assert.match(String(available), /Search with search_tool_result/);
    const malformed = state.service.process(state.input, 'web_search', `${text}\ud800`, { inlineTokens: 100 }); assert.match(String(malformed), /fullResultAvailable=false; reason=invalid_unicode/);
  } finally { state.close(); }
});
void test('unindexed crash leftovers count against disk capacity, and an existing result survives service recreation', () => {
  const state = setup({ maxTotalBytes: 1000 });
  try {
    state.service.process(state.input, 'web_search', 'a'.repeat(300), { inlineTokens: 5 }); const id = savedId(state.store);
    const restarted = new ToolOutputStore({ store: state.store, rootDir: () => state.dir, guard: (input, source) => state.auth.assert(input.context, 'chat', input.agent, { kind: 'tools', id: source }), now: () => 1000, maxTotalBytes: 1000 });
    assert.equal(restarted.read(state.input, { id }).text, 'a'.repeat(300));
    writeFileSync(path.join(state.dir, 'orphan.txt'), 'b'.repeat(600)); assert.match(String(restarted.process(state.input, 'web_search', 'c'.repeat(300), { inlineTokens: 5 })), /reason=storage_capacity/);
  } finally { state.close(); }
});
void test('MCP structuredContent and metadata cannot bypass aggregate content limits; binary payloads survive', () => {
  const state = setup();
  try {
    const text = '全文'.repeat(800); const image = { type: 'image', image: { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' } }; const file = { type: 'file', file: { url: 'https://example.com/a.pdf' } };
    const value = { content: [{ type: 'text', text }, image, file], structuredContent: { document: text }, _meta: { detail: text }, isError: false };
    const result = z.object({ content: z.array(z.unknown()), structuredContent: z.string(), _meta: z.string(), isError: z.boolean() }).parse(state.service.process(state.input, 'mcp_lookup', value, { inlineTokens: 100, previewTokens: 60 }));
    assert.equal(result.content[1], image); assert.equal(result.content[2], file); assert.equal(result.isError, false); assert.doesNotMatch(result.structuredContent, new RegExp(text)); assert.match(result.structuredContent, /resultId=/); assert.match(result._meta, /resultId=/);
    const saved = state.store.list('tool-output-records', ToolOutputRecordSchema); assert.equal(saved.length, 3);
    const storedTexts = saved.map(item => readFileSync(path.join(state.dir, `${item.id}.txt`), 'utf8')); assert.ok(storedTexts.includes(text)); assert.ok(storedTexts.includes(JSON.stringify({ document: text }))); assert.ok(storedTexts.includes(JSON.stringify({ detail: text })));
    const duplicated = { content: [{ type: 'text', text: 'a'.repeat(200) }], structuredContent: { document: 'a'.repeat(200) } };
    const aggregate = z.object({ content: z.array(z.unknown()), structuredContent: z.string() }).parse(state.service.process(state.input, 'mcp_lookup', duplicated, { inlineTokens: 100, previewTokens: 30 })); assert.match(aggregate.structuredContent, /resultId=/);
    const nested = { content: [image], structuredContent: { text, binary: new Uint8Array([4, 5, 6]), file } };
    const nestedResult = z.object({ structuredContent: z.object({ text: z.string(), binary: z.unknown(), file: z.unknown() }) }).parse(state.service.process(state.input, 'mcp_lookup', nested, { inlineTokens: 100, previewTokens: 30 })); assert.equal(nestedResult.structuredContent.binary, nested.structuredContent.binary); assert.equal(nestedResult.structuredContent.file, file); assert.match(nestedResult.structuredContent.text, /resultId=/);
  } finally { state.close(); }
});
void test('result readers bypass recursive spill while retaining their original SDK tool instance', async () => {
  const state = setup(); const parameters = z.object({});
  try {
    for (const name of ['read_tool_result', 'search_tool_result', 'process_read_output']) {
      const original = tool<typeof parameters, SdkLocalContext>({ name, description: 'Paged reader', parameters, execute: () => 'already bounded page' });
      const wrapped = wrapToolOutputs(state.input, [original], state.service, () => ({ inlineTokens: 1, previewTokens: 1 }))[0]; assert.equal(wrapped, original); assert.ok(wrapped?.type === 'function');
      const result: unknown = await wrapped.invoke(new RunContext({ runId: state.input.context.runId }), '{}'); assert.equal(result, 'already bounded page');
    }
    assert.equal(state.store.list('tool-output-records', ToolOutputRecordSchema).length, 0);
  } finally { state.close(); }
});
void test('one-unit read pages preserve surrogate pairs, make progress, and repair an interior cursor', () => {
  const state = setup();
  try {
    const text = '😀a𠮷字😀'.repeat(20); state.service.process(state.input, 'web_search', text, { inlineTokens: 5 }); const id = savedId(state.store);
    let offset = 0; let full = '';
    while (offset < text.length) { const page = state.service.read(state.input, { id, offset, limit: 1, maxTokens: 1 }); assert.equal(Buffer.from(page.text).toString('utf8'), page.text); assert.ok(page.nextOffset > offset); assert.ok(page.text.length <= 2); assert.ok(estimateTextTokens(page.text) <= 1); full += page.text; offset = page.nextOffset; }
    assert.equal(full, text); const repaired = state.service.read(state.input, { id, offset: 1, limit: 1 }); assert.equal(repaired.offset, 0); assert.equal(repaired.text, '😀'); assert.equal(repaired.nextOffset, 2);
    const search = state.service.search(state.input, { id, query: 'a', contextChars: 1 }); for (const match of search.matches) assert.equal(Buffer.from(match.text).toString('utf8'), match.text);
  } finally { state.close(); }
});
void test('source ACL epochs invalidate old results even when the principal grant version stays unchanged', () => {
  const state = setup(); let epoch = 'plugin:qq_file:1';
  try {
    const service = new ToolOutputStore({ store: state.store, rootDir: () => state.dir, now: () => 1000, guard: (input, source) => state.auth.assert(input.context, 'chat', input.agent, { kind: 'tools', id: source }), sourceEpoch: (_input, source) => `${source}:${epoch}` });
    service.process(state.input, 'plugin_lookup', 'private group file'.repeat(100), { inlineTokens: 10 }); const id = savedId(state.store);
    assert.equal(service.read(state.input, { id }).fullResultAvailable, true); assert.equal(service.search(state.input, { id, query: 'private' }).matches.length, 10);
    epoch = 'plugin:qq_file:2'; assert.throws(() => service.read(state.input, { id }), /authorization configuration changed/); assert.throws(() => service.search(state.input, { id, query: 'private' }), /authorization configuration changed/);
    // Enabling epoch checks must also fail closed for old records without an epoch.
    state.service.process(state.input, 'web_search', 'legacy'.repeat(100), { inlineTokens: 10 }); const legacy = state.store.list('tool-output-records', ToolOutputRecordSchema).find(item => item.sourceToolName === 'web_search'); assert.ok(legacy); assert.equal(legacy.sourceEpoch, ''); assert.throws(() => service.read(state.input, { id: legacy.id }), /authorization configuration changed/);
  } finally { state.close(); }
});
