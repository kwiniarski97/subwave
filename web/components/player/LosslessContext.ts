'use client';

// The listener's Lossless switch, provided by PlayerCore and read by the
// Appearance menu. Its own module so the admin's menu, which has no player,
// doesn't pull PlayerCore into its bundle; and its own context, outside the
// skin contract, because no skin draws it.

import { createContext, useContext } from 'react';

export interface LosslessOption {
  /** Station serves `/stream.flac` and this browser can decode it. */
  available: boolean;
  on: boolean;
  /** Persists the choice and re-tunes a playing stream at once. */
  setOn: (on: boolean) => void;
}

export const LosslessContext = createContext<LosslessOption | null>(null);

/** null outside a player (the admin's Appearance menu). */
export function useLosslessOption(): LosslessOption | null {
  return useContext(LosslessContext);
}
