import assert from 'node:assert/strict';
import test from 'node:test';
import { ref } from 'vue';
import { createDraftState, registerUnsavedDraft, unsavedDrafts, confirmUnsavedDrafts } from '../src/composables/unsaved';

void test('independent drafts track changes and explicit save without persisting edited content', () => {
  const form = ref({ name: 'Original', credential: '' }); const state = createDraftState(() => form.value);
  assert.equal(state.dirty.value, false); form.value.name = 'Edited'; assert.equal(state.dirty.value, true);
  state.markSaved(); assert.equal(state.dirty.value, false); form.value.credential = 'private-token'; assert.equal(state.dirty.value, true);
  const unregister = registerUnsavedDraft('模型凭据', '/settings', () => state.dirty.value);
  try { assert.deepEqual(unsavedDrafts.value, [{ label: '模型凭据', page: '/settings' }]); assert.doesNotMatch(JSON.stringify(unsavedDrafts.value), /private-token/); }
  finally { unregister(); }
  assert.deepEqual(unsavedDrafts.value, []);
});
void test('unloaded resources acquire a baseline only after successful load', () => {
  const form = ref<{ name: string }>(); const state = createDraftState(() => form.value);
  assert.equal(state.dirty.value, false); form.value = { name: 'From server' }; assert.equal(state.dirty.value, false);
  state.markSaved(); form.value.name = 'Changed'; assert.equal(state.dirty.value, true);
});
void test('navigation checks only the departing page and rejection leaves every draft intact', () => {
  const a = ref(true), b = ref(true); const cleanupA = registerUnsavedDraft('人格', '/personas', () => a.value); const cleanupB = registerUnsavedDraft('搜索', '/search', () => b.value);
  const messages: string[] = []; let accept = false;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: (message: string) => { messages.push(message); return accept; } } });
  try {
    assert.equal(confirmUnsavedDrafts('/files'), true); assert.equal(messages.length, 0);
    assert.equal(confirmUnsavedDrafts('/personas'), false); assert.match(messages[0] ?? '', /人格/); assert.doesNotMatch(messages[0] ?? '', /搜索/);
    assert.equal(unsavedDrafts.value.length, 2); accept = true; assert.equal(confirmUnsavedDrafts(undefined, ['运行配置']), true);
    assert.match(messages[1] ?? '', /运行配置/); assert.match(messages[1] ?? '', /搜索/);
    assert.equal(unsavedDrafts.value.length, 2, 'Only the owning component can discard its state');
    a.value = false; assert.deepEqual(unsavedDrafts.value, [{ label: '搜索', page: '/search' }]);
  } finally { cleanupA(); cleanupB(); if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});
void test('separate editors with the same label unregister independently', () => {
  const a = registerUnsavedDraft('配置', '/agents', () => true); const b = registerUnsavedDraft('配置', '/search', () => true);
  a(); assert.deepEqual(unsavedDrafts.value, [{ label: '配置', page: '/search' }]); b(); assert.deepEqual(unsavedDrafts.value, []);
});
