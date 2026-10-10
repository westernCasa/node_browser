// Result-card previews: fetch a page and pick its best image or video
// (Open Graph, JSON-LD, the largest relevant image, YouTube thumbnails).
// Platform-neutral: the caller passes getText from net.js.

const { decodeEntities } = require("./providers");

function createPreview({ getText }) {
  function youtubeId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0];
      if (u.hostname.includes("youtube.com")) return u.searchParams.get("v") || "";
    } catch (_) {}
    return "";
  }

  function youtubeThumb(url) {
    const id = youtubeId(url);
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
  }

  function isMediaUrl(url) {
    return /\.(mp4|webm|ogg|ogv|mov|m4v|mp3|wav)(\?|$)/i.test(url || "");
  }

  function isJunkMedia(url) {
    const u = (url || "").toLowerCase();
    return (
      !u ||
      u.startsWith("data:image/svg") ||
      u.startsWith("data:image/gif") ||
      /sprite|pixel|tracking|1x1|spacer|blank|placeholder|icon[-_]?|favicon|logo[-_.]|avatar|emoji|badge|spinner|loading\.gif/.test(u)
    );
  }

  function absUrl(href, base) {
    try {
      return new URL(href, base).href;
    } catch (_) {
      return "";
    }
  }

  function scoreMedia(item, keywords) {
    let score = item.base || 0;
    const hay = `${item.src} ${item.alt || ""} ${item.poster || ""}`.toLowerCase();
    for (const k of keywords || []) {
      if (k && hay.includes(String(k).toLowerCase())) score += 28;
    }
    if (item.w && item.h) {
      score += Math.min(40, Math.log((item.w * item.h) / 1000 + 1) * 8);
      if (item.w < 64 || item.h < 64) score -= 40;
    }
    if (item.kind === "video") score += 18;
    return score;
  }

  function collectMedia(html, pageUrl, keywords) {
    const found = [];
    const push = (src, extra = {}) => {
      if (!src) return;
      const abs = absUrl(decodeEntities(src), pageUrl);
      if (!abs || isJunkMedia(abs)) return;
      found.push({ src: abs, ...extra });
    };

    const meta = (re, base = 80) => {
      const reG = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m;
      while ((m = reG.exec(html))) push(m[1], { base, kind: extraKind(m[1]) });
    };
    const extraKind = (s) => (isMediaUrl(s) ? "video" : "image");

    meta(/<meta[^>]+property=["']og:image(?::url|:secure_url)?["'][^>]+content=["']([^"']+)/gi, 90);
    meta(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)/gi, 85);
    meta(/<meta[^>]+property=["']og:video(?::url|:secure_url)?["'][^>]+content=["']([^"']+)/gi, 88);
    meta(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)/gi, 70);

    const jsonBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const block of jsonBlocks) {
      const raw = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
      try {
        const data = JSON.parse(raw);
        const walk = (node) => {
          if (!node) return;
          if (Array.isArray(node)) return node.forEach(walk);
          if (typeof node === "string") {
            if (/\.(jpe?g|png|webp|gif|avif|mp4|webm)(\?|$)/i.test(node)) push(node, { base: 72, kind: extraKind(node) });
            return;
          }
          if (typeof node !== "object") return;
          for (const key of ["image", "thumbnail", "thumbnailUrl", "contentUrl", "poster"]) {
            if (node[key]) walk(node[key]);
          }
          if (node["@graph"]) walk(node["@graph"]);
        };
        walk(data);
      } catch (_) {}
    }

    const imgRe = /<img\b([^>]*)>/gi;
    let im;
    while ((im = imgRe.exec(html))) {
      const attrs = im[1];
      const get = (n) => {
        const m = attrs.match(new RegExp(n + "=[\"']([^\"']+)", "i"));
        return m ? m[1] : "";
      };
      const srcset = get("srcset") || get("data-srcset");
      const src = get("src") || get("data-src") || get("data-lazy-src") || get("data-original");
      let best = src;
      if (srcset) {
        const parts = srcset.split(",").map((p) => p.trim().split(/\s+/));
        parts.sort((a, b) => parseInt(b[1] || "0", 10) - parseInt(a[1] || "0", 10));
        if (parts[0]?.[0]) best = parts[0][0];
      }
      push(best, {
        base: 40,
        kind: "image",
        alt: decodeEntities(get("alt") || get("title")),
        w: parseInt(get("width"), 10) || 0,
        h: parseInt(get("height"), 10) || 0,
      });
    }

    const vidRe = /<(?:video|source)\b([^>]*)>/gi;
    let vm;
    while ((vm = vidRe.exec(html))) {
      const attrs = vm[1];
      const get = (n) => {
        const m = attrs.match(new RegExp(n + "=[\"']([^\"']+)", "i"));
        return m ? m[1] : "";
      };
      const src = get("src") || get("data-src");
      const poster = get("poster");
      if (poster) push(poster, { base: 60, kind: "image", alt: "poster" });
      if (src && isMediaUrl(src)) push(src, { base: 75, kind: "video" });
    }

    const iframeRe = /<iframe\b([^>]*)>/gi;
    let ifr;
    while ((ifr = iframeRe.exec(html))) {
      const attrs = ifr[1];
      const sm = attrs.match(/src=["']([^"']+)/i);
      const src = sm ? sm[1] : "";
      const yt = youtubeThumb(absUrl(src, pageUrl));
      if (yt) push(yt, { base: 82, kind: "video" });
    }

    const ytPage = youtubeThumb(pageUrl);
    if (ytPage) push(ytPage, { base: 95, kind: "video" });

    const ranked = found
      .map((item) => ({ ...item, score: scoreMedia(item, keywords) }))
      .sort((a, b) => b.score - a.score);

    const seen = new Set();
    const unique = [];
    for (const item of ranked) {
      if (seen.has(item.src)) continue;
      seen.add(item.src);
      unique.push(item);
    }
    return unique;
  }

  async function preview(url, keywords = []) {
    const keys = Array.isArray(keywords) ? keywords : String(keywords || "").split(/\s+/).filter(Boolean);
    const quickImage = youtubeThumb(url);
    if (isMediaUrl(url)) {
      return { url, title: url, description: "", image: "", video: url, kind: "video" };
    }
    try {
      const res = await getText(url, { headers: { Accept: "text/html" }, maxBytes: 280000, timeout: 8000 });
      const html = res.text;
      const pick = (re) => {
        const m = html.match(re);
        return m ? decodeEntities(m[1]) : "";
      };
      const pageUrl = res.url || url;
      const media = collectMedia(html, pageUrl, keys);
      const topVideo = media.find((m) => m.kind === "video" && isMediaUrl(m.src));
      const topImage = media.find((m) => m.kind !== "video" || !isMediaUrl(m.src)) || media[0];
      const image = topImage?.src || quickImage;
      const video = topVideo?.src || "";
      return {
        url: pageUrl,
        title:
          pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ||
          pick(/<title[^>]*>([\s\S]*?)<\/title>/i) ||
          url,
        description:
          pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i) ||
          pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i),
        image,
        video,
        kind: video ? "video" : image ? "image" : "page",
      };
    } catch (err) {
      return {
        url,
        title: url,
        description: "",
        image: quickImage,
        video: "",
        kind: quickImage ? "video" : "page",
        error: String(err.message || err),
      };
    }
  }

  return { preview, youtubeThumb, isMediaUrl, collectMedia };
}

module.exports = { createPreview };
