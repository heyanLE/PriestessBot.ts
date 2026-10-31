import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentPartSchema } from '../packages/contracts/src/index.js';
import { splitReplyImageReferences } from '../packages/adapters/src/messages/reply-composition.js';
const first = ContentPartSchema.parse({ type: 'image', url: 'artifact:image-one', artifactId: 'image-one', mimeType: 'image/png' });
const second = ContentPartSchema.parse({ type: 'image', url: 'artifact:image-two', artifactId: 'image-two', mimeType: 'image/png' });
const reference = '![图片](artifact:image-one)';
void test('owned images replace only their exact reference and keep the text/image/text order', () => {
  const result = splitReplyImageReferences(`前言 [图 1] 是文字。\n${reference}\n结尾。`, [first]);
  assert.deepEqual(result.parts, [{ type: 'text', text: '前言 [图 1] 是文字。\n' }, first, { type: 'text', text: '\n结尾。' }]);
  assert.deepEqual([...result.usedArtifactIds], ['image-one']);
});
void test('foreign artifacts, remote images and ordinary links remain text and cannot pull media', () => {
  for (const text of ['![x](artifact:other-run)', '![x](https://private.invalid/image)', '[x](artifact:image-one)', '[图 1]']) {
    const result = splitReplyImageReferences(text, [first]); assert.deepEqual(result.parts, [{ type: 'text', text }]); assert.equal(result.usedArtifactIds.size, 0);
  }
});
void test('fenced, indented, escaped and inline code references never become image messages', () => {
  for (const text of [`\`${reference}\``, `\`\`${reference}\`\``, `\`\`\`md\n${reference}\n\`\`\``, `~~~~\r\n${reference}\r\n~~~~`, `\`\`\`md\n${reference}`, `    ${reference}\n`, `\\${reference}`]) {
    assert.deepEqual(splitReplyImageReferences(text, [first]).parts, [{ type: 'text', text }]);
  }
  const text = `\`\`\`\n${reference}\n\`\`\`\n真实位置：${reference}结束`;
  const result = splitReplyImageReferences(text, [first]); assert.equal(result.parts.filter(part => part.type === 'image').length, 1); assert.equal(result.parts.at(-1)?.type, 'text');
});
void test('multiple owned images follow explicit source order and each attachment is sent once', () => {
  const result = splitReplyImageReferences(`一![第二张](artifact:image-two)二${reference}三${reference}四`, [first, second]);
  assert.deepEqual(result.parts.filter(part => part.type === 'image'), [second, first]);
  assert.equal(result.usedArtifactIds.size, 2); assert.match(JSON.stringify(result.parts), /图片已在上文显示/);
});
