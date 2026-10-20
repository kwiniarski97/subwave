// Album of the day — the link writer sees what this episode's links already
// said in FULL (the 140-char recap cut the fact off the end of every line, and
// one Still Life episode credited Fredrik Nordström three links running), and
// a forced link may decline instead of repeating a fact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTempDir } from './test-utils/temp-dir.js';

process.env.STATE_DIR = createTempDir(join(tmpdir(), 'subwave-album-said-'));

const { albumEpisodeSaid, declinedAlbumLink, EPISODE_SAID_MAX } = await import('../src/broadcast/album-episode-policy.js');
const { linkPrompt } = await import('../src/llm/internal/prompts/scripts.js');

const LONG = 'Wracamy do Still Life zespołu Opeth, słuchając teraz drugiego utworu z tej płyty, zatytułowanego Godhead’s Lament. Przy nagrywaniu tego materiału za produkcję odpowiadali sami członkowie zespołu wraz z Fredrikiem Nordströmem.';
const start = Date.parse('2026-10-20T17:55:00Z');
const at = (min: number) => new Date(start + min * 60_000).toISOString();

test('aired links of this episode come back oldest first, untrimmed', () => {
  const memory = [ // promptMemory order: newest first
    { t: at(12), kind: 'link', message: LONG },
    { t: at(11), kind: 'hourly-check', message: 'Jest dwudziesta.' },
    { t: at(0), kind: 'link', message: 'Zaczynamy od The Moor.' },
    { t: at(-5), kind: 'link', message: 'Before the episode.' },
  ];
  assert.deepEqual(albumEpisodeSaid(memory, [], start), ['Zaczynamy od The Moor.', LONG]);
});

test('a written link still waiting for its seam counts, once', () => {
  const memory = [{ t: at(0), kind: 'link', message: 'Zaczynamy od The Moor.' }];
  assert.deepEqual(albumEpisodeSaid(memory, ['Zaczynamy od The Moor.', 'Benighted.', null], start), ['Zaczynamy od The Moor.', 'Benighted.']);
});

test('the list is bounded to the newest lines', () => {
  const memory = Array.from({ length: EPISODE_SAID_MAX + 5 }, (_, i) => ({ t: at(100 - i), kind: 'link', message: `line ${100 - i}` }));
  const said = albumEpisodeSaid(memory, [], start);
  assert.equal(said.length, EPISODE_SAID_MAX);
  assert.equal(said.at(-1), 'line 100');
});

test('only a bare SKIP declines', () => {
  assert.equal(declinedAlbumLink('SKIP'), true);
  assert.equal(declinedAlbumLink(' "skip." '), true);
  assert.equal(declinedAlbumLink('Skip to the fourth track, Moonlapse Vertigo.'), false);
  assert.equal(declinedAlbumLink(null), false);
});

test('the link prompt carries the full episode lines and the decline only when offered', () => {
  const current = { title: 'Moonlapse Vertigo', artist: 'Opeth' };
  const offered = linkPrompt({ current, albumPosition: { index: 3, total: 7, album: 'Still Life', said: [LONG], mayDecline: true } });
  assert.ok(offered.includes('Fredrikiem Nordströmem.'), 'the fact at the end of the line survives');
  assert.match(offered, /output exactly SKIP/);
  const plain = linkPrompt({ current, albumPosition: { index: 6, total: 7, album: 'Still Life', said: [LONG], mayDecline: false } });
  assert.doesNotMatch(plain, /SKIP/);
  assert.doesNotMatch(linkPrompt({ current }), /Already said in this album episode/);
});
