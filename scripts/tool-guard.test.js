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
const { decide, lockedFiles, patchPaths, countsAsWrite } = require(path.join(HOOKS,
  'tool-guard.js'));

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
// The place of a call in WORK, for countsAsWrite.
const PLACE = { cwd: WORK, root: WORK };
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

const guard = (input, env = RUN) => decide({ input, env, locked, root: WORK });

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
  const start = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  for (const agent of [undefined, 'implementer']) {
    firstLine(guard(claude('Edit', { file_path: LOCKED, old_string: 'a', new_string: 'b' }, agent)),
      start);
    firstLine(guard(codex('apply_patch', patch(CHECK_PATH), agent)), start);
  }
  // A shell command whose text contains the path and writes it.
  for (const command of [`echo x > ${CHECK_PATH}`, `echo x >> ./${CHECK_PATH}`,
    `echo x >${CHECK_PATH}`, `echo x>${CHECK_PATH}`, `echo x>>${LOCKED}`,
    `echo x | tee ${LOCKED}`, `sed -i 's/a/b/' ${CHECK_PATH}`, `rm -f ${CHECK_PATH}`,
    `cd src && cp a.ts ${LOCKED}`, `git rm ${CHECK_PATH}`, `git mv ${CHECK_PATH} b.ts`,
    `git checkout -- ${CHECK_PATH}`, `git restore --source HEAD~1 ${CHECK_PATH}`,
    `git -C . checkout -- ${CHECK_PATH}`, `git -c core.pager=cat --no-pager rm ${CHECK_PATH}`,
    `git --work-tree=. restore ${CHECK_PATH}`, `git restore --staged --worktree ${CHECK_PATH}`,
    `git restore -SW ${CHECK_PATH}`, `git restore --staged --work ${CHECK_PATH}`,
    `git restore --staged --w ${CHECK_PATH}`, `git -C . -c x=1 rm ${CHECK_PATH}`,
    `sh -c 'rm ${CHECK_PATH}'`, `bash -c "mv a ${CHECK_PATH}"`, `sh -c 'cp a ${CHECK_PATH}'`,
    `bash -lc "tee ${CHECK_PATH}"`, `sh -c 'echo x > ${CHECK_PATH}'`,
    `sh -c "bash -c 'rm ${CHECK_PATH}'"`, `/bin/zsh -ec 'cd src; cp a.ts ${LOCKED}'`,
    `bash -o pipefail -c 'rm ${CHECK_PATH}'`, `bash -O extglob --login -c "tee ${CHECK_PATH}"`]) {
    firstLine(guard(claude('Bash', { command }, 'implementer')), start);
    firstLine(guard(codex('Bash', { command })), start);
  }
  // Reads of the locked file pass.
  for (const command of [`cat ${CHECK_PATH}`, `npm run check -- ${CHECK_PATH} 2>&1`,
    `grep -n reply ${CHECK_PATH} > /tmp/out.txt`, 'echo x > checks/other.check.ts',
    `git restore --staged ${CHECK_PATH}`, `git -C . restore -S ${CHECK_PATH}`,
    `sh -c 'ls ${CHECK_PATH}'`, `X=1 git -c a=b log ${CHECK_PATH}`]) {
    assert.equal(guard(claude('Bash', { command }, 'implementer')), null, command);
    assert.equal(guard(codex('Bash', { command })), null, command);
  }
  // A write whose path the text does not contain passes: lock --verify keeps the lock.
  const command = 'D=checks; echo x > ${D}/corrected-reply.check.ts';
  assert.equal(guard(codex('Bash', { command })), null);
});

test('a write behind a prefix, in a group, of a folder above or by another path is denied',
  () => {
    const start = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
    const file = CHECK_PATH;
    for (const command of [`env cp a ${file}`, `env -u X FOO=1 tee ${file}`,
      `command cp a ${file}`, `timeout 5 cp a ${file}`, `timeout -s KILL 5 rm ${file}`,
      `nice -n 5 tee ${file}`, `nice cp a ${file}`, `exec rm ${file}`, `sudo -u root rm ${file}`,
      `FOO=1 env BAR=2 nice rm ${file}`, `( cp a ${file} )`, `{ cp a ${file}; }`,
      `if true; then rm ${file}; fi`, `echo $(rm ${file})`, `echo \`rm ${file}\``,
      'rm -rf checks', 'mv checks old', 'git rm -r checks', 'git checkout .',
      'git checkout -- checks', 'git restore checks', 'git restore --source HEAD~1 .',
      'cp a checks//corrected-reply.check.ts',
      'cp a ./checks/../checks/corrected-reply.check.ts',
      'echo x > ./src/../checks/corrected-reply.check.ts']) {
      firstLine(guard(claude('Bash', { command }, 'implementer')), start);
      firstLine(guard(codex('Bash', { command })), start);
    }
    for (const command of ['cp -r checks /tmp/checks-copy', 'rm -rf src', 'mv src/a.ts src/b.ts',
      'git -C . rm src/other.ts', 'rm -rf checks-old', 'env ls checks', 'mkdir -p checks/new',
      'timeout 5 grep -r x checks', 'git checkout main', 'git checkout -b fix-x',
      'git restore --staged checks']) {
      assert.equal(guard(claude('Bash', { command }, 'implementer')), null, command);
    }
  });

test('a write to .qory/build/ is denied, on Claude Code and on Codex', () => {
  const ledger = path.join(WORK, '.qory', 'build', 'steps.json');
  const start = 'Leave .qory/build/ as it is: the harness keeps the build ledger and step ' +
    'counts there.';
  firstLine(guard(claude('Write', { file_path: ledger, content: '{}' }, 'implementer')), start);
  firstLine(guard(codex('apply_patch', patch('.qory/build/steps.json'), 'default')), start);
  firstLine(guard(claude('Bash', { command: 'echo {} > .qory/build/steps.json' })), start);
  firstLine(guard(codex('Bash', { command: 'rm -rf .qory/build' })), start);
  for (const command of ['rm -rf .qory', 'mv .qory /tmp/old-qory', 'rm -rf ./x/../.qory/build',
    'cp a .qory//build/steps.json', 'env rm -rf .qory', 'rm -rf .', `rm -rf ${WORK}`]) {
    firstLine(guard(codex('Bash', { command }, 'default')), start);
  }
  assert.equal(guard(codex('Bash', { command: 'rm -rf .qory/artifacts/a.md' }, 'default')),
    null);
  firstLine(guard(codex('Bash', { command: `rm -rf ${path.join(WORK, '.qory', 'build')}` })),
    start);
  firstLine(guard(codex('Bash', { command: 'echo {}>.qory/build/steps.json' })), start);
  assert.equal(guard(codex('Bash', { command: 'cat .qory/build/steps.json' })), null);
});

test('an agent in the background is denied on Claude Code; spawn_agent runs on Codex', () => {
  const agent = { description: 'Write the spec', prompt: 'Write it.',
    subagent_type: 'spec-writer' };
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
  const reason = decide({ input, env: RUN, root: WORK, locked: () => ({ type: 'acceptance-lock',
    problem: 'qory exited with 1.' }) });
  assert.equal(firstLine(reason, 'Run `qory artifact pull acceptance-lock`, then try again')
    .split('\n')[1], 'qory exited with 1.');
  // A write outside the working folder reads no lock.
  assert.equal(decide({ input: claude('Write', { file_path: '/tmp/qory-artifacts/a.md' }, 'w'),
    root: WORK,
    env: RUN, locked: () => assert.fail('the lock is read') }), null);
});

// On a disk that ignores case, such as the default disk of macOS, WORK in upper case is WORK.
const CASELESS = (() => {
  try {
    return fs.realpathSync.native(WORK.toUpperCase()) === fs.realpathSync.native(WORK);
  } catch {
    return false;
  }
})();

test('on a disk that ignores case, a path in another case is the same path', { skip:
  CASELESS ? false : 'the disk of the temporary folder reads case' }, () => {
  const start = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  const upper = CHECK_PATH.toUpperCase();
  firstLine(guard(claude('Edit', { file_path: path.join(WORK, upper) }, 'implementer')), start);
  firstLine(guard(codex('apply_patch', patch(upper), 'default')), start);
  firstLine(guard(codex('Bash', { command: `echo x > ${upper}` }, 'default')), start);
  // .qory/build/ does not exist yet in WORK.
  const built = 'Leave .qory/build/ as it is';
  firstLine(guard(claude('Write', { file_path: path.join(WORK, '.QORY', 'Build', 'a.json') },
    'implementer')), built);
  firstLine(guard(codex('Bash', { command: 'rm -rf .Qory/Build' }, 'default')), built);
  // The artifact folder in another case is still the artifact folder.
  assert.equal(guard(claude('Write', { file_path: path.join(WORK, '.QORY', 'Artifacts',
    'points.json') })), null);
});

test('the reasons say what the code does', () => {
  const reason = guard(claude('Agent', { prompt: 'p', run_in_background: true }));
  assert.equal(reason.split('\n')[1],
    'An agent in the background can still run after the main session ends, so the guard ' +
    'denies it.');
  const locked = guard(claude('Edit', { file_path: LOCKED }, 'implementer'));
  assert.ok(locked.endsWith('fails checks.js lock --verify and the push check.'), locked);
});

test('a deny names the path of a locked file on its second line', () => {
  const deep = path.join(WORK, 'checks', 'a-folder-with-a-long-name', 'another-long-folder',
    'a-check-with-a-long-name-for-the-corrected-reply.check.ts');
  const reason = decide({ input: claude('Edit', { file_path: deep }, 'implementer'), env: RUN,
    root: WORK,
    locked: () => ({ what: 'acceptance-lock version 1', files: [deep] }) });
  assert.equal(firstLine(reason, 'Leave the locked file as it is').split('\n')[1]
    .startsWith(`The call writes ${path.relative(WORK, deep)}.`), true);
});

test('the guard reads a command of 1 MB in under 2 seconds', () => {
  const MB = 1 << 20;
  const code = 'a.b(c);d&&e||f(g)/h.i>j;k=(l|m);'.repeat(Math.ceil(MB / 33));
  for (const command of [`cat > src/min.js <<'EOF'\n${code}\nEOF`, '('.repeat(MB),
    `sh ${'--a '.repeat(MB / 4)}x`, `sh -${'c'.repeat(MB)}`, 'sh -c "'.repeat(MB / 7)]) {
    const start = process.hrtime.bigint();
    guard(codex('Bash', { command }, 'default'));
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 2000, `${command.slice(0, 20)}: ${ms} ms`);
  }
});

// shellPatch returns the input of a Codex shell call that runs apply_patch with the patch of
// file, as Codex runs a patch that the model writes as a shell command.
const shellPatch = (file) => ({ command: `apply_patch <<'EOF'\n${patch(file).command}EOF\n` });

test('a Codex patch through the shell is read as a write of its files', () => {
  const start = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  firstLine(guard(codex('Bash', shellPatch(CHECK_PATH), 'default')), start);
  firstLine(guard(codex('Bash', shellPatch('.qory/build/steps.json'), 'default')),
    'Leave .qory/build/ as it is');
  firstLine(guard(codex('Bash', shellPatch('src/reply.ts'))), 'Start an agent to change');
  assert.equal(guard(codex('Bash', shellPatch('src/reply.ts'), 'default')), null);
  assert.equal(guard(codex('Bash', shellPatch('.qory/artifacts/points.json'))), null);
  assert.equal(countsAsWrite('Bash', shellPatch('src/reply.ts'), PLACE), true);
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
  // A pull that fails is a problem of the lock's type, which denies a write.
  const failed = lockedFiles({ root: WORK, env: fakeQory(empty, 3), script });
  assert.equal(failed.type, 'acceptance-lock');
  assert.match(failed.problem, /^Run `qory artifact pull acceptance-lock`.*: it exited with 3\.$/);
});

test('each adapter prints the deny of its runtime', () => {
  const home = harnessHome();
  const env = { ...fakeQory(server()), QORY_HARNESS_HOME: home };
  delete env.CLAUDE_PROJECT_DIR;
  const run = (runtime, input) => {
    // Claude Code gives the working folder in CLAUDE_PROJECT_DIR, and Codex runs the hook in
    // it.
    const ran = childProcess.spawnSync(process.execPath,
      [path.join(home, 'hooks', `tool-guard-${runtime}.js`)],
      { input: JSON.stringify(input), env: { ...env, CLAUDE_PROJECT_DIR: WORK }, cwd: WORK,
        encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    return ran.stdout === '' ? null : JSON.parse(ran.stdout).hookSpecificOutput;
  };
  const denied = (out, start, check = firstLine) => {
    assert.equal(out.hookEventName, 'PreToolUse');
    assert.equal(out.permissionDecision, 'deny');
    check(out.permissionDecisionReason, start);
  };
  // reports-guard writes its reasons with no limit on the first line.
  const starts = (reason, start) => assert.ok(reason.startsWith(start), reason);
  const lockStart = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
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
  const env = { ...fakeQory(server()), QORY_HARNESS_HOME: home, CLAUDE_PROJECT_DIR: root };
  const hook = (runtime, input) => {
    const ran = childProcess.spawnSync(process.execPath,
      [path.join(home, 'hooks', `tool-guard-${runtime}.js`)],
      { input: JSON.stringify({ cwd: root, ...input }), env, cwd: root, encoding: 'utf8' });
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
  for (const name of ['Write', 'Edit', 'MultiEdit']) {
    assert.equal(countsAsWrite(name, { file_path: 'a.ts' }, PLACE), true, name);
  }
  assert.equal(countsAsWrite('NotebookEdit', { notebook_path: 'a.ipynb' }, PLACE), true);
  assert.equal(countsAsWrite('apply_patch', patch('a.ts'), PLACE), true);
  for (const command of ['echo x > out.md', 'cat a | tee b', "sed -i 's/a/b/' f",
    'git restore src/a.ts', 'git rm -q src/a.ts', "sh -c 'rm src/a.ts'",
    'git -C . -c x=1 rm src/a.ts', 'git restore --staged --wor src/a.ts',
    "sh -c 'cp a b'", 'bash -lc "tee b"', `sh -c "bash -c 'touch b'"`,
    'rm -f a', '/qory/qory artifact push spec /tmp/qory-artifacts/spec.md']) {
    assert.equal(countsAsWrite('Bash', { command }, PLACE), true, command);
  }
  for (const command of ['ls -la', 'grep -rn x src 2>&1', 'npm run check > /dev/null',
    "sh -c 'ls'", 'git restore --staged src/a.ts',
    'qory artifact pull spec']) {
    assert.equal(countsAsWrite('Bash', { command }, PLACE), false, command);
  }
  for (const name of ['Read', 'Grep', 'Glob', 'Skill', 'spawn_agent']) {
    assert.equal(countsAsWrite(name, {}, PLACE), false, name);
  }
});

test('the step limit reads read-only agents from their files, by agent_type', () => {
  const home = harnessHome();
  // On Claude Code, only an agent of the harness's plugin: a bare name can be a project's.
  assert.equal(steps.readOnly(home, 'harness:spec-reviewer', 'claude'), true);
  assert.equal(steps.readOnly(home, 'spec-reviewer', 'claude'), false);
  assert.equal(steps.readOnly(home, 'harness:spec-writer', 'claude'), false);
  assert.equal(steps.readOnly(home, 'other:spec-reviewer', 'claude'), false);
  assert.equal(steps.readOnly(home, 'harness:other:spec-reviewer', 'claude'), false);
  // On Codex, the role name, bare.
  assert.equal(steps.readOnly(home, 'spec-reviewer', 'codex'), true);
  assert.equal(steps.readOnly(home, 'harness:spec-reviewer', 'codex'), false);
  assert.equal(steps.readOnly(home, 'general-purpose', 'codex'), false);
  assert.equal(steps.readOnly(home, '../spec-reviewer', 'codex'), false);
  // With no harness home, no agent is exempt.
  assert.equal(steps.readOnly(undefined, 'harness:spec-reviewer', 'claude'), false);
  // A `tools` key as a YAML list, and an empty one.
  const agents = path.join(home, 'modules', 'extra', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  const agent = (name, front) => fs.writeFileSync(path.join(agents, `${name}.md`),
    `---\nname: ${name}\ndescription: An agent of the tests.\n${front}---\n\nText.\n`);
  agent('list-reader', 'tools:\n  - Read\n  - Grep\nmodel: inherit\n');
  agent('list-writer', 'tools:\n  - Read\n  - MultiEdit\n');
  agent('empty-tools', 'tools:\nmodel: inherit\n');
  agent('flow-reader', 'tools: [Read, Grep]\n');
  agent('flow-empty', 'tools: []\n');
  assert.equal(steps.readOnly(home, 'list-reader', 'codex'), true);
  assert.equal(steps.readOnly(home, 'flow-reader', 'codex'), true);
  for (const name of ['list-writer', 'empty-tools', 'flow-empty']) {
    assert.equal(steps.readOnly(home, name, 'codex'), false, name);
  }
});

test('on Claude Code, an agent that wrote nothing in 12 steps may only write', () => {
  const { root, hook } = stepRun();
  const who = claudeAgent('spec-writer');
  for (let step = 1; step <= steps.LIMIT; step += 1) {
    assert.equal(claudeStep(hook, who, [READ]), null, `step ${step}`);
  }
  const file = path.join(root, '.qory', 'build', 'steps', 's-1--a380cc41002eba5f8.json');
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
  const file = path.join(root, '.qory', 'build', 'steps', 's-1--a380cc41002eba5f8.json');
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
  const file = path.join(root, '.qory', 'build', 'steps',
    '01a1df95-ebfe--01a1df95-0000.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: steps.LIMIT });
  firstLine(hook('codex', { ...who, hook_event_name: 'PreToolUse', ...read }), LIMITED);
  firstLine(hook('codex', { ...who, hook_event_name: 'PreToolUse', tool_name: 'spawn_agent',
    tool_input: { message: 'say done' } }), LIMITED);
  assert.equal(hook('codex', { ...who, hook_event_name: 'PreToolUse', ...write }), null);
  assert.equal(hook('codex', { ...who, hook_event_name: 'PreModelRequest' }), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: 0 });
  assert.equal(fs.existsSync(file.replace(/\.json$/, '.calls')), false);
});

test('on Claude Code, a bare name of a read-only agent is limited', () => {
  const { hook } = stepRun();
  const who = claudeAgent('spec-reviewer');
  for (let step = 1; step <= steps.LIMIT; step += 1) claudeStep(hook, who, [READ]);
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), LIMITED);
});

test('the main session and a read-only reviewer are never limited', () => {
  const { root, hook } = stepRun();
  for (const who of [claudeAgent(null), claudeAgent('harness:spec-reviewer')]) {
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
  assert.equal(fs.existsSync(path.join(root, '.qory', 'build', 'steps')), false);
});

test('each agent has a separate count file, and the end check removes them', () => {
  const { root, home, env, hook } = stepRun();
  claudeStep(hook, claudeAgent('spec-writer'), [READ]);
  claudeStep(hook, { ...claudeAgent('decision-writer'), agent_id: 'b1' }, [READ]);
  claudeStep(hook, { ...claudeAgent('spec-writer'), session_id: 's-2' }, [READ]);
  const folder = path.join(root, '.qory', 'build', 'steps');
  assert.deepEqual(fs.readdirSync(folder).sort(),
    ['s-1--a380cc41002eba5f8.json', 's-1--a380cc41002eba5f8.seen', 's-1--b1.json',
      's-1--b1.seen', 's-2--a380cc41002eba5f8.json', 's-2--a380cc41002eba5f8.seen']);
  // Outside a run, nothing counts.
  steps.endStep({ input: claudeAgent('spec-writer'), env: {}, home, root }, false);
  assert.equal(steps.limited({ input: claudeAgent('spec-writer'), env: {}, home, root }, false),
    null);
  // The end check of session s-1 ends it, with no artifact folder, and removes its counts.
  const ran = childProcess.spawnSync(process.execPath, [path.join(home, 'hooks',
    'end-gate-claude.js')], { input: JSON.stringify({ session_id: 's-1', cwd: root,
    hook_event_name: 'Stop' }), env: { ...env, QORY_RUN_ID: '' }, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(fs.readdirSync(folder).sort(),
    ['s-2--a380cc41002eba5f8.json', 's-2--a380cc41002eba5f8.seen']);
});

test('at the limit, a write that the guard denies does not reset the count', () => {
  const { root, hook } = stepRun();
  // The lock of stepRun locks CHECK_PATH, a file below the folder: a write there counts.
  fs.mkdirSync(path.join(root, path.dirname(CHECK_PATH)), { recursive: true });
  fs.writeFileSync(path.join(root, CHECK_PATH), CHECK_TEXT);
  const lockStart = 'Leave the locked file as it is';
  // Claude Code: PostToolBatch lists the denied write too.
  const who = claudeAgent('spec-writer');
  for (let step = 1; step <= steps.LIMIT; step += 1) claudeStep(hook, who, [READ]);
  const denied = { tool_name: 'Write', tool_input: { file_path: path.join(root, CHECK_PATH),
    content: '{}' }, tool_use_id: 'toolu_denied' };
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...denied }), lockStart);
  assert.equal(hook('claude', { ...who, hook_event_name: 'PostToolBatch',
    tool_calls: [{ ...denied, tool_response: 'denied' }] }), null);
  const file = path.join(root, '.qory', 'build', 'steps', 's-1--a380cc41002eba5f8.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: steps.LIMIT + 1 });
  assert.equal(fs.existsSync(file.replace(/\.json$/, '.denied')), false);
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), LIMITED);
  // Codex: the line of the denied apply_patch is no write.
  const agent = codexAgent('spec-writer');
  const ls = { tool_name: 'Bash', tool_input: { command: 'ls' } };
  for (let step = 1; step <= steps.LIMIT; step += 1) codexStep(hook, agent, [ls]);
  assert.equal(hook('codex', { ...agent, hook_event_name: 'PreModelRequest' }), null);
  firstLine(hook('codex', { ...agent, hook_event_name: 'PreToolUse', tool_name: 'apply_patch',
    tool_input: patch(CHECK_PATH) }), lockStart);
  assert.equal(hook('codex', { ...agent, hook_event_name: 'PreModelRequest' }), null);
  const codexFile = path.join(root, '.qory', 'build', 'steps',
    '01a1df95-ebfe--01a1df95-0000.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(codexFile, 'utf8')), { steps: steps.LIMIT + 1 });
  firstLine(hook('codex', { ...agent, hook_event_name: 'PreToolUse', ...ls }), LIMITED);
});

test('an agent cannot change its count, and a broken count file limits it', () => {
  const { root, hook } = stepRun();
  const who = claudeAgent('spec-writer');
  assert.equal(claudeStep(hook, who, [READ]), null);
  const file = path.join(root, '.qory', 'build', 'steps', 's-1--a380cc41002eba5f8.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: 1 });
  // The agent's write or removal of its count file is denied.
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: file, content: '{"steps":0}' }, tool_use_id: 't4' }),
  'Leave .qory/build/ as it is');
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'rm -rf .qory/build/steps' }, tool_use_id: 't5' }),
  'Leave .qory/build/ as it is');
  // A count file that exists but has no count limits the agent, and a write resets it.
  fs.writeFileSync(file, 'not json');
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), LIMITED);
  assert.equal(claudeStep(hook, who, [WRITE]), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: 0 });
});

// guardCommands returns the PreToolUse commands of the guard in the settings of core: the one
// of Claude Code and the one of Codex.
function guardCommands() {
  const settings = JSON.parse(fs.readFileSync(path.join(MODULES, 'core', 'settings', 'claude',
    'settings.json'), 'utf8'));
  const claudeCommand = settings.hooks.PreToolUse[0].hooks[0].command;
  const toml = fs.readFileSync(path.join(MODULES, 'core', 'settings', 'codex', 'config.toml'),
    'utf8');
  const block = toml.slice(toml.indexOf('[[hooks.PreToolUse]]'));
  const codexCommand = JSON.parse(/^command = (".*")$/m.exec(block)[1]);
  return [claudeCommand, codexCommand];
}

test('in a run, a guard that does not start blocks the call', () => {
  const home = next('home');
  fs.mkdirSync(path.join(home, 'hooks'), { recursive: true });
  for (const command of guardCommands()) {
    const shell = (env) => childProcess.spawnSync('/bin/sh', ['-c', command],
      { input: '{}', env: { PATH: process.env.PATH, QORY_HARNESS_HOME: home, ...env },
        encoding: 'utf8' });
    // hooks/ has no adapter, so node exits 1.
    const ran = shell({ QORY_RUN_ID: 'run-1' });
    assert.equal(ran.status, 2, command);
    assert.match(ran.stderr, /^Report this error in your output: the tool guard did not run\.$/m);
    // Outside a run, the guard does not run.
    assert.equal(shell({}).status, 0, command);
  }
});

test('in a run, hook input that is not JSON denies the call', () => {
  const home = harnessHome();
  for (const runtime of ['claude', 'codex']) {
    const ran = (env) => childProcess.spawnSync(process.execPath,
      [path.join(home, 'hooks', `tool-guard-${runtime}.js`)],
      { input: 'not json', env: { ...process.env, ...env }, encoding: 'utf8' });
    const inRun = ran({ QORY_RUN_ID: 'run-1' });
    assert.equal(inRun.status, 0, inRun.stderr);
    firstLine(JSON.parse(inRun.stdout).hookSpecificOutput.permissionDecisionReason,
      'Report this error in your output: the tool guard got hook input that is not JSON.');
    assert.equal(ran({ QORY_RUN_ID: '' }).stdout, '');
  }
});

test('a guard that throws denies the call and asks the agent to report the error', () => {
  // An adapter whose check before the guard throws.
  const script = path.join(next('adapter'), 'tool-guard-broken.js');
  fs.mkdirSync(path.dirname(script));
  fs.writeFileSync(script, `require(${JSON.stringify(path.join(HOOKS, 'tool-guard.js'))})` +
    ".run({ runtime: 'codex', before: () => { throw new Error('a fault of the guard'); } });\n");
  const ran = childProcess.spawnSync(process.execPath, [script], { encoding: 'utf8',
    input: JSON.stringify(codex('Bash', { command: 'ls' })),
    env: { ...process.env, QORY_RUN_ID: 'run-1', CLAUDE_PROJECT_DIR: next('crash') } });
  assert.equal(ran.status, 0, ran.stderr);
  const reason = JSON.parse(ran.stdout).hookSpecificOutput.permissionDecisionReason;
  firstLine(reason, 'Report this error in your output: the tool guard crashed.');
  assert.match(reason, /a fault of the guard/);
});

test('a lost count, a failed step end and a Codex step with no call still count', () => {
  const { root, env, hook } = stepRun();
  const folder = path.join(root, '.qory', 'build', 'steps');
  // A new agent starts at 0; an agent whose count file is lost is at the limit.
  const who = claudeAgent('spec-writer');
  assert.equal(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), null);
  claudeStep(hook, who, [READ]);
  fs.rmSync(path.join(folder, 's-1--a380cc41002eba5f8.json'));
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), LIMITED);
  // An error while the end of a step reads its calls still counts the step.
  const fresh = { ...claudeAgent('spec-writer'), agent_id: 'c7' };
  const script = path.join(next('adapter'), 'tool-guard-failing.js');
  fs.mkdirSync(path.dirname(script));
  fs.writeFileSync(script, `const steps = require(${JSON.stringify(path.join(HOOKS,
    'step-limit.js'))});\nsteps.takeDenied = () => { throw new Error('a lost file'); };\n` +
    `require(${JSON.stringify(path.join(HOOKS, 'tool-guard.js'))}).run({ runtime: 'claude' });\n`);
  const ran = childProcess.spawnSync(process.execPath, [script], { encoding: 'utf8', env,
    input: JSON.stringify({ cwd: root, ...fresh, hook_event_name: 'PostToolBatch',
      tool_calls: [{ ...WRITE, tool_response: 'ok' }] }) });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stderr, /a lost file/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 's-1--c7.json'), 'utf8')),
    { steps: 1 });
  // On Codex, the first request of a new agent sets 0, and a later request with no call
  // counts a step.
  const agent = codexAgent('spec-writer');
  const codexFile = path.join(folder, '01a1df95-ebfe--01a1df95-0000.json');
  assert.equal(hook('codex', { ...agent, hook_event_name: 'PreModelRequest' }), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(codexFile, 'utf8')), { steps: 0 });
  assert.equal(hook('codex', { ...agent, hook_event_name: 'PreModelRequest' }), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(codexFile, 'utf8')), { steps: 1 });
});

test('only a write below the working folder outside .qory/, or a push, resets the count', () => {
  const place = PLACE;
  for (const command of ['echo x > src/a.ts', 'cp /tmp/a src/a.ts', 'rm src/a.ts',
    'git checkout -- src/a.ts', "sed -i 's/a/b/' src/a.ts", 'env tee src/a.ts',
    'qory artifact push spec /tmp/qory-artifacts/spec.md']) {
    assert.equal(countsAsWrite('Bash', { command }, place), true, command);
  }
  for (const command of ['grep -r x . > /tmp/o; cat /tmp/o', 'mkdir -p src/new',
    'chmod +x src/a.ts', 'git checkout main', 'cp src/a.ts /tmp/a', 'echo x > .qory/notes.md',
    "sed -i 's/a/b/' /tmp/a"]) {
    assert.equal(countsAsWrite('Bash', { command }, place), false, command);
  }
  assert.equal(countsAsWrite('Write', { file_path: '/tmp/a.md' }, place), false);
  assert.equal(countsAsWrite('Write', { file_path: 'src/a.ts' }, place), true);
  assert.equal(countsAsWrite('apply_patch', patch('../outside.ts'), place), false);
  // At the limit, a read with a write to /tmp is denied, and a write below the folder runs.
  const { hook } = stepRun();
  const who = claudeAgent('spec-writer');
  const tmp = { tool_name: 'Bash', tool_input: { command: 'grep -r x . > /tmp/o; cat /tmp/o' },
    tool_use_id: 't6' };
  for (let step = 1; step <= steps.LIMIT; step += 1) {
    assert.equal(claudeStep(hook, who, [tmp]), null, `step ${step}`);
  }
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...tmp }), LIMITED);
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'mkdir -p src/x' } }), LIMITED);
  assert.equal(claudeStep(hook, who, [WRITE]), null);
});

test('a writer at the limit writes its draft in the artifact folder, and the count resets', () => {
  const { folder } = require(path.join(HOOKS, 'end-gate.js'));
  const { root, env, hook } = stepRun();
  const artifacts = folder(root, env);
  const place = { cwd: root, root,
    artifacts: fs.existsSync(artifacts) ? fs.realpathSync.native(artifacts) : artifacts };
  assert.equal(countsAsWrite('Write', { file_path: path.join(artifacts, 'spec.md') }, place),
    true);
  assert.equal(countsAsWrite('Bash', { command: `echo x > ${path.join(artifacts, 'a.md')}` },
    place), true);
  assert.equal(countsAsWrite('Bash', { command: 'echo x > /tmp/elsewhere.md' }, place), false);
  const who = claudeAgent('harness:spec-writer');
  for (let step = 1; step <= steps.LIMIT; step += 1) claudeStep(hook, who, [READ]);
  firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), LIMITED);
  const draft = { tool_name: 'Write', tool_input: { file_path: path.join(artifacts, 'spec.md'),
    content: '# Spec' }, tool_use_id: 't7' };
  assert.equal(claudeStep(hook, who, [draft]), null);
  const file = path.join(root, '.qory', 'build', 'steps', 's-1--a380cc41002eba5f8.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { steps: 0 });
});

test('on Codex, the working folder is the folder of the hook, not the cwd of a call', () => {
  const home = harnessHome();
  const env = { ...fakeQory(server()), QORY_HARNESS_HOME: home };
  delete env.CLAUDE_PROJECT_DIR;
  const src = path.join(WORK, 'src');
  fs.mkdirSync(src, { recursive: true });
  // Codex runs the hook in the folder of the session, and gives the workdir of a shell call
  // as cwd.
  const run = (runtime, input, extra = {}) => {
    const ran = childProcess.spawnSync(process.execPath,
      [path.join(home, 'hooks', `tool-guard-${runtime}.js`)],
      { input: JSON.stringify(input), env: { ...env, ...extra }, cwd: WORK, encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    return ran.stdout === '' ? null : JSON.parse(ran.stdout).hookSpecificOutput
      .permissionDecisionReason;
  };
  const shell = (command) => ({ ...codex('Bash', { command }, 'implementer'), cwd: src });
  const lockStart = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  firstLine(run('codex', shell(`rm ../${CHECK_PATH}`)), lockStart);
  firstLine(run('codex', shell(`rm ${LOCKED}`)), lockStart);
  firstLine(run('codex', shell('echo x > ../.qory/build/x')), 'Leave .qory/build/ as it is');
  assert.equal(run('codex', shell('echo x > a.ts')), null);
  // Claude Code gives the working folder in CLAUDE_PROJECT_DIR; with none, a run denies each
  // call, and outside a run nothing is denied.
  const write = { ...claude('Edit', { file_path: `../${CHECK_PATH}` }, 'implementer'), cwd: src };
  firstLine(run('claude', write, { CLAUDE_PROJECT_DIR: WORK }), lockStart);
  firstLine(run('claude', write), 'Start the session through qory');
  firstLine(run('claude', claude('Read', { file_path: 'a.ts' })), 'Start the session through qory');
  assert.equal(run('claude', write, { QORY_RUN_ID: '' }), null);
  firstLine(decide({ input: claude('Write', { file_path: 'a.ts' }, 'w'), env: RUN, locked }),
    'Start the session through qory');
});

test('on Codex, the count of an agent stays in the folder of the hook', () => {
  const { root, env, hook } = stepRun();
  delete env.CLAUDE_PROJECT_DIR;
  fs.mkdirSync(path.join(root, 'src'));
  const who = { ...codexAgent('implementer'), cwd: path.join(root, 'src') };
  for (let step = 1; step <= steps.LIMIT; step += 1) codexStep(hook, who, [READ]);
  assert.equal(fs.existsSync(path.join(root, 'src', '.qory')), false);
  firstLine(codexStep(hook, who, [READ]), LIMITED);
});

test('an artifact folder that is a link is no artifact folder', () => {
  const { root, hook } = stepRun();
  fs.mkdirSync(path.join(root, '.qory'));
  // The link points to a folder above the file of the write.
  fs.symlinkSync(tmp, path.join(root, '.qory', 'artifacts'));
  const outside = path.join(next('outside'), 'x.md');
  // The main session cannot write through the link, and the reason says to replace it.
  const reason = firstLine(hook('claude', { ...claudeAgent(null), hook_event_name: 'PreToolUse',
    tool_name: 'Write', tool_input: { file_path: outside, content: 'x' }, tool_use_id: 't1' }),
  'Replace the link at the artifact folder with a folder: a link is no artifact folder.');
  assert.equal(reason.split('\n')[1], 'The main session writes only in the artifact folder, ' +
    `and ${path.join(root, '.qory', 'artifacts')} is a link; this call writes ${outside}.`);
  // A write outside the working folder does not reset the count of an agent.
  const who = claudeAgent('harness:spec-writer');
  for (let step = 1; step <= steps.LIMIT; step += 1) claudeStep(hook, who, [READ]);
  const write = { tool_name: 'Write', tool_input: { file_path: outside, content: 'x' },
    tool_use_id: 't7' };
  firstLine(claudeStep(hook, who, [write]), LIMITED);
});
