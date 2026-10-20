// NODE UI kit behaviour: tooltips with shortcuts, panel tabs, panel collapse,
// menu overlay with focus handling. No dependencies. Load after icons/icons.js.
// Works in a Chrome extension page (no inline script, no eval).
(function () {
  const mac = /Mac/.test(navigator.platform);

  // "mod+shift+M" → "⌘⇧M" on a Mac, "Ctrl+Shift+M" elsewhere.
  function keyLabel(keys) {
    if (!keys) return "";
    if (keys === "ctrl+mod+F" && !mac) return "F11";
    const parts = keys.split("+");
    const key = parts.pop();
    const names = mac ? { mod: "⌘", shift: "⇧", ctrl: "⌃", alt: "⌥" } : { mod: "Ctrl", shift: "Shift", ctrl: "Ctrl", alt: "Alt" };
    const mods = parts.map((m) => names[m] || m);
    const shown = key.length === 1 ? key.toUpperCase() : key;
    return mac ? mods.join("") + shown : [...mods, shown].join("+");
  }

  // Every icon button names itself: data-tip (name) + data-keys (shortcut)
  // become title (hover tooltip), aria-label and aria-keyshortcuts.
  function setTip(btn, tip) {
    if (!btn) return;
    if (tip) btn.dataset.tip = tip;
    const keys = keyLabel(btn.dataset.keys);
    btn.setAttribute("aria-label", btn.dataset.tip);
    btn.title = keys ? `${btn.dataset.tip}  (${keys})` : btn.dataset.tip;
    if (btn.dataset.keys) btn.setAttribute("aria-keyshortcuts", btn.dataset.keys.replace(/mod/g, mac ? "Meta" : "Control"));
  }

  // Toggle button: aria-pressed, violet when on, its own name for each state.
  function setPressed(btn, on, { tipOn, tipOff, iconOn, iconOff } = {}) {
    btn.setAttribute("aria-pressed", String(on));
    if (iconOn && iconOff) btn.innerHTML = NodeIcons.svg(on ? iconOn : iconOff);
    if (tipOn && tipOff) setTip(btn, on ? tipOn : tipOff);
  }

  // Panel tabs: one selected; arrow keys move between them.
  // tabs: container with .ptab buttons, each aria-controls="<pane id>".
  function panelTabs(container, onChange) {
    const tabs = () => [...container.querySelectorAll(".ptab")];
    function select(tab) {
      for (const t of tabs()) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        const pane = document.getElementById(t.getAttribute("aria-controls"));
        if (pane) pane.hidden = !on;
      }
      onChange?.(tab.dataset.pane || tab.getAttribute("aria-controls"));
    }
    container.addEventListener("click", (e) => {
      const t = e.target.closest(".ptab");
      if (t) select(t);
    });
    container.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const list = tabs();
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      const next = list[(i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
      next.focus();
      select(next);
    });
    const first = tabs().find((t) => t.getAttribute("aria-selected") === "true") || tabs()[0];
    if (first) select(first);
    return { select: (id) => select(tabs().find((t) => t.getAttribute("aria-controls") === id || t.dataset.pane === id)) };
  }

  // Menu overlay: opens on a section, Esc / × / click outside closes, Tab stays
  // inside, focus returns to the opener. onSection(name) renders the section.
  function menuOverlay(overlay, { onSection, onOpen, onClose } = {}) {
    let open = false;
    let returnTo = null;
    let section = null;
    const panel = overlay.querySelector(".menu-panel");
    const navButtons = () => [...overlay.querySelectorAll(".mnav")];
    for (const b of navButtons()) {
      const kbd = b.querySelector("kbd");
      if (kbd) kbd.textContent = keyLabel(b.dataset.keys);
    }
    function show(name) {
      section = name;
      for (const b of navButtons()) {
        if (b.dataset.section === name) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      }
      onSection?.(name);
    }
    function openMenu(name = section || navButtons()[0]?.dataset.section) {
      if (!open) {
        open = true;
        returnTo = document.activeElement;
        overlay.hidden = false;
        onOpen?.();
      }
      show(name);
      overlay.querySelector('.mnav[aria-current="page"]')?.focus();
    }
    function closeMenu() {
      if (!open) return;
      open = false;
      overlay.hidden = true;
      onClose?.();
      (returnTo?.isConnected ? returnTo : document.body).focus?.();
    }
    overlay.addEventListener("click", (e) => {
      if (e.target.closest(".menu-scrim") || e.target.closest("[data-menu-close]")) closeMenu();
      const b = e.target.closest(".mnav");
      if (b) show(b.dataset.section);
    });
    window.addEventListener("keydown", (e) => {
      if (open && e.key === "Escape") {
        e.preventDefault();
        closeMenu();
      }
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const items = [...panel.querySelectorAll("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter(
        (el) => !el.disabled && el.offsetParent !== null
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    return { open: openMenu, close: closeMenu, isOpen: () => open };
  }

  // Collapsed-panel badge on the toolbar toggle: result count, "+N" new since collapse.
  function paintCount(btn, { count = 0, added = 0, open }) {
    const c = btn.querySelector(".count");
    const n = btn.querySelector(".new");
    if (c) { c.textContent = count; c.hidden = open || !count; }
    if (n) { n.textContent = `+${added}`; n.hidden = open || !added; }
    setPressed(btn, open);
    setTip(btn, open ? "Hide suggestions" : `Show suggestions${count ? `: ${count} results` : ""}${added ? `, ${added} new` : ""}`);
  }

  function init(root = document) {
    window.NodeIcons?.inject();
    root.querySelectorAll("[data-tip]").forEach((b) => setTip(b));
  }

  window.NodeUI = { keyLabel, setTip, setPressed, panelTabs, menuOverlay, paintCount, init };
})();
