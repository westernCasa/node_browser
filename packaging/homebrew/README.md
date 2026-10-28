# Homebrew tap

Lets Mac users install NODE Research Browser with:

```bash
brew install westerncasa/tap/node-research
```

## Set it up once

1. On GitHub, create a public repository named **`homebrew-tap`** under `westernCasa` (the `homebrew-` prefix is required).
2. Copy `Casks/node-research.rb` from this folder into it, at `Casks/node-research.rb`, and commit.
3. Check it on a Mac:

```bash
brew install westerncasa/tap/node-research
brew audit --cask --online westerncasa/tap/node-research
```

## On each release

NODE updates itself, so people who installed with Homebrew stay current. New installs get the version in the cask, so update it on each release:

1. Change `version` to the new number.
2. Replace both `sha256` values. Get them with:

```bash
curl -sL https://github.com/westernCasa/node_browser/releases/download/vX.Y.Z/NODE-X.Y.Z-mac-arm64.dmg | shasum -a 256
curl -sL https://github.com/westernCasa/node_browser/releases/download/vX.Y.Z/NODE-X.Y.Z-mac-x64.dmg | shasum -a 256
```

3. Commit to `homebrew-tap`, and copy the file back here.

## The main Homebrew list

`brew install --cask node-research` without the tap needs NODE in Homebrew's own cask list. For apps submitted by their own author, Homebrew asks for a popular repository (about 75 stars, 30 forks or 30 watchers). Submit it there once the repository has those.
