import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileParsingSettingsSchema } from '../packages/contracts/src/file-parsing.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { FileParsingError, FileParsingSettingsService, LOCAL_FORMATS, shouldUploadDocuments } from '../apps/server/src/file-parsing.js';

void test('defaults parse locally and keep the project limits', () => {
  const settings = FileParsingSettingsSchema.parse({});
  assert.equal(settings.enabled, true);
  assert.equal(settings.provider, 'local');
  assert.equal(settings.maxBytes, 20_000_000);
  assert.equal(settings.maxTextChars, 80_000);
  assert.equal(settings.revision, 0);
});

void test('saving bumps the revision and rejects a stale one', () => {
  const store = new RuntimeStore(':memory:');
  try {
    const service = new FileParsingSettingsService(store);
    const saved = service.update({ enabled: true, provider: 'deepseek', maxBytes: 5_000_000, maxTextChars: 20_000, purpose: 'text_recognition', expiresAfterSeconds: 3600 }, 0);
    assert.equal(saved.revision, 1);
    assert.equal(saved.provider, 'deepseek');
    assert.equal(service.settings().provider, 'deepseek');
    assert.throws(() => service.update({ enabled: false, provider: 'local', maxBytes: 5_000_000, maxTextChars: 20_000, purpose: 'text_recognition', expiresAfterSeconds: 3600 }, 0), FileParsingError);
  } finally { store.close(); }
});

void test('remote parsing needs the switch, the provider and the connection', () => {
  const base = FileParsingSettingsSchema.parse({});
  assert.equal(shouldUploadDocuments(base, true), false, 'local provider never uploads');
  const remote = FileParsingSettingsSchema.parse({ provider: 'deepseek' });
  assert.equal(shouldUploadDocuments(remote, true), true);
  assert.equal(shouldUploadDocuments(remote, false), false, 'connection must support uploads');
  assert.equal(shouldUploadDocuments({ ...remote, enabled: false }, true), false, 'disabled means local');
});

void test('local formats cover PDF, text and Office', () => {
  for (const format of ['pdf', 'txt', 'md', 'docx', 'pptx', 'xlsx']) assert.ok(LOCAL_FORMATS.includes(format), format);
});
