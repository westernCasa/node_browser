// Metro bundler config. Adds ../core (shared with the desktop app) so the
// mobile app can import it.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, "..", "core")];
// Packages that core/ uses (for example @noble for sync, B50) come from this
// app's node_modules: the repository root has none in a phone build.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules"), ...(config.resolver.nodeModulesPaths || [])];

module.exports = config;
