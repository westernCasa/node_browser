// Automatic active count (B116). Once a day while NODE is in use, one
// anonymous request with only the version and the operating system, so the
// number of daily, weekly and monthly users can be counted. No id of any
// kind: weekly and monthly users are counted from a "first this week" and a
// "first this month" mark on the request. Turn it off in Settings → Help.
// No platform imports: main.js sends the request and keeps the state.

const pad = (n) => String(n).padStart(2, "0");
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
// ISO week, like "2026-W46".
function weekOf(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${pad(week)}`;
}
const OS = { darwin: "mac", win32: "windows", linux: "linux" };
const osName = (platform) => OS[platform] || "other";
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}(?:-[0-9A-Za-z.]{1,20})?$/;

// What to send now, or null. state: { day, week, month } of the last count sent.
function nextCount(state, { now = new Date(), version, platform }) {
  const day = dayOf(now);
  if (state?.day === day || !VERSION.test(String(version))) return null;
  const week = weekOf(now), month = monthOf(now);
  return {
    body: { v: String(version), os: osName(platform), w: state?.week !== week, m: state?.month !== month },
    state: { day, week, month },
  };
}

module.exports = { nextCount, weekOf, dayOf, osName, VERSION };
