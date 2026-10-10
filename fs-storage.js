// Desktop storage for core/ modules: one file per name in a folder.
const fs = require("fs");
const path = require("path");

function fsStorage(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    read: (name) => {
      try {
        return fs.readFileSync(path.join(dir, name), "utf8");
      } catch {
        return null;
      }
    },
    write: (name, text) => fs.writeFileSync(path.join(dir, name), text),
    list: () => fs.readdirSync(dir),
  };
}

module.exports = { fsStorage };
