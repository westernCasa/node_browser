#!/usr/bin/env python3
"""Build the blog as a NODE trail from docs/blog.md.

    python3 docs/media/src/build-blog.py docs/blog.md site

Writes:
  site/blog.trail.md  the blog as a node-trail v2 file (docs/26-trail-file-format.md), which NODE opens
  site/blog.html      the same trail on a canvas, read only, with Replay (docs/media/src/sample-template.html)
  site/blog.xml       an RSS feed of the posts

Each post becomes a question card (the question) and a note card (my answer), linked.
A post with a Read: link also gets a page card. Posts are grouped by Topic.
Post format is described at the top of docs/blog.md.
"""
import html, json, math, re, sys
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
SITE = "https://noderesearch.app"
FIELDS = ["Topic", "Status", "Decision", "Why", "Next", "Read"]
STATUSES = ["Open", "Proposed", "In progress", "Decided", "Parked"]
LEAD = {"Decided": "Decided", "Proposed": "Plan", "Open": "Thinking", "Parked": "For now", "In progress": "So far"}
TOPIC_ORDER = ["First week", "Who it's for", "Sharing", "Privacy", "Engine"]
VERDICTS = ["Chosen", "Leaning", "Also offered", "Also doing", "Fallback", "Later", "Parked", "Dropped", "Not possible"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# ---- Read the posts ----
posts, cur = [], None
for line in src.read_text(encoding="utf-8").splitlines():
    m = re.match(r"## (\d{4}-\d{2}-\d{2}) · (.+)$", line)
    if m:
        cur = {"date": m.group(1), "q": m.group(2).strip()}
        posts.append(cur)
        continue
    m = re.match(r"Option: (.+)$", line)
    if cur and m:
        parts = [x.strip() for x in m.group(1).split("|")]
        if len(parts) < 2 or parts[0] not in VERDICTS:
            sys.exit(f"post {cur['date']}: option '{m.group(1)}' needs 'Verdict | option | why', verdict one of {', '.join(VERDICTS)}")
        cur.setdefault("options", []).append({"v": parts[0], "t": parts[1], "why": parts[2] if len(parts) > 2 else ""})
        continue
    m = re.match(r"(%s): (.+)$" % "|".join(FIELDS), line)
    if cur and m:
        cur[m.group(1)] = m.group(2).strip()
for p in posts:
    for f in ("Topic", "Status", "Decision"):
        if not p.get(f):
            sys.exit(f"post {p['date']} '{p['q']}' needs {f}")
    if p["Status"] not in STATUSES:
        sys.exit(f"post {p['date']} '{p['q']}': Status must be one of {', '.join(STATUSES)}")
    p["slug"] = f"{p['date']}-" + re.sub(r"[^a-z0-9]+", "-", p["q"].lower()).strip("-")[:60].rstrip("-")
posts.sort(key=lambda p: p["date"], reverse=True)  # newest first; stable for same-day posts
for i, p in enumerate(posts):
    p["n"] = len(posts) - i  # oldest post is 1

day = lambda d: f"{int(d[8:])} {MONTHS[int(d[5:7]) - 1]} {d[:4]}"
short = lambda d: f"{MONTHS[int(d[5:7]) - 1].lower()} {int(d[8:])}"
host = lambda u: re.sub(r"^https?://(www\.)?", "", u).split("/")[0]

def release_title(u):
    m = re.search(r"/releases/tag/v([\d.]+)", u)
    return f"NODE {m.group(1)} release notes" if m else host(u)

def answer(p):
    t = f"{LEAD[p['Status']]}: {p['Decision']}"
    if p.get("Why"):
        t += f" Why: {p['Why']}"
    if p.get("Next"):
        t += f" Next: {p['Next']}"
    return t

# ---- Lay out the canvas: one group per topic, a row per post ----
QW, NW, PW, PAD, GAP = 400, 380, 260, 40, 60
opt_h = lambda o: 28 + 20 * math.ceil(len(o["t"]) / 46) + (18 * math.ceil(len(o["why"]) / 54) if o["why"] else 0)
q_h = lambda p: 110 + 22 * math.ceil(len(p["q"]) / 34) + (28 + sum(opt_h(o) for o in p.get("options", [])) if p.get("options") else 0)
n_h = lambda p: 76 + 20 * math.ceil(len(answer(p)) / 46)
topics = sorted({p["Topic"] for p in posts}, key=lambda t: (TOPIC_ORDER.index(t) if t in TOPIC_ORDER else 99, t))
groups, cards, links = [], [], []
col_x, col_y = [0, 0], [0, 0]
group_w = PAD + QW + GAP + NW + GAP + PW + PAD
for gi, topic in enumerate(topics):
    rows = [p for p in posts if p["Topic"] == topic]
    h = 60 + sum(max(q_h(p), n_h(p)) + 40 for p in rows)
    c = 0 if col_y[0] <= col_y[1] else 1
    gx, gy = c * (group_w + 80), col_y[c]
    col_y[c] += h + 80
    gid = f"g{gi + 1}"
    groups.append({"id": gid, "name": topic, "x": gx, "y": gy, "w": group_w, "h": h, "resolved": all(p["Status"] == "Decided" for p in rows)})
    y = gy + 60
    for p in rows:
        n = p["n"]
        p["qid"], p["nid"], p["pid"] = f"q{n}", f"n{n}", f"p{n}"
        cards.append({"id": p["qid"], "type": "question", "x": gx + PAD, "y": y, "w": QW, "h": q_h(p), "group": gid,
                      "title": p["q"], "lines": ["Status: " + ("resolved" if p["Status"] == "Decided" else "open"), f"- Sven: {p['Status']}, {day(p['date'])}"]
                      + [f"- Sven: Option: {o['t']}. {o['v']}." + (f" {o['why']}" if o["why"] else "") for o in p.get("options", [])],
                      "options": p.get("options", [])})
        nx = gx + PAD + QW + GAP
        cards.append({"id": p["nid"], "type": "note", "x": nx, "y": y, "w": NW, "h": n_h(p), "group": gid,
                      "title": "Note", "lines": [answer(p), f"— Sven · {short(p['date'])}"]})
        links.append({"from": p["nid"], "to": p["qid"], "kind": "you", "label": LEAD[p["Status"]].lower()})
        if p.get("Read"):
            cards.append({"id": p["pid"], "type": "page", "x": nx + NW + GAP, "y": y, "w": PW, "h": 150, "group": gid,
                          "title": release_title(p["Read"]), "url": p["Read"], "lines": ["Where this shipped."]})
            links.append({"from": p["nid"], "to": p["pid"], "kind": "auto", "label": "shipped in"})
        y += max(q_h(p), n_h(p)) + 40

open_posts = [p for p in posts if p["Status"] in ("Open", "Proposed")]
start = (open_posts or posts)[0]
intro = "I'm Sven, and I make NODE. This blog is a NODE trail: each question I ran into is a card with the options I looked at, and my answer is the note linked to it."
by_card = {c["id"]: c for c in cards}

# Replay: oldest post first, the question then the answer then the release.
steps = []
for p in reversed(posts):
    for cid in (p["qid"], p["nid"], p["pid"]):
        if cid in by_card:
            steps.append({"card": cid, "day": short(p["date"]).upper(), "device": "", "time": ""})

# ---- The trail file ----
updated = posts[0]["date"]
lines = ["---", "node-trail: 2", "id: trail-node-blog", "name: Building NODE", "exported-by: Sven",
         f"exported-at: {updated}T12:00:00Z", f"start-here: {start['qid']}", "---", "# Building NODE", "", intro, "",
         f"**Start here:** [{start['q']}](#{start['qid']})", ""]
for g in groups:
    lines += [f"## {g['name']}", f"<!-- group:{g['id']} at:{g['x']},{g['y']} size:{g['w']}x{g['h']}{' resolved' if g['resolved'] else ''} -->", ""]
    for c in [c for c in cards if c["group"] == g["id"]]:
        if c["type"] == "question":
            head = f"### ? {c['title']}"
        elif c["type"] == "note":
            head = "### Note"
        else:
            head = f"### [{c['title']}]({c['url']})"
        lines += [head, f"<!-- id:{c['id']} type:{c['type']} at:{c['x']},{c['y']} size:{c['w']}x{c['h']} -->", *c["lines"], ""]
lines += ["## Links", ""]
name_of = lambda c: c["title"] if c["type"] != "note" else c["lines"][0].split(". ")[0].rstrip(".")
for k in links:
    a, b = by_card[k["from"]], by_card[k["to"]]
    label = f"drawn · {k['label']}" if k["kind"] == "you" else k["label"]
    lines.append(f"- [{name_of(a)}](#{a['id']}) → [{name_of(b)}](#{b['id']}) · {label} <!-- from:{a['id']} to:{b['id']} kind:{k['kind']} -->")
(out / "blog.trail.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

# ---- The canvas page ----
data = {"name": "Building NODE", "note": intro, "from": "Sven", "exportedAt": f"{updated}T12:00:00Z",
        "startHere": start["qid"], "groups": groups, "cards": cards, "links": links, "steps": steps,
        "file": "blog.trail.md", "zoom": "actual", "verbs": {"question": "asked", "note": "answered", "page": "shipped"}}
tpl = (Path(__file__).parent / "sample-template.html").read_text(encoding="utf-8")
page = tpl.replace("/*TRAIL_DATA*/null", json.dumps(data, ensure_ascii=False)).replace("{{TRAIL_FILE}}", "blog.trail.md")
index = (out / "index.html").read_text(encoding="utf-8")
m = re.search(r'<svg[^>]*class="lockup".*?</svg>', index, re.S)
page = page.replace("{{LOCKUP}}", m.group(0) if m else "NODE")
PAGE = {
    "TITLE": "Building NODE · blog · NODE Research Browser",
    "DESC": "Sven on the questions he runs into while building NODE Research Browser and what he decides, laid out as a NODE trail.",
    "URL": f"{SITE}/blog",
    "HEAD_EXTRA": f'\n<link rel="alternate" type="application/rss+xml" title="Building NODE" href="{SITE}/blog.xml">',
    "OG_TITLE": "Building NODE · blog",
    "OG_DESC": "The questions I run into while building NODE, and what I decide. Laid out as a NODE trail.",
    "TAG": f"Blog · {len(posts)} posts · updated {day(updated)}",
    "ABOUT": "Each question card lists the options I looked at, and the note linked to it says what I decided and why. Press Play to see them in the order I worked through them, or Start here for what I'm working out now. Download the file to open this blog in NODE.",
    "ABOUT_FOOT": 'Follow along with the <a href="/blog.xml">RSS feed</a>. The file is plain Markdown.',
    "BODY_CLASS": "phone-list",
}
for k, v in PAGE.items():
    page = page.replace("{{%s}}" % k, v)
page = page.replace('data-track="sample-', 'data-track="blog-').replace('name:"sample-replay"', 'name:"blog-replay"')
(out / "blog.html").write_text(page, encoding="utf-8")

# ---- RSS ----
esc = html.escape
def rfc822(d):
    return format_datetime(datetime.strptime(d, "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc))
items = []
for p in posts:
    items.append(f'''  <item>
    <title>{esc(p["q"])}</title>
    <link>{SITE}/blog#card-{p["qid"]}</link>
    <guid isPermaLink="false">node-blog-{p["slug"]}-{p["Status"].lower().replace(" ", "-")}</guid>
    <pubDate>{rfc822(p["date"])}</pubDate>
    <category>{esc(p["Topic"])}</category>
    <description>{esc(" ".join(["Options: " + "; ".join(o["t"] + " (" + o["v"].lower() + ")" for o in p["options"]) + "."] if p.get("options") else []) + " " + answer(p)).strip()}</description>
  </item>''')
(out / "blog.xml").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Building NODE</title>
  <link>{SITE}/blog</link>
  <atom:link href="{SITE}/blog.xml" rel="self" type="application/rss+xml"/>
  <description>Sven on the questions he runs into while building NODE Research Browser, and what he decides.</description>
  <language>en</language>
  <lastBuildDate>{rfc822(updated)}</lastBuildDate>
{chr(10).join(items)}
</channel>
</rss>
''', encoding="utf-8")
print(f"{out}/blog.html, blog.trail.md, blog.xml: {len(posts)} posts, {len(groups)} groups, {len(cards)} cards, {len(links)} links, {len(steps)} steps")
