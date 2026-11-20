// The hook commands that the fragments of modules/core/settings/ register, and the checks of
// scripts/check.sh on them: each command parses with sh and bash, passes shellcheck, and runs
// a file of modules/core/hooks/ that passes `node --check`.
//
// Usage: node scripts/hook-commands.js [CORE_DIR]
// CORE_DIR is a folder with settings/ and hooks/; the default is modules/core. The script
// prints one line per finding to stderr and exits 1 on a finding. The checks need no package.
// Without shellcheck on the PATH, the script skips shellcheck with a message and exits 0,
// unless the environment variable CI is set: GitHub Actions sets it, and there a missing
// shellcheck is a finding.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The fragments, relative to settings/. Gemini CLI starts a hook through `bash -c`; the other
// runtimes start it through the shell of the system, so those commands must also run in sh.
const FRAGMENTS = ['claude/settings.json', 'codex/config.toml', 'copilot/hooks.json',
  'cursor/hooks.json', 'gemini/settings.json'];
const BASH_ONLY = new Set(['gemini/settings.json']);

// hookCommands returns each command that a fragment under dir (a settings/ folder) registers as
// a hook, as { file, command }, where file is the path of the fragment below dir. Copilot CLI
// names a command `bash`; the other JSON fragments name it `command`. Codex registers it as a
// line `command = "..."` of its TOML, and a TOML basic string reads as a JSON string.
function hookCommands(dir) {
  const found = [];
  const walk = (file, value) => {
    if (Array.isArray(value)) value.forEach((one) => walk(file, one));
    else if (value !== null && typeof value === 'object') {
      for (const [key, one] of Object.entries(value)) {
        if (typeof one === 'string' && (key === 'command' || key === 'bash')) {
          found.push({ file, command: one });
        } else walk(file, one);
      }
    }
  };
  for (const file of FRAGMENTS.filter((one) => one.endsWith('.json'))) {
    walk(file, JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).hooks);
  }
  const toml = fs.readFileSync(path.join(dir, 'codex/config.toml'), 'utf8');
  for (const [, quoted] of toml.matchAll(/^command = (".*")$/gm)) {
    found.push({ file: 'codex/config.toml', command: JSON.parse(quoted) });
  }
  return found;
}

// run starts a program and returns { status, text } with the output of both streams. A
// program that cannot start has status null and text with the error.
function run(program, args, input) {
  const ran = childProcess.spawnSync(program, args, { input, encoding: 'utf8', timeout: 60000,
    killSignal: 'SIGKILL' });
  if (ran.error !== undefined) return { status: null, text: String(ran.error) };
  return { status: ran.status, text: `${ran.stdout}${ran.stderr}`.trim() };
}

// hasShellcheck reports whether shellcheck starts.
function hasShellcheck() {
  return run('shellcheck', ['--version']).status === 0;
}

// checkCommands returns one finding string for each failed check of the commands: sh -n and
// bash -n on each, shellcheck -s sh on each, and shellcheck -s bash on the commands that only
// run in bash. Each command goes to a file of a scratch folder that this function removes.
function checkCommands(commands, { shellcheck }) {
  const findings = [];
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-commands-'));
  try {
    commands.forEach(({ file, command }, index) => {
      const name = `${file} #${index + 1}`;
      const script = path.join(scratch, `${index + 1}.sh`);
      fs.writeFileSync(script, `${command}\n`);
      const checks = [['sh', ['-n', script]], ['bash', ['-n', script]]];
      if (shellcheck) {
        checks.push(['shellcheck', ['-s', 'sh', script]]);
        if (BASH_ONLY.has(file)) checks.push(['shellcheck', ['-s', 'bash', script]]);
      }
      for (const [program, args] of checks) {
        const ran = run(program, args);
        if (ran.status !== 0) {
          const label = `${program} ${args.slice(0, -1).join(' ')}`.trim();
          findings.push(`${name}: ${label} fails.\n${ran.text.split(script).join('<command>')}`);
        }
      }
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return findings;
}

// checkHookFiles returns one finding string for each file of hooksDir with the extension .cjs
// that fails `node --check`, and for each file that a command runs from hooks/ and that is
// missing there.
function checkHookFiles(hooksDir, commands) {
  const findings = [];
  const files = new Set(fs.readdirSync(hooksDir).filter((one) => one.endsWith('.cjs')));
  for (const { file, command } of commands) {
    for (const [, name] of command.matchAll(/\/hooks\/([A-Za-z0-9._-]+)"/g)) {
      if (!files.has(name)) findings.push(`${file}: the command runs hooks/${name}, which is missing.`);
    }
  }
  for (const name of [...files].sort()) {
    const ran = run(process.execPath, ['--check', path.join(hooksDir, name)]);
    if (ran.status !== 0) findings.push(`hooks/${name}: node --check fails.\n${ran.text}`);
  }
  return findings;
}

// check runs every check on the core folder and returns { findings, skipped }, where skipped
// is the text of a check that did not run, or ''. A missing shellcheck is a finding when
// required is true.
function check(core, { required }) {
  const commands = hookCommands(path.join(core, 'settings'));
  const findings = [];
  let skipped = '';
  const shellcheck = hasShellcheck();
  if (!shellcheck) {
    const text = 'shellcheck is not installed. Install it, for example with `apt-get install shellcheck` or `brew install shellcheck`.';
    if (required) findings.push(text);
    else skipped = `${text} The shellcheck checks did not run.`;
  }
  findings.push(...checkCommands(commands, { shellcheck }));
  findings.push(...checkHookFiles(path.join(core, 'hooks'), commands));
  return { commands, findings, skipped };
}

function main(argv) {
  const core = argv[0] || path.join(__dirname, '..', 'modules', 'core');
  const { commands, findings, skipped } = check(core, { required: Boolean(process.env.CI) });
  if (skipped !== '') process.stderr.write(`SKIP  ${skipped}\n`);
  for (const finding of findings) process.stderr.write(`${finding}\n`);
  if (findings.length > 0) return 1;
  process.stdout.write(`${commands.length} hook commands pass the checks.\n`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { hookCommands, checkCommands, checkHookFiles, check, hasShellcheck };
