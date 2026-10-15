// Random albums for skills (services.library.randomAlbums): Navidrome's own
// server-side sample, mapped to a small stable shape so a tool.mjs never reads
// raw Subsonic fields.

import * as subsonic from './subsonic.js';

export interface RandomAlbum {
  id: string; name: string; artist: string;
  year: number | null; genre: string | null;
  songCount: number;
  /** Seconds. 0 when the server did not say. */
  duration: number;
  isCompilation: boolean;
}

const positive = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

export function toRandomAlbum(raw: unknown): RandomAlbum | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, any>;
  if (typeof a.id !== 'string' || !a.id) return null;
  const releaseTypes: unknown[] = Array.isArray(a.releaseTypes) ? a.releaseTypes : [];
  return {
    id: a.id,
    name: String(a.name ?? a.title ?? ''),
    artist: String(a.artist ?? ''),
    year: positive(a.originalReleaseDate?.year) ?? positive(a.year),
    genre: typeof a.genre === 'string' && a.genre ? a.genre
      : typeof a.genres?.[0]?.name === 'string' && a.genres[0].name ? a.genres[0].name : null,
    songCount: positive(a.songCount) ?? 0,
    duration: positive(a.duration) ?? 0,
    isCompilation: a.isCompilation === true || releaseTypes.some(t => typeof t === 'string' && /compilation/i.test(t)),
  };
}

export async function randomAlbums({ count = 20 }: { count?: number } = {}): Promise<RandomAlbum[]> {
  const raw = await subsonic.getRandomAlbums({ size: count });
  return raw.map(toRandomAlbum).filter((a: RandomAlbum | null): a is RandomAlbum => !!a);
}
