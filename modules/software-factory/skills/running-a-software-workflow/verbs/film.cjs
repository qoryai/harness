// film: the evidence of a demo scenario, one film or one set of pictures, from the pushed
// demo script of the scenario.
//
//   film <scenario> [--inputs <path>] [--artifacts <folder>]
//                         runs the newest demo script of the scenario that counts, in
//                         <folder>/.film/<scenario>/. The runner of preflight starts the app of
//                         the build plan at its App address, in a new window of 1280 x 720 px,
//                         and replays the setup as a sign-in. With the evidence film, it then
//                         records the page from the start of step 1 to the last action, and
//                         ffmpeg makes <scenario>.mp4 and <scenario>.vtt, whose cue of each
//                         step starts at the start of that step. With the evidence pictures,
//                         it runs with video off and writes <scenario>-step-<N>.png, the page
//                         after step N. It exits 0, and prints a line that names the files. A
//                         failed step stores nothing, and exits 1 with the fix first.
//   film pages <path>... [--inputs <path>] [--artifacts <folder>]
//                         takes pictures of the pages that the paths open, for the two screen
//                         reviewers: pages-<N>-<width>.png in <folder>/.film/pages/ for the
//                         Nth path, at the widths 360, 768 and 1280 px. The setup of the first
//                         demo script that counts is the sign-in, if there is one.
//
// A call takes one scenario, and ends within CALL_MS of lib/budget.cjs, 585 s: the runner ends
// within RUN_BUDGET_MS, 535 s, 15 s more at the latest, and the encode takes ENCODE_MS, 35 s.
// The verb stores nothing in Qory Apiary, writes no demo evidence and no ledger row: the
// session pushes the files. Exit 3 means that an input is missing, that ffmpeg or the browser
// is missing, or that the app, the browser or ffmpeg did not run.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { findBrowser } = require('../lib/browser.cjs');
const { CALL_MS, RUN_BUDGET_MS } = require('../lib/budget.cjs');
const { FILM_HEIGHT } = require('../lib/capture.cjs');
const { takeInputs, takeValue } = require('../lib/limits.cjs');
const { ARTIFACTS_USAGE } = require('../lib/start.cjs');
const { INPUTS_USAGE } = require('./run.cjs');

const FOLDER = '.film';
const WIDTHS = [360, 768, 1280];
const ID = /^scenario-[1-9][0-9]?$/;
const FRAME = /^f[0-9]{6}\.jpg$/;
const USAGE = 'Give film with a scenario id, or film pages with one path or more.';
// The path of ffmpeg in the image of qory, which apt installs, and the name for the PATH.
const FFMPEG = ['/usr/bin/ffmpeg', 'ffmpeg'];
// The most time of ffmpeg, and the least: ffmpegLimitMs gives it what is left of CALL_MS.
const FFMPEG_MS = 90000;
const FFMPEG_LEAST_MS = 5000;
const FRAMES_PER_SECOND = 25;

// ffmpegArguments returns the arguments of ffmpeg that make <id>.mp4.tmp from frames.txt, the
// list of frames, with the last frame held for hold seconds.
const ffmpegArguments = (id, hold) => ['-y', '-hide_banner', '-loglevel', 'error', '-f',
  'concat', '-i', 'frames.txt', '-vf', `fps=${FRAMES_PER_SECOND},tpad=stop_mode=clone:` +
  `stop_duration=${hold},scale=1280:${FILM_HEIGHT},format=yuv420p`, '-c:v', 'libx264',
  '-preset', 'veryfast', '-movflags', '+faststart', '-an', '-f', 'mp4', `${id}.mp4.tmp`];

// ffmpegLimitMs returns the time for ffmpeg when the call has run for spent ms: what is left
// of CALL_MS, at most FFMPEG_MS and at least FFMPEG_LEAST_MS.
const ffmpegLimitMs = (spent) => Math.max(Math.min(FFMPEG_MS, CALL_MS - spent), FFMPEG_LEAST_MS);

// stamp returns ms as a WebVTT time, 00:00:03.250.
function stamp(ms) {
  const part = (value, size) => String(Math.floor(value)).padStart(size, '0');
  return `${part(ms / 3600000, 2)}:${part((ms / 60000) % 60, 2)}:${part((ms / 1000) % 60, 2)}.` +
    `${part(ms % 1000, 3)}`;
}

// cueText returns text for a WebVTT cue: & < and > are escaped, so that the text holds no tag
// and no --> that ends the cue.
const cueText = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

// captions returns the WebVTT file of script: one cue per step, from the start of the step to
// the start of the next, and the last to the end of the film.
function captions(script, capture) {
  const cues = script.steps.map((step, at) => {
    const start = capture.starts[at];
    const end = at + 1 < capture.starts.length ? capture.starts[at + 1] : capture.end;
    return `${at + 1}\n${stamp(start)} --> ${stamp(Math.max(end, start + 1))}\n${cueText(step.title)}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

module.exports = (lib) => {
  const { Missing, artifactFolder, cut, plural, short, within } = lib;
  const checks = require('../lib/preflight.cjs')(lib);

  // options returns { inputs, artifacts, rest } of the arguments, each undefined when it is not
  // given, or { problem }, the line of wrong arguments.
  function options(args) {
    const { inputs, rest: other } = takeInputs(args);
    if (inputs === null) return { problem: INPUTS_USAGE };
    const { value: artifacts, rest } = takeValue(other, '--artifacts');
    if (artifacts === null) return { problem: ARTIFACTS_USAGE };
    return { inputs, artifacts, rest };
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

  // browserOf throws the Missing of a machine that has no browser.
  function browserOf(io) {
    if (!findBrowser(io.env, (io.preflight || {}).browsers)) {
      throw new Missing('Add a browser to the dev container, then run preflight again.\nNo ' +
        'browser such as /usr/bin/chromium exists on this machine.');
    }
  }

  // cleaned returns work(), and removes dir, the new folder of the call, when work throws.
  function cleaned(dir, work) {
    try {
      return work();
    } catch (error) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }

  // ended throws the Missing of a run that has no result, or returns the result run. again is
  // the command that the fix repeats.
  function ended(ran, serve, again) {
    if (!ran.app.started) {
      throw new Missing(`Make ${short(serve.command, 40)} start the app in the dev container, ` +
        `then run ${again} again.\nThe app did not start: ${ran.app.why}.`);
    }
    if (!ran.run || ran.run.browser) {
      throw new Missing('End the run: the browser did not finish the script.\n' +
        `${ran.run ? ran.run.why : 'The runner returned no result'}.`);
    }
    return ran.run;
  }

  // failure prints the finding of a run that failed in a step, with the fix first, and returns 1.
  function failure(io, run, what, again) {
    const where = run.step === 0 ? 'the sign-in' : `step ${run.step}`;
    io.print([`Check ${where} against the app, then run ${again} again.\n${run.why}.`],
      `Stored no ${what}: it failed in ${where}.`);
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

  // encode makes <scenario>.mp4 and <scenario>.vtt in dir from the frames of capture, and
  // removes the frames.
  function encode(io, dir, script, capture, ffmpeg, limitMs) {
    const id = script.scenario;
    if (!capture || capture.kind !== 'film' || !Array.isArray(capture.frames) ||
      !capture.frames.length || !Array.isArray(capture.starts) ||
      capture.starts.length !== script.steps.length || !Number.isFinite(capture.end)) {
      throw new Missing(`End the run: the runner stored no film of ${id}.\nIts result has no ` +
        'frames or no start of each step.');
    }
    const list = path.join(dir, 'frames.txt');
    fs.writeFileSync(list, concat(dir, capture), { flag: 'wx' });
    const film = path.join(dir, `${id}.mp4`);
    // The last frame lasts one frame by itself, and then stays until the end of the film.
    const hold = Math.max((capture.end - capture.frames[capture.frames.length - 1].at) / 1000 -
      1 / FRAMES_PER_SECOND, 0).toFixed(3);
    const made = childProcess.spawnSync(ffmpeg, ffmpegArguments(id, hold), { cwd: dir,
      env: { PATH: io.env.PATH || '/usr/bin:/bin' }, encoding: 'utf8', timeout: limitMs,
      killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    if (made.status !== 0) {
      const why = String(made.stderr || '').trim().split('\n')[0] || (made.error
        ? made.error.code || made.error.message : `exit ${made.status}`);
      throw new Missing(`End the run: ffmpeg did not make the film of ${id}.\n${short(why, 160)}`);
    }
    place(`${film}.tmp`, film);
    const text = path.join(dir, `${id}.vtt`);
    fs.writeFileSync(`${text}.tmp`, captions(script, capture), { flag: 'wx' });
    place(`${text}.tmp`, text);
    for (const one of [list, ...capture.frames.map((frame) => path.join(dir, frame.file))]) {
      fs.rmSync(one, { force: true });
    }
  }

  // filmOf runs the script of scenario `id` and stores its film or its pictures.
  function filmOf(io, id, given) {
    const began = Date.now();
    const root = artifactFolder(io);
    const serve = checks.serveOf(io, given);
    if (!serve) {
      throw new Missing('Add a serve row with a command to ## Commands of the build plan, then ' +
        `plan the build again.\nThe build plan has no serve command, so ${id} has no app to run.`);
    }
    const script = checks.demoScripts(root, io).find((one) => one.scenario === id);
    if (!script) {
      throw new Missing(`Push the demo script of ${id}, then run film ${id} again.\nThe artifact ` +
        `folder has no demo script named ${id} that counts.`);
    }
    const ffmpeg = script.evidence === 'film'
      ? findBrowser(io.env, (io.preflight || {}).ffmpegs || FFMPEG) : null;
    if (script.evidence === 'film' && !ffmpeg) {
      throw new Missing('Add ffmpeg to the dev container, then run film again.\nNo ffmpeg exists ' +
        `on this machine, and ${id} has the evidence film.`);
    }
    browserOf(io);
    const dir = freshFolder(root, id);
    return cleaned(dir, () => {
      const capture = { kind: script.evidence, dir, name: id };
      const shorter = { ...io, preflight: { ...io.preflight,
        maxMs: Math.min((io.preflight || {}).maxMs || RUN_BUDGET_MS, RUN_BUDGET_MS) } };
      const run = ended(checks.runScript(shorter, root, { serve, script, capture }), serve,
        `film ${id}`);
      if (!run.ok) {
        fs.rmSync(dir, { recursive: true, force: true });
        return failure(io, run, script.evidence === 'film' ? 'film' : 'pictures', `film ${id}`);
      }
      if (script.evidence === 'film') {
        encode(io, dir, script, run.capture, ffmpeg, ffmpegLimitMs(Date.now() - began));
        io.print([], `Filmed ${id}: ${plural(script.steps.length, 'step')} in ` +
          `${path.join(FOLDER, id, `${id}.mp4`)}, with the captions ${id}.vtt.`);
      } else {
        io.print([], `Took ${plural(run.capture.files.length, 'picture')} of ${id} in ` +
          `${path.join(FOLDER, id)}/, one for each step.`);
      }
      return 0;
    });
  }

  // pagesOf takes the pictures of the pages that paths open.
  function pagesOf(io, paths, given) {
    const root = artifactFolder(io);
    const serve = checks.serveOf(io, given);
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
      const run = ended(checks.runScript(io, root, { serve, script, capture }), serve,
        'film pages');
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
      usage: ['film <scenario> [--inputs <path>] [--artifacts <folder>]',
        'film pages <path>... [--inputs <path>] [--artifacts <folder>]'],
      args: (io, what, rest) => {
        const given = options([what, ...rest].filter((one) => one !== undefined));
        if (given.problem) return given.problem;
        const [first, ...paths] = given.rest;
        if (first === 'pages' ? paths.length > 0 : given.rest.length === 1 && ID.test(first)) {
          return null;
        }
        return USAGE;
      },
      run: (io, what, rest) => {
        const given = options([what, ...rest].filter((one) => one !== undefined));
        const [first, ...paths] = given.rest;
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
module.exports.stamp = stamp;
