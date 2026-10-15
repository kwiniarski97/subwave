// When a listener request may be answered from OUTSIDE the library — a song
// octo-fiesta offers under an `ext-<provider>-song-<id>` id — and which outside
// song counts as the one asked for.
//
// Both request paths reach this decision (the request agent's
// searchOutsideLibrary tool and the stateless cascade in routes/request.ts),
// which is why it lives here and not at either call site.
//
// The matching is deliberately STRICTER than the cascade's near-miss check. A
// library miss already degrades honestly: a stand-in with an "I couldn't find
// that" intro. An outside hit is announced as the listener's own request, so a
// loose match (asked for "Queen", got "Queens of the Stone Age") is a wrong
// song presented as the right one — the worse outcome. Fold spelling, never
// identity.
//
// Off by default (settings.requests.outsideLibrary) and inert without
// OCTO_FIESTA_URL: any listener can name any song, so pulling outside music onto
// the broadcast is an operator decision, bounded by an hourly cap.

import { config } from '../config.js';
import * as settings from '../settings.js';
import { artistParticipantKeys } from './recency.js';
import { isOutsideSongId } from './subsonic.js';

// Versions a request slot should not get unless the listener asked for one.
const ODD_VERSION_RE = /\b(live|remix|karaoke|instrumental|sped up|slowed|acoustic|demo|cover)\b/i;

// Case, accents, apostrophes, punctuation and spacing — and `&` read as `and`,
// which both spellings of one act's name use.
function fold(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['‘’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Spaces go too, so "AC/DC" and "ACDC" are one act.
function foldArtist(raw: unknown): string {
  return fold(raw).replace(/^the /, '').replace(/ /g, '');
}

// A title without its version dressing: "Get Lucky (Radio Edit)",
// "Get Lucky [Remastered]", "Get Lucky - 2013 Remaster" → "get lucky".
function baseTitle(raw: unknown): string {
  return fold(String(raw ?? '').replace(/\s*[([].*$/, '').replace(/\s+-\s+.*$/, ''));
}

/** The named artist is the credit's lead or a `feat.` guest — nothing looser. */
export function artistMatches(want: unknown, got: unknown): boolean {
  const w = foldArtist(want);
  if (!w) return false;
  // Splits on feat./ft./featuring only: `&` lives inside real band names.
  const parts = artistParticipantKeys(String(got ?? ''));
  return parts.some((p) => foldArtist(p) === w);
}

/** Same song title, ignoring a bracketed or dashed version suffix on either side. */
export function titleMatches(want: unknown, got: unknown): boolean {
  const w = baseTitle(want);
  if (!w) return false;
  return fold(want) === fold(got) || w === baseTitle(got);
}

/**
 * The song title a request named, read from the matcher's search terms: a term
 * that is not just the artist, with the artist taken off its front. Without a
 * named artist a bare term cannot be told apart from an artist name, so there
 * is no title.
 */
export function requestedTitle(terms: unknown, artist: string | null | undefined): string | null {
  const a = fold(artist);
  if (!a || !Array.isArray(terms)) return null;
  for (const t of terms) {
    if (typeof t !== 'string') continue;
    const raw = t.trim();
    const f = fold(raw);
    if (!f || f === a || foldArtist(raw) === foldArtist(artist)) continue;
    if (f.startsWith(`${a} `)) {
      // Drop as many words off the raw term as the artist folds to.
      const words = raw.split(/\s+/);
      const rest = words.slice(a.split(' ').length).join(' ').trim();
      return rest || null;
    }
    return raw;
  }
  return null;
}

export interface NamedRequest {
  artist: string | null | undefined;
  title: string | null | undefined;
}

/** Does this song answer what the listener named? */
export function satisfiesNamedRequest(song: any, req: NamedRequest): boolean {
  if (!song || !artistMatches(req.artist, song.artist)) return false;
  return !req.title || titleMatches(req.title, song.title);
}

/**
 * The outside songs that answer a named request, in the search's own order:
 * external `ext-` songs only, strictly matched, not an odd version the listener
 * did not ask for, not played or queued recently.
 */
export function outsideCandidates(
  songs: any[],
  { artist, title, recentIds }: NamedRequest & { recentIds: Set<string> },
): any[] {
  if (!artist || !Array.isArray(songs)) return [];
  const askedOdd = ODD_VERSION_RE.test(String(title ?? ''));
  return songs.filter((s) =>
    s?.isExternal === true
    && isOutsideSongId(s.id)
    && s.title
    && !recentIds.has(s.id)
    && (askedOdd || !ODD_VERSION_RE.test(String(s.title)))
    && satisfiesNamedRequest(s, { artist, title }));
}

// --- the request agent's backstop ----------------------------------------

// A search phrase the listener actually wrote, as whole words.
function textNames(text: string, phrase: string): boolean {
  const p = fold(phrase);
  return !!p && ` ${fold(text)} `.includes(` ${p} `);
}

/**
 * The outside song a request-agent run must queue in place of the pick it
 * made, or null to keep that pick. The prompt says to take an outside song
 * the run found, but a small model can still fall back to the frame's
 * "closest thing" rule and air a stand-in for a song it had in hand — so this
 * holds the run to the same strict match searchOutsideLibrary applied.
 *
 * Only a searchOutsideLibrary call that came back with tracks, and only an ask
 * the listener's OWN text names (artist, and the title when one was given):
 * the model chose the call's arguments, and they must not be what turns a
 * "something in the mood of…" request into a specific song. A pick that already
 * answers that ask — the library's copy, or an outside id — stands.
 */
export function outsideOverride(
  pick: any,
  toolCalls: ReadonlyArray<any> | null | undefined,
  requestText: string,
): any | null {
  if (!pick || isOutsideSongId(pick.id) || !Array.isArray(toolCalls)) return null;
  for (const call of toolCalls) {
    if (call?.name !== 'searchOutsideLibrary') continue;
    const artist = typeof call.args?.artist === 'string' ? call.args.artist.trim() : '';
    const title = typeof call.args?.title === 'string' ? call.args.title.trim() : '';
    const tracks = Array.isArray(call.result?.tracks) ? call.result.tracks : [];
    const hit = tracks.find((t: any) => isOutsideSongId(t?.id));
    if (!hit || !textNames(requestText, artist) || (title && !textNames(requestText, title))) continue;
    if (satisfiesNamedRequest(pick, { artist, title: title || null })) return null;
    return hit;
  }
  return null;
}

// --- gate and hourly cap ---------------------------------------------------

const HOUR_MS = 3_600_000;
let queuedAt: number[] = [];

export function withinHourlyCap(stamps: number[], now: number, cap: number): boolean {
  return stamps.filter((t) => now - t < HOUR_MS).length < cap;
}

/** May a request reach outside the library right now? */
export function outsideRequestsAllowed(now = Date.now()): boolean {
  const rq = (settings.get() as any)?.requests;
  if (rq?.outsideLibrary !== true || !config.navidrome.octoFiestaUrl) return false;
  queuedAt = queuedAt.filter((t) => now - t < HOUR_MS);
  return withinHourlyCap(queuedAt, now, Number(rq.outsideHourlyCap) || 1);
}

/** Count a queued request against the hourly cap — outside songs only. */
export function noteOutsideQueued(id: unknown, now = Date.now()): void {
  if (isOutsideSongId(id)) queuedAt.push(now);
}

export function resetOutsideLedgerForTests(): void {
  queuedAt = [];
}
