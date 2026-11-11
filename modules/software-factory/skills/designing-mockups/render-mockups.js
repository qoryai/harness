#!/usr/bin/env node
// Renders each packed page of a mockup to one PNG, for the review in the run, and runs the
// styling tests. pack-mockups.js writes the pages; nothing that this script writes is pushed.
//
//   render-mockups.js --check
//   render-mockups.js --pages=<dir>/mockup-draft --out=<dir>/mockup-render
//
// Exit status: 0 done, 1 a page fails, 2 wrong arguments, 3 no browser.
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BROWSER = '/usr/bin/chromium';
const ARTIFACTS = '/tmp/qory-artifacts';
const DERIVED_LINE = 'Styling derived from sources, not from a build';
const PAGES_FOLDER = 'mockup-draft';
const RENDER_FOLDER = 'mockup-render';
const USAGE = 'Usage: render-mockups.js --check '
  + '| --pages=<dir>/mockup-draft --out=<dir>/mockup-render';
const WIDTH = 1280;
const HEIGHT = 800;
const MAX_SCREENS = 9;
const LOAD_MS = 15000;
const SETTLE_MS = 400;
const RUN_MS = 300000;
const STOP_MS = 2000;

// Never add --allow-file-access-from-files: with it, a page script reads any file.
const NETWORK_FLAGS = ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'];
// --hide-scrollbars, because a page taller than the window lays out 15 px narrower with a
// scrollbar, and the picture of the whole page has none. --no-sandbox, because the browser
// of the run's image does not start without it, as the image's docs state. The pack refuses
// every script in a page, and refusalOf blocks each request but the page itself, data: and
// about:blank, so a page runs no script and loads nothing from outside.
const FLAGS = [
  '--headless=new', '--hide-scrollbars', '--no-sandbox', '--remote-debugging-pipe', ...NETWORK_FLAGS,
];

// A browser ignores these at-rules, so a sheet with them has no effect and gives no error.
const UNBUILT_MARKERS = [
  'tailwind', 'apply', 'theme', 'utility', 'variant', 'custom-variant', 'source', 'plugin',
  'config', 'reference', 'use', 'forward', 'mixin', 'include', 'extend',
];

// The properties that show whether a rule styled an element. The text colour and the
// underline, because a sheet often styles a link in a menu only by those two.
const STYLE_PROPS = [
  'color', 'text-decoration-line', 'background-color', 'background-image', 'border-top-width',
  'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style',
  'border-top-left-radius', 'box-shadow',
];
// The tags whose default colour is set by the browser, not inherited from the parent: a link,
// a button and the form fields. Any other tag takes its parent's colour with no rule for it,
// so its colour counts only when it differs from the parent's computed value.
const OWN_COLOR_TAGS = ['a', 'button', 'input', 'select', 'textarea'];
// A failure quotes at most this many characters of a marked element's label.
const LABEL_CHARS = 80;

// A comment records its screen in on.screen, which allows at most 32 characters.
const SCREEN_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

class Refusal extends Error {}

// Where warnings and failures go. A test sets it, because the test runner reports on stdout.
let errors = process.stderr;

function inside(file, roots) {
  return roots.some((root) => file === root || file.startsWith(root + path.sep));
}

// Why a request fails, or null when it passes. A packed page loads no file, so only the page
// itself passes, and a data: address, which needs no request.
function refusalOf(url, page) {
  if (url === 'about:blank' || url.startsWith('data:')) return null;
  return url.split('#')[0] === page ? null : 'a packed page loads no file';
}

function unbuiltMarkers(cssText) {
  const bare = cssText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\n\\])*"|'(?:\\.|[^'\n\\])*'/g, '""');
  const found = bare.match(new RegExp(`@(?:${UNBUILT_MARKERS.join('|')})(?![\\w-])`, 'g')) || [];
  return [...new Set(found)];
}

// Whether a box from DevTools lies inside the picture. The picture's size is in whole pixels,
// so a box that ends less than 1 px past it counts.
function insidePicture(box, size) {
  return box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0
    && box.x + box.w < size.width + 1 && box.y + box.h < size.height + 1;
}

// Whether a tab at the address `shown` still shows the page's file.
function sameFile(shown, page) {
  return shown.split('#')[0] === page;
}

function boxOf(model) {
  const [x1, y1, , , x3, y3] = model.border;
  return { x: x1, y: y1, w: x3 - x1, h: y3 - y1 };
}

function textOf(node) {
  const own = node.nodeType === 3 ? node.nodeValue : '';
  return own + (node.children || []).map(textOf).join('');
}

function plain(text) {
  return text.replace(/\s+/g, ' ').trim();
}

class Browser {
  constructor(bin) {
    this.bin = bin;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = [];
    this.output = '';
  }

  // The image's docs state these two folders for a read-only HOME, and --no-sandbox.
  start() {
    this.dir = fs.mkdtempSync('/tmp/qory-render-');
    const env = {
      PATH: process.env.PATH || '/usr/bin:/bin',
      HOME: process.env.HOME || this.dir,
      XDG_CONFIG_HOME: path.join(this.dir, 'config'),
      XDG_CACHE_HOME: path.join(this.dir, 'cache'),
    };
    const args = [...FLAGS, `--user-data-dir=${path.join(this.dir, 'profile')}`, 'about:blank'];
    this.proc = spawn(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'], env });
    this.proc.stdout.on('data', (d) => { this.output += d; });
    this.proc.stderr.on('data', (d) => { this.output += d; });
    this.exited = new Promise((resolve) => {
      this.proc.on('error', (e) => resolve({ error: e.message }));
      this.proc.on('exit', (code, signal) => resolve({ code, signal }));
    });
    let buffer = Buffer.alloc(0);
    this.proc.stdio[4].on('data', (d) => {
      buffer = Buffer.concat([buffer, d]);
      let end = buffer.indexOf(0);
      while (end >= 0) {
        this.receive(JSON.parse(buffer.subarray(0, end).toString()));
        buffer = buffer.subarray(end + 1);
        end = buffer.indexOf(0);
      }
    });
    this.proc.stdio[3].on('error', () => {});
    this.proc.stdio[4].on('error', () => {});
    return Promise.race([
      this.send('Browser.getVersion'),
      this.exited.then((e) => {
        const tail = plain(this.output).slice(-300);
        throw new Refusal(`The browser exited before it started: ${JSON.stringify(e)} ${tail}`);
      }),
    ]);
  }

  receive(message) {
    if (this.stopped) return;
    const waiting = message.id && this.pending.get(message.id);
    if (!waiting) {
      for (const handler of this.handlers) handler(message);
      return;
    }
    this.pending.delete(message.id);
    if (message.error) waiting.reject(new Error(`${waiting.method}: ${message.error.message}`));
    else waiting.resolve(message.result);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      this.proc.stdio[3].write(`${JSON.stringify(message)}\0`);
    });
  }

  // Ignores each later message, so that no picture lands in the output after the stop.
  async stop() {
    this.stopped = true;
    if (this.proc) {
      this.proc.kill('SIGKILL');
      let timer;
      const late = new Promise((resolve) => { timer = setTimeout(resolve, STOP_MS); });
      await Promise.race([this.exited, late]);
      clearTimeout(timer);
    }
    if (this.dir) {
      try {
        fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // A child of the browser can still write here. The folder holds no result.
      }
    }
  }
}

// One tab with JavaScript off, whose every request goes through refusalOf. page is the address
// of the page that the tab shows, or null.
class Tab {
  constructor(browser, page) {
    this.browser = browser;
    this.page = page;
    this.sessions = new Set();
    this.sheets = [];
    this.denied = new Map();
  }

  send(method, params) {
    return this.browser.send(method, params, this.session);
  }

  async open() {
    const { targetId } = await this.browser.send('Target.createTarget', { url: 'about:blank' });
    this.targetId = targetId;
    const { sessionId } = await this.browser.send('Target.attachToTarget', { targetId, flatten: true });
    this.session = sessionId;
    this.handler = (message) => this.event(message);
    this.browser.handlers.push(this.handler);
    await this.limit(sessionId);
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('CSS.enable');
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
    });
    // A frame in another process is a separate target, and each needs the same limits.
    await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    return this;
  }

  async limit(sessionId) {
    this.sessions.add(sessionId);
    await this.browser.send('Emulation.setScriptExecutionDisabled', { value: true }, sessionId);
    await this.browser.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
  }

  async event(message) {
    const params = message.params || {};
    if (!this.sessions.has(message.sessionId)) return;
    if (message.method === 'Target.attachedToTarget') {
      const child = params.sessionId;
      await this.limit(child).catch(() => {});
      await this.browser.send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {});
    } else if (message.method === 'Page.loadEventFired') {
      if (this.onLoad) this.onLoad();
    } else if (message.method === 'CSS.styleSheetAdded') {
      if (params.header.origin === 'regular') this.sheets.push(params.header);
    } else if (message.method === 'Fetch.requestPaused') {
      const refusal = refusalOf(params.request.url, this.page);
      if (refusal) this.denied.set(params.request.url, refusal);
      const reply = refusal
        ? ['Fetch.failRequest', { requestId: params.requestId, errorReason: 'AccessDenied' }]
        : ['Fetch.continueRequest', { requestId: params.requestId }];
      await this.browser.send(reply[0], reply[1], message.sessionId).catch(() => {});
    }
  }

  async go(url) {
    let timer;
    const loaded = new Promise((resolve) => { this.onLoad = () => resolve(true); });
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(false), LOAD_MS); });
    const navigation = await this.send('Page.navigate', { url });
    if (navigation.errorText) {
      clearTimeout(timer);
      throw new Refusal(`The page did not open: ${navigation.errorText}`);
    }
    const inTime = await Promise.race([loaded, late]);
    clearTimeout(timer);
    if (!inTime) throw new Refusal(`The page did not load within ${LOAD_MS / 1000} s`);
    await new Promise((resolve) => { setTimeout(resolve, SETTLE_MS); });
  }

  // One DOM.getDocument per tab, because a second call makes the earlier node ids invalid. The
  // whole tree, so that parentOf finds the parent element of each node.
  async query(selector) {
    if (!this.rootId) {
      const { root } = await this.send('DOM.getDocument', { depth: -1 });
      this.rootId = root.nodeId;
      this.parents = new Map();
      const walk = (node) => {
        for (const child of node.children || []) {
          if (node.nodeType === 1) this.parents.set(child.nodeId, node.nodeId);
          walk(child);
        }
      };
      walk(root);
    }
    return (await this.send('DOM.querySelectorAll', { nodeId: this.rootId, selector })).nodeIds;
  }

  // The computed styles of the parent element of a node, or null for the root element.
  async parentStyle(nodeId) {
    const parent = this.parents && this.parents.get(nodeId);
    return parent ? this.computed(parent).catch(() => null) : null;
  }

  async computed(nodeId) {
    const { computedStyle } = await this.send('CSS.getComputedStyleForNode', { nodeId });
    return Object.fromEntries(computedStyle.map((c) => [c.name, c.value]));
  }

  async text(nodeId) {
    return plain(textOf((await this.send('DOM.describeNode', { nodeId, depth: -1 })).node));
  }

  async box(nodeId) {
    try {
      return boxOf((await this.send('DOM.getBoxModel', { nodeId })).model);
    } catch {
      return null;
    }
  }

  async size() {
    const { cssContentSize: size } = await this.send('Page.getLayoutMetrics');
    return {
      width: Math.max(WIDTH, Math.ceil(size.width)),
      height: Math.max(HEIGHT, Math.ceil(size.height)),
    };
  }

  async picture(size) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
    });
    return Buffer.from(data, 'base64');
  }

  async expectFile(url, id) {
    const { targetInfo } = await this.browser.send('Target.getTargetInfo', { targetId: this.targetId });
    if (!sameFile(targetInfo.url, url)) {
      throw new Refusal(`Remove the redirect from ${id}.html: the tab left the page for ${targetInfo.url}`);
    }
  }

  async close() {
    this.browser.handlers = this.browser.handlers.filter((h) => h !== this.handler);
    await this.browser.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}

// The computed styles of a tag in an empty page, once per tag. A tag that an empty body drops,
// such as tr, has no baseline, so the test skips it.
const baselines = new Map();
async function baselineOf(browser, tag) {
  if (baselines.has(tag)) return baselines.get(tag);
  const tab = await new Tab(browser, null).open();
  const { frameTree } = await tab.send('Page.getFrameTree');
  await tab.send('Page.setDocumentContent', {
    frameId: frameTree.frame.id,
    html: `<!doctype html><${tag} id="baseline" href="x">x</${tag}>`,
  });
  const [node] = await tab.query('#baseline');
  const baseline = node ? await tab.computed(node) : null;
  await tab.close();
  baselines.set(tag, baseline);
  return baseline;
}

// The line counts only with the exact text and a box inside the captured picture.
async function hasDerivedLine(tab, size) {
  for (const node of await tab.query('[data-styling="derived"]')) {
    if (await tab.text(node) !== DERIVED_LINE) continue;
    const style = await tab.computed(node);
    if (style.visibility !== 'visible' || style.opacity === '0' || style.display === 'none') continue;
    const box = await tab.box(node);
    if (box && insidePicture(box, size)) return true;
  }
  return false;
}

async function stylingFailures(browser, tab, marked) {
  const failures = [];
  const markers = new Set();
  for (const sheet of tab.sheets) {
    const { text } = await tab.send('CSS.getStyleSheetText', { styleSheetId: sheet.styleSheetId })
      .catch(() => ({ text: '' }));
    for (const marker of unbuiltMarkers(text)) markers.add(marker);
  }
  if (markers.size) failures.push(`unbuilt markers in a sheet: ${[...markers].join(' ')}`);
  const unstyled = [];
  for (const element of marked) {
    const baseline = await baselineOf(browser, element.tag);
    const style = await tab.computed(element.node);
    const parent = await tab.parentStyle(element.node);
    if (baseline && !isStyled(style, baseline, parent, element.tag)) {
      unstyled.push(element);
    }
  }
  if (unstyled.length) {
    failures.push(`default computed styles on ${unstyled.length} of ${marked.length} marked `
      + `elements: ${unstyled.map(markedName).join(', ')}`);
  }
  return failures;
}

// Whether a rule styled an element of tag: a property of STYLE_PROPS differs from the
// baseline of its tag. The colour of a tag that inherits it counts only when it also differs
// from the parent's computed value. parent is null for the root. So a menu link with
// `color: inherit; text-decoration: none` counts as styled.
function isStyled(style, baseline, parent, tag) {
  const inherits = (name) => name === 'color' && !OWN_COLOR_TAGS.includes(tag);
  return STYLE_PROPS.some((name) => style[name] !== baseline[name]
    && !(inherits(name) && parent && style[name] === parent[name]));
}

// clip removes control characters from a page's text and cuts it to LABEL_CHARS characters.
function clip(text) {
  const clean = String(text).replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
  return clean.length > LABEL_CHARS ? `${clean.slice(0, LABEL_CHARS - 3)}...` : clean;
}

// How a failure names a marked element, so that the designer finds it among the others that
// lead to the same screen.
function markedName(element) {
  const label = element.label ? ` "${clip(element.label)}"` : '';
  return `<${element.tag} data-to="${clip(element.to)}">${label}`;
}

async function markedOf(tab, node) {
  const { node: described } = await tab.send('DOM.describeNode', { nodeId: node });
  const { attributes } = await tab.send('DOM.getAttributes', { nodeId: node });
  const attribute = (name) => {
    const at = attributes.findIndex((value, i) => i % 2 === 0 && value === name);
    return at < 0 ? undefined : attributes[at + 1];
  };
  const label = plain(attribute('aria-label') || await tab.text(node));
  return { node, tag: described.nodeName.toLowerCase(), to: attribute('data-to'), label };
}

async function renderScreen(browser, out, page) {
  const url = pathToFileURL(page.file).href;
  const tab = await new Tab(browser, url).open();
  try {
    await tab.go(url);
    await tab.expectFile(url, page.id);
    const size = await tab.size();
    const marked = [];
    for (const node of await tab.query('[data-to]')) marked.push(await markedOf(tab, node));
    const failures = [];
    if (!await hasDerivedLine(tab, size)) {
      failures.push(...await stylingFailures(browser, tab, marked));
    }
    for (const [address, refusal] of tab.denied) {
      errors.write(`Warning: ${page.id}: not loaded, ${refusal}: ${address}\n`);
    }
    const bytes = await tab.picture(size);
    await tab.expectFile(url, page.id);
    fs.writeFileSync(path.join(out, `${page.id}.png`), bytes);
    return failures;
  } finally {
    await tab.close();
  }
}

function readPages(pagesDir) {
  const pages = [];
  for (const name of fs.readdirSync(pagesDir).filter((entry) => entry.endsWith('.html')).sort()) {
    pages.push({ id: name.slice(0, -'.html'.length), file: path.join(pagesDir, name) });
  }
  if (!pages.length) {
    throw new Refusal(`Run pack-mockups.js first: ${pagesDir} has no packed page.`);
  }
  if (pages.length > MAX_SCREENS) {
    throw new Refusal(`Use at most ${MAX_SCREENS} screens: ${pagesDir} has ${pages.length}.`);
  }
  for (const page of pages) {
    if (!SCREEN_ID.test(page.id)) {
      throw new Refusal('Name each page with at most 32 lower-case letters, digits and hyphens: '
        + `${page.id}.html`);
    }
  }
  return pages;
}

function clearOutput(out) {
  for (const name of fs.readdirSync(out)) {
    if (name.endsWith('.png')) fs.rmSync(path.join(out, name));
  }
}

async function renderAll(browser, out, pages) {
  await browser.start();
  const failures = [];
  for (const page of pages) {
    const found = await renderScreen(browser, out, page);
    failures.push(...found.map((failure) => `${page.id}: ${failure}`));
  }
  if (failures.length) throw new Refusal(`The render failed:\n${failures.join('\n')}`);
  return `${out}: ${pages.length} pictures`;
}

async function render(options, deps) {
  const root = fs.realpathSync(deps.artifacts);
  // First of all, because a refusal must leave no picture of an earlier render to review.
  const out = underRoot(options.out, root, '--out', { name: RENDER_FOLDER, create: true });
  clearOutput(out);
  const pagesDir = underRoot(options.pages, root, '--pages', { name: PAGES_FOLDER });
  const pages = readPages(pagesDir);
  const browser = new Browser(deps.browser);
  const limit = deps.limitMs || RUN_MS;
  let timer;
  const late = new Promise((resolve, reject) => {
    const why = `The render failed: it took more than ${limit / 1000} s.`;
    timer = setTimeout(() => reject(new Refusal(why)), limit);
  });
  let finished = false;
  try {
    const result = await Promise.race([renderAll(browser, out, pages), late]);
    finished = true;
    return result;
  } finally {
    clearTimeout(timer);
    await browser.stop();
    if (!finished) clearOutput(out);
  }
}

function underRoot(given, root, flag, { name, create } = {}) {
  const whole = path.resolve(given);
  const wrong = () => new Refusal(`Set ${flag} to a folder named ${name} under ${root}: ${given}`);
  if (name && path.basename(whole) !== name) throw wrong();
  if (create) {
    let parent = whole;
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    if (!inside(fs.realpathSync(parent), [root])) {
      throw new Refusal(`Set ${flag} to a folder under ${root}: ${given}`);
    }
    fs.mkdirSync(whole, { recursive: true });
  }
  let real;
  try {
    real = fs.realpathSync(whole);
  } catch {
    throw new Refusal(`Set ${flag} to a folder that exists: ${given}`);
  }
  if (!inside(real, [root])) throw new Refusal(`Set ${flag} to a folder under ${root}: ${given}`);
  if (name && path.basename(real) !== name) throw wrong();
  return real;
}

function parseArguments(argv) {
  const options = {};
  for (const argument of argv) {
    const match = /^--(check|pages|out)(?:=(.*))?$/s.exec(argument);
    if (!match) throw new Refusal(`Use --check, or --pages and --out: ${argument}`);
    const [, flag, value] = match;
    if (flag === 'check' && value !== undefined) throw new Refusal('Write --check with no value.');
    if (flag !== 'check' && !value) throw new Refusal(`Write a value after --${flag}=.`);
    options[flag] = value === undefined ? true : value;
  }
  if (!options.check && !(options.pages && options.out)) {
    throw new Refusal('Set --check, or --pages and --out.');
  }
  return options;
}

// Returns the exit status, and writes the result to stdout and each failure to stderr.
async function main(argv, deps = { browser: BROWSER, artifacts: ARTIFACTS }) {
  const results = deps.stdout || process.stdout;
  errors = deps.stderr || process.stderr;
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    errors.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  try {
    if (!fs.existsSync(deps.browser)) {
      errors.write(`No browser: ${deps.browser} does not exist, so this run can make no pictures.\n`);
      return 3;
    }
    if (options.check) {
      results.write(`${deps.browser} exists.\n`);
      return 0;
    }
    results.write(`${await render(options, deps)}\n`);
    return 0;
  } catch (error) {
    errors.write(`${error instanceof Refusal ? error.message : error.stack}\n`);
    return 1;
  }
}

if (require.main === module) {
  // process.exit, because a pipe to the browser can keep the process alive after its work.
  main(process.argv.slice(2)).then((status) => process.exit(status));
}

module.exports = {
  DERIVED_LINE, FLAGS, MAX_SCREENS, STYLE_PROPS, insidePicture, isStyled, main, markedName,
  refusalOf, sameFile, unbuiltMarkers,
};
