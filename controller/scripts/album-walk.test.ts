// Album of the day — the walk: album order, no wrap, a finish that is said
// once per airing, resume across a restart, and a store of its own so an
// in-order playlist show's position is never moved by an album airing.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { albumWalkSig, isAlbumWalkFinished, nextInAlbum } from '../src/music/album-walk.js';
import { cursorFor } from '../src/music/playlist-order.js';
import { createPlaylistCursorStore } from '../src/music/playlist-cursors.js';
import { createAlbumWalker } from '../src/music/album-walk-next.js';
import type { AlbumEpisodeSource } from '../src/music/episode-source.js';

const dir = mkdtempSync(join(tmpdir(), 'subwave-album-walk-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const tracks = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, title: `T${i + 1}`, artist: 'Band' }));
const sig = albumWalkSig('occ-1', 'lp');
const any = () => true;
const at = (index: number) => cursorFor(tracks[index], index, sig);
const step = (cursor: ReturnType<typeof at> | null, eligible: (t: typeof tracks[number]) => boolean = any) => nextInAlbum(tracks, cursor, sig, eligible);

test('a fresh airing starts at track 1, and a new occurrence starts over', () => {
  assert.deepEqual(step(null), { track: tracks[0], index: 0 });
  assert.deepEqual(nextInAlbum(tracks, at(2), albumWalkSig('occ-2', 'lp'), any), { track: tracks[0], index: 0 });
});

test('the walk continues one past the last pick and never wraps', () => {
  assert.deepEqual(step(at(1)), { track: tracks[2], index: 2 });
  assert.deepEqual(step(at(3)), { finished: true });
});

test('ineligible (busy) tracks are stepped over; a queued last track means finished', () => {
  assert.deepEqual(step(at(0), t => t.id !== 'b'), { track: tracks[2], index: 2 });
  assert.deepEqual(step(at(2), t => t.id !== 'd'), { finished: true });
});

test('a last pick that left the album resumes at its old slot', () => {
  const shrunk = tracks.filter(t => t.id !== 'b');
  assert.deepEqual(nextInAlbum(shrunk, at(1), sig, any), { track: shrunk[1], index: 1 });
});

const source: AlbumEpisodeSource = {
  kind: 'album', identity: 'occ-1:lp:x', album: { id: 'lp', name: 'Record', artist: 'Band', year: 1999 },
  tracks: tracks.map(t => ({ ...t, album: 'Record', albumId: 'lp' })), ids: new Set(tracks.map(t => t.id)),
};
const store = (file: string) => createPlaylistCursorStore({ file: join(dir, file), knownShowIds: () => ['s1'] });

test('walker: commit advances, finish is reported once, and both survive a restart', async () => {
  const walker = createAlbumWalker(store('album-cursors.json'));
  let next = await walker.next('s1', 'occ-1', source);
  assert.equal(next.kind === 'track' && next.index, 0);
  for (let i = 0; i < 4; i++) {
    next = await walker.next('s1', 'occ-1', source);
    assert.ok(next.kind === 'track');
    await walker.commit('s1', next.track, next.index, next.sig);
  }
  next = await walker.next('s1', 'occ-1', source);
  assert.equal(next.kind, 'finished');
  assert.equal(walker.finishedNow('s1', 'occ-1', 'lp'), false, 'not finished until finish() is recorded');
  assert.equal(await walker.finish('s1', next.sig, 4), true);
  assert.equal(await walker.finish('s1', next.sig, 4), false, 'the finish note is said once');
  assert.equal(walker.finishedNow('s1', 'occ-1', 'lp'), true);

  const restarted = createAlbumWalker(store('album-cursors.json'));
  await restarted.load();
  assert.equal(restarted.finishedNow('s1', 'occ-1', 'lp'), true, 'peek reads the persisted finish after load');
  assert.equal(await restarted.finish('s1', albumWalkSig('occ-1', 'lp'), 4), false, 'no second note after a restart');
  assert.equal(restarted.finishedNow('s1', 'occ-2', 'lp'), false, 'the next airing is a new walk');
});

test('walker: a restart mid-album resumes at the next track', async () => {
  const walker = createAlbumWalker(store('mid.json'));
  const first = await walker.next('s1', 'occ-1', source);
  assert.ok(first.kind === 'track');
  await walker.commit('s1', first.track, first.index, first.sig);
  const restarted = createAlbumWalker(store('mid.json'));
  const second = await restarted.next('s1', 'occ-1', source);
  assert.equal(second.kind === 'track' && second.track.id, 'b');
});

test('the album store never moves the playlist store (separate files, same show id)', async () => {
  const playlists = store('playlist-cursors.json');
  await playlists.commit('s1', cursorFor(tracks[2], 2, 'pl_a'));
  const before = await playlists.get('s1');
  const walker = createAlbumWalker(store('albums-separate.json'));
  const next = await walker.next('s1', 'occ-1', source);
  assert.ok(next.kind === 'track');
  await walker.commit('s1', next.track, next.index, next.sig);
  await walker.finish('s1', next.sig, 4);
  const reread = store('playlist-cursors.json');
  assert.deepEqual(await reread.get('s1'), before, 'the playlist position on disk is untouched');
  assert.equal(isAlbumWalkFinished(await reread.get('s1'), next.sig), false);
});
