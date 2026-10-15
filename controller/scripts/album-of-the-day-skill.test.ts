// The album-of-the-day example skill (docs/examples/skills/album-of-the-day)
// against fake station services: the hard filters, choose() and its null
// fallback, the unfiltered last resort, blank config fields meaning their
// defaults, research filtering, and available:false only when Navidrome is down.

import test from 'node:test';
import assert from 'node:assert/strict';

const tool = await import('../../docs/examples/skills/album-of-the-day/tool.mjs');

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

test('research keeps up to four results that name the album, 700 characters each', async () => {
  const hit = (n: number) => ({ title: `Album ok session ${n}`, url: `https://example.org/${n}`, content: 'x'.repeat(900) });
  const s = services({ pages: [[album('ok')]], search: [hit(1), { title: 'Unrelated', url: 'u', content: 'nothing' }, hit(2), hit(3), hit(4), hit(5)] });
  const out = await run(s);
  assert.equal(s.calls.search[0], '"Artist ok" "Album ok" album recording history');
  assert.equal(out.data.research.length, 4);
  assert.ok(out.data.research.every((r: any) => r.content.length === 700));
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
