import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { defaultConfiguration, PriestessRuntime } from '../apps/server/src/runtime.js';
import { MemoryRecordSchema, RuntimeConfigSchema } from '../packages/contracts/src/index.js';

const secrets = new Map<string, string>();
for (const line of (await readFile(process.env['PRIESTESS_LEGACY_LOCAL_PROPERTIES'] ?? 'archive/kotlin/local.properties', 'utf8')).split(/\r?\n/)) { const index = line.indexOf('='); if (index > 0 && !line.trimStart().startsWith('#')) secrets.set(line.slice(0, index).trim(), line.slice(index + 1).trim()); }
const LegacySchema = z.object({ llms: z.array(z.object({ id: z.string(), endpoint: z.string(), credentialRef: z.object({ key: z.string() }) })), agents: z.array(z.object({ llm: z.object({ model: z.string() }) })) });
const raw: unknown = JSON.parse(await readFile(process.env['PRIESTESS_LEGACY_DEBUG_CONFIG'] ?? 'archive/kotlin/config.local-debug.json', 'utf8')); const legacy = LegacySchema.parse(raw);
const connection = legacy.llms[0]; const oldAgent = legacy.agents[0]; if (!connection || !oldAgent) throw new Error('Local smoke configuration is incomplete');
const base = defaultConfiguration(); const original = base.agents[0]; if (!original) throw new Error('Default Agent missing');
const config = RuntimeConfigSchema.parse({ ...base, connections: [{ id: 'default', baseUrl: connection.endpoint, apiKeyEnv: connection.credentialRef.key, protocol: 'chat_completions' }], agents: [{ ...original, model: oldAgent.llm.model, instructions: 'You are a smoke-test assistant. Follow the requested tool call exactly. Never invent tool success.' }] });
const runtime = new PriestessRuntime({ database: ':memory:', config, secret: name => secrets.get(name) });
try {
  const scope = { agentId: 'assistant', libraryId: 'default', scope: 'sender', principal: { platform: 'isolated-smoke', sessionType: 'private', sessionId: 'memory-test', senderId: 'test' } };
  for (const [id,text] of [['qa-first','用户喜欢绿色主题的界面。'],['qa-second','用户界面配色偏好是绿色。']]) {
    if (!id || !text) throw new Error('Invalid smoke fixture');
    runtime.store.put('memories',id,MemoryRecordSchema.parse({...scope,id,text,source:`smoke:${id}`,confidence:0.9,createdAt:Date.now(),updatedAt:Date.now()}));
  }
  const proposal=await runtime.memoryMaintenance.preview(scope);
  runtime.memoryMaintenance.apply(proposal.id);
  process.stdout.write(JSON.stringify({success:true,sourceCount:proposal.sources.length,mergeCount:proposal.merges.length,resultCount:runtime.memory.list().length})+'\n');
} catch (error) { let reason=error instanceof Error?error.message:'Unknown failure'; for(const secret of secrets.values())if(secret.length>8)reason=reason.replaceAll(secret,'[redacted]'); process.stdout.write(JSON.stringify({success:false,stage:'memory-consolidation',reason:reason.slice(0,500)})+'\n'); process.exitCode=1; }
finally { await runtime.stop(); }
