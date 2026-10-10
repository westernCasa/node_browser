// One tab: a WebView kept mounted while the tab is open, so media keeps
// playing in the background (muted) and Mosaic can show several tabs at once.
import { forwardRef } from "react";
import { WebView } from "react-native-webview";
import { BRIDGE } from "../bridge";

const TabView = forwardRef(function TabView({ tab, style, onMessage, onNav, onLoadEnd, onOpenWindow }, ref) {
  return (
    <WebView
      ref={ref}
      style={style}
      source={{ uri: tab.startUrl }}
      injectedJavaScriptBeforeContentLoaded={BRIDGE}
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
