#!/bin/bash
# Gives the whole career to an email address (yours, a friend's, a tester's) without a payment:
#   bash tools/paywall-grant.sh someone@example.com            (the real database)
#   bash tools/paywall-grant.sh someone@example.com --revoke   (takes a gift back)
# The person signs in with that email as usual; this only adds the row. Gifts show as source 'grant'.
set -e
cd "$(dirname "$0")/.."
EMAIL=$(echo "$1" | tr 'A-Z' 'a-z')
[[ "$EMAIL" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Usage: bash tools/paywall-grant.sh email@example.com [--revoke]"; exit 1; }
DB="${HEADLINER_DB_ARGS:---remote}"   # tests: HEADLINER_DB_ARGS="--local --config wrangler.test.toml --persist-to DIR"
NOW="strftime('%s','now')*1000"
if [ "$2" = "--revoke" ]; then
  SQL="UPDATE entitlements SET revoked_at = $NOW WHERE ref = 'grant:$EMAIL' AND revoked_at IS NULL;"
else
  SQL="INSERT OR IGNORE INTO players (id, email, created_at) VALUES (lower(hex(randomblob(12))), '$EMAIL', $NOW);
       INSERT INTO entitlements (player_id, product, source, ref, created_at) SELECT id, 'career', 'grant', 'grant:$EMAIL', $NOW FROM players WHERE email = '$EMAIL'
       ON CONFLICT(ref) DO UPDATE SET revoked_at = NULL;"
fi
wrangler d1 execute headliner-db $DB --command "$SQL"
echo "Done for $EMAIL. (A running Worker notices within a minute.)"
