// Agent view (D2 in the agent research): a page's main content as Markdown.
// Shorter and cleaner than HTML for language models and agents: headings,
// paragraphs, lists, links, tables, quotes and code are kept; navigation,
// footers, ads, scripts, forms and hidden elements are dropped.
//
// toMarkdown runs inside the page (injected by markdownScript), so it uses only
// DOM APIs and no imports. Shared by the desktop app and, later, mobile.

function toMarkdown(maxChars) {
  const SKIP = "script,style,noscript,template,svg,canvas,iframe,form,button,input,select,textarea,nav,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[role=complementary],[aria-hidden=true],[hidden],.navbox,.reflist,.mw-editsection,.ad,.ads,.advert,.cookie,.cookies,.newsletter,.share,.social";
  const pick = () => {
    const cands = [document.querySelector("article"), document.querySelector("main, [role=main]"), document.body].filter(Boolean);
    // Prefer the candidate that holds most of the page's paragraph text.
    let best = cands[cands.length - 1];
    let bestLen = 0;
    for (const c of cands) {
      const len = Array.from(c.querySelectorAll("p")).reduce((n, p) => n + (p.textContent || "").length, 0);
      if (len > bestLen * 1.25) {
        best = c;
        bestLen = len;
      }
    }
    return best;
  };
  // Text a reader cannot see is left out: it is where prompt-injection
  // instructions are usually hidden (tiny, transparent, same colour as the
  // background, moved off screen or clipped away).
  const rgb = (c) => (String(c).match(/[\d.]+/g) || []).map(Number);
  const backgroundOf = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) return c;
    }
    // No background set anywhere: the browser's default, dark for pages that
    // ask for a dark colour scheme.
    const scheme = getComputedStyle(document.documentElement).colorScheme || "";
    return /^dark|only dark/.test(scheme.trim()) ? [18, 18, 18] : [255, 255, 255];
  };
  const invisible = (el, st) => {
    if (Number(st.opacity) < 0.1) return true;
    if (parseFloat(st.fontSize) < 4) return true;
    const fg = rgb(st.color);
    if (fg.length >= 4 && fg[3] < 0.1) return true;
    const bg = backgroundOf(el);
    if (fg.length >= 3 && Math.abs(fg[0] - bg[0]) + Math.abs(fg[1] - bg[1]) + Math.abs(fg[2] - bg[2]) < 30) return true;
    if (st.position === "absolute" || st.position === "fixed") {
      const r = el.getBoundingClientRect();
      if (r.right < -100 || r.bottom < -100 || r.left > innerWidth + 2000) return true;
      if (r.width <= 2 && r.height <= 2) return true;
    }
    if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(st.clip) || st.clipPath === "inset(50%)") return true;
    return false;
  };
  const hidden = (el) => {
    if (el.matches && el.matches(SKIP)) return true;
    const st = el.ownerDocument.defaultView.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return true;
    return invisible(el, st);
  };
  const abs = (href) => {
    try {
      return new URL(href, location.href).href;
    } catch (_) {
      return "";
    }
  };
  const clean = (s) => s.replace(/\s+/g, " ");
  const esc = (s) => s.replace(/([*_`\[\]])/g, "\\$1");

  // Inline content: text, links, emphasis, code, images (alt text).
  const inline = (node) => {
    let out = "";
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) {
        out += esc(clean(ch.textContent));
        continue;
      }
      if (ch.nodeType !== 1 || hidden(ch)) continue;
      const tag = ch.tagName.toLowerCase();
      if (tag === "br") out += "\n";
      else if (tag === "a") {
        const text = inline(ch).trim();
        const href = abs(ch.getAttribute("href") || "");
        out += text && /^https?:/.test(href) ? `[${text}](${href})` : text;
      } else if (tag === "strong" || tag === "b") {
        const t = inline(ch).trim();
        out += t ? `**${t}**` : "";
      } else if (tag === "em" || tag === "i") {
        const t = inline(ch).trim();
        out += t ? `*${t}*` : "";
      } else if (tag === "code") out += "`" + ch.textContent.replace(/`/g, "'") + "`";
      else if (tag === "img") {
        const alt = clean(ch.getAttribute("alt") || "").trim();
        if (alt) out += `[image: ${esc(alt)}]`;
      } else out += inline(ch);
    }
    return out;
  };

  const blocks = [];
  const push = (s) => {
    const t = s.replace(/[ \t]+\n/g, "\n").trim();
    if (t) blocks.push(t);
  };
  const table = (el) => {
    const rows = Array.from(el.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map((c) => inline(c).trim().replace(/\|/g, "\\|").replace(/\n/g, " ")));
    if (!rows.length) return;
    const n = Math.max(...rows.map((r) => r.length));
    const pad = (r) => r.concat(Array(n - r.length).fill(""));
    const lines = [`| ${pad(rows[0]).join(" | ")} |`, `| ${Array(n).fill("---").join(" | ")} |`];
    for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
    push(lines.join("\n"));
  };
  const list = (el, depth) => {
    const ordered = el.tagName.toLowerCase() === "ol";
    let i = 1;
    const lines = [];
    for (const li of el.children) {
      if (li.tagName.toLowerCase() !== "li" || hidden(li)) continue;
      const own = document.createElement("div");
      for (const ch of li.childNodes) if (!(ch.nodeType === 1 && /^(ul|ol)$/i.test(ch.tagName))) own.appendChild(ch.cloneNode(true));
      lines.push(`${"  ".repeat(depth)}${ordered ? `${i++}.` : "-"} ${inline(own).trim()}`);
      for (const sub of li.children) if (/^(ul|ol)$/i.test(sub.tagName)) lines.push(list(sub, depth + 1));
    }
    return lines.join("\n");
  };
  const walk = (el) => {
    for (const ch of el.children) {
      if (hidden(ch)) continue;
      const tag = ch.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) push(`${"#".repeat(Number(tag[1]))} ${inline(ch).trim()}`);
      else if (tag === "p") push(inline(ch));
      else if (tag === "ul" || tag === "ol") push(list(ch, 0));
      else if (tag === "pre") push("```\n" + ch.textContent.replace(/\n+$/, "") + "\n```");
      else if (tag === "blockquote") push(inline(ch).trim().split("\n").map((l) => "> " + l).join("\n"));
      else if (tag === "table") table(ch);
      else if (tag === "figure") {
        const cap = ch.querySelector("figcaption");
        const img = ch.querySelector("img");
        const alt = img ? clean(img.getAttribute("alt") || "").trim() : "";
        push([alt && `[image: ${alt}]`, cap && `*${inline(cap).trim()}*`].filter(Boolean).join(" "));
      } else if (tag === "hr") push("---");
      else if (tag === "img") push(inline({ childNodes: [ch] }));
      else if (ch.children.length) walk(ch);
      else push(inline(ch));
    }
  };
  walk(pick());
  let markdown = blocks.join("\n\n");
  const limit = Number(maxChars) || 40000;
  const truncated = markdown.length > limit;
  if (truncated) markdown = markdown.slice(0, limit) + "\n\n[... cut at " + limit + " characters]";
  const meta = (name) => (document.querySelector(`meta[name="${name}"], meta[property="${name}"]`) || {}).content || "";
  return {
    url: location.href,
    title: document.title || "",
    description: meta("description") || meta("og:description"),
    markdown,
    truncated,
    // Pages where an agent must not read or act (enforced in main.js).
    sensitive: Boolean(document.querySelector('input[type=password], input[autocomplete^="cc-"], input[name*="card" i][name*="number" i]')),
  };
}

function markdownScript(maxChars = 40000) {
  return `(${toMarkdown.toString()})(${Number(maxChars) || 40000})`;
}

module.exports = { markdownScript, toMarkdown };
