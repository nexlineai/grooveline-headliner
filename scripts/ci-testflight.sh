#!/usr/bin/env bash
# Signed archive -> App Store Connect (TestFlight). Runs only in the approval-gated `testflight`
# environment, the only place the App Store Connect key exists. Signing is cloud-managed: with the
# key, xcodebuild creates or fetches the distribution certificate and the App Store profile itself.
# Run `xcodegen generate` first.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ASC_KEY_ID:?}" "${ASC_ISSUER_ID:?}" "${ASC_KEY_P8:?}" "${BUILD_NUMBER:?}"
team=TBVQAB4342

keydir="$(mktemp -d)"
trap 'rm -rf "$keydir"' EXIT
key="$keydir/AuthKey_$ASC_KEY_ID.p8"
printf '%s\n' "$ASC_KEY_P8" > "$key"
grep -q "BEGIN PRIVATE KEY" "$key" || { echo "::error::ASC_KEY_P8 is not the text of a .p8 key"; exit 1; }
auth=(-allowProvisioningUpdates -authenticationKeyPath "$key"
      -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")

mkdir -p build
run() {
  local log=$1; shift
  set +e
  "$@" 2>&1 | tee "$log"
  local status=${PIPESTATUS[0]}
  set -e
  scripts/annotate-errors.sh "$log"
  return "$status"
}

run build/archive.log xcodebuild archive -project GroovelineHeadliner.xcodeproj -scheme GroovelineHeadliner \
  -configuration Release -destination 'generic/platform=iOS' -archivePath build/GroovelineHeadliner.xcarchive \
  DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$BUILD_NUMBER" "${auth[@]}"

# The App Store refuses uploads without the privacy manifest.
[ -f build/GroovelineHeadliner.xcarchive/Products/Applications/GroovelineHeadliner.app/PrivacyInfo.xcprivacy ] \
  || { echo "::error::PrivacyInfo.xcprivacy is not in the archive"; exit 1; }

# destination=upload in ExportOptions sends the build straight to App Store Connect.
run build/export.log xcodebuild -exportArchive -archivePath build/GroovelineHeadliner.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export "${auth[@]}"

echo "Uploaded build $BUILD_NUMBER. App Store Connect processes it before TestFlight lists it."
