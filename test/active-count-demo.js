// Automatic active count (B116): core/active-count.js decides when to send
// and what. Run: npm run test:active
const assert = require("assert");
const A = require("../core/active-count");
let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);

const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h);
{
  const first = A.nextCount(null, { now: at(2026, 11, 9), version: "0.11.0", platform: "darwin" });
  assert.deepStrictEqual(first.body, { v: "0.11.0", os: "mac", w: true, m: true });
  assert.deepStrictEqual(Object.keys(first.body).sort(), ["m", "os", "v", "w"], "nothing else is sent");
  assert.strictEqual(A.nextCount(first.state, { now: at(2026, 11, 9, 23), version: "0.11.0", platform: "darwin" }), null, "once a day");
  const tue = A.nextCount(first.state, { now: at(2026, 11, 10), version: "0.11.0", platform: "darwin" });
  assert.deepStrictEqual(tue.body, { v: "0.11.0", os: "mac", w: false, m: false }, "the same week and month");
  const nextWeek = A.nextCount(tue.state, { now: at(2026, 11, 16), version: "0.11.1", platform: "darwin" });
  assert.deepStrictEqual([nextWeek.body.w, nextWeek.body.m, nextWeek.body.v], [true, false, "0.11.1"]);
  const dec = A.nextCount(nextWeek.state, { now: at(2026, 12, 1), version: "0.11.1", platform: "darwin" });
  assert.deepStrictEqual([dec.body.w, dec.body.m], [true, true]);
  ok("one count a day, marked first this week and first this month");
}
{
  assert.strictEqual(A.osName("win32"), "windows");
  assert.strictEqual(A.osName("linux"), "linux");
  assert.strictEqual(A.osName("freebsd"), "other");
  assert.strictEqual(A.nextCount(null, { version: "dev build", platform: "linux" }), null, "only real version numbers");
  assert.strictEqual(A.weekOf(at(2027, 1, 1)), "2026-W53");
  assert.strictEqual(A.weekOf(at(2026, 1, 1)), "2026-W01");
  assert.strictEqual(A.weekOf(at(2026, 12, 28)), "2026-W53");
  ok("OS names, version check and ISO weeks");
}
console.log(`\n${n} checks passed`);
