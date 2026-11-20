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
  crate; no library: a dashed "YOUR MUSIC / OPEN A FOLDER" crate, and it does NOT go away with the first folder: it stays as the last crate, saying "ADD A FOLDER", while a crate slot is free (21 Nov, Zé: "after i import a folder, i dont have any more an option to import music" -> there was no way back to the picker from the wall; MY MUSIC has ADD A FOLDER too). ROOM button = the crowd instead (then a RECORDS pill); choice in `headliner.front`,
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
  a lesson or a night is plain iPhone parity: no bar, no knobs, no wall) and LIVE (`openLive()`: `Booth.mode = "live"`). THE ENDING is off the title. `?live` opens STRAIGHT in the DJ's booth, no game title (`openLiveLink()` in main.ts: `showMode("live")`, then
  `ensureStarted()` and `openLive()`); browsers start sound only after a click or key, so when the sound is blocked a one-line prompt `#sound-gate` ("CLICK ANYWHERE TO START THE SOUND") sits on the booth after 700 ms until the first click (test the blocked case with
  `shot.ts --chromium <wrapper that swaps --autoplay-policy=no-user-gesture-required for document-user-activation-required>`; the normal page tests allow sound); the back arrow leads to the whole title; the Worker redirects `/headliner/live` to `/headliner/?live` (needs `npm run deploy`). `?autostart` = free play; `?autostart&live` = LIVE with empty
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
  height-bound, 1.49 at 1440x770; the gear row gets 71 % of the height, the library about 28 %). The effect is switched on PER CHANNEL by an FX button at the LEFT end (channel A) and the RIGHT end (channel B) of the effects controls (`Kind fxSend`, `LiveFxGeometry.send`, in the channel's colour; they were beside the FILTER knobs until 20 Nov, afternoon; the G key and MIDI `fxOn` toggle both). DSP: `core/mixer.ts renderMix` has an optional send bus (`MixerShared.fxSend`
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
- **Page tests, and where to start (20 Nov).** The browser tests that were in a temp folder are now in `web/tools/pagetests/` (README there): `./run.sh` runs the 20 headless suites one at a time (about 29 min, dev server on :5174; `camera-preview` gets the fake-camera Chromium),
  `mouse-fx.ts` drives controls with the REAL mouse (on 20 Nov the FX buttons and the LEVEL fader were broken while every test was green, because tests called the control directly: drive each new control once with the mouse).
  The effects controls sit in the TOP BAR between the stream bar's 00:00:00 and the page's buttons (KEYS & MIDI ...) when there is room (`fxFitsTheBar`), else in a strip above the gear row (no "EFFECT" label in either); the LEVEL fader is short and follows the pointer 1:1. **Measured, not assumed (20 Nov):** Chrome on Omarchy follows the 1.25 GTK text scaling, so Zé's 1440 x 900 screen at browser 100 % is a **1152 x 720** CSS viewport (125 % browser zoom: about 920 px). The first in-bar layout needed 1266 px and fell back to the strip for him. Now the bar layout is pixels, 310 px wide, inside the top 28 px (the orange `#note` sits under it): name button, four knobs (r 9, name UNDER the knob, step to the right, 42 px each), LEVEL (name under the fader); text sizes use `LiveFxGeometry.text` (fixed in the bar, `u` in the strip). `Booth.barRoom()` measures `#livebar`'s right edge and `#top`'s left edge (so EXIT FULLSCREEN counts) and passes them to `liveGeometry(W, H, room)`; the booth lays out again on `fullscreenchange`, on `document.fonts.ready` and when the bar first shows. Without a measure (unit tests) the worst case is used. It fits from about 1110 px (EXIT FULLSCREEN) / 1075 px (FULLSCREEN); narrower, the strip. Check new bar work at 1152 x 720 with `#fullscreen-button` forced to EXIT FULLSCREEN, not at 1440.
  **A new session starts at the vault note `04_projects/grooveline/notes/2026-11-20-headliner-live-handoff-next-session.md`** (open items in order, pitfalls, how to test and push).
- **SETTINGS, tempo range, MIDI config file, bar clock (20 Nov, afternoon).** In LIVE the bar has ONE button for the old KEYS & MIDI and PHONES: **SETTINGS** (`#settings`, tabs TEMPO | KEYS & MIDI | PHONES; `body.live` hides `#controls-button` / `#phones-button`,
  the game's booth keeps them and has no SETTINGS). `fillControls(body)` and `fillPhones(body)` render into a target element (their own sheets or `#settings-body`; CSS keyed `#settings-body.keys-tab` / `.phones-tab`); `refreshKeys()` redraws whichever shows KEYS & MIDI;
  the `?` key opens SETTINGS on KEYS & MIDI in LIVE. **Tempo fader range**: `Booth.pitchRange` is the setting in LIVE (`PITCH_RANGES` 8, 12, 16, 25, 35, 50 %, `headliner.pitchRange`) and a turntable's 8 % everywhere else (lessons and nights are tuned to it);
  `setPitchRange` keeps each deck's TEMPO and moves the fader to where that tempo now is (clamped at the new end), `setMode` does the same when the range differs; sync, partner and MIDI use `pitchRange` too. **MIDI config file** (`input/midi.ts`):
  SAVE CONFIG downloads `headliner-midi-config.json` (`{app: "grooveline-headliner-midi", version: 1, bindings: {device: Binding[]}}`), IMPORT CONFIG reads one with `parseMidiConfig` (every binding checked: source `type:ch:num` in range, target known to `targetKind`, the KIND comes from the page not
  the file, mode fixed to fit; bad lines skipped and counted, a wrong file refused with words, size and count limits, no `__proto__`); import replaces the controllers named in the file and leaves the others; USE FOR <controller> copies one controller's bindings to another (ALSA, macOS and
  Windows name the same USB controller differently). Tests: `test/midi.test.ts`, page test `settings-e2e`. **Clock**: `#livebar .clock` (HH:MM, 24 h) before OFF AIR. **The bar fits by shedding** (`fitBar` in main.ts, called by `Booth.barRoom()` before every measure): brand name, then the words on SETTINGS and FULLSCREEN (two small icons stay), then the clock, then the words OFF AIR (the dot stays) go until the effects (`BAR_ROOM_NEEDED_PX` = 388) fit between `#livebar` and `#top`; at 1152 px everything is shown (EXIT FULLSCREEN, 12 px to spare); the effects stay in the bar down to about 670 px (measured at 680, 700, 768, ...), narrower the strip (which has the two FX buttons at its ends too). On Zé's 1440 x 900 screen: browser 100 % = 1152 (all shown), 110 % = 1047 and 125 % = 922 (no brand name; icons from 125 %), 133 % = 866, 150 % = 768 (no clock), 175 % and more = 658 or less: the strip (only the OFF AIR word is still there).
- **FX buttons in the bar, wider decks (20 Nov, afternoon).** TOP_BAR is 44 px (`--bar-h`); the effects are 368 px (`BAR_FX_PX`): FX A | name | four knobs (r 10, the name under, the step to the right, 42 px each) | LEVEL | FX B, inside the top 32 px (the orange `#note` is at 33 px under them). The bar's text is bigger (brand 12.5 px, clock and time 12.5, OFF AIR 11) and its rows are level (about 16 px from the top). The mixer lost its FX buttons: `MIXER_W` 196 (was 226), strips at `STRIP_CX` 28, and `DECK_MIN` 311 (was 296), so the total in units (and `u`, and every knob) is unchanged and each deck is 15 units wider. Never put anything on the outer side of the FILTER knobs again without checking the strip margins in `live-geometry.test.ts`.
- **DJ slots: the WHIP publisher (20 Nov, spike; SOUND CHECK and GO LIVE use it, next paragraph).** `src/stream/whip.ts` `WhipPublisher` sends a MediaStream to a WHIP endpoint (MediaMTX) with one RTCPeerConnection: complete offer (no trickle), Opus tuned for music (`tuneOpusSdp`: stereo, 192 kbit/s, FEC on, DTX off), `POST` as `application/sdp`, `Location` = the session, `DELETE` on `stop()`; states idle | connecting | live | reconnecting | failed | stopped;
  a drop is made again with growing waits (until `stop()`), but 400/401/403/404/409/422 are refusals and NOT retried (`whipRefusal` words); "disconnected" gets a grace time. The page must still take ON AIR from the server's `/live`, never from this state. Tests: `test/whip.test.ts` (fake peer and server) and `tools/pagetests/whip-local.sh` (real MediaMTX v1.4.0 on this machine, a tone read back by ffmpeg over RTSP: passed 20 Nov). Plan and findings: the vault `headliner-live-dj-slots-design.md`. The Carapava side (nginx proxy, MediaMTX WebRTC, sync-agent patch, radio fan-out, scripts with backup and rollback, tests) is prepared, tested locally and NOT applied: vault `04_projects/grooveline/notes/dj-slots-server/README.md`. When the page gets its UI, add `https://stream.grooveline.org` to the headliner Worker's `connect-src` (it is `'self'` now). `tools/shot.ts --bypass-csp` ignores a page's CSP (CORS still applies) for trying a real origin.
- **DJ slots: the STREAM panel, SOUND CHECK and GO LIVE (20 Nov; NOT deployed; needs the Worker and agent changes first).** `src/stream/`: `account.ts` (the site's `gl_token` from localStorage; the Worker's JWT body is Latin-1 `btoa`, decode with plain `atob`), `soundcheck.ts` (the private `vcheck-` key from `/check/mount`; nobody hears it), `slot.ts` (`GET /me/next-slot`, times are the SERVER's: the page keeps the offset to the laptop clock), `golive.ts` (`GoLive`: states later / early / on / confirming / connecting / sending / onair / reconnecting / failed / ended; GO LIVE opens only when the slot STARTS (20 Nov: the early 15 minutes used to allow it with two clicks and put a DJ on the radio 7 min before the start; now they are for the SOUND CHECK, and the Worker gives the address only from the start); ON AIR only when `/live` names THIS booking (`booking_id`, a UUID string), polled every 5 s; at the slot's end the audio stops and the panel keeps saying "Your slot has ended" until another slot shows). `engine.broadcastStream()` is the room only, never the headphone cue (SPLIT = the left channel on both sides; the MASTER knob sets its level, at 0 it is silent). `main.ts` block "The STREAM panel": ONE renderer (`renderStream`) draws chip, note and buttons from both parts, from the kept `checkView` / `liveView` (never read a part that may not be built yet): the show wins chip and note while it runs or waits for its second click, the check's words win while it has any, else the slot's; SOUND CHECK is disabled while the show runs; the top bar's dot, word and timer (`#bar-onair`, `#bar-time`) follow the show; `streamVisibility`: leaving LIVE ends a test or a show only after the booth has been away for 1 s; `pagehide` ends both. Seams for tests only: `headliner.streamTest.fetchFn` (all three server calls) and `.whipBase` (replaces `https://stream.grooveline.org/whip` in the address the server gives; `fetchNextSlot` accepts only an `https://` `whip_url`, so stub the real one). CSP `connect-src` in `tools/worker.js` gains `api.grooveline.org` and `stream.grooveline.org`; `tools/serve.ts` does NOT send the CSP, so no local test has exercised it. **Server side** (vault `04_projects/grooveline/notes/dj-slots-server/`, steps `13-worker.sh` then the Worker deploy, then `12-agent-web-keys.sh`, then `npm run deploy`): without the Worker the panel says "Going live from the page is not available yet" (SOUND CHECK still works). Tests: unit `test/slot.test.ts`, `golive.test.ts`, `soundcheck.test.ts`, `account.test.ts`; page tests `stream-tap` (in `run.sh`), `stream-local.sh` (SOUND CHECK, real MediaMTX) and `golive-local.sh` (GO LIVE with the real CDP mouse, 17 checks + 2 music read-backs, about 3 min; NOT in `run.sh`, see `tools/pagetests/README.md`). The first production GO LIVE with a real booking is PUBLIC (Telegram, Discord, Facebook, the recorder): do it on purpose.
- **Master meter in the STREAM panel (20 Nov, Zé: "a volume monitor to see where the master level is").** `#meter` sits beside the panel's rows (vertical, two bars L/R, a held-peak line, the held peak in dB under them, a CLIP light at -0.5 dBFS held 2.5 s). It reads what the RADIO gets: `engine.streamPeaks()` = two AnalyserNodes on the broadcast tap (room only, never the headphone cue; the master knob moves it; at 0 it is empty). Arithmetic in `src/audio/meter.ts` (`Meter`: instant attack, 24 dB/s fall, 1.5 s peak hold, dB -60..0 bent so the top 18 dB get over a third of the height; unit test `test/meter.test.ts`), drawn every frame by `renderMeter()` in main.ts while LIVE is on screen; the colour is the level (green, amber, red), a dark cover hides the part above it (`transform: scaleY`). Page test `meter-panel` (in `run.sh`). The slot line is "13:10-14:10 . in 10 min" (no "starts") so it fits beside the meter; a day-away slot wraps to two lines (not in windows under 540 px high).
- **The camera preview in the PREVIEW row (21 Nov; local only, nothing is published).** `src/stream/camera.ts` gives the panel a picture of the DJ: `CameraPreview` asks `getUserMedia(cameraConstraints(...))` = `{ video: { deviceId: { exact } } or { width: 1280, height: 720 }, audio: false }` and shows the LOCAL `MediaStream` in `<video muted playsinline>` (`video.srcObject` + `play()`), beside the master meter. **Nothing leaves the page:** no `fetch`, no `RTCPeerConnection` (the page test counts both while it opens). **Audio is `false` in every case**, and an audio track a browser might still hand over is stopped and removed before the picture is used: a camera's own microphone must never become the show's audio (the mixer's Opus is the only audio). The row `#camera-bar` holds `#camera-toggle` (ON / OFF / `...` while asking) and, from two cameras on, `#camera-pick`; `enumerateDevices` is read at start-up, again after the first allow (the labels are empty before it, so there is one "Camera 1"), and on `devicechange`; the choice is kept in localStorage `headliner.camera` (every read and write wrapped: a blocked store is fine) and a remembered camera that is gone falls back to the browser's default. Every track is stopped when the button goes OFF, when another camera is chosen, when LIVE is left (`streamVisibility`'s existing 1 s rule) and on `pagehide`. `cameraWords` turns the browser's error names into plain words in the panel's note ("Camera blocked: allow the camera for this page (the padlock or the camera icon in the address bar, then RELOAD)", no camera, camera busy, a page that is not https/localhost); a camera message wins the note over the show's and the check's until the camera clears it. **Layout:** five rows and a 16:9 picture do not fit in 276 x 248 px, so while the picture is on the panel hides the facts (SLOT, ON AIR, LISTENERS, BITRATE: the top bar keeps the timer and the chip) and `.s-body` grows; the video is a real 16:9 box (`width: auto; height: auto; aspect-ratio: 16/9` with both max constraints, `object-fit: cover`) that fits what is left beside the 30 px meter. In windows under 540 px high there is no room for a picture at all, so it stays off screen and the row says "no room for the picture in this window". Page test `camera-preview` (in `run.sh`, 16 checks: off by default, one live video track and NO audio track, the mouse reaches the button, no connection and no request, 16:9 beside the meter, the rows giving way, OFF ends the track and brings the rows back, a blocked camera's words, leaving LIVE ends it) in Chromium's **fake** camera: `tools/pagetests/camera-fake.sh` adds `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` to `shot.ts --chromium` (run.sh passes it for that spec only: a test must never open Zé's hardware). Unit tests `test/camera.test.ts`. **No CSP change, checked:** a MediaStream assigned to `srcObject` is not a URL the page fetches; the page was loaded through a local proxy that adds the production CSP (`media-src 'self' blob:`, copied from `tools/worker.js`) with the fake camera, and the picture played.
- **The camera as VIDEO in a show (phase 2: SPIKE on branch `camera-publish`, 21 Nov, NOT merged, NOT deployed, off without a flag).** `WhipPublisher` gained `video`, `videoBitrate` (default 1.5 Mbit/s) and `videoCodecs`: the camera's track is added with `addTransceiver({ direction: "sendonly" })` in the SAME connection as the mixer, and `h264First(codecs)` puts H264 at the head of the video codec list so the server can repackage instead of re-encoding. `CameraPreview.track` is the picture's track; `main.ts` sends it only with `?publishCamera` (`cameraForShow`), so a normal show is unchanged. The preview still OWNS its track: switching the preview off ends the video of a show mid-set (a phase-2 job is moving the track to the show). With `?publishCamera` a show or a check **turns the camera on by itself** (`ensureCameraForShow` in the button handlers) and the PREVIEW row's label reads "PREVIEW · IN SHOW" while a connection is up: a track is added once, at connect time, so a show started with the preview off went out as audio only (Zé, 21 Nov: MediaMTX logged `1 track (Opus)` for a video slot). Measured locally, one headless Chromium, MediaMTX v1.4.0 on this machine with `hlsVariant: fmp4`: sound check went to `sending`, the playlist appeared ~3 s later with `CODECS="avc1.42c01e,opus"`, hls.js (the site's own 1.5.15) played it 480x279, `readyState 4`, 4 fragments, 143 KB audio + 111 KB video decoded; ffprobe over RTSP saw `h264 960x540` + `opus 48000 stereo`. So a page camera needs **no re-encode**: only fMP4 instead of `mpegts` (which cannot carry Opus) plus a Worker that tells the site a web booking has video (it probes the playlist for rtmp bookings only). Safari/iOS untested. The old plan text here said the same thing three times; this paragraph is the record now.

- **Now playing for the site's player (20 Nov, option B for the stream titles).** An Ogg mount takes no title from outside (Icecast 2.4.4: `format_ogg.c set_tag = NULL`) and chained titles would cut the recorder (`ffmpeg -c copy` stops at the first chain link) and dip the audio ~20 ms, so the page tells the WORKER and the site reads it from `/live`. `src/stream/nowplaying.ts`: `NowPlayingPicker` (the deck the ROOM hears: `engine.decks[d].volume` >= 0.12, really playing, with a title; the other deck must be clearly louder for 8 s before the title changes) and `NowPlaying` (POST `https://api.grooveline.org/me/now-playing` {booking_id, artist, title} with the sign-in, on change and every 60 s, retry after 15 s; only while GoLive is sending/on air for a booking: `goLive.sendingBookingId`; a sound check has none). Wired in main.ts in the 1 s interval. The title is `track.title || file name`, `track.artist`. Server side (vault `dj-slots-server/`): step `15-worker-now-playing.sh` (Worker: the route, the `now_playing` table made on first update, `now_playing` in `/live`, fresh for 4 minutes) and `16-site-now-playing.sh` (the site's `pollTrack`: the stream's own title wins, else `/live` now_playing). Tests: `test/nowplaying.test.ts`, the Worker's `now-playing.test.mjs`, the site's `site-poll.test.mjs`.
- **Library text size and the busy rule (20 Nov).** The library's text (its top row, the LIST, the PLAYLISTS) uses `--wz` = the wall's fit scale `--ws` x the player's zoom (A- / A+ in the top row, steps of 12.5 %, 75-225 %,
  default 125 %, kept in `headliner.libZoom`); the wall's shelf and crates keep `--ws`. A deck counts as BUSY (the "stop the deck first" message, the PLAYING mark in the popup) only while its record really
  plays: a record that has FINISHED keeps `motorOn` and `rate` 1 with the needle at the end, in silence, so `main.ts deckPlaying` also requires `progress < 0.995`; a playlist can load the next record onto it.
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
  Work files go in `work/` in this repo (gitignored, never committed; moved here from
  `/data/headliner-work` on 21 Nov 2026 at Zé's request so all Headliner work sits under the
  project), only finished clips in git.
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
