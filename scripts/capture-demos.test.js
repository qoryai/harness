// Tests of the workflow capture-demos: the size of a film and its second encode (verbs/film.cjs:
// film and film recode), the frames of a film, the list of scenarios to film, the record of the
// demo evidence, the check of the build ledger when a demo script is pushed, and the newest
// demo script that a check reads. The tests run no browser: a runner that returns frames
// stands in for it, and an ffmpeg that writes files of a size stands in for ffmpeg. The tests
// of the frames of a film skip with no ffmpeg and ffprobe.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// A run of Build sets QORY_RUN_ID, which changes where the verbs read the build plan from.
// Only the tests of a run set it.
delete process.env.QORY_RUN_ID;

const MODULES = path.join(__dirname, '../modules');
const PLUGIN = path.join(MODULES, 'core');
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const { main } = require(path.join(PLUGIN, 'skills/running-a-workflow/checks.cjs'));
const filmVerb = require(path.join(SKILL, 'verbs/film.cjs'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'capture-demos-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let folders = 0;
const next = (name) => path.join(tmp, `${name}-${++folders}`);

// call runs the checks script with argv, and returns { status, out, err }.
function call(argv, deps = {}) {
  let out = '';
  let err = '';
  const status = main(argv, {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: PLUGIN, cwd: tmp, ...deps,
  });
  return { status, out, err };
}

// pinnedPlan returns a folder with version 1 of a build plan that has the lines of summary and
// the serve command.
function pinnedPlan(summary, command) {
  const dir = next('plan');
  const plan = path.join(dir, 'build-plan', 'main', 'v1');
  fs.mkdirSync(plan, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ artifacts: [{
    type: 'build-plan', name: 'main', approved_version: null, newest_version: 1,
    versions: [{ id: 'av_bp1', number: 1 }] }] }));
  fs.writeFileSync(path.join(plan, 'build-plan.md'), ['## Summary', '', 'One deliverable.',
    '', ...summary, '', '## Deliverables', '', '| Id | Change | Criteria | Files | Check |',
    '|---|---|---|---|---|', '| d-1 | Add the date. | ac-1 | `src/a.js` | scenario-1 |', '',
    '## Commands', '', '| Kind | Command | Result file | Source |', '|---|---|---|---|',
    '| targeted | `node --test` | `out/junit.xml` | repository: `package.json` |',
    `| serve | \`${command}\` | none | repository: \`package.json\` |`, ''].join('\n'));
  return dir;
}

// A demo script of scenario id with the evidence, and one step.
const script = (id, evidence = 'film') => ({
  scenario: id, title: 'Two parcels, one date', evidence, source: { version: 1 },
  setup: [{ do: 'open', url: '/sign-in' }],
  steps: [{ step: 1, title: `Step 1 of ${id}.`, expected: 'Seen.',
    actions: [{ do: 'open', url: '/orders' }] }],
});

// artifact returns the entry of index.json for the versions of a type and name.
const artifact = (type, name, numbers) => ({ type, name, approved_version: null,
  newest_version: Math.max(...numbers),
  versions: numbers.map((number) => ({ id: `av_${type}_${name}_${number}`, number })) });

// checkout returns a new git folder with an artifact folder in .qory/artifacts, where the
// pushed demo scripts of scripts are version 1 of each, and the call dependencies for a build
// plan with a serve row.
function checkout(scripts) {
  const dir = next('run');
  const root = path.join(dir, '.qory', 'artifacts');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(childProcess.spawnSync('git', ['-C', dir, 'init', '-q']).status, 0);
  for (const one of scripts) {
    const folder = path.join(root, 'demo-script', one.scenario, 'v1');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${one.scenario}.json`), JSON.stringify(one));
  }
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ artifacts: scripts
    .map((one) => artifact('demo-script', one.scenario, [1])) }));
  const plan = pinnedPlan(['App address: `http://127.0.0.1:4010/`'], 'node app/server.cjs');
  return { dir, root, plan, deps: { cwd: dir, artifacts: [root], env: { ...process.env },
    preflight: { browsers: [process.execPath] } } };
}

// A runner that starts no browser: it writes two frames to the folder of the capture, and
// returns a film of 1.04 s with one step.
const FAKE_RUNNER = path.join(tmp, 'film-runner.cjs');
fs.writeFileSync(FAKE_RUNNER, `const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
const dir = spec.runs[0].capture.dir;
const files = ['f000001.jpg', 'f000002.jpg'];
for (const file of files) fs.writeFileSync(dir + '/' + file, 'x');
const capture = { kind: 'film', frames: files.map((file, at) => ({ file, at: at * 40 })),
  starts: [0], end: 1040 };
const run = { ok: true, step: null, why: null, outside: null, capture };
const result = { app: { started: true, ran: true, why: null }, signIns: [], runs: [run],
  unfinished: null };
fs.writeFileSync(spec.resultFile, JSON.stringify(result) + '\\n', { flag: 'wx' });
`);

// sized returns an ffmpeg that writes a film of the bytes of its n-th call, the last size for
// each call after the list, and adds the arguments of each call as a line to the file log. The
// counter is a file, because the verb gives ffmpeg a PATH and nothing else.
function sized(...bytes) {
  const file = next('ffmpeg');
  const log = `${file}.log`;
  fs.writeFileSync(file, `#!/bin/sh
n=$(wc -l < '${log}' 2>/dev/null || echo 0)
printf '%s\\n' "$*" >> '${log}'
for last; do :; done
sizes='${bytes.join(' ')}'
set -- $sizes
n=$((n + 1))
size=$(eval "echo \\\${$n}")
[ -n "$size" ] || size=$(eval "echo \\\${$#}")
head -c "$size" /dev/zero > "$last"
`, { mode: 0o755 });
  return { file, calls: () => (fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}

// filming returns a checkout with one film scenario and the dependencies that film it with
// the runner above, the ffmpeg and the limit of one version in bytes.
function filming(ffmpeg, limit) {
  const here = checkout([script('scenario-1')]);
  here.deps.preflight = { ...here.deps.preflight, runner: FAKE_RUNNER, ffmpegs: [ffmpeg.file],
    filmLimit: limit };
  return { ...here, film: path.join(here.root, '.film', 'scenario-1') };
}

const MIB = 1048576;

test('film: the cap is 300 kbit/s for 535 s, 274 for 586 s and 1,500 for 10 s', () => {
  assert.equal(filmVerb.rateCap(535), 300);
  assert.equal(filmVerb.rateCap(586), 274);
  assert.equal(filmVerb.rateCap(10), 1500);
  // Pass 2 has half the cap, at 960 x 540 px and the CRF 32.
  assert.deepEqual(filmVerb.passesOf(535), [{ crf: 28, kbit: 300, scale: '1280:720' },
    { crf: 32, kbit: 150, scale: '960:540' }]);
  // A film at the cap of its length keeps the files within 80 % of what one version holds:
  // the bytes of 535 s at 300 kbit/s, as qory counts them, are under 32 MiB.
  assert.ok(filmVerb.encodedSize([300 * 1000 / 8 * 535]) < 32 * MIB);
  assert.equal(filmVerb.encodedSize([0]), 16384);
  assert.equal(filmVerb.encodedSize([1, 3, 4]), 16384 + 4 + 4 + 8);
});

test('film: pass 1 has the CRF 28 and the cap, pass 2 the CRF 32, half the cap and 960 x 540 px', () => {
  const [one, two] = filmVerb.passesOf(535);
  const first = filmVerb.ffmpegArguments('scenario-1', '1.000', one).join(' ');
  assert.match(first, /-crf 28 -maxrate 300k -bufsize 600k /);
  assert.match(first, /scale=1280:720,format=yuv420p/);
  const second = filmVerb.ffmpegArguments('scenario-1', '1.000', two).join(' ');
  assert.match(second, /-crf 32 -maxrate 150k -bufsize 300k /);
  assert.match(second, /scale=960:540,format=yuv420p/);
});

test('film: a film over the limit exits 4 and keeps the frames, and film recode makes it fit and removes them', () => {
  const ffmpeg = sized(2 * MIB, 100);
  const here = filming(ffmpeg, MIB);
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 4, done.out + done.err);
  const lines = done.out.trim().split('\n');
  assert.equal(lines[0], 'Run film recode scenario-1.');
  assert.match(lines[1], /^ {2}The film of scenario-1 is 2\.7 MiB encoded, and the limit of one version is 1\.0 MiB\.$/);
  assert.equal(lines.at(-1), 'Kept the frames of scenario-1: its film is over the size limit.');
  assert.deepEqual(fs.readdirSync(here.film).sort(),
    ['capture.json', 'f000001.jpg', 'f000002.jpg', 'scenario-1.vtt']);
  assert.equal(ffmpeg.calls().length, 1);
  assert.match(ffmpeg.calls()[0], /-crf 28 -maxrate 1500k -bufsize 3000k /);
  const again = call(['film', 'recode', 'scenario-1'], here.deps);
  assert.equal(again.status, 0, again.out + again.err);
  assert.match(again.out.trim(), /^Filmed scenario-1 again at 960 x 540 px, 0\.0 MiB encoded, in \.film\/scenario-1\/scenario-1\.mp4, with the captions scenario-1\.vtt\.$/);
  assert.deepEqual(fs.readdirSync(here.film).sort(), ['scenario-1.mp4', 'scenario-1.vtt']);
  assert.equal(ffmpeg.calls().length, 2);
  assert.match(ffmpeg.calls()[1], /-crf 32 -maxrate 750k -bufsize 1500k /);
  assert.match(ffmpeg.calls()[1], /scale=960:540,/);
});

test('film: a film that fits after pass 1 keeps no frame and needs no recode', () => {
  const ffmpeg = sized(100);
  const here = filming(ffmpeg, MIB);
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 0, done.out + done.err);
  assert.deepEqual(fs.readdirSync(here.film).sort(), ['scenario-1.mp4', 'scenario-1.vtt']);
  assert.equal(ffmpeg.calls().length, 1);
});

test('film --film: a scenario with the evidence pictures is filmed, and the flag is for one scenario only', () => {
  const ffmpeg = sized(100);
  const here = checkout([script('scenario-1', 'pictures')]);
  here.deps.preflight = { ...here.deps.preflight, runner: FAKE_RUNNER, ffmpegs: [ffmpeg.file],
    filmLimit: MIB };
  const done = call(['film', 'scenario-1', '--film', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 0, done.out + done.err);
  assert.deepEqual(fs.readdirSync(path.join(here.root, '.film', 'scenario-1')).sort(),
    ['scenario-1.mp4', 'scenario-1.vtt']);
  assert.equal(call(['film', 'pages', '/a', '--film'], here.deps).status, 2);
  assert.equal(call(['film', 'todo', '--film'], here.deps).status, 2);
});

test('film: a film that is over the limit after both passes exits 1, with the size and the limit, and removes the folder', () => {
  const ffmpeg = sized(2 * MIB, 2 * MIB);
  const here = filming(ffmpeg, MIB);
  assert.equal(call(['film', 'scenario-1', '--artifacts', here.plan], here.deps).status, 4);
  const done = call(['film', 'recode', 'scenario-1'], here.deps);
  assert.equal(done.status, 1, done.out + done.err);
  const lines = done.out.trim().split('\n');
  assert.equal(lines[0], 'Shorten the waits of scenario-1 or split it in Shape.');
  assert.equal(lines[1], '  The film of scenario-1 is 2.7 MiB encoded after pass 2, and the ' +
    'limit of one version is 1.0 MiB.');
  assert.equal(lines.at(-1), 'Stored no film: it is over the size limit.');
  assert.equal(fs.existsSync(here.film), false);
  assert.equal(ffmpeg.calls().length, 2);
});

// sleepy returns an ffmpeg that runs for 5 s, and the file of its log of calls.
function sleepy() {
  const file = next('ffmpeg');
  fs.writeFileSync(file, '#!/bin/sh\nexec sleep 5\n', { mode: 0o755 });
  return file;
}

test('film recode: with no kept frames it exits 3, and a pass 2 that runs out of time is a cause outside', () => {
  const ffmpeg = sized(2 * MIB, 100);
  const here = filming(ffmpeg, MIB);
  const none = call(['film', 'recode', 'scenario-1'], here.deps);
  assert.equal(none.status, 3, none.out + none.err);
  assert.equal(none.out.split('\n')[0], 'Run film scenario-1, then run film recode ' +
    'scenario-1 again.');
  assert.doesNotMatch(none.out, /Kind:/);
  assert.equal(call(['film', 'scenario-1', '--artifacts', here.plan], here.deps).status, 4);
  const slow = { ...here.deps, preflight: { ...here.deps.preflight, ffmpegs: [sleepy()],
    ffmpegMs: 300 } };
  const late = call(['film', 'recode', 'scenario-1'], slow);
  assert.equal(late.status, 3, late.out + late.err);
  assert.deepEqual(late.out.trim().split('\n').slice(0, 3), [
    'Give the dev container more CPU, then run film recode scenario-1 again.',
    '  ffmpeg did not finish pass 2 of the film of scenario-1 within 0 s, after pass 1 did not ' +
      'fit or did not finish.',
    '  Kind: outside']);
  // With no ffmpeg at all, the cause is outside too. The frames stay in both cases, so the call
  // can run again, with an ffmpeg that finishes.
  assert.ok(fs.existsSync(path.join(here.film, 'f000001.jpg')));
  const absent = call(['film', 'recode', 'scenario-1'], { ...here.deps, preflight: {
    ...here.deps.preflight, ffmpegs: [path.join(tmp, 'none')] } });
  assert.equal(absent.status, 3, absent.out + absent.err);
  assert.match(absent.out, /^ {2}Kind: outside$/m);
  assert.equal(call(['film', 'recode', 'scenario-1'], here.deps).status, 0);
});

test('film: a pass 1 that runs out of time keeps the frames and exits 4, and film recode is its retry', () => {
  const ffmpeg = sized(100);
  const here = filming(ffmpeg, MIB);
  const slow = { ...here.deps, preflight: { ...here.deps.preflight, ffmpegs: [sleepy()],
    ffmpegMs: 300 } };
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], slow);
  assert.equal(done.status, 4, done.out + done.err);
  const lines = done.out.trim().split('\n');
  assert.equal(lines[0], 'Run film recode scenario-1.');
  assert.match(lines[1], /^ {2}ffmpeg did not finish pass 1 of the film of scenario-1 within \d+ s\.$/);
  assert.equal(lines.at(-1), 'Kept the frames of scenario-1: pass 1 ran out of time.');
  assert.deepEqual(fs.readdirSync(here.film).sort(),
    ['capture.json', 'f000001.jpg', 'f000002.jpg', 'scenario-1.vtt']);
  const again = call(['film', 'recode', 'scenario-1'], here.deps);
  assert.equal(again.status, 0, again.out + again.err);
  assert.deepEqual(fs.readdirSync(here.film).sort(), ['scenario-1.mp4', 'scenario-1.vtt']);
});

test('film recode: a capture file with a frame that is no object or a link is refused, and nothing is encoded', () => {
  const ffmpeg = sized(2 * MIB, 100);
  const here = filming(ffmpeg, MIB);
  assert.equal(call(['film', 'scenario-1', '--artifacts', here.plan], here.deps).status, 4);
  const kept = path.join(here.film, 'capture.json');
  fs.writeFileSync(kept, JSON.stringify({ end: 1040, frames: [null] }));
  const bad = call(['film', 'recode', 'scenario-1'], here.deps);
  assert.equal(bad.status, 3, bad.out + bad.err);
  fs.writeFileSync(kept, JSON.stringify({ end: 1040, frames: [{ file: '../x.jpg', at: 0 }] }));
  const outside = call(['film', 'recode', 'scenario-1'], here.deps);
  assert.equal(outside.status, 3, outside.out + outside.err);
  assert.equal(outside.out.split('\n')[0], 'End the run: the runner stored a frame that cannot ' +
    'be read.');
  assert.equal(ffmpeg.calls().length, 1);
});

// ---- a run that fails, and the kind of each cause --------------------------------------------

// runnerOf returns a runner that returns the result of one run, with the members of run, and the
// frames or the pictures that it wrote before it stopped: film is { frames, starts, end } and
// pictures a list of file names. app is the result of the start of the app.
function runnerOf(run, { film, pictures, app } = {}) {
  const file = `${next('runner')}.cjs`;
  fs.writeFileSync(file, `const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
const dir = spec.runs[0] && spec.runs[0].capture ? spec.runs[0].capture.dir : null;
const run = ${JSON.stringify(run)};
const film = ${JSON.stringify(film || null)};
const pictures = ${JSON.stringify(pictures || null)};
if (dir && film) {
  const frames = [];
  for (let n = 1; n <= film.frames; n += 1) {
    const name = 'f' + String(n).padStart(6, '0') + '.jpg';
    fs.writeFileSync(dir + '/' + name, 'x');
    frames.push({ file: name, at: (n - 1) * 40 });
  }
  run.capture = { kind: 'film', frames, starts: film.starts, end: film.end };
}
if (dir && pictures) {
  for (const name of pictures) fs.writeFileSync(dir + '/' + name, 'x');
  run.capture = { kind: 'pictures', files: pictures };
}
const result = { app: ${JSON.stringify(app || { started: true, ran: true, why: null })},
  signIns: [], runs: [run], unfinished: null };
fs.writeFileSync(spec.resultFile, JSON.stringify(result) + '\\n', { flag: 'wx' });
`);
  return file;
}

// failing returns a checkout with the script of scenario-1 of the kind and the steps of one(),
// and a film that runs the runner of run, and an ffmpeg that writes a film of 100 bytes.
function failing(one, run, options) {
  const ffmpeg = sized(100);
  const here = checkout([one]);
  here.deps.preflight = { ...here.deps.preflight, runner: runnerOf(run, options),
    ffmpegs: [ffmpeg.file] };
  return { ...here, film: path.join(here.root, '.film', 'scenario-1') };
}

const STEP_FAILED = { ok: false, step: 1, why: 'action 1 (click text=Order 1042) failed: no ' +
  'element', outside: null };

test('film: a run that fails in a step keeps its film up to that step for demo-reviewer, and exits 5', () => {
  const here = failing(two('scenario-1'), STEP_FAILED, { film: { frames: 2, starts: [0],
    end: 1040 } });
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 5, done.out + done.err);
  assert.deepEqual(done.out.trim().split('\n'), [
    'Start demo-reviewer on step 1 of scenario-1, then record it.',
    '  action 1 (click text=Order 1042) failed: no element.',
    'Filmed scenario-1 up to step 1: it failed in step 1.']);
  // The film and its captions of the begun step stay, with failed.json, which has the step.
  assert.deepEqual(fs.readdirSync(here.film).sort(),
    ['failed.json', 'scenario-1.mp4', 'scenario-1.vtt']);
  const cues = filmVerb.cuesOf(fs.readFileSync(path.join(here.film, 'scenario-1.vtt'), 'utf8'));
  assert.equal(cues.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(here.film, 'failed.json'), 'utf8')),
    { step: 1, why: STEP_FAILED.why });
  // The report of demo-reviewer sorts the failure, and the evidence has no media.
  committed(here.dir);
  let reports = 0;
  const review = (...lines) => {
    const file = path.join(here.dir, `review-${++reports}.md`);
    fs.writeFileSync(file, `${lines.join('\n')}\nchanges-needed\n`);
    return file;
  };
  const report = review('Step 1: failed: The page has no order.', 'Step 2: not-reached',
    'Class: product');
  const withMedia = call(['film', 'record', 'scenario-1', '--review', report, '--media', '1'],
    here.deps);
  assert.equal(withMedia.status, 1, withMedia.out);
  assert.equal(withMedia.out.split('\n')[0], 'Leave out --media.');
  const passed = call(['film', 'record', 'scenario-1', '--review',
    review('Step 1: passed', 'Step 2: passed')], here.deps);
  assert.equal(passed.status, 1, passed.out);
  assert.equal(passed.out.split('\n')[0],
    'Report step 1 as failed and each later step as not-reached.');
  const recorded = call(['film', 'record', 'scenario-1', '--review', report], here.deps);
  assert.equal(recorded.status, 0, recorded.out + recorded.err);
  const data = JSON.parse(fs.readFileSync(path.join(here.root, 'scenario-1.json'), 'utf8'));
  assert.deepEqual([data.evidence, data.verdict, data.class, data.media],
    ['none', 'failed', 'product', undefined]);
  assert.deepEqual(data.steps.map((step) => [step.verdict, step.frames.length]),
    [['failed', 0], ['not-reached', 0]]);
  assert.equal(call(['check', 'demo-evidence', path.join(here.root, 'scenario-1.json')],
    here.deps).status, 0);
});

test('film: a run of pictures that fails in a step keeps the pictures before it, and one that fails in step 1 keeps none', () => {
  const second = { ...STEP_FAILED, step: 2 };
  const here = failing(two('scenario-1', 'pictures'), second, {
    pictures: ['scenario-1-step-1.png'] });
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 5, done.out + done.err);
  assert.equal(done.out.trim().split('\n').at(-1),
    'Took 1 picture of scenario-1 before step 2: it failed in step 2.');
  assert.deepEqual(fs.readdirSync(here.film).sort(), ['failed.json', 'scenario-1-step-1.png']);
  const first = failing(two('scenario-1', 'pictures'), STEP_FAILED);
  const none = call(['film', 'scenario-1', '--artifacts', first.plan], first.deps);
  assert.equal(none.status, 1, none.out + none.err);
  assert.equal(none.out.trim().split('\n').at(-1), 'Stored no pictures: it failed in step 1.');
  assert.equal(fs.existsSync(first.film), false);
});

test('film: a step that fails before the runner stored a frame stores nothing and exits 1', () => {
  const here = failing(two('scenario-1'), { ...STEP_FAILED, step: 2 });
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 1, done.out + done.err);
  assert.equal(done.out.trim().split('\n').at(-1), 'Stored no film: it failed in step 2.');
  assert.equal(fs.existsSync(here.film), false);
});

test('film: a sign-in that fails is of kind setup, and a variable with no value is of kind outside', () => {
  const signIn = failing(script('scenario-1'), { ok: false, step: 0, why: 'action 2 (type ' +
    'into #password) failed: the sign-in did not finish', outside: null });
  const failed = call(['film', 'scenario-1', '--artifacts', signIn.plan], signIn.deps);
  assert.equal(failed.status, 1, failed.out + failed.err);
  assert.deepEqual(failed.out.trim().split('\n'), [
    'Check the sign-in against the app, then run film scenario-1 again.',
    '  action 2 (type into #password) failed: the sign-in did not finish.',
    '  Kind: setup', 'Stored no film: it failed in the sign-in.']);
  // A name of 31 characters stays whole, and the first line, the fix, stays within 100. A
  // longer one, up to the 64 characters that the schema allows, is cut to 28 and ...: the
  // line of 100 characters. The line "the variable <name> has no value" keeps the whole name.
  const long = `SHOP_${'X'.repeat(17)}_PASSWORD`;
  const longer = `SHOP_${'X'.repeat(18)}_PASSWORD`;
  const longest = `SHOP_${'X'.repeat(50)}_PASSWORD`;
  assert.deepEqual([long.length, longer.length, longest.length], [31, 32, 64]);
  for (const [step, name] of [[0, 'SHOP_PASSWORD'], [1, 'SHOP_PASSWORD'], [0, long],
    [0, longer], [0, longest]]) {
    const missing = failing(script('scenario-1'), { ok: false, step, why: 'action 2 (type into ' +
      `#password) failed: the variable ${name} has no value`, outside: null,
    variable: name }, { film: { frames: 2, starts: [0], end: 1040 } });
    const out = call(['film', 'scenario-1', '--artifacts', missing.plan], missing.deps);
    assert.equal(out.status, 1, out.out + out.err);
    const lines = out.out.trim().split('\n');
    const shown = name.length > 31 ? `${name.slice(0, 28)}...` : name;
    assert.equal(lines[0], `Add AGENT_${shown} in Workspace settings > Secrets and variables > ` +
      'Variables.');
    assert.equal(lines[1], '  Then run film scenario-1 again.');
    assert.equal(lines[2], `  action 2 (type into #password) failed: the variable ${name} has ` +
      'no value.');
    assert.equal(lines[0].length, 69 + shown.length);
    assert.ok(lines[0].length <= 100, lines[0]);
    assert.equal(lines.at(-2), '  Kind: outside');
    assert.equal(fs.existsSync(missing.film), false);
  }
});

test('film: the fix with the whole name of 64 characters passes the check of points', () => {
  // The session takes the name from the line "the variable <name> has no value", since the
  // first line of film cuts a name of more than 31 characters to 28 and ..., and "... in"
  // ends a sentence for the check.
  const name = `SHOP_${'X'.repeat(50)}_PASSWORD`;
  const here = checkout([script('scenario-1')]);
  const file = path.join(here.root, 'points.json');
  const check = (shown) => {
    fs.writeFileSync(file, JSON.stringify([{ action: 'run_again',
      text: 'The run could not film the order scenario, because the workspace lacks a ' +
        'sign-in variable.',
      fix: `Add AGENT_${shown} in Workspace settings > Secrets and variables > Variables, ` +
        'then run another round.' }]));
    return call(['check', 'points', file], here.deps);
  };
  const whole = check(name);
  assert.equal(whole.status, 0, whole.out + whole.err);
  const cut = check(`${name.slice(0, 28)}...`);
  assert.equal(cut.status, 1);
  assert.equal(cut.out.split('\n')[1], '  The text has 2 sentences.');
});

// keyRunner returns a runner that writes the file started when it starts, for the tests of a
// script that types a key, where no runner starts.
function keyRunner(started) {
  const file = `${next('runner')}.cjs`;
  fs.writeFileSync(file, `require('fs').writeFileSync(${JSON.stringify(started)}, 'x');\n`);
  return file;
}

test('film and demo run: a step that types a credential exits 3 before the app', () => {
  const one = script('scenario-1');
  one.steps[0].actions = [{ do: 'type', target: '#token', variable: 'GITHUB_TOKEN' }];
  const here = checkout([one]);
  const started = path.join(here.dir, 'started.txt');
  const deps = { ...here.deps, env: { ...here.deps.env, GITHUB_TOKEN: 'ghp_fake-value-0001' },
    preflight: { ...here.deps.preflight, runner: keyRunner(started) } };
  const cause = '  A demo script types GITHUB_TOKEN, which is a secret of this run.';
  const film = call(['film', 'scenario-1', '--artifacts', here.plan], deps);
  assert.equal(film.status, 3, film.out + film.err);
  assert.equal(film.out, 'Remove the key from the demo scripts, then run film scenario-1 ' +
    `again.\n${cause}\nChecked nothing: the film could not read its input.\n`);
  assert.equal(fs.existsSync(path.join(here.root, '.film', 'scenario-1')), false);
  // demo run of the draft of the same script.
  fs.mkdirSync(path.join(here.root, '.demo'), { recursive: true });
  fs.writeFileSync(path.join(here.root, '.demo', 'scenario-1.json'), JSON.stringify(one));
  const draft = call(['demo', 'run', 'scenario-1', '--artifacts', here.plan], deps);
  assert.equal(draft.status, 3, draft.out + draft.err);
  assert.equal(draft.out, 'Remove the key from .demo/scenario-1.actions.json, then run demo ' +
    `write scenario-1.\n${cause}\nChecked nothing: the demo could not read its input.\n`);
  assert.equal(fs.existsSync(started), false);
  for (const text of [film.out, film.err, draft.out, draft.err]) {
    assert.equal(text.includes('ghp_fake'), false, text);
  }
});

test('film pages: a setup that types a credential exits 3 before the app', () => {
  const one = script('scenario-1');
  one.setup = [{ do: 'open', url: '/sign-in' },
    { do: 'type', target: '#token', variable: 'GITHUB_TOKEN' }];
  const here = checkout([one]);
  const started = path.join(here.dir, 'started.txt');
  const deps = { ...here.deps, env: { ...here.deps.env, GITHUB_TOKEN: 'ghp_fake-value-0001' },
    preflight: { ...here.deps.preflight, runner: keyRunner(started) } };
  const done = call(['film', 'pages', '/orders', '--artifacts', here.plan], deps);
  assert.equal(done.status, 3, done.out + done.err);
  assert.equal(done.out, 'Remove the key from the demo scripts, then run film pages again.\n' +
    '  A demo script types GITHUB_TOKEN, which is a secret of this run.\n' +
    'Checked nothing: the film could not read its input.\n');
  assert.equal(fs.existsSync(started), false);
  assert.equal(fs.existsSync(path.join(here.root, '.film', 'pages')), false);
  assert.equal((done.out + done.err).includes('ghp_fake'), false);
});

test('film: a title with --> is a fault of the script at its step, with no film', () => {
  const arrow = script('scenario-1');
  arrow.steps[0].title = 'Open --> the order.';
  const here = failing(arrow, STEP_FAILED);
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 1, done.out + done.err);
  const lines = done.out.trim().split('\n');
  assert.equal(lines[0], 'Change the Action of step 1 in the demo scenario so it has no "-->", ' +
    'then film it again.');
  assert.equal(lines.at(-1), 'Stored no film: it failed in step 1.');
  assert.equal(fs.existsSync(here.film), false);
});

test('film: each cause that the session sorts ends with a Kind line, and a failure of the call has none', () => {
  const kind = (done) => (/^ {2}Kind: (\w+)$/m.exec(done.out) || [])[1];
  const ok = { ok: true, step: null, why: null, outside: null };
  // No ffmpeg and no browser, in the dev container: outside.
  const absent = failing(script('scenario-1'), ok);
  const noFfmpeg = call(['film', 'scenario-1', '--artifacts', absent.plan], { ...absent.deps,
    preflight: { ...absent.deps.preflight, ffmpegs: [path.join(tmp, 'none')] } });
  assert.deepEqual([noFfmpeg.status, kind(noFfmpeg)], [3, 'outside']);
  assert.equal(noFfmpeg.out.split('\n')[0], 'Add ffmpeg to the dev container, then run film again.');
  const noBrowser = call(['film', 'scenario-1', '--artifacts', absent.plan], { ...absent.deps,
    preflight: { ...absent.deps.preflight, browsers: [path.join(tmp, 'none')] } });
  assert.deepEqual([noBrowser.status, kind(noBrowser)], [3, 'outside']);
  // A browser that fails in the run is outside, and an app that does not start is a setup.
  const broken = failing(script('scenario-1'), { ok: false, step: 0, browser: true,
    why: 'the browser failed: it did not start' });
  const browser = call(['film', 'scenario-1', '--artifacts', broken.plan], broken.deps);
  assert.deepEqual([browser.status, kind(browser)], [3, 'outside']);
  assert.equal(browser.out.split('\n')[0],
    'Fix the browser of the dev container, then run film scenario-1 again.');
  const down = failing(script('scenario-1'), ok, { app: { started: false, ran: true,
    why: 'the command exited with 1 before the address of the app returned a response' } });
  const app = call(['film', 'scenario-1', '--artifacts', down.plan], down.deps);
  assert.deepEqual([app.status, kind(app)], [3, 'setup']);
  // The 120 s that ran out before the browser started are a setup too.
  const late = failing(script('scenario-1'), { ok: false, step: 0, late: true,
    why: 'the time for the start ran out' });
  const slow = call(['film', 'scenario-1', '--artifacts', late.plan], late.deps);
  assert.deepEqual([slow.status, kind(slow)], [3, 'setup']);
  // A missing demo script is no cause of either kind: the session ends as Failures lists.
  const missing = call(['film', 'scenario-2', '--artifacts', absent.plan], absent.deps);
  assert.deepEqual([missing.status, kind(missing)], [3, undefined]);
});

test('film: an ffmpeg that runs out of time on a failed run keeps the frames, and is a cause outside', () => {
  const here = failing(two('scenario-1'), STEP_FAILED, { film: { frames: 2, starts: [0],
    end: 1040 } });
  const slow = { ...here.deps, preflight: { ...here.deps.preflight, ffmpegs: [sleepy()],
    ffmpegMs: 300 } };
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], slow);
  assert.equal(done.status, 3, done.out + done.err);
  const lines = done.out.trim().split('\n');
  assert.equal(lines[0], 'Give the dev container more CPU, then run film scenario-1 again.');
  assert.match(lines[1], /^ {2}ffmpeg did not finish the film of scenario-1 up to step 1 within/);
  assert.equal(lines.at(-2), '  Kind: outside');
  // The frames, the captions and failed.json stay, so that the film can run again.
  assert.deepEqual(fs.readdirSync(here.film).sort(),
    ['capture.json', 'f000001.jpg', 'f000002.jpg', 'failed.json', 'scenario-1.vtt']);
});

test('film: a capture that the runner could not write is a cause outside, with no frame kept', () => {
  const here = failing(two('scenario-1'), { ...STEP_FAILED, step: 2,
    lost: 'ENOSPC: no space left' });
  const done = call(['film', 'scenario-1', '--artifacts', here.plan], here.deps);
  assert.equal(done.status, 3, done.out + done.err);
  const lines = done.out.trim().split('\n');
  assert.equal(lines[0], 'Give the dev container more disk space, then run film scenario-1 ' +
    'again.');
  assert.match(lines[1], /before step 2: ENOSPC: no space left\.$/);
  assert.equal(lines.at(-2), '  Kind: outside');
  assert.equal(fs.existsSync(here.film), false);
});

test('capture: a write that failed for the disk is a cause outside, any other error is not', () => {
  const { diskFault } = require(path.join(SKILL, 'lib/capture.cjs'));
  for (const code of ['ENOSPC', 'EIO', 'EDQUOT', 'EROFS', 'EFBIG']) {
    // A message of Node starts with its code, which the text keeps once.
    assert.equal(diskFault(Object.assign(new Error(`${code}: no space left on device, write`),
      { code })), `${code}: no space left on device, write`);
    assert.equal(diskFault(Object.assign(new Error('write failed'), { code })),
      `${code}: write failed`);
  }
  assert.equal(diskFault(Object.assign(new Error('x'), { code: 'EEXIST' })), null);
  assert.equal(diskFault(new Error('Target closed')), null);
  assert.equal(diskFault(null), null);
});

test('film frames: a film with no ffmpeg on the machine is a cause outside', () => {
  const here = filmed();
  const done = call(['film', 'frames', 'scenario-1'], { ...here.deps, preflight: {
    ...here.deps.preflight, ffmpegs: [path.join(tmp, 'none')] } });
  assert.equal(done.status, 3, done.out + done.err);
  assert.equal(done.out.split('\n')[0],
    'Add ffmpeg to the dev container, then run film frames again.');
  assert.match(done.out, /^ {2}Kind: outside$/m);
});

// ---- the kind of a failed sign-in, in preflight and film -------------------------------------

// signInScript returns a demo script of id whose setup types the variable name.
const signInScript = (id, name) => ({ ...script(id), setup: [{ do: 'open', url: '/sign-in' },
  { do: 'type', target: '#password', variable: name }] });

// signInRunner returns a runner for preflight that starts no browser: the sign-ins of the
// setups return the results, in the order of the setups.
function signInRunner(results, app = { started: true, ran: true, why: null }) {
  const file = `${next('runner')}.cjs`;
  fs.writeFileSync(file, `const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
const result = { app: ${JSON.stringify(app)}, signIns: ${JSON.stringify(results)}, runs: [],
  unfinished: null };
fs.writeFileSync(spec.resultFile, JSON.stringify(result) + '\\n', { flag: 'wx' });
`);
  return file;
}

test('preflight: a sign-in that fails with every variable set is setup, and one with a missing variable is outside', () => {
  const lacking = { ok: false, why: 'action 2 (type into #password) failed: the variable ' +
    'SHOP_PASSWORD has no value', variable: 'SHOP_PASSWORD' };
  const wrong = { ok: false, why: 'the page still showed a field that a variable was typed ' +
    'into 3 s after the last action' };
  const kinds = (results) => {
    const here = checkout([signInScript('scenario-1', 'SHOP_PASSWORD'),
      signInScript('scenario-2', 'OTHER_PASSWORD')]);
    here.deps.env = { ...process.env, SHOP_PASSWORD: 'a', OTHER_PASSWORD: 'b' };
    here.deps.preflight = { ...here.deps.preflight, runner: signInRunner(results) };
    const done = call(['preflight', '--artifacts', here.plan], here.deps);
    assert.equal(done.status, 1, done.out + done.err);
    pointFixes = JSON.parse(fs.readFileSync(path.join(here.root, 'points.json'), 'utf8'))
      .map((one) => one.fix);
    return done.out.split('\n').filter((line) => /^ {2}Kind: /.test(line))
      .map((line) => line.trim());
  };
  let pointFixes = [];
  // The point of a setup fault asks for a change to the app, and the point of a variable that
  // the workspace lacks asks for the variable.
  assert.deepEqual(kinds([wrong, wrong]), ['Kind: setup']);
  assert.deepEqual(pointFixes, ['Make the sign-in of the app work with the variables set, ' +
    'then run another round.']);
  assert.deepEqual(kinds([lacking, lacking]), ['Kind: outside']);
  assert.match(pointFixes[0], /^Ask an owner or admin .* sign-in variable with the prefix AGENT_/);
  // One call with both kinds has one finding and one point for each kind, and the session
  // keeps the outside one.
  assert.deepEqual(kinds([lacking, wrong]).sort(), ['Kind: outside', 'Kind: setup']);
  assert.equal(new Set(pointFixes).size, 2);
});

test('preflight: the points of two failed calls are all removed by a call that passes', () => {
  const here = checkout([script('scenario-1')]);
  const { plan } = here;
  const file = path.join(here.root, 'points.json');
  const noBrowser = { ...here.deps, preflight: { browsers: [path.join(tmp, 'none')] } };
  const noApp = { ...here.deps, preflight: { ...here.deps.preflight, runner: signInRunner([],
    { started: false, ran: true, why: 'the command exited with 1' }) } };
  assert.equal(call(['preflight', '--artifacts', plan], noBrowser).status, 1);
  const first = JSON.parse(fs.readFileSync(file, 'utf8')).map((one) => one.text);
  const second = call(['preflight', '--artifacts', plan], noApp);
  assert.equal(second.status, 1, second.out + second.err);
  const both = JSON.parse(fs.readFileSync(file, 'utf8')).map((one) => one.text);
  assert.equal(both.length, 2);
  assert.ok(first.every((text) => both.includes(text)));
  const passing = { ...here.deps, preflight: { ...here.deps.preflight, runner: PREFLIGHT_RUNNER } };
  assert.equal(call(['preflight', '--artifacts', plan], passing).status, 0);
  assert.equal(fs.existsSync(file), false);
});

// ---- the build plan of a run -----------------------------------------------------------------

test('film, preflight and demo run in a run read the build plan of qory.start_artifacts only', () => {
  const ffmpeg = sized(100);
  const here = checkout([script('scenario-1')]);
  here.deps.env = { ...process.env, QORY_RUN_ID: 'run-1' };
  here.deps.preflight = { ...here.deps.preflight, runner: FAKE_RUNNER, ffmpegs: [ffmpeg.file],
    filmLimit: MIB };
  fs.mkdirSync(path.join(here.root, '.demo'));
  fs.writeFileSync(path.join(here.root, '.demo', 'scenario-1.json'),
    JSON.stringify(script('scenario-1')));
  const verbs = [['film', 'scenario-1'], ['preflight'], ['demo', 'run', 'scenario-1']];
  // With no --inputs, even with --artifacts, no verb reads a plan.
  for (const verb of verbs) {
    const done = call([...verb, '--artifacts', here.plan], here.deps);
    assert.equal(done.status, 3, `${verb[0]}: ${done.out}${done.err}`);
    assert.equal(done.out.split('\n')[0], 'Give --inputs, the input file of the run, to read ' +
      'the build plan that the run started with.', verb[0]);
  }
  // An empty qory.start_artifacts is no plan: the artifact folder of the session counts for none.
  fs.cpSync(path.join(here.plan, 'build-plan'), path.join(here.root, 'build-plan'),
    { recursive: true });
  const empty = inputsOf(here, '');
  for (const verb of verbs) {
    const done = call([...verb, '--inputs', empty], here.deps);
    assert.equal(done.status, 3, `${verb[0]}: ${done.out}${done.err}`);
    assert.match(done.out, /^ {2}Cause: the build plan is missing\.$/m, verb[0]);
  }
  // A --artifacts other than the start folder is refused.
  const inputs = inputsOf(here, here.plan);
  const other = next('plan');
  fs.mkdirSync(other);
  for (const verb of verbs) {
    const done = call([...verb, '--inputs', inputs, '--artifacts', other], here.deps);
    assert.equal(done.status, 3, `${verb[0]}: ${done.out}${done.err}`);
    assert.equal(done.out.split('\n')[0], 'Leave out --artifacts, or give it the folder of ' +
      'qory.start_artifacts in inputs.json.', verb[0]);
  }
  // The start folder, alone or as --artifacts, is read.
  assert.equal(call(['film', 'scenario-1', '--inputs', inputs, '--artifacts', here.plan],
    here.deps).status, 0);
  assert.equal(call(['film', 'scenario-1', '--inputs', inputs], here.deps).status, 0);
});

// ---- failed setup evidence for each scenario that has none -----------------------------------

test('film todo and film record: a failed setup records each scenario of To film, and a rerun films them again', () => {
  const here = checkout([]);
  const head = committed(here.dir);
  const entries = [
    stored(here.root, 'demo-scenarios', 'main', { 'demo-scenarios.md': SCENARIO_TEXT }, true),
    ...['scenario-1', 'scenario-2'].map((id) => stored(here.root, 'demo-script', id,
      { [`${id}.json`]: JSON.stringify(script(id)) })),
  ];
  fs.writeFileSync(path.join(here.root, 'index.json'), JSON.stringify({ artifacts: entries }));
  const listed = () => call(['film', 'todo'], here.deps).out.split('\n')[0];
  assert.equal(listed(), 'To film: scenario-1, scenario-2.');
  // A failed preflight records the class setup for each scenario of the list, as the session
  // does with film record and the check of the push.
  for (const id of ['scenario-1', 'scenario-2']) {
    const done = call(['film', 'record', id, '--class', 'setup', '--cause',
      'The app did not start.', '--step', '1'], here.deps);
    assert.equal(done.status, 0, done.out + done.err);
    const file = path.join(here.root, `${id}.json`);
    assert.equal(call(['check', 'demo-evidence', file], here.deps).status, 0);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual([data.commit, data.verdict, data.class, data.steps[0].finding],
      [head, 'failed', 'setup', 'The app did not start.']);
    // The push puts it in the store as a new version of the evidence.
    entries.push(stored(here.root, 'demo-evidence', id, { [`${id}.json`]: JSON.stringify(data) }));
  }
  fs.writeFileSync(path.join(here.root, 'index.json'), JSON.stringify({ artifacts: entries }));
  // The evidence is of the commit, and the class setup lists each scenario again.
  assert.equal(listed(), 'To film: scenario-1, scenario-2.');
});

test('film: with neither --inputs nor --artifacts it reads no build plan and exits 3', () => {
  const here = failing(script('scenario-1'), { ok: true, step: null, why: null, outside: null });
  for (const argv of [['film', 'scenario-1'], ['film', 'pages', '/orders']]) {
    const done = call(argv, here.deps);
    assert.equal(done.status, 3, done.out + done.err);
    assert.equal(done.out.split('\n')[0], 'Give --inputs, the input file of the run, to read ' +
      'the build plan that the run started with.');
  }
});

test('preflight: a retry that passes removes the points that the failed one wrote, and keeps others', () => {
  const here = checkout([script('scenario-1')]);
  const plan = pinnedPlan(['App address: `http://127.0.0.1:4010/`'], 'none');
  const missing = { ...here.deps, preflight: { browsers: [path.join(tmp, 'none')] } };
  const failed = call(['preflight', '--artifacts', plan], missing);
  assert.equal(failed.status, 1, failed.out + failed.err);
  const file = path.join(here.root, 'points.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  list.push({ text: 'Another step wrote this point.', action: 'run_again', fix: 'Run it again.' });
  fs.writeFileSync(file, JSON.stringify(list));
  const passed = call(['preflight', '--artifacts', plan], here.deps);
  assert.equal(passed.status, 0, passed.out + passed.err);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).map((one) => one.text),
    ['Another step wrote this point.']);
  // With no other point, the file goes.
  const again = call(['preflight', '--artifacts', plan], missing);
  assert.equal(again.status, 1);
  fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).slice(-1)));
  assert.equal(call(['preflight', '--artifacts', plan], here.deps).status, 0);
  assert.equal(fs.existsSync(file), false);
});

// ---- film frames and film todo ---------------------------------------------------------------

const FFMPEG = childProcess.spawnSync('ffmpeg', ['-version']).status === 0 ? 'ffmpeg' : null;
const FFPROBE = childProcess.spawnSync('ffprobe', ['-version']).status === 0 ? 'ffprobe' : null;
const NO_FFMPEG = FFMPEG && FFPROBE ? false : 'no ffmpeg and ffprobe, so no film';

// ffmpegPath returns the path of the ffmpeg of the PATH, as a list that findBrowser reads.
const ffmpegPath = () => childProcess.spawnSync('sh', ['-c', 'command -v ffmpeg'],
  { encoding: 'utf8' }).stdout.trim();

test('film frames: two pictures for each step, at the start of the step and a frame before its end', { skip: NO_FFMPEG }, () => {
  const here = checkout([script('scenario-1')]);
  const dir = path.join(here.root, '.film', 'scenario-1');
  fs.mkdirSync(dir, { recursive: true });
  // A film of 4 s that changes in each frame, with the cues of two steps of 2 s.
  assert.equal(childProcess.spawnSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=320x180:rate=25', '-t', '4', '-pix_fmt', 'yuv420p',
    path.join(dir, 'scenario-1.mp4')]).status, 0);
  fs.writeFileSync(path.join(dir, 'scenario-1.vtt'), filmVerb.captions(
    { steps: [{ title: 'Open.' }, { title: 'Read.' }] }, { starts: [0, 2000], end: 4000 }));
  assert.deepEqual(filmVerb.pictureTimes(filmVerb.cuesOf(fs.readFileSync(
    path.join(dir, 'scenario-1.vtt'), 'utf8'))), [{ start: 0, reached: 1960 },
    { start: 2000, reached: 3960 }]);
  const deps = { ...here.deps, preflight: { ffmpegs: [ffmpegPath()] } };
  const done = call(['film', 'frames', 'scenario-1'], deps);
  assert.equal(done.status, 0, done.out + done.err);
  assert.deepEqual(done.out.trim().split('\n'), [
    'Step 1: step-1-start.png at 0 ms, step-1-reached.png at 1960 ms.',
    'Step 2: step-2-start.png at 2000 ms, step-2-reached.png at 3960 ms.',
    'Took 4 pictures of scenario-1 in .film/scenario-1/frames/, two for each step.']);
  const names = fs.readdirSync(path.join(dir, 'frames')).sort();
  assert.deepEqual(names, ['step-1-reached.png', 'step-1-start.png', 'step-2-reached.png',
    'step-2-start.png']);
  const sums = new Set(names.map((name) => fs.readFileSync(path.join(dir, 'frames', name))
    .toString('base64')));
  assert.equal(sums.size, 4);
  for (const name of names) {
    assert.equal(fs.readFileSync(path.join(dir, 'frames', name)).subarray(1, 4).toString(),
      'PNG');
  }
});

test('film frames: the first line says which step the run failed in', { skip: NO_FFMPEG }, () => {
  const here = checkout([two('scenario-1')]);
  const dir = path.join(here.root, '.film', 'scenario-1');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(childProcess.spawnSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=320x180:rate=25', '-t', '2', '-pix_fmt', 'yuv420p',
    path.join(dir, 'scenario-1.mp4')]).status, 0);
  fs.writeFileSync(path.join(dir, 'scenario-1.vtt'), filmVerb.captions(
    { steps: [{ title: 'Open.' }, { title: 'Read.' }] }, { starts: [0], end: 2000 }));
  fs.writeFileSync(path.join(dir, 'failed.json'),
    JSON.stringify({ step: 1, why: 'action 1 (click text=Order) failed: no element' }));
  const done = call(['film', 'frames', 'scenario-1'], { ...here.deps,
    preflight: { ffmpegs: [ffmpegPath()] } });
  assert.equal(done.status, 0, done.out + done.err);
  assert.deepEqual(done.out.trim().split('\n'), [
    'The run failed in step 1: "action 1 (click text=Order) failed: no element".',
    'Step 1: step-1-start.png at 0 ms, step-1-reached.png at 1960 ms.',
    'Took 2 pictures of scenario-1 in .film/scenario-1/frames/, two for each step.']);
});

test('film frames: a scenario with no film exits 3 with the fix first', () => {
  const here = checkout([script('scenario-1')]);
  const done = call(['film', 'frames', 'scenario-1'], here.deps);
  assert.equal(done.status, 3, done.out + done.err);
  assert.equal(done.out.split('\n')[0], 'Run film scenario-1, then run film frames scenario-1 ' +
    'again.');
});

const SCENARIO_TEXT = `## Summary

Three scenarios.

### scenario-1: Open the order

Starting state: the list is open.

| Step | Action | What the viewer sees | Screen |
|---|---|---|---|
| 1 | Open the order. | The order shows. | \`order\` |

Shows: ac-1

Evidence: film

### scenario-2: Read the date

Starting state: the list is open.

| Step | Action | What the viewer sees | Screen |
|---|---|---|---|
| 1 | Read the date. | The date shows. | \`order\` |

Shows: ac-2

Evidence: film

### scenario-4: Read the old date

Removed, because the date left the product.
`;

// stored writes the files of a version of type and name under root, as a pull does, and
// returns its entry of index.json. approved sets approved_version.
function stored(root, type, name, files, approved = false) {
  const dir = path.join(root, type, name, 'v1');
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
  return { ...artifact(type, name, [1]), approved_version: approved ? `av_${type}_${name}_1` : null };
}

// evidence returns the demo evidence of id for commit, with the version of the script.
const evidence = (id, commit, version = 1) => ({ scenario: id, title: 'Two parcels, one date',
  commit, planned: 'film', evidence: 'film', verdict: 'passed',
  script: { type: 'demo-script', name: id, version }, media: { type: 'demo-video', name: id,
    version: 1 }, steps: [{ step: 1, title: `Step 1 of ${id}.`, expected: 'Seen.',
    verdict: 'passed', frames: [] }] });

// committed makes one commit in dir, and returns its id.
function committed(dir) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@example.com',
    GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@example.com' };
  assert.equal(childProcess.spawnSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m',
    'x'], { env }).status, 0);
  return childProcess.spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' }).stdout.trim();
}

test('film todo: a rerun lists the scenario with no evidence for the commit, and the artifacts of removed scenarios', () => {
  const here = checkout([]);
  const head = committed(here.dir);
  const other = '0'.repeat(40);
  const entries = [
    stored(here.root, 'demo-scenarios', 'main', { 'demo-scenarios.md': SCENARIO_TEXT }, true),
    stored(here.root, 'demo-script', 'scenario-1', { 'scenario-1.json': JSON.stringify(script('scenario-1')) }),
    stored(here.root, 'demo-script', 'scenario-2', { 'scenario-2.json': JSON.stringify(script('scenario-2')) }),
    stored(here.root, 'demo-evidence', 'scenario-1', { 'scenario-1.json': JSON.stringify(evidence('scenario-1', head)) }),
    stored(here.root, 'demo-evidence', 'scenario-2', { 'scenario-2.json': JSON.stringify(evidence('scenario-2', other)) }),
    stored(here.root, 'demo-evidence', 'scenario-3', { 'scenario-3.json': '{}' }),
    stored(here.root, 'demo-video', 'scenario-3', { 'scenario-3.vtt': 'WEBVTT\n' }),
    stored(here.root, 'screenshot', 'scenario-4', { 'scenario-4-step-1.png': 'x' }),
  ];
  const write = () => fs.writeFileSync(path.join(here.root, 'index.json'),
    JSON.stringify({ artifacts: entries }));
  write();
  const done = call(['film', 'todo'], here.deps);
  assert.equal(done.status, 0, done.out + done.err);
  assert.deepEqual(done.out.trim().split('\n'), ['To film: scenario-2.',
    'To withdraw: demo-evidence scenario-3, demo-video scenario-3, screenshot scenario-4.']);
  // The evidence of scenario-1 is for another version of its script: it is filmed again.
  fs.writeFileSync(path.join(here.root, 'demo-evidence', 'scenario-1', 'v1', 'scenario-1.json'),
    JSON.stringify(evidence('scenario-1', head, 2)));
  assert.equal(call(['film', 'todo'], here.deps).out.split('\n')[0],
    'To film: scenario-1, scenario-2.');
  // Withdrawn artifacts and filmed scenarios leave both lists empty.
  fs.writeFileSync(path.join(here.root, 'demo-evidence', 'scenario-1', 'v1', 'scenario-1.json'),
    JSON.stringify(evidence('scenario-1', head)));
  fs.writeFileSync(path.join(here.root, 'demo-evidence', 'scenario-2', 'v1', 'scenario-2.json'),
    JSON.stringify(evidence('scenario-2', head)));
  for (const one of entries.filter((entry) => ['scenario-3', 'scenario-4'].includes(entry.name))) {
    one.versions.push({ id: `${one.versions[0].id}-w`, number: 2, withdrawn: true });
    one.newest_version = 2;
  }
  write();
  assert.deepEqual(call(['film', 'todo'], here.deps).out.trim().split('\n'),
    ['To film: none.', 'To withdraw: none.']);
});

test('film todo: a scenario that failed in the setup on this commit is filmed again, and a product or script fault stands', () => {
  const here = checkout([]);
  const head = committed(here.dir);
  const failed = (id, klass) => ({ ...evidence(id, head), verdict: 'failed', class: klass });
  const entries = [
    stored(here.root, 'demo-scenarios', 'main', { 'demo-scenarios.md': SCENARIO_TEXT }, true),
    stored(here.root, 'demo-script', 'scenario-1', { 'scenario-1.json': JSON.stringify(script('scenario-1')) }),
    stored(here.root, 'demo-script', 'scenario-2', { 'scenario-2.json': JSON.stringify(script('scenario-2')) }),
    stored(here.root, 'demo-evidence', 'scenario-1', { 'scenario-1.json': JSON.stringify(failed('scenario-1', 'setup')) }),
    stored(here.root, 'demo-evidence', 'scenario-2', { 'scenario-2.json': JSON.stringify(failed('scenario-2', 'product')) }),
  ];
  fs.writeFileSync(path.join(here.root, 'index.json'), JSON.stringify({ artifacts: entries }));
  assert.equal(call(['film', 'todo'], here.deps).out.split('\n')[0], 'To film: scenario-1.');
  fs.writeFileSync(path.join(here.root, 'demo-evidence', 'scenario-2', 'v1', 'scenario-2.json'),
    JSON.stringify(failed('scenario-2', 'script')));
  assert.equal(call(['film', 'todo'], here.deps).out.split('\n')[0], 'To film: scenario-1.');
});

// ---- film record -----------------------------------------------------------------------------

// two returns a demo script of id with two steps.
function two(id, evidence = 'film') {
  const one = script(id, evidence);
  one.steps.push({ step: 2, title: `Step 2 of ${id}.`, expected: 'Seen too.',
    actions: [{ do: 'click', target: 'text=Order 1042' }] });
  return one;
}

// filmed returns a checkout with the script of scenario-1 on one commit, and the folder .film
// that a call of film leaves, with a film of two steps, 2 s each.
function filmed(evidenceKind = 'film') {
  const here = checkout([two('scenario-1', evidenceKind)]);
  const head = committed(here.dir);
  const dir = path.join(here.root, '.film', 'scenario-1');
  fs.mkdirSync(dir, { recursive: true });
  if (evidenceKind === 'film') {
    fs.writeFileSync(path.join(dir, 'scenario-1.mp4'), 'x');
    fs.writeFileSync(path.join(dir, 'scenario-1.vtt'), filmVerb.captions(
      { steps: [{ title: 'Step 1 of scenario-1.' }, { title: 'Step 2 of scenario-1.' }] },
      { starts: [0, 2000], end: 4000 }));
  } else {
    fs.writeFileSync(path.join(dir, 'scenario-1-step-1.png'), 'x');
    fs.writeFileSync(path.join(dir, 'scenario-1-step-2.png'), 'x');
  }
  const review = (...lines) => {
    const file = path.join(here.dir, 'review.md');
    fs.writeFileSync(file, `${lines.join('\n')}\nchanges-needed\n`);
    return file;
  };
  const written = () => JSON.parse(fs.readFileSync(path.join(here.root, 'scenario-1.json'),
    'utf8'));
  // The push check of demo-evidence reads the file that film record wrote.
  const pushed = () => call(['check', 'demo-evidence', path.join(here.root, 'scenario-1.json')],
    here.deps);
  return { ...here, head, review, written, pushed };
}

test('film record: a film whose steps passed is a passed evidence with two frames per step', () => {
  const here = filmed();
  const done = call(['film', 'record', 'scenario-1', '--review',
    here.review('Step 1: passed', 'Step 2: passed'), '--media', '3'], here.deps);
  assert.equal(done.status, 0, done.out + done.err);
  assert.equal(done.out.trim(), 'Wrote scenario-1.json, the demo evidence of scenario-1: ' +
    'passed, evidence film.');
  const data = here.written();
  assert.equal(data.commit, here.head);
  assert.deepEqual([data.planned, data.evidence, data.verdict, data.class],
    ['film', 'film', 'passed', undefined]);
  assert.deepEqual(data.script, { type: 'demo-script', name: 'scenario-1', version: 1 });
  assert.deepEqual(data.media, { type: 'demo-video', name: 'scenario-1', version: 3 });
  assert.deepEqual(data.steps.map((step) => step.frames), [
    [{ at: 'start', time_ms: 0 }, { at: 'reached', time_ms: 1960 }],
    [{ at: 'start', time_ms: 2000 }, { at: 'reached', time_ms: 3960 }]]);
  assert.equal(here.pushed().status, 0, here.pushed().out);
});

test('film record: a review of a film that did not fail needs --media', () => {
  const here = filmed();
  const done = call(['film', 'record', 'scenario-1', '--review',
    here.review('Step 1: passed', 'Step 2: passed')], here.deps);
  assert.equal(done.status, 1, done.out + done.err);
  assert.equal(done.out.split('\n')[0], 'Give --media the version of the film or pictures ' +
    'that the session pushed.');
});

test('film record: a failed step needs its finding and a class, and the evidence keeps both', () => {
  const here = filmed();
  const lines = ['Step 1: passed', 'Step 2: failed: The page shows no date.'];
  const noClass = call(['film', 'record', 'scenario-1', '--review', here.review(...lines),
    '--media', '1'], here.deps);
  assert.equal(noClass.status, 1, noClass.out);
  assert.equal(noClass.out.split('\n')[0],
    'Give each failed step a finding and the report a class line.');
  const done = call(['film', 'record', 'scenario-1', '--review',
    here.review(...lines, 'Class: product'), '--media', '1'], here.deps);
  assert.equal(done.status, 0, done.out);
  const data = here.written();
  assert.deepEqual([data.verdict, data.class, data.steps[1].verdict, data.steps[1].finding],
    ['failed', 'product', 'failed', 'The page shows no date.']);
  assert.equal(here.pushed().status, 0, here.pushed().out);
  const short = call(['film', 'record', 'scenario-1', '--review', here.review('Step 1: passed'),
    '--media', '1'], here.deps);
  assert.equal(short.status, 1);
  assert.match(short.out, /The script has 2 steps, and the report has 1 such line\./);
});

test('film record: a scenario with no film is a failed evidence of class script, with the cause in the last step', () => {
  const here = filmed();
  const cause = 'The film of scenario-1 is 31.0 MiB encoded after pass 2.';
  const done = call(['film', 'record', 'scenario-1', '--class', 'script', '--cause', cause],
    here.deps);
  assert.equal(done.status, 0, done.out + done.err);
  const data = here.written();
  assert.deepEqual([data.evidence, data.verdict, data.class, data.media],
    ['none', 'failed', 'script', undefined]);
  assert.deepEqual(data.steps.map((step) => step.verdict), ['passed', 'failed']);
  assert.equal(data.steps[1].finding, cause);
  assert.deepEqual(data.steps.map((step) => step.frames), [[], []]);
  assert.equal(here.pushed().status, 0, here.pushed().out);
  const first = call(['film', 'record', 'scenario-1', '--class', 'setup', '--cause', 'No page.',
    '--step', '1'], here.deps);
  assert.equal(first.status, 0, first.out);
  assert.deepEqual(here.written().steps.map((step) => step.verdict), ['failed', 'not-reached']);
});

test('film record: pictures have one frame per step, and a wrong form exits 2', () => {
  const here = filmed('pictures');
  const done = call(['film', 'record', 'scenario-1', '--review',
    here.review('Step 1: passed', 'Step 2: passed'), '--media', '2'], here.deps);
  assert.equal(done.status, 0, done.out + done.err);
  const data = here.written();
  assert.deepEqual([data.evidence, data.media.type], ['pictures', 'screenshot']);
  assert.deepEqual(data.steps[1].frames, [{ at: 'reached', file: 'scenario-1-step-2.png' }]);
  for (const argv of [['film', 'record', 'scenario-1'], ['film', 'record', 'scenario-1',
    '--class', 'script'], ['film', 'record', 'scenario-1', '--class', 'wrong', '--cause', 'x'],
  ['film', 'record', 'scenario-1', '--review', 'a', '--media', '0']]) {
    assert.equal(call(argv, here.deps).status, 2, argv.join(' '));
  }
});

// ---- the build ledger at the push of a demo script -------------------------------------------

const crypto = require('node:crypto');

const SCENARIOS = fs.readFileSync(path.join(MODULES,
  'software-factory/testdata/demo-scenarios.md'), 'utf8');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// The demo script of scenario-2 of the test data, with the click of the action.
const scriptTwo = (target) => ({ scenario: 'scenario-2', title: 'Read the closed day',
  evidence: 'pictures', source: { version: 1 }, setup: [{ do: 'open', url: '/sign-in' }],
  steps: [{ step: 1, title: 'Open the saved reply for delayed orders.',
    expected: 'The reply states that support is closed on 25 December.',
    actions: [{ do: 'click', target }] }] });

// A step of the build ledger with the members that its schema requires.
const row = (id, state, extra = {}) => ({ id, pass: 1, kind: 'script',
  workflow: 'implement-changes', inputs: '1'.repeat(64), state, base: '2'.repeat(40),
  attempts: [], replays: 0, started_at: '2026-11-22T09:00:00Z', ...extra });

// A done step script:scenario-2 or its corrections, with the sha256 of the file that it froze.
const done = (id, text) => row(id, 'done', { commit: '3'.repeat(40),
  ended_at: '2026-11-22T09:10:00Z', script_sha256: sha256(text) });

// ledgered returns an artifact folder with the approved demo scenarios, the pushed script FIRST
// as version 1, and the build ledger with rows, a list of steps.
function ledgered(rows, first = JSON.stringify(scriptTwo('text=Delayed order'))) {
  const root = next('ledger');
  const entries = [
    stored(root, 'demo-scenarios', 'main', { 'demo-scenarios.md': SCENARIOS }, true),
    stored(root, 'demo-script', 'scenario-2', { 'scenario-2.json': first }),
  ];
  if (rows) {
    const text = JSON.stringify({ steps: rows, escalations: [] });
    entries.push(stored(root, 'build-ledger', 'main', { 'build-ledger.json': text }));
    fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
    fs.writeFileSync(path.join(root, '.reports', 'build-ledger.json'), text);
  }
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ artifacts: entries }));
  return root;
}

// pushing runs the push check of demo-script on the file of a script, in the push form, as
// qory runs it: the folder root is the push store, with the pushed versions that the check reads.
function pushing(root, data) {
  const file = path.join(tmp, `draft-${++folders}`, 'scenario-2.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return call(['push', 'demo-script', file], { cwd: root });
}

test('push check of demo-script: a changed frozen script needs the next step in the ledger', () => {
  const frozenText = JSON.stringify(scriptTwo('text=Delayed order'));
  const changed = scriptTwo('text=Delayed order reply');
  const rows = [done('script:scenario-2', frozenText)];
  // No ledger, or a script that is the frozen one: no finding.
  assert.equal(pushing(ledgered(null), changed).status, 0);
  assert.equal(pushing(ledgered(rows), frozenText).status, 0);
  const refused = pushing(ledgered(rows), changed);
  assert.equal(refused.status, 1, refused.out);
  assert.deepEqual(refused.out.split('\n').slice(0, 2), [
    'Run the step script:scenario-2#2, then push scenario-2.json again.',
    '  scenario-2.json has another sha256 than the done step script:scenario-2, and the build ' +
      'ledger has no step script:scenario-2#2.']);
  // The step is begun: the push passes, and it stays refused with the row of another scenario.
  const begun = [...rows, row('script:scenario-2#2', 'running')];
  assert.equal(pushing(ledgered(begun), changed).status, 0);
  const other = [...rows, row('script:scenario-1#2', 'running')];
  assert.equal(pushing(ledgered(other), changed).status, 1);
});

// The qory stub of step begin, with a store: a push of build-ledger runs its push check in the
// store and stores the version, and a pull copies build-ledger and index.json into ARTIFACTS.
const PUSH = path.join(SKILL, 'workflow-checks.cjs');
function stubbed(store, bin) {
  const listing = path.join(bin, 'list.js');
  fs.writeFileSync(listing, `const fs = require('fs');
const [file, number, run] = process.argv.slice(2);
const index = JSON.parse(fs.readFileSync(file, 'utf8'));
let entry = index.artifacts.find((one) => one.type === 'build-ledger');
if (!entry) {
  entry = { type: 'build-ledger', name: 'main', approved_version: null, versions: [] };
  index.artifacts.push(entry);
}
entry.versions.push({ id: 'av_bl' + number, number: Number(number),
  writer: { kind: 'run', run_id: run } });
entry.newest_version = Math.max(...entry.versions.map((one) => one.number));
fs.writeFileSync(file, JSON.stringify(index));
`);
  const qory = path.join(bin, 'qory');
  fs.writeFileSync(qory, `#!/bin/sh
case "$1 $2 $3" in
'artifact push build-ledger')
  cd '${store}' || exit 1
  '${process.execPath}' '${PUSH}' push build-ledger "$4" >&2 || exit 1
  n=0
  for dir in build-ledger/main/v*; do [ -d "$dir" ] && n=$((n + 1)); done
  n=$((n + 1))
  mkdir -p "build-ledger/main/v$n" && cp "$4" "build-ledger/main/v$n/build-ledger.json"
  '${process.execPath}' '${listing}' '${store}/index.json' "$n" "$QORY_RUN_ID"
  echo "Pushed build-ledger version $n."
  exit 0;;
'artifact pull build-ledger')
  rm -rf "$ARTIFACTS/build-ledger"
  [ -d '${store}/build-ledger' ] && cp -R '${store}/build-ledger' "$ARTIFACTS/"
  cp '${store}/index.json' "$ARTIFACTS/index.json"
  echo "$ARTIFACTS/"
  exit 0;;
esac
exit 9
`, { mode: 0o755 });
  return qory;
}

test('demo-script: the check of the draft passes after step begin pushed the row of the correction, before the push of the script', () => {
  const frozenText = JSON.stringify(scriptTwo('text=Delayed order'));
  const changed = JSON.stringify(scriptTwo('text=Delayed order reply'));
  const dir = next('work');
  const store = next('store');
  const bin = next('bin');
  const artifacts = next('artifacts');
  const inputs = next('inputs');
  for (const folder of [dir, store, bin, artifacts, inputs]) fs.mkdirSync(folder, { recursive: true });
  assert.equal(childProcess.spawnSync('git', ['-C', dir, 'init', '-q']).status, 0);
  fs.writeFileSync(path.join(dir, 'README.md'), 'The shop.\n');
  assert.equal(childProcess.spawnSync('git', ['-C', dir, 'add', '-A']).status, 0);
  committed(dir);
  // The store has the approved scenarios and the frozen script as pushed version 1, and no
  // build ledger yet.
  const entries = [
    stored(store, 'demo-scenarios', 'main', { 'demo-scenarios.md': SCENARIOS }, true),
    stored(store, 'demo-script', 'scenario-2', { 'scenario-2.json': frozenText })];
  fs.writeFileSync(path.join(store, 'index.json'), JSON.stringify({ version: 1,
    artifacts: entries }));
  const env = { ...process.env, ARTIFACTS: artifacts, QORY_RUN_ID: 'run-1' };
  delete env.QORY_SESSION;
  const session = (...argv) => call(argv, { cwd: dir, artifacts: [artifacts], env,
    qory: stubbed(store, bin), plugin: PLUGIN });
  const files = ['plan.md', 'skill.md', 'agent.md'].map((name) => {
    fs.writeFileSync(path.join(inputs, name), `The ${name} of the step.\n`);
    return path.join(inputs, name);
  });
  const draft = path.join(artifacts, '.demo', 'scenario-2.json');
  fs.mkdirSync(path.dirname(draft), { recursive: true });
  fs.writeFileSync(draft, frozenText);
  // The first pass: begin the step, end it done with the sha256 of the frozen script, which
  // check-reviewer passed in its report for that sha256. Then the author changes the draft.
  assert.equal(session('resume').status, 0);
  const first = session('step', 'begin', 'script:scenario-2', 'implement-changes', ...files);
  assert.equal(first.status, 0, first.out + first.err);
  const report = path.join(artifacts, '.step-reports', 'check-reviewer',
    `${sha256(frozenText)}.json`);
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, JSON.stringify({ reviewer: 'check-reviewer', findings: [] }));
  const ended = session('step', 'end', 'script:scenario-2', 'done', '--script-sha256',
    sha256(frozenText));
  assert.equal(ended.status, 0, ended.out + ended.err);
  fs.writeFileSync(draft, changed);
  // The next session pulls the ledger with the done row, then begins the correction. The pushed
  // row is in the store, and the pulled folder still has the ledger of the pull.
  assert.equal(session('resume').status, 0);
  for (const type of ['demo-scenarios', 'demo-script']) {
    fs.cpSync(path.join(store, type), path.join(artifacts, type), { recursive: true });
  }
  const begun = session('step', 'begin', 'script:scenario-2#2', 'implement-changes', ...files);
  assert.equal(begun.status, 0, begun.out + begun.err);
  const pulled = JSON.parse(fs.readFileSync(path.join(artifacts, 'build-ledger', 'main',
    fs.readdirSync(path.join(artifacts, 'build-ledger', 'main')).sort().at(-1),
    'build-ledger.json'), 'utf8'));
  assert.equal(pulled.steps.some((one) => one.id === 'script:scenario-2#2'), false);
  // The check of step 6 of scripting-demos finds no fault, and the push check passes too, in
  // the store that now has the row. Before the push no row of the correction is in the folder.
  const checked = session('check', 'demo-script', draft);
  assert.equal(checked.status, 0, checked.out + checked.err);
  const pushed = call(['push', 'demo-script', draft], { cwd: store });
  assert.equal(pushed.status, 0, pushed.out + pushed.err);
});

test('push check of demo-script: a third correction fails', () => {
  const frozenText = JSON.stringify(scriptTwo('text=Delayed order'));
  const rows = [done('script:scenario-2', frozenText),
    done('script:scenario-2#2', JSON.stringify(scriptTwo('text=a'))),
    done('script:scenario-2#3', JSON.stringify(scriptTwo('text=b')))];
  const last = JSON.stringify(scriptTwo('text=b'));
  assert.equal(pushing(ledgered(rows), last).status, 0);
  const refused = pushing(ledgered(rows), scriptTwo('text=c'));
  assert.equal(refused.status, 1, refused.out);
  assert.equal(refused.out.split('\n')[0], 'Keep the script of scenario-2 as it is: it has had 2 ' +
    'corrections, and a third correction fails.');
});

test('demo check: a frozen script that Verify faulted is a correction, and the third is refused', () => {
  const frozenText = JSON.stringify(scriptTwo('text=Delayed order'));
  const fault = { scenario: 'scenario-2', verdict: 'failed', class: 'script',
    script: { type: 'demo-script', name: 'scenario-2', version: 1 },
    steps: [{ step: 1, verdict: 'failed', finding: 'The target matches no element.' }] };
  const checking = (rows, evidenceData) => {
    const root = ledgered(rows, frozenText);
    if (evidenceData) {
      const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
      index.artifacts.push(stored(root, 'demo-evidence', 'scenario-2',
        { 'scenario-2.json': JSON.stringify(evidenceData) }));
      fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index));
    }
    return call(['demo', 'check', 'scenario-2'], { cwd: tmp, artifacts: [root] });
  };
  const rows = [done('script:scenario-2', frozenText)];
  const faulted = checking(rows, fault);
  assert.equal(faulted.status, 1, faulted.out);
  assert.deepEqual(faulted.out.split('\n').slice(0, 3), [
    'Fix the actions of scenario-2: Verify found the script at fault in step 1.',
    '  "The target matches no element."',
    'Write scenario-2 again as the step script:scenario-2#2, then run demo check scenario-2.']);
  // Evidence of a product fault, of another script version or a passed one is no correction.
  for (const other of [{ ...fault, class: 'product' }, { ...fault, verdict: 'passed' },
    { ...fault, script: { ...fault.script, version: 2 } }]) {
    assert.equal(checking(rows, other).status, 0);
  }
  const three = [...rows, done('script:scenario-2#2', 'b'), done('script:scenario-2#3', 'c')];
  const refused = checking(three, fault);
  assert.equal(refused.status, 1, refused.out);
  assert.equal(refused.out.split('\n')[0], 'Keep the script of scenario-2 as it is: it has had ' +
    '2 corrections, and a third is refused.');
});

// ---- the newest demo script that a check reads -----------------------------------------------

test('demo-evidence check: a leftover demo-script folder above the newest version in index.json decides nothing', () => {
  const here = checkout([script('scenario-1')]);
  const file = path.join(here.root, 'scenario-1.json');
  fs.writeFileSync(file, JSON.stringify(evidence('scenario-1', 'a'.repeat(40))));
  assert.equal(call(['check', 'demo-evidence', file], here.deps).status, 0);
  // An earlier pull left version 2, a script of two steps that index.json does not list.
  const left = path.join(here.root, 'demo-script', 'scenario-1', 'v2');
  fs.mkdirSync(left);
  fs.writeFileSync(path.join(left, 'scenario-1.json'), JSON.stringify(two('scenario-1')));
  const got = call(['check', 'demo-evidence', file], here.deps);
  assert.equal(got.status, 0, got.out);
  // Version 2 counts once index.json lists it, and then the one-step evidence is at fault.
  const index = JSON.parse(fs.readFileSync(path.join(here.root, 'index.json'), 'utf8'));
  index.artifacts[0] = artifact('demo-script', 'scenario-1', [1, 2]);
  fs.writeFileSync(path.join(here.root, 'index.json'), JSON.stringify(index));
  const counted = call(['check', 'demo-evidence', file], here.deps);
  assert.equal(counted.status, 1, counted.out);
  assert.match(counted.out, /Give scenario-1\.json 2 steps/);
});

test('demo-video check: the cues are those of the newest version that index.json lists', () => {
  const here = checkout([script('scenario-1')]);
  const left = path.join(here.root, 'demo-script', 'scenario-1', 'v2');
  fs.mkdirSync(left);
  fs.writeFileSync(path.join(left, 'scenario-1.json'), JSON.stringify(two('scenario-1')));
  const folder = path.join(here.root, 'video');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'scenario-1.mp4'), 'x');
  fs.writeFileSync(path.join(folder, 'scenario-1.vtt'), filmVerb.captions(
    { steps: [{ title: 'Step 1 of scenario-1.' }] }, { starts: [0], end: 1000 }));
  const got = call(['check', 'demo-video', path.join(folder, 'scenario-1.mp4'),
    path.join(folder, 'scenario-1.vtt')], here.deps);
  assert.equal(got.status, 0, got.out);
});

// ---- the report of demo-reviewer -------------------------------------------------------------

// PLUGIN_COPY has the layout of the composed plugin for the agents of software-factory.
const PLUGIN_COPY = path.join(tmp, 'plugin');
fs.mkdirSync(path.join(PLUGIN_COPY, 'agents'), { recursive: true });
fs.cpSync(path.join(MODULES, 'software-factory', 'agents'), path.join(PLUGIN_COPY, 'agents'),
  { recursive: true });

// reviewed runs the report check of demo-reviewer on text.
function reviewed(text) {
  const root = next('report');
  fs.mkdirSync(path.join(root, '.reports'), { recursive: true });
  const file = path.join(root, '.reports', 'demo-reviewer-1.md');
  fs.writeFileSync(file, text);
  return call(['report', 'demo-reviewer', file], { cwd: tmp, artifacts: [root],
    plugin: PLUGIN_COPY });
}

test('report: demo-reviewer ends with done or blocked, and its step lines are the lines that film record reads', () => {
  const body = ['What you read:', '- /tmp/qory-artifacts/demo-script/scenario-1/v1/scenario-1.json',
    '- /tmp/qory-artifacts/.film/scenario-1/frames/step-1-start.png', ''];
  const passed = reviewed([...body, 'Step 1: passed', 'Step 2: passed', '', 'done', ''].join('\n'));
  assert.equal(passed.status, 0, passed.out + passed.err);
  const failed = reviewed([...body, 'Step 1: passed',
    'Step 2: failed: The page shows no date, and the step expects 2026-11-24.',
    'Class: product', '', 'done', ''].join('\n'));
  assert.equal(failed.status, 0, failed.out + failed.err);
  const film = reviewed([...body, 'Step 1: not-reached', 'Needs film: 1', '', 'done', ''].join('\n'));
  assert.equal(film.status, 0, film.out + film.err);
  const clean = reviewed([...body, 'Step 1: passed', '', 'clean', ''].join('\n'));
  assert.equal(clean.status, 1);
  assert.match(clean.out, /End the report with one word, done, blocked\./);
  const blocked = reviewed(['Blocked: /tmp/x.png is no image.', '', 'blocked', ''].join('\n'));
  assert.equal(blocked.status, 0, blocked.out + blocked.err);
});

test('film record reads the lines that demo-reviewer writes', () => {
  const here = filmed();
  const text = ['What you read:', '- x', '', 'Step 1: passed',
    'Step 2: failed: The page shows no date.', 'Class: script', '', 'done', ''].join('\n');
  const file = path.join(here.dir, 'report.md');
  fs.writeFileSync(file, text);
  const done = call(['film', 'record', 'scenario-1', '--review', file, '--media', '1'], here.deps);
  assert.equal(done.status, 0, done.out + done.err);
  assert.deepEqual([here.written().class, here.written().steps[1].finding],
    ['script', 'The page shows no date.']);
});

// ---- the build plan of a session with no plan --------------------------------------------------

// A runner for preflight that starts no browser and has no sign-in to replay.
const PREFLIGHT_RUNNER = path.join(tmp, 'preflight-runner.cjs');
fs.writeFileSync(PREFLIGHT_RUNNER, `const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
const result = { app: { started: true, ran: true, why: null }, signIns: [], runs: [],
  unfinished: null };
fs.writeFileSync(spec.resultFile, JSON.stringify(result) + '\\n', { flag: 'wx' });
`);

// inputsOf writes the inputs.json of a run whose start_artifacts is folder, and returns its path.
function inputsOf(here, folder) {
  const file = path.join(here.dir, 'inputs.json');
  fs.writeFileSync(file, JSON.stringify({ qory: { harness_extensions: {},
    start_commits: [{ path: here.dir, commit: committed(here.dir) }],
    start_artifacts: folder } }));
  return file;
}

test('preflight and film read the build plan of qory.start_artifacts, with no --artifacts', () => {
  const ffmpeg = sized(100);
  const here = checkout([script('scenario-1')]);
  here.deps.preflight = { ...here.deps.preflight, runner: FAKE_RUNNER, ffmpegs: [ffmpeg.file],
    filmLimit: MIB };
  // The snapshot has the approved version of the build plan only.
  const inputs = inputsOf(here, here.plan);
  const filmed = call(['film', 'scenario-1', '--inputs', inputs], here.deps);
  assert.equal(filmed.status, 0, filmed.out + filmed.err);
  const checked = call(['preflight', '--inputs', inputs], { ...here.deps,
    preflight: { ...here.deps.preflight, runner: PREFLIGHT_RUNNER } });
  assert.equal(checked.status, 0, checked.out + checked.err);
});

test('preflight and film on a snapshot with no build plan exit 3 with the cause that the build plan is missing', () => {
  const ffmpeg = sized(100);
  const here = checkout([script('scenario-1')]);
  here.deps.preflight = { ...here.deps.preflight, runner: FAKE_RUNNER, ffmpegs: [ffmpeg.file] };
  const empty = next('snapshot');
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(empty, 'index.json'), JSON.stringify({ artifacts: [] }));
  const inputs = inputsOf(here, empty);
  const checked = call(['preflight', '--inputs', inputs], here.deps);
  assert.equal(checked.status, 3, checked.out + checked.err);
  assert.match(checked.out, /^ {2}Cause: the build plan is missing\.$/m);
  const filmed = call(['film', 'scenario-1', '--inputs', inputs], here.deps);
  assert.equal(filmed.status, 3, filmed.out + filmed.err);
  assert.equal(ffmpeg.calls().length, 0);
});

test('film todo: with no approved demo scenarios it exits 3 and lists nothing to withdraw', () => {
  const here = checkout([]);
  committed(here.dir);
  const entries = [
    stored(here.root, 'demo-evidence', 'scenario-3', { 'scenario-3.json': '{}' }),
    stored(here.root, 'demo-video', 'scenario-3', { 'scenario-3.vtt': 'WEBVTT\n' }),
  ];
  fs.writeFileSync(path.join(here.root, 'index.json'), JSON.stringify({ artifacts: entries }));
  const done = call(['film', 'todo'], here.deps);
  assert.equal(done.status, 3, done.out + done.err);
  assert.equal(done.out.split('\n')[0], 'Pull the artifacts again.');
  assert.doesNotMatch(done.out, /To withdraw/);
});

test('film record: a step past the last, a missing report and a scenario with no film are refused', () => {
  const here = filmed();
  const past = call(['film', 'record', 'scenario-1', '--class', 'script', '--cause', 'x',
    '--step', '3'], here.deps);
  assert.equal(past.status, 1, past.out + past.err);
  assert.equal(past.out.split('\n')[0], 'Give --step a step of scenario-1.');
  assert.equal(fs.existsSync(path.join(here.root, 'scenario-1.json')), false);
  const missing = call(['film', 'record', 'scenario-1', '--review', path.join(here.dir, 'none.md'),
    '--media', '1'], here.deps);
  assert.equal(missing.status, 1, missing.out + missing.err);
  assert.match(missing.out.split('\n')[0], /^Save the report of demo-reviewer in a file/);
  fs.rmSync(path.join(here.root, '.film'), { recursive: true });
  const none = call(['film', 'record', 'scenario-1', '--review',
    here.review('Step 1: passed', 'Step 2: passed'), '--media', '1'], here.deps);
  assert.equal(none.status, 3, none.out + none.err);
  assert.equal(none.out.split('\n')[0],
    'Run film scenario-1, then run film record scenario-1 again.');
});

test('demo-evidence check: a version that index.json counts and the store lacks exits 3 with the pull line', () => {
  const here = checkout([script('scenario-1')]);
  const file = path.join(here.root, 'scenario-1.json');
  fs.writeFileSync(file, JSON.stringify(evidence('scenario-1', 'a'.repeat(40))));
  const index = JSON.parse(fs.readFileSync(path.join(here.root, 'index.json'), 'utf8'));
  index.artifacts[0] = artifact('demo-script', 'scenario-1', [1, 2]);
  fs.writeFileSync(path.join(here.root, 'index.json'), JSON.stringify(index));
  const got = call(['check', 'demo-evidence', file], here.deps);
  assert.equal(got.status, 3, got.out + got.err);
  assert.equal(got.out.split('\n')[0],
    'Run `qory artifact pull demo-script --version 2`, then check again.');
  assert.match(got.out, /demo-script version 2/);
});

test('film outside a run with an empty qory.start_artifacts reads the build plan of the session folder', () => {
  const ffmpeg = sized(100);
  const here = checkout([script('scenario-1')]);
  here.deps.preflight = { ...here.deps.preflight, runner: FAKE_RUNNER, ffmpegs: [ffmpeg.file],
    filmLimit: MIB };
  const inputs = inputsOf(here, '');
  // The session folder has no build plan: exit 3 with the cause.
  const none = call(['film', 'scenario-1', '--inputs', inputs], here.deps);
  assert.equal(none.status, 3, none.out + none.err);
  assert.match(none.out, /^ {2}Cause: the build plan is missing\.$/m);
  assert.equal(ffmpeg.calls().length, 0);
  // With a build plan in the session folder, the call is the call that has no --inputs.
  fs.cpSync(path.join(here.plan, 'build-plan'), path.join(here.root, 'build-plan'),
    { recursive: true });
  const index = JSON.parse(fs.readFileSync(path.join(here.root, 'index.json'), 'utf8'));
  index.artifacts.push(artifact('build-plan', 'main', [1]));
  fs.writeFileSync(path.join(here.root, 'index.json'), JSON.stringify(index));
  const done = call(['film', 'scenario-1', '--inputs', inputs], here.deps);
  assert.equal(done.status, 0, done.out + done.err);
  assert.deepEqual(fs.readdirSync(path.join(here.root, '.film', 'scenario-1')).sort(),
    ['scenario-1.mp4', 'scenario-1.vtt']);
});
