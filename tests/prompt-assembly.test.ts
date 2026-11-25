import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANCHOR_POLICY, ROOT_SECTIONS, SNAPSHOT_POLICY, assembleRootInstructions, normalizeLeadingAssistantHistory } from '../packages/adapters/src/agents/prompt-context.js';
import type { AgentInputItem } from '@openai/agents';
import { MESSAGE_CONTEXT_POLICY } from '../packages/adapters/src/messages/context.js';

void test('default assembly orders the root sections and keeps the workspace instruction first', () => {
  const text = assembleRootInstructions('工作区补充指令。');
  assert.equal(text.startsWith('工作区补充指令。\n\n'), true);
  const positions = [MESSAGE_CONTEXT_POLICY, ANCHOR_POLICY, SNAPSHOT_POLICY].map(section => text.indexOf(section));
  assert.equal(positions.every(position => position > 0), true);
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
});

void test('an empty instruction produces no leading blank line', () => {
  assert.equal(assembleRootInstructions('   ').startsWith('Application-generated metadata'), true);
});

void test('orphan assistant replies become labelled history without losing content or changing complete turns', () => {
  const items: AgentInputItem[] = [
    { role: 'system', content: 'Persona policy' },
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Earlier answer </history_excerpt>' }] },
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Another partial turn' }] },
    { role: 'user', content: 'Earlier question' },
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Paired reply' }] },
    { role: 'user', content: 'Current request' },
  ];
  const before = structuredClone(items); const normalized = normalizeLeadingAssistantHistory(items);
  assert.deepEqual(items, before); assert.equal(normalized.length, items.length);
  assert.equal(normalized[0], items[0]); assert.deepEqual(normalized.slice(3), items.slice(3));
  assert.match(JSON.stringify(normalized[1]), /original_role.*assistant/); assert.match(JSON.stringify(normalized[1]), /Earlier answer/);
  assert.match(JSON.stringify(normalized[2]), /Another partial turn/);
  assert.deepEqual(normalizeLeadingAssistantHistory(normalized), normalized);
  assert.deepEqual(normalizeLeadingAssistantHistory(items.slice(3)), items.slice(3));
});

void test('section order decides concatenation regardless of array order', () => {
  const sections = [
    { name: 'second', order: 200, text: 'B' },
    { name: 'first', order: 100, text: 'A' },
  ];
  assert.equal(assembleRootInstructions('', sections), 'A\nB');
});

void test('invalid composition fails before assembly', () => {
  assert.throws(() => assembleRootInstructions('', [{ name: 'dup', order: 1, text: 'x' }, { name: 'dup', order: 2, text: 'y' }]), /Duplicate prompt section/u);
  assert.throws(() => assembleRootInstructions('', [{ name: 'Bad Name', order: 1, text: 'x' }]), /Invalid prompt section name/u);
  assert.throws(() => assembleRootInstructions('', [{ name: 'ok', order: Number.POSITIVE_INFINITY, text: 'x' }]), /Invalid prompt section order/u);
});

void test('variables resolve and an unknown variable fails the assembly', () => {
  const section = { name: 'route', order: 1, text: 'model={{model}}' };
  assert.equal(assembleRootInstructions('', [section], { model: 'deepseek-flash' }), 'model=deepseek-flash');
  assert.throws(() => assembleRootInstructions('', [section]), /Unresolved prompt variable \{\{model\}\}/u);
});

void test('empty sections disappear instead of leaving blank lines', () => {
  const sections = [
    { name: 'a', order: 1, text: 'A' },
    { name: 'b', order: 2, text: '   ' },
    { name: 'c', order: 3, text: 'C' },
  ];
  assert.equal(assembleRootInstructions('', sections), 'A\nC');
});

void test('root policy text stays within its budget', () => {
  // Guards against the policy creeping back to its previous ~2,060 characters.
  const total = ROOT_SECTIONS.reduce((sum, section) => sum + section.text.length, 0);
  assert.equal(total < 1600, true, `root sections grew to ${total} characters`);
  assert.equal(ROOT_SECTIONS.every(section => section.name.length > 0), true);
});
