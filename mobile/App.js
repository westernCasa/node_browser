// NODE mobile. Opens on the trail (CM1: timeline list, CM2: canvas); the
// browser behind it keeps its tabs of WebViews, address bar, and the shared
// suggestion engine from core/.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, BackHandler, Keyboard, PanResponder, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { createServices } from "./src/services";
const Capture = require("./src/capture");
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
            pending.current.set(id, { resolve, reject, timer });
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
      pending.current.set(id, { resolve, reject, timer });
      view.injectJavaScript(readCall(id));
    });

  const updateTab = useCallback((id, patch) => setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t))), []);

  const onMessage = useCallback(
    (tabId, raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
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
        msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.data);
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
      if (msg.type === "scroll") controller.onPage(tab, "scroll");
    },
    [controller]
  );

  const onNav = useCallback((tabId, nav) => {
    const before = tabById(tabId);
    updateTab(tabId, { url: nav.url, title: nav.title, canGoBack: nav.canGoBack, canGoForward: nav.canGoForward, loading: nav.loading });
    // Single-page sites (m.youtube.com and similar) change address without a
    // new load, so onLoadEnd does not run: start the new page's media here.
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
      pending.current.set(reqId, { resolve, reject: (e) => resolve({ error: String(e) }), timer });
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

  const addTab = (url, activate = true) => {
    const t = newTab(url);
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
  const rects = layoutRects(layout, tiled.length, { active: Math.max(0, tiled.findIndex((t) => t.id === active?.id)), wide });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg2 }} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      {/* Address bar, with suggestions from history and Wikipedia while typing */}
      <View style={{ zIndex: 20, elevation: 20 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderBottomWidth: 1, borderColor: colors.line }} {...addressPan.panHandlers}>
        <Button label="‹" a11yLabel="Back" small onPress={() => refs.current.get(activeId)?.goBack()} style={!active?.canGoBack && { opacity: 0.4 }} />
        <Button label="›" a11yLabel="Forward" small onPress={() => refs.current.get(activeId)?.goForward()} style={!active?.canGoForward && { opacity: 0.4 }} />
        <TextInput
          style={[ui.input, { flex: 1, paddingVertical: 6 }]}
          value={editing ? address : active?.url || ""}
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
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus
        />
        <Button
          label={active && services.bookmarks.has(active.url) ? "★" : "☆"}
          small
          onPress={() => {
            if (!active || !/^https?:/i.test(active.url || "")) return;
            services.bookmarks.toggle(active.url, active.title);
            setBookmarkVersion((v) => v + 1);
          }}
        />
        {/* Tap: tab list. Press and hold: new tab. */}
        <Button label={String(tabs.length)} a11yLabel={`${tabs.length} ${tabs.length === 1 ? "tab" : "tabs"}, open the tab list`} a11yHint="Press and hold for a new tab" small onPress={() => setSheet("tabs")} onLongPress={() => addTab(HOME_URL)} />
      </View>
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

      {/* Bottom bar */}
      <View style={{ flexDirection: "row", gap: 6, padding: 8, borderTopWidth: 1, borderColor: colors.line, alignItems: "center" }}>
        <Button label={`Suggest${state.results.length ? ` (${state.results.length})` : ""}`} active={state.busy} onPress={() => setSheet("suggest")} />
        <Button label="Capture" a11yHint="Saves this page, the selected text and a thumbnail into the trail" onPress={capture} />
        <Button
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
        <Button label="Trail" onPress={() => setHome(true)} />
        <Button label="⚙︎" a11yLabel="Settings" onPress={() => setSheet("settings")} />
        <Text style={[ui.help, { flex: 1 }]} numberOfLines={1}>
          {state.busy ? "Searching…" : ""}
        </Text>
      </View>

      <SuggestionsSheet visible={sheet === "suggest"} onClose={() => setSheet(null)} state={state} controller={controller} onOpen={openResult} onAsk={() => setSheet("ask")} />
      <AskSheet visible={sheet === "ask"} onClose={() => setSheet(null)} tab={active} services={services} readPage={readPage} />
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

      {toast && !home ? (
        <View accessibilityLiveRegion="polite" style={{ position: "absolute", left: 12, right: 12, bottom: 70, zIndex: 40, elevation: 40, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bg3, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10 }}>
          <Text style={{ color: colors.text, flex: 1 }} numberOfLines={2}>
            {toast.text}
          </Text>
          {toast.saved ? <Button label="Undo" small onPress={undoCapture} /> : null}
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
                addTab(url);
              }}
              onSearch={(q) => {
                setHome(false);
                addTab(normalizeUrl(q));
              }}
            />
          </SafeAreaView>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
