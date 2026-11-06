// Desktop storage for core/ modules: one file per name in a folder.
// Names may contain "/" (the trail store keeps one folder per trail); the
// folders are made as needed. append() adds to the end of a file, for
// append-only logs such as a trail's events.jsonl. remove() deletes a file
// or a folder.
const fs = require("fs");
const path = require("path");

function fsStorage(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const full = (name) => {
    const p = path.join(dir, name);
    if (!p.startsWith(path.join(dir, path.sep)) && p !== dir) throw new Error(`Storage name outside its folder: ${name}`);
    return p;
  };
  return {
    read: (name) => {
      try {
        return fs.readFileSync(full(name), "utf8");
      } catch {
        return null;
      }
    },
    write: (name, text) => {
      const p = full(name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      // Write to a temporary file, then rename, so a crash never leaves half a file.
      const tmp = `${p}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, p);
    },
    append: (name, text) => {
      const p = full(name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, text);
    },
    list: () => fs.readdirSync(dir),
    // A file, or a folder with everything in it (a deleted trail, B115).
    remove: (name) => {
      const p = full(name);
      if (p === dir) throw new Error("Storage can't remove its own folder");
      fs.rmSync(p, { recursive: true, force: true });
    },
  };
}

module.exports = { fsStorage };
