// Album of the day: the pure half of walking a prepared album in its own
// running order. Shaped like the playlist walk (music/playlist-order.ts) and
// stored in the same cursor shape, but it never wraps. An album plays once per
// airing, and then the show is open again.

import type { PlaylistCursor } from '../schemas/playlist-cursor.js';
import type { InOrderTrack } from './playlist-order.js';

const FINISHED = '#finished';

// One walk per airing per album. A new occurrence starts at track 1; a restart
// inside the same airing resumes.
export function albumWalkSig(occurrenceId: string, albumId: string): string {
  return `album:${occurrenceId}:${albumId}`;
}

// A finished walk is recorded as its own cursor rather than inferred from the
// position, so "the album has finished" is said once and survives a restart.
export function isAlbumWalkFinished(cursor: PlaylistCursor | null | undefined, sig: string): boolean {
  return cursor?.sig === sig + FINISHED;
}

export function finishedCursor(sig: string, total: number, at: Date = new Date()): PlaylistCursor {
  return { sig: sig + FINISHED, index: Math.max(0, total), lastId: '', lastKey: '', at: at.toISOString() };
}

// One past the last pick, never wrapping. Found by its old slot, then by id.
// Album ids are stable for the length of an airing, so the title fallback the
// playlist walk needs for id rotation is not needed here. A last pick that has
// since left the album (a blocklist rule turned) resumes AT its old slot, which
// its successor slid into.
export function albumResumeIndex(tracks: readonly InOrderTrack[], cursor: PlaylistCursor | null | undefined, sig: string): number {
  if (!cursor || cursor.sig !== sig) return 0;
  const slot = Number.isInteger(cursor.index) && cursor.index >= 0 ? cursor.index : 0;
  if (slot < tracks.length && !!cursor.lastId && tracks[slot]?.id === cursor.lastId) return slot + 1;
  const byId = cursor.lastId ? tracks.findIndex(t => t?.id === cursor.lastId) : -1;
  if (byId >= 0) return byId + 1;
  return slot;
}

// The next track to air, or finished when nothing eligible remains after the
// resume point. `eligible` steps over tracks already queued or on air, so a
// last track waiting in the queue already counts as the album being done.
export function nextInAlbum<T extends InOrderTrack>(
  tracks: readonly T[],
  cursor: PlaylistCursor | null | undefined,
  sig: string,
  eligible: (track: T) => boolean,
): { track: T; index: number } | { finished: true } {
  if (isAlbumWalkFinished(cursor, sig)) return { finished: true };
  for (let index = albumResumeIndex(tracks, cursor, sig); index < tracks.length; index++) {
    const track = tracks[index];
    if (track && eligible(track)) return { track, index };
  }
  return { finished: true };
}
