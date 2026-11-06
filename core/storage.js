// Storage objects used by research.js and history.js.
// Interface: read(name) -> string | null, write(name, text), list() -> names,
// and optionally remove(name), which deletes a file or every name under
// "name/" (a folder).
// Reads are synchronous; writes may be persisted later.

/**
 * In-memory storage, optionally preloaded and with a callback that persists
 * each write (the mobile app loads its saved files first, then passes them in).
 */
function memoryStorage(initial = {}, onWrite = null, onRemove = null) {
  const files = new Map(Object.entries(initial));
  return {
    read: (name) => (files.has(name) ? files.get(name) : null),
    write: (name, text) => {
      files.set(name, text);
      if (onWrite) onWrite(name, text);
    },
    list: () => [...files.keys()],
    remove: (name) => {
      for (const k of [...files.keys()]) {
        if (k !== name && !k.startsWith(name + "/")) continue;
        files.delete(k);
        if (onRemove) onRemove(k);
      }
    },
  };
}

/** A view of another storage where every name gets a prefix (e.g. "sessions/"). */
function prefixedStorage(storage, prefix) {
  return {
    read: (name) => storage.read(prefix + name),
    write: (name, text) => storage.write(prefix + name, text),
    list: () => storage.list().filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length)),
  };
}

module.exports = { memoryStorage, prefixedStorage };
