const test = require('node:test');
const assert = require('node:assert');
const { planTiles, planSplits, splitLimitCss, normalizeRect, tileDrawRect } = require('../../src/lib/tiles.js');

test('page longer than viewport', () => assert.deepStrictEqual(
  planTiles({ top: 0, height: 2500, viewportHeight: 1000, scrollMax: 1500 }),
  [{ scroll: 0, offsetInView: 0, destY: 0, h: 1000 },
   { scroll: 1000, offsetInView: 0, destY: 1000, h: 1000 },
   { scroll: 1500, offsetInView: 500, destY: 2000, h: 500 }]));
test('short target', () => assert.deepStrictEqual(
  planTiles({ top: 0, height: 600, viewportHeight: 1000, scrollMax: 0 }),
  [{ scroll: 0, offsetInView: 0, destY: 0, h: 600 }]));
test('region in middle', () => assert.deepStrictEqual(
  planTiles({ top: 300, height: 500, viewportHeight: 1000, scrollMax: 5000 }),
  [{ scroll: 300, offsetInView: 0, destY: 0, h: 500 }]));
test('empty', () => assert.deepStrictEqual(planTiles({ top: 0, height: 0, viewportHeight: 1000, scrollMax: 0 }), []));
test('height capped', () => {
  const t = planTiles({ top: 0, height: 250000, viewportHeight: 1000, scrollMax: 249000 });
  const last = t[t.length - 1];
  assert.strictEqual(last.destY + last.h, 100000);
});
test('splits single', () => assert.deepStrictEqual(planSplits(1000, 16384), [{ start: 0, end: 1000 }]));
test('splits equal', () => assert.deepStrictEqual(planSplits(40000, 16384),
  [{ start: 0, end: 13334 }, { start: 13334, end: 26668 }, { start: 26668, end: 40000 }]));
test('limits', () => {
  assert.strictEqual(splitLimitCss('pdf', 2), 19200);
  assert.strictEqual(splitLimitCss('png', 2), 8192);
  assert.strictEqual(splitLimitCss('jpeg', 1.5), 10922);
});
test('normalize reversed drag', () => assert.deepStrictEqual(normalizeRect(300, 900, 100, 200), { x: 100, y: 200, w: 200, h: 700 }));
test('no seams at 1.25x', () => {
  const a = tileDrawRect(0, 333, 1.25), b = tileDrawRect(333, 333, 1.25);
  assert.strictEqual(a.dy + a.dh, b.dy);
});
