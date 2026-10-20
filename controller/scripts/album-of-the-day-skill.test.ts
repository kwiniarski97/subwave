// The album-of-the-day example skill (docs/examples/skills/album-of-the-day)
// against fake station services: the hard filters, choose() and its null
// fallback, the unfiltered last resort, blank config fields meaning their
// defaults, research filtering, and available:false only when Navidrome is down.

import test from 'node:test';
import assert from 'node:assert/strict';

const tool = await import('../../docs/examples/skills/album-of-the-day/tool.mjs');
// Offline by default; a test that wants Wikipedia swaps in its own answers.
const offline = async () => { throw new Error('offline'); };
tool.net.fetch = offline;

type Album = { id: string; name: string; artist: string; year: number | null; genre: string | null; songCount: number; duration: number; isCompilation: boolean };
const album = (id: string, extra: Partial<Album> = {}): Album =>
  ({ id, name: `Album ${id}`, artist: `Artist ${id}`, year: 1990, genre: 'Jazz', songCount: 9, duration: 45 * 60, isCompilation: false, ...extra });

function services({ pages = [] as Album[][], featured = [] as string[], played = [] as string[], choose = (_: any): number | null => 0, search = [] as any[], down = false, playable = (_id: string): boolean => true, searchHangs = false } = {}) {
  const calls = { random: [] as number[], choose: [] as any[], search: [] as string[] };
  let page = 0;
  return {
    calls,
    library: {
      randomAlbums: async ({ count }: { count: number }) => {
        calls.random.push(count);
        if (down) throw new Error('ECONNREFUSED');
        return count === 1 ? [album('any')] : (pages[page++] ?? []);
      },
      albumPlayable: async (id: string) => playable(id),
      getAlbum: async (id: string) => [{ id: `${id}-t2`, title: 'Two', discNumber: 1, track: 2, duration: 200 }, { id: `${id}-t1`, title: 'One', discNumber: 1, track: 1, duration: 180 }],
    },
    featured: { recentAlbumIds: async () => new Set(featured) },
    recentPlays: () => ({ ids: new Set(played), keys: new Set() }),
    choose: async (args: any) => { calls.choose.push(args); return choose(args); },
    searchReady: () => true,
    searchWeb: async (q: string) => { calls.search.push(q); return searchHangs ? new Promise(() => {}) : { results: search }; },
    log: () => {},
  };
}
const ctx = { activeShow: { name: 'Album of the day', topic: 'One record, start to finish' } };
// any: tsc infers the result union from the .mjs, and the tests read both arms.
const run = (s: ReturnType<typeof services>, config: Record<string, unknown> = {}): Promise<any> => tool.default(ctx, {}, s, config, {});

test('the hard filters run, and choose() picks among the survivors', async () => {
  const s = services({
    pages: [[
      album('comp', { isCompilation: true }), album('long', { duration: 130 * 60 }), album('short', { songCount: 3 }),
      album('unknown-length', { duration: 0 }), album('featured'), album('played'), album('good1'), album('good2'),
    ]],
    featured: ['featured'], played: ['played-t1'], choose: () => 1,
  });
  const out = await run(s);
  assert.equal(out.available, true);
  assert.deepEqual(out.music, { type: 'album', albumId: 'good2' });
  assert.equal(out.subject, 'Album good2 by Artist good2');
  assert.equal(s.calls.choose.length, 1);
  assert.equal(s.calls.choose[0].options.length, 2);
  assert.match(s.calls.choose[0].prompt, /One record, start to finish/);
  assert.deepEqual(out.data.tracklist.map((t: any) => t.title), ['One', 'Two'], 'tracklist in album order');
});

test('choose() answering null falls back to a random survivor', async () => {
  const s = services({ pages: [[album('a'), album('b')]], choose: () => null });
  const out = await run(s);
  assert.ok(['a', 'b'].includes(out.music.albumId));
});

test('a second page is drawn when the first has no survivors', async () => {
  const s = services({ pages: [[album('comp', { isCompilation: true })], [album('later')]] });
  const out = await run(s);
  assert.equal(out.music.albumId, 'later');
  assert.equal(s.calls.choose.length, 0, 'a single survivor needs no model call');
});

test('no survivors on two pages: one unfiltered random album, no model call', async () => {
  const s = services({ pages: [[album('comp', { isCompilation: true })], [album('long', { duration: 999 * 60 })]] });
  const out = await run(s);
  assert.equal(out.music.albumId, 'any');
  assert.deepEqual(s.calls.random, [20, 20, 1]);
  assert.equal(s.calls.choose.length, 0);
});

test('blank config fields mean their defaults, and set ones are honoured', async () => {
  const blank = await run(services({ pages: [[album('long', { duration: 115 * 60 }), album('ok')]] }), { maxAlbumMinutes: '', minTracks: '' });
  assert.equal(blank.music.albumId, 'ok', 'blank maxAlbumMinutes is 110, not 0 and not unlimited');
  const raised = await run(services({ pages: [[album('long', { duration: 115 * 60 })]] }), { maxAlbumMinutes: 120 });
  assert.equal(raised.music.albumId, 'long');
});

test('research keeps up to five results that name the album and its artist, 700 characters each', async () => {
  const hit = (n: number) => ({ title: `Album ok session ${n}`, url: `https://example.org/${n}`, content: `Artist ok ${'x'.repeat(900)}` });
  const s = services({ pages: [[album('ok')]], search: [hit(1), { title: 'Unrelated', url: 'u', content: 'nothing' }, hit(2), hit(3), hit(4), hit(5), hit(6)] });
  const out = await run(s);
  assert.deepEqual(s.calls.search, ['Artist ok "Album ok" album', 'Artist ok Album ok album review']);
  assert.equal(out.data.research.length, 5);
  assert.ok(out.data.research.every((r: any) => r.content.length === 700));
});

test('an edition title is searched and matched by the record\'s own name', async () => {
  const reissue = album('io', { name: 'Ode to Io (Remastered Deluxe Edition)', artist: 'Lowrider', year: 2020 });
  const s = services({ pages: [[reissue]], search: [
    // The page that aired as research, verbatim: another band's album, naming this one, artist and all, in a sidebar.
    { title: 'Domkraft - Dawn Of Man | Deezer', url: 'https://deezer.example', content: 'Plans Features Music · Log in Sign up · Album cover of Ode to Io (Remastered Deluxe Edition) Shivaree by Lowrider.' },
    { title: 'Lowrider – Ode to Io review', url: 'https://review.example', content: 'Ode to Io, the Swedish band Lowrider\'s debut, is a desert rock landmark.' },
  ] });
  const out = await run(s);
  assert.deepEqual(s.calls.search, ['Lowrider "Ode to Io" album', 'Lowrider Ode to Io album review']);
  assert.deepEqual(out.data.research.map((r: any) => r.url), ['https://review.example']);
  assert.equal(out.data.album.year, undefined, 'a reissue tag does not date the record');
  assert.equal(out.data.album.editionYear, 2020);
});

test('the tracklist carries no running times', async () => {
  const out = await run(services({ pages: [[album('ok')]] }));
  assert.deepEqual(out.data.tracklist, [{ position: 1, title: 'One' }, { position: 2, title: 'Two' }]);
  assert.equal(out.data.album.year, 1990, 'a plain title keeps its year');
});

test('baseTitle strips edition marks only', () => {
  assert.equal(tool.baseTitle('Ode to Io (Remastered Deluxe Edition)'), 'Ode to Io');
  assert.equal(tool.baseTitle('Revolver [2009 Remaster] (Super Deluxe)'), 'Revolver');
  assert.equal(tool.baseTitle('Live at Leeds (Live)'), 'Live at Leeds (Live)');
  assert.equal(tool.baseTitle('(What\'s the Story) Morning Glory?'), '(What\'s the Story) Morning Glory?');
  assert.equal(tool.baseTitle('(Remastered)'), '(Remastered)', 'never strips a title to nothing');
});

test('a Wikipedia lead about the album leads the research', async () => {
  const urls: string[] = [];
  tool.net.fetch = async (url: URL) => {
    urls.push(String(url));
    const body = url.searchParams.get('list') === 'search'
      ? { query: { search: [{ title: 'Ode to Io' }] } }
      : { query: { pages: { 1: { extract: 'Ode to Io is the debut album by Swedish stoner rock band Lowrider, released in 2000.' } } } };
    return new Response(JSON.stringify(body));
  };
  try {
    const out = await run(services({ pages: [[album('io', { name: 'Ode to Io (Remastered)', artist: 'Lowrider' })]] }));
    assert.equal(out.data.research[0].title, 'Ode to Io (Wikipedia)');
    assert.match(out.data.research[0].content, /released in 2000/);
    assert.match(urls[0], /srsearch=Lowrider\+Ode\+to\+Io\+album/);
  } finally {
    tool.net.fetch = offline;
  }
});

test('a Wikipedia article that never names the artist is left out', async () => {
  tool.net.fetch = async (url: URL) => new Response(JSON.stringify(url.searchParams.get('list') === 'search'
    ? { query: { search: [{ title: 'Ode to Io' }] } }
    : { query: { pages: { 1: { extract: 'Ode to Io is a poem.' } } } }));
  try {
    const out = await run(services({ pages: [[album('io', { name: 'Ode to Io', artist: 'Lowrider' })]] }));
    assert.deepEqual(out.data.research, []);
  } finally {
    tool.net.fetch = offline;
  }
});

test('the album fits the airing: a 60-minute takeover never gets an 85-minute record', async () => {
  const now = Date.now();
  const episode = { startsAt: now - 60_000, endsAt: now + 59 * 60_000 };
  const s = services({ pages: [[album('long', { duration: 85 * 60 }), album('fits', { duration: 50 * 60 })]] });
  const out: any = await tool.default({ ...ctx, episode }, {}, s, {}, {});
  assert.equal(out.music.albumId, 'fits');
});

test('slotMinutes counts from the start, or from now once started; no window is null', () => {
  const now = 1_000_000_000_000;
  assert.equal(tool.slotMinutes({ episode: { startsAt: now + 3_600_000, endsAt: now + 7_200_000 } }, now), 60, 'prepared ahead of the show');
  assert.equal(tool.slotMinutes({ episode: { startsAt: now - 600_000, endsAt: now + 1_800_000 } }, now), 30, 'already on air');
  assert.equal(tool.slotMinutes({}, now), null);
});

test('a slot too short for any album keeps the configured ceiling', async () => {
  const now = Date.now();
  const s = services({ pages: [[album('ok', { duration: 45 * 60 })]] });
  const out: any = await tool.default({ ...ctx, episode: { startsAt: now, endsAt: now + 5 * 60_000 } }, {}, s, {}, {});
  assert.equal(out.music.albumId, 'ok');
});

test('Navidrome unreachable: available false', async () => {
  const out = await run(services({ down: true }));
  assert.equal(out.available, false);
  assert.match(out.reason, /unreachable/);
});

test('an album the show\'s rules cannot play is never chosen', async () => {
  const s = services({ pages: [[album('rejected'), album('ok')]], playable: id => id !== 'rejected' });
  const out = await run(s);
  assert.equal(out.music.albumId, 'ok');
  assert.equal(s.calls.choose.length, 0, 'only one playable survivor');
});

test('slow research is abandoned inside its budget, and the album still airs', async () => {
  const saved = tool.timing.researchMs;
  tool.timing.researchMs = 20;
  try {
    const out = await run(services({ pages: [[album('ok')]], searchHangs: true }));
    assert.equal(out.available, true);
    assert.deepEqual(out.data.research, []);
  } finally {
    tool.timing.researchMs = saved;
  }
});
