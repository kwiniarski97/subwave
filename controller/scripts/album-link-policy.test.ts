// Album of the day — a pick the album walk produced talks past the cadence
// counter only while the research has something to say, plus the closing
// track; never where no link could air, past the voice switch or the budget.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { albumLinkDue, albumTalkingPoints } from '../src/broadcast/album-episode-policy.js';

const base = { wantLink: false, linkEligible: true, cheap: false, voiceAllowed: true, index: 0, total: 16, talkingPoints: 3 };

test('forced on while talking points remain, even when the cadence counter said no', () => {
  assert.equal(albumLinkDue(base), true);
  assert.equal(albumLinkDue({ ...base, index: 2 }), true);
});

test('past the talking points a seam follows the cadence counter', () => {
  assert.equal(albumLinkDue({ ...base, index: 3 }), false);
  assert.equal(albumLinkDue({ ...base, index: 5, wantLink: true }), true);
  assert.equal(albumLinkDue({ ...base, talkingPoints: 0 }), false, 'no research: no forced talk');
});

test('the closing track always gets its link', () => {
  assert.equal(albumLinkDue({ ...base, talkingPoints: 0, index: 15 }), true);
});

test('a link the cadence already granted stays granted', () => {
  assert.equal(albumLinkDue({ ...base, wantLink: true, linkEligible: false }), true);
});

test('not forced where no link could air: auto-link off, a request seam, a mic-pass seam', () => {
  assert.equal(albumLinkDue({ ...base, linkEligible: false }), false);
  assert.equal(albumLinkDue({ ...base, linkEligible: false, index: 15 }), false);
});

test('the muted station and the soft budget tier still silence it', () => {
  assert.equal(albumLinkDue({ ...base, voiceAllowed: false }), false);
  assert.equal(albumLinkDue({ ...base, cheap: true }), false);
});

test('talking points: a snippet is one, a long lead several, junk none', () => {
  assert.equal(albumTalkingPoints(null), 0);
  assert.equal(albumTalkingPoints({ research: 'nope' }), 0);
  assert.equal(albumTalkingPoints({ research: [{ content: 'x'.repeat(300) }, { content: '  ' }, {}] }), 1);
  assert.equal(albumTalkingPoints({ research: [{ content: 'x'.repeat(1500) }, { content: 'x'.repeat(200) }] }), 4);
});

test('the album-finished note reaches the event turn on the in-order playlist path too', () => {
  const source = readFileSync(new URL('../src/broadcast/dj-agent.ts', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async function pickInOrder('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  const noteAt = body.indexOf('if (album.note) eventText = ');
  const turnAt = body.indexOf('session.appendTurn(');
  assert.ok(noteAt > 0 && turnAt > noteAt, 'the note is folded into eventText before the playlist walk writes its turn');
});
