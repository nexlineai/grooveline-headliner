#!/usr/bin/env bash
# Downloads the latest simulator screenshots from the `shots` branch WITHOUT git (fetching that
# branch put every run's pictures into .git and filled the disk, 17 Nov 2026).
#   scripts/get-shots.sh OUTDIR [name ...]      (names without .png; default: all of them)
set -euo pipefail
out=$1; shift
mkdir -p "$out"
repo=nexlineai/grooveline-headliner
sha=$(git ls-remote "git@github.com:$repo.git" shots | cut -f1)
[ -n "$sha" ] || { echo "no shots branch" >&2; exit 1; }
raw="https://raw.githubusercontent.com/$repo/$sha"
names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  mapfile -t names < <(curl -fsSL "https://api.github.com/repos/$repo/git/trees/$sha" |
    python3 -c 'import sys,json; [print(t["path"][:-4]) for t in json.load(sys.stdin)["tree"] if t["path"].endswith(".png")]')
fi
curl -fsSL "$raw/README.txt" -o "$out/README.txt" && cat "$out/README.txt"
curl -fsSL "$raw/log.txt" -o "$out/log.txt" || true
for n in "${names[@]}"; do curl -fsSL "$raw/$n.png" -o "$out/$n.png" && echo "$out/$n.png"; done
