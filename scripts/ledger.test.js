// Tests of the build ledger: the verbs step begin, step end and resume of the checks script,
// whose frame is in core, with the rules that running-a-software-workflow adds. scripts/check.sh
// runs them. Each test works in a new checkout with a qory stub, which the calls name, so
// that no /qory/qory of the machine runs: a push runs the push check of build-ledger and stores
// the version in a store folder, and a pull copies the store into the session's artifact
// folder.
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
const LIMIT = 'The build is at its limit of 100 build steps, so another round stops at once, and';
const SOME = 'Pick Accept as it is, or close this work item and make a new one for the ' +
  'criteria that are not built.';
const POINT = {
  text: `${LIMIT} every criterion is built.`,
  action: 'run_again',
  fix: 'Pick Accept as it is, or close this work item.',
};
const H = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const T = '2026-11-15T10:00:00Z';
// The longest id of a row: fix: and 40 characters.
const LONG = `fix:${'a'.repeat(40)}`;

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const fresh = (name) => {
  const dir = path.join(tmp, `${name}-${++folders}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// work returns a new checkout with one commit, the files of a step's inputs, a store and a
// qory stub.
function work() {
  const w = {
    repo: fresh('repo'), store: fresh('store'), bin: fresh('bin'), inputs: [],
  };
  const home = fresh('home');
  const inputs = fresh('inputs');
  fs.writeFileSync(path.join(w.store, 'index.json'), JSON.stringify({ version: 1, artifacts: [] }));
  for (const name of ['plan.md', 'skill.md', 'agent.md']) {
    fs.writeFileSync(path.join(inputs, name), `The ${name} of the step.\n`);
    w.inputs.push(path.join(inputs, name));
  }
  w.env = {
    ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Sam Example', GIT_AUTHOR_EMAIL: 'sam@example.com',
    GIT_COMMITTER_NAME: 'Sam Example', GIT_COMMITTER_EMAIL: 'sam@example.com',
  };
  w.args = path.join(w.bin, 'args');
  w.qory = path.join(w.bin, 'qory');
  // A push runs the push check in the store, then stores the next version; with the file
  // fail-push it fails, and with stored-then-fail it stores the version and fails. A pull
  // copies the versions into the artifact folder that ARTIFACTS names, and fails with the
  // file fail-pull. With no version, it copies nothing, as qory at the pinned commit does.
  fs.writeFileSync(w.qory, `#!/bin/sh
printf '%s\\n' "$*" >> '${w.args}'
case "$1 $2 $3" in
'artifact push build-ledger')
  [ -e '${w.bin}/fail-push' ] && { echo 'The push failed: 503 unavailable.' >&2; exit 1; }
  cd '${w.store}' || exit 1
  '${process.execPath}' '${PUSH}' push build-ledger "$4" >&2 || exit 1
  n=0
  for dir in build-ledger/main/v*; do [ -d "$dir" ] && n=$((n + 1)); done
  n=$((n + 1))
  mkdir -p "build-ledger/main/v$n" && cp "$4" "build-ledger/main/v$n/build-ledger.json"
  [ -e '${w.bin}/stored-then-fail' ] && { echo 'No response.' >&2; exit 1; }
  echo "Pushed build-ledger version $n."
  exit 0;;
'artifact pull build-ledger')
  [ -e '${w.bin}/fail-pull' ] && { echo 'The pull failed.' >&2; exit 1; }
  rm -rf "$ARTIFACTS/build-ledger"
  [ -d '${w.store}/build-ledger' ] && cp -R '${w.store}/build-ledger' "$ARTIFACTS/"
  echo "$ARTIFACTS/"
  exit 0;;
esac
exit 9
`, { mode: 0o755 });
  git(w, 'init', '-q');
  commit(w, 'README.md', 'The shop.\n');
  return w;
}

function git(w, ...argv) {
  const ran = childProcess.spawnSync('git', ['-C', w.repo, ...argv], { env: w.env, encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout.trim();
}

const headOf = (w) => git(w, 'rev-parse', 'HEAD');

// commit writes text to file of the checkout and commits it, as an agent of a step does.
function commit(w, file, text) {
  fs.writeFileSync(path.join(w.repo, file), text);
  git(w, 'add', file);
  git(w, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `Change ${file}`);
  return headOf(w);
}

// session returns a call of the checks script from cwd, in a new run of qory, which has a new
// run id, unless run names one, and in a new artifact folder unless artifacts names one. number
// is the number of the session in its run, QORY_SESSION, which is unset by default.
let runs = 0;
function session(w, { cwd = w.repo, plugin = path.join(MODULES, 'core'),
  artifacts = fresh('artifacts'), run = `run-${++runs}`, number } = {}) {
  const env = { ...w.env, ARTIFACTS: artifacts, QORY_RUN_ID: run };
  delete env.QORY_SESSION;
  if (number !== undefined) env.QORY_SESSION = number;
  const call = (...argv) => {
    let out = '';
    let err = '';
    const status = main(argv, {
      cwd, artifacts: [artifacts], env, plugin, qory: w.qory,
      out: { write: (text) => { out += text; } },
      err: { write: (text) => { err += text; } },
    });
    return { status, out, err, lines: out.split('\n').filter(Boolean) };
  };
  call.artifacts = artifacts;
  call.run = run;
  return call;
}

// resumed returns a session that ran resume.
function resumed(w, options) {
  const call = session(w, options);
  const result = call('resume');
  assert.equal(result.status, 0, result.out);
  return call;
}

const begin = (call, w, id, inputs = w.inputs) =>
  call('step', 'begin', id, 'implement-changes', ...inputs);

// report writes a report of an agent to .reports of the session.
function report(call, name, text) {
  const file = path.join(call.artifacts, '.reports', `${name}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

const slug = (id) => id.replace(/[:#]/g, '-');

// deliver runs one step of id: begin, an agent's commit, and end done.
function deliver(call, w, id) {
  const begun = begin(call, w, id);
  assert.equal(begun.status, 0, begun.out);
  assert.match(begun.lines.at(-1), new RegExp(`^Run ${id} as pass \\d+: start its agent`));
  commit(w, `${slug(id)}.txt`, `The change of ${id}.\n`);
  const file = report(call, `software-developer-${slug(id)}`, `Built ${id}.\n\ndone\n`);
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

const pushes = (w) => (fs.existsSync(w.args) ? fs.readFileSync(w.args, 'utf8') : '')
  .split('\n').filter((line) => line.startsWith('artifact push')).length;

// inputHash returns the hash of the inputs of w as step begin computes it: the SHA-256 of the
// JSON list of the SHA-256 of each file.
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const inputHash = (w) => sha(JSON.stringify(w.inputs.map((file) => sha(fs.readFileSync(file)))));

// fullLedger returns 100 done rows on the head of w, with count escalations.
function fullLedger(w, count = 0) {
  const top = headOf(w);
  const row = (n) => ({
    id: `fix:f${n}`, pass: 1, kind: 'fix', workflow: 'implement-changes', inputs: inputHash(w),
    state: 'done', base: top, commit: top, attempts: [], replays: 0, started_at: T, ended_at: T,
  });
  return {
    steps: Array.from({ length: 100 }, (_, n) => row(n + 1)),
    escalations: Array.from({ length: count },
      () => ({ workflow: 'implement-changes', reason: 'other', at: T })),
  };
}

// ---- The four tests of the task -----------------------------------------------------------

test('ledger: a session that stops after two of three deliverables resumes at the third', () => {
  const w = work();
  const first = session(w);
  assert.equal(first('resume').lines.at(-1), 'Read no ledger: 0 rows, 0 done, 0 escalations.');
  deliver(first, w, 'deliverable:d-1');
  deliver(first, w, 'deliverable:d-2');
  const head = headOf(w);
  // The session stops here. The next one pulls the ledger into a new artifact folder.
  const next = session(w);
  const again = next('resume');
  assert.equal(again.lines.at(-1), 'Read version 4 of the ledger: 2 rows, 2 done, 0 escalations.');
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

test('ledger: an edit outside a step fails step begin or step end', () => {
  const w = work();
  const call = resumed(w);
  deliver(call, w, 'deliverable:d-1');
  const c1 = headOf(w);
  // A commit between two steps of the session: the next step begin refuses it before any row.
  commit(w, 'notes.txt', 'An edit of the main session.\n');
  const before = pushes(w);
  const refused = begin(call, w, 'deliverable:d-2');
  assert.equal(refused.status, 1, refused.out);
  assert.match(refused.lines[0], new RegExp(`^Return the checkout to ${c1.slice(0, 12)}, where ` +
    'deliverable:d-1 ended: the head [0-9a-f]{12} has a change that no step of this session made\\.$'));
  assert.equal(refused.lines.at(-1), 'Started no row of deliverable:d-2: the ledger is unchanged.');
  assert.equal(pushes(w), before, 'step begin pushes nothing');
  // A file changed and not committed fails step end done.
  git(w, 'reset', '-q', '--hard', c1);
  assert.equal(begin(call, w, 'deliverable:d-2').status, 0);
  fs.writeFileSync(path.join(w.repo, 'README.md'), 'An edit that no step committed.\n');
  const dirty = call('step', 'end', 'deliverable:d-2', 'done');
  assert.equal(dirty.status, 1, dirty.out);
  assert.match(dirty.lines[0], /^Commit each change in the step, or undo it: 1 file of the checkout differs from [0-9a-f]{12}, such as "README\.md"\.$/);
  assert.equal(dirty.lines.at(-1), 'Checked the step deliverable:d-2: the ledger is unchanged.');
  assert.equal(stored(w).ledger.steps[1].state, 'running');
  // step end failed records the failure with the edit, and no commit.
  assert.equal(call('step', 'end', 'deliverable:d-2', 'failed').status, 0);
  const failed = stored(w).ledger.steps[1];
  assert.equal(failed.state, 'failed');
  assert.equal(failed.commit, undefined);
});

test('ledger: a crash restart takes the next pass', () => {
  const w = work();
  const call = resumed(w);
  deliver(call, w, 'deliverable:d-1');
  assert.equal(begin(call, w, 'deliverable:d-2').status, 0);
  // The session stops while d-2 runs: its row stays running. The next session resumes.
  const next = session(w);
  const again = next('resume');
  assert.equal(again.status, 0, again.out);
  assert.deepEqual(again.lines.slice(0, -1), ['Run deliverable:d-2 again: its pass 1 stopped ' +
    'while it ran, so step begin starts pass 2.']);
  let { ledger } = stored(w);
  assert.equal(ledger.steps[1].state, 'failed');
  assert.equal(ledger.steps[1].commit, undefined);
  assert.match(begin(next, w, 'deliverable:d-1').lines.at(-1), /^Replay deliverable:d-1 from pass 1/);
  assert.equal(begin(next, w, 'deliverable:d-2').lines.at(-1),
    'Run deliverable:d-2 as pass 2: start its agent, then run step end.');
  commit(w, 'd-2.txt', 'The change of d-2.\n');
  assert.equal(next('step', 'end', 'deliverable:d-2', 'done').status, 0);
  ({ ledger } = stored(w));
  assert.deepEqual(ledger.steps.map((row) => [row.id, row.pass, row.state]), [
    ['deliverable:d-1', 1, 'done'],
    ['deliverable:d-2', 1, 'failed'],
    ['deliverable:d-2', 2, 'done'],
  ]);
});

test('ledger: row 101 is refused with no agent start and no commit', () => {
  const w = work();
  const head = headOf(w);
  store(w, fullLedger(w));
  const call = session(w);
  assert.match(call('resume').lines.at(-1), /: 100 rows, 100 done, 0 escalations\.$/);
  const refused = begin(call, w, 'fix:f101');
  assert.equal(refused.status, 1, refused.out);
  assert.deepEqual(refused.lines, [FULL]);
  const { ledger } = stored(w);
  assert.equal(ledger.steps.length, 100);
  assert.deepEqual(ledger.escalations.map((one) => [one.workflow, one.reason]),
    [['implement-changes', 'ledger-full']]);
  // points.json has the point of the 101st row, which passes the check of points.
  const points = path.join(call.artifacts, 'points.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(points, 'utf8')), [POINT]);
  assert.equal(call('check', 'points', points).status, 0);
  // No agent started: no count of starts; no commit: the head is the same.
  assert.equal(fs.existsSync(path.join(call.artifacts, '.reports', 'starts.json')), false);
  assert.equal(headOf(w), head);
  // In the same session, ledger-full counts once.
  assert.deepEqual(begin(call, w, 'plan').lines, [FULL]);
  assert.equal(stored(w).ledger.escalations.length, 1);
  // The next session refuses again, and counts a second escalation.
  const next = resumed(w);
  assert.deepEqual(begin(next, w, 'plan').lines, [FULL]);
  assert.equal(stored(w).ledger.escalations.length, 2);
  // A step that replays adds no row, so it replays with a full ledger.
  const replay = begin(next, w, 'fix:f1');
  assert.equal(replay.status, 0, replay.out);
  assert.match(replay.lines.at(-1), /^Replay fix:f1 from pass 1: start no agent/);
});

// ---- The chain of base ----------------------------------------------------------------------

test('ledger: the first row takes the head as its base', () => {
  const w = work();
  const call = resumed(w);
  const head = headOf(w);
  assert.equal(begin(call, w, 'plan').status, 0);
  assert.equal(stored(w).ledger.steps[0].base, head);
});

test('ledger: after a failed row, the next row starts on the commit before it', () => {
  const w = work();
  const call = resumed(w);
  deliver(call, w, 'deliverable:d-1');
  const c1 = headOf(w);
  assert.equal(begin(call, w, 'deliverable:d-2').status, 0);
  commit(w, 'd-2.txt', 'A change that fails.\n');
  assert.equal(call('step', 'end', 'deliverable:d-2', 'failed').status, 0);
  const left = headOf(w);
  // The failed step's commit is no commit of a step: step begin refuses it.
  const refused = begin(call, w, 'deliverable:d-2');
  assert.equal(refused.status, 1, refused.out);
  assert.equal(refused.lines[0], `Return the checkout to ${c1.slice(0, 12)}, where ` +
    `deliverable:d-1 ended: the failed step deliverable:d-2 left the commit ${left.slice(0, 12)}.`);
  git(w, 'reset', '-q', '--hard', c1);
  assert.equal(begin(call, w, 'deliverable:d-2').lines.at(-1),
    'Run deliverable:d-2 as pass 2: start its agent, then run step end.');
  assert.equal(stored(w).ledger.steps[2].base, c1);
});

test('ledger: after a failed first row of a session, the next row starts on the start head', () => {
  const w = work();
  const call = resumed(w);
  const head = headOf(w);
  assert.equal(begin(call, w, 'plan').status, 0);
  const left = commit(w, 'plan.txt', 'A plan that fails.\n');
  assert.equal(call('step', 'end', 'plan', 'failed').status, 0);
  const refused = begin(call, w, 'plan');
  assert.equal(refused.status, 1, refused.out);
  assert.equal(refused.lines[0], `Return the checkout to ${head.slice(0, 12)}, where the ` +
    `session started: the failed step plan left the commit ${left.slice(0, 12)}.`);
  git(w, 'reset', '-q', '--hard', head);
  assert.equal(begin(call, w, 'plan').status, 0);
  assert.equal(stored(w).ledger.steps[1].base, head);
  // resume records the head at which the session started, and the run id of the session.
  const mark = JSON.parse(fs.readFileSync(path.join(call.artifacts, '.reports', 'ledger.json'),
    'utf8'));
  assert.equal(mark.origin, head);
  assert.equal(mark.run, call.run);
  assert.equal(mark.session, 1);
});

test('ledger: a mark of an earlier session is refused until resume runs', () => {
  const w = work();
  const earlier = resumed(w);
  deliver(earlier, w, 'plan');
  // An unset QORY_SESSION counts as session 1 of the run.
  const same = session(w, { artifacts: earlier.artifacts, run: earlier.run, number: '1' });
  assert.equal(begin(same, w, 'checks').status, 0);
  assert.equal(same('step', 'end', 'checks', 'failed').status, 0);
  // The second session of the same run finds the mark of the first in the same artifact folder.
  const next = session(w, { artifacts: earlier.artifacts, run: earlier.run, number: '2' });
  for (const result of [begin(next, w, 'checks'), next('step', 'end', 'plan', 'done')]) {
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0], 'Run checks.js resume first, once at the start of the ' +
      'session: .reports/ledger.json is from an earlier session.');
  }
  assert.equal(next('resume').status, 0);
  assert.equal(begin(next, w, 'checks').status, 0);
  // Session 2 of another run is another session too.
  const other = session(w, { artifacts: earlier.artifacts, number: '2' });
  assert.equal(other('step', 'end', 'checks', 'failed').status, 3);
  // A number that is no number of a session exits 3.
  const wrong = session(w, { number: '0' })('resume');
  assert.equal(wrong.status, 3, wrong.out);
  assert.equal(wrong.lines[0], 'Run step and resume in a session of qory: QORY_SESSION is not ' +
    'the number of a session: "0".');
  // Without the run id of qory, no session starts.
  const artifacts = fresh('artifacts');
  const { QORY_RUN_ID, ...env } = { ...w.env, ARTIFACTS: artifacts };
  assert.equal(QORY_RUN_ID, undefined);
  let out = '';
  const status = main(['resume'], {
    cwd: w.repo, artifacts: [artifacts], env, plugin: path.join(MODULES, 'core'), qory: w.qory,
    out: { write: (text) => { out += text; } }, err: { write: () => {} },
  });
  assert.equal(status, 3, out);
  assert.equal(out.split('\n')[0], 'Run step and resume in a run of qory: QORY_RUN_ID is not ' +
    'set, so the ledger cannot tell one session from the next.');
});

test('ledger: a commit between two sessions starts the next session on the head', () => {
  const w = work();
  const first = resumed(w);
  deliver(first, w, 'deliverable:d-1');
  const submit = commit(w, 'submission.txt', 'The commit of the submit step.\n');
  const next = resumed(w);
  assert.equal(begin(next, w, 'deliverable:d-2').status, 0);
  assert.equal(stored(w).ledger.steps[1].base, submit);
});

test('ledger: after a cancelled run, the next session redoes a step whose commit is lost', () => {
  const w = work();
  const start = headOf(w);
  const cancelled = resumed(w);
  deliver(cancelled, w, 'deliverable:d-1');
  const lost = headOf(w);
  // The run was cancelled after the step: its commit is on no branch of the next checkout.
  const branch = git(w, 'symbolic-ref', '--short', 'HEAD');
  git(w, 'checkout', '-q', '--detach', start);
  git(w, 'branch', '-q', '-D', branch);
  git(w, 'checkout', '-q', '-b', 'next');
  const next = resumed(w);
  const redo = begin(next, w, 'deliverable:d-1');
  assert.equal(redo.status, 0, redo.out);
  assert.equal(redo.lines.at(-1),
    'Run deliverable:d-1 as pass 2: start its agent, then run step end.');
  const row = stored(w).ledger.steps[1];
  assert.equal(row.base, start);
  assert.notEqual(row.base, lost);
});

test('ledger: step end done needs a clean checkout and a head that follows the base', () => {
  const w = work();
  // An untracked file is an edit; a file under .qory is none, also from a subfolder.
  const sub = path.join(w.repo, 'src');
  fs.mkdirSync(sub);
  const inSub = resumed(w, { cwd: sub });
  assert.equal(begin(inSub, w, 'plan').status, 0);
  fs.mkdirSync(path.join(w.repo, '.qory', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(w.repo, '.qory', 'artifacts', 'note.json'), '{}');
  assert.equal(inSub('step', 'end', 'plan', 'done').status, 0);
  fs.writeFileSync(path.join(sub, 'new.txt'), 'An untracked file.\n');
  assert.equal(begin(inSub, w, 'checks').status, 0);
  const untracked = inSub('step', 'end', 'checks', 'done');
  assert.equal(untracked.status, 1, untracked.out);
  assert.match(untracked.lines[0], /such as "src\/new\.txt"\.$/);
  fs.rmSync(path.join(sub, 'new.txt'));
  // A head that does not follow the base.
  const start = headOf(w);
  commit(w, 'other.txt', 'A commit of the step.\n');
  git(w, 'reset', '-q', '--hard', 'HEAD~1');
  git(w, 'checkout', '-q', '--orphan', 'elsewhere');
  git(w, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Another root');
  const away = inSub('step', 'end', 'checks', 'done');
  assert.equal(away.status, 1, away.out);
  assert.match(away.lines[0], new RegExp(`^Check out a commit that follows ${start.slice(0, 12)}, ` +
    'where checks started: the head [0-9a-f]{12} does not follow it\\.$'));
});

// ---- Replays, rows and reports --------------------------------------------------------------

test('ledger: replays count once per later session', () => {
  const w = work();
  const first = resumed(w);
  deliver(first, w, 'plan');
  // The session that made the row counts no replay.
  begin(first, w, 'plan');
  assert.equal(stored(w).ledger.steps[0].replays, 0);
  const second = resumed(w);
  begin(second, w, 'plan');
  begin(second, w, 'plan');
  assert.equal(stored(w).ledger.steps[0].replays, 1);
  begin(resumed(w), w, 'plan');
  assert.equal(stored(w).ledger.steps[0].replays, 2);
});

test('ledger: a step with other inputs runs again at its next pass', () => {
  const w = work();
  const call = resumed(w);
  deliver(call, w, 'deliverable:d-1');
  fs.appendFileSync(w.inputs[0], 'A changed plan.\n');
  assert.equal(begin(call, w, 'deliverable:d-1').lines.at(-1),
    'Run deliverable:d-1 as pass 2: start its agent, then run step end.');
});

test('ledger: no step begins while a row runs, and step end needs a running row', () => {
  const w = work();
  const call = resumed(w);
  assert.equal(begin(call, w, 'plan').status, 0);
  const second = begin(call, w, 'checks');
  assert.equal(second.status, 1);
  assert.deepEqual(second.lines, ['End the step plan with step end, or run checks.js resume ' +
    'after a crash: row 1 of the ledger is running.']);
  const none = call('step', 'end', 'checks', 'done');
  assert.equal(none.status, 1);
  assert.deepEqual(none.lines, ['Start checks with step begin first: the ledger has no running ' +
    'row of it.']);
});

test('ledger: step begin and step end need resume first', () => {
  const w = work();
  const call = session(w);
  for (const result of [begin(call, w, 'plan'), call('step', 'end', 'plan', 'done')]) {
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0], 'Run checks.js resume first, once at the start of the session: ' +
      'the artifact folder has no .reports/ledger.json that resume writes.');
  }
});

test('ledger: a script step ends done only with its hash, and a long report is refused', () => {
  const w = work();
  const call = resumed(w);
  assert.equal(begin(call, w, 'script:scenario-1').status, 0);
  const wrong = call('step', 'end', 'script:scenario-1', 'done');
  assert.equal(wrong.status, 2);
  assert.match(wrong.err, /^Give --script-sha256 to end a script step as done\./);
  const long = report(call, 'browser-demo-author-1', `${'é'.repeat(4097)}\n`);
  const cut = call('step', 'end', 'script:scenario-1', 'done', '--script-sha256', H, '--report', long);
  assert.equal(cut.status, 1, cut.out);
  assert.equal(cut.lines[0], 'Cut the report "browser-demo-author-1.md" to 8192 bytes as written ' +
    'in the ledger: it has 8196 in 4098 characters.');
  const ended = call('step', 'end', 'script:scenario-1', 'done', '--script-sha256', H,
    '--pushed', 'demo-script/scenario-1/2');
  assert.equal(ended.status, 0, ended.out);
  const row = stored(w).ledger.steps[0];
  assert.equal(row.script_sha256, H);
  assert.deepEqual(row.pushed, [{ type: 'demo-script', name: 'scenario-1', version: 2 }]);
  // A failed step is recorded with no report when its report is too long or cannot be read.
  assert.equal(begin(call, w, 'plan').status, 0);
  const failed = call('step', 'end', 'plan', 'failed', '--report', long);
  assert.equal(failed.status, 0, failed.out);
  assert.deepEqual(failed.lines, [
    'Keep the next report to 8192 bytes as written in the ledger: the report ' +
      '"browser-demo-author-1.md" has 8196 in 4098 characters, so the row has none.',
    'Recorded plan, pass 1, as failed, with no report, and pushed the ledger.',
  ]);
  const plan = stored(w).ledger.steps[1];
  assert.equal(plan.state, 'failed');
  assert.equal(plan.report, undefined);
  assert.equal(begin(call, w, 'plan').status, 0);
  const gone = call('step', 'end', 'plan', 'failed', '--report',
    path.join(call.artifacts, '.reports', 'none.md'));
  assert.equal(gone.status, 0, gone.out);
  assert.match(gone.lines[0], /^Write the report first: ".*" does not exist\.$/);
  assert.equal(stored(w).ledger.steps[2].state, 'failed');
});

test('ledger: --report takes only a file under .reports, and no link', () => {
  const w = work();
  const call = resumed(w);
  assert.equal(begin(call, w, 'plan').status, 0);
  const outside = path.join(fresh('elsewhere'), 'report.md');
  fs.writeFileSync(outside, 'done\n');
  const link = path.join(call.artifacts, '.reports', 'link.md');
  fs.symlinkSync(report(call, 'planner-1', 'done\n'), link);
  const cases = [
    [outside, /^Write the report under \.reports of the artifact folder: ".*" is not there\./],
    [link, /^Name the report file, not a link to it: ".*" is a link\./],
    [path.join(call.artifacts, '.reports', 'none.md'), /^Write the report first: ".*" does not exist\./],
  ];
  for (const [file, pattern] of cases) {
    const result = call('step', 'end', 'plan', 'done', '--report', file);
    assert.equal(result.status, 3, result.out);
    assert.match(result.lines[0], pattern);
  }
});

test('ledger: wrong arguments exit 2 with the usage, and show no undefined', () => {
  const w = work();
  const call = resumed(w);
  const attempt = ['--attempt', 'a,b,fast,m'];
  const pushed = ['--pushed', 'spec/main/1'];
  const cases = [
    [['step'], /^Give step begin or step end: nothing is neither\./],
    [['step', 'begin'], /^Give the id of a step, such as plan, deliverable:d-1 or fix:f1: nothing is none\./],
    [['step', 'begin', 'deliverable:d-0', 'implement-changes', 'x'], /^Give the id of a step.*: "deliverable:d-0" is none\./],
    [['step', 'begin', 'plan'], /^Give the workflow of the session in lower case: nothing is none\./],
    [['step', 'begin', 'plan', 'implement-changes'], /^Give step begin the files/],
    [['step', 'end', 'plan'], /^Give step end the state done or failed: nothing is neither\./],
    [['step', 'end', 'plan', 'done', '--attempt', 'a,b,slow,m'], /^Give --attempt as/],
    [['step', 'end', 'plan', 'done', ...attempt, ...attempt, ...attempt, ...attempt], /^Give --attempt at most 3 times/],
    [['step', 'end', 'plan', 'done', '--pushed', 'spec/main/0'], /^Give --pushed as/],
    [['step', 'end', 'plan', 'done', ...pushed, ...pushed, ...pushed, ...pushed, ...pushed], /^Give --pushed at most 4 times/],
    [['step', 'end', 'plan', 'done', '--report'], /^Give --report a value\./],
    [['step', 'end', 'plan', 'done', '--report', 'a', '--report', 'b'], /^Give --report once\./],
    [['step', 'end', 'plan', 'done', '--script-sha256', 'ABC'], /^Give --script-sha256 64 lower-case hex digits: "ABC" is not\./],
    [['step', 'end', 'plan', 'done', '--ot\u0007her', 'x'], /^Give step end only --report, --attempt, --pushed, --script-sha256: "--ot her" is none\./],
    [['resume', 'now'], /^Give resume no argument\./],
  ];
  for (const [argv, pattern] of cases) {
    const result = call(...argv);
    assert.equal(result.status, 2, argv.join(' '));
    assert.match(result.err, pattern, argv.join(' '));
    assert.doesNotMatch(result.err, /undefined/, argv.join(' '));
    assert.match(result.err, /\| step begin <id> <workflow> <file>\.\.\./);
  }
});

// ---- Pushes, pulls and inputs that fail -----------------------------------------------------

test('ledger: a failed push changes no draft, and its line asks for resume', () => {
  const w = work();
  const call = resumed(w);
  deliver(call, w, 'deliverable:d-1');
  const draft = fs.readFileSync(path.join(call.artifacts, 'build-ledger.json'), 'utf8');
  fs.writeFileSync(path.join(w.bin, 'fail-push'), '');
  const failed = begin(call, w, 'deliverable:d-2');
  assert.equal(failed.status, 3, failed.out);
  assert.match(failed.lines[0], /^Run checks\.js resume, then step begin again: qory artifact push build-ledger exited with 1: The push failed: 503 unavailable\.$/);
  assert.ok([...failed.lines[0]].length <= 196, failed.lines[0]);
  assert.equal(fs.readFileSync(path.join(call.artifacts, 'build-ledger.json'), 'utf8'), draft);
});

test('ledger: a push that stored the version and failed leaves the draft behind; resume reads the store', () => {
  const w = work();
  const call = resumed(w);
  fs.writeFileSync(path.join(w.bin, 'stored-then-fail'), '');
  assert.equal(begin(call, w, 'plan').status, 3);
  fs.rmSync(path.join(w.bin, 'stored-then-fail'));
  // The store has the running row, the draft does not: the next push fails the kept rule.
  const next = begin(call, w, 'checks');
  assert.equal(next.status, 3, next.out);
  assert.match(next.lines[0], /^Run checks\.js resume, then step begin again: /);
  const again = call('resume');
  assert.deepEqual(again.lines.slice(0, -1), ['Run plan again: its pass 1 stopped while it ran, ' +
    'so step begin starts pass 2.']);
  assert.equal(begin(call, w, 'checks').status, 0);
});

test('ledger: the 20-escalation limit, and a failed escalation push', () => {
  const w = work();
  store(w, fullLedger(w, 20));
  const call = resumed(w);
  const before = pushes(w);
  assert.deepEqual(begin(call, w, 'plan').lines, [FULL]);
  assert.equal(pushes(w), before, 'with 20 escalations, step begin pushes none');
  const other = work();
  store(other, fullLedger(other));
  const second = resumed(other);
  fs.writeFileSync(path.join(other.bin, 'fail-push'), '');
  const failed = begin(second, other, 'plan');
  assert.equal(failed.status, 1, failed.out);
  assert.match(failed.lines[0], /^Run checks\.js resume, then step begin again: /);
  assert.equal(failed.lines.at(-1), FULL);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(second.artifacts, 'points.json'), 'utf8')),
    [POINT]);
});

test('ledger: at 20 points, the point of the full ledger replaces the last, with a line', () => {
  const w = work();
  store(w, fullLedger(w));
  const call = resumed(w);
  const others = Array.from({ length: 20 }, (_, n) => ({
    text: `The review of part ${n + 1} found an open question.`, action: 'run_again',
  }));
  const points = path.join(call.artifacts, 'points.json');
  fs.writeFileSync(points, JSON.stringify(others));
  const refused = begin(call, w, 'plan');
  assert.equal(refused.status, 1, refused.out);
  assert.deepEqual(refused.lines, [
    'Raise this point again in the next session: points.json had 20 points, its limit, so ' +
      'step begin removed it for the point of the full ledger: "The review of part 20 found an ' +
      'open question.".',
    FULL,
  ]);
  for (const line of refused.lines) assert.ok([...line].length <= 196, line);
  assert.deepEqual(JSON.parse(fs.readFileSync(points, 'utf8')), [...others.slice(0, 19), POINT]);
  assert.equal(call('check', 'points', points).status, 0);
});

// criteriaFiles writes approved acceptance criteria with texts, and a build plan whose
// deliverable d-<N> lists criterion ac-<N>, to the artifact folder of call.
function criteriaFiles(call, texts) {
  const root = call.artifacts;
  const index = { version: 1, artifacts: [
    { type: 'acceptance-criteria', name: 'main', approved_version: 'av_ac1', newest_version: 1,
      versions: [{ id: 'av_ac1', number: 1, writer: { kind: 'person' } }] },
    { type: 'build-plan', name: 'main', approved_version: null, newest_version: 1,
      versions: [{ id: 'av_bp1', number: 1, writer: { kind: 'run', run_id: 'run-1' } }] },
  ] };
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index));
  const rows = texts.map((text, n) => `| ac-${n + 1} | ${text} | Tests |`);
  const criteria = path.join(root, 'acceptance-criteria', 'main', 'v1');
  fs.mkdirSync(criteria, { recursive: true });
  fs.writeFileSync(path.join(criteria, 'acceptance-criteria.md'), ['## Summary', '',
    'What the shop needs.', '', '| Id | Criterion | Planned check |', '| --- | --- | --- |',
    ...rows, ''].join('\n'));
  const plan = path.join(root, 'build-plan', 'main', 'v1');
  fs.mkdirSync(plan, { recursive: true });
  fs.writeFileSync(path.join(plan, 'build-plan.md'), ['## Summary', '', 'The plan.', '',
    '## Deliverables', '', '| Id | Change | Criteria | Files | Check |',
    '| --- | --- | --- | --- | --- |',
    ...texts.map((_, n) => `| d-${n + 1} | A change. | ac-${n + 1} | src/a.js | tests/a.test.js |`),
    '', '## Commands', ''].join('\n'));
}

// fullWith returns the point that step begin writes at the 101st row, with the criteria texts
// and the deliverables of ids done in the ledger.
function fullWith(texts, done) {
  const w = work();
  const ledger = fullLedger(w);
  done.forEach((id, n) => Object.assign(ledger.steps[n], { id: `deliverable:${id}`,
    kind: 'deliverable' }));
  store(w, ledger);
  const call = resumed(w);
  criteriaFiles(call, texts);
  const refused = begin(call, w, 'plan');
  assert.deepEqual(refused.lines, [FULL]);
  const points = path.join(call.artifacts, 'points.json');
  const check = call('check', 'points', points);
  assert.equal(check.status, 0, check.out);
  return JSON.parse(fs.readFileSync(points, 'utf8'))[0];
}

test('ledger: the point of the full ledger names the criteria that are not built', () => {
  const texts = ['The cart keeps its items after a reload. It shows a count.',
    'The `checkout` page asks for an address', 'Orders export as CSV.'];
  // Two of three: plural, each the first sentence with no full stop and no code mark.
  assert.deepEqual(fullWith(texts, ['d-3']), { action: 'run_again', fix: SOME,
    text: `${LIMIT} 2 of 3 criteria are not built: "The cart keeps its items after a reload", ` +
      '"The checkout page asks for an address".' });
  // One of three: singular.
  assert.equal(fullWith(texts, ['d-1', 'd-3']).text,
    `${LIMIT} 1 of 3 criteria is not built: "The checkout page asks for an address".`);
  // Every one built.
  assert.deepEqual(fullWith(texts, ['d-1', 'd-2', 'd-3']), POINT);
  // Texts that do not fit in 500 characters end the list with the count of the rest.
  const long = Array.from({ length: 6 },
    (_, n) => `Criterion ${n + 1} ${'needs a long text '.repeat(6).trim()}`);
  const cut = fullWith(long, []).text;
  assert.ok([...cut].length <= 500, cut);
  assert.ok(cut.startsWith(`${LIMIT} 6 of 6 criteria are not built: "Criterion 1 `), cut);
  assert.match(cut, /", and [1-5] more, listed in the acceptance criteria on Build's tab\.$/);
  // With no criteria, the count of deliverables of the ledger that are not built.
  const w = work();
  const ledger = fullLedger(w);
  Object.assign(ledger.steps[0], { id: 'deliverable:d-1', kind: 'deliverable', state: 'failed' });
  delete ledger.steps[0].commit;
  store(w, ledger);
  const call = resumed(w);
  assert.deepEqual(begin(call, w, 'plan').lines, [FULL]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(call.artifacts, 'points.json'), 'utf8')),
    [{ text: `${LIMIT} 1 of 1 planned changes is not built.`, action: 'run_again', fix: SOME }]);
});

test('ledger: an input that cannot be read exits 3', () => {
  const w = work();
  const call = resumed(w);
  const missing = begin(call, w, 'plan', [path.join(tmp, 'no-such-input')]);
  assert.equal(missing.status, 3);
  assert.match(missing.lines[0], /^Name input files that exist and can be read: ".*" cannot be read\./);
  // Not a checkout of git.
  const bare = session({ ...w, repo: fresh('plain') }, { cwd: fresh('plain') });
  const none = bare('resume');
  assert.equal(none.status, 3, none.out);
  assert.match(none.lines[0], /^Run step and resume in the checkout of the work: git rev-parse HEAD failed/);
  // A failed pull.
  fs.writeFileSync(path.join(w.bin, 'fail-pull'), '');
  const pull = session(w)('resume');
  assert.equal(pull.status, 3);
  assert.match(pull.lines[0], /^Push nothing, and end the session with this line: qory artifact pull build-ledger exited with 1: The pull failed\.$/);
  fs.rmSync(path.join(w.bin, 'fail-pull'));
  // A draft that breaks the schema.
  fs.writeFileSync(path.join(call.artifacts, 'build-ledger.json'), '{"steps":[],"escalations":[],"x":1}');
  const broken = begin(call, w, 'plan');
  assert.equal(broken.status, 3, broken.out);
  assert.match(broken.lines[0], /^Run checks\.js resume, then the verb again: build-ledger\.json of the artifact folder breaks its schema: Remove the member "x"/);
});

test('ledger: without the rules of a skill, step and resume exit 3', () => {
  const w = work();
  const plugin = path.join(fresh('core'), 'plugin');
  fs.mkdirSync(path.join(plugin, 'skills'), { recursive: true });
  fs.symlinkSync(path.dirname(SCRIPT), path.join(plugin, 'skills', 'running-a-workflow'));
  const result = session(w, { plugin })('resume');
  assert.equal(result.status, 3, result.out);
  assert.match(result.lines[0], /^Add the module of the workflow to the stack: no skill adds the rules of the ledger/);
});

test('ledger: a crash of step or resume exits 4 with the fix first on stderr', () => {
  const w = work();
  const artifacts = fresh('artifacts');
  let err = '';
  const status = main(['resume'], {
    cwd: w.repo, artifacts: [artifacts], env: { ...w.env, ARTIFACTS: artifacts, QORY_RUN_ID: 'run-x' },
    plugin: path.join(MODULES, 'core'), qory: w.qory,
    out: { write: () => { throw new Error('boom'); } },
    err: { write: (text) => { err += text; } },
  });
  assert.equal(status, 4);
  assert.match(err, /^Send this error to the harness maintainers: checks\.js resume crashed, so the ledger may lack its last change\.\nError: boom\n/);
});

test('ledger: each finding line has at most 196 characters with ids of 44 characters', () => {
  const w = work();
  const call = resumed(w);
  const other = `fix:${'b'.repeat(40)}`;
  deliver(call, w, LONG);
  commit(w, 'outside.txt', 'An edit outside a step.\n');
  const lines = [...begin(call, w, other).lines];
  git(w, 'reset', '-q', '--hard', 'HEAD~1');
  assert.equal(begin(call, w, other).status, 0);
  lines.push(...begin(call, w, LONG).lines);
  fs.writeFileSync(path.join(w.repo, `${'c'.repeat(150)}.txt`), 'An untracked file.\n');
  lines.push(...call('step', 'end', other, 'done').lines);
  for (const line of lines) assert.ok([...line].length <= 196, `${[...line].length}: ${line}`);
  assert.ok(lines.length >= 4, lines.join('\n'));
});
