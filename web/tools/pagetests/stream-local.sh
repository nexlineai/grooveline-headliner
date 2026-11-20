#!/bin/bash
# The SOUND CHECK button against a real MediaMTX on this machine (same setup as whip-local.sh: MediaMTX with webrtc on 127.0.0.1:8889 and rtsp on 127.0.0.1:8554,
# an auth stub that allows the key below), and an ffmpeg that reads back what the server gets, to be sure it is the BOOTH'S music (not silence, not a tone).
#   web/tools/pagetests/stream-local.sh [scratch dir]
HERE="$(cd "$(dirname "$0")" && pwd)"; WEB="$HERE/../.."; OUT="${1:-${TMPDIR:-/tmp}}"; KEY=vcheck-0123456789abcdef0123
cd "$WEB" || exit 1; "$HERE/build.sh" >/dev/null
ALLOWED=$KEY node "$HERE/whip-auth-stub.mjs" > "$OUT/stream-auth.log" 2>&1 & AP=$!
trap 'kill $AP 2>/dev/null' EXIT
node tools/shot.ts "$OUT/stream-panel.png" 'http://localhost:5174/?autostart&live&records&hold=16' --size 1152x720 --wait 14 --do "run $HERE/built/stream-panel.js; wait 70" 2>&1 | grep --line-buffered -E "console.log: T (PASS|FAIL|ERROR|HOLD)" | sed -u 's/console.log: T //' > "$OUT/stream-page.log" &
PG=$!
# wait for the HOLD line, then read the stream back for 5 s
for i in $(seq 1 90); do grep -q "^HOLD" "$OUT/stream-page.log" 2>/dev/null && break; sleep 1; done
sleep 4
ffmpeg -y -loglevel error -rtsp_transport tcp -i "rtsp://127.0.0.1:8554/live/$KEY" -t 5 -ac 2 -ar 48000 -f f32le "$OUT/stream-read.raw" 2>"$OUT/stream-ffmpeg.log" && node "$HERE/stream-analyze.mjs" "$OUT/stream-read.raw"
wait $PG; cat "$OUT/stream-page.log" | grep -v '^HOLD'
