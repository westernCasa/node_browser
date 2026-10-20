// NODE icons: 20 px grid, 1.5 px stroke, square caps. Generated from icons/*.svg.
// Usage: NodeIcons.inject() once, then <svg class="ic"><use href="#i-NAME"/></svg>, or NodeIcons.svg("NAME").
(function () {
  const PATHS = {
    "back": "<path d=\"M12 4 6 10l6 6\"/>",
    "forward": "<path d=\"M8 4l6 6-6 6\"/>",
    "reload": "<path d=\"M16 10a6 6 0 1 1-1.8-4.3\"/><path d=\"M16 3v4h-4\"/>",
    "plus": "<path d=\"M10 4v12M4 10h12\"/>",
    "close": "<path d=\"M5 5l10 10M15 5 5 15\"/>",
    "up": "<path d=\"M5 12.5l5-5 5 5\"/>",
    "down": "<path d=\"M5 7.5l5 5 5-5\"/>",
    "star": "<path d=\"M10 3l2.1 4.6 4.9.5-3.7 3.3 1.1 4.9-4.4-2.5-4.4 2.5 1.1-4.9L3 8.1l4.9-.5z\"/>",
    "mosaic": "<rect x=\"3\" y=\"3\" width=\"6\" height=\"6\"/><rect x=\"11\" y=\"3\" width=\"6\" height=\"6\"/><rect x=\"3\" y=\"11\" width=\"6\" height=\"6\"/><rect x=\"11\" y=\"11\" width=\"6\" height=\"6\"/>",
    "focus": "<rect x=\"3\" y=\"3\" width=\"14\" height=\"14\"/>",
    "sound": "<path d=\"M3 8h3l4-3v10l-4-3H3z\"/><path d=\"M13 7.5a3.5 3.5 0 0 1 0 5\"/>",
    "sound-all": "<path d=\"M3 8h3l4-3v10l-4-3H3z\"/><path d=\"M13 7.5a3.5 3.5 0 0 1 0 5\"/><path d=\"M15.5 5a7 7 0 0 1 0 10\"/>",
    "capture": "<path d=\"M2.5 6h3l1.5-2h6l1.5 2h3v10h-15z\"/><circle cx=\"10\" cy=\"10.5\" r=\"3\"/>",
    "agents": "<path d=\"M7 3v4M13 3v4\"/><path d=\"M5 7h10v3a5 5 0 0 1-10 0z\"/><path d=\"M10 15v2.5\"/>",
    "share": "<path d=\"M10 3v9M6.5 6.5 10 3l3.5 3.5\"/><path d=\"M4 10v7h12v-7\"/>",
    "suggest": "<rect x=\"2.5\" y=\"3.5\" width=\"15\" height=\"13\"/><path d=\"M12 3.5v13M14 7h1.5M14 10h1.5\"/>",
    "fullscreen": "<path d=\"M3 7V3h4M17 7V3h-4M3 13v4h4M17 13v4h-4\"/>",
    "exit-fullscreen": "<path d=\"M7 3v4H3M13 3v4h4M7 17v-4H3M13 17v-4h4\"/>",
    "menu": "<path d=\"M3 6h14M3 10h14M3 14h14\"/>",
    "download": "<path d=\"M10 3v9M6 8l4 4 4-4\"/><path d=\"M3 14v3h14v-3\"/>",
    "library": "<path d=\"M4 3v14M8 3v14M11.5 3.5l4 13\"/>",
    "history": "<circle cx=\"10\" cy=\"10\" r=\"7\"/><path d=\"M10 6v4l3 2\"/>",
    "bookmarks": "<path d=\"M5 3h10v14l-5-3.5L5 17z\"/>",
    "trail": "<circle cx=\"4.5\" cy=\"15\" r=\"1.5\"/><circle cx=\"10\" cy=\"9.5\" r=\"1.5\"/><circle cx=\"15.5\" cy=\"5\" r=\"1.5\"/><path d=\"M5.6 13.9l3.3-3.3M11.2 8.5l3.1-2.5\"/>",
    "settings": "<path d=\"M3 6h8M15 6h2M3 14h2M9 14h8\"/><circle cx=\"13\" cy=\"6\" r=\"2\"/><circle cx=\"7\" cy=\"14\" r=\"2\"/>",
    "help": "<circle cx=\"10\" cy=\"10\" r=\"7\"/><path d=\"M8 8a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.6M10 14v.5\"/>",
    "ask": "<path d=\"M3 4h14v9H8l-4 3v-3H3z\"/>",
    "agent": "<circle cx=\"5\" cy=\"10\" r=\"2\"/><circle cx=\"15\" cy=\"5\" r=\"2\"/><circle cx=\"15\" cy=\"15\" r=\"2\"/><path d=\"M6.8 9.1l6.4-3.2M6.8 10.9l6.4 3.2\"/>",
    "talk": "<path d=\"M2.5 3.5h10v7h-6l-3 2.5v-2.5h-1z\"/><path d=\"M15 7h2.5v7h-1v2.5l-3-2.5h-5v-1.5\"/>"
  };
  const ATTRS = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"';
  function inject() {
    if (document.getElementById("node-icon-sprite")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `<svg id="node-icon-sprite" xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">${Object.entries(PATHS)
      .map(([n, p]) => `<symbol id="i-${n}" viewBox="0 0 20 20" ${ATTRS}>${p}</symbol>`)
      .join("")}</svg>`;
    document.body.prepend(wrap.firstChild);
  }
  function svg(name, cls = "") {
    return `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
  }
  window.NodeIcons = { inject, svg, names: Object.keys(PATHS) };
})();
