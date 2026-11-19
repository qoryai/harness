// The part of the guard of .reports/*.json that the adapters for Gemini CLI, Cursor and
// Copilot CLI share. Only checks.cjs writes the JSON files under .reports/ of the artifact
// folder: the report checks, the start counts and the count of failed end checks. On Claude
// Code and Codex, tool-guard.cjs runs decide for each call; the other runtimes run
// reports-guard-<runtime>.cjs before each tool call.
//
// In a run, when QORY_RUN_ID is set, decide denies:
// - a write, edit or delete of a file whose path is under a folder .reports and ends in
//   .json, or whose name has .json.lock: the locks of checks.cjs starts and report
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
// times its alternatives (250 ms of estimate for one call, 83,334 names read at most). A glob
// with braces that can put two * side by side (`*{*,}`) is denied, because fs.globSync expands
// the braces and reads the ** as a globstar; a glob with a / inside braces is expanded by the
// guard, and each word is scanned in the folders that it reaches. A glob with a backslash and a
// * ? or [ is denied (a word of braces only never reaches fs.globSync): fs.globSync reads a
// backslash as a path separator, and a globstar
// after it walks the whole disk. The count of braces is the larger of two readings, as
// minimatch reads them, and every word that braces make is matched against .reports.
// The calls of fs.globSync of one command, for the words with a * ? or [ that pass these
// checks, run in a child process that spawnSync kills with SIGKILL after 2.5 s in all. The
// kill, a failure of the child and bad output of the child deny the call. A hook has 10 s: the
// children of one hook process share one deadline of 2.5 s (Copilot CLI calls the guard for
// each string argument of a typing tool). The checks of a word with a wildcard run inside the
// child, as do 250 ms of estimate for each call and 600 ms in all, checked between the calls.
// From 8 s after the start of the hook process, safeDecide denies each call without reading it,
// so that in-process work for many arguments ends before the 10 s of the hook. Deadlines and
// budgets use performance.now(), which a step of the system clock does not change. A hook
// process also denies the call that takes its size past 8 MiB, before it reads any text: the
// size is the length of each string, the length of each key plus 16 for each entry of an object,
// 8 for each item of an array, and the length of cwd, a measure of the work and not an exact
// count. In a run, the adapters deny an input of more than 16 MiB on stdin before they parse it,
// and an input that is not a JSON object. The clock is read once for each call. A backslash at
// the end of a word or command is dropped by the shell: .reports\ is .reports.
// QORY_REPORTS_GUARD_TEST (globMs, stall, fail) can only lower the limit of the child or deny
// a call: a file of the workspace can reach the environment of a hook, so no field turns off a
// check, and the options noCaps and waitMs belong to decide, which the adapters call with fixed
// fields.
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

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

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
// A \ at the end of the command or word is dropped by the shell, so `.reports\` is .reports.
const REPORTS = /\.reports(?:[/\s'"`;|&)]|\\?$)/iu;
// A part of a shell command that runs a second command or redirects one.
const CONTROL = /[;&|<>`\n\r]|\$\(/;

// The first line of each deny starts with what to do and has at most 100 characters.
const WRITE_REASON = 'Write no file under .reports/ that ends in .json or has .json.lock in ' +
  'its name.\nOnly checks.cjs writes these files, which contain the report checks, the ' +
  'counts of the run and the locks of the counts.';
// The first line of a deny for a command whose first word is a device, a pipe or a socket; the
// second line contains that word.
const SPECIAL_REASON = 'Start the command with a program or a script, not a device, pipe or socket.\n';
const SHELL_REASON = 'Write to .reports/ only through checks.cjs.\nOnly ' +
  'checks.cjs writes the .json files there, which contain the report checks and the counts.';
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

// bracesText returns how many patterns pattern makes by brace expansion, counting a `{` with no
// `}` as a group: the sum of the alternatives of each {a,b}, the size of each range {1..9}, and
// the product of braces side by side or inside one another, clamped at 1e12. It reads each
// character once.
function bracesText(pattern) {
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

// countStars reads the glob pattern and returns the most `*` that any path part has in any
// expansion of its braces, calling check(now) after each `*`, `?` and `/`: now has the stars and
// wild (`*` and `?`) of the path part so far, and allStars and allWild of the pattern. Each
// alternative of a pair of braces is counted
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
    allWild: Math.max(one.allWild, two.allWild) });
  let now = { stars: 0, wild: 0, allStars: 0, allWild: 0 };
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
      now = { ...now, stars: 0, wild: 0 };
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
// than the limits allow, counted for each expansion of its braces, or has braces that can put
// two `*` side by side, which fs.globSync reads as a globstar. It reads each character once.
function checkGlob(pattern) {
  if (EXTGLOB.test(pattern)) {
    throw new Over('A glob of the command has a ( after *, ?, +, @ or !, which is an extended ' +
      'glob, and the guard expands none.');
  }
  if (starsMeet(pattern)) {
    throw new Over('A glob of the command has a brace that can put two * side by side, as in ' +
      '`*{*,}`, which fs.globSync reads as ** and the guard expands none.');
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
  });
}

// clock returns milliseconds from a monotonic clock, as the budgets and the deadline need: a step
// of the system clock changes neither. Deadlines and budgets are on this clock.
function clock() {
  return performance.now();
}

// overTime throws Over when the globs of a command have taken more than MAX_GLOB_MS, or
// budget.hooks.waitMs, an option of decide for checks of the guard that no adapter sets.
function overTime(budget) {
  const limit = budget.hooks.waitMs > 0 ? budget.hooks.waitMs : MAX_GLOB_MS;
  if (clock() - budget.start > limit) {
    throw new Over(`The globs of the command take more than ${limit} ms, and the guard ` +
      `waits at most ${limit} ms.`);
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

// parseBraces returns the groups of braces in pattern as a list of items, read as bash and
// minimatch read them: a character is {lit, star}, where lit is the character, or `\x` for an
// escape, and star is true for an unescaped `*`; a group is {alts}, a list of item lists, one for
// each word between the commas of a pair of braces (`{a,b}`) or for each word of the range of a
// pair (`{1..3}`, `{a..e..2}`, as {range}); and the braces of a pair with no comma and no range
// are {wrap}, text around the items of their content, as `{a}`; when the content makes more than
// one word, minimatch reads each word w as the braces `{w}` again, a range or a list of words. A `{` with no `}`, a `}` with no `{`, and
// a `{` after `$` are text, written `?` so that no pattern reads them as braces. When a pair has no comma and a `,` and a `}`
// follow it, its `}` is text and the group goes on to the next `}`, as `{}2,}` does in bash. It
// throws Over for groups nested more than MAX_NESTED deep.
const MAX_EXPANDED = 4096;
const MAX_NESTED = 32;
const RANGE = /^(?:-?\d+\.\.-?\d+|[A-Za-z]\.\.[A-Za-z])(?:\.\.-?\d+)?$/;
const tooMany = () => new Over(`The braces in the command make more than ${MAX_EXPANDED.toLocaleString('en-US')} ` +
  `patterns, and the guard expands at most ${MAX_EXPANDED.toLocaleString('en-US')}.`);

// rangeWords returns the words of the range text, as `1..3`, `01..10..3` or `a..e`, in bash's
// order. It throws Over for more than MAX_EXPANDED words.
function rangeWords(text) {
  const number = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(text);
  const [, low, high, by] = number || /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/.exec(text);
  const start = number ? bigOf(low) : BigInt(low.charCodeAt(0));
  const stop = number ? bigOf(high) : BigInt(high.charCodeAt(0));
  let step = by === undefined ? 1n : bigOf(by);
  if (start === null || stop === null || step === null) throw tooMany();
  if (step < 0n) step = -step;
  if (step === 0n) step = 1n;
  const width = number && (/^-?0\d/.test(low) || /^-?0\d/.test(high))
    ? Math.max(low.replace('-', '').length, high.replace('-', '').length) : 0;
  const words = [];
  const up = stop >= start;
  for (let at = start; up ? at <= stop : at >= stop; at += up ? step : -step) {
    if (words.length >= MAX_EXPANDED) throw tooMany();
    if (!number) words.push(String.fromCharCode(Number(at)));
    else words.push(`${at < 0n ? '-' : ''}${(at < 0n ? -at : at).toString().padStart(width, '0')}`);
  }
  return words;
}

// parseBraces returns the items of pattern, read once for each text: the last 64 are kept.
const parsed = new Map();
function parseBraces(pattern) {
  let items = parsed.get(pattern);
  if (items === undefined) {
    items = parseOnce(pattern);
    if (parsed.size >= 64) parsed.clear();
    parsed.set(pattern, items);
  }
  return items;
}
function parseOnce(pattern) {
  // The commas that no backslash escapes, up to each index, the first comma at or after each
  // index that no comma follows (the `,(?!,)` of the group that has a `}` after it), and the
  // last `}` up to each index: closeOf reads them once for each candidate, so that a word of
  // thousands of braces takes time in the square of its length at most.
  const length = pattern.length;
  const commas = new Int32Array(length + 1);
  const lastClose = new Int32Array(length + 1).fill(-1);
  const nextComma = new Int32Array(length + 2).fill(-1);
  for (let at = 0; at < length; at += 1) {
    commas[at + 1] = commas[at];
    lastClose[at + 1] = lastClose[at];
    if (pattern[at] === '\\') {
      at += 1;
      commas[at + 1] = commas[at];
      lastClose[at + 1] = lastClose[at];
    } else if (pattern[at] === ',') {
      commas[at + 1] += 1;
    } else if (pattern[at] === '}') {
      lastClose[at + 1] = at;
    }
  }
  for (let at = length - 1; at >= 0; at -= 1) {
    nextComma[at] = pattern[at] === ',' && pattern[at + 1] !== ',' ? at : nextComma[at + 1];
  }
  // closeOf returns the index of the } that closes the { at open, before to, or -1.
  const closeOf = (open, to) => {
    let depth = 1;
    for (let at = open + 1; at < to; at += 1) {
      if (pattern[at] === '\\') {
        at += 1;
      } else if (pattern[at] === '{') {
        depth += 1;
      } else if (pattern[at] === '}') {
        depth -= 1;
        if (depth > 0) continue;
        const comma = commas[at] - commas[open + 1] > 0;
        const range = at - open < 80
          && /^(-?\d+\.\.-?\d+|[A-Za-z]\.\.[A-Za-z])(\.\.-?\d+)?$/.test(pattern.slice(open + 1, at));
        const next = nextComma[at + 1];
        const quirk = next !== -1 && lastClose[to] > next;
        if (comma || range || !quirk) return at;
        depth = 1;
      }
    }
    return -1;
  };
  const read = (from, to, depth) => {
    if (depth > MAX_NESTED) {
      throw new Over(`The braces in the command are nested more than ${MAX_NESTED} deep, and the ` +
        `guard expands at most ${MAX_NESTED}.`);
    }
    const items = [];
    for (let at = from; at < to; at += 1) {
      const ch = pattern[at];
      const close = ch === '{' && pattern[at - 1] !== '$' ? closeOf(at, to) : -1;
      if (ch === '\\') {
        items.push({ lit: pattern.slice(at, at + 2), star: false });
        at += 1;
      } else if (close < 0) {
        items.push({ lit: ch === '{' || ch === '}' ? '?' : ch, star: ch === '*' });
      } else {
        const pieces = [];
        let begin = at + 1;
        let nest = 0;
        for (let scan = at + 1; scan < close; scan += 1) {
          if (pattern[scan] === '\\') scan += 1;
          else if (pattern[scan] === '{') nest += 1;
          else if (pattern[scan] === '}' && nest > 0) nest -= 1;
          else if (pattern[scan] === ',' && nest === 0) {
            pieces.push([begin, scan]);
            begin = scan + 1;
          }
        }
        const text = pattern.slice(at + 1, close);
        const range = pieces.length === 0 && RANGE.test(text) ? text : null;
        if (pieces.length > 0) {
          pieces.push([begin, close]);
          items.push({ alts: pieces.map(([one, two]) => read(one, two, depth + 1)) });
        } else if (range !== null) {
          items.push({ range });
        } else {
          items.push({ wrap: read(at + 1, close, depth + 1) });
        }
        at = close;
      }
    }
    return items;
  };
  // minimatch reads a `{}` at the start of the whole pattern as text, as `find -exec {}` needs.
  if (pattern.startsWith('{}')) {
    return [{ lit: '?', star: false }, { lit: '?', star: false }, ...read(2, pattern.length, 0)];
  }
  return read(0, pattern.length, 0);
}

// starsMeet returns true when some expansion of the braces of pattern has two `*` side by side,
// as `*{*,}` does (`**` and `*`). The guard reads `**` as `*`, as bash does without globstar,
// but fs.globSync expands the braces itself and then reads a path part `**` as a globstar that
// walks a whole tree, and the call cannot be stopped. It reads the items of parseBraces with a
// triple for each sequence: nullable (it can be empty), first and last (it can start, or end,
// with a `*`).
function starsMeet(pattern) {
  const sequence = (items) => {
    let seq = { nullable: true, first: false, last: false };
    for (const item of items) {
      let one = { nullable: false, first: item.star === true, last: item.star === true };
      if (item.alts !== undefined) {
        const alts = item.alts.map(sequence);
        if (alts.some((alt) => alt === null)) return null;
        one = { nullable: alts.some((alt) => alt.nullable), first: alts.some((alt) => alt.first),
          last: alts.some((alt) => alt.last) };
      }
      if (seq.last && one.first) return null;
      seq = { nullable: seq.nullable && one.nullable, first: seq.first || (seq.nullable && one.first),
        last: one.last || (one.nullable && seq.last) };
    }
    return seq;
  };
  return sequence(parseBraces(pattern)) === null;
}

// expandBraces returns the words that bash makes of the braces in pattern, in which a `{` or a `}`
// that bash reads as text is written `?`, so that fs.globSync expands no braces of them. A word
// that is empty is dropped, as bash drops it, unless keepEmpty is true. It throws Over for more
// than MAX_EXPANDED words.
function expandBraces(pattern, keepEmpty = false) {
  return wordsOf(parseBraces(pattern)).filter((one) => keepEmpty || one !== '');
}

// wordsOf returns the words that the items of parseBraces make. It throws Over for more than
// MAX_EXPANDED words.
function wordsOf(items) {
  let made = [''];
  for (const item of items) {
    let next;
    if (item.alts !== undefined) next = item.alts.flatMap(wordsOf);
    else if (item.range !== undefined) next = rangeWords(item.range);
    else if (item.wrap !== undefined) next = wrapWords(wordsOf(item.wrap));
    else next = [item.lit];
    if (made.length * next.length > MAX_EXPANDED) throw tooMany();
    made = made.flatMap((one) => next.map((two) => one + two));
  }
  return made;
}

// wrapWords returns the words of a pair of braces with no comma and no range, from the words of
// its content: a single word w is text, `?w?`; with more, minimatch reads each word w as `{w}`
// again, so that w makes the words of a range, or the words between its commas, or `?w?`.
function wrapWords(content) {
  if (content.length === 1) return [`?${content[0]}?`];
  return content.flatMap((word) => {
    if (RANGE.test(word)) return rangeWords(word);
    return word.includes(',') ? word.split(',') : [`?${word}?`];
  });
}

// braces returns how many patterns pattern makes by brace expansion, without making them: the
// most of what bracesText counts and of what the items of parseBraces make, which is the way that
// expandBraces reads the braces, clamped at 1e12. fs.globSync reads braces as minimatch does and
// parseBraces reads them the same way, but a count below the one of minimatch lets a command
// make more words than the caps allow; the larger of the two counts is the cap.
function braces(pattern) {
  const count = (items) => {
    let made = 1;
    for (const item of items) {
      let one = 1;
      if (item.alts !== undefined) one = item.alts.reduce((sum, alt) => Math.min(sum + count(alt), 1e12), 0);
      else if (item.range !== undefined) one = rangeCount(item.range, 0, item.range.length) || 1;
      else if (item.wrap !== undefined) one = wrapCount(item.wrap);
      made = Math.min(made * one, 1e12);
    }
    return made;
  };
  // The braces of a pair with no comma and no range make the words of their content, or, when
  // that is more than one word, the words that minimatch makes of each: the content is made in
  // full when it has at most MAX_EXPANDED words, and counts as HUGE when it has more.
  const wrapCount = (items) => {
    const inner = count(items);
    if (inner === 1) return 1;
    if (inner > MAX_EXPANDED) return HUGE;
    try {
      return wrapWords(wordsOf(items)).length;
    } catch (error) {
      if (error instanceof Over) return HUGE;
      throw error;
    }
  };
  return Math.max(bracesText(pattern), count(parseBraces(pattern)));
}

// slashInBraces returns true when pattern has a / inside a pair of braces, or after a { that has
// no }, which makes the path parts that the guard reads differ from those of the expansions.
function slashInBraces(pattern) {
  let depth = 0;
  for (let at = 0; at < pattern.length; at += 1) {
    const ch = pattern[at];
    if (ch === '\\') at += 1;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && depth > 0) depth -= 1;
    else if (ch === '/' && depth > 0) return true;
  }
  return false;
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

// scanParts returns the paths that text, a pattern with no group of braces, matches from cwd,
// then those that each folder part of text that has a glob character matches, so that a glob of a
// file that does not exist yet matches its folder, longest first. It throws what globbed throws.
function scanParts(text, cwd, budget) {
  const parts = text.split('/');
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
      if (budget.units > MAX_GLOB_UNITS) throw unitsOver();
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

// unitsOver returns the Over error for more braces than the guard expands.
const unitsOver = () => new Over(`The braces in the command make more than ` +
  `${MAX_GLOB_UNITS.toLocaleString('en-US')} patterns, and the guard expands at most ` +
  `${MAX_GLOB_UNITS.toLocaleString('en-US')}.`);

// startsEmpty returns true when the first path part of pattern, the text before its first / that
// is outside braces, has braces and can be empty, as `{*,}` in `{*,}/*`: the word then makes a
// relative path and an absolute one.
function startsEmpty(pattern) {
  let depth = 0;
  for (let at = 0; at < pattern.length; at += 1) {
    const ch = pattern[at];
    if (ch === '\\') at += 1;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && depth > 0) depth -= 1;
    else if (ch === '/' && depth === 0) {
      const first = pattern.slice(0, at);
      return first.includes('{') && expandBraces(first, true).includes('');
    }
  }
  return false;
}

// globbed returns the paths that pattern matches from cwd, then those that each folder part of
// pattern that has a glob character matches, so that a glob of a file that does not exist yet
// matches its folder, and the words that its braces make, as text, when one of them is
// .reports: `.{rep,x}orts` makes .reports where no such folder is. Each ** counts as *, as in
// bash without globstar, so that no pattern walks a whole tree; braces that can make ** from
// two * are denied (checkGlob), and so is a backslash in a glob, which fs.globSync reads as a
// path separator and a globstar after it walks the whole disk. A pattern with a / inside braces,
// or a first part that can be empty, has path parts that differ between its expansions: the
// guard expands the braces, and scans each word as a pattern, so that fs.globSync expands no
// braces of it. A pattern with no `*`, `?` or `[` is not scanned. It throws the error of
// fs.globSync, and Over when pattern passes a limit before any scan, or when budget, which counts
// the calls, matches and time of all the globs of a command, has none left. It checks the time
// before each folder part, so a long pattern ends at the limit. budget.hooks.noCaps, an option of decide that no adapter sets and no
// environment variable or file can set, turns off the checks of backslashes and braces, so that the limit of the child process decides.
function globbed(pattern, cwd, budget) {
  overTime(budget);
  if (pattern.length > MAX_GLOB_LENGTH) {
    const most = MAX_GLOB_LENGTH.toLocaleString('en-US');
    throw new Over(`A glob of the command has more than ${most} characters, and the guard ` +
      `expands at most ${most}.`);
  }
  const caps = budget.hooks.noCaps !== true;
  if (caps && pattern.includes('\\') && /[*?[]/.test(pattern)) {
    throw new Over(`Remove the backslash before the glob character, or write the path without a ` +
      `glob: the glob ${short(pattern)} has a backslash, which fs.globSync reads as a path separator.`);
  }
  const text = pattern.replace(/\*{2,}/g, '*');
  const wild = /[*?[]/.test(text);
  const slashed = caps && (slashInBraces(text) || startsEmpty(text));
  if (!slashed && text.split('/').filter((one) => GLOB.test(one)).length > MAX_GLOB_DEPTH) {
    throw new Over(`A glob of the command has more than ${MAX_GLOB_DEPTH} parts with a glob character, ` +
      `and the guard expands at most ${MAX_GLOB_DEPTH}.`);
  }
  checkGlob(text);
  const made = caps ? braces(text) : 1;
  if (made * (wild ? WILDCARD_UNITS : 1) > MAX_GLOB_UNITS && made > 1) throw unitsOver();
  const words = made > 1 || slashed ? expandBraces(text) : [text];
  const found = words.length > 1 || slashed ? words.filter((word) => REPORTS.test(word)) : [];
  if (!wild) {
    if (made > 1) budget.units += made;
    if (budget.units > MAX_GLOB_UNITS) throw unitsOver();
    return found;
  }
  if (!slashed) return found.concat(scanParts(text, cwd, budget));
  budget.units += made * WILDCARD_UNITS;
  if (budget.units > MAX_GLOB_UNITS) throw unitsOver();
  for (const word of words) {
    overTime(budget);
    if (!/[*?[]/.test(word)) continue;
    if (word.split('/').filter((one) => GLOB.test(one)).length > MAX_GLOB_DEPTH) {
      throw new Over(`A glob of the command has more than ${MAX_GLOB_DEPTH} parts with a glob ` +
        `character, and the guard expands at most ${MAX_GLOB_DEPTH}.`);
    }
    found.push(...scanParts(word, cwd, budget));
  }
  return found;
}

// short returns raw, cut to 60 characters, for a line of a deny.
const short = (raw) => (raw.length > 60 ? `${raw.slice(0, 59)}…` : raw);

// The limit of the child process that runs the fs.globSync calls of one command: no check of
// the input can promise that a call that cannot be stopped returns, so the guard stops it. The
// hook has 10 s on Cursor, Copilot CLI and Gemini CLI.
const GLOB_CHILD_MS = 2500;
const CHILD = 'const g = require(process.argv[1]);' +
  "const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));" +
  'process.stdout.write(JSON.stringify({ deny: g.globsChild(input) }));';

// guardHooks returns the hooks for checks of the guard, from QORY_REPORTS_GUARD_TEST, a JSON
// object. A file of the workspace can reach the environment of a hook (Gemini CLI loads .env),
// so each field can only lower the limit or deny a call, and no other field is read:
// globMs, a limit for the child lower than GLOB_CHILD_MS; stall, a text that makes the child of
// a command with it in a glob never return; and fail, which makes the child exit with 3, print
// text that is no JSON, print a deny that is no text, or print 2 MiB.
function guardHooks() {
  let read = {};
  try {
    read = JSON.parse(process.env.QORY_REPORTS_GUARD_TEST || '{}');
  } catch {
    return {};
  }
  if (read === null || typeof read !== 'object') return {};
  const hooks = {};
  if (typeof read.globMs === 'number') hooks.globMs = read.globMs;
  if (typeof read.stall === 'string') hooks.stall = read.stall;
  if (typeof read.fail === 'string') hooks.fail = read.fail;
  return hooks;
}

// globsHidden returns the second line of the deny for the first of the glob words in list, each
// { raw, value }, that reaches .reports from cwd, or null. It throws what fs.globSync throws for
// no word: a word that it cannot expand is a deny.
function globsHidden(list, cwd, hooks) {
  const budget = { calls: 0, matches: 0, units: 0, names: new Map(), seen: new Map(),
    start: clock(), hooks };
  // The globs that match nothing under .reports: a word that repeats one costs no more work.
  const clean = new Set();
  for (const { raw, value } of list) {
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
  return null;
}

// globsChild is what the child process runs: input is { list, cwd, hooks }.
function globsChild({ list, cwd, hooks }) {
  if (typeof hooks.stall === 'string' && list.some(({ value }) => value.includes(hooks.stall))) {
    for (;;);
  }
  if (hooks.fail === 'exit') process.exit(3);
  if (hooks.fail === 'garbage') {
    process.stdout.write('not json');
    process.exit(0);
  }
  if (hooks.fail === 'type') {
    process.stdout.write('{"deny":["x"]}');
    process.exit(0);
  }
  if (hooks.fail === 'big') {
    process.stdout.write(JSON.stringify({ deny: 'x'.repeat(2 << 20) }));
    process.exit(0);
  }
  return globsHidden(list, cwd, hooks);
}

// globsInChild runs globsHidden for list in a child process, which spawnSync kills after
// GLOB_CHILD_MS: a call of fs.globSync that does not return, a crash, and an output that is not
// { deny: string or null } of at most 1 MiB each deny the call.
function globsInChild(list, cwd, noCaps, waitMs, deadline) {
  const hooks = { ...guardHooks(), noCaps, waitMs };
  const total = Math.min(GLOB_CHILD_MS, hooks.globMs > 0 ? hooks.globMs : GLOB_CHILD_MS);
  const failed = `Use a narrower glob: the globs of the command did not finish in ` +
    `${total.toLocaleString('en-US')} ms, or could not run, and the guard blocks the call.`;
  // The children of all the calls of one hook process share one deadline: each has the time
  // that is left, and none starts when there is none.
  const left = deadline === undefined ? total : Math.min(total, deadline - clock());
  if (!(left >= 1)) return failed;
  const limit = Math.ceil(left);
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  let ran;
  try {
    ran = childProcess.spawnSync(process.execPath, ['--max-old-space-size=256', '-e', CHILD,
      __filename], { input: JSON.stringify({ list, cwd, hooks }), encoding: 'utf8', env,
      timeout: limit, killSignal: 'SIGKILL', maxBuffer: 1 << 20, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    return failed;
  }
  if (ran.error !== undefined || ran.status !== 0 || typeof ran.stdout !== 'string') return failed;
  let out;
  try {
    out = JSON.parse(ran.stdout);
  } catch {
    return failed;
  }
  if (out === null || typeof out !== 'object'
    || (out.deny !== null && typeof out.deny !== 'string')) return failed;
  return out.deny;
}

// hidden returns the part of command that reaches .reports though its text does not contain
// .reports, as the second line of a deny, or null. A ~ at the start of a word reads as HOME,
// ~+ as cwd and ~- as OLDPWD. With globs false, it expands no glob. A glob word with a `*`, `?`
// or `[` is expanded by fs.globSync in a child process, unless inline is true; one with only
// braces is read as text, in this process. inline and noCaps (no early deny of backslashes and
// braces, so that only the limit of the child decides) and waitMs (the 600 ms in all) are
// options of decide for checks of the guard: the adapters build their call from fixed fields and
// set none of them.
function hidden(command, cwd, env, globs, inline, noCaps, waitMs, deadline) {
  const pending = [];
  const textual = [];
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
    (/[*?[]/.test(value) ? pending : textual).push({ raw, value });
  }
  const text = globsHidden(textual, cwd, { ...guardHooks(), noCaps, waitMs });
  if (text !== null) return text;
  const built = BUILT.exec(command);
  if (built !== null && DOT_R.test(command)) {
    const sign = { $: '$', '`': 'a backtick' }[built[0]] || 'eval';
    return `The command has ${sign} and .r, which can build the name .reports.`;
  }
  if (pending.length === 0) return null;
  return inline ? globsHidden(pending, cwd, { ...guardHooks(), noCaps, waitMs }) : globsInChild(pending, cwd, noCaps, waitMs, deadline);
}

// decide returns the reason to deny a call, or null to let it run. kind is 'write' for a tool
// that writes, edits or deletes a file, with its arguments args; 'shell' for a shell command,
// with args.command; and anything else for a tool that the guard lets run. cwd is the working
// folder of the shell command, from the hook's input, from which a glob in it expands; with
// no cwd, or one that does not exist, a glob expands from the working folder of the hook.
// With globs false, decide expands no glob: fs.globSync has no limit on its work, so
// tool-guard.cjs, which bounds the work of each call, matches globs itself.
function decide({ kind, args, env = process.env, script = process.argv[1], cwd,
  globs = true, inline = false, noCaps = false, waitMs = 0, deadline }) {
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
    const part = hidden(command, from, env, globs, inline, noCaps, waitMs, deadline);
    return part === null ? null : HIDDEN_REASON + part;
  }
  return null;
}

// The deny of a call that made decide throw. The second line has the error.
const FAILED_REASON = 'Send a smaller call: the guard failed on this call and blocks it.\n';

// safeDecide returns what decide returns for call, or, when decide throws in a run, a deny with
// FAILED_REASON and the error. The adapters call it, so that a call that the guard cannot read
// is blocked.
// HOOK_MS is the time from the start of a hook process after which safeDecide denies a call
// before it reads it: the hook has 10 s, and the adapter of Copilot CLI calls safeDecide once
// for each string argument of a typing tool, with in-process work for each that no child bounds.
const HOOK_MS = 8000;
// HOOK_CHARS is the number of characters of text, in all the strings of all the calls of one hook
// process, over which safeDecide denies the call that crosses it: one call of 55 MB or more ran
// past the 10 s of the hook although the time was read before the call.
const HOOK_CHARS = 8 * 1024 * 1024;
const SEND_LESS = 'Send fewer or smaller arguments in one tool call.\n';
const TIME_REASON = `${SEND_LESS}The guard of .reports/ used more than 8 seconds of the 10 seconds ` +
  'of its hook, and blocks the call.';
const SIZE_REASON = `${SEND_LESS}The arguments of this call are more than 8 MiB of text, and the ` +
  'guard of .reports/ does not read that much in the 10 seconds of its hook, so it blocks the call.';
let hookChars = 0;

// The stdin of a hook in a run is denied before it is parsed when it is over INPUT_BYTES.
// shortcut: the whole of stdin is read before the length is compared, so an input of several
// GB still uses that memory, replace with a read that stops at INPUT_BYTES + 1 if a runtime
// sends such an input.
const INPUT_BYTES = 16 * 1024 * 1024;
const UNREADABLE_REASON = 'Send the call again.\n' +
  'The guard of .reports/ could not read the input of this call, and blocks it.';

// readStdin returns { text, reason } for the stdin of a hook: the text, or, in a run (QORY_RUN_ID
// is set) with an input of more than INPUT_BYTES bytes, no text and the reason SIZE_REASON, so
// that the caller denies the call before it parses or resolves a path from the input. Outside
// a run, any size is read. A stdin that cannot be read gives the text ''.
function readStdin(env = process.env) {
  let data;
  try {
    data = fs.readFileSync(0);
  } catch {
    return { text: '', reason: null };
  }
  if (env.QORY_RUN_ID && data.length > INPUT_BYTES) return { text: '', reason: SIZE_REASON };
  return { text: data.toString('utf8'), reason: null };
}

// readGuardInput returns { input, reason } for the adapters: input is the JSON object on stdin,
// or {} when there is none. In a run, reason is SIZE_REASON for an input over the limit and
// UNREADABLE_REASON for stdin that is not a JSON object, and the adapter denies the call with
// it. Outside a run, reason is null and an input that cannot be read is {}.
function readGuardInput(env = process.env) {
  const { text, reason } = readStdin(env);
  if (reason) return { input: {}, reason };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return { input: data, reason: null };
  }
  return { input: {}, reason: env.QORY_RUN_ID ? UNREADABLE_REASON : null };
}

// textChars returns the size of value for the limit HOOK_CHARS, from lengths only, with no scan
// of any text: the length of each string, the length of each key of an object plus 16 for the
// entry, and 8 for each item of an array, whatever the item is (the guard walks the keys and
// the items too, and 4,000,000 entries of `"<base36>":""` took 9.4 s). It walks arrays and
// objects in a loop, with no recursion, so no depth overflows the stack. The sum is a measure of
// the work, not an exact count of characters.
// shortcut: the costs 16 and 8 come from timings on one machine (4,000,000 entries took 9.4 s), not
// from a model of the walk; replace them with a measured time for each entry if the limit moves.
const ENTRY_COST = 16;
const ITEM_COST = 8;
function textChars(value) {
  let chars = 0;
  const stack = [value];
  while (stack.length > 0) {
    const one = stack.pop();
    if (typeof one === 'string') {
      chars += one.length;
    } else if (Array.isArray(one)) {
      chars += ITEM_COST * one.length;
      for (const item of one) {
        if (typeof item === 'string') chars += item.length;
        else if (item !== null && typeof item === 'object') stack.push(item);
      }
    } else if (one !== null && typeof one === 'object') {
      for (const key of Object.keys(one)) {
        chars += key.length + ENTRY_COST;
        const item = one[key];
        if (typeof item === 'string') chars += item.length;
        else if (item !== null && typeof item === 'object') stack.push(item);
      }
    }
  }
  return chars;
}

let hookEnd;
function safeDecide(call) {
  const env = call.env || process.env;
  const run = Boolean(env.QORY_RUN_ID);
  try {
    if (run) {
      if (clock() > HOOK_MS) return TIME_REASON;
      // cwd counts too: the guard reads it as a path. A throw here denies the call.
      hookChars += textChars(call.args) + textChars(call.cwd);
      if (hookChars > HOOK_CHARS) return SIZE_REASON;
    }
    // An adapter may call safeDecide for each text of one tool call: all the children of that
    // hook process share the deadline of the first call, GLOB_CHILD_MS after it.
    if (hookEnd === undefined) hookEnd = clock() + GLOB_CHILD_MS;
    return decide({ ...call, deadline: hookEnd });
  } catch (error) {
    return run
      ? `${FAILED_REASON}The guard of .reports/ stopped on this call: ${String(error).slice(0, 200)}`
      : null;
  }
}

module.exports = { readStdin, readGuardInput, SIZE_REASON, decide, safeDecide, globsChild, braces, runsChecks, withoutRedirect, reportsJson, flat,
  REPORTS, HIDDEN_REASON, WRITE_REASON, SHELL_REASON, PATH_REASON, LOOP_REASON, FAILED_REASON,
  SPECIAL_REASON };
