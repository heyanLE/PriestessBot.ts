import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { defaultConfiguration, PriestessRuntime } from '../apps/server/src/runtime.js';
import { CompactionRecordSchema } from '../packages/adapters/src/agents/session.js';
import { MessageEventSchema, RuntimeConfigSchema } from '../packages/contracts/src/index.js';

const secrets = new Map<string, string>();
for (const line of (await readFile(process.env['PRIESTESS_LEGACY_LOCAL_PROPERTIES'] ?? 'archive/kotlin/local.properties', 'utf8')).split(/\r?\n/)) { const index = line.indexOf('='); if (index > 0 && !line.trimStart().startsWith('#')) secrets.set(line.slice(0, index).trim(), line.slice(index + 1).trim()); }
const LegacySchema = z.object({ llms: z.array(z.object({ id: z.string(), endpoint: z.string(), credentialRef: z.object({ key: z.string() }) })), agents: z.array(z.object({ llm: z.object({ model: z.string() }) })) });
const raw: unknown = JSON.parse(await readFile(process.env['PRIESTESS_LEGACY_DEBUG_CONFIG'] ?? 'archive/kotlin/config.local-debug.json', 'utf8')); const legacy = LegacySchema.parse(raw);
const connection = legacy.llms[0]; const oldAgent = legacy.agents[0]; if (!connection || !oldAgent) throw new Error('Local smoke configuration is incomplete');
const base = defaultConfiguration(); const original = base.agents[0]; if (!original) throw new Error('Default Agent missing');
const config = RuntimeConfigSchema.parse({ ...base, connections: [{ id: 'default', baseUrl: connection.endpoint, apiKeyEnv: connection.credentialRef.key, protocol: 'chat_completions' }], agents: [{ ...original, capabilities:['chat'], resources:{}, contextPolicy:{contextWindowTokens:20000,compactAtTokens:2048,targetTokens:1024,summaryMaxTokens:512}, budget:{maxTokens:15000}, model: oldAgent.llm.model, instructions: 'You are a smoke-test assistant. Follow the requested tool call exactly. Never invent tool success.' }] });
const runtime = new PriestessRuntime({ database: ':memory:', config, secret: name => secrets.get(name) });
try {
  const event=(text:string)=>MessageEventSchema.parse({platform:'context-smoke',platformType:'telegram',sessionId:'synthetic-context',sessionType:'private',senderId:'test',senderName:'Test',messageId:crypto.randomUUID(),timestamp:Date.now(),parts:[{type:'text',text}],botId:'test'});
  const first=runtime.submit(event('合成验收事实：用户偏好绿色界面，后续任务不重复已经完成的文件写入。\n'.repeat(240)+'请只回复已记录，不调用任何工具。')); await runtime.idle();
  if(runtime.detail(first.id).run.status!=='completed')throw new Error('Initial context turn did not complete');
  const second=runtime.submit(event('测试中的界面颜色偏好是什么？只回答颜色。'));await runtime.idle();
  const records=runtime.store.list('sdk-compactions',CompactionRecordSchema);
  const success=runtime.detail(second.id).run.status==='completed' && records.some(record=>record.strategy==='semantic-summary-v1');
  process.stdout.write(JSON.stringify({success,compactions:records.map(record=>({strategy:record.strategy,before:record.estimatedTokensBefore,after:record.estimatedTokensAfter,fallback:record.fallbackReason})),reply:runtime.detail(second.id).run.summary})+'\n');if(!success)process.exitCode=1;
} catch {process.stdout.write(JSON.stringify({success:false,stage:'context-compaction'})+'\n');process.exitCode=1;}
finally {await runtime.stop();}
