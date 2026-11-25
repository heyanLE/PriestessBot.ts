import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ServerResponse } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { AgentDefinitionSchema, RuntimeConfigSchema, WorkspaceViewSchema, type WorkspaceView } from '../packages/contracts/src/index.js';
import { handleWorkspaceHttp } from '../apps/server/src/workspace-http.js';

const skill = (name: string) => `---\nname: ${name}\ndescription: ${name} description.\n---\nbody\n`;

await test('workspace API lists skill and MCP resources by zone without secrets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'priestess-workspace-http-'));
  try {
    await mkdir(path.join(root, 'global', 'skill', 'briefing'), { recursive: true });
    await writeFile(path.join(root, 'global', 'skill', 'briefing', 'SKILL.md'), skill('briefing'));
    await mkdir(path.join(root, 'global', 'mcp'), { recursive: true });
    await writeFile(path.join(root, 'global', 'mcp', 'search.json'), JSON.stringify({ id: 'search', transport: 'stdio', command: 'search', args: [], envRefs: { TOKEN: 'SECRET_REF' } }));
    await mkdir(path.join(root, 'agents', 'assistant', 'skill', 'private'), { recursive: true });
    await writeFile(path.join(root, 'agents', 'assistant', 'skill', 'private', 'SKILL.md'), skill('private'));
    await mkdir(path.join(root, 'agents', 'assistant', 'mcp'), { recursive: true });
    await writeFile(path.join(root, 'agents', 'assistant', 'mcp', 'research.json'), JSON.stringify({ id: 'research', transport: 'streamable_http', url: 'http://127.0.0.1/mcp' }));
    await mkdir(path.join(root, 'conversations', 'qq', 'group', 'room', 'skill', 'today'), { recursive: true });
    await writeFile(path.join(root, 'conversations', 'qq', 'group', 'room', 'skill', 'today', 'SKILL.md'), skill('today'));
    const agent = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant' });
    const config = RuntimeConfigSchema.parse({ runtime: 'priestess-ts', schemaVersion: 1, agents: [agent], workspace: { root, sandbox: false }, flow: { routing: { defaultAgentId: 'assistant', rules: [] } } });
    let status = 0; let body: WorkspaceView | undefined;
    // eslint-disable-next-line no-restricted-syntax -- a minimal request is sufficient for the handler protocol.
    const response = new ServerResponse({} as IncomingMessage);
    // eslint-disable-next-line no-restricted-syntax -- a minimal request is sufficient for the handler protocol.
    const request = { method: 'GET' } as IncomingMessage;
    const handled = await handleWorkspaceHttp({ config: () => config, request, response, url: new URL('http://localhost/api/ts/workspace'), json: (_response, code, value) => { status = code; body = WorkspaceViewSchema.parse(value); } });
    assert.equal(handled, true); assert.equal(status, 200);
    if (!body || !body.workspace) throw new Error('missing workspace view');
    assert.equal(body.workspace.root, root);
    const global = body.zones.find(zone => zone.id === 'global');
    if (!global) throw new Error('missing global zone');
    assert.deepEqual(global.areas, { skill: 1, mcp: 1, cache: 0, file: 0 });
    assert.deepEqual(global.skills.map(item => item.name), ['briefing']);
    assert.deepEqual(global.mcp.map(item => item.id), ['search']);
    const agentZone = body.zones.find(zone => zone.id === 'agent:assistant');
    if (!agentZone) throw new Error('missing agent zone');
    assert.deepEqual(agentZone.skills.map(item => item.name), ['private']);
    assert.deepEqual(agentZone.mcp.map(item => item.id), ['research']);
    const conversation = body.zones.find(zone => zone.zone === 'conversation');
    if (!conversation) throw new Error('missing conversation zone');
    assert.deepEqual(conversation.skills.map(item => item.name), ['today']);
    assert.deepEqual(conversation.mcp, []);
    assert.equal(JSON.stringify(body).includes('SECRET_REF'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
