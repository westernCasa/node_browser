#!/usr/bin/env bash
# Prepares a Mac to build NODE Chromium on an external SSD.
#
#   bash prep-mac.sh /Volumes/<SSD name>
#
# What it does (safe to run again; each step is skipped when already done):
#   1. Checks the SSD: APFS format, at least 150 GB free.
#   2. Checks Xcode (full app, license accepted, Metal toolchain).
#   3. Installs Homebrew packages: git, coreutils, ninja, readline, python@3.13, node.
#   4. Makes a Python 3.13 environment on the SSD with PySocks and httplib2.
#   5. Clones NODE's chromium-build branch onto the SSD and runs npm install.
#   6. Keeps Spotlight and Time Machine out of the build folder.
#   7. Runs the patch check (a few seconds).
#   8. Writes node-build.env and start-build.sh on the SSD.
#
# It does not start the build. When it finishes, run the start-build.sh it prints.
set -euo pipefail

say()  { printf '\n== %s\n' "$*"; }
ok()   { printf '   ok: %s\n' "$*"; }
fail() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }

ssd="${1:-}"
[[ -n "$ssd" ]] || fail "give the SSD's path, for example: bash prep-mac.sh /Volumes/Build"
ssd="${ssd%/}"
[[ -d "$ssd" ]] || fail "$ssd not found. Is the SSD plugged in? (ls /Volumes)"
[[ "$(uname -s)" == "Darwin" ]] || fail "run this on the Mac"

root="$ssd/node-build"
repo="$root/node_browser"
venv="$root/py313"
branch="chromium-build"

# ---- 1. SSD ----
say "Checking the SSD"
fs="$(diskutil info "$ssd" | awk -F: '/Type \(Bundle\)/ {gsub(/ /,"",$2); print $2}')"
[[ "$fs" == "apfs" ]] || fail "$ssd is formatted as '${fs:-unknown}'. Chromium needs APFS (exFAT and FAT break symlinks and permissions). Reformat it in Disk Utility as APFS, then run this again."
ok "APFS"
if diskutil info "$ssd" | grep -q "Owners:.*Disabled"; then
  echo "   note: 'Ignore ownership' is on for this drive. Turn it off: Finder, select the drive, Get Info, untick 'Ignore ownership on this volume'."
fi
free_gb="$(df -g "$ssd" | awk 'NR==2 {print $4}')"
if [[ ! -d "$repo/browser/work/ungoogled-chromium-macos/build/src" ]] && (( free_gb < 150 )); then
  fail "$free_gb GB free on $ssd; the first build needs about 150 GB"
fi
ok "$free_gb GB free"
mkdir -p "$root"

# ---- 2. Xcode ----
say "Checking Xcode"
xcode-select -p >/dev/null 2>&1 || { xcode-select --install || true; fail "Command Line Tools are installing. Run this again when that finishes."; }
if ! xcodebuild -version >/dev/null 2>&1; then
  fail "full Xcode is needed (not only the Command Line Tools). Install Xcode from the App Store, open it once, then run:
    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
    sudo xcodebuild -license accept
  and run this script again."
fi
ok "$(xcodebuild -version | head -1)"
if [[ "$(xcode-select -p)" != *Xcode*.app* ]]; then
  fail "xcode-select points at $(xcode-select -p). Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
fi
if ! xcrun -sdk macosx metal -v >/dev/null 2>&1; then
  say "Downloading the Metal toolchain"
  xcodebuild -downloadComponent MetalToolchain
fi
ok "Metal toolchain"

# ---- 3. Homebrew packages ----
say "Homebrew packages"
if ! command -v brew >/dev/null; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x "$b" ]] && eval "$("$b" shellenv)" && break; done
fi
command -v brew >/dev/null || fail "Homebrew not found. Install it from https://brew.sh, then run this again."
brew install git coreutils ninja readline python@3.13 node
py313="$(brew --prefix python@3.13)/bin/python3.13"
[[ -x "$py313" ]] || fail "python3.13 not found at $py313"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
(( node_major >= 18 )) || fail "Node $node_major is too old; need 18 or newer"
ok "node $(node -v), $("$py313" --version)"

# ---- 4. Python environment (Homebrew's Python refuses pip installs outside one) ----
say "Python 3.13 environment"
[[ -x "$venv/bin/python3" ]] || "$py313" -m venv "$venv"
"$venv/bin/pip" install --quiet --upgrade pip PySocks httplib2
"$venv/bin/python3" -c 'import socks, httplib2'
ok "$venv"

# ---- 5. NODE repository ----
say "NODE repository ($branch branch)"
if [[ -d "$repo/.git" ]]; then
  git -C "$repo" fetch origin "$branch"
  git -C "$repo" checkout "$branch"
  git -C "$repo" pull --ff-only origin "$branch"
else
  git clone --branch "$branch" https://github.com/westernCasa/node_browser.git "$repo"
fi
ok "$(git -C "$repo" log --oneline -1)"
(cd "$repo" && npm install --no-audit --no-fund)
ok "npm install"

# ---- 6. Spotlight and Time Machine ----
say "Keeping Spotlight and Time Machine out of the build folder"
mkdir -p "$repo/browser/work"
touch "$repo/browser/work/.metadata_never_index"
tmutil addexclusion "$repo/browser/work" 2>/dev/null || true
ok "$repo/browser/work"

# ---- 7. Patch check ----
say "Checking NODE's patches against Chromium (seconds)"
(cd "$repo" && PATH="$venv/bin:$PATH" python3 browser/check_patches.py)

# ---- 8. Build files ----
cat > "$root/node-build.env" <<EOF
# Source this before building: source "$root/node-build.env"
export PATH="$venv/bin:$(brew --prefix)/bin:\$PATH"
export NODE_BROWSER_WORK="$repo/browser/work"
EOF
cat > "$root/start-build.sh" <<EOF
#!/usr/bin/env bash
# Starts the NODE Chromium build. caffeinate keeps the Mac awake (lid open, power connected).
# The log is saved next to this script. Add --fresh after a patch or base.env change.
set -euo pipefail
source "$root/node-build.env"
cd "$repo"
caffeinate -dims browser/build.sh "\$@" 2>&1 | tee "$root/build-\$(date +%Y%m%d-%H%M).log"
EOF
chmod +x "$root/start-build.sh"

say "Ready"
cat <<EOF
Everything is on $root.

Before starting:
  - Plug in power and keep the SSD connected the whole time (several hours).
  - System Settings → Battery/Energy: prevent sleep when the display is off.

Start the build:
  $root/start-build.sh

The .dmg ends up in:
  $repo/browser/work/ungoogled-chromium-macos/build/
EOF
