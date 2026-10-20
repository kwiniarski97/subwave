// Album of the day: whether a pick the album walk produced gets a link. A
// link is forced past the persona's cadence counter only while the episode
// has something to say: one seam per talking point the research holds, plus
// the closing track. Forcing every seam, as this once did, left a sixteen-track
// album with three facts saying "this is the sixth track" thirteen times. Past
// that, the album walk follows the ordinary cadence (`wantLink`), so an album
// with no research mostly plays without talk.
//
// A forced link applies only where a link could have aired at all
// (`linkEligible`: auto-link on, an autonomous seam with a predecessor, not a
// mic-pass seam), and never past the voice switch or the soft budget tier,
// which silence every other link too. `wantLink` arrives already gated
// (runTrackEvent applies !cheap && voice), so it passes straight through. The
// persona's tracksUntilLink counter is not touched, so the ordinary cadence
// resumes after the album.
export function albumLinkDue({ wantLink, linkEligible, cheap, voiceAllowed, index, total, talkingPoints }: {
  wantLink: boolean; linkEligible: boolean; cheap: boolean; voiceAllowed: boolean;
  /** 0-based position of the track this pick queues, and the album's length. */
  index: number; total: number;
  talkingPoints: number;
}): boolean {
  if (wantLink) return true;
  if (!linkEligible || cheap || !voiceAllowed) return false;
  return index < talkingPoints || index === total - 1;
}

// Roughly one fact per POINT_CHARS of research: a search snippet is one, a
// Wikipedia lead several. A count, not a reading — the link writer still
// decides what each fact is, and repeats are held off by its recap.
const POINT_CHARS = 500;

export function albumTalkingPoints(data: unknown): number {
  const research = (data as { research?: unknown } | null | undefined)?.research;
  if (!Array.isArray(research)) return 0;
  let points = 0;
  for (const row of research) {
    const content = typeof row?.content === 'string' ? row.content.trim() : '';
    if (content) points += Math.max(1, Math.round(content.length / POINT_CHARS));
  }
  return points;
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
