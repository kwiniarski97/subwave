# Polish Kokoro voice (`lm_mateusz`)

Stock Kokoro has no Polish. A Polish voice needs two files that are **not**
bundled in the image:

| File | What it is |
|---|---|
| `kokoro-pl-v1.0.onnx` | Software Mansion's Polish Kokoro fine-tune (Apache-2.0), exported to ONNX with the same inputs as `kokoro-v1.0.onnx` |
| `voices-pl-v1.0.bin` | The stock `voices-v1.0.bin` (all 54 voices) plus `lm_mateusz`, the Polish voicepack from the same release |

The `l` prefix means Polish. `p` was already taken by Portuguese.

## Setup

1. Copy both files into the state directory, e.g. `state/kokoro/`.
2. Point the controller at them in the root `.env`:

   ```bash
   KOKORO_VOICES=/var/sub-wave/kokoro/voices-pl-v1.0.bin
   KOKORO_PL_MODEL=/var/sub-wave/kokoro/kokoro-pl-v1.0.onnx
   ```

3. `docker compose up -d --build controller`.
4. Give a persona the Kokoro engine and the voice `lm_mateusz` (Polish in the
   voice language list), and set its language to Polish so the DJ writes in Polish.

Polish voices use the Polish model; every other voice keeps the stock
`kokoro-v1.0.onnx`. The fine-tune can't simply replace the stock model: it
changes how the stock voices sound (they come out as different speakers). The
worker loads the Polish model on the first Polish line, so a station that
never speaks Polish pays nothing.

Without `KOKORO_PL_MODEL`, `lm_mateusz` falls back to the stock model. It stays
understandable but has a heavy foreign accent, and the worker logs a warning
once.

## English names in Polish lines

Polish letter rules mangle English titles: "Wish You Were Here" comes out as
something like *wish you a very hairy*. When the on-air voice resolves to Kokoro
speaking Polish, the DJ prompt asks the model to wrap English names in curly
braces:

> Teraz {Pink Floyd} i utwór {Wish You Were Here}.

The worker phonemizes each `{...}` span with espeak's English rules and the rest
with Polish rules. Mateusz then reads the whole line in **one** pass, in one
voice and with one intonation; only the pronunciation lookup changes per span.
On a 10-sentence test set, this raised the share of English title words a
speech recognizer understood from 74% to 89%.

The braces are TTS input only:

- every other engine has them stripped, including a rescue engine after Kokoro fails;
- the public session feed (booth drawer, player) shows the words without them;
- the admin booth log keeps them, which shows what the model actually wrote.

Keep English names uninflected ("nowy album zespołu {Radiohead}"). A Polish
ending glued to a span would be read as a separate word.

## Known limits

- **ź is pronounced as ż.** Kokoro's vocabulary has no `ʑ`, and the fine-tune
  was trained with it folded into `ʒ`.
- **Numbers and dates aren't inflected.** espeak reads "12 listopada" as
  *dwanaście*, not *dwunastego*.
- **Prosody is somewhat exaggerated.** The fine-tune's pitch range is about 50%
  wider than the speaker's own recordings.
