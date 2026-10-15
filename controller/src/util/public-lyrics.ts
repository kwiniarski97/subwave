// The public shape of GET /lyrics/:id — the live-lyrics read the player polls
// once per track. Pure: the Subsonic read and the onset shift are injected, so
// this module owns only what a listener may see and how it is bounded.
//
// Timings are on the PLAYED timeline, not the file's: a trimmed lead silence
// moves every line earlier, and the shift is silence-trim's own shiftOnsetMs,
// never a local subtraction (#1594). The player adds its own listener offset.

export const LYRIC_LINES_MAX = 400;
export const LYRIC_TEXT_MAX = 300;

export interface RawLyrics {
  synced: boolean;
  lines: Array<{ startMs: number; text: string }>;
}

export interface PublicLyricLine {
  /** Ms from the moment this track became audible; null on unsynced lyrics. */
  t: number | null;
  text: string;
}

export interface PublicLyrics {
  synced: boolean;
  lines: PublicLyricLine[];
}

export const NO_LYRICS: PublicLyrics = { synced: false, lines: [] };

// `shift` maps a file-timeline ms onto the played timeline (null = no answer).
// A synced set whose timings do not survive is reported unsynced rather than
// as a half-timed list the player would scroll wrongly.
export function publicLyrics(
  raw: RawLyrics | null | undefined,
  shift: (ms: number) => number | null,
): PublicLyrics {
  if (!raw || !Array.isArray(raw.lines) || raw.lines.length === 0) return NO_LYRICS;
  const lines: PublicLyricLine[] = [];
  let timed = raw.synced === true;
  for (const l of raw.lines.slice(0, LYRIC_LINES_MAX)) {
    const text = typeof l?.text === 'string' ? l.text.trim().slice(0, LYRIC_TEXT_MAX) : '';
    let t: number | null = null;
    if (timed) {
      t = Number.isFinite(l?.startMs) ? shift(l.startMs) : null;
      if (t == null) timed = false;
    }
    lines.push({ t, text });
  }
  if (!timed) {
    // Unsynced: blank lines are only spacing, and every timing goes.
    const plain = lines.filter((l) => l.text).map((l) => ({ t: null, text: l.text }));
    return plain.length ? { synced: false, lines: plain } : NO_LYRICS;
  }
  // Synced: a blank line is a deliberate clear (an instrumental break), so it
  // stays. Sorted, since nothing promises a server returns them in order.
  lines.sort((a, b) => (a.t as number) - (b.t as number));
  return lines.some((l) => l.text) ? { synced: true, lines } : NO_LYRICS;
}
