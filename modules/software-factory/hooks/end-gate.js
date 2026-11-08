// The part of the end check that every runtime's adapter shares: it picks the artifact
// folder and runs `checks.js end` on it. Each adapter, end-gate-<runtime>.js, turns the
// result into what its runtime reads from a hook that runs when the session tries to end.
//
// The artifact folder is /tmp/qory-artifacts in a run, when QORY_RUN_ID is set and the
// folder exists, and else .qory/artifacts under the working folder, as checks.js lists. So a
// /tmp/qory-artifacts left from an earlier run never stops a session outside a run.
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

// folder returns the artifact folder for a session in the working folder cwd.
function folder(cwd, env = process.env) {
  if (env.QORY_RUN_ID && fs.existsSync(RUN_FOLDER)) return RUN_FOLDER;
  return path.join(cwd, '.qory', 'artifacts');
}

// check runs `checks.js end` and returns { status, text }. status is that of checks.js: 0
// when the session may end, 1 while it must go on with text, and any other number, or
// null when the script could not run, for a failure of the check itself.
function check({ cwd, script = process.argv[1], env = process.env } = {}) {
  const home = path.resolve(path.dirname(script), '..');
  const checks = path.join(home, 'modules', 'software-factory', 'skills', 'running-a-workflow',
    'checks.js');
  const work = cwd && fs.existsSync(cwd) ? cwd : process.cwd();
  const ran = childProcess.spawnSync(process.execPath, [checks, 'end', folder(work, env)],
    { cwd: work, env, encoding: 'utf8', timeout: 170000 });
  const text = `${ran.stdout || ''}${ran.stderr || ''}`.trim();
  if (ran.error) return { status: null, text: `The end check could not run: ${ran.error.message}` };
  return { status: ran.status, text };
}

module.exports = { readInput, folder, check };
