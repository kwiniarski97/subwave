#!/usr/bin/env python3
"""Pure-logic tests for pocket_tts_worker's language routing.

No torch / pocket-tts — importing the worker only runs its module-level env
reads, never main(), and the model is a fake. Runs with a plain python3:

    python3 controller/scripts/test_pocket_tts_language.py

Driven by scripts/analyzer-python.test.ts. Exits non-zero on the first failure.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pocket_tts_worker as w  # noqa: E402

FAILS = []


def check(name, cond):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        FAILS.append(name)


# --- resolve_language -------------------------------------------------------
check("polish key routes to polish", w.resolve_language("polish") == "polish")
check("key is case/space tolerant", w.resolve_language(" Polish ") == "polish")
check("empty means the default", w.resolve_language("") == w.DEFAULT_LANGUAGE)
check("None means the default", w.resolve_language(None) == w.DEFAULT_LANGUAGE)
check("unknown key means the default", w.resolve_language("klingon") == w.DEFAULT_LANGUAGE)
saved = w.DEFAULT_LANGUAGE
w.DEFAULT_LANGUAGE = "polish"
check("a Polish default voices jingles in Polish", w.resolve_language("") == "polish")
w.DEFAULT_LANGUAGE = saved

# --- the table ----------------------------------------------------------------
check("english stays on the 2.x default model",
      w.LANGUAGE_MODELS["english"] == {"language": "english_2026-04"})
check("polish loads the pinned fine-tune config",
      w.LANGUAGE_MODELS["polish"]["config"].startswith("hf://shefowl/pocket-tts-polish-6l/config.yaml@"))


# --- load_language_model ------------------------------------------------------
class FakeTTSModel:
    calls = []
    reject_language_kwarg = False

    @classmethod
    def load_model(cls, **kwargs):
        cls.calls.append(kwargs)
        if cls.reject_language_kwarg and kwargs:
            raise TypeError("load_model() got an unexpected keyword argument")
        return ("model", tuple(sorted(kwargs.items())))


FakeTTSModel.calls = []
w.load_language_model(FakeTTSModel, "polish")
check("polish passes its config", "config" in FakeTTSModel.calls[-1])
check("no quantize unless asked", "quantize" not in FakeTTSModel.calls[-1])

w.QUANTIZE = True
w.load_language_model(FakeTTSModel, "english")
check("POCKET_TTS_QUANTIZE adds quantize=True", FakeTTSModel.calls[-1].get("quantize") is True)
w.QUANTIZE = False

FakeTTSModel.reject_language_kwarg = True
FakeTTSModel.calls = []
got = w.load_language_model(FakeTTSModel, "english")
check("an old pocket-tts still loads English bare", FakeTTSModel.calls[-1] == {} and got is not None)
try:
    w.load_language_model(FakeTTSModel, "polish")
    check("an old pocket-tts refuses Polish loudly", False)
except TypeError:
    check("an old pocket-tts refuses Polish loudly", True)
FakeTTSModel.reject_language_kwarg = False

# --- ModelPool ----------------------------------------------------------------
loads = []


def loader(key):
    loads.append(key)
    if key == "broken":
        raise RuntimeError("download failed")
    return f"model-{key}"


pool = w.ModelPool(loader)
check("pool loads on first use", pool.get("polish") == "model-polish")
pool.get("polish")
check("pool keeps a loaded model resident", loads.count("polish") == 1)
for attempt in range(2):
    try:
        pool.get("broken")
    except RuntimeError:
        pass
check("a failed load is retried on the next line", loads.count("broken") == 2)


# --- voice_prompt_state -------------------------------------------------------
class FakeModel:
    def __init__(self, custom):
        self.custom = custom
        self.prompts = []

    def get_state_for_audio_prompt(self, key):
        self.prompts.append(key)
        if self.custom and not key.endswith(".wav"):
            raise ValueError("Predefined voice is a state precomputed with the released weights")
        return f"state:{key}"


origins = {"alba": "hf://kyutai/tts-voices/alba-mackenna/casual.wav"}
official = FakeModel(custom=False)
check("official model uses the built-in state",
      w.voice_prompt_state(official, "alba", origins) == "state:alba")
custom = FakeModel(custom=True)
check("custom model clones a built-in from its source wav",
      w.voice_prompt_state(custom, "alba", origins) == "state:" + origins["alba"])
check("a reference wav goes straight through",
      w.voice_prompt_state(custom, "/voices/piotr.wav", origins) == "state:/voices/piotr.wav")
try:
    w.voice_prompt_state(custom, "nobody", origins)
    check("an unknown voice on a custom model still raises", False)
except ValueError:
    check("an unknown voice on a custom model still raises", True)

if FAILS:
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1)
print("\nall passed")
