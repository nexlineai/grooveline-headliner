#!/usr/bin/env bash
# Unsigned device build -> build/GroovelineHeadliner-unsigned.ipa, which iloader can sign and install.
# Run `xcodegen generate` first.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
dd=build/dd
set +e
xcodebuild build -project GroovelineHeadliner.xcodeproj -scheme GroovelineHeadliner -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath "$dd" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CURRENT_PROJECT_VERSION="${BUILD_NUMBER:-1}" \
  2>&1 | tee build/xcodebuild.log
status=${PIPESTATUS[0]}
set -e
scripts/annotate-errors.sh build/xcodebuild.log
[ "$status" -eq 0 ] || exit "$status"

app="$dd/Build/Products/Release-iphoneos/GroovelineHeadliner.app"
# The App Store refuses uploads without the privacy manifest: make sure it reached the bundle.
[ -f "$app/PrivacyInfo.xcprivacy" ] || { echo "::error title=privacy::PrivacyInfo.xcprivacy is not in the app"; exit 1; }
rm -rf build/ipa
mkdir -p build/ipa/Payload
cp -R "$app" build/ipa/Payload/
(cd build/ipa && zip -qry ../GroovelineHeadliner-unsigned.ipa Payload)
ls -lh build/GroovelineHeadliner-unsigned.ipa
