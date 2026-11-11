// Tests of the pack script of designing-mockups. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.join(__dirname,
  '../modules/software-factory/skills/designing-mockups/pack-mockups.js');
const pack = require(script);

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pack-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

// The shared cases of contract.md, copied byte for byte from Qory Apiary's side.
const casesFile = path.join(__dirname, 'testdata', 'mockup-cases.md');
const cases = fs.readFileSync(casesFile, 'utf8');
const template = /```\n(<!doctype html>[^\n]*)\n```/.exec(cases)[1];
const pageOf = (place, snippet) => template
  .replace('{head}', place === 'head' ? snippet : '')
  .replace('{body}', place === 'body' ? snippet : '');
const ids = new Set(['start', 'next']);
const check = (page) => pack.checkPage(page, { file: 'start.html', ids, title: 'Start' }).findings;

test('every line of each cases block in mockup-cases.md passes', async (t) => {
  const lines = [...cases.matchAll(/```cases\n([\s\S]*?)```/g)]
    .flatMap((block) => block[1].split('\n').filter(Boolean));
  assert.equal(lines.length, 123);
  for (const line of lines) {
    const [, verdict, place, snippet] = /^(allowed|refused) (head|body) (.*)$/.exec(line);
    await t.test(line, () => {
      const findings = check(pageOf(place, snippet));
      if (verdict === 'allowed') assert.deepEqual(findings, []);
      else assert.ok(findings.length > 0, 'no finding');
    });
  }
});

test('a page with 1,000 <use> elements is allowed, and one with 1,001 is refused', () => {
  const uses = (n) => pageOf('body', '<svg><defs><path id="p" d="M0 0"/></defs>'
    + `${'<use href="#p"/>'.repeat(n)}</svg>`);
  assert.deepEqual(check(uses(1000)), []);
  assert.match(check(uses(1001)).join('\n'), /at most 1000 <use>/);
});

test('a <use> may not point at a <use> by a %XX fragment either', () => {
  const page = pageOf('body', '<svg><defs><path id="p" d="M0 0"/><use id="u" href="#p"/></defs>'
    + '<use href="#%75"/></svg>');
  assert.match(check(page).join('\n'), /no <use> and contains none/);
});

test('keyword and address values compare by the contract', () => {
  assert.deepEqual(check(pageOf('body', '<input type="CHECKBOX">')), []);
  assert.notDeepEqual(check(pageOf('body', '<input type="chec\u212Abox">')), []);
  assert.notDeepEqual(check(pageOf('head', '<style>.a{background:url("d ata:image/png;base64,AA")}'
    + '</style>')), []);
  // The title is trimmed of ASCII white space only, as a browser trims it.
  assert.notDeepEqual(check(template.replace('<title>Start', '<title>Start&nbsp;')
    .replace('{head}', '').replace('{body}', '')), []);
});

test('the page of the cases with both places empty is allowed', () => {
  assert.deepEqual(check(pageOf('body', '')), []);
});

test('a page with no <title> is refused, and white space in the title is collapsed', () => {
  const untitled = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  assert.notDeepEqual(check(untitled), []);
  assert.deepEqual(check(template.replace('<title>Start</title>', '<title> \n Start \n </title>')
    .replace('{head}', '').replace('{body}', '')), []);
});

// version returns the files of a version whose screens are start and next, each linking to
// the other, with startPage as the page of start.
function version(startPage, extra = {}) {
  const page = (title, to) => `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<title>${title}</title></head><body><a href="${to}.html">${title}</a></body></html>`;
  const screens = {
    start: 'start',
    screens: [
      {
        id: 'start', title: 'Start', file: 'start.html', criteria: [],
        links: [{ to: 'next', label: 'Next' }],
      },
      {
        id: 'next', title: 'Next', file: 'next.html', criteria: ['ac-1'],
        links: [{ to: 'start', label: 'Start' }],
      },
    ],
    ...extra,
  };
  return new Map([
    ['screens.json', Buffer.from(JSON.stringify(screens))],
    ['start.html', Buffer.isBuffer(startPage) ? startPage : Buffer.from(page('Start', 'next'))],
    ['next.html', Buffer.from(page('Next', 'start'))],
  ]);
}

test('a page with a byte order mark, or with a byte that is not UTF-8, is refused', () => {
  const good = version().get('start.html');
  assert.deepEqual(pack.checkVersion(version()), []);
  const bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), good]);
  assert.match(pack.checkVersion(version(bom)).join('\n'), /byte order mark/);
  const ff = Buffer.concat([good, Buffer.from([0xFF])]);
  assert.match(pack.checkVersion(version(ff)).join('\n'), /UTF-8/);
});

test('a page of 1 MiB is allowed, and one byte more is refused', () => {
  const head = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<title>Start</title></head>'
    + '<body><a href="next.html">Next</a><!--';
  const tail = '--></body></html>';
  const fill = (size) => Buffer.from(head + 'x'.repeat(size - head.length - tail.length) + tail);
  assert.equal(fill(pack.MAX_PAGE_BYTES).length, 1024 * 1024);
  assert.deepEqual(pack.checkVersion(version(fill(pack.MAX_PAGE_BYTES))), []);
  const over = pack.checkVersion(version(fill(pack.MAX_PAGE_BYTES + 1)));
  assert.match(over.join('\n'), /Cut the page/);
});

test('the parser refuses each page that it cannot read for certain', () => {
  const refused = [
    ['body', '<div/onclick="x()">x</div>'],
    ['body', '<div class="a"onclick="x()">x</div>'],
    ['body', '<div class=a"b>x</div>'],
    ['body', '<div class="a" class="b">x</div>'],
    ['body', '<div title="&copy;">x</div>'],
    ['body', '<div title="R&D">x</div>'],
    ['body', '<div title="&#0;">x</div>'],
    ['body', '<div title="&#x80;">x</div>'],
    ['body', '<div title="&#xD800;">x</div>'],
    ['body', '<div title="&#1;">x</div>'],
    ['body', '<div title="&#;">x</div>'],
    ['body', '<!--x--!><p>x</p>-->'],
    ['body', '<!-->'],
    ['body', '<!--->'],
    ['body', '<!-- open'],
    ['body', '<?xml version="1.0"?>'],
    ['body', '<![CDATA[x]]>'],
    ['body', '<!ELEMENT x>'],
    ['body', '</>'],
    ['body', '</div foo>'],
    ['body', '<div>x</span>'],
    ['body', '<div>x'],
    ['body', '<div'],
    ['body', '<div/>'],
    ['body', '<br></br>'],
    ['body', '<p><div>x</div></p>'],
    ['body', '<p><span><ul><li>x</li></ul></span></p>'],
    ['body', '<table><div>x</div></table>'],
    ['body', '<table>text</table>'],
    ['body', '<table><tr><td>x</td></tr></table>'],
    ['body', '<dl><dd><div><dd>x</dd></div></dd></dl>'],
    ['body', '<dl><dt><span><div><dt>x</dt></div></span></dt></dl>'],
    ['body', '<li>x</li>'],
    ['body', '<ul><span><li>x</li></span></ul>'],
    ['body', '<a href="next.html"><a href="next.html">x</a></a>'],
    ['body', '<button><button>x</button></button>'],
    ['body', '<h1><h2>x</h2></h1>'],
    ['body', '<select><div>x</div></select>'],
    ['body', '<svg><title><b>x</b></title></svg>'],
    ['body', '<svg><p>x</p></svg>'],
    ['body', '<style>p{}'],
    ['body', '<title>Again</title>'],
    ['body', '<meta charset="utf-8">'],
    ['head', '<div>x</div>'],
    ['head', 'text'],
    ['body', `x${String.fromCharCode(1)}y`],
    ['body', `x${String.fromCharCode(0)}y`],
    ['body', `x${String.fromCharCode(0x85)}y`],
  ];
  for (const [place, snippet] of refused) {
    assert.ok(check(pageOf(place, snippet)).length > 0, snippet);
  }
  assert.ok(check(`${template}<p>x</p>`.replace('{head}', '').replace('{body}', '')).length > 0);
  assert.ok(check('<!doctype html><html><head><title>Start</title></head><body>').length > 0);
  assert.ok(check('<!doctype html><title>Start</title><p>x</p>').length > 0);
});

test('the parser reads what a browser reads the same way', () => {
  const allowed = [
    ['body', '<svg><text><![CDATA[a<b]]></text></svg>'],
    ['body', '<p>a < b &amp; c &copy; d</p>'],
    ['body', '<div title="a &amp; b &lt; &#65; &#x42;">x</div>'],
    ['body', '<div title=plain>x</div>'],
    ['body', '<DIV CLASS="a">x</DIV>'],
    ['body', '<br/><hr><img alt="x"/>'],
    ['body', '<textarea name="t"><p>not a tag</p></textarea>'],
    ['head', '<style>p::after{content:"</p>"}</style >'],
    ['body', '<ul><li><ul><li>x</li></ul></li></ul>'],
    ['body', '<dl><div><dt>a</dt><dd>b</dd></div></dl>'],
    ['body', '<table><tbody><tr><td>x</td></tr></tbody></table>'],
    ['body', '<dl><dd><dl><dt>a</dt><dd>b</dd></dl></dd></dl>'],
    ['body', '<p><button><div>x</div></button></p>'],
    ['body', '<svg><g><rect width="1" height="1"/></g></svg>'],
    ['head', '<!-- a comment -->'],
  ];
  for (const [place, snippet] of allowed) {
    assert.deepEqual(check(pageOf(place, snippet)), [], snippet);
  }
});

test('a reference in an attribute value is decoded before the rules compare it', () => {
  const { elements } = pack.parseHtml(pageOf('body', '<div title="&#106;ava&#x09;&amp;">x</div>'));
  assert.equal(elements.find((el) => el.lname === 'div').attrs[0].value, 'java\t&');
  assert.equal(pack.decodeRefs('&#106avascript').value, 'javascript');
  assert.ok(pack.decodeRefs('&copy;').bad);
  assert.equal(pack.decodeRefs('a & b').value, 'a & b');
});

test('the CSS rules hold against comments, strings and escapes', () => {
  const css = (text) => pack.cssRefusals(text, 'sheet');
  assert.ok(css('.a{content:"/*"} .b{background:url(https://example.com/a.png)} '
    + '.c{content:"*/"}').length);
  assert.ok(css('.a{background:url(a.png/*)} .b{x:url(https://example.com/a.png) /**/}').length);
  assert.ok(css('@\\69mport "a.css";').length);
  assert.ok(css('@-moz-document url-prefix(){}').length);
  assert.ok(css('.a{background:URL(https://example.com/a.png)}').length);
  assert.ok(css('.a{background:url(a b)}').length);
  assert.ok(css('.a{content:"open\n}').length);
  assert.ok(css('.a{x:1} /* open').length);
  assert.ok(css('.a{background:src("https://example.com/a.png")}').length);
  assert.ok(css('.a{background:-moz-element(#x)}').length);
  assert.ok(css('.a{background:url("java\\9 script:x")}').length);
  assert.ok(css('.a{background:url(data:image/png;charset=x;base64,AAAA)}').length);
  assert.deepEqual(css('html{scroll-behavior:smooth;overscroll-behavior:none}'), []);
  assert.deepEqual(css('.a{background:linear-gradient(#fff,#000);width:calc(1px + 2%)}'), []);
  assert.deepEqual(css('@media (min-width:10px){.a{color:red}} @font-face{src:local(x)}'), []);
  assert.deepEqual(css('.a{background:url(DATA:IMAGE/PNG;BASE64,AAAA)}'), []);
  assert.ok(pack.cssRefusals('url(data:image/png;base64,AAAA)', 'fragment').length);
  assert.deepEqual(pack.cssRefusals('url(#g) red', 'fragment'), []);
});

test('srcset is split as a browser splits it, with commas inside a data: URI', () => {
  const urls = pack.srcsetUrls('data:image/png;base64,AA== 1x,data:image/gif;base64,BB 2x, c.png,');
  assert.deepEqual(urls.map((u) => u.url),
    ['data:image/png;base64,AA==', 'data:image/gif;base64,BB', 'c.png']);
});

// ---- screens.json -------------------------------------------------------------------------

// screensWith returns the findings of version() with screens.json changed by change.
function screensWith(change) {
  const files = version();
  const value = JSON.parse(files.get('screens.json'));
  const changed = change(value) ?? value;
  const text = typeof changed === 'string' ? changed : JSON.stringify(changed);
  files.set('screens.json', Buffer.from(text));
  return pack.checkVersion(files);
}

test('screens.json passes only with the shape of contract.md', () => {
  const refused = {
    'an extra key': (v) => { v.extra = 1; },
    'no start': (v) => { delete v.start; },
    'a start that is no screen': (v) => { v.start = 'gone'; },
    'no screens': (v) => { v.screens = []; },
    'ten screens': (v) => {
      for (let i = 0; i < 8; i += 1) {
        v.screens.push({ ...v.screens[1], id: `s${i}`, file: `s${i}.html` });
      }
    },
    'an id in capitals': (v) => { v.screens[1].id = 'Next'; v.screens[1].file = 'Next.html'; },
    'an id of 33 characters': (v) => { v.screens[1].id = 'n'.repeat(33); },
    'an id twice': (v) => { v.screens[1].id = 'start'; },
    'a screen with an extra key': (v) => { v.screens[0].image = 'start.png'; },
    'a screen with no criteria': (v) => { delete v.screens[0].criteria; },
    'an empty title': (v) => { v.screens[0].title = ''; },
    'a title of 201 characters': (v) => { v.screens[0].title = 't'.repeat(201); },
    'a title with a tab': (v) => { v.screens[0].title = 'a\tb'; },
    'a title with a line feed': (v) => { v.screens[0].title = 'a\nb'; },
    'a title that is no string': (v) => { v.screens[0].title = 1; },
    'a file that is not <id>.html': (v) => { v.screens[0].file = 'other.html'; },
    'a criterion that is not ac-N': (v) => { v.screens[0].criteria = ['ac-0']; },
    'a criterion of five digits': (v) => { v.screens[0].criteria = ['ac-10000']; },
    'a criterion twice': (v) => { v.screens[0].criteria = ['ac-1', 'ac-1']; },
    '51 criteria': (v) => {
      v.screens[0].criteria = Array.from({ length: 51 }, (_, i) => `ac-${i + 1}`);
    },
    '101 links': (v) => {
      v.screens[0].links = Array.from({ length: 101 }, () => ({ to: 'next', label: 'Next' }));
    },
    'a link to no screen': (v) => { v.screens[0].links.push({ to: 'gone', label: 'Gone' }); },
    'a link with an extra key': (v) => { v.screens[0].links[0].x = 0.1; },
    'an empty label': (v) => { v.screens[0].links[0].label = ''; },
    'a label of 201 characters': (v) => { v.screens[0].links[0].label = 'l'.repeat(201); },
    'a label with a control character': (v) => {
      v.screens[0].links[0].label = `a${String.fromCharCode(0x1B)}`;
    },
    'a key twice': (v) => JSON.stringify(v)
      .replace('"start":"start"', '"start":"next","start":"start"'),
    'more than 64 KiB': (v) => `${JSON.stringify(v)}${' '.repeat(64 * 1024)}`,
    'links that differ from the page': (v) => {
      v.screens[0].links = [{ to: 'start', label: 'Self' }];
    },
  };
  assert.deepEqual(screensWith(() => {}), []);
  for (const [name, change] of Object.entries(refused)) {
    assert.ok(screensWith(change).length > 0, name);
  }
  assert.deepEqual(screensWith((v) => { v.screens[0].criteria = ['ac-1', 'ac-9999']; }), []);
  const again = { to: 'next', label: 'Again' };
  assert.deepEqual(screensWith((v) => { v.screens[0].links.push(again); }), []);
});

test('a label with a lone surrogate is refused, and one with an emoji is allowed', () => {
  const withLabel = (label) => {
    const files = version();
    const text = files.get('screens.json').toString().replace('"Next"', label);
    files.set('screens.json', Buffer.from(text));
    return pack.checkVersion(files);
  };
  assert.deepEqual(withLabel('"Next \\ud83d\\ude00"'), []);
  assert.match(withLabel('"Next \\ud800"').join('\n'), /Set each label of screen start/);
  assert.match(withLabel('"\\ude00 Next"').join('\n'), /Set each label of screen start/);
});

test('every screen must be reachable from start through links', () => {
  const files = version();
  const value = JSON.parse(files.get('screens.json'));
  value.start = 'next';
  value.screens[1].links = [];
  files.set('screens.json', Buffer.from(JSON.stringify(value)));
  const next = files.get('next.html').toString().replace(/<a [^>]*>Next<\/a>/, '');
  files.set('next.html', Buffer.from(next));
  assert.match(pack.checkVersion(files).join('\n'), /Add a data-to link to screen start/);
});

test('the version has only screens.json and its pages, at most 10 files and 10 MiB', () => {
  const extra = version();
  extra.set('start.png', Buffer.from('x'));
  assert.match(pack.checkVersion(extra).join('\n'), /as a screen in screens\.json: start\.png/);
  const missing = version();
  missing.delete('next.html');
  assert.match(pack.checkVersion(missing).join('\n'), /Add the page of screen next/);
  const none = version();
  none.delete('screens.json');
  assert.match(pack.checkVersion(none).join('\n'), /Add screens\.json/);
  const big = version();
  for (let i = 0; i < 10; i += 1) big.set(`x${i}.bin`, Buffer.alloc(1024 * 1024));
  const found = pack.checkVersion(big).join('\n');
  assert.match(found, /at most 10 files/);
  assert.match(found, /Cut the version to 10485760 bytes/);
});

// ---- Pack, unpack and check -----------------------------------------------------------------

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('png'),
]);
const WOFF2 = Buffer.from('wOF2font');

// fixture writes a checkout and an artifact folder with pages, and returns their paths.
function fixture(name, pages) {
  const root = path.join(tmp, name);
  const checkout = path.join(root, 'checkout');
  const artifacts = path.join(root, 'artifacts');
  write(path.join(checkout, 'assets', 'logo.png'), PNG);
  write(path.join(checkout, 'assets', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  write(path.join(checkout, 'assets', 'f.woff2'), WOFF2);
  write(path.join(checkout, 'assets', 'base.css'), '.base{color:#123}\n');
  write(path.join(checkout, 'assets', 'app.css'), [
    '@import "base.css";',
    '@import url(https://fonts.example.com/css?family=x);',
    '@font-face{font-family:F;src:url(f.woff2) format("woff2"),'
      + 'url(https://cdn.example.com/f.woff)}',
    '.logo{background:url("logo.png") no-repeat}',
    '.icon{background:url(icon.svg)}',
    '',
  ].join('\n'));
  write(path.join(checkout, '.env'), 'SECRET=1');
  write(path.join(root, 'outside.png'), PNG);
  for (const [file, text] of Object.entries(pages)) {
    write(path.join(artifacts, 'mockup-pages', file), text);
  }
  return {
    checkout, artifacts, pages: path.join(artifacts, 'mockup-pages'),
    draft: path.join(artifacts, 'mockup-draft'),
  };
}

function run(where, argv) {
  const text = { out: '', err: '' };
  const status = pack.main(argv, {
    artifacts: where.artifacts, cwd: where.checkout,
    stdout: { write: (chunk) => { text.out += chunk; } },
    stderr: { write: (chunk) => { text.err += chunk; } },
  });
  return { status, ...text };
}

const packArgs = (where, start = 'start') => [
  `--pages=${where.pages}`, `--out=${where.draft}`, `--start=${start}`,
];
const namesOf = (dir) => fs.readdirSync(dir).sort();
const bytesOf = (dir) => namesOf(dir).map((name) => fs.readFileSync(path.join(dir, name)));

const START = `<!doctype html>
<html lang="en" data-criteria="ac-1 ac-3">
<head><meta charset="utf-8"><title>Order
  list</title><link rel="stylesheet" href="{{checkout}}/assets/app.css"></head>
<body>
<nav><a data-to="detail" class="link">Open order 1</a></nav>
<button type="button" data-to="detail" aria-label="Open the first order">Open</button>
<div class="logo"></div>
</body>
</html>
`;
const DETAIL = `<!doctype html>
<html lang="en" data-criteria="ac-2">
<head><meta charset="utf-8"><title>Order 1</title></head>
<body><p><span data-to="start">Back to the list</span></p></body>
</html>
`;
const IMAGES = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pictures</title>
<style>.a{background:url({{checkout}}/assets/logo.png)}</style></head>
<body><img src="{{checkout}}/assets/logo.png" alt="Logo">
<img srcset="{{checkout}}/assets/logo.png 1x, {{checkout}}/assets/logo.png 2x" alt="Logo">
<svg width="1" height="1"><image href="{{checkout}}/assets/logo.png" width="1" height="1"/></svg>
<div style="background:url({{checkout}}/assets/logo.png)" data-to="start">Back</div></body>
</html>
`;

const THREE = { 'start.html': START, 'detail.html': DETAIL, 'images.html': IMAGES };

test('the script is executable, because the allow rule starts with its path', () => {
  fs.accessSync(script, fs.constants.X_OK);
});

test('the pack writes one self-contained page per screen and screens.json', () => {
  const where = fixture('pack', THREE);
  write(path.join(where.draft, 'old.png'), 'x');
  write(path.join(where.draft, 'old.html'), 'x');
  const done = run(where, packArgs(where, 'images'));
  assert.equal(done.status, 0, done.out + done.err);
  assert.match(done.out, /mockup-draft: 3 screens, \d+ bytes\n$/);
  const names = ['detail.html', 'images.html', 'screens.json', 'start.html'];
  assert.deepEqual(namesOf(where.draft), names);
  assert.deepEqual(done.err.split('\n').filter(Boolean), [
    'Dropped: https://fonts.example.com/css?family=x in assets/app.css',
    'Dropped: https://cdn.example.com/f.woff in assets/app.css',
    'Dropped: icon.svg in assets/app.css',
  ]);
  const screens = JSON.parse(fs.readFileSync(path.join(where.draft, 'screens.json'), 'utf8'));
  assert.deepEqual(screens, {
    start: 'images',
    screens: [
      {
        id: 'detail', title: 'Order 1', file: 'detail.html', criteria: ['ac-2'],
        links: [{ to: 'start', label: 'Back to the list' }],
      },
      {
        id: 'images', title: 'Pictures', file: 'images.html', criteria: [],
        links: [{ to: 'start', label: 'Back' }],
      },
      {
        id: 'start', title: 'Order list', file: 'start.html', criteria: ['ac-1', 'ac-3'],
        links: [
          { to: 'detail', label: 'Open order 1' }, { to: 'detail', label: 'Open the first order' },
        ],
      },
    ],
  });
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.match(start, /<a href="detail\.html" data-to="detail" class="link">Open order 1<\/a>/);
  assert.match(start,
    /<a href="detail\.html" style="display:contents;color:inherit;text-decoration:inherit">/);
  assert.match(start, /text-decoration:inherit"><button type="button" data-to="detail"/);
  assert.match(start, /<style data-sheet="assets\/app\.css">\.base\{color:#123\}/);
  assert.match(start,
    /src:url\(data:font\/woff2;base64,d09GMmZvbnQ=\) format\("woff2"\),url\(#dropped\)/);
  assert.match(start, /\.logo\{background:url\(data:image\/png;base64,/);
  assert.doesNotMatch(start, /\{\{checkout\}\}|https:|<link/);
  const images = fs.readFileSync(path.join(where.draft, 'images.html'), 'utf8');
  assert.doesNotMatch(images, /\{\{checkout\}\}/);
  assert.equal(images.match(/data:image\/png;base64,/g).length, 6);
  const checked = run(where, [`--check=${where.draft}`]);
  assert.equal(checked.status, 0, checked.out);
  assert.match(checked.out, /^Checked .*: 4 files, 0 findings\.\n$/);
});

test('the same pages pack to the same bytes', () => {
  const where = fixture('same', { 'start.html': START, 'detail.html': DETAIL });
  const bytes = () => {
    assert.equal(run(where, packArgs(where)).status, 0);
    return bytesOf(where.draft);
  };
  assert.deepEqual(bytes(), bytes());
});

test('unpack writes the pages back with the links removed and data-to kept', () => {
  const where = fixture('unpack', THREE);
  assert.equal(run(where, packArgs(where, 'images')).status, 0);
  const v1 = path.join(where.artifacts, 'mockup', 'main', 'v1');
  fs.mkdirSync(v1, { recursive: true });
  for (const name of namesOf(where.draft)) {
    fs.copyFileSync(path.join(where.draft, name), path.join(v1, name));
  }
  const pages = path.join(where.artifacts, 'again', 'mockup-pages');
  const done = run(where, [`--unpack=${v1}`, `--pages=${pages}`]);
  assert.equal(done.status, 0, done.err);
  assert.equal(done.out, `${pages}: 3 pages\n`);
  assert.equal(fs.readFileSync(path.join(pages, 'start.html'), 'utf8'), START);
  assert.equal(fs.readFileSync(path.join(pages, 'detail.html'), 'utf8'), DETAIL);
  const images = fs.readFileSync(path.join(pages, 'images.html'), 'utf8');
  assert.match(images,
    /<div style="background:url\(data:image\/png;base64,[^"]*\)" data-to="start">Back<\/div>/);
  assert.doesNotMatch(images, /href="start\.html"/);
  // The unpacked pages pack again to the same version.
  const before = bytesOf(where.draft);
  const again = { ...where, pages };
  assert.equal(run(again, packArgs(again, 'images')).status, 0);
  assert.deepEqual(bytesOf(where.draft), before);
});

test('unpack states what to do when the version is missing or unusable, and writes no page', () => {
  const where = fixture('unpack-bad', { 'start.html': DETAIL });
  const pages = path.join(where.artifacts, 'out', 'mockup-pages');
  const v9 = path.join(where.artifacts, 'mockup', 'main', 'v9');
  const missing = run(where, [`--unpack=${v9}`, `--pages=${pages}`]);
  assert.equal(missing.status, 1);
  assert.match(missing.err, /^Write each page anew, with no --unpack: .* does not exist/);
  const v1 = path.join(where.artifacts, 'mockup', 'main', 'v1');
  const unusable = ['{"screens": [', '{"screens": [{"id": "../x"}]}',
    '{"screens": [{"id": "a"}, {"id": "a"}]}', '{"screens": [{"id": "a"}]}'];
  for (const text of unusable) {
    write(path.join(v1, 'screens.json'), text);
    const { status, err } = run(where, [`--unpack=${v1}`, `--pages=${pages}`]);
    assert.equal(status, 1, text);
    assert.match(err, /^Write each page anew, with no --unpack:/, text);
    assert.deepEqual(fs.readdirSync(pages), [], text);
  }
});

// refusalOf packs the page start.html with the snippet in its body and returns the findings.
function refusalOf(name, body, extra = {}) {
  const page = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<title>Start</title></head>'
    + `<body>${body}</body></html>`;
  const where = fixture(name, { 'start.html': page, ...extra });
  write(path.join(where.draft, 'screens.json'), '{}');
  const result = run(where, packArgs(where));
  assert.equal(result.status, 1, `${body}\n${result.out}${result.err}`);
  assert.deepEqual(fs.readdirSync(where.draft), [], body);
  assert.match(result.out, /Packed nothing: \d+ findings\.\n$/);
  return result.out;
}

test('the pack refuses what it cannot fix, with the fix first and the place', () => {
  const cases = [
    ['script', '<script>x()</script>', /^Remove the <script> element: start\.html line 1\./],
    ['onclick', '<div onclick="x()">x</div>',
      /Remove the attribute onclick from <div>: start\.html line 1, "x\(\)"/],
    ['href', '<a href="https://example.com/">Out</a>',
      /Mark the link with data-to="<screen id>" in place of href/],
    ['target', '<a data-to="gone">Gone</a>', /Set data-to of <a> to one of the screens: start/],
    ['label', '<button type="button" data-to="start"></button>',
      /Give <button> data-to="start" a text or an aria-label/],
    ['cell', '<table><tbody><tr><td data-to="start">x</td></tr></tbody></table>',
      /Move data-to from <td> to an element inside it/],
    ['item', '<ul><li data-to="start">x</li></ul>', /Move data-to from <li>/],
    ['both', '<a href="start.html" data-to="start">x</a>',
      /Remove href from <a>, because data-to sets it/],
    ['svg-child', '<svg><rect data-to="start" aria-label="x" width="1" height="1"/></svg>',
      /Move data-to from <rect>/],
    ['nested', '<div data-to="start"><span data-to="start">x</span></div>',
      /Mark only one of two nested/],
    ['missing', '<img src="{{checkout}}/assets/gone.png" alt="x">',
      /Fix src of <img>, no such file/],
    ['svg-file', '<img src="{{checkout}}/assets/icon.svg" alt="x">',
      /draw an SVG file as <svg> in the page/],
    ['secret', '<img src="{{checkout}}/.env" alt="x">', /the name looks like a secret/],
    ['outside', '<img src="{{checkout}}/../outside.png" alt="x">', /outside the working folder/],
    ['relative', '<img src="assets/logo.png" alt="x">', /for src of <img>/],
    ['hosted-sheet', '<link rel="stylesheet" href="https://example.com/a.css">',
      /Put <link> only inside <head>/],
    ['hosted-url', '<div style="background:url(https://example.com/a.png)">x</div>',
      /in CSS: start\.html line 1/],
    ['bad-ref', '<div title="&copy;">x</div>', /Write the character itself, or &amp;/],
  ];
  for (const [name, body, expected] of cases) assert.match(refusalOf(name, body), expected, name);
});

test('the pack refuses a hosted sheet, a wrong criterion and an unreachable screen', () => {
  const head = (extra) => '<!doctype html><html lang="en" data-criteria="ac-1 ac-1 x"><head>'
    + '<meta charset="utf-8">'
    + `<title>Start</title>${extra}</head><body><p>x</p></body></html>`;
  const where = fixture('page-head', {
    'start.html': head('<link rel="stylesheet" href="https://example.com/a.css">'),
    'other.html': DETAIL.replace('data-to="start"', 'data-to="other"'),
  });
  const { status, out } = run(where, packArgs(where));
  assert.equal(status, 1);
  assert.match(out, /Link a sheet only as <link rel="stylesheet" href="\{\{checkout\}\}\/<path>">/);
  assert.match(out, /List each ac-<N> once in data-criteria: start\.html line 1, "ac-1"/);
  assert.match(out, /List only ac-<N> in data-criteria: start\.html line 1, "x"/);
  const clean = head('').replace(' data-criteria="ac-1 ac-1 x"', '');
  const other = DETAIL.replace('data-to="start"', 'data-to="other"');
  const reach = fixture('reach', { 'start.html': clean, 'other.html': other });
  assert.match(run(reach, packArgs(reach)).out,
    /Add a data-to link to screen other on a screen that start reaches/);
});

test('a finding in an inlined sheet names the sheet, and no line passes 200 characters', () => {
  const where = fixture('sheet', { 'start.html': START, 'detail.html': DETAIL });
  // Only the literal reading of contract.md finds behavior in a string.
  write(path.join(where.checkout, 'assets', 'app.css'), '.a::after{content:"behavior"}');
  const { status, out } = run(where, packArgs(where));
  assert.equal(status, 1);
  assert.match(out,
    /^Remove behavior from the CSS: start\.html line 4, the sheet assets\/app\.css\./m);
  for (const line of out.split('\n')) assert.ok(line.length <= 200, line);
});

test('the pack drops each refused declaration and rule of an inlined sheet', () => {
  const where = fixture('sheet-drops', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'), [
    '.a{color:red;background:-webkit-image-set("logo.png" 1x);margin:0}',
    '.b{background:image(x.png)}',
    '.c{BEHAVIOR:url(x.htc)}',
    '.d::after{content:attr(data-x)}',
    '@media print{@import "base.css";.e{color:blue}}',
    '@namespace svg url(http://www.w3.org/2000/svg);',
    '@-moz-document url-prefix(){.f{color:red}}',
    '.ok{color:green}',
  ].join('\n'));
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  assert.deepEqual(done.err.split('\n').filter(Boolean), [
    'Dropped: background:-webkit-image-set("logo.png" 1x); in assets/app.css',
    'Dropped: background:image(x.png) in assets/app.css',
    'Dropped: BEHAVIOR:url(x.htc) in assets/app.css',
    'Dropped: content:attr(data-x) in assets/app.css',
    'Dropped: @import "base.css"; in assets/app.css',
    'Dropped: @namespace svg url(http://www.w3.org/2000/svg); in assets/app.css',
    'Dropped: @-moz-document url-prefix(){.f{color:red}} in assets/app.css',
  ]);
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.match(start, /\.a\{color:red;margin:0\}\n\.b\{\}\n\.c\{\}\n\.d::after\{\}\n/);
  assert.match(start, /@media print\{\.e\{color:blue\}\}\n\n\n\.ok\{color:green\}/);
});

test('an @import of the checkout is inlined, and a loop of imports is dropped', () => {
  const where = fixture('loop', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'), '@import "a.css" print;\n.app{}');
  write(path.join(where.checkout, 'assets', 'a.css'), '@import "app.css";\n.a{}');
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  assert.match(done.err, /^Dropped: app\.css in a\.css of assets\/app\.css\n$/);
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.match(start, /@media print\{\n\.a\{\}\}\n\.app\{\}/);
});

test('a checkout path with a space, % or # packs and unpacks', () => {
  const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Start</title>'
    + '<link rel="stylesheet" href=" {{checkout}}/my styles/app 100%.css "></head>'
    + '<body><img src=" {{checkout}}/my images/logo #1.png " alt="Logo"></body></html>';
  const where = fixture('spaces', { 'start.html': page });
  write(path.join(where.checkout, 'my styles', 'app 100%.css'),
    '.a{background:url("../my images/logo 1.png")}');
  write(path.join(where.checkout, 'my images', 'logo #1.png'), PNG);
  // In a sheet, # starts a fragment, as in a browser.
  write(path.join(where.checkout, 'my images', 'logo 1.png'), PNG);
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out + done.err);
  const packed = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.match(packed, /<style data-sheet="my styles\/app 100%\.css">\.a\{background:url\(data:/);
  assert.match(packed, /<img src="data:image\/png;base64,/);
  const v1 = path.join(where.artifacts, 'mockup', 'main', 'v1');
  fs.mkdirSync(v1, { recursive: true });
  for (const name of namesOf(where.draft)) {
    fs.copyFileSync(path.join(where.draft, name), path.join(v1, name));
  }
  const pages = path.join(where.artifacts, 'again', 'mockup-pages');
  assert.equal(run(where, [`--unpack=${v1}`, `--pages=${pages}`]).status, 0);
  assert.match(fs.readFileSync(path.join(pages, 'start.html'), 'utf8'),
    /<link rel="stylesheet" href="\{\{checkout\}\}\/my styles\/app 100%\.css">/);
});

test('a settings file of the checkout gets into no page as a sheet, font or picture', () => {
  const settings = 'true: 1\npassword: example\n';
  const sheet = fixture('yml-link', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(sheet.checkout, 'config', 'database.yml'), settings);
  fs.writeFileSync(path.join(sheet.pages, 'start.html'),
    START.replace('assets/app.css', 'config/database.yml'));
  const linked = run(sheet, packArgs(sheet));
  assert.equal(linked.status, 1);
  assert.match(linked.out + linked.err, /Link only a \.css file of the checkout as a sheet/);
  const font = fixture('yml-font', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(font.checkout, 'config', 'database.yml'), settings);
  write(path.join(font.checkout, 'config', 'database.ttf'), settings);
  write(path.join(font.checkout, 'assets', 'app.css'), '@import "../config/database.yml";\n'
    + '@font-face{font-family:F;src:url(../config/database.yml),url(../config/database.ttf)}');
  const dropped = run(font, packArgs(font));
  assert.equal(dropped.status, 0, dropped.out);
  assert.deepEqual(dropped.err.split('\n').filter(Boolean), [
    'Dropped: ../config/database.yml in assets/app.css',
    'Dropped: ../config/database.yml in assets/app.css',
    'Dropped: ../config/database.ttf in assets/app.css',
  ]);
  const packed = fs.readFileSync(path.join(font.draft, 'start.html'), 'utf8');
  assert.doesNotMatch(packed, /password|dHJ1/);
  // A version whose page has a sheet of another type unpacks to nothing.
  const v1 = path.join(font.artifacts, 'mockup', 'main', 'v1');
  fs.mkdirSync(v1, { recursive: true });
  for (const name of namesOf(font.draft)) {
    fs.copyFileSync(path.join(font.draft, name), path.join(v1, name));
  }
  const page = path.join(v1, 'start.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8')
    .replace('data-sheet="assets/app.css"', 'data-sheet="config/database.yml"'));
  const pages = path.join(font.artifacts, 'again', 'mockup-pages');
  const unpacked = run(font, [`--unpack=${v1}`, `--pages=${pages}`]);
  assert.equal(unpacked.status, 1);
  assert.match(unpacked.out + unpacked.err, /its sheet "config\/database\.yml" is no \.css file/);
  assert.deepEqual(fs.readdirSync(pages), []);
});

test('{{checkout}} is the top of the git checkout, and never the home folder', (t) => {
  const page = DETAIL.replace('</body>', '<img src="{{checkout}}/assets/logo.png" alt="x"></body>');
  const where = fixture('git-top', { 'start.html': page });
  execFileSync('git', ['init', '-q'], { cwd: where.checkout });
  const deeper = path.join(where.checkout, 'src', 'app');
  fs.mkdirSync(deeper, { recursive: true });
  const fromDeeper = run({ ...where, checkout: deeper }, packArgs(where));
  assert.equal(fromDeeper.status, 0, fromDeeper.out + fromDeeper.err);
  const home = process.env.HOME;
  t.after(() => { process.env.HOME = home; });
  process.env.HOME = path.join(where.checkout, '..');
  const fromHome = run({ ...where, checkout: process.env.HOME }, packArgs(where));
  assert.equal(fromHome.status, 1);
  assert.match(fromHome.out + fromHome.err, /contains the home folder/);
  assert.equal(run(where, packArgs(where)).status, 0);
});

test('a page with the mark is dropped and reported, and the start must be a page', () => {
  const where = fixture('dropped', {
    'start.html': DETAIL, 'gone.html': `${pack.DROPPED_MARK}\n<p>old</p>`,
    'Bad Name.html': pack.DROPPED_MARK,
  });
  const done = run(where, packArgs(where));
  assert.match(done.err, /Dropped: Bad Name\.html\nDropped: gone\.html/);
  assert.equal(done.status, 0, done.out);
  const wrong = run(where, packArgs(where, 'gone'));
  assert.equal(wrong.status, 1);
  assert.match(wrong.err, /Set --start to one of: start\./);
});

test('the pack reads a page only as a plain file of the pages folder, with no secret name', () => {
  const cases = {
    symlink: (where) => fs.symlinkSync(path.join(where.checkout, 'assets', 'base.css'),
      path.join(where.pages, 'next.html')),
    hardlink: (where) => fs.linkSync(path.join(where.checkout, 'assets', 'base.css'),
      path.join(where.pages, 'next.html')),
    folder: (where) => fs.mkdirSync(path.join(where.pages, 'next.html')),
    secret: (where) => write(path.join(where.pages, 'secrets.html'), DETAIL),
  };
  for (const [name, make] of Object.entries(cases)) {
    const where = fixture(`page-${name}`, { 'start.html': DETAIL });
    make(where);
    const result = run(where, packArgs(where));
    assert.equal(result.status, 1, name);
    assert.match(result.out + result.err,
      name === 'secret' ? /the name looks like a secret/ : /it is a link or a folder/, name);
    assert.deepEqual(fs.readdirSync(where.draft), [], name);
  }
});

test('folders outside the artifact folder or with another name are refused', () => {
  const where = fixture('folders', { 'start.html': DETAIL });
  const other = path.join(where.artifacts, 'other');
  fs.mkdirSync(other);
  const err = (pages, out) => run(where, [`--pages=${pages}`, `--out=${out}`, '--start=start']).err;
  assert.match(err(where.pages, other), /Set --out to a folder named mockup-draft/);
  assert.match(err(other, where.draft), /Set --pages to a folder named mockup-pages/);
  assert.match(err(where.pages, `${tmp}/mockup-draft`), /Set --out to a folder under/);
  assert.match(run(where, [`--check=${tmp}`]).err, /Set --check to a folder under/);
  write(path.join(where.pages, 'Bad.html'), 'x');
  assert.match(run(where, packArgs(where)).err, /at most 32 lower-case/);
});

test('--check exits 0 on a pass, 1 on findings, 2 on bad arguments, 3 on unreadable input', () => {
  const where = fixture('check', {});
  const dir = path.join(where.artifacts, 'mockup', 'main', 'v1');
  for (const [name, bytes] of version()) write(path.join(dir, name), bytes);
  assert.equal(run(where, [`--check=${dir}`]).status, 0);
  write(path.join(dir, 'start.png'), 'x');
  const found = run(where, [`--check=${dir}`]);
  assert.equal(found.status, 1);
  assert.match(found.out, /^Remove the file from the version, or list it as a screen/);
  assert.equal(run(where, ['--check']).status, 2);
  assert.equal(run(where, [`--check=${dir}`, '--start=a']).status, 2);
  assert.equal(run(where, []).status, 2);
  assert.equal(run(where, ['--pages=a', '--out=b']).status, 2);
  const usage = /^Use --pages, --out, --start, --unpack or --check/;
  assert.match(run(where, ['--browser=/bin/sh']).err, usage);
  assert.equal(run(where, [`--check=${path.join(where.artifacts, 'gone')}`]).status, 3);
  write(path.join(dir, 'screens.json'), '{"start":');
  assert.equal(run(where, [`--check=${dir}`]).status, 3);
  fs.rmSync(path.join(dir, 'screens.json'));
  assert.equal(run(where, [`--check=${dir}`]).status, 3);
});

// Pages of nearly 1 MiB that a slow checker would take minutes on, or overflow the stack.
const MiB = 1024 * 1024;
const LARGE = {
  'nested-div': () => { const n = 90000; return `${'<div>'.repeat(n)}x${'</div>'.repeat(n)}`; },
  'data-attributes': () => {
    let attrs = '';
    for (let i = 0; attrs.length < MiB - 1000; i += 1) attrs += ` data-a${i.toString(36)}`;
    return `<div${attrs}>x</div>`;
  },
  'refused-attributes': () => {
    let attrs = '';
    for (let i = 0; attrs.length < MiB - 1000; i += 1) attrs += ` x${i.toString(36)}`;
    return `<div${attrs}>x</div>`;
  },
  'refused-elements': () => '<x></x>\n'.repeat(Math.floor((MiB - 1000) / 8)),
  'nested-span-link': () => {
    const n = 20000;
    return `<div data-to="start">${'<span>'.repeat(n)}x${'</span>'.repeat(n)}</div>`;
  },
};

for (const [name, body] of Object.entries(LARGE)) {
  test(`a page of 1 MiB with ${name} packs or fails within 10 s`, () => {
    const page = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
      + `<title>Start</title></head><body>${body()}</body></html>`;
    assert.ok(Buffer.byteLength(page) <= MiB, `${Buffer.byteLength(page)} bytes`);
    const where = fixture(`large-${name}`, { 'start.html': page });
    const begin = Date.now();
    const result = run(where, packArgs(where));
    const ms = Date.now() - begin;
    assert.ok(ms < 10000, `${ms} ms`);
    assert.ok([0, 1].includes(result.status), result.err);
    assert.doesNotMatch(result.err, /\n {4}at /);
    assert.ok(result.out.split('\n').length <= 53, 'at most 50 findings and 2 more lines');
  });
}

test('the skill and the script state the same mark', () => {
  const skill = fs.readFileSync(path.join(path.dirname(script), 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(pack.DROPPED_MARK));
});
