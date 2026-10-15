import { tool } from 'ai';
import { z } from 'zod';
import * as subsonic from '../../../../../music/subsonic.js';
import { outsideCandidates } from '../../../../../music/outside-request-policy.js';
import { definePickerTool } from '../defs.js';

// Request path only, and only when the operator allows outside requests
// (settings.requests.outsideLibrary + OCTO_FIESTA_URL, under the hourly cap —
// resolved into scope.outsideLibrary when the run starts). Finds the song a
// listener NAMED among the songs octo-fiesta can fetch but the library does
// not hold. Matching is strict (music/outside-request-policy.ts): an outside
// hit is announced as the listener's own request, so a near-miss here is a
// wrong song presented as the right one. Results go through collect(), so the
// chosen `ext-` id validates against `seen` like any other tool's.
export default definePickerTool({
  name: 'searchOutsideLibrary',
  available: ({ scope }) => scope.outsideLibrary,
  build: ({ collect }) => tool({
    description: 'Use when a listener NAMES a specific artist (and maybe a song) — call it alongside searchLibrary, not instead of it. Searches streaming services for that exact artist/song OUTSIDE this station\'s library; it streams in on demand. Returns { tracks } that match the named artist (and title) exactly, or an empty list. If searchLibrary returned the song they asked for, pick the library track; pick an outside track only when the library does not have it. Never use it for a mood, genre or "something like" request.',
    inputSchema: z.object({
      artist: z.string().min(1).max(200).describe('the artist the listener named'),
      // A plain string, not .optional(): no other picker tool takes an optional
      // field, and an empty string reads the same to every provider.
      title: z.string().max(200).describe('the song title the listener named, or "" if they named only the artist'),
    }),
    execute: async ({ artist, title }, { abortSignal }: { abortSignal?: AbortSignal }) => {
      try {
        const songs = await subsonic.searchOutside([artist, title].filter(Boolean).join(' '), { songCount: 20, signal: abortSignal });
        const matches = outsideCandidates(songs, { artist, title: title || null, recentIds: new Set() });
        const tracks = collect(matches, 3, { maxPerArtist: Infinity });
        if (!tracks.length) {
          return { tracks, note: 'nothing outside the library matches that artist/song either — choose a fitting stand-in from your other results' };
        }
        return { tracks, note: 'These stream in from outside the station library. Pick one only if it is the song the listener asked for.' };
      } catch (err) { return { error: (err as Error).message }; }
    },
  }),
});
