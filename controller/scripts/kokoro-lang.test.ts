// Unit tests for the Kokoro phonemizer language vocabulary (settings/vocab.ts)
// and its sync with controller/scripts/kokoro_worker.py.
//
// Issue #1213: `fr` was offered as a language even though espeak-ng ships no
// bare `fr` voice (only fr-fr/fr-be/fr-ch). phonemizer's EspeakBackend matches
// its language argument EXACTLY against espeak-ng's voice table, so every
// French TTS call threw and fell back to Piper's English voice. The espeak-ng
// CLI does resolve `-v fr` to a regional voice, which is what made the wrong
// code look correct until it reached the backend.
//
// The two facts pinned here are the ones that let the bug exist and survive:
//   1. the TS override list and the worker's prefix→lang map must hold the SAME
//      language codes — the worker rejects any lang outside its own map values
//      and silently substitutes the voice's own language, so fixing one file
//      without the other trades a loud failure for a quiet wrong-accent one;
//   2. legacy codes must canonicalise rather than vanish, so an operator who
//      picked French before the fix still gets French after upgrading.
// Run: `npm test -- kokoro-lang`.
//
// node:assert-via-tsx style, matching scripts/tts-fallback.test.ts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  KOKORO_LANGS,
  KOKORO_LANG_RE,
  KOKORO_LANG_ALIASES,
  canonicalKokoroLang,
  KOKORO_PREFIX_LANGS,
  kokoroPhonemizerLang,
} from '../src/settings/vocab.js';

const WORKER = fileURLToPath(new URL('./kokoro_worker.py', import.meta.url));
const workerSrc = readFileSync(WORKER, 'utf8');

// --- the regression itself -------------------------------------------------

assert.ok(
  !KOKORO_LANGS.includes('fr'),
  'bare `fr` is not an espeak-ng voice — espeak-ng ships fr-fr/fr-be/fr-ch only (#1213)',
);
assert.ok(KOKORO_LANGS.includes('fr-fr'), 'French is still offered, as fr-fr');

// The auto-detect path is the half of #1213 the bug report missed: `ff_siwis`
// (the only French Kokoro voice) resolves its language from the prefix map, so
// French was broken even with the override left empty.
const prefixMap = Object.fromEntries(
  [...workerSrc.matchAll(/^\s{8}"([a-z])":\s*"([a-z-]+)",$/gm)].map(m => [m[1], m[2]]),
);
assert.equal(
  Object.keys(prefixMap).length,
  10,
  'parsed all 10 voice-prefix entries out of kokoro_worker.py',
);
assert.equal(prefixMap.f, 'fr-fr', 'the `f` (French) voice prefix auto-detects as fr-fr');

// --- the drift guard -------------------------------------------------------

// The worker's `lang not in lang_mapping.values()` guard means an override the
// worker doesn't know is dropped, not honoured. Keep the two sides identical.
assert.deepEqual(
  [...new Set(Object.values(prefixMap))].sort(),
  [...KOKORO_LANGS].sort(),
  'KOKORO_LANGS and kokoro_worker.py lang_mapping carry the same language codes',
);

// The TS copy of the prefix map decides whether the DJ prompt asks for
// `{English}` span marks (Polish voices only), so it must agree entry for entry.
assert.deepEqual({ ...KOKORO_PREFIX_LANGS }, prefixMap, 'KOKORO_PREFIX_LANGS mirrors the worker lang_mapping');
assert.equal(prefixMap.l, 'pl', 'the `l` (Polish) voice prefix auto-detects as pl');

// kokoroPhonemizerLang follows the worker: known override, else prefix, else en-gb.
assert.equal(kokoroPhonemizerLang('lm_mateusz', ''), 'pl');
assert.equal(kokoroPhonemizerLang('lm_mateusz', 'en-gb'), 'en-gb', 'an explicit override wins over the prefix');
assert.equal(kokoroPhonemizerLang('bf_isabella', 'pl'), 'pl');
assert.equal(kokoroPhonemizerLang('lm_mateusz', 'xx'), 'pl', 'an unknown override falls back to the prefix, as in the worker');
assert.equal(kokoroPhonemizerLang('ff_siwis', 'fr'), 'fr-fr', 'a legacy alias is canonicalised first');
assert.equal(kokoroPhonemizerLang('qq_unknown', ''), 'en-gb', 'unknown prefix -> British English, as in the worker');
assert.equal(kokoroPhonemizerLang(undefined, undefined), 'en-gb');

// --- legacy canonicalisation ----------------------------------------------

assert.equal(canonicalKokoroLang('fr'), 'fr-fr', 'stored `fr` upgrades to fr-fr');
assert.ok(
  KOKORO_LANG_RE.test(canonicalKokoroLang('fr')),
  'the canonicalised legacy code passes validation, so load() keeps it',
);
for (const lang of KOKORO_LANGS) {
  assert.equal(canonicalKokoroLang(lang), lang, `${lang} is already canonical`);
}
assert.equal(canonicalKokoroLang(''), '', 'empty (auto-detect) passes through untouched');
assert.equal(canonicalKokoroLang('xx'), 'xx', 'unknown codes pass through for the caller to reject');
assert.ok(!KOKORO_LANG_RE.test('xx'), 'and validation rejects them');

// Alias parity: the worker sees the same legacy value via the KOKORO_LANG env
// var, which never passes through the TS layer.
const workerAliases = Object.fromEntries(
  [...(workerSrc.match(/lang_aliases = \{([^}]*)\}/)?.[1] ?? '').matchAll(
    /"([a-z-]+)":\s*"([a-z-]+)"/g,
  )].map(m => [m[1], m[2]]),
);
assert.deepEqual(
  workerAliases,
  KOKORO_LANG_ALIASES,
  'KOKORO_LANG_ALIASES and the worker lang_aliases agree',
);

console.log('kokoro-lang: all assertions passed');
