// Scout mobile: walking skeleton (Phase 5 groundwork).
// Tabs of WebViews, address bar, and the shared suggestion engine from core/.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { createServices } from "./src/services";
import { autoplayCall, extractCall, MUTE_ALL } from "./src/bridge";
import { colors, ui } from "./src/theme";
import TabView from "./src/components/TabView";
import Button from "./src/components/Button";
import SuggestionsSheet from "./src/components/SuggestionsSheet";
import TabsSheet from "./src/components/TabsSheet";
import TrailSheet from "./src/components/TrailSheet";
import SettingsSheet from "./src/components/SettingsSheet";

const { SuggestController } = require("../core/controller");
const { HOME_URL, normalizeUrl } = require("../core/urls");

const MOSAIC_MIN_WIDTH = 700; // tablets and large phones in landscape
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
  const [sheet, setSheet] = useState(null); // "suggest" | "tabs" | "trail" | "settings"
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [ctrlState, setCtrlState] = useState(null);
  const [trailVersion, setTrailVersion] = useState(0);

  const refs = useRef(new Map()); // tab id -> WebView ref
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
      if (tabId !== activeRef.current) return;
      const tab = withRule(tabById(tabId));
      if (msg.type === "selection") controller.onPage(tab, "selection", msg.text);
      if (msg.type === "scroll") controller.onPage(tab, "scroll");
    },
    [controller]
  );

  const onNav = useCallback((tabId, nav) => {
    updateTab(tabId, { url: nav.url, title: nav.title, canGoBack: nav.canGoBack, canGoForward: nav.canGoForward, loading: nav.loading });
  }, []);

  const onLoadEnd = useCallback(
    (tabId) => {
      const tab = withRule(tabById(tabId));
      const view = refs.current.get(tabId);
      if (!tab || !view) return;
      services.history.record(tab.url, tab.title);
      view.injectJavaScript(autoplayCall(tab.rule.autoplay));
      if (tabId !== activeRef.current) {
        view.injectJavaScript(MUTE_ALL); // only the active tab plays sound
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
    if (prev && activeRef.current !== id) prev.injectJavaScript(MUTE_ALL);
    setActiveId(id);
    activeRef.current = id;
    const tab = withRule(tabById(id));
    if (tab && !tab.loading) controller.onPage(tab, "tick");
  };

  const closeTab = (id) => {
    refs.current.delete(id);
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
  const canMosaic = width >= MOSAIC_MIN_WIDTH;
  const showMosaic = mosaic && canMosaic && tabs.length > 1;
  const cols = Math.ceil(Math.sqrt(tabs.length));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg2 }} edges={["top", "bottom"]}>
      <StatusBar style="light" />
      {/* Address bar */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderBottomWidth: 1, borderColor: colors.line }}>
        <Button label="‹" small onPress={() => refs.current.get(activeId)?.goBack()} style={!active?.canGoBack && { opacity: 0.4 }} />
        <Button label="›" small onPress={() => refs.current.get(activeId)?.goForward()} style={!active?.canGoForward && { opacity: 0.4 }} />
        <TextInput
          style={[ui.input, { flex: 1, paddingVertical: 6 }]}
          value={editing ? address : active?.url || ""}
          onFocus={() => {
            setEditing(true);
            setAddress(active?.url || "");
          }}
          onBlur={() => setEditing(false)}
          onChangeText={setAddress}
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

      {/* Tabs: every WebView stays mounted; inactive ones are hidden unless Mosaic is on. */}
      <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", backgroundColor: colors.bg }}>
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          const style = showMosaic
            ? { width: `${100 / cols}%`, height: `${100 / Math.ceil(tabs.length / cols)}%`, borderWidth: isActive ? 2 : 0, borderColor: colors.accent }
            : isActive
              ? { flex: 1, width: "100%" }
              : { position: "absolute", width: 1, height: 1, opacity: 0, left: -10 };
          return (
            <View key={t.id} style={style}>
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
