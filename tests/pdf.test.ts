import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MediaPipeline } from '../packages/adapters/src/media/pipeline.js';

function samplePdf(): Uint8Array {
  const stream = 'BT /F1 12 Tf 40 700 Td (Priestess PDF source) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(text); text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(`${text}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);
}
void test('actual PDF parser extracts source text with page provenance and rejects page-budget overflow', async () => {
  const text = await new MediaPipeline().extract(samplePdf(), 'application/pdf', 'source.pdf');
  assert.match(text, /\[Page 1\]/); assert.match(text, /Priestess PDF source/);
  await assert.rejects(new MediaPipeline({ maxBytes: 100_000, maxPdfPages: 0, maxTextChars: 1000 }).extract(samplePdf(), 'application/pdf', 'source.pdf'), /page limit/);
});
