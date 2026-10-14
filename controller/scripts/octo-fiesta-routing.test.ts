// octo-fiesta routing: an `ext-<provider>-song-<id>` id is a song octo-fiesta
// offers but Navidrome does not hold, so every id-keyed URL for one (stream,
// raw stream, cover art) must be built against OCTO_FIESTA_URL. Everything
// else stays on Navidrome — the station's library is never widened.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const stateRoot = mkdtempSync(join(tmpdir(), 'subwave-octo-routing-'));
process.env.STATE_DIR = stateRoot;
process.env.NAVIDROME_URL = 'http://navidrome.test:4533';
process.env.NAVIDROME_USER = 'fixture';
process.env.NAVIDROME_PASS = 'fixture-secret';
process.env.OCTO_FIESTA_URL = 'http://octo.test:5274/';

const subsonic = await import('../src/music/subsonic.js');

test.after(() => rmSync(stateRoot, { recursive: true, force: true }));

const EXT = 'ext-deezer-song-3135556';

function origin(uri: string): string {
  return new URL(uri.replace(/^subhttp:/, '')).origin;
}

test('an ext- song streams from octo-fiesta', () => {
  assert.equal(origin(subsonic.getStreamUrl(EXT)), 'http://octo.test:5274');
  assert.equal(origin(subsonic.getRawStreamUrl(EXT)), 'http://octo.test:5274');
  const url = new URL(subsonic.getRawStreamUrl(EXT));
  assert.equal(url.pathname, '/rest/stream');
  assert.equal(url.searchParams.get('id'), EXT);
});

test('an ext- song takes its cover art from octo-fiesta', () => {
  assert.equal(origin(subsonic.getCoverArtUrl(EXT)), 'http://octo.test:5274');
});

test('an ext- song keeps the probe fragment on its subhttp URI', () => {
  assert.match(subsonic.getStreamUrl(EXT, 'p1'), /#subwave_probe=p1$/);
});

test('library ids stay on Navidrome', () => {
  for (const id of ['a1b2c3d4e5', 'ext', 'extended-mix-1', 'next-deezer-song-1']) {
    assert.equal(origin(subsonic.getStreamUrl(id)), 'http://navidrome.test:4533', id);
    assert.equal(origin(subsonic.getCoverArtUrl(id)), 'http://navidrome.test:4533', id);
  }
});

test('an ext- album or artist id is not routed — only songs reach these URLs', () => {
  assert.equal(origin(subsonic.getCoverArtUrl('ext-deezer-album-1')), 'http://navidrome.test:4533');
});
