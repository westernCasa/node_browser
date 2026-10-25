// Usage summary for the beta survey (B64). NODE counts a few actions on this
// computer and the days it was used. Nothing is sent: the user copies the
// summary from Settings → Help and pastes it into the survey if they want to.
// Only numbers and dates are kept: no pages, addresses, titles or keywords.
// Platform-neutral: the caller passes read() and write() for one JSON file.

const COUNTS = {
  suggestionsShown: "Suggestions shown",
  suggestionsOpened: "Suggestions opened",
  pins: "Keywords pinned",
  hides: "Keywords hidden",
  trailPages: "Trail pages",
  sessions: "Research sessions started",
  captures: "Screenshots and saves",
  mosaic: "Times Mosaic was turned on",
  talk: "Times Talk was opened",
  askQuestions: "Ask AI questions",
  agentRuns: "Research agent runs",
};
const MAX_DAYS = 365;

/** The local date as YYYY-MM-DD. */
function localDay(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

class Usage {
  /** @param io {{ read(): string|null, write(text: string): void }} @param now () => Date */
  constructor(io, now = () => new Date()) {
    this.io = io;
    this.now = now;
    this.timer = null;
    let saved = {};
    try {
      saved = JSON.parse(io.read() || "{}");
    } catch (_) {}
    this.data = { counts: {}, days: Array.isArray(saved.days) ? saved.days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [] };
    for (const k of Object.keys(COUNTS)) this.data.counts[k] = Math.max(0, Math.floor(Number(saved.counts?.[k]) || 0));
  }

  /** Marks today as a day NODE was used. */
  touch() {
    const day = localDay(this.now());
    if (!this.data.days.includes(day)) {
      this.data.days.push(day);
      this.data.days.sort();
      if (this.data.days.length > MAX_DAYS) this.data.days.splice(0, this.data.days.length - MAX_DAYS);
      this.saveSoon();
    }
  }

  /** Adds n to a known count; anything else is ignored. */
  count(name, n = 1) {
    if (!Object.prototype.hasOwnProperty.call(COUNTS, name)) return false;
    const add = Math.min(1000, Math.max(0, Math.floor(Number(n) || 0)));
    if (!add) return false;
    this.data.counts[name] += add;
    this.touch();
    this.saveSoon();
    return true;
  }

  daysUsed() {
    return this.data.days.length;
  }

  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 2000);
    this.timer.unref?.();
  }

  saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      this.io.write(JSON.stringify(this.data, null, 2));
    } catch (_) {}
  }

  /** Plain text for the survey's usage question. */
  summary({ version = "", os = "" } = {}) {
    const c = this.data.counts;
    const days = this.data.days;
    const rate = c.suggestionsShown ? ` (${((c.suggestionsOpened / c.suggestionsShown) * 100).toFixed(1)}%)` : "";
    const lines = [
      "NODE usage summary",
      `Version ${version}${os ? ` · ${os}` : ""}`,
      `Days used: ${days.length}${days.length ? ` (first ${days[0]}, last ${days[days.length - 1]})` : ""}`,
      `${COUNTS.suggestionsShown}: ${c.suggestionsShown} · opened: ${c.suggestionsOpened}${rate}`,
      `${COUNTS.pins}: ${c.pins} · hidden: ${c.hides}`,
      `${COUNTS.trailPages}: ${c.trailPages} · ${COUNTS.sessions.toLowerCase()}: ${c.sessions}`,
      `${COUNTS.captures}: ${c.captures}`,
      `${COUNTS.mosaic}: ${c.mosaic} · ${COUNTS.talk.toLowerCase()}: ${c.talk}`,
      `${COUNTS.askQuestions}: ${c.askQuestions} · ${COUNTS.agentRuns.toLowerCase()}: ${c.agentRuns}`,
      "Counts only. No pages, addresses or keywords.",
    ];
    return lines.join("\n");
  }
}

module.exports = { Usage, COUNTS, localDay };
