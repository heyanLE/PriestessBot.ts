import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { root } from './v3-test-support.mjs';
const router = readFileSync(`${root}/src/router/index.ts`, 'utf8');
const sidebar = readFileSync(`${root}/src/components/AppLayout.vue`, 'utf8');
assert.ok(router.includes("path: '/workspaces', redirect: '/agents'"));
assert.ok(!sidebar.includes("to: '/workspaces'"));
for (const path of ['/agents', '/ims', '/llms', '/resources/skills', '/resources/memories', '/resources/mcp', '/resources/personas', '/logs/system', '/logs/executions']) assert.ok(sidebar.includes(`to: '${path}'`));
console.log('V3 navigation smoke passed: independent Agents, platform resources and separate log views.');
