// Album of the day: which albums past airings featured. The controller writes
// it when an album preparation is accepted (broadcast/show-preparation.ts);
// skills read it through services.featured.recentAlbumIds. The skill never
// writes, so a tool that crashes after choosing cannot leave a false entry.

import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { writeFileAtomic } from '../util/atomic-file.js';
import { featuredAlbumsStoreSchema, FEATURED_ALBUMS_MAX, type FeaturedAlbum } from '../schemas/featured-albums.js';

const DAY_MS = 86_400_000;

export function createFeaturedAlbums({ file, now = Date.now }: { file: string; now?: () => number }) {
  let albums: FeaturedAlbum[] = [];
  let loaded: Promise<void> | null = null;
  let pending: Promise<void> = Promise.resolve();

  const load = () => loaded ??= (async () => {
    try {
      albums = featuredAlbumsStoreSchema.parse(JSON.parse(await readFile(file, 'utf8'))).albums;
    } catch (error) {
      // Missing = nothing featured yet. Corrupt = an empty history rather than
      // a refusal to prepare; the next record replaces the file.
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        console.warn(`[featured-albums] unreadable ${file}, starting an empty history: ${(error as Error)?.message}`);
      }
    }
  })();

  return {
    load,
    record(entry: { albumId: string; name: string; artist: string }): Promise<void> {
      const operation = pending.then(async () => {
        await load();
        const kept = [{ albumId: entry.albumId, name: entry.name.slice(0, 500), artist: entry.artist.slice(0, 500), at: now() }, ...albums]
          .slice(0, FEATURED_ALBUMS_MAX);
        await mkdir(dirname(file), { recursive: true });
        await writeFileAtomic(file, JSON.stringify({ version: 1, albums: kept }));
        albums = kept;
      });
      pending = operation.catch(() => {});
      return operation;
    },
    // Albums featured in the last `days`. Zero or a bad value excludes nothing.
    async recentIds(days: number): Promise<Set<string>> {
      await load();
      if (!Number.isFinite(days) || days <= 0) return new Set();
      const since = now() - days * DAY_MS;
      return new Set(albums.filter(a => a.at >= since).map(a => a.albumId));
    },
  };
}

export const featuredAlbums = createFeaturedAlbums({ file: join(config.stateDir, 'featured-albums.json') });
