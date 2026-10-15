'use client';

import { memo, useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useLyrics } from '@/hooks/useLyrics';
import { activeLyricIndex } from '@/lib/lyrics';
import { pollWhileVisible } from '@/lib/poll';

/** How often the sung line is re-checked. Lines last seconds, so a quarter
 *  second is well inside what a listener can see as late. */
const TICK_MS = 250;

export interface LiveLyricsProps {
  subsonicId: string | null;
  /** Listener-time epoch ms the track became audible (useStationFeed). */
  trackStartedAt: number | null;
  enabled: boolean;
}

/** The line being sung now plus the one after it. Synced lyrics only: an
 *  unsynced block has no "now" to show, and would crowd the stage. Renders
 *  nothing when the track has none. The tick lives here so only this leaf
 *  re-renders, and only when the line actually changes. */
export default memo(function LiveLyrics({ subsonicId, trackStartedAt, enabled }: LiveLyricsProps) {
  const lyrics = useLyrics(subsonicId, enabled);
  const lines = lyrics?.synced ? lyrics.lines : null;
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    if (!lines || trackStartedAt == null) {
      setIndex(-1);
      return;
    }
    return pollWhileVisible(() => setIndex(activeLyricIndex(lines, Date.now() - trackStartedAt)), TICK_MS);
  }, [lines, trackStartedAt]);

  if (!lines) return null;
  const current = index >= 0 ? lines[index] : null;
  const next = lines[index + 1] ?? null;

  return (
    <div className="mt-[14px] max-w-[min(100%,46rem)]" aria-label="Lyrics" role="region">
      <AnimatePresence mode="popLayout" initial={false}>
        <m.p
          key={index}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
          className="m-0 line-clamp-2 text-[clamp(15px,1.7vw,22px)] leading-snug font-medium text-ink"
        >
          {current?.text ? current.text : <span className="text-muted" aria-label="Instrumental">♪</span>}
        </m.p>
      </AnimatePresence>
      {next?.text && (
        <p className="m-0 mt-[4px] truncate text-[clamp(12px,1.2vw,15px)] leading-snug text-muted">
          {next.text}
        </p>
      )}
    </div>
  );
});
