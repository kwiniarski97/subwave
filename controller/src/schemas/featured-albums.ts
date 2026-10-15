import { z } from 'zod';

// Album of the day: the albums past airings featured, newest first. Persisted
// to state/featured-albums.json by music/featured-albums.ts. Kept apart from
// show-preparations.json, which prunes each record ten minutes after its
// airing ends, far too soon to answer "not in the last 90 days".
export const FEATURED_ALBUMS_MAX = 512;

export const featuredAlbumSchema = z.object({
  albumId: z.string().min(1).max(256),
  name: z.string().max(500),
  artist: z.string().max(500),
  at: z.number().finite(),
});

export const featuredAlbumsStoreSchema = z.object({
  version: z.literal(1),
  albums: z.array(featuredAlbumSchema).max(FEATURED_ALBUMS_MAX),
});

export type FeaturedAlbum = z.output<typeof featuredAlbumSchema>;
