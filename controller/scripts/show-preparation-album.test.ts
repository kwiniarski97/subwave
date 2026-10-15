// Album of the day — the preparation result's album music type, and how a
// prepared album's music stops steering selection once its walk is done.

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparationResultSchema } from '../src/schemas/show-preparation.js';

const root = await mkdtemp(join(tmpdir(), 'subwave-preparation-album-'));
process.env.STATE_DIR = root;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });
const { getFullContext } = await import('../src/context.js');
const context = await getFullContext();
globalThis.fetch = realFetch;
const { createShowPreparation, preparationGrounding } = await import('../src/broadcast/show-preparation.js');
after(async () => { await rm(root, { recursive: true, force: true }); });

test('an album result parses, and an artist result is unchanged', () => {
  const album = preparationResultSchema.parse({ available: true, subject: 'Blue Train by John Coltrane', data: null, music: { type: 'album', albumId: ' al-1 ' } });
  assert.deepEqual(album.available && album.music, { type: 'album', albumId: 'al-1' });
  const artist = preparationResultSchema.parse({ available: true, subject: 'Air', data: null, music: { type: 'artist', artistId: 'ar-1' } });
  assert.deepEqual(artist.available && artist.music, { type: 'artist', artistId: 'ar-1' });
});

test('an album without an id, or an unknown music type, is refused', () => {
  assert.equal(preparationResultSchema.safeParse({ available: true, subject: 'x', music: { type: 'album' } }).success, false);
  assert.equal(preparationResultSchema.safeParse({ available: true, subject: 'x', music: { type: 'album', albumId: '  ' } }).success, false);
  assert.equal(preparationResultSchema.safeParse({ available: true, subject: 'x', music: { type: 'playlist', playlistId: 'p' } }).success, false);
  assert.equal(preparationResultSchema.safeParse({ available: true, subject: 'x', music: { type: 'artist', albumId: 'a' } }).success, false);
});

const albumResult = { available: true as const, subject: 'placeholder', data: { research: [] }, music: { type: 'album' as const, albumId: 'lp' } };
const albumSource = {
  kind: 'album' as const, identity: 'occ:lp:rev', album: { id: 'lp', name: 'Record', artist: 'Band', year: 1999 },
  tracks: [{ id: 'a', title: 'A', artist: 'Band', album: 'Record', albumId: 'lp' }], ids: new Set(['a']),
};

function albumFixture(name: string) {
  const base = Date.now();
  let finished = false;
  const ready: unknown[] = [];
  const options = {
    file: join(root, `${name}.json`), now: () => base,
    snapshot: () => ({ occurrence: { id: name, showId: 's1', source: 'scheduled' as const, startsAt: base, endsAt: base + 7_200_000 }, skill: 'album-of-the-day', configuration: 'c' }),
    execute: async () => albumResult,
    source: async () => albumSource,
    musicActive: (music: { kind: string }) => music.kind !== 'album' || !finished,
    ready: (_result: unknown, music: unknown) => { ready.push(music); },
  };
  return { options, finish: () => { finished = true; }, ready };
}

test('an album episode is ready with an "<album> by <artist>" subject and album grounding', async () => {
  const f = albumFixture('album-ready');
  const owner = createShowPreparation(f.options);
  const view = await owner.ensure({ context });
  assert.equal(view.status.kind, 'ready');
  assert.equal(view.status.kind === 'ready' && view.status.subject, 'Record by Band');
  assert.equal(view.music?.kind, 'album');
  assert.match(view.editorial, /album order/);
  assert.doesNotMatch(view.editorial, /prepared artist/);
  assert.match(view.editorial, /one fact or piece of trivia/, 'the per-link brief reaches the speaking model through the grounding');
  assert.match(view.editorial, /closing track/);
  assert.match(view.editorial, /"libraryRecords":\[\]/, 'the tool tracklist already lists the album; research is not crowded out');
});

test('the ready hook runs once per accepted preparation, not again after a restart', async () => {
  const f = albumFixture('album-hook');
  await createShowPreparation(f.options).ensure({ context });
  await createShowPreparation(f.options).ensure({ context });
  const restarted = createShowPreparation(f.options);
  await restarted.recover();
  await restarted.ensure({ context });
  assert.equal(f.ready.length, 1);
  assert.equal((f.ready[0] as { kind: string }).kind, 'album');
});

test('a finished album stops steering read().music, but preparedAlbum still answers', async () => {
  const f = albumFixture('album-finish');
  const owner = createShowPreparation(f.options);
  await owner.ensure({ context });
  assert.equal(owner.read({ context }).music?.kind, 'album');
  f.finish();
  assert.equal(owner.read({ context }).music, null);
  assert.equal(owner.read({ context }).status.kind, 'ready', 'the research stays; only the music restriction lifts');
  assert.equal(owner.preparedAlbum({ context })?.album.album.id, 'lp');
  assert.equal(owner.preparedAlbum({ context })?.occurrence.id, 'album-finish');
  const after = owner.read({ context }).editorial;
  assert.match(after, /"Record" has finished; the rest of the show is open/, 'links after the finish know the album is over');
  assert.doesNotMatch(after, /play this prepared album in album order/);
  assert.match(after, /<episode-source-data>/, 'the research stays available');
});

test('grounding wording for artist episodes is unchanged', () => {
  const artist = { available: true as const, subject: 'Air', data: null, music: { type: 'artist' as const, artistId: 'x' } };
  assert.match(preparationGrounding(artist, 'restricted'), /restricted to this prepared artist/);
  assert.match(preparationGrounding(artist, 'degraded'), /^\n\nVerified episode subject: Air\nArtist music is unavailable/);
});
