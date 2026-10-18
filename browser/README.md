# NODE Chromium build

NODE built on Chromium itself instead of Electron (roadmap B51), so that Google sign-in works inside NODE. It is ungoogled-chromium with NODE's patches and NODE's research panel built in. The Electron app stays the release build until this one reaches parity; plan and status are in `docs/13-chromium-build.md`.

| Path | What it is |
| --- | --- |
| `base.env` | The pinned base: ungoogled-chromium-macos tag and Chromium version (152.0.7977.64, the same Chromium as Electron 44) |
| `patches/` | NODE's patches to Chromium, applied after ungoogled-chromium's, in `series` order |
| `extension/` | NODE's built-in extension (side panel, autoplay, 4-tab limit, center on click, Talk), built from `core/` |
| `build.sh` | Full macOS build: source, patches, extension, compile, sign, .dmg |
| `sign_and_package.sh` | Signing and .dmg packaging, called by `build.sh` |
| `check_patches.py` | Checks the patches apply, using only the files they touch (seconds, no full source) |

## Patches

| Patch | What it does |
| --- | --- |
| `0001-node-branding` | App name "NODE Chromium", bundle ID `app.node.chromium`, profile folder `~/Library/Application Support/NODE Chromium` (separate from Chromium and from the Electron app's `NODE` folder) |
| `0002-node-builtin-extension` | Registers the NODE extension as a component extension: always on, not in `chrome://extensions`, fixed ID `bdcmchdlmdgddldgdgapcmipndcgpgod`. The manifest is compiled in (`node_extension_manifest.inc`, written by `extension/build.js`); the files are read from the framework's `Resources/node_extension` |
| `0003-node-autoplay-default` | On desktop, media may start with sound without a click (the `--autoplay-policy` switch still wins), so NODE can autoplay a page's main video |

## Building on a Mac

One-time setup:

```bash
xcode-select --install                       # plus full Xcode from the App Store
xcodebuild -downloadComponent MetalToolchain
brew install coreutils ninja readline python@3.13 node
export PATH="$(brew --prefix python@3.13)/libexec/bin:$PATH"
pip3 install PySocks httplib2
```

Then, from the repository folder:

```bash
npm install
browser/build.sh            # Apple chip; browser/build.sh x86_64 for Intel
```

The first build downloads several GB and compiles for several hours; it needs about 150 GB of free disk. Everything goes into `browser/work/` (ignored by git). Later runs reuse the patched source and only recompile what changed. `browser/build.sh --fresh` starts again from a clean source tree (needed after changing a patch or `base.env`).

The result is `browser/work/ungoogled-chromium-macos/build/NODE-Chromium-<version>-<arch>.dmg`. It is signed ad hoc, so the first open needs System Settings → Privacy & Security → Open Anyway. With a Developer ID certificate in the keychain, set `MACOS_CERTIFICATE_NAME` (and `NOTARIZE=1` with `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`) before building.

## Checks without a full build

```bash
npm run check:browser-patches      # patches apply to the pinned Chromium (seconds)
npm run build:browser-extension    # builds extension/dist
NODE_CHROMIUM=/path/to/chromium-152/chrome npm run test:chromium-build
```

The last one runs the extension in a stock Chromium 152 (loaded unpacked, with the same ID) and checks suggestions, Talk, autoplay with sound, the 4-tab limit and center on click. The Tests workflow on GitHub runs all three with ungoogled-chromium 152 for Linux.

## Changing a patch

Patches are plain `diff -u` files against the source after ungoogled-chromium's patches. To change one, edit the files in `browser/work/ungoogled-chromium-macos/build/src`, then write the diff for those files back into the patch, or use `python3 browser/check_patches.py --keep /tmp/node-src` to get just the touched files, edit them there, and diff. Run `npm run check:browser-patches` before committing.

## Moving to a new Chromium version

Set the new tag, Chromium version and commit in `base.env`, run `npm run check:browser-patches`, and fix any patch that no longer applies. ungoogled-chromium-macos follows Chromium's stable releases, about every 4 weeks.

## Licenses

ungoogled-chromium and its macOS scripts are BSD-3-Clause; Chromium is BSD-3-Clause with third-party parts under their own licenses. NODE's own code stays MIT. `sign_and_package.sh` is adapted from ungoogled-chromium-macos.
