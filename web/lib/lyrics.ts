import type { LyricLine } from '@/lib/stationClient';

/** Index of the line being sung `posMs` into the track, or -1 before the first
 *  timed line. Lines arrive sorted by `t` (the controller sorts them); an
 *  untimed line never becomes active. */
export function activeLyricIndex(lines: readonly LyricLine[], posMs: number): number {
  if (!Number.isFinite(posMs)) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = lines[mid]?.t;
    if (t != null && t <= posMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export interface LyricWindow {
  /** The line just sung; null until the second line starts. */
  past: LyricLine | null;
  /** The line being sung now; null before the first timed line. */
  current: LyricLine | null;
  /** The line coming up; null after the last one. */
  next: LyricLine | null;
}

/** The three lines around `index` (an activeLyricIndex result), so the
 *  display never has to reason about the -1 "not started" index. */
export function lyricWindow(lines: readonly LyricLine[], index: number): LyricWindow {
  return {
    past: index > 0 ? (lines[index - 1] ?? null) : null,
    current: index >= 0 ? (lines[index] ?? null) : null,
    next: lines[index + 1] ?? null,
  };
}
