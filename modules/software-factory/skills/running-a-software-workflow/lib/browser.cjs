// A headless browser that runs the pages of an app, driven through the Chrome DevTools
// protocol on a pipe (--remote-debugging-pipe), with no npm package. The preflight replays the
// sign-in of the demo scripts with it, and a script that films a demo can use it too.
//
// Unlike the browser of render-mockups.cjs, a page here runs its scripts and reaches the
// network, because an app needs both to sign in. A Browser with an origin reaches only that
// origin's host and port: it sends every other request, of any kind, to a proxy at a port
// where nothing listens, so the request fails. A page of a Page with an origin opens no new
// window: the browser closes each one before its first request.
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The browser of qory's agent image first, then the names that a dev container may have on
// PATH.
const BROWSERS = ['/usr/bin/chromium', 'chromium', 'chromium-browser', 'google-chrome',
  'google-chrome-stable'];

// --no-sandbox, because the browser of the run's image does not start without it, as
// render-mockups.cjs states. --use-mock-keychain and --password-store=basic, because Chrome
// on macOS otherwise opens the keychain and can show a dialog to the person at the screen.
const FLAGS = ['--headless=new', '--no-sandbox', '--remote-debugging-pipe', '--no-first-run',
  '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic',
  '--window-size=1280,800'];

const WIDTH = 1280;
const HEIGHT = 800;
const STOP_MS = 2000;
// The time that halt waits for the browser to exit, and the wait before the second removal
// of its folder.
const HALT_MS = 1000;
const RETRY_MS = 200;
const POLL_MS = 100;
const LOAD_MS = 15000;
// The most time for the browser to start, and for the browser to return the result of one
// call of the protocol.
const START_MS = 15000;
const SEND_MS = 10000;
// The proxy of a Browser with an origin: port 9, the discard port, where nothing listens in
// a dev container, so each request through it fails.
const DEAD_PROXY = 'http://127.0.0.1:9';
// The most time to wait for the first request of a new window, which gives its origin.
const POPUP_MS = 2000;
// The outside of a page whose new window has no request yet, or one to the app's origin.
const NEW_WINDOW = 'a new window';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// limited resolves as promise does, or rejects with an Error of why after ms.
function limited(promise, ms, why) {
  let timer;
  const late = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(why)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// originOf returns the origin of url, such as https://login.example.com, or its scheme, such
// as data:, for an address with no origin. It returns null for no address.
function originOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'null' ? parsed.protocol : parsed.origin;
  } catch {
    return null;
  }
}

// proxyFlags returns the flags that send each request to DEAD_PROXY, except one to the host
// and port of origin. <-loopback> removes the rule that sends no request to localhost and
// 127.0.0.1 through a proxy.
function proxyFlags(origin) {
  const url = new URL(origin);
  const port = url.port || { 'http:': '80', 'https:': '443' }[url.protocol];
  return [`--proxy-server=${DEAD_PROXY}`,
    `--proxy-bypass-list=<-loopback>;${url.hostname}:${port}`];
}

// executable reports whether file is a regular file that the user may run.
function executable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// findBrowser returns the path of the first of candidates that exists and runs: an absolute
// path as it is, a name in a folder of the PATH of env. It returns null for none.
function findBrowser(env = process.env, candidates = BROWSERS) {
  const folders = String((env && env.PATH) || '').split(path.delimiter).filter(Boolean);
  for (const one of candidates) {
    if (path.isAbsolute(one)) {
      if (executable(one)) return one;
      continue;
    }
    const found = folders.map((folder) => path.join(folder, one)).find(executable);
    if (found) return found;
  }
  return null;
}

// A headless browser. With origin, it reaches no other host and port than origin's, as
// proxyFlags sets, and pauses each new target before it runs, so that a Page with an origin
// closes each new window of its page before the window sends a request.
class Browser {
  constructor(bin, { origin } = {}) {
    this.bin = bin;
    this.origin = origin || null;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Set();
    // The Page of each browser context, by its id.
    this.pages = new Map();
    this.output = '';
  }

  // start starts the browser with a new profile in a new temporary folder, and resolves once
  // the browser returns its version on the pipe, or rejects after ms.
  async start(ms = START_MS) {
    const version = await this.launch(ms);
    if (this.origin) {
      await this.send('Target.setAutoAttach',
        { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    }
    return version;
  }

  launch(ms) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qory-browser-'));
    const env = {
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: process.env.HOME || this.dir,
      XDG_CONFIG_HOME: path.join(this.dir, 'config'),
      XDG_CACHE_HOME: path.join(this.dir, 'cache'),
    };
    const args = [...FLAGS, ...(this.origin ? proxyFlags(this.origin) : []),
      `--user-data-dir=${path.join(this.dir, 'profile')}`, 'about:blank'];
    this.proc = spawn(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'], env });
    // A process that exits with the browser still running, as by process.exit, kills it.
    const kill = () => {
      try {
        this.proc.kill('SIGKILL');
      } catch {
        // The browser has ended.
      }
    };
    process.once('exit', kill);
    this.proc.once('exit', () => process.removeListener('exit', kill));
    this.proc.once('error', () => process.removeListener('exit', kill));
    this.proc.stdout.on('data', (data) => { this.output = (this.output + data).slice(-4000); });
    this.proc.stderr.on('data', (data) => { this.output = (this.output + data).slice(-4000); });
    this.exited = new Promise((resolve) => {
      this.proc.on('error', (error) => resolve({ error: error.message }));
      this.proc.on('exit', (code, signal) => resolve({ code, signal }));
    });
    let buffer = Buffer.alloc(0);
    this.proc.stdio[4].on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      let end = buffer.indexOf(0);
      while (end >= 0 && !this.broken) {
        let message;
        try {
          message = JSON.parse(buffer.subarray(0, end).toString());
        } catch {
          this.fail('the browser wrote a message that is no JSON');
          return;
        }
        this.receive(message);
        buffer = buffer.subarray(end + 1);
        end = buffer.indexOf(0);
      }
    });
    this.proc.stdio[3].on('error', () => {});
    this.proc.stdio[4].on('error', () => {});
    return limited(Promise.race([
      this.send('Browser.getVersion', {}, undefined, ms + 1000),
      this.exited.then((how) => {
        throw new Error(`the browser exited before it started: ${JSON.stringify(how)}`);
      }),
    ]), ms, `the browser did not start within ${ms / 1000} s`);
  }

  // fail rejects each call that waits for its result with why, and each later call too.
  fail(why) {
    this.broken = why;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error(`${waiting.method}: ${why}`));
    }
    this.pending.clear();
  }

  receive(message) {
    if (this.stopped) return;
    if (message.method === 'Target.attachedToTarget' && !message.sessionId) {
      this.attached(message.params);
      return;
    }
    const waiting = message.id && this.pending.get(message.id);
    if (!waiting) {
      for (const handler of this.handlers) handler(message);
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new Error(`${waiting.method}: ${message.error.message}`));
    else waiting.resolve(message.result);
  }

  // attached handles a target that the browser paused at its start: a new window of a Page
  // with an origin goes to that Page, which closes it. Each other paused target, such as the
  // tab of a new Page or a service worker, runs on, and the browser detaches from it. A
  // target that is not paused, such as the tab that page attaches to, stays as it is.
  attached({ sessionId, targetInfo, waitingForDebugger }) {
    const page = this.pages.get(targetInfo.browserContextId);
    if (waitingForDebugger && targetInfo.type === 'page' && page && page.origin &&
      targetInfo.targetId !== page.targetId) {
      page.popup(sessionId, targetInfo);
      return;
    }
    if (!waitingForDebugger) return;
    this.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
      .finally(() => this.send('Target.detachFromTarget', { sessionId }).catch(() => {}));
  }

  // send calls method of the protocol, and resolves to its result, or rejects when the
  // browser returns no result within ms.
  send(method, params = {}, sessionId, ms = SEND_MS) {
    if (this.stopped) return Promise.reject(new Error(`${method}: the browser stopped`));
    if (this.broken) return Promise.reject(new Error(`${method}: ${this.broken}`));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: the browser returned no result within ${ms / 1000} s`));
      }, ms);
      this.pending.set(id, { resolve, reject, method, timer });
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      this.proc.stdio[3].write(`${JSON.stringify(message)}\0`);
    });
  }

  // page returns a new Page in a new browser context, which shares no cookie or storage with
  // another page. With origin, the page loads no document of another origin in any of its
  // frames, as Page states.
  async page({ origin } = {}) {
    const { browserContextId } = await this.send('Target.createBrowserContext');
    const { targetId } = await this.send('Target.createTarget',
      { url: 'about:blank', browserContextId });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, { browserContextId, targetId, sessionId });
    this.pages.set(browserContextId, page);
    if (origin) await page.guard(origin);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
    });
    return page;
  }

  // stop kills the browser, waits up to STOP_MS for it to exit, and removes its temporary
  // folder.
  stop() {
    return this.halt(STOP_MS);
  }

  // halt kills the browser, waits up to ms for it to exit, so that it no longer writes to its
  // profile, and removes its temporary folder, for a process that exits right after.
  async halt(ms = HALT_MS) {
    this.stopped = true;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error(`${waiting.method}: the browser stopped`));
    }
    this.pending.clear();
    if (this.proc) {
      try {
        this.proc.kill('SIGKILL');
      } catch {
        // The browser has ended.
      }
      await Promise.race([this.exited, sleep(ms)]);
    }
    await this.removeDir();
  }

  // removeDir removes the temporary folder, and once more after RETRY_MS when a child of the
  // browser still wrote to it.
  async removeDir() {
    if (!this.dir) return;
    for (const wait of [0, RETRY_MS]) {
      if (wait) await sleep(wait);
      try {
        fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // A child of the browser can still write here: the next round removes it.
      }
      if (!fs.existsSync(this.dir)) return;
    }
  }
}

// The keys that press takes by name, each with its code and key code. A letter or digit
// takes neither from here.
const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
};
// The bits of each modifier in Input.dispatchKeyEvent.
const MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

// keyOf returns { key, code, keyCode, text, modifiers } of a key such as Enter, a or
// Control+A, or null for a key that press does not take.
function keyOf(given) {
  const parts = String(given).split('+');
  const name = parts.pop();
  let modifiers = 0;
  for (const part of parts) {
    if (!Object.hasOwn(MODIFIERS, part)) return null;
    modifiers |= MODIFIERS[part];
  }
  if (Object.hasOwn(KEYS, name)) {
    const one = KEYS[name];
    return { key: one.key || name, code: one.code, keyCode: one.keyCode,
      text: modifiers & ~MODIFIERS.Shift ? undefined : one.text, modifiers };
  }
  if (!/^[A-Za-z0-9]$/.test(name)) return null;
  const upper = name.toUpperCase();
  const digit = /[0-9]/.test(name);
  return { key: name, code: digit ? `Digit${name}` : `Key${upper}`, keyCode: upper.charCodeAt(0),
    text: modifiers & ~MODIFIERS.Shift ? undefined : name, modifiers };
}

// The script that finds the element of a target in a page: text=<words> is the innermost
// visible element whose text contains the words, in any case and with runs of white space as
// one space; any other target is a CSS selector, and the first visible element that it
// matches. It scrolls the element into view, keeps it for FOCUSED, and returns the centre of
// its box, null for no element, or { error } for a selector that the page cannot read.
const LOCATE = `(target) => {
  const visible = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' &&
      style.display !== 'none';
  };
  let el = null;
  if (target.startsWith('text=')) {
    const words = target.slice(5).replace(/\\s+/g, ' ').trim().toLowerCase();
    const all = new Set([...document.querySelectorAll('body *')].filter((one) =>
      visible(one) && (one.innerText || '').replace(/\\s+/g, ' ').toLowerCase().includes(words)));
    el = [...all].find((one) => ![...one.children].some((child) => all.has(child))) || null;
  } else {
    try {
      el = [...document.querySelectorAll(target)].find(visible) || null;
    } catch (error) {
      return { error: 'the target is no CSS selector and does not start with text=' };
    }
  }
  if (!el) return null;
  window[Symbol.for('qory.located')] = el;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}`;

// The script that returns the origin of the page, whether the focus is in a frame, and
// whether it is in the element that LOCATE found last, in this document.
const FOCUSED = `(() => {
  const el = window[Symbol.for('qory.located')];
  const active = document.activeElement;
  const frame = Boolean(active && active.tagName === 'IFRAME');
  return { origin: location.origin, frame,
    focused: Boolean(el && active && !frame && (active === el || el.contains(active))) };
})()`;

// One tab of the app, in a new browser context that no other Page shares. It dismisses each
// dialog of the page, such as an alert, which would stop the page until a person closes it.
// With an origin, which page({ origin }) or guard sets, the page fails the load of each
// document of another origin, in the tab and in each frame, such as one that a redirect, a
// link or a script opens, and outside is the origin of the first such load; type and press
// then act only on a page of origin. It also closes each new window of the page, such as one
// that window.open or a form or link with target=_blank opens, before its first request, and
// outside is then the origin of that request, or NEW_WINDOW for one to origin or for none
// within POPUP_MS. Only a Page of a Browser with an origin gets its new windows.
class Page {
  constructor(browser, { browserContextId, targetId, sessionId }) {
    this.browser = browser;
    this.browserContextId = browserContextId;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.origin = null;
    this.outside = null;
    this.loads = 0;
    // The new windows that wait for their first request, each a promise.
    this.popups = new Set();
    this.handler = (message) => {
      if (message.sessionId !== this.sessionId) return;
      if (message.method === 'Page.loadEventFired') this.loads += 1;
      if (message.method === 'Page.javascriptDialogOpening') {
        this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
      }
      if (message.method === 'Fetch.requestPaused') this.paused(message.params);
    };
    browser.handlers.add(this.handler);
  }

  // guard sets the origin of the page: from then on, the page fails the load of each document
  // of another origin. A second call with another origin throws.
  async guard(origin) {
    if (this.origin === origin) return;
    if (this.origin) throw new Error(`the page already has the origin ${this.origin}`);
    this.origin = origin;
    await this.send('Fetch.enable',
      { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
  }

  // popup closes the new window of the target of sessionId, which the browser paused at its
  // start, and sets outside: the window may send no request, so it fails its first one and
  // takes the origin of that request.
  popup(sessionId, targetInfo) {
    if (!this.outside) this.outside = NEW_WINDOW;
    const browser = this.browser;
    let handler;
    let timer;
    const done = new Promise((resolve) => {
      handler = (message) => {
        if (message.sessionId !== sessionId || message.method !== 'Fetch.requestPaused') return;
        const { requestId, request } = message.params;
        browser.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' },
          sessionId).catch(() => {});
        const other = originOf(request.url);
        if (this.outside === NEW_WINDOW && other && other !== this.origin) this.outside = other;
        resolve();
      };
      browser.handlers.add(handler);
      timer = setTimeout(resolve, POPUP_MS);
    }).then(() => {
      clearTimeout(timer);
      browser.handlers.delete(handler);
      return browser.send('Target.closeTarget', { targetId: targetInfo.targetId });
    }).catch(() => {}).finally(() => this.popups.delete(done));
    this.popups.add(done);
    browser.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] },
      sessionId).then(() => browser.send('Runtime.runIfWaitingForDebugger', {}, sessionId))
      .catch(() => {});
  }

  // settled resolves once each new window of the page is closed.
  async settled() {
    await Promise.all([...this.popups]);
  }

  // paused lets a load of a document of origin go on, and fails any other.
  paused({ requestId, request }) {
    const other = originOf(request.url);
    if (!this.origin || other === this.origin) {
      this.send('Fetch.continueRequest', { requestId }).catch(() => {});
      return;
    }
    if (!this.outside) this.outside = other || 'an address with no origin';
    this.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
      .catch(() => {});
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId);
  }

  // goto opens url, and resolves once the page has loaded, or rejects after ms.
  async goto(url, ms = LOAD_MS) {
    const before = this.loads;
    const navigation = await this.send('Page.navigate', { url });
    if (navigation.errorText) throw new Error(`the page did not open: ${navigation.errorText}`);
    const until = Date.now() + ms;
    while (this.loads === before) {
      if (Date.now() > until) throw new Error(`the page did not load within ${ms / 1000} s`);
      await sleep(POLL_MS);
    }
  }

  // evaluate returns the value of expression in the page. A page that is loading has no
  // context to run it in, and then evaluate rejects.
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) {
      throw new Error((exceptionDetails.exception && exceptionDetails.exception.description) ||
        exceptionDetails.text);
    }
    return result.value;
  }

  // poll calls check until it returns a value other than null and undefined, and returns
  // that value, or null after ms. A call that rejects, as during a load, or that runs past
  // ms, counts as none.
  async poll(check, ms) {
    const until = Date.now() + ms;
    for (;;) {
      let value = null;
      try {
        value = await limited(check(), Math.max(until - Date.now(), POLL_MS), 'late');
      } catch {
        // The page is loading: try again.
      }
      if (value !== null && value !== undefined) return value;
      if (Date.now() > until) return null;
      await sleep(POLL_MS);
    }
  }

  // locate returns the centre of the element of target, or throws when no element shows
  // within ms.
  async locate(target, ms) {
    const found = await this.poll(() => this.evaluate(`(${LOCATE})(${JSON.stringify(target)})`),
      ms);
    if (found && found.error) throw new Error(found.error);
    if (!found) throw new Error(`no element of the target showed within ${ms / 1000} s`);
    return found;
  }

  // visible reports whether an element of target shows now.
  async visible(target) {
    try {
      const found = await this.evaluate(`(${LOCATE})(${JSON.stringify(target)})`);
      return Boolean(found && !found.error);
    } catch {
      return false;
    }
  }

  async click(target, ms) {
    const { x, y } = await this.locate(target, ms);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent',
      { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent',
      { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  // here throws when the page is not on origin, when the focus is in a frame, or with
  // focused set, when the focus is not in the element that locate found last.
  async here(focused) {
    const now = await this.evaluate(FOCUSED);
    if (this.origin && now.origin !== this.origin) {
      throw new Error(`the page is on ${now.origin}, outside the app`);
    }
    if (now.frame) throw new Error('the focus is in a frame');
    if (focused && !now.focused) throw new Error('the focus is not in the element of the target');
  }

  // type clicks the element of target, then enters text as one input, only when the focus is
  // in that element and the page is on origin.
  async type(target, text, ms) {
    await this.click(target, ms);
    await this.here(true);
    await this.send('Input.insertText', { text });
  }

  async press(given) {
    const key = keyOf(given);
    if (!key) throw new Error('the key is none that press takes');
    await this.here(false);
    const event = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode,
      nativeVirtualKeyCode: key.keyCode, modifiers: key.modifiers };
    await this.send('Input.dispatchKeyEvent',
      { type: key.text ? 'keyDown' : 'rawKeyDown', ...event, text: key.text });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
  }

  // waitText resolves once the text of the page contains text, or rejects after ms.
  async waitText(text, ms) {
    const found = await this.poll(async () => ((await this.evaluate(
      `Boolean(document.body && document.body.innerText.includes(${JSON.stringify(text)}))`))
      ? true : null), ms);
    if (!found) throw new Error(`the page showed no such text within ${ms / 1000} s`);
  }

  async close() {
    this.browser.handlers.delete(this.handler);
    this.browser.pages.delete(this.browserContextId);
    await this.browser.send('Target.disposeBrowserContext',
      { browserContextId: this.browserContextId }).catch(() => {});
  }
}

module.exports = { BROWSERS, Browser, FLAGS, Page, findBrowser, keyOf, limited, originOf };
