// The web player's mount choice: MP3 floor, automatic Opus, opt-in FLAC.
// Pins that Lossless needs the station flag, browser support and an unfailed
// mount, and that a failed FLAC mount lands on Opus or MP3, not FLAC again.
//
// Run: `npm test -- lib/streamChoice`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseStream, detectCodecSupport, losslessAvailable, type StreamChoiceInput } from './streamChoice';

const base: StreamChoiceInput = {
  streams: { mp3: '/stream.mp3', opus: '/stream.opus', flac: '/stream.flac' },
  opusEnabled: true,
  flacEnabled: true,
  lossless: false,
  support: { opus: true, flac: true },
  failed: { opus: false, flac: false },
};

test('Opus is the automatic upgrade when Lossless is off', () => {
  assert.equal(chooseStream(base), '/stream.opus');
});

test('Lossless picks FLAC', () => {
  assert.equal(chooseStream({ ...base, lossless: true }), '/stream.flac');
});

test('Lossless needs an explicit true from the station', () => {
  for (const flacEnabled of [false, null]) {
    const i = { ...base, lossless: true, flacEnabled };
    assert.equal(losslessAvailable(i), false);
    assert.equal(chooseStream(i), '/stream.opus');
  }
});

test('Lossless needs browser support, probed or not', () => {
  assert.equal(chooseStream({ ...base, lossless: true, support: { opus: true, flac: false } }), '/stream.opus');
  assert.equal(chooseStream({ ...base, lossless: true, support: null }), '/stream.mp3');
});

test('a failed FLAC mount falls back to Opus, then MP3', () => {
  assert.equal(chooseStream({ ...base, lossless: true, failed: { opus: false, flac: true } }), '/stream.opus');
  assert.equal(chooseStream({ ...base, lossless: true, failed: { opus: true, flac: true } }), '/stream.mp3');
});

test('a non-standard stream override has no FLAC mount to offer', () => {
  const i = { ...base, lossless: true, streams: { mp3: 'http://x/custom', opus: null, flac: null } };
  assert.equal(losslessAvailable(i), false);
  assert.equal(chooseStream(i), 'http://x/custom');
});

test('iOS and Firefox get neither Ogg mount', () => {
  const yes = () => 'probably';
  assert.deepEqual(detectCodecSupport(yes, { ios: true, userAgent: 'Safari' }), { opus: false, flac: false });
  assert.deepEqual(
    detectCodecSupport(yes, { ios: false, userAgent: 'Mozilla/5.0 Gecko/20100101 Firefox/140.0' }),
    { opus: false, flac: false },
  );
});

test('only "probably" counts as support', () => {
  const answer = (type: string) => (type.includes('flac') ? 'maybe' : 'probably');
  assert.deepEqual(detectCodecSupport(answer, { ios: false, userAgent: 'Chrome' }), { opus: true, flac: false });
});
