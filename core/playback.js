// Playback limit: media may play in several tabs at once, up to PLAY_LIMIT.
// When one more tab starts playing, the tab that started playing longest ago
// is paused (never the active tab or the one that just started). A tab paused
// this way resumes when the user makes it the active tab again.
// Platform-neutral: the caller reports events and carries out the returned actions.

const PLAY_LIMIT = 4;

class PlaybackLimiter {
  constructor({ limit = PLAY_LIMIT } = {}) {
    this.limit = limit;
    this.playing = []; // tab ids, oldest start first
    this.pausedByLimit = new Set();
  }

  /** Media started in tab `id`. Returns the tab ids to pause. */
  started(id, activeId) {
    this.pausedByLimit.delete(id);
    this.playing = this.playing.filter((x) => x !== id);
    this.playing.push(id);
    const pause = [];
    while (this.playing.length > this.limit) {
      const victim = this.playing.find((x) => x !== activeId && x !== id);
      if (!victim) break;
      this.playing = this.playing.filter((x) => x !== victim);
      this.pausedByLimit.add(victim);
      pause.push(victim);
    }
    return pause;
  }

  /** No media is playing in tab `id` any more (paused, ended, or navigated away). */
  stopped(id) {
    this.playing = this.playing.filter((x) => x !== id);
  }

  /** Tab `id` was closed. */
  closed(id) {
    this.stopped(id);
    this.pausedByLimit.delete(id);
  }

  /** Tab `id` became active. Returns true if its media should resume. */
  activated(id) {
    return this.pausedByLimit.has(id);
  }

  /** The tab loaded a new page: nothing of the old page should resume. */
  navigated(id) {
    this.pausedByLimit.delete(id);
  }

  snapshot() {
    return { playing: [...this.playing], pausedByLimit: [...this.pausedByLimit] };
  }
}

module.exports = { PlaybackLimiter, PLAY_LIMIT };
