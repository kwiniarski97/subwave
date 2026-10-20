// Album of the day: whether a pick the album walk produced gets a link. The
// show exists to talk between the songs, so every seam of the walk speaks,
// whatever the persona's cadence counter says. That only applies where a link
// could have aired at all (`linkEligible`: auto-link on, an autonomous seam
// with a predecessor, not a mic-pass seam), and never past the voice switch or
// the soft budget tier, which silence every other link too.
//
// `wantLink` arrives already gated (runTrackEvent applies !cheap && voice), so
// it passes straight through. The persona's tracksUntilLink counter is not
// touched, so the ordinary cadence resumes after the album.
export function albumLinkDue({ wantLink, linkEligible, cheap, voiceAllowed }: {
  wantLink: boolean; linkEligible: boolean; cheap: boolean; voiceAllowed: boolean;
}): boolean {
  return wantLink || (linkEligible && !cheap && voiceAllowed);
}

// Album of the day in an empty room. The empty-room pause (llm.pauseWhenEmpty)
// skips the pick cycle, and Liquidsoap coasts on auto.m3u, which for an album
// episode is the album SHUFFLED. The walk only moved on a pick, so the album
// aired out of order for as long as nobody listened, then started again from
// track one when the first listener arrived: the album twice in one show.
// Stepping the walk costs no model call, so it runs whenever music is actually
// playing to nobody; only the link stays off. An idle-paused stream is not
// playing at all (stream-idle.ts), so it does not step.
export function unheardAlbumStepDue({ djCallsAllowed, streamIdle }: {
  djCallsAllowed: boolean; streamIdle: boolean;
}): boolean {
  return !djCallsAllowed && !streamIdle;
}
