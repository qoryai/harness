// Tests of scripts/hook-commands.js, the checks of the hook commands. scripts/check.sh runs them.
// The tests that need shellcheck skip when it is not installed, except when the environment
// variable CI is set: there, a missing shellcheck fails them, as it fails scripts/check.sh.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const hooks = require('./hook-commands.js');

const CORE = path.join(__dirname, '..', 'modules', 'core');
const SCRIPT = path.join(__dirname, 'hook-commands.js');
const SHELLCHECK = hooks.hasShellcheck();
// Run a test that needs shellcheck when it is installed, and always on CI.
const withShellcheck = { skip: !SHELLCHECK && !process.env.CI ? 'shellcheck is not installed' : false };

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-commands-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let count = 0;
const next = () => path.join(tmp, `case-${count += 1}`);

// copyCore copies settings/ and hooks/ of modules/core to a new folder and returns it.
function copyCore() {
  const dir = next();
  for (const folder of ['settings', 'hooks']) {
    fs.cpSync(path.join(CORE, folder), path.join(dir, folder), { recursive: true });
  }
  return dir;
}

// The same command, with a quoted variable and with an unquoted one.
const GOOD = '[ -z "$QORY_RUN_ID" ] || node "$QORY_HARNESS_HOME/hooks/tool-guard-claude.cjs"';
const BAD = GOOD.replace('"$QORY_HARNESS_HOME/hooks/tool-guard-claude.cjs"',
  '$QORY_HARNESS_HOME/hooks/tool-guard-claude.cjs');

// cli runs scripts/hook-commands.js on core with env added to the environment of this test.
function cli(core, env = {}) {
  const ran = childProcess.spawnSync(process.execPath, [SCRIPT, core], {
    env: { ...process.env, CI: '', ...env }, encoding: 'utf8', timeout: 120000 });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

test('the fragments register 13 hook commands: claude 3, codex 3, copilot 2, cursor 3, gemini 2', () => {
  const found = hooks.hookCommands(path.join(CORE, 'settings'));
  const per = {};
  for (const { file } of found) per[file.split('/')[0]] = (per[file.split('/')[0]] || 0) + 1;
  assert.deepEqual(per, { claude: 3, codex: 3, copilot: 2, cursor: 3, gemini: 2 });
  assert.equal(found.length, 13);
});

test('the 13 hook commands and the hook files pass the checks', () => {
  const { findings } = hooks.check(CORE, { required: Boolean(process.env.CI) });
  assert.deepEqual(findings, []);
});

test('a command with a syntax error fails sh -n and bash -n, with no shellcheck', () => {
  const findings = hooks.checkCommands([{ file: 'claude/settings.json',
    command: '[ -z "$QORY_RUN_ID" ] ||' }], { shellcheck: false });
  assert.equal(findings.length, 2, findings.join('\n'));
  assert.match(findings[0], /^claude\/settings\.json #1: sh -n fails\./);
  assert.match(findings[1], /^claude\/settings\.json #1: bash -n fails\./);
  assert.deepEqual(hooks.checkCommands([{ file: 'claude/settings.json', command: GOOD }],
    { shellcheck: false }), []);
});

test('shellcheck fails a command with an unquoted variable, and passes the same command quoted',
  withShellcheck, () => {
    assert.deepEqual(hooks.checkCommands([{ file: 'claude/settings.json', command: GOOD }],
      { shellcheck: true }), []);
    const findings = hooks.checkCommands([{ file: 'claude/settings.json', command: BAD }],
      { shellcheck: true });
    assert.equal(findings.length, 1, findings.join('\n'));
    assert.match(findings[0], /^claude\/settings\.json #1: shellcheck -s sh fails\./);
    assert.match(findings[0], /SC2086/);
    // A Gemini command runs in bash, so shellcheck also reads it as bash.
    const gemini = hooks.checkCommands([{ file: 'gemini/settings.json', command: BAD }],
      { shellcheck: true });
    assert.deepEqual(gemini.map((one) => one.split('\n')[0].replace(/^[^:]*: /, '')),
      ['shellcheck -s sh fails.', 'shellcheck -s bash fails.']);
  });

test('node --check fails a hook file with a syntax error and a command of a missing file', () => {
  const dir = next();
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'good.cjs'), "'use strict';\nconsole.log(1);\n");
  fs.writeFileSync(path.join(dir, 'bad.cjs'), 'const = ;\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'const = ;\n');
  const commands = [{ file: 'claude/settings.json', command: 'node "$QORY_HARNESS_HOME/hooks/good.cjs"' },
    { file: 'codex/config.toml', command: 'node "$QORY_HARNESS_HOME/hooks/gone.cjs"' }];
  const findings = hooks.checkHookFiles(dir, commands);
  assert.equal(findings.length, 2, findings.join('\n'));
  assert.equal(findings[0], 'codex/config.toml: the command runs hooks/gone.cjs, which is missing.');
  assert.match(findings[1], /^hooks\/bad\.cjs: node --check fails\./);
});

test('the script exits 0 on the real folder and 1 on a fragment with an unquoted variable',
  withShellcheck, () => {
    const real = cli(CORE);
    assert.equal(real.status, 0, real.out);
    assert.match(real.out, /^13 hook commands pass the checks\.$/m);
    // The same copy of core, with the variable of one command of each fragment unquoted.
    const files = ['claude/settings.json', 'codex/config.toml', 'copilot/hooks.json',
      'cursor/hooks.json', 'gemini/settings.json'];
    for (const file of files) {
      const core = copyCore();
      const target = path.join(core, 'settings', file);
      const text = fs.readFileSync(target, 'utf8');
      const mutated = text.replace(/\\"\$QORY_HARNESS_HOME\/hooks\/([a-z-]+\.cjs)\\"/,
        '$$QORY_HARNESS_HOME/hooks/$1');
      assert.notEqual(mutated, text, file);
      fs.writeFileSync(target, mutated);
      const ran = cli(core);
      assert.equal(ran.status, 1, `${file}: ${ran.out}`);
      assert.match(ran.out, /shellcheck -s sh fails\./, file);
      assert.match(ran.out, /SC2086/, file);
    }
  });

test('the script fails on a missing shellcheck when CI is set, and skips it when not', () => {
  // A PATH with sh and bash only. node is started by its full path.
  const bin = next();
  fs.mkdirSync(bin);
  for (const name of ['sh', 'bash']) {
    const found = childProcess.execFileSync('/bin/sh', ['-c', `command -v ${name}`],
      { encoding: 'utf8' }).trim();
    fs.symlinkSync(found, path.join(bin, name));
  }
  const skipped = cli(CORE, { PATH: bin });
  assert.equal(skipped.status, 0, skipped.out);
  assert.match(skipped.out, /^SKIP {2}shellcheck is not installed\./m);
  const required = cli(CORE, { PATH: bin, CI: 'true' });
  assert.equal(required.status, 1, required.out);
  assert.match(required.out, /^shellcheck is not installed\./m);
});
