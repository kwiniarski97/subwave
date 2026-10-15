// The outside-the-crate example skill (docs/examples/skills/outside-the-crate)
// against loopback stand-ins for octo-fiesta and the controller's own
// POST /dj/queue-track. Pins the two things that make it more than a data
// tool: only songs octo-fiesta marks external are ever queued, and nothing is
// queued when the tool reports `available: false`.

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

type Handler = (req: IncomingMessage, url: URL, body: string, res: ServerResponse) => void;

async function serve(handler: () => Handler) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler()(req, new URL(req.url || '/', 'http://127.0.0.1'), body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return { server, port: (server.address() as AddressInfo).port };
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const song = (id: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id, title, artist: 'Air', album: 'Talkie Walkie', year: 2004, duration: 250, isExternal: id.startsWith('ext-'), ...extra });

let topSongs: Record<string, unknown>[] = [];
let octoQuery: URL | null = null;
const octo = await serve(() => (_req, url, _body, res) => {
  octoQuery = url;
  json(res, 200, { 'subsonic-response': { status: 'ok', topSongs: { song: topSongs } } });
});

let queueStatus = 200;
const queued: { auth?: string; body: Record<string, unknown> }[] = [];
const controller = await serve(() => (req, url, body, res) => {
  assert.equal(url.pathname, '/dj/queue-track');
  queued.push({ auth: req.headers.authorization, body: JSON.parse(body) });
  if (queueStatus !== 200) return json(res, queueStatus, { error: 'track is on the never-play blocklist' });
  json(res, 200, { ok: true, queuePosition: 2 });
});

process.env.OCTO_FIESTA_URL = `http://127.0.0.1:${octo.port}/`;
process.env.OCTO_FIESTA_USER = 'radio';
process.env.OCTO_FIESTA_PASS = 'secret';
process.env.PORT = String(controller.port);
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'pw';

const tool = await import('../../docs/examples/skills/outside-the-crate/tool.mjs');

test.after(() => { octo.server.close(); controller.server.close(); });

const logs: string[] = [];
function services(onAir: string | null = 'Air', recent: { ids?: string[]; keys?: string[] } = {}) {
  return {
    nowPlaying: () => (onAir ? { artist: onAir, title: 'Cherry Blossom Girl' } : null),
    recentPlays: () => ({ ids: new Set(recent.ids || []), keys: new Set(recent.keys || []) }),
    log: (m: string) => logs.push(m),
  };
}

function reset(songs: Record<string, unknown>[]) {
  topSongs = songs;
  queued.length = 0;
  queueStatus = 200;
  octoQuery = null;
}

test('ready only with octo-fiesta URL and a login', () => {
  assert.equal(tool.ready(), true);
});

test('queues an external song, never a library one, with admin auth', async () => {
  reset([song('lib1', 'Venus'), song('ext-deezer-song-7', 'Alone in Kyoto')]);
  const state: Record<string, unknown> = {};
  const out = await tool.default({}, state, services(), {}, {});
  assert.deepEqual(out, { available: true, artist: 'Air', title: 'Alone in Kyoto', album: 'Talkie Walkie', year: 2004, via: 'same artist as on air' });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].body.id, 'ext-deezer-song-7');
  assert.equal(queued[0].auth, `Basic ${Buffer.from('admin:pw').toString('base64')}`);
  assert.equal(octoQuery?.searchParams.get('artist'), 'Air');
  assert.equal(octoQuery?.searchParams.get('u'), 'radio');
  assert.equal(octoQuery?.searchParams.get('p'), null, 'never sends the password in clear');
  assert.deepEqual(state.offered, ['ext-deezer-song-7']);
});

test('the agent can steer to a related artist', async () => {
  reset([song('ext-deezer-song-9', 'La Femme d\'Argent', { artist: 'Phoenix' })]);
  const out = await tool.default({}, {}, services(), {}, { artist: 'Phoenix' });
  assert.equal(octoQuery?.searchParams.get('artist'), 'Phoenix');
  assert.equal(out.via, 'related to Air');
});

test('filters odd versions, bad lengths, recent plays and repeats — and queues nothing', async () => {
  reset([
    song('ext-deezer-song-1', 'Sexy Boy (Live)'),
    song('ext-deezer-song-2', 'Intro', { duration: 40 }),
    song('ext-deezer-song-3', 'Long Jam', { duration: 900 }),
    song('ext-deezer-song-4', 'Played Lately'),
    song('ext-deezer-song-5', 'Offered Before'),
    song('ext-deezer-song-6', 'Played By Key'),
  ]);
  const state = { offered: ['ext-deezer-song-5'] };
  const out = await tool.default({}, state, services('Air', { ids: ['ext-deezer-song-4'], keys: ['played by key|air'] }), {}, {});
  assert.deepEqual(out, { available: false });
  assert.equal(queued.length, 0);
});

test('a refused push reports available: false and remembers nothing', async () => {
  reset([song('ext-deezer-song-8', 'Kelly Watch the Stars')]);
  queueStatus = 409;
  const state: Record<string, unknown> = {};
  const out = await tool.default({}, state, services(), {}, {});
  assert.deepEqual(out, { available: false });
  assert.equal(state.offered, undefined);
  assert.ok(logs.some((l) => l.includes('never-play blocklist')));
});

test('nothing on air means nothing to do', async () => {
  reset([song('ext-deezer-song-8', 'Kelly Watch the Stars')]);
  assert.deepEqual(await tool.default({}, {}, services(null), {}, {}), { available: false });
  assert.equal(octoQuery, null);
});
