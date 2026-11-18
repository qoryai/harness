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
const SCRIPT = path.join(MODULES, 'core/skills/running-a-workflow/checks.cjs');
const PUSH = path.join(MODULES,
  'software-factory/skills/running-a-software-workflow/workflow-checks.cjs');
const { main } = require(SCRIPT);
const { watch, CHILD } = require('./first-line.js');

const FULL = 'Start no new step: the ledger has 100 rows, its limit. End the session with escalate.';
const LIMIT = 'The build is at its limit of 100 build steps, so another round stops at once, and';
const SOME = 'Pick Accept as it is, or close this work item and make a new one for the ' +
  'criteria that are not built.';
const PLANNED = 'Pick Accept as it is, or close this work item and make a new one for the ' +
  'planned changes that are not built.';
const POINT = {
  text: `${LIMIT} every criterion is built.`,
  action: 'run_again',
  fix: 'Pick Accept as it is, or close this work item.',
};
// The point of a full ledger with no build plan, no criteria and no deliverable row.
const NONE = { text: `${LIMIT} no planned change is built.`, action: 'run_again', fix: PLANNED };
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

// listVersion adds version number of build-ledger, which the run run wrote, to the index.json
// at file, as qory lists a version that it stores. The qory stub runs it on each push.
function listVersion(file, number, run) {
  const fs = require('node:fs');
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  let entry = index.artifacts.find((one) => one.type === 'build-ledger');
  if (!entry) {
    entry = { type: 'build-ledger', name: 'main', approved_version: null, versions: [] };
    index.artifacts.push(entry);
  }
  entry.versions.push({ id: `av_bl${number}_${process.pid}`, number: Number(number),
    writer: { kind: 'run', run_id: run || 'run-0' } });
  entry.newest_version = Math.max(...entry.versions.map((one) => one.number));
  const temporary = `${file}.${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(index));
  fs.renameSync(temporary, file);
}

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
  fs.writeFileSync(path.join(w.bin, 'index.js'),
    `${listVersion}\nlistVersion(...process.argv.slice(2));\n`);
  w.qory = path.join(w.bin, 'qory');
  // A push runs the push check in the store, then stores the next version; with the file
  // fail-push it fails, and with stored-then-fail it stores the version and fails. Each push
  // and each pull adds a line to the file locks with the locks under .reports at that time. A
  // pull copies the versions and index.json into the artifact folder that ARTIFACTS names, and
  // fails with the file fail-pull. With no version, it copies no version, as qory at the
  // pinned commit does.
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
  '${process.execPath}' '${w.bin}/index.js' '${w.store}/index.json' "$n" "$QORY_RUN_ID"
  held=$(ls "$ARTIFACTS/.reports" 2>/dev/null | grep '\\.lock$' | tr '\\n' ' ')
  echo "push:$held" >> '${w.bin}/locks'
  [ -e '${w.bin}/stored-then-fail' ] && { echo 'No response.' >&2; exit 1; }
  echo "Pushed build-ledger version $n."
  exit 0;;
'artifact pull build-ledger')
  [ -e '${w.bin}/fail-pull' ] && { echo 'The pull failed.' >&2; exit 1; }
  held=$(ls "$ARTIFACTS/.reports" 2>/dev/null | grep '\\.lock$' | tr '\\n' ' ')
  echo "pull:$held" >> '${w.bin}/locks'
  rm -rf "$ARTIFACTS/build-ledger"
  [ -d '${w.store}/build-ledger' ] && cp -R '${w.store}/build-ledger' "$ARTIFACTS/"
  cp '${w.store}/index.json' "$ARTIFACTS/index.json"
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
// is the number of the session in its run, QORY_SESSION, which is unset by default. lockWait,
// when given, is the most milliseconds that a call waits for a lock.
let runs = 0;
function session(w, { cwd = w.repo, plugin = path.join(MODULES, 'core'),
  artifacts = fresh('artifacts'), run = `run-${++runs}`, number, lockWait } = {}) {
  const env = { ...w.env, ARTIFACTS: artifacts, QORY_RUN_ID: run };
  delete env.QORY_SESSION;
  if (number !== undefined) env.QORY_SESSION = number;
  const call = (...argv) => {
    let out = '';
    let err = '';
    const first = watch();
    const status = main(argv, {
      cwd, artifacts: [artifacts], env, plugin, qory: w.qory,
      ...(lockWait === undefined ? {} : { lockWait }),
      out: { write: (text) => { out += text; } },
      err: { write: (text) => { err += text; } },
      firstLine: first.firstLine,
    });
    first.check(status, err);
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
    '--attempt', 'software-developer,developer,balanced,unknown');
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
  listVersion(path.join(w.store, 'index.json'), number);
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
    [{ agent: 'software-developer', role: 'developer', tier: 'balanced', model: 'unknown' }]);
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
  assert.equal(refused.lines[0], `Return the checkout to ${c1.slice(0, 12)}, where ` +
    'deliverable:d-1 ended.');
  assert.match(refused.lines[1], /^ {2}The head [0-9a-f]{12} has a change that no step of this session made\.$/);
  assert.equal(refused.lines.at(-1), 'Started no row of deliverable:d-2: the ledger is unchanged.');
  assert.equal(pushes(w), before, 'step begin pushes nothing');
  // A file changed and not committed fails step end done.
  git(w, 'reset', '-q', '--hard', c1);
  assert.equal(begin(call, w, 'deliverable:d-2').status, 0);
  fs.writeFileSync(path.join(w.repo, 'README.md'), 'An edit that no step committed.\n');
  const dirty = call('step', 'end', 'deliverable:d-2', 'done');
  assert.equal(dirty.status, 1, dirty.out);
  assert.equal(dirty.lines[0], 'Commit each change in the step, or undo it.');
  assert.match(dirty.lines[1], /^ {2}1 file of the checkout differs from [0-9a-f]{12}, such as "README\.md"\.$/);
  assert.equal(dirty.lines.at(-1), 'Checked the step deliverable:d-2: the ledger is unchanged.');
  assert.equal(stored(w).ledger.steps[1].state, 'running');
  // step end failed records the failure with the edit, and no commit.
  assert.equal(call('step', 'end', 'deliverable:d-2', 'failed').status, 0);
  const failed = stored(w).ledger.steps[1];
  assert.equal(failed.state, 'failed');
  assert.equal(failed.commit, undefined);
  // The next step begin refuses the failed step's edit, an untracked file included, and names
  // the command that keeps it in a stash; a file under .qory stays where it is.
  fs.writeFileSync(path.join(w.repo, 'draft.txt'), 'An untracked file of the failed step.\n');
  fs.mkdirSync(path.join(w.repo, '.qory'), { recursive: true });
  fs.writeFileSync(path.join(w.repo, '.qory', 'note.json'), '{}');
  const before2 = pushes(w);
  const left = begin(call, w, 'deliverable:d-2');
  assert.equal(left.status, 1, left.out);
  assert.deepEqual(left.lines.slice(0, 2), ["Run git stash push --include-untracked -- ':/' " +
    "':!/.qory', then step begin again.", '  The failed step deliverable:d-2 left 2 files changed.']);
  assert.equal(pushes(w), before2, 'step begin pushes nothing');
  git(w, 'stash', 'push', '--include-untracked', '--', ':/', ':!/.qory');
  assert.equal(fs.existsSync(path.join(w.repo, '.qory', 'note.json')), true);
  assert.match(git(w, 'stash', 'show', '--include-untracked', '--name-only', 'stash@{0}'),
    /^README\.md\ndraft\.txt$/);
  const again = begin(call, w, 'deliverable:d-2');
  assert.equal(again.lines.at(-1), 'Run deliverable:d-2 as pass 2: start its agent, then run ' +
    'step end.');
  assert.equal(stored(w).ledger.steps[2].base, c1);
});

test('ledger: a change made before step begin and outside a step is refused', () => {
  const w = work();
  const call = resumed(w);
  // A file changed before the first step: no step of the session made it.
  fs.writeFileSync(path.join(w.repo, 'README.md'), 'An edit before the first step.\n');
  const refused = begin(call, w, 'deliverable:d-1');
  assert.equal(refused.status, 1, refused.out);
  assert.deepEqual(refused.lines, ['End the session, and keep the checkout as it is.',
    '  1 file changed outside a step, such as "README.md".',
    'Started no row of deliverable:d-1: the ledger is unchanged.']);
  assert.equal(pushes(w), 0, 'step begin pushes nothing');
  assert.equal(fs.readFileSync(path.join(w.repo, 'README.md'), 'utf8'),
    'An edit before the first step.\n');
  // A file changed after a done step: the row before it is no failed step.
  git(w, 'checkout', '-q', '--', 'README.md');
  deliver(call, w, 'deliverable:d-1');
  fs.writeFileSync(path.join(w.repo, 'new.txt'), 'An edit between two steps.\n');
  fs.writeFileSync(path.join(w.repo, 'other.txt'), 'A second one.\n');
  const between = begin(call, w, 'deliverable:d-2');
  assert.equal(between.status, 1, between.out);
  assert.deepEqual(between.lines.slice(0, 2), ['End the session, and keep the checkout as it is.',
    '  2 files changed outside a step, such as "new.txt".']);
});

test('ledger: a commit between resume and the first row is refused', () => {
  const w = work();
  const start = headOf(w);
  const call = resumed(w);
  const moved = commit(w, 'notes.txt', 'A commit after resume.\n');
  const refused = begin(call, w, 'deliverable:d-1');
  assert.equal(refused.status, 1, refused.out);
  assert.deepEqual(refused.lines, [`Return the checkout to ${start.slice(0, 12)}, where the ` +
    `session started.`, `  The head ${moved.slice(0, 12)} has a change that no step of this ` +
    'session made.', 'Started no row of deliverable:d-1: the ledger is unchanged.']);
  assert.equal(pushes(w), 0, 'step begin pushes nothing');
  git(w, 'reset', '-q', '--keep', start);
  assert.equal(begin(call, w, 'deliverable:d-1').status, 0);
  assert.equal(stored(w).ledger.steps[0].base, start);
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
  assert.deepEqual(again.lines.slice(0, -1), ['Run deliverable:d-2 again.', '  Its pass 1 of ' +
    'deliverable:d-2 stopped while it ran, so step begin starts pass 2.']);
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

test('ledger: after a crash, the next session stashes the crashed step\'s changes', () => {
  const w = work();
  const first = resumed(w);
  deliver(first, w, 'deliverable:d-1');
  const c1 = headOf(w);
  assert.equal(begin(first, w, 'deliverable:d-2').status, 0);
  // The session stops while d-2 runs, with a changed file and an untracked one.
  fs.writeFileSync(path.join(w.repo, 'README.md'), 'A change of the crashed step.\n');
  fs.writeFileSync(path.join(w.repo, 'part.txt'), 'A file of the crashed step.\n');
  // The next session of the same run, in the same artifact folder, gets the stash line.
  const next = session(w, { artifacts: first.artifacts, run: first.run });
  assert.equal(next('resume').status, 0);
  const left = begin(next, w, 'deliverable:d-2');
  assert.equal(left.status, 1, left.out);
  assert.deepEqual(left.lines, ["Run git stash push --include-untracked -- ':/' ':!/.qory', " +
    'then step begin again.', '  The failed step deliverable:d-2 left 2 files changed.',
  'Started no row of deliverable:d-2: the ledger is unchanged.']);
  git(w, 'stash', 'push', '--include-untracked', '--', ':/', ':!/.qory');
  const again = begin(next, w, 'deliverable:d-2');
  assert.equal(again.lines.at(-1), 'Run deliverable:d-2 as pass 2: start its agent, then run ' +
    'step end.');
  assert.equal(stored(w).ledger.steps.at(-1).base, c1);
  // A new run finds no mark of its run, so no step of it made a change after the crash.
  const v = work();
  const crashed = resumed(v);
  assert.equal(begin(crashed, v, 'plan').status, 0);
  fs.writeFileSync(path.join(v.repo, 'README.md'), 'A change of the crashed step.\n');
  const other = resumed(v);
  assert.deepEqual(begin(other, v, 'plan').lines.slice(0, 2), ['End the session, and keep the ' +
    'checkout as it is.', '  1 file changed outside a step, such as "README.md".']);
});

test('ledger: after a crash with a commit, the next session returns to the crashed base', () => {
  const w = work();
  const first = resumed(w);
  deliver(first, w, 'deliverable:d-1');
  const c1 = headOf(w);
  assert.equal(begin(first, w, 'deliverable:d-2').status, 0);
  // The session stops while d-2 runs, after a commit and with one more changed file.
  const left = commit(w, 'd-2.txt', 'A commit of the crashed step.\n');
  fs.writeFileSync(path.join(w.repo, 'README.md'), 'A change of the crashed step.\n');
  // resume records the head with the crashed commit as the start head; the first step begin
  // starts the session on the crashed step's base instead, after the stash.
  const next = session(w, { artifacts: first.artifacts, run: first.run });
  assert.equal(next('resume').status, 0);
  const mark = JSON.parse(fs.readFileSync(path.join(next.artifacts, '.reports', 'ledger.json'),
    'utf8'));
  assert.equal(mark.origin, left);
  assert.deepEqual(mark.crashed, ['deliverable:d-2\n1']);
  assert.deepEqual(begin(next, w, 'deliverable:d-2').lines.slice(0, 2), ['Run git stash push ' +
    "--include-untracked -- ':/' ':!/.qory', then step begin again.", '  The failed step ' +
    'deliverable:d-2 left 1 file changed.']);
  git(w, 'stash', 'push', '--include-untracked', '--', ':/', ':!/.qory');
  // A second resume in the session, as after a failed push, keeps the crash.
  assert.equal(next('resume').status, 0);
  const reset = begin(next, w, 'deliverable:d-2');
  assert.equal(reset.status, 1, reset.out);
  assert.deepEqual(reset.lines.slice(0, 2), [`Run git reset --keep ${c1.slice(0, 12)}, then ` +
    'step begin again.', `  The failed step deliverable:d-2 left the commit ${left.slice(0, 12)}.`]);
  git(w, 'reset', '-q', '--keep', c1.slice(0, 12));
  const run = begin(next, w, 'deliverable:d-2');
  assert.equal(run.lines.at(-1), 'Run deliverable:d-2 as pass 2: start its agent, then run ' +
    'step end.');
  assert.equal(stored(w).ledger.steps.at(-1).base, c1);
  // The crashed commit counts once: the next row goes on from the row of this session.
  commit(w, 'd-2.txt', 'The change of d-2.\n');
  assert.equal(next('step', 'end', 'deliverable:d-2', 'done').status, 0);
  const c2 = headOf(w);
  assert.equal(begin(next, w, 'deliverable:d-3').status, 0);
  assert.equal(stored(w).ledger.steps.at(-1).base, c2);
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
  // points.json has the point of the 101st row, which passes the check of points. With no
  // build plan, no criteria and no deliverable row, it counts no planned change.
  const points = path.join(call.artifacts, 'points.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(points, 'utf8')), [NONE]);
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
  assert.deepEqual(refused.lines.slice(0, 2), [`Run git reset --keep ${c1.slice(0, 12)}, then ` +
    'step begin again.', `  The failed step deliverable:d-2 left the commit ${left.slice(0, 12)}.`]);
  git(w, 'reset', '-q', '--keep', c1.slice(0, 12));
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
  assert.deepEqual(refused.lines.slice(0, 2), [`Run git reset --keep ${head.slice(0, 12)}, then ` +
    'step begin again.', `  The failed step plan left the commit ${left.slice(0, 12)}.`]);
  git(w, 'reset', '-q', '--keep', head.slice(0, 12));
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
    assert.deepEqual(result.lines.slice(0, 2), ['Run checks.cjs resume first, once at the start ' +
      'of the session.', '  .reports/ledger.json is from an earlier session.']);
  }
  assert.equal(next('resume').status, 0);
  assert.equal(begin(next, w, 'checks').status, 0);
  // Session 2 of another run is another session too.
  const other = session(w, { artifacts: earlier.artifacts, number: '2' });
  assert.equal(other('step', 'end', 'checks', 'failed').status, 3);
  // A number that is no number of a session exits 3.
  const wrong = session(w, { number: '0' })('resume');
  assert.equal(wrong.status, 3, wrong.out);
  assert.deepEqual(wrong.lines.slice(0, 2), ['Run step and resume in a session of qory.',
    '  QORY_SESSION is not a whole number from 1 to 999999: "0".']);
  assert.equal(session(w, { number: '1000000' })('resume').status, 3);
  // An empty QORY_SESSION counts as 1, as an unset one does.
  const empty = session(w, { artifacts: earlier.artifacts, run: earlier.run, number: '' });
  assert.equal(empty('resume').status, 0);
  const unset = begin(session(w, { artifacts: earlier.artifacts, run: earlier.run }), w, 'plan');
  assert.equal(unset.status, 0, unset.out);
  assert.match(unset.lines.at(-1), /^Replay plan from pass 1: /);
  // Without the run id of qory, no session starts.
  const artifacts = fresh('artifacts');
  const { QORY_RUN_ID, ...env } = { ...w.env, ARTIFACTS: artifacts };
  assert.equal(QORY_RUN_ID, undefined);
  let out = '';
  const first = watch();
  const status = main(['resume'], {
    cwd: w.repo, artifacts: [artifacts], env, plugin: path.join(MODULES, 'core'), qory: w.qory,
    out: { write: (text) => { out += text; } }, err: { write: () => {} },
    firstLine: first.firstLine,
  });
  first.check(status);
  assert.equal(status, 3, out);
  assert.deepEqual(out.split('\n').slice(0, 2), ['Run step and resume in a run of qory.',
    '  QORY_RUN_ID is not set, so the ledger cannot tell one session from the next.']);
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
  assert.equal(begin(inSub, w, 'checks').status, 0);
  fs.writeFileSync(path.join(sub, 'new.txt'), 'An untracked file.\n');
  const untracked = inSub('step', 'end', 'checks', 'done');
  assert.equal(untracked.status, 1, untracked.out);
  assert.match(untracked.lines[1], /such as "src\/new\.txt"\.$/);
  fs.rmSync(path.join(sub, 'new.txt'));
  // A head that does not follow the base.
  const start = headOf(w);
  commit(w, 'other.txt', 'A commit of the step.\n');
  git(w, 'reset', '-q', '--hard', 'HEAD~1');
  git(w, 'checkout', '-q', '--orphan', 'elsewhere');
  git(w, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Another root');
  const away = inSub('step', 'end', 'checks', 'done');
  assert.equal(away.status, 1, away.out);
  assert.equal(away.lines[0], `Check out a commit that follows ${start.slice(0, 12)}, the base ` +
    'of the step.');
  assert.match(away.lines[1], new RegExp(`^ {2}checks started on ${start.slice(0, 12)}, and the ` +
    'head [0-9a-f]{12} does not follow it\\.$'));
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
  // No finding: the one line has the fix.
  assert.deepEqual(second.lines, ['End the step plan, row 1, with step end, or run checks.cjs ' +
    'resume after a crash.']);
  const none = call('step', 'end', 'checks', 'done');
  assert.equal(none.status, 1);
  assert.deepEqual(none.lines, ['Start checks with step begin first: the ledger has no running ' +
    'row of it.']);
});

test('ledger: the line of a running row and of no running row keeps 100 characters', () => {
  const w = work();
  const call = resumed(w);
  // The longest id that the build ledger takes: fix: and 40 characters.
  const long = `fix:${'a'.repeat(40)}`;
  assert.equal(begin(call, w, long).status, 0);
  const second = begin(call, w, 'checks');
  assert.equal(second.status, 1);
  assert.equal(second.lines.length, 1, second.out);
  assert.equal(second.lines[0], `End the step fix:aaaaaa...aaaaaaaaa, row 1, with step end, ` +
    'or run checks.cjs resume after a crash.');
  // Room for a row of 3 digits.
  assert.ok([...second.lines[0]].length + 2 <= 100, second.lines[0]);
  const other = `fix:${'b'.repeat(40)}`;
  const none = call('step', 'end', other, 'done');
  assert.equal(none.status, 1);
  assert.equal(none.lines.length, 1, none.out);
  assert.ok([...none.lines[0]].length <= 100, none.lines[0]);
  assert.match(none.lines[0], /^Start fix:b+\.\.\.b+ with step begin first: the ledger has no /);
});

test('ledger: step begin and step end need resume first', () => {
  const w = work();
  const call = session(w);
  for (const result of [begin(call, w, 'plan'), call('step', 'end', 'plan', 'done')]) {
    assert.equal(result.status, 3, result.out);
    assert.deepEqual(result.lines.slice(0, 2), ['Run checks.cjs resume first, once at the start ' +
      'of the session.', '  The artifact folder has no .reports/ledger.json that resume writes.']);
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
    'in the ledger.');
  assert.equal(cut.lines[1], '  "browser-demo-author-1.md" has 8196 bytes in 4098 characters.');
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
    'Keep the next report to 8192 bytes as written in the ledger.',
    '  The report "browser-demo-author-1.md" has 8196 bytes in 4098 characters, so the row has ' +
      'none.',
    'Recorded plan, pass 1, as failed, with no report, and pushed the ledger.',
  ]);
  const plan = stored(w).ledger.steps[1];
  assert.equal(plan.state, 'failed');
  assert.equal(plan.report, undefined);
  assert.equal(begin(call, w, 'plan').status, 0);
  const gone = call('step', 'end', 'plan', 'failed', '--report',
    path.join(call.artifacts, '.reports', 'none.md'));
  assert.equal(gone.status, 0, gone.out);
  assert.equal(gone.lines[0], 'Write the report first.');
  assert.match(gone.lines[1], /^ {2}".*" does not exist\.$/);
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
    [outside, 'Write the report under .reports of the artifact folder.', /^ {2}".*" is not there\./],
    [link, 'Name the report file, not a link to it.', /^ {2}".*" is a link\./],
    [path.join(call.artifacts, '.reports', 'none.md'), 'Write the report first.',
      /^ {2}".*" does not exist\./],
  ];
  for (const [file, first, second] of cases) {
    const result = call('step', 'end', 'plan', 'done', '--report', file);
    assert.equal(result.status, 3, result.out);
    assert.equal(result.lines[0], first);
    assert.match(result.lines[1], second);
  }
});

test('ledger: wrong arguments exit 2 with the usage, and show no undefined', () => {
  const w = work();
  const call = resumed(w);
  const attempt = ['--attempt', 'a,b,balanced,m'];
  const pushed = ['--pushed', 'spec/main/1'];
  const cases = [
    [['step'], /^Give step begin or step end\.\n  nothing is neither\./],
    [['step', 'begin'], /^Give the id of a step, such as plan, deliverable:d-1 or fix:f1\.\n  nothing is none\./],
    [['step', 'begin', 'deliverable:d-0', 'implement-changes', 'x'], /^Give the id of a step.*\.\n  "deliverable:d-0" is none\./],
    [['step', 'begin', 'plan'], /^Give the workflow of the session in lower case\.\n  nothing is none\./],
    [['step', 'begin', 'plan', 'implement-changes'], /^Give step begin the files/],
    [['step', 'end', 'plan'], /^Give step end the state done or failed\.\n  nothing is neither\./],
    [['step', 'end', 'plan', 'done', '--attempt', 'a,b,slow,m'], /^Give --attempt as/],
    [['step', 'end', 'plan', 'done', '--attempt', 'a,b,fast,m'], /^Give --attempt as/],
    [['step', 'end', 'plan', 'done', ...attempt, ...attempt, ...attempt, ...attempt], /^Give --attempt at most 3 times/],
    [['step', 'end', 'plan', 'done', '--pushed', 'spec/main/0'], /^Give --pushed as/],
    [['step', 'end', 'plan', 'done', ...pushed, ...pushed, ...pushed, ...pushed, ...pushed], /^Give --pushed at most 4 times/],
    [['step', 'end', 'plan', 'done', '--report'], /^Give --report a value\./],
    [['step', 'end', 'plan', 'done', '--report', 'a', '--report', 'b'], /^Give --report once\./],
    [['step', 'end', 'plan', 'done', '--script-sha256', 'ABC'], /^Give --script-sha256 64 lower-case hex digits\.\n  "ABC" is not\./],
    [['step', 'end', 'plan', 'done', '--ot\u0007her', 'x'], /^Give step end only the flags that its usage lists\.\n  The flags are --report, --attempt, --pushed, --script-sha256, and "--ot her" is none of them\./],
    [['resume', 'now'], /^Give resume no argument\./],
    [['step', 'begin', 'plan', 'implement-changes', 'x', '--inputs'],
      /^Give --inputs once, with the path of inputs\.json from the prompt\./],
    [['step', 'begin', 'plan', 'implement-changes', '--inputs', 'a', '--inputs', 'b', 'x'],
      /^Give --inputs once/],
    [['step', 'begin', 'plan', 'implement-changes', '--artifacts', '--inputs', 'a', 'x'],
      /^Give --artifacts once, with the path of the folder of the pulled build plans\./],
    [['step', 'begin', 'plan', 'implement-changes', '--inputs', 'a'], /^Give step begin the files/],
  ];
  for (const [argv, pattern] of cases) {
    const result = call(...argv);
    assert.equal(result.status, 2, argv.join(' '));
    assert.match(result.err, pattern, argv.join(' '));
    assert.doesNotMatch(result.err, /undefined/, argv.join(' '));
    assert.match(result.err,
      /\| step begin <id> <workflow> \[--inputs <path>\] \[--artifacts <folder>\] <file>\.\.\./);
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
  assert.equal(failed.lines[0], 'Run checks.cjs resume, then step begin again.');
  assert.equal(failed.lines[1],
    '  qory artifact push build-ledger exited with 1: The push failed: 503 unavailable.');
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
  assert.equal(next.lines[0], 'Run checks.cjs resume, then step begin again.');
  const again = call('resume');
  assert.deepEqual(again.lines.slice(0, -1), ['Run plan again.', '  Its pass 1 of plan stopped ' +
    'while it ran, so step begin starts pass 2.']);
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
  assert.equal(failed.lines[0], 'Run checks.cjs resume, then step begin again.');
  assert.equal(failed.lines.at(-1), FULL);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(second.artifacts, 'points.json'), 'utf8')),
    [NONE]);
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
    'Raise a point that step begin removed again in the next session.',
    '  points.json had 20 points, its limit, so step begin removed the point for the point of ' +
      'the full ledger.',
    '  The point is "The review of part 20 found an open question.".',
    FULL,
  ]);
  for (const line of refused.lines) assert.ok([...line].length <= 196, line);
  assert.deepEqual(JSON.parse(fs.readFileSync(points, 'utf8')), [...others.slice(0, 19), NONE]);
  assert.equal(call('check', 'points', points).status, 0);
});

// planText returns a build plan whose deliverable d-<N> lists the criteria of criteria[N - 1],
// such as ['ac-1'].
const planText = (criteria) => ['## Summary', '', 'The plan.', '', '## Deliverables', '',
  '| Id | Change | Criteria | Files | Check |', '| --- | --- | --- | --- | --- |',
  ...criteria.map((ids, n) =>
    `| d-${n + 1} | A change. | ${ids.join(', ')} | src/a.js | tests/a.test.js |`),
  '', '## Commands', '', '| Kind | Command | Result file | Source |', '| --- | --- | --- | --- |',
  '| targeted | none | none | The shop has no tests. |', ''].join('\n');

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
  const criteria = path.join(root, 'acceptance-criteria', 'main', 'v1');
  fs.mkdirSync(criteria, { recursive: true });
  fs.writeFileSync(path.join(criteria, 'acceptance-criteria.json'), JSON.stringify({
    summary: 'What the shop needs.',
    criteria: texts.map((text, n) => ({ id: `ac-${n + 1}`, text, check: 'Tests' })),
  }, null, 2));
  const plan = path.join(root, 'build-plan', 'main', 'v1');
  fs.mkdirSync(plan, { recursive: true });
  fs.writeFileSync(path.join(plan, 'build-plan.md'),
    planText(texts.map((_, n) => [`ac-${n + 1}`])));
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
    'The `checkout` page asks for an "address"', 'Orders export as CSV.'];
  // Two of three: plural, each the first sentence with no full stop and no code mark.
  assert.deepEqual(fullWith(texts, ['d-3']), { action: 'run_again', fix: SOME,
    text: `${LIMIT} 2 of 3 criteria are not built: "The cart keeps its items after a reload", ` +
      '"The checkout page asks for an \'address\'".' });
  // One of three: singular.
  assert.equal(fullWith(texts, ['d-1', 'd-3']).text,
    `${LIMIT} 1 of 3 criteria is not built: "The checkout page asks for an 'address'".`);
  // Every one built.
  assert.deepEqual(fullWith(texts, ['d-1', 'd-2', 'd-3']), POINT);
  // Texts that do not fit in 500 characters end the list with the count of the rest.
  const long = Array.from({ length: 6 },
    (_, n) => `Criterion ${n + 1} ${'needs a long text '.repeat(6).trim()}`);
  const cut = fullWith(long, []).text;
  assert.ok([...cut].length <= 500, cut);
  assert.ok(cut.startsWith(`${LIMIT} 6 of 6 criteria are not built: "Criterion 1 `), cut);
  assert.match(cut, /", and [1-5] more, listed in the acceptance criteria of this work item\.$/);
  // With no criteria, the count of deliverables of the ledger that are not built.
  const w = work();
  const ledger = fullLedger(w);
  Object.assign(ledger.steps[0], { id: 'deliverable:d-1', kind: 'deliverable', state: 'failed' });
  delete ledger.steps[0].commit;
  store(w, ledger);
  const call = resumed(w);
  assert.deepEqual(begin(call, w, 'plan').lines, [FULL]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(call.artifacts, 'points.json'), 'utf8')),
    [{ text: `${LIMIT} 1 of 1 planned changes is not built.`, action: 'run_again', fix: PLANNED }]);
  // With no criteria and every deliverable done, the point has the fix for all built.
  const done = work();
  const doneLedger = fullLedger(done);
  Object.assign(doneLedger.steps[0], { id: 'deliverable:d-1', kind: 'deliverable' });
  store(done, doneLedger);
  const doneCall = resumed(done);
  assert.deepEqual(begin(doneCall, done, 'plan').lines, [FULL]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(doneCall.artifacts, 'points.json'),
    'utf8')), [{ text: `${LIMIT} every planned change is built.`, action: 'run_again',
    fix: POINT.fix }]);
});

test('ledger: the point of the full ledger stops on a stored Markdown criteria version', () => {
  // A version folder with only the acceptance-criteria.md of the earlier format gives the line
  // to pull, and no point. Step begin still refuses row 101, so it exits 1, as for any point
  // that cannot be written.
  const w = work();
  store(w, fullLedger(w));
  const call = resumed(w);
  criteriaFiles(call, ['Orders export as CSV.']);
  const dir = path.join(call.artifacts, 'acceptance-criteria', 'main', 'v1');
  fs.rmSync(path.join(dir, 'acceptance-criteria.json'));
  fs.writeFileSync(path.join(dir, 'acceptance-criteria.md'), '## Summary\n\nA table.\n');
  const result = begin(call, w, 'plan');
  assert.equal(result.status, 1, result.out);
  assert.deepEqual(result.lines, ['Pull the artifacts again.',
    '  acceptance-criteria/main/v1 has no acceptance-criteria.json.', FULL], result.out);
  assert.equal(fs.existsSync(path.join(call.artifacts, 'points.json')), false);
});

// The check of a point refuses a file name of a run in its text, so the point leaves out a
// criterion whose first sentence contains one, also a script name that ends in .cjs.
test('ledger: the point of the full ledger leaves out a criterion with a file name', () => {
  for (const name of ['checks.js', 'checks.cjs']) {
    const texts = ['The cart keeps its items after a reload.', `Run ${name} before each push.`];
    assert.equal(fullWith(texts, []).text, `${LIMIT} 2 of 2 criteria are not built: ` +
      '"The cart keeps its items after a reload", and 1 more, listed in the acceptance ' +
      'criteria of this work item.', name);
  }
});

// startFolder writes a folder of build plans, as qory pulls it at the start of a run, with the
// plan of criteria, as planText takes them, as version 1, and returns its path.
function startFolder(criteria) {
  const folder = fresh('start');
  fs.writeFileSync(path.join(folder, 'index.json'), JSON.stringify({ version: 1, artifacts: [
    { type: 'build-plan', name: 'main', approved_version: null, newest_version: 1,
      versions: [{ id: 'av_start1', number: 1, writer: { kind: 'run', run_id: 'run-1' } }] },
  ] }));
  const plan = path.join(folder, 'build-plan', 'main', 'v1');
  fs.mkdirSync(plan, { recursive: true });
  fs.writeFileSync(path.join(plan, 'build-plan.md'), planText(criteria));
  return folder;
}

// inputsFile writes the inputs.json of a run with the members of qory, and returns its path.
function inputsFile(qory) {
  const file = path.join(fresh('in'), 'inputs.json');
  fs.writeFileSync(file, JSON.stringify({ qory: { harness_extensions: {}, ...qory } }));
  return file;
}

test('ledger: with --inputs, the point reads the build plan of the start of the run', () => {
  const texts = ['The cart keeps its items after a reload.', 'The page asks for an address.',
    'Orders export as CSV.'];
  const w = work();
  const ledger = fullLedger(w);
  Object.assign(ledger.steps[0], { id: 'deliverable:d-3', kind: 'deliverable' });
  store(w, ledger);
  const call = resumed(w);
  criteriaFiles(call, texts);
  // The session pushes the plan again as version 2, whose d-3, done, lists every criterion.
  const index = JSON.parse(fs.readFileSync(path.join(call.artifacts, 'index.json'), 'utf8'));
  const entry = index.artifacts.find((one) => one.type === 'build-plan');
  entry.versions.push({ id: 'av_bp2', number: 2, writer: { kind: 'run', run_id: call.run } });
  entry.newest_version = 2;
  fs.writeFileSync(path.join(call.artifacts, 'index.json'), JSON.stringify(index));
  const again = path.join(call.artifacts, 'build-plan', 'main', 'v2');
  fs.mkdirSync(again, { recursive: true });
  fs.writeFileSync(path.join(again, 'build-plan.md'), planText([[], [], ['ac-1', 'ac-2', 'ac-3']]));
  const points = path.join(call.artifacts, 'points.json');
  const pointOf = (...flags) => {
    fs.rmSync(points, { force: true });
    const refused = call('step', 'begin', 'plan', 'implement-changes', ...flags, ...w.inputs);
    assert.deepEqual(refused.lines, [FULL], refused.out);
    return JSON.parse(fs.readFileSync(points, 'utf8'))[0].text;
  };
  // Without --inputs, the newest version that the session pushed counts.
  assert.equal(pointOf(), `${LIMIT} every criterion is built.`);
  // With --inputs, the plan of the start counts, so the push changes nothing.
  const start = startFolder(texts.map((_, n) => [`ac-${n + 1}`]));
  const inputs = inputsFile({ start_commits: [{ path: w.repo, commit: headOf(w) }],
    start_artifacts: start });
  const pinned = `${LIMIT} 2 of 3 criteria are not built: ` +
    '"The cart keeps its items after a reload", "The page asks for an address".';
  assert.equal(pointOf('--inputs', inputs), pinned);
  // --artifacts reads the same folder, and the flags may follow the files.
  fs.rmSync(points, { force: true });
  const after = call('step', 'begin', 'plan', 'implement-changes', ...w.inputs,
    '--artifacts', start);
  assert.deepEqual(after.lines, [FULL], after.out);
  assert.equal(JSON.parse(fs.readFileSync(points, 'utf8'))[0].text, pinned);
});

test('ledger: step begin with an inputs.json without a start member exits 3', () => {
  const w = work();
  const call = resumed(w);
  const before = pushes(w);
  const start = startFolder([['ac-1']]);
  for (const [qory, member] of [
    [{ start_commits: [{ path: w.repo, commit: headOf(w) }] }, 'start_artifacts'],
    [{ start_artifacts: start }, 'start_commits'],
  ]) {
    const result = begin(call, w, 'plan', ['--inputs', inputsFile(qory), ...w.inputs]);
    assert.equal(result.status, 3, result.out);
    assert.deepEqual(result.lines.slice(0, 2), [
      'Give --inputs the inputs.json that qory wrote for the run.',
      `  inputs.json has no member qory.${member}, which qory writes, so the start of the run is ` +
        'unknown.',
    ]);
  }
  assert.equal(pushes(w), before);
  assert.equal(stored(w).number, 0);
});

// ledgerIndex writes the index.json of the store with the versions of build-ledger, each
// { number } with cancelled or withdrawn set to true when given.
function ledgerIndex(w, versions) {
  fs.writeFileSync(path.join(w.store, 'index.json'), JSON.stringify({ version: 1, artifacts: [{
    type: 'build-ledger', name: 'main', approved_version: null,
    newest_version: Math.max(...versions.map((one) => one.number)),
    versions: versions.map((one) => ({ id: `av_bl${one.number}`, writer: { kind: 'run',
      run_id: `run-${one.number}` }, ...one })),
  }] }));
}

// rowsOf returns a ledger of the first count rows of fullLedger.
const rowsOf = (w, count) => ({ steps: fullLedger(w).steps.slice(0, count), escalations: [] });

test('ledger: resume skips a version of a cancelled run', () => {
  const w = work();
  store(w, rowsOf(w, 2));
  store(w, rowsOf(w, 3));
  ledgerIndex(w, [{ number: 1 }, { number: 2, cancelled: true }]);
  const call = session(w);
  assert.equal(call('resume').lines.at(-1),
    'Read version 1 of the ledger: 2 rows, 2 done, 0 escalations.');
  const copy = JSON.parse(fs.readFileSync(path.join(call.artifacts, '.reports',
    'build-ledger.json'), 'utf8'));
  assert.equal(copy.steps.length, 2);
  // The next row follows version 1, as the push check compares it.
  const begun = begin(call, w, 'deliverable:d-1');
  assert.equal(begun.status, 0, begun.out);
  assert.deepEqual(stored(w).ledger.steps.map((row) => row.id),
    ['fix:f1', 'fix:f2', 'deliverable:d-1']);
});

test('ledger: resume of a withdrawn ledger takes the version before the withdrawal', () => {
  const w = work();
  store(w, rowsOf(w, 2));
  store(w, rowsOf(w, 3));
  // Version 2 is of a cancelled run, and version 3 is a withdrawal, with no files.
  ledgerIndex(w, [{ number: 1 }, { number: 2, cancelled: true }, { number: 3, withdrawn: true }]);
  const call = session(w);
  assert.equal(call('resume').lines.at(-1),
    'Read version 1 of the ledger: 2 rows, 2 done, 0 escalations.');
  // Without the cancelled version, the version before the withdrawal is version 2.
  const plain = work();
  store(plain, rowsOf(plain, 2));
  store(plain, rowsOf(plain, 3));
  ledgerIndex(plain, [{ number: 1 }, { number: 2 }, { number: 3, withdrawn: true }]);
  assert.equal(session(plain)('resume').lines.at(-1),
    'Read version 2 of the ledger: 3 rows, 3 done, 0 escalations.');
});

test('ledger: a withdrawn ledger whose earlier version was not pulled names its pull', () => {
  const w = work();
  store(w, rowsOf(w, 2));
  store(w, rowsOf(w, 3));
  ledgerIndex(w, [{ number: 1 }, { number: 2 }, { number: 3, withdrawn: true }]);
  // A plain pull skips version 2, the version before the withdrawal.
  fs.rmSync(path.join(w.store, 'build-ledger', 'main', 'v2'), { recursive: true });
  const result = session(w)('resume');
  assert.equal(result.status, 3, result.out);
  assert.deepEqual(result.lines.slice(0, 2), [
    'Run `qory artifact pull build-ledger --version 2`, then check again.',
    '  The store lacks build-ledger version 2, the version before the withdrawal.',
  ]);
});

test('ledger: a stale v<N> folder does not decide where resume starts', () => {
  const w = work();
  store(w, rowsOf(w, 2));
  store(w, rowsOf(w, 3));
  // A folder v3 that index.json does not list, as an earlier pull can leave it.
  const stale = path.join(w.store, 'build-ledger', 'main', 'v3');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'build-ledger.json'), JSON.stringify(rowsOf(w, 4)));
  const call = session(w);
  assert.equal(call('resume').lines.at(-1),
    'Read version 2 of the ledger: 3 rows, 3 done, 0 escalations.');
  const copy = JSON.parse(fs.readFileSync(path.join(call.artifacts, '.reports',
    'build-ledger.json'), 'utf8'));
  assert.equal(copy.steps.length, 3);
  // Without the copy, step begin reads the same version, with v3 left in the artifact folder,
  // and its push passes the push check, which compares it with version 2, with v3 left in the
  // store.
  assert.ok(fs.existsSync(path.join(call.artifacts, 'build-ledger', 'main', 'v3')));
  fs.rmSync(path.join(call.artifacts, '.reports', 'build-ledger.json'));
  const begun = begin(call, w, 'fix:f1');
  assert.equal(begun.status, 0, begun.out);
  assert.match(begun.lines.at(-1), /^Replay fix:f1 from pass 1/);
  assert.ok(fs.existsSync(path.join(stale, 'build-ledger.json')));
  const pushed = stored(w);
  assert.equal(pushed.number, 4);
  assert.equal(pushed.ledger.steps.length, 3);
});

test('ledger: both locks exist during every push and pull of qory', () => {
  const w = work();
  const lines = () => fs.readFileSync(path.join(w.bin, 'locks'), 'utf8').split('\n')
    .filter(Boolean);
  const first = resumed(w);
  // step begin and step end each push once.
  deliver(first, w, 'deliverable:d-1');
  assert.equal(begin(first, w, 'deliverable:d-2').status, 0);
  // resume of the next session pulls, and pushes once, with the running row marked failed.
  assert.equal(session(w)('resume').status, 0);
  const both = 'build-ledger.json.lock ledger.json.lock ';
  assert.deepEqual(lines(), ['pull', 'push', 'push', 'push', 'pull', 'push']
    .map((action) => `${action}:${both}`));
  const reports = path.join(first.artifacts, '.reports');
  assert.deepEqual(fs.readdirSync(reports).filter((one) => one.includes('.lock')), []);
});

test('ledger: a call that waits for the lock too long exits 3 with nothing pushed', () => {
  for (const [verb, name] of [['step begin', 'build-ledger.json'], ['step end', 'ledger.json'],
    ['resume', 'build-ledger.json']]) {
    const w = work();
    const call = resumed(w);
    const other = session(w, { artifacts: call.artifacts, run: call.run, lockWait: 50 });
    const before = pushes(w);
    if (verb === 'step end') assert.equal(begin(call, w, 'plan').status, 0);
    const started = pushes(w);
    // A lock that a running process holds, as another call does during its push.
    const lock = path.join(call.artifacts, '.reports', `${name}.lock`);
    fs.writeFileSync(lock, String(process.pid));
    const argv = { 'step begin': ['step', 'begin', 'plan', 'implement-changes', ...w.inputs],
      'step end': ['step', 'end', 'plan', 'failed'], resume: ['resume'] }[verb];
    const result = other(...argv);
    assert.equal(result.status, 3, result.out);
    assert.deepEqual(result.lines, [
      `Run ${verb} again after the other call finishes: another call held the ledger lock ` +
        'for 0.05 s.',
      `  .reports/${name}.lock still exists after 0.05 s of tries.`,
    ]);
    assert.ok([...result.lines[0]].length <= 100, result.lines[0]);
    assert.equal(pushes(w), started, verb);
    assert.ok(started >= before);
    // The lock of the other call stays, and the next call passes once it is gone.
    assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
    fs.rmSync(lock);
    assert.equal(other(...argv).status, 0, verb);
  }
});

// parallel runs each argv of list as checks.cjs in a separate process, all at once, in the
// session of call, and returns { argv, status, out } of each.
async function parallel(w, call, list) {
  const { spawn } = require('node:child_process');
  const env = { ...w.env, ARTIFACTS: call.artifacts, QORY_RUN_ID: call.run };
  delete env.QORY_SESSION;
  const start = Date.now() + 1000;
  const code = (argv) => `const { main } = require(${JSON.stringify(SCRIPT)});
let out = '';
let err = '';
const sink = { write: (text) => { out += text; } };
while (Date.now() < ${start});
const status = main(${JSON.stringify(argv)}, {
  cwd: ${JSON.stringify(w.repo)}, artifacts: [${JSON.stringify(call.artifacts)}],
  env: ${JSON.stringify(env)}, plugin: ${JSON.stringify(path.join(MODULES, 'core'))},
  qory: ${JSON.stringify(w.qory)}, out: sink,
  err: { write: (text) => { out += text; err += text; } }, firstLine: ${CHILD},
});
process.stdout.write(JSON.stringify({ status, out, err }));`;
  const runs = await Promise.all(list.map((argv) => new Promise((resolve) => {
    const proc = spawn(process.execPath, ['-e', code(argv)],
      { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    let out = '';
    let lines = '';
    proc.stdout.on('data', (data) => { out += data; });
    proc.stderr.on('data', (data) => { out += data; });
    proc.stdio[3].on('data', (data) => { lines += data; });
    proc.on('close', () => resolve({ argv, lines, ...JSON.parse(out) }));
  })));
  return runs.map(({ argv, status, out, err, lines }) => {
    const first = watch();
    first.read(lines);
    first.check(status, err);
    return { argv, status, out };
  });
}

test('ledger: each step call in parallel that passes is in the newest stored version', async () => {
  const w = work();
  const first = resumed(w);
  const done = Array.from({ length: 4 }, (_, n) => `deliverable:d-${n + 1}`);
  for (const id of done) deliver(first, w, id);
  // In the next session, four calls each replay one done row, and one call adds a row. A
  // replay after the new row exits 1, because that row runs.
  const call = resumed(w);
  const ids = [...done, 'deliverable:d-5'];
  const runs = await parallel(w, call, ids.map((id) =>
    ['step', 'begin', id, 'implement-changes', ...w.inputs]));
  const passed = runs.filter((run) => run.status === 0);
  assert.ok(passed.length >= 1, JSON.stringify(runs));
  for (const run of runs.filter((one) => one.status !== 0)) {
    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /^End the step deliverable:d-5, row \d+, with step end/, run.out);
  }
  const newest = stored(w).ledger;
  const reports = path.join(call.artifacts, '.reports');
  const copy = fs.readFileSync(path.join(reports, 'build-ledger.json'), 'utf8');
  const mark = JSON.parse(fs.readFileSync(path.join(reports, 'ledger.json'), 'utf8'));
  assert.equal(copy, JSON.stringify(newest));
  for (const run of passed) {
    const id = run.argv[2];
    const row = newest.steps.find((one) => one.id === id);
    if (id === 'deliverable:d-5') {
      assert.equal(row.state, 'running', id);
      assert.ok(mark.rows.includes(`${id}\n1`), id);
    } else {
      assert.equal(row.replays, 1, id);
      assert.ok(mark.replayed.includes(`${id}\n1`), id);
    }
  }
  // Each replay that exited 1 left its row unchanged.
  for (const run of runs.filter((one) => one.status !== 0)) {
    assert.equal(newest.steps.find((one) => one.id === run.argv[2]).replays, 0);
  }
  assert.deepEqual(fs.readdirSync(reports).filter((one) => one.includes('.lock')), []);
});

test('ledger: an input that cannot be read exits 3', () => {
  const w = work();
  const call = resumed(w);
  const missing = begin(call, w, 'plan', [path.join(tmp, 'no-such-input')]);
  assert.equal(missing.status, 3);
  assert.equal(missing.lines[0], 'Name input files that exist and can be read.');
  assert.match(missing.lines[1], /^ {2}".*" cannot be read\./);
  // Not a checkout of git.
  const bare = session({ ...w, repo: fresh('plain') }, { cwd: fresh('plain') });
  const none = bare('resume');
  assert.equal(none.status, 3, none.out);
  assert.deepEqual(none.lines.slice(0, 2), ['Run step and resume in the checkout of the work.',
    '  git rev-parse HEAD failed in the working folder.']);
  // A failed pull.
  fs.writeFileSync(path.join(w.bin, 'fail-pull'), '');
  const pull = session(w)('resume');
  assert.equal(pull.status, 3);
  assert.deepEqual(pull.lines.slice(0, 2), ['Push nothing, and end the session with these lines.',
    '  qory artifact pull build-ledger exited with 1: The pull failed.']);
  fs.rmSync(path.join(w.bin, 'fail-pull'));
  // A copy of the draft that breaks the schema.
  fs.mkdirSync(path.join(call.artifacts, '.reports'), { recursive: true });
  fs.writeFileSync(path.join(call.artifacts, '.reports', 'build-ledger.json'),
    '{"steps":[],"escalations":[],"x":1}');
  const broken = begin(call, w, 'plan');
  assert.equal(broken.status, 3, broken.out);
  assert.equal(broken.lines[0], 'Run checks.cjs resume, then the verb again.');
  assert.match(broken.lines[1], /^ {2}\.reports\/build-ledger\.json of the artifact folder breaks its schema: Remove the member "x"/);
});

test('ledger: the verbs read the copy of the draft under .reports, not the draft', () => {
  const w = work();
  const call = resumed(w);
  deliver(call, w, 'deliverable:d-1');
  const copy = path.join(call.artifacts, '.reports', 'build-ledger.json');
  const draft = path.join(call.artifacts, 'build-ledger.json');
  assert.equal(fs.readFileSync(copy, 'utf8'), JSON.stringify(stored(w).ledger));
  assert.equal(fs.readFileSync(draft, 'utf8'), fs.readFileSync(copy, 'utf8'));
  // An agent marks a running row done in the draft at the top of the artifact folder: the
  // verbs read the copy, so the row still runs, and step end needs it.
  assert.equal(begin(call, w, 'deliverable:d-2').status, 0);
  const edited = JSON.parse(fs.readFileSync(draft, 'utf8'));
  Object.assign(edited.steps[1], { state: 'done', commit: headOf(w), ended_at: T });
  fs.writeFileSync(draft, JSON.stringify(edited));
  const blocked = begin(call, w, 'deliverable:d-3');
  assert.equal(blocked.status, 1, blocked.out);
  assert.deepEqual(blocked.lines, ['End the step deliverable:d-2, row 2, with step end, or ' +
    'run checks.cjs resume after a crash.']);
  commit(w, 'd-2.txt', 'The change of d-2.\n');
  assert.equal(call('step', 'end', 'deliverable:d-2', 'done').status, 0);
  assert.equal(fs.readFileSync(draft, 'utf8'), fs.readFileSync(copy, 'utf8'));
  // resume with no version removes both.
  const empty = resumed(work());
  assert.equal(fs.existsSync(path.join(empty.artifacts, 'build-ledger.json')), false);
  assert.equal(fs.existsSync(path.join(empty.artifacts, '.reports', 'build-ledger.json')), false);
});

test('ledger: without the rules of a skill, step and resume exit 3', () => {
  const w = work();
  const plugin = path.join(fresh('core'), 'plugin');
  fs.mkdirSync(path.join(plugin, 'skills'), { recursive: true });
  fs.symlinkSync(path.dirname(SCRIPT), path.join(plugin, 'skills', 'running-a-workflow'));
  const result = session(w, { plugin })('resume');
  assert.equal(result.status, 3, result.out);
  assert.deepEqual(result.lines.slice(0, 2), ['Add the module of the workflow to the stack.',
    '  No skill adds the rules of the ledger, so step and resume cannot run.']);
});

test('ledger: a crash of step or resume exits 4 with the fix first on stderr', () => {
  const w = work();
  const artifacts = fresh('artifacts');
  let err = '';
  const first = watch();
  const status = main(['resume'], {
    cwd: w.repo, artifacts: [artifacts], env: { ...w.env, ARTIFACTS: artifacts, QORY_RUN_ID: 'run-x' },
    plugin: path.join(MODULES, 'core'), qory: w.qory,
    out: { write: () => { throw new Error('boom'); } },
    err: { write: (text) => { err += text; } },
    firstLine: first.firstLine,
  });
  first.check(status, err);
  assert.equal(status, 4);
  assert.match(err, /^Send this error to the harness maintainers\.\n  checks\.cjs resume crashed, so the ledger may lack its last change\.\nError: boom\n/);
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
  // A failed step with a long id that left a commit and a file with a long name.
  commit(w, 'failed.txt', 'A commit of a failed step.\n');
  assert.equal(call('step', 'end', other, 'failed').status, 0);
  const stash = begin(call, w, other).lines;
  assert.match(stash[0], /^Run git stash push --include-untracked /);
  lines.push(...stash);
  fs.rmSync(path.join(w.repo, `${'c'.repeat(150)}.txt`));
  const reset = begin(call, w, other).lines;
  assert.match(reset[0], /^Run git reset --keep [0-9a-f]{12}, then step begin again\.$/);
  lines.push(...reset);
  // A file with a long name changed after a done step.
  git(w, 'reset', '-q', '--keep', 'HEAD~1');
  assert.equal(begin(call, w, other).status, 0);
  commit(w, 'other.txt', 'The change of the step.\n');
  assert.equal(call('step', 'end', other, 'done').status, 0);
  fs.writeFileSync(path.join(w.repo, `${'d'.repeat(150)}.txt`), 'An edit outside a step.\n');
  const outside = begin(call, w, `fix:${'d'.repeat(40)}`).lines;
  assert.equal(outside[0], 'End the session, and keep the checkout as it is.');
  assert.match(outside[1], /^ {2}1 file changed /);
  lines.push(...outside);
  for (const line of lines) assert.ok([...line].length <= 196, `${[...line].length}: ${line}`);
  // The first line of each finding, the fix, stays within 100 characters.
  for (const line of lines.filter((one) => !one.startsWith('  '))) {
    assert.ok([...line].length <= 100, `${[...line].length}: ${line}`);
  }
  assert.ok(lines.length >= 5, lines.join('\n'));
});
