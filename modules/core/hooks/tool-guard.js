// The guard of a run's tool calls that the adapters for Claude Code and Codex share. Each
// runtime runs tool-guard-<runtime>.js before each tool call, and at each step of an agent
// for the step limit of step-limit.js. Only in a run, when QORY_RUN_ID is set, decide denies:
// - an agent started in the background, on Claude Code: an Agent or Task call with
//   run_in_background true. Codex starts every agent with spawn_agent, which returns at
//   once and has no such key, so decide lets spawn_agent run;
// - a write to a path under .qory/build/, where checks.js keeps the build ledger and
//   step-limit.js the step counts, and a chmod, chown, chgrp or chflags of .qory/ or a
//   folder above it;
// - a write to a path that the lock lists, as checks.js lock --verify reads the lock;
// - a write below $QORY_HARNESS_HOME when it lies below the working folder, where the step
//   limit reads the tools of each agent;
// - a write from the main session, a call whose input has no agent_id, outside the
//   artifact folder. Both runtimes set agent_id only in a call of an agent that the session
//   started.
// A write is a call of Write, Edit, MultiEdit or NotebookEdit, or a Codex apply_patch, with
// the paths of its file_path, notebook_path or patch; or a shell command whose text contains
// the path and writes, as WRITERS reads it. decide reads a shell command as text and runs no
// shell, so a write whose path the text does not contain, as in `D=lock; echo x > ${D}ed/f`,
// passes; lock --verify and the push check keep the lock for that write. No rule covers
// qory.yaml, .qory/ outside .qory/build/ and the harness home, the hooks or the modules
// outside a harness home below the working folder: agents may change them.
//
// The adapter lies at <home>/hooks/, and checks.js at
// <home>/modules/core/skills/running-a-workflow/checks.js, as end-gate.js lists.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { folder } = require('./end-gate.js');
const steps = require('./step-limit.js');

// The tools that write files, with the keys of their input that contain a path.
const WRITE_TOOLS = { Write: ['file_path'], Edit: ['file_path'], MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'] };
// The tools that start an agent on Claude Code.
const AGENT_TOOLS = new Set(['Agent', 'Task']);
// A line of a Codex patch that names a file it adds, changes, deletes or moves to.
const PATCH_FILE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
// The folder of the build ledger and the step counts, below the working folder.
const BUILD = path.join('.qory', 'build');
// The first line of a Codex patch, which apply_patch also takes through the shell.
const PATCH = '*** Begin Patch';

// The first line of each deny starts with what to do and has at most 100 characters.
const BACKGROUND = 'Start the agent with run_in_background false, or leave the key out.\n' +
  'An agent in the background can still run after the main session ends, so the guard ' +
  'denies it.';
const BUILT = 'Leave .qory/build/ as it is: the harness keeps the build ledger and step ' +
  'counts there.\n';
const MAIN = 'Start an agent to change this file: the main session of a run changes no ' +
  'file here.\nThe main session writes only in the artifact folder, ';
// unread returns the deny of a write when the lock of type cannot be read, for problem.
const unread = ({ type, problem }) => `Run \`qory artifact pull${type ? ` ${type}` : ''}\`, ` +
  `then try again: the guard could not read the lock.\n${problem}`;
const CRASHED = 'Report this error in your output: the tool guard crashed.\n';
const HOMED = 'Leave the composed harness as it is: the step limit reads the tools of each ' +
  'agent from it.\nThe harness home is ';
const MODED = 'Leave the mode and owner of .qory/ and the folders above it as they are.\n' +
  'The step limit writes the step counts in .qory/build/; the command changes ';
const LINKED = 'Replace the link at the artifact folder with a folder: a link is no artifact ' +
  'folder.\nThe main session writes only in the artifact folder, and ';
const NO_ROOT = 'Start the session through qory: the tool guard found no working folder of ' +
  'the run.\nOn Claude Code it reads CLAUDE_PROJECT_DIR, and on Codex the folder of the hook.';
const NOT_JSON = 'Report this error in your output: the tool guard got hook input that is ' +
  'not JSON.\nIn a run, the guard denies a call whose input it cannot read.';

// The commands that write the files they name.
const WRITERS = new Set(['tee', 'cp', 'mv', 'rm', 'rmdir', 'unlink', 'touch', 'ln', 'install',
  'truncate', 'dd', 'chmod', 'chown', 'chgrp', 'chflags', 'mkdir', 'rsync', 'patch']);
// The commands that change the mode, owner or flags of the files they name.
const MODES = new Set(['chmod', 'chown', 'chgrp', 'chflags']);
// The subcommands that make a command write the files it names, as in `<tool> rm <path>` or
// `<tool> -C <folder> restore <path>` of a version control tool.
const SUB_WRITERS = new Set(['rm', 'mv', 'restore', 'checkout']);
// The commands that remove or move the files and folders they name: removing or moving a
// folder above a locked file changes that file.
const REMOVERS = new Set(['rm', 'rmdir', 'unlink', 'mv']);
// The words that run the command after them, with the options of each that take a value,
// as in `env -u X <command>` or `timeout -s KILL 5 <command>`.
const PREFIXES = { env: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
  command: [], exec: ['-a'], nice: ['-n', '--adjustment'],
  timeout: ['-s', '--signal', '-k', '--kill-after'],
  sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T'],
  sudoedit: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T'], nohup: [],
  time: ['-f', '--format', '-o', '--output'], stdbuf: ['-i', '-o', '-e'],
  xargs: ['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '--arg-file', '--delimiter',
    '--max-args', '--max-procs', '--max-chars', '--max-lines', '--replace', '--eof'],
  doas: ['-u', '-C'], ionice: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata'],
  busybox: [] };
// The commands that change only folders or the mode of files, which the step count reads
// as no write.
const FOLDER_ONLY = new Set(['mkdir', 'rmdir', 'chmod', 'chown', 'chgrp', 'chflags']);
// The commands that write only their last path, as cp writes the copy and reads the rest.
const LAST_WRITTEN = new Set(['cp', 'install', 'ln', 'rsync']);
// The words that open a group, or the then, do or else part, before a command, as in
// `{ cp a b; }`.
const GROUPS = new Set(['{', '}', 'then', 'do', 'else', '!']);
// A redirect that writes a file: > or >>, also after & or a digit, but no >& to a stream.
const REDIRECT = /(?:^|[^>])>>?(?![>&])/;
// A sed or perl that edits its files in place.
const IN_PLACE = /^(?:sed|perl)$/;

// inPlace reports whether tool, with the words of its command, edits its files in place: sed
// or perl with -i, as in -i, -i.bak or -pi, or sed with --in-place or --in-place=<suffix>.
const inPlace = (tool, words) => IN_PLACE.test(tool) && words.map(unquote).some((word) =>
  /^-[A-Za-z]*i/.test(word) || (tool === 'sed' && /^--in-place(?:=|$)/.test(word)));

// patchPaths returns the paths that a Codex patch adds, changes, deletes or moves to.
function patchPaths(patch) {
  return [...String(patch).matchAll(PATCH_FILE)].map((match) => match[1].trim());
}

// kindOf returns { kind, paths } of a call: kind is 'write', 'shell', 'agent' or null.
function kindOf(name, input) {
  const args = input !== null && typeof input === 'object' ? input : {};
  if (Object.hasOwn(WRITE_TOOLS, name)) {
    return { kind: 'write', paths: WRITE_TOOLS[name].map((key) => args[key])
      .filter((one) => typeof one === 'string' && one !== '') };
  }
  if (name === 'apply_patch') return { kind: 'write', paths: patchPaths(args.command || '') };
  if (name === 'Bash') {
    // Codex runs `apply_patch <<'EOF' ...` through its shell tool, as Bash in the input.
    const command = String(args.command || '');
    return { kind: 'shell', command, paths: command.includes(PATCH) ? patchPaths(command) : [] };
  }
  if (AGENT_TOOLS.has(name)) {
    const background = args.run_in_background === true || args.run_in_background === 'true';
    return { kind: 'agent', reason: background ? BACKGROUND : null };
  }
  return { kind: null };
}

// The longest path that the system opens: a longer one fails with ENAMETOOLONG.
const PATH_MAX = 4096;

// real returns full with each part that exists read through its links, in the case of its
// name on the disk, so that /tmp/x and /private/tmp/x are one path on macOS, and so are
// Checks/a.ts and checks/a.ts on a disk that ignores case. It reads the parts from the top
// once, up to the first that does not exist, and adds the rest as they are. A path longer
// than PATH_MAX, with its .. parts resolved, names no file, and real returns it resolved.
function real(full) {
  const resolved = path.resolve(full);
  if (resolved.length > PATH_MAX) return resolved;
  const { root } = path.parse(resolved);
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
  let found = root;
  let at = 0;
  for (; at < parts.length; at += 1) {
    const next = path.join(found, parts[at]);
    if (!fs.existsSync(next)) break;
    found = next;
  }
  let base;
  try {
    base = fs.realpathSync.native(found);
  } catch {
    return resolved;
  }
  return at < parts.length ? path.join(base, parts.slice(at).join(path.sep)) : base;
}

const under = (full, dir) => full === dir || full.startsWith(`${dir}${path.sep}`);

// caseless reports whether the disk of dir, a folder that exists, ignores case: dir with its
// case swapped reads as the same folder. There, a part of a path that does not exist yet
// matches a name in any case.
function caseless(dir) {
  const swapped = dir.replace(/[A-Za-z]/g, (one) => (one === one.toLowerCase()
    ? one.toUpperCase() : one.toLowerCase()));
  if (swapped === dir) return false;
  try {
    return fs.realpathSync.native(swapped) === fs.realpathSync.native(dir);
  } catch {
    return false;
  }
}

// lockedFiles returns { what, files } of the lock that counts: files are the real paths of
// the files it lists under root, the working folder. It returns { files: [] } when no type
// of the registry has a lock, or no version of it counts, and { type, problem } when the
// lock of type cannot be read. It reads the lock with checks.js's reader: in a run, it
// pulls the lock.
function lockedFiles({ root, env, script = process.argv[1], plugin, artifacts }) {
  const home = path.resolve(path.dirname(script), '..');
  const dir = path.join(home, 'modules', 'core', 'skills', 'running-a-workflow');
  const base = require(path.join(dir, 'lib', 'base.js'));
  const { loadRegistry } = require(path.join(dir, 'lib', 'registry.js'));
  const { pluginFolder } = require(path.join(dir, 'lib', 'plugin.js'));
  const { lockType, readLock } = require(path.join(dir, 'verbs', 'lock.js')).lockReader;
  const io = { artifacts: artifacts || base.ARTIFACTS, cwd: root, home: env.HOME, env,
    plugin: plugin || pluginFolder(path.join(dir, 'checks.js')) };
  let registry = null;
  io.registry = () => {
    if (!registry) registry = loadRegistry(io.plugin);
    return registry;
  };
  let def;
  try {
    def = lockType(io);
  } catch (error) {
    if (error instanceof base.Missing) return { files: [] };
    throw error;
  }
  try {
    const lock = readLock(io, def, null, 'write');
    if (!lock.version || lock.differs) {
      return lock.differs ? { type: def.type,
        problem: `The stored ${lock.what} differs from index.json.` }
        : { files: [] };
    }
    return { what: lock.what, files: lock.files.filter((one) => !one.problem)
      .map((one) => real(path.resolve(root, one.folder || '.', one.path))) };
  } catch (error) {
    if (error instanceof base.Missing) return { type: def.type, problem: error.message };
    throw error;
  }
}

// A shell that runs the text after -c, as in `sh -c '<text>'` or `bash -o pipefail -lc
// "<text>"`: group 1 is the quote, and group 2 the text. Each repeat in it has one way to
// match a given text, so the time to match grows in a line with the length of the command:
// the path before the shell stops at ; & | ( ) and spaces, an option is - and letters or
// -o and -O with a value, and the -c option is read ahead once.
const SHELL_C = new RegExp('(?:^|[;&|\\n(\\s])(?:[^\\s;&|()]*/)?(?:sh|bash|zsh|dash)\\s+' +
  '(?:-[oO]\\s+[^-\\s]\\S*\\s+|-[A-Za-z-]+\\s+)*-(?=[A-Za-z]*c)[A-Za-z]+\\s+' +
  '([\'"])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1', 'g');
// The depth of shells in shells whose text the guard reads.
const SHELL_DEPTH = 2;

// commands returns command and the text that each shell in it runs with -c, down to
// SHELL_DEPTH shells deep, so that the rules read `sh -c 'cp a <path>'` as `cp a <path>`.
function commands(command, depth = 0) {
  const out = [command];
  if (depth >= SHELL_DEPTH) return out;
  for (const match of command.matchAll(SHELL_C)) {
    const text = match[1] === '"' ? match[2].replace(/\\(["\\$`])/g, '$1') : match[2];
    for (const one of commands(text, depth + 1)) out.push(one);
  }
  return out;
}

// shellText returns word as the shell reads it: without its quotes, and with the character
// after each backslash that escapes it, outside single quotes; in $'...', with the escapes
// that ansi reads. With keep, a wildcard, *, ?,
// [ or ], or a backslash that quotes or a backslash made literal keeps a backslash before it,
// so that the result is a pattern for globMatch whose live wildcards are the unquoted ones.
function shellText(word, keep) {
  if (!/['"\\]/.test(word)) return word;
  const one = (char) => (keep && /[*?[\]\\]/.test(char) ? `\\${char}` : char);
  let out = '';
  let quote = null;
  for (let at = 0; at < word.length; at += 1) {
    const char = word[at];
    if (quote === "'") {
      if (char === "'") quote = null;
      else out += one(char);
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '\\' && /[$`"\\\n]/.test(word[at + 1] || '')) {
        at += 1;
        out += one(word[at]);
      } else out += one(char);
    } else if (quote === 'ansi') {
      if (char === "'") quote = null;
      else if (char === '\\' && at + 1 < word.length) {
        const [text, used] = ansi(word, at + 1);
        out += [...text].map(one).join('');
        at += used;
      } else out += one(char);
    } else if (char === '$' && word[at + 1] === "'") {
      quote = 'ansi';
      at += 1;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '\\' && at + 1 < word.length) {
      at += 1;
      out += one(word[at]);
    } else out += char;
  }
  return out;
}

// The characters of the escapes of $'...' that stand for one character.
const ANSI = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t',
  v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

// ansi returns [text, used] of the escape of $'...' in word that starts at at, after its
// backslash: the text it stands for, and the number of characters it takes. It reads \xHH,
// \NNN in octal and the escapes of ANSI; any other keeps its backslash.
function ansi(word, at) {
  const char = word[at];
  const hex = /^x([0-9A-Fa-f]{1,2})/.exec(word.slice(at, at + 3));
  if (hex) return [String.fromCharCode(parseInt(hex[1], 16)), hex[0].length];
  const octal = /^[0-7]{1,3}/.exec(word.slice(at, at + 3));
  if (octal) return [String.fromCharCode(parseInt(octal[0], 8)), octal[0].length];
  if (Object.hasOwn(ANSI, char)) return [ANSI[char], 1];
  return [`\\${char}`, 1];
}

// unquote returns word as the shell reads it, without quotes and escapes.
const unquote = (word) => shellText(word, false);

// patternOf returns word as a pattern of globMatch: its quoted wildcards escaped.
const patternOf = (word) => shellText(word, true);

// The most words that braces makes of one word.
const BRACED = 64;

// braceGroups returns the top-level brace groups of word that the shell expands, each as
// { start, end, parts, nested }: a { outside quotes, not after $ or a backslash, whose }
// closes it with a comma at its level between them. parts are the texts between those commas,
// and nested reports whether a group holds another group. One pass with a stack of open
// braces finds them, so the time grows in a line with the length of word.
function braceGroups(word) {
  const groups = [];
  const open = [];
  let quote = null;
  for (let at = 0; at < word.length; at += 1) {
    const char = word[at];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"') at += 1;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '\\') at += 1;
    else if (char === '{' && word[at - 1] !== '$') {
      open.push({ start: at, commas: [], nested: false });
    } else if (char === ',' && open.length) open[open.length - 1].commas.push(at);
    else if (char === '}' && open.length) {
      const group = open.pop();
      if (group.commas.length && open.length) open[open.length - 1].nested = true;
      if (group.commas.length && !open.length) {
        const cuts = [group.start, ...group.commas, at];
        groups.push({ start: group.start, end: at, nested: group.nested,
          parts: cuts.slice(1).map((cut, k) => word.slice(cuts[k] + 1, cut)) });
      }
    }
  }
  return groups;
}

// braces returns the words of word after the shell expands its braces, as in `rm {a,b}`, up to
// BRACED words. When word would have more, or has a group in a group, it also returns word
// with each group as *, so that the guard reads every path that the shell could make. A brace
// with no comma, such as {} or ${x}, stays.
function braces(word) {
  const groups = braceGroups(word);
  if (!groups.length) return [word];
  let out = [''];
  let over = groups.some((group) => group.nested);
  let from = 0;
  for (const group of groups) {
    const before = word.slice(from, group.start);
    const next = [];
    for (const head of out) {
      for (const part of group.parts) {
        if (next.length >= BRACED) {
          over = true;
          break;
        }
        next.push(`${head}${before}${part}`);
      }
      if (next.length >= BRACED) {
        over = over || out.length * group.parts.length > BRACED;
        break;
      }
    }
    out = next;
    from = group.end + 1;
  }
  out = out.map((head) => `${head}${word.slice(from)}`);
  if (!over) return out;
  let star = '';
  from = 0;
  for (const group of groups) {
    star += `${word.slice(from, group.start)}*`;
    from = group.end + 1;
  }
  return [...out, `${star}${word.slice(from)}`];
}

// The short options of time and sudo that take a value, as in `time -f %e -o <file>`; in a
// group of short options, as in `time -ao <file>`, the value is the rest of the group or the
// next word.
const VALUED = { time: 'fo', sudo: 'ugCDhprtUT', sudoedit: 'ugCDhprtUT' };

// prefixOutputs reads the option of a word of PREFIXES at words[at], as in `time -o <file>`
// or `sudo -e <file>`, and returns { skip, files, edit }: skip is the number of words that
// the option and its value take, files the words of the files that time writes with -o,
// --output or --output=, and edit whether sudo edits the files after its options, with -e or
// --edit. It returns null for an option that neither time nor sudo reads this way.
function prefixOutputs(prefix, words, at) {
  const option = unquote(words[at]);
  if (prefix === 'time' && (option === '-o' || option === '--output')) {
    return { skip: 2, files: words[at + 1] === undefined ? [] : [words[at + 1]], edit: false };
  }
  if (prefix === 'time' && option.startsWith('--output=')) {
    return { skip: 1, files: [words[at].slice(words[at].indexOf('=') + 1)], edit: false };
  }
  if (prefix === 'sudo' && option === '--edit') return { skip: 1, files: [], edit: true };
  if (!Object.hasOwn(VALUED, prefix) || !/^-[A-Za-z]+/.test(option)) return null;
  for (let letter = 1; letter < option.length; letter += 1) {
    const char = option[letter];
    if (prefix === 'sudo' && char === 'e') return { skip: 1, files: [], edit: true };
    if (!VALUED[prefix].includes(char)) continue;
    const rest = option.slice(letter + 1);
    const value = rest || words[at + 1];
    const files = char === 'o' && value !== undefined ? [rest || words[at + 1]] : [];
    return { skip: rest ? 1 : 2, files, edit: false };
  }
  return null;
}

// commandWords returns { words, dirs, outputs } of a simple command: words are the words from
// the command that runs, without the NAME=value words that set variables, the words of
// GROUPS, and each word of PREFIXES with its options and, for timeout, its time. dirs are the
// folders that `env -C <folder>` or `env --chdir=<folder>` runs the command in. outputs are
// the words of the files that a prefix writes: `time -o <file>`, and each file after the
// options of `sudo -e` or sudoedit, which edit them.
function commandWords(words) {
  const dirs = [];
  const outputs = [];
  let edit = false;
  let at = 0;
  while (at < words.length) {
    const word = unquote(words[at]);
    if (GROUPS.has(word) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      at += 1;
      continue;
    }
    const prefix = path.basename(word);
    if (!Object.hasOwn(PREFIXES, prefix)) break;
    if (prefix === 'sudoedit') edit = true;
    at += 1;
    while (at < words.length && words[at].startsWith('-')) {
      const option = unquote(words[at]);
      if (prefix === 'env' && (option === '-C' || option === '--chdir')) {
        dirs.push(unquote(words[at + 1] || ''));
      }
      if (prefix === 'env' && option.startsWith('--chdir=')) dirs.push(option.slice(8));
      const read = prefixOutputs(prefix, words, at);
      if (read) {
        for (const file of read.files) outputs.push(file);
        edit = edit || read.edit;
        at += read.skip;
      } else at += PREFIXES[prefix].includes(words[at]) ? 2 : 1;
    }
    if (prefix === 'timeout') at += 1;
    if (edit) break;
  }
  const rest = words.slice(at);
  return { words: rest, dirs, outputs: edit ? outputs.concat(rest) : outputs };
}

// segments returns the simple commands of a shell command and of the text of each shell in it
// that commands finds: each text split at ; & | ( ) ` and line breaks, but not at the | of the
// redirect >|, so that a group such as `( cp a b )` or `$(cp a b)` reads as its command, each
// as { text, words, cwds, at, dots }. words are the words that commandWords keeps; cwds the
// known folders that the command can run in, as folders finds them from cwd; at the folder it
// runs in, as walk finds it, or null when that is unknown; and dots whether a wildcard
// matches a leading dot.
function segments(command, cwd = process.cwd(), keep = () => true) {
  const texts = commands(dropBodies(command)).map((one, index) => {
    // An escaped parenthesis, as in `find . \( -name a \) -delete`, is a word of the command.
    const pieces = one.replace(/>\|/g, '>').replace(/\\[()]/g, ' ').split(/([;&|\n()`]+)/);
    const out = [];
    for (let at = 0; at < pieces.length; at += 2) {
      out.push({ text: pieces[at], before: pieces[at - 1] || '', after: pieces[at + 1] || '',
        index, ...commandWords(pieces[at].trim().split(/\s+/).filter(Boolean).flatMap(braces)) });
    }
    return out;
  });
  const all = texts.flat();
  const changes = all.some((one) => one.words.length &&
    CD.has(path.basename(unquote(one.words[0]))));
  for (const parts of texts) walk(parts, parts[0].index === 0 || !changes ? cwd : null);
  const parts = all.filter((one) => one.words.length);
  const from = folders(parts, cwd);
  // A wildcard matches a leading dot only after the shell is set to: dotglob in bash,
  // globdots or GLOB_DOTS in zsh, or GLOBIGNORE, which turns dotglob on.
  const dots = /dotglob|globdots|GLOB_DOTS|GLOBIGNORE/i.test(command);
  return parts.filter(keep).map(({ text, words, dirs, outputs, at }) => {
    const chdirs = [...dirs, ...toolDirs(words)];
    const known = chdirs.filter((dir) => !vague(dir));
    const cwds = from.map((one) => known.reduce((to, dir) => path.resolve(to, dir), one));
    const sure = at !== null && known.length === chdirs.length;
    return { text, words, outputs, cwds,
      at: sure ? known.reduce((to, dir) => path.resolve(to, dir), at) : null, dots };
  });
}

// link returns the kind of a separator between two commands of a shell text, without its
// parentheses and backticks: '&&', '||', '|', '&', ';' for ; and line breaks, or ''.
function link(separator) {
  const plain = separator.replace(/[()`]/g, '');
  if (plain.includes('||')) return '||';
  if (plain.includes('&&')) return '&&';
  if (plain.includes('|')) return '|';
  if (/[;\n]/.test(plain)) return ';';
  return plain.includes('&') ? '&' : '';
}

// walk sets at on each of parts, the commands of one shell text in order, to the folder that
// the shell runs it in, from start, or to null when that is unknown. A cd, pushd or popd
// changes the folder of the commands after it, and the end of its ( ... ), $( ... ) or
// backtick group sets the folder back. The folder is unknown after a cd to a vague folder
// or to one that does not exist, a cd in a pipe or in the background, a popd with no pushd,
// a command after `cd ... ||`, and a command that a ; or a || joins after a cd that ran only
// on the condition of a && before it.
function walk(parts, start) {
  let at = start;
  let maybe = false;
  const saved = [];
  const pushed = [];
  let quoted = false;
  for (const part of parts) {
    for (const char of part.before) {
      if (char === '(' || (char === '`' && !quoted)) saved.push({ at, maybe });
      if ((char === ')' || (char === '`' && quoted)) && saved.length) ({ at, maybe } = saved.pop());
      if (char === '`') quoted = !quoted;
    }
    const kind = link(part.before);
    if (maybe && kind !== '&&' && kind !== '') {
      at = null;
      maybe = false;
    }
    part.at = at;
    const tool = part.words.length ? path.basename(unquote(part.words[0])) : '';
    if (!CD.has(tool)) continue;
    if (link(part.after) === '|' || link(part.after) === '&' || kind === '|') continue;
    if (link(part.after) === '||') {
      at = null;
      continue;
    }
    if (kind === '&&' || kind === '||') maybe = true;
    const to = part.words.slice(1).map(unquote).find((word) => !/^-[LPe@]+$/.test(word) &&
      word !== '--');
    if (tool === 'popd') at = pushed.length ? pushed.pop() : null;
    else if (at === null || to === undefined || vague(to)) at = null;
    else {
      if (tool === 'pushd') pushed.push(at);
      const next = path.resolve(at, to);
      let stat = null;
      try {
        stat = fs.statSync(next, { throwIfNoEntry: false });
      } catch {
        // A folder that cannot be read, a name too long or a NUL: the cd fails.
      }
      at = stat && stat.isDirectory() ? next : null;
    }
  }
}

// A here-document operator: group 1 is - for <<-, group 2 the word of a quoted end, as in
// <<'EOF', <<"EOF" or <<\EOF, and group 3 the word of an unquoted end, as in <<EOF.
const HEREDOC = /<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\([^\s;&|<>()'"]+)|([^\s;&|<>()'"]+))/y;
// The commands whose input is text that they copy to a file or to their output, as in
// `cat > a.ts <<'EOF'`.
const READERS = new Set(['cat', 'tee']);
// A function definition, as in `cat() { sh; }`, `cat () { sh; }` or `function cat { sh; }`, in
// any form and with any name, so that a function named cat or tee is never read as cat or tee.
const DEFINES = /(?:^|[^\w$-])function(?![\w-])|\(\s*\)/;
// The commands besides cat and tee that may run in a call whose here-document bodies the guard
// skips: they run no file and read no input, as in `mkdir -p docs && cat > docs/a.md <<'EOF'`.
const PLAIN = new Set(['echo', 'ls', 'mkdir', 'true']);

// dropBodies returns command without the body of each here-document whose end word is quoted,
// such as <<'EOF', and whose command, after PREFIXES, is cat or tee with no pipe after it,
// because the shell reads such a body as text, with no $( ... ) or backticks, and passes it
// to cat or tee as their input. Any other command could run the lines of the body, so its
// body stays. It reads the command once, line by line, and returns it as it is when a body
// has no end, when the command ends in a quote or after a backslash, when heredocs returns
// null, when another command of the lines outside the bodies is not one of PLAIN or a cat or
// tee that reads, because it could run a file that cat or tee writes, or when those lines
// define a function, which can be named cat.
function dropBodies(command) {
  if (!command.includes('<<')) return command;
  const kept = [];
  // The here-documents whose bodies come next, from pending[head] on.
  const pending = [];
  let head = 0;
  const scan = heredocs();
  let dropped = false;
  for (const line of command.split('\n')) {
    if (head < pending.length) {
      const { end, dash, drop } = pending[head];
      if ((dash ? line.replace(/^\t+/, '') : line) === end) head += 1;
      if (drop) dropped = true;
      else kept.push(line);
      continue;
    }
    kept.push(line);
    const found = scan.next(line);
    if (!found) return command;
    for (const one of found) pending.push(one);
  }
  if (head < pending.length || scan.open() || !dropped || scan.other()) return command;
  const rest = kept.join('\n');
  return DEFINES.test(rest) ? command : rest;
}

// plain reports whether text, a simple command, is one of PLAIN after PREFIXES, or has no
// words but variables that it sets, as in `X=1`, and words of GROUPS, such as `}`.
function plain(text) {
  const all = text.trim().split(/\s+/).filter(Boolean);
  const { words } = commandWords(all);
  if (words.length) return PLAIN.has(words[0]);
  return all.every((word) => GROUPS.has(unquote(word)) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
}

// reads reports whether text, a simple command with its here-document operators removed, is
// cat or tee after PREFIXES other than xargs, which would run the command once for each line.
function reads(text) {
  const all = text.trim().split(/\s+/).filter(Boolean);
  const { words } = commandWords(all);
  const before = all.slice(0, all.length - words.length);
  return words.length > 0 && READERS.has(words[0]) &&
    !before.some((word) => path.basename(unquote(word)) === 'xargs');
}

// heredocs returns { next, open, other }. next reads the next line of a command outside the bodies
// of its here-documents and returns { end, dash, drop } of each here-document operator of the
// command line that the line ends, in order: its end word, whether it is <<-, and whether its
// body is text to drop: the end word is quoted and the command of the operator reads. A
// command line goes on to the next line after a backslash at its end or in a quote, as in the
// shell; next then returns no operator, and open returns true. A command ends at ; & | ( ) `
// and the end of the command line, but not at the & or | of a redirect such as 2>&1, &> or >|;
// a command that ends at a pipe, a ( or a backtick sends its input on, so its body stays. next
// skips a << in quotes, after a backslash, or in a comment, which starts with a # at the start
// of a word. next returns null where it cannot know the lines of a body or the quotes: for an
// operator on a command line of more than one line, and for $( or a backtick in double quotes.
// other returns true when a command of the lines read is neither a cat or tee that reads nor
// plain.
function heredocs() {
  let quote = null;
  let text = '';
  let found = [];
  let out = [];
  let lines = 0;
  let open = false;
  let other = false;
  const close = (after) => {
    const reader = !/[|(`]/.test(after) && reads(text);
    if (!reader && !plain(text)) other = true;
    for (const one of found) out.push({ ...one, drop: one.quoted && reader });
    text = '';
    found = [];
  };
  const next = (line) => {
    lines += 1;
    let more = false;
    for (let at = 0; at < line.length; at += 1) {
      const char = line[at];
      if (quote === "'") {
        if (char === "'") quote = null;
        text += char;
      } else if (quote) {
        if (char === '\\') {
          more = at + 1 === line.length;
          text += line.slice(at, at + 2);
          at += 1;
          continue;
        }
        if (quote === '"' && (char === '`' || (char === '$' && line[at + 1] === '('))) return null;
        if (char === (quote === '"' ? '"' : "'")) quote = null;
        text += char;
      } else if (char === '\\') {
        more = at + 1 === line.length;
        text += line.slice(at, at + 2);
        at += 1;
      } else if (char === '$' && line[at + 1] === "'") {
        quote = 'ansi';
        text += "$'";
        at += 1;
      } else if (char === "'" || char === '"') {
        quote = char;
        text += char;
      } else if (char === '#' && (at === 0 || /\s/.test(line[at - 1]))) break;
      else if (char === '<' && line[at + 1] === '<' && line[at + 2] !== '<') {
        HEREDOC.lastIndex = at;
        const match = HEREDOC.exec(line);
        if (match) {
          const quoted = match[2] || match[3] || match[4];
          found.push({ end: quoted || match[5], dash: match[1] === '-', quoted: Boolean(quoted) });
          text += ' ';
          at = HEREDOC.lastIndex - 1;
        } else {
          text += '<<';
          at += 1;
        }
      } else if (char === '<' && line[at + 1] === '<') {
        text += '<<<';
        at += 2;
      } else if (/[;)(`]/.test(char) || (char === '|' && line[at - 1] !== '>') ||
        (char === '&' && !/[<>]/.test(line[at - 1] || '') && line[at + 1] !== '>')) close(char);
      else text += char;
    }
    open = Boolean(quote) || more;
    if (open) {
      text += '\n';
      return found.length || out.length ? null : [];
    }
    close('');
    const done = lines > 1 && out.length ? null : out;
    out = [];
    lines = 0;
    return done;
  };
  return { next, open: () => open, other: () => other };
}

// The commands that change the folder of the commands after them.
const CD = new Set(['cd', 'pushd', 'popd']);
// The most folders that folders follows.
const FOLDERS = 16;

// vague reports whether the folder or file of word is unknown before the shell runs: it
// starts with ~, contains $ or a backtick, is - for the folder before, or is empty.
const vague = (word) => word === '' || word === '-' || word.startsWith('~') || /[$`]/.test(word);

// folders returns the known folders that the commands of parts can run in: cwd and each
// folder that a cd or pushd in parts changes to, from each folder before it, since a cd can
// fail, run in a group, or not run at all, up to FOLDERS folders. A cd to a vague folder or
// to the home, and a popd, add no folder.
function folders(parts, cwd) {
  let list = [cwd];
  for (const { words } of parts) {
    const tool = path.basename(unquote(words[0]));
    if (!CD.has(tool)) continue;
    const to = words.slice(1).map(unquote).find((word) => !/^-[LPe@]+$/.test(word) &&
      word !== '--');
    if (tool === 'popd' || to === undefined || vague(to)) continue;
    const more = [...new Set([...list, ...list.map((one) => path.resolve(one, to))])];
    if (more.length <= FOLDERS) list = more;
  }
  return list;
}

// toolDirs returns the folders that a command with a subcommand of SUB_WRITERS runs in, from
// each -C <folder> before the subcommand, as in `<tool> -C <folder> restore <path>`.
function toolDirs(words) {
  if (!subWrites(words)) return [];
  const plain = words.map(unquote);
  const out = [];
  for (let at = 1; at < subIndex(plain); at += 1) {
    if (plain[at] === '-C') out.push(plain[at + 1] || '');
  }
  return out;
}

// subWrites reports whether words, the words of a simple command, run a subcommand of
// SUB_WRITERS: the first word after the tool and its options, which skip -C <value>,
// -c <value> when the value contains =, and each other word that starts with -. So the
// command in `sh -c 'rm <path>'` is read. A restore with --staged or -S and no --worktree,
// or a start of it such as --work, or -W changes only the index, so it writes no file.
function subWrites(words) {
  const plain = words.map(unquote);
  const at = subIndex(plain);
  const sub = plain[at];
  if (!SUB_WRITERS.has(sub)) return false;
  if (sub !== 'restore') return true;
  const rest = plain.slice(at + 1);
  // A version control tool takes a start of a long option, such as --work for --worktree.
  const flag = (long, short) => rest.some((word) => (word.length > 2 && long.startsWith(word)) ||
    new RegExp(`^-[A-Za-z]*${short}`).test(word));
  return !flag('--staged', 'S') || flag('--worktree', 'W');
}

// subIndex returns the index in words of the subcommand: the first word after the tool and
// its options, as subWrites reads them.
function subIndex(words) {
  let at = 1;
  while (at < words.length && words[at].startsWith('-')) {
    const value = words[at] === '-C' || (words[at] === '-c' && (words[at + 1] || '').includes('='));
    at += value ? 2 : 1;
  }
  return at;
}

// writes reports whether a simple command writes a file and contains name: a redirect to
// name, a command of WRITERS or with a subcommand of SUB_WRITERS, or sed -i or perl -i.
// With nocase, name matches in any case.
function writes(segment, name, nocase = false) {
  const { at, target } = namePatterns(name, nocase);
  if (!segment.text.includes(nocase ? '' : path.basename(name)) || !at.test(segment.text)) {
    return false;
  }
  const [first] = segment.words;
  const tool = path.basename(first.replace(/^['"]|['"]$/g, ''));
  if (WRITERS.has(tool) || subWrites(segment.words)) return true;
  if (inPlace(tool, segment.words) || findParts(segment.words).writes) return true;
  if ((segment.outputs || []).some((word) => at.test(word))) return true;
  return REDIRECT.test(segment.text) && target.test(segment.text);
}

// The patterns of namePatterns, by name and case.
const NAMED = new Map();

// namePatterns returns { at, target } for name: at matches name as a word of a command, and
// target as the target of a redirect. With nocase, they match in any case. They are made once
// for each name.
function namePatterns(name, nocase) {
  const key = `${nocase ? 'i' : ''}:${name}`;
  if (!NAMED.has(key)) {
    const flags = nocase ? 'i' : '';
    const text = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    NAMED.set(key, { at: new RegExp(`(^|[\\s'"=(:>])(\\./)?${text}(?=$|[\\s'")<>;|&/])`, flags),
      target: new RegExp(`>>?\\s*['"]?(\\./)?${text}`, flags) });
  }
  return NAMED.get(key);
}

// A redirect target that is no file.
const NO_FILE = /^['"]?\/dev\/(?:null|stdout|stderr|tty)['"]?$/;

// segmentWrites reports whether a simple command writes a file, whichever file: it runs a
// command of WRITERS or with a subcommand of SUB_WRITERS, sed -i or perl -i,
// `qory artifact push`, or has a redirect to a file.
function segmentWrites(segment) {
  const [first, second, third] = segment.words.map((word) => word.replace(/^['"]|['"]$/g, ''));
  const tool = path.basename(first);
  if (WRITERS.has(tool) || subWrites(segment.words)) return true;
  if (inPlace(tool, segment.words) || findParts(segment.words).writes) return true;
  if (tool === 'qory' && second === 'artifact' && third === 'push') return true;
  return redirectTargets(segment).length > 0;
}

// redirectTargets returns the files that the redirects of a simple command write, and the
// files that a prefix of it writes, as in `time -o <file>`.
function redirectTargets(segment) {
  const outputs = (segment.outputs || []).filter((word) => !NO_FILE.test(word)).map(patternOf);
  if (!REDIRECT.test(segment.text)) return outputs;
  return [...segment.text.matchAll(/(?:^|[^>0-9&])&?[0-9]?>>?(?![>&])\s*(\S*)/g)]
    .map((match) => match[1]).filter((target) => target !== '' && !NO_FILE.test(target))
    .map(patternOf).concat(outputs);
}

// pathWords returns the words of a simple command that can be paths that it writes: the
// targets of its redirects and, for a command of WRITERS, a subcommand of SUB_WRITERS or
// sed -i or perl -i, the words after the tool and its subcommand, and the value of an
// option or of a word with =, as in dd of=<path>. It leaves out the script of sed and perl.
// Each word is a pattern of patternOf, with its quoted wildcards escaped.
function pathWords(segment) {
  const words = segment.words.map(unquote);
  const tool = path.basename(words[0]);
  const sub = subWrites(segment.words) ? subIndex(words) : -1;
  const out = redirectTargets(segment);
  if (!WRITERS.has(tool) && sub < 0 && !inPlace(tool, words)) return out;
  let script = tool === 'sed' && !words.some((word) => /^(?:-e|--expression|-f|--file)/.test(word));
  // The words before a subcommand are the tool's options, as in `<tool> -C <folder> rm`.
  for (let at = sub > 0 ? sub + 1 : 1; at < words.length; at += 1) {
    const word = words[at];
    if (IN_PLACE.test(tool) && (word === '-e' || word === '-f' || word === '--expression' ||
      (tool === 'perl' && /^-[A-Za-z]*e$/.test(word)))) {
      at += 1;
      continue;
    }
    const shown = patternOf(segment.words[at]);
    if (word.startsWith('-') || /^[A-Za-z_]+=/.test(word)) {
      if (shown.indexOf('=') > 0) out.push(shown.slice(shown.indexOf('=') + 1));
      continue;
    }
    if (script) {
      script = false;
      continue;
    }
    out.push(shown);
  }
  return out;
}

// findParts returns { starts, names, exec, writes } of a find command of words: the paths it
// starts from, . when none; the patterns of its -name and -iname options, each as
// { pattern, nocase }; the words of each command that its -exec, -execdir, -ok or -okdir
// runs and that writes; and whether it writes: with -delete, or an exec of a command that
// writes. It returns writes false for any other command.
function findParts(words) {
  const out = { starts: [], names: [], exec: [], writes: false };
  if (path.basename(unquote(words[0] || '')) !== 'find') return out;
  const plain = words.map(unquote);
  let at = 1;
  while (at < plain.length && /^-(?:[HLP]|O\d*|D)$/.test(plain[at])) {
    at += plain[at] === '-D' ? 2 : 1;
  }
  while (at < plain.length && !plain[at].startsWith('-') && plain[at] !== '!') {
    out.starts.push(plain[at]);
    at += 1;
  }
  if (!out.starts.length) out.starts.push('.');
  for (; at < plain.length; at += 1) {
    const word = plain[at];
    if ((word === '-name' || word === '-iname') && at + 1 < plain.length) {
      out.names.push({ pattern: plain[at + 1], nocase: word === '-iname' });
      at += 1;
    } else if (word === '-delete') out.writes = true;
    else if (/^-(?:exec|execdir|ok|okdir)$/.test(word)) {
      const end = plain.findIndex((one, index) => index > at && (one === ';' || one === '+'));
      const exec = plain.slice(at + 1, end < 0 ? plain.length : end)
        .filter((one) => one !== '{}');
      const tool = path.basename(exec[0] || '');
      if (WRITERS.has(tool) || subWrites(exec) || inPlace(tool, exec)) {
        out.writes = true;
        out.exec.push(exec);
      }
      at = end < 0 ? plain.length : end;
    }
  }
  return out;
}

// shown returns the names that a -name option of find can match for full: its name and, for a
// folder, the name of each entry below it, up to 1000.
function shown(full, folder) {
  const out = [path.basename(full)];
  if (!folder) return out;
  try {
    for (const entry of fs.readdirSync(full, { recursive: true }).slice(0, 1000)) {
      out.push(path.basename(String(entry)));
    }
  } catch {
    // A folder that cannot be read has only its name.
  }
  return out;
}

// copyParts returns { dest, sources } of a cp, install, ln or rsync of words: the folder of
// -t or --target-directory, else the last path, and the other paths, as patterns of patternOf.
function copyParts(words) {
  const plain = words.map(patternOf);
  let dest = null;
  const sources = [];
  for (let at = 1; at < plain.length; at += 1) {
    const word = plain[at];
    if (word === '-t' || word === '--target-directory') {
      dest = plain[at + 1] || '';
      at += 1;
    } else if (word.startsWith('--target-directory=')) dest = word.slice(19);
    else if (!word.startsWith('-')) sources.push(word);
  }
  if (dest === null) dest = sources.pop();
  return { dest, sources };
}

// pathHits reports whether a simple command that writes changes full, as its words read once
// each is resolved from a folder of the command's cwds: a word that is full, or below full
// when folder is true, or a folder above full for a command of REMOVERS or, when full is a
// file, a restore or a checkout of a path. A checkout with no `--` reads a word as a path only
// when it exists, so `checkout .` is one and `checkout <name>` of a name that is no path is
// not. fold and realOf compare and resolve paths.
function pathHits(segment, full, folder, how) {
  const { fold, realOf } = how;
  const words = segment.words.map(unquote);
  const sub = subWrites(segment.words) ? words[subIndex(words)] : null;
  const remover = REMOVERS.has(path.basename(words[0])) || REMOVERS.has(sub);
  const restorer = sub === 'restore' || sub === 'checkout';
  const named = sub !== 'checkout' || words.includes('--');
  const target = fold(full);
  const base = path.basename(target);
  const nocase = fold('A') === 'a';
  const find = findParts(segment.words);
  if (find.writes) {
    // find writes the paths below each start that its -name options match.
    return find.exec.some((exec) => pathHits({ ...segment, words: exec }, full, folder, how)) ||
      segment.cwds.some((cwd) => find.starts.some((start) => {
        const at = fold(realOf(path.resolve(cwd, start)));
        if (!under(target, at) && !(folder && under(at, target))) return false;
        return !find.names.length || find.names.some(({ pattern, nocase: other }) =>
          shown(full, folder).some((name) => globMatch(pattern, name,
            { nocase: nocase || other, dots: true })));
      }));
  }
  // A copy into a folder above full writes full when a source has the name of the part of
  // full's path below that folder, or a source is vague or ends with /.
  if (LAST_WRITTEN.has(path.basename(words[0]))) {
    const { dest, sources } = copyParts(segment.words);
    const named = (first) => sources.some((source) => vague(source) || /\/\.?$/.test(source) ||
      globMatch(path.basename(source), first, { nocase, dots: segment.dots }));
    if (dest && !vague(dest) && wild(dest) && segment.cwds.some((cwd) => {
      const pattern = path.resolve(cwd, dest);
      return globReach(pattern, target, fold, segment.dots) === 'above' &&
        named(target.split(path.sep).filter(Boolean)[pattern.split(path.sep).filter(Boolean)
          .length]);
    })) return true;
    if (dest && !vague(dest) && !wild(dest) && segment.cwds.some((cwd) => {
      const resolved = realOf(path.resolve(cwd, literal(dest)));
      const at = fold(resolved);
      if (at === target || !under(target, at)) return false;
      const stat = fs.statSync(resolved, { throwIfNoEntry: false });
      if (!dest.endsWith('/') && !(stat && stat.isDirectory())) return false;
      return named(path.relative(at, target).split(path.sep)[0]);
    })) return true;
  }
  return pathWords(segment).some((shown) => segment.cwds.some((cwd) => {
    if (wild(shown)) {
      // A glob writes each path it matches: full, a folder above it for a remover or a
      // restore, or a path below full when full is a folder.
      const reach = globReach(path.resolve(cwd, shown), target, fold, segment.dots);
      return reach === 'equal' || (reach === 'below' && folder) ||
        (reach === 'above' && (remover || (!folder && restorer)));
    }
    const word = literal(shown);
    const lexical = fold(path.resolve(cwd, word));
    // Only a word that can match is resolved through the disk.
    if (!path.isAbsolute(word) && path.basename(lexical) !== base && !under(target, lexical) &&
      !(folder && under(lexical, target))) return false;
    const resolved = realOf(path.resolve(cwd, word));
    const exact = fold(resolved);
    if (exact === target || (folder && under(exact, target))) return true;
    if (!under(target, exact)) return false;
    // A restore writes only tracked files, and .qory/build/ holds none.
    return remover || (!folder && restorer && (named || fs.existsSync(resolved)));
  }));
}

// countsAsWrite reports whether a call writes for the step count: it writes a file in
// artifacts, the artifact folder, which may lie in root/.qory/, or below root, the working
// folder, outside root/.qory/, or runs `qory artifact push`. cwd is the folder of the call,
// and all three, and each written path, are read through their links, a new file through the
// deepest folder above it that exists. A path of a shell command that vague reports, as in
// `~/x`, `$HOME/x` or `"$f"`, counts as no write. A write elsewhere in /tmp, mkdir, rmdir,
// chmod, chown, chgrp, chflags and a checkout with no `--` count as no write, and of cp,
// install, ln and rsync only the last path counts. A relative path of a shell command is
// read from the folder that walk finds for its command, after a cd, pushd, popd, -C or
// env -C, and counts as no write when that folder is unknown. A path with a wildcard counts
// as its folder before the first part with a wildcard.
function countsAsWrite(name, input, { cwd, root, artifacts }) {
  const args = input !== null && typeof input === 'object' ? input : {};
  const nocase = caseless(root);
  const fold = (full) => (nocase ? full.toLowerCase() : full);
  const qory = fold(path.join(root, '.qory'));
  const known = new Map();
  const place = (lexical) => {
    if (!known.has(lexical)) known.set(lexical, real(lexical));
    const full = fold(known.get(lexical));
    if (artifacts && under(full, fold(artifacts))) return true;
    return under(full, fold(root)) && !under(full, qory);
  };
  const work = (word, from = cwd) => (path.isAbsolute(word) ? place(word)
    : from !== null && place(path.resolve(from, word)));
  if (Object.hasOwn(WRITE_TOOLS, name)) {
    return WRITE_TOOLS[name].some((key) => typeof args[key] === 'string' && args[key] !== '' &&
      work(args[key]));
  }
  if (name === 'apply_patch') return patchPaths(args.command || '').some((one) => work(one));
  if (name !== 'Bash') return false;
  const command = String(args.command || '');
  if (command.includes(PATCH) && patchPaths(command).some((one) => work(one))) return true;
  return segments(command, cwd, segmentWrites).some((segment) => {
    const at = (word) => !vague(word) && (wild(word) ? work(globFolder(word), segment.at)
      : work(literal(word), segment.at));
    const words = segment.words.map(unquote);
    const tool = path.basename(words[0]);
    if (tool === 'qory' && words[1] === 'artifact' && words[2] === 'push') return true;
    const checkout = subWrites(segment.words) && words[subIndex(words)] === 'checkout' &&
      !words.includes('--');
    const targets = redirectTargets(segment);
    if (FOLDER_ONLY.has(tool) || checkout) return targets.some(at);
    const written = pathWords(segment);
    if (LAST_WRITTEN.has(tool)) return [...targets, ...written.slice(-1)].some(at);
    return written.some(at);
  });
}

// globFolder returns the folder of word, a pattern with a wildcard, before its first part
// with a wildcard, as in src for src/*/build, or . for *.log.
function globFolder(word) {
  const parts = word.split('/');
  const at = parts.findIndex((part) => wild(part));
  const folder = parts.slice(0, at).join('/');
  return literal(folder === '' && word.startsWith('/') ? '/' : folder || '.');
}

// names returns the ways a shell command can write full: its path, and its path from each
// folder of cwds and from root when it lies below them.
function names(full, cwds, root) {
  const out = new Set([full]);
  for (const from of [...cwds, root]) {
    const relative = path.relative(from, full);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) out.add(relative);
  }
  return [...out];
}

// decide returns the reason to deny a call, or null to let it run. input is the hook's input:
// tool_name, tool_input, cwd and, in an agent's call, agent_id; cwd only resolves the paths
// of the call. root is the working folder of the run, as rootOf of step-limit.js finds it;
// with no root, decide denies each write and shell command. locked returns the files of the
// lock, as lockedFiles does; it runs only for a write below root.
function decide({ input, env = process.env, script = process.argv[1], locked, root: start }) {
  if (!env.QORY_RUN_ID) return null;
  const call = kindOf(input.tool_name, input.tool_input);
  if (call.kind === 'agent') return call.reason;
  if (call.kind !== 'write' && call.kind !== 'shell') return null;
  if (typeof start !== 'string' || start === '') return NO_ROOT;
  const cwd = real(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd());
  const root = real(start);
  const build = path.join(root, BUILD);
  const nocase = caseless(root);
  const fold = (full) => (nocase ? full.toLowerCase() : full);
  const inside = (full, dir) => under(fold(full), fold(dir));
  let lock = null;
  const lockOf = () => {
    if (lock === null) {
      lock = (locked || ((args) => lockedFiles(args)))({ root, env, script });
    }
    return lock;
  };
  const paths = call.paths.map((one) => real(path.resolve(cwd, one)));
  const home = steps.homeBelow(env.QORY_HARNESS_HOME, root);
  if (call.kind === 'shell') {
    const reason = shellReason(call.command, { cwd, root, lockOf, nocase, home });
    if (reason || !paths.length) return reason;
  }
  const homed = home && paths.find((full) => inside(full, home));
  if (homed) return `${HOMED}${home}; the call writes ${homed}.`;
  const built = paths.find((full) => inside(full, build) ||
    fold(full).includes(fold(`${path.sep}${BUILD}${path.sep}`)));
  if (built) return `${BUILT}The call writes ${built}.`;
  if (paths.some((full) => inside(full, root))) {
    const { files = [], what, problem, type } = lockOf();
    if (problem) return unread({ type, problem });
    const file = paths.find((full) => files.some((one) => fold(one) === fold(full)));
    if (file) return lockedReason(file, root, what);
  }
  const agent = typeof input.agent_id === 'string' && input.agent_id !== '';
  if (agent) return null;
  const artifacts = artifactFolder(root, env);
  const outside = paths.find((full) => !artifacts || !inside(full, artifacts));
  if (!outside) return null;
  if (!artifacts) return `${LINKED}${folder(root, env)} is a link; this call writes ${outside}.`;
  return `${MAIN}${artifacts}; this call writes ${outside}.`;
}

// shellReason returns the reason to deny a shell command: it writes .qory/build/, home, the
// harness home below the working folder, or a file of the lock, as its text shows. lockOf
// returns the files of the lock; with nocase, a name matches in any case.
function shellReason(command, { cwd, root, lockOf, nocase, home }) {
  const parts = segments(command, cwd, segmentWrites);
  if (!parts.length) return null;
  const cwds = [...new Set(parts.flatMap((one) => one.cwds))];
  const known = new Map();
  const realOf = (full) => {
    if (!known.has(full)) known.set(full, real(full));
    return known.get(full);
  };
  const how = { realOf, fold: (full) => (nocase ? full.toLowerCase() : full) };
  const hit = (full, folder) => parts.some((one) => pathHits(one, full, folder, how)) ||
    names(full, cwds, root).some((name) => parts.some((one) => writes(one, name, nocase)));
  const fold = how.fold;
  const qory = path.join(root, '.qory');
  for (const one of parts) {
    if (!MODES.has(path.basename(unquote(one.words[0])))) continue;
    if (fold(one.text).includes(fold('.qory'))) return `${MODED}${one.text.trim()}.`;
    const word = pathWords(one).find((each) => one.cwds.some((cwd) =>
      globMeets(path.resolve(cwd, each), qory, how, one.dots)));
    if (word !== undefined) return `${MODED}${word}.`;
  }
  if (hit(path.join(root, BUILD), true) || parts.some((one) => writes(one, BUILD, nocase))) {
    return `${BUILT}The command writes .qory/build/.`;
  }
  if (home && hit(home, true)) return `${HOMED}${home}; the command writes in it.`;
  const { files = [], what, problem, type } = lockOf();
  if (problem) return unread({ type, problem });
  const file = files.find((full) => hit(full, false));
  return file ? lockedReason(file, root, what) : null;
}

// wild reports whether word has a wildcard of the shell, *, ? or [, that no backslash escapes.
function wild(word) {
  for (let at = 0; at < word.length; at += 1) {
    if (word[at] === '\\') at += 1;
    else if (word[at] === '*' || word[at] === '?' || word[at] === '[') return true;
  }
  return false;
}

// literal returns word without the backslashes that escape its characters.
const literal = (word) => word.replace(/\\(.)/g, '$1');

// globParts returns the parts of part, one part of a path with wildcards: { kind: 'char',
// char }, { kind: 'any' } for ?, { kind: 'star' } for one or more *, and { kind: 'class',
// negate, items, bad } for [...], whose items are [low, high] ranges. A range whose low is
// above its high makes bad true, and a [ with no ] is a char.
function globParts(part) {
  const out = [];
  for (let at = 0; at < part.length; at += 1) {
    const one = part[at];
    if (one === '\\' && at + 1 < part.length) {
      at += 1;
      out.push({ kind: 'char', char: part[at] });
    } else if (one === '*') {
      if (!out.length || out[out.length - 1].kind !== 'star') out.push({ kind: 'star' });
    } else if (one === '?') out.push({ kind: 'any' });
    else if (one === '[' && classEnd(part, at) > 0) {
      const end = classEnd(part, at);
      let body = part.slice(at + 1, end);
      const negate = body.startsWith('!') || body.startsWith('^');
      if (negate) body = body.slice(1);
      const items = [];
      for (let k = 0; k < body.length; k += 1) {
        if (body[k + 1] === '-' && k + 2 < body.length) {
          items.push([body[k], body[k + 2]]);
          k += 2;
        } else items.push([body[k], body[k]]);
      }
      out.push({ kind: 'class', negate, items, bad: items.some(([low, high]) => low > high) });
      at = end;
    } else out.push({ kind: 'char', char: one });
  }
  return out;
}

// classEnd returns the index of the ] that closes the [ at at in part, or -1. A ] right after
// the [ or after its ! or ^ is a member.
function classEnd(part, at) {
  let from = at + 1;
  if (part[from] === '!' || part[from] === '^') from += 1;
  return part.indexOf(']', from + 1);
}

// globMatch reports whether name, one part of a path, matches part, one part of a pattern. It
// walks both once, and goes back only to the last *, so its time grows with the product of
// their lengths, never more. Without dots, a name that starts with . needs a . at the start
// of part, as the shell does without dotglob. With nocase, letters match in any case.
function globMatch(part, name, { nocase = false, dots = false } = {}) {
  const tokens = globParts(part);
  const first = tokens[0];
  if (!dots && name.startsWith('.') && !(first && first.kind === 'char' && first.char === '.')) {
    return false;
  }
  const fold = (one) => (nocase ? one.toLowerCase() : one);
  const one = (token, char) => {
    if (token.kind === 'any') return true;
    if (token.kind === 'char') return fold(token.char) === fold(char);
    if (token.bad) return false;
    const hit = token.items.some(([low, high]) => (fold(low) <= fold(char) &&
      fold(char) <= fold(high)) || (low <= char && char <= high));
    return token.negate ? !hit : hit;
  };
  let t = 0;
  let n = 0;
  let star = -1;
  let mark = 0;
  while (n < name.length) {
    const token = tokens[t];
    if (token && token.kind === 'star') {
      star = t;
      t += 1;
      mark = n;
    } else if (token && one(token, name[n])) {
      t += 1;
      n += 1;
    } else if (star >= 0) {
      t = star + 1;
      mark += 1;
      n = mark;
    } else return false;
  }
  while (t < tokens.length && tokens[t].kind === 'star') t += 1;
  return t === tokens.length;
}

// globMeets reports whether pattern, a full path that may have wildcards, matches dir, a
// path below dir, or a folder above dir. realOf and fold resolve and compare paths.
function globMeets(pattern, dir, { realOf, fold }, dots) {
  if (!wild(pattern)) {
    const full = fold(realOf(literal(pattern)));
    return under(full, fold(dir)) || under(fold(dir), full);
  }
  return globReach(pattern, dir, fold, dots) !== null;
}

// globReach returns how pattern, a full path with wildcards, meets full: 'equal' when it
// matches full, 'above' when it matches a folder above full, 'below' when it matches only
// paths below full, and null when it matches none of them. fold compares the parts, and with
// dots a wildcard matches a leading dot.
function globReach(pattern, full, fold, dots) {
  const parts = pattern.split(path.sep).filter(Boolean);
  const wanted = full.split(path.sep).filter(Boolean);
  const nocase = fold('A') === 'a';
  const meets = parts.slice(0, wanted.length).every((part, at) => (wild(part)
    ? globMatch(part, wanted[at], { nocase, dots }) : fold(literal(part)) === fold(wanted[at])));
  if (!meets) return null;
  if (parts.length === wanted.length) return 'equal';
  return parts.length < wanted.length ? 'above' : 'below';
}

// lockedReason returns the deny of a write to file, which the lock what lists. The path is on
// the second line, so that the first line stays within 100 characters.
function lockedReason(file, root, what) {
  const shown = under(file, root) ? path.relative(root, file) : file;
  return `Leave the locked file as it is: ${what} locks it.\nThe call writes ${shown}. ` +
    'A change to a locked file fails checks.js lock --verify and the push check.';
}

// placeOf returns { cwd, root, artifacts } of a call: the folder of the hook's input, root
// and the artifact folder, as artifactFolder finds it, read through their links.
function placeOf(input, root, env) {
  const cwd = real(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd());
  return { cwd, root: real(root), artifacts: artifactFolder(root, env) };
}

// artifactFolder returns the artifact folder of the run, as end-gate.js finds it from root and
// env, with the folders above it read through their links, or null when the folder itself is
// a link: an agent that replaces the folder with a link to / would make every write a write
// in the artifact folder.
function artifactFolder(root, env) {
  const dir = folder(root, env);
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return null;
  } catch {
    // A folder that does not exist yet is no link.
  }
  return path.join(real(path.dirname(dir)), path.basename(dir));
}

// readHookInput returns the hook's input from stdin, or null when it is not a JSON object.
function readHookInput() {
  try {
    const data = JSON.parse(fs.readFileSync(0, 'utf8'));
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// deny returns the JSON that Claude Code and Codex read from a PreToolUse hook on stdout to
// deny a call: the reason goes to the model as the tool's error.
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse',
  permissionDecision: 'deny', permissionDecisionReason: reason } });

// run reads the hook's input and acts on its event. On PreToolUse it decides and prints the
// deny, or nothing to let the call run: first the step limit of step-limit.js, then before,
// such as reports-guard's, then decide. On Codex, it also appends the call to the calls of
// the step. On PostToolBatch, the end of a Claude Code step, and PreModelRequest, the start
// of a Codex step, it sets the count of the agent and prints nothing. A guard that throws on
// PreToolUse denies the call with the error, so a fault never opens the lock. In a run, input
// that is not JSON denies the call too.
function run({ runtime, before } = {}) {
  const input = readHookInput();
  const env = process.env;
  if (input === null) {
    if (env.QORY_RUN_ID) process.stdout.write(`${JSON.stringify(deny(NOT_JSON))}\n`);
    process.exitCode = 0;
    return;
  }
  const script = process.argv[1];
  const args = { input, env, runtime, root: steps.rootOf(runtime, env) };
  const stepEnd = input.hook_event_name === 'PostToolBatch' ||
    input.hook_event_name === 'PreModelRequest';
  if (!args.root) {
    // With no working folder, a run denies each call, and a step end counts nothing.
    if (env.QORY_RUN_ID && !stepEnd) process.stdout.write(`${JSON.stringify(deny(NO_ROOT))}\n`);
    process.exitCode = 0;
    return;
  }
  if (stepEnd) {
    const fault = (error) => process.stderr.write(`${CRASHED}${error && error.stack ? error.stack
      : String(error)}\n`);
    // An error while the step's calls are read still counts the step, as one that wrote
    // nothing.
    let wrote = false;
    let calls = [];
    try {
      if (input.hook_event_name === 'PostToolBatch') {
        const place = placeOf(input, args.root, env);
        const batch = Array.isArray(input.tool_calls) ? input.tool_calls : [];
        const denied = steps.takeDenied(args);
        wrote = batch.some((one) => one !== null && typeof one === 'object' &&
          !denied.has(one.tool_use_id) && countsAsWrite(one.tool_name, one.tool_input, place));
      } else {
        calls = steps.takeCalls(args);
        wrote = Boolean(calls) && calls.some((one) => one && one.write === true);
      }
    } catch (error) {
      fault(error);
    }
    try {
      if (calls === null) steps.stepWithoutCalls(args);
      else steps.endStep(args, wrote);
    } catch (error) {
      fault(error);
    }
    process.exitCode = 0;
    return;
  }
  let reason;
  try {
    const write = countsAsWrite(input.tool_name, input.tool_input,
      placeOf(input, args.root, env));
    reason = steps.limited(args, write) || (before && before(input)) ||
      decide({ input, env, script, root: args.root });
    // A denied call wrote nothing: on Codex its line has write false, and on Claude Code
    // PostToolBatch counts no write of a call whose id is in the denied file. A count
    // folder that cannot be written keeps the reason: limited reads that folder.
    try {
      if (runtime === 'codex') steps.appendCall(args, write && !reason);
      if (runtime === 'claude' && reason) steps.appendDenied(args, input.tool_use_id);
    } catch (error) {
      if (!steps.limited(args, false)) throw error;
    }
  } catch (error) {
    reason = `${CRASHED}${error && error.stack ? error.stack : String(error)}`;
  }
  if (reason) process.stdout.write(`${JSON.stringify(deny(reason))}\n`);
  process.exitCode = 0;
}

module.exports = { decide, lockedFiles, patchPaths, countsAsWrite, deny, run };
