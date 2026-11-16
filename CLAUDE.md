# CLAUDE.md

Grooveline: Headliner, a native iPhone game about a DJ's career (working title).
Design, story, decisions and the build log are in the vault:
`~/workspace/04_projects/grooveline/notes/dj-career-game.md`. Read it before changing scope.

## Repo rules
- Public repo `nexlineai/grooveline-headliner`, all rights reserved (`LICENSE`), not open source.
- The app ships no keys and has no network code. Art, voices and music are made on Omarchy with
  the scripts in `tools/` (xAI key from the GNOME Keyring, never in a file) and committed as files.
- No repo-level secrets, ever. A signing key will exist only in an approval-gated `testflight`
  environment (not set up yet; do not push `v*` tags or add a workflow naming it before it exists).
  Never use `pull_request_target`.
- Check `.github/workflows/` before every push (exfil-workflow history on other repos).
- Commits use `58702721+nexlineai@users.noreply.github.com` (set in this clone's git config).
- No commercial music, ever: only tracks made by `tools/music/make.mjs` or supplied by Zé as his own.

## Build
- Nothing builds on Omarchy (no Xcode, no room for a Swift toolchain). CI is the compiler:
  `.github/workflows/build.yml` on every push to `main`.
  - `ios` job: package tests + unsigned IPA artifact for iloader.
  - `shots` job: runs the app in the iOS Simulator and force-pushes screenshots + the app's log to
    the `shots` branch. Look at them with:
    `git fetch origin shots && git show origin/shots:booth.png > /tmp/booth.png` (then Read it).
  - On failure, read the annotations without a token:
    `curl -s https://api.github.com/repos/nexlineai/grooveline-headliner/commits/main/check-runs`
    then `.../check-runs/<id>/annotations`.
- `project.yml` -> `xcodegen generate` -> `GroovelineHeadliner.xcodeproj` (gitignored).
- iOS 26.0, iPhone only, landscape only, Swift 5 language mode.
- Launch arguments for screenshots: `-screen booth`, `-demo 1`. Add one per new screen and a
  `shot` line in `scripts/ci-shots.sh`.

## Architecture
- `Packages/HeadlinerKit/HeadlinerCore` (pure Swift, unit-tested on the CI host): `BeatGrid`,
  `Vinyl.render` (reads a record at a changing speed: play, stop, pitch, nudge, scratch and
  spinback are all the same mechanism), `MixMath`, `MixJudge` (how good the blend is).
- `HeadlinerAudio`: `Deck` (one turntable; main-thread API over `DeckShared`, plain memory shared
  with the audio thread, no locks) and `DeckEngine` (two decks -> 3-band EQ each -> output).
- `App/`: SwiftUI shell (`Game`, `TitleView`, `BoothView`) and the SpriteKit booth
  (`BoothScene` holds settings and touch handling, `BoothNodes` draws the gear).
- Turntable conventions Zé asked for in the Record Store apply here too: pitch fader up = slower,
  CUE like a club deck (stopped: set the mark; playing: back to the mark and stop), crossfader
  full until the middle.

## Assets
- `tools/music/make.mjs`: synthesizes the original tracks into `App/Tracks/` (+ `tracks.json`).
  Every track starts on a kick at sample 0; the app finds it at load and starts the grid there.
- `tools/art/imagine.py OUT.jpg "prompt" [--aspect 16:9]`: illustrations in the house style.
  Style tests in `art/style-tests/`; pictures the app uses in `App/Art/`.
- `tools/voice/say.sh OUT.m4a VOICE "text"`: spoken lines. `voice/casting/` has every voice
  saying one line, for Zé to cast by ear.
