// Playback limit: which tabs get paused and resumed (npm run test:playback).
const { PlaybackLimiter } = require("../core/playback");
const lim = new PlaybackLimiter({ limit: 4 });
const show = (label, v) => console.log("•", label, JSON.stringify(v));
let active = "1";
for (const id of ["1", "2", "3", "4"]) show(`tab ${id} starts, pause:`, lim.started(id, active));
show("tab 5 starts (active is 1), pause:", lim.started("5", active));
show("state:", lim.snapshot());
active = "2";
show("user opens tab 2, resume it:", lim.activated("2"));
show("tab 2 starts again (active), pause:", lim.started("2", active));
show("state:", lim.snapshot());
lim.stopped("4");
show("tab 4 paused by the user; tab 6 starts, pause:", lim.started("6", active));
lim.closed("3");
show("tab 3 closed; state:", lim.snapshot());
show("tab 1 navigates to a new page, resume on activate:", (lim.navigated("1"), lim.activated("1")));
