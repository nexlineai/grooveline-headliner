# Page tests, real-mouse check and real-library checks

The unit tests (`web/test`, `node --test`) cannot see the booth. These scripts drive the REAL page in a headless Chromium (`../shot.ts`, about 1 frame a second):

| What | How |
|---|---|
| Build the scripts | `./build.sh` (puts the fixtures in front of each body in `bodies/`, writes `built/`) |
| Run the whole suite (about 25 min) | `./run.sh` (dev server on :5174 must be running: `cd web && node tools/serve.ts --port 5174`) |
| Run some | `./run.sh live-e2e:85:'?autostart&live&records' fx-run:110:'?autostart&live&records'` |
| Real mouse (a click, a drag) | `node mouse-fx.ts 1440 770` prints the `--do` steps for shot.ts (CDP mouse events); see `../shot.ts` for `click`, `drag`, `eval`, `wait` |
| A screenshot with a state | `node tools/shot.ts out.png 'http://localhost:5174/?autostart&live&records' --size 1440x770 --wait 16 --do "run tools/pagetests/built/look-booth.js; wait 4"` |
| Audio checks (a recorded tone through a loop) | `audio/` (needs a PipeWire null sink `Headliner-Radio` and `ffmpeg -f pulse`; an audible variant of shot.ts without `--mute-audio`) |
| Real-library checks (read-only!) | `real-library/` (the Mixxx database and the USB drive are READ-ONLY; edit the paths inside) |

URLs: `?autostart` = FREE PLAY (the game's booth), `?autostart&live` = LIVE with empty decks, `&records` puts the game's first two records on the decks, `&playcount=2` makes a play 2 s.

## Rules learned the hard way
- ONE headless browser at a time. Two at once starve each other (a master-volume check read -3.75 dB instead of -6).
- The booth redraws about once a second headless: wait 2.5 s or more after anything that rebuilds the layout, and 7 s after a mode switch made by calling `booth.setMode` directly.
- A test that calls `booth.press({...})` or `setValue` proves the control EXISTS, not that the mouse reaches it: on 20 Nov the FX buttons did nothing on a click and the LEVEL fader dragged on the wrong axis while every test was green. After adding a control, drive it once with the real mouse (`mouse-fx.ts`).
- `bodies/*.js` are async IIFEs that print `T PASS|FAIL|ERROR|DONE ...` lines (`console.log`), which `run.sh` filters.
- Fixtures are tiny: 4 mp3 of 1.5 s with different tags and covers (`fixtures/`), plus the unit tests' own (`../../test/fixtures`).
