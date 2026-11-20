#!/bin/bash
# Builds the page tests: each script in bodies/ gets the fixtures it needs put in front (a base64 object), and goes to built/.
#   SL    = the four small mp3 files + a picture (fixtures/): a made-up music folder for the library tests
#   FILES = four of the unit tests' fixtures (../../test/fixtures): tags in mp3 / flac / m4a / aiff
# Run from anywhere: web/tools/pagetests/build.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HERE/built"
python3 - "$HERE" <<'PY'
import base64, os, sys
here = sys.argv[1]
def obj(name, files):
    return f"const {name} = {{" + ", ".join(f'"{os.path.basename(p)}": "{base64.b64encode(open(p, "rb").read()).decode()}"' for p in files) + "};\n"
fx = lambda *n: [os.path.join(here, "fixtures", x) for x in n]
tf = lambda *n: [os.path.join(here, "..", "..", "test", "fixtures", x) for x in n]
SL = obj("SL", fx("embedded.mp3", "folder1.mp3", "folder2.mp3", "bare.mp3", "blue.jpg"))
FILES = obj("FILES", tf("v23.mp3", "tagged.flac", "itunes.m4a", "plain.aiff"))
needs_sl = {"marks-e2e", "list-e2e", "popup-e2e", "new-e2e", "playlist-e2e", "wall-e2e", "sleeves-e2e", "look-library"}
needs_files = {"lib-e2e"}
for f in sorted(os.listdir(os.path.join(here, "bodies"))):
    name = f[:-3]
    body = open(os.path.join(here, "bodies", f)).read()
    pre = SL if name in needs_sl else FILES if name in needs_files else ""
    open(os.path.join(here, "built", f), "w").write(pre + body)
print("built", len(os.listdir(os.path.join(here, "built"))), "page tests in", os.path.join(here, "built"))
PY
