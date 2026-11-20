#!/bin/bash
# GO LIVE in the stream panel with the REAL mouse (CDP clicks on the real buttons), against a real MediaMTX on this machine (same setup as whip-local.sh / stream-local.sh:
# MediaMTX v1.4.0 with webrtc on 127.0.0.1:8889 and rtsp on 127.0.0.1:8554 is already running). The server's answers (/me/next-slot, /live, /check/mount) are stand-ins with the real
# shapes (bodies/golive-panel.js); the auth stub allows the booking's key and the sound-check key. An ffmpeg reads the stream back twice: while ON AIR, and while ON AIR after a
# SOUND CHECK (so a show started after a check carries music too). Takes about 3 minutes. The dev server must be on :5174.
#   web/tools/pagetests/golive-local.sh [scratch dir]      (PORT=5175 for a dev server on another port)
PORT="${PORT:-5174}"
HERE="$(cd "$(dirname "$0")" && pwd)"; WEB="$HERE/../.."; OUT="${1:-${TMPDIR:-/tmp}}"; KEY=zdb-b1; SIZE=1152x720; URL="http://localhost:$PORT/?autostart&live&records"
cd "$WEB" || exit 1; "$HERE/build.sh" >/dev/null
ALLOWED="$KEY,vcheck-0123456789abcdef0123" node "$HERE/whip-auth-stub.mjs" > "$OUT/golive-auth.log" 2>&1 & AP=$!
trap 'kill $AP 2>/dev/null' EXIT
# where the two buttons are (the panel is laid out for the window size)
POS=$(node tools/shot.ts "$OUT/golive-probe.png" "$URL" --size $SIZE --wait 14 --do "wait 8; eval ['go-live','sound-check'].map(i=>document.getElementById(i).getBoundingClientRect()).map(r=>[Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)])" 2>&1 | grep -oE '\[\[[0-9]+,[0-9]+\],\[[0-9]+,[0-9]+\]\]' | tail -1)
read -r GX GY SX SY <<< "$(echo "$POS" | tr -d '[]' | tr ',' ' ')"
[ -n "$GX" ] && [ -n "$SY" ] || { echo "could not find the buttons: '$POS'"; exit 1; }
echo "GO LIVE at $GX,$GY; SOUND CHECK at $SX,$SY"
G="click $GX $GY"; S="click $SX $SY"
STEPS="run $HERE/built/golive-panel.js; wait 10; $G; wait 1; eval GL.p1(); wait 3; $G; wait 7; eval GL.p2(); wait 9; eval GL.p3(); wait 14; $G; wait 3; eval GL.p4(); wait 2; $G; wait 6; eval GL.p5(); wait 13; eval GL.p6(); wait 3; $S; wait 7; eval GL.p7(); $S; wait 2.5; $G; wait 6; eval GL.p8(); wait 9; eval GL.p9(); wait 14; eval GL.p10(); wait 5; eval GL.p11(); wait 1"
node tools/shot.ts "$OUT/golive-panel.png" "$URL" --size $SIZE --wait 14 --do "$STEPS" 2>&1 | grep --line-buffered -E "console.log: T |run .*:" | sed -u 's/console.log: T //' > "$OUT/golive-page.log" &
PG=$!
for H in HOLD1 HOLD2; do
  for i in $(seq 1 300); do grep -q "^$H" "$OUT/golive-page.log" 2>/dev/null && break; sleep 1; done
  sleep 4
  echo "== reading the stream back ($H)"
  ffmpeg -y -loglevel error -rtsp_transport tcp -i "rtsp://127.0.0.1:8554/live/$KEY" -t 5 -ac 2 -ar 48000 -f f32le "$OUT/golive-read-$H.raw" 2>"$OUT/golive-ffmpeg-$H.log" && node "$HERE/stream-analyze.mjs" "$OUT/golive-read-$H.raw" || { echo "FAIL could not read the stream back ($H)"; cat "$OUT/golive-ffmpeg-$H.log" | head -3; }
done
wait $PG; grep -v '^HOLD' "$OUT/golive-page.log"
