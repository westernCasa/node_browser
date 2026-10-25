// Scripts injected into web pages. Shared by the desktop app (executeJavaScript)
// and the mobile app (WebView injectJavaScript). Each returns a JavaScript
// source string that evaluates to its result.

/**
 * Reads the visible page: title, description, headings, selected text, visible
 * readable text, media names, plus extra text from site-rule selectors.
 * Evaluates to a plain object (see keywords.js rankTerms for the fields used).
 */
function extractionScript(ruleExtract) {
  return `(() => {
    const MEDIA_EXT = /\\.(mp4|webm|ogv|ogg|mov|m4v|mp3|wav|m4a|aac|flac|jpg|jpeg|png|webp|gif|avif|m3u8)([?#].*)?$/i;
    const inView = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      const vw = window.innerWidth || 0;
      return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw && r.width > 8 && r.height > 8;
    };
    // Elements near the viewport, in document order. Long lists (thousands of
    // paragraphs or links) are mostly laid out top to bottom, so a binary search
    // finds where the viewport starts and the scan stops a little past its end,
    // instead of measuring every element on the page.
    const nearView = (list) => {
      const n = list.length;
      if (n < 300) return Array.from(list);
      const vh = window.innerHeight || 0;
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].getBoundingClientRect().bottom <= 0) lo = mid + 1;
        else hi = mid;
      }
      const out = [];
      let below = 0;
      for (let i = Math.max(0, lo - 150); i < n && below < 150; i++) {
        const el = list[i];
        const r = el.getBoundingClientRect();
        if (r.top >= vh && r.height > 0) below++;
        else below = 0;
        out.push(el);
      }
      return out;
    };
    const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
    const fileStem = (href) => {
      try {
        const path = new URL(href, location.href).pathname.split("/").pop() || "";
        return decodeURIComponent(path.replace(MEDIA_EXT, "").replace(/[-_]+/g, " "));
      } catch (_) { return ""; }
    };
    const namesFrom = (text) => {
      const out = [];
      const t = clean(text);
      if (!t) return out;
      const hits = t.match(/\\b[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,3}\\b/g) || [];
      for (const h of hits) {
        if (h.length < 3) continue;
        if (/^(The|A|An|And|For|With|From|This|That|You|Your|Home|Page|Video|Image|Photo)$/.test(h)) continue;
        out.push(h);
      }
      return out;
    };

    const mediaEls = [...document.querySelectorAll("img,video,audio,source,picture,figure,figcaption,track,iframe")];
    const mediaMeta = [];
    const names = [];
    const mediaLinks = [];

    const takeMeta = (el) => {
      const bits = [
        el.getAttribute && el.getAttribute("alt"),
        el.getAttribute && el.getAttribute("title"),
        el.getAttribute && el.getAttribute("aria-label"),
        el.getAttribute && el.getAttribute("data-title"),
        el.getAttribute && el.getAttribute("data-caption"),
        el.getAttribute && el.getAttribute("data-name"),
        el.getAttribute && el.getAttribute("itemprop") === "name" ? el.textContent : "",
      ];
      if (el.tagName === "VIDEO" || el.tagName === "AUDIO") bits.push(el.getAttribute("media-title"));
      const fig = el.closest && el.closest("figure");
      if (fig) {
        const cap = fig.querySelector("figcaption");
        if (cap) bits.push(cap.innerText);
      }
      const labeled = el.getAttribute && el.getAttribute("aria-labelledby");
      if (labeled) {
        const lab = document.getElementById(labeled);
        if (lab) bits.push(lab.innerText);
      }
      const joined = bits.map(clean).filter(Boolean).join(" | ");
      if (joined) mediaMeta.push(joined.slice(0, 240));
      names.push(...namesFrom(joined));
      const srcs = [
        el.currentSrc, el.src, el.getAttribute && el.getAttribute("src"),
        el.getAttribute && el.getAttribute("data-src"),
        el.getAttribute && el.getAttribute("poster"),
      ].filter(Boolean);
      for (const s of srcs) {
        const stem = fileStem(s);
        if (stem && stem.length > 2) {
          mediaMeta.push(stem);
          names.push(...namesFrom(stem.replace(/\\b\\w/g, c => c.toUpperCase())));
        }
      }
    };

    // Icons, logos and avatars (small images, or images in the site's menus
    // and buttons) describe the site, not the page (B67).
    const CHROME = "nav, header, [role=banner], [role=navigation], button, [role=button], [role=menu], [role=menuitem]";
    for (const el of mediaEls) {
      if (!inView(el.tagName === "SOURCE" ? el.parentElement : el) && el.tagName !== "META") continue;
      if (el.tagName === "IMG" || el.tagName === "PICTURE") {
        const r = el.getBoundingClientRect();
        if ((r.width < 64 && r.height < 64) || (el.closest && el.closest(CHROME))) continue;
      }
      takeMeta(el);
    }

    for (const a of nearView(document.querySelectorAll("a[href]"))) {
      if (!inView(a)) continue;
      const href = a.href || "";
      const looksMedia = MEDIA_EXT.test(href) || /\\/(watch|video|videos|media|photo|photos|image|gallery|embed)\\b/i.test(href);
      if (!looksMedia) continue;
      const label = clean(a.getAttribute("title") || a.getAttribute("aria-label") || a.innerText);
      mediaLinks.push(label || fileStem(href));
      names.push(...namesFrom(label));
      const stem = fileStem(href);
      if (stem) mediaMeta.push(stem);
    }

    const pageMeta = [
      document.querySelector('meta[property="og:video"]')?.content,
      document.querySelector('meta[property="og:audio"]')?.content,
      document.querySelector('meta[property="og:image"]')?.content,
      document.querySelector('meta[property="og:video:title"]')?.content,
      document.querySelector('meta[name="twitter:player"]')?.content,
      document.querySelector('meta[itemprop="name"]')?.content,
      document.querySelector('meta[name="author"]')?.content,
      document.querySelector('meta[property="og:title"]')?.content,
    ].filter(Boolean);
    for (const m of pageMeta) {
      if (MEDIA_EXT.test(m)) mediaLinks.push(fileStem(m));
      names.push(...namesFrom(m));
      if (/og:title|author|name|video:title/i.test(m) || namesFrom(m).length) mediaMeta.push(String(m).slice(0, 160));
    }
    names.push(...namesFrom(document.querySelector('meta[property="og:title"]')?.content || ""));
    names.push(...namesFrom(document.querySelector('meta[name="author"]')?.content || ""));
    names.push(...namesFrom(document.querySelector('[itemprop="author"],[rel="author"],.author,.byline')?.innerText || ""));

    const uniq = (arr) => [...new Set(arr.map(clean).filter((x) => x && x.length > 1))].slice(0, 16);

    // Page text (B07): title, description, headings, selection, and the
    // readable text currently in the viewport (navigation and footers skipped).
    // Site rule selectors (B16); invalid selectors are dropped.
    const RULE = ${JSON.stringify(ruleExtract || {})};
    const validSel = (sel) => { try { document.querySelector(sel); return true; } catch (_) { return false; } };
    const extraSkip = (RULE.skip || []).filter(validSel);
    // Buttons, labels and pop-up dialogs hold interface text, not the page's topic.
    const SKIP = ["nav, footer, aside, header nav, [role=navigation], [role=contentinfo], [role=banner] nav, [aria-hidden=true], .navbox, .sidebar, .menu, .cookie, #cookie, .ad, .ads, button, [role=button], label, dialog, [role=dialog], [role=alertdialog], [aria-modal=true]", ...extraSkip].join(", ");
    let focus = "";
    for (const sel of (RULE.include || []).filter(validSel)) {
      for (const el of document.querySelectorAll(sel)) {
        if (focus.length > 3000) break;
        const t = clean(el.innerText);
        if (t) focus += t + " . ";
      }
    }
    const meta = (sel) => document.querySelector(sel)?.content || "";
    const description = clean(meta('meta[name="description"]') || meta('meta[property="og:description"]'));
    const headings = [];
    for (const h of document.querySelectorAll("h1, h2, h3")) {
      if (h.closest(SKIP)) continue;
      const t = clean(h.innerText);
      if (t && t.length < 160) headings.push({ t, inView: inView(h), top: h.tagName === "H1" });
    }
    headings.sort((a, b) => (b.top - a.top) || (b.inView - a.inView));
    // The text comes in blocks (one per paragraph, list item, cell...) so the
    // ranking can recognise blocks that repeat on every page of a site.
    let text = "";
    const blocks = [];
    for (const el of nearView(document.querySelectorAll("p, li, dd, blockquote, td, figcaption, h1, h2, h3, h4, article div:not(:has(*))"))) {
      if (text.length > 6000) break;
      if (!inView(el) || el.closest(SKIP)) continue;
      const t = clean(el.innerText);
      if (t.length > 20) {
        text += t + " . ";
        if (blocks.length < 150) blocks.push(t.slice(0, 400));
      }
    }
    const selection = clean(String(window.getSelection ? window.getSelection() : "")).slice(0, 600);
    return {
      url: location.href,
      title: document.title || "",
      description,
      headings: headings.slice(0, 20).map((h) => h.t),
      selection,
      text: text.slice(0, 6000),
      blocks,
      focus: focus.slice(0, 3000),
      lang: document.documentElement.lang || "",
      names: uniq(names),
      mediaMeta: uniq(mediaMeta),
      mediaLinks: uniq(mediaLinks),
      viewport: true
    };
  })()`;
}

/**
 * Plays the page's main media as soon as it exists: the largest visible video
 * or embedded player (YouTube, Vimeo, Dailymotion), or else the first audio
 * element. Runs once per page address; players that appear later (lazy or
 * script-built players, single-page sites changing address) are caught by a
 * short-lived observer. Media the user pauses is left paused.
 * mode "on" plays with sound and falls back to muted if the page refuses
 * sound; "muted" plays muted.
 */
function autoplayScript(mode = "on") {
  return `(() => {
    const MUTED = ${mode === "muted"};
    const EMBED = /youtube\\.com|youtube-nocookie\\.com|youtu\\.be|player\\.vimeo\\.com|dailymotion\\.com/;
    const st = (window.__scoutAutoplay = window.__scoutAutoplay || { url: "", started: false, obs: null, timer: 0 });
    if (st.url !== location.href) {
      st.url = location.href;
      st.started = false;
    }
    if (st.started) return;

    const box = (el) => el.getBoundingClientRect();
    const usable = (el) => {
      const r = box(el);
      return r.width >= 80 && r.height >= 45 && r.bottom > 0 && r.top < (window.innerHeight || 800) * 1.5;
    };
    const area = (el) => { const r = box(el); return r.width * r.height; };

    const playEl = (el) => {
      if (!el.paused && !el.ended) return;
      if (MUTED) el.muted = true;
      const run = () => el.play().catch(() => {
        el.muted = true;
        el.play().catch(() => {});
      });
      if (el.readyState >= 2) run();
      else el.addEventListener("canplay", run, { once: true });
    };
    const playFrame = (f) => {
      try {
        const u = new URL(f.getAttribute("src") || f.getAttribute("data-src") || "", location.href);
        if (u.searchParams.get("autoplay") === "1") return;
        u.searchParams.set("autoplay", "1");
        if (MUTED) u.searchParams.set("mute", "1");
        f.allow = ((f.allow || "") + "; autoplay; fullscreen").replace(/^; /, "");
        f.src = u.toString();
      } catch (_) {}
    };

    const attempt = () => {
      if (st.started) return true;
      const candidates = [
        ...[...document.querySelectorAll("video")].filter(usable).map((el) => ({ el, kind: "video" })),
        ...[...document.querySelectorAll("iframe")]
          .filter((f) => EMBED.test(f.getAttribute("src") || f.getAttribute("data-src") || "") && usable(f))
          .map((el) => ({ el, kind: "frame" })),
      ].sort((a, b) => area(b.el) - area(a.el));
      let main = candidates[0];
      if (!main) {
        const audio = document.querySelector("audio");
        if (audio) main = { el: audio, kind: "audio" };
      }
      if (!main) return false;
      st.started = true;
      if (main.kind === "frame") playFrame(main.el);
      else playEl(main.el);
      return true;
    };

    if (attempt()) return;
    // No player yet: watch for one for up to 20 s.
    if (st.obs) st.obs.disconnect();
    let pending = 0;
    st.obs = new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = 0;
        if (attempt() && st.obs) { st.obs.disconnect(); st.obs = null; }
      }, 250);
    });
    st.obs.observe(document.documentElement, { childList: true, subtree: true });
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { if (st.obs) { st.obs.disconnect(); st.obs = null; } }, 20000);
  })()`;
}

/** Pauses media the page starts on its own before the user has interacted with it. */
function blockAutoplayScript() {
  return `(() => {
    const active = () => navigator.userActivation && navigator.userActivation.hasBeenActive;
    const stop = (el) => { if (el && el.pause && !active()) el.pause(); };
    if (!window.__scoutNoAutoplay) {
      window.__scoutNoAutoplay = true;
      document.addEventListener("play", (e) => stop(e.target), true);
    }
    document.querySelectorAll("video, audio").forEach((el) => { if (!el.paused) stop(el); });
  })()`;
}

/**
 * Centers media in the view when the user clicks it: a video, audio player,
 * image, canvas, or embedded player (YouTube, Vimeo and similar iframes).
 * Clicks on overlays drawn above a video (custom player controls) count too.
 * Small images (icons, avatars) are ignored, and media already near the
 * middle of the view is left where it is. Installed once per page.
 */
function centerOnClickScript() {
  return `(() => {
    if (window.__scoutCenter) return;
    window.__scoutCenter = true;
    const MEDIA = "video, audio, img, picture, canvas, embed, object, iframe";
    const PLAYER = /youtube\\.com|youtube-nocookie\\.com|youtu\\.be|vimeo\\.com|dailymotion\\.com|twitch\\.tv|soundcloud\\.com|spotify\\.com|bandcamp\\.com|streamable\\.com|wistia|jwplayer|brightcove/;
    const isMedia = (el) => {
      if (!el || !el.matches || !el.matches(MEDIA)) return false;
      if (el.tagName !== "IFRAME") return true;
      const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
      const allow = (el.getAttribute("allow") || "") + (el.hasAttribute("allowfullscreen") ? " fullscreen" : "");
      return PLAYER.test(src) || /autoplay|fullscreen|picture-in-picture/.test(allow);
    };
    const center = (el) => {
      if (!el || !el.getBoundingClientRect) return;
      if (el.tagName === "SOURCE" || el.tagName === "PICTURE") el = el.querySelector("img") || el.parentElement || el;
      const r = el.getBoundingClientRect();
      if (el.tagName !== "AUDIO" && (r.width < 120 || r.height < 80)) return;
      const vh = window.innerHeight || 0;
      const offset = r.top + r.height / 2 - vh / 2;
      if (r.height <= vh && Math.abs(offset) < 40) return;
      el.scrollIntoView({ behavior: "smooth", block: r.height > vh ? "start" : "center", inline: "nearest" });
    };
    window.addEventListener("click", (e) => {
      const path = e.composedPath ? e.composedPath() : [e.target];
      let el = path.find(isMedia);
      if (!el && document.elementsFromPoint) el = document.elementsFromPoint(e.clientX, e.clientY).find(isMedia);
      if (el) requestAnimationFrame(() => center(el));
    }, true);
    // A click inside an embedded player goes to the iframe, not this page;
    // the page only sees that it lost focus to the iframe.
    window.addEventListener("blur", () => setTimeout(() => {
      const a = document.activeElement;
      if (a && a.tagName === "IFRAME" && isMedia(a)) center(a);
    }, 0));
  })()`;
}

/**
 * The page's readable text for "Ask about this page": the main article (or
 * <main>, or the body) without navigation, footers, scripts and forms.
 * Evaluates to { url, title, text, selection }.
 */
function readableTextScript(maxChars = 20000) {
  return `(() => {
    const root = document.querySelector("article") || document.querySelector("main, [role=main]") || document.body;
    const copy = root ? root.cloneNode(true) : document.createElement("div");
    copy.querySelectorAll("nav, footer, aside, header nav, script, style, noscript, form, iframe, svg, [role=navigation], [aria-hidden=true], .navbox, .reflist, .mw-editsection").forEach((n) => n.remove());
    const text = (copy.innerText || copy.textContent || "").replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, ${Number(maxChars) || 20000});
    return { url: location.href, title: document.title || "", text, selection: String(window.getSelection ? window.getSelection() : "").slice(0, 1500) };
  })()`;
}

/**
 * Picture-in-picture for the page's main video: the playing one, else the
 * largest visible one. Closes picture-in-picture if it is already open.
 * Evaluates to "opened", "closed", or "none" (no video in this frame).
 */
function pipScript() {
  return `(async () => {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      return "closed";
    }
    const vids = [...document.querySelectorAll("video")].filter((v) => v.readyState > 0 && !v.disablePictureInPicture);
    if (!vids.length) return "none";
    const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
    const v = vids.find((x) => !x.paused) || vids.sort((a, b) => area(b) - area(a))[0];
    await v.requestPictureInPicture();
    return "opened";
  })()`;
}

/** Pauses all playing media and marks it, so resumeScript can start it again (playback limit). */
function pauseForLimitScript() {
  return `(() => {
    let n = 0;
    document.querySelectorAll("video, audio").forEach((el) => {
      if (!el.paused && !el.ended) { el.__scoutLimited = true; el.pause(); n++; }
    });
    return n;
  })()`;
}

/** Resumes media paused by pauseForLimitScript. */
function resumeScript() {
  return `(() => {
    let n = 0;
    document.querySelectorAll("video, audio").forEach((el) => {
      if (el.__scoutLimited) { el.__scoutLimited = false; el.play().catch(() => {}); n++; }
    });
    return n;
  })()`;
}

/** True if any media element in the document is playing. */
function anyPlayingScript() {
  return `[...document.querySelectorAll("video, audio")].some((el) => !el.paused && !el.ended)`;
}

module.exports = { extractionScript, autoplayScript, blockAutoplayScript, centerOnClickScript, pipScript, readableTextScript, pauseForLimitScript, resumeScript, anyPlayingScript };
