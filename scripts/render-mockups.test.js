// Tests of the render script that need no browser. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const script = path.join(__dirname, '../modules/software-factory/skills/designing-mockups/render-mockups.js');
const render = require(script);

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-')));
const checkout = path.join(tmp, 'checkout');
const artifacts = path.join(tmp, 'artifacts');
const outside = path.join(tmp, 'outside');
const missing = path.join(tmp, 'no-browser');
const roots = [checkout, artifacts];
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

for (const dir of [checkout, artifacts, outside, path.join(artifacts, 'pages')]) {
  fs.mkdirSync(dir, { recursive: true });
}
const write = (file, text) => fs.writeFileSync(file, text);
write(path.join(checkout, 'app.css'), 'p {}');
write(path.join(checkout, '.env'), 'x');
write(path.join(checkout, '.env.local'), 'x');
write(path.join(artifacts, 'page.html'), 'x');
write(path.join(outside, 'secret.txt'), 'x');
fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(checkout, 'link.css'));
fs.symlinkSync(path.join(checkout, '.env'), path.join(checkout, 'env-link.css'));
const url = (file) => pathToFileURL(file).href;

// main writes to the process's streams, so a test holds them and returns what they got.
async function run(argv, browser = missing) {
  const text = { out: '', err: '' };
  const outWrite = process.stdout.write;
  const errWrite = process.stderr.write;
  process.stdout.write = (chunk) => { text.out += chunk; return true; };
  process.stderr.write = (chunk) => { text.err += chunk; return true; };
  try {
    const status = await render.main(argv, { browser, artifacts });
    return { status, ...text };
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
}

test('the script is executable, because the allow rule starts with its path', () => {
  fs.accessSync(script, fs.constants.X_OK);
});

test('the flags turn off the network and never allow a page to read files', () => {
  assert.ok(render.FLAGS.includes('--no-proxy-server'));
  assert.ok(render.FLAGS.includes('--host-resolver-rules=MAP * ~NOTFOUND'));
  assert.ok(render.FLAGS.includes('--no-sandbox'));
  assert.ok(!render.FLAGS.includes('--allow-file-access-from-files'));
});

test('a request passes only for a file of the checkout or the artifact folder', () => {
  assert.equal(render.isAllowedUrl('about:blank', roots), true);
  assert.equal(render.isAllowedUrl(url(path.join(checkout, 'app.css')), roots), true);
  assert.equal(render.isAllowedUrl(url(path.join(artifacts, 'page.html')), roots), true);
  assert.equal(render.isAllowedUrl(url(path.join(outside, 'secret.txt')), roots), false);
  assert.equal(render.isAllowedUrl(`${url(checkout)}/../outside/secret.txt`, roots), false);
  assert.equal(render.isAllowedUrl(url(path.join(checkout, 'gone.css')), roots), false);
  assert.equal(render.isAllowedUrl(url(checkout), roots), false);
  assert.equal(render.isAllowedUrl('https://example.com/x.css', roots), false);
  assert.equal(render.isAllowedUrl('file://host/etc/passwd', roots), false);
  assert.equal(render.isAllowedUrl('not a url', roots), false);
});

test('a request fails for a link out of the roots and for a secret file', () => {
  assert.equal(render.isAllowedUrl(url(path.join(checkout, 'link.css')), roots), false);
  assert.equal(render.isAllowedUrl(url(path.join(checkout, '.env')), roots), false);
  assert.equal(render.isAllowedUrl(url(path.join(checkout, '.env.local')), roots), false);
  assert.equal(render.isAllowedUrl(url(path.join(checkout, 'env-link.css')), roots), false);
});

test('unbuilt markers count outside comments and strings only', () => {
  assert.deepEqual(render.unbuiltMarkers('@tailwind base;\n.a { @apply px-2; }'), ['@tailwind', '@apply']);
  assert.deepEqual(render.unbuiltMarkers('/* @tailwind */ .a::before { content: "@apply"; }'), []);
  assert.deepEqual(render.unbuiltMarkers('@media print {} @layer x {} @import "a.css";'), []);
  assert.deepEqual(render.unbuiltMarkers('@use-this {}'), []);
});

test('the skill lists each unbuilt marker of the script', () => {
  const skill = fs.readFileSync(path.join(path.dirname(script), 'SKILL.md'), 'utf8');
  for (const marker of render.UNBUILT_MARKERS) assert.ok(skill.includes(`\`@${marker}\``), marker);
});

test('the skill and the script state the same line', () => {
  const skill = fs.readFileSync(path.join(path.dirname(script), 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(`<p data-styling="derived">${render.DERIVED_LINE}</p>`));
});

test('the token becomes the checkout, and an unreachable screen is found', () => {
  assert.equal(render.expandToken('{{checkout}}/a.css', '/w x'), 'file:///w%20x/a.css');
  const screens = [
    { id: 'a', areas: [{ to: 'b' }] },
    { id: 'b', areas: [{ to: 'a' }] },
    { id: 'c', areas: [{ to: 'a' }] },
  ];
  assert.deepEqual(render.unreachable(screens, 'a'), ['c']);
});

test('an area outside the picture has no fractions', () => {
  assert.deepEqual(render.fractions({ x: 128, y: 80, w: 128, h: 80 }, 1280, 800), { x: 0.1, y: 0.1, w: 0.1, h: 0.1 });
  assert.equal(render.fractions({ x: -10, y: 0, w: 5, h: 5 }, 1280, 800), null);
  assert.equal(render.fractions({ x: 1270, y: 0, w: 20, h: 5 }, 1280, 800), null);
  assert.equal(render.fractions({ x: 0, y: 0, w: 0, h: 5 }, 1280, 800), null);
});

test('with no browser, --check and a render exit with 3', async () => {
  const check = await run(['--check']);
  assert.equal(check.status, 3);
  assert.match(check.err, /^No browser: /);
  const page = await run([`--pages=${artifacts}/pages`, `--out=${artifacts}/draft`, '--start=a']);
  assert.equal(page.status, 3);
  assert.equal(fs.existsSync(`${artifacts}/draft`), false);
});

test('wrong arguments exit with 2, and no argument starts another program', async () => {
  assert.equal((await run([])).status, 2);
  assert.equal((await run(['--browser=/bin/sh'])).status, 2);
  assert.equal((await run(['--pages=a'])).status, 2);
  assert.equal((await run(['--unpack=a'])).status, 2);
});

test('folders outside the artifact folder and bad pages fail before the browser starts', async () => {
  const browser = process.execPath;
  const draft = `--out=${artifacts}/draft`;
  const pages = path.join(artifacts, 'pages');
  assert.match((await run([`--pages=${outside}`, draft, '--start=a'], browser)).err, /Set --pages/);
  assert.match((await run([`--pages=${pages}`, draft, '--start=a'], browser)).err, /has none/);

  write(path.join(pages, 'a.html'), '<a href="file:///etc/passwd">x</a>');
  assert.match((await run([`--pages=${pages}`, draft, '--start=a'], browser)).err, /file:\/\/ address/);
  write(path.join(pages, 'a.html'), 'x');
  assert.match((await run([`--pages=${pages}`, draft, '--start=b'], browser)).err, /Set --start/);
  assert.match((await run([`--pages=${pages}`, `--out=${outside}/d`, '--start=a'], browser)).err, /Set --out/);

  const long = 'a'.repeat(33);
  write(path.join(pages, `${long}.html`), 'x');
  assert.match((await run([`--pages=${pages}`, draft, '--start=a'], browser)).err, /at most 32/);
  fs.rmSync(path.join(pages, `${long}.html`));

  for (let i = 0; i < render.MAX_SCREENS; i += 1) write(path.join(pages, `s${i}.html`), 'x');
  assert.match((await run([`--pages=${pages}`, draft, '--start=a'], browser)).err, /at most 9/);
  for (let i = 0; i < render.MAX_SCREENS; i += 1) fs.rmSync(path.join(pages, `s${i}.html`));
});

test('--unpack writes each source, and refuses an id that leaves the folder', async () => {
  const from = path.join(artifacts, 'screens.json');
  write(from, JSON.stringify({ screens: [{ id: 'cart', source: '<p>{{checkout}}</p>' }] }));
  const done = await run([`--unpack=${from}`, `--pages=${artifacts}/unpacked`]);
  assert.equal(done.status, 0);
  assert.equal(fs.readFileSync(`${artifacts}/unpacked/cart.html`, 'utf8'), '<p>{{checkout}}</p>');

  write(from, JSON.stringify({ screens: [{ id: '../x', source: 'x' }] }));
  assert.equal((await run([`--unpack=${from}`, `--pages=${artifacts}/unpacked`])).status, 1);
  assert.equal(fs.existsSync(`${artifacts}/x.html`), false);
});
