#!/usr/bin/env python3
"""Point noderesearch.app and the Homebrew cask at a new NODE release.

    gh api repos/westernCasa/node_browser/releases/latest > /tmp/release.json
    python3 packaging/bump-site.py /tmp/release.json

Updates the version, release date, download links, file sizes and structured
data in site/index.html, the dates in site/sitemap.xml, the version and
sha256 values in the Homebrew cask, and the README status line. It changes
no feature copy: new features still need words on the site.

Prints the old and new version. Exits 0 without changes if the site already
shows that version, and exits 1 if something it expects is missing.
"""
import json, re, sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
rel = json.loads(Path(sys.argv[1]).read_text())
if rel.get("draft") or rel.get("prerelease"):
    sys.exit("not a published release")
new = rel["tag_name"].lstrip("v")
if not re.fullmatch(r"\d+\.\d+\.\d+", new):
    sys.exit(f"unexpected tag {rel['tag_name']}")
day = datetime.strptime(rel["published_at"][:10], "%Y-%m-%d")
iso, human = day.strftime("%Y-%m-%d"), f"{day.day} {day.strftime('%b %Y')}"
assets = {a["name"]: a for a in rel["assets"]}

index = ROOT / "site/index.html"
s = index.read_text()
m = re.search(r'<p class="tele">(\d+\.\d+\.\d+) //', s)
if not m:
    sys.exit("version line not found in site/index.html")
old = m.group(1)
if old == new:
    print(f"site already on {new}")
    sys.exit(0)


def need(cond, what):
    if not cond:
        sys.exit(f"missing: {what}")


# Every installer the site links to must exist in the release.
kinds = ["mac-arm64.dmg", "mac-x64.dmg", "win-x64.exe", "linux-x86_64.AppImage", "linux-amd64.deb"]
for k in kinds:
    need(f"NODE-{new}-{k}" in assets, f"release asset NODE-{new}-{k}")

s = s.replace(f"NODE-{old}-", f"NODE-{new}-")
s = s.replace(f"/download/v{old}/", f"/download/v{new}/")
s = s.replace(f"/releases/tag/v{old}", f"/releases/tag/v{new}")
s = s.replace(f'"softwareVersion": "{old}"', f'"softwareVersion": "{new}"')
s = s.replace(f"NODE {old} is live", f"NODE {new} is live")
s = s.replace(f'<p class="tele">{old} //', f'<p class="tele">{new} //')
s = re.sub(rf"{re.escape(old)} · \d+ \w+ \d{{4}}", f"{new} · {human}", s)
s = re.sub(r'"(datePublished|dateModified)": "\d{4}-\d{2}-\d{2}"', rf'"\1": "{iso}"', s)
# File sizes, in the list and in the OS-detection map.
for k in kinds:
    name = f"NODE-{new}-{k}"
    mb = f"{round(assets[name]['size'] / 1e6)} MB"
    s = re.sub(rf"({re.escape(name)} · )\d+ MB", rf"\g<1>{mb}", s)
    s = re.sub(rf'(file:"{re.escape(name)}",size:")\d+ MB', rf"\g<1>{mb}", s)
need(old not in s, f"leftover {old} in site/index.html")
index.write_text(s)

sm = ROOT / "site/sitemap.xml"
t = sm.read_text()
sm.write_text(re.sub(r"(<loc>https://noderesearch\.app/(?:sample)?</loc><lastmod>)\d{4}-\d{2}-\d{2}", rf"\g<1>{iso}", t))

cask = ROOT / "packaging/homebrew/Casks/node-research.rb"
c = cask.read_text()


def digest(name):
    d = assets[name].get("digest") or ""
    need(d.startswith("sha256:"), f"sha256 digest for {name}")
    return d.split(":", 1)[1]


c = re.sub(r'version "\d+\.\d+\.\d+"', f'version "{new}"', c)
c = re.sub(r'(arm:\s+")[0-9a-f]{64}', rf"\g<1>{digest(f'NODE-{new}-mac-arm64.dmg')}", c)
c = re.sub(r'(intel:\s+")[0-9a-f]{64}', rf"\g<1>{digest(f'NODE-{new}-mac-x64.dmg')}", c)
cask.write_text(c)

readme = ROOT / "README.md"
r = readme.read_text()
readme.write_text(re.sub(r"Status: released, version \d+\.\d+\.\d+", f"Status: released, version {new}", r))

print(f"{old} -> {new} ({human})")
