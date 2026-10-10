// Scout core: platform-neutral logic shared by the desktop app (Electron) and
// the mobile app (React Native). No Node, Electron or React Native imports.
module.exports = {
  ...require("./keywords"),
  ...require("./providers"),
  ...require("./rules"),
  ...require("./research"),
  ...require("./history"),
  ...require("./net"),
  ...require("./suggest"),
  ...require("./preview"),
  ...require("./page-scripts"),
  ...require("./storage"),
  ...require("./compat"),
  AI: require("./ai"),
  Rules: require("./rules"),
};
