// Shows which site rules apply to sample URLs (no browser needed).
const { DEFAULT_FILE, validate, resolve } = require("../core/rules.js");
const { rules, errors } = validate(DEFAULT_FILE);
console.log("default file errors:", errors);
for (const url of [
  "https://en.wikipedia.org/wiki/Marie_Curie",
  "https://www.youtube.com/watch?v=abc",
  "https://www.paypal.com/myaccount",
  "https://example.com/account/settings",
  "https://example.com/blog/post",
]) {
  const r = resolve(rules, url);
  console.log(url, "->", JSON.stringify({ autoplay: r.autoplay, suggest: r.suggest, mosaic: r.mosaic, skip: r.extract.skip.length, include: r.extract.include.length, matched: r.matched }));
}
const bad = validate({ rules: [{ match: "x.com", autoplay: "loud" }, { match: "/[/" }, { name: "ok", match: "*.y.com", suggest: false }] });
console.log("bad file:", bad.errors, "| kept:", bad.rules.length);
console.log("subdomain-only:", resolve(bad.rules, "https://y.com").suggest, resolve(bad.rules, "https://a.y.com").suggest);
