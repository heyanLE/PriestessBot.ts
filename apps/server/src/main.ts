import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { RuntimeConfigSchema } from '../../../packages/contracts/src/index.js';
import { PriestessRuntime } from './runtime.js';
import { createRuntimeServer } from './http.js';

const dataDirectory = path.resolve(process.env['PRIESTESS_DATA_DIR'] ?? '.runtime');
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
let token = process.env['PRIESTESS_API_TOKEN'];
if (!token) {
  const tokenPath = path.join(dataDirectory, 'management-token');
  try { token = (await readFile(tokenPath, 'utf8')).trim(); }
  catch { token = randomBytes(32).toString('hex'); await writeFile(tokenPath, token, { mode: 0o600, flag: 'wx' }); }
  process.stdout.write(`Management token file: ${tokenPath}\n`);
}
let config;
if (process.env['PRIESTESS_CONFIG']) { const value: unknown = JSON.parse(await readFile(process.env['PRIESTESS_CONFIG'], 'utf8')); config = RuntimeConfigSchema.parse(value); }
const runtime = new PriestessRuntime({ database: path.join(dataDirectory, 'runtime.sqlite'), ...(config === undefined ? {} : { config }) });
await chmod(path.join(dataDirectory, 'runtime.sqlite'), 0o600);
const port = Number(process.env['PORT'] ?? '8081');
const host = process.env['HOST'] ?? '127.0.0.1';
const dashboard = path.resolve(process.env['PRIESTESS_DASHBOARD'] ?? 'dashboard/dist');
const server = createRuntimeServer(runtime, { token, artifacts: path.join(dataDirectory, 'artifacts'), dashboard, ...(process.env['PRIESTESS_PUBLIC_BASE_URL'] ? { publicBaseUrl: process.env['PRIESTESS_PUBLIC_BASE_URL'] } : {}) });
await runtime.startPlatforms();
server.listen(port, host, () => process.stdout.write(`PriestessBot listening on http://${host}:${port}\n`));
let stopping = false;
const shutdown = (): void => { if (stopping) return; stopping = true; server.close(); server.closeIdleConnections(); void runtime.stop().then(() => { server.closeAllConnections(); process.exitCode = 0; }).catch(() => { process.stderr.write('Runtime shutdown did not drain all work\n'); process.exitCode = 1; }); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
