// NODE mobile. Opens on the trail (CM1: timeline list, CM2: canvas); the
// browser behind it keeps its tabs of WebViews, address bar, and the shared
// suggestion engine from core/.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, AppState, BackHandler, Keyboard, LayoutAnimation, PanResponder, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { createServices } from "./src/services";
const Capture = require("./src/capture");
const PageMessages = require("./src/pageMessages");
const { createEngagement } = require("./src/engagement");
import { autoplayCall, CENTER_ON_TAP, extractCall, MUTE_ALL, PAUSE_FOR_LIMIT, readCall, RESUME, UNMUTE } from "./src/bridge";
import { colors, ui } from "./src/theme";
import TabView from "./src/components/TabView";
import Button from "./src/components/Button";
import SuggestionsSheet from "./src/components/SuggestionsSheet";
import TabsSheet from "./src/components/TabsSheet";
import AddressSuggestions from "./src/components/AddressSuggestions";
import AskSheet from "./src/components/AskSheet";
import TrailHome from "./src/components/TrailHome";
import FullTextSheet from "./src/components/FullTextSheet";
import { captureRef } from "react-native-view-shot";
import { Directory, File, Paths } from "expo-file-system";
import SettingsSheet from "./src/components/SettingsSheet";
import IconButton from "./src/components/IconButton";
import Sheet from "./src/components/Sheet";
import MosaicLayoutSheet from "./src/components/MosaicLayoutPicker";
const { layoutRects, isLayout } = require("./src/mosaicLayout");

const { SuggestController } = require("../core/controller");
const { PlaybackLimiter } = require("../core/playback");
const { HOME_URL, normalizeUrl } = require("../core/urls");

const WIDE = 700; // tablets, and large phones in landscape
const PHONE_TILES = 4; // most tiles shown at once on a phone screen
let tabSeq = 1;
let requestSeq = 1;

function newTab(url) {
  return { id: String(tabSeq++), startUrl: url, url, title: "", canGoBack: false, canGoForward: false, loading: true };
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NodeApp />
    </SafeAreaProvider>
  );
}

function NodeApp() {
  const [services, setServices] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    createServices().then(setServices, (e) => setError(String(e?.message || e)));
  }, []);
  if (!services) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        {error ? <Text style={{ color: colors.bad }}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
      </View>
    );
  }
  return <Browser services={services} />;
}

function Browser({ services }) {
  const { width } = useWindowDimensions();
  const [tabs, setTabs] = useState(() => [newTab(HOME_URL)]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [mosaic, setMosaic] = useState(false);
  // Mosaic layout (Auto, Stack, Side by side, Grid, Focus), kept between launches.
  const [layout, setLayoutState] = useState(() => {
    try {
      const saved = JSON.parse(services.storage.read("mosaic.json") || "{}");
      return isLayout(saved.layout) ? saved.layout : "auto";
    } catch {
      return "auto";
    }
  });
  const setLayout = (id) => {
    setLayoutState(id);
    services.storage.write("mosaic.json", JSON.stringify({ layout: id, hinted: true }));
  };
  // Sound from every playing tab. Android only: iOS (WebKit) lets only one
  // video with sound play at a time and pauses the others.
  const canSoundAll = Platform.OS === "android";
  const [soundAll, setSoundAllState] = useState(false);
  const soundAllRef = useRef(false);
  const setSoundAll = (on) => {
    soundAllRef.current = on;
    setSoundAllState(on);
    for (const [id, view] of refs.current) {
      if (id === activeRef.current) continue;
      view.injectJavaScript(on ? UNMUTE : MUTE_ALL);
    }
  };
  const [sheet, setSheet] = useState(null); // "suggest" | "tabs" | "ask" | "settings"
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  // The bars hide while you read (scrolling down) and come back when you
  // scroll up, reach the top, open a page or tap the address line (Sven,
  // 2026-11-17). They stay put while typing, in Mosaic, with a sheet open, and
  // for screen reader users.
  const [barsHidden, setBarsHidden] = useState(false);
  const barsRef = useRef({ hidden: false, keep: false, still: false, reduce: false });
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => (barsRef.current.reduce = v)).catch(() => {});
    AccessibilityInfo.isScreenReaderEnabled?.().then((v) => (barsRef.current.still = v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("screenReaderChanged", (v) => {
      barsRef.current.still = v;
      if (v) setBars(false);
    });
    return () => sub?.remove?.();
  }, []);
  function setBars(hidden) {
    const b = barsRef.current;
    if (hidden && (b.keep || b.still)) return;
    if (b.hidden === hidden) return;
    b.hidden = hidden;
    if (!b.reduce) LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    setBarsHidden(hidden);
  }
  const [typed, setTyped] = useState(false); // typed since focusing the address bar
  const [bookmarkVersion, setBookmarkVersion] = useState(0); // re-render after bookmark changes
  const [ctrlState, setCtrlState] = useState(null);
  const [trailVersion, setTrailVersion] = useState(0);
  // The phone opens on the trail (doc 23, entry points: "Phone app → timeline list").
  const [home, setHomeState] = useState(true);
  const homeRef = useRef(true);
  const setHome = (on) => {
    homeRef.current = on;
    setHomeState(on);
    if (on) setTrailVersion((v) => v + 1); // pages read since are shown
  };

  const refs = useRef(new Map()); // tab id -> WebView ref
  const playback = useRef(new PlaybackLimiter()).current; // up to 4 tabs playing at once
  const pending = useRef(new Map()); // extract request id -> { resolve, reject, timer }
  const tileRefs = useRef(new Map()); // tab id -> the View around its WebView (for capture thumbnails)
  const lastSelection = useRef({ tabId: null, url: "", text: "" }); // the last text selected, for Capture
  const [toast, setToast] = useState(null); // { text, saved, trailId }
  // Pages becoming cards on the phone (desktop's B104 rule, every trail).
  const engagement = useRef(null);
  if (!engagement.current) {
    engagement.current = createEngagement({
      store: services.trails,
      trailOf: () => services.research.current.id,
      onCard: () => setTrailVersion((v) => v + 1),
    });
  }
  const onScreenRef = useRef([]); // tab ids on screen now, for time on page
  useEffect(() => {
    let front = AppState.currentState === "active";
    const sub = AppState.addEventListener("change", (st) => (front = st === "active"));
    const timer = setInterval(() => {
      if (front) engagement.current.tick(onScreenRef.current);
    }, 1000);
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  // Sync (B50): a round at start, every 30 s while NODE is in front, and when
  // it comes back to the front. Trails that arrive refresh the trail view; a
  // trail deleted on another device says so, with Undo.
  useEffect(() => {
    const sync = services.sync;
    let front = AppState.currentState === "active";
    const off = sync.on((e) => {
      if (e.type === "changed") setTrailVersion((v) => v + 1);
      if (e.type === "deleted") {
        const d = e.trails[0];
        showToast({ text: `“${d.name || "A trail"}” was deleted on ${d.byName}.`, undoTrail: d.id, sync: true });
      }
    });
    sync.start().then((i) => i.paired && sync.now());
    const sub = AppState.addEventListener("change", (st) => {
      front = st === "active";
      if (front) sync.now();
    });
    const timer = setInterval(() => front && sync.now(), 30000);
    return () => {
      off();
      sub.remove();
      clearInterval(timer);
    };
  }, []);
  const undoTrailDelete = () => {
    if (!toast?.undoTrail) return;
    services.trails.restore(toast.undoTrail, { current: false });
    setTrailVersion((v) => v + 1);
    services.sync.now(); // Undo reaches the other devices too
    showToast({ text: "Trail brought back." });
  };
  const toastTimer = useRef(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const tabById = (id) => tabsRef.current.find((t) => t.id === id);
  const withRule = (t) => (t ? { ...t, rule: services.ruleFor(t.url) } : t);

  // The shared suggestion controller asks the page for its text through the WebView.
  const controller = useMemo(
    () =>
      new SuggestController({
        research: services.research,
        suggestFor: services.flow.suggestFor,
        onChange: setCtrlState,
        extract: (tab) =>
          new Promise((resolve, reject) => {
            const view = refs.current.get(tab.id);
            if (!view) return reject(new Error("Tab is not ready"));
            const id = String(requestSeq++);
            const timer = setTimeout(() => {
              pending.current.delete(id);
              reject(new Error("The page did not answer"));
            }, 5000);
            pending.current.set(id, { resolve, reject, timer, tabId: tab.id });
            view.injectJavaScript(extractCall(tab.rule?.extract, id));
          }),
      }),
    [services]
  );
  const state = ctrlState || controller.state;

  // Page text for Ask AI, read through the WebView (same reply channel as extraction).
  const readPage = (tab) =>
    new Promise((resolve, reject) => {
      const view = refs.current.get(tab.id);
      if (!view) return reject(new Error("Tab is not ready"));
      const id = String(requestSeq++);
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(new Error("The page did not answer"));
      }, 5000);
      pending.current.set(id, { resolve, reject, timer, tabId: tab.id });
      view.injectJavaScript(readCall(id));
    });

  const updateTab = useCallback((id, patch) => setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t))), []);

  const onMessage = useCallback(
    (tabId, raw) => {
      // Pages are untrusted: only known, well-formed messages, and answers
      // only to requests NODE sent to this tab (src/pageMessages.js).
      const msg = PageMessages.checkMessage(raw, { tabId, pendingFor: (id) => pending.current.get(id)?.tabId ?? null });
      if (!msg) return;
      if (msg.type === "capinfo" && String(msg.id).startsWith("ft:")) {
        // M19: the page's DOI or PMID, found on the phone; nothing is sent.
        const ids = Capture.findIds(msg);
        updateTab(tabId, { doi: ids.doi || "", pmid: ids.pmid || "" });
        return;
      }
      if (msg.type === "capinfo") {
        const p = pending.current.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.current.delete(msg.id);
        p.resolve(msg);
        return;
      }
      if (msg.type === "extract") {
        const p = pending.current.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.current.delete(msg.id);
        msg.error || !msg.data ? p.reject(new Error(msg.error || "The page did not answer")) : p.resolve(msg.data);
        return;
      }
      if (msg.type === "media") {
        if (msg.playing) {
          for (const id of playback.started(tabId, activeRef.current)) {
            refs.current.get(id)?.injectJavaScript(PAUSE_FOR_LIMIT);
            updateTab(id, { pausedByLimit: true });
          }
          updateTab(tabId, { pausedByLimit: false });
        } else {
          playback.stopped(tabId);
        }
        return;
      }
      if (msg.type === "syspause") {
        // The system paused this tab's video and the page started it again.
        setTabs((list) => list.map((t) => (t.id === tabId ? { ...t, sysPauses: (t.sysPauses || 0) + 1 } : t)));
        return;
      }
      if (tabId !== activeRef.current) return;
      const tab = withRule(tabById(tabId));
      if (msg.type === "selection") {
        lastSelection.current = { tabId, url: tab?.url || "", text: msg.text };
        controller.onPage(tab, "selection", msg.text);
      }
      if (msg.type === "scrolldir") {
        if (tabId === activeRef.current) setBars(msg.dir === "down" && !msg.top);
        return;
      }
      if (msg.type === "scroll") {
        controller.onPage(tab, "scroll");
        engagement.current.engage(tabId, "scroll"); // scrolling counts as engaging (B104)
      }
    },
    [controller]
  );

  const onNav = useCallback((tabId, nav) => {
    const before = tabById(tabId);
    updateTab(tabId, { url: nav.url, title: nav.title, canGoBack: nav.canGoBack, canGoForward: nav.canGoForward, loading: nav.loading });
    if (!nav.loading && nav.url) {
      engagement.current.started(tabId, nav.url, { title: nav.title, openedFrom: before?.openedFrom || "" });
      engagement.current.title(tabId, nav.title);
    }
    // Single-page sites (m.youtube.com and similar) change address without a
    // new load, so onLoadEnd does not run: start the new page's media here.
    if (tabId === activeRef.current && nav.loading && before && nav.url !== before.url) setBars(false); // a new page: show the bars
    if (before && !nav.loading && before.url && nav.url !== before.url) {
      if (lastSelection.current.tabId === tabId) lastSelection.current = { tabId: null, url: "", text: "" };
      updateTab(tabId, { doi: "", pmid: "" });
      services.history.record(nav.url, nav.title);
      const tab = withRule({ ...before, url: nav.url });
      refs.current.get(tabId)?.injectJavaScript(autoplayCall(tab.rule.autoplay));
    }
  }, []);

  // M18 smart capture: the page's address, title, DOI or PMID, the time with
  // the time zone, the selected text and a thumbnail go into the trail being
  // recorded as a capture card. No screen change; a note with Undo shows.
  const mosaicHinted = () => {
    try {
      return Boolean(JSON.parse(services.storage.read("mosaic.json") || "{}").hinted);
    } catch {
      return false;
    }
  };
  const showToast = (t) => {
    clearTimeout(toastTimer.current);
    AccessibilityInfo.announceForAccessibility?.(t.text); // VoiceOver reads the note; TalkBack uses the live region
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };
  const capture = async () => {
    const id = activeRef.current;
    const tab = tabById(id);
    const view = refs.current.get(id);
    if (!tab || !view) return;
    const reqId = `cap${Date.now()}`;
    const info = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.current.delete(reqId);
        resolve({ error: "timeout" });
      }, 3000);
      pending.current.set(reqId, { resolve, reject: (e) => resolve({ error: String(e) }), timer, tabId: id });
      view.injectJavaScript(Capture.captureInfoCall(reqId));
    });
    const at = Date.now();
    const sel = lastSelection.current;
    const built = Capture.buildCapture(info, { at, selection: sel.tabId === id && sel.url === info.url ? sel.text : "" });
    if (built.error) return showToast({ text: built.error });
    const card = built.card;
    card.id = `c${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    try {
      const tmp = await captureRef(tileRefs.current.get(id), { format: "jpg", quality: 0.6, width: 480, result: "tmpfile" });
      const dir = new Directory(Paths.document, "captures");
      if (!dir.exists) dir.create();
      const dest = new File(dir, `${card.id}.jpg`);
      await new File(tmp).move(dest);
      Object.assign(card, { shot: dest.uri, captureKind: "shot" });
    } catch (_) {
      // No thumbnail (the page may not allow it); the capture still saves.
    }
    engagement.current.engage(id, "capture"); // a page captured from becomes a card (B104)
    services.research.saveNow();
    const trailId = services.research.current.id;
    const saved = Capture.saveCapture(services.trails, trailId, card, { pageTitle: tab.title });
    if (!saved.card) return showToast({ text: "Couldn't save the capture." });
    setTrailVersion((v) => v + 1);
    showToast({ text: Capture.capturedText(card, services.trails.get(trailId)?.trail.name), saved, trailId });
  };
  const undoCapture = () => {
    if (!toast?.saved) return;
    Capture.undoCapture(services.trails, toast.trailId, toast.saved);
    if (toast.saved.card?.shot) {
      try {
        new File(toast.saved.card.shot).delete();
      } catch (_) {}
    }
    setTrailVersion((v) => v + 1);
    showToast({ text: "Capture removed." });
  };

  const onLoadEnd = useCallback(
    (tabId) => {
      const tab = withRule(tabById(tabId));
      const view = refs.current.get(tabId);
      if (!tab || !view) return;
      services.history.record(tab.url, tab.title);
      playback.navigated(tabId); // media of the previous page will not resume
      view.injectJavaScript(autoplayCall(tab.rule.autoplay));
      if (tab.rule.center !== false) view.injectJavaScript(CENTER_ON_TAP);
      view.injectJavaScript(Capture.captureInfoCall(`ft:${tabId}`)); // DOI for the Full text button
      if (tabId !== activeRef.current) {
        if (!soundAllRef.current) view.injectJavaScript(MUTE_ALL); // only the active tab plays sound
        return;
      }
      controller.onPage(tab, "load");
    },
    [controller, services]
  );

  const addTab = (url, activate = true, { fromTrail = false } = {}) => {
    // The page this tab was opened from: where its card goes (B104). Opened
    // from the trail screen: no source page.
    const from = fromTrail ? "" : tabById(activeRef.current)?.url || "";
    const t = { ...newTab(url), openedFrom: /^https?:/i.test(from) ? from : "" };
    setTabs((list) => [...list, t]);
    if (activate) switchTo(t.id);
    return t.id;
  };

  const switchTo = (id) => {
    const prev = refs.current.get(activeRef.current);
    // Mute the tab being left (it keeps playing), then give sound to the new one.
    if (prev && activeRef.current !== id && !soundAllRef.current) prev.injectJavaScript(MUTE_ALL);
    refs.current.get(id)?.injectJavaScript(UNMUTE);
    setActiveId(id);
    activeRef.current = id;
    setBars(false);
    // A tab paused by the playback limit resumes when it becomes active.
    if (playback.activated(id)) refs.current.get(id)?.injectJavaScript(RESUME);
    const tab = withRule(tabById(id));
    if (tab && !tab.loading) controller.onPage(tab, "tick");
  };

  // ---- Gestures ----
  // Swipe left or right on the address bar: next or previous tab (as in Safari).
  const switchRef = useRef(switchTo);
  switchRef.current = switchTo;
  const editingRef = useRef(false);
  editingRef.current = editing;
  const addressPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => !editingRef.current && Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) < 60) return;
        const list = tabsRef.current;
        const i = list.findIndex((t) => t.id === activeRef.current);
        const next = list[i + (g.dx < 0 ? 1 : -1)];
        if (next) switchRef.current(next.id);
      },
    })
  ).current;

  // Android back button: go back in the page; at the first page, back to the
  // trail; on the trail, let the system handle it.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (homeRef.current) return false;
      const tab = tabsRef.current.find((t) => t.id === activeRef.current);
      if (tab?.canGoBack) {
        refs.current.get(tab.id)?.goBack();
        return true;
      }
      setHome(true);
      return true;
    });
    return () => sub.remove();
  }, []);

  const closeTab = (id) => {
    engagement.current.closed(id);
    refs.current.delete(id);
    playback.closed(id);
    setTabs((list) => {
      const rest = list.filter((t) => t.id !== id);
      if (!rest.length) {
        const t = newTab(HOME_URL);
        setActiveId(t.id);
        return [t];
      }
      if (id === activeRef.current) setActiveId(rest[rest.length - 1].id);
      return rest;
    });
  };

  const navigate = (url) => {
    const view = refs.current.get(activeRef.current);
    if (view) view.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`);
  };

  const openResult = (item, inNewTab) => {
    controller.opened(item);
    setSheet(null);
    inNewTab ? addTab(item.url) : navigate(item.url);
  };

  const onOpenWindow = (openerId) => (url) => {
    const opener = withRule(tabById(openerId));
    if (opener?.rule.popups === "block") return;
    addTab(url);
  };

  const active = tabs.find((t) => t.id === activeId) || tabs[0];
  // Mosaic works on every screen. Tablets and landscape phones get a square-ish
  // grid of all tabs. Phones in portrait stack up to 3 tiles in one column, or
  // show 4 in two columns; with more tabs, the active tab and the 3 most
  // recently opened others are shown.
  const canMosaic = true;
  const showMosaic = mosaic && tabs.length > 1;
  const wide = width >= WIDE;
  const tiled = !showMosaic
    ? []
    : wide
      ? tabs
      : [active, ...tabs.filter((t) => t.id !== active?.id).slice(-(PHONE_TILES - 1))].sort((a, b) => tabs.indexOf(a) - tabs.indexOf(b));
  const tiledIds = new Set(tiled.map((t) => t.id));
  // Time on page counts for the tabs on screen, with NODE in front and the trail screen closed.
  onScreenRef.current = home ? [] : showMosaic ? [...tiledIds] : active ? [active.id] : [];
  const rects = layoutRects(layout, tiled.length, { active: Math.max(0, tiled.findIndex((t) => t.id === active?.id)), wide });

  barsRef.current.keep = editing || Boolean(sheet) || showMosaic;
  useEffect(() => {
    if (barsRef.current.keep) setBars(false);
  }, [editing, sheet, showMosaic]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg2 }} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      {/* Address bar, with suggestions from history and Wikipedia while typing.
          Hidden while reading: a thin line with the site's name stays; tap it
          to bring the bars back. */}
      <View style={{ zIndex: 20, elevation: 20 }}>
      {barsHidden && !editing ? (
        <Pressable
          onPress={() => setBars(false)}
          hitSlop={{ top: 10, bottom: 14 }}
          accessibilityRole="button"
          accessibilityLabel={`${hostOf(active?.url) || "Page"}. Show the address bar and buttons`}
          style={{ height: 22, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: colors.mute, fontSize: 12 }} numberOfLines={1}>
            {active?.loading ? "Loading… " : ""}
            {hostOf(active?.url) || ""}
          </Text>
        </Pressable>
      ) : (
      <View style={{ paddingHorizontal: 8, paddingTop: 2, paddingBottom: 6 }} {...addressPan.panHandlers}>
        <TextInput
          style={[ui.input, { textAlign: editing ? "left" : "center", backgroundColor: colors.bg3, borderRadius: 12 }]}
          value={editing ? address : hostOf(active?.url) || active?.url || ""}
          accessibilityLabel="Address"
          onFocus={() => {
            setEditing(true);
            setTyped(false);
            setAddress(active?.url || "");
          }}
          onBlur={() => setEditing(false)}
          onChangeText={(v) => {
            setAddress(v);
            setTyped(true);
          }}
          onSubmitEditing={() => {
            setEditing(false);
            navigate(normalizeUrl(address));
          }}
          placeholder="Search or enter address"
          placeholderTextColor={colors.mute}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus
        />
        {active?.loading && !editing ? <ActivityIndicator size="small" color={colors.mute} style={{ position: "absolute", right: 20, top: 14 }} /> : null}
      </View>
      )}
      {editing ? (
        <AddressSuggestions
          query={typed ? address : ""}
          history={services.history}
          bookmarks={services.bookmarks}
          getText={services.net.getText}
          lang={services.settings.providers.wikipedia?.lang}
          onPick={(url) => {
            setEditing(false);
            Keyboard.dismiss();
            navigate(url);
          }}
        />
      ) : null}
      </View>

      {/* Tabs: every WebView stays mounted at full size. Tabs not on screen sit
          behind the visible ones instead of being shrunk away, because iOS pauses
          videos it considers invisible. */}
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          const tile = showMosaic ? tiled.findIndex((x) => x.id === t.id) : -1;
          const onScreen = tile >= 0 || (!showMosaic && isActive);
          const style =
            tile >= 0
              ? {
                  position: "absolute",
                  left: `${rects[tile].left}%`,
                  top: `${rects[tile].top}%`,
                  width: `${rects[tile].width}%`,
                  height: `${rects[tile].height}%`,
                  zIndex: 2,
                  borderWidth: isActive ? 2 : 0,
                  borderColor: colors.accent,
                }
              : { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: onScreen ? 2 : 0 };
          return (
            <View key={t.id} ref={(r) => (r ? tileRefs.current.set(t.id, r) : tileRefs.current.delete(t.id))} collapsable={false} style={style} pointerEvents={onScreen ? "auto" : "none"}>
              <TabView
                ref={(r) => (r ? refs.current.set(t.id, r) : null)}
                tab={t}
                style={{ flex: 1, backgroundColor: "#fff" }}
                onMessage={onMessage}
                onNav={onNav}
                onLoadEnd={onLoadEnd}
                onOpenWindow={onOpenWindow(t.id)}
              />
              {showMosaic && !isActive ? (
                // Tap an inactive tile to make it the active tab; then it takes touches.
                <Pressable
                  style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
                  onPress={() => switchTo(t.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Mosaic tile ${tile + 1}: ${t.title || t.url || "new tab"}`}
                  accessibilityHint="Makes this the active tab"
                />
              ) : null}
            </View>
          );
        })}
      </View>

      {/* Bottom bar: 44 pt icon buttons. Hidden while reading. */}
      {barsHidden ? null : (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4, borderTopWidth: 1, borderColor: colors.line }}>
          <IconButton icon="chevron-back" label="Back" disabled={!active?.canGoBack} onPress={() => refs.current.get(activeId)?.goBack()} />
          <IconButton icon="chevron-forward" label="Forward" disabled={!active?.canGoForward} onPress={() => refs.current.get(activeId)?.goForward()} />
          <IconButton
            icon="sparkles-outline"
            label={`Suggestions${state.results.length ? `, ${state.results.length}` : ""}${state.busy ? ", searching" : ""}`}
            active={state.busy}
            badge={state.results.length}
            onPress={() => setSheet("suggest")}
          />
          <IconButton icon="scan-outline" label="Capture" a11yHint="Saves this page, the selected text and a thumbnail into the trail" onPress={capture} />
          <IconButton
            icon="grid-outline"
            label="Mosaic"
            active={mosaic}
            a11yHint="Press and hold to change the layout"
            onPress={() => {
              const on = !mosaic;
              setMosaic(on);
              // Once: say how to change the layout.
              if (on && tabs.length > 1 && !mosaicHinted()) {
                services.storage.write("mosaic.json", JSON.stringify({ layout, hinted: true }));
                showToast({ text: "Press and hold Mosaic to change the layout." });
              }
            }}
            onLongPress={() => setSheet("layout")}
          />
          {/* Tap: tab list. Press and hold: new tab. */}
          <IconButton text={String(tabs.length)} label={`${tabs.length} ${tabs.length === 1 ? "tab" : "tabs"}, open the tab list`} a11yHint="Press and hold for a new tab" onPress={() => setSheet("tabs")} onLongPress={() => addTab(HOME_URL)} />
          <IconButton icon="git-network-outline" label="Trail" onPress={() => setHome(true)} />
          <IconButton icon="ellipsis-horizontal" label="More" a11yHint="Bookmark, Mosaic layout, Settings" onPress={() => setSheet("more")} />
        </View>
      )}

      {sheet === "more" ? (
        <Sheet visible onClose={() => setSheet(null)} title={active?.title || hostOf(active?.url) || "This page"} kicker={hostOf(active?.url) || "More"}>
          <View style={{ gap: 8 }}>
            <Button
              label={active && services.bookmarks.has(active.url) ? "★ Remove bookmark" : "☆ Add bookmark"}
              onPress={() => {
                if (active && /^https?:/i.test(active.url || "")) {
                  services.bookmarks.toggle(active.url, active.title);
                  setBookmarkVersion((v) => v + 1);
                }
                setSheet(null);
              }}
            />
            <Button label="Mosaic layout…" onPress={() => setSheet("layout")} />
            <Button label="Settings" onPress={() => setSheet("settings")} />
          </View>
        </Sheet>
      ) : null}

      <SuggestionsSheet visible={sheet === "suggest"} onClose={() => setSheet(null)} state={state} controller={controller} onOpen={openResult} onAsk={() => setSheet("ask")} />
      <AskSheet
        visible={sheet === "ask"}
        onClose={() => setSheet(null)}
        tab={active}
        services={services}
        readPage={(...a) => {
          if (active) engagement.current.engage(active.id, "ask"); // a page asked about becomes a card (B104)
          return readPage(...a);
        }}
      />
      <TabsSheet
        visible={sheet === "tabs"}
        onClose={() => setSheet(null)}
        tabs={tabs}
        activeId={activeId}
        onActivate={(id) => {
          switchTo(id);
          setSheet(null);
        }}
        onCloseTab={closeTab}
        bookmarks={services.bookmarks}
        bookmarkVersion={bookmarkVersion}
        onOpenBookmark={(url) => {
          setSheet(null);
          addTab(url);
        }}
        onRemoveBookmark={(url) => {
          services.bookmarks.remove(url);
          setBookmarkVersion((v) => v + 1);
        }}
        onNewTab={() => {
          addTab(HOME_URL);
          setSheet(null);
        }}
        mosaic={mosaic}
        onToggleMosaic={() => setMosaic(!mosaic)}
        canSoundAll={canSoundAll}
        soundAll={soundAll}
        onToggleSoundAll={() => setSoundAll(!soundAll)}
        canMosaic={canMosaic}
      />
      <SettingsSheet visible={sheet === "settings"} onClose={() => setSheet(null)} services={services} mosaicLayout={layout} onMosaicLayout={setLayout} wide={wide} />
      <MosaicLayoutSheet visible={sheet === "layout"} onClose={() => setSheet(null)} value={layout} onChange={setLayout} wide={wide} />

      {(active?.doi || active?.pmid) && !home && !sheet ? (
        <View style={{ position: "absolute", right: 12, bottom: toast ? 128 : 70, zIndex: 39, elevation: 39 }}>
          <Button label="Full text" active a11yHint="Finds a free copy of this paper" onPress={() => setSheet("fulltext")} />
        </View>
      ) : null}
      <FullTextSheet
        visible={sheet === "fulltext"}
        onClose={() => setSheet(null)}
        doi={active?.doi}
        pmid={active?.pmid}
        services={services}
        onOpenUrl={(url) => addTab(url)}
        onOpenSettings={() => setSheet("settings")}
      />

      {toast && (!home || toast.sync) ? (
        <View accessibilityLiveRegion="polite" style={{ position: "absolute", left: 12, right: 12, bottom: 70, zIndex: toast.sync ? 60 : 40, elevation: toast.sync ? 60 : 40, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bg3, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10 }}>
          <Text style={{ color: colors.text, flex: 1 }} numberOfLines={2}>
            {toast.text}
          </Text>
          {toast.saved ? <Button label="Undo" small onPress={undoCapture} /> : null}
          {toast.undoTrail ? <Button label="Undo" small onPress={undoTrailDelete} /> : null}
        </View>
      ) : null}

      {/* The trail, over the browser. The WebViews stay mounted underneath so
          tabs keep their pages (and media) while the trail is shown. */}
      {home ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 50, elevation: 50 }}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg2 }} edges={["top", "bottom"]}>
            <TrailHome
              services={services}
              controller={controller}
              version={trailVersion}
              bump={() => setTrailVersion((v) => v + 1)}
              tabCount={tabs.length}
              onBrowse={() => setHome(false)}
              onOpenUrl={(url) => {
                setHome(false);
                addTab(url, true, { fromTrail: true });
              }}
              onSearch={(q) => {
                setHome(false);
                addTab(normalizeUrl(q), true, { fromTrail: true });
              }}
            />
          </SafeAreaView>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

// "en.wikipedia.org" from an address, for the compact address bar.
function hostOf(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ""));
  return m ? m[1].replace(/^www\./, "") : "";
}
