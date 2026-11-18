#!/usr/bin/env bash
# App Store screenshots: the app in the iOS Simulator on a Pro Max iPhone (2868x1320 landscape,
# the "iPhone with Dynamic Island (large)" set), JPEG without alpha, into build/store/.
# Run `xcodegen generate` first. Started by .github/workflows/store-shots.yml (a `store-shots-*` tag).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/store
bundle=org.grooveline.headliner
dd=build/dd-store

set +e
xcodebuild build -project GroovelineHeadliner.xcodeproj -scheme GroovelineHeadliner -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$dd" \
  CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION="${BUILD_NUMBER:-1}" \
  2>&1 | tee build/xcodebuild-store.log
status=${PIPESTATUS[0]}
set -e
scripts/annotate-errors.sh build/xcodebuild-store.log
[ "$status" -eq 0 ] || exit "$status"
app="$dd/Build/Products/Debug-iphonesimulator/GroovelineHeadliner.app"

# Newest iOS runtime, the newest "Pro Max" iPhone on it.
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
        if not (name.startswith("iPhone") and name.endswith("Pro Max")):
            continue
        key = (version, name)
        if best is None or key > best[0]:
            best = (key, d["udid"], name, runtime)
if best is None:
    sys.exit("no Pro Max iPhone simulator on this runner")
print(best[1])
print(best[2], best[3], file=sys.stderr)
')
echo "simulator: $udid"
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$app"

shot() { # name, seconds to wait, launch arguments... (every chapter open unless a shot says otherwise)
  local name=$1 wait=$2; shift 2
  xcrun simctl launch "$udid" "$bundle" -unlockAll 1 "$@"
  sleep "$wait"
  # The Pro Max simulator saves a portrait frame (1320x2868) with the landscape game turned 90 degrees
  # clockwise inside it (store-shots-3, seen 18 Nov): turn it back, counter-clockwise.
  xcrun simctl io "$udid" screenshot "build/store/$name.png"
  local w h
  w=$(sips -g pixelWidth "build/store/$name.png" | awk '/pixel/{print $2}')
  h=$(sips -g pixelHeight "build/store/$name.png" | awk '/pixel/{print $2}')
  if [ "$h" -gt "$w" ]; then sips -r 270 "build/store/$name.png" >/dev/null; fi
  xcrun simctl terminate "$udid" "$bundle" || true
  # JPEG: no alpha channel, which App Store Connect refuses.
  sips -s format jpeg -s formatOptions 92 "build/store/$name.png" --out "build/store/$name.jpg" >/dev/null
  rm "build/store/$name.png"
  local size
  size=$(sips -g pixelWidth -g pixelHeight "build/store/$name.jpg" | awk '/pixel/{printf "%s ", $2}')
  echo "$name: $size"
  case "$size" in
    "2868 1320 "|"2796 1290 "|"2736 1260 ") ;;
    # Not fatal: the picture is kept (and pushed) so it can be looked at; the README lists the bad ones.
    *) echo "::warning title=store shot size::$name is $size, not a 6.9-inch landscape size"; echo "$name $size" >> build/store/BAD-SIZES.txt ;;
  esac
}

# Warm-up: the first launch on a fresh simulator is slow and starts in portrait.
xcrun simctl launch "$udid" "$bundle" -unlockAll 1 -screen booth
sleep 8
xcrun simctl terminate "$udid" "$bundle" || true

shot 01-cold-open 6 -screen story -scene cold-open
shot 02-booth 9 -screen booth -demo 1
shot 03-bass-swap 6 -screen lesson -lesson bass-swap
shot 04-saturday-shift 10 -screen night -night saturday-shift -demo 1
shot 05-cave 10 -screen night -night cave-warm-up -demo 1
shot 06-studio 8 -screen lesson -lesson drums -lessonStep 1 -demoPattern 1 -demo 1
shot 07-meridian 10 -screen night -night meridian -demo 1
# The offer at the chapter 3 door: also the In-App Purchase review screenshot (not a store-page picture).
shot 08-unlock-offer 5 -screen chapter -chapter 3 -forceLocked 1 -shotPrice '$4.99'
