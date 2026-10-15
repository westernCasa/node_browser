# 09 — Releasing NODE

How a new version gets from the repo to people's computers.

## What happens on a release

1. A version tag (`v0.9.0`, `v1.0.0`) is pushed to GitHub.
2. The **Release** workflow (`.github/workflows/release.yml`) runs on macOS, Windows and Linux. Each runs the unit tests, builds the installers and uploads them to a GitHub release for that tag:
   - macOS: `.dmg` and `.zip` for Apple silicon (arm64) and Intel (x64)
   - Windows: `.exe` installer (NSIS)
   - Linux: `.AppImage` and `.deb`
3. Installed copies of NODE check GitHub every 6 hours (and 10 seconds after start), download the new version in the background and offer **Restart now**. If the user waits, it installs the next time NODE quits. Settings → Help → Check for updates automatically turns this off.

The **Tests** workflow (`.github/workflows/ci.yml`) runs the unit tests and 14 end-to-end suites on every push to `main`.

## Releasing a version

```bash
# 1. Set the version in package.json (for example 1.0.0) and commit it.
npm version 1.0.0 --no-git-tag-version
git commit -am "NODE 1.0.0"
git push origin main

# 2. Tag and push the tag. This starts the Release workflow.
git tag v1.0.0
git push origin v1.0.0
```

The release appears under Releases when all three builds finish (about 15 to 25 minutes). Edit its notes on GitHub; the changelog in `05-changelog.md` has the wording.

## Signing (needed before a public 1.0)

Without signing the builds work, but:

- **macOS** shows "NODE can't be opened because Apple cannot check it for malicious software". The user has to right-click → Open the first time. macOS also refuses to install automatic updates for unsigned apps, so Mac users would have to download each update by hand.
- **Windows** SmartScreen shows "Windows protected your PC" once; the user clicks More info → Run anyway.

To sign, add these repository secrets (GitHub → Settings → Secrets and variables → Actions). The workflow uses them as soon as they exist; nothing else changes.

| Secret | What it is | Where it comes from |
| --- | --- | --- |
| `CSC_LINK` | Developer ID Application certificate as a base64 .p12 | Apple Developer Program (99 USD a year) → Certificates; export from Keychain, then `base64 -i cert.p12` |
| `CSC_KEY_PASSWORD` | The .p12 password | Set when exporting |
| `APPLE_ID` | Apple ID email of the developer account | — |
| `APPLE_APP_SPECIFIC_PASSWORD` | For notarization | appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | 10-character team ID | developer.apple.com → Membership |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code signing certificate (optional) | A code signing provider (OV or EV certificate), or Azure Trusted Signing |

macOS builds use the hardened runtime with the entitlements in `build/entitlements.mac.plist`.

## Before a release

- `npm run test:unit` and the end-to-end suites (see `test/e2e/README.md`), including `npm run test:redteam`.
- On a real Mac: the open checks in `02-roadmap-backlog.md` (live search results, Google window sign-in, an hour of browsing).
- Update `05-changelog.md` and the version in `package.json`.

## Building locally

`npm run dist:mac`, `npm run dist:win` or `npx electron-builder --linux` build installers into `dist/` without publishing. `npm run release` builds and publishes from your machine (needs `GH_TOKEN`).

## Notes from the first release (v0.9.0, 2026-10-15)

- Release notes for testers go in `docs/release-notes/v<version>.md` before tagging. The workflow's first job creates the release with them; the three builds then upload their files to it.
- Without an Apple certificate, the Mac app is ad-hoc signed. Testers open it once with System Settings → Privacy & Security → Open Anyway, and update by downloading the new version by hand.
- The tag is pushed from your own computer (`git tag v<version> && git push origin v<version>`). Claude's cloud session can push branches but not tags.
- Never delete or reuse a tag. If a build fails, fix it, bump the patch version in package.json, and tag again.
