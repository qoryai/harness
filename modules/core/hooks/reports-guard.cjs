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
//   and each link, and the path of each header line of a patch in it, read as Codex reads it
//   (lines end at line feeds, the path keeps a space at its start) and with any line break and
//   any white space cut off: `.reports/a b/../end.json` is denied, with or without the folder a b;
// - a shell command that reaches .reports, unless it runs the harness's checks.cjs and
//   nothing else: the first word, after node, is a path to checks.cjs, or to a copy with the
//   same bytes, and the command has no ; & | < > ` $( or line break, except a 2>&1 at its
//   end. decide reads that file only if it has the size of checks.cjs, and denies a first
//   word that is a device, a pipe or a socket. A command reaches .reports when its text
//   contains .reports; when one of its words, as the shell reads it, contains .reports; when
//   a word with an unquoted * ? [ or {, or a folder part of that word, matches a path under
//   .reports, as fs.globSync expands it from the working folder of the command; or when the command has $, a backtick or eval and
//   also a .r with no letter, digit or _ before it. The shell's reading removes quotes and
//   backslashes, drops each backslash with the line break after it, decodes $'...', and
//   reads a ~ at the start of a word as HOME, ~+ as the working folder and ~- as OLDPWD. A
//   ** counts as *, as in bash without globstar. decide denies a word with a glob when
//   fs.globSync throws on it, when the word starts with another ~name, and on Node before
//   22, which has no fs.globSync. It denies a word that starts with ~- when OLDPWD is unset.
// It denies a glob of more than 4,096 characters, with an extended glob, or with more than 3 *
// in a path part, 8 in all, 16 * and ? in a part, or 32 in all, each pair of braces counted as
// its largest alternative: fs.globSync cannot be stopped. A part after a / inside braces with 2
// or more * is denied, and every part with a * ? or [ is bounded by the names that it scans,
// times its alternatives (250 ms of estimate for one call, 83,334 names read at most).
// decide splits the command into words in Node and runs no shell. A command still reaches
// .reports past these checks through a variable built without .r, or with a .r after a
// letter, digit or _, through shopt -s dotglob, through find or cp -r of the parent folder,
// through a glob after a cd in the command, through python -c, and through a script that it
// writes to a file and then runs. A first word that is a byte copy of checks.cjs counts as the
// checks tool, although checks.cjs loads files next to it, so a copy of the whole folder with
// an edited file runs. A shell command that writes through an existing link to .reports is not
// followed to the target: the write tools follow links, the shell kind does not. A path with
// backslash separators is read as POSIX, so `art\.reports\x.json` is one name, which a tool of
// Windows reads as a path under .reports. The adapters
// of Gemini CLI, Cursor and Copilot CLI call safeDecide, which denies a call for which decide
// throws. A guard that runs past the timeout of its hook lets the command run on Cursor and
// Copilot CLI. Outside a run decide denies nothing, as checks.cjs end checks nothing there.
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
// whose name has .json.lock, alone or inside a patch. It reads each word once, and returns
// false for a value that is no string.
function reportsJson(text) {
  if (typeof text !== 'string') return false;
  for (const [word] of text.matchAll(WORD)) {
    if (pathJson(word)) return true;
  }
  return false;
}

// A path has at most this many characters on the disks that the guard knows, and a disk follows
// at most this many links in one path.
const PATH_MAX = 4096;
const MAX_LINKS = 40;
// The most parts, `.` and empty ones too, that onDisk takes from all the paths of one call.
const MAX_STEPS = 16384;
// The white space that Codex trims from a line of a patch, as Rust's trim does: the characters of
// Unicode's White_Space. JavaScript's \s lacks U+0085.
const PATCH_SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f' +
  '\\u3000';
const PATCH_SPACE_CHAR = new RegExp(`[${PATCH_SPACE}]`);
// Each line break of that set. Codex splits a patch at line feeds only, but a tool may split at
// each of them, so the guard reads a patch both ways.
const PATCH_BREAK = /[\n\v\f\r\u0085\u2028\u2029]/;
// The start of a line of a patch that adds, changes, deletes or moves to a file, as Codex reads
// it: the exact text, with one space after the colon. The broad form takes the space as optional.
const PATCH_EXACT = /^\*\*\* (?:Add File|Update File|Delete File|Move to): /;
const PATCH_LINE = new RegExp(`^[${PATCH_SPACE}]*\\*\\*\\* (?:Add File|Update File|Delete File|` +
  'Move to): ?');

// trimmed returns text without the white space of PATCH_SPACE at both ends, in one pass.
function trimmed(text) {
  let from = 0;
  let to = text.length;
  while (from < to && PATCH_SPACE_CHAR.test(text[from])) from += 1;
  while (to > from && PATCH_SPACE_CHAR.test(text[to - 1])) to -= 1;
  return text.slice(from, to);
}

// Stop is the error that onDisk throws for a path that it cannot read; its message is the deny.
class Stop extends Error {}

// onDisk returns file as the disk resolves it, from start for a relative file: it follows each
// link with readlink, also one to a file that is not there, and goes up for `..`. Each part
// costs a step of budget.steps. It throws Stop for a path with no steps left or too many links.
function onDisk(file, start, budget) {
  const todo = file.split('/').reverse();
  let real = path.isAbsolute(file) ? '/' : start;
  let links = 0;
  while (todo.length > 0) {
    const part = todo.pop();
    if (budget.steps <= 0) throw new Stop(PATH_REASON);
    budget.steps -= 1;
    if (part === '' || part === '.') continue;
    const at = path.join(real, part);
    let link = null;
    try {
      link = fs.readlinkSync(at);
    } catch {
      // Not a link, or not there: the part stays as it is.
    }
    if (link === null) {
      real = at;
      continue;
    }
    links += 1;
    if (links > MAX_LINKS) throw new Stop(LOOP_REASON);
    if (path.isAbsolute(link)) real = '/';
    todo.push(...link.split('/').reverse());
  }
  return real;
}

// flat returns file as path.posix.normalize returns it, in one pass: it drops each `.` and empty
// part, and each `..` with the part before it. path.posix.normalize took 26 s on 990 KB of `../`.
function flat(file) {
  const absolute = file.startsWith('/');
  const stack = [];
  for (const part of file.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') stack.push(part);
    else if (stack.length > 0 && stack[stack.length - 1] !== '..') stack.pop();
    else if (!absolute) stack.push('..');
  }
  const body = stack.join('/');
  const out = absolute ? `/${body}` : body || '.';
  return file.endsWith('/') && !out.endsWith('/') ? `${out}/` : out;
}

// headerPaths returns the paths of the header lines of a patch text, read the way Codex reads
// them and the way that any line break and any white space is read, with and without the white
// space at the left of the path: Codex strips only the exact start of the line, so a name with a
// space at its start is a different name. A path that both readings give is listed once.
function headerPaths(text) {
  // forms returns right, a path with no white space at its right end, and the same without any at
  // its left end when that differs.
  const forms = (right) => {
    const both = trimmed(right);
    return both === right ? [right] : [right, both];
  };
  const codex = [];
  for (const line of text.split('\n')) {
    const whole = trimmed(line);
    const header = PATCH_EXACT.exec(whole);
    if (header !== null) codex.push(...forms(whole.slice(header[0].length)));
  }
  const left = new Map();
  for (const one of codex) left.set(one, (left.get(one) || 0) + 1);
  const out = [...codex];
  for (const line of text.split(PATCH_BREAK)) {
    const header = PATCH_LINE.exec(line);
    if (header === null) continue;
    const rest = line.slice(header[0].length);
    let end = rest.length;
    while (end > 0 && PATCH_SPACE_CHAR.test(rest[end - 1])) end -= 1;
    for (const one of forms(rest.slice(0, end))) {
      if (left.get(one) > 0) left.set(one, left.get(one) - 1);
      else out.push(one);
    }
  }
  return out;
}

// A path with a `.` or `..` part, or an empty part inside it.
const DOTTED = /(?:^|\/)\.\.?(?:\/|$)|\/\//;

// reportsOnDisk returns the deny for a text whose path the disk resolves to a file .reports/*.json,
// as one with a space before a `..` or one through a link, or null. It reads the whole text as one
// path, and also the path of each header line of a patch in it; a line break in a path is part
// of a part's name. It reads each path in two ways: as the kernel does, which applies each `..` to
// the folder that the part before it resolves to, and as a tool that cuts each `..` out of the
// text before it opens the file; a deny by either way counts. state has the budget of the call, the
// resolved folder cwd and its text.
function reportsOnDisk(text, cwd, state) {
  const paths = [text, ...headerPaths(text)];
  try {
    for (const one of paths) {
      if (one === '' || one.includes('\0')) continue;
      if (state.start === undefined) {
        state.text = path.resolve(cwd);
        state.start = onDisk(state.text, '/', state);
        // The folders that a tool may resolve a relative path against: the text of the working
        // folder, the folder that its links lead to, and what fs.realpathSync returns for it.
        state.bases = new Set([state.text, state.start]);
        try {
          state.bases.add(fs.realpathSync(state.text));
        } catch {
          // The working folder is not there: the other two readings stay.
        }
      }
      // No disk takes a path over PATH_MAX characters.
      if (one.length <= PATH_MAX && pathJson(onDisk(one, state.start, state))) return WRITE_REASON;
      // A tool that cuts each `.` and `..` and each empty part out of the text first, or one that
      // takes a path over PATH_MAX that way, reads the text, not the kernel's folders.
      if (one.length <= PATH_MAX && !DOTTED.test(one)) continue;
      for (const base of one.startsWith('/') ? [''] : state.bases) {
        const cut = flat(one.startsWith('/') ? one : `${base}/${one}`);
        if (pathJson(cut)) return WRITE_REASON;
        if (cut.length <= PATH_MAX && pathJson(onDisk(cut, '/', state))) return WRITE_REASON;
      }
    }
  } catch (error) {
    if (error instanceof Stop) return error.message;
    throw error;
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
// The deny of a path that goes through more than MAX_LINKS links.
const LOOP_REASON = 'Remove the link loop from the path.\n' +
  'The path goes through more than 40 links, or through a link that leads back to itself.';
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
// if it is a regular file of the size of checks, and then at most one byte more than that:
// /dev/zero has no end, and a FIFO blocks the read. Another process may replace real with a
// FIFO between the stat of its path and the open, so the open does not block (O_NONBLOCK) and
// the type and size come from the open file (fstat), not from the path.
function sameFile(real, checks) {
  const want = fs.statSync(checks);
  const have = fs.statSync(real);
  if (!have.isFile() || have.size !== want.size) return false;
  const fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const open = fs.fstatSync(fd);
    if (!open.isFile() || open.size !== want.size) return false;
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
// device, a pipe or a socket. For a file, a folder and a path that is not there, it returns null.
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

// The limits of one command: fs.globSync calls, matched paths, milliseconds, units of brace
// expansion (1 for each pattern, 256 for each with a wildcard), and parts of a glob with a
// glob character. One call cannot be stopped, so the limits hold before it. A glob word has at
// most MAX_GLOB_LENGTH characters, 3 `*` in a path part and 8 in all, and 16 `*` or `?` in a
// path part and 32 in all: fs.globSync matches a part with a regular expression that takes
// time in the power of its `*`, for each name of each folder that it scans: 1 ms per name of
// 254 characters for `*a*a*c` (3), and over 20 s for `*a*a*a*a*c` (5). scanWork bounds the work
// by the names that a part scans.
const MAX_GLOB_CALLS = 256;
const MAX_GLOB_MATCHES = 100000;
const MAX_GLOB_MS = 600;
const MAX_GLOB_UNITS = 4096;
const WILDCARD_UNITS = 256;
const MAX_GLOB_DEPTH = 5;
const MAX_GLOB_LENGTH = PATH_MAX;
const MAX_STARS_PART = 3;
const MAX_STARS = 8;
const MAX_WILD_PART = 16;
const MAX_WILD = 32;
// The work of one fs.globSync call is bounded by its input, because the call cannot be stopped.
// A part with 2 or more `*` costs about len(name)^stars per name of a folder that it scans, as
// 1.0 ms for `*a*a*c` on a name of 254 `a` and 0.06 ms on 100 (measured at load 12), and each name
// costs a base for the read. A part with fewer costs 2.1 us per name and 0.54 us more for each
// alternative of its braces after the first, as 107 ms for `*` and 520 ms for 17 alternatives
// followed by `*`, on 50,000 names. The constants are 5 to 100 % more than the measured times,
// and one call may cost 250 ms of this estimate, which took under 500 ms at load 30. The time
// of all the calls of a command is bounded by MAX_GLOB_MS, between the calls.
const BASE_NS = 3000;
const NS_PER_UNIT = { 2: 0.5, 3: 0.08 };
const ONE_NS = 2200;
const ALT_NS = 600;
const MAX_WORK_NS = 250e6;
// A folder with this many names or more is not read, and one with more than MAX_STAR_ENTRIES
// makes a part with 3 `*` too slow; a glob scans at most MAX_SCAN_DIRS folders.
const MAX_READ = Math.floor(MAX_WORK_NS / BASE_NS) + 1;
const MAX_STAR_ENTRIES = 20000;
const MAX_SCAN_DIRS = 2000;
// An extended glob such as +(a|aa) or !(a): fs.globSync reads it where bash reads a quoted or
// escaped ( as text, and its regular expression takes exponential time.
const EXTGLOB = /[*?+@!]\(/;

// Over is the error that globbed throws when a command passes a limit of its budget.
class Over extends Error {}

// The largest count of words that a brace makes, and the longest number of a range that is read
// in full: a longer one makes that many words.
const HUGE = 1e12;
const DIGITS = 20;

// bigOf returns the number in text, a minus sign and digits with or without zeros before them,
// as a BigInt, or null for one of more than DIGITS digits.
function bigOf(text) {
  const negative = text.startsWith('-');
  const digits = text.slice(negative ? 1 : 0).replace(/^0+(?=\d)/, '');
  if (digits.length > DIGITS) return null;
  return BigInt(negative ? `-${digits}` : digits);
}

// The text of a range in a brace, which the sticky flag reads at one place.
const NUMBER_RANGE = /(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?/y;
const LETTER_RANGE = /([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?/y;

// rangeCount returns how many words the brace `{from..to}` or `{from..to..step}` makes when its
// text is pattern from start to end, or 0 when that text is no range. Zeros before a number
// make no difference to its value, a step of 0 counts as 1, and the count has at most HUGE.
function rangeCount(pattern, start, end) {
  let found = null;
  for (const re of [NUMBER_RANGE, LETTER_RANGE]) {
    re.lastIndex = start;
    const one = re.exec(pattern);
    if (one !== null && start + one[0].length === end) found = [re === NUMBER_RANGE, one];
  }
  if (found === null) return 0;
  const [numbers, [, from, to, by]] = found;
  const ends = numbers ? [bigOf(from), bigOf(to)]
    : [BigInt(from.charCodeAt(0)), BigInt(to.charCodeAt(0))];
  if (ends.includes(null)) return HUGE;
  let step = by === undefined ? 1n : bigOf(by);
  if (step === null) step = 10n ** BigInt(DIGITS + 1);
  if (step < 0n) step = -step;
  if (step === 0n) step = 1n;
  const gap = ends[1] > ends[0] ? ends[1] - ends[0] : ends[0] - ends[1];
  const count = gap / step + 1n;
  return count > BigInt(HUGE) ? HUGE : Number(count);
}

// braces returns how many patterns pattern makes by brace expansion, without making them: the
// sum of the alternatives of each {a,b}, the size of each range {1..9}, and the product of
// braces side by side or inside one another, clamped at 1e12. It reads each character once.
function braces(pattern) {
  const stack = [];
  let count = 1;
  for (let at = 0; at < pattern.length; at += 1) {
    const ch = pattern[at];
    if (ch === '\\') {
      at += 1;
    } else if (ch === '{') {
      stack.push({ outer: count, sum: 0, comma: false, from: at + 1 });
      count = 1;
    } else if (ch === ',' && stack.length > 0) {
      const top = stack[stack.length - 1];
      top.sum = Math.min(top.sum + count, 1e12);
      top.comma = true;
      count = 1;
    } else if (ch === '}' && stack.length > 0) {
      const top = stack.pop();
      const range = top.comma ? 0 : rangeCount(pattern, top.from, at);
      const made = top.comma ? top.sum + count : range || count;
      count = Math.min(top.outer * made, 1e12);
    }
  }
  // A { with no } is text, so only the braces that closed multiply the count.
  while (stack.length > 0) {
    const top = stack.pop();
    count = Math.min(top.outer * Math.max(top.sum + count, 1), 1e12);
  }
  return count;
}

// GLUED is the second line of the deny for a glob part that has a / inside braces and 2 or more
// `*` in a path part: the guard cannot tell which folder the part scans.
const GLUED = 'Write each alternative as its own word, as `src/*a* lib/*b*`.';

// countStars reads the glob pattern and returns the most `*` that any path part has in any
// expansion of its braces, calling check(part, all, glued) after each `*`, `?` and `/`: part has
// the stars and wild (`*` and `?`) of the path part so far, all those of the pattern, and glued is
// true when the part follows a / inside braces. Each alternative of a pair of braces is counted
// from the text before the braces, and the pair counts as its largest alternative: `{*a,*b}*` has
// 2 `*` in a part, not 3. A { with no } is text. A / inside an alternative starts a path part.
function countStars(pattern, check) {
  const ends = new Map();
  const open = [];
  for (let at = 0; at < pattern.length; at += 1) {
    if (pattern[at] === '\\') at += 1;
    else if (pattern[at] === '{') open.push(at);
    else if (pattern[at] === '}' && open.length > 0) ends.set(open.pop(), at);
  }
  const most = (one, two) => ({ stars: Math.max(one.stars, two.stars),
    wild: Math.max(one.wild, two.wild), allStars: Math.max(one.allStars, two.allStars),
    allWild: Math.max(one.allWild, two.allWild), glued: one.glued || two.glued });
  let now = { stars: 0, wild: 0, allStars: 0, allWild: 0, glued: false };
  let peak = 0;
  const frames = [];
  const see = () => {
    peak = Math.max(peak, now.stars);
    check(now);
  };
  for (let at = 0; at < pattern.length; at += 1) {
    const ch = pattern[at];
    if (ch === '\\') {
      at += 1;
    } else if (ch === '{' && ends.has(at)) {
      frames.push({ end: ends.get(at), start: now, best: null });
    } else if (ch === ',' && frames.length > 0) {
      const top = frames[frames.length - 1];
      top.best = top.best === null ? now : most(top.best, now);
      now = top.start;
    } else if (ch === '}' && frames.length > 0 && frames[frames.length - 1].end === at) {
      const top = frames.pop();
      now = top.best === null ? now : most(top.best, now);
      see();
    } else if (ch === '/') {
      now = { ...now, stars: 0, wild: 0, glued: frames.length > 0 };
      see();
    } else if (ch === '*' || ch === '?') {
      now = { ...now, wild: now.wild + 1, allWild: now.allWild + 1,
        stars: now.stars + (ch === '*' ? 1 : 0), allStars: now.allStars + (ch === '*' ? 1 : 0) };
      see();
    }
  }
  return peak;
}

// checkGlob throws Over for a glob pattern that has an extended glob, or has more `*` and `?`
// than the limits allow, counted for each expansion of its braces, or has a part with a / inside
// braces and 2 or more `*`, which the work estimate cannot place. It reads each character once.
function checkGlob(pattern) {
  if (EXTGLOB.test(pattern)) {
    throw new Over('A glob of the command has a ( after *, ?, +, @ or !, which is an extended ' +
      'glob, and the guard expands none.');
  }
  countStars(pattern, (now) => {
    const limits = [[now.stars, MAX_STARS_PART, '*', 'in one path part'],
      [now.allStars, MAX_STARS, '*', 'in all'],
      [now.wild, MAX_WILD_PART, '* and ?', 'in one path part'],
      [now.allWild, MAX_WILD, '* and ?', 'in all']];
    for (const [count, most, what, where] of limits) {
      if (count > most) {
        throw new Over(`A glob of the command has more than ${most} ${what} ${where}, and the ` +
          `guard expands at most ${most}.`);
      }
    }
    if (now.glued && now.stars >= 2) throw new Over(GLUED);
  });
}

// overTime throws Over when the globs of a command have taken more than MAX_GLOB_MS.
function overTime(budget) {
  if (Date.now() - budget.start > MAX_GLOB_MS) {
    throw new Over(`The globs of the command take more than ${MAX_GLOB_MS} ms, and the guard ` +
      `waits at most ${MAX_GLOB_MS} ms.`);
  }
}

// isDirectory reports whether file is a folder, or a link to one.
function isDirectory(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

// namesOf returns the names in the folder dir, at most MAX_READ of them, without reading more.
function namesOf(dir, budget) {
  let names = budget.names.get(dir);
  if (names !== undefined) return names;
  names = [];
  let handle = null;
  try {
    handle = fs.opendirSync(dir);
    for (let one = handle.readSync(); one !== null && names.length < MAX_READ;
      one = handle.readSync()) {
      names.push(one.name);
    }
  } catch {
    // A folder that is not there, or cannot be read, has no names to match.
  } finally {
    if (handle !== null) {
      try {
        handle.closeSync();
      } catch {
        // The folder is closed or never opened.
      }
    }
  }
  budget.names.set(dir, names);
  return names;
}

// partStars returns the most `*` that the glob part text has in any expansion of its braces.
const partStars = (text) => countStars(text, () => {});

// narrow returns the Over error for the part last: what is what the part does.
const narrow = (last, what) => new Over(`Use a narrower glob: the part ${short(last)} of a glob ` +
  `of the command ${what}.`);

// foldersOf returns the full paths of the folders among matches, relative to cwd, all of them:
// a part scans the folders that the part before it matches, and files that sort before the
// folders must not hide them. It throws Over for more than MAX_SCAN_DIRS folders, and checks
// the time as it goes. matches has at most MAX_GLOB_MATCHES paths.
function foldersOf(matches, cwd, last, budget) {
  const dirs = [];
  for (let at = 0; at < matches.length; at += 1) {
    if (at % 256 === 0) overTime(budget);
    const full = path.resolve(cwd, matches[at]);
    if (!isDirectory(full)) continue;
    dirs.push(full);
    if (dirs.length > MAX_SCAN_DIRS) {
      throw narrow(last, `scans more than ${MAX_SCAN_DIRS.toLocaleString('en-US')} folders`);
    }
  }
  return dirs;
}

// scanWork throws Over when matching the path part last, against the names in the folders dirs,
// would take more than MAX_WORK_NS in one fs.globSync call. A part with fewer than 2 `*` costs
// ONE_NS for each name and ALT_NS for each alternative of its braces after the first; a part with
// more costs BASE_NS and a power of the length of the name, for each alternative.
function scanWork(last, dirs, budget) {
  const stars = partStars(last);
  const alternatives = Math.max(1, braces(last));
  const weight = NS_PER_UNIT[Math.min(stars, 3)];
  let ns = 0;
  let count = 0;
  for (const dir of dirs) {
    const names = namesOf(dir, budget);
    count += names.length;
    if (names.length >= MAX_READ) {
      throw narrow(last, `scans a folder of ${MAX_READ.toLocaleString('en-US')} names or more`);
    }
    if (stars >= 3 && count > MAX_STAR_ENTRIES) {
      throw narrow(last, `has ${stars} * and a folder of more than ` +
        `${MAX_STAR_ENTRIES.toLocaleString('en-US')} names`);
    }
    if (stars < 2) {
      ns += names.length * (ONE_NS + ALT_NS * (alternatives - 1));
    } else {
      let sum = 0;
      for (const name of names) sum += BASE_NS + weight * name.length ** stars;
      ns += sum * alternatives;
    }
    if (ns > MAX_WORK_NS) {
      throw narrow(last, `scans ${count.toLocaleString('en-US')} names or more with ${stars} * ` +
        `and ${alternatives.toLocaleString('en-US')} alternatives, more than the guard allows`);
    }
  }
}

// globbed returns the paths that pattern matches from cwd, then those that each folder part of
// pattern that has a glob character matches, so that a glob of a file that does not exist yet
// matches its folder. Each ** counts as *, as in bash without globstar, so that no pattern
// walks a whole tree. It throws the error of fs.globSync, and Over when pattern passes a limit
// before any scan, or when budget, which counts the work of all the globs of a command, has no
// call, match or time left. It checks the time before each folder part, so a long pattern ends
// at the limit.
function globbed(pattern, cwd, budget) {
  overTime(budget);
  if (pattern.length > MAX_GLOB_LENGTH) {
    const most = MAX_GLOB_LENGTH.toLocaleString('en-US');
    throw new Over(`A glob of the command has more than ${most} characters, and the guard ` +
      `expands at most ${most}.`);
  }
  const text = pattern.replace(/\*{2,}/g, '*');
  const parts = text.split('/');
  if (parts.filter((one) => GLOB.test(one)).length > MAX_GLOB_DEPTH) {
    throw new Over(`A glob of the command has more than ${MAX_GLOB_DEPTH} parts with a glob character, ` +
      `and the guard expands at most ${MAX_GLOB_DEPTH}.`);
  }
  checkGlob(text);
  // The start and end of each folder part, from the first with a glob character on: each prefix
  // is cut from the text once, and read for a glob character once.
  const spans = [];
  let end = -1;
  let wild = false;
  for (const one of parts) {
    end += one.length + 1;
    wild = wild || GLOB.test(one);
    if (wild) spans.push([end - one.length, end, one]);
  }
  // The prefixes run from the shortest, so that the folders that a part scans are the matches of
  // the prefix before it.
  const found = [];
  let before = null;
  for (const [start, stop, last] of spans) {
    overTime(budget);
    const part = text.slice(0, stop);
    let matched = budget.seen.get(part);
    if (matched === undefined) {
      if (budget.calls >= MAX_GLOB_CALLS) {
        throw new Over(`The command has more than ${MAX_GLOB_CALLS} different globs, and the guard ` +
          `expands at most ${MAX_GLOB_CALLS}.`);
      }
      budget.calls += 1;
      const made = braces(part);
      if (made > 1) budget.units += made * (/[*?[]/.test(part) ? WILDCARD_UNITS : 1);
      if (budget.units > MAX_GLOB_UNITS) {
        throw new Over(`The braces in the command make more than ${MAX_GLOB_UNITS.toLocaleString('en-US')} ` +
          `patterns, and the guard expands at most ${MAX_GLOB_UNITS.toLocaleString('en-US')}.`);
      }
      if (/[*?[]/.test(last)) {
        const dirs = before === null ? [path.resolve(cwd, text.slice(0, start) || '.')]
          : foldersOf(before, cwd, last, budget);
        scanWork(last, dirs, budget);
      }
      matched = fs.globSync(part, { cwd });
      budget.seen.set(part, matched);
      budget.matches += matched.length;
      if (budget.matches > MAX_GLOB_MATCHES) {
        throw new Over(`The globs of the command match more than ` +
          `${MAX_GLOB_MATCHES.toLocaleString('en-US')} paths, and the guard reads at most ` +
          `${MAX_GLOB_MATCHES.toLocaleString('en-US')}.`);
      }
    }
    found.push(matched);
    before = matched;
  }
  // The longest prefix first: its matches name the file that the glob reaches.
  return found.reverse().flat();
}

// short returns raw, cut to 60 characters, for a line of a deny.
const short = (raw) => (raw.length > 60 ? `${raw.slice(0, 59)}…` : raw);

// hidden returns the part of command that reaches .reports though its text does not contain
// .reports, as the second line of a deny, or null. A ~ at the start of a word reads as HOME,
// ~+ as cwd and ~- as OLDPWD. With globs false, it expands no glob.
function hidden(command, cwd, env, globs) {
  const budget = { calls: 0, matches: 0, units: 0, names: new Map(), seen: new Map(),
    start: Date.now() };
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
        return error.message;
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
    const state = { steps: MAX_STEPS, start: undefined };
    let reason = null;
    for (const [key, text] of strings(args)) {
      if (TEXT_KEYS.has(key)) continue;
      reason = reportsJson(text) ? WRITE_REASON : reportsOnDisk(text, from, state);
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
const FAILED_REASON = 'Send a smaller call: the guard failed on this call and blocks it.\n';

// safeDecide returns what decide returns for call, or, when decide throws in a run, a deny with
// FAILED_REASON and the error. The adapters call it, so that a call that the guard cannot read
// is blocked.
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

module.exports = { readInput, decide, safeDecide, runsChecks, withoutRedirect, reportsJson, flat,
  REPORTS, HIDDEN_REASON, WRITE_REASON, SHELL_REASON, PATH_REASON, LOOP_REASON, FAILED_REASON,
  SPECIAL_REASON };
