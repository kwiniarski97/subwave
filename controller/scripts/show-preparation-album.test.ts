// Album of the day — the preparation result's album music type, and (Task 5)
// how a prepared album's music stops steering selection once its walk is done.

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparationResultSchema } from '../src/schemas/show-preparation.js';

test('an album result parses, and an artist result is unchanged', () => {
  const album = preparationResultSchema.parse({ available: true, subject: 'Blue Train by John Coltrane', data: null, music: { type: 'album', albumId: ' al-1 ' } });
  assert.deepEqual(album.available && album.music, { type: 'album', albumId: 'al-1' });
  const artist = preparationResultSchema.parse({ available: true, subject: 'Air', data: null, music: { type: 'artist', artistId: 'ar-1' } });
  assert.deepEqual(artist.available && artist.music, { type: 'artist', artistId: 'ar-1' });
});

test('an album without an id, or an unknown music type, is refused', () => {
  assert.equal(preparationResultSchema.safeParse({ available: true, subject: 'x', music: { type: 'album' } }).success, false);
  assert.equal(preparationResultSchema.safeParse({ available: true, subject: 'x', music: { type: 'album', albumId: '  ' } }).success, false);
  assert.equal(preparationResultSchema.safeParse({ available: true, subject: 'x', music: { type: 'playlist', playlistId: 'p' } }).success, false);
  assert.equal(preparationResultSchema.safeParse({ available: true, subject: 'x', music: { type: 'artist', albumId: 'a' } }).success, false);
});
