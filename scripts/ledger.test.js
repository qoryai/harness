// Tests of the build ledger: the verbs step begin, step end and resume, which workflow-checks.js
// of running-a-software-workflow adds to the checks script. scripts/check.sh runs them. Each
// test works in a new checkout with a qory stub: a push runs the push check of build-ledger
// and stores the version in a store folder, and a pull copies the store into the artifact
// folder of the session.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const SCRIPT = path.join(MODULES, 'core/skills/running-a-workflow/checks.js');
const PUSH = path.join(MODULES,
  'software-factory/skills/running-a-software-workflow/workflow-checks.js');
const { main } = require(SCRIPT);

const FULL = 'Start no new step: the ledger has 100 rows, its limit. End the session with escalate.';
const H = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const T = '2026-11-15T10:00:00Z';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const fresh = (name) => {
  const dir = path.join(tmp, `${name}-${++folders}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// work returns a new checkout with one commit, the files of the step's inputs, a store and a
// qory stub. Each session gets a new artifact folder from session().
function work() {
  const repo = fresh('repo');
  const home = fresh('home');
  const store = fresh('store');
  const bin = fresh('bin');
  const inputs = fresh('inputs');
  fs.writeFileSync(path.join(store, 'index.json'), JSON.stringify({ version: 1, artifacts: [] }));
  for (const name of ['skill.md', 'agent.md', 'plan.md']) {
    fs.writeFileSync(path.join(inputs, name), `The ${name} of the step.\n`);
  }
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Sam Example',
    GIT_AUTHOR_EMAIL: 'sam@example.com',
    GIT_COMMITTER_NAME: 'Sam Example',
    GIT_COMMITTER_EMAIL: 'sam@example.com',
  };
  const args = path.join(bin, 'args');
  // A push runs the push check in the store, then stores the next version. A pull copies the
  // store's versions of build-ledger into the artifact folder that ARTIFACTS names.
  fs.writeFileSync(path.join(bin, 'qory'), `#!/bin/sh
printf '%s\\n' "$*" >> '${args}'
case "$1 $2 $3" in
'artifact push build-ledger')
  [ -e '${bin}/fail-push' ] && { echo 'The push failed: 503 unavailable.' >&2; exit 1; }
  cd '${store}' || exit 1
  '${process.execPath}' '${PUSH}' push build-ledger "$4" >&2 || exit 1
  n=0
  for dir in build-ledger/main/v*; do [ -d "$dir" ] && n=$((n + 1)); done
  n=$((n + 1))
  mkdir -p "build-ledger/main/v$n" && cp "$4" "build-ledger/main/v$n/build-ledger.json"
  echo "Pushed build-ledger version $n."
  exit 0;;
'artifact pull build-ledger')
  rm -rf "$ARTIFACTS/build-ledger"
  [ -d '${store}/build-ledger' ] && cp -R '${store}/build-ledger' "$ARTIFACTS/"
  echo "$ARTIFACTS/"
  exit 0;;
esac
exit 9
`, { mode: 0o755 });
  const w = { repo, store, bin, args, env, inputs: ['plan.md', 'skill.md', 'agent.md'].map((n) => path.join(inputs, n)) };
  git(w, 'init', '-q');
  commit(w, 'README.md', 'The shop.\n');
  return w;
}

function git(w, ...argv) {
  const ran = childProcess.spawnSync('git', ['-C', w.repo, ...argv], { env: w.env, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

// commit writes text to file of the checkout and commits it, as an agent of a step does.
function commit(w, file, text) {
  fs.writeFileSync(path.join(w.repo, file), text);
  git(w, 'add', file);
  git(w, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `Change ${file}`);
  return git(w, 'rev-parse', 'HEAD');
}

// session returns a call of the checks script in a new artifact folder of w.
function session(w) {
  const artifacts = fresh('artifacts');
  const env = { ...w.env, ARTIFACTS: artifacts };
  const call = (...argv) => {
    let out = '';
    let err = '';
    const status = main(argv, {
      cwd: w.repo, artifacts: [artifacts], env, plugin: path.join(MODULES, 'core'),
      out: { write: (text) => { out += text; } },
      err: { write: (text) => { err += text; } },
    });
    return { status, out, err, lines: out.split('\n').filter(Boolean) };
  };
  call.artifacts = artifacts;
  return call;
}

const begin = (call, w, id, inputs = w.inputs) => call('step', 'begin', id, 'implement-changes', ...inputs);

// report writes a report of an agent to .reports of the session.
function report(call, name, text) {
  const file = path.join(call.artifacts, '.reports', `${name}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// deliver runs one step of deliverable id: begin, an agent's commit, and end done.
function deliver(call, w, id) {
  const begun = begin(call, w, id);
  assert.equal(begun.status, 0, begun.out);
  assert.match(begun.lines.at(-1), new RegExp(`^Run ${id} as pass \\d+: start its agent`));
  commit(w, `${id.replace(':', '-')}.txt`, `The change of ${id}.\n`);
  const file = report(call, `software-developer-${id.replace(':', '-')}`, `Built ${id}.\n\ndone\n`);
  const ended = call('step', 'end', id, 'done', '--report', file,
    '--attempt', 'software-developer,developer,fast,unknown');
  assert.equal(ended.status, 0, ended.out);
  return ended;
}

// stored returns the newest ledger version of the store, and its number.
function stored(w) {
  const dir = path.join(w.store, 'build-ledger', 'main');
  const numbers = fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => Number(n.slice(1))) : [];
  if (!numbers.length) return { number: 0, ledger: null };
  const number = Math.max(...numbers);
  const text = fs.readFileSync(path.join(dir, `v${number}`, 'build-ledger.json'), 'utf8');
  assert.equal(text, JSON.stringify(JSON.parse(text)), 'the ledger is one line of compact JSON');
  return { number, ledger: JSON.parse(text) };
}

// store writes ledger as the next version of the store, as an earlier session pushed it.
function store(w, ledger) {
  const number = stored(w).number + 1;
  const dir = path.join(w.store, 'build-ledger', 'main', `v${number}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'build-ledger.json'), JSON.stringify(ledger));
}

// inputHash returns the hash of the inputs of w as step begin computes it: the SHA-256 of the
// JSON list of the SHA-256 of each file.
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const inputHash = (w) => sha(JSON.stringify(w.inputs.map((file) => sha(fs.readFileSync(file)))));

const pushes = (w) => (fs.existsSync(w.args) ? fs.readFileSync(w.args, 'utf8') : '')
  .split('\n').filter((line) => line.startsWith('artifact push')).length;

// ---- The four tests of the task -----------------------------------------------------------

test('ledger: a session that stops after two of three deliverables resumes at the third', () => {
  const w = work();
  const first = session(w);
  assert.match(first('resume').lines.at(-1), /^Read no build ledger: 0 rows, 0 done, 0 escalations\.$/);
  deliver(first, w, 'deliverable:d-1');
  deliver(first, w, 'deliverable:d-2');
  const head = git(w, 'rev-parse', 'HEAD');
  // The session stops here. The next one pulls the ledger into a new artifact folder.
  const next = session(w);
  const resumed = next('resume');
  assert.equal(resumed.status, 0, resumed.out);
  assert.match(resumed.lines.at(-1), /^Read version 4 of the build ledger: 2 rows, 2 done, 0 escalations\.$/);
  for (const id of ['deliverable:d-1', 'deliverable:d-2']) {
    const replay = begin(next, w, id);
    assert.equal(replay.status, 0, replay.out);
    assert.equal(replay.lines.at(-1), `Replay ${id} from pass 1: start no agent and push nothing ` +
      'again; its report is above.');
    assert.equal(replay.lines[0], `Built ${id}.`);
  }
  const third = begin(next, w, 'deliverable:d-3');
  assert.equal(third.status, 0, third.out);
  assert.equal(third.lines.at(-1), 'Run deliverable:d-3 as pass 1: start its agent, then run step end.');
  const { ledger } = stored(w);
  assert.deepEqual(ledger.steps.map((row) => [row.id, row.pass, row.state, row.replays]), [
    ['deliverable:d-1', 1, 'done', 1],
    ['deliverable:d-2', 1, 'done', 1],
    ['deliverable:d-3', 1, 'running', 0],
  ]);
  assert.equal(ledger.steps[2].base, head);
  assert.equal(ledger.steps[0].report, 'Built deliverable:d-1.\n\ndone\n');
  assert.deepEqual(ledger.steps[0].attempts,
    [{ agent: 'software-developer', role: 'developer', tier: 'fast', model: 'unknown' }]);
  // The draft at the top of the artifact folder has the bytes of the newest version.
  assert.equal(fs.readFileSync(path.join(next.artifacts, 'build-ledger.json'), 'utf8'),
    JSON.stringify(ledger));
});

test('ledger: an edit outside a step fails step end', () => {
  const w = work();
  const call = session(w);
  deliver(call, w, 'deliverable:d-1');
  // A commit between two steps: the next step starts on it.
  const outside = commit(w, 'notes.txt', 'An edit of the main session.\n');
  assert.equal(begin(call, w, 'deliverable:d-2').status, 0);
  commit(w, 'd-2.txt', 'The change of d-2.\n');
  const before = pushes(w);
  const ended = call('step', 'end', 'deliverable:d-2', 'done');
  assert.equal(ended.status, 1, ended.out);
  assert.match(ended.lines[0], new RegExp('^Undo the commits made outside a step: deliverable:d-2 ' +
    `started on ${outside.slice(0, 12)}, and the row before it, row 1 \\(deliverable:d-1\\), ended on`));
  assert.equal(ended.lines.at(-1), 'Checked the checkout and the report of deliverable:d-2: the ' +
    'build ledger is unchanged.');
  assert.equal(pushes(w), before, 'step end pushes nothing');
  assert.equal(stored(w).ledger.steps[1].state, 'running');

  // A file changed and not committed fails too, and .qory counts as no change.
  const other = work();
  const second = session(other);
  assert.equal(begin(second, other, 'deliverable:d-1').status, 0);
  commit(other, 'd-1.txt', 'The change of d-1.\n');
  fs.mkdirSync(path.join(other.repo, '.qory', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(other.repo, '.qory', 'artifacts', 'note.json'), '{}');
  assert.equal(second('step', 'end', 'deliverable:d-1', 'failed').status, 0);
  assert.equal(begin(second, other, 'deliverable:d-1').status, 0);
  fs.writeFileSync(path.join(other.repo, 'README.md'), 'An edit that no step committed.\n');
  const dirty = second('step', 'end', 'deliverable:d-1', 'done');
  assert.equal(dirty.status, 1, dirty.out);
  assert.match(dirty.lines[0], /^Commit each change in a step, or undo it: 1 file of the checkout differs from [0-9a-f]{12}, such as "README\.md"\.$/);
});

test('ledger: a crash restart takes the next pass', () => {
  const w = work();
  const call = session(w);
  deliver(call, w, 'deliverable:d-1');
  assert.equal(begin(call, w, 'deliverable:d-2').status, 0);
  // The session stops while d-2 runs: its row stays running. The next session resumes.
  const next = session(w);
  const resumed = next('resume');
  assert.equal(resumed.status, 0, resumed.out);
  assert.deepEqual(resumed.lines.slice(0, -1), ['Run deliverable:d-2 again: its pass 1 stopped ' +
    'while it ran, so step begin starts pass 2.']);
  const head = git(w, 'rev-parse', 'HEAD');
  let { ledger } = stored(w);
  assert.equal(ledger.steps[1].state, 'failed');
  assert.equal(ledger.steps[1].commit, head);
  // d-1 replays; d-2 starts its next pass, and ends with no edit outside a step.
  assert.match(begin(next, w, 'deliverable:d-1').lines.at(-1), /^Replay deliverable:d-1 from pass 1/);
  const again = begin(next, w, 'deliverable:d-2');
  assert.equal(again.lines.at(-1), 'Run deliverable:d-2 as pass 2: start its agent, then run step end.');
  commit(w, 'd-2.txt', 'The change of d-2.\n');
  const ended = next('step', 'end', 'deliverable:d-2', 'done');
  assert.equal(ended.status, 0, ended.out);
  ({ ledger } = stored(w));
  assert.deepEqual(ledger.steps.map((row) => [row.id, row.pass, row.state]), [
    ['deliverable:d-1', 1, 'done'],
    ['deliverable:d-2', 1, 'failed'],
    ['deliverable:d-2', 2, 'done'],
  ]);
});

test('ledger: row 101 is refused with no agent start and no commit', () => {
  const w = work();
  const head = git(w, 'rev-parse', 'HEAD');
  const row = (n) => ({
    id: `fix:f${n}`, pass: 1, kind: 'fix', workflow: 'implement-changes', inputs: inputHash(w),
    state: 'done', base: head, commit: head, attempts: [], replays: 0, started_at: T, ended_at: T,
  });
  store(w, { steps: Array.from({ length: 100 }, (_, n) => row(n + 1)), escalations: [] });
  const call = session(w);
  assert.match(call('resume').lines.at(-1), /: 100 rows, 100 done, 0 escalations\.$/);
  const refused = begin(call, w, 'fix:f101');
  assert.equal(refused.status, 1, refused.out);
  assert.deepEqual(refused.lines, [FULL]);
  const { ledger } = stored(w);
  assert.equal(ledger.steps.length, 100);
  assert.deepEqual(ledger.escalations.map((one) => [one.workflow, one.reason]),
    [['implement-changes', 'ledger-full']]);
  // No agent started: no count of starts; no commit: the head is the same.
  assert.equal(fs.existsSync(path.join(call.artifacts, '.reports', 'starts.json')), false);
  assert.equal(git(w, 'rev-parse', 'HEAD'), head);
  // The next session refuses again, and counts a second escalation.
  const next = session(w);
  next('resume');
  assert.deepEqual(begin(next, w, 'plan').lines, [FULL]);
  assert.equal(stored(w).ledger.escalations.length, 2);
  // A step that replays adds no row, so it passes with a full ledger.
  const replay = begin(next, w, 'fix:f1');
  assert.equal(replay.status, 0, replay.out);
  assert.match(replay.lines.at(-1), /^Replay fix:f1 from pass 1: start no agent/);
});

// ---- The other rules ----------------------------------------------------------------------

test('ledger: a step with other inputs runs again at its next pass', () => {
  const w = work();
  const call = session(w);
  deliver(call, w, 'deliverable:d-1');
  fs.appendFileSync(w.inputs[0], 'A changed plan.\n');
  assert.equal(begin(call, w, 'deliverable:d-1').lines.at(-1),
    'Run deliverable:d-1 as pass 2: start its agent, then run step end.');
});

test('ledger: a step whose commit the head does not have runs again', () => {
  const w = work();
  const call = session(w);
  const start = git(w, 'rev-parse', 'HEAD');
  deliver(call, w, 'deliverable:d-1');
  git(w, 'reset', '-q', '--hard', start);
  const next = session(w);
  next('resume');
  assert.equal(begin(next, w, 'deliverable:d-1').lines.at(-1),
    'Run deliverable:d-1 as pass 2: start its agent, then run step end.');
  // The row of the lost commit is no row before it: step end passes.
  commit(w, 'd-1.txt', 'The change of d-1 again.\n');
  assert.equal(next('step', 'end', 'deliverable:d-1', 'done').status, 0);
});

test('ledger: no step begins while a row runs, and step end needs a running row', () => {
  const w = work();
  const call = session(w);
  assert.equal(begin(call, w, 'plan').status, 0);
  const second = begin(call, w, 'checks');
  assert.equal(second.status, 1);
  assert.deepEqual(second.lines, ['End the step plan with step end, or run resume after a crash: ' +
    'row 1 of the build ledger is running.']);
  const none = call('step', 'end', 'checks', 'done');
  assert.equal(none.status, 1);
  assert.deepEqual(none.lines, ['Start checks with step begin first: the build ledger has no ' +
    'running row of it.']);
});

test('ledger: a script step ends done only with its hash, and a long report is refused', () => {
  const w = work();
  const call = session(w);
  assert.equal(begin(call, w, 'script:scenario-1').status, 0);
  const wrong = call('step', 'end', 'script:scenario-1', 'done');
  assert.equal(wrong.status, 2);
  assert.match(wrong.err, /^Give --script-sha256 to end a script step as done\./);
  const long = report(call, 'browser-demo-author-1', `${'é'.repeat(4097)}\n`);
  const cut = call('step', 'end', 'script:scenario-1', 'done', '--script-sha256', H, '--report', long);
  assert.equal(cut.status, 1, cut.out);
  assert.match(cut.lines[0], /^Cut the report "browser-demo-author-1\.md" to 8192 bytes as written in the ledger: it has 8196 in 4098 characters\.$/);
  const ended = call('step', 'end', 'script:scenario-1', 'done', '--script-sha256', H,
    '--pushed', 'demo-script/scenario-1/2');
  assert.equal(ended.status, 0, ended.out);
  const row = stored(w).ledger.steps[0];
  assert.equal(row.script_sha256, H);
  assert.deepEqual(row.pushed, [{ type: 'demo-script', name: 'scenario-1', version: 2 }]);
});

test('ledger: wrong arguments exit 2 with the usage', () => {
  const w = work();
  const call = session(w);
  const cases = [
    [['step'], /^Give step begin or step end\./],
    [['step', 'begin', 'deliverable:d-0', 'implement-changes', 'x'], /^Give an id of a step/],
    [['step', 'begin', 'plan', 'Implement', 'x'], /^Give the workflow of the session/],
    [['step', 'begin', 'plan', 'implement-changes'], /^Give step begin the files/],
    [['step', 'end', 'plan', 'ok'], /^Give step end the state done or failed\./],
    [['step', 'end', 'plan', 'done', '--attempt', 'a,b,slow,m'], /^Give --attempt as/],
    [['step', 'end', 'plan', 'done', '--pushed', 'spec/main/0'], /^Give --pushed as/],
    [['step', 'end', 'plan', 'done', '--report'], /^Give --report a value\./],
    [['step', 'end', 'plan', 'done', '--other', 'x'], /^Give step end only --report/],
    [['resume', 'now'], /^Give resume no argument\./],
  ];
  for (const [argv, pattern] of cases) {
    const result = call(...argv);
    assert.equal(result.status, 2, argv.join(' '));
    assert.match(result.err, pattern, argv.join(' '));
    assert.match(result.err, /\| step begin <id> <workflow> <file>\.\.\./);
  }
});

test('ledger: a failed push changes no draft and exits 3', () => {
  const w = work();
  const call = session(w);
  deliver(call, w, 'deliverable:d-1');
  const draft = fs.readFileSync(path.join(call.artifacts, 'build-ledger.json'), 'utf8');
  fs.writeFileSync(path.join(w.bin, 'fail-push'), '');
  const failed = begin(call, w, 'deliverable:d-2');
  assert.equal(failed.status, 3, failed.out);
  assert.match(failed.lines[0], /^Handle the failed push as run-artifacts lists: qory artifact push build-ledger exited with 1: The push failed/);
  assert.equal(fs.readFileSync(path.join(call.artifacts, 'build-ledger.json'), 'utf8'), draft);
});

test('ledger: a crash of step or resume exits 4 with the fix first on stderr', () => {
  const w = work();
  const call = session(w);
  let err = '';
  const status = main(['resume'], {
    cwd: w.repo, artifacts: [call.artifacts], env: { ...w.env, ARTIFACTS: call.artifacts },
    plugin: path.join(MODULES, 'core'),
    out: { write: () => { throw new Error('boom'); } },
    err: { write: (text) => { err += text; } },
  });
  assert.equal(status, 4);
  assert.match(err, /^Send this error to the harness maintainers: checks\.js resume crashed, so the build ledger may lack its last change\.\nError: boom\n/);
});
