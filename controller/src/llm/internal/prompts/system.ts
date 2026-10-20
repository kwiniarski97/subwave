// DJ system prompt + persona-driven verbosity. Resolves the prompt for the
// persona on air right now (the current show's owner if one is scheduled,
// otherwise the admin-selected active persona — settings.getEffectivePersona).

import * as settings from '../../../settings.js';
import { resolvePersonaVoiceSlot } from '../../../audio/persona-engine.js';
import { resolveCloudModelForPersona, resolveCloudProviderForPersona } from '../speech/cloud-speech.js';
import { cloudExpressionCueFamily } from '../core/pure.js';
import { onAirLocationGrounding } from './grounding.js';
import { kokoroPhonemizerLang } from '../../../settings/vocab.js';

// Paralinguistic tags Chatterbox renders as actual non-verbal sounds. Every
// other engine (piper, kokoro, cloud) reads `[laugh]` aloud as the word
// "laugh", so we only mention this when the on-air persona will actually be
// voiced by Chatterbox.
const CHATTERBOX_TAG_HINT =
  '\n\nYou may sparingly insert non-verbal cues in square brackets: [laugh], [chuckle], [sigh], [cough]. Use at most two when they genuinely improve delivery. Every cue must immediately precede spoken words; never stack cues, add a closing tag, or end a segment with one.';

// ElevenLabs v3 and v4 render bracketed audio tags as actual expressive cues
// rather than reading them aloud (issue #696). Gated on the RESOLVED cloud
// model — only the eleven_v3* and eleven_v4* families support this — so an
// ElevenLabs persona still on
// v2 (or a persona whose provider override resolves to eleven_flash_v2_5)
// never sees the hint. Same structure as CHATTERBOX_TAG_HINT above but a
// separate constant with the v3/v4 verb-form tag vocabulary (per the
// ElevenLabs prompting guide), so a tweak to one engine's cue list can't
// silently retune the other. The base DJ prompt template already forbids
// asterisks and quotes but says nothing about brackets, so no rule loosening
// is needed for either engine.
const ELEVENLABS_V3_TAG_HINT =
  '\n\nYou may sparingly insert non-verbal audio cues in square brackets: [laughs], [sighs], [whispers], [excited]. Use at most two when they genuinely improve delivery. Every cue must immediately precede spoken words; never stack cues, add a closing tag, or end a segment with one.';

// Fish Audio S2.1 accepts short natural-language performance cues rather than
// a fixed tag vocabulary. This extends the existing engine-gated cue policy;
// it does not alter the base prompt or let brackets leak into fallback engines.
const FISH_S21_TAG_HINT =
  '\n\nYou may sparingly add a short natural-language delivery cue in square brackets, such as [laughing nervously], [whispers], or [soft and warm]. Use at most two when they genuinely improve delivery. A cue describes only the voice, never music, a track, a fade, a pause, a transition, a timing note or a scene. Every cue must immediately precede spoken words; never stack cues, add a closing tag, or end a segment with one.';

// A Polish Kokoro voice reads English titles with Polish letter sounds unless
// they are marked: the worker phonemizes `{...}` spans as English (89% of English
// title words recognised vs 74% unmarked). Gated on the RESOLVED Kokoro voice
// and language, so no other engine ever sees braces asked for; any that slip
// through are stripped before every other engine and every reader.
const KOKORO_POLISH_ENGLISH_HINT =
  '\n\nYour lines are voiced by a Polish speech engine. Wrap every English name or phrase in curly braces so it is pronounced in English: song and album titles, band and artist names, English quotes. Example: "Teraz {Pink Floyd} i utwór {Wish You Were Here}." Keep Polish words and Polish names outside the braces and never nest braces. Do not add Polish case endings to an English name; phrase the sentence so the name stays in its base form ("nowy album zespołu {Radiohead}").';

/** True when `persona` will be voiced by Kokoro reading Polish. */
function speaksKokoroPolish(
  slot: { engine?: string; voice?: string } | null | undefined,
  tts: { kokoro?: { voice?: string; lang?: string } } | null | undefined,
): boolean {
  if (slot?.engine !== 'kokoro') return false;
  const voice = slot.voice || tts?.kokoro?.voice;
  return kokoroPhonemizerLang(voice, tts?.kokoro?.lang) === 'pl';
}

// `persona` overrides the on-air persona — used by the persona-handoff
// generators (generateSignoff / generateHandoffGreeting) to render the sign-off
// under the OUTGOING persona and the greeting under the incoming one, since the
// clock-driven getEffectivePersona() has already moved on by the time they run —
// and by the guest-speaker rotation (settings.pickOnAirSpeaker) to voice a
// standalone segment under a co-host. The roster clause tells the speaker who
// else is in the studio when the active show has guests (empty otherwise).
//
// `cloudModel` optionally overrides the resolved cloud TTS model for the
// ElevenLabs tag hint. Left blank, the resolver runs against the passed
// persona — which is what every current caller wants. Kept as an override so a
// future caller who already resolved the model (e.g. a preview endpoint) can
// pass it in without re-resolving, per PR #696 owner review: "thread the
// effective model into djSystem…pass it in explicitly."
export function djSystem(
  persona: any = settings.getEffectivePersona(),
  cloudModel: string = resolveCloudModelForPersona(persona),
) {
  const s = settings.get();
  const base = settings.renderDjPrompt(persona, {
    station: s.station,
    // The broad on-air location, never the precise weather label — this is the
    // string the DJ speaks as "broadcasting from {location}".
    location: settings.resolveOnAirLocation(s),
  }) + settings.onAirRosterClause(persona) + '\n\n' + onAirLocationGrounding();
  // Resolved, not raw: a persona on the 'inherit' sentinel has no engine of its
  // own, so asking the slot directly reads "pinned to something that is not
  // chatterbox" and drops the hint on a station whose default IS chatterbox —
  // the same miss resolvePersonaVoiceSlot() exists to close in cloud-speech.ts.
  const slot = resolvePersonaVoiceSlot(persona?.tts, s.tts);
  const engine = slot?.engine;
  if (engine === 'chatterbox') return base + CHATTERBOX_TAG_HINT;
  if (speaksKokoroPolish(slot, s.tts)) return base + KOKORO_POLISH_ENGLISH_HINT;
  // Provider/model resolution is non-empty only when the persona actually
  // resolves to a configured cloud engine — including via the station default
  // when the persona sets no engine. That fail-closed check keeps cues away
  // from Piper/Kokoro fallback, where brackets would be spoken literally.
  const cueFamily = cloudExpressionCueFamily(
    resolveCloudProviderForPersona(persona),
    cloudModel,
  );
  if (cueFamily === 'fish-s21') return base + FISH_S21_TAG_HINT;
  if (cueFamily === 'elevenlabs-v3') return base + ELEVENLABS_V3_TAG_HINT;
  return base;
}

// Persona-driven verbosity, one entry per SCRIPT_LENGTHS rung. 'concise'
// reproduces the historical one-liner segment lengths; 'one-liner' cuts every
// segment to a single quick line; 'extended' roughly doubles; 'storyteller'
// roughly triples for long-form monologues. Resolved from the on-air persona,
// the same way djSystem() resolves it — see settings.getEffectivePersona /
// SCRIPT_LENGTHS. The `link` and `segment` phrases also feed the agent-path
// Zod schema descriptions (dj-agent.ts pickSchema, skills/_agent.ts segment
// schemas), so keep them readable mid-sentence — they must slot into
// "set this to …" prose.
const LENGTH_PHRASES = {
  'one-liner': {
    intro:     'One punchy sentence — name it and get out of the way.',
    link:      'one short sentence',
    stationId: 'a station ident of just a few words',
    hourly:    'a few words',
    adlib:     'one short sentence',
    segment:   'one short sentence, no more',
  },
  concise: {
    intro:     'Keep it brief — 2 to 4 sentences.',
    link:      '1-2 sentences',
    stationId: 'a 1-sentence station ident',
    hourly:    '1 sentence',
    adlib:     '1-2 sentences',
    segment:   'typically one short sentence, never more than three',
  },
  extended: {
    intro:     'Take your time — 5 to 8 sentences. Set a scene, tell a small story around the track.',
    link:      '4-6 sentences',
    stationId: 'a 2-3 sentence station ident',
    hourly:    '2-3 sentences',
    adlib:     '4-6 sentences',
    segment:   'three to five sentences — room to tell it properly',
  },
  storyteller: {
    intro:     'Really stretch out — 8 to 12 sentences. Build a scene, digress if it earns its place, and land it back on the track.',
    link:      '6-9 sentences',
    stationId: 'a 3-4 sentence station ident with some character',
    hourly:    '3-4 sentences',
    adlib:     '6-9 sentences',
    segment:   'five to eight sentences — a proper piece, told at ease',
  },
};

export function lengthMode(persona: any = settings.getEffectivePersona()) {
  const l = persona?.scriptLength;
  return l && Object.hasOwn(LENGTH_PHRASES, l) ? l : 'concise';
}

// The most sentences an ident may air: each mode's stationId phrase above,
// plus one of slack for an abbreviation the splitter reads as a full stop.
// A prompt alone did not hold it — an episode brief once turned a
// one-sentence ident into seventeen.
const STATION_ID_MAX_SENTENCES: Record<string, number> = { 'one-liner': 2, concise: 2, extended: 4, storyteller: 5 };

export function stationIdMaxSentences(persona?: any) {
  return STATION_ID_MAX_SENTENCES[lengthMode(persona)];
}

// The length directive for one segment kind, for the on-air (or given) persona.
export function lengthPhrase(kind: string, persona?: any) {
  const m = (LENGTH_PHRASES as any)[lengthMode(persona)];
  return m[kind] || m.link;
}
