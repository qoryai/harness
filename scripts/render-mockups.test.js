// Tests of the render script that need no browser. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const script = path.join(__dirname,
  '../modules/software-factory/skills/designing-mockups/render-mockups.js');
const render = require(script);

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'render-test-')));
const artifacts = path.join(tmp, 'artifacts');
const outside = path.join(tmp, 'outside');
const missing = path.join(tmp, 'no-browser');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const pagesDir = path.join(artifacts, 'mockup-draft');
const renderDir = path.join(artifacts, 'mockup-render');
for (const dir of [artifacts, outside, pagesDir]) fs.mkdirSync(dir, { recursive: true });
const write = (file, text) => fs.writeFileSync(file, text);
const url = (file) => pathToFileURL(file).href;

// Returns the exit status and what main wrote to each stream.
async function run(argv, browser = missing, limitMs = undefined) {
  const text = { out: '', err: '' };
  const stdout = { write: (chunk) => { text.out += chunk; } };
  const stderr = { write: (chunk) => { text.err += chunk; } };
  const status = await render.main(argv, { browser, artifacts, limitMs, stdout, stderr });
  return { status, ...text };
}
const args = (pages = pagesDir, out = renderDir) => [`--pages=${pages}`, `--out=${out}`];

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

test('a request passes only for the page itself, a data: address and about:blank', () => {
  const page = url(path.join(pagesDir, 'start.html'));
  assert.equal(render.refusalOf(page, page), null);
  assert.equal(render.refusalOf(`${page}#part`, page), null);
  assert.equal(render.refusalOf('about:blank', page), null);
  assert.equal(render.refusalOf('data:image/png;base64,AAAA', page), null);
  assert.match(render.refusalOf(url(path.join(pagesDir, 'next.html')), page), /loads no file/);
  assert.match(render.refusalOf(url(path.join(outside, 'secret.txt')), page), /loads no file/);
  assert.match(render.refusalOf('https://example.com/x.css', page), /loads no file/);
  assert.match(render.refusalOf(page, null), /loads no file/);
});

test('unbuilt markers count outside comments and strings only', () => {
  assert.deepEqual(render.unbuiltMarkers('@tailwind base;\n.a { @apply px-2; }'), ['@tailwind', '@apply']);
  assert.deepEqual(render.unbuiltMarkers('/* @tailwind */ .a::before { content: "@apply"; }'), []);
  assert.deepEqual(render.unbuiltMarkers('@media print {} @layer x {} @import "a.css";'), []);
  assert.deepEqual(render.unbuiltMarkers('@use-this {}'), []);
});

test('the skill and the script state the same line', () => {
  const skill = fs.readFileSync(path.join(path.dirname(script), 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(`<p data-styling="derived">${render.DERIVED_LINE}</p>`));
});

test('a link styled only by its colour or underline counts as styled', () => {
  assert.ok(render.STYLE_PROPS.includes('color'));
  assert.ok(render.STYLE_PROPS.includes('text-decoration-line'));
  const plain = Object.fromEntries(render.STYLE_PROPS.map((name) => [name, 'none']));
  // The browser's link: blue and underlined. The menu around it: dark grey, no underline.
  const link = { ...plain, color: 'rgb(0, 0, 238)', 'text-decoration-line': 'underline' };
  const menu = { ...plain, color: 'rgb(51, 51, 51)' };
  // color: inherit; text-decoration: none
  const inherited = { ...link, color: 'rgb(51, 51, 51)', 'text-decoration-line': 'none' };
  assert.equal(render.isStyled(inherited, link, menu, 'a'), true);
  assert.equal(render.isStyled({ ...link, color: 'rgb(51, 51, 51)' }, link, menu, 'a'), true);
  assert.equal(render.isStyled({ ...link, 'text-decoration-line': 'none' }, link, menu, 'a'), true);
  assert.equal(render.isStyled({ ...plain, color: 'rgb(51, 51, 51)' }, plain, menu, 'button'), true);
  assert.equal(render.isStyled(link, link, menu, 'a'), false);
});

test('the colour of a tag that inherits it counts only when it differs from the parent', () => {
  const plain = Object.fromEntries(render.STYLE_PROPS.map((name) => [name, 'none']));
  const menu = { ...plain, color: 'rgb(200, 0, 0)', 'text-decoration-line': 'underline' };
  const div = { ...plain, color: 'rgb(200, 0, 0)' };
  assert.equal(render.isStyled(div, plain, menu, 'div'), false);
  assert.equal(render.isStyled(div, plain, null, 'div'), true);
  assert.equal(render.isStyled({ ...div, color: 'rgb(1, 1, 1)' }, plain, menu, 'div'), true);
  // The underline counts against the browser's baseline only, also when the parent has it.
  assert.equal(render.isStyled({ ...plain, 'text-decoration-line': 'underline' }, plain, menu, 'div'), true);
  const filled = { ...div, 'background-color': 'rgb(1, 2, 3)' };
  assert.equal(render.isStyled(filled, plain, { ...menu, 'background-color': 'rgb(1, 2, 3)' }, 'div'), true);
});

test('a box counts inside the picture up to 1 px past its edge', () => {
  const size = { width: 1280, height: 800 };
  assert.equal(render.insidePicture({ x: 0, y: 0, w: 1280, h: 800 }, size), true);
  assert.equal(render.insidePicture({ x: 0, y: 760, w: 10, h: 40.5 }, size), true);
  assert.equal(render.insidePicture({ x: 0, y: 760, w: 10, h: 41 }, size), false);
  assert.equal(render.insidePicture({ x: -1, y: 0, w: 10, h: 10 }, size), false);
  assert.equal(render.insidePicture({ x: 0, y: 0, w: 0, h: 10 }, size), false);
});

test('a failure names the marked element by its tag, target and label', () => {
  const back = render.markedName({ tag: 'a', to: 'settings', label: 'Back' });
  assert.equal(back, '<a data-to="settings"> "Back"');
  const gone = render.markedName({ tag: 'button', to: 'gone', label: '' });
  assert.equal(gone, '<button data-to="gone">');
});

test('a failure cuts the label at 80 characters and removes control characters', () => {
  const name = render.markedName({ tag: 'a', to: 'set\u001btings', label: `\u001b[2J${'x'.repeat(100)}` });
  assert.doesNotMatch(name, /[\u0000-\u001f]/);
  const label = / "([^"]*)"$/.exec(name)[1];
  assert.equal(label.length, 80);
  assert.ok(label.endsWith('...'));
  assert.match(name, /^<a data-to="set tings"> "/);
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
  const page = await run(args());
  assert.equal(page.status, 3);
  assert.equal(fs.existsSync(renderDir), false);
});

test('wrong arguments exit with 2, and no argument starts another program', async () => {
  assert.equal((await run([])).status, 2);
  assert.equal((await run(['--browser=/bin/sh'])).status, 2);
  assert.equal((await run([`--pages=${pagesDir}`])).status, 2);
  const wrong = [['--pages'], ['--unpack=a', '--pages=a'], ['--start=a'], ['--pages=', '--out=a'],
    ['--check=a']];
  for (const argv of wrong) {
    const { status, err } = await run(argv);
    assert.equal(status, 2, argv.join(' '));
    assert.match(err, /^Usage: render-mockups\.js /m, argv.join(' '));
  }
});

test('--pages and --out accept only mockup-draft and mockup-render under artifacts', async () => {
  const browser = process.execPath;
  const other = path.join(artifacts, 'other');
  fs.mkdirSync(other);
  const err = async (pages, out) => (await run(args(pages, out), browser)).err;
  assert.match(await err(pagesDir, other), /Set --out to a folder named mockup-render/);
  assert.match(await err(other, renderDir), /Set --pages to a folder named mockup-draft/);
  const far = path.join(outside, 'mockup-render');
  assert.match(await err(pagesDir, far), /Set --out to a folder under/);
  const link = path.join(artifacts, 'link', 'mockup-render');
  fs.mkdirSync(path.dirname(link));
  fs.symlinkSync(other, link);
  assert.match(await err(pagesDir, link), /Set --out to a folder named mockup-render/);
});

test('a folder with no packed page or a wrong name fails before the browser starts', async () => {
  const browser = process.execPath;
  assert.match((await run(args(), browser)).err, /Run pack-mockups\.js first/);
  write(path.join(pagesDir, 'Bad Name.html'), 'x');
  assert.match((await run(args(), browser)).err, /at most 32/);
  fs.rmSync(path.join(pagesDir, 'Bad Name.html'));
  for (let i = 0; i <= render.MAX_SCREENS; i += 1) write(path.join(pagesDir, `s${i}.html`), 'x');
  assert.match((await run(args(), browser)).err, /at most 9/);
  for (let i = 0; i <= render.MAX_SCREENS; i += 1) fs.rmSync(path.join(pagesDir, `s${i}.html`));
});

test('a refusal leaves no picture of an earlier render', async () => {
  const browser = process.execPath;
  fs.mkdirSync(renderDir, { recursive: true });
  write(path.join(renderDir, 'old.png'), 'x');
  assert.equal((await run(args(), browser)).status, 1);
  assert.deepEqual(fs.readdirSync(renderDir), []);
});

// until resolves with the first value of check that is not null. It rejects with the error that
// check throws, or after ms milliseconds with an Error that starts with what. It polls with
// setInterval, which the mock of setTimeout leaves real.
function until(check, ms, what) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      let value;
      try {
        value = check();
      } catch (error) {
        clearInterval(timer);
        reject(error);
        return;
      }
      if (value !== null) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() > end) {
        clearInterval(timer);
        reject(new Error(`${what} after ${ms / 1000} s`));
      }
    }, 10);
  });
}

// The timer of the render is a mock, so that the timeout fires only after the stand-in browser
// writes its pid, however slowly the machine starts it.
test('on the timeout, the script stops the browser and clears the output', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pidFile = path.join(tmp, 'browser.pid');
  const stand = path.join(tmp, 'browser.sh');
  write(stand, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 60\n`);
  fs.chmodSync(stand, 0o755);
  write(path.join(pagesDir, 'a.html'), 'x');
  fs.mkdirSync(renderDir, { recursive: true });
  write(path.join(renderDir, 'old.png'), 'x');

  const running = run(args(), stand, 1000);
  // The newline at the end shows that echo wrote the whole pid.
  const written = () => {
    const found = /^(\d+)\n$/.exec(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : '');
    return found ? Number(found[1]) : null;
  };
  const pid = await until(written, 30000, 'The stand-in browser wrote no pid');
  // The stop of the browser waits for its exit with no limit, because its limit is a mock too.
  let ended = null;
  running.then((result) => { ended = result; }, (error) => { ended = { error }; });
  t.mock.timers.tick(1000);
  const { status, err, error } = await until(() => ended, 10000, 'The render did not end');
  if (error) throw error;
  assert.equal(status, 1);
  assert.match(err, /it took more than 1 s/);
  assert.deepEqual(fs.readdirSync(renderDir), []);
  const gone = () => {
    try {
      process.kill(pid, 0);
      return null;
    } catch (error) {
      return error.code === 'ESRCH' ? true : null;
    }
  };
  await until(gone, 5000, `The stand-in browser ${pid} still runs`);
  fs.rmSync(path.join(pagesDir, 'a.html'));
});
