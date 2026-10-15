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
