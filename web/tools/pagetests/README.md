# Page tests

The unit tests (`web/test`, `node --test`) cannot see the booth. These scripts drive the REAL page in a headless Chromium (`../shot.ts`, about 1 frame a second).

| What | How |
|---|---|
| Build the scripts | `./build.sh` (copies `bodies/` to `built/`) |
| Run the whole suite (about 4 minutes) | `./run.sh` (dev server on :5174 must be running: `cd web && node tools/serve.ts --port 5174`) |
| Run some | `./run.sh free-e2e:50:'?autostart' title-e2e:34:'?x=1'` |
| The paywall (a stranger plays chapters 1-2 with the gate on; starts its own Worker, about 12 min) | `./paywall-e2e.sh [port]` (not in run.sh); the HTTP-level purchase path: `node paywall-local.mjs URL` against `wrangler dev --config wrangler.test.toml` |
| Audio checks (a recorded tone through a loop) | `audio/` (needs a PipeWire null sink `Headliner-Radio` and `ffmpeg -f pulse`; an audible variant of shot.ts without `--mute-audio`) |

URLs: `?autostart` = FREE PLAY (the game's booth), `?autostart&lesson=<id>` straight into a lesson, `?autostart&night=<id>&length=<s>` into a night.

The DJ software (LIVE: your own music, effects, pads, SOUND CHECK, GO LIVE) is Grooveline Booth since 22 Nov 2026, with its own repo
(`nexlineai/grooveline-booth`, local `~/PROJECTS/grooveline/booth`) and its own page tests. This page is the game only.

## Rules learned the hard way
- ONE headless browser at a time. Two at once starve each other.
- The booth redraws about once a second headless: wait 2.5 s or more after anything that rebuilds the layout.
- A test that calls `booth.press({...})` or `setValue` proves the control EXISTS, not that the mouse reaches it: drive a new control once with the real mouse (`../shot.ts` `click` / `drag`).
- `bodies/*.js` are async IIFEs that print `T PASS|FAIL|ERROR|DONE ...` lines (`console.log`), which `run.sh` filters.
