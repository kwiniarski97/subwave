// Persisted Lossless switch from the Appearance menu. This browser's choice,
// not the station's, so it lives in localStorage like the volume (#783).
//
// Reads/writes are effect-only, never during render, so there's no hydration
// mismatch: the player tunes MP3 on first paint and picks this up a tick later.

const STORAGE_KEY = 'subwave-lossless';

/** False when unset, unreadable or on the server. */
export function loadLosslessPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Off removes the key: unset and the default are the same thing. Storage
 *  failures are swallowed; playback is unaffected. */
export function saveLosslessPref(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, 'on');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode / quota — non-fatal */ }
}
