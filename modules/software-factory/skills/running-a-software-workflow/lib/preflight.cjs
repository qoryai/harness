// The preflight: before a session changes code, it checks the parts of the dev container
// that a demo of the app needs, and writes a point run_again with its fix for each part that
// is missing, so that the session ends with escalate (checks.cjs end):
// 1. a browser: the first of BROWSERS of lib/browser.cjs that exists;
// 2. the app: the serve command of the build plan starts it, and a GET of the address of
//    the line "App address:" in the Summary of the plan returns a response;
// 3. the sign-in: each setup of the demo scripts that types a variable passes once in the
//    browser, with the values of the variables in the environment.
// With no serve command, it checks no app and no sign-in. The sign-in needs the browser and
// the app, so with either missing it checks no sign-in. lib/preflight-run.cjs runs parts 2
// and 3, which wait for the app and the browser.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { findBrowser } = require('./browser.cjs');
const { ACTION_MS, SIGNED_IN_MS, signInSetups } = require('./replay.cjs');
const schema = require('./schema.cjs');

const RUNNER = path.join(__dirname, 'preflight-run.cjs');

// The time for the address of the app to return a response after the serve command starts.
const START_MS = 120000;
// The most time that an open action waits for its page, as lib/browser.cjs has it, the time
// of a press, and the time to start the browser and open a page for a sign-in.
const OPEN_MS = 15000;
const PRESS_MS = 1000;
const PAGE_MS = 15000;

// signInMs returns the most time that the replay of actions may take, by the limit of each
// action, with the time after the last action and the time to open its page.
const signInMs = (actions, actionMs, signedInMs) => PAGE_MS + signedInMs +
  actions.reduce((sum, one) => sum + ({ open: OPEN_MS, press: PRESS_MS }[one.do] ||
    (one.do === 'wait' && one.timeout_ms) || actionMs), 0);

// The texts of the points. A text with a value of the run, such as the serve command, takes
// the words of its fallback when the value would break the rules of a point, as a value with
// a Markdown mark or a full stop does.
const TEXTS = {
  browser: () => ({
    text: 'The dev container has no browser, so the run could not open the app.',
    fix: 'Add a browser to .devcontainer/devcontainer.json, then run another round.',
  }),
  app: (command) => ({
    text: 'The app did not start in the dev container, so the run stopped before it changed ' +
      'anything.',
    fix: `Make ${command} start the app in the dev container, then run another round.`,
  }),
  signIn: (names) => ({
    text: `The run could not sign in to the app with the values of ${names} in the ` +
      'workspace\'s variables.',
    fix: 'Ask a workspace owner or admin to correct the app\'s sign-in variables in Workspace ' +
      'settings > Secrets and variables, then run another round.',
  }),
};
// The first line of the finding of each part: the step for the session, within 100
// characters, where the fix of a point may be longer.
const FIRST = {
  browser: 'End the session with points.json: the dev container has no browser.',
  app: 'End the session with points.json: the app did not start in the dev container.',
  signIn: 'End the session with points.json: the sign-in to the app failed.',
};
const FALLBACK = {
  app: 'the serve command of the build plan',
  signIn: 'the sign-in variables of the demo scripts',
};

// joined returns names as words: A, A and B, or A, B and C.
const joined = (names) => (names.length < 2 ? names.join('')
  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

module.exports = (lib) => {
  const { Context, Missing, Run, agentNames, isObject, lacks, parseJson, plural, pointCheck,
    pointRules, readFile, writeJson, MAX_POINTS } = lib;

  // rulesOf returns the agents and the rules that the check of a point reads.
  function rulesOf(io) {
    let registry = {};
    try {
      registry = io.registry ? io.registry() : {};
    } catch (error) {
      if (!(error instanceof Missing)) throw error;
    }
    return { agents: io.plugin ? agentNames(io.plugin) : new Set(), rules: pointRules(registry) };
  }

  // passes reports whether point passes the check of a point.
  function passes(point, checks) {
    const run = new Run(null);
    pointCheck(run, point, 1, new Set(), checks.agents, checks.rules);
    return !run.findings.length;
  }

  // pointOf returns the point run_again of kind, filled with value, or with the fallback words
  // of kind when value breaks the rules of a point.
  function pointOf(kind, value, checks) {
    const point = { ...TEXTS[kind](value), action: 'run_again' };
    if (value === undefined || passes(point, checks)) {
      return { text: point.text, action: 'run_again', fix: point.fix };
    }
    const other = TEXTS[kind](FALLBACK[kind]);
    return { text: other.text, action: 'run_again', fix: other.fix };
  }

  // demoScripts returns the demo script of each scenario of the artifact folder root, in the
  // order of the scenarios: of each name scenario-<N> of demo-script in index.json that is not
  // withdrawn, the newest version that counts, as lib/plan.cjs reads the build plan. A version folder that index.json does not list, such as one that an earlier pull
  // left, decides nothing. A store that lacks the folder of that version, and a script that
  // breaks its schema, throw Missing.
  function demoScripts(root, io) {
    const context = new Context(root, 'check', io.home);
    if (!context.index) return [];
    const names = [...new Set(context.index.artifacts
      .filter((one) => isObject(one) && one.type === 'demo-script')
      .map((one) => one.name || 'main'))]
      .filter((name) => /^scenario-[1-9][0-9]?$/.test(name) &&
        !context.withdrawn('demo-script', name));
    names.sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
    const scripts = [];
    for (const name of names) {
      const number = context.counted('demo-script', name);
      if (number === null) continue;
      const dir = path.join(root, 'demo-script', name, `v${number}`);
      if (!fs.existsSync(dir)) throw lacks('demo-script', number);
      const words = `demo-script ${name} version ${number}`;
      const file = path.join(dir, `${name}.json`);
      if (!fs.existsSync(file)) {
        throw new Missing(`Pull the artifacts again.\ndemo-script/${name}/v${number} has no ` +
          `${name}.json.`);
      }
      const data = parseJson(readFile(file, words), words, null);
      const found = schema.errors(schema.load('demo-script'), data, `${name}.json`);
      if (found.length) {
        throw new Missing(`Push a demo script of ${name} that passes its check, then pull it.`,
          [`${words} breaks its schema: ${found[0].split('\n')[0]}`]);
      }
      scripts.push(data);
    }
    return scripts;
  }

  // waited runs lib/preflight-run.cjs on spec and returns its result.
  function waited(io, spec, limitMs) {
    const ran = childProcess.spawnSync(process.execPath, [RUNNER], {
      input: JSON.stringify(spec), env: io.env, encoding: 'utf8', timeout: limitMs,
      killSignal: 'SIGTERM', maxBuffer: 1024 * 1024,
    });
    const line = String(ran.stdout || '').trim().split('\n').pop();
    try {
      return JSON.parse(line);
    } catch {
      const why = ran.error ? ran.error.message : `it exited with ${ran.status}`;
      throw new Missing('Run preflight again: the check of the app and the sign-in returned no ' +
        `result.\nThe runner ${why}. ${String(ran.stderr || '').trim().split('\n').pop() || ''}`);
    }
  }

  // savePoints writes points to points.json of root, after each point of a points.json there
  // whose text differs from theirs, at most MAX_POINTS in all. check points judges the points
  // that it keeps, an answer point with its open question too.
  function savePoints(root, points) {
    const file = path.join(root, 'points.json');
    let kept = [];
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(list)) {
        kept = list.filter((one) => one && typeof one === 'object' &&
          !points.some((point) => point.text === one.text));
      }
    } catch {
      // No points.json, or one that cannot be read: the new points take its place.
    }
    writeJson(file, [...kept, ...points].slice(-MAX_POINTS));
  }

  // preflight checks the parts and returns { status, findings, last, points }. root is the
  // artifact folder of the session, which gets points.json and the log of the serve command.
  // serve is null, or { command, url, cwd } of the build plan. scripts are the demo scripts.
  // io.preflight may set browsers, the paths and names to look for, and the times startMs,
  // actionMs and signedInMs.
  function preflight(io, root, { serve, scripts }) {
    const options = io.preflight || {};
    const checks = rulesOf(io);
    const browser = findBrowser(io.env, options.browsers);
    const setups = serve ? signInSetups(scripts) : [];
    const found = [];
    const did = ['the browser'];
    if (!browser) found.push({ kind: 'browser', why: 'No browser such as /usr/bin/chromium ' +
      'exists on this machine.' });
    let log = null;
    if (serve) {
      did.push('the app');
      log = path.join(root, '.reports', 'preflight', 'serve.log');
      fs.mkdirSync(path.dirname(log), { recursive: true });
      const startMs = options.startMs || START_MS;
      const actionMs = options.actionMs || ACTION_MS;
      const signedInMs = options.signedInMs || SIGNED_IN_MS;
      // The time of the start, of each sign-in by its actions, and of the stop of the app.
      const limitMs = startMs + 30000 + setups.reduce((sum, setup) =>
        sum + signInMs(setup.actions, actionMs, signedInMs), 0);
      const result = waited(io, {
        serve: { command: serve.command, url: serve.url, cwd: serve.cwd, log },
        browser, setups: setups.map(({ actions, names }) => ({ actions, names })),
        startMs, actionMs, signedInMs,
      }, limitMs);
      if (!result.app.started) {
        found.push({ kind: 'app', value: serve.command,
          why: `${result.app.why}. The output of the command is in ${log}.` });
      } else if (browser && setups.length) {
        did.push('the sign-in');
        const failed = setups.filter((setup, at) => !result.signIns[at].ok);
        if (failed.length) {
          const names = [...new Set(failed.flatMap((setup) => setup.names))];
          const whys = setups.map((setup, at) => result.signIns[at])
            .filter((one) => !one.ok).map((one) => one.why);
          found.push({ kind: 'signIn', value: joined(names),
            why: `The sign-in of ${joined(failed.flatMap((one) => one.scenarios))} failed: ` +
              `${[...new Set(whys)].join('; ')}.` });
        }
      }
    }
    const checked = `Checked ${joined(did)}`;
    if (!found.length) {
      const signIn = !serve ? ', and no app or sign-in: the build plan has no serve command'
        : !setups.length ? ', and no sign-in: no demo script types a variable in its setup'
          : '';
      return { status: 0, findings: [], points: [], last: `${checked}: each part is there` +
        `${signIn}.` };
    }
    const points = found.map((one) => pointOf(one.kind, one.value, checks));
    savePoints(root, points);
    const findings = found.map((one, at) => `${FIRST[one.kind]}\n${one.why}\n` +
      `The fix of its point: ${points[at].fix}`);
    return { status: 1, findings, points, last: `${checked}: ${found.length} of ` +
      `${plural(did.length, 'part')} ${found.length === 1 ? 'is' : 'are'} missing, and ` +
      'points.json has a point run_again for each.' };
  }

  return { preflight, demoScripts, pointOf, joined, signInMs };
};
