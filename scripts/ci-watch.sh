#!/usr/bin/env bash
# Waits for a workflow run to finish, then prints each job's result and any error annotations.
# No token needed on a public repo.   scripts/ci-watch.sh [run id]   (default: the newest run)
set -uo pipefail
repo=nexlineai/grooveline-headliner
api=https://api.github.com/repos/$repo
run=${1:-$(curl -s "$api/actions/runs?per_page=1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["workflow_runs"][0]["id"])')}
while :; do
  state=$(curl -s "$api/actions/runs/$run" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("status"), d.get("conclusion"))')
  case "$state" in completed*) break;; esac
  sleep 30
done
echo "run $run: $state"
curl -s "$api/actions/runs/$run/jobs" | python3 -c '
import sys, json, urllib.request
for j in json.load(sys.stdin)["jobs"]:
    print("job", j["name"], j["conclusion"])
    for s in j["steps"]:
        if s["conclusion"] not in ("success", "skipped"):
            print("   step:", s["name"], s["conclusion"])
    try:
        notes = json.load(urllib.request.urlopen("https://api.github.com/repos/'$repo'/check-runs/%d/annotations" % j["id"], timeout=20))
    except Exception as e:
        notes = []
        print("   (annotations unavailable:", e, ")")
    for n in notes:
        if n.get("annotation_level") == "failure":
            print("   ", n.get("path"), n.get("start_line"), "|", (n.get("title") or ""), "|", n.get("message", "")[:400])
'
