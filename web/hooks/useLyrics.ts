'use client';

import { useEffect, useState } from 'react';
import { useStationClient, type LyricsPayload } from '@/lib/stationClient';

/** Lyrics for the track on air, fetched once per track. null while loading,
 *  when the track has none, or when the controller cannot answer — every one
 *  of those renders as "no lyrics". */
export function useLyrics(subsonicId: string | null, enabled = true): LyricsPayload | null {
  const client = useStationClient();
  const [lyrics, setLyrics] = useState<{ id: string; payload: LyricsPayload | null } | null>(null);

  useEffect(() => {
    if (!enabled || !subsonicId) return;
    const ctrl = new AbortController();
    client.lyrics(subsonicId, { signal: ctrl.signal }).then(payload => {
      if (!ctrl.signal.aborted) setLyrics({ id: subsonicId, payload });
    });
    return () => ctrl.abort();
  }, [client, subsonicId, enabled]);

  // Keyed on the id so the previous track's lines never show against the new one.
  if (!enabled || !subsonicId || lyrics?.id !== subsonicId) return null;
  const payload = lyrics.payload;
  return payload && payload.lines.length > 0 ? payload : null;
}
