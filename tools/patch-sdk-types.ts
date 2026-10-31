import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

// agents-core 0.21.0 declares an optional interface member narrower than its
// implemented getter under exactOptionalPropertyTypes. Align the declaration
// with the getter; retain strict checking for the entire dependency graph.
const file = new URL('../node_modules/@openai/agents-core/dist/result.d.ts', import.meta.url);
const source = readFileSync(file, 'utf8');
const before = 'agentToolInvocation?: AgentToolInvocation;';
const after = 'agentToolInvocation?: AgentToolInvocation | undefined;';
if (source.includes(before)) writeFileSync(file, source.replace(before, after));
else if (!source.includes(after)) throw new Error('Pinned SDK declaration changed; review and remove or update the exact-optional patch');

// node-pty's published prebuilt helper may lose its executable bit on extraction.
const helper = new URL(`../node_modules/node-pty/prebuilds/${process.platform}-${process.arch}/spawn-helper`, import.meta.url);
if (existsSync(helper)) chmodSync(helper, 0o755);
