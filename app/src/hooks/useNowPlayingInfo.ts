// Talking state and card contents come from lib/voice-turn and lib/air-card,
// shared with the Live Activity.

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import TrackPlayer, { Event, useTrackPlayerEvents } from 'react-native-track-player';
import { useAppActive } from '@/hooks/useAppActive';
import { useTalking } from '@/hooks/useTalking';
import type { PlayerStatus } from '@/hooks/usePlayer';
import { resolveAirCard } from '@/lib/air-card';
import type { StationApi } from '@/lib/api';
import { cardArtwork, hasPlayed, sendsCard, type SentCard } from '@/lib/now-playing-card';
import type { ActiveShow, NowPlayingTrack, SessionTurn } from '@/lib/types';
import { nowPlayingProgress } from '@/lib/track-progress';

export interface UseNowPlayingInfoParams {
  api: StationApi | null;
  tunedIn: boolean;
  status: PlayerStatus;
  nowPlaying: NowPlayingTrack | null;
  boothFeed?: SessionTurn[];
  /** Listener buffer behind the live edge (useStationFeed.leadMs). */
  leadMs: number;
  /** Listener-time start shared with the player and Live Activity. */
  trackStartedAt: number | null;
  activeShow?: ActiveShow | null;
}

export function useNowPlayingInfo({
  api,
  tunedIn,
  status,
  nowPlaying,
  boothFeed,
  leadMs,
  trackStartedAt,
  activeShow,
}: UseNowPlayingInfoParams): void {
  const talking = useTalking(boothFeed, leadMs);
  const appActive = useAppActive();
  const card = api ? resolveAirCard({ api, nowPlaying, activeShow, talking }) : null;

  // Use resolved strings as dependencies to avoid flickering artwork on unchanged polls.
  const title = card?.title;
  const artist = card?.artist;
  const album = card?.album;
  const artwork = card?.artworkUrl;
  const duration = nowPlaying?.duration;

  // A loaded item resets the native card, so each one gets the card again.
  const [item, setItem] = useState(0);
  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged], () => setItem((n) => n + 1));
  const sentRef = useRef<SentCard | null>(null);

  useEffect(() => {
    if (!api || !tunedIn || !title) {
      sentRef.current = null;
      return;
    }
    const last = sentRef.current;
    const played = hasPlayed(last, item, status === 'playing');
    const next: SentCard = { title, artist, album, artwork, item, played };
    const withCard = sendsCard(last, next);
    sentRef.current = next;
    const update = (includeCard: boolean) => {
      const metadata = {
        // The fork's Android setMetadata clears every field not sent, so the
        // card rides every Android update.
        ...(includeCard || Platform.OS === 'android' ? { title, artist, album, artwork: cardArtwork(next) } : {}),
        // Retain iOS's LIVE presentation and the absence of seek controls.
        isLiveStream: true,
        ...nowPlayingProgress({ track: { duration }, trackStartedAt, talking }),
      };
      // On Android the pinned RNTP fork's updateNowPlayingMetadata replaces the
      // playing item with one built from the metadata alone: no url, so the
      // stream dies (and on an empty queue it crashes). updateMetadataForTrack
      // edits the loaded track in place and keeps its url and headers. A fixed
      // mediaId keeps the rebuilt item from drawing a fresh random one each time.
      const sent =
        Platform.OS === 'android'
          ? TrackPlayer.getActiveTrackIndex().then((index) =>
              index === undefined
                ? undefined
                : TrackPlayer.updateMetadataForTrack(index, { ...metadata, mediaId: 'subwave-live' }),
            )
          : TrackPlayer.updateNowPlayingMetadata(metadata);
      sent.catch(() => {
        /* no active track yet */
      });
    };
    // Card or not, every refresh re-anchors progress (lib/now-playing-card).
    update(withCard);
    // Native playback state extrapolates between updates. Re-anchor from the
    // absolute listener clock even while the foreground elapsed timer sleeps.
    const timer = setInterval(() => update(false), 30000);
    return () => clearInterval(timer);
  }, [api, tunedIn, status, title, artist, album, artwork, duration, trackStartedAt, talking, appActive, item]);
}
