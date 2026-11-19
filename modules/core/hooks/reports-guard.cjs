// The part of the guard of .reports/*.json that the adapters for Gemini CLI, Cursor and
// Copilot CLI share. Only checks.cjs writes the JSON files under .reports/ of the artifact
// folder: the report checks, the start counts, the count of failed end checks and the
// findings of a change. On Claude Code and Codex, tool-guard.cjs runs decide for each call;
// the other runtimes run reports-guard-<runtime>.cjs before each tool call.
//
// In a run, when QORY_RUN_ID is set, decide denies:
// - a write, edit or delete of a file whose path is under a folder .reports and ends in
//   .json, or whose name has .json.lock: the locks of checks.cjs findings, starts and report
//   and their .break files; in any argument of the tool except the text that it writes.
//   decide also reads an argument as one path that the disk resolves from cwd, with each `..`
//   and each link: `.reports/a b/../end.json` is denied once `.reports/a b/` exists;
// - a shell command that reaches .reports, unless it runs the harness's checks.cjs and
//   nothing else: the first word, after node, is a path to checks.cjs, or to a copy with the
//   same bytes, and the command has no ; & | < > ` $( or line break, except a 2>&1 at its
//   end. decide reads that file only if it has the size of checks.cjs, and denies a first
//   word that is a device, a pipe or a socket. A command reaches .reports when its text
//   contains .reports; when one of its words,
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
// writes to a file and then runs. The adapters of Gemini CLI, Cursor and Copilot CLI call
// safeDecide, which denies a call for which decide throws. A guard that runs past the
// timeout of its hook lets the command run on Cursor and Copilot CLI. Outside a run decide
// denies nothing, as checks.cjs end checks nothing there.
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
// The u flag with i folds letters as a disk that ignores case does: U+017F (long s) is s and
// U+212A (Kelvin sign) is k, so .reportſ/ is .reports/ and .json.locK is .json.lock.
// The start of a path under a folder .reports, in a word of a text: at its start or after /, =
// or :.
const REPORTS_START = /(?:^|[/=:])\.reports\//iu;
// A word of a text: a run of characters that are no white space, ' or ".
const WORD = /[^\s'"]+/g;

// pathJson reports whether the path full is under a folder .reports and ends in .json, or has
// .json.lock in its name. It reads full as one path, so a space in it splits nothing.
function pathJson(full) {
  if (!REPORTS_START.test(full)) return false;
  const name = full.slice(full.lastIndexOf('/') + 1);
  return /\.json$/iu.test(name) || /\.json\.lock/iu.test(name);
}

// reportsJson reports whether text has a path under a folder .reports that ends in .json, or
// whose name has .json.lock, alone or inside a patch. It returns false for a value that is no
// string. It reads each word once: the regular expression that it replaced took time in the
// square of a text of repeated `.reports/`.
function reportsJson(text) {
  if (typeof text !== 'string') return false;
  for (const [word] of text.matchAll(WORD)) {
    if (pathJson(word)) return true;
  }
  return false;
}

// A path can have at most this many characters on the disks that the guard knows.
const PATH_MAX = 4096;
// The most readlink calls that onDisk makes for all the paths of one call, which also ends a
// loop of links. About 3 microseconds each, so a call that spends them all takes 50 ms.
const MAX_STEPS = 16384;
// A line of a patch that adds, changes, deletes or moves to a file, up to its path.
const PATCH_LINE = /^\s*\*\*\* (?:Add File|Update File|Delete File|Move to): ?/;

// onDisk returns file, read from cwd, as the disk resolves it: a `..` goes to the parent of the
// folder that the parts before it reach, with each link followed, also one to a file that does
// not exist yet. A part that does not exist is kept, and a `..` after it is read as text. Each
// part costs one step of budget.steps; onDisk returns null when none is left.
function onDisk(file, cwd, budget) {
  const todo = (path.isAbsolute(file) ? file : `${cwd}/${file}`).split('/').reverse();
  let real = '/';
  while (todo.length > 0) {
    const part = todo.pop();
    if (part === '' || part === '.') continue;
    if (part === '..') {
      real = path.dirname(real);
      continue;
    }
    if (budget.steps <= 0) return null;
    budget.steps -= 1;
    const at = path.join(real, part);
    let link = null;
    try {
      link = fs.readlinkSync(at);
    } catch {
      // Not a link, or not there: the part stays as it is.
    }
    if (link === null) {
      real = at;
    } else {
      if (path.isAbsolute(link)) real = '/';
      todo.push(...link.split('/').reverse());
    }
  }
  return real;
}

// reportsOnDisk returns the reason to deny a write of text, which reading the words misses, or
// null: a path that is a file .reports/*.json once the disk resolves it from cwd, as one with
// a space before a `..` or one through a link. It reads text as one path, and each header line
// of a patch as one. budget is the one of onDisk, for all the strings of a call.
function reportsOnDisk(text, cwd, budget) {
  const paths = text.includes('\n') ? [] : [text];
  for (const line of text.split('\n')) {
    const header = PATCH_LINE.exec(line);
    if (header !== null) paths.push(line.slice(header[0].length).trim());
  }
  for (const one of paths) {
    if (one === '' || one.length > PATH_MAX || one.includes('\0')) continue;
    const full = onDisk(one, cwd, budget);
    if (full === null) return PATH_REASON;
    if (pathJson(full)) return WRITE_REASON;
  }
  return null;
}

// The folder .reports in a shell command.
const REPORTS = /\.reports(?:[/\s'"`;|&)]|$)/iu;
// A part of a shell command that runs a second command or redirects one.
const CONTROL = /[;&|<>`\n\r]|\$\(/;

// The first line of each deny starts with what to do and has at most 100 characters.
const WRITE_REASON = 'Write no file under .reports/ that ends in .json or has .json.lock in ' +
  'its name.\nOnly checks.cjs writes these files, which contain the report checks, the ' +
  'counts of the run, the findings of a change and the locks of the counts and the findings.';
// The first line of a deny for a command whose first word is a device, a pipe or a socket; the
// second line contains that word.
const SPECIAL_REASON = 'Start the command with a program or a script, not a device, pipe or socket.\n';
const SHELL_REASON = 'Write to .reports/ only through checks.cjs.\nOnly ' +
  'checks.cjs writes the .json files there, which contain the report checks, the counts and ' +
  'the findings of a change.';
// The deny of a call whose paths cost more than MAX_STEPS readlink calls to resolve.
const PATH_REASON = 'Write fewer files in one call, each with a short path and no link.\n' +
  'The guard follows each `..` and each link of a path, and stopped after 16,384 steps.';
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

// strings returns each [key, text] of value: each string in it, with the key it is under. It
// walks a list, not a recursion: a call nested 3,000 levels deep overflowed the call stack.
function strings(value) {
  const out = [];
  const stack = [['', value]];
  while (stack.length > 0) {
    const [key, one] = stack.pop();
    if (typeof one === 'string') {
      out.push([key, one]);
    } else if (Array.isArray(one)) {
      for (let at = one.length - 1; at >= 0; at -= 1) stack.push([key, one[at]]);
    } else if (one !== null && typeof one === 'object') {
      const entries = Object.entries(one);
      for (let at = entries.length - 1; at >= 0; at -= 1) stack.push(entries[at]);
    }
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

// withoutRedirect returns command without its white space at both ends and without a ` 2>&1`
// at its end, with the white space before it. The regular expression that it replaced took time
// in the square of a run of white space.
function withoutRedirect(command) {
  const text = command.trim();
  if (!text.endsWith('2>&1')) return text;
  let end = text.length - '2>&1'.length;
  while (end > 0 && /\s/.test(text[end - 1])) end--;
  return end < text.length - '2>&1'.length ? text.slice(0, end) : text;
}

// checksWord returns the first word of command, after node, as an absolute path with a leading
// quote, $QORY_HARNESS_HOME or ~ resolved, when the command has no ; & | < > ` $( or line break
// other than a 2>&1 at its end; else null.
function checksWord(command, env) {
  const rest = withoutRedirect(command);
  if (CONTROL.test(rest)) return null;
  const words = rest.split(/\s+/);
  if (words[0] === 'node') words.shift();
  const first = (words[0] || '').replace(/^(['"])(.*)\1$/, '$2')
    .replace(/^\$(QORY_HARNESS_HOME|\{QORY_HARNESS_HOME\})(?=\/)/, env.QORY_HARNESS_HOME || '\0')
    .replace(/^~(?=\/)/, env.HOME || '\0');
  return path.isAbsolute(first) && !first.includes('\0') ? first : null;
}

// sameFile reports whether the file real has the bytes of the file checks. It reads real only
// when it is a regular file of the size of checks, and then at most that size and one byte
// more: a device such as /dev/zero has no end, a FIFO blocks the read, and a big file takes
// time and memory.
function sameFile(real, checks) {
  const want = fs.statSync(checks);
  const have = fs.statSync(real);
  if (!have.isFile() || have.size !== want.size) return false;
  const fd = fs.openSync(real, 'r');
  try {
    const bytes = Buffer.alloc(want.size + 1);
    return bytes.subarray(0, fs.readSync(fd, bytes, 0, bytes.length, 0))
      .equals(fs.readFileSync(checks));
  } finally {
    fs.closeSync(fd);
  }
}

// runsChecks reports whether command runs the checks.cjs next to script and nothing else.
function runsChecks(command, env, script) {
  const first = checksWord(command, env);
  if (first === null) return false;
  const checks = path.join(path.resolve(path.dirname(script), '..'), 'modules',
    'core', 'skills', 'running-a-workflow', 'checks.cjs');
  const real = realPath(first);
  if (real === null) return false;
  if (real === realPath(checks)) return true;
  // A compose with copies in place of links writes checks.cjs more than once.
  try {
    return sameFile(real, checks);
  } catch {
    return false;
  }
}

// notProgram returns the second line of a deny when the first word of command is a path to a
// device, a pipe or a socket, or null. A file, a folder and a path that is not there give null.
function notProgram(command, env) {
  const first = checksWord(command, env);
  if (first === null) return null;
  let info;
  try {
    info = fs.statSync(first);
  } catch {
    return null;
  }
  return info.isFile() || info.isDirectory() ? null
    : `The first word of the command is ${short(first)}, which is no program.`;
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

// The most fs.globSync calls, the most paths that they match in all, and the most milliseconds
// that they take in all, for one command. Equal patterns share one call. Measured at load 19 in
// a folder of 1,000 files, 256 different globs `a<n>*` take 0.36 s and 62,500 equal `***` take
// 0.03 s; in a folder of 10,000 files, 256 take over 2 s. A command that passes a limit is
// denied, because a hook that outlasts its timeout lets the call run on Cursor and Copilot CLI.
const MAX_GLOB_CALLS = 256;
const MAX_GLOB_MATCHES = 100000;
const MAX_GLOB_MS = 600;

// Over is the error that globbed throws when a command passes a limit of its budget.
class Over extends Error {}

// globbed returns the paths that pattern matches from cwd, then those that each folder part of
// pattern that has a glob character matches, so that a glob of a file that does not exist yet
// matches its folder. Each ** counts as *, as in bash without globstar, so that no pattern
// walks a whole tree. It throws the error of fs.globSync, such as "pattern is too long" for a
// pattern that bash still expands, and Over when budget, which counts the work of all the
// globs of a command, has no call, match or time left.
function globbed(pattern, cwd, budget) {
  const parts = pattern.replace(/\*{2,}/g, '*').split('/');
  const out = [];
  for (let n = parts.length; n >= 1; n -= 1) {
    const part = parts.slice(0, n).join('/');
    if (!GLOB.test(part)) continue;
    let found = budget.seen.get(part);
    if (found === undefined) {
      if (budget.calls >= MAX_GLOB_CALLS) throw new Over(`more than ${MAX_GLOB_CALLS} different globs`);
      if (Date.now() - budget.start > MAX_GLOB_MS) throw new Over(`more than ${MAX_GLOB_MS} ms`);
      budget.calls += 1;
      found = fs.globSync(part, { cwd });
      budget.seen.set(part, found);
      budget.matches += found.length;
      if (budget.matches > MAX_GLOB_MATCHES) {
        throw new Over(`more than ${MAX_GLOB_MATCHES.toLocaleString('en-US')} matching paths`);
      }
    }
    out.push(...found);
  }
  return out;
}

// short returns raw, cut to 60 characters, for a line of a deny.
const short = (raw) => (raw.length > 60 ? `${raw.slice(0, 59)}…` : raw);

// hidden returns the part of command that reaches .reports though its text does not contain
// .reports, as the second line of a deny, or null. A ~ at the start of a word reads as HOME,
// ~+ as cwd and ~- as OLDPWD. With globs false, it expands no glob.
function hidden(command, cwd, env, globs) {
  const budget = { calls: 0, matches: 0, seen: new Map(), start: Date.now() };
  // The globs that match nothing under .reports: a word that repeats one costs no more work.
  const clean = new Set();
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
    if (clean.has(value)) continue;
    let matches;
    try {
      matches = globbed(value, cwd, budget);
    } catch (error) {
      if (error instanceof Over) {
        return `The globs of the command pass what the guard expands: ${error.message}.`;
      }
      return `fs.globSync could not expand the glob ${short(raw)}: ${error.message}.`;
    }
    const match = matches.find((one) => REPORTS.test(one));
    if (match !== undefined) return `The glob ${raw} matches ${match}.`;
    clean.add(value);
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
    const from = typeof cwd === 'string' && fs.existsSync(cwd) ? cwd : process.cwd();
    const budget = { steps: MAX_STEPS };
    let reason = null;
    for (const [key, text] of strings(args)) {
      if (TEXT_KEYS.has(key)) continue;
      reason = reportsJson(text) ? WRITE_REASON : reportsOnDisk(text, from, budget);
      if (reason !== null) break;
    }
    return reason;
  }
  if (kind === 'shell') {
    const command = args !== null && typeof args === 'object' ? args.command : undefined;
    if (typeof command !== 'string') return null;
    if (runsChecks(command, env, script)) return null;
    if (REPORTS.test(command)) return SHELL_REASON;
    const special = notProgram(command, env);
    if (special !== null) return SPECIAL_REASON + special;
    const from = typeof cwd === 'string' && fs.existsSync(cwd) ? cwd : process.cwd();
    const part = hidden(command, from, env, globs);
    return part === null ? null : HIDDEN_REASON + part;
  }
  return null;
}

// The deny of a call that made decide throw. The second line has the error.
const FAILED_REASON = 'Make the call smaller or simpler, and send it again.\n';

// safeDecide returns what decide returns for call, or, when decide throws in a run, a deny with
// FAILED_REASON and the error: the adapters of Cursor and Copilot CLI let a call run when a hook
// exits with an error, so a call that the guard cannot read is denied.
function safeDecide(call) {
  try {
    return decide(call);
  } catch (error) {
    const env = call.env || process.env;
    return env.QORY_RUN_ID
      ? `${FAILED_REASON}The guard of .reports/ stopped on this call: ${String(error).slice(0, 200)}`
      : null;
  }
}

module.exports = { readInput, decide, safeDecide, runsChecks, withoutRedirect, reportsJson, REPORTS,
  HIDDEN_REASON, WRITE_REASON, SHELL_REASON, PATH_REASON, FAILED_REASON, SPECIAL_REASON };
