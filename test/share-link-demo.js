// Share links (B82 phase 2): encryption and reading links.
//   node test/share-link-demo.js
const assert = require("assert");
const S = require("../core/share-link");
const ok = (name) => console.log("ok  ", name);

const md = "---\nnode-trail: 1\nname: Test\n---\n# Test\n\nÜnïcode · 24 °C\n";
const { bytes, key } = S.seal(md);
assert.ok(bytes.subarray(0, 3).toString() === "NT1" && key.length === 43 && !bytes.toString("latin1").includes("Test"));
assert.strictEqual(S.unseal(bytes, key), md);
ok("a trail is encrypted (no readable text) and comes back the same");

assert.notStrictEqual(S.seal(md).key, key);
ok("every link gets its own key");

assert.throws(() => S.unseal(bytes, S.seal("x").key), /could not be decrypted/);
const tampered = Buffer.from(bytes);
tampered[20] ^= 1;
assert.throws(() => S.unseal(tampered, key), /could not be decrypted/);
assert.throws(() => S.unseal(bytes, key.slice(0, 20)), /incomplete/);
assert.throws(() => S.unseal(Buffer.from("# plain"), key), /not an encrypted NODE trail/);
ok("a wrong key, a changed byte, a cut key and plain text are refused");

const link = S.linkFor("AbCdEfGh12345678", key);
assert.strictEqual(link, `https://noderesearch.app/t/AbCdEfGh12345678#k=${key}`);
assert.deepStrictEqual(S.parseLink(link), { id: "AbCdEfGh12345678", key, api: S.API_BASE });
assert.deepStrictEqual(S.parseLink(`noderesearch://open?link=${encodeURIComponent(link)}`), { id: "AbCdEfGh12345678", key, api: S.API_BASE });
assert.strictEqual(S.parseLink(link.split("#")[0]).key, "");
ok("links and noderesearch://open?link=… are read");

for (const bad of [`https://evil.example/t/AbCdEfGh12345678#k=${key}`, `http://noderesearch.app/t/AbCdEfGh12345678#k=${key}`, "https://noderesearch.app/download", "https://noderesearch.app/t/short", "not a link", ""]) assert.strictEqual(S.parseLink(bad), null, bad);
ok("other sites, plain http, other pages and junk are not share links");
