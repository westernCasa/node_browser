// Saved passwords (B47). Kept in one JSON file on this computer; each password
// is encrypted with the system's secure storage (Keychain on macOS, DPAPI on
// Windows, the keyring on Linux) through the encrypt/decrypt functions passed
// in. Nothing here is sent anywhere. Pure Node, so it can be tested without
// Electron.
const fs = require("fs");
const crypto = require("crypto");

// "https://example.com" for http and https addresses; null for anything else.
function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

// Logins are offered on the same origin, and on the same site with or without
// "www." (www.example.com and example.com), same scheme and port.
function sameSite(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const strip = (o) => o.replace(/^(https?:\/\/)www\./i, "$1");
  return strip(a) === strip(b);
}

function siteName(origin) {
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" ? "http://" : "") + u.host.replace(/^www\./i, "");
  } catch {
    return origin;
  }
}

function createPasswordStore({ file, encrypt, decrypt, now = () => Date.now() }) {
  let data = { version: 1, logins: [], never: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(raw.logins)) data.logins = raw.logins.filter((l) => l && typeof l.origin === "string" && l.password);
    if (Array.isArray(raw.never)) data.never = raw.never.filter((o) => typeof o === "string");
  } catch {}

  function save() {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  // Rows without the password, for menus and Settings.
  const row = (l) => ({ id: l.id, origin: l.origin, site: siteName(l.origin), username: l.username || "", created: l.created, used: l.used || 0 });

  return {
    list() {
      return data.logins.map(row).sort((a, b) => a.site.localeCompare(b.site) || a.username.localeCompare(b.username));
    },
    forOrigin(origin) {
      return data.logins
        .filter((l) => sameSite(l.origin, origin))
        .sort((a, b) => (a.origin === origin ? 0 : 1) - (b.origin === origin ? 0 : 1) || (b.used || 0) - (a.used || 0))
        .map(row);
    },
    // The login with its password, only when its site matches the page's origin.
    reveal(id, origin) {
      const l = data.logins.find((x) => x.id === id);
      if (!l || !sameSite(l.origin, origin)) return null;
      const password = decrypt(l.password);
      if (!password) return null;
      l.used = now();
      save();
      return { username: l.username || "", password };
    },
    // What to ask after a sign-in: nothing ("same", "never", "empty"), "new" or "update".
    consider({ origin, username = "", password = "" }) {
      if (!origin || !password) return { action: "empty" };
      if (data.never.some((o) => sameSite(o, origin))) return { action: "never" };
      const match = data.logins.find((l) => sameSite(l.origin, origin) && (l.username || "") === username);
      if (!match) return { action: "new" };
      if (decrypt(match.password) === password) {
        match.used = now();
        save();
        return { action: "same", id: match.id };
      }
      return { action: "update", id: match.id };
    },
    save({ origin, username = "", password }) {
      const at = now();
      const match = data.logins.find((l) => sameSite(l.origin, origin) && (l.username || "") === username);
      if (match) {
        match.password = encrypt(password);
        match.used = at;
        save();
        return match.id;
      }
      const id = crypto.randomBytes(8).toString("hex");
      data.logins.push({ id, origin, username, password: encrypt(password), created: at, used: at });
      save();
      return id;
    },
    remove(id) {
      const n = data.logins.length;
      data.logins = data.logins.filter((l) => l.id !== id);
      if (data.logins.length !== n) save();
      return data.logins.length !== n;
    },
    never(origin) {
      if (!data.never.includes(origin)) data.never.push(origin);
      save();
    },
    neverList() {
      return data.never.map((origin) => ({ origin, site: siteName(origin) })).sort((a, b) => a.site.localeCompare(b.site));
    },
    allow(origin) {
      data.never = data.never.filter((o) => o !== origin);
      save();
    },
    count() {
      return data.logins.length;
    },
  };
}

module.exports = { createPasswordStore, originOf, sameSite, siteName };
