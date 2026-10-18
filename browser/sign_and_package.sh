#!/usr/bin/env bash
# Signs NODE Chromium.app and packages it as a .dmg. Called by build.sh.
# Adapted from ungoogled-chromium-macos's sign_and_package_app.sh (BSD-3-Clause)
# for NODE's app, framework and helper names.
#
#   APP=".../NODE Chromium.app" ENTITLEMENTS=".../entitlements" sign_and_package.sh out.dmg
#
# Signing: ad hoc by default, so the app runs on this Mac and opens elsewhere
# with Open Anyway (as for the Electron build, see docs/09-releasing.md). With
# MACOS_CERTIFICATE_NAME set to a Developer ID Application certificate in the
# keychain, it signs with that; set NOTARIZE=1 plus APPLE_ID, APPLE_TEAM_ID and
# APPLE_APP_SPECIFIC_PASSWORD to notarize and staple as well.
set -euo pipefail

dmg="${1:?usage: sign_and_package.sh out.dmg}"
app="${APP:?set APP to the .app path}"
ent="${ENTITLEMENTS:?set ENTITLEMENTS to ungoogled-chromium-macos/entitlements}"
src_dir="$(cd "$app/../../.." && pwd)"   # .../build/src (app is in out/Default)
bundle_id="app.node.chromium"
framework="$app/Contents/Frameworks/NODE Chromium Framework.framework"
helpers="$framework/Helpers"
libraries="$framework/Libraries"
cert="${MACOS_CERTIFICATE_NAME:-}"

sign() {
  if [[ -z "$cert" ]]; then
    codesign --sign - --force "$@"
  else
    codesign --sign "$cert" --force --timestamp "$@"
  fi
}

# Stops macOS asking about incoming network connections on every start
# (ungoogled-chromium-macos issue 17).
xattr -cs "$app"

sign --identifier chrome_crashpad_handler --options=restrict,library,runtime,kill "$helpers/chrome_crashpad_handler"
for helper in "$helpers"/*.app; do
  name="$(basename "$helper" .app)"
  case "$name" in
    *"(Renderer)") sign --identifier "$bundle_id.helper.renderer" --options restrict,kill,runtime --entitlements "$ent/helper-renderer-entitlements.plist" "$helper" ;;
    *"(GPU)") sign --identifier "$bundle_id.helper" --options restrict,kill,runtime --entitlements "$ent/helper-gpu-entitlements.plist" "$helper" ;;
    *"(Plugin)") sign --identifier "$bundle_id.helper.plugin" --options restrict,kill,runtime --entitlements "$ent/helper-plugin-entitlements.plist" "$helper" ;;
    *"(Alerts)") sign --identifier "$bundle_id.framework.AlertNotificationService" --options restrict,library,runtime,kill "$helper" ;;
    *) sign --identifier "$bundle_id.helper" --options restrict,library,runtime,kill "$helper" ;;
  esac
done
for tool in app_mode_loader web_app_shortcut_copier; do
  if [[ -e "$helpers/$tool" ]]; then
    sign --identifier "$tool" --options restrict,library,runtime,kill "$helpers/$tool"
  fi
done
for dylib in "$libraries"/*.dylib; do
  [[ -e "$dylib" ]] || continue
  sign --identifier "$(basename "$dylib" .dylib)" "$dylib"
done

sign --identifier "$bundle_id.framework" "$framework"
sign --identifier "$bundle_id" --options restrict,library,runtime,kill --entitlements "$ent/app-entitlements.plist" "$app"
codesign --verify --deep --strict --verbose=2 "$app"

if [[ -n "$cert" && "${NOTARIZE:-0}" == "1" ]]; then
  zip="$(mktemp -d)/notarize.zip"
  ditto -c -k --keepParent "$app" "$zip"
  xcrun notarytool submit --wait --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" "$zip"
  xcrun stapler staple "$app"
fi

rm -f "$dmg"
"$src_dir/chrome/installer/mac/pkg-dmg" \
  --sourcefile --source "$app" \
  --target "$dmg" \
  --volname "NODE Chromium" --symlink /Applications:/Applications \
  --format UDBZ --verbosity 2
