// film: the evidence of a demo scenario, one film or one set of pictures, from the pushed
// demo script of the scenario.
//
//   film <scenario> [--film] [--inputs <path>] [--artifacts <folder>]
//                         reads the build plan from --inputs or --artifacts, and exits 3 with
//                         neither. It runs the newest demo script of the scenario that counts, in
//                         <folder>/.film/<scenario>/. The runner of preflight starts the app of
//                         the build plan at its App address, in a new window of 1280 x 720 px,
//                         and replays the setup as a sign-in. With the evidence film, it then
//                         records the page from the start of step 1 to the last action, and
//                         ffmpeg makes <scenario>.mp4 and <scenario>.vtt, whose cue of each
//                         step starts at the start of that step. With the evidence pictures,
//                         it runs with video off and writes <scenario>-step-<N>.png, the page
//                         after step N. It exits 0, and prints a line that names the files. A
//                         run that fails in the sign-in, or in a step before anything was
//                         recorded, stores nothing and exits 1 with the fix first. A run that
//                         fails in step N after the film or the pictures began keeps the film
//                         of the steps up to N (no size limit applies) or the pictures before
//                         it, writes failed.json with the step, and exits 5 with the line
//                         "Start demo-reviewer on step N of <scenario>, then record it.". With
//                         --film, a scenario whose script has the evidence pictures is filmed
//                         too, for a step that a picture cannot show. The first encode (pass
//                         1) caps the bitrate so that the film fits one version of qory. When
//                         the film is still over the limit, the call keeps .film/<scenario>/
//                         with the frames and exits 4 with the line "Run film recode
//                         <scenario>.".
//   film recode <scenario>
//                         encodes the kept frames again (pass 2), at 960 x 540 px, with a
//                         lower quality and half the cap, within what is left of CALL_MS. A
//                         film that fits replaces the first one and the frames go. A film that
//                         is still over the limit exits 1 with the fix first, and removes
//                         .film/<scenario>/. A pass 2 that ffmpeg does not finish in time
//                         exits 3 and keeps the frames.
//   film frames <scenario>
//                         takes two pictures of each step from <scenario>.mp4 of
//                         <folder>/.film/<scenario>/, for demo-reviewer: the page at the start
//                         of the step and the page when the step ended, as
//                         frames/step-<N>-start.png and frames/step-<N>-reached.png.
//   film todo             prints the scenarios to film, those of the approved demo scenarios
//                         with a demo script and no demo evidence for the commit of the working
//                         folder and the version of that script, or with evidence of the class
//                         setup, and the pushed artifacts to withdraw, those of a scenario that
//                         the approved demo scenarios removed.
//   film record <scenario> --review <file> [--media <N>]
//   film record <scenario> --class <class> --cause <text> [--step <N>]
//                         writes <folder>/<scenario>.json, the demo evidence of the scenario
//                         for the commit of the working folder and the newest demo script that
//                         counts. The first form reads the report of demo-reviewer in <file>,
//                         one line "Step <N>: passed", "Step <N>: failed: <finding>" or "Step
//                         <N>: not-reached" for each step, and the line "Class: product",
//                         "Class: script" or "Class: setup" for a failed step; <N> of --media
//                         is the version of the demo-video or the screenshot that the session
//                         pushed; a run that failed in a step (exit 5 of film) takes no --media,
//                         and the report fails that step and does not reach the later ones.
//                         The second form records a scenario with no film: the steps
//                         before step N passed, step N, the last by default, failed with the
//                         cause as its finding, and the later steps were not reached.
//   film pages <path>... [--inputs <path>] [--artifacts <folder>]
//                         takes pictures of the pages that the paths open, for the two screen
//                         reviewers: pages-<N>-<width>.png in <folder>/.film/pages/ for the
//                         Nth path, at the widths 360, 768 and 1280 px. The setup of the first
//                         demo script that counts is the sign-in, if there is one.
//
// A call takes one scenario, and ends within CALL_MS of lib/budget.cjs, 585 s: the runner ends
// within RUN_BUDGET_MS, 535 s, 15 s more at the latest, and the encode takes ENCODE_MS, 35 s.
// film recode is a separate call, with the same CALL_MS for ffmpeg alone. The size is that of qory's rule for one version: the MP4 and
// the WebVTT file, each as base64, and an envelope of 16 KiB, at most 32 MiB.
// film <scenario> and film pages store nothing in Qory Apiary, write no demo evidence and no
// ledger row: the session pushes the files. Only film record writes demo evidence, to a file.
// Exit 3 means that an input is missing, that ffmpeg or the browser is missing, or that the
// app, the browser or ffmpeg did not run. Exit 4 means that pass 1 left a film over the limit,
// or ran out of time, and kept its frames. Exit 5 means that the run failed in a step and kept
// what it recorded for demo-reviewer.
// The last line that starts with "Kind: " of a finding sorts its cause for the session: "Kind:
// outside" for one that no change to the repository repairs (no browser, no ffmpeg, a variable
// that the workspace lacks, ffmpeg out of time after film recode), and "Kind: setup" for one
// that a change repairs (the app does not start, the sign-in fails). A finding with no such
// line is a failure of the call.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { findBrowser } = require('../lib/browser.cjs');
const git = require('../lib/git.cjs');
const { CALL_MS, RUN_BUDGET_MS, START_MS } = require('../lib/budget.cjs');
const { FILM_HEIGHT } = require('../lib/capture.cjs');
const { takeInputs, takeValue } = require('../lib/limits.cjs');
const { ARTIFACTS_USAGE } = require('../lib/start.cjs');
const { SCHEMAS } = require('../lib/template.cjs');
const { INPUTS_USAGE } = require('./run.cjs');

const FOLDER = '.film';
const WIDTHS = [360, 768, 1280];
const ID = /^scenario-[1-9][0-9]?$/;
const FRAME = /^f[0-9]{6}\.jpg$/;
const USAGE = 'Give film a scenario id, or recode, frames, todo, record or pages with their ' +
  'arguments.';
// The path of ffmpeg in the image of qory, which apt installs, and the name for the PATH.
const FFMPEG = ['/usr/bin/ffmpeg', 'ffmpeg'];
// The most time of ffmpeg, and the least: ffmpegLimitMs gives it what is left of CALL_MS.
const FFMPEG_MS = 90000;
const FFMPEG_LEAST_MS = 5000;
const FRAMES_PER_SECOND = 25;

// The size that qory accepts for one version: the files, each as base64 (ceil(n / 3) * 4
// bytes), plus an envelope of JSON, at most 32 MiB (runapi.MaxBody of qory). The film and its
// captions are the files of the version.
const VERSION_LIMIT = 32 * 1024 * 1024;
const ENVELOPE = 16 * 1024;
// The bytes of files that fit: (VERSION_LIMIT - ENVELOPE) / 4 * 3.
const FILES_BYTES = (VERSION_LIMIT - ENVELOPE) / 4 * 3;
// Pass 1 caps the bitrate so that the film takes at most this share of FILES_BYTES, and at
// most MOST_KBIT kbit/s, the rate that a film has when its frames stay still.
const SHARE = 0.8;
const MOST_KBIT = 1500;
// The file that keeps the frames of a film between film and film recode, and the file that
// keeps the step that a run failed in, for film frames and film record.
const CAPTURE_FILE = 'capture.json';
const FAILED_FILE = 'failed.json';
const CLASSES = ['product', 'script', 'setup'];
const RECORD_USAGE = 'Give film record a scenario id, then --review and --media, or --class ' +
  'and --cause.\nAdd --step <N> with --class and --cause to name the failed step. A run that ' +
  'failed in a step takes --review with no --media.';

// rateCap returns the cap of pass 1 in kbit/s for a film of seconds: the rate at which the
// film takes SHARE of FILES_BYTES, at most MOST_KBIT.
function rateCap(seconds) {
  if (!(seconds > 0)) return MOST_KBIT;
  return Math.max(Math.min(MOST_KBIT, Math.floor(SHARE * FILES_BYTES * 8 / 1000 / seconds)), 1);
}

// passesOf returns the settings of the two passes for a film of seconds: pass 1 at 1280 x
// FILM_HEIGHT px with the CRF 28 and the cap, pass 2 at 960 x 540 px with the CRF 32 and half
// the cap.
const passesOf = (seconds) => [
  { crf: 28, kbit: rateCap(seconds), scale: `1280:${FILM_HEIGHT}` },
  { crf: 32, kbit: Math.max(Math.floor(rateCap(seconds) / 2), 1), scale: '960:540' }];

// ffmpegArguments returns the arguments of ffmpeg that make <id>.mp4.tmp from frames.txt, the
// list of frames, with the last frame held for hold seconds, in the setting { crf, kbit,
// scale } of a pass. With no setting it is pass 1 at the highest cap.
const ffmpegArguments = (id, hold,
  { crf, kbit, scale } = { crf: 28, kbit: MOST_KBIT, scale: `1280:${FILM_HEIGHT}` }) => [
  '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-i', 'frames.txt', '-vf',
  `fps=${FRAMES_PER_SECOND},tpad=stop_mode=clone:stop_duration=${hold},scale=${scale},` +
  'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-maxrate',
  `${kbit}k`, '-bufsize', `${2 * kbit}k`, '-movflags', '+faststart', '-an', '-f', 'mp4',
  `${id}.mp4.tmp`];

// encodedSize returns the bytes that qory counts for files of the sizes: each file as base64,
// and the envelope.
const encodedSize = (sizes) => ENVELOPE + sizes
  .reduce((sum, size) => sum + Math.ceil(size / 3) * 4, 0);

// mib returns bytes as MiB with one decimal.
const mib = (bytes) => (bytes / 1048576).toFixed(1);

// ffmpegLimitMs returns the time for ffmpeg when the call has run for spent ms: what is left
// of CALL_MS, at most FFMPEG_MS and at least FFMPEG_LEAST_MS.
const ffmpegLimitMs = (spent) => Math.max(Math.min(FFMPEG_MS, CALL_MS - spent), FFMPEG_LEAST_MS);

// stamp returns ms as a WebVTT time, 00:00:03.250.
function stamp(ms) {
  const part = (value, size) => String(Math.floor(value)).padStart(size, '0');
  return `${part(ms / 3600000, 2)}:${part((ms / 60000) % 60, 2)}:${part((ms / 1000) % 60, 2)}.` +
    `${part(ms % 1000, 3)}`;
}

// captions returns the WebVTT file of script: one cue per step that began, from the start of
// the step to the start of the next, and the last to the end of the film. A film of a run that
// failed has the cues of the steps up to the failed one.
function captions(script, capture) {
  const cues = script.steps.slice(0, capture.starts.length).map((step, at) => {
    const start = capture.starts[at];
    const end = at + 1 < capture.starts.length ? capture.starts[at + 1] : capture.end;
    // shortcut: a title with & or < reaches the player as written, which may read it as markup.
    const times = `${stamp(start)} --> ${stamp(Math.max(end, start + 1))}`;
    return `${at + 1}\n${times}\n${step.title}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

// cuesOf returns { start, end } in ms of each cue of the WebVTT file text that captions wrote.
function cuesOf(text) {
  const ms = (clock) => {
    const [h, m, rest] = clock.split(':');
    return ((Number(h) * 60 + Number(m)) * 60 + Number(rest)) * 1000;
  };
  return [...text.matchAll(/^(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})$/gm)]
    .map((one) => ({ start: Math.round(ms(one[1])), end: Math.round(ms(one[2])) }));
}

// pictureTimes returns the times in ms of the two pictures of each step of cues: the start of
// the cue, and one frame before its end, at the start when the cue is shorter than a frame.
const pictureTimes = (cues) => cues.map((cue) => ({ start: cue.start,
  reached: Math.max(cue.end - 1000 / FRAMES_PER_SECOND, cue.start) }));

module.exports = (lib) => {
  const { Context, MAX_BYTES, Missing, approved, artifactFolder, boundedText, cut, isObject,
    newestNamed, parseJson, plural, scenarios, schema, short, within, writeJson } = lib;
  const checks = require('../lib/preflight.cjs')(lib);

  // options returns { inputs, artifacts, rest } of the arguments, each undefined when it is not
  // given, or { problem }, the line of wrong arguments.
  function options(args) {
    const { inputs, rest: other } = takeInputs(args);
    if (inputs === null) return { problem: INPUTS_USAGE };
    const { value: artifacts, rest: left } = takeValue(other, '--artifacts');
    if (artifacts === null) return { problem: ARTIFACTS_USAGE };
    const film = left.includes('--film');
    return { inputs, artifacts, film, rest: left.filter((one) => one !== '--film') };
  }

  // serveOf returns the serve row of the build plan, which film and film pages read from
  // --inputs or --artifacts only: with neither, the plan would come from the artifact folder of
  // the session, where a member of the run may have written another.
  function serveOf(io, given) {
    if (given.inputs === undefined && given.artifacts === undefined) {
      throw new Missing('Give --inputs, the input file of the run, to read the build plan that ' +
        'the run started with.\nWithout --inputs or --artifacts, film would read the build ' +
        'plan from the artifact folder of the session.');
    }
    return checks.serveOf(io, given);
  }

  // freshFolder returns the new folder .film/<name> of root. A link in place of .film is
  // refused, and a link in place of the folder is removed: nothing is written outside root.
  function freshFolder(root, name) {
    const base = path.join(root, FOLDER);
    const dir = path.join(base, name);
    try {
      fs.mkdirSync(base, { recursive: true });
      if (!fs.lstatSync(base).isDirectory()) throw new Error('not a folder');
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir);
    } catch {
      throw new Missing(`Make the artifact folder writable, and remove ${FOLDER} if it is a ` +
        `link.\n${path.join(FOLDER, name)} cannot be made.`);
    }
    return dir;
  }

  // caused returns the Missing of a cause that the session sorts by its last line: "Kind:
  // outside" for a cause that no change to the repository repairs, such as a dev container with
  // no browser, and "Kind: setup" for one that a change repairs, such as an app that does not
  // start. A Missing with no Kind line is a failure of the call, for the Failures of the
  // session.
  const caused = (kind, fix, ...details) => new Missing(fix, [...details, `Kind: ${kind}`]);

  // ffmpegMs returns ms, the time for one call of ffmpeg, or io.preflight.ffmpegMs, which only a
  // test sets.
  const ffmpegMs = (io, ms) => (io.preflight || {}).ffmpegMs || ms;

  // browserOf throws the Missing of a machine that has no browser.
  function browserOf(io) {
    if (!findBrowser(io.env, (io.preflight || {}).browsers)) {
      throw caused('outside', 'Add a browser to the dev container, then run preflight again.',
        'No browser such as /usr/bin/chromium exists on this machine.');
    }
  }

  // cleaned returns work(), and removes dir, the new folder of the call, when work throws, except
  // for an error with keep set, which leaves the frames of a run for another call.
  function cleaned(dir, work) {
    try {
      return work();
    } catch (error) {
      if (!error.keep) fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }

  // ended throws the Missing of a run that has no result, or returns the result run. again is
  // the command that the fix repeats. With late, a function that returns the Missing of a
  // run whose START_MS ran out before the browser started, that Missing is thrown for it.
  function ended(ran, serve, again, late) {
    if (!ran.app.started) {
      throw caused('setup', `Make ${short(serve.command, 20)} start the app in the dev ` +
        `container, then run ${again} again.`, `The app did not start: ${ran.app.why}.`);
    }
    if (late && ran.run && ran.run.late) {
      const missing = late();
      missing.more.push('Kind: setup');
      throw missing;
    }
    if (!ran.run) {
      throw new Missing('End the run: the runner returned no result.\nThe script of the film ' +
        'ended with no result.');
    }
    if (ran.run.browser) {
      throw caused('outside', `Fix the browser of the dev container, then run ${again} again.`,
        `The browser did not finish the script: ${ran.run.why}.`);
    }
    return ran.run;
  }

  // failure prints the finding of a run that failed in a step, with the fix first, and returns 1.
  // A sign-in that failed gets the line "Kind: setup", and a variable with no value in the
  // workspace the line "Kind: outside", for the session to sort. The schema of a demo script
  // allows a variable name of 64 characters; the cut to 31 keeps the first line within 100.
  function failure(io, run, what, again) {
    const where = run.step === 0 ? 'the sign-in' : `step ${run.step}`;
    const last = `Stored no ${what}: it failed in ${where}.`;
    if (run.variable) {
      io.print([`Add AGENT_${cut(String(run.variable), 31)} in Workspace settings > Secrets ` +
        'and variables > Variables.\n' +
        `Then run ${again} again.\n${run.why}.\nKind: outside`], last);
      return 1;
    }
    io.print([`Check ${where} against the app, then run ${again} again.\n${run.why}.` +
      `${run.step === 0 ? '\nKind: setup' : ''}`], last);
    return 1;
  }

  // place moves file, written in the same folder, to its final name, as writeJson does.
  const place = (temporary, file) => fs.renameSync(temporary, file);

  // regular reports whether file is a regular file, no link.
  function regular(file) {
    try {
      return fs.lstatSync(file).isFile();
    } catch {
      return false;
    }
  }

  // concat returns the frames of capture as the list of the concat demuxer of ffmpeg: each
  // file with the time until the next frame. The last file has the duration 0 and comes twice,
  // since ffmpeg gives the last entry the duration of the one before it, and then it lasts one
  // frame. It throws a Missing for a frame that is no regular file with the name that the
  // runner gives.
  function concat(dir, capture) {
    const lines = [];
    capture.frames.forEach((frame, at) => {
      if (!FRAME.test(frame.file) || !Number.isFinite(frame.at) ||
        !regular(path.join(dir, frame.file))) {
        throw new Missing('End the run: the runner stored a frame that cannot be read.\n' +
          `${short(String(frame.file), 40)} is no regular file.`);
      }
      const next = at + 1 < capture.frames.length ? capture.frames[at + 1].at : frame.at;
      lines.push(`file '${frame.file}'`, `duration ${(Math.max(next - frame.at, 0) / 1000)
        .toFixed(3)}`);
    });
    lines.push(`file '${capture.frames[capture.frames.length - 1].file}'`);
    return `${lines.join('\n')}\n`;
  }

  // listFrames writes the list of frames of capture to dir, runs ffmpeg once on it in the
  // setting pass, and places <id>.mp4. A failed ffmpeg throws a Missing, with timedOut set when
  // it ran past limitMs, and leaves no list and no temporary film.
  function listFrames(io, dir, id, capture, ffmpeg, limitMs, pass) {
    const list = path.join(dir, 'frames.txt');
    const film = path.join(dir, `${id}.mp4`);
    try {
      fs.writeFileSync(list, concat(dir, capture), { flag: 'wx' });
      // The last frame lasts one frame by itself, and then stays until the end of the film.
      const hold = Math.max((capture.end - capture.frames[capture.frames.length - 1].at) / 1000 -
        1 / FRAMES_PER_SECOND, 0).toFixed(3);
      const made = childProcess.spawnSync(ffmpeg, ffmpegArguments(id, hold, pass), { cwd: dir,
        env: { PATH: io.env.PATH || '/usr/bin:/bin' }, encoding: 'utf8', timeout: limitMs,
        killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
      if (made.status !== 0) {
        const timedOut = Boolean(made.error && made.error.code === 'ETIMEDOUT');
        const why = timedOut ? `ffmpeg ran past its limit of ${Math.round(limitMs / 1000)} s`
          : String(made.stderr || '').trim().split('\n')[0] || (made.error
            ? made.error.code || made.error.message : `exit ${made.status}`);
        throw Object.assign(new Missing(`End the run: ffmpeg did not make the film of ${id}.\n` +
          `${short(why, 160)}`), { timedOut });
      }
      place(`${film}.tmp`, film);
    } catch (error) {
      fs.rmSync(`${film}.tmp`, { force: true });
      throw error;
    } finally {
      fs.rmSync(list, { force: true });
    }
  }

  // sizeOf returns the bytes that qory counts for <id>.mp4 and <id>.vtt of dir.
  const sizeOf = (dir, id) => encodedSize([`${id}.mp4`, `${id}.vtt`]
    .map((name) => fs.statSync(path.join(dir, name)).size));

  // limitOf returns the most bytes of one version: VERSION_LIMIT, or io.preflight.filmLimit,
  // which only a test sets.
  const limitOf = (io) => (io.preflight || {}).filmLimit || VERSION_LIMIT;

  // dropFrames removes the frames of capture and the file that keeps them from dir.
  function dropFrames(dir, capture) {
    for (const one of [path.join(dir, CAPTURE_FILE),
      ...capture.frames.map((frame) => path.join(dir, frame.file))]) {
      fs.rmSync(one, { force: true });
    }
  }

  // encode makes <scenario>.vtt and, in pass 1, <scenario>.mp4 in dir from the frames of
  // capture, which has the start of each of the begun steps: all steps of the script, or the
  // steps up to the failed one. The captions come first, so that film recode finds them after a
  // pass 1 that ran out of time. It keeps the frames, and returns the bytes that qory counts for
  // the version.
  function encode(io, dir, script, capture, ffmpeg, limitMs, begun = script.steps.length) {
    const id = script.scenario;
    if (!capture || capture.kind !== 'film' || !Array.isArray(capture.frames) ||
      !capture.frames.length || !Array.isArray(capture.starts) ||
      capture.starts.length !== begun || !Number.isFinite(capture.end)) {
      throw new Missing(`End the run: the runner stored no film of ${id}.\nIts result has no ` +
        'frames or no start of each step.');
    }
    const text = path.join(dir, `${id}.vtt`);
    fs.writeFileSync(`${text}.tmp`, captions(script, capture), { flag: 'wx' });
    place(`${text}.tmp`, text);
    listFrames(io, dir, id, capture, ffmpeg, limitMs, passesOf(capture.end / 1000)[0]);
    return sizeOf(dir, id);
  }

  // keep writes the frames of capture to the file that film recode reads in dir, and removes the
  // film that dir may hold.
  // shortcut: the frames of the film stay on disk between film and film recode, about 3.5 GB for
  // 35,000 frames, so a film over the limit needs that space in the artifact folder; replace it
  // with a lower rate in pass 1 when a run image has less space.
  function keep(dir, capture, id) {
    fs.writeFileSync(path.join(dir, CAPTURE_FILE), JSON.stringify({ end: capture.end,
      frames: capture.frames.map(({ file, at }) => ({ file, at })) }));
    fs.rmSync(path.join(dir, `${id}.mp4`), { force: true });
  }

  // over keeps the frames of capture in dir, without the film that is over the limit, and prints
  // the line that asks for pass 2. It returns 4.
  function over(io, dir, capture, id, size) {
    keep(dir, capture, id);
    io.print([`Run film recode ${id}.\nThe film of ${id} is ${mib(size)} MiB encoded, and the ` +
      `limit of one version is ${mib(limitOf(io))} MiB.`],
    `Kept the frames of ${id}: its film is over the size limit.`);
    return 4;
  }

  // slow keeps the frames as over does, for a pass 1 that ran past limitMs. film recode is its
  // retry, at a lower quality, so only a recode that runs out of time is a cause outside the
  // repository. It returns 4.
  function slow(io, dir, capture, id, limitMs) {
    keep(dir, capture, id);
    io.print([`Run film recode ${id}.\nffmpeg did not finish pass 1 of the film of ${id} ` +
      `within ${Math.round(limitMs / 1000)} s.`],
    `Kept the frames of ${id}: pass 1 ran out of time.`);
    return 4;
  }

  // recodeOf makes the film of scenario id again, from the frames that film kept: pass 2. The
  // call has the whole of CALL_MS for ffmpeg, so it needs no least time.
  function recodeOf(io, id) {
    const began = Date.now();
    const root = artifactFolder(io);
    const dir = path.join(root, FOLDER, id);
    const kept = path.join(dir, CAPTURE_FILE);
    let capture = null;
    try {
      if (!fs.lstatSync(path.join(root, FOLDER)).isDirectory() ||
        !fs.lstatSync(dir).isDirectory() || !regular(kept)) throw new Error('not kept');
      capture = JSON.parse(fs.readFileSync(kept, 'utf8'));
    } catch {
      capture = null;
    }
    if (!capture || !Array.isArray(capture.frames) || !capture.frames.length ||
      !capture.frames.every((frame) => frame !== null && typeof frame === 'object') ||
      !Number.isFinite(capture.end) || !regular(path.join(dir, `${id}.vtt`))) {
      throw new Missing(`Run film ${id}, then run film recode ${id} again.\n${path.join(FOLDER,
        id)} has no frames that film kept.`);
    }
    const ffmpeg = findBrowser(io.env, (io.preflight || {}).ffmpegs || FFMPEG);
    if (!ffmpeg) {
      throw caused('outside', 'Add ffmpeg to the dev container, then run film recode again.',
        `No ffmpeg exists on this machine, and ${id} has the evidence film.`);
    }
    const [, pass] = passesOf(capture.end / 1000);
    const limitMs = ffmpegMs(io, CALL_MS - (Date.now() - began));
    try {
      listFrames(io, dir, id, capture, ffmpeg, limitMs, pass);
    } catch (error) {
      if (!error.timedOut) throw error;
      // The frames stay, so that another call can run film recode again.
      throw caused('outside', `Give the dev container more CPU, then run film recode ${id} ` +
        'again.', `ffmpeg did not finish pass 2 of the film of ${id} within ` +
        `${Math.round(limitMs / 1000)} s, after pass 1 did not fit or did not finish.`);
    }
    const size = sizeOf(dir, id);
    if (size > limitOf(io)) {
      fs.rmSync(dir, { recursive: true, force: true });
      io.print([`Shorten the waits of ${id} or split it in Shape.\nThe film of ${id} is ` +
        `${mib(size)} MiB encoded after pass 2, and the limit of one version is ` +
        `${mib(limitOf(io))} MiB.`], 'Stored no film: it is over the size limit.');
      return 1;
    }
    dropFrames(dir, capture);
    io.print([], `Filmed ${id} again at 960 x 540 px, ${mib(size)} MiB encoded, in ` +
      `${path.join(FOLDER, id, `${id}.mp4`)}, with the captions ${id}.vtt.`);
    return 0;
  }

  // failed ends a run that failed. A run that failed in a step after step 1 began keeps what it
  // recorded up to that step, for demo-reviewer: the film of the steps up to it, with no size
  // limit because the session pushes none, or the pictures of the steps before it, and the
  // file failed.json with the step and the reason. It prints the finding and returns 5. A run
  // with nothing recorded, a sign-in that failed and a variable with no value store nothing:
  // they print the finding of failure and return 1. A capture that the runner could not write for
  // the disk (lost) and an encode that ran out of time are causes outside the repository: they
  // throw a Missing with "Kind: outside", and the encode keeps its frames.
  // shortcut: a film of a failed run that ffmpeg cannot encode for another reason than time
  // stores nothing, so the session records the step with the class script, with no frame;
  // replace it with the frames themselves when demo-reviewer can read them.
  function failed(io, { dir, id, kind, script, run, ffmpeg, began }) {
    const what = kind === 'film' ? 'film' : 'pictures';
    const recorded = run.capture ? (kind === 'film' ? run.capture.frames : run.capture.files) : [];
    const none = () => {
      fs.rmSync(dir, { recursive: true, force: true });
      return failure(io, run, what, `film ${id}`);
    };
    if (run.step === 0 || run.variable) return none();
    if (run.lost) {
      throw caused('outside', 'Give the dev container more disk space, then run film ' +
        `${id} again.`, `The runner could not write the ${what} of ${id} that it took before ` +
        `step ${run.step}: ${cut(String(run.lost), 160)}.`);
    }
    if (!Array.isArray(recorded) || !recorded.length) return none();
    fs.writeFileSync(path.join(dir, FAILED_FILE), JSON.stringify({ step: run.step, why: run.why }));
    if (kind === 'film') {
      const limitMs = ffmpegMs(io, ffmpegLimitMs(Date.now() - began));
      try {
        encode(io, dir, script, run.capture, ffmpeg, limitMs, run.step);
      } catch (error) {
        if (!(error instanceof Missing)) throw error;
        if (!error.timedOut) return none();
        keep(dir, run.capture, id);
        throw Object.assign(caused('outside', 'Give the dev container more CPU, then run film ' +
          `${id} again.`, `ffmpeg did not finish the film of ${id} up to step ${run.step} ` +
          `within ${Math.round(limitMs / 1000)} s.`), { keep: true });
      }
      dropFrames(dir, run.capture);
    }
    io.print([`Start demo-reviewer on step ${run.step} of ${id}, then record it.\n${run.why}.`],
      kind === 'film' ? `Filmed ${id} up to step ${run.step}: it failed in step ${run.step}.`
        : `Took ${plural(recorded.length, 'picture')} of ${id} before step ${run.step}: it ` +
          `failed in step ${run.step}.`);
    return 5;
  }

  // failedOf returns { step, why } of the file that failed wrote in dir, or null when dir has
  // none or it cannot be read.
  function failedOf(dir) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, FAILED_FILE), 'utf8'));
      return isObject(data) && Number.isInteger(data.step) ? data : null;
    } catch {
      return null;
    }
  }

  // filmOf runs the script of scenario `id` and stores its film or its pictures.
  function filmOf(io, id, given) {
    const began = Date.now();
    const root = artifactFolder(io);
    const serve = serveOf(io, given);
    if (!serve) {
      throw new Missing('Add a serve row with a command to ## Commands of the build plan, then ' +
        `plan the build again.\nThe build plan has no serve command, so ${id} has no app to run.`);
    }
    const script = checks.demoScripts(root, io).find((one) => one.scenario === id);
    if (!script) {
      throw new Missing(`Push the demo script of ${id}, then run film ${id} again.\nThe artifact ` +
        `folder has no demo script named ${id} that counts.`);
    }
    const kind = given.film ? 'film' : script.evidence;
    const arrow = kind === 'film'
      ? script.steps.findIndex((one) => one.title.includes('-->')) : -1;
    if (arrow >= 0) {
      // The title is the demo scenario's, so the script is at fault, and the session records the
      // step with the class script.
      io.print([`Change the Action of step ${arrow + 1} in the demo scenario so it has no ` +
        `"-->", then film it again.\nA cue of ${id}.vtt cannot hold "-->", which ends the cue ` +
        'in a player.'], `Stored no film: it failed in step ${arrow + 1}.`);
      return 1;
    }
    const ffmpeg = kind === 'film'
      ? findBrowser(io.env, (io.preflight || {}).ffmpegs || FFMPEG) : null;
    if (kind === 'film' && !ffmpeg) {
      throw caused('outside', 'Add ffmpeg to the dev container, then run film again.',
        `No ffmpeg exists on this machine, and ${id} has the evidence film.`);
    }
    browserOf(io);
    const dir = freshFolder(root, id);
    return cleaned(dir, () => {
      const capture = { kind, dir, name: id };
      const shorter = { ...io, preflight: { ...io.preflight,
        maxMs: Math.min((io.preflight || {}).maxMs || RUN_BUDGET_MS, RUN_BUDGET_MS) } };
      const again = kind === 'film' ? 'film it' : 'run it';
      const ran = checks.runScript(shorter, root, { serve, script, capture,
        keyFix: `Remove the key from the demo scripts, then run film ${id} again.` });
      const run = ended(ran, serve,
        `film ${id}`, () => new Missing(`Shorten the sign-in steps of ${id}.json, or make the ` +
          `app start faster, then ${again} again.\nThe ${START_MS / 1000} s for the app ` +
          'start, the sign-in and the browser ran out before the browser started.'));
      if (!run.ok) return failed(io, { dir, id, kind, script, run, ffmpeg, began });
      if (kind === 'film') {
        const limitMs = ffmpegMs(io, ffmpegLimitMs(Date.now() - began));
        let size;
        try {
          size = encode(io, dir, script, run.capture, ffmpeg, limitMs);
        } catch (error) {
          if (error.timedOut) return slow(io, dir, run.capture, id, limitMs);
          throw error;
        }
        if (size > limitOf(io)) return over(io, dir, run.capture, id, size);
        dropFrames(dir, run.capture);
        io.print([], `Filmed ${id}: ${plural(script.steps.length, 'step')} in ` +
          `${path.join(FOLDER, id, `${id}.mp4`)}, with the captions ${id}.vtt.`);
      } else {
        io.print([], `Took ${plural(run.capture.files.length, 'picture')} of ${id} in ` +
          `${path.join(FOLDER, id)}/, one for each step.`);
      }
      return 0;
    });
  }

  // framesOf takes the two pictures of each step of the film of scenario id.
  function framesOf(io, id) {
    const root = artifactFolder(io);
    const dir = path.join(root, FOLDER, id);
    const film = path.join(dir, `${id}.mp4`);
    const vtt = path.join(dir, `${id}.vtt`);
    if (!regular(film) || !regular(vtt)) {
      throw new Missing(`Run film ${id}, then run film frames ${id} again.\n${path.join(FOLDER, id)} ` +
        `has no ${id}.mp4 and ${id}.vtt.`);
    }
    const ffmpeg = findBrowser(io.env, (io.preflight || {}).ffmpegs || FFMPEG);
    if (!ffmpeg) {
      throw caused('outside', 'Add ffmpeg to the dev container, then run film frames again.',
        `No ffmpeg exists on this machine, and ${id} has a film.`);
    }
    const times = pictureTimes(cuesOf(fs.readFileSync(vtt, 'utf8')));
    const folder = path.join(dir, 'frames');
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder);
    const lines = [];
    const stopped = failedOf(dir);
    if (stopped) {
      lines.push(`The run failed in step ${stopped.step}: ${short(String(stopped.why), 300)}.`);
    }
    times.forEach((time, at) => {
      const names = [['start', time.start], ['reached', time.reached]].map(([which, ms]) => {
        const name = `step-${at + 1}-${which}.png`;
        const made = childProcess.spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error',
          '-ss', (ms / 1000).toFixed(3), '-i', film, '-frames:v', '1', path.join(folder, name)],
        { env: { PATH: io.env.PATH || '/usr/bin:/bin' }, encoding: 'utf8',
          timeout: FFMPEG_LEAST_MS * 6, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
        if (made.status !== 0 || !regular(path.join(folder, name))) {
          throw new Missing(`End the run: ffmpeg did not take ${name} of ${id}.\n` +
            `${short(String(made.stderr || '').trim().split('\n')[0] || 'no picture', 160)}`);
        }
        return `${name} at ${Math.round(ms)} ms`;
      });
      lines.push(`Step ${at + 1}: ${names.join(', ')}.`);
    });
    io.print(lines, `Took ${plural(times.length * 2, 'picture')} of ${id} in ` +
      `${path.join(FOLDER, id, 'frames')}/, two for each step.`);
    return 0;
  }

  // liveScenarios returns the ids of the scenarios of the approved demo scenarios that are not
  // removed, or null when the artifact folder has no approved version.
  function liveScenarios(context) {
    const version = approved(context, 'demo-scenarios', 'demo-scenarios.md');
    return version ? scenarios(version.text).filter((one) => one.id && !one.removed)
      .map((one) => one.id) : null;
  }

  // evidenceOf returns the data of the newest demo evidence of scenario id, or null for none, a
  // withdrawn one and one that is no JSON object.
  function evidenceOf(context, id) {
    const newest = newestNamed(context, 'demo-evidence', id, `${id}.json`);
    if (!newest) return null;
    try {
      const data = parseJson(newest.text, `demo-evidence ${id} version ${newest.number}`);
      return isObject(data) ? data : null;
    } catch {
      return null;
    }
  }

  // todoOf prints the scenarios to film and the artifacts to withdraw.
  function todoOf(io) {
    const root = artifactFolder(io);
    const head = git.head(io.cwd, io.env);
    if (!head) {
      throw new Missing('Run the verb in the checkout of the work.\ngit has no HEAD there.');
    }
    const context = new Context(root, 'check', io.home);
    const live = liveScenarios(context);
    if (!live) {
      throw new Missing('Pull the artifacts again.\nThe artifact folder has no approved demo ' +
        'scenarios.');
    }
    const film = live.filter((id) => {
      const version = context.counted('demo-script', id);
      if (version === null || context.withdrawn('demo-script', id)) return false;
      const evidence = evidenceOf(context, id);
      // A scenario that failed in the setup is filmed again, whatever the commit: a product or
      // script fault stands as the verdict of that commit.
      return !evidence || evidence.commit !== head || !isObject(evidence.script) ||
        evidence.script.version !== version ||
        (evidence.verdict === 'failed' && evidence.class === 'setup');
    });
    const withdraw = ['demo-evidence', 'demo-video', 'screenshot'].flatMap((type) =>
      (context.index ? context.index.artifacts : [])
        .filter((one) => isObject(one) && one.type === type && ID.test(one.name) &&
          !live.includes(one.name) && !context.withdrawn(type, one.name) &&
          context.counted(type, one.name) !== null)
        .map((one) => `${type} ${one.name}`));
    io.print([`To film: ${film.length ? film.join(', ') : 'none'}.`],
      `To withdraw: ${withdraw.length ? withdraw.join(', ') : 'none'}.`);
    return 0;
  }

  // recordOptions returns { review, media, klass, cause, step } of the arguments after the
  // scenario of film record, or { problem }. Exactly one form is complete.
  function recordOptions(args) {
    let rest = args;
    const got = {};
    for (const [key, flag] of [['review', '--review'], ['media', '--media'],
      ['klass', '--class'], ['cause', '--cause'], ['step', '--step']]) {
      const taken = takeValue(rest, flag);
      if (taken.value === null) return { problem: RECORD_USAGE };
      got[key] = taken.value;
      rest = taken.rest;
    }
    const whole = (text) => text === undefined || /^[1-9][0-9]{0,5}$/.test(text);
    const reviewed = got.review !== undefined &&
      [got.klass, got.cause, got.step].every((one) => one === undefined);
    const none = got.klass !== undefined && got.cause !== undefined &&
      [got.review, got.media].every((one) => one === undefined);
    if (rest.length || !(reviewed || none) || !whole(got.media) || !whole(got.step) ||
      (got.klass !== undefined && !CLASSES.includes(got.klass))) return { problem: RECORD_USAGE };
    return { ...got, media: got.media && Number(got.media), step: got.step && Number(got.step) };
  }

  // reviewOf returns the verdict of each step and the class from the report of demo-reviewer in
  // file, as { steps: [{ verdict, finding }], klass }, or { problem } with the fix first. With
  // stopped, the step that the run failed in, the report fails that step and does not reach the
  // later ones.
  function reviewOf(file, count, stopped) {
    const read = boundedText(file);
    if (read.why) {
      return { problem: `Save the report of demo-reviewer in a file of at most ${MAX_BYTES} ` +
        `bytes, then run film record again.\n${short(file, 80)} is no such file.` };
    }
    const steps = [];
    let klass = null;
    for (const line of read.text.split('\n')) {
      const step = /^Step ([1-9][0-9]?): (passed|failed|not-reached)(?:: (.+))?$/.exec(line);
      if (step && Number(step[1]) === steps.length + 1) {
        steps.push({ verdict: step[2], finding: step[3] });
      }
      const named = /^Class: (product|script|setup)$/.exec(line);
      if (named) klass = named[1];
    }
    const failed = steps.filter((one) => one.verdict === 'failed');
    if (steps.length !== count) {
      return { problem: 'Give the report one line for each step, in order.\nThe forms are ' +
        '"Step <N>: passed", "Step <N>: failed: <the finding>" and "Step <N>: not-reached". ' +
        `The script has ${plural(count, 'step')}, and the report has ` +
        `${plural(steps.length, 'such line')}.` };
    }
    if (failed.some((one) => !one.finding) || (failed.length && !klass)) {
      return { problem: 'Give each failed step a finding and the report a class line.\n' +
        'The forms are "Class: product", "Class: script" and "Class: setup". The report lacks ' +
        'one of them.' };
    }
    if (stopped && (stopped > steps.length || steps[stopped - 1].verdict !== 'failed' ||
      steps.slice(stopped).some((one) => one.verdict !== 'not-reached'))) {
      return { problem: `Report step ${stopped} as failed and each later step as not-reached.\n` +
        `The run failed in step ${stopped}.` };
    }
    return { steps, klass };
  }

  // recordOf writes the demo evidence of scenario id, from the arguments that recordOptions
  // returns in given.
  function recordOf(io, id, given) {
    const root = artifactFolder(io);
    const head = git.head(io.cwd, io.env);
    if (!head) {
      throw new Missing('Run the verb in the checkout of the work.\ngit has no HEAD there.');
    }
    const script = checks.demoScripts(root, io).find((one) => one.scenario === id);
    if (!script) {
      throw new Missing(`Push the demo script of ${id}, then run film record ${id} again.\n` +
        `The artifact folder has no demo script named ${id} that counts.`);
    }
    const version = new Context(root, 'check', io.home).counted('demo-script', id);
    const dir = path.join(root, FOLDER, id);
    const stopped = failedOf(dir);
    let steps;
    let evidence = 'none';
    let verdict = 'failed';
    let klass = given.klass;
    let media = null;
    if (given.review === undefined) {
      const failed = given.step || script.steps.length;
      if (failed > script.steps.length) {
        io.print([`Give --step a step of ${id}.\n${id} has ${plural(script.steps.length, 'step')}.`],
          'Wrote no demo evidence.');
        return 1;
      }
      steps = script.steps.map((_, at) => ({ verdict: at + 1 < failed ? 'passed'
        : at + 1 === failed ? 'failed' : 'not-reached',
      finding: at + 1 === failed ? given.cause : undefined }));
    } else {
      const reviewed = reviewOf(path.resolve(io.cwd, given.review), script.steps.length,
        stopped && stopped.step);
      if (reviewed.problem) {
        io.print([reviewed.problem], 'Wrote no demo evidence.');
        return 1;
      }
      ({ steps, klass } = reviewed);
      verdict = steps.every((one) => one.verdict === 'passed') ? 'passed' : 'failed';
      // The film or the pictures of a run that failed in a step are for the review only: the
      // session pushes none, and the evidence has none.
      if (stopped ? given.media !== undefined : given.media === undefined) {
        io.print([stopped ? `Leave out --media.\nThe run of ${id} failed in step ${stopped.step}, ` +
          'and the session pushes no film or pictures of it.'
          : `Give --media the version of the film or pictures that the session pushed.\n${id} ` +
            'has files to push, and the evidence needs their version.'], 'Wrote no demo evidence.');
        return 1;
      }
      if (!stopped) {
        evidence = regular(path.join(dir, `${id}.mp4`)) ? 'film'
          : regular(path.join(dir, `${id}-step-1.png`)) ? 'pictures' : null;
        if (!evidence) {
          throw new Missing(`Run film ${id}, then run film record ${id} again.\n` +
            `${path.join(FOLDER, id)} has no film and no pictures.`);
        }
        media = { type: evidence === 'film' ? 'demo-video' : 'screenshot', name: id,
          version: given.media };
      }
    }
    const times = evidence === 'film'
      ? pictureTimes(cuesOf(fs.readFileSync(path.join(dir, `${id}.vtt`), 'utf8'))) : [];
    const data = { scenario: id, title: script.title, commit: head, planned: script.evidence,
      evidence, verdict, ...(verdict === 'failed' ? { class: klass } : {}),
      script: { type: 'demo-script', name: id, version }, ...(media ? { media } : {}),
      steps: script.steps.map((step, at) => ({ step: at + 1, title: step.title,
        expected: step.expected, verdict: steps[at].verdict,
        frames: evidence === 'film' && times[at]
          ? [{ at: 'start', time_ms: Math.round(times[at].start) },
            { at: 'reached', time_ms: Math.round(times[at].reached) }]
          : evidence === 'pictures' ? [{ at: 'reached', file: `${id}-step-${at + 1}.png` }] : [],
        ...(steps[at].finding ? { finding: steps[at].finding } : {}) })) };
    const found = schema.errors(schema.load(SCHEMAS, 'demo-evidence'), data, `${id}.json`);
    if (found.length) {
      io.print([`Fix the input of film record ${id}.\nThe evidence breaks its schema: ` +
        `${short(found[0].split('\n')[0], 120)}`], 'Wrote no demo evidence.');
      return 1;
    }
    writeJson(path.join(root, `${id}.json`), data);
    io.print([], `Wrote ${id}.json, the demo evidence of ${id}: ${verdict}, evidence ` +
      `${evidence}.`);
    return 0;
  }

  // pagesOf takes the pictures of the pages that paths open.
  function pagesOf(io, paths, given) {
    const root = artifactFolder(io);
    const serve = serveOf(io, given);
    if (!serve) {
      throw new Missing('Add a serve row with a command to ## Commands of the build plan, then ' +
        'plan the build again.\nThe build plan has no serve command, so there is no app to open.');
    }
    const outside = paths.find((one) => !one.startsWith('/') || !within(one, serve.url));
    if (outside) {
      io.print([`Open only pages under ${cut(serve.url, 60)}, as paths that start with /.\n` +
        `${short(outside, 80)} is no such page.`], 'Took no pictures of pages.');
      return 1;
    }
    const first = checks.demoScripts(root, io)[0];
    const script = { scenario: 'pages', setup: first ? first.setup : [], steps: paths.map(
      (url) => ({ actions: [{ do: 'open', url }] })) };
    browserOf(io);
    const dir = freshFolder(root, 'pages');
    return cleaned(dir, () => {
      const capture = { kind: 'pages', dir, name: 'pages', widths: WIDTHS };
      const ran = checks.runScript(io, root, { serve, script, capture,
        keyFix: 'Remove the key from the demo scripts, then run film pages again.' });
      const run = ended(ran, serve, 'film pages');
      if (!run.ok) {
        fs.rmSync(dir, { recursive: true, force: true });
        return failure(io, run, 'pictures of pages', 'film pages');
      }
      io.print([], `Took ${plural(run.capture.files.length, 'picture')} of ` +
        `${plural(paths.length, 'page')} in ${path.join(FOLDER, 'pages')}/ at ` +
        `${WIDTHS.join(', ')} px: pages-<N>-<width>.png is the Nth path.`);
      return 0;
    });
  }

  return {
    film: {
      usage: ['film <scenario> [--film] [--inputs <path>] [--artifacts <folder>]',
        'film recode <scenario>', 'film frames <scenario>', 'film todo',
        'film record <scenario> --review <file> [--media <N>]',
        'film record <scenario> --class <class> --cause <text> [--step <N>]',
        'film pages <path>... [--inputs <path>] [--artifacts <folder>]'],
      args: (io, what, rest) => {
        const given = options([what, ...rest].filter((one) => one !== undefined));
        if (given.problem) return given.problem;
        const [first, ...paths] = given.rest;
        if (given.film && !(given.rest.length === 1 && ID.test(first))) return USAGE;
        if (first === 'pages' ? paths.length > 0 : given.rest.length === 1 && ID.test(first)) {
          return null;
        }
        if (['recode', 'frames'].includes(first) && paths.length === 1 && ID.test(paths[0])) {
          return null;
        }
        if (first === 'todo' && !paths.length && given.rest.length === 1) return null;
        if (first === 'record' && ID.test(paths[0] || '')) {
          return recordOptions(paths.slice(1)).problem || null;
        }
        return USAGE;
      },
      run: (io, what, rest) => {
        const given = options([what, ...rest].filter((one) => one !== undefined));
        const [first, ...paths] = given.rest;
        if (first === 'recode') return recodeOf(io, paths[0]);
        if (first === 'frames') return framesOf(io, paths[0]);
        if (first === 'todo') return todoOf(io);
        if (first === 'record') return recordOf(io, paths[0], recordOptions(paths.slice(1)));
        return first === 'pages' ? pagesOf(io, paths, given) : filmOf(io, first, given);
      },
    },
  };
};
module.exports.FFMPEG_MS = FFMPEG_MS;
module.exports.ffmpegLimitMs = ffmpegLimitMs;
module.exports.FRAMES_PER_SECOND = FRAMES_PER_SECOND;
module.exports.ffmpegArguments = ffmpegArguments;
module.exports.captions = captions;
module.exports.rateCap = rateCap;
module.exports.cuesOf = cuesOf;
module.exports.pictureTimes = pictureTimes;
module.exports.passesOf = passesOf;
module.exports.encodedSize = encodedSize;
module.exports.stamp = stamp;
