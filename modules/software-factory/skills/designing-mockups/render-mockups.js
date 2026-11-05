#!/usr/bin/env node
// Renders a mockup's HTML pages to one PNG per screen, and writes screens.json.
//
//   node render-mockups.js --check
//   node render-mockups.js --pages=<dir> --out=<dir> --start=<screen id>
//   node render-mockups.js --unpack=<screens.json> --pages=<dir>
//
// Exit status: 0 done, 1 a page fails, 2 wrong arguments, 3 no browser.
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const BROWSER = '/usr/bin/chromium';
const ARTIFACTS = '/tmp/qory-artifacts';
const TOKEN = '{{checkout}}';
const DERIVED_LINE = 'Styling derived from sources, not from a build';
const WIDTH = 1280;
const HEIGHT = 800;
const MAX_SCREENS = 9;
const MAX_VERSION_BYTES = 10 * 1024 * 1024;
const MAX_SCREENS_JSON_BYTES = 1024 * 1024;
const LOAD_MS = 15000;
const SETTLE_MS = 400;
const RUN_MS = 300000;
const STOP_MS = 2000;

// Never add --allow-file-access-from-files: with it, a page script reads any file.
const NETWORK_FLAGS = ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'];
const FLAGS = ['--headless=new', '--no-sandbox', '--remote-debugging-pipe', ...NETWORK_FLAGS];

// A browser ignores these at-rules, so a sheet with them has no effect and gives no error.
// The skill designing-mockups lists the same words.
const UNBUILT_MARKERS = [
  'tailwind', 'apply', 'theme', 'utility', 'variant', 'custom-variant', 'source', 'plugin',
  'config', 'reference', 'use', 'forward', 'mixin', 'include', 'extend',
];

// The properties that show whether a rule styled an element.
const STYLE_PROPS = [
  'background-color', 'background-image', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-top-style', 'border-top-left-radius',
  'box-shadow',
];

// A comment records its screen in on.screen, which allows at most 32 characters.
const SCREEN_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

class Refusal extends Error {}

function inside(file, roots) {
  return roots.some((root) => file === root || file.startsWith(root + path.sep));
}

// The names that the settings deny to Read, because a page could print such a file.
function isSecretName(file) {
  return /^\.env(\.|$)/.test(path.basename(file));
}

// Checks the real path of each file, because a repository can hold a link to any file.
function isAllowedUrl(url, roots) {
  if (url === 'about:blank') return true;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'file:' || parsed.hostname) return false;
  try {
    const file = fileURLToPath(parsed);
    const real = fs.realpathSync(file);
    return inside(real, roots) && !isSecretName(file) && !isSecretName(real)
      && fs.statSync(real).isFile();
  } catch {
    return false;
  }
}

function unbuiltMarkers(cssText) {
  const bare = cssText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:\\.|[^"\n\\])*"|'(?:\\.|[^'\n\\])*'/g, '""');
  const found = bare.match(new RegExp(`@(?:${UNBUILT_MARKERS.join('|')})(?![\\w-])`, 'g')) || [];
  return [...new Set(found)];
}

function expandToken(source, checkout) {
  return source.split(TOKEN).join(pathToFileURL(checkout).href);
}

function unreachable(screens, start) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const screen = screens.find((s) => s.id === queue.shift());
    for (const area of screen ? screen.areas : []) {
      if (!seen.has(area.to)) {
        seen.add(area.to);
        queue.push(area.to);
      }
    }
  }
  return screens.map((s) => s.id).filter((id) => !seen.has(id));
}

// A box from DevTools, as fractions of the picture; null when it lies outside the picture.
function fractions(box, width, height) {
  const round = (n) => Number(n.toFixed(5));
  const [x, y, w, h] = [box.x / width, box.y / height, box.w / width, box.h / height].map(round);
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) return null;
  return { x, y, w, h };
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

  async stop() {
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

// One tab with JavaScript off, whose every request goes through isAllowedUrl.
class Tab {
  constructor(browser, roots) {
    this.browser = browser;
    this.roots = roots;
    this.sessions = new Set();
    this.sheets = [];
    this.denied = [];
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
      const allowed = isAllowedUrl(params.request.url, this.roots);
      if (!allowed) this.denied.push(params.request.url);
      const reply = allowed
        ? ['Fetch.continueRequest', { requestId: params.requestId }]
        : ['Fetch.failRequest', { requestId: params.requestId, errorReason: 'AccessDenied' }];
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

  // One DOM.getDocument per tab, because a second call makes the earlier node ids invalid.
  async query(selector) {
    if (!this.rootId) this.rootId = (await this.send('DOM.getDocument', { depth: 0 })).root.nodeId;
    return (await this.send('DOM.querySelectorAll', { nodeId: this.rootId, selector })).nodeIds;
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

  async title() {
    const { targetInfo } = await this.browser.send('Target.getTargetInfo', { targetId: this.targetId });
    return /^(file:|about:)/.test(targetInfo.title) ? '' : plain(targetInfo.title);
  }

  async close() {
    this.browser.handlers = this.browser.handlers.filter((h) => h !== this.handler);
    await this.browser.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}

// The computed styles of a tag in an empty page, once per tag. A tag that an empty body drops,
// such as tr, has no baseline, so the test skips it.
const baselines = new Map();
async function baselineOf(browser, roots, tag) {
  if (baselines.has(tag)) return baselines.get(tag);
  const tab = await new Tab(browser, roots).open();
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
    if (box && fractions(box, size.width, size.height)) return true;
  }
  return false;
}

async function stylingFailures(browser, roots, tab, marked) {
  const failures = [];
  const markers = new Set();
  for (const sheet of tab.sheets) {
    const { text } = await tab.send('CSS.getStyleSheetText', { styleSheetId: sheet.styleSheetId })
      .catch(() => ({ text: '' }));
    for (const marker of unbuiltMarkers(text)) markers.add(marker);
  }
  if (markers.size) failures.push(`unbuilt markers in a sheet: ${[...markers].join(' ')}`);
  let unstyled = 0;
  for (const node of marked) {
    const { node: described } = await tab.send('DOM.describeNode', { nodeId: node });
    const baseline = await baselineOf(browser, roots, described.nodeName.toLowerCase());
    const style = await tab.computed(node);
    if (baseline && STYLE_PROPS.every((name) => style[name] === baseline[name])) unstyled += 1;
  }
  if (unstyled) failures.push(`default computed styles on ${unstyled} of ${marked.length} marked elements`);
  return failures;
}

async function areasOf(tab, marked, size, ids) {
  const areas = [];
  const failures = [];
  for (const node of marked) {
    const { attributes } = await tab.send('DOM.getAttributes', { nodeId: node });
    const attribute = (name) => {
      const at = attributes.findIndex((value, i) => i % 2 === 0 && value === name);
      return at < 0 ? undefined : attributes[at + 1];
    };
    const to = attribute('data-to');
    const label = plain(attribute('aria-label') || await tab.text(node));
    const box = await tab.box(node);
    const area = box && fractions(box, size.width, size.height);
    if (!ids.includes(to)) failures.push(`data-to="${to}" leads to no screen`);
    if (!label) failures.push(`data-to="${to}" has no text and no aria-label`);
    if (!area) failures.push(`data-to="${to}" has no box inside the picture`);
    if (area) areas.push({ ...area, to, label });
  }
  return { areas, failures };
}

async function renderScreen(browser, roots, checkout, work, out, page, ids) {
  const file = path.join(work, `${page.id}.html`);
  fs.writeFileSync(file, expandToken(page.source, checkout));
  const tab = await new Tab(browser, roots).open();
  try {
    await tab.go(pathToFileURL(file).href);
    const size = await tab.size();
    const marked = await tab.query('[data-to]');
    const failures = [];
    if (!await hasDerivedLine(tab, size)) {
      failures.push(...await stylingFailures(browser, roots, tab, marked));
    }
    const { areas, failures: areaFailures } = await areasOf(tab, marked, size, ids);
    failures.push(...areaFailures);
    for (const url of new Set(tab.denied)) {
      process.stderr.write(`Warning: ${page.id}: not loaded, outside the allowed files: ${url}\n`);
    }
    const image = `${page.id}.png`;
    const bytes = await tab.picture(size);
    fs.writeFileSync(path.join(out, image), bytes);
    const screen = { id: page.id, title: await tab.title() || page.id, image, source: page.source, areas };
    return { screen, bytes: bytes.length, failures };
  } finally {
    await tab.close();
  }
}

function readPages(pagesDir) {
  const pages = fs.readdirSync(pagesDir).filter((name) => name.endsWith('.html')).sort().map((name) => ({
    id: name.slice(0, -'.html'.length),
    source: fs.readFileSync(path.join(pagesDir, name), 'utf8'),
  }));
  if (!pages.length) throw new Refusal(`Write one .html file per screen in ${pagesDir}: it has none.`);
  if (pages.length > MAX_SCREENS) {
    throw new Refusal(`Use at most ${MAX_SCREENS} screens: ${pagesDir} has ${pages.length}.`);
  }
  for (const page of pages) {
    if (!SCREEN_ID.test(page.id)) {
      throw new Refusal(`Name each page with at most 32 lower-case letters, digits and hyphens: ${page.id}.html`);
    }
    if (/file:\/\//i.test(page.source)) {
      throw new Refusal(`Write ${TOKEN} in place of the file:// address in ${page.id}.html: the path differs per run.`);
    }
  }
  return pages;
}

function clearOutput(out) {
  for (const name of fs.readdirSync(out)) {
    if (name === 'screens.json' || name.endsWith('.png')) fs.rmSync(path.join(out, name));
  }
}

async function render(options, deps) {
  const root = fs.realpathSync(deps.artifacts);
  const checkout = fs.realpathSync(process.cwd());
  if (checkout === path.parse(checkout).root) {
    throw new Refusal('Run the script from the working folder: the current folder is the root of the disk.');
  }
  const roots = [checkout, root];
  const pagesDir = underRoot(options.pages, root, '--pages');
  const pages = readPages(pagesDir);
  const ids = pages.map((page) => page.id);
  if (!ids.includes(options.start)) throw new Refusal(`Set --start to one of: ${ids.join(' ')}.`);
  const out = underRoot(options.out, root, '--out', true);
  clearOutput(out);
  const work = fs.mkdtempSync(path.join(root, '.render-'));
  const browser = new Browser(deps.browser);
  try {
    await browser.start();
    const screens = [];
    const failures = [];
    let bytes = 0;
    for (const page of pages) {
      const result = await renderScreen(browser, roots, checkout, work, out, page, ids);
      screens.push(result.screen);
      bytes += result.bytes;
      failures.push(...result.failures.map((failure) => `${page.id}: ${failure}`));
    }
    for (const id of unreachable(screens, options.start)) {
      failures.push(`${id}: no marked element on a screen leads to it from ${options.start}`);
    }
    const json = `${JSON.stringify({ start: options.start, screens }, null, 2)}\n`;
    const jsonBytes = Buffer.byteLength(json);
    if (jsonBytes > MAX_SCREENS_JSON_BYTES) {
      failures.push(`screens.json is ${jsonBytes} bytes, over the limit of ${MAX_SCREENS_JSON_BYTES}`);
    }
    if (bytes + jsonBytes > MAX_VERSION_BYTES) {
      failures.push(`the version is ${bytes + jsonBytes} bytes, over the limit of ${MAX_VERSION_BYTES}`);
    }
    if (failures.length) throw new Refusal(`The render failed:\n${failures.join('\n')}`);
    fs.writeFileSync(path.join(out, 'screens.json'), json);
    return `${path.join(out, 'screens.json')}: ${screens.length} screens, ${bytes + jsonBytes} bytes`;
  } catch (error) {
    clearOutput(out);
    throw error;
  } finally {
    await browser.stop();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function underRoot(given, root, flag, create) {
  const whole = path.resolve(given);
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
  return real;
}

function unpack(options, deps) {
  const root = fs.realpathSync(deps.artifacts);
  const from = underRoot(options.unpack, root, '--unpack');
  const pagesDir = underRoot(options.pages, root, '--pages', true);
  const { screens } = JSON.parse(fs.readFileSync(from, 'utf8'));
  for (const screen of screens) {
    if (!SCREEN_ID.test(screen.id) || typeof screen.source !== 'string') {
      throw new Refusal(`Render this mockup again from its pages: a screen in ${from} has no usable id or source.`);
    }
    fs.writeFileSync(path.join(pagesDir, `${screen.id}.html`), screen.source);
  }
  return `${pagesDir}: ${screens.length} pages`;
}

function parseArguments(argv) {
  const options = {};
  for (const argument of argv) {
    const match = /^--(check|pages|out|start|unpack)(?:=(.*))?$/s.exec(argument);
    if (!match) throw new Refusal(`Use --check, --pages, --out, --start or --unpack: ${argument}`);
    options[match[1]] = match[2] === undefined ? true : match[2];
  }
  return options;
}

// Returns the exit status, and writes the result to stdout and each failure to stderr.
async function main(argv, deps = { browser: BROWSER, artifacts: ARTIFACTS }) {
  let options;
  try {
    options = parseArguments(argv);
    if (options.unpack) {
      if (!options.pages) throw new Refusal('Set --pages with --unpack.');
    } else if (!options.check && !(options.pages && options.out && options.start)) {
      throw new Refusal('Set --check, or --pages, --out and --start, or --unpack and --pages.');
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  try {
    if (options.unpack) {
      process.stdout.write(`${unpack(options, deps)}\n`);
      return 0;
    }
    if (!fs.existsSync(deps.browser)) {
      process.stderr.write(`No browser: ${deps.browser} does not exist, so this run can make no pictures.\n`);
      return 3;
    }
    if (options.check) {
      process.stdout.write(`${deps.browser} exists.\n`);
      return 0;
    }
    process.stdout.write(`${await render(options, deps)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Refusal ? error.message : error.stack}\n`);
    return 1;
  }
}

if (require.main === module) {
  const timer = setTimeout(() => {
    process.stderr.write(`The render failed: it took more than ${RUN_MS / 1000} s.\n`);
    process.exit(1);
  }, RUN_MS);
  timer.unref();
  // process.exit, because a pipe to the browser can keep the process alive after its work.
  main(process.argv.slice(2)).then((status) => process.exit(status));
}

module.exports = {
  DERIVED_LINE, FLAGS, MAX_SCREENS, TOKEN, UNBUILT_MARKERS, expandToken, fractions, isAllowedUrl,
  main, unbuiltMarkers, unreachable,
};
