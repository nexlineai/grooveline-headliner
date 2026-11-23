#!/bin/bash
# The OWNER's path in a real browser against the real local Worker (what the hand-made requests of paywall-local.mjs
# cannot show: a browser's own Origin and Referrer rules on the sign-in button, the cookie it keeps, and a chapter 3
# night playing for someone who owns the game). One session: the emailed link -> the button -> the game says who is
# signed in -> a chapter 3 night loads with nothing refused.   web/tools/pagetests/paywall-signin-e2e.sh [port]
HERE="$(cd "$(dirname "$0")" && pwd)"; WEB="$HERE/../.."; PORT="${1:-8792}"; HOST="${2:-127.0.0.1}"
STATE="$(mktemp -d)"; cd "$WEB" || exit 1
"$HERE/build.sh" >/dev/null; [ -f dist/gated.json ] || node tools/build.ts >/dev/null 2>&1
ARGS="--local --config wrangler.test.toml --persist-to $STATE"
wrangler d1 migrations apply headliner-db $ARGS >/dev/null 2>&1 || { echo "FAIL migrations"; exit 1; }
wrangler dev --config wrangler.test.toml --port "$PORT" --persist-to "$STATE" --ip 127.0.0.1 >"$STATE/dev.log" 2>&1 &
DEV=$!; trap 'kill $DEV 2>/dev/null; pkill -P $DEV 2>/dev/null; rm -rf "$STATE"' EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null "http://$HOST:$PORT/headliner/api/me" && break; sleep 1; done
EMAIL="owner$$@example.com"
HEADLINER_DB_ARGS="$ARGS" bash tools/paywall-grant.sh "$EMAIL" >/dev/null 2>&1 || { echo "FAIL grant"; exit 1; }
LINK=$(curl -s -X POST "http://$HOST:$PORT/headliner/api/login" -H 'Content-Type: application/json' -H "Origin: http://$HOST:$PORT" -d "{\"email\":\"$EMAIL\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).link))')
[ -n "$LINK" ] || { echo "FAIL no sign-in link"; exit 1; }
OUT="$STATE/out.log"
timeout 300 node tools/shot.ts "$STATE/x.png" "$LINK" --size 1600x800 --wait 3 --do "eval document.querySelector('button[type=submit]').textContent; eval document.querySelector('button[type=submit]').click(); wait 12; eval document.getElementById('title-account').textContent; eval location.pathname; eval location.search='?autostart&night=saturday-shift&length=30&pw=play&for=30'; wait 14; run $HERE/built/paywall-e2e.js; wait 50" >"$OUT" 2>&1
grep "^console.log: T \(PASS\|FAIL\|ERROR\)" "$OUT" | sed 's/console.log: T //' | cut -c1-200
ok() { if grep -q "$2" "$OUT"; then echo "PASS $1"; else echo "FAIL $1 (wanted: $2)"; fi; }
ok "the sign-in page has its button" 'type=submit.*textContent.*SIGN IN'
ok "the button signed the browser in: the game shows the email" "title-account').textContent = \"$EMAIL\""
ok "and landed on the game, not an error page" 'location.pathname = "/headliner/"'
grep -q "NOT ALLOWED" "$OUT" && echo "FAIL the button was refused (Origin?)"
echo "(sign-in link page: $LINK)" >/dev/null
