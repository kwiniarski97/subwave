// The request agent found the exact song outside the library and queued a
// library stand-in anyway (a live run: "Insignificant Other" by Queens of the
// Stone Age found as an ext- song, "Misfit Love" queued). Two halves pin the
// fix: the prompt names an outside find as a find, and runRequest holds the
// run to it when the model ignores that.

import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTempDir } from './test-utils/temp-dir.js';

process.env.STATE_DIR = createTempDir(join(tmpdir(), 'subwave-outside-backstop-'));
process.env.NAVIDROME_URL = 'http://navidrome.test:4533';
process.env.NAVIDROME_USER = 'fixture';
process.env.NAVIDROME_PASS = 'fixture-secret';
process.env.OCTO_FIESTA_URL = 'http://octo-fiesta.test:8080';

const policy = await import('../src/music/outside-request-policy.js');
const settings = await import('../src/settings.js');
const session = await import('../src/broadcast/session.js');
const { queue } = await import('../src/broadcast/queue.js');
const { requestAgent } = await import('../src/broadcast/dj-agent/agents.js');
const { runRequest } = await import('../src/broadcast/dj-agent.js');
const { requestSystem } = await import('../src/broadcast/dj-agent/schemas.js');

const ASK = 'Insignificant Other - Queens of the Stone Age';
const OUTSIDE = { id: 'ext-deezer-song-4261126191', title: 'Insignificant Other', artist: 'Queens of the Stone Age', duration: 353 };
const STAND_IN = { id: 'WiNU1irTIgAF6eZIWsbHxX', title: 'Misfit Love', artist: 'Queens of the Stone Age', duration: 339 };
const outsideCall = (tracks: any[] = [OUTSIDE], args = { artist: 'Queens of the Stone Age', title: 'Insignificant Other' }) =>
  ({ name: 'searchOutsideLibrary', args, result: { tracks, note: 'outside' }, round: 2 });

// --- the pure rule -----------------------------------------------------------

test('a stand-in loses to the exact outside song the run found', () => {
  assert.equal(policy.outsideOverride(STAND_IN, [outsideCall()], ASK)?.id, OUTSIDE.id);
});

test('a pick that already answers the ask stands', () => {
  // The library's own copy of the song.
  const libraryCopy = { id: 'lib1', title: 'Insignificant Other (Remastered)', artist: 'Queens of the Stone Age' };
  assert.equal(policy.outsideOverride(libraryCopy, [outsideCall()], ASK), null);
  // The outside song itself.
  assert.equal(policy.outsideOverride(OUTSIDE, [outsideCall()], ASK), null);
});

test('no outside hit, no override', () => {
  assert.equal(policy.outsideOverride(STAND_IN, [outsideCall([])], ASK), null);
  assert.equal(policy.outsideOverride(STAND_IN, [{ name: 'searchLibrary', args: {}, result: [OUTSIDE] }], ASK), null);
  assert.equal(policy.outsideOverride(STAND_IN, [], ASK), null);
  assert.equal(policy.outsideOverride(null, [outsideCall()], ASK), null);
});

test('the ask must be in the listener\'s own words, not only in the model\'s tool arguments', () => {
  assert.equal(policy.outsideOverride(STAND_IN, [outsideCall()], 'something heavy for a rainy day'), null);
  // Artist named, a different title searched: not what they asked for.
  assert.equal(policy.outsideOverride(STAND_IN, [outsideCall()], 'play some Queens of the Stone Age'), null);
  // Artist only: a stand-in by another act loses to the artist's outside song;
  // one by the named artist already answers it.
  const artistOnly = outsideCall([OUTSIDE], { artist: 'Queens of the Stone Age', title: '' });
  const other = { id: 'lib2', title: 'Song', artist: 'Kyuss' };
  assert.equal(policy.outsideOverride(other, [artistOnly], 'play some Queens of the Stone Age')?.id, OUTSIDE.id);
  assert.equal(policy.outsideOverride(STAND_IN, [artistOnly], 'play some Queens of the Stone Age'), null);
});

// --- the prompt --------------------------------------------------------------

test('the request prompt names an outside find only when the tool is offered', async () => {
  await settings.load();
  assert.doesNotMatch(requestSystem(), /searchOutsideLibrary/);
  assert.match(requestSystem(undefined, { outsideLibrary: true }), /searchOutsideLibrary[^]*IS the one the listener asked for/);
  // The substitution rule no longer reads "not in the library" as "not found".
  assert.doesNotMatch(requestSystem(), /isn't in the library/);
});

// --- the agent run -------------------------------------------------------------

const realRun = requestAgent.run;

beforeEach(async () => {
  requestAgent.run = realRun;
  queue.senderBusy = true;
  queue.upcoming = [];
  queue.current = null;
  queue.history = [];
  queue.djLog = [];
  policy.resetOutsideLedgerForTests();
  await settings.load();
  await settings.update({
    llm: { pickerAgent: true },
    tts: { enabled: false },
    requests: { outsideLibrary: true, outsideHourlyCap: 4 },
  } as never);
  session.start({
    at: new Date().toISOString(), time: { period: 'day', vibe: 'day', mood: 'calm' },
    weather: null, festival: null, dominantMood: 'calm', activeShow: null,
  } as any);
});

after(async () => {
  requestAgent.run = realRun;
  queue.senderBusy = false;
  await new Promise((resolve) => setTimeout(resolve, 1_100));
});

function modelPicks(id: string, toolCalls: any[]) {
  const args: any[] = [];
  requestAgent.run = (async (a: any) => {
    args.push(a);
    return {
      object: { kind: 'track', id, ack: 'Misfit Love for you!' },
      steps: 4,
      toolCalls,
      extras: { seen: new Map<string, any>([[OUTSIDE.id, OUTSIDE], [STAND_IN.id, STAND_IN]]) },
    };
  }) as any;
  return args;
}

test('runRequest queues the outside song the model passed over, with the stand-in ack dropped', async () => {
  const args = modelPicks(STAND_IN.id, [outsideCall()]);
  const out: any = await runRequest(queue, { requester: 'anon', text: ASK });
  assert.equal(args[0].scope.outsideLibrary, true, 'the run is told outside requests are open');
  assert.equal(out.track.id, OUTSIDE.id);
  assert.equal(queue.upcoming.at(-1)?.track.id, OUTSIDE.id);
  assert.doesNotMatch(out.ack, /Misfit Love/, 'an ack written for the stand-in must not survive');
});

test('with the gate shut the model\'s pick stands', async () => {
  await settings.update({ requests: { outsideLibrary: false } } as never);
  const args = modelPicks(STAND_IN.id, [outsideCall()]);
  const out: any = await runRequest(queue, { requester: 'anon', text: ASK });
  assert.equal(args[0].scope.outsideLibrary, false);
  assert.equal(out.track.id, STAND_IN.id);
});
