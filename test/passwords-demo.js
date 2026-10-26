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
// Part 2: strong passwords and imports.
const { generatePassword, parseCsv, loginsFromCsv } = require("../core/passwords");
const g = generatePassword();
check("strong password: four groups of five", /^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){3}$/.test(g), g);
check("strong password has a capital, a small letter and a digit", /[A-Z]/.test(g) && /[a-z]/.test(g) && /[0-9]/.test(g));
check("strong passwords differ", generatePassword() !== generatePassword());
check("CSV: quotes, commas and line breaks in fields", JSON.stringify(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n')) === JSON.stringify([["a", "b"], ["x, y", 'say "hi"\nthere']]));
const chrome = loginsFromCsv("name,url,username,password,note\nexample.com,https://example.com/login,ana,pw-a,\nno-url,,bob,pw-b,\n");
check("Chrome file: one login, one skipped", chrome.logins.length === 1 && chrome.skipped === 1 && chrome.logins[0].origin === "https://example.com");
const safari = loginsFromCsv("Title,URL,Username,Password,Notes,OTPAuth\nEx,https://www.ex.org/,cy,pw-c,,\n");
check("Safari file", safari.logins[0]?.username === "cy" && safari.logins[0]?.origin === "https://www.ex.org");
const firefox = loginsFromCsv('"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://ff.example","dee","pw-d",,"https://ff.example","{1}","1","1","1"\n');
check("Firefox file", firefox.logins[0]?.password === "pw-d");
const bw = loginsFromCsv("folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Ex,,,0,bw.example.com,eve,pw-e,\n");
check("Bitwarden file, address without https://", bw.logins[0]?.origin === "https://bw.example.com" && bw.logins[0]?.username === "eve");
check("not a passwords file", Boolean(loginsFromCsv("a,b\n1,2\n").error));
s = store();
const plan = s.importPlan([...chrome.logins, { origin: o, username: "ben", password: "x" }]);
check("import plan: new and already saved", plan.added === 1 && plan.same === 1, JSON.stringify(plan));
const before = s.count();
s.importMany(chrome.logins);
check("import adds the login", s.count() === before + 1);
check("secret returns the password", s.secret(s.forOrigin("https://example.com").find((l) => l.username === "ana").id) === "pw-a");
if (process.platform !== "win32") check("file readable only by this user", (fs.statSync(file).mode & 0o077) === 0, (fs.statSync(file).mode & 0o777).toString(8));
process.exit(failed ? 1 : 0);
