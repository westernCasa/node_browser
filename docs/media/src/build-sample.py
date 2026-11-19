#!/usr/bin/env python3
"""Build site/sample.html from a node-trail v2 file (docs/26-trail-file-format.md).

    python3 docs/media/src/build-sample.py docs/sourdough-starters.trail.md site/sample.html

The page shows the trail the way NODE opens a shared file: read only, the
sender's note and Start here in the side panel, the canvas, and Replay.
"""
import json, re, sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
text = src.read_text(encoding="utf-8")
template = (Path(__file__).parent / "sample-template.html").read_text(encoding="utf-8")

fm_raw, body = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S).groups()
fm = dict(line.split(": ", 1) for line in fm_raw.splitlines() if ": " in line)

lines = body.splitlines()
name = next(l[2:] for l in lines if l.startswith("# "))
note = ""
for l in lines[lines.index("# " + name) + 1:]:
    if l.strip() and not l.startswith("**Start here"):
        note = l.strip()
        break

groups, cards, links, timeline = [], [], [], []
section, group, card = None, None, None
KV = lambda s: dict(re.findall(r"(\w[\w-]*):(\S+)", s))

for i, l in enumerate(lines):
    if l.startswith("## "):
        section = l[3:].strip()
        card = None
        group = None
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        m = re.match(r"<!-- group:(\S+) (.*?) -->", nxt)
        if m:
            kv = KV(m.group(2))
            x, y = map(int, kv["at"].split(","))
            w, h = map(int, kv["size"].split("x"))
            group = {"id": m.group(1), "name": section, "x": x, "y": y, "w": w, "h": h, "resolved": "resolved" in m.group(2)}
            groups.append(group)
        continue
    if section == "Links" and l.startswith("- "):
        m = re.search(r"<!-- from:(\S+) to:(\S+) kind:(\S+) -->", l)
        lab = re.search(r"\) · (.*?) <!--", l)
        label = lab.group(1) if lab else ""
        if label.startswith("drawn"):
            label = label[len("drawn"):].lstrip(" ·")
        links.append({"from": m.group(1), "to": m.group(2), "kind": m.group(3), "label": label})
        continue
    if section == "Timeline" and l.startswith("- "):
        head, _, items = l[2:].partition(": ")
        day, device = [p.strip() for p in head.split("·")[:2]]
        for it in items.split("; "):
            t, _, title = it.partition(" ")
            timeline.append({"day": day, "device": device, "time": t, "title": title.strip().rstrip("."), "only": "(timeline only)" in title})
        continue
    if l.startswith("### "):
        head = l[4:]
        m = re.match(r"<!-- id:(\S+) (.*?) -->", lines[i + 1])
        kv = KV(m.group(2))
        x, y = map(int, kv["at"].split(","))
        w, h = map(int, kv["size"].split("x"))
        card = {"id": m.group(1), "type": kv["type"], "x": x, "y": y, "w": w, "h": h, "group": group["id"] if group else None, "lines": []}
        link = re.match(r"\[(.*?)\]\((.*?)\)", head)
        if link:
            card["title"], card["url"] = link.group(1), link.group(2)
        elif head.startswith("? "):
            card["title"] = head[2:]
        elif head.startswith("> "):
            card["title"] = head[2:]
        elif head.startswith("Report: "):
            card["title"] = head[len("Report: "):]
        else:
            card["title"] = head
        cards.append(card)
        continue
    if card and l.strip() and not l.startswith("<!--"):
        card["lines"].append(l.strip())

# Replay order: sessions are listed newest first, items newest first.
by_title = {}
for c in cards:
    key = c["title"].strip("“”\"").rstrip(".")
    by_title[key] = c["id"]
    if c["type"] == "note" and c["lines"]:
        by_title[c["lines"][0].rstrip(".")] = c["id"]
sessions = []
for e in timeline:
    if not sessions or sessions[-1][0] != (e["day"], e["device"]):
        sessions.append(((e["day"], e["device"]), []))
    sessions[-1][1].append(e)
day_label = {"today": fm.get("exported-at", "")[:10]}
steps = []
for _, items in reversed(sessions):
    for e in reversed(items):
        if e["only"]:
            continue
        cid = by_title.get(e["title"].strip("“”\""))
        if cid and cid not in [s["card"] for s in steps]:
            steps.append({"card": cid, "day": e["day"], "device": e["device"], "time": e["time"]})
missing = [c["id"] for c in cards if c["id"] not in [s["card"] for s in steps]]
for cid in missing:
    steps.append({"card": cid, "day": "", "device": "", "time": ""})

data = {"name": name, "note": note, "from": fm.get("exported-by", ""), "exportedAt": fm.get("exported-at", ""),
        "startHere": fm.get("start-here"), "groups": groups, "cards": cards, "links": links, "steps": steps,
        "file": src.name}
html = template.replace("/*TRAIL_DATA*/null", json.dumps(data, ensure_ascii=False))
html = html.replace("{{TRAIL_FILE}}", src.name)
PAGE = {"TITLE": "Sourdough starters · a sample trail · NODE Research Browser",
        "DESC": "A real trail made in NODE Research Browser and shared as one file: cards, groups, links, open questions and a Replay of how it was built.",
        "URL": "https://noderesearch.app/sample", "HEAD_EXTRA": "",
        "OG_TITLE": "Sourdough starters · a sample trail",
        "OG_DESC": "A trail made in NODE Research Browser and shared as one file. Open it, replay how it was built, and see what is still open.",
        "TAG": "Sample trail · read only",
        "ABOUT": "This is a real trail made in NODE Research Browser and shared as one file. In NODE it opens like this, and you can save your own copy and keep going.",
        "ABOUT_FOOT": "The file is plain Markdown. Any editor can read it.", "BODY_CLASS": ""}
for k, v in PAGE.items():
    html = html.replace("{{%s}}" % k, v)
index = (out.parent / "index.html").read_text(encoding="utf-8")
m = re.search(r'<svg[^>]*class="lockup".*?</svg>', index, re.S)
html = html.replace("{{LOCKUP}}", m.group(0) if m else "NODE")
out.write_text(html, encoding="utf-8")
print(f"{out}: {len(cards)} cards, {len(groups)} groups, {len(links)} links, {len(steps)} replay steps")
