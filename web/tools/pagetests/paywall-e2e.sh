#!/bin/bash
# A stranger plays chapters 1-2 against the REAL Worker (workerd + local D1) with the paywall ON:
# not one file the game asks for may be refused, and a chapter 3 night must be (the control, so a
# green run cannot mean the gate is off). About 10 minutes; ONE headless browser at a time.
#   web/tools/pagetests/paywall-e2e.sh [port [only-specs-containing]]        (not in run.sh: it starts its own Worker)
HERE="$(cd "$(dirname "$0")" && pwd)"; WEB="$HERE/../.."; PORT="${1:-8788}"; ONLY="${2:-}"   # ONLY: run just the specs whose query contains this (e.g. pw=data)
STATE="$(mktemp -d)"; LOG="$STATE/dev.log"; cd "$WEB" || exit 1
"$HERE/build.sh" >/dev/null
[ -f dist/gated.json ] || node tools/build.ts >/dev/null 2>&1
wrangler d1 migrations apply headliner-db --local --config wrangler.test.toml --persist-to "$STATE" >/dev/null 2>&1 || { echo "FAIL migrations"; exit 1; }
wrangler dev --config wrangler.test.toml --port "$PORT" --persist-to "$STATE" --ip 127.0.0.1 >"$LOG" 2>&1 &
DEV=$!; trap 'kill $DEV 2>/dev/null; pkill -P $DEV 2>/dev/null; rm -rf "$STATE"' EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/headliner/api/me" && break; sleep 1; done
curl -s "http://127.0.0.1:$PORT/headliner/api/me" | grep -q '"paywall":true' || { echo "FAIL the Worker is not up with the paywall on"; tail "$LOG"; exit 1; }
RUNS=(
  "?autostart&lesson=first-mix&pw=play&for=75|bot|85"
  "?autostart&lesson=on-the-phrase&pw=play&for=75|bot|85"
  "?autostart&lesson=bass-swap&pw=play&for=75|bot|85"
  "?autostart&lesson=in-your-ears&pw=play&for=60|bot|70"
  "?autostart&lesson=requests&pw=play&for=75|bot|85"
  "?autostart&night=first-party&length=45&pw=play&for=70|bot|80"
  "?autostart&night=garage-party&length=45&pw=play&for=70|bot|80"
  "?autostart&pw=stories||330"
  "?autostart&pw=data||90"
  "?autostart&pw=tracks||60"
  "?autostart&night=saturday-shift&length=30&pw=control||40"
)
for spec in "${RUNS[@]}"; do
  [ -n "$ONLY" ] && [[ "$spec" != *"$ONLY"* ]] && continue
  IFS='|' read -r query bot secs <<< "$spec"
  echo "== $query"
  DO="run $HERE/built/paywall-e2e.js; wait $secs"; [ -n "$bot" ] && DO="run $WEB/tools/bot.js; run $HERE/built/paywall-e2e.js; wait $secs"
  timeout 600 node tools/shot.ts "$STATE/x.png" "http://127.0.0.1:$PORT/headliner/$query" --size 1600x800 --wait 14 --do "$DO" 2>&1 \
    | grep "^console.log: T \(PASS\|FAIL\|ERROR\|story\)" | sed 's/console.log: T //' | cut -c1-240 | tee -a "$STATE/all.log"
done
echo "PASS: $(grep -c '^PASS' "$STATE/all.log")  FAIL: $(grep -c '^FAIL\|^ERROR' "$STATE/all.log")"
grep -q '^FAIL\|^ERROR' "$STATE/all.log" && exit 1; exit 0
