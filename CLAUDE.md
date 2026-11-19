# CLAUDE.md

Grooveline: Headliner, a native iPhone game about a DJ's career (working title).
Design, story, decisions and the build log are in the vault:
`~/workspace/04_projects/grooveline/notes/dj-career-game.md`. Read it before changing scope.

## Repo rules
- Public repo `nexlineai/grooveline-headliner`, all rights reserved (`LICENSE`), not open source.
- The app ships no keys and has no network code. Art, voices and music are made on Omarchy with
  the scripts in `tools/` (xAI key from the GNOME Keyring, never in a file) and committed as files.
- No repo-level secrets, ever. The App Store Connect key (team key "Grooveline CI", Admin, Key ID
  `VBXBBQSHYJ`) exists only in the approval-gated `testflight` environment (created 18 Nov 2026:
  required reviewer Zé, `v*` tags only; secrets ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8).
  `.github/workflows/testflight.yml` runs on `v*` tags (the tag must match MARKETING_VERSION, or
  `vX.Y.Z-N` for another build of it), waits for his approval, then `scripts/ci-testflight.sh`
  archives with cloud signing (team TBVQAB4342) and uploads (ExportOptions.plist, destination
  upload). Never use `pull_request_target`.
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
- **Screenshots are quick by default** (18 Nov): a push takes only the QUICK set in `ci-shots.sh` (title,
  chapter screens, paywall, booth, one lesson, one night) plus names in a `[shots: name name]` tag in
  the commit message. A new screen: add its `shot` line AND name it in the commit message. All ~90:
  `git tag full-shots-N && git push origin full-shots-N` (about 25 min). Store pictures: tag `store-shots-N`.
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
  one-knob filter (`ChannelStrip.filter` -1...1: low-pass 20 kHz -> 100 Hz below the middle,
  high-pass 20 Hz -> 8 kHz above it, off within 0.03 of the middle; the knob sits under each EQ
  column beside the crossfader, shown from chapter 7 on and in free play), a
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
- Lesson goals worth knowing: `phaseHeld(bars, tolerance)` needs an unbroken lock;
  `blendHeld(bars, tolerance)` counts bars of a clean blend in total (a slip pauses it) and its
  chip says why it stopped. Lessons can hide the numbers (`hideBPM`) and preset pitch faders.
- Nights (`NightInfo`): room, records, chapter, coach + per-night `lines`, `requests`,
  `mishap` (.cable / .needleSkip), `turnDownAt` (the on-air fader must come down within 8 s),
  `remarks`, `maxMood` (a small room tops out at 2), `syncAllowed`, `mixesFor3Stars`, `bag` (the
  crate shows only these ids; lessons have `LessonDesk.bag` too), `hot` (records too big for a
  warm-up: one on air costs the third star), `clockStart` (minutes; CAVE starts at 00:30), and
  `.stuckGroove` (the record on air repeats one platter turn, 1.8 s, until the needle is lifted
  or the deck stops; energy drains while the room hears it). Lesson goal `pickRecord(deck, good)`:
  any other record put on that deck is a miss ("too hot"). `.powerCut` stops both decks and the
  next 6 s of silence do not count. `judgeKeys`: a blend that `Harmony.clash`es for more than 3 s
  drains the room. `LessonDesk.cueBar` cues every record in the lesson (crate loads too) that many
  bars in, past the drum intros, so the music is heard at once.
  `endBPM` (afterhours): the tempo on air must end at or below it for three stars, and a drop of
  more than 2 BPM within 2 s costs energy ("the brakes"). Lesson goal `rideTempo(deck, to)`: bring
  the pitch down to a tempo, never more than 1.5 BPM within one bar. SpriteKit: `SKScene` already
  has `filter` (CIFilter); the scene's own knob values are `filterSetting` (build 34 broke on it).
- **Studio (chapter 8, `HeadlinerCore/DrumMachine.swift`, `App/Studio.swift`):** a 3 x 16 step
  grid (kick, clap, hat) over the room in lessons with `LessonDesk.studio`; the voices are
  arithmetic (no samples, no codec delay); one bar is rendered with wrap-around and repeated 64
  times at 124 BPM, then `Deck.load(_:left:right:sampleRate:keepPlace:)` puts it on the left deck
  (grid from sample 0; an edit swaps the buffer in place while it plays). Goal
  `pattern(row, steps)`. The coach's words are hidden there (the grid needs the room). The pattern
  is not saved yet; when it is, add it to `CareerProgress` as an Optional (synthesized Codable
  inside `try?`: a new non-optional field wipes every saved progress).
  CUT (`LessonDesk.cutter`) renders `DrumMachine.arrangement` (intro 16 kick+hat, groove 16
  +clap+bass, full 16, break 8 chord+hat, full 16, outro 8 = 80 bars) as the record `your-dubplate` (not `dubplate`: chapter 3 has a record with that id),
  saved as `CareerProgress.track` (Optional) and listed in the crate (free play, and bags that
  name "your-dubplate"; crate loads of it go through `Studio.loadCut`). Night `mixdownCheck`: 5 s after
  the dubplate is on air its bass "booms"; its low knob must be at 0.35 or below within 8 s.
  Every App file that names a HeadlinerCore type must `import HeadlinerCore` (build 38 failed).
  Studio audio is levelled: the full mix (all rows) is scaled to `DrumMachine.targetRMS` (-15
  dBFS RMS, what our records' full sections measure), so the dubplate and the loop sit level with
  the crate. On `mixdownCheck` nights the dubplate is cut with kick and bass +6 dB (`heavyLows`),
  so the "boom" is real and turning its low down really fixes it.
- **Strange booths (chapter 9):** `LessonDesk.deadFader` / `NightInfo.deadFader` = a channel fader
  stuck where the desk sets it (drawn dim, ignores the finger). Mishap `.pitchWander`: the on-air
  deck's belt slips, its pitch drifts (about ±0.5 %, slow) around its fader for the rest of the
  night unless SYNC holds it.
- **Festival echo (chapter 10):** `MixerShared.echoDelay` + ring buffers from `DeckEngine`:
  the ROOM output also gets a copy `echoSeconds` late at -6 dB (the far speakers); the headphones
  never do (the monitors). `LessonDesk.echo` / `NightInfo.echo`; `closeBooth` turns it off.
  `NightInfo.climbTo`: the tempo on air must end at or above it for three stars.
- **Back to back (chapter 11):** `LessonDesk.partner` = the deck the other DJ plays herself
  (`BoothScene.drivePartner`, state `PartnerMove`: her record on air from the start; once yours is
  up, ≥ 0.8, she cuts her low at her next phrase over 2 beats, waits for your low (or 2 bars),
  fades her fader over 4 bars and stops). Her deck's controls, and the crossfader while she is on,
  refuse touches (`partnerHolds`, PHONES and the cue mix stay free); the crate's `onLoad` asks
  `refuseLoad(on:)`. Each refusal is `BoothFacts.stepOns` -> Helena's "Hands off" line + a miss +
  a verdict line. Her deck never auto-restarts while your fader is up. Lesson goals that wait
  for her use her fader (`channelFader(0, 0...0.04)`), not `.listen`.
  Nights: `NightInfo.partner` + `partnerBag` (her answers). 35 s after your record is on air
  alone she loads one that fits (`partnerPick`: Harmony + within 2.1 BPM), sets her PITCH to your
  tempo in the same frame (never her SYNC: your deck's SYNC follows hers, so hers must not
  jump), seeks to your beat-in-phrase + 0.05 s spin-up, trims the phase while her fader is down,
  fader up over your next phrase (low out), then her low in; she hands over again only after
  your fader has been down (`PartnerMove.on(armed:)`). Step-ons in a night: -0.05 energy,
  Helena's line (`speak(by:)`), no third star; Tó's moment "answer" when she starts one.
  `PartnerStyle.vex` (night VEX B2B): his bag in its own order (no key check), answers after
  20 s, half a phrase off, fader up in one bar with his bass in, then pulls YOUR fader down
  (moment "stolen"); pushing it back up within 8 s = a fight (-0.08, moment "fight", no third
  star); he hands over at once when your fader comes up. Mishap `.partnerCrash` (his laptop
  dies): his deck stops and `partnerDeck = nil` (both decks are yours).
  Mishap switch in `BoothScene`: anything not listed falls to `default` = the record on air
  STOPS. `.rainRush` was missing there until build 50 (THE TENT went silent at 35 %).
- **Records move forward (Zé, 18 Nov):** each night starts on and carries its own and recent
  chapters' records, crates list the newest chapter first (`BoothView.newestFirst`; never reorder
  `tracks.json`, lessons rely on `tracks[0..1]`). After changing a night's `records`/`bag`/
  `partnerBag`, run `python3 tools/check-nights.py`: it fails on future-chapter records, missing
  rule records (requests, hot, encore) and unreachable climbTo/endBPM, and warns on records with no
  key neighbour (judgeKeys) or no Helena answer; a change must not add warnings.
- **Room lift:** `BoothScene.roomLift` raises a room's picture by a part of its height when its
  people stand low (the booth shows only ~8-67 % of the picture's height); clamped so the bottom
  edge never comes above the gear.
- **Keys (`HeadlinerCore/Harmony.swift`):** Camelot neighbours (same, ±1 with 12/1 wrapping, or
  same number other letter). The decks have NO key lock: the pitch fader and SYNC move the key
  too, so `clash` also counts records pitched more than 0.3 semitone apart (128 -> 130 is 0.27,
  128 -> 132 is 0.53). Key lessons use records at the same BPM.
- Chapters (`Chapter.swift`): PLAY opens the chapter screen (steps with best stars, scenes
  seen, CONTINUE = from the first step not done to the end of the chapter). Progress is saved in
  `UserDefaults` under `progress.v1`, recorded at a result card's CONTINUE (never on the back
  button, which leaves to the chapter). `Chapters.locked` (18 Nov) is ON for everyone:
  a new player goes in order (steps after the first not done are locked; chapters after
  `Chapters.current` show a lock; a finished chapter offers CHAPTER N+1; PLAY opens the current
  chapter). Zé's hidden unlock: hold the title's Grooveline logo 3 s (`Game.unlockAll`, default
  `unlockAll`). `ci-shots.sh` passes `-unlockAll 1` to every shot unless the shot names it.
- **Paywall (`Store.swift`, 18 Nov):** chapters 1-2 free, `Store.firstPaidChapter` = 3 (one constant).
  One non-consumable `org.grooveline.headliner.career` (id can never be reused), price 4.99 set in App
  Store Connect, shown with `product.displayPrice`. `Store.careerOpen` = owned, or the hidden logo hold
  (`devUnlockAllowed`: not in the App Store build; REMOVE the TestFlight/review allowance before the
  build that goes to App Review), or a non-production receipt whose product failed to load (testers are
  never stuck). `Game.run` refuses paid screens; `ChapterView.paywalled` shows the offer + RESTORE.
  Ownership only ever turns on at launch (refunds arrive via `Transaction.updates`). Debug-only
  launch args for shots: `-forceLocked 1`, `-shotPrice '$4.99'`.
- Nights (`Night.swift`, `Nights`, `Screen.night(id)`): no coach; `NightRunner` turns what the
  room hears (`MixJudge` reading: silence / one record / blend quality, bass clash, which deck is
  on air) into crowd energy, a mood 0-3 and short comments from the friends; stars from the
  average energy, the number of mixes, dead air and train wrecks. `BoothScene.showRoom` cross-
  fades between four loops of the same room picture (`room-bedroom-{waiting,nodding,dancing,nuts}`);
  outside a night the room dances while music is heard and holds still when it stops.
- Crate (`CrateView.swift`): in free play only the records of chapters played so far
  (`Chapters.recordsOpen`: chapter 1 always, chapter N once its night has a star, or one of its
  lessons when it has no night yet; Zé, 17 Nov); in lessons/nights the chapter's or the bag's. Lists `tracks.json`, loads a record on the left or
  right deck (not onto a turning deck, one copy per record). `BoothScene.recordChanged(on:)` redraws.
- The Grooveline name is always the site's mark: `GroovelineLogo` (bars + Orbitron Bold, teal
  `#00d4c8`). Fonts in `App/Fonts/` (Orbitron, OFL).
- Turntable conventions Zé asked for in the Record Store apply here too: pitch fader up = slower,
  CUE like a club deck (stopped: set the mark; playing: back to the mark and stop), crossfader
  full until the middle. Double tap on a knob = back to its default: EQ in the middle (flat),
  the cue mix to CUE (Zé corrected this: the cue mix default is CUE, not the middle).

## Web version (`web/`, started 18 Nov 2026)
Plan and log: vault `04_projects/grooveline/notes/headliner-other-platforms.md`.
- Plain TypeScript, **erasable syntax only** (no enums, namespaces, parameter properties), **no npm
  dependencies**: Node 26 strips the types. Types are imported with `import type` (a stripped
  plain import of a type fails at run time). `tsc` runs only on CI (`.github/workflows/web.yml`,
  Linux: `node --test` + `tsc -p web`); `build.yml` ignores `web/**`, so web pushes never start or
  cancel a Mac build.
- `web/src/core/` is `HeadlinerCore` line by line; `web/test/core.test.ts` is `CoreTests.swift` case
  by case. A change to one core is made in the other too, with its test twin.
- Run it: `cd web && node tools/serve.ts` -> http://localhost:5173 (serves `../App` at `/assets/`,
  one copy of the content; COOP/COEP headers so the page shares memory with its audio thread).
  `--lan` serves the Wi-Fi too, but a phone gets no sound over plain http (AudioWorklet needs
  https or localhost): phones wait for an https preview deploy.
- Look at it myself: `node tools/shot.ts OUT.png "http://localhost:5173/?autostart&demo" [--do
  "click X Y; drag X1 Y1 X2 Y2; wait S; eval EXPR"]` = headless, muted Chromium, prints the console
  and errors; `eval` sees `engine` and `booth`.
- Audio: `src/audio/worklet.ts` runs `renderMix` in an AudioWorklet; the page and the worklet share
  one Float64Array (`layout.ts`: the page writes the wanted values, the worklet the needle). Without
  cross-origin isolation (an Android WebView) the same array is synced by messages. Records are
  decoded at the output rate; the grid starts at the first kick found in the decoded audio (AAC
  priming differs per browser). A load message carries the deck's seek count, so a cue right after
  a load lands on the new record.
- **Content:** `web/content/career.json` (chapters, lessons, nights, night lines) is GENERATED from
  `App/Lesson.swift`, `Night.swift`, `Chapter.swift` by `node web/tools/content.ts` (a parser for
  that literal subset of Swift; defaults come from the Swift declarations; it fails on anything it
  does not understand and checks every voice file, record, scene and room). Swift stays the one
  source until the iPhone release. **After any change to those files, run the tool and commit
  career.json**: web.yml runs `--check` and fails otherwise. A new unlabeled enum value needs a
  name in its `POSITIONAL` table.
- **Whole game on the web (19 Nov):** title, chapter screen, stories, 22 lessons, 20 nights, THE BAG,
  credits + zdB card, progress in localStorage (`src/game/progress.ts`). Same hidden unlock (hold the
  logo 3 s) for testing; **Zé: take it out of the web's last version** (19 Nov).
- **Inputs:** every way in (touch, keys `src/input/keys.ts`, MIDI `src/input/midi.ts`) goes through
  the booth's `press` / `setValue` / `nudgeKey` / `jog`, so partner step-ons, dead faders, SYNC and
  detents hold everywhere (keys skip the pitch detent: steps are smaller than it). MIDI: generic
  learn for any controller, push/toggle buttons, both jog encodings, soft takeover; pure rules
  tested in `test/midi.test.ts` (no MIDI device in headless).
- **CUE (web, 18 Nov):** as on a club deck. Stopped: the needle's spot becomes the mark (unless within
  20 ms of it) and the record plays from there while CUE is held; let go, it stops and goes back to
  the mark. Playing: CUE = back to the mark and stop (no preview). PLAY during the hold keeps it
  playing (`Deck.latch`). `Deck.preview/park` use a 4-5 ms "quick" glide (not the motor's 50/120 ms) and
  `park` drops the needle on the mark ~30 ms later, once the record is silent, so there is neither a
  tape-stop tail nor a click. Every way in sends `press` and `release` (touch up, key up, MIDI target
  kind `hold`; `MidiInput` asks `kindOf(target)`, so CUEs learned as push buttons before still work).
  A preview is hidden from lesson facts (`motorOn`/`turning`) so it never counts as a start; any
  rebuild, blur or desk reset ends it (`endCueHolds`). The iPhone's CUE is still the old one (mark / back).
- **Master section (web only, 18 Nov): `src/audio/fx.ts`, outside `core/` (no Swift twin).** The worklet calls
  `MasterSection.process` right after `renderMix` and BEFORE the TWO DEVICES ring is filled. It holds (1) the
  effect unit: delay (stereo, feedback 0.5, darkened repeats, time = tempo x note value: 1/4 = one beat, the page
  sends `fxDelay` in seconds from the louder playing deck's BPM), Freeverb reverb, flanger (sweep = 8 x the
  delay time). Dry stays full, the wet is added to the room AND to the headphones x cue mix (split: left =
  room, right = phones). Off and finished ringing (under -100 dB for 0.5 s) it does nothing: bit-identical
  output (tested). Soft clip (0.9 knee) only while it works. (2) the headphones level (VOL knob next to MIX;
  unity at 0.7, -60..+6 dB, kept in localStorage `headliner.phonesLevel`). The effect unit (DELAY/REVERB/FLANGER,
  1/4..1/32, AMOUNT, ON; keys G T Y V B; MIDI targets fxOn/fxType:i/fxDiv:i/fxAmount) is the first unit of the
  effects controller of LIVE (see "LIVE booth" below); the game's booth has none (`Booth.mode`). Settings in localStorage
  `headliner.fx`; always OFF at start.
  The old `echoDelay` in `core/mixer.ts` is the far-speakers mishap (one late copy), not this delay.
- **Channel GAIN knobs (web only, 19 Nov): the TRIM knob at the top of each LIVE channel strip (LIVE only).** For records mastered too loud (own
  music). `Deck.trim` (0...1, 0.5 = 0 dB; `trimDecibels` in `audio/fx.ts`: -24 dB at the bottom, +6 at the top, 0.03 detent,
  double tap = 0 dB) goes through the deck's existing needle gain: `Deck.pushGain()` writes `D.targetGain` = `lifted ? 0 :
  trimGainFor(trim)`, and EVERY write of that field goes through it (the lift, a load, a made record), so a needle drop or a
  new record never puts it back to 0 dB. That is `core/vinyl.ts`'s own gain glide (5 ms), so nothing in `core/mixer.ts` (the
  Swift twin) changed, and the trim sits before the EQ, the filter and the fader; the channel meter shows the trimmed level.
  The knob stays on the deck when a record is loaded (hardware-like). `Booth.applyTrim()` runs every frame: outside free
  play every channel is at exactly 0 dB (the knob keeps its place, and the layout has no knobs and the old 88-unit
  faders; the game's booth is the plain iPhone desk again). MIDI target `trim:d` (absolute,
  "LEFT GAIN"), mouse, wheel. `heardGain` (the lessons' and nights' view of the mix) is the fader only, so the trim never
  changes a verdict. Not remembered between visits or per track (a possible next step: store it with the library track).
- **My music (web only, 19 Nov): `web/src/library/`, free play only (CRATE -> MY MUSIC; hidden in lessons and nights).**
  Your own files, read in the browser, never uploaded. `showDirectoryPicker` (Chromium; the handle is kept in IndexedDB
  `headliner-library`, a new visit needs one RECONNECT click) with an `<input webkitdirectory>` fallback (this visit only).
  `scan.ts` walks a folder (6 reads at a time, a file with the same size+mtime is not read again), `tags.ts` reads ID3v1/2.2-2.4,
  FLAC, MP4 (iTunes atoms and QuickTime keys) with random-access reads (title/artist/album/genre/BPM/key -> Camelot, where
  the cover lies; wav/aiff/ogg get the file name), `aiff.ts` decodes AIFF (Chromium cannot; ALAC and WMA also fail: the
  load says so). `beats.ts` finds tempo + first beat (onset strength per 2.5 ms, fold over every tempo, then a line through the
  beats one by one; a file tag BPM only chooses between a tempo and its double/half) in `analysis-worker.ts`; the result
  (and your corrections: half, double, +-0.1, GRID HERE = first beat at the CUE mark) is stored on the track. A track opens
  through `loadUserTrack` in main.ts: `probeDuration` first (limit 15 minutes, an hour decoded is 2 GB), `engine.decode`,
  `Deck.loadDecoded(info, audio, grid)`. Checked against 70 real tracks of the Mixxx library with `tools/check-beats.ts`
  (read-only; needs the DB and the USB): tempo within 0.5 BPM on 59/70, the rest mostly octave readings; over a whole track
  it stays on the onsets where Mixxx's analysed tempo drifts. Tests use real ffmpeg output in `web/test/fixtures`.
- **Sleeves (web only, 19 Nov; item 4a of the roadmap): the crate shows covers.** `library/sleeves.ts`. A track's picture is, in
  order, the cover inside the file (`LibraryTrack.cover` = where it lies; read lazily with `readCover`) or the cover picture lying
  in the same folder (`LibraryTrack.art`, found AT SCAN TIME by `listFolder`/`entriesFromFiles` with `pickArtName`: cover, folder,
  front, albumart, album, artwork, any case, jpg/jpeg/png, "AlbumArtSmall" skipped; an unchanged track gets/loses it on a rescan
  without a tag re-read). `Sleeves` = queue (4 at a time, newest request first, cancellable) + LRU cache of 160 px master CANVASES
  (no blob URLs: no CSP change, nothing to revoke); `createImageBitmap(blob, {resizeWidth/Height})` scales while decoding (the
  size comes from `imageSize`, JPEG/PNG headers), cut square from the middle. "later" (folder waits for RECONNECT, or a read
  failed) is never cached; "none" is. `Library.fileQuiet` never prompts (needs a click). The tracks of one folder share one decode.
  No picture: a sleeve made from the name (`paintGenerated`, same track = same look). MY MUSIC has SLEEVES (default, a grid; tap
  opens LEFT/RIGHT on the cover) and LIST (small covers), kept in localStorage `headliner.myMusicView`; only the visible tiles load
  (IntersectionObserver on `.mm-list`). On the platter: `Booth.setLabelArt(d, id, canvas)` -> `platterPicture(..., art)`; drawn only
  while `deck.info.id === art id` (so a game record, lesson or `loadMade` never shows it; nobody clears it). `TAGS_VERSION` (scan.ts)
  marks what the tag reader could do: a track from an older one is read again by the next SCAN (the panel says "Press SCAN once").
  Found with 200 real tracks: ID3v2.4 APIC frames with the frame flags (data length indicator + frame unsync) were misread, now
  handled (`Cover.unsync`); WAV files with art in an ID3 chunk (about 1 %) still show no cover. Real files: 122 of 122 embedded
  covers decode, median 15 ms, worst 69 ms. NOT done: online tagging (MusicBrainz + Cover Art Archive via the Worker; about 31 % of
  his library has no picture at all), and the "closet" look (crates with records) beyond the grid.
- **The record room (web only, 19 Nov; item 4b): in LIVE the library under the gear row is a wall and crates.** `library/wall.ts` (look
  and feel), `library/crates.ts` (data, no DOM, tested), covers from a second, bigger `Sleeves` (320 px, `bigSleeves` in main.ts).
  `#wall` is a fixed overlay placed by `body.live #wall` from the CSS variables `--lib-left/top/w/h` that `Booth.buildLive` publishes
  from `liveGeometry().library` (it used to cover the room above the gear; LIVE has no room): a shelf of picks (random, covers first, SHUFFLE),
  a row of crates, and a crate opens to DIG: the front record stands up, the ones behind show their tops (CSS 3D, only about 10 records
  in the DOM), flip with the wheel, a drag, the arrows (captured only while a crate is open: they are the crossfader otherwise), Home/End,
  PageUp/Down, the scrub bar; Esc or a click on the empty stage closes (in fullscreen Esc leaves fullscreen first: the click and the CLOSE button are the way). LEFT / RIGHT put the record on a deck through the same paths as MY MUSIC
  (`loadUserTrack`, `loadRecord`, `booth.refuseLoad`). Crates are chosen by CRATES BY: A-Z (default; balanced, cut between letters),
  GENRE (your own tags, top ones, rest, none), TEMPO (bands 110/120/126/134, from the analysis or the tag); THE GAME is always the first
  crate; no library: an "OPEN A FOLDER" crate. ROOM button = the crowd instead (then a RECORDS pill); choice in `headliner.front`,
  grouping in `headliner.wallBy`. Shown only in LIVE with the booth on screen (`liveLoop` in main.ts), never in a lesson or night. (The ROOM button and the
  crowd clips pause are gone: LIVE has no room.)
  While it is up the room's clips are not played (`Booth.setRoomHidden`). Rebuilt from `Library.subscribe` at most every 0.8 s (a
  scan reports often); 10,000 tracks group in about 40 ms. Compact (front shorter than 240 px: a phone held sideways): crates only.
  Measured on 500 real files: tag tempo 67 %, genre 56 %, artist 90 %, and 27 % of the files share one copy date (so no "newest" crate).
  **Search and LIST (19 Nov, Zé's asks):** the wall's top row has a search box and a WALL | LIST switch, built ONCE (the row's other
  half is redrawn on every library change, which would blur a box being typed in). `library/browse.ts`: `filterItems` (every word must
  be in the artist, title, tempo/key/genre line, album or file name), `sortItems` (ARTIST, TITLE, BPM, KEY on the Camelot wheel, no
  tempo or key last), and `buildList`: one line per record, NO covers, virtual scrolling (only the lines in view are elements; tested
  with 9,004 records), A / B load buttons through the same hooks as the wall, an "on deck" mark that follows the decks (polled every
  0.5 s), the sort kept in `headliner.listSort` and the view in `headliner.libView`. Typing a search on the wall switches to LIST.
  The wall's size is capped by the width too (`ws <= (w - 24) / 1180`) so seven crates always fit.
  Not done: drag a record onto a deck, a crate front board drawn over the dig, remembering the last records played.
  **Top bar (19 Nov): small buttons.** `#top .pill` uses `clamp(9px, 0.95vw, 11.5px)` (about two thirds of the sheets'
  pills, which keep the big size); the bar is about 475 px wide at 1200 px and up. main.ts publishes its real width as `--top-w`
  (ResizeObserver) and the wall's control row keeps clear of it, so nothing overlaps at any window width.
  **Bug fixed with it (from 0f7f5db):** `build()` set `--gear-h` to the ROOM's height but the CSS uses the GEAR's height (fallback 58vh,
  `#studio bottom`): lesson/night/studio overlays were taller than the room and covered the top of the gear (a lesson caption over the
  mixer's BPM numbers). Now `--gear-h` = `gearTop`.
- **Outputs (PHONES):** the worklet always renders 4 channels (room 1-2, headphones 3-4); modes only
  rewire a splitter/merger: OFF, SPLIT, SOUND CARD (destination 4 ch, discrete), TWO DEVICES (the
  headphones' pair -> MediaStream -> `<audio>.setSinkId`; the room via `AudioContext.setSinkId`).
  Never recreate the AudioContext (the records live in the worklet). A vanished device -> OFF (the
  cue must never fall back to the room). Not testable headless: needs Zé's hardware.
  **TWO DEVICES alignment (19 Nov, fix):** the room waits for the headphones' longer path through a `DelayNode`. A delay node that is
  re-aimed bends the pitch of everything through it, and the browser's latency readings jump by tens of ms (measured with Zé's USB
  card KM_B2: the old `align()` re-aimed it every 2 s and a 1 kHz tone moved by up to 38 cents each time: the "nudging" he heard).
  `audio/align.ts` `RoomAlignment`: a reading a second, a median of 25, set once after 8 readings, changed again only when the wanted
  wait moves by more than 25 ms (simulated: one change in ten minutes at +-14 ms jitter), then by a ramp of `|change| * 200` s (half a
  percent at most); the trim slider (debounced 200 ms) follows in 0.35 s. Measured after: 0.0 cents for 40 s. The headphone ring's
  own steering (phones-worklet.ts) is on the headphones side and untouched.
- **LIVE booth (web only, 19 Nov; step L1 of `headliner-live-roadmap.md` in the vault).** Free play is now LIVE: `main.ts showMode("free")`
  sets `Booth.mode = "live"`, a lesson or a night sets `"game"` (the iPhone's desk, untouched, plain parity: no trim, no effects, no
  master, no wall). `booth/live-geometry.ts` = pure layout (tested at 7 window sizes: nothing overlaps, everything inside its module,
  touch areas big enough): top bar 40 px; ONE gear row (deck A | mixer | FX controller | deck B; width beyond 1000 units goes to the
  decks' waveforms); under it the library (HTML `#wall`) and the stream panel (`#stream`, a placeholder until L5). `booth/live-draw.ts` =
  the look (graphite, LED-ring knobs, ridged fader caps, LED meters; deck A cyan, deck B amber; no pink; `LIVE` theme tokens) and
  `LiveRenderer` (keeps the platter and waveform pictures). `Booth.buildLive()` registers every control as a `hit` with the SAME `Kind`s,
  so the pointer code, keys, MIDI learn and the wheel work as before; new kinds: `master` (engine.masterVolume; MIDI "MASTER VOLUME")
  and the cue-mix / phones-level faders are horizontal (`Layout.sliderTravel`). The mixer strip, top to bottom: GAIN (red
  pointer), HI, MID, LOW, FILTER (in a blue square: not an EQ), CUE (headphones), channel fader; the BPM and, under it in the same size,
  the key of each deck sit at the top corners (the deck itself shows neither); the middle: MASTER, meters, CUE-MIX and PHONES faders,
  crossfader. The pitch reads out under each deck's pitch fader. The effects controller is ONE narrow unit (112 units wide): the
  effect's name between two arrows, ON, four vertical fader columns (the first, LEVEL, works; the others are laid out in the
  geometry for the new effects) and DIV, a vertical stepped note-value selector. No control is drawn that does not work yet. The stop-the-deck alert:
  `main.ts deckBusy` -> `Booth.alertDeck` (a message over that deck for 3 s; the record stays). Drawing costs about 4 ms a frame
  (the static parts are not cached yet: a hardening item). Smokes: `test/live-geometry.test.ts` and the page checks listed in the vault.
- **LIVE hot cues, loops and the zoomable waveform (web only, 19 Nov; step L2).** Under each deck: eight PADS, and in the column beside the
  platter CUES | LOOPS (what the pads are), IN | OUT, 1/2 | x2, LOOP (on/off) and auto loops of 1, 2, 4, 8 beats. A CUES pad: empty = set at the
  needle, set = jump there; a LOOPS pad: empty = keep the loop that is set, set = make it the loop and start it. Shift, alt or right-click on a pad
  clears it. Layout (19 Nov, after Zé's feedback): the CUES | LOOPS tabs are two slim tabs right above the pads; the loop controls are three short rows
  on a four-column grid beside the platter (IN, OUT, LOOP; 1/2, x2; auto loops of 4, 8, 16 and 32 beats: nobody cues 1- or 2-beat loops), never wide. While the record turns, a new mark goes on the nearest beat and a jump keeps the beat PHASE (`Deck.landing`); standing still, a mark is
  exactly where the needle is. Marks live on the `Deck` (`hotCues`, `loopSlots`, `loopStart/loopEnd`, `marks()/setMarks()/onMarks`) and are kept per
  library track (`LibraryTrack.cues/loops`, saved through `library.update`); a record of the game keeps none. The audio thread loops in
  `core/vinyl.ts` (`D.loopStart/loopEnd` in file frames, 0 = off; the seam is a short crossfade, no click) and, in LIVE only, a needle drop while
  the record turns crossfades (`D.smoothSeek`, 64 frames; `Deck.smoothSeek`; the game's booth keeps the hard jump). Both are BIT-IDENTICAL when
  off: `test/vinyl-golden.test.ts` holds the fingerprint of the record reader with loops off, so any change to that path must keep it. The big
  waveform (`live-draw.ts zoomWave`) scrolls under a fixed needle; zoom levels `ZOOM_SECONDS` (whole record, 60, 30, 15, 8, 4, 2 s), kept in
  localStorage `headliner.zoom`; buttons over its corner, the wheel over it, a drag moves the needle (dropped on release). The strip of the WHOLE record
  under it is still the `wave` hit (a touch drops the needle) and shows the cues, the loop and the window the big one shows. `audio/peaks.ts`
  builds the loudness pyramid (4x per level) once at load. New Kinds `pad`, `loop` (`LOOP_ACTIONS`), `zoom`, `zwave` (MIDI-learnable; labels in
  `main.ts labelOf`). Tests: `test/marks.test.ts`, `test/loop.test.ts`, `test/live-geometry.test.ts`, page test in the vault (`marks-e2e`).
- **LIVE master knob = the ROOM only (web only, 19 Nov).** The core's `mixer.master` (a Swift twin; the game's lessons and nights duck the music with it,
  and it scales the headphones too) is untouched. LIVE's knob is `engine.roomVolume` -> `M.roomMaster` -> `MasterSection.runRoom` in `audio/fx.ts`:
  after the effect, on the room bus only (both channels with no phones, the left channel alone in split, the stereo pair with a sound card on the
  phones), so the headphone cue never comes down. Taper `roomGainFor`: unity at 75 % (`ROOM_UNITY`, the knob's default and its double-tap), a straight
  line down to silence, +6 dB (soft-clipped) at the top; exactly unity = untouched, bit for bit. The game's booth forces 75 % (`Booth.setMode` keeps
  LIVE's value for the way back).
- **The "which deck?" popup (19 Nov).** `library/loadpop.ts`: a click on a record (a shelf pick, the front record of an open crate, a list row; the A and
  B buttons of a row still load at once) opens ONE popup beside it: the title, LEFT (cyan) and RIGHT (amber), 104 x 48 px buttons; a deck that plays is
  marked PLAYING and choosing it gives the stop-the-deck message. Esc or a click elsewhere closes it. `WallHooks.busy` comes from main.ts.
- **LIVE knob colours:** the lit ring of a knob is per TYPE, the same on both channels (GAIN red, HI yellow, MID orange, LOW brown, FILTER blue; the FILTER
  also sits in a thin blue outline with no fill). Faders, pads and the deck title keep the deck colours (A cyan, B amber).
- **Title, FREE PLAY and LIVE (19 Nov, evening).** The title has PLAY, FREE PLAY (`showMode("free")`: the game's booth EXACTLY as the deployed site had it before LIVE: the effect bar under the gear
  (the first three effects), a GAIN knob above each fader, the wall of records in front of the room with ROOM / RECORDS to swap it for the crowd, the CRATE sheet with MY MUSIC;
  a lesson or a night is plain iPhone parity: no bar, no knobs, no wall) and LIVE (`openLive()`: `Booth.mode = "live"`). THE ENDING is off the title. `?live` opens the page on ONE button, LIVE (`#start.live-link`;
  until you leave it); the Worker redirects `/headliner/live` to `/headliner/?live` (needs `npm run deploy`). `?autostart` = free play; `?autostart&live` = LIVE with empty
  decks; add `&records` for the game's first two records on the decks (tests); `&playcount=<s>` shortens "a play" (30 s) for tests. LIVE's library has NO game records
  (`WallHooks.game` returns nothing); its decks start empty.
- **LIVE deck header (19 Nov):** title (`label` with `ellipsis`, stops at `titleMax` = `HEADER_RIGHT` units from the right), time, four bar lamps, key (8.4 units, smaller than the
  tempo), tempo (10 units, the deck's colour) at the corner. The mixer has no tempo or key. FILTER is the fifth `knobY` of a strip and sits UNDER the fader, with its name between
  (`filterLabelY`); no outline. Hovering the title shows the whole title (`#deck-tip`, `Booth.hoverTitle`).
- **Crates are DJ flight cases and record bags** (`.w-crate.case` / `.bag`, alternating; CSS only: ribbed shell, latches, handle, corners / flap, buckle, straps; they rise in one
  after the other, the records bob, hover lifts them). **Favourites and plays** (`LibraryTrack.fav/plays`, `WallItem.fav/plays`): the heart is in the popup and the list rows; a
  play = 30 s running on a deck (`liveLoop` in main.ts); `rankShelf` puts favourites first (most played first), then the most played; random picks fill the rest (SHUFFLE = random
  until the page is opened again). **SHARE** (`share.ts`, `#share-button`, LIVE only): link, COPY LINK, the system share sheet when there is one, six networks; the link is
  `SHARE_URL` (the radio) until a DJ has a page of their own. The list lights the record on a deck in that deck's colour (`.l-row.on.ona/.onb`). The page's message (`#note`)
  sits between the stream bar and the buttons in LIVE.
- **Effects strip on top and FX per channel (19 Nov, night).** The effects unit left the gear row: it is a thin strip (30 units) ABOVE the row (`fxGeometry`): the effect's
  name between two arrows (lit green while the effect is on for a channel), four small knobs with NO ring of dots (`knob(..., ring=false)`) each with its name and step to the
  right, a short horizontal LEVEL fader; no ON button. The gear row is three modules now (deck A | mixer | deck B), so the decks are about 20 % wider (breathing space; `u` is
  height-bound, 1.49 at 1440x770; the gear row gets 71 % of the height, the library about 28 %). The effect is switched on PER CHANNEL by a square FX button on the outer side of
  each channel's FILTER knob (`Kind fxSend`, `LiveStrip.fxBtn`; the G key and MIDI `fxOn` toggle both). DSP: `core/mixer.ts renderMix` has an optional send bus (`MixerShared.fxSend`
  per channel, glided, taken AFTER the fader; web only; with it off the mixer is bit for bit what it was: `test/mixer-golden.test.ts` pins three fingerprints), `M.fxSend` slots,
  `MasterSection.fxSendOn` + the bus as the effect's input (insert effects replace the channel's own signal, tail effects echo only that channel); the wet returns to the room and,
  by the cue mix, the headphones. The delay's tempo follows the channel(s) the effect is on for. Free play's bar is unchanged (the whole room: `engine.fxOn`).
  The orange page messages (`#note`) sit under GROOVELINE LIVE in the bar, small, up to two lines, full text in the tooltip.
- **List columns and playlists (19 Nov, night).** The LIST has TIME, TYPE and DATE (all sortable; DATE newest first; the file's modification date). `library/length.ts` reads the
  length from the header at the scan (mp3: Xing/Info/VBRI frame count, else the size over the bitrate sampled along the file; FLAC STREAMINFO; WAV; AIFF; M4A mvhd; Ogg not read);
  checked against 150 real files (FLAC and M4A exact, mp3 111/113 within 1 s of ffprobe, Mixxx's own stored durations were stale for some). `TAGS_VERSION` 3: entries from an older
  reader are read again by `Library.refreshOld` (15 s after the library opens, 3 files at a time; also after RECONNECT or the first record you open, since the browser often
  asks permission again after a reload; measured on 500 real files: 5.9 ms a file before, 7.6 ms with the length, so about 1.3 min for 10,282; the wall has RESCAN too); a rescan now keeps EVERY user field (`USER_FIELDS`: grid, analysis, cues, loops, fav,
  plays; it used to keep only the first two). PLAYLISTS is the wall's third view (`library/playlistview.ts`; data `playlist.ts`, manager `playlists.ts`, store: IndexedDB version 2,
  `playlists`; the upgrade is safe and an old tab lets go of the database: `onversionchange`, `onBlocked` says "close the other tab"). Entries hold the folder NAME + the path inside it
  (not the folder id) + title/artist/length. Add from the which-deck popup (ADD TO PLAYLIST, own music only); NEW, RENAME, reorder, take out, DELETE (asks twice). EXPORT writes an
  extended M3U (.m3u8, UTF-8, paths from the folder that holds your music folders; the browser's save dialog or a plain download), IMPORT reads .m3u8/.m3u from any program: records are
  found by path suffix, then artist + title; what is not found is KEPT (grey, "NOT IN YOUR LIBRARY"). Tests: `playlist.test.ts`, `playlists.test.ts`, `length.test.ts`, page test `playlist-e2e`.
- **The effects unit (19 Nov):** `audio/fx.ts`: seven effects (`FX_TYPES`), four knobs each (`FX_KNOBS`: name, steps; `FX_DEFAULTS`; the `tempo` knob picks the note value, the
  page turns it into `fxDelaySeconds`), `M.fxKnob..+3` in the shared mixer slots; knobs glide (30 ms), NaN/runaway output is dropped and the effect restarts, off = bit-identical
  (tests: every knob changes the sound, extremes stay finite and inside full scale). Delay/reverb/DLY+FLT have a tail and take the sound at their input; the others at their output.
  The filter and FLG+FLT are INSERTS (LEVEL fades between dry and processed). Booth: `fxParam` Kind (MIDI "EFFECT KNOB n"), knobs saved per effect in `headliner.fx`. NOT built yet:
  an ON per channel (A / B / MASTER): see the roadmap in the vault.
- **Layout unit (18 Nov, the game's booth):** `u = min(height share / 210, width / 816)` (816u = the iPhone's gear width), the gear sits at the
  bottom and the room takes the rest; `build()` publishes `--gear-h` (the gear's height in px) and the overlays (lesson, night,
  studio grid) size themselves from it, so fullscreen 16:9 no longer overlaps. FULLSCREEN button in the top bar (hidden where
  the browser has none). Windows below about 1.45:1 (4:3, 5:4) leave an empty band above the gear (the room picture is fixed 3.08:1).
- Booth: `src/booth/booth.ts` draws in SpriteKit's world (y up, CSS pixels), so `BoothScene`'s layout
  numbers, angles and touch arithmetic port unchanged; the room picture and its clips are DOM
  layers under the canvas. Labels use Barlow Condensed (OFL, `web/fonts/`), the same on every system.

## Assets
- `tools/music/make.mjs ID [ID ...]`: synthesizes the original tracks into `App/Tracks/` (+
  `tracks.json`); `--all` re-renders every one, including the approved ones, so name the ids.
  Each record can choose its own sounds (`kit`: kicks deep/punch, metal hats, shaker, snare,
  rim, congas, cowbell, piano, organ, Rhodes, pluck, acid/sub/reese/organ bass, vox chops), its
  own drum patterns (`drums`), sections and mix. Chapter 2's six and chapter 3's six (strings,
  brass, clav, disco bass, square/reed lead, tambourine; major keys) use them; keep new records sounding different from the ones before (Zé, 17 Nov). Appending
  only: lessons use tracks[0] and tracks[1] (122 / 124 BPM).
  Every track starts on a kick at sample 0; the app finds it at load and starts the grid there.
- `tools/art/imagine.py OUT.jpg "prompt" [--aspect 16:9]`: illustrations in the house style.
  Style tests in `art/style-tests/`; pictures the app uses in `App/Art/`.
- `tools/art/animate.py IN.jpg OUT.mp4 "what moves" [--voice ID] [--return] [--silent]`: clips.
  `--voice` + the line in quotes in the prompt = lip-synced speech in a cast voice; `--return`
  makes the clip end on the picture it started from (use this, not the forwards-backwards
  `--loop`, for anything that looks wrong in reverse). `tools/art/story-lines.sh` holds the
  prompts of every spoken line. Check the words of each clip with `voxtype transcribe`.
  Work files go in `/data/headliner-work/` (root disk is nearly full), only finished clips in git.
- **On-camera clips: OpenRouter Omni for every character (Zé, 17 Nov).** Voice-over lines
  without a picture are xAI TTS (`say.sh`: Tó `helios`, Lia `ara`, Nuno `zagan`, Helena `luna`);
  on camera the voice comes from Omni (same voice description every clip). An earlier "Grok
  `--voice` for voice-over characters" rule was Claude's own, never Zé's: Grok made the cold open,
  Nuno's door lines and Helena's first line, and is not used for new clips unless Zé asks.
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
  Do NOT pin the last frame (`--return`) on Omni clips: the model closes the mouth early to land
  on the still while the voice goes on (Zé saw it on Mira, 17 Nov). Give 2 s of slack (a 9 s
  clip for ~7 s of speech), then `trim-line.py --keep-end`.
  `google/veo-3.1-lite` refused our picture ("violates Vertex AI's usage guidelines").
- `tools/voice/say.sh OUT.m4a VOICE "text"`: spoken lines without a picture. `voice/casting/` has every voice
  saying one line, for Zé to cast by ear.
