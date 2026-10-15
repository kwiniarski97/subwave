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
