// The part of the end check that every runtime's adapter shares: it picks the artifact
// folder and runs `checks.cjs end` on it. Each adapter, end-gate-<runtime>.cjs, turns the
// result into what its runtime reads from a hook that runs when the session tries to end.
//
// The artifact folder is /tmp/qory-artifacts in a run, when QORY_RUN_ID is set and the
// folder exists, as checks.cjs lists. Else it is .qory/artifacts under the first folder that
// has .qory/artifacts, from CLAUDE_PROJECT_DIR up when it is set, else from the working
// folder up, up to the folder with .git or /. So a session in a subfolder of the checkout
// checks the checkout's folder. Claude Code sets CLAUDE_PROJECT_DIR to the project folder,
// and Gemini CLI to the session's working folder, which can be a subfolder of the checkout,
// so the walk starts there too. checks.cjs end checks nothing when QORY_RUN_ID is not
// set, so a /tmp/qory-artifacts left from an earlier run never stops a session outside a run.
//
// The adapter lies at <home>/hooks/, where <home> is the composed harness, QORY_HARNESS_HOME.
// checks.cjs lies at <home>/modules/core/skills/running-a-workflow/checks.cjs.
//
// In a run, qory writes a copy of the run's inputs.json at $QORY_HARNESS_HOME/inputs.json.
// When QORY_HARNESS_HOME is an absolute path and that file exists, the hook runs
// `end <folder> --inputs <file>`, so that end reads the extensions of the harness from the
// same file as the push check; else `end <folder>`, which reads .qory/harness-report.json of
// the working folder.
// The hook takes that file only from the variable, never from a path that it builds.
//
// In the session of a hook's agent, when that file has the member qory.hook_session, the hook
// runs no check and lets the session end: qory checks the report of the hook after its agent
// exits.
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

// inputsFile returns $QORY_HARNESS_HOME/inputs.json of env when the variable is an absolute
// path and the file exists, else null. A relative value is ignored, because the hook and the
// end check could resolve it against different folders.
function inputsFile(env = process.env) {
  if (!env.QORY_HARNESS_HOME || !path.isAbsolute(env.QORY_HARNESS_HOME)) return null;
  const file = path.join(env.QORY_HARNESS_HOME, 'inputs.json');
  return fs.existsSync(file) ? file : null;
}

// The most bytes of inputs.json that qoryInputs reads.
const INPUTS_MAX = 1024 * 1024;

// qoryInputs returns the member qory of the inputs.json of inputsFile when it is an object, or
// null. A link, a file that is no regular file or no JSON, and one of more than INPUTS_MAX
// bytes count as no file.
function qoryInputs(env = process.env) {
  const file = inputsFile(env);
  if (!file) return null;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > INPUTS_MAX) return null;
    const qory = JSON.parse(fs.readFileSync(file, 'utf8')).qory;
    return qory !== null && typeof qory === 'object' ? qory : null;
  } catch {
    return null;
  }
}

// The member of qory in inputs.json that qory writes in the session of a hook's agent: an
// object whose member report is the absolute path of the hook's report file.
const HOOK_SESSION = 'hook_session';

// hookSession reports whether the inputs.json of inputsFile has the member qory.hook_session,
// with any value: the session of a hook's agent.
function hookSession(env = process.env) {
  const qory = qoryInputs(env);
  return Boolean(qory) && Object.hasOwn(qory, HOOK_SESSION);
}

// folder returns the artifact folder for a session in the working folder cwd. run is the
// folder of a run, RUN_FOLDER unless the caller sets another.
function folder(cwd, env = process.env, run = RUN_FOLDER) {
  if (env.QORY_RUN_ID && fs.existsSync(run)) return run;
  return path.join(base(cwd, env), '.qory', 'artifacts');
}

// CRASHED is the exit status of RUNNER when checks.cjs throws, at load or while it runs. The
// script never returns it. Node exits 1 when a script cannot load, the same status as
// findings, so a session would go on with no check counted; RUNNER keeps the two apart.
const CRASHED = 4;

// RUNNER loads checks.cjs, given as its first argument, and runs main(['end', <folder>]), with
// --inputs and the third argument after them when it is given.
// It sets process.argv as a start of checks.cjs would, because main finds the plugin folder
// from process.argv[1]. Any exception, also one thrown later from a callback, exits CRASHED
// with the fix on the first line, since a log often keeps only that line. Only the first
// exception is printed. The text of a value that cannot be turned into a string is
// "unprintable error".
const RUNNER = `'use strict';
const [checks, folder, inputs] = process.argv.slice(1);
const args = ['end', folder, ...(inputs ? ['--inputs', inputs] : [])];
process.argv = [process.argv[0], checks, ...args];
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
  process.exitCode = require(checks).main(args);
} catch (error) {
  crash(error);
}
`;

// check runs `checks.cjs end` through RUNNER and returns { status, text }. status is that of
// checks.cjs: 0 when the session may end, 1 while it must go on with text; CRASHED when the
// script threw; any other number, or null when the script could not run, for another
// failure of the check itself. Every status but 0 and 1 ends the session in each adapter.
// In the session of a hook's agent it runs no check and returns { status: 0, text: '' }.
function check({ cwd, script = process.argv[1], env = process.env } = {}) {
  if (hookSession(env)) return { status: 0, text: '' };
  const home = path.resolve(path.dirname(script), '..');
  const checks = path.join(home, 'modules', 'core', 'skills', 'running-a-workflow', 'checks.cjs');
  const work = cwd && fs.existsSync(cwd) ? cwd : process.cwd();
  const inputs = inputsFile(env);
  const ran = childProcess.spawnSync(process.execPath,
    ['-e', RUNNER, checks, folder(work, env), ...(inputs ? [inputs] : [])],
    { cwd: work, env, encoding: 'utf8', timeout: 170000 });
  // On a crash the fix comes first, before any text that checks.cjs printed.
  const parts = ran.status === CRASHED ? [ran.stderr, ran.stdout] : [ran.stdout, ran.stderr];
  const text = parts.map((part) => part || '').join('').trim();
  if (ran.error) return { status: null, text: `The end check could not run: ${ran.error.message}` };
  return { status: ran.status, text };
}

module.exports = { readInput, base, folder, inputsFile, qoryInputs, HOOK_SESSION, hookSession,
  check };
