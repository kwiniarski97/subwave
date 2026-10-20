// describeRouting()'s PocketTTS warning for a community-model language: a
// Polish persona on a built-in voice gets an English speaker's accent, which
// /debug must say rather than look healthy.
// Run: npm test -- pocket-tts-debug-warning

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'pocket-debug-'));
process.env.STATE_DIR = root;
process.env.TTS_HEAVY_URL = '';
// isAvailable() on the local path only checks that both files exist.
process.env.POCKET_TTS_PYTHON = process.execPath;
process.env.POCKET_TTS_WORKER = fileURLToPath(import.meta.url);

const settings = await import('../src/settings.js');
const tts = await import('../src/audio/tts.js');
await settings.load();

test.after(() => rmSync(root, { recursive: true, force: true }));

async function persona(language: string, voice: string) {
  await settings.update({
    personas: settings.get().personas.map((p: any, i: number) =>
      i === 0 ? { ...p, language, tts: { engine: 'pocket-tts', cloudProvider: 'openai', voice, gainDb: 0, speed: 1 } } : p,
    ),
    activePersonaId: settings.get().personas[0].id,
  });
  return tts.describeRouting().spoken;
}

test('a Polish persona on a built-in PocketTTS voice is warned about', async () => {
  const spoken = await persona('Polski', 'alba');
  assert.equal(spoken.engine, 'pocket-tts');
  assert.match(String(spoken.warning), /English accent/);
});

test('a Polish persona on its own cloned clip is not', async () => {
  const spoken = await persona('Polski', 'piotr.wav');
  assert.equal(spoken.warning, null);
});

test('an English persona on a built-in voice is not', async () => {
  const spoken = await persona('English', 'alba');
  assert.equal(spoken.warning, null);
});
