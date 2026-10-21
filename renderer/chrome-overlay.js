// The full-screen toolbar layer (chrome-overlay.html). Shows a copy of the
// window's toolbar and slides it in and out; every click, key and edit is
// passed back to the real toolbar in the window (renderer/app.js), so the
// toolbar has one set of behaviour. Elements are found by their position
// under the toolbar ("path"), which is the same in the copy and the original.
const bar = document.getElementById("bar");
const api = window.nodeOverlay;

function pathOf(el) {
  const path = [];
  while (el && el !== bar) {
    if (!el.parentElement) return null;
    path.unshift([...el.parentElement.children].indexOf(el));
    el = el.parentElement;
  }
  return el === bar ? path : null;
}
const at = (path) => path.reduce((el, i) => el?.children[i], bar);

// Apply a new copy, keeping a field being typed in. Wait while a button is
// held down, so a click is not split across two copies.
let pending = null;
let pointerDown = false;
let lastHtml = "";
function apply(m) {
  if (pointerDown) return void (pending = m);
  pending = null;
  if (m.sprite) document.getElementById("sprite").innerHTML = m.sprite;
  if (m.html !== lastHtml) {
    const active = bar.contains(document.activeElement) && document.activeElement.tagName === "INPUT" ? document.activeElement : null;
    const keep = active && { path: pathOf(active), value: active.value, start: active.selectionStart, end: active.selectionEnd };
    bar.innerHTML = m.html;
    lastHtml = m.html;
    if (keep) {
      const el = at(keep.path);
      if (el) {
        el.value = keep.value;
        el.focus();
        try { el.setSelectionRange(keep.start, keep.end); } catch (_) {}
      }
    }
  }
  for (const [path, value] of m.values || []) {
    const el = at(path);
    if (el && el !== document.activeElement) el.value = value;
  }
}
api.onMirror(apply);
addEventListener("mousedown", () => (pointerDown = true), true);
addEventListener("mouseup", () => {
  pointerDown = false;
  if (pending) setTimeout(() => pending && apply(pending), 0);
}, true);

api.onShow((on) => {
  document.body.classList.toggle("shown", on);
  if (!on && bar.contains(document.activeElement)) document.activeElement.blur();
});
api.onFocus((path) => {
  const el = at(path);
  if (!el) return;
  el.focus();
  el.select?.();
});

const mods = (e) => ({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey });
for (const type of ["click", "dblclick", "auxclick", "contextmenu"]) {
  bar.addEventListener(type, (e) => {
    const path = pathOf(e.target);
    if (!path) return;
    if (e.target.closest("input")) return; // fields are typed in here; their edits are sent below
    if (type !== "click") e.preventDefault();
    api.send({ type, path, button: e.button, detail: e.detail, x: e.clientX, y: e.clientY, ...mods(e) });
  });
}
bar.addEventListener("mousedown", (e) => e.button === 1 && e.preventDefault()); // no autoscroll icon
bar.addEventListener("input", (e) => {
  const path = pathOf(e.target);
  if (path) api.send({ type: "input", path, value: e.target.value });
});
bar.addEventListener("keydown", (e) => {
  if (e.target.tagName !== "INPUT") return;
  const path = pathOf(e.target);
  if (!path) return;
  if (e.key === "Enter" || e.key === "Escape" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.metaKey || e.ctrlKey) {
    api.send({ type: "keydown", path, key: e.key, value: e.target.value, ...mods(e) });
  }
  if (e.key === "Enter" && e.target.closest("form")) {
    e.preventDefault();
    e.target.blur();
  } else if (e.key === "Escape") {
    e.target.blur();
  }
});
// The toolbar stays while a field here has focus.
bar.addEventListener("focusin", (e) => e.target.tagName === "INPUT" && api.hold(true));
bar.addEventListener("focusout", (e) => e.target.tagName === "INPUT" && api.hold(false));
