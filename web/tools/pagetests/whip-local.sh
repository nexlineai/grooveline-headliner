#!/bin/bash
# WHIP against a real MediaMTX on this machine (the same v1.4.0 as Carapava, hash-checked), end to end:
#   page (headless Chromium, a 440 Hz tone) --WHIP--> MediaMTX --RTSP--> ffmpeg --> analysis (is it 440 Hz, how loud, how many seconds).
# Needs: a dev server on :5174, MediaMTX with webrtc on 127.0.0.1:8889 and rtsp on 127.0.0.1:8554, an auth stub that allows publish to live/goodkey only.
#   web/tools/pagetests/whip-local.sh [scratch dir]
HERE="$(cd "$(dirname "$0")" && pwd)"; WEB="$HERE/../.."; OUT="${1:-${TMPDIR:-/tmp}}"
cd "$WEB" || exit 1; "$HERE/build.sh" >/dev/null
echo "== refused key"
node tools/shot.ts "$OUT/whip-bad.png" 'http://localhost:5174/?autostart#bad' --size 800x500 --wait 8 --do "run $HERE/built/whip-local.js; wait 9" 2>&1 | grep -E "console.log: T (PASS|FAIL|ERROR|state)" | sed 's/console.log: T //'
echo "== allowed key"
node tools/shot.ts "$OUT/whip-good.png" 'http://localhost:5174/?autostart&hold=22#good' --size 800x500 --wait 8 --do "run $HERE/built/whip-local.js; wait 40" 2>&1 | grep -E "console.log: T (PASS|FAIL|ERROR|state)" | sed 's/console.log: T //' > "$OUT/whip-good.log" &
sleep 16   # the page is live by now (8 s load + connect + 2 s)
ffmpeg -y -loglevel error -rtsp_transport tcp -i rtsp://127.0.0.1:8554/live/goodkey -t 5 -ac 2 -ar 48000 -f f32le "$OUT/whip-read.raw" && node "$HERE/whip-analyze.mjs" "$OUT/whip-read.raw" 440
wait
cat "$OUT/whip-good.log"
