// App entry: register the RNTP playback service so OS media controls reach our
// remote handlers even when the JS UI isn't mounted, then hand off to
// expo-router. The service MUST be registered before the router entry runs.
import TrackPlayer from 'react-native-track-player';
import { startCarPlay } from '@/car/carPlay';
import { PlaybackService } from './service';

TrackPlayer.registerPlaybackService(() => PlaybackService);

// CarPlay templates (iOS-only no-op elsewhere), registered here rather than in
// the React tree because the car can connect while the phone UI is unmounted.
startCarPlay();

// Registration must run before the router starts the app.
// eslint-disable-next-line import/first
import 'expo-router/entry';
