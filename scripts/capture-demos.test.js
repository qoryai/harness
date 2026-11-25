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

test('film recode: with no kept frames it exits 3, and with under 20 s of the call left it exits 3 and keeps them', () => {
  const ffmpeg = sized(2 * MIB, 100);
  const here = filming(ffmpeg, MIB);
  const none = call(['film', 'recode', 'scenario-1'], here.deps);
  assert.equal(none.status, 3, none.out + none.err);
  assert.equal(none.out.split('\n')[0], 'Run film scenario-1, then run film recode ' +
    'scenario-1 again.');
  assert.equal(call(['film', 'scenario-1', '--artifacts', here.plan], here.deps).status, 4);
  // The clock jumps 570 s when the verb reads the kept frames, which it does after the start
  // of its call: 15 s are left.
  const clock = Date.now;
  const reader = fs.readFileSync;
  let late;
  fs.readFileSync = (file, ...rest) => {
    if (String(file).endsWith('capture.json')) Date.now = () => clock() + 570000;
    return reader(file, ...rest);
  };
  try {
    late = call(['film', 'recode', 'scenario-1'], here.deps);
  } finally {
    Date.now = clock;
    fs.readFileSync = reader;
  }
  assert.equal(late.status, 3, late.out + late.err);
  assert.equal(late.out.split('\n')[0], 'Run film recode scenario-1 again.');
  assert.match(late.out.split('\n')[1], /^ {2}Only 1[45] s of the 585 s of the call are left for ffmpeg\.$/);
  assert.ok(fs.existsSync(path.join(here.film, 'f000001.jpg')));
  assert.equal(ffmpeg.calls().length, 1);
  assert.equal(call(['film', 'recode', 'scenario-1'], here.deps).status, 0);
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

test('film record: a failed step needs its finding and a class, and the evidence keeps both', () => {
  const here = filmed();
  const lines = ['Step 1: passed', 'Step 2: failed: The page shows no date.'];
  const noClass = call(['film', 'record', 'scenario-1', '--review', here.review(...lines),
    '--media', '1'], here.deps);
  assert.equal(noClass.status, 1, noClass.out);
  assert.equal(noClass.out.split('\n')[0], 'Give each failed step a finding and the report the ' +
    'line "Class: product", "Class: script" or "Class: setup".');
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
  assert.match(short.out, /The script has 2 steps, and the report has 1 such lines\./);
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

// pushing runs the push check of demo-script on the file of a script in root.
function pushing(root, data) {
  const file = path.join(root, 'draft', 'scenario-2.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return call(['check', 'demo-script', file], { cwd: tmp, artifacts: [root] });
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

test('push check of demo-script: a third correction is refused', () => {
  const frozenText = JSON.stringify(scriptTwo('text=Delayed order'));
  const rows = [done('script:scenario-2', frozenText),
    done('script:scenario-2#2', JSON.stringify(scriptTwo('text=a'))),
    done('script:scenario-2#3', JSON.stringify(scriptTwo('text=b')))];
  const last = JSON.stringify(scriptTwo('text=b'));
  assert.equal(pushing(ledgered(rows), last).status, 0);
  const refused = pushing(ledgered(rows), scriptTwo('text=c'));
  assert.equal(refused.status, 1, refused.out);
  assert.equal(refused.out.split('\n')[0], 'Keep the script of scenario-2 as it is: it has had 2 ' +
    'corrections, and a third is refused.');
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
