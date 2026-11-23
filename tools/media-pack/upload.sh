#!/bin/bash
# Puts the career pack into the R2 bucket (Zé runs this: it writes to his Cloudflare account):
#   bash tools/media-pack/upload.sh [--repo DIR]           make the manifest, create the bucket if needed, upload everything
# Safe to run again: objects are content-addressed (pack/<sha256>.<ext>), so an upload never changes an existing object, and a
# ledger (tools/media-pack/out/uploaded.txt) skips what is already there. Then it uploads pack/manifest.json (the only mutable object).
# Env: BUCKET (default headliner-media), WR_FLAGS (default --remote; tests use "--local --persist-to DIR"), LIMIT (tests: only the first N files).
set -e
cd "$(dirname "$0")/../.."
BUCKET="${BUCKET:-headliner-media}"; WR_FLAGS="${WR_FLAGS:---remote}"
REPO="$HOME/PROJECTS/grooveline/headliner"; [ "$1" = "--repo" ] && REPO="$2"
# LIMIT is a test knob: it would leave a manifest naming files that are not there. Never with the real bucket.
[ -n "$LIMIT" ] && [[ "$WR_FLAGS" == *--remote* ]] && { echo "LIMIT is only for local tests (WR_FLAGS=--local ...)"; exit 1; }
node tools/media-pack/make-manifest.mjs --repo "$REPO" 2>&1 | grep -v -i "warning\|trace-warn"
OUT=tools/media-pack/out; LEDGER=$OUT/uploaded.txt; touch "$LEDGER"

if [[ "$WR_FLAGS" == *--remote* ]]; then
  wrangler r2 bucket create "$BUCKET" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -i -E "created|already exists" | head -1 || true
fi

total=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).files.length)' $OUT/pack-manifest.json)
n=0
while IFS=$'\t' read -r key path type; do
  n=$((n+1))
  [ -n "$LIMIT" ] && [ "$n" -gt "$LIMIT" ] && break
  grep -qxF "$key" "$LEDGER" && continue
  wrangler r2 object put "$BUCKET/$key" --file "$REPO/App/$path" --content-type "$type" --cache-control "public, max-age=31536000, immutable" $WR_FLAGS >/dev/null 2>&1 \
    || { echo "FAILED $path (stopping; run again to resume)"; exit 1; }
  echo "$key" >> "$LEDGER"
  printf '\r%d / %d  %s              ' "$n" "$total" "$path"
done < <(node -e 'for (const f of JSON.parse(require("fs").readFileSync(process.argv[1])).files) console.log([f.key, f.path, f.type].join("\t"))' $OUT/pack-manifest.json)
echo
wrangler r2 object put "$BUCKET/pack/manifest.json" --file $OUT/pack-manifest.json --content-type application/json --cache-control "public, max-age=300" $WR_FLAGS >/dev/null 2>&1 || { echo "FAILED the manifest"; exit 1; }
echo "Done: ${LIMIT:-$total} of $total files and pack/manifest.json are in the bucket $BUCKET."
echo "The bucket stays PRIVATE (no custom domain, no r2.dev): the Headliner Worker serves it to buyers and testers (see tools/media-pack/README.md)."
