// One tab: a WebView kept mounted while the tab is open, so media keeps
// playing in the background (muted) and Mosaic can show several tabs at once.
import { forwardRef } from "react";
import { Platform } from "react-native";
import { WebView } from "react-native-webview";
import { BRIDGE } from "../bridge";

// On iPhone and iPad the app's web view leaves "Version/... Safari/..." out of
// its user agent, which Google sign-in and some other sites treat as an
// embedded, unsafe browser. This ending makes it the same as Safari's.
const IOS_MAJOR = String(Platform.Version || "18").split(".")[0];
const IOS_APP_NAME = `Version/${IOS_MAJOR}.0 Mobile/15E148 Safari/604.1`;

const TabView = forwardRef(function TabView({ tab, style, onMessage, onNav, onLoadEnd, onOpenWindow }, ref) {
  return (
    <WebView
      ref={ref}
      style={style}
      source={{ uri: tab.startUrl }}
      injectedJavaScriptBeforeContentLoaded={BRIDGE}
      applicationNameForUserAgent={Platform.OS === "ios" ? IOS_APP_NAME : undefined}
      onMessage={(e) => onMessage(tab.id, e.nativeEvent.data)}
      onNavigationStateChange={(nav) => onNav(tab.id, nav)}
      onLoadEnd={() => onLoadEnd(tab.id)}
      // Autoplay and inline video (autoplay itself follows the site rule).
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      allowsFullscreenVideo
      // target=_blank and window.open from a tap open a new Scout tab.
      setSupportMultipleWindows
      onOpenWindow={(e) => onOpenWindow(e.nativeEvent.targetUrl)}
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled
      originWhitelist={["http://*", "https://*", "about:*"]}
    />
  );
});

export default TabView;
