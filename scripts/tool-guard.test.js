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
const guardModule = require(path.join(HOOKS, 'tool-guard.js'));
const { lockedFiles, patchPaths, countsAsWrite } = guardModule;

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tool-guard-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// The artifact folder of a run, which no test makes, so that a /tmp/qory-artifacts that
// another run left on this machine changes no test.
const RUN_FOLDER = path.join(tmp, 'qory-artifacts');
const decide = (args) => guardModule.decide({ runFolder: RUN_FOLDER, ...args });

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
  for (const command of [`cat ${CHECK_PATH}`,
    `grep -n reply ${CHECK_PATH} > /tmp/out.txt`, 'echo x > checks/other.check.ts',
    `git restore --staged ${CHECK_PATH}`, `git -C . restore -S ${CHECK_PATH}`,
    `sh -c 'ls ${CHECK_PATH}'`]) {
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
      'echo x > ./src/../checks/corrected-reply.check.ts', `echo x >| ${file}`,
      `echo x>|${file}`, `nohup rm ${file}`, `time rm ${file}`, `time -p rm ${file}`,
      `stdbuf -oL tee ${file}`, `stdbuf -o L tee ${file}`, `ls | xargs rm ${file}`,
      `xargs -n 1 -I {} cp {} ${file}`, `doas -u root rm ${file}`, `ionice -c 3 rm ${file}`,
      `busybox rm ${file}`, `nohup nice -n 5 busybox cp a ${file}`,
      // time writes the file of -o, and sudo -e edits the files after it.
      `time -o ${file} true`, `/usr/bin/time -o ${file} true`,
      `command time --output=${file} true`, `time -a -o ${file} true`, `time -ao ${file} true`,
      `time -o${file} true`, `time --output ${file} true`, `env time -f %e -o '${file}' true`,
      `sudo -e ${file}`, `sudo --edit ${file}`, `sudo -u root -e ${file}`,
      `sudoedit ${file}`, `/usr/bin/sudoedit -u root ${file}`]) {
      firstLine(guard(claude('Bash', { command }, 'implementer')), start);
      firstLine(guard(codex('Bash', { command })), start);
    }
    for (const command of ['cp -r checks /tmp/checks-copy', 'rm -rf src', 'mv src/a.ts src/b.ts',
      'git -C . rm src/other.ts', 'rm -rf checks-old', 'env ls checks', 'mkdir -p checks/new',
      'timeout 5 grep -r x checks', 'git checkout main', 'git checkout -b fix-x',
      'git restore --staged checks', 'time -o src/time.txt cat checks/a.ts',
      'time -f %e -o /dev/null ls checks', 'sudo -u root cat checks/a.ts']) {
      assert.equal(guard(claude('Bash', { command }, 'implementer')), null, command);
    }
  });

test('a command name with quotes or backslashes is read as the shell reads it', () => {
  const locked = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  const built = 'Leave .qory/build/ as it is: the step limit keeps the step count of each';
  for (const command of [`\\cp /dev/null ${CHECK_PATH}`, `c\\p /dev/null ${CHECK_PATH}`,
    `"c"p /dev/null ${CHECK_PATH}`, `c''p /dev/null ${CHECK_PATH}`, `$'cp' /dev/null ${CHECK_PATH}`,
    `"rm" ${CHECK_PATH}`, `env \\rm ${CHECK_PATH}`, `\\sh -c 'rm ${CHECK_PATH}'`,
    `"ba"sh -c 'rm ${CHECK_PATH}'`]) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  for (const command of ['\\cp /tmp/z .qory/build/steps/s.json', '\\rm -rf .qory/build']) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), built);
  }
  firstLine(guard(codex('Bash', { command: '\\chmod -R a-w .qory/build' }, 'implementer')),
    'Leave the mode and owner of .qory/ and the folders above it as they are.');
});

test('a path is read through its links before each .., as the system reads it', () => {
  const locked = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  const outside = next('outside');
  fs.mkdirSync(path.join(outside, 'd'), { recursive: true });
  const made = ['checks/x', 'l4', 'lf4', 'dl4', 'dirl4'].map((one) => path.join(WORK, one));
  fs.mkdirSync(made[0]);
  fs.symlinkSync('checks/x', made[1]);
  fs.symlinkSync(CHECK_PATH, made[2]);
  fs.symlinkSync(path.join(outside, 'missing'), made[3]);
  fs.symlinkSync(path.join(outside, 'd'), made[4]);
  try {
    for (const command of ['echo y > l4/../corrected-reply.check.ts', 'echo y > lf4',
      'rm l4/../corrected-reply.check.ts']) {
      firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
    }
    firstLine(guard(claude('Write', { file_path: `${WORK}/l4/../corrected-reply.check.ts`,
      content: 'x' }, 'implementer')), locked);
    firstLine(guard(codex('Bash', { command: 'mkdir -p checks/y && ln -s checks/y l5 && ' +
      'echo y > l5/../corrected-reply.check.ts' }, 'implementer')),
    'Write the path without a .. after a folder that does not exist yet');
    const counts = (command) => countsAsWrite('Bash', { command }, PLACE);
    assert.equal(counts('echo x > dirl4/../x'), false);
    assert.equal(counts('echo x > dl4'), false);
    assert.equal(counts('echo x > l4/y'), true);
  } finally {
    for (const one of made.slice(1)) fs.rmSync(one, { force: true });
    fs.rmSync(made[0], { recursive: true, force: true });
  }
});

test('a command whose writes the guard does not read is denied when it reaches a locked file',
  () => {
    const opaque = 'Run the checks with no file path or `checks.js run locked`; read a locked ' +
      'file with `cat <file>`.';
    // The first line names the forms that pass, and the next line the command and the file.
    const reason = firstLine(guard(codex('Bash', { command: `npx vitest run ${CHECK_PATH}` },
      'implementer')), opaque);
    assert.equal(reason.split('\n')[0], opaque);
    assert.equal(reason.split('\n')[1], 'The guard cannot tell what npx writes, and the call ' +
      `contains corrected-reply.check.ts, which reaches ${CHECK_PATH}.`);
    const file = CHECK_PATH;
    for (const command of [`node -e "require('fs').writeFileSync('${file}', 'x')"`,
      `python3 -c "open('${file}', 'w')"`, `bash -c rm\\ ${file}`, `printf 'rm ${file}' | bash`,
      `curl -o ${file} https://example.com/x`, 'tar -xf a.tar checks', 'node x.js checks/',
      `cd checks && node -e "require('fs').rmSync('corrected-reply.check.ts')"`,
      'node x.js checks/*.ts', `npm run check -- ${file}`, `X=1 git -c a=b log ${file}`,
      `python3 <<'EOF'\nopen('${file}', 'w')\nEOF`, `make -C checks`, `\\node -e "rm('${file}')"`,
      `find checks -name x -exec node {} \\;`]) {
      const reason = guard(codex('Bash', { command }, 'implementer'));
      assert.ok(typeof reason === 'string' && [opaque, 'Leave the locked file as it is']
        .some((one) => reason.startsWith(one)), `${command}: ${reason}`);
    }
    firstLine(guard(codex('Bash', { command: "node -e \"fs.writeFileSync('.qory/build/steps/s." +
      "json', '{}')\"" }, 'implementer')), 'Leave .qory/build/ as it is');
    for (const command of ['node -e "console.log(1)"', 'npm test', 'npm run build',
      'python3 -c "print(1)"', 'curl -o /tmp/x https://example.com', `sed -n 1,20p ${file}`,
      `git restore --staged ${file}`, `grep -n x ${file}`, "find checks -name '*.ts'",
      `sh -c 'ls ${file}'`, 'make build', 'git status', `if grep -q x ${file}; then echo y; fi`,
      `for f in checks/*; do echo "$f"; done`, `cat ${file} | wc -l`,
      // The working folder and the folders above it run over the whole folder, as a command
      // with no path does.
      'tar -xf a.tar -C .', 'npx eslint .', `node x.js ${WORK}`, 'node x.js ..', 'ls -la /']) {
      assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
    }
    // Each step of the skills that runs the checks passes with a file locked; a locked check
    // runs through `run locked`.
    const checks = '$QORY_HARNESS_HOME/claude/plugin/skills/running-a-workflow/checks.js';
    for (const step of ['run locked', 'run locked ac-1 ac-2', 'run targeted src/reply.test.ts',
      'run lint', 'run types', 'run build', 'suite start', 'suite result su-1', 'scope 3',
      'freeze 3', 'diff --from 1a2b3c4', 'lock --verify', 'fixes',
      'probe .qory/artifacts/p.patch targeted src/reply.test.ts',
      'check points .qory/artifacts/points.json --inputs /tmp/in/inputs.json']) {
      assert.equal(guard(codex('Bash', { command: `${checks} ${step}` }, 'implementer')), null,
        step);
    }
    firstLine(guard(codex('Bash', { command: `${checks} run targeted ${file}` }, 'implementer')),
      opaque);
    // An opaque command is read after the shell removes quotes and expands braces.
    for (const command of [`python3 -c 'x' ch''ecks`, `python3 -c 'x' $'\\x63hecks'`,
      'node x.js {c..c}hecks', `node x.js checks/corrected-reply.check.{s..u}s`]) {
      firstLine(guard(codex('Bash', { command }, 'implementer')), opaque);
    }
    firstLine(guard(codex('Bash', { command: "node x.js .q''ory/build" }, 'implementer')),
      'Leave .qory/build/ as it is');
    firstLine(guard(codex('Bash', { command: 'rm -rf {c..c}hecks' }, 'implementer')),
      'Leave the locked file as it is');
    // xargs and parallel run a writer or an opaque command with words from their input.
    for (const command of ['echo checks | xargs rm -rf', 'echo checks | parallel rm -rf',
      `printf '%s' ${file} | xargs -n1 node x.js`]) {
      firstLine(guard(codex('Bash', { command }, 'implementer')), opaque);
    }
    assert.equal(guard(codex('Bash', { command: 'echo checks | xargs rm -rf' },
      'implementer')).split('\n')[1], 'The guard cannot tell what xargs rm writes, and the ' +
      'call contains checks, which reaches checks/corrected-reply.check.ts.');
    for (const command of ['echo src/a | xargs rm -f', 'find checks -name x | xargs grep -n y',
      "find checks -name '*.ts' | xargs wc -l"]) {
      assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
    }
    // A read-only command keeps only its read-only options: any other option, such as one
    // that runs a command, makes it opaque.
    // The value of such an option is no subcommand, in the form --option value too: each
    // command of READ_ONLY in tool-guard.js with an option outside its list.
    const source = fs.readFileSync(path.join(HOOKS, 'tool-guard.js'), 'utf8');
    const list = source.slice(source.indexOf('const READ_ONLY = new Map('));
    const names = [...list.slice(0, list.indexOf('}));')).matchAll(
      /^ {2}(?:'([^']+)'|([\w-]+)): \{ short: '([^']*)'/gm)]
      .filter((match) => match[3] !== '*').map((match) => match[1] || match[2])
      // A cd runs no command and writes no file.
      .filter((name) => !['cd', 'pushd', 'popd'].includes(name));
    assert.ok(names.length > 20, names.join(' '));
    for (const name of names) {
      firstLine(guard(codex('Bash', { command: `${name} --pre rm x checks` }, 'implementer')),
        opaque);
    }
    firstLine(guard(codex('Bash', { command: 'rg --pre rm --hidden -uu x .qory/build' },
      'implementer')), 'Leave .qory/build/ as it is');
    for (const command of ['rg --pre=rm x checks', `rg --pre=sh x ${file}`,
      `sort --compress-program=rm ${file}`, `file -C -m ${file}`, `tree -R -H . checks`,
      `grep --no-such-option x ${file}`, `find checks -name x -delete-all`]) {
      firstLine(guard(codex('Bash', { command }, 'implementer')), opaque);
    }
    for (const command of ['rg -n x checks', `grep -rn --include=*.ts x checks`,
      `sort -k2 -t, ${file}`, "find checks -name '*.ts' -mtime -7 -print", `head -20 ${file}`,
      `tail -n 5 ${file}`, 'ls -la checks', `wc -l ${file}`, `cut -d, -f1 ${file}`,
      `rg -g '*.ts' -e x checks`, `find checks -type f -exec grep -n x {} +`]) {
      assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
    }
  });

test('a write to .qory/build/ is denied, on Claude Code and on Codex', () => {
  const ledger = path.join(WORK, '.qory', 'build', 'steps.json');
  const start = 'Leave .qory/build/ as it is: the step limit keeps the step count of each ' +
    'agent there.';
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
  assert.ok(locked.endsWith("A change to a locked file fails Verify's lock --verify --version " +
    '<N>.'), locked);
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
  // Codex trims white space from both ends of a line before it reads a header: U+0085 too.
  assert.deepEqual(patchPaths(' *** Delete File: a.ts\n\t*** Move to: b.ts \r\n' +
    '\u00a0*** Add File: c.ts\u3000\n\u0085*** Update File: d.ts\n*** Add File:e.ts\n'),
  ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  const start = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  for (const header of [' *** Delete File: ', '\t*** Update File: ', '  *** Move to: ']) {
    const text = `*** Begin Patch\n*** Update File: src/a.ts\n${header}${CHECK_PATH}\n` +
      '*** End Patch\n';
    firstLine(guard(codex('apply_patch', { command: text }, 'default')), start);
    firstLine(guard(codex('Bash', { command: `apply_patch <<'EOF'\n${text}EOF\n` }, 'default')),
      start);
  }
});

// harnessHome makes a folder with the layout of a composed harness, hooks/ and
// modules/<name>/, and returns it.
function harnessHome() {
  const home = next('home');
  fs.mkdirSync(path.join(home, 'modules'), { recursive: true });
  // The hooks are a copy whose artifact folder of a run is RUN_FOLDER.
  fs.cpSync(HOOKS, path.join(home, 'hooks'), { recursive: true });
  const gate = path.join(home, 'hooks', 'end-gate.js');
  const text = fs.readFileSync(gate, 'utf8');
  const line = "const RUN_FOLDER = '/tmp/qory-artifacts';";
  assert.ok(text.includes(line), 'end-gate.js sets the artifact folder of a run');
  fs.writeFileSync(gate, text.replace(line, `const RUN_FOLDER = ${JSON.stringify(RUN_FOLDER)};`));
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
  denied(run('codex', codex('apply_patch', patch('/tmp/qory-artifacts/.reports/starts.json'),
    'default')), 'Write no file under .reports/');
  denied(run('codex', codex('Bash', { command: 'rm /tmp/qory-artifacts/.reports/end.json' })),
    'Run no shell command on .reports/');
  // On Claude Code, decide runs reports-guard too, for each tool.
  for (const command of ['echo {} > .qory/artifacts/.reports/findings.json',
    'rm -rf .qory/artifacts/.reports']) {
    denied(run('claude', claude('Bash', { command }, 'implementer')),
      'Run no shell command on .reports/');
  }
  denied(run('claude', claude('Write', { file_path: `${RUN_FOLDER}/.reports/findings.json`,
    content: '{}' }, 'implementer')), 'Write no file under .reports/');
  denied(run('claude', claude('Edit', { file_path: `${RUN_FOLDER}/.reports/starts.json.lock` },
    'implementer')), 'Write no file under .reports/');
  // checks.js of the harness alone is the one command that reaches .reports/.
  const checks = path.join(home, 'modules', 'core', 'skills', 'running-a-workflow', 'checks.js');
  for (const runtime of ['claude', 'codex']) {
    const input = (runtime === 'claude' ? claude : codex)('Bash',
      { command: `node ${checks} findings ${RUN_FOLDER}/.reports/findings.json` }, 'implementer');
    assert.equal(run(runtime, input), null, runtime);
  }
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
  assert.equal(steps.readOnly(home, 'harness:../spec-reviewer', 'claude'), false);
  // On Codex, no agent is read-only: apply_patch writes in every role.
  assert.equal(steps.readOnly(home, 'spec-reviewer', 'codex'), false);
  assert.equal(steps.readOnly(home, 'harness:spec-reviewer', 'codex'), false);
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
  assert.equal(steps.readOnly(home, 'harness:list-reader', 'claude'), true);
  assert.equal(steps.readOnly(home, 'harness:flow-reader', 'claude'), true);
  for (const name of ['list-writer', 'empty-tools', 'flow-empty']) {
    assert.equal(steps.readOnly(home, `harness:${name}`, 'claude'), false, name);
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
  for (let step = 1; step <= steps.LIMIT + 2; step += 1) {
    assert.equal(codexStep(hook, codexAgent(null), [{ tool_name: 'Bash',
      tool_input: { command: 'ls' } }]), null);
  }
  assert.equal(fs.existsSync(path.join(root, '.qory', 'build', 'steps')), false);
});

test('on Codex, an agent whose file lists only read tools is limited, as apply_patch writes',
  () => {
    const { hook } = stepRun();
    const ls = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    const who = codexAgent('spec-reviewer');
    for (let step = 1; step <= steps.LIMIT; step += 1) {
      assert.equal(codexStep(hook, who, [ls]), null);
    }
    firstLine(codexStep(hook, who, [ls]), LIMITED);
  });

test('a harness home below the working folder cannot be written, and its links exempt no one',
  () => {
    const { root, env, hook } = stepRun();
    const home = path.join(root, '.qory', 'harness');
    fs.mkdirSync(path.join(home, 'modules'), { recursive: true });
    fs.cpSync(path.join(MODULES, 'software-factory', 'agents'),
      path.join(home, 'modules', 'sf', 'agents'), { recursive: true });
    const agentFile = path.join(home, 'modules', 'sf', 'agents', 'spec-reviewer.md');
    const run = { ...env, QORY_HARNESS_HOME: home };
    const write = (command) => decide({ input: { ...codex('Bash', { command }, 'implementer'),
      cwd: root }, env: run, root, locked: () => ({ files: [] }) });
    const start = 'Leave the composed harness as it is: the step limit reads the tools of each ' +
      'agent from it.';
    firstLine(write(`sed -i s/Read/Write/ ${agentFile}`), start);
    firstLine(write('echo x >> .qory/harness/modules/sf/agents/spec-reviewer.md'), start);
    firstLine(write('rm -rf .qory/harness'), start);
    firstLine(decide({ input: { ...claude('Edit', { file_path: agentFile }, 'implementer'),
      cwd: root }, env: run, root, locked: () => ({ files: [] }) }), start);
    assert.equal(write('echo x > src/a.ts'), null);
    // The home is denied, so its reviewer is exempt on Claude Code.
    assert.equal(steps.readOnly(home, 'harness:spec-reviewer', 'claude', root), true);
    // A module that links to a folder of the working folder outside the home exempts no one.
    const moved = path.join(root, 'moved-sf');
    fs.renameSync(path.join(home, 'modules', 'sf'), moved);
    fs.symlinkSync(moved, path.join(home, 'modules', 'sf'));
    assert.equal(steps.readOnly(home, 'harness:spec-reviewer', 'claude', root), false);
    env.QORY_HARNESS_HOME = home;
    const who = claudeAgent('harness:spec-reviewer');
    for (let step = 1; step <= steps.LIMIT; step += 1) claudeStep(hook, who, [READ]);
    firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), LIMITED);
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

test('on Claude Code, each PreToolUse command hook blocks the call when it fails', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(MODULES, 'core', 'settings', 'claude',
    'settings.json'), 'utf8'));
  const hooks = (event) => (settings.hooks[event] || []).flatMap((group) => group.hooks);
  assert.ok(hooks('PreToolUse').length > 0);
  for (const hook of hooks('PreToolUse').filter((one) => one.type === 'command')) {
    assert.equal(hook.onFailure, 'block');
  }
  for (const event of Object.keys(settings.hooks).filter((one) => one !== 'PreToolUse')) {
    assert.ok(hooks(event).every((hook) => !('onFailure' in hook)), event);
  }
  const toml = fs.readFileSync(path.join(MODULES, 'core', 'settings', 'codex', 'config.toml'),
    'utf8');
  assert.ok(!/onFailure|on_failure/.test(toml));
});

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
  const artifacts = folder(root, env, RUN_FOLDER);
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

test('a path after cd, git -C or env -C is read from that folder', () => {
  const start = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  const base = path.basename(CHECK_PATH);
  for (const command of [`cd checks && rm ${base}`, `cd checks; cp /tmp/a ${base}`,
    `cd src && cd ../checks && echo x > ${base}`, `pushd checks && tee ${base}`,
    `cd ${path.join(WORK, 'checks')} && rm -f ${base}`, `cd checks && sh -c 'rm ${base}'`,
    `git -C checks restore ${base}`, `git -C checks checkout -- ${base}`,
    `git -C src -C ../checks rm ${base}`, `env -C checks rm ${base}`,
    `env --chdir=checks rm ${base}`]) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), start);
  }
  for (const command of [`cd src && rm ${base}`, `git -C src restore ${base}`,
    `env -C src rm ${base}`]) {
    assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
  }
});

test('the step count reads a path after cd, git -C or env -C from that folder', () => {
  const outside = next('outside');
  fs.mkdirSync(outside);
  const place = { cwd: WORK, root: WORK };
  const counts = (command) => countsAsWrite('Bash', { command }, place);
  assert.equal(counts('cd src && echo x > a.ts'), true);
  assert.equal(counts(`cd ${outside} && echo x > a.ts`), false);
  assert.equal(counts(`cd ${outside}; cp /tmp/a b.ts`), false);
  assert.equal(counts('cd ~ && echo x > a.ts'), false);
  assert.equal(counts('cd "$TMPDIR" && echo x > a.ts'), false);
  assert.equal(counts(`env -C ${outside} cp /tmp/a b.ts`), false);
  assert.equal(counts(`git -C ${outside} restore a.ts`), false);
  assert.equal(counts(`cd ${outside} && echo x > ${path.join(WORK, 'a.ts')}`), true);
});

test('a write whose path is vague, or a link out of the working folder, resets no count', () => {
  const place = { cwd: WORK, root: WORK };
  const counts = (command) => countsAsWrite('Bash', { command }, place);
  for (const command of ['echo x > ~/x', 'echo x > $HOME/x', 'echo x > "$TMPDIR/x"',
    'f=$(mktemp); ls > "$f"', 'cp /tmp/a ~/b', 'tee `mktemp`', 'echo x > ${OUT}/a.ts']) {
    assert.equal(counts(command), false, command);
  }
  const away = next('away');
  fs.mkdirSync(away);
  fs.symlinkSync(away, path.join(WORK, 'away-link'));
  assert.equal(counts('echo x > away-link/a.md'), false);
  assert.equal(counts('echo x > away-link/new/a.md'), false);
  assert.equal(countsAsWrite('Write', { file_path: path.join(WORK, 'away-link', 'a.md') },
    place), false);
  assert.equal(counts('echo x > src/a.ts'), true);
  fs.rmSync(path.join(WORK, 'away-link'));
});

test('a change of the mode or owner of .qory/ or a folder above it is denied', () => {
  const start = 'Leave the mode and owner of .qory/ and the folders above it as they are.';
  for (const command of ['chmod -w .qory/b*/steps', 'chmod -R -w .qory', 'chmod a-w .',
    `chmod -w ${WORK}`, 'chflags uchg .qory/build/steps', 'chown -R nobody .qory',
    'chmod -w $PWD/.qory/build', 'chmod -w .q*', 'chgrp staff .qory/build',
    'chmod 555 ./src/../.qory/build/steps', 'cd .qory && chmod -w build']) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), start);
  }
  for (const command of ['chmod +x scripts/run.sh', 'chmod -R u+w src', 'chmod 644 *.md']) {
    assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
  }
});

test('a count that the step limit cannot write, or a failed save, limits the agent', () => {
  const { root, env, hook } = stepRun();
  const who = claudeAgent('implementer');
  const args = { input: { ...who, cwd: root }, env, runtime: 'claude', root };
  assert.equal(steps.endStep(args, false), 1);
  const folder = steps.folderOf(root);
  fs.chmodSync(folder, 0o555);
  const unwritable = 'Report to a member: the step limit cannot write the step count of this ' +
    'agent.';
  try {
    const reason = firstLine(steps.limited(args, false), unwritable);
    assert.equal(reason.split('\n')[1], `The count folder is ${folder}; until it can be ` +
      'written, each call that writes nothing is denied.');
    assert.equal(steps.limited(args, true), null);
    firstLine(hook('claude', { ...who, hook_event_name: 'PreToolUse', ...READ }), unwritable);
  } finally {
    fs.chmodSync(folder, 0o755);
  }
  // A save that fails leaves no count, so the marker limits the agent.
  const rename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('no space left on device');
  };
  try {
    assert.throws(() => steps.endStep(args, false), /no space left/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(steps.limited(args, false).split('\n')[0], LIMITED);
});

test('a copy into a folder above a locked file, find -delete and sed --in-place are denied',
  () => {
    const start = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
    const base = path.basename(CHECK_PATH);
    for (const command of [`cp /tmp/${base} checks/`, `cp /tmp/${base} checks`,
      `cp -r /tmp/checks .`, `cp -t checks /tmp/${base}`, `install /tmp/${base} checks/`,
      `rsync -a /tmp/new/ checks/`, `cp /tmp/*.ts checks/`, `cp "$SRC" checks/`,
      'find checks -name "*.ts" -delete', `find . -name ${base} -delete`,
      'find checks -exec rm {} +', 'find checks -type f -execdir rm -f {} ;',
      `find . \\( -name ${base} \\) -delete`, `find checks -exec cp /tmp/a ${base} ;`,
      `find checks -exec sed -i s/a/b/ {} +`, `sed --in-place s/a/b/ ${CHECK_PATH}`,
      `sed --in-place=.bak s/a/b/ ${CHECK_PATH}`, `sed -i.bak s/a/b/ ${CHECK_PATH}`,
      `sed -E -i s/a/b/ ${CHECK_PATH}`, `perl -pi -e s/a/b/ ${CHECK_PATH}`,
      `perl -i.bak -pe s/a/b/ ${CHECK_PATH}`]) {
      firstLine(guard(codex('Bash', { command }, 'implementer')), start);
    }
    // find . reaches .qory/build/ first.
    for (const command of ['find . -delete', 'find . -type f -execdir rm -f {} ;',
      'find . -name "b*" -delete']) {
      firstLine(guard(codex('Bash', { command }, 'implementer')), 'Leave .qory/build/ as it is');
    }
    for (const command of ['cp /tmp/a.ts checks/', 'cp /tmp/x.md src/', 'find . -name "*.log"',
      'find checks -name "*.md" -delete', 'find src -delete', 'find . -exec grep -l x {} +',
      'sed -n p checks/corrected-reply.check.ts', 'cp -r /tmp/docs .']) {
      assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
    }
  });

test('a glob of a remover, a restore or a copy that covers a protected path is denied', () => {
  const locked = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  const built = 'Leave .qory/build/ as it is';
  // The test folder lies below /tmp, so a move names a folder of the working folder.
  for (const command of ['mv chec* old', 'git checkout -- ch*', 'git restore chec?s',
    'rm checks/*.ts', 'rm -f checks/corrected-*', 'cp /tmp/corrected-reply.check.ts che*/',
    'rm -rf [c]hecks']) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  for (const command of ['rm -rf .q*', 'rm -rf .[!.]*', 'rm -rf .qory/b*', 'mv .q* old',
    'rm -f .qory/build/steps/*.json', 'shopt -s dotglob; rm -rf */build',
    'setopt globdots && rm -rf *', 'GLOBIGNORE=x rm -rf */build']) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), built);
  }
  // As in the shell, a wildcard matches no leading dot without dotglob.
  const none = (command) => decide({ input: codex('Bash', { command }, 'implementer'),
    env: RUN, root: WORK, locked: () => ({ files: [] }) });
  assert.equal(none('rm -rf */build'), null);
  assert.equal(none('rm -rf *'), null);
  firstLine(guard(codex('Bash', { command: 'rm -rf *' }, 'implementer')), locked);
  for (const command of ['rm -rf node_mod*', 'rm -rf dist*', 'rm src/*.ts', 'mv src/a* old',
    'git checkout -- src/*', 'cp /tmp/a.ts src*/', 'rm -rf checks-old*']) {
    assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
  }
});

test('a crafted glob is read in linear time, and a bad bracket matches nothing', () => {
  const name = `${'a'.repeat(44)}.ts`;
  const file = path.join(WORK, 'checks', name);
  const lock = () => ({ what: 'acceptance-lock version 1', files: [file] });
  const command = `rm checks/${'*?'.repeat(12)}X`;
  const start = process.hrtime.bigint();
  assert.equal(decide({ input: codex('Bash', { command }, 'implementer'), env: RUN, root: WORK,
    locked: lock }), null);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 100, `${ms} ms`);
  firstLine(decide({ input: codex('Bash', { command: `rm checks/${'*?'.repeat(12)}` },
    'implementer'), env: RUN, root: WORK, locked: lock }), 'Leave the locked file as it is');
  for (const command of ['rm -f [z-a]x', 'rm checks/[z-a]*', 'rm -rf [', 'rm -rf checks/[]']) {
    assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
  }
  firstLine(guard(codex('Bash', { command: 'rm -rf [b-d]hecks' }, 'implementer')),
    'Leave the locked file as it is');
});

test('the step count reads a path from the folder after the last cd, as the shell does', () => {
  const outside = next('outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(WORK, 'src', 'a'), { recursive: true });
  const from = (cwd, command) => countsAsWrite('Bash', { command }, { cwd, root: WORK });
  const src = path.join(WORK, 'src');
  assert.equal(from(src, 'cd .. && echo x > a.ts'), true);
  assert.equal(from(WORK, 'cd src/a && echo x > ../b.ts'), true);
  assert.equal(from(WORK, 'pushd src && popd && echo x > a.ts'), true);
  assert.equal(from(outside, `cd ${src} && echo x > a.ts`), true);
  assert.equal(from(outside, `cd ${src}; cd ${outside}; echo x > a.ts`), false);
  assert.equal(from(outside, `(cd ${src}); echo x > a.ts`), false);
  assert.equal(from(outside, `(cd ${src}; echo x > a.ts)`), true);
  assert.equal(from(outside, `echo $(cd ${src}) > a.ts`), false);
  assert.equal(from(outside, `false && cd ${src}; echo x > a.ts`), false);
  assert.equal(from(outside, `true && cd ${src} && echo x > a.ts`), true);
  assert.equal(from(outside, `cd ${src} || echo x > a.ts`), false);
  assert.equal(from(outside, `cd ${path.join(WORK, 'missing')}; echo x > a.ts`), false);
  assert.equal(from(outside, `cd ${src} & echo x > a.ts`), false);
  assert.equal(from(outside, `popd; echo x > a.ts`), false);
  assert.equal(from(outside, `cd ${src} && sh -c 'echo x > a.ts'`), true);
});

test('a ~ at the start of a word is the home folder, as the shell expands it', () => {
  // The home folder is the folder above WORK, so ~/<name of WORK> is WORK.
  const env = { ...RUN, HOME: path.dirname(WORK) };
  const at = `~/${path.basename(WORK)}`;
  const run = (command) => guard(codex('Bash', { command }, 'implementer'), env);
  for (const command of [`rm -rf ${at}/checks`, `echo x >${at}/${CHECK_PATH}`,
    `time -o ${at}/${CHECK_PATH} ls`, `cd ${at} && rm -rf checks`, `rm -rf ${at}/ch*`]) {
    firstLine(run(command), 'Leave the locked file as it is');
  }
  firstLine(run(`echo x > ${at}/.qory/build/steps/s.json`), 'Leave .qory/build/ as it is');
  firstLine(run(`node x.js ${at}/checks`), 'Run the checks with no file path');
  // A ~+ is the folder that the shell runs the command in.
  for (const command of ['rm -rf ~+/checks', `cd src && rm -rf ~+/../${CHECK_PATH}`,
    `cd ~+/src && rm ../${CHECK_PATH}`]) {
    firstLine(run(command), 'Leave the locked file as it is');
  }
  firstLine(run('echo x > ~+/.qory/build/steps/s.json'), 'Leave .qory/build/ as it is');
  assert.equal(countsAsWrite('Bash', { command: 'echo x > ~+/src/a.ts' }, PLACE), true);
  assert.equal(run('rm -rf ~+/src'), null);
  // A quoted ~, a ~user and $HOME stay as the call has them.
  for (const command of [`rm -rf "${at}/checks"`, `rm -rf ~user/${path.basename(WORK)}/checks`,
    `rm -rf $HOME/${path.basename(WORK)}/checks`, `rm -rf ${at}/src`, 'rm -rf "~+/checks"']) {
    assert.equal(run(command), null, command);
  }
});

test('a call that reaches .reports/ is denied on Claude Code and on Codex', () => {
  const shell = 'Run no shell command on .reports/ other than checks.js alone';
  const hidden = 'Leave .reports/ to checks.js, and name other files with no `$`, backtick, ' +
    'eval or glob.';
  const starts = (reason, start) => firstLine(reason, start);
  for (const make of [claude, codex]) {
    for (const command of ['echo {} > .qory/artifacts/.reports/findings.json',
      'rm -rf .qory/artifacts/.reports']) {
      starts(guard(make('Bash', { command }, 'implementer')), shell);
    }
    for (const command of ['rm -rf .qory/artifacts/.rep*', 'rm .qory/artifacts/.r*/f.json',
      'rm -rf .qory/artifacts/.{rep,x}orts', 'rm -rf .qory/artifacts/.rep{o..o}rts',
      "rm -rf .qory/artifacts/.rep''orts"]) {
      starts(guard(make('Bash', { command }, 'implementer')), hidden);
    }
    starts(guard(make('Write', { file_path: '.qory/artifacts/.reports/findings.json',
      content: '{}' }, 'implementer')), 'Write no file under .reports/');
    // The body of a here-document that bash runs is read; one that cat writes is text.
    starts(guard(make('Bash', { command: "bash <<'EOF'\nrm -rf .qory/artifacts/.reports\nEOF" },
      'implementer')), shell);
    // A call of read-only commands only reads .reports/, as the running-checks skill says.
    for (const command of ['ls .reports', 'cat .qory/artifacts/.reports/build-ledger.json',
      'tail .qory/artifacts/.reports/runs/x.log', 'grep -rn red .qory/artifacts/.reports/runs',
      'cd .qory/artifacts && head -n 20 .reports/findings.json', 'ls .qory/artifacts/.r*']) {
      assert.equal(guard(make('Bash', { command }, 'implementer')), null, command);
    }
    for (const command of ['cat .qory/artifacts/.reports/f.json > copy.json',
      'ls .qory/artifacts/.reports | xargs rm', 'rg --pre rm x .qory/artifacts/.reports',
      'sort -o .qory/artifacts/.reports/f.json x']) {
      starts(guard(make('Bash', { command }, 'implementer')), shell);
    }
    // A * matches no leading dot, so it reaches no .reports folder.
    for (const command of ['ls .qory/artifacts/*', 'rm x{a,b}', 'cat src/*.ts',
      "cat > notes.md <<'EOF'\nClean .reports/ with checks.js.\nEOF"]) {
      assert.equal(guard(make('Bash', { command }, 'implementer')), null, command);
    }
  }
  starts(guard(codex('apply_patch', patch('.qory/artifacts/.reports/starts.json'),
    'implementer')), 'Write no file under .reports/');
  // A patch that the shell runs: its files are checked, though the guard reads its body as
  // text. So is a file that cat or tee writes from a body.
  const report = '.qory/artifacts/.reports/findings.json';
  for (const lines of [[`*** Add File: ${report}`, '+{}'],
    [`*** Update File: ${report}`, '@@', '-a', '+b'],
    ['*** Update File: src/a.ts', `*** Move to: ${report}`, '@@', '-a', '+b']]) {
    const command = ["apply_patch <<'EOF'", '*** Begin Patch', ...lines, '*** End Patch', 'EOF']
      .join('\n');
    starts(guard(codex('Bash', { command }, 'implementer')), 'Write no file under .reports/');
  }
  for (const command of [`tee ${report} <<'EOF'\n{}\nEOF`, `cat <<'EOF' >> ${report}\n{}\nEOF`]) {
    starts(guard(codex('Bash', { command }, 'implementer')), shell);
  }
});

test('a write through a dangling link into .qory/build/ is denied', () => {
  const built = 'Leave .qory/build/ as it is';
  const links = [['dangle-a', path.join(WORK, '.qory', 'build', 'steps', 'missing.json')],
    ['dangle-b', path.join('.qory', 'build', 'no-folder', 'x.json')]];
  for (const [name, target] of links) fs.symlinkSync(target, path.join(WORK, name));
  try {
    for (const [name] of links) {
      for (const command of [`echo x > ${name}`, `cp a.ts ${name}`, `tee ${name} < a.ts`]) {
        firstLine(guard(codex('Bash', { command }, 'implementer')), built);
      }
      firstLine(guard(claude('Write', { file_path: path.join(WORK, name), content: '{}' },
        'implementer')), built);
      firstLine(guard(codex('apply_patch', patch(name), 'implementer')), built);
    }
  } finally {
    for (const [name] of links) fs.unlinkSync(path.join(WORK, name));
  }
});

test('the first line of each deny has at most 100 characters and says what to do', () => {
  const reports = require(path.join(HOOKS, 'reports-guard.js'));
  const texts = { ...guardModule.REASONS, WRITE_REASON: reports.WRITE_REASON,
    SHELL_REASON: reports.SHELL_REASON, HIDDEN_REASON: reports.HIDDEN_REASON,
    STEPS: steps.REASON, UNWRITABLE: steps.UNWRITABLE };
  assert.ok(Object.keys(texts).length >= 19, Object.keys(texts).join(' '));
  for (const [name, text] of Object.entries(texts)) {
    const [first, ...rest] = text.split('\n');
    assert.ok(first.length <= 100, `${name}: ${first.length} characters: ${first}`);
    // The first line starts with a verb in the imperative, as "Run", "Leave" or "Copy,".
    assert.match(first, /^[A-Z][a-z]+[ ,]/, name);
    assert.ok(rest.length > 0, `${name} has a second line`);
  }
});

test('a read-only command with a variable setting is opaque', () => {
  const opaque = 'Run the checks with no file path or';
  const reports = 'Run no shell command on .reports/';
  const set = (target) => [`printf '\\x2d-pre=rm' | RIPGREP_CONFIG_PATH=/dev/stdin rg x ${target}`,
    `export RIPGREP_CONFIG_PATH=/dev/stdin; rg x ${target}`,
    `env RIPGREP_CONFIG_PATH=/dev/stdin rg x ${target}`, `declare -x R=1; rg x ${target}`,
    `typeset -gx R=1; grep -r x ${target}`, `set -a; R=1; rg x ${target}`,
    `set -o allexport; rg x ${target}`, `GREP_OPTIONS=x grep -r y ${target}`,
    `PAGER=x cat ${target}`];
  for (const make of [claude, codex]) {
    for (const command of set('checks')) {
      firstLine(guard(make('Bash', { command }, 'implementer')), opaque);
    }
    for (const command of set('.qory/build')) {
      firstLine(guard(make('Bash', { command }, 'implementer')), 'Leave .qory/build/ as it is');
    }
    for (const command of set('.qory/artifacts/.reports')) {
      firstLine(guard(make('Bash', { command }, 'implementer')), reports);
    }
    // A variable before another command, or exported for a path that reaches nothing, passes.
    for (const command of ['rg x checks', 'LC_ALL=C grep -rn x src', 'export X=1; rg x src',
      'ls .qory/artifacts/.reports', 'X=1; rg x checks']) {
      assert.equal(guard(make('Bash', { command }, 'implementer')), null, command);
    }
  }
});

test('a recursive cp with -T copies into the locked folder', () => {
  for (const command of ['cp -rT src checks', 'cp -r -T src checks', 'cp -aT src checks/',
    'cp --recursive --no-target-directory src checks', 'cp -RT src ./checks']) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), 'Leave the locked file as it is');
  }
  for (const command of ['cp -rT src out', 'cp -rT checks out', 'cp -T src/a.ts checks']) {
    assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
  }
});

test('a shell gets each word after its -c text as a path it can write', () => {
  const opaque = 'Run the checks with no file path or';
  const built = 'Leave .qory/build/ as it is';
  const locked = 'Leave the locked file as it is';
  for (const shell of ['sh', 'bash', 'zsh', 'dash', '/bin/sh']) {
    firstLine(guard(codex('Bash', { command: `${shell} -c ': > "$1"' _ ${CHECK_PATH}` },
      'implementer')), opaque);
    firstLine(guard(codex('Bash', { command: `${shell} -c 'echo x > $0' ${CHECK_PATH}` },
      'implementer')), opaque);
    firstLine(guard(codex('Bash', { command: `${shell} -c ': > "$1"' _ .qory/build/steps/s.json` },
      'implementer')), built);
    // find gets the paths that it walks to the shell of its -exec.
    for (const command of [`find ${CHECK_PATH} -exec ${shell} -c 'cat /dev/null > $0' {} \\;`,
      `find checks -exec ${shell} -c 'echo > "$1"' _ {} +`,
      `find . -name '*.ts' -execdir ${shell} -c ': > "$0"' {} \\;`]) {
      firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
    }
    firstLine(guard(codex('Bash', { command: `find .qory/build -exec ${shell} -c ': > $0' {} +` },
      'implementer')), built);
    for (const command of [`${shell} -c 'echo hi'`, `${shell} -c 'echo $1' _ src/a.ts`,
      `find src -exec ${shell} -c 'wc -l "$0"' {} \\;`]) {
      assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
    }
  }
});

test('each redirect of bash and zsh that writes a file is read as one', () => {
  const locked = 'Leave the locked file as it is';
  for (const op of ['>!', '>>!', '>|', '>>|', '&>', '&>>', '&>!', '&>|', '&>>!', '&>>|', '>&',
    '>>&', '>&!', '>&|', '>>&!', '>>&|', '2>!', '1>|', '<>']) {
    for (const command of [`echo x ${op} ${CHECK_PATH}`, `echo x ${op}${CHECK_PATH}`]) {
      firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
    }
    assert.equal(countsAsWrite('Bash', { command: `echo x ${op} src/a.ts` }, PLACE), true, op);
  }
  firstLine(guard(codex('Bash', { command: 'echo 0 >! .qory/build/steps/s.json' },
    'implementer')), 'Leave .qory/build/ as it is');
  // A >& to a stream, or a > in quotes, writes no file.
  for (const command of ['echo x >&2', 'echo x 2>&1', 'echo x >&-', 'echo x >& 2',
    `echo "x >! ${CHECK_PATH}"`]) {
    assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
    assert.equal(countsAsWrite('Bash', { command }, PLACE), false, command);
  }
});

test('the step count reads a redirect outside quotes and comments, and a subcommand', () => {
  const count = (command) => countsAsWrite('Bash', { command }, PLACE);
  for (const command of ['echo "a > src/x"', 'echo hi # > src/x', 'echo rm src/x',
    "echo '>' src/x", '# rm src/x', 'x=1 # rm a > src/b', 'printf rm src/x']) {
    assert.equal(count(command), false, command);
  }
  for (const command of ['echo a > src/x', 'echo a>src/x # c', 'echo a >> "src/my x"',
    'echo a 2>src/x', 'vcs rm src/x', "sh -c 'echo x > src/a.ts'"]) {
    assert.equal(count(command), true, command);
  }
});

test('quotes and backslashes inside a word, and simple braces, are read as the shell does', () => {
  const locked = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  const base = path.basename(CHECK_PATH);
  for (const command of [`rm c"h"ecks/${base}`, `rm \\checks/${base}`, `rm "che"*/${base}`,
    'rm -rf {checks,x}', `rm checks/{a,${base}}`, `echo x > ch'ecks'/${base}`,
    `cp /tmp/a "checks"/${base}`, `rm -rf x{,y,z}/../checks`, `rm 'checks'/c"orrected"*`]) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  // A quoted wildcard is a character of the name.
  for (const command of [`rm 'chec*'`, `rm "checks/*"`, 'rm chec\\*', 'rm -rf {src,dist}',
    'echo "{checks,x}" > notes.md']) {
    assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
  }
});

test('braces are expanded in linear time, and a brace past the cap or nested is a wildcard',
  () => {
    const locked = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
    for (const command of [`rm ${'{a,b}'.repeat(30)}`, `rm {${','.repeat(100 * 1024)}}`,
      `rm ${'{'.repeat(100 * 1024)}`, `rm ${'{a,'.repeat(20 * 1024)}`]) {
      const start = process.hrtime.bigint();
      guard(codex('Bash', { command }, 'implementer'));
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      assert.ok(ms < 100, `${command.slice(0, 20)}: ${ms} ms`);
    }
    const many = Array.from({ length: 64 }, (_, at) => `z${at}`).join(',');
    for (const command of [`rm -rf {${many},checks}`, `rm -rf ${'{a,b}'.repeat(6)}{checks,x}`,
      'rm -rf {checks,{x,y}}', 'rm -rf "a"{checks,x}/../checks']) {
      firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
    }
    assert.equal(guard(codex('Bash', { command: 'rm -rf {src,{x,y}}/a.ts' }, 'implementer')),
      null);
  });

test('a write through an entry that an earlier command of the call makes is denied', () => {
  const start = 'Copy, move or link in one call, and write below the result in a later call.';
  const base = path.basename(CHECK_PATH);
  // A link to the locked folder that an earlier call made.
  const old = path.join(WORK, 'old-link');
  fs.symlinkSync('checks', old);
  try {
    for (const command of [`ln -s checks l && echo x > l/${base}`,
      'ln -s .qory q && echo 0 > q/build/steps/s.json',
      `cp -al checks c2 && echo x > c2/${base}`, `ln -s checks l; cd l && echo x > ${base}`,
      'rsync -a checks/ c3/ && rm c3/*', 'ln -s "$D" l && echo x > l/a.ts',
      `cp -a old-link l2 && echo x > l2/${base}`, `cp -R old-link l2 && echo x > l2/${base}`,
      `cp -P old-link l2 && echo x > l2/${base}`, 'cp -r checks c4 && echo x > c4/a.ts',
      'rsync -a src/ out/ && echo done > out/stamp', 'tar -xf a.tar && echo x > src/a.ts',
      'unzip a.zip -d out && echo x > out/a.ts', 'node x.js l5 && echo x > l5/a.ts',
      'cp -a a.ts $D && echo x > src/b.ts', 'mklink l6 src && echo x > src/b.ts',
      'cp --preserve=mode,links a.ts b.ts && echo x > b.ts', 'cp -Q a.ts b.ts && echo x > b.ts',
      'cp --no-such-option a.ts b.ts && echo x > b.ts']) {
      firstLine(guard(codex('Bash', { command }, 'implementer')), start);
    }
    for (const command of ['ln -s ../shared lib && echo x > src/a.ts', 'ln -s a b',
      'mkdir -p out && ln -s ../out o', 'echo x > l/a.ts; ln -s checks l',
      'rsync -a src/ out/ && echo done > stamp', 'tar -czf a.tgz src && echo x > src/a.ts',
      'unzip a.zip -d out && echo x > src/a.ts', 'node x.js && echo x > src/a.ts',
      'mkdir out && echo x > out/a.ts', 'touch a.ts && echo x > a.ts',
      // A cp with no option that keeps links follows each link and writes regular files.
      'cp a.ts b.ts && echo x >> b.ts', 'cp -pv a.ts b.ts && echo x > b.ts',
      'cp --preserve=mode a.ts b.ts && echo x > b.ts', 'cp -S .bak a.ts b.ts && echo x > b.ts',
      'cp -t out a.ts && echo x > out/a.ts', 'cp --suffix .bak -f a.ts b.ts && echo x > b.ts']) {
      assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
    }
    // Such a write is unknown, so the step count reads it as no write.
    const outside = next('made');
    fs.mkdirSync(outside);
    const count = (command) => countsAsWrite('Bash', { command }, PLACE);
    assert.equal(count(`cp -a old-link ${outside}/l && echo x > ${outside}/l/a.ts`), false);
    assert.equal(count(`cp -a old-link ${outside}/l && echo x > src/a.ts`), true);
    assert.equal(count(`mkdir ${outside}/m && echo x > src/a.ts`), true);
  } finally {
    fs.unlinkSync(old);
  }
});

test('a folder that the guard cannot follow is unknown: a relative write there is denied',
  () => {
    const lost = 'Write with a path that starts with /: the guard cannot tell the folder';
    const built = 'Leave .qory/build/ as it is';
    for (const command of ['builtin cd .qory && touch build/pwned', 'eval cd .qory; touch build/x',
      'CDPATH=.qory cd build && touch steps/pwned', 'cd "$X" && echo x > a',
      'for d in a b; do cd src; done; rm a.ts', 'f() { cd .qory; }; f; touch build/x',
      'source ./env.sh; rm a.ts', 'echo | cd .qory; touch build/x', 'cd; rm a.ts',
      'setopt auto_cd; .qory; touch build/x', 'if true; then cd .qory; fi; rm -rf build']) {
      const reason = guard(codex('Bash', { command }, 'implementer'));
      assert.ok(typeof reason === 'string' && [lost, built].some((one) => reason.startsWith(one)),
        `${command}: ${reason}`);
    }
    firstLine(guard(codex('Bash', { command: 'command cd .qory/build && touch steps/pwned' },
      'implementer')), built);
    for (const command of ['cd src && echo x > a.ts', 'cd "$X" && echo x > /tmp/a',
      'eval "$(x)"; ls', 'cd src; rm "$f"']) {
      assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
    }
    const outside = next('outside');
    const counts = (command) => countsAsWrite('Bash', { command }, { cwd: outside, root: WORK });
    assert.equal(counts(`cd ${outside}; if false; then cd ${WORK}; fi; echo x > a`), false);
    assert.equal(counts(`cd ${outside}; for d in a; do cd ${WORK}; done; echo x > a`), false);
    assert.equal(counts(`builtin cd ${WORK}; echo x > a`), false);
    assert.equal(counts(`cd ${WORK} && echo x > a`), true);
  });

test('a cd whose folder cannot be read leaves the folder unknown, with no crash', () => {
  const noperm = path.join(WORK, 'noperm');
  fs.mkdirSync(noperm, { recursive: true });
  fs.chmodSync(noperm, 0o000);
  try {
    for (const command of ['cd noperm/x && echo x > a.ts', `cd ${'a'.repeat(300)} && rm a.ts`,
      'cd a\0b && rm a.ts']) {
      assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
      assert.equal(countsAsWrite('Bash', { command }, { cwd: WORK, root: WORK }), false);
    }
  } finally {
    fs.chmodSync(noperm, 0o755);
    fs.rmSync(noperm, { recursive: true, force: true });
  }
});

test("a word in $'...' is read as the shell reads it", () => {
  const locked = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  const base = path.basename(CHECK_PATH);
  for (const command of [`rm $'checks'/${base}`, `rm $'che\\x63ks'/${base}`,
    `rm $'che\\143ks/'${base}`, `rm c$'h'ecks/${base}`]) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  assert.equal(guard(codex('Bash', { command: "rm $'chec*'" }, 'implementer')), null);
});

test('a wildcard path whose folder lies in the working folder counts as a write', () => {
  const place = { cwd: WORK, root: WORK };
  const counts = (command) => countsAsWrite('Bash', { command }, place);
  for (const command of ['rm -f *.log', 'rm -rf packages/*/build', 'rm -rf */dist',
    `rm -f ${WORK}/src/*.tmp`]) {
    assert.equal(counts(command), true, command);
  }
  for (const command of ['rm -f /tmp/*.log', 'rm -rf .qory/b*', 'rm -f ~/*.log',
    'cd ~ && rm -f *.log']) {
    assert.equal(counts(command), false, command);
  }
});

test('the guard reads 256 KB of one character beside a here-document in under 500 ms', () => {
  const run = 256 * 1024;
  for (const char of ['1', '<', '>', '&', "'", '\\']) {
    const word = char.repeat(run);
    for (const command of [`cat > a <<'EOF'\nx\nEOF\necho ${word}`,
      `cat > a <<'EOF' ${word}\nx\nEOF`, `cat > a${word} <<'EOF'\nx\nEOF`]) {
      const start = process.hrtime.bigint();
      guard(codex('Bash', { command }, 'implementer'));
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      assert.ok(ms < 500, `${JSON.stringify(char)}: ${ms} ms`);
    }
  }
});

test('a call of 1 MB with many words or operators returns a decision', () => {
  const MB = 1 << 20;
  for (const command of [`sudo -e ${'a '.repeat(MB / 2)}`, `sudoedit ${'a '.repeat(MB / 2)}`,
    `cat ${'<<a '.repeat(MB / 4)}\na`, `sh -c "${"sh -c 'a' ".repeat(MB / 10)}"`]) {
    const reason = guard(codex('Bash', { command }, 'implementer'));
    assert.ok(reason === null || typeof reason === 'string');
  }
});

test('a path of 1 MB returns a decision in under 2 seconds, and .. parts reach a locked file',
  () => {
    const locked = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
    const deep = 'a/'.repeat(500000);
    const back = `${'a/'.repeat(3000)}${'../'.repeat(3000)}${CHECK_PATH}`;
    const timed = (input) => {
      const start = process.hrtime.bigint();
      const reason = guard(input);
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      assert.ok(ms < 2000, `${ms} ms`);
      return reason;
    };
    assert.equal(timed(claude('Write', { file_path: path.join(WORK, deep), content: 'x' },
      'implementer')), null);
    firstLine(timed(codex('Bash', { command: `rm ${CHECK_PATH} ${deep}` }, 'implementer')),
      locked);
    firstLine(timed(claude('Write', { file_path: path.join(WORK, back), content: 'x' },
      'implementer')), locked);
    firstLine(timed(codex('Bash', { command: `rm ${back}` }, 'implementer')), locked);
  });

test('a call past the work limit is denied in under 5 seconds and counts as no write', () => {
  const files = Array.from({ length: 20 }, (_, at) => path.join(WORK, 'checks', `f${at}.check.ts`));
  const word = `zq${'{a,b}'.repeat(6)}*/* `;
  const command = `cd a1; cd a2; cd a3; cd a4; rm -f ${word.repeat(Math.ceil((128 << 10) /
    word.length))}; rm checks/f19.check.ts`;
  const start = process.hrtime.bigint();
  const reason = decide({ input: codex('Bash', { command }, 'implementer'), env: RUN, root: WORK,
    locked: () => ({ what: 'acceptance-lock version 1', files }) });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 5000, `${ms} ms`);
  firstLine(reason, 'Split this command into smaller calls: the guard stopped before it read');
  const counted = process.hrtime.bigint();
  assert.equal(countsAsWrite('Bash', { command: `rm -f ${'/tmp/x '.repeat(250000)}a.ts` },
    PLACE), false);
  assert.ok(Number(process.hrtime.bigint() - counted) / 1e6 < 5000);
});

test('each loop of the guard ends in under 5 seconds on a large call', () => {
  // A working folder whose .qory/build/ has 1,200 files, and a link L whose target goes 200
  // folders down and up again, so that each L costs 400 reads of the disk.
  const root = next('loops');
  const build = path.join(root, '.qory', 'build');
  fs.mkdirSync(build, { recursive: true });
  for (let at = 0; at < 1200; at += 1) fs.writeFileSync(path.join(build, `s${at}.json`), '{}');
  fs.mkdirSync(path.join(root, 'd', ...Array(200).fill('a')), { recursive: true });
  fs.symlinkSync(['d', ...Array(200).fill('a'), ...Array(201).fill('..')].join('/'),
    path.join(root, 'L'));
  fs.mkdirSync(path.join(root, 'checks'));
  const files = [path.join(root, 'checks', 'a.check.ts')];
  fs.writeFileSync(files[0], CHECK_TEXT);
  const deep = Array(41).fill('L').join('/');
  const patched = `*** Begin Patch\n${`*** Add File: ${deep}/x\n`.repeat(1000)}*** End Patch\n`;
  const calls = [['Bash', { command: `find . -name ${'['.repeat(60000)} -delete` }],
    ['Bash', { command: `find . ${'-name z '.repeat(12500)}-delete` }],
    ['Bash', { command: `git ${'-C d '.repeat(20000)}rm x` }],
    ['Bash', { command: `env ${'-C d '.repeat(20000)}touch x` }],
    ['Bash', { command: `find . ${'-exec rm + '.repeat(10000)}-delete` }],
    ['Bash', { command: `cd d/${Array(200).fill('a').join('/')}; ${'cd a; cd ..; '.repeat(8000)}` +
      'touch x' }],
    ['apply_patch', { command: patched }]];
  const place = { cwd: root, root };
  for (const [tool, args] of calls) {
    const start = process.hrtime.bigint();
    decide({ input: { ...codex(tool, args, 'implementer'), cwd: root }, env: RUN, root,
      locked: () => ({ what: 'acceptance-lock version 1', files }) });
    countsAsWrite(tool, args, place);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 5000, `${args.command.slice(0, 30)}: ${ms} ms`);
  }
});

test('the body of a here-document with a quoted end is text only for cat or tee', () => {
  const locked = 'Leave the locked file as it is: acceptance-lock version 1 locks it.';
  const MB = 1 << 20;
  const body = 'a.b(c);d&&e||f(g)/h.i>j;k=(l|m);'.repeat(Math.ceil(MB / 33));
  const start = process.hrtime.bigint();
  assert.equal(guard(codex('Bash', { command: `cat > src/min.js <<'EOF'\n${body}\nEOF` },
    'implementer')), null);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 100, `${ms} ms`);
  for (const command of [`cat > notes.md <<'EOF'\nrm ${CHECK_PATH}\nEOF`,
    `cat > notes.md <<"EOF"\nrm ${CHECK_PATH}\nEOF`,
    `cat > notes.md <<\\EOF\nrm ${CHECK_PATH}\nEOF`,
    `cat > notes.md <<-'EOF'\n\trm ${CHECK_PATH}\n\tEOF`,
    `cat > notes.md <<\\E\\OF\nrm ${CHECK_PATH}\nEOF`, `cat > notes.md <<"E"'OF'\nx\nEOF`]) {
    assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
  }
  for (const command of [`bash <<'EOF'\nrm ${CHECK_PATH}\nEOF`,
    `cat <<'EOF' | sh\nrm ${CHECK_PATH}\nEOF`, `echo "<<'X'"\nrm ${CHECK_PATH}\nX`,
    `# <<'X'\nrm ${CHECK_PATH}\nX`, `cat > a <<'X'\nrm ${CHECK_PATH}`,
    `cat > a <<EOF\n$(rm ${CHECK_PATH})\nEOF`, `cat > a <<'EOF'\nx\nEOF\nrm ${CHECK_PATH}`,
    `cat <<<'x' > a\nrm ${CHECK_PATH}`,
    // A quote or a backslash at the end of a line goes on to the next line.
    `echo "\n<<'X'"\nrm ${CHECK_PATH}\nX`, `echo '\n<<"X"'\nrm ${CHECK_PATH}\nX`,
    `echo a \\\n<<'X'\nrm ${CHECK_PATH}\nX`, `echo "\ncat > a <<'X'"\nrm ${CHECK_PATH}\nX`,
    `echo '\ncat > a <<"X"'\nrm ${CHECK_PATH}\nX`, `echo a \\\ncat > a <<'X'\nrm ${CHECK_PATH}\nX`,
    `cat > a <<'X' "b\nc"\nrm ${CHECK_PATH}\nX`, `cat "$(cat "<<'X'")"\nrm ${CHECK_PATH}\nX`,
    `cat $'\\'<<"X"' > a\nrm ${CHECK_PATH}\nX`,
    // The shell ends a body at its end word after quote removal: EOF for <<\E\OF.
    `cat > a <<\\E\\OF\nEOF\nrm ${CHECK_PATH}\nE\\OF`,
    `cat > a <<"E"'OF'\nEOF\nrm ${CHECK_PATH}\nE"OF`,
    `cat > a <<E"OF"\nEOF\nrm ${CHECK_PATH}\nE"OF"`,
    // In $(( ... )), << is a shift; a variable setting can make cat another program.
    `echo $((true<<2)); cat <<'EOF' >/dev/null\n2\nrm -f ${CHECK_PATH}\nEOF`,
    `((x = 1<<2)); cat <<'EOF' >/dev/null\n2\nrm -f ${CHECK_PATH}\nEOF`,
    `PATH=/tmp/e cat <<'EOF'\nrm ${CHECK_PATH}\nEOF`, `X=1 tee a <<'EOF'\nrm ${CHECK_PATH}\nEOF`,
    `X=1 command cat <<'EOF' > notes.md && echo done\nrm ${CHECK_PATH}\nEOF`]) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  for (const runner of ['. /dev/stdin', 'source /dev/stdin', 'exec bash', 'env sh', 'command bash',
    'busybox sh', '/bin/sh -s', 'eval "$(cat)"', 'python', 'python3', 'python3.12 -',
    '/usr/bin/python3', 'node', 'perl', 'ruby', 'php', 'osascript', 'awk -f -', 'tclsh', 'lua',
    'deno run -', 'xargs -I{} sh -c {}']) {
    const command = `${runner} <<'EOF'\nrm ${CHECK_PATH}\nEOF`;
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  // Any command other than cat or tee keeps the body: a shell by any name, a command that
  // starts a shell, and a program that runs the commands of its input.
  for (const runner of ["bash<<'EOF'", `"bash" <<'EOF'`, "b\\ash <<'EOF'", "$SHELL <<'EOF'",
    `"$SHELL" -s <<'EOF'`, "$0 <<'EOF'", "bash-5.2 <<'EOF'", "ash <<'EOF'", "csh <<'EOF'",
    "tcsh <<'EOF'", "pwsh <<'EOF'", "sudo -s <<'EOF'", "su - x <<'EOF'",
    "ssh localhost <<'EOF'", "script -q /dev/null <<'EOF'", "at now <<'EOF'", "expect <<'EOF'",
    "ex -s f <<'EOF'", "xargs tee <<'EOF'", "cat <<'EOF' 2>&1 | sh", "cat <<'EOF' > >(sh)"]) {
    const command = `${runner}\nrm ${CHECK_PATH}\nEOF`;
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  // A function named cat or tee runs the body.
  for (const runner of ["cat(){ sh; }; cat <<'EOF'", "function cat { sh; }; cat <<'EOF'",
    "cat () { sh; }\ncat <<'EOF'", "tee() { sh; }; tee a <<'EOF'",
    "function tee() { sh; }\ntee a <<'EOF'"]) {
    const command = `${runner}\nrm ${CHECK_PATH}\nEOF`;
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  // Another command of the call runs the file that cat or tee writes.
  for (const command of [`cat <<'EOF' > x.sh && sh x.sh\nrm ${CHECK_PATH}\nEOF`,
    `cat <<'EOF' > x.sh; . ./x.sh\nrm ${CHECK_PATH}\nEOF`,
    `cat > x.sh <<'EOF'\nrm ${CHECK_PATH}\nEOF\nsource x.sh`,
    `tee x.sh <<'EOF'\nrm ${CHECK_PATH}\nEOF\n"bash" x.sh`,
    `cat > x.sh <<'EOF'\nrm ${CHECK_PATH}\nEOF\nchmod +x x.sh && ./x.sh`,
    `cat > x.sh <<'EOF'\nrm ${CHECK_PATH}\nEOF\nenv $SHELL x.sh`]) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  // Any other command of the call than echo, ls, mkdir, true, or a cat or tee that reads,
  // could run the file that cat writes.
  for (const after of ['env PATH=. x', 'PATH=.:$PATH x', 'command x', 'exec x', 'nohup x',
    'timeout 5 x', 'make -f x', 'xargs -a x rm', 'xargs rm < x', 'parallel < x', 'sudo -s < x',
    'at -f x now', 'crontab x', 'expect x', 'watch x', 'find . -name x -exec {} \\;']) {
    const command = `cat > x <<'EOF'\nrm ${CHECK_PATH}\nEOF\n${after}`;
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  for (const command of [`sqlite3 db <<'EOF'\n.shell rm ${CHECK_PATH}\nEOF`,
    `make -f - <<'EOF'\nall:\n\trm ${CHECK_PATH}\nEOF`]) {
    firstLine(guard(codex('Bash', { command }, 'implementer')), locked);
  }
  for (const command of [`cat > run.sh <<'EOF'\nrm ${CHECK_PATH}\nEOF`,
    `tee -a notes.md > /dev/null <<'EOF'\nrm ${CHECK_PATH}\nEOF`,
    `command cat <<'EOF' > notes.md && echo done\nrm ${CHECK_PATH}\nEOF`,
    `cat > notes.md <<'EOF' 2>&1 && ls &>/dev/null\nrm ${CHECK_PATH}\nEOF`,
    `cat > app.py <<'EOF'\nrm ${CHECK_PATH}\nEOF`,
    `mkdir -p docs && cat > docs/a.md <<'EOF'\nrm ${CHECK_PATH}\nEOF`]) {
    assert.equal(guard(codex('Bash', { command }, 'implementer')), null, command);
  }
});
