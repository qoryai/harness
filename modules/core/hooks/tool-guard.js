// The guard of a run's tool calls that the adapters for Claude Code and Codex share. Each
// runtime runs tool-guard-<runtime>.js before each tool call, and at each step of an agent
// for the step limit of step-limit.js. Only in a run, when QORY_RUN_ID is set, decide denies:
// - an agent started in the background, on Claude Code: an Agent or Task call with
//   run_in_background true. Codex starts every agent with spawn_agent, which returns at
//   once and has no such key, so decide lets spawn_agent run;
// - a write to a path under .qory/build/, where checks.js keeps the build ledger and
//   step-limit.js the step counts;
// - a write to a path that the lock lists, as checks.js lock --verify reads the lock;
// - a write from the main session, a call whose input has no agent_id, outside the
//   artifact folder. Both runtimes set agent_id only in a call of an agent that the session
//   started.
// A write is a call of Write, Edit, MultiEdit or NotebookEdit, or a Codex apply_patch, with
// the paths of its file_path, notebook_path or patch; or a shell command whose text contains
// the path and writes, as WRITERS reads it. decide reads a shell command as text and runs no
// shell, so a write whose path the text does not contain, as in `D=lock; echo x > ${D}ed/f`,
// passes; lock --verify and the push check keep the lock for that write. No rule covers
// qory.yaml, .qory/ outside .qory/build/, the hooks or the modules: agents may change them.
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
const LINKED = 'Replace the link at the artifact folder with a folder: a link is no artifact ' +
  'folder.\nThe main session writes only in the artifact folder, and ';
const NO_ROOT = 'Start the session through qory: the tool guard found no working folder of ' +
  'the run.\nOn Claude Code it reads CLAUDE_PROJECT_DIR, and on Codex the folder of the hook.';
const NOT_JSON = 'Report this error in your output: the tool guard got hook input that is ' +
  'not JSON.\nIn a run, the guard denies a call whose input it cannot read.';

// The commands that write the files they name.
const WRITERS = new Set(['tee', 'cp', 'mv', 'rm', 'rmdir', 'unlink', 'touch', 'ln', 'install',
  'truncate', 'dd', 'chmod', 'chown', 'mkdir', 'rsync', 'patch']);
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
  sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T'], nohup: [],
  time: ['-f', '--format', '-o', '--output'], stdbuf: ['-i', '-o', '-e'],
  xargs: ['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '--arg-file', '--delimiter',
    '--max-args', '--max-procs', '--max-chars', '--max-lines', '--replace', '--eof'],
  doas: ['-u', '-C'], ionice: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata'],
  busybox: [] };
// The commands that change only folders or the mode of files, which the step count reads
// as no write.
const FOLDER_ONLY = new Set(['mkdir', 'rmdir', 'chmod', 'chown']);
// The commands that write only their last path, as cp writes the copy and reads the rest.
const LAST_WRITTEN = new Set(['cp', 'install', 'ln', 'rsync']);
// The words that open a group, or the then, do or else part, before a command, as in
// `{ cp a b; }`.
const GROUPS = new Set(['{', '}', 'then', 'do', 'else', '!']);
// A redirect that writes a file: > or >>, also after & or a digit, but no >& to a stream.
const REDIRECT = /(?:^|[^>])>>?(?![>&])/;
// A sed or perl that edits its files in place.
const IN_PLACE = /^(?:sed|perl)$/;

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

// real returns full with each part that exists read through its links, in the case of its
// name on the disk, so that /tmp/x and /private/tmp/x are one path on macOS, and so are
// Checks/a.ts and checks/a.ts on a disk that ignores case.
function real(full) {
  const rest = [];
  for (let at = path.resolve(full); ; at = path.dirname(at)) {
    try {
      return path.join(fs.realpathSync.native(at), ...rest.reverse());
    } catch {
      if (path.dirname(at) === at) return path.resolve(full);
      rest.push(path.basename(at));
    }
  }
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
    out.push(...commands(text, depth + 1));
  }
  return out;
}

// unquote returns word without a quote at its start or end.
const unquote = (word) => word.replace(/^['"]|['"]$/g, '');

// commandWords returns { words, dirs } of a simple command: words are the words from the
// command that runs, without the NAME=value words that set variables, the words of GROUPS,
// and each word of PREFIXES with its options and, for timeout, its time. dirs are the folders
// that `env -C <folder>` or `env --chdir=<folder>` runs the command in.
function commandWords(words) {
  const dirs = [];
  let at = 0;
  while (at < words.length) {
    const word = unquote(words[at]);
    if (GROUPS.has(word) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      at += 1;
      continue;
    }
    const prefix = path.basename(word);
    if (!Object.hasOwn(PREFIXES, prefix)) break;
    at += 1;
    while (at < words.length && words[at].startsWith('-')) {
      const option = unquote(words[at]);
      if (prefix === 'env' && (option === '-C' || option === '--chdir')) {
        dirs.push(unquote(words[at + 1] || ''));
      }
      if (prefix === 'env' && option.startsWith('--chdir=')) dirs.push(option.slice(8));
      at += PREFIXES[prefix].includes(words[at]) ? 2 : 1;
    }
    if (prefix === 'timeout') at += 1;
  }
  return { words: words.slice(at), dirs };
}

// segments returns the simple commands of a shell command and of the text of each shell in it
// that commands finds: each text split at ; & | ( ) ` and line breaks, but not at the | of the
// redirect >|, so that a group such as `( cp a b )` or `$(cp a b)` reads as its command, each
// as { text, words, cwds, sure }. words are the words that commandWords keeps, cwds the known
// folders that the command can run in, as folders finds them from cwd, and sure reports
// whether cwds are all its folders.
function segments(command, cwd = process.cwd()) {
  const parts = commands(command)
    .flatMap((one) => one.replace(/>\|/g, '>').split(/[;&|\n()`]+/))
    .map((text) => ({ text, ...commandWords(text.trim().split(/\s+/).filter(Boolean)) }))
    .filter((one) => one.words.length);
  const from = folders(parts, cwd);
  return parts.map(({ text, words, dirs }) => {
    const all = [...dirs, ...toolDirs(words)];
    const known = all.filter((dir) => !vague(dir));
    const cwds = from.list.map((one) => known.reduce((at, dir) => path.resolve(at, dir), one));
    return { text, words, cwds, sure: from.sure && known.length === all.length };
  });
}

// The commands that change the folder of the commands after them.
const CD = new Set(['cd', 'pushd', 'popd']);
// The most folders that folders follows.
const FOLDERS = 16;

// vague reports whether the folder or file of word is unknown before the shell runs: it
// starts with ~, contains $ or a backtick, is - for the folder before, or is empty.
const vague = (word) => word === '' || word === '-' || word.startsWith('~') || /[$`]/.test(word);

// folders returns { list, sure } of the folders that the commands of parts can run in: list
// has cwd and each folder that a cd or pushd in parts changes to, from each folder before it,
// since a cd can fail, run in a group, or not run at all. sure is false when a folder is
// unknown: after a cd to a vague folder or to the home, a popd, or past FOLDERS folders.
function folders(parts, cwd) {
  let list = [cwd];
  let sure = true;
  for (const { words } of parts) {
    const tool = path.basename(unquote(words[0]));
    if (!CD.has(tool)) continue;
    const to = words.slice(1).map(unquote).find((word) => !/^-[LPe@]+$/.test(word) &&
      word !== '--');
    if (tool === 'popd' || to === undefined || vague(to)) {
      sure = false;
      continue;
    }
    const more = [...new Set([...list, ...list.map((one) => path.resolve(one, to))])];
    if (more.length > FOLDERS) sure = false;
    else list = more;
  }
  return { list, sure };
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
  const flags = nocase ? 'i' : '';
  const at = new RegExp(`(^|[\\s'"=(:>])(\\./)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` +
    '(?=$|[\\s\'")<>;|&/])', flags);
  if (!at.test(segment.text)) return false;
  const [first] = segment.words;
  const tool = path.basename(first.replace(/^['"]|['"]$/g, ''));
  if (WRITERS.has(tool) || subWrites(segment.words)) return true;
  if (IN_PLACE.test(tool) && segment.words.some((word) => /^-[A-Za-z]*i/.test(word))) return true;
  const target = new RegExp(`>>?\\s*['"]?(\\./)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    flags);
  return REDIRECT.test(segment.text) && target.test(segment.text);
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
  if (IN_PLACE.test(tool) && segment.words.some((word) => /^-[A-Za-z]*i/.test(word))) return true;
  if (tool === 'qory' && second === 'artifact' && third === 'push') return true;
  return redirectTargets(segment).length > 0;
}

// redirectTargets returns the files that the redirects of a simple command write.
function redirectTargets(segment) {
  if (!REDIRECT.test(segment.text)) return [];
  return [...segment.text.matchAll(/(?:^|[^>0-9&])&?[0-9]?>>?(?![>&])\s*(\S*)/g)]
    .map((match) => match[1]).filter((target) => target !== '' && !NO_FILE.test(target))
    .map(unquote);
}

// pathWords returns the words of a simple command that can be paths that it writes: the
// targets of its redirects and, for a command of WRITERS, a subcommand of SUB_WRITERS or
// sed -i or perl -i, the words after the tool and its subcommand, and the value of an
// option or of a word with =, as in dd of=<path>. It leaves out the script of sed and perl.
function pathWords(segment) {
  const words = segment.words.map(unquote);
  const tool = path.basename(words[0]);
  const sub = subWrites(segment.words) ? subIndex(words) : -1;
  const out = redirectTargets(segment);
  const inPlace = IN_PLACE.test(tool) && words.some((word) => /^-[A-Za-z]*i/.test(word));
  if (!WRITERS.has(tool) && sub < 0 && !inPlace) return out;
  let script = tool === 'sed' && !words.some((word) => /^(?:-e|--expression|-f|--file)/.test(word));
  // The words before a subcommand are the tool's options, as in `<tool> -C <folder> rm`.
  for (let at = sub > 0 ? sub + 1 : 1; at < words.length; at += 1) {
    const word = words[at];
    if (IN_PLACE.test(tool) && (word === '-e' || word === '-f' || word === '--expression' ||
      (tool === 'perl' && /^-[A-Za-z]*e$/.test(word)))) {
      at += 1;
      continue;
    }
    const equal = word.indexOf('=');
    if (word.startsWith('-') || /^[A-Za-z_]+=/.test(word)) {
      if (equal > 0) out.push(word.slice(equal + 1));
      continue;
    }
    if (script) {
      script = false;
      continue;
    }
    out.push(word);
  }
  return out;
}

// pathHits reports whether a simple command that writes changes full, as its words read once
// each is resolved from a folder of the command's cwds: a word that is full, or below full
// when folder is true, or a folder above full for a command of REMOVERS or, when full is a
// file, a restore or a checkout of a path. A checkout with no `--` reads a word as a path only
// when it exists, so `checkout .` is one and `checkout <name>` of a name that is no path is
// not. fold and realOf compare and resolve paths.
function pathHits(segment, full, folder, { fold, realOf }) {
  const words = segment.words.map(unquote);
  const sub = subWrites(segment.words) ? words[subIndex(words)] : null;
  const remover = REMOVERS.has(path.basename(words[0])) || REMOVERS.has(sub);
  const restorer = sub === 'restore' || sub === 'checkout';
  const named = sub !== 'checkout' || words.includes('--');
  const target = fold(full);
  const base = path.basename(target);
  return pathWords(segment).some((word) => segment.cwds.some((cwd) => {
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
// chmod, chown and a checkout with no `--` count as no write, and of cp, install, ln and
// rsync only the last path counts. A relative path of a shell command counts only when it
// counts from every folder that the command can run in, after a cd, -C or env -C.
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
  const work = (word, from = [cwd], sure = true) => (path.isAbsolute(word) ? place(word)
    : sure && from.every((one) => place(path.resolve(one, word))));
  if (Object.hasOwn(WRITE_TOOLS, name)) {
    return WRITE_TOOLS[name].some((key) => typeof args[key] === 'string' && args[key] !== '' &&
      work(args[key]));
  }
  if (name === 'apply_patch') return patchPaths(args.command || '').some((one) => work(one));
  if (name !== 'Bash') return false;
  const command = String(args.command || '');
  if (command.includes(PATCH) && patchPaths(command).some((one) => work(one))) return true;
  return segments(command, cwd).some((segment) => {
    const at = (word) => !vague(word) && work(word, segment.cwds, segment.sure);
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
  if (call.kind === 'shell') {
    const reason = shellReason(call.command, { cwd, root, lockOf, nocase });
    if (reason || !paths.length) return reason;
  }
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

// shellReason returns the reason to deny a shell command: it writes .qory/build/ or a file of
// the lock, as its text shows. lockOf returns the files of the lock; with nocase, a name
// matches in any case.
function shellReason(command, { cwd, root, lockOf, nocase }) {
  const parts = segments(command, cwd).filter(segmentWrites);
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
  if (hit(path.join(root, BUILD), true) || parts.some((one) => writes(one, BUILD, nocase))) {
    return `${BUILT}The command writes .qory/build/.`;
  }
  const { files = [], what, problem, type } = lockOf();
  if (problem) return unread({ type, problem });
  const file = files.find((full) => hit(full, false));
  return file ? lockedReason(file, root, what) : null;
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
    // PostToolBatch counts no write of a call whose id is in the denied file.
    if (runtime === 'codex') steps.appendCall(args, write && !reason);
    if (runtime === 'claude' && reason) steps.appendDenied(args, input.tool_use_id);
  } catch (error) {
    reason = `${CRASHED}${error && error.stack ? error.stack : String(error)}`;
  }
  if (reason) process.stdout.write(`${JSON.stringify(deny(reason))}\n`);
  process.exitCode = 0;
}

module.exports = { decide, lockedFiles, patchPaths, countsAsWrite, deny, run };
