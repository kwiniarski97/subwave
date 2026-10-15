// Album of the day — the album episode source: album order, the same show
// rules as an artist episode, and id-only dedupe so a reprise keeps its slot.

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const root = await mkdtemp(join(tmpdir(), 'subwave-album-source-'));
let albumCalls = 0;
// Deliberately out of order: Navidrome's return order is not the running order.
const songs = [
  { id: 'd2t1', title: 'Side B Opener', artist: 'Band', albumId: 'lp', album: 'Record', discNumber: 2, track: 1, duration: 200 },
  { id: 'd1t2', title: 'Theme', artist: 'Band', albumId: 'lp', album: 'Record', discNumber: 1, track: 2, duration: 200 },
  { id: 'd1t1', title: 'Intro', artist: 'Band', albumId: 'lp', album: 'Record', discNumber: 1, track: 1, duration: 200 },
  { id: 'd1t3', title: 'Theme', artist: 'Band', albumId: 'lp', album: 'Record', discNumber: 1, track: 3, duration: 200 },
  { id: 'short', title: 'Skit', artist: 'Band', albumId: 'lp', album: 'Record', discNumber: 1, track: 4, duration: 10 },
];
const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const id = url.searchParams.get('id');
  let body: Record<string, unknown> = {};
  if (url.pathname.endsWith('/getAlbum')) {
    albumCalls++;
    body = id === 'lp'
      ? { album: { id: 'lp', name: 'Record', artist: 'Band', year: 2001, originalReleaseDate: { year: 1999 }, song: songs } }
      : { album: { id: 'someone-else', name: 'Other', artist: 'Other', song: [] } };
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', ...body } }));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
process.env.STATE_DIR = root;
process.env.NAVIDROME_URL = `http://127.0.0.1:${address.port}`;
process.env.NAVIDROME_USER = 'test'; process.env.NAVIDROME_PASS = 'test';
const db = await import('../src/music/library-db.js');
const library = await import('../src/music/library.js');
const blocklist = await import('../src/music/blocklist.js');
const settings = await import('../src/settings.js');
const { resolveAlbumEpisodeSource, intersectEpisodeSource } = await import('../src/music/episode-source.js');
const { orderAlbumTracks } = await import('../src/broadcast/block-queue.js');
const { orderAlbumTracks: shared } = await import('../src/music/album-order.js');
const { showSchema } = await import('../src/schemas/show.js');
await settings.load(); await library.load(); await blocklist.load();
after(async () => { db.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });

function show(fields: Record<string, unknown> = {}) {
  const parsed = showSchema({ personaIds: null, moodNames: null, themeIds: null, minTrackSeconds: null })
    .parse({ id: 's_album', name: 'Album hour', personaId: '', minTrackLengthSeconds: 30, ...fields });
  assert.ok(parsed.id);
  return { ...parsed, id: parsed.id, persona: null, guests: [] };
}

test('the block queue and the album source share one ordering function', () => {
  assert.equal(orderAlbumTracks, shared);
});

test('tracks come back in disc/track order, filtered by the show rules, with duplicate titles kept', async () => {
  const source = await resolveAlbumEpisodeSource('lp', show(), 'occ-1:lp');
  assert.equal(source.kind, 'album');
  assert.deepEqual(source.tracks.map(t => t.id), ['d1t1', 'd1t2', 'd1t3', 'd2t1'],
    'album order; the 10 s skit falls to the show floor; both "Theme" takes survive');
  assert.deepEqual(source.album, { id: 'lp', name: 'Record', artist: 'Band', year: 1999 }, 'original release year wins over a reissue year');
  assert.ok(source.identity.startsWith('occ-1:lp:'));
  assert.deepEqual(intersectEpisodeSource([{ id: 'd1t2' }, { id: 'stranger' }], source), [{ id: 'd1t2' }]);
});

test('the album record is cached for a minute', async () => {
  const before = albumCalls;
  await resolveAlbumEpisodeSource('lp', show(), 'occ-1:lp');
  assert.equal(albumCalls, before);
});

test('an album id the server does not return is refused', async () => {
  await assert.rejects(resolveAlbumEpisodeSource('missing', show(), 'occ-1:missing'), /not in this library/);
});
