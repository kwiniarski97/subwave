// Album running order: disc, then track. Shared by the operator album block
// (broadcast/block-queue.ts) and the album episode source
// (music/episode-source.ts), so a queued album and an album-of-the-day airing
// can never disagree about which song is track 2.

export interface AlbumOrderSong {
  /** Subsonic `discNumber`. Missing means disc 1. */
  discNumber?: unknown;
  /** Subsonic `track`, the position on its disc. Missing sorts last within the disc. */
  track?: unknown;
}

/**
 * Sort by disc, then track, preserving source order for ties. Missing discs mean disc 1;
 * missing tracks sort last within their disc.
 */
// Any object: a zod passthrough track (index signature of unknown) does not
// satisfy an all-optional interface, so the fields are read through it instead.
export function orderAlbumTracks<T extends object>(songs: readonly T[]): T[] {
  const num = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return songs
    .map((song, at) => ({ song, at }))
    .sort(({ song: sa, at: ia }, { song: sb, at: ib }) => {
      const a = { song: sa as AlbumOrderSong, at: ia };
      const b = { song: sb as AlbumOrderSong, at: ib };
      const disc = num(a.song.discNumber, 1) - num(b.song.discNumber, 1);
      if (disc !== 0) return disc;
      const track = num(a.song.track, Number.MAX_SAFE_INTEGER) - num(b.song.track, Number.MAX_SAFE_INTEGER);
      if (track !== 0) return track;
      return a.at - b.at;
    })
    .map(({ song }) => song);
}
