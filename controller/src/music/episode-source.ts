import { z } from 'zod';
import { createHash } from 'node:crypto';
import * as db from './library-db.js';
import * as library from './library.js';
import * as subsonic from './subsonic.js';
import * as settings from '../settings.js';
import * as blocklist from './blocklist.js';
import { preparationArtistSchema, preparationTrackSchema, type PreparationTrack } from '../schemas/show-preparation.js';
import { resolveExcludedPlaylistIds, resolveShowPlaylistPool } from './show-playlist.js';
import { applyStrictLocks } from './show-filter.js';
import { excludesExplicit, withoutExplicit } from './explicit-policy.js';
import { applyTrackFloor } from './track-floor.js';
import { applyKnownTrackCeiling } from './track-duration.js';
import { mapPool } from '../util/async-pool.js';
import { trackKey } from './recency.js';
import { creditsArtist, songCredit } from './artist-credit.js';
import { orderAlbumTracks } from './album-order.js';

export interface ArtistEpisodeSource {
  kind: 'artist'; identity: string;
  artist: { id: string; name: string };
  tracks: PreparationTrack[];
  ids: Set<string>;
  // When this airing of the episode began (the preparation occurrence's
  // startsAt, epoch ms). The hard no-repeat guard holds what the airing has
  // played since then (#2320); absent = unknown.
  airingStartedAt?: number;
}
export interface AlbumEpisodeSource {
  kind: 'album'; identity: string;
  album: { id: string; name: string; artist: string; year: number | null };
  /** In album order (orderAlbumTracks), after the show's rules. */
  tracks: PreparationTrack[];
  ids: Set<string>;
  // As on ArtistEpisodeSource: when this airing began (#2320); absent = unknown.
  airingStartedAt?: number;
}
export type EpisodeSource = ArtistEpisodeSource | AlbumEpisodeSource;
const albums = new Map<string, { at: number; album: AlbumEpisodeSource['album']; tracks: PreparationTrack[] }>();
const catalogues = new Map<string, { at: number; artist: ArtistEpisodeSource['artist']; tracks: PreparationTrack[] }>();
type EpisodeShow = NonNullable<ReturnType<typeof settings.resolveActiveShow>>;

export function intersectEpisodeSource<T extends { id?: string | null }>(tracks: T[], source: EpisodeSource | null): T[] {
  return source ? tracks.filter(t => !!t.id && source.ids.has(t.id)) : tracks;
}

// The show's own rules over an episode's tracks: station archive, blocklist,
// excluded playlists, a strict playlist, strict locks, then the length ceiling
// and floor. One chain for every episode kind, so an album airing obeys exactly
// what an artist airing does. Order-preserving: every step is a filter.
async function applyEpisodeRules(input: PreparationTrack[], show: EpisodeShow, kind: EpisodeSource['kind']): Promise<PreparationTrack[]> {
  let tracks = blocklist.rejectBlocked(input.filter(track => !subsonic.isStationArchive(track)));
  const excluded = await resolveExcludedPlaylistIds(show);
  if (excluded) tracks = tracks.filter(t => !excluded.has(t.id));
  if (show.playlistStrict && show.playlistIds.length) {
    const playlist = await resolveShowPlaylistPool(show);
    if (!playlist) throw new Error(`The strict playlist could not be resolved for this ${kind} episode`);
    // Judged on the whole input, so the reason names the playlist only when
    // it is the cause, not an exclusion or the blocklist that emptied it.
    if (input.length && !input.some(t => playlist.ids.has(t.id))) {
      throw new Error(`None of this ${kind}'s tracks are in the show's playlists`);
    }
    tracks = tracks.filter(t => playlist.ids.has(t.id));
  }
  // Before the never-starve locks, so a lock that found only tagged tracks is
  // the one that gives way. Hard: an episode with nothing clean stands down below.
  tracks = withoutExplicit(tracks, excludesExplicit(show));
  if (show.filtersStrict) {
    const genres = (await Promise.all(show.genres.map(g => subsonic.resolveGenreName(g)))).filter((g): g is string => typeof g === 'string');
    tracks = applyStrictLocks(tracks, {
      genres, eras: show.eras, moods: show.moods, energies: show.energies,
      vocals: show.vocals === 'vocal' || show.vocals === 'instrumental' ? show.vocals : '',
    }, { starve: false });
  }
  return applyTrackFloor(applyKnownTrackCeiling(tracks, settings.effectiveTrackLengthLimits(show).selectionMaxSec), settings.effectiveMinTrackSec(show), { starve: true });
}

const revisionOf = (ids: Set<string>) => createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex').slice(0, 16);

export async function resolveArtistEpisodeSource(artistId: string, show: EpisodeShow, identity: string): Promise<ArtistEpisodeSource> {
  await library.load();
  let catalogue = catalogues.get(artistId);
  if (!catalogue || Date.now() - catalogue.at > 60_000) {
    const artist = preparationArtistSchema.parse(await subsonic.getArtist(artistId));
    if (artist.id !== artistId) throw new Error('The preparation artist is not in this library');
    const mirror = db.artistCatalogue(artistId, artist.album.map(album => album.id));
    const mirrored = mirror.tracks;
    const expected = artist.album.reduce((n, album) => n + (album.songCount ?? 0), 0);
    // Walked rows: like with like, the rows the mirror holds on the artist's
    // albums against the songs Navidrome counts there. Any row it needs without
    // album_artist_id (not walked since the column arrived) cannot be judged,
    // so the rule before it stands, the artist's own rows against that count,
    // and an upgraded station never does worse than before its next walk.
    // Before the walk, only the artist's own rows count, as they did: a row the
    // mirror holds only through a walked album_artist_id (a Trio record) must
    // not make up for an own song the mirror never reached.
    const covers = mirror.unwalked === 0 ? mirror.onAlbums >= expected
      : mirrored.filter(track => track.artistId === artistId).length >= expected;
    let tracks: PreparationTrack[];
    if (expected > 0 && artist.album.every(a => a.songCount != null) && covers) {
      tracks = mirrored;
    } else {
      if (artist.album.length > 128) throw new Error('Artist catalogue is too large to fetch before playback; run Library → Reconcile so the library mirror can answer it');
      const albums = await mapPool(artist.album, 4, async album => {
        const songs = z.array(preparationTrackSchema).parse(await subsonic.getAlbum(album.id));
        return songs.filter(song => creditsArtist(songCredit(song, album), artistId));
      });
      // The albums cover the records the artist is an album artist on; the
      // mirror adds the tracks credited first to them on someone else's record,
      // which getArtist does not list, so those survive either path (#2333).
      // Both sides keep creditsArtist's set, so the merge adds no other kind.
      const byId = new Map<string, PreparationTrack>();
      for (const track of [...albums.flat(), ...mirrored]) if (!byId.has(track.id)) byId.set(track.id, track);
      tracks = [...byId.values()];
    }
    catalogue = { at: Date.now(), artist: { id: artist.id, name: artist.name }, tracks };
    catalogues.set(artistId, catalogue);
    if (catalogues.size > 32) { const oldest = catalogues.keys().next().value; if (oldest) catalogues.delete(oldest); }
  }
  let tracks = await applyEpisodeRules(catalogue.tracks, show, 'artist');
  const seen = new Set<string>();
  tracks = tracks.filter(t => { const key = trackKey(t); if (seen.has(key)) return false; seen.add(key); return true; });
  if (!tracks.length) throw new Error('No playable songs remain for the prepared artist and show rules');
  const ids = new Set(tracks.map(t => t.id));
  return { kind: 'artist', identity: `${identity}:${revisionOf(ids)}`, artist: catalogue.artist, tracks, ids };
}

export async function resolveAlbumEpisodeSource(albumId: string, show: EpisodeShow, identity: string): Promise<AlbumEpisodeSource> {
  await library.load();
  let cached = albums.get(albumId);
  if (!cached || Date.now() - cached.at > 60_000) {
    const record = await subsonic.getAlbumRecord(albumId);
    if (!record || record.id !== albumId) throw new Error('The preparation album is not in this library');
    const songs = z.array(preparationTrackSchema).parse(record.songs);
    if (!songs.length) throw new Error('The preparation album has no songs');
    cached = {
      at: Date.now(),
      album: { id: record.id, name: record.name || songs[0].album || 'Untitled album', artist: record.artist || songs[0].artist, year: record.year ?? songs[0].year ?? null },
      tracks: orderAlbumTracks(songs),
    };
    albums.set(albumId, cached);
    if (albums.size > 32) { const oldest = albums.keys().next().value; if (oldest) albums.delete(oldest); }
  }
  let tracks = await applyEpisodeRules(cached.tracks, show, 'album');
  // Id only, never trackKey: an intro and its reprise, or a studio and a live
  // take, share a title and are still two places in the running order.
  const seen = new Set<string>();
  tracks = tracks.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
  if (!tracks.length) throw new Error('No playable songs remain for the prepared album and show rules');
  const ids = new Set(tracks.map(t => t.id));
  return { kind: 'album', identity: `${identity}:${revisionOf(ids)}`, album: cached.album, tracks, ids };
}

export async function randomLibraryArtist({ minDistinctTracks = 2 }: { minDistinctTracks?: number } = {}): Promise<{ id: string; name: string } | null> {
  await library.load();
  const mirrored = db.artistIdentities(Math.max(1, minDistinctTracks));
  const artists = await subsonic.getLibraryArtists();
  if (!artists.length) return null;
  const indexedIds = new Set(artists.map(artist => artist.id));
  const eligible = mirrored.filter(artist => indexedIds.has(artist.id));
  if (eligible.length) return eligible[Math.floor(Math.random() * eligible.length)];
  const remaining = artists.slice();
  for (let n = 0; n < Math.min(5, artists.length); n++) {
    const [artist] = remaining.splice(Math.floor(Math.random() * remaining.length), 1);
    const full = preparationArtistSchema.parse(await subsonic.getArtist(artist.id));
    if (full.album.reduce((count, album) => count + (album.songCount ?? 0), 0) >= minDistinctTracks) return { id: full.id, name: full.name };
  }
  return null;
}
