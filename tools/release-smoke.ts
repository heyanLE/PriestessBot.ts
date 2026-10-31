import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
const exec = promisify(execFile);
const image = process.env['PRIESTESS_RELEASE_IMAGE'] ?? 'priestess-ts:integration';
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const container = `priestess-release-test-${suffix}`;
const volume = `${container}-data`;
const token = randomBytes(24).toString('hex');
const marker = `release-persistence-${suffix}`;
const docker = async (args: readonly string[], timeout = 30_000): Promise<string> => (await exec('docker', [...args], { timeout, maxBuffer: 1_000_000 })).stdout.trim();
const imageSchema = z.object({ Id: z.string(), Architecture: z.string(), Os: z.string() });
const nativeSchema = z.object({ platform: z.literal('linux'), arch: z.string(), node: z.string(), sqlite: z.string(), rows: z.number(), pty: z.string() });
let createdVolume = false; let createdContainer = false;
async function waitHealthy(base: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch { /* Restart briefly closes the listener. */ }
    await new Promise<void>(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Release container did not become healthy');
}
try {
  const metadataRaw: unknown = JSON.parse(await docker(['image', 'inspect', image, '--format', '{{json .}}'])); const metadata = imageSchema.parse(metadataRaw);
  await docker(['volume', 'create', volume]); createdVolume = true;
  await docker(['run', '--detach', '--name', container, '--mount', `type=volume,src=${volume},dst=/data`, '--publish', '127.0.0.1::8081', '--env', `PRIESTESS_API_TOKEN=${token}`, image]); createdContainer = true;
  const port = /^127\.0\.0\.1:(\d+)$/.exec(await docker(['port', container, '8081/tcp']))?.[1]; if (!port) throw new Error('Expected a loopback-only ephemeral release port');
  let base = `http://127.0.0.1:${port}`; await waitHealthy(base);
  const health = z.object({ status: z.literal('ok'), runtime: z.literal('priestess-ts'), engine: z.literal('agents_sdk') }).parse(await (await fetch(`${base}/health`)).json());
  assert.equal((await fetch(`${base}/api/ts/config`)).status, 401);
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const configuration = z.object({ config: z.object({ platforms: z.array(z.unknown()), agents: z.array(z.object({ id: z.string() })), memoryLibraries: z.array(z.object({ id: z.string() })) }) }).parse(await (await fetch(`${base}/api/ts/config`, { headers })).json());
  assert.equal(configuration.config.platforms.length, 0, 'Release smoke must never start real IM consumers');
  const agent = configuration.config.agents[0]; const library = configuration.config.memoryLibraries[0]; assert.ok(agent); assert.ok(library);
  const dashboard = await fetch(base); assert.equal(dashboard.status, 200); const html = await dashboard.text(); assert.match(html, /<div id="app"><\/div>/);
  const script = /<script[^>]*src="([^"]+)"/.exec(html)?.[1]; assert.ok(script); const bundle = await fetch(new URL(script, base)); assert.equal(bundle.status, 200); assert.ok((await bundle.text()).length > 1000);
  const nativeScript = `import { DatabaseSync } from 'node:sqlite'; import { spawn } from 'node-pty'; const db = new DatabaseSync('/data/release-native.sqlite'); db.exec("CREATE TABLE IF NOT EXISTS probe(value TEXT NOT NULL); INSERT INTO probe VALUES('persistent')"); const row = db.prepare('SELECT COUNT(*) AS count FROM probe').get(); const version = db.prepare('SELECT sqlite_version() AS version').get(); const terminal = spawn('/bin/sh', ['-c', 'printf LINUX_PTY_CONFIRMED'], { name: 'xterm-color', cols: 80, rows: 24, cwd: '/data', env: { PATH: '/usr/local/bin:/usr/bin:/bin' } }); let output = ''; terminal.onData(data => { output += data; }); await new Promise((resolve, reject) => { const timer = setTimeout(() => { terminal.kill(); reject(new Error('PTY timeout')); }, 5000); terminal.onExit(event => { clearTimeout(timer); if (event.exitCode === 0) resolve(); else reject(new Error('PTY failed')); }); }); console.log(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, sqlite: version.version, rows: Number(row.count), pty: output })); db.close();`;
  const nativeRaw: unknown = JSON.parse(await docker(['exec', container, 'node', '--input-type=module', '-e', nativeScript])); const native = nativeSchema.parse(nativeRaw); assert.equal(native.pty, 'LINUX_PTY_CONFIRMED'); assert.equal(native.rows, 1);
  const created = await fetch(`${base}/api/ts/memory`, { method: 'POST', headers, body: JSON.stringify({ libraryId: library.id, agentId: agent.id, principal: { platform: 'release-fixture', sessionId: 'release-session', senderId: 'release-user' }, scope: 'sender', text: marker, source: 'release-smoke', confidence: 1 }) }); assert.equal(created.status, 201, await created.text());
  await docker(['restart', '--time', '10', container]);
  const restartPort = /^127\.0\.0\.1:(\d+)$/.exec(await docker(['port', container, '8081/tcp']))?.[1]; if (!restartPort) throw new Error('Release port missing after restart'); base = `http://127.0.0.1:${restartPort}`; await waitHealthy(base);
  const memories = z.object({ memories: z.array(z.object({ text: z.string() })) }).parse(await (await fetch(`${base}/api/ts/memory`, { headers })).json()); assert.ok(memories.memories.some(record => record.text === marker));
  const persistedCount = await docker(['exec', container, 'node', '--input-type=module', '-e', "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/data/release-native.sqlite'); console.log(db.prepare('SELECT COUNT(*) AS count FROM probe').get().count); db.close();"]); assert.equal(persistedCount, '1');
  const report = { verifiedAt: new Date().toISOString(), image, imageId: metadata.Id, imageOs: metadata.Os, imageArchitecture: metadata.Architecture, native, health, checks: { management401: true, dashboardHtml: true, dashboardAsset: true, noImConsumers: true, sqliteNative: true, linuxPty: true, apiMemorySurvivesRestart: true, sqliteSurvivesRestart: true }, scope: 'Local Docker release qualification; no external production deployment and no live IM messages.' };
  const output = process.env['PRIESTESS_RELEASE_REPORT'] ?? 'docs/release-qualification.json'; await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); process.stdout.write(JSON.stringify(report) + '\n');
} catch (error) {
  if (createdContainer) process.stderr.write(JSON.stringify({ state: await docker(['inspect', container, '--format', '{{json .State}}']), logs: await docker(['logs', '--tail', '15', container]) }) + '\n');
  throw error;
} finally {
  if (createdContainer) await docker(['rm', '--force', container]);
  if (createdVolume) await docker(['volume', 'rm', volume]);
}
