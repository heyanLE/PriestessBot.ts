import { readFile, mkdir, chmod } from 'node:fs/promises';
import { z } from 'zod';
import { defaultConfiguration, PriestessRuntime } from '../apps/server/src/runtime.js';
import { RuntimeConfigSchema } from '../packages/contracts/src/index.js';
import { createRuntimeServer } from '../apps/server/src/http.js';

const secrets = new Map<string, string>();
for (const line of (await readFile(process.env['PRIESTESS_LEGACY_LOCAL_PROPERTIES'] ?? 'archive/kotlin/local.properties', 'utf8')).split(/\r?\n/)) { const index = line.indexOf('='); if (index > 0 && !line.trimStart().startsWith('#')) secrets.set(line.slice(0, index).trim(), line.slice(index + 1).trim()); }
const source: unknown = JSON.parse(await readFile(process.env['PRIESTESS_LEGACY_DEBUG_CONFIG'] ?? 'archive/kotlin/config.local-debug.json', 'utf8'));
const legacy = z.object({ llms: z.array(z.object({ endpoint: z.string(), credentialRef: z.object({ key: z.string() }) })), agents: z.array(z.object({ llm: z.object({ model: z.string() }) })) }).parse(source);
const provider = legacy.llms[0]; const oldAgent = legacy.agents[0]; if (!provider || !oldAgent) throw new Error('Incomplete test model configuration');
const base = defaultConfiguration(); const agent = base.agents[0]; if (!agent) throw new Error('Missing Agent');
const config = RuntimeConfigSchema.parse({ ...base, agents: [{ ...agent, model: oldAgent.llm.model }], platforms: [{ id: 'telegram_test', type: 'telegram', enabled: true, tokenEnv: 'TELEGRAM_TEST_TOKEN' }], connections: [{ id: 'default', baseUrl: provider.endpoint, protocol: 'chat_completions', apiKeyEnv: provider.credentialRef.key }] });
const directory = '/private/tmp/priestess-ts-live-telegram'; await mkdir(directory, { recursive: true, mode: 0o700 });
const runtime = new PriestessRuntime({ database: `${directory}/runtime.sqlite`, config, secret: name => secrets.get(name) }); await chmod(`${directory}/runtime.sqlite`, 0o600);
const token = process.env['PRIESTESS_API_TOKEN']; if (!token) throw new Error('Set a local management token');
const server = createRuntimeServer(runtime, { token, artifacts: `${directory}/artifacts`, dashboard: 'dashboard/dist' });
await runtime.startPlatforms();
server.listen(8082, '127.0.0.1', () => process.stdout.write('TypeScript Telegram smoke service ready at 127.0.0.1:8082\n'));
let stopping = false;
const stop = (): void => { if (stopping) return; stopping = true; server.close(); server.closeAllConnections(); void runtime.stop().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
