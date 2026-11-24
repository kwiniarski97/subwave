// The played-songs log (observability/played-log.ts): line shape, repeat note,
// and that the append lands in the month's file under STATE_DIR/logs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const { formatGap, formatPlayedLine, appendPlayedLine, playedLogPath } = await import('../src/observability/played-log.js');

const base = {
  playedAt: '2026-11-17T12:00:00.000Z',
  title: 'Song', artist: 'Band', album: 'LP', trackId: 'abc',
  source: 'ai', requestedBy: null, showName: 'Morning', previous: null,
};

test('formatGap is coarse and readable', () => {
  assert.equal(formatGap(40_000), '40s');
  assert.equal(formatGap(12 * 60_000), '12m');
  assert.equal(formatGap(2 * 3600_000 + 5 * 60_000), '2h 05m');
  assert.equal(formatGap(3 * 86_400_000 + 4 * 3600_000), '3d 4h');
  assert.equal(formatGap(-1), '?');
});

test('a first play says so', () => {
  assert.equal(
    formatPlayedLine(base),
    '2026-11-17T12:00:00.000Z\tBand — Song\tLP\tai\tMorning\tfirst play\tabc\n',
  );
});

test('a repeat names its count and gap; requests name the listener; tabs are scrubbed', () => {
  const line = formatPlayedLine({
    ...base, title: 'A\tB', source: 'request', requestedBy: 'kasia',
    previous: { playedAt: '2026-11-17T09:30:00.000Z', count: 2 },
  });
  const cols = line.trimEnd().split('\t');
  assert.equal(cols.length, 7);
  assert.equal(cols[1], 'Band — A B');
  assert.equal(cols[3], 'request:kasia');
  assert.equal(cols[5], 'REPEAT #3, last 2h 30m ago (2026-11-17T09:30:00.000Z)');
});

test('appendPlayedLine writes to the month file', async () => {
  await appendPlayedLine(base);
  await appendPlayedLine({ ...base, previous: { playedAt: '2026-11-17T11:00:00.000Z', count: 1 } });
  const body = await readFile(playedLogPath(), 'utf8');
  assert.match(playedLogPath(), /logs\/played-\d{4}-\d{2}\.log$/);
  assert.equal(body.trim().split('\n').length, 2);
  assert.match(body, /REPEAT #2, last 1h 00m ago/);
});
