import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MarkdownDecorationPartSchema, MarkdownSettingsSchema } from '../packages/contracts/src/plugins/markdown.js';
import { MarkdownPlugin, cleanMarkdown, containsFormula, markdownHtml } from '../packages/adapters/src/plugins/markdown.js';

void test('Markdown cleanup preserves code, arithmetic, variables and list structure', () => {
  const source = '# Heading\n**bold** and *emphasis* with a_b and 2 * 3 = 6\n- **First**\n  continued\n- Second\n`x_y **literal**`\n```ts\nconst x_y = 2 * 3;\n// **literal**\n```\n[docs](https://example.com)';
  const output = cleanMarkdown(source, 'segment_boundary');
  assert.match(output, /^Heading\nbold and emphasis with a_b and 2 \* 3 = 6/);
  assert.match(output, /- First\n {2}continued\n- Second/); assert.match(output, /`x_y \*\*literal\*\*`/); assert.match(output, /```ts\nconst x_y = 2 \* 3;\n\/\/ \*\*literal\*\*\n```/); assert.match(output, /docs \(https:\/\/example.com\)/);
  assert.equal(cleanMarkdown('第一句。\n第二句', 'segment_boundary'), '第一句。 第二句'); assert.equal(cleanMarkdown('one\n\n\ntwo', 'global'), 'one\n\ntwo');
});
void test('Markdown renderer escapes HTML, removes URL effects and emits local MathML outside code only', () => {
  const html = markdownHtml('<script>alert(1)</script>\n\n![remote](http://127.0.0.1/private)\n\n[x](javascript:alert(1))\n\n$\\frac{1}{2}$\n\n`$ignored$`');
  assert.doesNotMatch(html, /<script>|<img|href="javascript:|src="http/); assert.match(html, /&lt;script&gt;/); assert.match(html, /<math/); assert.match(html, /\$ignored\$/);
  assert.equal(containsFormula('cost $5 and $6'), false); assert.equal(containsFormula('`$code$`'), false); assert.equal(containsFormula('\\[x^2\\]'), true);
});
void test('Markdown decoration invokes renderer for tables/formulas, preserves raw disabled tables and reports configured fallback', async () => {
  const settings = MarkdownSettingsSchema.parse({ enabled: true, globalCleanup: true }); const sources: string[] = [];
  const plugin = new MarkdownPlugin(() => settings, text => { sources.push(text); return Promise.resolve(new Uint8Array([137, 80, 78, 71])); });
  const result = await plugin.decorate('**Text**\n\n| A | B |\n| --- | --- |\n| x | y |\n\n$E=mc^2$', new AbortController().signal);
  assert.equal(result.images.length, 2); assert.equal(sources.length, 2); assert.match(result.text, /Text/); assert.match(result.text, /\[图 1\]/);
  assert.deepEqual(result.parts.filter(part => part.type === 'image').map(part => part.imageIndex), [0, 1]);
  const failing = new MarkdownPlugin(() => settings, () => Promise.reject(new Error('No Chromium')));
  const fallback = await failing.decorate('| A | B |\n| --- | --- |\n| x | y |\n\n$E=mc^2$', new AbortController().signal); assert.equal(fallback.images.length, 0); assert.equal(fallback.warnings.length, 2); assert.match(fallback.text, /A · B/); assert.match(fallback.text, /\$E=mc\^2\$/);
  assert.equal(fallback.parts.filter(part => part.type === 'text').map(part => part.text).join(''), fallback.text);
  const disabledTable = new MarkdownPlugin(() => ({ ...settings, tableRender: false })); const raw = '| A |\n| --- |\n| **B** |'; assert.equal((await disabledTable.decorate(raw, new AbortController().signal)).text, raw);
});
void test('Markdown plugin disable is a byte-for-byte bypass and cancellation never falls back to delivery', async () => {
  const controller = new AbortController(); const disabled = new MarkdownPlugin(() => MarkdownSettingsSchema.parse({})); const raw = '  **literal**\n'; const unchanged = await disabled.decorate(raw, controller.signal); assert.equal(unchanged.text, raw); assert.deepEqual(unchanged.parts, [{ type: 'text', text: raw }]); assert.deepEqual((await disabled.decorate('', controller.signal)).parts, []);
  const plugin = new MarkdownPlugin(() => MarkdownSettingsSchema.parse({ enabled: true }), () => { controller.abort(); return Promise.reject(new Error('abort')); }); await assert.rejects(plugin.decorate('$$x$$', controller.signal), /abort/i);
});

void test('ordered Markdown parts keep images between surrounding text without interpreting literal image markers', async () => {
  const settings = MarkdownSettingsSchema.parse({ enabled: true, globalCleanup: true }); const rendered: string[] = [];
  const plugin = new MarkdownPlugin(() => settings, raw => { rendered.push(raw); return Promise.resolve(new Uint8Array([rendered.length])); });
  const result = await plugin.decorate('前言 [图 1] 是原文。\n\n| A | B |\n| --- | --- |\n| x | y |\n\n中间说明。\n\n$$E=mc^2$$\n\n结尾。', new AbortController().signal);
  assert.deepEqual(result.parts.map(part => part.type), ['text', 'image', 'text', 'image', 'text']);
  assert.deepEqual(result.parts.filter(part => part.type === 'text').map(part => part.text.trim()), ['前言 [图 1] 是原文。', '中间说明。', '结尾。']);
  const images = result.parts.filter(part => part.type === 'image'); assert.deepEqual(images.map(part => part.imageIndex), [0, 1]);
  for (const part of images) assert.deepEqual(result.images[part.imageIndex], new Uint8Array([part.imageIndex + 1]));
  assert.equal(result.text.match(/\[图 1\]/g)?.length, 2, 'Legacy representation remains compatible');
  assert.equal(result.parts.filter(part => part.type === 'text').map(part => part.text).join('').match(/\[图 1\]/g)?.length, 1, 'Only the literal user marker remains in text parts');
  assert.deepEqual(MarkdownDecorationPartSchema.array().parse(result.parts), result.parts);
});

void test('one rendered Markdown block yields one image even when it contains several formulas or a table formula', async () => {
  const sources: string[] = []; const settings = MarkdownSettingsSchema.parse({ enabled: true });
  const plugin = new MarkdownPlugin(() => settings, raw => { sources.push(raw); return Promise.resolve(new Uint8Array([sources.length])); });
  const result = await plugin.decorate('同一段先解释 $x$，再解释 $y$，最后收尾。\n\n| 公式 | 值 |\n| --- | --- |\n| $a+b$ | 3 |', new AbortController().signal);
  assert.equal(sources.length, 2); assert.match(sources[0] ?? '', /同一段先解释 \$x\$，再解释 \$y\$，最后收尾/); assert.match(sources[1] ?? '', /\$a\+b\$/);
  assert.deepEqual(result.parts.filter(part => part.type === 'image'), [{ type: 'image', imageIndex: 0 }, { type: 'image', imageIndex: 1 }]);
  assert.ok(result.parts.filter(part => part.type === 'text').every(part => part.text.trim() === ''), 'Text inside rendered blocks is not duplicated outside their images');
});

void test('render failure stays in source order and successful later images use compact byte indexes', async () => {
  const settings = MarkdownSettingsSchema.parse({ enabled: true, tableFallback: 'raw' }); let attempts = 0;
  const plugin = new MarkdownPlugin(() => settings, () => ++attempts === 1 ? Promise.reject(new Error('first renderer unavailable')) : Promise.resolve(new Uint8Array([7])));
  const result = await plugin.decorate('前言\n\n| A |\n| --- |\n| x |\n\n中间\n\n$$x$$\n\n尾声', new AbortController().signal);
  assert.equal(result.images.length, 1); assert.equal(result.warnings.length, 1); assert.deepEqual(result.parts.map(part => part.type), ['text', 'image', 'text']);
  const first = result.parts[0]; assert.ok(first?.type === 'text'); assert.match(first.text, /前言[\s\S]*\| A \|[\s\S]*中间/); assert.deepEqual(result.parts[1], { type: 'image', imageIndex: 0 });
  const last = result.parts.at(-1); assert.ok(last?.type === 'text'); assert.equal(last.text.trim(), '尾声');
});

void test('image quota preserves later raw fallback and remove fallback omits only the affected block', async () => {
  const settings = MarkdownSettingsSchema.parse({ enabled: true, maxImages: 1, formulaFallback: 'raw' }); let attempts = 0;
  const plugin = new MarkdownPlugin(() => settings, () => { attempts++; return Promise.resolve(new Uint8Array([1])); });
  const result = await plugin.decorate('前言\n\n$$x$$\n\n中间\n\n$$y$$\n\n尾声', new AbortController().signal);
  assert.equal(attempts, 1); assert.equal(result.images.length, 1); assert.equal(result.warnings.length, 1); assert.deepEqual(result.parts.map(part => part.type), ['text', 'image', 'text']);
  const afterImage = result.parts.at(-1); assert.ok(afterImage?.type === 'text'); assert.match(afterImage.text, /中间[\s\S]*\$\$y\$\$[\s\S]*尾声/);
  const removing = new MarkdownPlugin(() => ({ ...settings, formulaFallback: 'remove' }), () => Promise.reject(new Error('No renderer')));
  const removed = await removing.decorate('前言\n\n$$remove$$\n\n尾声', new AbortController().signal); assert.equal(removed.images.length, 0); assert.equal(removed.parts.length, 1); const kept = removed.parts[0]; assert.ok(kept?.type === 'text'); assert.match(kept.text, /前言[\s\S]*尾声/); assert.doesNotMatch(kept.text, /remove|\[图/);
});

void test('fenced and inline code remain literal while surrounding formula images keep their position', async () => {
  const settings = MarkdownSettingsSchema.parse({ enabled: true, globalCleanup: true }); const sources: string[] = [];
  const plugin = new MarkdownPlugin(() => settings, raw => { sources.push(raw); return Promise.resolve(new Uint8Array([1])); });
  const code = '```md\n| A |\n| --- |\n| $literal$ |\n[图 1]\n```';
  const result = await plugin.decorate(`前言\n\n${code}\n\n\`$inline$ [图 2]\`\n\n$$rendered$$\n\n尾声`, new AbortController().signal);
  assert.equal(sources.length, 1); assert.match(sources[0] ?? '', /rendered/); assert.doesNotMatch(sources[0] ?? '', /literal|inline/);
  const first = result.parts[0]; assert.ok(first?.type === 'text'); assert.ok(first.text.includes(code)); assert.ok(first.text.includes('`$inline$ [图 2]`')); assert.deepEqual(result.parts.filter(part => part.type === 'image'), [{ type: 'image', imageIndex: 0 }]);
});

void test('disable during rendering emits configured text fallback with no dangling image reference', async () => {
  const settings = MarkdownSettingsSchema.parse({ enabled: true, formulaFallback: 'raw' }); let enabled = true;
  const plugin = new MarkdownPlugin(() => ({ ...settings, enabled }), () => { enabled = false; return Promise.resolve(new Uint8Array([1])); });
  const result = await plugin.decorate('前言\n\n$$x$$\n\n尾声', new AbortController().signal);
  assert.equal(result.images.length, 0); assert.equal(result.parts.length, 1); assert.deepEqual(result.parts, [{ type: 'text', text: result.text }]); assert.match(result.text, /前言[\s\S]*\$\$x\$\$[\s\S]*尾声/); assert.equal(result.warnings.length, 1);
});
void test('Markdown real local Chromium returns an actual PNG with no network dependency', { timeout: 30000 }, async context => {
  const plugin = new MarkdownPlugin(() => MarkdownSettingsSchema.parse({ enabled: true }));
  const availability = await plugin.availability(); if (!availability.available) { context.skip(availability.reason); return; }
  const png = await plugin.render('| A | B |\n| --- | --- |\n| 本地 | $x^2$ |', new AbortController().signal);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); assert.ok(png.length > 1000);
});

void test('Markdown card templates change real layout CSS and reach the renderer', async () => {
  assert.notEqual(markdownHtml('# Title', 'classic'), markdownHtml('# Title', 'minimal'));
  assert.match(markdownHtml('# Title', 'minimal'), /width:664px/); assert.match(markdownHtml('# Title', 'cinematic_poster'), /linear-gradient/);
  let selected = ''; const plugin = new MarkdownPlugin(() => MarkdownSettingsSchema.parse({}), (_text, _signal, _settings, template) => { selected = template ?? ''; return Promise.resolve(new Uint8Array()); });
  await plugin.render('Title', new AbortController().signal, 'cinematic_poster'); assert.equal(selected, 'cinematic_poster');
});
