// The time limit of each kind of check, in minutes: command_limits_minutes of the settings
// that lib/extensions.js reads, each key optional, else the default. Each limit is at most 60
// minutes, because a Bash call of Claude Code stops at BASH_MAX_TIMEOUT_MS, which the
// settings of software-factory set to 60 minutes. No workflow and no verb sets another limit.
'use strict';

const extensions = require('./extensions.js');

const KEY = 'command_limits_minutes';
const DEFAULTS = Object.freeze({ full_suite: 60, fast_checks: 10, targeted_checks: 5 });
const MOST = 60;

// limits returns { minutes, source, problem }: minutes has a whole number for each key of
// DEFAULTS. problem is the line, fix first, of settings that cannot be read or that break
// the schema, and then minutes is null. A finding of another key of software-factory is no
// problem here, except a key that the schema does not list.
function limits({ env, cwd }) {
  const got = extensions.read({ env, cwd });
  if (got.problem) return { minutes: null, source: got.source, problem: got.problem };
  const set = got.settings !== null && typeof got.settings === 'object' &&
    !Array.isArray(got.settings) ? got.settings[KEY] : undefined;
  if (set !== null && typeof set === 'object' && !Array.isArray(set)) {
    for (const [name, value] of Object.entries(set)) {
      if (Number.isInteger(value) && value > MOST && Object.hasOwn(DEFAULTS, name)) {
        return { minutes: null, source: got.source, problem: `Set ${name} of ${KEY} in ` +
          `${extensions.PLACE} to at most ${MOST}: it is ${value}, and a Bash call of the ` +
          `agent stops after ${MOST} minutes.` };
      }
    }
  }
  const findings = extensions.check(got.settings, [KEY]);
  if (findings.length) return { minutes: null, source: got.source, problem: findings[0] };
  return { minutes: { ...DEFAULTS, ...(set || {}) }, source: got.source, problem: null };
}

module.exports = { KEY, DEFAULTS, MOST, limits };
