// Which PocketTTS model voices a persona, from its free-text `language`.
// The worker (pocket_tts_worker.py LANGUAGE_MODELS) owns what each key loads.
// Lives in schemas/ so the admin UI resolves a persona exactly as the engine does.

// "Türkçe" → "turkce": lowercase, strip combining marks, collapse whitespace.
// The one fold for a free-text language, shared with audio/preview-text.ts.
export function normalizeLanguage(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const POCKET_TTS_LANGUAGES = [
  'english', 'polish', 'french', 'german', 'italian', 'spanish', 'portuguese', 'dutch',
] as const;

export type PocketTtsLanguage = typeof POCKET_TTS_LANGUAGES[number];

// Keys pass through normalizeLanguage, so list them as an operator types them.
const KEYS: Record<PocketTtsLanguage, string[]> = {
  english: ['english', 'en', 'en-gb', 'en-us'],
  polish: ['polish', 'polski', 'pl', 'pl-pl'],
  french: ['french', 'français', 'fr', 'fr-fr'],
  german: ['german', 'deutsch', 'de', 'de-de'],
  italian: ['italian', 'italiano', 'it', 'it-it'],
  spanish: ['spanish', 'español', 'castellano', 'es', 'es-es'],
  portuguese: ['portuguese', 'português', 'brazilian portuguese', 'pt', 'pt-br', 'pt-pt'],
  dutch: ['dutch', 'nederlands', 'nl', 'nl-nl'],
};

const LOOKUP = new Map<string, PocketTtsLanguage>();
for (const lang of POCKET_TTS_LANGUAGES) {
  for (const key of KEYS[lang]) LOOKUP.set(normalizeLanguage(key), lang);
}

// '' (no language) leaves the choice to the worker's POCKET_TTS_DEFAULT_LANGUAGE:
// jingles carry no persona language, and on a Polish station they must not be
// forced English. A language with no PocketTTS model keeps English, which is
// what every line used before routing existed.
export function pocketTtsLanguage(raw?: string | null): PocketTtsLanguage | '' {
  if (typeof raw !== 'string') return '';
  const folded = normalizeLanguage(raw);
  if (!folded) return '';
  return LOOKUP.get(folded) ?? 'english';
}

// Languages served by a community fine-tune rather than an official kyutai
// model. The built-in voices are precomputed for the official weights, so here
// they are re-cloned from English source clips: a persona wants its own clip.
export const POCKET_TTS_CLONE_ONLY_LANGUAGES: readonly PocketTtsLanguage[] = ['polish'];
