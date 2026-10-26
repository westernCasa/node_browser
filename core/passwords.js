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

// A strong password like Safari's: four groups of five letters and digits,
// with at least one capital letter and one digit (about 110 bits).
function generatePassword(randomInt = crypto.randomInt) {
  const lower = "abcdefghijkmnopqrstuvwxyz"; // no l, easily read as 1
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O
  const digits = "23456789";
  const all = lower + upper + digits;
  for (;;) {
    const chars = Array.from({ length: 20 }, () => all[randomInt(all.length)]);
    const pw = [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
    if (/[A-Z]/.test(pw) && /[2-9]/.test(pw) && /[a-z]/.test(pw)) return pw;
  }
}

// CSV as exported by Chrome, Brave, Edge, Safari, Firefox, 1Password and
// Bitwarden (RFC 4180: quoted fields, "" for a quote, line breaks in quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  text = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

// The logins in an exported passwords file. Columns are found by name.
const COLUMNS = {
  url: ["url", "website", "login_uri", "login url", "web site", "hostname", "origin"],
  username: ["username", "login_username", "login name", "user name", "login", "email"],
  password: ["password", "login_password"],
};
function loginsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { logins: [], skipped: 0, error: "The file has no logins." };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names) => head.findIndex((h) => names.includes(h));
  const iu = col(COLUMNS.url), iname = col(COLUMNS.username), ip = col(COLUMNS.password);
  if (iu < 0 || ip < 0) return { logins: [], skipped: 0, error: "This is not a passwords file: it needs a URL and a password column." };
  const logins = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const raw = (r[iu] || "").trim();
    const origin = originOf(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : raw ? `https://${raw}` : "");
    const password = r[ip] || "";
    if (!origin || !password) {
      skipped++;
      continue;
    }
    logins.push({ origin, username: iname >= 0 ? (r[iname] || "").trim() : "", password });
  }
  return { logins, skipped };
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
    // The password, for Settings → Show or Copy (after the user is checked).
    secret(id) {
      const l = data.logins.find((x) => x.id === id);
      return l ? decrypt(l.password) : null;
    },
    // What an import would do, and doing it.
    importPlan(list) {
      let added = 0, updated = 0, same = 0;
      const seen = new Set();
      for (const l of list) {
        const key = `${l.origin}\n${l.username}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = data.logins.find((x) => sameSite(x.origin, l.origin) && (x.username || "") === l.username);
        if (!m) added++;
        else if (decrypt(m.password) === l.password) same++;
        else updated++;
      }
      return { added, updated, same };
    },
    importMany(list) {
      const plan = this.importPlan(list);
      const at = now();
      for (const l of list) {
        const m = data.logins.find((x) => sameSite(x.origin, l.origin) && (x.username || "") === l.username);
        if (m) {
          if (decrypt(m.password) !== l.password) m.password = encrypt(l.password);
        } else data.logins.push({ id: crypto.randomBytes(8).toString("hex"), origin: l.origin, username: l.username, password: encrypt(l.password), created: at, used: 0 });
      }
      save();
      return plan;
    },
  };
}

module.exports = { createPasswordStore, originOf, sameSite, siteName, generatePassword, parseCsv, loginsFromCsv };
