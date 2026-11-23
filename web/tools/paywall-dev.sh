#!/bin/bash
# Try the paywall on THIS machine (nothing is deployed): the real Worker with the paywall ON, a local database,
# and no email: the sign-in link is shown on the page instead.
#   bash tools/paywall-dev.sh                 then open http://localhost:8788/headliner/?unlockAll=1
#                                             (PLAY, then the lock dot of chapter 3: the offer)
#   bash tools/paywall-dev.sh grant EMAIL     (another terminal) pretend that email has paid
#   bash tools/paywall-dev.sh revoke EMAIL    take it back (a refund)
# Paddle's own checkout cannot run here (it needs the Paddle sandbox account): granting is how you see the unlocked game.
cd "$(dirname "$0")/.." || exit 1
ARGS="--local --config wrangler.test.toml"   # the same local database for wrangler dev and these commands (.wrangler/state, not committed)
case "$1" in
  grant)  HEADLINER_DB_ARGS="$ARGS" exec bash tools/paywall-grant.sh "$2" ;;
  revoke) HEADLINER_DB_ARGS="$ARGS" exec bash tools/paywall-grant.sh "$2" --revoke ;;
esac
node tools/build.ts 2>&1 | grep -v -i "warning\|trace-warnings" | tail -3
wrangler d1 migrations apply headliner-db $ARGS >/dev/null 2>&1 || { echo "could not prepare the local database"; exit 1; }
echo "Open  http://localhost:8788/headliner/?unlockAll=1   (Ctrl+C stops it)"
# wrangler 4.125's dev proxy sometimes dies with "Network connection lost" when a browser drops a request: start it again.
# A trap only runs when the foreground child ends, so wrangler runs in the background and is waited for: Ctrl+C then stops both.
trap 'kill $WR 2>/dev/null; exit 0' INT TERM
while true; do
  wrangler dev --config wrangler.test.toml --port 8788 --ip 127.0.0.1 &
  WR=$!; wait $WR
  echo "wrangler stopped; starting it again (Ctrl+C to quit) ..."; sleep 1
done
