// Suggestion controller: decides when to read the page and search again, and
// holds keywords, pins, hidden keywords and results. Same behaviour as the
// desktop sidebar (renderer/app.js), written without UI so the mobile app can
// use it and Node can test it.
//
// The platform supplies:
//   extract(tab)          -> Promise<page>   (runs core/page-scripts extractionScript in the page)
//   suggestFor(payload)   -> Promise<result> (core/suggest.js)
//   analyzePage, KeywordContext  (core/keywords.js)
//   research              (core/research.js ResearchStore, optional)
//   onChange(state)       called after every state change

const { analyzePage, KeywordContext, overlap } = require("./keywords");

const RECRAWL_GAP_MS = 20000; // minimum time between automatic searches (B11)
const SELECTION_GAP_MS = 3000;
const AUTO_SHOWN = 8;

class SuggestController {
  constructor({ extract, suggestFor, research = null, onChange = () => {}, now = () => Date.now() }) {
    this.extract = extract;
    this.suggestFor = suggestFor;
    this.research = research;
    this.onChange = onChange;
    this.now = now;
    this.context = new KeywordContext();
    this.state = {
      pinned: research ? [...(research.current.pins || [])] : [],
      banned: [],
      auto: [],
      results: [],
      queries: [],
      aiQueries: [],
      status: "Waiting for a page to load.",
      busy: false,
      disabled: false,
      autoOn: true,
    };
    this.last = { at: 0, url: "", terms: [], selection: "" };
    this.again = false;
    this.activeTab = null;
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.onChange({ ...this.state });
  }

  lower(s) {
    return String(s).toLowerCase();
  }

  autoTerms() {
    const { pinned, banned, auto } = this.state;
    const pins = new Set(pinned.map((p) => this.lower(p)));
    return auto.map((r) => r.term).filter((t) => !pins.has(this.lower(t)) && !banned.includes(this.lower(t)));
  }

  shownKeywords() {
    return [...this.state.pinned, ...this.autoTerms().slice(0, AUTO_SHOWN)];
  }

  savePins() {
    if (this.research) this.research.setPins(this.state.pinned);
  }

  togglePin(term) {
    const has = this.state.pinned.some((p) => this.lower(p) === this.lower(term));
    this.set({ pinned: has ? this.state.pinned.filter((p) => this.lower(p) !== this.lower(term)) : [...this.state.pinned, term] });
    this.savePins();
    return this.crawl();
  }

  addPin(term) {
    const t = String(term || "").trim();
    if (!t || this.state.pinned.some((p) => this.lower(p) === this.lower(t))) return Promise.resolve();
    this.set({ pinned: [...this.state.pinned, t].slice(0, 6), banned: this.state.banned.filter((b) => b !== this.lower(t)) });
    this.savePins();
    return this.crawl();
  }

  hide(term) {
    this.set({ banned: [...new Set([...this.state.banned, this.lower(term)])] });
    return this.crawl();
  }

  dismiss(url) {
    if (this.research) this.research.dismiss(url);
    this.set({ results: this.state.results.filter((r) => r.url !== url) });
  }

  opened(item) {
    if (this.research) this.research.opened(item);
  }

  setAuto(on) {
    this.set({ autoOn: Boolean(on) });
  }

  // New research session: pins come from the session; page keywords reset.
  adoptSession() {
    this.last = { at: 0, url: "", terms: [], selection: "" };
    this.set({ pinned: this.research ? [...(this.research.current.pins || [])] : [], auto: [], results: [], queries: [], aiQueries: [] });
  }

  notDismissed(items) {
    const gone = new Set(this.research ? this.research.current.dismissed : []);
    return (items || []).filter((x) => !gone.has(x.url));
  }

  /**
   * The page or what is on screen changed.
   * reason: "load" (page finished loading), "scroll", "selection", "tick", "manual"
   * tab: { id, url, title, rule }
   */
  async onPage(tab, reason, selectionText = "") {
    this.activeTab = tab;
    if (!tab?.url) return;
    if (tab.rule && tab.rule.suggest === false) {
      if (this.last.url !== tab.url) {
        this.last = { at: this.now(), url: tab.url, terms: [], selection: "" };
        this.set({ auto: [], results: [], disabled: true, status: "Suggestions are off for this site (site rule)." });
      }
      return;
    }
    if (reason !== "manual" && reason !== "load" && !this.state.autoOn) return;
    let page;
    try {
      page = await this.extract(tab);
    } catch (err) {
      this.set({ status: "Could not read the page: " + String(err?.message || err) });
      return;
    }
    if (!page || page.error) return;
    const res = analyzePage(page, { context: this.context, banned: this.state.banned, limit: 12 });
    // Thin pages (home screens, feeds, bot checks) use the running topic.
    const ranked = res.thin ? (res.blocked ? [] : this.context.topic(8, this.state.banned)) : res.ranked;
    if (res.thin && !ranked.length) {
      if (this.last.url !== tab.url) {
        this.last = { at: this.now(), url: tab.url, terms: [], selection: "" };
        this.set({ auto: [], results: [], status: res.blocked ? "This page is a bot check or an access block." : "Not much to read on this page yet." });
        if (this.state.pinned.length) return this.crawl();
      }
      return;
    }
    const terms = ranked.map((r) => r.term).slice(0, 6);
    const selection = page.selection || selectionText || "";
    const now = this.now();
    const newPage = tab.url !== this.last.url;
    const newSelection = selection && selection !== this.last.selection;
    const drifted = overlap(terms, this.last.terms) < 0.5;
    const due = now - this.last.at >= RECRAWL_GAP_MS;
    if (reason === "load" && !newPage && !due) return;
    if (reason === "scroll" || reason === "selection" || reason === "tick") {
      const go = newPage || (newSelection && now - this.last.at >= SELECTION_GAP_MS) || (drifted && due);
      if (!go) return;
    }
    this.last = { at: now, url: tab.url, terms, selection };
    this.set({ auto: ranked, disabled: false });
    if (this.research && !res.thin) this.research.visit(tab.url, tab.title, terms.slice(0, 5));
    return this.crawl();
  }

  // Search with the current pins and page keywords: Wikipedia first, then all.
  async crawl() {
    if (this.state.busy) {
      this.again = true;
      return;
    }
    if (!this.shownKeywords().length) {
      this.set({ status: "No keywords yet. Add one, or load a page." });
      return;
    }
    const tab = this.activeTab;
    const startedFor = tab?.url;
    const stale = () => (this.activeTab?.url || "") !== (startedFor || "");
    this.set({ busy: true, status: "Searching…" });
    const payload = { pinned: this.state.pinned, ranked: this.autoTerms(), title: tab?.title || "", excludeUrl: tab?.url || "" };
    try {
      const first = await this.suggestFor({ ...payload, part: "reference" });
      if (stale()) return;
      const firstResults = this.notDismissed(first.results);
      if (firstResults.length) this.set({ results: firstResults, status: `${firstResults.length} Wikipedia results · loading web results…` });
      const data = await this.suggestFor({ ...payload, part: "all" });
      if (stale()) return;
      const results = this.notDismissed(data.results);
      const ai = new Set(data.aiQueries || []);
      const qs = (data.queries || []).map((q) => `"${q}"` + (ai.has(q) ? " (AI)" : "")).join(" · ");
      let status = `${results.length} results` + (qs ? ` for ${qs}` : "");
      if (data.notes?.length) status += " — " + data.notes.join(" ");
      this.set({ results, queries: data.queries || [], aiQueries: data.aiQueries || [], status });
    } catch (err) {
      this.set({ status: "Search failed: " + String(err?.message || err) });
    } finally {
      this.set({ busy: false });
      if (this.again) {
        this.again = false;
        this.crawl();
      }
    }
  }
}

module.exports = { SuggestController, RECRAWL_GAP_MS };
