#!/usr/bin/env python3
"""Build the decision log page and its feed from docs/decision-log.md.

    python3 docs/media/src/build-log.py docs/decision-log.md site

Writes site/log.html and site/log.xml (RSS). Entry format is described at the
top of docs/decision-log.md.
"""
import html, re, sys
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
SITE = "https://noderesearch.app"
FIELDS = ["Status", "Decision", "Why", "Next", "Read"]
STATUSES = ["Open", "Proposed", "In progress", "Decided", "Parked"]

entries, cur = [], None
for line in src.read_text(encoding="utf-8").splitlines():
    m = re.match(r"## (\d{4}-\d{2}-\d{2}) · (.+)$", line)
    if m:
        cur = {"date": m.group(1), "q": m.group(2).strip()}
        entries.append(cur)
        continue
    m = re.match(r"(%s): (.+)$" % "|".join(FIELDS), line)
    if cur and m:
        cur[m.group(1)] = m.group(2).strip()

for e in entries:
    if e.get("Status") not in STATUSES or "Decision" not in e:
        sys.exit(f"entry {e['date']} '{e['q']}' needs Status ({', '.join(STATUSES)}) and Decision")
    slug = re.sub(r"[^a-z0-9]+", "-", e["q"].lower()).strip("-")[:60].rstrip("-")
    e["id"] = f"{e['date']}-{slug}"
entries.sort(key=lambda e: e["date"], reverse=True)

esc = html.escape
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
day = lambda d: f"{int(d[8:])} {MONTHS[int(d[5:7]) - 1]} {d[:4]}"
link = lambda u: f'<a href="{esc(u)}">{esc(re.sub(r"^https?://(www\\.)?", "", u).rstrip("/"))}</a>'

index = (out / "index.html").read_text(encoding="utf-8")
m = re.search(r'<svg[^>]*class="lockup".*?</svg>', index, re.S)
lockup = m.group(0) if m else "NODE"
counts = {s: sum(1 for e in entries if e["Status"] == s) for s in STATUSES}

items = []
for e in entries:
    rows = [f'<dt class="label">Decision</dt><dd>{esc(e["Decision"])}</dd>']
    if e.get("Why"):
        rows.append(f'<dt class="label">Why</dt><dd>{esc(e["Why"])}</dd>')
    if e.get("Next"):
        rows.append(f'<dt class="label">Next</dt><dd>{esc(e["Next"])}</dd>')
    if e.get("Read"):
        rows.append(f'<dt class="label">Read</dt><dd>{link(e["Read"])}</dd>')
    st = e["Status"]
    items.append(f'''    <article class="entry" id="{e["id"]}" data-status="{esc(st)}">
      <div class="meta"><time class="tele" datetime="{e["date"]}">{day(e["date"])}</time><span class="status s-{st.lower().replace(" ", "-")}">{esc(st)}</span></div>
      <div class="body">
        <h2 class="q"><a href="#{e["id"]}">{esc(e["q"])}</a></h2>
        <dl>{"".join(rows)}</dl>
      </div>
    </article>''')

filters = '<button type="button" class="chip" aria-pressed="true" data-f="all">All · ' + str(len(entries)) + "</button>" + "".join(
    f'<button type="button" class="chip" aria-pressed="false" data-f="{s}">{s} · {counts[s]}</button>' for s in STATUSES if counts[s])

page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Decision log · NODE Research Browser</title>
<meta name="description" content="The questions we asked while building NODE Research Browser, and what we decided. Newest first.">
<link rel="canonical" href="{SITE}/log">
<link rel="alternate" type="application/rss+xml" title="NODE decision log" href="{SITE}/log.xml">
<meta name="theme-color" content="#000000">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="NODE decision log">
<meta property="og:description" content="The questions we asked while building NODE Research Browser, and what we decided.">
<meta property="og:url" content="{SITE}/log">
<meta property="og:image" content="{SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<script>window.va=window.va||function(){{(window.vaq=window.vaq||[]).push(arguments)}};</script>
<script defer src="/_vercel/insights/script.js"></script>
<style>
@font-face{{font-family:"Barlow";font-weight:400;font-display:swap;src:url(/fonts/barlow-latin-400-normal.woff2) format("woff2")}}
@font-face{{font-family:"Barlow";font-weight:600;font-display:swap;src:url(/fonts/barlow-latin-600-normal.woff2) format("woff2")}}
@font-face{{font-family:"Barlow";font-weight:700;font-display:swap;src:url(/fonts/barlow-latin-700-normal.woff2) format("woff2")}}
@font-face{{font-family:"JetBrains Mono";font-weight:400;font-display:swap;src:url(/fonts/jetbrains-mono-latin-400-normal.woff2) format("woff2")}}
:root{{--surface:#000;--raised:#0e0e0f;--line:#2a2a2d;--ink:#fff;--muted:#a1a1a6;--signal:#b18cff;
  --sans:"Barlow","Helvetica Neue",Arial,sans-serif;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace;color-scheme:dark}}
*{{box-sizing:border-box}}
html,body{{margin:0}}
body{{background:var(--surface);color:var(--ink);font:400 16px/24px var(--sans);-webkit-font-smoothing:antialiased}}
a{{color:var(--ink);text-underline-offset:3px}}
a:focus-visible,button:focus-visible{{outline:2px solid var(--signal);outline-offset:2px}}
.label{{font:600 12px/16px var(--sans);letter-spacing:.12em;text-transform:uppercase}}
.tele{{font:400 13px/20px var(--mono);color:var(--muted)}}
header{{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px max(24px,env(safe-area-inset-left));border-bottom:1px solid var(--line)}}
header .lockup{{height:22px;width:auto;display:block}}
.btn{{display:inline-flex;align-items:center;height:36px;padding:0 16px;border:1px solid var(--ink);border-radius:2px;font:600 12px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;text-decoration:none}}
.btn:hover{{background:var(--ink);color:var(--surface)}}
main{{max-width:960px;margin:0 auto;padding:56px 24px 96px}}
h1{{font:700 clamp(36px,6vw,56px)/1 var(--sans);letter-spacing:.04em;text-transform:uppercase;margin:0 0 16px}}
.lead{{color:var(--muted);max-width:60ch;margin:0 0 24px}}
.filters{{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 40px}}
.chip{{appearance:none;background:none;border:1px solid var(--line);border-radius:2px;color:var(--muted);height:32px;padding:0 12px;cursor:pointer;font:600 11px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase}}
.chip:hover{{color:var(--ink)}}
.chip[aria-pressed="true"]{{background:var(--ink);border-color:var(--ink);color:var(--surface)}}
.entry{{display:grid;grid-template-columns:160px minmax(0,1fr);gap:24px;padding:32px 0;border-top:1px solid var(--line)}}
.entry[hidden]{{display:none}}
.meta{{display:flex;flex-direction:column;gap:8px;align-items:flex-start}}
.status{{font:600 11px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;padding:5px 8px;border:1px solid var(--line);border-radius:2px;color:var(--muted)}}
.s-open,.s-proposed{{border-color:var(--ink);color:var(--ink)}}
.s-parked,.s-in-progress{{border-style:dashed}}
.q{{font:600 24px/30px var(--sans);margin:0 0 16px;text-wrap:balance}}
.q a{{text-decoration:none}}
.q a:hover{{text-decoration:underline}}
dl{{display:grid;grid-template-columns:96px minmax(0,1fr);gap:10px 16px;margin:0}}
dt{{color:var(--muted);padding-top:4px}}
dd{{margin:0;max-width:62ch;overflow-wrap:anywhere}}
footer{{border-top:1px solid var(--line);padding-top:24px;margin-top:8px;display:flex;flex-wrap:wrap;gap:8px 24px}}
@media (max-width:700px){{
  main{{padding:40px 16px 72px}}
  header{{padding:16px}}
  .entry{{grid-template-columns:minmax(0,1fr);gap:12px}}
  .meta{{flex-direction:row;align-items:center;gap:12px}}
  .q{{font-size:20px;line-height:26px}}
  dl{{grid-template-columns:minmax(0,1fr);gap:4px}}
  dd{{margin-bottom:10px}}
}}
</style>
</head>
<body>
<header>
  <a href="/" aria-label="NODE Research Browser home">{lockup}</a>
  <a class="btn" href="/#downloads" data-track="log-get">Get NODE</a>
</header>
<main>
  <p class="tele">Decision log · {len(entries)} entries · updated {day(entries[0]["date"])}</p>
  <h1>Questions and decisions</h1>
  <p class="lead">What we asked while building NODE, what we decided and why. Newest first. Open and proposed items can still change. <a href="/log.xml">RSS feed</a>.</p>
  <div class="filters" role="group" aria-label="Filter by status">{filters}</div>
{chr(10).join(items)}
  <footer class="tele"><a href="/">noderesearch.app</a><a href="https://github.com/westernCasa/node_browser/blob/main/docs/decision-log.md">Source of this page</a><a href="https://github.com/westernCasa/node_browser/releases">Releases</a></footer>
</main>
<script>
(function(){{
  var chips=document.querySelectorAll(".chip"),rows=document.querySelectorAll(".entry");
  chips.forEach(function(c){{c.addEventListener("click",function(){{
    var f=c.getAttribute("data-f");
    chips.forEach(function(x){{x.setAttribute("aria-pressed",String(x===c))}});
    rows.forEach(function(r){{r.hidden=f!=="all"&&r.getAttribute("data-status")!==f}});
  }})}});
  document.querySelectorAll("[data-track]").forEach(function(a){{a.addEventListener("click",function(){{window.va("event",{{name:a.getAttribute("data-track")}})}})}});
}})();
</script>
</body>
</html>
'''
(out / "log.html").write_text(page, encoding="utf-8")

def rfc822(d):
    return format_datetime(datetime.strptime(d, "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc))

rss_items = []
for e in entries:
    desc = f'{e["Status"]}. {e["Decision"]}' + (f' Why: {e["Why"]}' if e.get("Why") else "") + (f' Next: {e["Next"]}' if e.get("Next") else "")
    rss_items.append(f'''  <item>
    <title>{esc(e["q"])}</title>
    <link>{SITE}/log#{e["id"]}</link>
    <guid isPermaLink="false">node-log-{e["id"]}-{e["Status"].lower().replace(" ", "-")}</guid>
    <pubDate>{rfc822(e["date"])}</pubDate>
    <description>{esc(desc)}</description>
  </item>''')
rss = f'''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>NODE decision log</title>
  <link>{SITE}/log</link>
  <atom:link href="{SITE}/log.xml" rel="self" type="application/rss+xml"/>
  <description>Questions asked while building NODE Research Browser, and what was decided.</description>
  <language>en</language>
  <lastBuildDate>{rfc822(entries[0]["date"])}</lastBuildDate>
{chr(10).join(rss_items)}
</channel>
</rss>
'''
(out / "log.xml").write_text(rss, encoding="utf-8")
print(f"{out}/log.html, {out}/log.xml: {len(entries)} entries")
