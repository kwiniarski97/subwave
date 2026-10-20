// A station ident never carries the episode's per-link brief or its source
// data, and an ident that runs on anyway is cut to its sentence allowance.
// Live case: a one-sentence ident handed an album brief and a sixteen-row
// tracklist read every track's running time after its ident.

import test from 'node:test';
import assert from 'node:assert/strict';
import { capSentences, stationIdPrompt } from '../src/llm/internal/prompts/scripts.js';
import { stationIdMaxSentences } from '../src/llm/internal/prompts/system.js';
import { preparationGrounding } from '../src/broadcast/show-preparation.js';

const editorial = '\n\nVerified episode subject: Ode to Io by Lowrider\nIn each link, share one fact.\n<episode-source-data>{"tracklist":[{"position":1,"title":"Caravan"}]}</episode-source-data>';

test('the ident prompt leaves the episode brief and its data out, and keeps the show line', () => {
  const prompt = stationIdPrompt({
    context: { episodeEditorial: editorial, activeShow: { name: 'The Album' } },
    persona: { name: 'Archiwista', scriptLength: 'concise' },
  });
  assert.doesNotMatch(prompt, /episode-source-data|In each link|Caravan/);
  assert.match(prompt, /The Album/);
  assert.match(prompt, /a 1-sentence station ident/);
});

test('capSentences keeps the first sentences and leaves short text alone', () => {
  const aired = 'Jesienne popołudnie w Polsce płynie z WIN Radio. Flat Earth, drugi numer na płycie, trwa pięć minut. Trzecia pozycja, Convoy V, trwa pięć minut.';
  assert.equal(capSentences(aired, 2), 'Jesienne popołudnie w Polsce płynie z WIN Radio. Flat Earth, drugi numer na płycie, trwa pięć minut.');
  assert.equal(capSentences('Tu WIN Radio.', 2), 'Tu WIN Radio.');
  assert.equal(capSentences('Siódmy jest Texas Pt. 1 & 2, najdłuższy. Koniec.', 1), 'Siódmy jest Texas Pt. 1 & 2, najdłuższy.');
  assert.equal(capSentences('Raz! „Dwa” trzy? Cztery.', 2), 'Raz! „Dwa” trzy?');
});

test('the ident allowance follows the persona\'s script length', () => {
  assert.equal(stationIdMaxSentences({ scriptLength: 'concise' }), 2);
  assert.equal(stationIdMaxSentences({ scriptLength: 'storyteller' }), 5);
  assert.equal(stationIdMaxSentences({}), 2, 'absent length is concise');
});

test('the album brief asks for one song per link and no running times', () => {
  const grounding = preparationGrounding({ subject: 'Ode to Io by Lowrider', data: {} } as any, 'restricted', [], 'album');
  assert.match(grounding, /one song per link, never read out the tracklist, and never state a song's running time/);
  assert.doesNotMatch(grounding, /title, position, length/);
});

test('an album-walk link names the track\'s place on the record, and a title track as such', async () => {
  const { albumPositionNote, linkPrompt } = await import('../src/llm/internal/prompts/scripts.js');
  const current = { title: 'Ode to Io (Remastered)', artist: 'Lowrider' };
  const album = 'Ode to Io (Remastered Deluxe Edition)';
  assert.equal(albumPositionNote(current, { index: 9, total: 16, album }),
    ' Track 10 of 16 on the album "Ode to Io (Remastered Deluxe Edition)". It is the title track: its name is the album\'s.');
  assert.match(albumPositionNote({ title: 'David William Hughes' }, { index: 15, total: 16, album }), /Track 16 of 16.*closing track/);
  assert.equal(albumPositionNote(current, null), '');
  assert.equal(albumPositionNote(current, { index: 16, total: 16 }), '', 'out of range says nothing');
  const prompt = linkPrompt({ current, context: {}, persona: { name: 'Archiwista' }, albumPosition: { index: 9, total: 16, album } });
  assert.match(prompt, /Ode to Io \(Remastered\) by Lowrider\. Track 10 of 16/);
  assert.doesNotMatch(linkPrompt({ current, context: {}, persona: { name: 'Archiwista' } }), /Track \d+ of/);
});

test('a sign-off keeps the episode research but is told the album may not have finished', async () => {
  const { signoffPrompt } = await import('../src/llm/internal/prompts/scripts.js');
  const { signoffEpisodeGrounding, SIGNOFF_EPISODE_RULE } = await import('../src/llm/internal/prompts/grounding.js');
  const editorial = preparationGrounding({ subject: 'Ode to Io (Remastered Deluxe Edition) by Lowrider', data: { tracklist: [{ position: 16, title: 'David William Hughes' }] } } as any, 'restricted', [], 'album');
  const prompt = signoffPrompt({ personaOut: { name: 'Archiwista' }, personaIn: { name: 'Ola' }, showOut: 'The Album', showIn: 'Długie Popołudnie', context: { episodeEditorial: editorial } });
  assert.match(prompt, /Verified episode subject: Ode to Io/);
  assert.ok(prompt.includes(SIGNOFF_EPISODE_RULE));
  assert.ok(prompt.indexOf(SIGNOFF_EPISODE_RULE) > prompt.indexOf('closing track'), 'the sign-off rule comes after the link brief it narrows');
  assert.equal(signoffEpisodeGrounding(''), '', 'no episode, no rule');
});
