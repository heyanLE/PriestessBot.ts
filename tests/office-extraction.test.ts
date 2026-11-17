import assert from 'node:assert/strict';
import { test } from 'node:test';
import { officeKind, officeText, OfficeError } from '../packages/adapters/src/media/office.js';

/** Build a stored (uncompressed) ZIP so the reader is tested without a dependency. */
function zip(files: readonly (readonly [string, string])[]): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const nameBytes = Buffer.from(name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

void test('docx paragraphs become lines and entities decode', () => {
  const bytes = zip([['word/document.xml', '<w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>Tom &amp; Jerry</w:t></w:r></w:p></w:body>']]);
  assert.equal(officeText('docx', bytes, 10_000), '第一段\nTom & Jerry');
});

void test('pptx text is grouped by slide in numeric order', () => {
  const bytes = zip([
    ['ppt/slides/slide2.xml', '<a:p><a:r><a:t>第二页</a:t></a:r></a:p>'],
    ['ppt/slides/slide1.xml', '<a:p><a:r><a:t>第一页</a:t></a:r></a:p>'],
    ['ppt/slides/slide10.xml', '<a:p><a:r><a:t>第十页</a:t></a:r></a:p>'],
  ]);
  assert.equal(officeText('pptx', bytes, 10_000), '第 1 页\n第一页\n\n第 2 页\n第二页\n\n第 3 页\n第十页');
});

void test('xlsx resolves shared strings and keeps rows', () => {
  const bytes = zip([
    ['xl/sharedStrings.xml', '<sst><si><t>名称</t></si><si><t>数量</t></si></sst>'],
    ['xl/worksheets/sheet1.xml', '<sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c><v>42</v></c></row></sheetData>'],
  ]);
  assert.equal(officeText('xlsx', bytes, 10_000), '工作表 1\n名称\t数量\n42');
});

void test('bounds and malformed containers fail loudly', () => {
  const bytes = zip([['word/document.xml', '<w:p><w:t>这是一段很长的正文</w:t></w:p>']]);
  assert.throws(() => officeText('docx', bytes, 5), OfficeError);
  assert.throws(() => officeText('docx', new Uint8Array([1, 2, 3, 4, 5]), 100), OfficeError);
});

void test('only Office extensions route to this extractor', () => {
  assert.equal(officeKind('a.docx'), 'docx');
  assert.equal(officeKind('a.PPTX'), 'pptx');
  assert.equal(officeKind('a.xlsx'), 'xlsx');
  assert.equal(officeKind('a.pdf'), undefined);
  assert.equal(officeKind('a.txt'), undefined);
});
