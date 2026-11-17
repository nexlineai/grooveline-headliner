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
  - One job `build` (one Mac per push; a newer push cancels an older run): package tests,
    unsigned IPA artifact for iloader, then the app runs in the iOS Simulator and screenshots +
    the app's log are force-pushed to the `shots` branch. Look at them with
    `scripts/get-shots.sh <scratch dir> [booth night ...]` (downloads over HTTPS, then Read them).
    **Never `git fetch` the shots branch**: every run's pictures piled up in `.git` and filled
    Omarchy's root disk (318 MB of loose objects, 17 Nov). This clone only fetches `main`.
  - On failure, read the annotations without a token:
    `curl -s https://api.github.com/repos/nexlineai/grooveline-headliner/commits/main/check-runs`
    then `.../check-runs/<id>/annotations`.
- `project.yml` -> `xcodegen generate` -> `GroovelineHeadliner.xcodeproj` (gitignored).
- iOS 26.0, iPhone only, landscape only, Swift 5 language mode.
- Launch arguments for screenshots: `-screen booth`, `-demo 1`, `-screen lesson`, `-screen story -scene <id>`. Add one per new screen and a
  `shot` line in `scripts/ci-shots.sh`.

## Architecture
- `Packages/HeadlinerKit/HeadlinerCore` (pure Swift, unit-tested on the CI host): `BeatGrid`,
  `Vinyl.render` (reads a record at a changing speed: play, stop, pitch, nudge, scratch and
  spinback are all the same mechanism), `MixMath`, `MixJudge` (how good the blend is).
- `HeadlinerCore/Mixer.swift`: the whole mixer as plain arithmetic, unit-tested: per deck a
  3-band EQ (`Biquad`: low shelf 180 Hz, peak 1 kHz, high shelf 4.5 kHz, -36 dB kill to +6 dB), a
  fader to the room, a headphone cue switch (before the fader); output either the room in stereo
  or "split" (room mono left, headphones mono right, `cueMix` blends the room into the headphones).
- `HeadlinerAudio`: `Deck` (one turntable; main-thread API over `DeckShared` and its
  `ChannelStrip`, plain memory shared with the audio thread, no locks) and `DeckEngine` (ONE
  source node that calls `Mixer.render`; restarts itself when the output changes, e.g. headphones
  plugged in). No system audio units: what the tests check is what the phone plays.
- Headphones (`PhonesView`, `Game.phonesMode` / `cueMix`, PHONES buttons on the mixer), as in the
  Record Store: OFF or SPLIT L/R. A third mode, SOUND CARD, shows only when a device with four or
  more outputs is connected (room on 1-2, headphones on 3-4; written, never run on real hardware).
  Do NOT try again to play the phone's speaker next to a wired adapter or Bluetooth headphones:
  Zé tested both on his iPhone (16 Nov 2026, `.multiRoute`), iOS sends everything to the added
  output. Bluetooth is also a fifth of a second late.
- `App/`: SwiftUI shell (`Game`, `TitleView`, `BoothView`) and the SpriteKit booth
  (`BoothScene` holds settings and touch handling, `BoothNodes` draws the gear).
- Moving through a record: pick up the headshell and carry it (`Kind.needle`), or touch the strip
  above the platter (`Kind.wave`). Both lift the needle (`Deck.lifted`, silent, platter keeps
  turning) and drop it on release. The rim wins over the strip where they overlap.
- Story (`Story.swift`, `StoryView.swift`, `App/Story/scenes.json`): scenes play by themselves,
  a tap skips a line. A line is either a `clip` (mp4 in which the character says the line; voice
  and lips are made together by the video model, so they match) or a `voice` (m4a over the still
  picture, no mouth movement). Never pair a separate voice file with a "talking" loop: Zé saw
  that on the phone and the lips were wrong.
- Lessons (`Lesson.swift`): a `Lesson` is a list of `LessonStep`s (coach's voice line + text, a
  task in a few words, a `LessonGoal` the decks must show, a control to point at). `LessonRunner`
  is fed `BoothFacts` by `BoothScene.teach` every frame; `LessonOverlay` shows task and words over
  the room. The coach is a voice-over (Zé's choice), never on camera; music ducks while he talks.
  Voice files in `App/Lessons/` made with `tools/voice/say.sh` (Tó = `helios`).
- Menu music (`Game.updateMenuMusic`): `App/Art/menu-loop.m4a` (Saturday Job bars 32-48, a
  16-bar loop) on the title and chapter screens, fading out on every other screen.
- In a night Tó comments as a voice-over (`App/Lessons/night-*.m4a`, music ducks while he talks).
  SwiftUI: a picture wider than the screen must go in `.background`, never as a ZStack child (it
  made the chapter screen wider than the phone and pushed the back button off the edge).
- Chapters (`Chapter.swift`): PLAY opens the chapter screen (steps with best stars, scenes
  seen, CONTINUE = from the first step not done to the end of the chapter). Progress is saved in
  `UserDefaults` under `progress.v1`, recorded at a result card's CONTINUE (never on the back
  button, which leaves to the chapter). `Chapters.locked` is false while Zé tests (every step
  playable); turn it on for the release.
- Nights (`Night.swift`, `Nights`, `Screen.night(id)`): no coach; `NightRunner` turns what the
  room hears (`MixJudge` reading: silence / one record / blend quality, bass clash, which deck is
  on air) into crowd energy, a mood 0-3 and short comments from the friends; stars from the
  average energy, the number of mixes, dead air and train wrecks. `BoothScene.showRoom` cross-
  fades between four loops of the same room picture (`room-bedroom-{waiting,nodding,dancing,nuts}`);
  outside a night the room dances while music is heard and holds still when it stops.
- Crate (`CrateView.swift`, free play only): lists `tracks.json`, loads a record on the left or
  right deck (not onto a turning deck, one copy per record). `BoothScene.recordChanged(on:)` redraws.
- The Grooveline name is always the site's mark: `GroovelineLogo` (bars + Orbitron Bold, teal
  `#00d4c8`). Fonts in `App/Fonts/` (Orbitron, OFL).
- Turntable conventions Zé asked for in the Record Store apply here too: pitch fader up = slower,
  CUE like a club deck (stopped: set the mark; playing: back to the mark and stop), crossfader
  full until the middle. Double tap on a knob = back to its default: EQ in the middle (flat),
  the cue mix to CUE (Zé corrected this: the cue mix default is CUE, not the middle).

## Assets
- `tools/music/make.mjs`: synthesizes the original tracks into `App/Tracks/` (+ `tracks.json`).
  Every track starts on a kick at sample 0; the app finds it at load and starts the grid there.
- `tools/art/imagine.py OUT.jpg "prompt" [--aspect 16:9]`: illustrations in the house style.
  Style tests in `art/style-tests/`; pictures the app uses in `App/Art/`.
- `tools/art/animate.py IN.jpg OUT.mp4 "what moves" [--voice ID] [--return] [--silent]`: clips.
  `--voice` + the line in quotes in the prompt = lip-synced speech in a cast voice; `--return`
  makes the clip end on the picture it started from (use this, not the forwards-backwards
  `--loop`, for anything that looks wrong in reverse). `tools/art/story-lines.sh` holds the
  prompts of every spoken line. Check the words of each clip with `voxtype transcribe`.
  Work files go in `/data/headliner-work/` (root disk is nearly full), only finished clips in git.
- **Voice rule (17 Nov):** a character who coaches by voice-over keeps one xAI voice everywhere,
  and their on-camera lines are made on Grok with `animate.py --voice`: Tó `helios` (never on
  camera), Lia `ara`, Nuno `zagan`. Characters who only appear on camera (Dani, Mira, Sara, ...)
  are made with Omni and their voice comes from Omni (same voice description every clip).
- Lessons can set the room (`LessonDesk.room`, `room-<room>.jpg` + `room-<room>-<mood>.mp4`,
  falling back to the room's nearest mood) and turn SYNC off (`syncAllowed: false`, vinyl).
  Pitch fader fine mode: finger more than 60 pt to the side of the fader = four times slower.
  Lessons reload the first two records (122 / 124 BPM) if the crate swapped them.
- **Talking clips are made with `tools/art/animate_or.py IN.jpg OUT.mp4 "prompt" --model
  google/gemini-omni-1.2-flash --return`** (OpenRouter, key: keyring `service openrouter account
  claude-art`; Zé's choice 17 Nov: half of Grok's price, he likes look and voice). It is 16:9
  only, so new scene pictures are 16:9 with faces inside the middle 80 % of the height. The voice
  comes from the model: use the same voice description for a character in every prompt.
  Only about two lines per scene go on camera, the rest is voice over the picture (cost).
  `animate.py` (Grok, cast voices, twice the price) made the first two scenes.
  `google/veo-3.1-lite` refused our picture ("violates Vertex AI's usage guidelines").
- `tools/voice/say.sh OUT.m4a VOICE "text"`: spoken lines without a picture. `voice/casting/` has every voice
  saying one line, for Zé to cast by ear.
