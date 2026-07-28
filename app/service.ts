// This headless service cannot access React state.
// Skip and seek are unavailable on a shared live broadcast.
import TrackPlayer, { Event } from 'react-native-track-player';
import { getLastLiveMeta, loadAndPlay } from '@/audio/player';
import { carStations, publishCarBrowseTree, stationForMediaId } from '@/car/browseTree';
import { carTuneTo, matchStationQuery } from '@/car/carTune';
import { featuredStation, loadStations } from '@/lib/station';
import { remotePlay } from '@/lib/remote-play';

export async function PlaybackService(): Promise<void> {
  // RemotePlay reloads with a cache-buster to discard the paused buffer,
  // through the app's player and its stream recovery while that is mounted
  // (src/lib/remote-play.ts). If reloading fails, fall back to play.
  TrackPlayer.addEventListener(Event.RemotePlay, () =>
    remotePlay({
      hasStream: () => getLastLiveMeta() !== null,
      reloadLast: async () => {
        const meta = getLastLiveMeta();
        if (meta) await loadAndPlay(meta);
      },
      resume: () => TrackPlayer.play(),
    }),
  );
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());

  // --- Android Auto ---------------------------------------------------------
  // Browse-tree taps and voice queries land here (Media3 MediaLibraryService in
  // the RNTP fork → Event.RemotePlayId / RemotePlaySearch). Resolution goes
  // through the persisted station store, not React state — on a car cold start
  // this service is all that's running.
  TrackPlayer.addEventListener(Event.RemotePlayId, async ({ id }) => {
    try {
      const store = await loadStations();
      const ref = stationForMediaId(id, carStations(featuredStation(), store.recents));
      if (ref) await carTuneTo(ref);
    } catch {
      /* headless best-effort — the car shows the session's error state */
    }
  });
  TrackPlayer.addEventListener(Event.RemotePlaySearch, async ({ query }) => {
    try {
      const store = await loadStations();
      const ref = matchStationQuery(
        query ?? '',
        carStations(featuredStation(), store.recents),
        store.activeStation,
      );
      if (ref) await carTuneTo(ref);
    } catch {
      /* headless best-effort */
    }
  });

  // Publish the station list even when the phone UI never mounts (car cold
  // start). StationContext republishes with the live store on every change.
  publishCarBrowseTree().catch(() => {});

  // Never settle. On Android this is a headless JS task, and RN fires JS timers
  // behind a paused activity only while one is running — the feed poll that
  // keeps lock-screen and Bluetooth metadata current among them. RN 0.85 never
  // delivered the finish signal; 0.86 does, so returning here stopped every
  // timer the moment the screen locked.
  await new Promise<never>(() => {});
}
