// The step limit of an agent that writes files, which the adapters of tool-guard.js run in
// a run, when QORY_RUN_ID is set. After LIMIT steps in a row that write no file and push no
// artifact, the guard denies each call of the agent except a write, until a step writes. A
// step is one model step: one answer of the model with its calls, however many run at once.
// A step writes when one of its calls writes a file below the working folder outside .qory/,
// or in the artifact folder (.qory/artifacts or /tmp/qory-artifacts), or pushes an
// artifact, as countsAsWrite of tool-guard.js reads it. The main session,
// whose input has no agent_id, and a read-only agent on Claude Code are exempt: their stop is
// the time limit and the end check. A read-only agent is one whose file
// $QORY_HARNESS_HOME/modules/<module>/agents/<name>.md has a `tools` key that lists tools,
// none of them in WRITING; readOnly reads the name from agent_type. On Codex, every agent
// counts, because apply_patch writes in every role.
//
// The count of an agent is in <root>/.qory/build/steps/<session_id>--<agent_id>.json, where
// root is the working folder of the run. The guard denies an agent's write to .qory/build/,
// so only this file's code changes the count. A count file that exists but cannot be read,
// or that writable reports cannot be written, counts as LIMIT, and so does a missing count
// file of an agent with the marker file <session_id>--<agent_id>.seen, which save writes
// beside the count. A new agent, with
// neither file, starts at 0. Only the event at the end of a step changes the count, and
// PreToolUse only reads it:
// - Claude Code fires PostToolBatch once per step, in an agent too, with agent_id,
//   agent_type and tool_calls, every call of the step, a call that the guard denied
//   included. A step that only returns the report fires it; a last step with text alone
//   fires none. PreToolUse appends the tool_use_id of each call it denies to
//   <session_id>--<agent_id>.denied, and PostToolBatch counts no write of those calls, so
//   a write that the guard denied does not reset the count.
// - Codex fires PreModelRequest before each model request, with agent_id and agent_type in an
//   agent. PreToolUse appends one line per call to <session_id>--<agent_id>.calls, so calls
//   at once do not race; PreModelRequest reads the lines of the step before it, sets the
//   count and removes the file. A step with no line, such as the first request of a turn,
//   counts as a step that wrote nothing; the first request of a new agent sets its count
//   to 0.
// An error while the end of a step reads its calls still counts the step, as one that
// wrote nothing. PostToolBatch saves that count before it reads the calls, so a hook process
// that ends while it reads them, as when it runs out of memory, leaves the step counted too.
// end-gate-claude.js and end-gate-codex.js remove the files of the session when it ends.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The steps in a row that write nothing, after which the guard denies all but a write.
const LIMIT = 12;
const REASON = `Write your output now: ${LIMIT} steps in a row wrote nothing.\n` +
  'A write or `qory artifact push` resets the count; until then every other call is denied.';
// The first line of the deny when the count cannot be written, so that it cannot go up.
const UNWRITABLE = 'Report to a member: the step limit cannot write the step count of this ' +
  'agent.\nThe count folder is ';
// The tools whose presence in an agent's `tools` key make it an agent that may write.
const WRITING = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'apply_patch']);
// The prefix of an agent of the harness's Claude Code plugin in agent_type.
const PLUGIN = 'harness:';
// The folder of the counts, below the working folder, in the folder that the guard keeps
// agents from writing.
const STEPS = path.join('.qory', 'build', 'steps');

// safe returns text as a part of a file name.
const safe = (text) => String(text).replace(/[^A-Za-z0-9_.-]/g, '_');

// folderOf returns the folder of the counts of a session in the working folder root.
const folderOf = (root) => path.join(root, STEPS);

// filesOf returns { count, calls }, the files of the agent of input below root, or null for
// the main session.
function filesOf(root, input) {
  if (typeof input.agent_id !== 'string' || input.agent_id === '') return null;
  const base = path.join(folderOf(root), `${safe(input.session_id || 'session')}--` +
    `${safe(input.agent_id)}`);
  return { count: `${base}.json`, calls: `${base}.calls`, denied: `${base}.denied`,
    seen: `${base}.seen` };
}

// readOnly reports whether the agent of agent_type has a `tools` key that lists tools, none
// of them in WRITING, in its file under <home>/modules/*/agents/, where home is the composed
// harness. Only on Claude Code, where agent_type is PLUGIN and the name: a bare name can also
// be an agent of the project, so it may write. On Codex, every role can run apply_patch,
// whatever its file lists, so no agent is read-only. The key lists its tools on its line,
// split by commas, or as a YAML list on the lines after it. An agent with no file, no `tools`
// key or an empty list may write. When the home or the agent's file lies below root, the
// working folder, the file must lie in the real folder of the home, below root, where
// tool-guard.js denies each write; else an agent could edit its `tools` key.
function readOnly(home, agentType, runtime, root) {
  if (typeof home !== 'string' || home === '') return false;
  if (typeof agentType !== 'string' || agentType === '') return false;
  if (runtime !== 'claude' || !agentType.startsWith(PLUGIN)) return false;
  const name = agentType.slice(PLUGIN.length);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return false;
  let modules;
  try {
    modules = fs.readdirSync(path.join(home, 'modules')).sort();
  } catch {
    return false;
  }
  for (const module of modules) {
    let text;
    try {
      text = fs.readFileSync(path.join(home, 'modules', module, 'agents', `${name}.md`), 'utf8');
    } catch {
      continue;
    }
    if (!guarded(home, path.join(home, 'modules', module, 'agents', `${name}.md`), root)) {
      return false;
    }
    const front = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const tools = front && toolsOf(front[1]);
    return Boolean(tools && tools.length) && !tools.some((one) => WRITING.has(one));
  }
  return false;
}

// guarded reports whether an agent cannot change file, the file of an agent under home: home
// and file lie outside root, or file lies in homeBelow(home, root).
function guarded(home, file, root) {
  const inside = (full) => typeof root === 'string' && root !== '' &&
    (full === root || full.startsWith(`${root}${path.sep}`));
  let real;
  try {
    real = fs.realpathSync.native(file);
  } catch {
    return false;
  }
  const denied = homeBelow(home, root);
  if (denied) return real.startsWith(`${denied}${path.sep}`);
  return !inside(real) && !inside(path.resolve(home));
}

// homeBelow returns the real folder of home when it lies below root, the working folder,
// where tool-guard.js denies each write, else null.
function homeBelow(home, root) {
  if (typeof home !== 'string' || home === '' || typeof root !== 'string' || root === '') {
    return null;
  }
  let real;
  try {
    real = fs.realpathSync.native(home);
  } catch {
    return null;
  }
  return real === root || real.startsWith(`${root}${path.sep}`) ? real : null;
}

// toolsOf returns the tools that the `tools` key of front matter lists, or null with no key:
// `tools: Read, Grep`, `tools: [Read, Grep]`, or `tools:` with `- Read` on each line after.
function toolsOf(front) {
  const lines = front.split(/\r?\n/);
  const at = lines.findIndex((line) => /^tools:/.test(line));
  if (at < 0) return null;
  const strip = (one) => one.trim().replace(/^['"]|['"]$/g, '');
  const inline = lines[at].slice('tools:'.length).replace(/#.*$/, '').trim();
  if (inline !== '') {
    return inline.replace(/^\[|\]$/g, '').split(',').map(strip).filter(Boolean);
  }
  const tools = [];
  for (const line of lines.slice(at + 1)) {
    const item = /^[ \t]*-[ \t]+(.*)$/.exec(line);
    if (!item) break;
    tools.push(strip(item[1].replace(/#.*$/, '')));
  }
  return tools.filter(Boolean);
}

// counted returns the files of the agent of input when its steps count: in a run, in an
// agent that may write. The composed harness is at QORY_HARNESS_HOME, root is the working
// folder, and runtime is claude or codex.
function counted({ input, env, root, runtime }) {
  if (!env.QORY_RUN_ID) return null;
  const files = filesOf(root, input);
  if (!files || readOnly(env.QORY_HARNESS_HOME, input.agent_type, runtime, root)) return null;
  return files;
}

// count returns the steps in a row that wrote nothing, from the count file of files: 0 when
// the agent is new, with no count file and no marker file, and LIMIT when the count file is
// missing for an agent with a marker, cannot be read or has no count, so that a lost or
// broken file limits the agent.
function count(files) {
  let text;
  try {
    text = fs.readFileSync(files.count, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT' && !fs.existsSync(files.seen)) return 0;
    return LIMIT;
  }
  try {
    const value = JSON.parse(text).steps;
    return Number.isInteger(value) && value >= 0 ? value : LIMIT;
  } catch {
    return LIMIT;
  }
}

// save writes steps to the count file of files, through a file beside it that it then
// renames, so that a read of the count returns the old or the new content, never a part of
// one. It also writes the marker file of the agent.
function save(files, steps) {
  fs.mkdirSync(path.dirname(files.count), { recursive: true });
  if (!fs.existsSync(files.seen)) fs.writeFileSync(files.seen, '');
  const part = `${files.count}.${process.pid}`;
  fs.writeFileSync(part, `${JSON.stringify({ steps })}\n`);
  fs.renameSync(part, files.count);
}

// writable reports whether save can write the count of files: the folder of the counts, or
// the nearest folder above it that exists, takes new files, and the count and marker files
// that exist can be written.
function writable(files) {
  let dir = path.dirname(files.count);
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  try {
    fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
    for (const file of [files.count, files.seen]) {
      if (fs.existsSync(file)) fs.accessSync(file, fs.constants.W_OK);
    }
    return true;
  } catch {
    return false;
  }
}

// limited returns, for a call that writes nothing, UNWRITABLE when the count of the agent of
// input cannot be written, so that it cannot go up, and REASON when the agent reached LIMIT;
// else null. write reports whether the call writes.
function limited(args, write) {
  const files = counted(args);
  if (!files || write) return null;
  if (!writable(files)) {
    return `${UNWRITABLE}${path.dirname(files.count)}; until it can be written, each call ` +
      'that writes nothing is denied.';
  }
  return count(files) >= LIMIT ? REASON : null;
}

// endStep sets the count of the agent of input at the end of a step: 0 when wrote, else one
// more. It returns the new count, or null when the agent is exempt. When the save fails, it
// removes the count file, so that the marker limits the agent, and throws the error.
function endStep(args, wrote) {
  const files = counted(args);
  if (!files) return null;
  const steps = wrote ? 0 : count(files) + 1;
  try {
    save(files, steps);
  } catch (error) {
    try {
      fs.rmSync(files.count, { force: true });
    } catch {
      // The folder cannot be written either, and limited reads that.
    }
    throw error;
  }
  return steps;
}

// stepWithoutCalls sets the count at a Codex step with no line of a call: 0 for a new agent,
// with no count file and no marker file, else one more, as a step that wrote nothing.
function stepWithoutCalls(args) {
  const files = counted(args);
  if (!files) return null;
  if (!fs.existsSync(files.count) && !fs.existsSync(files.seen)) {
    save(files, 0);
    return 0;
  }
  return endStep(args, false);
}

// appendCall adds the line of one call of a Codex step: write reports whether it writes.
function appendCall(args, write) {
  const files = counted(args);
  if (!files) return;
  fs.mkdirSync(path.dirname(files.calls), { recursive: true });
  fs.appendFileSync(files.calls, `${JSON.stringify({ write })}\n`);
}

// appendDenied adds id, the tool_use_id of a Claude Code call that the guard denied.
function appendDenied(args, id) {
  const files = counted(args);
  if (!files || typeof id !== 'string' || id === '') return;
  fs.mkdirSync(path.dirname(files.denied), { recursive: true });
  fs.appendFileSync(files.denied, `${JSON.stringify(id)}\n`);
}

// takeDenied returns the set of tool_use_ids that the guard denied in the Claude Code step
// that ended, and removes them.
function takeDenied(args) {
  const files = counted(args);
  if (!files) return new Set();
  let text;
  try {
    text = fs.readFileSync(files.denied, 'utf8');
  } catch {
    return new Set();
  }
  fs.rmSync(files.denied, { force: true });
  return new Set(text.split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }));
}

// takeCalls returns the lines of the calls of the Codex step that ended, and removes them, or
// null when the step had no call or the agent is exempt.
function takeCalls(args) {
  const files = counted(args);
  if (!files) return null;
  let text;
  try {
    text = fs.readFileSync(files.calls, 'utf8');
  } catch {
    return null;
  }
  fs.rmSync(files.calls, { force: true });
  return text.split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { write: false };
    }
  });
}

// rootOf returns the working folder of the run, read through its links and in the case of
// its name on the disk, or null when none is known. It never reads the cwd of the hook's
// input, which on Codex is the folder that the model gives a shell call
// (core/src/tools/handlers/unified_exec/exec_command.rs:349-364 of Codex 0.167.2):
// - on Claude Code, CLAUDE_PROJECT_DIR, which Claude Code sets for each hook;
// - on Codex, start, the folder that the hook process runs in. Codex runs every hook in the
//   folder of the session (core/src/hook_runtime.rs:264-269,
//   hooks/src/engine/command_runner.rs:281).
function rootOf(runtime, env, start = process.cwd()) {
  let dir = null;
  if (runtime === 'claude') dir = env.CLAUDE_PROJECT_DIR;
  else if (runtime === 'codex') dir = start;
  if (typeof dir !== 'string' || dir === '') return null;
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return null;
  }
}

// clear removes the counts of session_id in the working folder root.
function clear(root, session) {
  const dir = folderOf(root);
  const prefix = `${safe(session || 'session')}--`;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(prefix)) fs.rmSync(path.join(dir, entry), { force: true });
  }
}

module.exports = { LIMIT, REASON, UNWRITABLE, readOnly, limited, endStep, stepWithoutCalls,
  appendCall, takeCalls, appendDenied, takeDenied, clear, folderOf, rootOf, homeBelow };
