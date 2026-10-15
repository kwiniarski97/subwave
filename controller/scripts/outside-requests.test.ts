// Listener requests from outside the library (octo-fiesta). A named request the
// library cannot satisfy may queue an `ext-` song, but only on a strict match:
// a loose outside hit airs the WRONG song under a "here's your request" intro,
// which is worse than the honest stand-in the cascade already gives.

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createTempDir } from './test-utils/temp-dir.js';

// An outside search that answers with a canned search3 page.
let lastQuery: URLSearchParams | null = null;
let page: any[] = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  lastQuery = url.searchParams;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', searchResult3: { song: page } } }));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as AddressInfo).port;

process.env.STATE_DIR = createTempDir(join(tmpdir(), 'subwave-outside-req-'));
process.env.NAVIDROME_URL = 'http://navidrome.test:4533';
process.env.NAVIDROME_USER = 'fixture';
process.env.NAVIDROME_PASS = 'fixture-secret';
process.env.OCTO_FIESTA_URL = `http://127.0.0.1:${port}`;

const policy = await import('../src/music/outside-request-policy.js');
const subsonic = await import('../src/music/subsonic.js');
const settings = await import('../src/settings.js');
const { setCache } = await import('../src/settings/store.js');
const { PICKER_TOOLS } = await import('../src/llm/internal/tools/picker/index.js');
const { buildPickerContext, pickerScope } = await import('../src/llm/internal/tools/picker/scope.js');
await settings.load();

test.after(() => server.close());

const ext = (id: string, title: string, artist: string, extra: Record<string, unknown> = {}) =>
  ({ id: `ext-deezer-song-${id}`, title, artist, album: 'A', duration: 240, isExternal: true, ...extra });

// --- matching --------------------------------------------------------------

test('artist match is strict but folds case, accents, punctuation and a leading "the"', () => {
  assert.ok(policy.artistMatches('Beyonce', 'Beyoncé'));
  assert.ok(policy.artistMatches('the beatles', 'The Beatles'));
  assert.ok(policy.artistMatches('Beatles', 'The Beatles'));
  assert.ok(policy.artistMatches('AC/DC', 'ACDC'));
  assert.ok(policy.artistMatches('Simon & Garfunkel', 'Simon and Garfunkel'));
  // The near-miss check elsewhere accepts these; an outside pick must not.
  assert.ok(!policy.artistMatches('Queen', 'Queens of the Stone Age'));
  assert.ok(!policy.artistMatches('Prince', 'Prince Buster'));
  assert.ok(!policy.artistMatches('', 'Anyone'));
});

test('a featured credit satisfies the lead or the guest', () => {
  assert.ok(policy.artistMatches('Daft Punk', 'Daft Punk feat. Pharrell Williams'));
  assert.ok(policy.artistMatches('Pharrell Williams', 'Daft Punk ft. Pharrell Williams'));
  // `&` is part of real band names, so it never splits a credit.
  assert.ok(!policy.artistMatches('Simon', 'Simon & Garfunkel'));
});

test('title match ignores a bracketed or dashed version suffix', () => {
  assert.ok(policy.titleMatches('Get Lucky', 'Get Lucky (Radio Edit)'));
  assert.ok(policy.titleMatches('get lucky', 'Get Lucky - 2013 Remaster'));
  assert.ok(policy.titleMatches("Don't Stop Me Now", 'Dont Stop Me Now'));
  assert.ok(!policy.titleMatches('Lucky', 'Get Lucky'));
  assert.ok(!policy.titleMatches('Get Lucky', 'Lose Yourself to Dance'));
});

test('the requested title is a search term with the artist taken out', () => {
  assert.equal(policy.requestedTitle(['Daft Punk Get Lucky'], 'Daft Punk'), 'Get Lucky');
  assert.equal(policy.requestedTitle(['Get Lucky'], 'Daft Punk'), 'Get Lucky');
  assert.equal(policy.requestedTitle(['Daft Punk'], 'Daft Punk'), null);
  assert.equal(policy.requestedTitle([], 'Daft Punk'), null);
  // No artist named: a bare term cannot be told apart from an artist name.
  assert.equal(policy.requestedTitle(['Get Lucky'], null), null);
});

test('a library pick satisfies a named request only on the artist (and the title, when one was named)', () => {
  const song = { id: 'lib1', title: 'Get Lucky', artist: 'Daft Punk' };
  assert.ok(policy.satisfiesNamedRequest(song, { artist: 'Daft Punk', title: null }));
  assert.ok(policy.satisfiesNamedRequest(song, { artist: 'Daft Punk', title: 'Get Lucky' }));
  assert.ok(!policy.satisfiesNamedRequest(song, { artist: 'Daft Punk', title: 'One More Time' }));
  assert.ok(!policy.satisfiesNamedRequest(song, { artist: 'Justice', title: null }));
  assert.ok(!policy.satisfiesNamedRequest(null, { artist: 'Daft Punk', title: null }));
});

test('outside candidates are external, strictly matched, not odd versions, not recent', () => {
  const songs = [
    { id: 'lib1', title: 'Get Lucky', artist: 'Daft Punk' },                 // library row
    ext('1', 'Get Lucky (Live)', 'Daft Punk'),                                // odd version
    ext('2', 'Get Lucky', 'Daft Punk Tribute Band'),                          // wrong artist
    ext('3', 'Get Lucky', 'Daft Punk', { isExternal: false }),                // not external
    { id: 'deezer-3', title: 'Get Lucky', artist: 'Daft Punk', isExternal: true }, // not an ext- song id
    ext('4', 'Get Lucky (Radio Edit)', 'Daft Punk feat. Pharrell Williams'),
    ext('5', 'Get Lucky', 'Daft Punk'),
    ext('6', 'Instant Crush', 'Daft Punk'),
  ];
  const out = policy.outsideCandidates(songs, {
    artist: 'Daft Punk', title: 'Get Lucky', recentIds: new Set(['ext-deezer-song-5']),
  });
  assert.deepEqual(out.map((s: any) => s.id), ['ext-deezer-song-4']);
});

test('an odd version is allowed when the listener asked for it', () => {
  // "live" is in the request, so the version filter stands down.
  for (const title of ['Get Lucky live', 'Get Lucky (Live)']) {
    const out = policy.outsideCandidates([ext('1', 'Get Lucky (Live)', 'Daft Punk')], {
      artist: 'Daft Punk', title, recentIds: new Set(),
    });
    assert.equal(out.length, 1, title);
  }
});

test('no artist named → no outside candidates at all', () => {
  assert.deepEqual(policy.outsideCandidates([ext('1', 'Get Lucky', 'Daft Punk')], {
    artist: null, title: 'Get Lucky', recentIds: new Set(),
  }), []);
});

// --- gate and hourly cap ---------------------------------------------------

test('the hourly cap counts outside queues inside a rolling hour', () => {
  const now = 10_000_000;
  const stamps = [now - 3_700_000, now - 1_000, now - 2_000];
  assert.ok(policy.withinHourlyCap(stamps, now, 3));
  assert.ok(!policy.withinHourlyCap(stamps, now, 2));
});

test('outside requests are off by default and need octo-fiesta configured', async () => {
  assert.equal(settings.get().requests.outsideLibrary, false);
  assert.equal(policy.outsideRequestsAllowed(), false);
  await settings.update({ requests: { outsideLibrary: true } });
  assert.equal(policy.outsideRequestsAllowed(), true);
  await settings.update({ requests: { outsideLibrary: false } });
});

test('the cap closes the gate once reached', async () => {
  await settings.update({ requests: { outsideLibrary: true, outsideHourlyCap: 1 } });
  policy.resetOutsideLedgerForTests();
  assert.equal(policy.outsideRequestsAllowed(), true);
  policy.noteOutsideQueued('ext-deezer-song-9');
  assert.equal(policy.outsideRequestsAllowed(), false);
  // A library id is not an outside queue and is not counted.
  policy.resetOutsideLedgerForTests();
  policy.noteOutsideQueued('lib1');
  assert.equal(policy.outsideRequestsAllowed(), true);
  await settings.update({ requests: { outsideLibrary: false, outsideHourlyCap: 4 } });
});

test('outsideHourlyCap defaults to 4 and clamps to 1–60', async () => {
  assert.equal(settings.get().requests.outsideHourlyCap, 4);
  await settings.update({ requests: { outsideHourlyCap: 999 } });
  assert.equal(settings.get().requests.outsideHourlyCap, 60);
  await settings.update({ requests: { outsideHourlyCap: 0 } });
  assert.equal(settings.get().requests.outsideHourlyCap, 1);
  await settings.update({ requests: { outsideHourlyCap: null, outsideLibrary: 'yes' } });
  assert.equal(settings.get().requests.outsideHourlyCap, 1, 'a cleared field keeps the stored value');
  assert.equal(settings.get().requests.outsideLibrary, false, 'a non-boolean is ignored');
  await settings.update({ requests: { outsideHourlyCap: 4 } });
});

test('both outside settings survive a cold load', async () => {
  await settings.update({ requests: { outsideLibrary: true, outsideHourlyCap: 9 } });
  setCache(null);
  await settings.load();
  assert.equal(settings.get().requests.outsideLibrary, true);
  assert.equal(settings.get().requests.outsideHourlyCap, 9);
  await settings.update({ requests: { outsideLibrary: false, outsideHourlyCap: 4 } });
});

// --- the outside search ----------------------------------------------------

test('searchOutside queries octo-fiesta and keeps only external ext- songs', async () => {
  page = [
    { id: 'lib1', title: 'Get Lucky', artist: 'Daft Punk' },
    ext('1', 'Get Lucky', 'Daft Punk'),
    { id: 'ext-deezer-album-1', title: 'RAM', artist: 'Daft Punk', isExternal: true },
  ];
  const songs = await subsonic.searchOutside('Daft Punk Get Lucky');
  assert.deepEqual(songs.map((s: any) => s.id), ['ext-deezer-song-1']);
  assert.equal(lastQuery?.get('query'), 'Daft Punk Get Lucky');
  assert.equal(lastQuery?.get('u'), 'fixture');
});

// --- the request agent's tool ----------------------------------------------

const toolNames = (scope: any) => {
  const ctx = { ...buildPickerContext(pickerScope(scope)), hasTextEmbeddings: false, hasAudioEmbeddings: false, hasEmbeddingProvider: false };
  return PICKER_TOOLS.filter((m: any) => !m.available || m.available(ctx)).map((m: any) => m.name);
};

test('searchOutsideLibrary is offered only when the request scope opts in', () => {
  assert.ok(!toolNames({}).includes('searchOutsideLibrary'));
  assert.ok(toolNames({ outsideLibrary: true }).includes('searchOutsideLibrary'));
});

test('searchOutsideLibrary returns strict matches and records them in seen', async () => {
  page = [ext('1', 'Get Lucky', 'Daft Punk'), ext('2', 'Get Lucky', 'Someone Else')];
  const ctx = buildPickerContext(pickerScope({ outsideLibrary: true }));
  const mod = PICKER_TOOLS.find((m: any) => m.name === 'searchOutsideLibrary')!;
  const t: any = mod.build(ctx);
  const out = await t.execute({ artist: 'Daft Punk', title: 'Get Lucky' }, {});
  assert.deepEqual(out.tracks.map((s: any) => s.id), ['ext-deezer-song-1']);
  assert.ok(ctx.seen.has('ext-deezer-song-1'), 'the chosen id must validate like any tool result');
  assert.match(out.note, /outside/i);

  page = [ext('2', 'Get Lucky', 'Someone Else')];
  const none = await t.execute({ artist: 'Daft Punk', title: 'Get Lucky' }, {});
  assert.deepEqual(none.tracks, []);
});
