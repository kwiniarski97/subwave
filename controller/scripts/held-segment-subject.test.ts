// A segment held for the next track boundary (djTalkOnlyBetweenTracks, the
// ident, a vocal-runway postponement) is written about the track on air WHEN IT
// IS WRITTEN. At its first boundary that track is the one ending, which is what
// the writer is told (skills/_agent.ts buildSituation). Held past that boundary
// it would land after a different song while still talking about the old one.
// Live: a library-deep-cut line about Michael Jackson's catalogue aired over
// the start of Laura Branigan's "Self Control".
// Run: `npm test -- held-segment-subject`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { queue, shouldDropHeldSegment } from '../src/broadcast/queue.js';
import { buildSituation } from '../src/skills/_agent.js';
import { withTalkAir } from '../src/broadcast/talk-air.js';

const MJ = { id: 'mj-1', title: 'Off the Wall', artist: 'Michael Jackson' };
const LB = { id: 'lb-1', title: 'Self Control', artist: 'Laura Branigan' };
const NV = { id: 'nv-1', title: 'All Apologies', artist: 'Nirvana' };

test('the subject is still the outgoing track → airs', () => {
  assert.equal(shouldDropHeldSegment(MJ, MJ, ['That was Michael Jackson.']), false);
});

test('held past its subject and names it → dropped', () => {
  assert.equal(shouldDropHeldSegment(MJ, LB, ['Michael Jackson has more in the crate.']), true);
  assert.equal(shouldDropHeldSegment(MJ, LB, ['ok', '"Off the Wall" still holds up.']), true, 'any clip of an exchange');
});

test('held past its subject but never names it → airs (no silent boundary for generic talk)', () => {
  assert.equal(shouldDropHeldSegment(MJ, LB, ['Late evening, the city is quiet.']), false);
});

test('no subject stamp (nothing was on air) → airs', () => {
  assert.equal(shouldDropHeldSegment(null, LB, ['Michael Jackson']), false);
  assert.equal(shouldDropHeldSegment(undefined, NV, ['Michael Jackson']), false);
});

test('situation for a deferred segment says the on-air track will have ended', async () => {
  const prev = queue.current;
  queue.current = { track: MJ } as any;
  try {
    const now = buildSituation({});
    assert.match(now, /On air now: "Off the Wall" by Michael Jackson/);
    assert.doesNotMatch(now, /will have ended/);
    const held = await withTalkAir('next-track', async () => buildSituation({}));
    assert.match(held, /"Off the Wall" by Michael Jackson/);
    assert.match(held, /will have ended/);
    assert.match(held, /name the artist/i);
  } finally {
    queue.current = prev;
  }
});
