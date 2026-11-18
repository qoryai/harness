// The replay of the actions of a demo script (schemas/demo-script.schema.json) in a Page of
// lib/browser.cjs: open, click, type, press and wait. The preflight replays the setup of the
// demo scripts with signIn; a script that films a demo can replay its setup and steps with
// replay.
'use strict';

const { originOf } = require('./browser.cjs');

// The time that click and type wait for their target, and wait for its text when the action
// sets no timeout_ms.
const ACTION_MS = 5000;
// The time after the last action of a sign-in for the fields of the variables to go.
const SIGNED_IN_MS = 10000;

// describe returns the words of an action for a reason, with no value that the action types:
// "action 3 (type into #password)".
function describe(action, place) {
  const what = {
    open: () => `open ${action.url}`,
    click: () => `click ${action.target}`,
    type: () => `type into ${action.target}`,
    press: () => `press ${action.key}`,
    wait: () => 'wait for a text',
  }[action.do];
  return `action ${place + 1} (${what ? what() : action.do})`;
}

// replay runs actions in order in page. base is the address that a relative url of open is
// read against, and env has the value of each variable of a type action. With origin set, an
// open of an address of another origin fails before the page opens it, and an action fails
// once the page has failed a load of another origin, as page.outside shows. It returns
// { done, failure }: done counts the actions that passed, and failure is null, or
// { place, action, why, words, outside } for the first action that failed, where outside is
// the other origin, or null. A why contains no typed value.
async function replay(page, actions, { base, env = {}, actionMs = ACTION_MS, origin } = {}) {
  for (const [place, action] of actions.entries()) {
    const fail = (why, outside = null) => ({ done: place, failure: { place, action, why,
      words: `${describe(action, place)} failed: ${why}`, outside } });
    const left = () => fail(`the page opened ${page.outside}, outside the app`, page.outside);
    if (origin && page.outside) return left();
    try {
      if (action.do === 'open') {
        const url = new URL(action.url, base);
        if (origin && url.origin !== origin) {
          return fail(`the address is outside the app, whose origin is ${origin}`,
            originOf(url.href));
        }
        await page.goto(url.href);
      } else if (action.do === 'click') {
        await page.click(action.target, actionMs);
      } else if (action.do === 'type') {
        const value = action.variable === undefined ? action.text : env[action.variable];
        if (typeof value !== 'string' || (action.variable !== undefined && !value)) {
          return fail(`the variable ${action.variable} has no value`);
        }
        await page.type(action.target, value, actionMs);
      } else if (action.do === 'press') {
        await page.press(action.key);
      } else if (action.do === 'wait') {
        await page.waitText(action.text, action.timeout_ms || actionMs);
      } else {
        return fail('the action is none of open, click, type, press and wait');
      }
    } catch (error) {
      if (origin && page.outside) return left();
      return fail(String((error && error.message) || error).split('\n')[0]);
    }
  }
  return { done: actions.length, failure: null };
}

// variablesOf returns the names of the variables that actions type, each once, in order.
function variablesOf(actions) {
  return [...new Set(actions.filter((one) => one.do === 'type' && one.variable !== undefined)
    .map((one) => one.variable))];
}

// signIn replays the actions of a setup in page, a Page with the origin of base, the address
// of the app, and returns { ok, why, outside }. A load of a document of another origin, by
// an open, a redirect, a link or a script, fails the sign-in, outside is that origin, and the
// replay stops there, so no later action types a value of a variable into that page. The
// sign-in passes when each action passes and, unless the last action is a wait, which
// already shows the page after the sign-in, each field that a variable was typed into is
// gone from the page within signedInMs: a sign-in that fails shows its form again.
async function signIn(page, actions, { base, env, actionMs = ACTION_MS,
  signedInMs = SIGNED_IN_MS } = {}) {
  const origin = new URL(base).origin;
  const done = await replay(page, actions, { base, env, actionMs, origin });
  if (done.failure) return { ok: false, why: done.failure.words, outside: done.failure.outside };
  const last = actions[actions.length - 1];
  const gone = !last || last.do === 'wait' || await page.poll(async () => {
    for (const target of new Set(actions.filter((one) => one.do === 'type' &&
      one.variable !== undefined).map((one) => one.target))) {
      if (await page.visible(target)) return null;
    }
    return true;
  }, signedInMs);
  if (page.outside) {
    return { ok: false, why: `the page opened ${page.outside}, outside the app, after the ` +
      'last action', outside: page.outside };
  }
  if (gone) return { ok: true, why: null, outside: null };
  return { ok: false, why: `the page still showed a field that a variable was typed into ` +
    `${signedInMs / 1000} s after the last action`, outside: null };
}

// signInSetups returns the setups of scripts, the demo scripts, that type a variable: each
// setup once, with its scenarios and the names of its variables, in the order of scripts. A
// setup that types no variable is no sign-in.
function signInSetups(scripts) {
  const setups = new Map();
  for (const script of scripts) {
    const names = variablesOf(script.setup || []);
    if (!names.length) continue;
    const key = JSON.stringify(script.setup);
    if (!setups.has(key)) setups.set(key, { actions: script.setup, names, scenarios: [] });
    setups.get(key).scenarios.push(script.scenario);
  }
  return [...setups.values()];
}

module.exports = { ACTION_MS, SIGNED_IN_MS, replay, signIn, signInSetups, variablesOf };
