# Testing the SUB/WAVE app on iOS and Android

How to build, run, and test the Expo app on simulators/emulators, physical
devices, and via EAS cloud builds. Read the **Architecture-critical facts**
section first — one wrong toggle and playback crashes on launch.

---

## Architecture-critical facts (read before changing native config)

### Both platforms run the New Architecture — it's mandatory in RN 0.86

RN 0.82+ **removed the ability to opt out** of the New Architecture. Both
platforms run it ON, and this is required (Reanimated 4.5.1 only works under new
arch):

- **iOS** — `Info.plist RCTNewArchEnabled = true`, Pods built `-DRCT_NEW_ARCH_ENABLED=1`.
- **Android** — a generated `android/gradle.properties` may carry a leftover
  `newArchEnabled=false`, but **Gradle ignores it** and prints:
  `Setting newArchEnabled=false … is not supported anymore since React Native 0.82
  … The application will run with the New Architecture enabled by default.`
  The line is a harmless no-op; you can delete it.

`app.json` no longer declares `newArchEnabled` (it used to say `false` — equally
a no-op). Don't rely on such flags anywhere; they do nothing on this RN version.

### Why `react-native-track-player` works under new arch

RNTP is the **lovegaoshi fork, pinned by commit** in `package.json`
(Apache-2.0, Media3 `MediaLibraryService` inside, same v4 JS API). It carries
its own New Architecture fix, so the old
`patches/react-native-track-player+4.1.2.patch` is gone. The fork is what makes
the Android Auto browse tree possible: stock RNTP v4 cannot expose a browsable
media service. The git dependency's `prepare` script builds with **yarn**, which
must exist on the machine or builder.

> **Known regression from the patch removal: the media-session song clock
> (#857/#1880).** The old patch adapted KotlinAudio 2.1.0's session player so
> Android published the song's duration and elapsed time, and patched iOS
> `Metadata.swift` to clear omitted clock fields and keep artwork on
> progress-only refreshes. The fork's Android bridge reads `elapsedTime` but
> never applies it, so the Android notification and Bluetooth show no song
> clock. The fork's iOS `Metadata.swift` is stock: it publishes the clock but
> keeps stale fields through DJ speech and can drop artwork on a progress-only
> refresh. Both need porting (a Media3 session-player adapter on Android, the
> old `Metadata.swift` hunk on iOS). The JS side (`src/lib/track-progress.ts`,
> `useNowPlayingInfo`) still sends the fields.

Once the clock is restored, the device check is to play a track with a known duration and inspect
`adb shell dumpsys media_session`: its duration should be the song's duration
in milliseconds, and position should match the app's elapsed time, including
the advertised listener buffer. Check that artwork remains visible during
progress refreshes and changes with the track/persona. During DJ speech and
on a track with no duration, the previous song's progress must disappear.
Repeat after a track change, screen lock, reconnect, and tune-out/tune-in.
Verify a release build too, so the reflection keep rules are exercised.
On iOS, confirm the LIVE controls, artwork, and Live Activity still work;
Cast should still tear down the local session. Bluetooth display of artwork
and progress must also be checked in the car.

### Other load-bearing facts

- **Expo Go does not work** — native modules (RNTP, Skia, Reanimated worklets)
  ship compiled code. You must build a **dev client**.
- **MP3 is the default** (`{base}/stream.mp3`). The SIGNAL picker offers AAC on
  both platforms and Opus/FLAC on Android when the station advertises the mount.
  iOS cannot demux Ogg. Cast always uses MP3.
- **No backend needed for testing** — the app defaults to the public
  `getsubwave.com` station, which is live. Onboarding pre-fills it.
- **Base URL is fully runtime** — there are no hardcoded station URLs in source.
  All API/stream URLs come from `StationContext` → `createApi(baseUrl)`.
- **Cast + AirPlay need physical hardware.** Neither Google Cast discovery nor
  the AirPlay picker works in a simulator/emulator — test with a real phone and
  a Chromecast/Nest (or HomePod/Apple TV) on the **same Wi-Fi**. On iOS the
  first tap of the cast button triggers the Local Network permission prompt
  (deny = no devices found, ever — reset via Settings → Privacy → Local
  Network). Cast hands playback OFF the phone: while a session is connected,
  RNTP is torn down and the phone is a remote — expect no lock-screen media
  controls, and the deck's Signal cell reads `Cast · <device>`.
  `react-native-google-cast` runs under the New Architecture in **compat
  (interop) mode** (v5 will be native); if a Cast API breaks after an RN/Expo
  upgrade, check the library's v5 status before patching.
- **The Android Cast SDK is pinned** (`androidPlayServicesCastFrameworkVersion`
  on the `react-native-google-cast` plugin in `app.json`). The library defaults
  to `play-services-cast-framework:+`, so every build takes Google's newest, and
  23.0.0 pulls `androidx.mediarouter:mediarouter:1.9.0-beta01`, which needs
  compileSdk 37 and AGP 9.1: `:app:checkReleaseAarMetadata` fails the build.
  Raise the pin alongside an Expo SDK upgrade that moves compileSdk/AGP, and
  ship it in a binary for both platforms, because the plugin options are in the
  shared app config, so the pin is in the iOS fingerprint too.

---

## Prerequisites

| Tool | Needed for | Notes |
|---|---|---|
| Node 20+ / npm | everything | `npm install` (uses `legacy-peer-deps`, set in `.npmrc`) |
| Xcode 16+ + CocoaPods | iOS sim/device | `xcode-select --install`, `sudo gem install cocoapods` |
| **JDK 17** | Android build | `brew install openjdk@17`. **Not** JDK 21 (Android Studio's JBR) — it fails the Gradle build with a JVM-target mismatch. |
| Android SDK + an AVD | Android emulator | via Android Studio; emulator binary at `$ANDROID_HOME/emulator` |

First-time setup:

```bash
cd app
npm install        # postinstall applies patches/ via patch-package
```

---

## Local testing — iOS simulator

The fast inner loop. No Apple Developer account required.

```bash
cd app

# Build, install, and launch on a booted simulator.
# (Boot one first via: open -a Simulator)
npx expo run:ios

# If run:ios skips the dev server (non-interactive shells do), start Metro
# yourself and open the installed app pointed at localhost:
npx expo start --dev-client --port 8081 &
xcrun simctl openurl <SIM_UDID> \
  "exp+subwave://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

**Use `localhost`, not the LAN IP**, in the deep link for simulators — the LAN
IP can time out (`xcrun simctl openurl ... code: 60`).

**Verified working** (2026-06): builds clean (0 errors), bundles 4075 modules,
renders onboarding → health check (all 4 probes OK against live getsubwave.com)
→ player with live audio (NOW PLAYING timer advances), runtime theming, cover
art, and the Skia spectrum.

---

## Local testing — Android emulator

```bash
cd app

# Boot an AVD (list them: $ANDROID_HOME/emulator/emulator -list-avds)
$ANDROID_HOME/emulator/emulator -avd <AVD_NAME> &

# Build with JDK 17 — single connected emulator is auto-selected.
# DO NOT pass `--device <adb-serial>`; expo wants an AVD name, not emulator-5554.
JAVA_HOME=/opt/homebrew/opt/openjdk@17 npx expo run:android
```

If the dev client opens against the LAN IP and can't reach Metro, set the
reverse tunnel and relaunch via localhost:

```bash
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW \
  -d "exp+subwave://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" \
  com.getsubwave.app
adb exec-out screencap -p > /tmp/screen.png   # always screenshot to verify
```

**Verified working** (2026-06): `BUILD SUCCESSFUL` with JDK 17 (new arch ON, via
the RNTP patch), debug APK installed on the emulator. (Physical-device run is
covered and proven by the `subwave-app-android` skill — see below.)

---

## Physical devices

### Android phone — use the `subwave-app-android` skill

The repo ships a skill (`.claude/skills/subwave-app-android/`) that automates
getting the app onto a connected Pixel, in two modes:

- **Dev / USB** — dev-client app loads live JS from Metro over `adb reverse`;
  hot-reload while tethered.
- **Release / embedded** — self-contained release APK (`./gradlew assembleRelease`
  with **JDK 17**) that runs unplugged over WiFi/cellular.

It handles the JDK-17 gotcha, the Metro tunnel, the deep link, and screenshots
to verify. The release APK is signed with the **debug keystore** — fine for
sideloading, **not** for Play Store.

### iOS device

Two options:
1. **Local** — open `ios/SUBWAVE.xcworkspace` in Xcode, select your device,
   set a development team (Signing & Capabilities), run. Needs a free or paid
   Apple ID for on-device signing.
2. **EAS** — `eas build --profile development-device --platform ios` (see below).

Background audio (lock screen / CarPlay / headphones) and metadata can only be
properly judged on a **physical device** — the remote-control wiring lives in
`service.ts` (Play/Pause/Stop; Next/Seek intentionally omitted for a live
stream).

On Android, `PlaybackService` must **never resolve**. It runs as RNTP's
headless JS task, and React Native fires JS timers behind a paused activity only
while a headless task is active. Every background poll is a timer, including the
`/now-playing` poll that feeds lock-screen and Bluetooth metadata. RN 0.85 never
registered `HeadlessJsTaskSupport` under bridgeless, so the task never finished.
RN 0.86 (Expo SDK 57) registers it, and app 1.6.0 shipped with metadata frozen
behind the lock screen until the phone was unlocked. Device check: tune in, lock
the phone, and wait through a track change. The notification (or a Bluetooth
head unit) should show the new title without unlocking.

### CarPlay & Android Auto — launchable in-car apps

Both car platforms now get a real SUB/WAVE app on the car screen: a Stations
list (featured + saved recents, the same `carStations` view on both platforms)
→ tap → tune → the system now-playing screen, fed by the metadata RNTP already
pushes (`useNowPlayingInfo`). The shared tune path is `src/car/carTune.ts`
(works from the headless service — a car cold start never mounts the phone UI);
`usePlayer`'s station-change effect *adopts* a car-initiated switch instead of
stopping it (`streamBelongsTo` guard).

- **iOS (CarPlay)** — `react-native-carplay` templates; `plugins/withCarPlay.js`
  generates the scene manifest, `CarSceneDelegate`/`PhoneSceneDelegate` Swift
  files, and the `com.apple.developer.carplay-audio` entitlement on prebuild.
  Test in the **CarPlay Simulator** (Simulator app → **I/O → External Displays
  → CarPlay**) — simulator builds skip provisioning, so this works **before**
  Apple grants the entitlement. **Device builds fail codesigning until the
  grant lands** (apply at <https://developer.apple.com/contact/carplay/>,
  Account Holder, category Audio; then enable CarPlay on the App ID under
  Additional Capabilities and regenerate profiles — EAS can't sync this
  capability). Until then `eas.json` device profiles strip the entitlement via
  `SUBWAVE_NO_CARPLAY_ENTITLEMENT=1`; delete those lines after the grant.
  **SDK-upgrade caveat**: the generated `PhoneSceneDelegate` re-parents the
  AppDelegate's React root into the scene window — re-verify against Expo's
  AppDelegate template on every SDK bump.
- **Android (Android Auto)** — the RNTP fork's Media3 `MediaLibraryService`
  serves the browse tree (`src/car/browseTree.ts`; taps/voice land as
  `Event.RemotePlayId`/`RemotePlaySearch` in `service.ts`);
  `plugins/withAndroidAuto.js` supplies `automotive_app_desc.xml` + the car
  meta-data. Test with the **Desktop Head Unit** (Android Studio; enable Auto
  developer mode → "Unknown sources") or a real head unit.

> ⚠ **Android Auto must stay OFF Google Play.** The earlier manifest-only
> declaration (#444) drew a Play **enforcement** on 20 Jun 2026 — *"Category
> not permitted — media apps that use TTS engine readout for content are not
> permitted at this time"* — and the build was pulled (#477). The AI DJ *is*
> TTS readout, so the now-compliant browse tree does not cure the policy
> objection. The `production` profile therefore sets `SUBWAVE_NO_ANDROID_AUTO=1`
> to strip the declaration from Play-bound builds; dev / `preview` (internal
> APK) / sideloaded builds keep Android Auto working. Revisit the gate only if
> Google's "at this time" policy changes, or to attempt an appeal armed with
> the compliant `MediaLibraryService` implementation.

### Live Activity — Lock Screen, Dynamic Island, Apple Watch (iOS only)

The on-air card. A **widget extension target** (`targets/live-activity/`, wired by
`@bacons/apple-targets`) plus a **local Expo module** (`modules/live-activity/`)
that drives ActivityKit, started and stopped by `src/hooks/useLiveActivity.ts`.

The reason it exists is the **Apple Watch**: React Native does not run on watchOS,
so a real watch app is a second, Swift-only codebase. iOS 18+ mirrors an iPhone
Live Activity into the **watch Smart Stack** for free — the same lock-screen
SwiftUI view, rendered on the wrist. One target, no watchOS project, no second
release path.

**The floor is iOS 17** (the widget target builds at 17.0 for the interactive
heart). `isLiveActivitySupported()` is the only gate; below it the app behaves
exactly as it did before and the OS Now Playing card is untouched.

What is easy to get wrong:

- **`SubwaveLiveAttributes.swift` is compiled twice** — once into the widget, once
  into the Expo module — because the two are different Swift modules and neither
  can import the other. ActivityKit matches an activity to its widget by the type
  NAME, not its module, which is why two copies work; it is the same split Apple's
  own app/extension template has. `npm test` fails if they drift. A mismatched
  `ContentState` does **not** fail the build — the card just silently stops
  rendering on device, which is a miserable thing to debug.
- **`_shared/` is load-bearing.** `LikeTrackIntent.swift` must compile into the
  **main app target** as well as the widget — that is what `_shared/` means to
  `@bacons/apple-targets`, and it is what makes the heart work at all, because a
  `LiveActivityIntent` runs in the app's process (waking it if suspended). If the
  intent ends up in the widget target only, the button does nothing. Confirm the
  generated project lists it under the app target after a prebuild.
- **The widget gets no network turn.** Cover art is downloaded by the app into the
  `group.com.getsubwave.app` container and handed to the widget as a *filename*.
  Miss the App Group entitlement on either side and every cover silently falls
  back to the drawn disc mark.
- **Version lockstep.** App Store Connect rejects an upload whose extension
  `CFBundleShortVersionString` differs from the app's. `eas.json` uses
  `autoIncrement` with remote `appVersionSource`; check the widget target picks up
  the same version on the first production build rather than at submit time.
- **The heart fills on the next feed poll (≤5s), not instantly.** Deliberate: the
  intent hands the tap back to JS so the like goes out through the app's own
  `StationApi` — no station URL and no SecureStore credential in an app extension —
  and the controller rejects a stale tap, so a heart that fills and then un-fills
  would be worse than one that fills a beat late.

Iterate on it like any other native change: `npx expo prebuild -p ios --clean`,
then `xed ios` and pick the **SUB/WAVE Live** scheme — `SubwaveLiveActivity.swift`
carries a `#Preview` so the layout can be worked on without a device. It cannot
run in Expo Go, and the Dynamic Island needs a Pro-class device or the matching
simulator.


---

## EAS cloud builds (for distributing to testers)

Use EAS when testers can't build locally — TestFlight (iOS) or a shareable
internal APK (Android). `eas.json` already defines the profiles, and the
project is already linked (`extra.eas.projectId` is set in `app.json`); the only
interactive piece left is **auth**, which must be done by the project owner.

### One-time setup (owner runs these)

```bash
npm i -g eas-cli
eas login                 # your Expo account
cd app                    # project is already linked — `eas init` is only
                          # needed again if the owner/projectId ever changes
```

`eas.json` uses `appVersionSource: remote`, so build/version numbers are managed
on the EAS servers (`production` auto-increments) — you don't hand-edit
`ios.buildNumber` / `android.versionCode`.

### Build profiles (already configured in `eas.json`)

| Profile | Output | Account needs |
|---|---|---|
| `development` | dev client, iOS **simulator** | EAS only |
| `development-device` | dev client, physical device | iOS: Apple Developer ($99/yr) for device provisioning |
| `preview` | internal: Android **APK**, iOS non-simulator | Android: none (EAS-managed keystore). iOS: Apple Developer |
| `production` | store builds, auto-incremented | Apple Developer + Play Console |

### Example: shareable Android APK for testers (no Apple account)

```bash
eas build --profile preview --platform android
# EAS returns a URL; testers download + sideload the APK.
```

### Example: iOS TestFlight

```bash
eas build --profile production --platform ios     # needs Apple Developer
eas submit --profile production --platform ios     # uploads to App Store Connect
```

> **OTA is wired up.** `expo-updates` is installed, `app.json` has the `updates`
> block + `runtimeVersion.policy = "fingerprint"`, and `eas.json` gives `preview`
> and `production` a `channel`. JS-only changes ship over-the-air with
> `eas update --channel <channel>` — no new build. Native changes (deps,
> `patches/`, config plugins, `app.json` native sections) still need a store
> build; the fingerprint runtime version guarantees an OTA can't land on a binary
> with mismatched native code. Full decision table + commands: [`RELEASE.md`](./RELEASE.md).

---

## A listener's playback log

A store build prints nothing a listener can reach, so it keeps the last 300
`plog` lines (`src/hooks/usePlayer.ts`) in memory instead: the playback state
events and errors, iOS route changes, and every hold and reload
`src/lib/stream-recovery.ts` decides, with its reason. Ask a listener with a
playback problem for **About SUB/WAVE → Share playback log** (the share sheet
has Copy on iOS and Android 10+; older Android sends it to a mail or notes app)
before they kill the app, which empties it.

The first line names the app version, the JS bundle (`OTA <id>` or
`built-in <id>`, and the channel) and the OS. Times are the phone's clock in
UTC. Each `reload [reason] #n` line should match one new stream request (its
`t=` cache-buster) in the station's Icecast access log; a `skipped` line loads
nothing. Lines are redacted before they are stored
(`src/lib/playback-log.ts`): URLs keep only scheme, host and path, the station
password, Station login and `Authorization` values are gone, and a route lists
port types without device names.

---

## Known issues / gotchas

- **JDK 21 fails the Android build.** Always `JAVA_HOME=/opt/homebrew/opt/openjdk@17`.
- **`LegacySurfaceTexture is not attached!`** in Android logcat is **noise** from
  the Skia visualizer surface, not a crash.
- **Gradle is pinned to 8.14.3** via `plugins/withGradleVersion.js` — RN's
  bundled Gradle plugins reference an API removed in Gradle 9.
- **`expo run:ios` non-interactively prints "Skipping dev server"** and then
  fails the final deep-link open — the build/install still succeeded; just start
  Metro and open via `localhost` (above).

---

## Validation status (2026-06)

| Check | iOS | Android |
|---|---|---|
| `tsc --noEmit` | ✅ | ✅ |
| Native build | ✅ simulator (new arch ON) | ✅ emulator + APK (new arch ON, JDK 17) |
| RNTP New Architecture (fork, replaces the old patch) | ⏳ re-validate | ⏳ re-validate |
| Install + launch | ✅ | ✅ (emulator install) |
| JS bundle | ✅ 4075 modules | ✅ build path |
| Onboarding → health check | ✅ all 4 probes OK | (same JS; via skill on device) |
| Player + **live audio** | ✅ timer advances | proven on device via skill |
| Runtime theming, cover art, spectrum | ✅ | — |
| Background audio / lock screen | ⏳ device-only — not yet validated | ⏳ device-only |
