// Full URL support (React Native's built-in URL lacks parts that core/ uses).
import "react-native-url-polyfill/auto";
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
