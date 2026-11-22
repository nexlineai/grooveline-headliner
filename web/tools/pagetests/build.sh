#!/bin/bash
# Builds the page tests: each script in bodies/ goes to built/ (the runner evaluates built/<name>.js in the page).
# Run from anywhere: web/tools/pagetests/build.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HERE/built"
cp "$HERE"/bodies/*.js "$HERE/built/"
echo "built $(ls "$HERE/built" | wc -l) page tests in $HERE/built"
