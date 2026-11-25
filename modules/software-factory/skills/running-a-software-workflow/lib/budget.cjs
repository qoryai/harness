// The time of one call of the verb film, in ms. The call ends within CALL_MS: the runner gets
// what is left of it after the stop of the runner and the encode, and the waits of a demo
// script, in its setup and its steps, get what is left of the runner's time after START_MS.
// lib/demo-script.cjs refuses a script whose waits add up to more than WAITS_MS, so that each
// script that passes can be filmed. Run the film call with a tool timeout of at least 600 s.
'use strict';

// The limit of a tool call, and the reserve below it. The ffmpeg floor of 5 s is not used
// after a run within its limit. Of the 15 s, the delete of 28,000 frames takes 1.7 s and the
// start of Node 0.1 s (measured on this development machine, with 28,000 jpeg files of 50 KB),
// so about 13 s are left.
const TOOL_CALL_MS = 600000;
const MARGIN_MS = 15000;
// shortcut: a runtime whose tool calls cannot last 600 s cannot run a film call; give it a
// call in the background when one exists.
const CALL_MS = TOOL_CALL_MS - MARGIN_MS;
// The time that lib/preflight.cjs adds to the limit of the runner to stop it.
const STOP_MS = 15000;
// The time of pass 1, the encode of verbs/film.cjs, in a call, measured: 35 s for about
// 28,000 frames.
// shortcut: replace it with the run-image measurement when it exists.
const ENCODE_MS = 35000;
// The most time of the runner of a film.
const RUN_BUDGET_MS = CALL_MS - STOP_MS - ENCODE_MS;
// The time of the app's start, in which the start of the browser and the sign-in count too.
// One deadline of the runner, START_MS after its start, stops them when they pass it.
const START_MS = 120000;
// The time of the waits of the setup and the steps of a script.
const WAITS_MS = RUN_BUDGET_MS - START_MS;

module.exports = { CALL_MS, ENCODE_MS, MARGIN_MS, RUN_BUDGET_MS, START_MS, STOP_MS,
  TOOL_CALL_MS, WAITS_MS };
