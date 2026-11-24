// Human-readable log of every track that went to air, one line per play, at
// ${STATE_DIR}/logs/played-YYYY-MM.log (UTC month). It exists to eyeball and
// grep repeats: each line carries how long ago the same track last aired and
// how many times it has aired before, read from library.db `plays` before the
// new row lands. The DB and the `track.play` event remain the records of truth;
// this is a convenience view, so it is never pruned (a busy station writes
// ~1.5 MB a month) and never read back by the controller.
//
// Best-effort: appendPlayedLine swallows its own errors and never throws.

import { appendFile, mkdir } from 'node:fs/promises';
import { STATE_DIR } from '../config.js';

export interface PlayedLineInput {
  playedAt: string;           // ISO-8601
  title: string | null;
  artist: string | null;
  album: string | null;
  trackId: string | null;
  source: string | null;
  requestedBy: string | null;
  showName: string | null;
  previous: { playedAt: string; count: number } | null;
}

// "3d 4h", "2h 05m", "12m", "40s": coarse on purpose, the gap is what matters.
export function formatGap(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

const clean = (v: string | null | undefined) => (v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

// One tab-separated line: time, artist — title, album, source, show, repeat
// note, id. Tabs keep it `cut`/`awk`-friendly while still reading by eye.
export function formatPlayedLine(p: PlayedLineInput): string {
  const at = Date.parse(p.playedAt);
  const prevAt = p.previous ? Date.parse(p.previous.playedAt) : NaN;
  const repeat = p.previous
    ? `REPEAT #${p.previous.count + 1}, last ${formatGap(at - prevAt)} ago (${p.previous.playedAt})`
    : 'first play';
  const source = clean(p.source) || '?';
  return [
    Number.isFinite(at) ? new Date(at).toISOString() : clean(p.playedAt),
    `${clean(p.artist) || 'unknown'} — ${clean(p.title) || 'untitled'}`,
    clean(p.album) || '-',
    p.requestedBy ? `${source}:${clean(p.requestedBy)}` : source,
    clean(p.showName) || '-',
    repeat,
    clean(p.trackId) || '-',
  ].join('\t') + '\n';
}

const LOGS_DIR = `${STATE_DIR}/logs`;

export function playedLogPath(now = new Date()): string {
  return `${LOGS_DIR}/played-${now.toISOString().slice(0, 7)}.log`;
}

// One chain for every append, so two plays fired together (a boot backfill, a
// test) land in the order they were called; concurrent appendFiles may not.
let chain: Promise<unknown> = mkdir(LOGS_DIR, { recursive: true }).catch(() => {});

export function appendPlayedLine(p: PlayedLineInput): Promise<void> {
  let line: string;
  try { line = formatPlayedLine(p); } catch { return Promise.resolve(); }
  const next = chain.then(() => appendFile(playedLogPath(), line)).catch(() => {
    // Logging must never break a broadcast.
  });
  chain = next;
  return next;
}
