// PocketTTS language routing: a persona's free-text `language` picks which
// PocketTTS model voices it. Pins the mapping and the wire field on both paths
// (sidecar body, local worker line). Each path runs in a fresh process because
// TTS_HEAVY_URL is read once at import.
// Run: npm test -- pocket-tts-language

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pocketTtsLanguage } from '../src/schemas/pocket-tts.js';

const scenario = process.env.POCKET_TTS_LANGUAGE_SCENARIO;

if (scenario) {
  // Child process: speak once per language and print what reached the wire.
  const sent: Array<Record<string, unknown>> = [];
  if (scenario === 'sidecar') {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, engines: ['pocket-tts'] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      sent.push(body);
      return new Response(JSON.stringify({ ok: true, path: body.out }), { status: 200 });
    }) as typeof fetch;
  }
  const pocketTts = await import('../src/audio/pocketTts.js');
  for (const language of ['Polski', '', 'Turkish']) {
    await pocketTts.speak('Dzień dobry.', { voice: 'piotr.wav', language });
  }
  pocketTts.stop();
  if (scenario === 'local') {
    for (const line of readFileSync(process.env.FAKE_WORKER_LOG!, 'utf8').trim().split('\n')) {
      sent.push(JSON.parse(line));
    }
  }
  process.stdout.write(`${JSON.stringify(sent.map((s) => s.language))}\n`);
  process.exit(0);
}

test('Polish in every spelling an operator types routes to the Polish model', () => {
  for (const raw of ['Polish', 'polski', 'POLSKI', 'pl', ' Polski ']) {
    assert.equal(pocketTtsLanguage(raw), 'polish', raw);
  }
});

test('the official kyutai languages route to their own models', () => {
  assert.equal(pocketTtsLanguage('French'), 'french');
  assert.equal(pocketTtsLanguage('Français'), 'french');
  assert.equal(pocketTtsLanguage('Deutsch'), 'german');
  assert.equal(pocketTtsLanguage('italiano'), 'italian');
  assert.equal(pocketTtsLanguage('Español'), 'spanish');
  assert.equal(pocketTtsLanguage('pt-BR'), 'portuguese');
  assert.equal(pocketTtsLanguage('Nederlands'), 'dutch');
  assert.equal(pocketTtsLanguage('English'), 'english');
  assert.equal(pocketTtsLanguage('en-GB'), 'english');
});

test('an empty language is left to the worker default, never guessed', () => {
  // Jingles and the `default` kind carry no persona language; the worker's
  // POCKET_TTS_DEFAULT_LANGUAGE decides, so a Polish station's jingles can
  // still be Polish.
  assert.equal(pocketTtsLanguage(''), '');
  assert.equal(pocketTtsLanguage(undefined), '');
  assert.equal(pocketTtsLanguage('   '), '');
});

test('a language PocketTTS has no model for keeps the English model it always had', () => {
  // Byte-identical upgrade: before language routing every line used English.
  assert.equal(pocketTtsLanguage('Turkish'), 'english');
  assert.equal(pocketTtsLanguage('Klingon'), 'english');
});

function runScenario(name: string, extraEnv: (stateDir: string) => Record<string, string>): unknown {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'pocket-lang-'));
  try {
    const out = execFileSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], {
      env: {
        ...process.env,
        POCKET_TTS_LANGUAGE_SCENARIO: name,
        STATE_DIR: stateDir,
        PIPER_OUT: path.join(stateDir, 'voice'),
        TTS_VOICE_DIR: path.join(stateDir, 'voices'),
        ...extraEnv(stateDir),
      } as NodeJS.ProcessEnv,
      encoding: 'utf8',
    });
    return JSON.parse(out.trim().split('\n').pop()!);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

test('the sidecar body carries the routed language', () => {
  const sent = runScenario('sidecar', () => ({ TTS_HEAVY_URL: 'http://tts-heavy.test:8080' }));
  assert.deepEqual(sent, ['polish', '', 'english']);
});

test('the local worker line carries the routed language', () => {
  const sent = runScenario('local', (stateDir) => {
    // A stand-in worker: reports ready, logs each request line, answers ok.
    const log = path.join(stateDir, 'worker.log');
    const script = path.join(stateDir, 'fake-worker.mjs');
    writeFileSync(script, [
      "import { appendFileSync } from 'node:fs';",
      "import readline from 'node:readline';",
      "process.stdout.write(JSON.stringify({ id: null, ready: true, voice_cloning: true }) + '\\n');",
      'for await (const line of readline.createInterface({ input: process.stdin })) {',
      "  appendFileSync(process.env.FAKE_WORKER_LOG, line + '\\n');",
      '  const req = JSON.parse(line);',
      "  process.stdout.write(JSON.stringify({ id: req.id, ok: true, path: req.out }) + '\\n');",
      '}',
    ].join('\n'));
    return {
      TTS_HEAVY_URL: '',
      POCKET_TTS_PYTHON: process.execPath,
      POCKET_TTS_WORKER: script,
      FAKE_WORKER_LOG: log,
    };
  });
  assert.deepEqual(sent, ['polish', '', 'english']);
});
