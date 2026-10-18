#!/usr/bin/env bash
# Builds NODE Chromium for macOS: ungoogled-chromium plus NODE's patches
# (browser/patches) and NODE's built-in extension (browser/extension).
#
#   browser/build.sh            build for this Mac's chip (arm64 or x86_64)
#   browser/build.sh x86_64     build for Intel on an Apple-chip Mac
#   browser/build.sh --fresh    start again from a clean source tree
#
# Needs: macOS, Xcode with the Metal toolchain, Homebrew with
# coreutils, ninja, readline and python@3.13, Node.js 18 or newer, about
# 150 GB of free disk, and several hours for the first build. Later builds
# only recompile what changed. See browser/README.md.
#
# Output: browser/work/ungoogled-chromium-macos/build/NODE-Chromium-<version>-<arch>.dmg
# Signing: ad hoc unless MACOS_CERTIFICATE_NAME is set (see sign_and_package.sh).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
# shellcheck source=base.env
source "$here/base.env"

fresh=0
arch=""
for a in "$@"; do
  case "$a" in
    --fresh) fresh=1 ;;
    arm64|x86_64) arch="$a" ;;
    *) echo "Unknown argument: $a" >&2; exit 2 ;;
  esac
done
[[ -n "$arch" ]] || arch="$(uname -m)"
[[ "$arch" == "arm64" || "$arch" == "x86_64" ]] || { echo "Unsupported architecture: $arch" >&2; exit 2; }
gn_cpu="arm64"; [[ "$arch" == "x86_64" ]] && gn_cpu="x64"

work="${NODE_BROWSER_WORK:-$here/work}"
ugm="$work/ungoogled-chromium-macos"
src="$ugm/build/src"
stamp="$src/.node-patched"

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# ---- 1. Check the machine ----
step "Checking tools"
[[ "$(uname -s)" == "Darwin" ]] || fail "this script builds the macOS app; run it on a Mac"
for tool in git node ninja greadlink xcodebuild python3; do
  command -v "$tool" >/dev/null || fail "$tool not found (see browser/README.md)"
done
py_minor="$(python3 -c 'import sys; print(sys.version_info[1])')"
[[ "$(python3 -c 'import sys; print(sys.version_info[0])')" == "3" && "$py_minor" -le 13 ]] \
  || fail "python3 must be 3.13 or older (depot_tools needs it); put Homebrew's python@3.13 first in PATH"
python3 -c 'import socks, httplib2' 2>/dev/null || fail "missing Python packages: pip3 install PySocks httplib2"
free_gb="$(df -g "$here" | awk 'NR==2 {print $4}')"
if (( free_gb < 150 )) && [[ ! -d "$src" ]]; then
  fail "about 150 GB of free disk is needed for the first build; ${free_gb} GB free"
fi

# ---- 2. ungoogled-chromium-macos at the pinned tag ----
step "ungoogled-chromium-macos $UNGOOGLED_MACOS_TAG"
mkdir -p "$work"
if [[ ! -d "$ugm/.git" ]]; then
  git clone --recurse-submodules --branch "$UNGOOGLED_MACOS_TAG" --depth 1 --shallow-submodules \
    https://github.com/ungoogled-software/ungoogled-chromium-macos.git "$ugm"
fi
have="$(git -C "$ugm" rev-parse HEAD)"
[[ "$have" == "$UNGOOGLED_MACOS_COMMIT" ]] \
  || fail "$ugm is at $have, expected $UNGOOGLED_MACOS_COMMIT ($UNGOOGLED_MACOS_TAG). Delete $work to start over."
[[ "$(cat "$ugm/ungoogled-chromium/chromium_version.txt")" == "$CHROMIUM_VERSION" ]] \
  || fail "ungoogled-chromium submodule is not Chromium $CHROMIUM_VERSION"

# ---- 3. Chromium source with ungoogled's and NODE's patches ----
if (( fresh )); then
  step "Removing the old source tree"
  rm -rf "$src"
fi
if [[ ! -f "$stamp" ]]; then
  if [[ -d "$src" ]]; then
    fail "$src exists but was not fully patched. Run again with --fresh."
  fi
  step "Downloading the Chromium source archive (several GB)"
  mkdir -p "$ugm/build/download_cache"
  python3 "$ugm/retrieve_and_unpack_resource.py" -d -g "$arch"

  step "Pruning binaries and applying patches"
  python3 "$ugm/ungoogled-chromium/utils/prune_binaries.py" "$src" "$ugm/ungoogled-chromium/pruning.list"
  python3 "$ugm/ungoogled-chromium/utils/patches.py" apply "$src" \
    "$ugm/ungoogled-chromium/patches" "$ugm/patches" "$here/patches"
  python3 "$ugm/ungoogled-chromium/utils/domain_substitution.py" apply \
    -r "$ugm/ungoogled-chromium/domain_regex.list" -f "$ugm/ungoogled-chromium/domain_substitution.list" "$src"

  step "Platform toolchains"
  mkdir -p "$src/third_party/llvm-build/Release+Asserts" "$src/third_party/rust-toolchain/bin"
  python3 "$ugm/retrieve_and_unpack_resource.py" -p "$arch"
  date > "$stamp"
fi

# ---- 4. NODE's built-in extension ----
step "Building NODE's built-in extension"
if [[ ! -d "$repo/node_modules/esbuild" ]]; then (cd "$repo" && npm install); fi
node "$here/extension/build.js" --src "$src"

# ---- 5. Build settings and compile ----
step "Configuring the build"
out="$src/out/Default"
mkdir -p "$out"
{
  cat "$ugm/ungoogled-chromium/flags.gn" "$ugm/flags.macos.gn"
  if [[ -f "$here/flags.node.gn" ]]; then cat "$here/flags.node.gn"; fi
  echo "target_cpu = \"$gn_cpu\""
} > "$out/args.gn.new"
# Only rewrite args.gn when it changed, so ninja does not rebuild everything.
if ! cmp -s "$out/args.gn.new" "$out/args.gn"; then mv "$out/args.gn.new" "$out/args.gn"; else rm "$out/args.gn.new"; fi

cd "$src"
[[ -x out/Default/gn ]] || ./tools/gn/bootstrap/bootstrap.py -o out/Default/gn --skip-generate-buildfiles
[[ -x third_party/rust-toolchain/bin/bindgen ]] || ./tools/rust/build_bindgen.py --skip-test
./out/Default/gn gen out/Default --fail-on-unused-args

step "Compiling (the first build takes several hours)"
ninja -C out/Default chrome

# ---- 6. Put the extension in the app, sign and package ----
app="$out/NODE Chromium.app"
[[ -d "$app" ]] || fail "expected $app after the build; check the branding patch (0001)"
framework="$app/Contents/Frameworks/NODE Chromium Framework.framework"
resources="$framework/Versions/Current/Resources"
[[ -d "$resources" ]] || fail "framework resources folder not found: $resources"
step "Copying the extension into the app"
rm -rf "$resources/node_extension"
cp -R "$here/extension/dist" "$resources/node_extension"

version="$(node -p 'require(process.argv[1]).version' "$repo/package.json")"
dmg="$ugm/build/NODE-Chromium-$version-$arch.dmg"
step "Signing and packaging"
APP="$app" ENTITLEMENTS="$ugm/entitlements" "$here/sign_and_package.sh" "$dmg"
printf '\nDone: %s\n' "$dmg"
