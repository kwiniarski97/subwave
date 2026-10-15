// Album of the day — the featured-albums ledger: newest first, capped,
// windowed by days, and a corrupt file reads as an empty history.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFeaturedAlbums } from '../src/music/featured-albums.js';
import { FEATURED_ALBUMS_MAX } from '../src/schemas/featured-albums.js';

const dir = mkdtempSync(join(tmpdir(), 'subwave-featured-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const DAY = 86_400_000;

test('recentIds windows by days; zero days excludes nothing', async () => {
  let clock = 1_000 * DAY;
  const ledger = createFeaturedAlbums({ file: join(dir, 'window.json'), now: () => clock });
  await ledger.record({ albumId: 'old', name: 'Old', artist: 'A' });
  clock += 100 * DAY;
  await ledger.record({ albumId: 'new', name: 'New', artist: 'B' });
  assert.deepEqual([...await ledger.recentIds(90)], ['new']);
  assert.deepEqual([...await ledger.recentIds(365)].sort(), ['new', 'old']);
  assert.deepEqual([...await ledger.recentIds(0)], []);
});

test('the ledger persists newest first and is capped', async () => {
  const file = join(dir, 'cap.json');
  let clock = 0;
  const ledger = createFeaturedAlbums({ file, now: () => ++clock });
  for (let i = 0; i < FEATURED_ALBUMS_MAX + 5; i++) await ledger.record({ albumId: `al-${i}`, name: 'N', artist: 'A' });
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(stored.albums.length, FEATURED_ALBUMS_MAX);
  assert.equal(stored.albums[0].albumId, `al-${FEATURED_ALBUMS_MAX + 4}`);
  const reopened = createFeaturedAlbums({ file, now: () => clock });
  assert.ok((await reopened.recentIds(1)).has(`al-${FEATURED_ALBUMS_MAX + 4}`));
});

test('a corrupt file reads as empty and the next record replaces it', async () => {
  const file = join(dir, 'corrupt.json');
  writeFileSync(file, '{not json');
  const ledger = createFeaturedAlbums({ file, now: () => 5 });
  assert.deepEqual([...await ledger.recentIds(90)], []);
  await ledger.record({ albumId: 'x', name: 'X', artist: 'Y' });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).albums.length, 1);
});
