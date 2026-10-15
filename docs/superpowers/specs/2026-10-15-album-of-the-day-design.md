# Album of the day — design

Date: 2026-10-15. Status: draft for review.

## Goal

A show that, on each airing, takes one album from Navidrome, researches it, and
plays it **in album order** while the DJ reads facts and trivia between the
songs. After the album finishes, the rest of the slot is the show's ordinary
programming.

The operator schedules it like any show (for example a daily two-hour slot).

### Decisions taken in brainstorming

| Question | Decision |
| --- | --- |
| Track order | Album order: disc, then track number. Never shuffled. |
| Album shorter than the slot | Hand back to the show's normal picks. No looping. |
| Album longer than the slot | Cut at the show boundary. No overrun or extension. The operator sizes the slot (2h covers almost every album), and the skill skips albums longer than a configurable limit. |
| How the album is chosen | Navidrome `getAlbumList2 type=random` → hard filters → the LLM chooses one of the survivors. If that fails, take a random survivor. |
| Everything fails | One unfiltered random album straight from Navidrome, with no LLM. |
| DJ cadence | A link on every seam while the album walk is active. |
| Persona | Ship a paste-ready host persona recipe with the example. Do not seed settings. |

### Non-goals

- Overrunning the slot or delaying the next show.
- Queuing the album as an operator block. That would bypass the pick cycle,
  which is the only thing that writes links between songs.
- A new show type or new show-editor fields. The feature is a preparation skill
  plus a new `music` type.

## Architecture

```
show airing starts
  └─ show-preparation runs the show's preparation skill (album-of-the-day/tool.mjs)
       ├─ services.library.randomAlbums()   → candidates
       ├─ filters (tracks, length, compilation, featured ledger, recent plays)
       ├─ services.choose()                 → LLM picks one (fallback: random)
       ├─ services.searchWeb()              → research
       └─ returns { subject, data, music: { type: 'album', albumId } }
  └─ controller records the album in the featured-albums ledger

every pick cycle while the airing lasts
  └─ runTrackEvent → pickInOrder
       ├─ prepared music is an album and the walk is not finished
       │    → next album track in order, link forced on, enqueueSelected
       └─ album finished (or no album) → today's paths (in-order playlist / agent / pool)
```

The pool picker and the `auto.m3u` fallback are restricted to the album's tracks
**only while the walk is unfinished**, the same way an artist episode restricts
them today.

## Components

### 1. Preparation result schema (`controller/src/schemas/show-preparation.ts`)

`music` becomes a discriminated union on `type`:

```ts
music: z.discriminatedUnion('type', [
  z.object({ type: z.literal('artist'), artistId: z.string().trim().min(1).max(256) }),
  z.object({ type: z.literal('album'),  albumId:  z.string().trim().min(1).max(256) }),
]).optional()
```

Existing artist results parse byte-identically. Run `npm run gen:schemas` to
update the web mirror.

### 2. Album episode source (`controller/src/music/episode-source.ts`)

- `AlbumEpisodeSource { kind: 'album'; identity; album: { id, name, artist, year }; tracks; ids }`.
  `tracks` are **ordered** by `orderAlbumTracks` (moved from
  `broadcast/block-queue.ts` into a shared music module, so the block queue and
  this file import the same function).
- `EpisodeSource = ArtistEpisodeSource | AlbumEpisodeSource`. `intersectEpisodeSource`
  and the picker read only `.tracks`/`.ids`, so they accept either.
- `resolveAlbumEpisodeSource(albumId, show, identity)`: one `subsonic.getAlbum`,
  then the **same** filter chain as the artist source (station-archive, blocklist,
  excluded playlists, strict playlist, strict locks, length ceiling and floor).
  Dedupe by track **id only**, not `trackKey`, so an album that repeats a title
  (an intro and its reprise, a live and studio take) keeps both in order.
- Cached for 60s the same way the artist catalogue is.

### 3. Album walk (new pure module `controller/src/music/album-walk.ts`)

Pure, like `music/playlist-order.ts`, and reusing its `PlaylistCursor` shape and
`resumeIndex` lookup.

- `albumWalkSig(occurrenceId, albumId)`: the cursor signature. A new airing (a new
  occurrence) starts at track 1. A restart within an airing resumes.
- `nextInAlbum(tracks, cursor, sig, eligible)` → `{ track, index } | { finished: true }`.
  Walks forward from the resume point **without wrapping**. When no eligible track
  remains after the cursor, it reports `finished`.
- `albumWalkFinished(...)`: the same answer as a boolean, for the restriction check.

The cursor is persisted through the existing `commitInOrderPick` store, keyed by
show id, with the album signature. Because the signature contains the occurrence
id, it cannot collide with a playlist walk's cursor for the same show.

### 4. Pick path (`controller/src/broadcast/dj-agent.ts`)

`pickInOrder` currently stands down whenever preparation supplies `music`. It
changes to:

1. Prepared music is `album` → resolve the album source and call `nextInAlbum`.
   - Next track found → `enqueueSelected` with reason
     `Track 3 of 9: "<title>" from <album> (<artist>, <year>)`, source
     `album-episode-order`, and the link forced on (see 5). Commit the cursor (also on
     a `collision`, as the playlist walk does).
   - `finished` → fall through to today's paths. The first pick after the finish
     appends `The album "<album>" has finished; the rest of the show is open.` to the
     event text, once per airing.
   - Resolve failure → booth log line, then fall through. The station keeps making
     sound.
2. Prepared music is `artist` → unchanged (stand down).
3. No prepared music → the existing in-order playlist walk, unchanged.

An album episode takes precedence over a show's own `playlistInOrder`, because
preparation is per airing.

`showPreparation.read().music` returns `null` for an album whose walk has finished,
so the pool picker and `auto.m3u` lose the restriction at the same moment. The
research `data` stays available to the DJ for the rest of the airing.

### 5. Every-seam links (new policy in `controller/src/broadcast/album-episode-policy.ts`)

One function, `albumLinkDue({ albumWalkActive, isAutonomous, autoLink })`. It is
true only when the station's auto-link is on, the seam is autonomous (a listener
request brings its own intro), and an album walk produced this pick. `runTrackEvent`
ORs it into `wantLink` **before** its existing gates (`cheap` budget tier,
`autoVoiceAllowed()`), so a muted station or the soft budget tier still stays
silent. The persona's `tracksUntilLink` counter is left alone, so cadence resumes
normally after the album.

### 6. Skill services (`controller/src/llm/internal/tools/station-services.ts`)

- `library.randomAlbums({ count })`: wraps `getAlbumList2 type=random` (new
  `subsonic.getRandomAlbums`). Returns `{ id, name, artist, year, genre, songCount,
  duration, isCompilation }`.
- `featured.recentAlbumIds(days)`: reads the featured-albums ledger (see 7).
- `choose({ prompt, options })` → `Promise<number | null>`. One structured call
  through the `llm/sdk.js` primitives with a schema of `{ index: int }`, no retry
  loop, and a timeout. Returns `null` on any failure, an out-of-range index, or
  when `dj-budget` disallows calls. It is generic, so other skills can reuse it.

`StationServices` gains these three. Nothing else changes in the tool signature.

### 7. Featured-albums ledger (`state/featured-albums.json`)

The controller (not the skill) records `{ albumId, name, artist, at }` when a
preparation with `music.type === 'album'` is **accepted**. It is capped at 512
entries, newest first, written with `writeFileAtomic`, and a missing or corrupt
file reads as empty. Preparation records cannot serve as this history: they are
pruned 10 minutes after each airing ends.

### 8. Example skill (`docs/examples/skills/album-of-the-day/`)

`SKILL.md` contains frontmatter (`context: show`, a long cooldown) and the DJ's
brief. Every link uses the supplied research. One fact or piece of trivia per
link, never repeating earlier speech. When the facts are exhausted, the DJ talks
about the song from library facts (title, position, length) and never invents
anything. The final track is called the closing track.

`configFields`:
- `maxAlbumMinutes` (default 110)
- `minTracks` (default 5)
- `noRepeatDays` (default 90)
- `recentPlayHours` (default 24)
- `shortlist` (default 8)

`tool.mjs` flow:
1. `randomAlbums({ count: 20 })` → filter: `songCount ≥ minTracks`,
   `duration ≤ maxAlbumMinutes`, not a compilation, not in
   `featured.recentAlbumIds(noRepeatDays)`, and no track in
   `recentPlays(recentPlayHours)`. Checking tracks for that last filter needs
   `getAlbum` per survivor, so it runs on the shortlist only.
2. No survivors → one more page. Still none, or any throw → **last resort**: the
   first album of a fresh `randomAlbums({ count: 1 })`, no filters, no LLM.
3. More than one survivor → `choose()` with the show's topic and each album's
   title, artist, year and genre. `null` → a random survivor.
4. Research: `searchWeb('"<artist>" "<album>" album recording history')`, keeping
   results that mention the album title. Up to 4 results, 700 characters each.
   Research is optional. No results means the DJ sticks to library facts.
5. Return `{ available: true, subject: '<album> by <artist>', data: { album,
   tracklist, research }, music: { type: 'album', albumId } }`.
6. `{ available: false }` only when Navidrome itself is unreachable.

`persona.md` is a paste-ready host persona: a soul written as a record-store
historian (curious, precise, credits sources, never guesses), frequency
`chatty`, and a skills allowlist that includes `album-of-the-day`. It is created
through Admin → Personas, never seeded.

### 9. Docs

Add an "Album of the day" section to `docs/custom-skills.md`, beside the artist
spotlight: setup steps, the result contract's new `album` music type, the walk's
finish and cut behaviour, and the every-seam link rule.

## Error handling

| Failure | Behaviour |
| --- | --- |
| LLM down or slow | `choose()` → null → a random survivor. No retry. |
| Filters leave nothing twice | Unfiltered random album. |
| Navidrome unreachable at preparation | `available: false`. The existing two-attempt retry, then the show runs normally. |
| Album resolve fails mid-airing | Booth log. Ordinary picks. The existing "Retry catalogue" path applies. |
| Track blocklisted or filtered | Skipped in the walk, not substituted. |
| Show boundary mid-album | The next show starts. The album is not resumed. With `fadeAtShowEnd`, the existing cue-out fades it. |
| Controller restart mid-album | The cursor, keyed by occurrence, resumes at the next track. |
| Hard budget cap | No pick cycle at all (unchanged). `auto.m3u` is album-restricted while the walk is unfinished. |

## Testing

New `controller/scripts/*.test.ts` files using `node:test`:

- `album-walk.test.ts`: order (multi-disc, missing track numbers), no wrap,
  `finished`, resume after restart, a new occurrence starts at track 1, and
  ineligible tracks are skipped.
- `show-preparation-album.test.ts`: the schema accepts the album type and artist
  results stay unchanged. `read().music` is null once the walk has finished.
- `album-episode-source.test.ts`: the filter chain applies, and duplicate titles
  survive with id-only dedupe.
- `album-link-policy.test.ts`: forced on only for autonomous album picks, and
  still silenced by the mute and budget gates.
- `album-of-the-day-skill.test.ts`: drives the example `tool.mjs` with fake
  `services`, covering the filters, the `choose` null fallback, the
  unfiltered last resort, and `available: false` when Navidrome throws.
- `featured-albums.test.ts`: the cap, a corrupt file, and the window query.

Manual: a dev stack, a test show with the skill, **Retry preparation**, then
listen to two seams and the finish.

Run `npm run lint` and `npm test` in `controller/`. The web side only changes
through the regenerated schema mirror.
