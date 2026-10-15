---
name: outside-the-crate
label: Outside the crate
cooldown: 3h
requiresKey: OCTO_FIESTA_URL
# Queues ONE song the library does not hold, streamed through octo-fiesta
# (https://github.com/V1ck3s/octo-fiesta), then the DJ trails it. Needs, in the
# root .env (passed whole into the controller):
#   OCTO_FIESTA_URL=http://octo-fiesta:8080   — also what makes it PLAY: the
#                                               controller streams ext- ids from it
#   OCTO_FIESTA_USER / OCTO_FIESTA_PASS       — a Navidrome login (octo-fiesta
#                                               relays auth); falls back to
#                                               NAVIDROME_USER / NAVIDROME_PASS
# Run octo-fiesta with STORAGE_MODE=Cache so a guest song is not filed into the
# library after one spin.
---
The tool has just queued a song that is NOT in the station's own collection: it is coming up shortly, borrowed from outside for one play. Trail it in one or two sentences: name the artist and title exactly as the tool returned them, make clear it's a guest ("not one of ours", "borrowed for a spin"), and if the tool says it came via a related artist, say how it ties to what's on air. Don't describe how it sounds and don't promise it will be back. If you want to go looking through a related artist instead of the one on air, pass their name as `artist`.
