// Album of the day — a pick the album walk produced talks on every seam where
// a link could air at all, and never past the voice switch or the budget.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { albumLinkDue } from '../src/broadcast/album-episode-policy.js';

const base = { wantLink: false, linkEligible: true, cheap: false, voiceAllowed: true };

test('forced on for an eligible seam even when the cadence counter said no', () => {
  assert.equal(albumLinkDue(base), true);
});

test('a link the cadence already granted stays granted', () => {
  assert.equal(albumLinkDue({ ...base, wantLink: true, linkEligible: false }), true);
});

test('not forced where no link could air: auto-link off, a request seam, a mic-pass seam', () => {
  assert.equal(albumLinkDue({ ...base, linkEligible: false }), false);
});

test('the muted station and the soft budget tier still silence it', () => {
  assert.equal(albumLinkDue({ ...base, voiceAllowed: false }), false);
  assert.equal(albumLinkDue({ ...base, cheap: true }), false);
});

test('the album-finished note reaches the event turn on the in-order playlist path too', () => {
  const source = readFileSync(new URL('../src/broadcast/dj-agent.ts', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async function pickInOrder('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  const noteAt = body.indexOf('if (album.note) eventText = ');
  const turnAt = body.indexOf('session.appendTurn(');
  assert.ok(noteAt > 0 && turnAt > noteAt, 'the note is folded into eventText before the playlist walk writes its turn');
});
