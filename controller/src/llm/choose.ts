// services.choose: let a skill ask the station's model to pick one option.
// One structured call through the sdk primitive, under a hard deadline, with
// no retry loop of its own: the default provider is a slow homelab box, and a
// skill always has a non-model fallback (the album skill takes a random one).
// Answers an index, or null on anything else, and never throws.

import { z } from 'zod';
import { djObject, withDeadline } from './sdk.js';
import * as budget from '../broadcast/dj-budget.js';

const MAX_OPTIONS = 50;
const SYSTEM = 'You choose one option for a radio station. Answer with the zero-based index of the best option for the stated purpose.';
const schema = z.object({ index: z.number().int().describe('zero-based index of the chosen option') });

export function createChoose({ object, allowed, deadlineMs }: {
  object: (args: any) => Promise<any>;
  allowed: () => boolean;
  deadlineMs: number;
}) {
  return async function choose({ prompt, options }: { prompt: string; options: string[] }): Promise<number | null> {
    if (!Array.isArray(options) || options.length === 0) return null;
    if (options.length === 1) return 0;
    if (!allowed()) return null;
    const list = options.slice(0, MAX_OPTIONS).map((o, i) => `${i}. ${String(o).slice(0, 300)}`).join('\n');
    try {
      const out = await withDeadline(deadlineMs, 'services.choose', signal => object({
        system: SYSTEM,
        prompt: `${String(prompt).slice(0, 1000)}\n\nOptions:\n${list}`,
        schema, temperature: 0.3, maxOutputTokens: 256, kind: 'skillChoose', signal,
      }));
      const index = out?.index;
      return Number.isInteger(index) && index >= 0 && index < Math.min(options.length, MAX_OPTIONS) ? index : null;
    } catch {
      return null;
    }
  };
}

// Optional speech-adjacent work: paused at the soft budget tier, like links.
export const chooseOption = createChoose({ object: djObject, allowed: () => budget.optionalSegmentsAllowed(), deadlineMs: 15_000 });
