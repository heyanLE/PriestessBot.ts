import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanTerminalOutput, outputTokenLimit, ProcessOutputLog, TRUNCATION_MARKER, truncateOutput } from '../packages/adapters/src/execution/output.js';
import { ExecutionService } from '../packages/adapters/src/execution/environment.js';
import { AgentIdSchema, BudgetSchema, ResourceBindingsSchema, RunIdSchema, SessionIdSchema, type RunContext } from '../packages/contracts/src/index.js';
function context(): RunContext { return { runId: RunIdSchema.parse('output-test'), turnId: 'turn', principal: { platform: 'napcat', senderId: 'alice', sessionId: SessionIdSchema.parse('group'), sessionType: 'group' }, agentId: AgentIdSchema.parse('agent'), generation: 0, configRevision: 0, flowRevision: 0, runtimeState: 'elite_operator', effectiveCapabilities: ['process.execute.restricted', 'process.execute', 'process.pty'], resources: ResourceBindingsSchema.parse({ executionEnvironment: 'local' }), grantVersion: 0, signal: new AbortController().signal, budget: BudgetSchema.parse({}), depth: 0 }; }
await test('AstrBotX command budget keeps head and tail, normalizes terminals and clamps limits', () => {
  const source = `HEAD${'中'.repeat(5000)}TAIL`;
  const limited = truncateOutput(source, 256);
  assert.equal(limited.truncated, true); assert.ok(limited.output.length <= 1024);
  assert.ok(limited.output.startsWith('HEAD')); assert.ok(limited.output.endsWith('TAIL'));
  assert.ok(limited.output.includes(TRUNCATION_MARKER));
  assert.equal(cleanTerminalOutput('\u001b[31mRED\u001b[0m\r\nnext\rprogress\u0007'), 'RED\nnext\nprogress');
  assert.equal(outputTokenLimit(), 10_000); assert.equal(outputTokenLimit(1), 256); assert.equal(outputTokenLimit(90_000), 40_000);
});
await test('Private log preserves older output beyond the old 128k ring, before and after disk flush', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-output-log-'));
  const log = await ProcessOutputLog.create(root, 'session');
  try {
    const source = `FIRST${'汉🙂'.repeat(80_000)}LAST`;
    log.append(source.slice(0, 12345)); log.append(source.slice(12345));
    assert.equal(log.read().text, source); assert.equal(log.read(130_000, 10).text, source.slice(130_000, 130_010));
    await log.drain(); assert.equal(log.read().text, source);
    const names = await readdir(root); const name = names[0]; assert.ok(name);
    assert.equal((await stat(path.join(root, name))).mode & 0o777, 0o600);
  } finally { await log.close(); await rm(root, { recursive: true, force: true }); }
});
await test('Log cap reports an unrecoverable gap instead of silently moving cursors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-output-cap-'));
  const log = await ProcessOutputLog.create(root, 'session', 2000);
  try {
    log.append('A'.repeat(200_000)); await log.drain();
    const prefix = log.read(0, 1000); assert.equal(prefix.text.length, 1000); assert.equal(prefix.fullOutputAvailable, false); assert.equal(prefix.retainedThrough, 1000);
    const gap = log.read(1000, 20); assert.equal(gap.from, 72_000); assert.equal(gap.droppedChars, 71_000); assert.equal(gap.text, 'A'.repeat(20));
    const names = await readdir(root); const name = names[0]; assert.ok(name); assert.equal((await stat(path.join(root, name))).size, 2000);
  } finally { await log.close(); await rm(root, { recursive: true, force: true }); }
});
await test('PTY output can be read completely using nextOffset and explicit segments; revoked owners cannot read logs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-exec-output-')); let revoked = false;
  const service = new ExecutionService({ root, backend: 'local' }, (ctx, capability) => { ctx.signal.throwIfAborted(); if (revoked || !ctx.effectiveCapabilities.includes(capability)) throw new Error('grant revoked'); });
  const ctx = context();
  try {
    let result = await service.execute(ctx, "awk 'BEGIN { printf \"HEAD\"; for (i=0;i<200000;i++) printf \"x\"; printf \"TAIL\" }'", 40, 256);
    const deadline = Date.now() + 5000;
    while (result.status === 'running' && Date.now() < deadline) { await new Promise<void>(resolve => setTimeout(resolve, 20)); result = service.poll(ctx, result.id, 0, 256); }
    assert.equal(result.status, 'completed'); assert.equal(result.fullOutputAvailable, true); assert.ok(result.output.startsWith('HEAD')); assert.ok(result.output.endsWith('TAIL')); assert.ok(result.output.length <= 1024);
    assert.ok(result.nextOffset !== undefined && result.nextOffset < result.offset); assert.ok((result.originalChars ?? 0) > 128_000);
    let cursor = 0; let entire = '';
    while (cursor < result.offset) { const chunk = service.readOutput(ctx, result.id, cursor, 1000, 256); assert.equal(chunk.returnedFrom, cursor); assert.ok(chunk.nextOffset !== undefined && chunk.nextOffset > cursor); entire += chunk.output; cursor = chunk.nextOffset; }
    assert.equal(entire, `HEAD${'x'.repeat(200000)}TAIL`);
    assert.throws(() => service.readOutput({ ...ctx, principal: { ...ctx.principal, senderId: 'bob' } }, result.id), /not found/);
    revoked = true; assert.throws(() => service.readOutput(ctx, result.id), /revoked/);
  } finally { service.stop(); await service.drain(); await rm(root, { recursive: true, force: true }); }
});

await test('head-tail previews preserve astral Unicode boundaries',()=>{const source='HEAD'+'🙂'.repeat(5000)+'TAIL';const result=truncateOutput(source,256);assert.equal(Buffer.from(result.output,'utf8').toString('utf8'),result.output);assert.ok(result.output.length<=1024);assert.equal(source.charCodeAt(result.headChars)>=0xdc00&&source.charCodeAt(result.headChars)<=0xdfff,false);});
