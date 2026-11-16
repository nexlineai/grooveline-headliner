#!/usr/bin/env bash
# HeadlinerKit package tests (pure Swift, runs on the macOS host).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
set +e
swift test --package-path Packages/HeadlinerKit 2>&1 | tee build/swift-test.log
status=${PIPESTATUS[0]}
set -e
scripts/annotate-errors.sh build/swift-test.log
# A failed assertion is not a compiler error; surface those lines too.
grep -E 'error: -\[|: error: .*XCTAssert' build/swift-test.log | head -n 10 | sed -e 's/%/%25/g' -e 's#^#::error title=test::#' || true
exit "$status"
