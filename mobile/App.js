// Scout mobile: walking skeleton (Phase 5 groundwork).
// Tabs of WebViews, address bar, and the shared suggestion engine from core/.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { createServices } from "./src/services";
import { autoplayCall, CENTER_ON_TAP, extractCall, MUTE_ALL, PAUSE_FOR_LIMIT, RESUME, UNMUTE } from "./src/bridge";
import { colors, ui } from "./src/theme";
import TabView from "./src/components/TabView";
import Button from "./src/components/Button";
import SuggestionsSheet from "./src/components/SuggestionsSheet";
import TabsSheet from "./src/components/TabsSheet";
import AddressSuggestions from "./src/components/AddressSuggestions";
import TrailSheet from "./src/components/TrailSheet";
import SettingsSheet from "./src/components/SettingsSheet";

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
      <Scout />
    </SafeAreaProvider>
  );
}

function Scout() {
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
  const [sheet, setSheet] = useState(null); // "suggest" | "tabs" | "trail" | "settings"
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState(false); // typed since focusing the address bar
  const [ctrlState, setCtrlState] = useState(null);
  const [trailVersion, setTrailVersion] = useState(0);

  const refs = useRef(new Map()); // tab id -> WebView ref
  const playback = useRef(new PlaybackLimiter()).current; // up to 4 tabs playing at once
  const pending = useRef(new Map()); // extract request id -> { resolve, reject, timer }
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

  const updateTab = useCallback((id, patch) => setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t))), []);

  const onMessage = useCallback(
    (tabId, raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
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
      if (msg.type === "selection") controller.onPage(tab, "selection", msg.text);
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
      services.history.record(nav.url, nav.title);
      const tab = withRule({ ...before, url: nav.url });
      refs.current.get(tabId)?.injectJavaScript(autoplayCall(tab.rule.autoplay));
    }
  }, []);

  const onLoadEnd = useCallback(
    (tabId) => {
      const tab = withRule(tabById(tabId));
      const view = refs.current.get(tabId);
      if (!tab || !view) return;
      services.history.record(tab.url, tab.title);
      playback.navigated(tabId); // media of the previous page will not resume
      view.injectJavaScript(autoplayCall(tab.rule.autoplay));
      if (tab.rule.center !== false) view.injectJavaScript(CENTER_ON_TAP);
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
  const cols = wide ? Math.ceil(Math.sqrt(tiled.length)) : tiled.length <= 3 ? 1 : 2;
  const rows = Math.ceil(tiled.length / cols) || 1;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg2 }} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      {/* Address bar, with suggestions from history and Wikipedia while typing */}
      <View style={{ zIndex: 20, elevation: 20 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderBottomWidth: 1, borderColor: colors.line }}>
        <Button label="‹" small onPress={() => refs.current.get(activeId)?.goBack()} style={!active?.canGoBack && { opacity: 0.4 }} />
        <Button label="›" small onPress={() => refs.current.get(activeId)?.goForward()} style={!active?.canGoForward && { opacity: 0.4 }} />
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
        <Button label={String(tabs.length)} small onPress={() => setSheet("tabs")} />
      </View>
      {editing ? (
        <AddressSuggestions
          query={typed ? address : ""}
          history={services.history}
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
                  left: `${((tile % cols) * 100) / cols}%`,
                  top: `${(Math.floor(tile / cols) * 100) / rows}%`,
                  width: `${100 / cols}%`,
                  height: `${100 / rows}%`,
                  zIndex: 2,
                  borderWidth: isActive ? 2 : 0,
                  borderColor: colors.accent,
                }
              : { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: onScreen ? 2 : 0 };
          return (
            <View key={t.id} style={style} pointerEvents={onScreen ? "auto" : "none"}>
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
                <Pressable style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} onPress={() => switchTo(t.id)} />
              ) : null}
            </View>
          );
        })}
      </View>

      {/* Bottom bar */}
      <View style={{ flexDirection: "row", gap: 6, padding: 8, borderTopWidth: 1, borderColor: colors.line, alignItems: "center" }}>
        <Button label={`Suggestions${state.results.length ? ` (${state.results.length})` : ""}`} active={state.busy} onPress={() => setSheet("suggest")} />
        <Button label="Mosaic" active={mosaic} onPress={() => setMosaic(!mosaic)} />
        <Button label="Trail" onPress={() => setSheet("trail")} />
        <Button label="Settings" onPress={() => setSheet("settings")} />
        <Text style={[ui.help, { flex: 1 }]} numberOfLines={1}>
          {state.busy ? "Searching…" : ""}
        </Text>
      </View>

      <SuggestionsSheet visible={sheet === "suggest"} onClose={() => setSheet(null)} state={state} controller={controller} onOpen={openResult} />
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
      <TrailSheet
        visible={sheet === "trail"}
        onClose={() => setSheet(null)}
        research={services.research}
        controller={controller}
        version={trailVersion}
        bump={() => setTrailVersion((v) => v + 1)}
        onOpenUrl={(url) => {
          setSheet(null);
          navigate(url);
        }}
      />
      <SettingsSheet visible={sheet === "settings"} onClose={() => setSheet(null)} services={services} />
    </SafeAreaView>
  );
}
