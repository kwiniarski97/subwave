'use client';

import { memo, useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { cn } from '@/lib/cn';
import { useLyrics } from '@/hooks/useLyrics';
import { activeLyricIndex, lyricWindow } from '@/lib/lyrics';
import type { LyricLine } from '@/lib/stationClient';
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

/** A past/next row: always rendered (blank when there is no line) so the block
 *  keeps its height as lines come and go. An empty line is an instrumental gap. */
function SideLine({ line, className }: { line: LyricLine | null; className?: string }) {
  return (
    <p className={cn('m-0 truncate text-[clamp(12px,1.15vw,15px)] leading-tight text-muted', className)}>
      {line ? line.text || '♪' : ' '}
    </p>
  );
}

/** The line just sung, the line being sung and the next one, under the track
 *  meta. It sits on the page itself rather than over the Waveform band, so the
 *  progress split and EQ stay visible and no theme needs a backing panel.
 *  Synced lyrics only: an unsynced block has no "now" to show. The tick lives
 *  here so only this leaf re-renders, and only when the line changes. */
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
  const { past, current, next } = lyricWindow(lines, index);

  return (
    // From sm the cover and title sit side by side, so the lyrics indent by the
    // cover's width (CenterStage's clamp) plus the row gap to start under the title.
    <div
      className="mt-[16px] max-w-[min(100%,40rem)] sm:max-w-[calc(40rem+clamp(96px,min(14vw,20vh),240px)+1.5rem)] sm:pl-[calc(clamp(96px,min(14vw,20vh),240px)+1.5rem)]"
      aria-label="Lyrics"
      role="region"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <m.div
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <SideLine line={past} className="opacity-80" />
          <p className="m-0 my-[4px] line-clamp-2 text-[clamp(16px,1.8vw,24px)] leading-snug font-semibold text-ink">
            {current?.text ? current.text : <span className="text-muted" aria-label="Instrumental">♪</span>}
          </p>
          <SideLine line={next} />
        </m.div>
      </AnimatePresence>
    </div>
  );
});
