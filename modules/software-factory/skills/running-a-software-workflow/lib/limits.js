// The time limit of each kind of check, in minutes: command_limits_minutes of the settings
// that lib/repository-settings.js reads, each key optional, else the default. Each limit is
// at most 60 minutes, because a Bash call of Claude Code stops at BASH_MAX_TIMEOUT_MS, which
// the settings of software-factory set to 60 minutes. No workflow and no verb sets another
// limit.
'use strict';

const extensions = require('./repository-settings.js');

const KEY = 'command_limits_minutes';
const DEFAULTS = Object.freeze({ full_suite: 60, fast_checks: 10, targeted_checks: 5 });
const MOST = 60;

// limits returns { minutes, source, problem }: minutes has a whole number for each key of
// DEFAULTS. problem is the line, fix first, of settings that cannot be read, or whose
// command_limits_minutes breaks the schema, and then minutes is null. No other key of
// software-factory is a problem here. inputs and top are those of read of
// lib/repository-settings.js.
function limits({ inputs, top }) {
  const got = extensions.read({ inputs, top });
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

// takeValue returns { value, rest } of the arguments args of a verb: value is the argument
// after flag, undefined without flag, or null when flag has no value, a value that starts
// with -, or comes twice, and rest the other arguments.
function takeValue(args, flag) {
  const at = args.indexOf(flag);
  if (at === -1) return { value: undefined, rest: args };
  const rest = [...args.slice(0, at), ...args.slice(at + 2)];
  const value = args[at + 1];
  if (typeof value !== 'string' || !value || value.startsWith('-') || rest.includes(flag)) {
    return { value: null, rest };
  }
  return { value, rest };
}

// takeInputs returns { inputs, rest }: takeValue for --inputs.
function takeInputs(args) {
  const { value, rest } = takeValue(args, '--inputs');
  return { inputs: value, rest };
}

module.exports = { KEY, DEFAULTS, MOST, limits, takeValue, takeInputs };
