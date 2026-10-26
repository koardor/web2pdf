const test = require('node:test');
const assert = require('node:assert');
const { buildFilename } = require('../../src/lib/filename.js');
const d = new Date(2026, 9, 26, 16, 5, 9);

test('basic', () => assert.strictEqual(
  buildFilename({ title: 'Hello: World?', url: 'https://example.com/a/b?x=1', date: d, ext: 'pdf', part: null }),
  'Hello_World_example.com_a_b_x=1_20261026-160509.pdf'));
test('part suffix', () => assert.strictEqual(
  buildFilename({ title: 'T', url: 'http://a.com/', date: d, ext: 'png', part: 2 }),
  'T_a.com_20261026-160509_part2.png'));
test('empty title', () => assert.match(
  buildFilename({ title: '  ', url: 'https://a.com', date: d, ext: 'jpg', part: null }), /^untitled_a\.com_/));
test('chinese kept', () => assert.ok(
  buildFilename({ title: '中文 标题', url: 'https://a.com', date: d, ext: 'pdf', part: null }).startsWith('中文_标题_')));
test('truncation', () => {
  const name = buildFilename({ title: 'a'.repeat(100), url: 'https://b.com/' + 'c'.repeat(200), date: d, ext: 'pdf', part: 12 });
  assert.ok(name.startsWith('a'.repeat(50) + '_b.com_'));
  assert.strictEqual(name.length, 50 + 1 + 80 + 1 + 15 + 7 + 4); // 标题_网址_时间_part12.pdf
  assert.ok(name.endsWith('_20261026-160509_part12.pdf'));
});
test('no forbidden chars', () => assert.doesNotMatch(
  buildFilename({ title: 'a\b/c:d*e?f"g<h>i|j\tk', url: 'https://x.y', date: d, ext: 'pdf', part: null }),
  /[\/:*?"<>|\s]/));
