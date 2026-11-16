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

shot() { # name, seconds to wait, launch arguments...
  local name=$1 wait=$2; shift 2
  xcrun simctl launch "$udid" "$bundle" "$@"
  sleep "$wait"
  xcrun simctl io "$udid" screenshot "build/shots/$name.png"
  xcrun simctl terminate "$udid" "$bundle" || true
}
shot title 6
shot booth 9 -screen booth -demo 1
shot lesson 6 -screen lesson
shot lesson2 6 -screen lesson -lesson on-the-phrase
shot lesson3 6 -screen lesson -lesson bass-swap
shot crate 6 -screen booth -crate 1
shot phones 6 -screen booth -phones 1 -phonesMode 1 -demo 1
shot story-nuno 5 -screen story -scene cold-open
# Four seconds in, Lia is in the middle of her first line (a clip with her voice in it).
shot story-lia 4 -screen story -scene white-label

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
