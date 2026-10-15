// Album of the day: the impure half. It records where each show's album walk
// has got to, in a file of its own (state/album-cursors.json). The playlist
// store is keyed by the same show id, so sharing it would let an album airing
// move an in-order show's playlist position.
//
// Like the playlist walk, the cursor advances when a pick is QUEUED, not when
// it airs.

import { join } from 'node:path';
import { config } from '../config.js';
import * as settings from '../settings.js';
import { createPlaylistCursorStore } from './playlist-cursors.js';
import { cursorFor } from './playlist-order.js';
import { albumWalkSig, finishedCursor, isAlbumWalkFinished, nextInAlbum } from './album-walk.js';
import type { AlbumEpisodeSource } from './episode-source.js';
import type { PreparationTrack } from '../schemas/show-preparation.js';

type CursorStore = ReturnType<typeof createPlaylistCursorStore>;

export type AlbumNext =
  | { kind: 'track'; track: PreparationTrack; index: number; total: number; sig: string }
  | { kind: 'finished'; sig: string };

export function createAlbumWalker(store: CursorStore) {
  return {
    load: () => store.load(),
    async next(showId: string, occurrenceId: string, source: AlbumEpisodeSource, busyIds: ReadonlySet<string> = new Set()): Promise<AlbumNext> {
      const sig = albumWalkSig(occurrenceId, source.album.id);
      const step = nextInAlbum(source.tracks, await store.get(showId), sig, t => !busyIds.has(t.id));
      return 'finished' in step
        ? { kind: 'finished', sig }
        : { kind: 'track', track: step.track, index: step.index, total: source.tracks.length, sig };
    },
    commit(showId: string, track: PreparationTrack, index: number, sig: string): Promise<void> {
      return store.commit(showId, cursorFor(track, index, sig));
    },
    // True only the first time the walk is marked finished, so the event note
    // and the booth line happen once per airing, even across a restart.
    async finish(showId: string, sig: string, total: number): Promise<boolean> {
      if (isAlbumWalkFinished(await store.get(showId), sig)) return false;
      await store.commit(showId, finishedCursor(sig, total));
      return true;
    },
    finishedNow(showId: string, occurrenceId: string, albumId: string): boolean {
      return isAlbumWalkFinished(store.peek(showId), albumWalkSig(occurrenceId, albumId));
    },
  };
}

export const albumWalker = createAlbumWalker(createPlaylistCursorStore({
  file: join(config.stateDir, 'album-cursors.json'),
  knownShowIds: () => (settings.get().shows ?? []).map((s: any) => s?.id).filter(Boolean),
}));
