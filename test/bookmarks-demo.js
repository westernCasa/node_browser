// Bookmarks store with in-memory storage (npm run test:bookmarks).
const { BookmarkStore } = require("../core/bookmarks");
const { memoryStorage } = require("../core/storage");
const storage = memoryStorage();
const b = new BookmarkStore(storage);
const log = (...a) => console.log("•", ...a);
b.add("https://en.wikipedia.org/wiki/Sourdough", "Sourdough - Wikipedia");
b.add("https://example.com/levain", "Levain guide");
b.add("about:blank", "not a web page");
log("bookmarks:", b.search().map((r) => r.title).join(" | "));
log("search 'levain':", b.search("levain").map((r) => r.url).join(" | "));
log("toggle Sourdough off:", b.toggle("https://en.wikipedia.org/wiki/Sourdough"), "| has it:", b.has("https://en.wikipedia.org/wiki/Sourdough"));
log("after reload from storage:", new BookmarkStore(storage).search().map((r) => r.title).join(" | "));
