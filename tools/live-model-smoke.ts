import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { defaultConfiguration, PriestessRuntime } from '../apps/server/src/runtime.js';
import { MessageEventSchema, RuntimeConfigSchema } from '../packages/contracts/src/index.js';

const secrets = new Map<string, string>();
for (const line of (await readFile(process.env['PRIESTESS_LEGACY_LOCAL_PROPERTIES'] ?? 'archive/kotlin/local.properties', 'utf8')).split(/\r?\n/)) { const index = line.indexOf('='); if (index > 0 && !line.trimStart().startsWith('#')) secrets.set(line.slice(0, index).trim(), line.slice(index + 1).trim()); }
const LegacySchema = z.object({ llms: z.array(z.object({ id: z.string(), endpoint: z.string(), credentialRef: z.object({ key: z.string() }) })), agents: z.array(z.object({ llm: z.object({ model: z.string() }) })) });
const raw: unknown = JSON.parse(await readFile(process.env['PRIESTESS_LEGACY_DEBUG_CONFIG'] ?? 'archive/kotlin/config.local-debug.json', 'utf8')); const legacy = LegacySchema.parse(raw);
const connection = legacy.llms[0]; const oldAgent = legacy.agents[0]; if (!connection || !oldAgent) throw new Error('Local smoke configuration is incomplete');
const base = defaultConfiguration(); const original = base.agents[0]; if (!original) throw new Error('Default Agent missing');
const config = RuntimeConfigSchema.parse({ ...base, connections: [{ id: 'default', baseUrl: connection.endpoint, apiKeyEnv: connection.credentialRef.key, protocol: 'chat_completions' }], agents: [{ ...original, model: oldAgent.llm.model, instructions: 'You are a smoke-test assistant. Follow the requested tool call exactly. Never invent tool success.' }] });
const runtime = new PriestessRuntime({ database: ':memory:', config, secret: name => secrets.get(name) });
try {
  const message = MessageEventSchema.parse({ platform: 'live-smoke', platformType: 'telegram', sessionId: 'isolated-model-test', sessionType: 'private', senderId: 'test', senderName: 'Test', messageId: crypto.randomUUID(), timestamp: Date.now(), parts: [{ type: 'text', text: '请调用 memory_save，把“TypeScript Agents SDK live smoke 2026-10-25”保存到 default 记忆库，然后只回复“工具已验证”。' }], botId: 'test' });
  const run = runtime.submit(message); await runtime.idle(); const detail = runtime.detail(run.id);
  const toolCalls = detail.events.flatMap(event => event.type === 'tool' && event.status === 'completed' ? [event.name] : []);
  const usage = detail.events.filter(event => event.type === 'usage').map(event => ({ input: event.inputTokens, output: event.outputTokens }));
  const succeeded = detail.run.status === 'completed' && runtime.memory.list().some(record => record.text.includes('TypeScript Agents SDK')) && toolCalls.includes('memory_save');
  process.stdout.write(JSON.stringify({ success: succeeded, status: detail.run.status, toolCalls, usage, reply: detail.run.summary }) + '\n');
  if (!succeeded) process.exitCode = 1;
} finally { await runtime.stop(); }
