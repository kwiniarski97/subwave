// Outside the crate — queue ONE song the station's library does not hold, from
// octo-fiesta (a Subsonic proxy over Deezer/Qobuz/Tidal), and hand the DJ the
// facts to trail it. Full signature:
//   (ctx, state, services, config, input) => data
//
// Two things a data tool does not normally do, and how this one does them:
//
// - It reads a second Subsonic server. octo-fiesta merges provider results
//   into getTopSongs and marks the ones the library lacks `isExternal: true`
//   with an `ext-<provider>-song-<id>` id. Only those are offered.
// - It QUEUES a track. Skills have no queue service; this one calls the same
//   admin route the MCP server's subwave_queue_track uses (POST
//   /dj/queue-track) on the controller it runs inside, with the admin
//   credentials already in process.env. The controller then streams the ext-
//   id from OCTO_FIESTA_URL (music/subsonic.ts) — without that, the push is
//   accepted and Liquidsoap silently drops it.
//
// The whole tool runs under the station's 8s guard, so every call is bounded
// and there is no second-chance search: an artist with nothing outside the
// library is `{ available: false }`, and the DJ can steer to another artist
// through the `artist` input on its next look.

import crypto from 'node:crypto';

export const description =
  'Queue ONE song from OUTSIDE the station library (streamed in via octo-fiesta) by the on-air artist, or by `artist` if given, and return what was queued: { available, artist, title, album, year, via }. `available: false` when that artist has nothing suitable outside the library or the queue refused it — nothing was queued then.';

export const inputs = {
  artist: 'Optional: a related artist to look through instead of the one on air. Leave empty to use the on-air artist.',
};

const OCTO_URL = (process.env.OCTO_FIESTA_URL || '').replace(/\/+$/, '');
const USER = process.env.OCTO_FIESTA_USER || process.env.NAVIDROME_USER || '';
const PASS = process.env.OCTO_FIESTA_PASS || process.env.NAVIDROME_PASS || '';

export const ready = () => Boolean(OCTO_URL && USER && PASS);

// Versions a radio slot should not get by accident.
const ODD_VERSION_RE = /\b(live|remix|mix\)|karaoke|instrumental|sped up|slowed|acoustic version|demo)\b/i;
const MIN_SEC = 150;
const MAX_SEC = 420;
const REMEMBER = 100;

function octoUrl(endpoint, params) {
  const salt = crypto.randomBytes(8).toString('hex');
  const token = crypto.createHash('md5').update(PASS + salt).digest('hex');
  const url = new URL(`${OCTO_URL}/rest/${endpoint}`);
  for (const [k, v] of Object.entries({ u: USER, t: token, s: salt, v: '1.16.1', c: 'sub-wave-outside', f: 'json', ...params })) {
    url.searchParams.set(k, String(v));
  }
  return url;
}

const keyOf = (s) => `${String(s.title || '').toLowerCase().trim()}|${String(s.artist || '').toLowerCase().trim()}`;

async function outsideSongs(artist) {
  const res = await fetch(octoUrl('getTopSongs', { artist, count: 40 }), { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`octo-fiesta HTTP ${res.status}`);
  const songs = (await res.json())?.['subsonic-response']?.topSongs?.song ?? [];
  return songs.filter((s) => s?.isExternal === true && /^ext-[a-z]+-song-/.test(String(s.id || '')));
}

async function queueTrack(song) {
  const port = process.env.PORT || 7701;
  const headers = { 'content-type': 'application/json' };
  if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
    headers.authorization = `Basic ${Buffer.from(`${process.env.ADMIN_USER}:${process.env.ADMIN_PASS}`).toString('base64')}`;
  }
  const body = { id: song.id, title: song.title, artist: song.artist, album: song.album, year: song.year || undefined, duration: song.duration };
  const res = await fetch(`http://127.0.0.1:${port}/dj/queue-track`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(2500),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `queue-track HTTP ${res.status}`);
  return json.queuePosition;
}

export default async function outsideTheCrate(ctx, state, services, config, input) {
  const onAir = services.nowPlaying()?.artist;
  const artist = String(input?.artist || '').trim() || onAir;
  if (!artist || /^unknown/i.test(artist)) return { available: false };

  let songs;
  try {
    songs = await outsideSongs(artist);
  } catch (err) {
    services.log(`outside-the-crate: octo-fiesta lookup failed — ${err.message}`);
    return { available: false };
  }

  const { ids, keys } = services.recentPlays(30 * 24);
  const offered = new Set(state.offered || []);
  const usable = songs.filter((s) =>
    s.title && s.artist
    && s.duration >= MIN_SEC && s.duration <= MAX_SEC
    && !ODD_VERSION_RE.test(s.title)
    && !ids.has(s.id) && !keys.has(keyOf(s)) && !offered.has(s.id));
  if (!usable.length) {
    services.log(`outside-the-crate: nothing outside the library for "${artist}" (${songs.length} external, none usable)`);
    return { available: false };
  }

  // Top-songs order is popularity; draw from the top few rather than always
  // the biggest hit, so repeat firings on one artist don't converge.
  const pick = usable[Math.floor(Math.random() * Math.min(5, usable.length))];
  let position;
  try {
    position = await queueTrack(pick);
  } catch (err) {
    services.log(`outside-the-crate: could not queue ${pick.artist} — ${pick.title}: ${err.message}`);
    return { available: false };
  }

  state.offered = [pick.id, ...offered].slice(0, REMEMBER);
  services.log(`outside-the-crate: queued ${pick.artist} — ${pick.title} (${pick.id}) at position ${position}`);
  return {
    available: true,
    artist: pick.artist,
    title: pick.title,
    album: pick.album || '',
    year: pick.year || null,
    via: onAir && artist.toLowerCase() !== onAir.toLowerCase() ? `related to ${onAir}` : 'same artist as on air',
  };
}
