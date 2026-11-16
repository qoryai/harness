// The guard of a run's tool calls that the adapters for Claude Code and Codex share. Each
// runtime runs tool-guard-<runtime>.js before each tool call, and at each step of an agent
// for the step limit of step-limit.js. Only in a run, when QORY_RUN_ID is set, decide denies:
// - an agent started in the background, on Claude Code: an Agent or Task call with
//   run_in_background true. Codex starts every agent with spawn_agent, which returns at
//   once and has no such key, so decide lets spawn_agent run;
// - a write to a path under .qory/build/, where checks.js keeps the build ledger;
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

const { readInput, folder } = require('./end-gate.js');
const steps = require('./step-limit.js');

// The tools that write files, with the keys of their input that contain a path.
const WRITE_TOOLS = { Write: ['file_path'], Edit: ['file_path'], MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'] };
// The tools that start an agent on Claude Code.
const AGENT_TOOLS = new Set(['Agent', 'Task']);
// A line of a Codex patch that names a file it adds, changes, deletes or moves to.
const PATCH_FILE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
// The folder of the build ledger, below the working folder.
const BUILD = path.join('.qory', 'build');
// The first line of a Codex patch, which apply_patch also takes through the shell.
const PATCH = '*** Begin Patch';

// The first line of each deny starts with what to do and has at most 100 characters.
const BACKGROUND = 'Start the agent with run_in_background false, or leave the key out.\n' +
  'A run waits for each agent it starts, so it allows no agent in the background.';
const BUILT = 'Leave .qory/build/ to checks.js: it writes the build ledger there.\n';
const MAIN = 'Start an agent to change this file: the main session of a run changes no ' +
  'file here.\nThe main session writes only in the artifact folder, ';
const UNREAD = 'Run `qory artifact pull`, then try again: the guard could not read the lock.\n';
const CRASHED = 'Send this error to the harness maintainers: the tool guard crashed.\n';

// The commands that write the files they name.
const WRITERS = new Set(['tee', 'cp', 'mv', 'rm', 'rmdir', 'unlink', 'touch', 'ln', 'install',
  'truncate', 'dd', 'chmod', 'chown', 'mkdir', 'rsync', 'patch']);
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

// real returns full with each part that exists read through its links, so that
// /tmp/x and /private/tmp/x are one path on macOS.
function real(full) {
  const rest = [];
  for (let at = path.resolve(full); ; at = path.dirname(at)) {
    try {
      return path.join(fs.realpathSync(at), ...rest.reverse());
    } catch {
      if (path.dirname(at) === at) return path.resolve(full);
      rest.push(path.basename(at));
    }
  }
}

const under = (full, dir) => full === dir || full.startsWith(`${dir}${path.sep}`);

// lockedFiles returns { what, files } of the lock that counts: files are the real paths of
// the files it lists under root, the working folder. It returns { files: [] } when no type
// of the registry has a lock, or no version of it counts, and { problem } when the lock
// cannot be read. It reads the lock with checks.js's reader: in a run, it pulls the lock.
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
      return lock.differs ? { problem: `The stored ${lock.what} differs from index.json.` }
        : { files: [] };
    }
    return { what: lock.what, files: lock.files.filter((one) => !one.problem)
      .map((one) => real(path.resolve(root, one.folder || '.', one.path))) };
  } catch (error) {
    if (error instanceof base.Missing) return { problem: error.message };
    throw error;
  }
}

// segments returns the simple commands of a shell command: its text split at ; & | and
// line breaks, each as { text, words }.
function segments(command) {
  return command.split(/[;&|\n]+/).map((text) => ({ text,
    words: text.trim().split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) }))
    .filter((one) => one.words.length);
}

// writes reports whether a simple command writes a file and contains name: a redirect to
// name, a command of WRITERS, or sed -i or perl -i.
function writes(segment, name) {
  const at = new RegExp(`(^|[\\s'"=(:])(\\./)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` +
    '(?=$|[\\s\'")<>;|&/])');
  if (!at.test(segment.text)) return false;
  const [first] = segment.words;
  const tool = path.basename(first.replace(/^['"]|['"]$/g, ''));
  if (WRITERS.has(tool)) return true;
  if (IN_PLACE.test(tool) && segment.words.some((word) => /^-[A-Za-z]*i/.test(word))) return true;
  const target = new RegExp(`>>?\\s*['"]?(\\./)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  return REDIRECT.test(segment.text) && target.test(segment.text);
}

// A redirect target that is no file.
const NO_FILE = /^['"]?\/dev\/(?:null|stdout|stderr|tty)['"]?$/;

// segmentWrites reports whether a simple command writes a file, whichever file: it runs a
// command of WRITERS, sed -i or perl -i, `qory artifact push`, or has a redirect to a file.
function segmentWrites(segment) {
  const [first, second, third] = segment.words.map((word) => word.replace(/^['"]|['"]$/g, ''));
  const tool = path.basename(first);
  if (WRITERS.has(tool)) return true;
  if (IN_PLACE.test(tool) && segment.words.some((word) => /^-[A-Za-z]*i/.test(word))) return true;
  if (tool === 'qory' && second === 'artifact' && third === 'push') return true;
  if (!REDIRECT.test(segment.text)) return false;
  const targets = [...segment.text.matchAll(/(?:^|[^>0-9&])&?[0-9]?>>?(?![>&])\s*(\S*)/g)]
    .map((match) => match[1]);
  return targets.some((target) => target !== '' && !NO_FILE.test(target));
}

// writesFiles reports whether a call writes a file, as the guard and the step count read it:
// a call of Write, Edit, MultiEdit, NotebookEdit or apply_patch, or a Bash command with a
// Codex patch or with a simple command that segmentWrites flags. name is the tool_name of
// the hook's input, and input its tool_input.
function writesFiles(name, input) {
  const args = input !== null && typeof input === 'object' ? input : {};
  if (Object.hasOwn(WRITE_TOOLS, name) || name === 'apply_patch') return true;
  if (name !== 'Bash') return false;
  const command = String(args.command || '');
  return command.includes(PATCH) || segments(command).some(segmentWrites);
}

// names returns the ways a shell command can write full: its path, and its path from cwd and
// from root when it lies below them.
function names(full, cwd, root) {
  const out = new Set([full]);
  for (const from of [cwd, root]) {
    const relative = path.relative(from, full);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) out.add(relative);
  }
  return [...out];
}

// decide returns the reason to deny a call, or null to let it run. input is the hook's input:
// tool_name, tool_input, cwd and, in an agent's call, agent_id. root is the working folder of
// the run, where qory starts the session: CLAUDE_PROJECT_DIR on Claude Code, else cwd. locked
// returns the files of the lock, as lockedFiles does; it runs only for a write below root.
function decide({ input, env = process.env, script = process.argv[1], locked }) {
  if (!env.QORY_RUN_ID) return null;
  const call = kindOf(input.tool_name, input.tool_input);
  if (call.kind === 'agent') return call.reason;
  if (call.kind !== 'write' && call.kind !== 'shell') return null;
  const cwd = real(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd());
  const root = real(env.CLAUDE_PROJECT_DIR || cwd);
  const build = path.join(root, BUILD);
  let lock = null;
  const lockOf = () => {
    if (lock === null) {
      lock = (locked || ((args) => lockedFiles(args)))({ root, env, script });
    }
    return lock;
  };
  const paths = call.paths.map((one) => real(path.resolve(cwd, one)));
  if (call.kind === 'shell') {
    const reason = shellReason(call.command, { cwd, root, lockOf });
    if (reason || !paths.length) return reason;
  }
  const built = paths.find((full) => under(full, build) ||
    full.includes(`${path.sep}${BUILD}${path.sep}`));
  if (built) return `${BUILT}The call writes ${built}.`;
  if (paths.some((full) => under(full, root))) {
    const { files = [], what, problem } = lockOf();
    if (problem) return `${UNREAD}${problem}`;
    const file = paths.find((full) => files.includes(full));
    if (file) return lockedReason(file, root, what);
  }
  const agent = typeof input.agent_id === 'string' && input.agent_id !== '';
  if (agent) return null;
  const artifacts = real(folder(cwd, env));
  const outside = paths.find((full) => !under(full, artifacts));
  return outside ? `${MAIN}${artifacts}; this call writes ${outside}.` : null;
}

// shellReason returns the reason to deny a shell command: it writes .qory/build/ or a file of
// the lock, as its text shows. lockOf returns the files of the lock.
function shellReason(command, { cwd, root, lockOf }) {
  const parts = segments(command);
  const hit = (full) => names(full, cwd, root).some((name) =>
    parts.some((one) => writes(one, name)));
  if (parts.some((one) => writes(one, BUILD))) return `${BUILT}The command writes .qory/build/.`;
  if (!parts.some(segmentWrites)) return null;
  const { files = [], what, problem } = lockOf();
  if (problem) return `${UNREAD}${problem}`;
  const file = files.find(hit);
  return file ? lockedReason(file, root, what) : null;
}

// lockedReason returns the deny of a write to file, which the lock what lists.
function lockedReason(file, root, what) {
  const shown = under(file, root) ? path.relative(root, file) : file;
  return `Leave ${shown} as it is: ${what} locks it.\n` +
    'A change to a locked file fails checks.js lock --verify, and the push check refuses it.';
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
// PreToolUse denies the call with the error, so a fault never opens the lock.
function run({ runtime, before } = {}) {
  const input = readInput();
  const env = process.env;
  const script = process.argv[1];
  const args = { input, env, home: path.resolve(path.dirname(script), '..'),
    root: steps.rootOf(input, env) };
  if (input.hook_event_name === 'PostToolBatch' || input.hook_event_name === 'PreModelRequest') {
    try {
      if (input.hook_event_name === 'PostToolBatch') {
        const calls = Array.isArray(input.tool_calls) ? input.tool_calls : [];
        const denied = steps.takeDenied(args);
        steps.endStep(args, calls.some((one) => one !== null && typeof one === 'object' &&
          !denied.has(one.tool_use_id) && writesFiles(one.tool_name, one.tool_input)));
      } else {
        const calls = steps.takeCalls(args);
        if (calls) steps.endStep(args, calls.some((one) => one && one.write === true));
      }
    } catch (error) {
      process.stderr.write(`${CRASHED}${error && error.stack ? error.stack : String(error)}\n`);
    }
    process.exitCode = 0;
    return;
  }
  let reason;
  try {
    const write = writesFiles(input.tool_name, input.tool_input);
    reason = steps.limited(args, write) || (before && before(input)) ||
      decide({ input, env, script });
    // A denied call wrote nothing: on Codex its line says so, and on Claude Code its id
    // keeps PostToolBatch from counting it.
    if (runtime === 'codex') steps.appendCall(args, write && !reason);
    if (runtime === 'claude' && reason) steps.appendDenied(args, input.tool_use_id);
  } catch (error) {
    reason = `${CRASHED}${error && error.stack ? error.stack : String(error)}`;
  }
  if (reason) process.stdout.write(`${JSON.stringify(deny(reason))}\n`);
  process.exitCode = 0;
}

module.exports = { decide, lockedFiles, patchPaths, writesFiles, deny, run };
