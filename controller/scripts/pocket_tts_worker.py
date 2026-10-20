#!/usr/bin/env python3
"""
PocketTTS worker — line-protocol child process.

The Node side (controller/src/audio/pocketTts.ts) spawns this once and keeps
it alive: kyutai-labs/pocket-tts loads a ~100M-param model on first call and
caching it across requests turns ~6x real-time inference into the actual cost
per line. Protocol mirrors kokoro_worker.py and chatterbox_worker.py — one
JSON object per line over stdin/stdout.

Request:  {"id": "...", "text": "...", "voice": "alba",
           "reference_wav": "/path/to/ref.wav",  # optional, empty = built-in
           "language": "polish",                 # optional, empty = default
           "out": "/path/to.wav"}
Response: {"id": "...", "ok": true,  "path": "/path/to.wav", "duration_s": 3.4}
       |  {"id": "...", "ok": false, "error": "..."}

Voice selection (issue #213):
  - "voice" only (built-in id like alba, anna, charles, estelle, giovanni,
    juergen, lola, rafael) → curated voice plays directly.
  - "reference_wav" set     → zero-shot cloning from the WAV. The base voice
    is still passed so the model has a speaker prior if the reference load
    fails — the worker logs the failure and falls back instead of erroring.

Language routing: "language" is a key from the controller's
schemas/pocket-tts.ts and picks a MODEL (LANGUAGE_MODELS below). One
model per language stays resident; the default language loads at boot, the
others on their first line. An empty or unknown key means
POCKET_TTS_DEFAULT_LANGUAGE (default "english"), which is also what jingles get.

The model is bundled into the controller image only when it is built with
`--build-arg WITH_POCKETTTS=1` (see docker/Dockerfile.controller). Weights live
under the Hugging Face cache (HF_HOME), pre-warmed at image build time.
"""

import json
import os
import sys
import traceback

DEFAULT_VOICE = os.environ.get("POCKET_TTS_VOICE", "alba")

# int8 weights: faster on CPU and about half the RAM, for a small accuracy cost
# (pocket-tts measures ~27% faster on x86). Off by default
# so an upgrade renders the same audio.
QUANTIZE = os.environ.get("POCKET_TTS_QUANTIZE", "").strip().lower() in ("1", "true", "yes", "on")


def _env_max_tokens(name, default):
    """A positive int from env, else the default — a typo never wedges the worker."""
    try:
        value = int(os.environ.get(name, "").strip())
    except ValueError:
        return default
    return value if value > 0 else default


def _env_float(name, default):
    """A float from env, else the default — a typo never wedges the worker."""
    try:
        return float(os.environ.get(name, "").strip())
    except ValueError:
        return default


# What each language key loads, as load_model() kwargs. English is pinned to
# english_2026-04, the default of the pocket-tts 2.x this sidecar used to ship,
# so the newer package does not change the voice of an existing English station.
# Polish is a community fine-tune (CC-BY-4.0), pinned to a reviewed revision.
LANGUAGE_MODELS = {
    "english": {"language": os.environ.get("POCKET_TTS_ENGLISH_MODEL") or "english_2026-04"},
    # eos_threshold -2 (pocket-tts default -4): the fine-tune declares a chunk
    # finished before its last words. Higher holds it open; at 0 renders began
    # to run on. See GENERATE_OPTIONS for the other half of the fix.
    "polish": {
        "config": os.environ.get("POCKET_TTS_POLISH_CONFIG") or (
            "hf://shefowl/pocket-tts-polish-6l/config.yaml@cd9047ee2fc9d1eb40ed38673d8b220485713863"
        ),
        "eos_threshold": _env_float("POCKET_TTS_POLISH_EOS_THRESHOLD", -2.0),
    },
    "french": {"language": "french"},
    "german": {"language": "german"},
    "italian": {"language": "italian"},
    "spanish": {"language": "spanish"},
    "portuguese": {"language": "portuguese"},
    "dutch": {"language": "dutch"},
}


# Per-language generate_audio() kwargs. pocket-tts packs sentences into chunks
# of up to 50 tokens; the 6-layer Polish fine-tune ends a long chunk early and
# drops its tail. Polish BPE spends ~2 tokens a word, so 15 splits at every
# comma — one clause per chunk. Measured with Whisper over 5 renders of two
# on-air lines: 15 tokens + eos -2 dropped 1 and 9 words, the stock 50/-4 several
# per render. Neither lever alone gets there and nothing tried reaches zero.
# Languages absent here keep pocket-tts's own default.
GENERATE_OPTIONS = {
    "polish": {"max_tokens": _env_max_tokens("POCKET_TTS_POLISH_MAX_TOKENS", 15)},
}


def generate_options(key):
    return dict(GENERATE_OPTIONS.get(key, {}))


_default = (os.environ.get("POCKET_TTS_DEFAULT_LANGUAGE") or "english").strip().lower()
DEFAULT_LANGUAGE = _default if _default in LANGUAGE_MODELS else "english"


def resolve_language(requested):
    """The LANGUAGE_MODELS key a request runs on: its own when known, else the
    default. Never raises — an unknown key is a newer controller, not an error."""
    key = (requested or "").strip().lower()
    return key if key in LANGUAGE_MODELS else DEFAULT_LANGUAGE


def load_language_model(TTSModel, key):
    """Load one language's model. A pocket-tts too old to know the `language`
    argument (TypeError) still loads its default English model, as before."""
    kwargs = dict(LANGUAGE_MODELS[key])
    if QUANTIZE:
        kwargs["quantize"] = True
    try:
        return TTSModel.load_model(**kwargs)
    except TypeError:
        if key != "english":
            raise
        return TTSModel.load_model()


class ModelPool:
    """One resident model per language, loaded on first use. A language whose
    model fails to load raises for that line only — the controller's rescue
    voice takes it — and is retried on the next line."""

    def __init__(self, loader):
        self._loader = loader
        self._models = {}

    def get(self, key):
        model = self._models.get(key)
        if model is None:
            model = self._loader(key)
            self._models[key] = model
        return model


def predefined_voice_origins():
    """Built-in voice name → its source .wav, or {} on a pocket-tts without it."""
    try:
        from pocket_tts.utils.utils import _ORIGINS_OF_PREDEFINED_VOICES
        return dict(_ORIGINS_OF_PREDEFINED_VOICES)
    except Exception:
        return {}


def voice_prompt_state(model, key, origins):
    """get_state_for_audio_prompt(key), except that a built-in voice NAME on a
    non-official model (the Polish fine-tune) is refused by pocket-tts — its
    precomputed state belongs to the released weights. Cloning that voice from
    its source .wav instead is what pocket-tts itself does for custom models."""
    try:
        return model.get_state_for_audio_prompt(key)
    except ValueError:
        origin = origins.get(key)
        if not origin:
            raise
        return model.get_state_for_audio_prompt(origin)


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg):
    # Anything on stderr is captured by the Node parent as plain log lines.
    sys.stderr.write(f"[pocket-tts-worker] {msg}\n")
    sys.stderr.flush()


def main():
    try:
        from pocket_tts import TTSModel
        import scipy.io.wavfile as wavfile
    except Exception as e:
        emit({"id": None, "ok": False, "fatal": True, "error": f"import failed: {e}"})
        sys.exit(1)

    def loader(key):
        log(f"loading TTSModel for {key!r}{' (int8)' if QUANTIZE else ''}")
        return load_language_model(TTSModel, key)

    pool = ModelPool(loader)
    origins = predefined_voice_origins()

    # The default language loads before "ready", exactly as the single model
    # used to; a failure here is still fatal, since every jingle needs it.
    try:
        model = pool.get(DEFAULT_LANGUAGE)
    except Exception as e:
        emit({"id": None, "ok": False, "fatal": True, "error": f"model load failed: {e}"})
        sys.exit(1)

    # Voice cloning lives behind the GATED kyutai/pocket-tts weights. Loaded
    # without an HF token (the default for an image built with no credentials —
    # issue #238), pocket-tts silently falls back to the open
    # "without-voice-cloning" weights and sets has_voice_cloning=False. In that
    # mode get_state_for_audio_prompt(<a .wav path>) raises VOICE_CLONING_
    # UNSUPPORTED, so a persona's cloned reference can never take effect — it
    # silently reverts to a built-in voice. Detect the capability once up front
    # so we can (a) advertise it in the ready message and (b) short-circuit
    # clone requests with a precise reason instead of a generic stack trace.
    has_voice_cloning = bool(getattr(model, "has_voice_cloning", True))
    if has_voice_cloning:
        log("voice cloning available")
    else:
        log(
            "voice cloning UNAVAILABLE — loaded without the gated kyutai/pocket-tts "
            "weights. Built-in voices work; cloned .wav references will fall back to "
            "a built-in voice. Set HF_TOKEN (and accept the model terms on Hugging "
            "Face) to enable cloning."
        )

    # get_state_for_audio_prompt() does meaningful work (loads the speaker
    # embedding) — cache per voice id so repeat lines don't pay it again.
    # Reference-WAV clones cache under their absolute path; built-in ids
    # cache under their id, so the two namespaces never collide. A state is
    # computed by one model, so the cache is per language too.
    voice_states = {}

    def voice_state(lang, model, key):
        st = voice_states.get((lang, key))
        if st is None:
            st = voice_prompt_state(model, key, origins)
            voice_states[(lang, key)] = st
        return st

    log("ready")
    emit({"id": None, "ready": True, "voice_cloning": has_voice_cloning})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            text = (req.get("text") or "").strip()
            if not text:
                raise ValueError("empty text")
            voice = req.get("voice") or DEFAULT_VOICE
            ref = (req.get("reference_wav") or "").strip()
            out = req.get("out")
            if not out:
                raise ValueError("missing 'out' path")
            lang = resolve_language(req.get("language"))
            # Raises when this language's model cannot load: the line fails
            # and the controller's rescue voice speaks it, rather than the
            # English model reading Polish.
            model = pool.get(lang)
            # Cloning is a property of each model's weights; the Polish
            # fine-tune is open, English needs the gated weights (#238).
            has_voice_cloning = bool(getattr(model, "has_voice_cloning", True))

            # Resolve the speaker state, tracking whether the operator's chosen
            # voice/clone was actually honoured. fell_back=True means the
            # rendered audio is NOT the requested voice; the controller logs
            # that loudly and surfaces it in /debug so a silently-substituted
            # voice (issue #238) is visible instead of looking like a no-op.
            state = None
            fell_back = False
            fell_back_reason = None
            voice_used = voice
            if ref:
                # Prefer a reference WAV when one is supplied — but cloning needs
                # the gated weights (see has_voice_cloning above). Short-circuit
                # with a precise reason rather than letting get_state_for_audio_
                # prompt() raise VOICE_CLONING_UNSUPPORTED.
                if not has_voice_cloning:
                    fell_back = True
                    fell_back_reason = (
                        "voice cloning unavailable (model loaded without cloning "
                        "weights; set HF_TOKEN to enable)"
                    )
                    log(f"reference_wav {ref!r} ignored: {fell_back_reason}; using {voice!r}")
                elif not os.path.exists(ref):
                    fell_back = True
                    fell_back_reason = f"reference_wav not found: {ref}"
                    log(f"{fell_back_reason}; falling back to {voice!r}")
                else:
                    try:
                        state = voice_state(lang, model, ref)
                        voice_used = ref
                    except Exception as e:
                        fell_back = True
                        fell_back_reason = f"reference_wav failed: {e}"
                        log(f"reference_wav {ref!r} failed ({e}); falling back to {voice!r}")
            if state is None:
                try:
                    state = voice_state(lang, model, voice)
                    voice_used = voice
                except Exception as e:
                    # Unknown / unfetchable voice id — fall back to the default
                    # rather than 500 the request, mirroring how chatterbox
                    # falls back to its built-in voice when a reference is
                    # missing. Record it so the substitution stays visible.
                    if not fell_back:
                        fell_back = True
                        fell_back_reason = f"voice {voice!r} failed: {e}"
                    log(f"voice {voice!r} failed ({e}); using default {DEFAULT_VOICE!r}")
                    voice = DEFAULT_VOICE
                    state = voice_state(lang, model, voice)
                    voice_used = voice

            audio = model.generate_audio(state, text, **generate_options(lang))
            # generate_audio returns a torch tensor; coerce to a numpy float32
            # array in roughly [-1, 1].
            if hasattr(audio, "numpy"):
                audio = audio.numpy()
            import numpy as np
            audio = np.asarray(audio, dtype=np.float32)
            # Loudness. PocketTTS is the operator's chosen on-air voice and was
            # perceived quiet on the (ducked) music bed, so we drive it
            # deliberately hot: RMS-normalize to a high target, then soft-limit
            # peaks instead of hard-clipping — so the louder level never chops
            # into harsh clipping. POCKET_TTS_TARGET_RMS tunes it without a code
            # change (0.245 linear ≈ -12.2 dBFS RMS, ~+2 dB over the old -14.3).
            target_rms = float(os.environ.get("POCKET_TTS_TARGET_RMS", "0.245"))
            rms = float(np.sqrt(np.mean(audio * audio))) if audio.size else 0.0
            if rms > 0:
                audio = audio * (target_rms / rms)
            # Soft-knee limiter: transparent below `knee`, then tanh-shaped up to
            # `ceiling` (~-0.26 dBFS). Tames the hotter signal's peaks smoothly
            # and adds a touch of presence, where a hard clip would distort.
            knee, ceiling = 0.70, 0.97
            mag = np.abs(audio)
            over = mag > knee
            audio[over] = np.sign(audio[over]) * (
                knee + (ceiling - knee) * np.tanh((mag[over] - knee) / (ceiling - knee))
            )
            # Save as 16-bit PCM (matches the other engines' output format).
            audio_i16 = (audio * 32767.0).astype(np.int16)
            sample_rate = int(getattr(model, "sample_rate", 24000))
            wavfile.write(out, sample_rate, audio_i16)

            duration = float(len(audio)) / float(sample_rate)
            emit({
                "id": req_id, "ok": True, "path": out,
                "duration_s": round(duration, 3),
                "voice_used": voice_used,
                "fell_back": fell_back,
                "fell_back_reason": fell_back_reason,
            })
        except Exception as e:
            log(f"request failed: {e}\n{traceback.format_exc()}")
            emit({"id": req_id, "ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
