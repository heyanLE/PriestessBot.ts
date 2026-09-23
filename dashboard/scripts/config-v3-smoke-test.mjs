import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { model, modelUrl, fixture, moduleUrl } from './v3-test-support.mjs';

assert.deepEqual(model.validateConfiguration(fixture()), []);
const invalid = fixture();
invalid.agents[0].llm.providerRef = 'missing';
invalid.agents[0].memory.writeLibraryId = 'unmounted';
invalid.ims[0].routes[0].match.sessionTypes = [];
invalid.ims[0].routes[1].action.agentId = 'missing';
invalid.llms.push({ ...invalid.llms[0] });
invalid.runtime.server.port = 65536;
assert.equal(
  model.validateConfiguration(invalid).length,
  6,
  'invalid references, duplicate IDs, port and routing constraints must be reported',
);
const routes = model.defaultRoutes('assistant');
assert.deepEqual(
  routes.map((route) => route.action.type),
  ['COMMAND', 'AGENT', 'COMMAND', 'AGENT'],
);
assert.deepEqual(
  routes.map((route) => route.match.sessionTypes[0]),
  ['GROUP', 'GROUP', 'PRIVATE', 'PRIVATE'],
);
assert.equal(routes[0].match.attention, 'MENTION_OR_REPLY');
assert.equal(routes[2].match.attention, 'ANY');
model.moveItem(routes, 3, -1);
assert.equal(routes[2].action.type, 'AGENT');
const originalOrder = routes.map((route) => route.id);
model.moveItem(routes, 0, -1);
assert.deepEqual(
  routes.map((route) => route.id),
  originalOrder,
);

// Exercise the actual reactive store and HTTP client, including optimistic revision and stale previews.
const dashboardUrl = moduleUrl('src/api/dashboard.ts');
const apiUrl = moduleUrl('src/api/configV3.ts', { './dashboard': dashboardUrl });
const storeUrl = moduleUrl('src/stores/configV3.ts', {
  '../api/configV3': apiUrl,
  '../models/configV3': modelUrl,
  vue: import.meta.resolve('vue'),
  pinia: import.meta.resolve('pinia'),
});
const { useConfigV3Store } = await import(storeUrl);
globalThis.window = {
  location: { search: '' },
  localStorage: { getItem: () => '', setItem: () => {} },
};
let stored = fixture();
let revision = 'r1';
let previewCalls = 0;
let saveCalls = 0;
let conflict = false;
let pendingRestartPaths = [];
let releasePreview;
globalThis.fetch = async (path, options = {}) => {
  if (path === '/api/config/v3' && !options.method)
    return Response.json({
      document: structuredClone(stored),
      revision,
      sourcePath: '/config.json',
      diagnostics: [],
    });
  if (path === '/api/config/v3/preview') {
    previewCalls++;
    if (releasePreview)
      await new Promise((resolve) => {
        releasePreview = resolve;
      });
    return Response.json({ success: true, diagnostics: [] });
  }
  if (path === '/api/config/v3' && options.method === 'PUT') {
    saveCalls++;
    const body = JSON.parse(options.body);
    assert.equal(body.expectedRevision, revision);
    if (conflict) return Response.json({ error: 'Revision conflict' }, { status: 409 });
    stored = JSON.parse(body.content);
    revision = 'r2';
    return Response.json({ success: true, diagnostics: [], pendingRestartPaths });
  }
  throw new Error(`Unexpected request ${path}`);
};
setActivePinia(createPinia());
const store = useConfigV3Store();
await store.load();
assert.equal(store.revision, 'r1');
assert.equal(store.dirty, false);
store.document.agents[0].displayName = '改名';
assert.equal(store.dirty, true);
assert.equal(!!store.canSave, false);
await store.preview();
assert.equal(!!store.canSave, true);
store.document.agents[0].displayName = '再次改名';
assert.equal(!!store.canSave, false, 'an edited draft invalidates the preview');
await store.save();
assert.equal(saveCalls, 0);
await store.preview();
await store.save();
assert.equal(store.dirty, false);
assert.equal(store.revision, 'r2');
assert.equal(stored.agents[0].displayName, '再次改名');
pendingRestartPaths = ['platformDirectory'];
store.document.platformDirectory = 'data/new-platform';
await store.preview();
await store.save();
assert.match(
  store.notice,
  /部分设置重启后生效/,
  'restart-required changes must not claim full activation',
);
pendingRestartPaths = [];
store.document.agents[0].displayName = '保留草稿';
await store.preview();
conflict = true;
await store.save();
assert.equal(store.dirty, true);
assert.match(store.error, /409/);
assert.equal(store.document.agents[0].displayName, '保留草稿');
conflict = false;
releasePreview = true;
const pending = store.preview();
await Promise.resolve();
store.document.agents[0].displayName = '预览期间编辑';
releasePreview();
await pending;
releasePreview = null;
assert.equal(!!store.canSave, false, 'an older in-flight preview cannot authorize a changed draft');
store.document.agents[0].llm.model = '';
const before = previewCalls;
await store.preview();
assert.equal(previewCalls, before, 'invalid forms never reach preview API');
globalThis.fetch = async () =>
  Response.json({
    document: null,
    revision: null,
    sourcePath: '/invalid.json',
    diagnostics: [
      { code: 'INVALID', message: 'Invalid source', path: '', source: '', severity: 'ERROR' },
    ],
  });
setActivePinia(createPinia());
const invalidSourceStore = useConfigV3Store();
await invalidSourceStore.load();
assert.equal(invalidSourceStore.document, null);
assert.equal(invalidSourceStore.revision, '');
assert.equal(!!invalidSourceStore.canSave, false);
assert.equal(invalidSourceStore.result.diagnostics[0].code, 'INVALID');
console.log(
  'Configuration V3 functional smoke passed: model constraints, route ordering, preview invalidation, optimistic revisions and conflict recovery.',
);
