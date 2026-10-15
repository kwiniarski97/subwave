// `{English}` span marks for Polish Kokoro voices.
//
// A Polish Kokoro voice reads English titles with Polish letter sounds unless
// the DJ marks them; kokoro_worker.py phonemizes `{...}` spans as English. The
// marks are TTS input for that one engine, so four seams have to agree:
//   1. djSystem() asks for them only when the RESOLVED voice is Kokoro reading Polish;
//   2. normalizeForSpeech() keeps them for kokoro and drops them for every other engine;
//   3. a rescue off a kokoro request drops them (fallbackTextFor);
//   4. the public session feed never shows them to a listener.
//
// Driven against real settings for the prompt half; STATE_DIR is redirected
// before the first import, hence the dynamic imports.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'subwave-kokoro-polish-'));
process.env.STATE_DIR = root;

const settings = await import('../src/settings.js');
const { djSystem } = await import('../src/llm/internal/prompts/system.js');
const { normalizeForDisplay, normalizeForSpeech, stripEnglishSpanMarks } = await import('../src/audio/speech-text.js');
const { fallbackTextFor } = await import('../src/audio/tts-fallback.js');
const { publicSessionTurn } = await import('../src/util/public-feed.js');

test.after(() => rmSync(root, { recursive: true, force: true }));

// Matched on a fragment so a reword of the hint doesn't fail this test.
const HINT_MARKER = 'curly braces';
const persona = (tts: Record<string, unknown>) => ({
  id: 'p_pl',
  name: 'Mateusz',
  soul: 'A test persona.',
  tts: { cloudProvider: 'openai', gainDb: 0, speed: 1, ...tts },
});
const LINE = 'Teraz {Pink Floyd} i utwór {Wish You Were Here}.';

test('a persona pinned to a Polish Kokoro voice is asked to mark English spans', async () => {
  await settings.update({ tts: { defaultEngine: 'piper', kokoro: { voice: 'bf_isabella', lang: '' } } });
  assert.ok(djSystem(persona({ engine: 'kokoro', voice: 'lm_mateusz' })).includes(HINT_MARKER));
});

test('an inherit persona gets the hint only when the station resolves to Polish Kokoro', async () => {
  const inherit = persona({ engine: 'inherit', voice: 'lm_mateusz' });
  await settings.update({ tts: { defaultEngine: 'kokoro' } });
  assert.ok(djSystem(inherit).includes(HINT_MARKER), 'inherit + kokoro station carries the Polish voice');
  await settings.update({ tts: { defaultEngine: 'piper' } });
  assert.ok(!djSystem(inherit).includes(HINT_MARKER), 'piper would read the braces, so no hint');
});

test('no hint for a non-Polish Kokoro voice, or when the language override is not Polish', async () => {
  await settings.update({ tts: { defaultEngine: 'piper', kokoro: { voice: 'bf_isabella', lang: '' } } });
  assert.ok(!djSystem(persona({ engine: 'kokoro', voice: 'bm_george' })).includes(HINT_MARKER));
  await settings.update({ tts: { kokoro: { voice: 'bf_isabella', lang: 'en-gb' } } });
  assert.ok(
    !djSystem(persona({ engine: 'kokoro', voice: 'lm_mateusz' })).includes(HINT_MARKER),
    'an en-gb override phonemizes the Polish voice as English, where braces mean nothing',
  );
  await settings.update({ tts: { kokoro: { voice: 'bf_isabella', lang: '' } } });
});

test('speech keeps the marks for kokoro only; display keeps them for speak() to receive', () => {
  assert.equal(normalizeForSpeech(LINE, [], 'Polish', 'kokoro'), 'Teraz {Pink Floyd} i utwór {Wish You Were Here}.');
  assert.equal(normalizeForSpeech(LINE, [], 'Polish', 'piper'), 'Teraz Pink Floyd i utwór Wish You Were Here.');
  assert.equal(normalizeForSpeech(LINE, [], 'Polish', ''), 'Teraz Pink Floyd i utwór Wish You Were Here.');
  assert.equal(normalizeForDisplay(LINE), LINE);
});

test('a rescue off a kokoro request drops the marks; other requests are untouched', () => {
  assert.equal(fallbackTextFor('kokoro', '', LINE), 'Teraz Pink Floyd i utwór Wish You Were Here.');
  assert.equal(fallbackTextFor('piper', '', 'a {b}'), 'a {b}');
  assert.equal(fallbackTextFor('kokoro', '', ''), '');
});

test('the public session feed shows listeners the words without the marks', () => {
  const turn = publicSessionTurn({
    t: 1, role: 'assistant', kind: 'link', text: LINE,
    meta: { say: 'Za chwilę {Radiohead}.', toolCalls: ['private'] },
  });
  assert.equal(turn.text, 'Teraz Pink Floyd i utwór Wish You Were Here.');
  assert.equal(turn.meta.say, 'Za chwilę Radiohead.');
  assert.ok(!('toolCalls' in turn.meta), 'the allowlist still applies');
  assert.equal(publicSessionTurn({ text: undefined }).text, undefined, 'a missing text stays missing');
  assert.equal(stripEnglishSpanMarks(''), '');
});
