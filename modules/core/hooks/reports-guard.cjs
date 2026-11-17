// The part of the guard of .reports/*.json that the adapters for Gemini CLI, Cursor and
// Copilot CLI share. Only checks.cjs writes the JSON files under .reports/ of the artifact
// folder: the report checks, the start counts, the count of failed end checks and the
// findings of a change. On Claude Code and Codex, tool-guard.cjs runs decide for each call;
// the other runtimes run reports-guard-<runtime>.cjs before each tool call.
//
// In a run, when QORY_RUN_ID is set, decide denies:
// - a write, edit or delete of a file whose path is under a folder .reports and ends in
//   .json, or whose name has .json.lock: the locks of checks.cjs findings, starts and report
//   and their .break files; in any argument of the tool except the text that it writes;
// - a shell command that reaches .reports, unless it runs the harness's checks.cjs and
//   nothing else: the first word, after node, is a path to checks.cjs, or to a copy with the
//   same bytes, and the command has no ; & | < > ` $( or line break, except a 2>&1 at its
//   end. A command reaches .reports when its text contains .reports; when one of its words,
//   as the shell reads it, contains .reports; when a word with an unquoted * ? [ or {, or a
//   folder part of that word, matches a path under .reports, as fs.globSync expands it from
//   the working folder of the command; or when the command has $, a backtick or eval and
//   also a .r with no letter, digit or _ before it. The shell's reading removes quotes and
//   backslashes, drops each backslash with the line break after it, decodes $'...', and
//   reads a ~ at the start of a word as HOME, ~+ as the working folder and ~- as OLDPWD. A
//   ** counts as *, as in bash without globstar. decide denies a word with a glob when
//   fs.globSync throws on it, when the word starts with another ~name, and on Node before
//   22, which has no fs.globSync. It denies a word that starts with ~- when OLDPWD is unset.
// decide splits the command into words in Node and runs no shell. A command still reaches
// .reports past these checks through a variable built without .r, or with a .r after a
// letter, digit or _, through shopt -s dotglob, through find or cp -r of the parent folder,
// through a glob after a cd in the command, through python -c, and through a script that it
// writes to a file and then runs. A guard that crashes or runs past the timeout of its hook
// lets the command run on Cursor and Copilot CLI. Outside a run decide denies nothing, as
// checks.cjs end checks nothing there.
//
// The adapter lies at <home>/hooks/, and checks.cjs at
// <home>/modules/core/skills/running-a-workflow/checks.cjs, as end-gate.cjs lists.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { readInput } = require('./end-gate.cjs');

// The keys of a write tool's arguments that contain the text it writes, not a path.
const TEXT_KEYS = new Set(['content', 'contents', 'file_text', 'new_string', 'old_string',
  'new_str', 'old_str', 'instruction', 'description']);
// A path under a folder .reports that ends in .json, or whose name has .json.lock, alone or
// inside a patch.
const REPORTS_JSON =
  /(?:^|[/\s'"=:])\.reports\/(?:[^\s'"]*\/)?[^\s'"/]*\.json(?:\.lock[^\s'"/]*)?(?=$|[\s'"])/im;
// The folder .reports in a shell command.
const REPORTS = /\.reports(?:[/\s'"`;|&)]|$)/i;
// A part of a shell command that runs a second command or redirects one.
const CONTROL = /[;&|<>`\n\r]|\$\(/;

// The first line of each deny starts with what to do and has at most 100 characters.
const WRITE_REASON = 'Write no file under .reports/ that ends in .json or has .json.lock in ' +
  'its name.\nOnly checks.cjs writes these files, which contain the report checks, the ' +
  'counts of the run, the findings of a change and the locks of the counts and the findings.';
const SHELL_REASON = 'Write to .reports/ only through checks.cjs.\nOnly ' +
  'checks.cjs writes the .json files there, which contain the report checks, the counts and ' +
  'the findings of a change.';
// The first line of a deny for a command that reaches .reports in a way its text does not
// show; the second line contains the part of the command that does.
const HIDDEN_REASON = 'Leave .reports/ to checks.cjs, and name other files with no `$`, ' +
  'backtick, eval or glob.\n';
// A part of a shell command that builds a name when the shell runs it.
const BUILT = /[$`]|\beval\b/;
// A .r with no letter, digit or _ before it, as at the start of a path part: d=.rep or
// ${d:-.rep} counts, src/b.rs does not.
const DOT_R = /(?<![A-Za-z0-9_])\.r/i;
// A glob character, which the shell expands when it is not quoted.
const GLOB = /[*?[{]/;

// strings returns each [key, text] of value: each string in it, with the key it is under.
function strings(value, key = '', out = []) {
  if (typeof value === 'string') {
    out.push([key, value]);
  } else if (Array.isArray(value)) {
    for (const one of value) strings(one, key, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [name, one] of Object.entries(value)) strings(one, name, out);
  }
  return out;
}

const realPath = (file) => {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
};

// runsChecks reports whether command runs the checks.cjs next to script and nothing else.
function runsChecks(command, env, script) {
  const rest = command.trim().replace(/\s+2>&1$/, '');
  if (CONTROL.test(rest)) return false;
  const words = rest.split(/\s+/);
  if (words[0] === 'node') words.shift();
  const first = (words[0] || '').replace(/^(['"])(.*)\1$/, '$2')
    .replace(/^\$(QORY_HARNESS_HOME|\{QORY_HARNESS_HOME\})(?=\/)/, env.QORY_HARNESS_HOME || '\0')
    .replace(/^~(?=\/)/, env.HOME || '\0');
  if (!path.isAbsolute(first) || first.includes('\0')) return false;
  const checks = path.join(path.resolve(path.dirname(script), '..'), 'modules',
    'core', 'skills', 'running-a-workflow', 'checks.cjs');
  const real = realPath(first);
  if (real === null) return false;
  if (real === realPath(checks)) return true;
  // A compose with copies in place of links writes checks.cjs more than once.
  try {
    return fs.readFileSync(real).equals(fs.readFileSync(checks));
  } catch {
    return false;
  }
}

// The character of each escape of a $'...' quote, after the backslash, other than the
// numbers \NNN, \xHH, \uHHHH and \UHHHHHHHH and the control character \cX.
const ANSI = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t',
  v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
const ANSI_NUMBER = [[/^[0-7]{1,3}/, 8], [/^x[0-9a-fA-F]{1,2}/, 16],
  [/^u[0-9a-fA-F]{1,4}/, 16], [/^U[0-9a-fA-F]{1,8}/, 16]];

// ansi returns [text, end] for the $'...' quote whose $ is at start of command: text is the
// quote with its escapes decoded, and end is the index of its closing quote.
function ansi(command, start) {
  let text = '';
  let i = start + 2;
  for (; i < command.length && command[i] !== "'"; i += 1) {
    if (command[i] !== '\\' || i + 1 === command.length) {
      text += command[i];
      continue;
    }
    const rest = command.slice(i + 1);
    const number = ANSI_NUMBER.map(([re, base]) => [re.exec(rest), base])
      .find(([found]) => found !== null);
    if (number !== undefined) {
      const [[digits], base] = number;
      const code = parseInt(base === 8 ? digits : digits.slice(1), base);
      text += code <= 0x10ffff ? String.fromCodePoint(code) : '';
      i += digits.length;
    } else if (rest[0] === 'c' && rest.length > 1) {
      text += String.fromCharCode(rest.charCodeAt(1) & 0x1f);
      i += 2;
    } else {
      text += ANSI[rest[0]] ?? `\\${rest[0]}`;
      i += 1;
    }
  }
  return [text, i];
}

// words returns the words of a shell command as { raw, value, glob, tilde }: raw is the text
// of the word as the command has it; value is that text with quotes and backslashes removed,
// a backslash and line break dropped outside single quotes, and the escapes of a $'...' quote
// decoded; glob is true when the word has a * ? [ or { outside quotes; and tilde is true when
// the word starts with a ~ outside quotes. Spaces, line breaks and ; & | < > ( ) end a word
// outside quotes. Other than in $'...', it reads $ and backticks as plain characters.
function words(command) {
  const out = [];
  let word = null;
  const begin = (start) => {
    if (word === null) word = { start, value: '', glob: false, tilde: command[start] === '~' };
  };
  const end = (at) => {
    if (word !== null) {
      out.push({ raw: command.slice(word.start, at), value: word.value, glob: word.glob,
        tilde: word.tilde });
    }
    word = null;
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const start = i;
    if (ch === '\\' && command[i + 1] === '\n') {
      i += 1;
    } else if (/[\s;&|<>()]/.test(ch)) {
      end(i);
    } else if (ch === '\\' && i + 1 < command.length) {
      begin(start);
      i += 1;
      word.value += command[i];
    } else if (ch === '$' && command[i + 1] === "'") {
      begin(start);
      const [text, stop] = ansi(command, i);
      word.value += text;
      i = stop;
    } else if (ch === "'") {
      begin(start);
      const close = command.indexOf("'", i + 1);
      const stop = close === -1 ? command.length : close;
      word.value += command.slice(i + 1, stop);
      i = stop;
    } else if (ch === '"') {
      begin(start);
      for (i += 1; i < command.length && command[i] !== '"'; i += 1) {
        if (command[i] === '\\' && command[i + 1] === '\n') {
          i += 1;
          continue;
        }
        if (command[i] === '\\' && /["\\$`]/.test(command[i + 1] || '')) i += 1;
        word.value += command[i];
      }
    } else {
      begin(start);
      word.value += ch;
      if (GLOB.test(ch)) word.glob = true;
    }
  }
  end(command.length);
  return out;
}

// globbed returns the paths that pattern matches from cwd, then those that each folder part of
// pattern that has a glob character matches, so that a glob of a file that does not exist yet
// matches its folder. Each ** counts as *, as in bash without globstar, so that no pattern
// walks a whole tree. It throws the error of fs.globSync, such as "pattern is too long" for a
// pattern that bash still expands.
function globbed(pattern, cwd) {
  const parts = pattern.replace(/\*{2,}/g, '*').split('/');
  const out = [];
  for (let n = parts.length; n >= 1; n -= 1) {
    const part = parts.slice(0, n).join('/');
    if (!GLOB.test(part)) continue;
    out.push(...fs.globSync(part, { cwd }));
  }
  return out;
}

// short returns raw, cut to 60 characters, for a line of a deny.
const short = (raw) => (raw.length > 60 ? `${raw.slice(0, 59)}…` : raw);

// hidden returns the part of command that reaches .reports though its text does not contain
// .reports, as the second line of a deny, or null. A ~ at the start of a word reads as HOME,
// ~+ as cwd and ~- as OLDPWD. With globs false, it expands no glob.
function hidden(command, cwd, env, globs) {
  for (const { raw, value: text, glob, tilde } of words(command)) {
    let value = text;
    const name = tilde ? /^~([^/]*)/.exec(text)[1] : null;
    const home = { '': env.HOME, '+': cwd, '-': env.OLDPWD }[name];
    if (name === '-' && !env.OLDPWD) {
      return `The guard reads ~- in the word ${short(raw)} as OLDPWD, which is not set.`;
    }
    if (typeof home === 'string' && home !== '') value = home + text.slice(1 + name.length);
    if (REPORTS.test(value)) return `The shell turns the word ${raw} into ${value}.`;
    if (!glob || !globs) continue;
    if (name !== null && home === undefined) {
      return `The guard does not expand ~${name} in the glob ${short(raw)}.`;
    }
    if (typeof fs.globSync !== 'function') {
      return `The guard needs Node 22 or later to expand the glob ${raw}; this is Node ` +
        `${process.versions.node}.`;
    }
    let matches;
    try {
      matches = globbed(value, cwd);
    } catch (error) {
      return `fs.globSync could not expand the glob ${short(raw)}: ${error.message}.`;
    }
    const match = matches.find((one) => REPORTS.test(one));
    if (match !== undefined) return `The glob ${raw} matches ${match}.`;
  }
  const built = BUILT.exec(command);
  if (built !== null && DOT_R.test(command)) {
    const sign = { $: '$', '`': 'a backtick' }[built[0]] || 'eval';
    return `The command has ${sign} and .r, which can build the name .reports.`;
  }
  return null;
}

// decide returns the reason to deny a call, or null to let it run. kind is 'write' for a tool
// that writes, edits or deletes a file, with its arguments args; 'shell' for a shell command,
// with args.command; and anything else for a tool that the guard lets run. cwd is the working
// folder of the shell command, from the hook's input, from which a glob in it expands; with
// no cwd, or one that does not exist, a glob expands from the working folder of the hook.
// With globs false, decide expands no glob: fs.globSync has no limit on its work, so
// tool-guard.cjs, which bounds the work of each call, matches globs itself.
function decide({ kind, args, env = process.env, script = process.argv[1], cwd,
  globs = true }) {
  if (!env.QORY_RUN_ID) return null;
  if (kind === 'write') {
    const hit = strings(args).some(([key, text]) => !TEXT_KEYS.has(key) &&
      REPORTS_JSON.test(text));
    return hit ? WRITE_REASON : null;
  }
  if (kind === 'shell') {
    const command = args !== null && typeof args === 'object' ? args.command : undefined;
    if (typeof command !== 'string') return null;
    if (runsChecks(command, env, script)) return null;
    if (REPORTS.test(command)) return SHELL_REASON;
    const from = typeof cwd === 'string' && fs.existsSync(cwd) ? cwd : process.cwd();
    const part = hidden(command, from, env, globs);
    return part === null ? null : HIDDEN_REASON + part;
  }
  return null;
}

module.exports = { readInput, decide, runsChecks, REPORTS, HIDDEN_REASON, WRITE_REASON,
  SHELL_REASON };
