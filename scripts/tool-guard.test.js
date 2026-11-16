// Tests of the guard of a run's tool calls, modules/core/hooks/tool-guard.js, with the hook
// input of Claude Code and of Codex. The Codex inputs are those that Codex 0.167.2 wrote to a
// PreToolUse hook in a probe run: session_id, turn_id, cwd, tool_name and tool_input, and no
// agent_id in the main session. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const HOOKS = path.join(MODULES, 'core', 'hooks');
const TESTDATA = path.join(MODULES, 'software-factory/testdata');
const { decide, lockedFiles, patchPaths, writesFiles } = require(path.join(HOOKS, 'tool-guard.js'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tool-guard-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const next = (name) => path.join(tmp, `${name}-${++folders}`);
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

const CHECK_PATH = 'checks/corrected-reply.check.ts';
const CHECK_TEXT = "expect(reply('order-12')).toContain('8:00 to 20:00');\n";

// A working folder, the top folder of a new repository, with the locked check.
function working() {
  const dir = next('work');
  fs.mkdirSync(path.join(dir, path.dirname(CHECK_PATH)), { recursive: true });
  childProcess.execFileSync('git', ['init', '-q', dir]);
  fs.writeFileSync(path.join(dir, CHECK_PATH), CHECK_TEXT);
  return dir;
}

const WORK = working();
const LOCKED = path.join(WORK, CHECK_PATH);
// The lock as lockedFiles returns it: one listed file.
const locked = () => ({ what: 'acceptance-lock version 1', files: [LOCKED] });
const RUN = { QORY_RUN_ID: 'run-1', HOME: os.homedir() };

// claude returns the input of Claude Code for a call of tool with args, from the main
// session, or from an agent when agent is set.
const claude = (tool, args, agent) => ({ session_id: 's-1', transcript_path: '/t.jsonl',
  cwd: WORK, permission_mode: 'dontAsk', hook_event_name: 'PreToolUse', tool_name: tool,
  tool_input: args, tool_use_id: 'toolu_1',
  ...(agent ? { agent_id: 'a4d2c8f1e0b3a297', agent_type: agent } : {}) });

// codex returns the input of Codex for a call of tool with args, as the probe recorded it,
// from the main session, or from an agent when agent is set.
const codex = (tool, args, agent) => ({ session_id: '01a1df95-ebfe-71e0-8775-8259849b8df7',
  turn_id: '01a1df95-ec0f-7552-a2a5-89bd7dc09238', transcript_path: '/home/agent/r.jsonl',
  cwd: WORK, hook_event_name: 'PreToolUse', model: 'gpt-5.5',
  permission_mode: 'bypassPermissions', tool_name: tool, tool_input: args,
  tool_use_id: 'call1', ...(agent ? { agent_id: '01a1df95-0000', agent_type: agent } : {}) });

const patch = (file) => ({ command: `*** Begin Patch\n*** Add File: ${file}\n+from apply_patch\n` +
  '*** End Patch\n' });

const guard = (input, env = RUN) => decide({ input, env, locked });

// firstLine checks that reason starts with start and that its first line has at most 100
// characters, and returns reason.
function firstLine(reason, start) {
  assert.equal(typeof reason, 'string', 'the call is denied');
  assert.ok(reason.startsWith(start), reason);
  assert.ok(reason.split('\n')[0].length <= 100, reason);
  return reason;
}

test('an edit from the main session is denied, on Claude Code and on Codex', () => {
  const file = path.join(WORK, 'src', 'reply.ts');
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    firstLine(guard(claude(tool, { file_path: file, content: 'x' })), 'Start an agent to change');
  }
  firstLine(guard(claude('NotebookEdit', { notebook_path: path.join(WORK, 'a.ipynb') })),
    'Start an agent to change');
  firstLine(guard(codex('apply_patch', patch('src/reply.ts'))), 'Start an agent to change');
  // The same writes from an agent pass.
  assert.equal(guard(claude('Write', { file_path: file, content: 'x' }, 'implementer')), null);
  assert.equal(guard(codex('apply_patch', patch('src/reply.ts'), 'default')), null);
  // The main session writes in the artifact folder, such as points.json.
  const artifacts = path.join(WORK, '.qory', 'artifacts');
  assert.equal(guard(claude('Write', { file_path: path.join(artifacts, 'points.json') })), null);
  assert.equal(guard(codex('apply_patch', patch('.qory/artifacts/points.json'))), null);
  // A shell command of the main session is no edit.
  assert.equal(guard(claude('Bash', { command: 'echo x > src/reply.ts' })), null);
});

test('a write to a locked path is denied, on Claude Code and on Codex', () => {
  const start = `Leave ${CHECK_PATH} as it is: acceptance-lock version 1 locks it.`;
  for (const agent of [undefined, 'implementer']) {
    firstLine(guard(claude('Edit', { file_path: LOCKED, old_string: 'a', new_string: 'b' }, agent)),
      start);
    firstLine(guard(codex('apply_patch', patch(CHECK_PATH), agent)), start);
  }
  // A shell command whose text contains the path and writes it.
  for (const command of [`echo x > ${CHECK_PATH}`, `echo x >> ./${CHECK_PATH}`,
    `echo x >${CHECK_PATH}`, `echo x>${CHECK_PATH}`, `echo x>>${LOCKED}`,
    `echo x | tee ${LOCKED}`, `sed -i 's/a/b/' ${CHECK_PATH}`, `rm -f ${CHECK_PATH}`,
    `cd src && cp a.ts ${LOCKED}`]) {
    firstLine(guard(claude('Bash', { command }, 'implementer')), start);
    firstLine(guard(codex('Bash', { command })), start);
  }
  // Reads of the locked file pass.
  for (const command of [`cat ${CHECK_PATH}`, `npm run check -- ${CHECK_PATH} 2>&1`,
    `grep -n reply ${CHECK_PATH} > /tmp/out.txt`, 'echo x > checks/other.check.ts']) {
    assert.equal(guard(claude('Bash', { command }, 'implementer')), null, command);
    assert.equal(guard(codex('Bash', { command })), null, command);
  }
  // A write whose path the text does not contain passes: lock --verify keeps the lock.
  assert.equal(guard(codex('Bash', { command: 'D=checks; echo x > ${D}/corrected-reply.check.ts' })),
    null);
});

test('a write to .qory/build/ is denied, on Claude Code and on Codex', () => {
  const ledger = path.join(WORK, '.qory', 'build', 'steps.json');
  const start = 'Leave .qory/build/ to checks.js: it writes the build ledger there.';
  firstLine(guard(claude('Write', { file_path: ledger, content: '{}' }, 'implementer')), start);
  firstLine(guard(codex('apply_patch', patch('.qory/build/steps.json'), 'default')), start);
  firstLine(guard(claude('Bash', { command: 'echo {} > .qory/build/steps.json' })), start);
  firstLine(guard(codex('Bash', { command: 'rm -rf .qory/build' })), start);
  firstLine(guard(codex('Bash', { command: `rm -rf ${path.join(WORK, '.qory', 'build')}` })),
    start);
  firstLine(guard(codex('Bash', { command: 'echo {}>.qory/build/steps.json' })), start);
  assert.equal(guard(codex('Bash', { command: 'cat .qory/build/steps.json' })), null);
});

test('an agent in the background is denied on Claude Code; spawn_agent runs on Codex', () => {
  const agent = { description: 'Write the spec', prompt: 'Write it.', subagent_type: 'spec-writer' };
  for (const tool of ['Agent', 'Task']) {
    for (const value of [true, 'true']) {
      firstLine(guard(claude(tool, { ...agent, run_in_background: value })),
        'Start the agent with run_in_background false, or leave the key out.');
    }
    assert.equal(guard(claude(tool, { ...agent, run_in_background: false })), null);
    assert.equal(guard(claude(tool, agent)), null);
  }
  // The call that the probe recorded: Codex has no agent in the foreground, so it runs.
  assert.equal(guard(codex('spawn_agent', { message: 'say done' })), null);
});

test('no rule covers qory.yaml, .qory/ outside .qory/build/, the hooks or the modules', () => {
  for (const file of ['qory.yaml', '.qory/harness/claude/settings.json', '.qory/artifacts/a.md',
    'hooks/tool-guard.js', 'modules/core/hooks/tool-guard.js', 'modules/x/qory-module.yaml']) {
    assert.equal(guard(claude('Write', { file_path: path.join(WORK, file) }, 'implementer')), null,
      file);
    assert.equal(guard(codex('apply_patch', patch(file), 'default')), null, file);
    assert.equal(guard(codex('Bash', { command: `echo x > ${file}` })), null, file);
  }
});

test('outside a run the guard denies nothing', () => {
  assert.equal(guard(claude('Write', { file_path: LOCKED }), { HOME: os.homedir() }), null);
  assert.equal(guard(codex('spawn_agent', { message: 'say done' }), {}), null);
});

test('a lock that cannot be read denies a write below the working folder', () => {
  const input = claude('Write', { file_path: path.join(WORK, 'src', 'a.ts') }, 'implementer');
  const reason = decide({ input, env: RUN, locked: () => ({ problem: 'qory exited with 1.' }) });
  assert.equal(firstLine(reason, 'Run `qory artifact pull`, then try again').split('\n')[1],
    'qory exited with 1.');
  // A write outside the working folder reads no lock.
  assert.equal(decide({ input: claude('Write', { file_path: '/tmp/qory-artifacts/a.md' }, 'w'),
    env: RUN, locked: () => assert.fail('the lock is read') }), null);
});

// shellPatch returns the input of a Codex shell call that runs apply_patch with the patch of
// file, as Codex runs a patch that the model writes as a shell command.
const shellPatch = (file) => ({ command: `apply_patch <<'EOF'\n${patch(file).command}EOF\n` });

test('a Codex patch through the shell is read as a write of its files', () => {
  const start = `Leave ${CHECK_PATH} as it is: acceptance-lock version 1 locks it.`;
  firstLine(guard(codex('Bash', shellPatch(CHECK_PATH), 'default')), start);
  firstLine(guard(codex('Bash', shellPatch('.qory/build/steps.json'), 'default')),
    'Leave .qory/build/ to checks.js');
  firstLine(guard(codex('Bash', shellPatch('src/reply.ts'))), 'Start an agent to change');
  assert.equal(guard(codex('Bash', shellPatch('src/reply.ts'), 'default')), null);
  assert.equal(guard(codex('Bash', shellPatch('.qory/artifacts/points.json'))), null);
  assert.equal(writesFiles('Bash', shellPatch('src/reply.ts')), true);
});

test('patchPaths reads each file of a Codex patch', () => {
  assert.deepEqual(patchPaths('*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n' +
    '@@\n-x\n+y\n*** Delete File: c.ts\n*** Add File: d/e.ts\n+z\n*** End Patch\n'),
  ['a.ts', 'b.ts', 'c.ts', 'd/e.ts']);
});

// harnessHome makes a folder with the layout of a composed harness, hooks/ and
// modules/<name>/, and returns it.
function harnessHome() {
  const home = next('home');
  fs.mkdirSync(path.join(home, 'modules'), { recursive: true });
  fs.symlinkSync(HOOKS, path.join(home, 'hooks'));
  for (const module of ['core', 'software-factory']) {
    fs.symlinkSync(path.join(MODULES, module), path.join(home, 'modules', module));
  }
  return home;
}

// server returns a folder that stands for Qory Apiary's artifacts: the testdata and version 1
// of acceptance-lock, which locks CHECK_PATH.
function server() {
  const root = next('server');
  fs.cpSync(TESTDATA, root, { recursive: true });
  const lock = { criteria: { version: 1 }, start_commit: '5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e',
    commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    checks: [{ criterion: 'ac-4', path: CHECK_PATH, command: `npm test -- ${CHECK_PATH}`,
      failed_with: 1, sha256: sha(CHECK_TEXT) }] };
  const text = JSON.stringify(lock, null, 2);
  const file = path.join(root, 'acceptance-lock', 'main', 'v1', 'acceptance-lock.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  index.artifacts.push({ type: 'acceptance-lock', name: 'main', stage_id: 'st_6ns22c4pav',
    approved_version: null, newest_version: 1, changed_after_approval: false,
    versions: [{ id: 'av_lock1', number: 1, writer: { kind: 'run', run_id: 'run_7c3k1' },
      cancelled: false, stage_id: 'st_6ns22c4pav', note: null, at: '2026-11-15T09:00:00Z',
      approvals: [], files: [{ filename: 'acceptance-lock.json', content_type: 'application/json',
        size: Buffer.byteLength(text), sha256: sha(text) }] }] });
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index, null, 2));
  return root;
}

// fakeQory returns an environment of a run whose qory pulls from into a new store.
function fakeQory(from, status = 0) {
  const bin = next('bin');
  const store = next('store');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'qory'), `#!/bin/sh
[ "$1 $2" = 'artifact pull' ] || exit 9
[ ${status} -eq 0 ] || exit ${status}
mkdir -p '${store}'
cp -R '${from}/.' '${store}/'
echo '${store}'
`, { mode: 0o755 });
  return { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    QORY_RUN_ID: 'run-1', QORY_RUN_REPOSITORIES: 'example-org/shop' };
}

test('lockedFiles reads the files of the lock with the reader of checks.js', () => {
  const home = harnessHome();
  const script = path.join(home, 'hooks', 'tool-guard-claude.js');
  const env = fakeQory(server());
  assert.deepEqual(lockedFiles({ root: WORK, env, script }),
    { what: 'acceptance-lock version 1', files: [LOCKED] });
  // No version of the lock: nothing is locked.
  const empty = next('server');
  fs.cpSync(TESTDATA, empty, { recursive: true });
  assert.deepEqual(lockedFiles({ root: WORK, env: fakeQory(empty), script }), { files: [] });
  // A pull that fails is a problem, which denies a write.
  assert.match(lockedFiles({ root: WORK, env: fakeQory(empty, 3), script }).problem,
    /^Run `qory artifact pull acceptance-lock`.*: it exited with 3\.$/);
});

test('each adapter prints the deny of its runtime', () => {
  const home = harnessHome();
  const env = { ...fakeQory(server()), QORY_HARNESS_HOME: home };
  delete env.CLAUDE_PROJECT_DIR;
  const run = (runtime, input) => {
    const ran = childProcess.spawnSync(process.execPath,
      [path.join(home, 'hooks', `tool-guard-${runtime}.js`)],
      { input: JSON.stringify(input), env, encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    return ran.stdout === '' ? null : JSON.parse(ran.stdout).hookSpecificOutput;
  };
  const denied = (out, start, check = firstLine) => {
    assert.equal(out.hookEventName, 'PreToolUse');
    assert.equal(out.permissionDecision, 'deny');
    check(out.permissionDecisionReason, start);
  };
  // reports-guard's reasons are its own, with no limit on the first line.
  const starts = (reason, start) => assert.ok(reason.startsWith(start), reason);
  const lockStart = `Leave ${CHECK_PATH} as it is: acceptance-lock version 1 locks it.`;
  denied(run('claude', claude('Write', { file_path: path.join(WORK, 'a.ts') })),
    'Start an agent to change');
  denied(run('claude', claude('Edit', { file_path: LOCKED }, 'implementer')), lockStart);
  denied(run('claude', claude('Agent', { prompt: 'p', run_in_background: true })),
    'Start the agent with run_in_background false');
  assert.equal(run('claude', claude('Write', { file_path: path.join(WORK, 'a.ts') }, 'w')), null);
  denied(run('codex', codex('apply_patch', patch('a.ts'))), 'Start an agent to change');
  denied(run('codex', codex('Bash', { command: `echo from-shell > ${CHECK_PATH}` })), lockStart);
  assert.equal(run('codex', codex('spawn_agent', { message: 'say done' })), null);
  assert.equal(run('codex', codex('Bash', { command: 'echo from-shell > free/echo.txt' })), null);
  // On Codex, reports-guard denies a direct write to .reports/ first.
  denied(run('codex', codex('apply_patch',
    patch('/tmp/qory-artifacts/.reports/starts.json'), 'default')), 'Write no file under .reports/',
  starts);
  denied(run('codex', codex('Bash', { command: 'rm /tmp/qory-artifacts/.reports/end.json' })),
    'Run no shell command on .reports/', starts);
});

// The step limit of step-limit.js, with the hook inputs of Claude Code and Codex. Claude Code
// ends a step with PostToolBatch, whose tool_calls list every call of the step; Codex starts
// a step with PreModelRequest, and PreToolUse appends each call of the step.
const steps = require(path.join(HOOKS, 'step-limit.js'));

// stepRun returns a folder that stands for the working folder of a run, a harness home, and
// hook(runtime, input), which runs the adapter of runtime on input and returns its deny
// reason, or null.
function stepRun() {
  const root = next('steps');
  fs.mkdirSync(root);
  const home = harnessHome();
  // A write below the working folder pulls the lock: the fake qory has one that locks no file
  // of the folder.
  const env = { ...fakeQory(server()), QORY_HARNESS_HOME: home };
  delete env.CLAUDE_PROJECT_DIR;
  const hook = (runtime, input) => {
    const ran = childProcess.spawnSync(process.execPath,
      [path.join(home, 'hooks', `tool-guard-${runtime}.js`)],
      { input: JSON.stringify({ cwd: root, ...input }), env, encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stderr, '');
    return ran.stdout === '' ? null : JSON.parse(ran.stdout).hookSpecificOutput
      .permissionDecisionReason;
  };
  return { root, home, env, hook };
}

const READ = { tool_name: 'Read', tool_input: { file_path: 'src/a.ts' }, tool_use_id: 't1' };
const WRITE = { tool_name: 'Write', tool_input: { file_path: 'src/a.ts', content: 'x' },
  tool_use_id: 't2' };
const LIMITED = 'Write your output now: 12 steps in a row wrote nothing.';

// claudeAgent and codexAgent return the hook inputs of an agent of type type, or of the main
// session when type is null.
const claudeAgent = (type) => (type ? { session_id: 's-1', agent_id: 'a380cc41002eba5f8',
  agent_type: type } : { session_id: 's-1' });
const codexAgent = (type) => (type ? { session_id: '01a1df95-ebfe', turn_id: 'turn-1',
  agent_id: '01a1df95-0000', agent_type: type, model: 'gpt-5.5' }
  : { session_id: '01a1df95-ebfe', turn_id: 'turn-1', model: 'gpt-5.5' });

// claudeStep runs one Claude Code step of the agent of who with the calls calls.
function claudeStep(hook, who, calls) {
  for (const call of calls) {
    const reason = hook('claude', { ...who, hook_event_name: 'PreToolUse', ...call });
    if (reason) return reason;
  }
  return hook('claude', { ...who, hook_event_name: 'PostToolBatch',
    tool_calls: calls.map((call) => ({ ...call, tool_response: 'ok' })) });
}

// codexStep runs one Codex step of the agent of who: the model request, then the calls.
function codexStep(hook, who, calls) {
  assert.equal(hook('codex', { ...who, hook_event_name: 'PreModelRequest' }), null);
  for (const call of calls) {
    const reason = hook('codex', { ...who, hook_event_name: 'PreToolUse',
      permission_mode: 'bypassPermissions', ...call });
    if (reason) return reason;
  }
  return null;
}

test('the step limit reads the writes of a step with the rules of the guard', () => {
  for (const name of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch']) {
    assert.equal(writesFiles(name, {}), true, name);
  }
  for (const command of ['echo x > out.md', 'cat a | tee b', "sed -i 's/a/b/' f",
    'rm -f a', '/qory/qory artifact push spec /tmp/qory-artifacts/spec.md']) {
    assert.equal(writesFiles('Bash', { command }), true, command);
  }
  for (const command of ['ls -la', 'grep -rn x src 2>&1', 'npm run check > /dev/null',
    'qory artifact pull spec']) {
    assert.equal(writesFiles('Bash', { command }), false, command);
  }
  for (const name of ['Read', 'Grep', 'Glob', 'Skill', 'spawn_agent']) {
    assert.equal(writesFiles(name, {}), false, name);
  }
});

test('the step limit reads read-only agents from their files, by agent_type', () => {
  const home = harnessHome();
  assert.equal(steps.readOnly(home, 'spec-reviewer'), true);
  assert.equal(steps.readOnly(home, 'harness:spec-reviewer'), true);
  assert.equal(steps.readOnly(home, 'spec-writer'), false);
  assert.equal(steps.readOnly(home, 'general-purpose'), false);
  assert.equal(steps.readOnly(home, '../spec-reviewer'), false);
});

test('on Claude Code, an agent that wrote nothing in 12 steps may only write', () => {
  const { root, hook } = stepRun();
  const who = claudeAgent('spec-writer');
  for (let step = 1; step <= steps.LIMIT; step += 1) {
    assert.equal(claudeStep(hook, who, [READ]), null, `step ${step}`);
  }
  const file = path.join(root, '.qory', 'steps', 's-1--a380cc41002eba5f8.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: steps.LIMIT });
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), LIMITED);
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'ls' } }), LIMITED);
  // A write runs, and its step resets the count.
  assert.equal(claudeStep(hook, who, [WRITE]), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: 0 });
  assert.equal(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), null);
});

test('on Claude Code, the calls of one step count once, and a push resets the count', () => {
  const { root, hook } = stepRun();
  const who = claudeAgent('spec-writer');
  for (let step = 1; step < steps.LIMIT; step += 1) {
    assert.equal(claudeStep(hook, who, [READ, READ, READ, READ]), null);
  }
  const file = path.join(root, '.qory', 'steps', 's-1--a380cc41002eba5f8.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: steps.LIMIT - 1 });
  const push = { tool_name: 'Bash', tool_input: { command: '/qory/qory artifact push spec ' +
    '/tmp/qory-artifacts/spec.md' }, tool_use_id: 't3' };
  assert.equal(claudeStep(hook, who, [READ, push]), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: 0 });
});

test('on Codex, an agent that wrote nothing in 12 steps may only write', () => {
  const { root, hook } = stepRun();
  const who = codexAgent('spec-writer');
  const read = { tool_name: 'Bash', tool_input: { command: 'cat src/a.ts' } };
  const write = { tool_name: 'apply_patch', tool_input: patch('src/a.ts') };
  for (let step = 1; step <= steps.LIMIT; step += 1) {
    // Calls at once: three reads in one step.
    assert.equal(codexStep(hook, who, [read, read, read]), null, `step ${step}`);
  }
  // The request after the 12th step ends it.
  assert.equal(hook('codex', { ...who, hook_event_name: 'PreModelRequest' }), null);
  const file = path.join(root, '.qory', 'steps', '01a1df95-ebfe--01a1df95-0000.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: steps.LIMIT });
  firstLine(hook('codex', { ...who, hook_event_name: 'PreToolUse', ...read }), LIMITED);
  firstLine(hook('codex', { ...who, hook_event_name: 'PreToolUse', tool_name: 'spawn_agent',
    tool_input: { message: 'say done' } }), LIMITED);
  assert.equal(hook('codex', { ...who, hook_event_name: 'PreToolUse', ...write }), null);
  assert.equal(hook('codex', { ...who, hook_event_name: 'PreModelRequest' }), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: 0 });
  assert.equal(fs.existsSync(file.replace(/\.json$/, '.calls')), false);
});

test('the main session and a read-only reviewer are never limited', () => {
  const { root, hook } = stepRun();
  for (const who of [claudeAgent(null), claudeAgent('spec-reviewer')]) {
    for (let step = 1; step <= steps.LIMIT + 2; step += 1) {
      assert.equal(claudeStep(hook, who, [READ]), null);
    }
  }
  for (const who of [codexAgent(null), codexAgent('spec-reviewer')]) {
    for (let step = 1; step <= steps.LIMIT + 2; step += 1) {
      assert.equal(codexStep(hook, who, [{ tool_name: 'Bash', tool_input: { command: 'ls' } }]),
        null);
    }
  }
  assert.equal(fs.existsSync(path.join(root, '.qory', 'steps')), false);
});

test('each agent has a separate count file, and the end check removes them', () => {
  const { root, home, env, hook } = stepRun();
  claudeStep(hook, claudeAgent('spec-writer'), [READ]);
  claudeStep(hook, { ...claudeAgent('decision-writer'), agent_id: 'b1' }, [READ]);
  claudeStep(hook, { ...claudeAgent('spec-writer'), session_id: 's-2' }, [READ]);
  const folder = path.join(root, '.qory', 'steps');
  assert.deepEqual(fs.readdirSync(folder).sort(),
    ['s-1--a380cc41002eba5f8.json', 's-1--b1.json', 's-2--a380cc41002eba5f8.json']);
  // Outside a run, nothing counts.
  steps.endStep({ input: claudeAgent('spec-writer'), env: {}, home, root }, false);
  assert.equal(steps.limited({ input: claudeAgent('spec-writer'), env: {}, home, root }, false),
    null);
  // The end check of session s-1 ends it, with no artifact folder, and removes its counts.
  const ran = childProcess.spawnSync(process.execPath, [path.join(home, 'hooks',
    'end-gate-claude.js')], { input: JSON.stringify({ session_id: 's-1', cwd: root,
    hook_event_name: 'Stop' }), env: { ...env, QORY_RUN_ID: '' }, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(fs.readdirSync(folder), ['s-2--a380cc41002eba5f8.json']);
});

test('at the limit, a write that the guard denies does not reset the count', () => {
  const { root, hook } = stepRun();
  // Claude Code: PostToolBatch lists the denied write too.
  const who = claudeAgent('spec-writer');
  for (let step = 1; step <= steps.LIMIT; step += 1) claudeStep(hook, who, [READ]);
  const denied = { tool_name: 'Write', tool_input: { file_path: path.join(root, '.qory',
    'build', 'steps.json'), content: '{}' }, tool_use_id: 'toolu_denied' };
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...denied }),
    'Leave .qory/build/ to checks.js');
  assert.equal(hook('claude', { ...who, hook_event_name: 'PostToolBatch',
    tool_calls: [{ ...denied, tool_response: 'denied' }] }), null);
  const file = path.join(root, '.qory', 'steps', 's-1--a380cc41002eba5f8.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: steps.LIMIT + 1 });
  assert.equal(fs.existsSync(file.replace(/\.json$/, '.denied')), false);
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), LIMITED);
  // Codex: the line of the denied apply_patch is no write.
  const agent = codexAgent('spec-writer');
  const ls = { tool_name: 'Bash', tool_input: { command: 'ls' } };
  for (let step = 1; step <= steps.LIMIT; step += 1) codexStep(hook, agent, [ls]);
  assert.equal(hook('codex', { ...agent, hook_event_name: 'PreModelRequest' }), null);
  firstLine(hook('codex', { ...agent, hook_event_name: 'PreToolUse', tool_name: 'apply_patch',
    tool_input: patch('.qory/build/steps.json') }), 'Leave .qory/build/ to checks.js');
  assert.equal(hook('codex', { ...agent, hook_event_name: 'PreModelRequest' }), null);
  const codexFile = path.join(root, '.qory', 'steps', '01a1df95-ebfe--01a1df95-0000.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(codexFile, 'utf8')), { steps: steps.LIMIT + 1 });
  firstLine(hook('codex', { ...agent, hook_event_name: 'PreToolUse', ...ls }), LIMITED);
});
