// Album of the day in an empty room — with the empty-room pause on, the album
// walk still steps (no model call, no link) instead of coasting on the shuffled
// album in auto.m3u and restarting from track one for the first listener.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unheardAlbumStepDue } from '../src/broadcast/album-episode-policy.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
// A method ends at its first two-space-indented brace, a function at column 0.
const bodyOf = (source: string, signature: string) => {
  const fn = source.slice(source.indexOf(signature));
  return fn.slice(0, fn.indexOf(signature.startsWith('  ') ? '\n  }\n' : '\n}\n'));
};

test('steps only when the room is empty and the music is playing', () => {
  assert.equal(unheardAlbumStepDue({ djCallsAllowed: false, streamIdle: false }), true);
  assert.equal(unheardAlbumStepDue({ djCallsAllowed: true, streamIdle: false }), false, 'a listened station picks normally');
  assert.equal(unheardAlbumStepDue({ djCallsAllowed: false, streamIdle: true }), false, 'an idle-paused stream plays nothing');
});

test('a track start with DJ calls blocked takes the unheard step, never the pick cycle', () => {
  const body = bodyOf(read('../src/broadcast/queue.ts'), '  onTrackStarted(');
  const gate = body.slice(body.indexOf('if (this.autoPick && this.upcoming.length === 0 && !this.pickerBusy)'));
  assert.match(gate, /if \(allowed\) this\.runPickCycle\(\{ isAutonomous \}\);\s*else if \(unheardAlbumStepDue\(/);
});

test('the unheard step makes no link and no model call', () => {
  const body = bodyOf(read('../src/broadcast/dj-agent.ts'), 'export async function stepAlbumUnheard(');
  assert.match(body, /pickAlbumInOrder\(queue, ctx, \{ wantLink: false, linkEligible: false, cheap: true,/);
  assert.doesNotMatch(body, /runTrackEvent|djObject|generatePickLink/);
});
