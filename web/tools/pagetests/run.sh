#!/bin/bash
# Runs page tests ONE AT A TIME in the headless browser (tools/shot.ts) against a running dev server and prints the PASS / FAIL lines.
#   web/tools/pagetests/run.sh [--port 5174] [--size 1600x800] [--log FILE] SPEC...
#   SPEC = name:waitSeconds:urlQuery   e.g.  live-e2e:85:'?autostart&live&records'
#   no SPEC = the whole standard suite (suite below), which takes about 25 minutes.
# NEVER run two of these at once (two headless browsers starve each other and timing checks fail).
HERE="$(cd "$(dirname "$0")" && pwd)"; WEB="$HERE/../.."
PORT=5174; SIZE=1600x800; LOG="${TMPDIR:-/tmp}/headliner-pagetests.log"
while [[ "$1" == --* ]]; do case "$1" in --port) PORT=$2; shift 2;; --size) SIZE=$2; shift 2;; --log) LOG=$2; shift 2;; *) shift;; esac; done
"$HERE/build.sh" >/dev/null
L='?autostart&live&records'
SUITE=("live-e2e:85:$L" "marks-e2e:120:$L" "wall-e2e:100:$L" "list-e2e:100:$L" "popup-e2e:70:$L" "new-e2e:80:$L&playcount=2" "playlist-e2e:70:$L" "settings-e2e:90:$L" "stream-tap:60:$L"
       "fx-run:110:$L" "cue-test:60:?autostart" "sleeves-e2e:70:$L" "lib-e2e:90:?autostart" "free-e2e:50:?autostart"
       "lessonfree-e2e:25:?autostart&lesson=first-mix" "title-e2e:34:?x=1" "title-e2e:26:?live")
[ $# -eq 0 ] && set -- "${SUITE[@]}"
: > "$LOG"; cd "$WEB" || exit 1
for spec in "$@"; do
  IFS=: read -r name wait query <<< "$spec"
  echo "== $name $query" | tee -a "$LOG"
  node tools/shot.ts "${TMPDIR:-/tmp}/headliner-pagetest.png" "http://localhost:$PORT/$query" --size "$SIZE" --wait 14 --do "run $HERE/built/$name.js; wait $wait" 2>&1 \
    | grep "^console.log: T \(PASS\|FAIL\|ERROR\)\|ERROR" | sed 's/console.log: T //' | cut -c1-220 | tee -a "$LOG"
done
echo "PASS: $(grep -c '^PASS' "$LOG")  FAIL: $(grep -c '^FAIL\|^ERROR' "$LOG")   (log: $LOG)"
