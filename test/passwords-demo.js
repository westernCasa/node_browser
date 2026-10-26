// Saved passwords store (B47): matching, save, update, never, reveal by site.
const fs = require("fs"), os = require("os"), path = require("path");
const { createPasswordStore, originOf, sameSite, siteName } = require("../core/passwords");
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, detail);
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-"));
const file = path.join(dir, "passwords.json");
// A stand-in for safeStorage: reversible, and never the plain password.
const encrypt = (v) => ({ enc: Buffer.from([...v].reverse().join("")).toString("base64") });
const decrypt = (s) => (s?.enc ? [...Buffer.from(s.enc, "base64").toString()].reverse().join("") : "");
const store = () => createPasswordStore({ file, encrypt, decrypt });

check("origin of an https page", originOf("https://www.example.com/login?x=1") === "https://www.example.com");
check("no origin for file and data addresses", originOf("file:///x") === null && originOf("data:text/html,x") === null);
check("www and bare host are the same site", sameSite("https://www.example.com", "https://example.com"));
check("other subdomains are not", !sameSite("https://evil.example.com", "https://example.com"));
check("http and https are not", !sameSite("http://example.com", "https://example.com"));
check("site name drops www and https", siteName("https://www.example.com") === "example.com");

let s = store();
const o = "https://example.com";
check("new login: ask", s.consider({ origin: o, username: "ana", password: "pw1" }).action === "new");
const id = s.save({ origin: o, username: "ana", password: "pw1" });
check("file does not hold the plain password", !fs.readFileSync(file, "utf8").includes("pw1"));
s = store();
check("same login again: nothing to ask", s.consider({ origin: o, username: "ana", password: "pw1" }).action === "same");
check("new password: ask to update", s.consider({ origin: o, username: "ana", password: "pw2" }).action === "update");
s.save({ origin: o, username: "ana", password: "pw2" });
check("update keeps one login", s.count() === 1);
check("reveal on the same site", s.reveal(id, "https://www.example.com")?.password === "pw2");
check("no reveal on another site", s.reveal(id, "https://example.org") === null);
check("list has no passwords", !JSON.stringify(s.list()).includes("pw2"));
check("forOrigin lists the login", s.forOrigin("https://example.com")[0]?.username === "ana");
s.save({ origin: o, username: "ben", password: "x" });
check("two usernames on one site", s.forOrigin(o).length === 2);
s.never("https://bank.example");
check("never: no question", s.consider({ origin: "https://bank.example", username: "a", password: "b" }).action === "never");
s.allow("https://bank.example");
check("allowed again: ask", s.consider({ origin: "https://bank.example", username: "a", password: "b" }).action === "new");
check("empty password: nothing", s.consider({ origin: o, username: "ana", password: "" }).action === "empty");
check("remove", s.remove(id) && s.count() === 1);
if (process.platform !== "win32") check("file readable only by this user", (fs.statSync(file).mode & 0o077) === 0, (fs.statSync(file).mode & 0o777).toString(8));
process.exit(failed ? 1 : 0);
