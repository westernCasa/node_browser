// How common an English word is, on the Zipf scale (about 7 for "the", 3 for
// rare words; words not in the list count as rare). Used by keyword ranking so
// everyday words lose out to specific ones. Data: core/data/word-frequency-en.js.

let table = null;

function load() {
  if (table) return table;
  table = new Map();
  const raw = require("./data/word-frequency-en.js");
  for (const line of raw.split("\n")) {
    const bar = line.indexOf("|");
    if (bar < 0) continue;
    const zipf = Number(line.slice(0, bar));
    for (const w of line.slice(bar + 1).split(",")) if (w && !table.has(w)) table.set(w, zipf);
  }
  return table;
}

function zipf(word) {
  return load().get(String(word || "").toLowerCase()) || 0;
}

// Score multiplier for a single word: very common words count for little.
function rarityWeight(word) {
  const z = zipf(word);
  if (z >= 6) return 0.12;
  if (z >= 5.5) return 0.25;
  if (z >= 5) return 0.4;
  if (z >= 4.5) return 0.6;
  if (z >= 4) return 0.8;
  if (z >= 3.5) return 0.95;
  return 1.1; // rare or not in the list: names, technical terms
}

module.exports = { zipf, rarityWeight };
