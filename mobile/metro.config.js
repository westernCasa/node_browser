// Metro bundler config. Adds ../core (shared with the desktop app) so the
// mobile app can import it.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, "..", "core")];

module.exports = config;
