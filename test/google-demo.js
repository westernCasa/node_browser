// Which addresses open in the Google window (core/google.js), and the parts of
// companion.js that do not need a browser.
const assert = require("assert");
const { routesToGoogleWindow } = require("../core/google");
const { extensionFiles, nameFor } = require("../companion");

const cases = [
  ["https://accounts.google.com/signin", "apps", true],
  ["https://accounts.google.com/signin", "signin", true],
  ["https://accounts.google.com/signin", "off", false],
  ["https://mail.google.com/mail/u/0/", "apps", true],
  ["https://mail.google.com/mail/u/0/", "signin", false],
  ["https://docs.google.com/document/d/x", "apps", true],
  ["https://www.google.com/search?q=levain", "apps", false],
  ["https://www.youtube.com/watch?v=x", "apps", false],
  ["https://scholar.google.com/scholar?q=sourdough", "apps", false],
  ["https://scholar.google.com/scholar?scilib=1", "apps", true],
  ["https://scholar.google.ca/scholar_alerts?view_op=list_alerts", "apps", true],
  ["https://scholar.google.com/citations?user=abc", "apps", false],
  ["https://scholar.google.com/citations?view_op=list_works", "apps", true],
  ["https://evil.example/accounts.google.com", "apps", false],
  ["https://accounts.google.com.evil.example/", "apps", false],
  ["file:///tmp/x.html", "apps", false],
  ["not a url", "apps", false],
];
for (const [url, mode, want] of cases) {
  const got = routesToGoogleWindow(url, mode);
  console.log(`${got === want ? "ok  " : "FAIL"} ${mode.padEnd(6)} ${got ? "→ Google window" : "→ NODE         "} ${url}`);
  assert.strictEqual(got, want, url);
}

const files = extensionFiles({ autoplay: "on" });
const manifest = JSON.parse(files["manifest.json"]);
assert.strictEqual(manifest.manifest_version, 3);
assert.ok(!manifest.permissions.includes("debugger"), "no debugger permission");
new Function(files["background.js"]); // parses
new Function(files["content.js"]);
console.log("ok   extension files parse; permissions:", manifest.permissions.join(", "));
assert.strictEqual(nameFor("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"), "Brave");
assert.strictEqual(nameFor("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "Google Chrome");
console.log("ok   browser names");
