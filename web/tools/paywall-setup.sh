#!/bin/bash
# The paywall's one-time setup, run by Zé from web/ with his Cloudflare login (it creates things in his account):
#   bash tools/paywall-setup.sh            database + session secret + email key
#   bash tools/paywall-setup.sh paddle     the Paddle notification secret (after the Paddle account exists)
# Safe to run again: it never deletes anything, and an existing database or secret is kept.
# It does NOT deploy and does NOT switch the paywall on (PAYWALL stays "off" in wrangler.toml).
set -e
cd "$(dirname "$0")/.."
NAME=headliner-db

secret_exists() { wrangler secret list --config wrangler.toml 2>/dev/null | grep -q "\"name\": \"$1\""; }

if [ "$1" = "paddle" ]; then
  echo "Paste the notification destination's SECRET KEY from Paddle (Developer tools > Notifications), then Enter:"
  wrangler secret put PADDLE_WEBHOOK_SECRET --config wrangler.toml
  exit 0
fi

# 1. The database (its id goes into wrangler.toml, replacing the commented block).
if grep -q '^# \[\[d1_databases\]\]' wrangler.toml; then
  ID=$(wrangler d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s).find(d=>d.name==="'$NAME'");if(r)console.log(r.uuid)}catch{}})')
  if [ -z "$ID" ]; then
    echo "Creating the database $NAME ..."
    ID=$(wrangler d1 create $NAME 2>&1 | grep -o 'database_id = "[^"]*"' | head -1 | cut -d'"' -f2)
  else
    echo "The database $NAME exists already ($ID)."
  fi
  [ -n "$ID" ] || { echo "Could not get the database id. Run: wrangler d1 create $NAME   and put its id in wrangler.toml"; exit 1; }
  python3 - "$ID" <<'PY'
import re, sys
p = "wrangler.toml"
s = open(p).read()
s = re.sub(r'# \[\[d1_databases\]\]\n# binding = "DB"\n# database_name = "headliner-db"\n# database_id = "[^"\n]*"\n# migrations_dir = "migrations"',
           '[[d1_databases]]\nbinding = "DB"\ndatabase_name = "headliner-db"\ndatabase_id = "%s"\nmigrations_dir = "migrations"' % sys.argv[1], s)
open(p, "w").write(s)
PY
  echo "wrangler.toml now has the database. Commit that change."
fi

# 2. The tables.
wrangler d1 migrations apply $NAME --remote --config wrangler.toml

# 3. Secrets (the values are never printed or saved in a file).
if secret_exists SESSION_SECRET; then echo "SESSION_SECRET is set."; else
  openssl rand -base64 48 | tr -d '\n' | wrangler secret put SESSION_SECRET --config wrangler.toml
fi
if secret_exists RESEND_API_KEY; then echo "RESEND_API_KEY is set."; else
  echo "Paste a Resend API key (it sends the sign-in emails from headliner@grooveline.org; a key limited to sending is enough), then Enter:"
  wrangler secret put RESEND_API_KEY --config wrangler.toml
fi
echo
echo "Done. Next: npm run deploy (the paywall stays OFF), then try it in your own browser: grooveline.org/headliner/api/preview?on=1"
