// GET /lyrics/:id's public shape: timings land on the PLAYED timeline through
// the injected shift, an unusable synced set degrades to unsynced rather than
// half-timed, and "no lyrics" is one empty answer however it arrived.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LYRIC_LINES_MAX,
  LYRIC_TEXT_MAX,
  NO_LYRICS,
  publicLyrics,
} from '../src/util/public-lyrics.js';

const same = (ms: number) => ms;

test('absent or empty lyrics are one empty answer', () => {
  assert.deepEqual(publicLyrics(null, same), NO_LYRICS);
  assert.deepEqual(publicLyrics(undefined, same), NO_LYRICS);
  assert.deepEqual(publicLyrics({ synced: true, lines: [] }, same), NO_LYRICS);
  assert.deepEqual(
    publicLyrics({ synced: true, lines: [{ startMs: 0, text: '  ' }] }, same),
    NO_LYRICS,
    'only blank lines is no lyrics',
  );
});

test('synced lines are shifted, sorted, and keep their deliberate blanks', () => {
  const out = publicLyrics(
    {
      synced: true,
      lines: [
        { startMs: 12_000, text: 'second' },
        { startMs: 4_000, text: ' first ' },
        { startMs: 8_000, text: '' },
      ],
    },
    (ms) => Math.max(0, ms - 2_000),
  );
  assert.deepEqual(out, {
    synced: true,
    lines: [
      { t: 2_000, text: 'first' },
      { t: 6_000, text: '' },
      { t: 10_000, text: 'second' },
    ],
  });
});

test('a synced set whose timings do not survive is reported unsynced', () => {
  const nanStart = publicLyrics(
    { synced: true, lines: [{ startMs: 1000, text: 'a' }, { startMs: NaN, text: 'b' }] },
    same,
  );
  assert.equal(nanStart.synced, false);
  assert.ok(nanStart.lines.every((l) => l.t === null));

  const shiftRefused = publicLyrics({ synced: true, lines: [{ startMs: 1000, text: 'a' }] }, () => null);
  assert.deepEqual(shiftRefused, { synced: false, lines: [{ t: null, text: 'a' }] });
});

test('unsynced lyrics drop blank spacing lines and carry no timings', () => {
  const out = publicLyrics(
    { synced: false, lines: [{ startMs: NaN, text: 'verse' }, { startMs: NaN, text: '' }, { startMs: NaN, text: 'chorus' }] },
    () => {
      throw new Error('an unsynced set must never consult the shift');
    },
  );
  assert.deepEqual(out, { synced: false, lines: [{ t: null, text: 'verse' }, { t: null, text: 'chorus' }] });
});

test('line count and line length are bounded', () => {
  const lines = Array.from({ length: LYRIC_LINES_MAX + 50 }, (_, i) => ({ startMs: i * 1000, text: 'x'.repeat(LYRIC_TEXT_MAX + 10) }));
  const out = publicLyrics({ synced: true, lines }, same);
  assert.equal(out.lines.length, LYRIC_LINES_MAX);
  assert.equal(out.lines[0].text.length, LYRIC_TEXT_MAX);
});
