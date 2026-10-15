// Album of the day — the station services the skill builds on: Navidrome's
// random album shape, and choose(), one bounded model call that answers an
// index or null and never throws.

import test from 'node:test';
import assert from 'node:assert/strict';
import { toRandomAlbum } from '../src/music/random-albums.js';
import { createChoose } from '../src/llm/choose.js';

test('a Navidrome album maps to the skill shape', () => {
  assert.deepEqual(toRandomAlbum({ id: 'al', name: 'Record', artist: 'Band', year: 2001, originalReleaseDate: { year: 1999 }, genre: 'Jazz', songCount: 9, duration: 2400, isCompilation: false }),
    { id: 'al', name: 'Record', artist: 'Band', year: 1999, genre: 'Jazz', songCount: 9, duration: 2400, isCompilation: false });
  assert.equal(toRandomAlbum({ id: 'c', name: 'Hits', releaseTypes: ['Compilation'] })?.isCompilation, true);
  assert.deepEqual(toRandomAlbum({ id: 'g', name: 'X', genres: [{ name: 'Soul' }] }), { id: 'g', name: 'X', artist: '', year: null, genre: 'Soul', songCount: 0, duration: 0, isCompilation: false });
  assert.equal(toRandomAlbum({ name: 'no id' }), null);
  assert.equal(toRandomAlbum(null), null);
});

function chooser(object: (args: any) => Promise<any>, allowed = true) {
  const calls: any[] = [];
  const choose = createChoose({ object: async args => { calls.push(args); return object(args); }, allowed: () => allowed, deadlineMs: 50 });
  return { choose, calls };
}

test('a valid index is returned; the options reach the prompt numbered', async () => {
  const { choose, calls } = chooser(async () => ({ index: 1 }));
  assert.equal(await choose({ prompt: 'Pick', options: ['A', 'B', 'C'] }), 1);
  assert.match(calls[0].prompt, /0\. A\n1\. B\n2\. C/);
});

test('no model call for zero or one option', async () => {
  const { choose, calls } = chooser(async () => ({ index: 0 }));
  assert.equal(await choose({ prompt: 'p', options: [] }), null);
  assert.equal(await choose({ prompt: 'p', options: ['only'] }), 0);
  assert.equal(calls.length, 0);
});

test('null on budget, a bad index, a throw, or the deadline', async () => {
  assert.equal(await chooser(async () => ({ index: 0 }), false).choose({ prompt: 'p', options: ['a', 'b'] }), null);
  assert.equal(await chooser(async () => ({ index: 7 })).choose({ prompt: 'p', options: ['a', 'b'] }), null);
  assert.equal(await chooser(async () => ({ index: 0.5 })).choose({ prompt: 'p', options: ['a', 'b'] }), null);
  assert.equal(await chooser(async () => { throw new Error('down'); }).choose({ prompt: 'p', options: ['a', 'b'] }), null);
  assert.equal(await chooser(() => new Promise(() => {})).choose({ prompt: 'p', options: ['a', 'b'] }), null);
});
