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

const pagesDir = path.join(artifacts, 'mockup-pages');
const draftDir = path.join(artifacts, 'mockup-draft');
const nested = path.join(checkout, 'nested');
for (const dir of [checkout, artifacts, outside, pagesDir, path.join(nested, '.env'), path.join(checkout, '.env.d'), path.join(checkout, '.git')]) {
  fs.mkdirSync(dir, { recursive: true });
}
const write = (file, text) => fs.writeFileSync(file, text);
write(path.join(checkout, 'app.css'), 'p {}');
write(path.join(checkout, '.env'), 'x');
write(path.join(checkout, '.env.local'), 'x');
write(path.join(nested, '.env', 'prod.css'), 'x');
write(path.join(checkout, '.env.d', 'prod.css'), 'x');
write(path.join(checkout, '.git', 'config'), 'x');
for (const name of ['.envrc', 'id_ed25519', 'server.pem', 'tls.KEY', 'credentials', 'credentials.json', '.netrc', '.gitignore', 'environment.css']) {
  write(path.join(checkout, name), 'x');
}
write(path.join(artifacts, 'page.html'), 'x');
write(path.join(outside, 'secret.txt'), 'x');
fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(checkout, 'link.css'));
fs.symlinkSync(path.join(checkout, '.env'), path.join(checkout, 'env-link.css'));
const url = (file) => pathToFileURL(file).href;

// Returns the exit status and what main wrote to each stream.
async function run(argv, browser = missing, limitMs = undefined) {
  const text = { out: '', err: '' };
  const stdout = { write: (chunk) => { text.out += chunk; } };
  const stderr = { write: (chunk) => { text.err += chunk; } };
  const status = await render.main(argv, { browser, artifacts, limitMs, stdout, stderr });
  return { status, ...text };
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

test('the browser lays out a tall page as wide as its picture, with no scrollbar', () => {
  assert.ok(render.FLAGS.includes('--hide-scrollbars'));
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

test('a request fails for a secret name in any folder of the path, also when encoded', () => {
  assert.equal(render.isAllowedUrl(url(path.join(nested, '.env', 'prod.css')), roots), false);
  assert.equal(render.isAllowedUrl(url(path.join(checkout, '.env.d', 'prod.css')), roots), false);
  assert.equal(render.isAllowedUrl(`${url(nested)}/%2eenv/prod.css`, roots), false);
  assert.equal(render.isAllowedUrl(`${url(nested)}/%2Eenv/prod.css`, roots), false);
  assert.equal(render.isAllowedUrl(url(path.join(checkout, '.git', 'config')), roots), false);
  for (const name of ['.envrc', 'id_ed25519', 'server.pem', 'tls.KEY', 'credentials', 'credentials.json', '.netrc']) {
    assert.equal(render.isAllowedUrl(url(path.join(checkout, name)), roots), false, name);
  }
  for (const name of ['.gitignore', 'environment.css']) {
    assert.equal(render.isAllowedUrl(url(path.join(checkout, name)), roots), true, name);
  }
});

test('a secret name in a folder above a root does not refuse the files below it', () => {
  const above = path.join(tmp, 'credentials', 'checkout');
  fs.mkdirSync(above, { recursive: true });
  write(path.join(above, 'app.css'), 'x');
  assert.equal(render.isAllowedUrl(url(path.join(above, 'app.css')), [above]), true);
});

test('a refusal states when the name looks like a secret', () => {
  assert.match(render.refusalOf(url(path.join(checkout, '.env')), roots), /looks like a secret/);
  assert.match(render.refusalOf(url(path.join(checkout, 'secrets.css')), roots), /looks like a secret/);
  assert.match(render.refusalOf('https://example.com/x.css', roots), /outside/);
  assert.equal(render.refusalOf(url(path.join(checkout, 'app.css')), roots), null);
});

test('a refusal states a missing file under a root, and nothing about one outside', () => {
  assert.equal(render.refusalOf(url(path.join(checkout, 'gone.css')), roots), 'no such file');
  assert.equal(render.refusalOf(url(path.join(artifacts, 'gone.png')), roots), 'no such file');
  assert.match(render.refusalOf(url(path.join(outside, 'gone.css')), roots), /outside/);
  assert.match(render.refusalOf(url(outside), roots), /outside/);
});

test('the work file of a screen does not contain its id, so no id refuses its page', () => {
  const work = path.join(artifacts, '.render-names');
  fs.mkdirSync(work);
  write(path.join(work, render.workName(0)), 'x');
  assert.equal(render.isAllowedUrl(url(path.join(work, render.workName(0))), roots), true);
  fs.rmSync(work, { recursive: true });
});

test('unbuilt markers count outside comments and strings only', () => {
  assert.deepEqual(render.unbuiltMarkers('@tailwind base;\n.a { @apply px-2; }'), ['@tailwind', '@apply']);
  assert.deepEqual(render.unbuiltMarkers('/* @tailwind */ .a::before { content: "@apply"; }'), []);
  assert.deepEqual(render.unbuiltMarkers('@media print {} @layer x {} @import "a.css";'), []);
  assert.deepEqual(render.unbuiltMarkers('@use-this {}'), []);
});

test('the skill and the script state the same line and the same mark', () => {
  const skill = fs.readFileSync(path.join(path.dirname(script), 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(`<p data-styling="derived">${render.DERIVED_LINE}</p>`));
  assert.ok(skill.includes(render.DROPPED_MARK));
});

test('the token becomes the checkout, and an unreachable screen is found', () => {
  assert.equal(render.expandToken('{{checkout}}/a.css', '/w x'), 'file:///w%20x/a.css');
  const screens = [
    { id: 'a', areas: [{ to: 'b' }] },
    { id: 'b', areas: [{ to: 'a' }] },
    { id: 'c', areas: [{ to: 'a' }] },
  ];
  assert.deepEqual(render.unreachable(screens, 'a'), ['c']);
  const chain = [
    { id: 'a', areas: [{ to: 'c' }] },
    { id: 'b', areas: [] },
    { id: 'c', areas: [{ to: 'b' }] },
  ];
  assert.deepEqual(render.unreachable(chain, 'a'), []);
});

test('an area outside the picture has no fractions', () => {
  assert.deepEqual(render.fractions({ x: 128, y: 80, w: 128, h: 80 }, 1280, 800), { x: 0.1, y: 0.1, w: 0.1, h: 0.1 });
  assert.equal(render.fractions({ x: -10, y: 0, w: 5, h: 5 }, 1280, 800), null);
  assert.equal(render.fractions({ x: 1270, y: 0, w: 20, h: 5 }, 1280, 800), null);
  assert.equal(render.fractions({ x: 0, y: 0, w: 0, h: 5 }, 1280, 800), null);
  assert.equal(render.fractions({ x: 1280, y: 0, w: 0.5, h: 5 }, 1280, 800), null);
});

test('an area that ends less than 1 px past the picture is cut at its edge', () => {
  // A link at the foot of a page 1760 px tall, as Chromium 153 measured it.
  const area = render.fractions({ x: 0, y: 1721.4375, w: 162.890625, h: 39 }, 1280, 1760);
  assert.ok(area);
  assert.ok(area.y + area.h <= 1);
  assert.equal(render.fractions({ x: 0, y: 1721, w: 10, h: 40 }, 1280, 1760), null);
});

test('rounding leaves each area inside the picture', () => {
  const area = render.fractions({ x: 260, y: 0, w: 1020, h: 5 }, 1280, 800);
  assert.ok(area);
  assert.ok(area.x + area.w <= 1);
  for (let x = 0; x < 1280; x += 1) {
    const { x: start, w } = render.fractions({ x, y: 0, w: 1280 - x, h: 5 }, 1280, 800);
    assert.ok(start + w <= 1, String(x));
  }
  for (let y = 0; y < 800; y += 1) {
    const { y: start, h } = render.fractions({ x: 0, y, w: 5, h: 800 - y }, 1280, 800);
    assert.ok(start + h <= 1, String(y));
  }
});

test('a tab that left the page is told apart from one that shows it', () => {
  const page = 'file:///tmp/qory-artifacts/.render-x/a.html';
  assert.equal(render.sameFile(page, page), true);
  assert.equal(render.sameFile(`${page}#part`, page), true);
  assert.equal(render.sameFile('file:///workspace/other.html', page), false);
  assert.equal(render.sameFile('chrome-error://chromewebdata/', page), false);
});

test('with no browser, --check and a render exit with 3', async () => {
  const check = await run(['--check']);
  assert.equal(check.status, 3);
  assert.match(check.err, /^No browser: /);
  const page = await run([`--pages=${pagesDir}`, `--out=${draftDir}`, '--start=a']);
  assert.equal(page.status, 3);
  assert.equal(fs.existsSync(draftDir), false);
});

test('wrong arguments exit with 2, and no argument starts another program', async () => {
  assert.equal((await run([])).status, 2);
  assert.equal((await run(['--browser=/bin/sh'])).status, 2);
  assert.equal((await run(['--pages=a'])).status, 2);
  assert.equal((await run(['--unpack=a'])).status, 2);
  for (const argv of [['--pages'], ['--unpack'], ['--unpack', '--pages=a'], ['--unpack=a', '--pages'], ['--pages=', '--out=a', '--start=a'], ['--check=a']]) {
    const { status, err } = await run(argv);
    assert.equal(status, 2, argv.join(' '));
    assert.match(err, /^Usage: render-mockups\.js /m, argv.join(' '));
  }
});

test('folders outside the artifact folder and bad pages fail before the browser starts', async () => {
  const browser = process.execPath;
  const draft = `--out=${draftDir}`;
  const pages = pagesDir;
  assert.match((await run([`--pages=${outside}`, draft, '--start=a'], browser)).err, /Set --pages/);
  assert.match((await run([`--pages=${pages}`, draft, '--start=a'], browser)).err, /has none/);

  write(path.join(pages, 'a.html'), '<a href="file:///etc/passwd">x</a>');
  assert.match((await run([`--pages=${pages}`, draft, '--start=a'], browser)).err, /file:\/\/ address/);
  write(path.join(pages, 'a.html'), 'x');
  assert.match((await run([`--pages=${pages}`, draft, '--start=b'], browser)).err, /Set --start/);
  assert.match((await run([`--pages=${pages}`, `--out=${outside}/mockup-draft`, '--start=a'], browser)).err, /Set --out/);

  const long = 'a'.repeat(33);
  write(path.join(pages, `${long}.html`), 'x');
  assert.match((await run([`--pages=${pages}`, draft, '--start=a'], browser)).err, /at most 32/);
  fs.rmSync(path.join(pages, `${long}.html`));

  for (let i = 0; i < render.MAX_SCREENS; i += 1) write(path.join(pages, `s${i}.html`), 'x');
  assert.match((await run([`--pages=${pages}`, draft, '--start=a'], browser)).err, /at most 9/);
  for (let i = 0; i < render.MAX_SCREENS; i += 1) fs.rmSync(path.join(pages, `s${i}.html`));
  fs.rmSync(path.join(pages, 'a.html'));
});

test('--out and --pages accept only the folder with the right name', async () => {
  const browser = process.execPath;
  const other = path.join(artifacts, 'other');
  fs.mkdirSync(other);
  const pagesFlag = `--pages=${pagesDir}`;
  const out = await run([pagesFlag, `--out=${other}`, '--start=a'], browser);
  assert.equal(out.status, 1);
  assert.match(out.err, /Set --out to a folder named mockup-draft/);
  const pages = await run([`--pages=${other}`, `--out=${draftDir}`, '--start=a'], browser);
  assert.equal(pages.status, 1);
  assert.match(pages.err, /Set --pages to a folder named mockup-pages/);
  const unpacked = await run([`--unpack=${path.join(other, 'x.json')}`, `--pages=${other}`], browser);
  assert.equal(unpacked.status, 1);
  assert.match(unpacked.err, /Set --pages to a folder named mockup-pages|Set --unpack/);

  const link = path.join(artifacts, 'link', 'mockup-draft');
  fs.mkdirSync(path.dirname(link));
  fs.symlinkSync(other, link);
  const linked = await run([pagesFlag, `--out=${link}`, '--start=a'], browser);
  assert.match(linked.err, /Set --out to a folder named mockup-draft/);
});

test('a page with the mark is dropped and reported, also under a name that the script refuses', async () => {
  const browser = process.execPath;
  const named = 'Bad Name.html';
  write(path.join(pagesDir, named), `${render.DROPPED_MARK}\n<p>old</p>`);
  write(path.join(pagesDir, 'gone.html'), render.DROPPED_MARK);
  const none = await run([`--pages=${pagesDir}`, `--out=${draftDir}`, '--start=a'], browser);
  assert.match(none.err, /Dropped: Bad Name\.html/);
  assert.match(none.err, /Dropped: gone\.html/);
  assert.match(none.err, /has none/);
  write(path.join(pagesDir, 'a.html'), 'x');
  const kept = await run([`--pages=${pagesDir}`, `--out=${draftDir}`, '--start=gone'], browser);
  assert.match(kept.err, /Set --start to one of: a\./);
  for (const name of [named, 'gone.html', 'a.html']) fs.rmSync(path.join(pagesDir, name));
});

test('a refusal leaves no picture or screens.json of an earlier render', async () => {
  const browser = process.execPath;
  const fill = () => {
    fs.mkdirSync(draftDir, { recursive: true });
    write(path.join(draftDir, 'old.png'), 'x');
    write(path.join(draftDir, 'screens.json'), '{}');
  };
  const empty = () => assert.deepEqual(fs.readdirSync(draftDir), []);

  fill();
  assert.equal((await run([`--pages=${outside}`, `--out=${draftDir}`, '--start=a'], browser)).status, 1);
  empty();
  fill();
  assert.match((await run([`--pages=${pagesDir}`, `--out=${draftDir}`, '--start=a'], browser)).err, /has none/);
  empty();
  write(path.join(pagesDir, 'a.html'), 'x');
  fill();
  assert.match((await run([`--pages=${pagesDir}`, `--out=${draftDir}`, '--start=b'], browser)).err, /Set --start/);
  empty();
  fs.rmSync(path.join(pagesDir, 'a.html'));
});

test('on the timeout, the script stops the browser, clears the output and removes its folder', async () => {
  const pidFile = path.join(tmp, 'browser.pid');
  const stand = path.join(tmp, 'browser.sh');
  write(stand, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 60\n`);
  fs.chmodSync(stand, 0o755);
  write(path.join(pagesDir, 'a.html'), 'x');
  fs.mkdirSync(draftDir, { recursive: true });
  write(path.join(draftDir, 'old.png'), 'x');

  const { status, err } = await run([`--pages=${pagesDir}`, `--out=${draftDir}`, '--start=a'], stand, 1000);
  assert.equal(status, 1);
  assert.match(err, /it took more than 1 s/);
  assert.deepEqual(fs.readdirSync(draftDir), []);
  assert.deepEqual(fs.readdirSync(artifacts).filter((name) => name.startsWith('.render-')), []);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  fs.rmSync(path.join(pagesDir, 'a.html'));
});

test('--unpack writes each source, and refuses an id that leaves the folder', async () => {
  const from = path.join(artifacts, 'screens.json');
  write(from, JSON.stringify({ screens: [{ id: 'cart', source: '<p>{{checkout}}</p>' }] }));
  const unpacked = path.join(artifacts, 'unpacked', 'mockup-pages');
  const done = await run([`--unpack=${from}`, `--pages=${unpacked}`]);
  assert.equal(done.status, 0);
  assert.equal(fs.readFileSync(path.join(unpacked, 'cart.html'), 'utf8'), '<p>{{checkout}}</p>');

  write(from, JSON.stringify({ screens: [{ id: '../x', source: 'x' }] }));
  assert.equal((await run([`--unpack=${from}`, `--pages=${unpacked}`])).status, 1);
  assert.equal(fs.existsSync(path.join(artifacts, 'unpacked', 'x.html')), false);
});

test('--unpack states what to do for a mockup with no screens.json', async () => {
  const from = path.join(artifacts, 'mockup', 'main', 'v1', 'screens.json');
  const unpacked = path.join(artifacts, 'no-screens', 'mockup-pages');
  const done = await run([`--unpack=${from}`, `--pages=${unpacked}`]);
  assert.equal(done.status, 1);
  assert.match(done.err, /^Write each page anew, with no --unpack:/);
  assert.deepEqual(fs.readdirSync(unpacked), []);
});
