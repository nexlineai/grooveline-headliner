#!/usr/bin/env bash
# Runs the app in the iOS Simulator and photographs each screen into build/shots/.
# This is how the game gets looked at: nothing can be built or run on the Linux dev machine.
# Run `xcodegen generate` first.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/shots
bundle=org.grooveline.headliner
dd=build/dd-sim

set +e
xcodebuild build -project GroovelineHeadliner.xcodeproj -scheme GroovelineHeadliner -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$dd" \
  CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION="${BUILD_NUMBER:-1}" \
  2>&1 | tee build/xcodebuild-sim.log
status=${PIPESTATUS[0]}
set -e
scripts/annotate-errors.sh build/xcodebuild-sim.log
[ "$status" -eq 0 ] || exit "$status"
app="$dd/Build/Products/Debug-iphonesimulator/GroovelineHeadliner.app"

# Newest iOS runtime, a plain iPhone if there is one.
udid=$(xcrun simctl list devices available -j | python3 -c '
import json, sys, re
best = None
for runtime, devices in json.load(sys.stdin)["devices"].items():
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    if not m:
        continue
    version = (int(m.group(1)), int(m.group(2)))
    for d in devices:
        name = d["name"]
        if not name.startswith("iPhone"):
            continue
        plain = re.fullmatch(r"iPhone \d+", name) is not None
        key = (version, plain, name)
        if best is None or key > best[0]:
            best = (key, d["udid"], name, runtime)
if best is None:
    sys.exit("no iPhone simulator on this runner")
print(best[1])
print(best[2], best[3], file=sys.stderr)
')
echo "simulator: $udid"
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$app"

shot() { # name, seconds to wait, launch arguments... (every chapter open unless -unlockAll is given)
  local name=$1 wait=$2; shift 2
  if [[ " $* " == *" -unlockAll "* ]]; then
    xcrun simctl launch "$udid" "$bundle" "$@"
  else
    xcrun simctl launch "$udid" "$bundle" -unlockAll 1 "$@"
  fi
  sleep "$wait"
  xcrun simctl io "$udid" screenshot "build/shots/$name.png"
  xcrun simctl terminate "$udid" "$bundle" || true
}
shot title 6
shot chapter 5 -screen chapter -demoProgress 1 -unlockAll 0
shot chapter-locked 5 -screen chapter -chapter 1 -unlockAll 0
shot chapter3 5 -screen chapter -chapter 3
shot chapter2 5 -screen chapter -chapter 2
shot booth 9 -screen booth -demo 1
shot lesson 6 -screen lesson
shot lesson2 6 -screen lesson -lesson on-the-phrase
shot lesson3 6 -screen lesson -lesson bass-swap
shot lesson4 6 -screen lesson -lesson in-your-ears
shot lesson-sync 6 -screen lesson -lesson sync-off
shot lesson-ear 6 -screen lesson -lesson by-ear
shot lesson-hold 6 -screen lesson -lesson hold-it
shot shop-night 10 -screen night -night saturday-shift -demo 1
shot chapter4 5 -screen chapter -chapter 4
shot lesson-long 6 -screen lesson -lesson long-blend
shot pub-night 10 -screen night -night empty-tuesday -demo 1
shot chapter5 5 -screen chapter -chapter 5
shot lesson-air 6 -screen lesson -lesson on-air
shot lesson-air-news 8 -screen lesson -lesson on-air -lessonStep 4
shot radio-night 10 -screen night -night thursday-show -demo 1
shot chapter6 5 -screen chapter -chapter 6
shot lesson-warm 6 -screen lesson -lesson warm-up
shot lesson-warm-pick 6 -screen lesson -lesson warm-up -lessonStep 2 -crate 1
shot cave-night 10 -screen night -night cave-warm-up -demo 1
shot story-nuno-door 5 -screen story -scene nuno
shot chapter7 5 -screen chapter -chapter 7
shot lesson-keys 6 -screen lesson -lesson keys
shot lesson-keys-pick 6 -screen lesson -lesson keys -lessonStep 4 -crate 1
shot friday-night 10 -screen night -night friday-cave -demo 1
shot story-helena 5 -screen story -scene helena
shot lesson-filter 6 -screen lesson -lesson filter -lessonStep 1
shot lesson-tempo 6 -screen lesson -lesson tempo -lessonStep 4
shot afterhours-night 10 -screen night -night afterhours -demo 1
shot story-vex 5 -screen story -scene vex
shot chapter8 5 -screen chapter -chapter 8
shot lesson-drums 8 -screen lesson -lesson drums -lessonStep 1 -demoPattern 1 -demo 1
shot lesson-synth 6 -screen lesson -lesson synth -lessonStep 2 -studioPage 1
shot lesson-dubplate 6 -screen lesson -lesson dubplate -lessonStep 1
shot dub-night 10 -screen night -night dubplate-night -demo 1
shot dub-crate 6 -screen night -night dubplate-night -crate 1
shot chapter9 5 -screen chapter -chapter 9
shot lesson-booth 6 -screen lesson -lesson borrowed-booth
shot berlin-night 10 -screen night -night berlin-night -demo 1
shot story-joli 5 -screen story -scene joli
shot lesson-switch 6 -screen lesson -lesson genre-switch -lessonStep 3
shot ibiza-night 10 -screen night -night ibiza-night -demo 1
shot ibiza-crate 6 -screen night -night ibiza-night -crate 1
shot burnout-night 10 -screen night -night burnout -demo 1
shot chapter10 5 -screen chapter -chapter 10
shot lesson-delay 6 -screen lesson -lesson delay
shot sunset-night 10 -screen night -night sunset-slot -demo 1
shot story-carla 5 -screen story -scene carla
shot three-pm-night 10 -screen night -night three-pm -demo 1
shot tent-night 10 -screen night -night tent-rain -demo 1
shot forest-night 10 -screen night -night forest-stage -demo 1
shot chapter11 5 -screen chapter -chapter 11
shot story-helena-b2b 4 -screen story -scene helena-b2b
shot lesson-b2b 8 -screen lesson -lesson b2b
shot lesson-b2b-pick 6 -screen lesson -lesson b2b -lessonStep 1 -crate 1
shot boat-night 10 -screen night -night boat-party -demo 1
shot story-vex-poster 4 -screen story -scene vex-poster
shot vex-night 10 -screen night -night vex-b2b -demo 1
shot chapter12 5 -screen chapter -chapter 12
shot story-carla-meridian 4 -screen story -scene carla-meridian
shot lesson-skip 8 -screen lesson -lesson skip
shot bag 5 -screen bag -demoBag 1
shot before-night 10 -screen night -night night-before -demo 1
# A packed bag (out of catalogue order, dubplate first): decks = its first two, crate = its order.
shot packed-night 8 -screen night -night night-before -demo 1 -demoClosingSet your-dubplate,meridiano,saturday-job,ponte,telhado,nove-anos
shot packed-crate 6 -screen night -night night-before -crate 1 -demoClosingSet your-dubplate,meridiano,saturday-job,ponte,telhado,nove-anos
shot story-back-to-meridian 4 -screen story -scene back-to-meridian
shot meridian-night 10 -screen night -night meridian -demo 1
shot meridian-packed 6 -screen night -night meridian -crate 1 -demoClosingSet ponte,saturday-job,meridiano,telhado,nove-anos,bastidores
shot story-meridian-end 4 -screen story -scene meridian-end
shot credits 25 -screen credits
shot credits-zdb 5 -screen credits -creditsPhase zdb
shot lesson-requests 6 -screen lesson -lesson requests
shot garage 10 -screen night -night garage-party -demo 1
shot garage-crate 6 -screen night -night garage-party -crate 1
shot night 12 -screen night -demo 1
shot night-end 30 -screen night -demo 1
shot crate 6 -screen booth -crate 1
shot phones 6 -screen booth -phones 1 -phonesMode 1 -demo 1
shot story-nuno 5 -screen story -scene cold-open
# Four seconds in, Lia is in the middle of her first line (a clip with her voice in it).
shot story-lia 4 -screen story -scene white-label
shot story-dani 3 -screen story -scene dani
shot story-mira 3 -screen story -scene mira-lights

# What the app logged (audio engine, track loading), for reading next to the pictures.
xcrun simctl spawn "$udid" log show --last 3m --style compact --info --debug \
  --predicate 'subsystem == "org.grooveline.headliner"' 2>/dev/null | tail -n 60 > build/shots/log.txt || true
xcrun simctl shutdown "$udid" || true
# Landscape apps come out sideways on a portrait simulator; turn them upright.
for f in build/shots/*.png; do
  w=$(sips -g pixelWidth "$f" | awk '/pixelWidth/ {print $2}')
  h=$(sips -g pixelHeight "$f" | awk '/pixelHeight/ {print $2}')
  [ "$h" -gt "$w" ] && sips -r 270 "$f" >/dev/null
done
ls -l build/shots
