// The part of the end check that every runtime's adapter shares: it picks the artifact
// folder and runs `checks.js end` on it. Each adapter, end-gate-<runtime>.js, turns the
// result into what its runtime reads from a hook that runs when the session tries to end.
//
// The artifact folder is /tmp/qory-artifacts in a run, when QORY_RUN_ID is set and the
// folder exists, as checks.js lists. Else it is .qory/artifacts under the first folder that
// has .qory/artifacts, from CLAUDE_PROJECT_DIR up when it is set, else from the working
// folder up, up to the folder with .git or /. So a session in a subfolder of the checkout
// checks the checkout's folder. Claude Code sets CLAUDE_PROJECT_DIR to the project folder,
// and Gemini CLI to the session's working folder, which can be a subfolder of the checkout,
// so the walk starts there too. checks.js end checks nothing when QORY_RUN_ID is not
// set, so a /tmp/qory-artifacts left from an earlier run never stops a session outside a run.
//
// The adapter lies at <home>/hooks/, where <home> is the composed harness, QORY_HARNESS_HOME.
// checks.js lies at <home>/modules/software-factory/skills/running-a-workflow/checks.js.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RUN_FOLDER = '/tmp/qory-artifacts';

// readInput returns the JSON object that the runtime wrote to stdin, or {}.
function readInput() {
  try {
    const data = JSON.parse(fs.readFileSync(0, 'utf8'));
    return data !== null && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

// base returns the folder whose .qory/artifacts a session in the working folder cwd uses:
// the first folder that has .qory/artifacts, from CLAUDE_PROJECT_DIR up when it is set,
// else from cwd up, up to the folder with .git or /, and the start when none has.
function base(cwd, env = process.env) {
  const start = env.CLAUDE_PROJECT_DIR || cwd;
  for (let at = path.resolve(start); ;) {
    if (fs.existsSync(path.join(at, '.qory', 'artifacts'))) return at;
    const parent = path.dirname(at);
    if (parent === at || fs.existsSync(path.join(at, '.git'))) return start;
    at = parent;
  }
}

// folder returns the artifact folder for a session in the working folder cwd.
function folder(cwd, env = process.env) {
  if (env.QORY_RUN_ID && fs.existsSync(RUN_FOLDER)) return RUN_FOLDER;
  return path.join(base(cwd, env), '.qory', 'artifacts');
}

// CRASHED is the exit status of RUNNER when checks.js throws, at load or while it runs. The
// script never returns it. Node exits 1 when a script cannot load, the same status as
// findings, so a session would go on with no check counted; RUNNER keeps the two apart.
const CRASHED = 4;

// RUNNER loads checks.js, given as its first argument, and runs main(['end', <folder>]).
// It sets process.argv as a start of checks.js would, because main finds the plugin folder
// from process.argv[1]. Any exception, also one thrown later from a callback, exits CRASHED
// with the fix on the first line, since a log often keeps only that line. Only the first
// exception is printed. The text of a value that cannot be turned into a string is
// "unprintable error".
const RUNNER = `'use strict';
const [checks, folder] = process.argv.slice(1);
process.argv = [process.argv[0], checks, 'end', folder];
let crashed = false;
function crash(error) {
  process.exitCode = ${CRASHED};
  if (crashed) return;
  crashed = true;
  let first = 'unprintable error';
  let stack = first;
  try {
    const message = error instanceof Error ? String(error.message) : String(error);
    first = message.split('\\n')[0];
    stack = error instanceof Error && error.stack ? String(error.stack) : message;
  } catch {}
  process.stderr.write('Send this error to the harness maintainers: the end check crashed, ' +
    'so the session ended without checking its drafts and reports.\\n' +
    \`Error: \${first}\\n\${stack}\\n\`);
}
process.on('uncaughtException', crash);
try {
  process.exitCode = require(checks).main(['end', folder]);
} catch (error) {
  crash(error);
}
`;

// check runs `checks.js end` through RUNNER and returns { status, text }. status is that of
// checks.js: 0 when the session may end, 1 while it must go on with text; CRASHED when the
// script threw; any other number, or null when the script could not run, for another
// failure of the check itself. Every status but 0 and 1 ends the session in each adapter.
function check({ cwd, script = process.argv[1], env = process.env } = {}) {
  const home = path.resolve(path.dirname(script), '..');
  const checks = path.join(home, 'modules', 'software-factory', 'skills', 'running-a-workflow',
    'checks.js');
  const work = cwd && fs.existsSync(cwd) ? cwd : process.cwd();
  const ran = childProcess.spawnSync(process.execPath,
    ['-e', RUNNER, checks, folder(work, env)],
    { cwd: work, env, encoding: 'utf8', timeout: 170000 });
  // On a crash the fix comes first, before any text that checks.js printed.
  const parts = ran.status === CRASHED ? [ran.stderr, ran.stdout] : [ran.stdout, ran.stderr];
  const text = parts.map((part) => part || '').join('').trim();
  if (ran.error) return { status: null, text: `The end check could not run: ${ran.error.message}` };
  return { status: ran.status, text };
}

module.exports = { readInput, base, folder, check };
