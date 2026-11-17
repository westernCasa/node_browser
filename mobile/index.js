// Full URL support (React Native's built-in URL lacks parts that core/ uses).
import "react-native-url-polyfill/auto";
// Secure random numbers for sync (B50); must load before the app.
import "./src/cryptoPolyfill";
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
