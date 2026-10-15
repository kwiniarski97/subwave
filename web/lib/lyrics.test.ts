import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeLyricIndex } from './lyrics';

const lines = [
  { t: 1_000, text: 'one' },
  { t: 4_000, text: '' },
  { t: 9_000, text: 'three' },
];

test('no line is active before the first timestamp', () => {
  assert.equal(activeLyricIndex(lines, 0), -1);
  assert.equal(activeLyricIndex(lines, 999), -1);
});

test('a line stays active until the next one starts', () => {
  assert.equal(activeLyricIndex(lines, 1_000), 0);
  assert.equal(activeLyricIndex(lines, 3_999), 0);
  assert.equal(activeLyricIndex(lines, 4_000), 1);
  assert.equal(activeLyricIndex(lines, 120_000), 2);
});

test('untimed or empty input never yields an active line', () => {
  assert.equal(activeLyricIndex([], 5_000), -1);
  assert.equal(activeLyricIndex([{ t: null, text: 'x' }], 5_000), -1);
  assert.equal(activeLyricIndex(lines, NaN), -1);
});
