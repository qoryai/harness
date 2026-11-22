// The time of one call of the verb film, in ms. The call ends within CALL_MS: the runner gets
// what is left of it after the stop of the runner and the encode, and the waits of a demo
// script get what is left of the runner's time after START_MS. lib/demo-script.cjs refuses a
// script whose waits add up to more than WAITS_MS, so that each script that passes can be filmed.
'use strict';

// The limit of a Bash call of Claude Code with a timeout of 600000, and the reserve below it.
// The reserve also covers the time that the stop of the app and the browser add to the runner.
const TOOL_CALL_MS = 600000;
const MARGIN_MS = 15000;
const CALL_MS = TOOL_CALL_MS - MARGIN_MS;
// The time that lib/preflight.cjs adds to the limit of the runner to stop it.
const STOP_MS = 15000;
// The time of pass 1, the encode of verbs/film.cjs, in a call, measured: 35 s for about
// 28,000 frames. Replace it with a new measure when the encode changes.
const ENCODE_MS = 35000;
// The most time of the runner of a film.
const RUN_BUDGET_MS = CALL_MS - STOP_MS - ENCODE_MS;
// The time of the app's start, in which the start of the browser and the sign-in count too.
const START_MS = 120000;
// The time of the waits of all steps of a script.
const WAITS_MS = RUN_BUDGET_MS - START_MS;

module.exports = { CALL_MS, ENCODE_MS, MARGIN_MS, RUN_BUDGET_MS, START_MS, STOP_MS,
  TOOL_CALL_MS, WAITS_MS };
