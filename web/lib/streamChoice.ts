// Which mount the web player tunes to. MP3 is the floor and always served.
// Opus is an automatic upgrade; FLAC is the listener's own Lossless choice in
// the Appearance menu, and only ever offered, never assumed. Both need the
// station's setting to be an explicit `true`, a browser that says it can decode
// the codec, and a mount that hasn't already failed this session. Pure, so the
// rules are testable without a browser; usePlayer owns the inputs.

import type { StationStreams } from './stationOrigin';

/** What this browser can decode. null until the post-mount probe runs, so
 *  SSR and first paint stay on MP3. */
export interface CodecSupport {
  opus: boolean;
  flac: boolean;
}

export interface StreamChoiceInput {
  streams: StationStreams;
  /** Station settings, null before the first poll. Only `true` counts. */
  opusEnabled: boolean | null;
  flacEnabled: boolean | null;
  /** The listener's Lossless switch. */
  lossless: boolean;
  support: CodecSupport | null;
  /** Mounts that errored this session; each one pins away from itself. */
  failed: { opus: boolean; flac: boolean };
}

/** Whether to offer the Lossless switch at all. */
export function losslessAvailable(i: StreamChoiceInput): boolean {
  return i.flacEnabled === true && !!i.streams.flac && i.support?.flac === true && !i.failed.flac;
}

export function chooseStream(i: StreamChoiceInput): string {
  if (i.lossless && losslessAvailable(i) && i.streams.flac) return i.streams.flac;
  if (i.opusEnabled === true && i.streams.opus && i.support?.opus === true && !i.failed.opus) {
    return i.streams.opus;
  }
  return i.streams.mp3;
}

/** Probe the browser. iOS and Firefox are excluded outright: both break on
 *  chained Ogg at a crossfade (#212), and both optional mounts are chained Ogg.
 *  Anything short of `'probably'` is a no. */
export function detectCodecSupport(
  canPlayType: (type: string) => string,
  { ios, userAgent }: { ios: boolean; userAgent: string },
): CodecSupport {
  // Desktop/Android Firefox + Gecko forks carry "Firefox" in the UA; Firefox-for-iOS
  // reports "FxiOS" and is already caught by `ios`.
  if (ios || /firefox/i.test(userAgent)) return { opus: false, flac: false };
  return {
    opus: canPlayType('audio/ogg; codecs=opus') === 'probably',
    flac: canPlayType('audio/ogg; codecs=flac') === 'probably',
  };
}
