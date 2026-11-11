// Tests of the pack script of designing-mockups. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
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
  assert.equal(lines.length, 164);
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

test('a fragment with % is refused, and a fragment matches an id byte for byte', () => {
  const page = (href) => pageOf('body', '<svg><defs><path id="p" d="M0 0"/>'
    + `<use id="u" href="#p"/></defs><use href="${href}"/></svg>`);
  assert.match(check(page('#%75')).join('\n'), /#<id> of this page, with no %/);
  assert.match(check(page('#u')).join('\n'), /no <use> and contains none/);
  assert.deepEqual(check(page('#U')), []);
  const fill = (target) => pageOf('body', `<svg><defs>${target}</defs>`
    + '<rect fill="url(#g)" stroke="url(&quot;#g&quot;)" width="1" height="1"/></svg>');
  assert.deepEqual(check(fill('<linearGradient id="g"><stop offset="0"/></linearGradient>')), []);
  assert.notDeepEqual(check(fill('<symbol id="g"/>')), []);
  assert.notDeepEqual(check(fill('<radialGradient id="G"/>')), []);
});

test('nested patterns, masks, clip paths and % ids are refused', () => {
  const svg = (inner) => pageOf('body', `<svg width="9" height="9"><defs>${inner}</defs></svg>`);
  const pages = [
    '<path id="L0%" d="M0 0"/><g id="L1%"><use href="#%4C0%"/></g>',
    '<pattern id="P0" width="1" height="1"><path d="M0 0"/></pattern>'
      + '<pattern id="P1" width="1" height="1"><rect fill="url(#P0)" width="1" height="1"/>'
      + '</pattern>',
    '<mask id="M0"><rect width="1" height="1"/></mask>'
      + '<mask id="M1"><rect mask="url(#M0)" width="1" height="1"/></mask>',
    '<clipPath id="C0"><rect width="1" height="1"/></clipPath>'
      + '<clipPath id="C1"><rect style="clip-path:url(#C0)" width="1" height="1"/></clipPath>',
  ];
  for (const inner of pages) assert.notDeepEqual(check(svg(inner)), [], inner);
  assert.notDeepEqual(check(pageOf('body', '<div style="clip-path:url(#c)">x</div>')), []);
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

test('a <select>, <option> or <optgroup> is refused, with a <button> as the fix', () => {
  const fix = (name) => `Draw the drop-down list as a <button type="button"> in place of `
    + `<${name}>: start.html line 1.`;
  assert.deepEqual(check(pageOf('body', '<select><div><a href="https://example.com/">x</a>'
    + '</div></select>')), [fix('select')]);
  assert.deepEqual(check(pageOf('body', '<p><option>x</option></p>')), [fix('option')]);
  assert.deepEqual(check(pageOf('body', '<div><OPTGROUP label="G"></OPTGROUP></div>')),
    [fix('OPTGROUP')]);
  // In an SVG drawing, select is an element name that SVG does not have.
  assert.deepEqual(check(pageOf('body', '<svg><select/></svg>')),
    ['Remove the <select> element, which a mockup page may not contain: start.html line 1.']);
});

test('an li or dd with no end tag before the next one names the end tag', () => {
  assert.match(check(pageOf('body', '<ul><li>a<li>b</li></li></ul>')).join('\n'),
    /^Close the <li> before the next one/);
  assert.match(check(pageOf('body', '<ul><li><span><li>b</li></span></li></ul>')).join('\n'),
    /^Close the <li> before the next one/);
  assert.match(check(pageOf('body', '<dl><dd>a<dd>b</dd></dd></dl>')).join('\n'),
    /^Close the open <dd> or <dt> before <dd>/);
  assert.deepEqual(check(pageOf('body', '<ul><li><ul><li>b</li></ul></li></ul>')), []);
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

test('the text search finds properties and most functions outside strings only', () => {
  for (const css of ['.behavior-note{color:red}', '.a{font-family:"Element("}',
    '.a::after{content:"image( behavior:"}', 'html{scroll-behavior:smooth}']) {
    assert.deepEqual(pack.cssRefusals(css, 'sheet'), [], css);
  }
  for (const css of ['.a{behavior:url(x.htc)}', '.a{-moz-binding : x}', '.a{b:\\61ttr(x)}',
    '.a::after{content:"javascript:x"}']) {
    assert.notDeepEqual(pack.cssRefusals(css, 'sheet'), [], css);
  }
});

test('a /* inside a CSS string starts no comment for the text search', () => {
  assert.deepEqual(check(pageOf('head', '<style>a{content:"/*"}b{content:"url(x)"}'
    + 'c{content:"*/"}</style>')),
  ['Use only a data: picture or {{checkout}}/<path> in CSS: start.html line 1, "x".']);
  assert.deepEqual(check(pageOf('head', '<style>a{content:"/*"}b{content:"@import x"}'
    + 'c{content:"*/"}</style>')), ['Remove the CSS rule @import: start.html line 1.']);
  const fonts = 'a{content:"/*"}b{font-family:"Element("}c{content:"*/"}';
  assert.deepEqual(check(pageOf('head', `<style>${fonts}</style>`)), []);
  // A real comment between two tokens is still removed: u/**/rl( reads as url(.
  assert.deepEqual(pack.cssRefusals('a{b:u/**/rl(x)}', 'sheet'),
    [[0, 'Use only a data: picture or {{checkout}}/<path> in CSS', 'x']]);
});

test('a quoted CSS address is compared as written, with no trimming', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const ends = (written) => 'Remove the whitespace at the ends of the quoted address: '
    + `start.html line 1, ${written}.`;
  for (const [css, written] of [[`.a{background:url(" ${png}")}`, `" ${png}"`],
    [`.a{background:url("${png}\t")}`, `"${png} "`], [`.a{background:SRC(' ${png}')}`, `' ${png}'`],
    [`.a{background:url("\\20 ${png}")}`, `"\\20 ${png}"`]]) {
    assert.deepEqual(check(pageOf('head', `<style>${css}</style>`)), [ends(written)], css);
  }
  assert.deepEqual(check(pageOf('body', `<p style="background:url('${png} ')">x</p>`)),
    [ends(`'${png} '`)]);
  const font = 'data:font/woff2;base64,d09GMmZvbnQ=';
  assert.deepEqual(check(pageOf('head',
    `<style>@font-face{font-family:f;src:src("${font} ")}</style>`)), [ends(`"${font} "`)]);
  // An unquoted address keeps an escaped space at its end.
  assert.deepEqual(check(pageOf('head', `<style>.a{background:url(${png}\\20)}</style>`)), [
    'Remove the escaped whitespace at the ends of the address in url(): start.html '
      + `line 1, url(${png}\\20).`]);
  // The text search shows a quoted address inside a CSS string as written, in its case.
  assert.deepEqual(pack.cssRefusals(`.a{content:"URL(' Data:x')"}`, 'sheet'),
    [[0, 'Remove the whitespace at the ends of the quoted address', { written: "' Data:x'" }]]);
  // Whitespace around the string, and around an unquoted address, is allowed.
  for (const css of [`.a{background:url( "${png}" )}`, `.a{background:url( ${png} )}`,
    `@font-face{font-family:f;src:src( "${font}" )}`]) {
    assert.deepEqual(check(pageOf('head', `<style>${css}</style>`)), [], css);
  }
  // A loaded sheet keeps such a data: address trimmed, and drops what still fails.
  const where = fixture('sheet-spaces', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'),
    `.c{background:url(" ${png}")}.d{background:url(" https://example.com/x.png ")}`);
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  assert.deepEqual(done.err.split('\n').filter(Boolean),
    ['Dropped: " https://example.com/x.png " in assets/app.css']);
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.match(start, new RegExp(`\\.c\\{background:url\\(${png.replace(/[+/]/g, '\\$&')}\\)\\}`));
});

test('a loaded sheet drops a declaration whose url() holds more than one address', () => {
  const where = fixture('sheet-two-strings', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'),
    '.a{color:red;background:url( "a" "b")}.after{color:green}\n.b{background:src("a" (b);)}');
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  assert.deepEqual(done.err.split('\n').filter(Boolean), [
    'Dropped: background:url( "a" "b") in assets/app.css',
    'Dropped: background:src("a" (b);) in assets/app.css']);
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.ok(start.includes('.a{color:red;}.after{color:green}\n.b{}</style>'), start);
});

test('a loaded sheet keeps the function name of each address it rewrites', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const where = fixture('sheet-names', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'), [
    `.c{color:red;background:-webkit-url(" ${png}")}`,
    '.d{background:-WEBKIT-URL("logo.png")}',
    `.e{background:URL(" ${png}")}`,
    '.f{background:src("logo.png")}',
    '.g{background:SRC("https://example.com/x.png")}',
  ].join('\n'));
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  assert.deepEqual(done.err.split('\n').filter(Boolean),
    ['Dropped: https://example.com/x.png in assets/app.css']);
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const logo = `data:image/png;base64,${PNG.toString('base64')}`;
  assert.ok(start.includes([`.c{color:red;background:-webkit-url("${png}")}`,
    `.d{background:-WEBKIT-URL("${logo}")}`, `.e{background:URL(${png})}`,
    `.f{background:src("${logo}")}`,
    `.g{background:SRC("${gif}")}`].join('\n')), start);
});

test('the page\'s own CSS keeps the function name of a checkout address', () => {
  const style = ['.a{background:-webkit-url("{{checkout}}/assets/logo.png")}',
    ".b{background:src('{{checkout}}/assets/logo.png')}",
    '.c{background:URL({{checkout}}/assets/logo.png)}'].join('');
  const page = START.replace('</head>', `<style>${style}</style></head>`);
  const where = fixture('own-names', { 'start.html': page, 'detail.html': DETAIL });
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  const uri = `data:image/png;base64,${PNG.toString('base64')}`;
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.ok(start.includes(`.a{background:-webkit-url("${uri}")}.b{background:src("${uri}")}`
    + `.c{background:URL(${uri})}`), start);
});

test('output shows a mark that reorders or breaks a line as a space', () => {
  const marks = '\u202E\u2028\u200F\u2066\u061C';
  const css = `.a{background:url(https://x.test/${marks}y)}`;
  const [line] = check(pageOf('head', `<style>${css}</style>`));
  assert.equal(line, 'Use only a data: picture or {{checkout}}/<path> in CSS: start.html line 1, '
    + '"https://x.test/     y".');
  const where = fixture('sheet-marks', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'), css);
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  assert.deepEqual(done.err.split('\n').filter(Boolean),
    ['Dropped: https://x.test/     y in assets/app.css']);
  const pages = { 'start.html': START, 'detail.html': DETAIL };
  pages[`old${marks}.html`] = '<!-- dropped -->\n';
  const named = fixture('dropped-marks', pages);
  const result = run(named, packArgs(named));
  assert.equal(result.status, 0, result.out);
  assert.ok(result.err.split('\n').includes('Dropped: old     .html'), result.err);
});

test('a page name with a line break, an ESC or a mark is written on one line', () => {
  const bad = 'x\u202E\u2066\nINJECTED\u001b[31m';
  const lines = (text) => text.split('\n').filter(Boolean);
  const clean = (text) => assert.ok(!/[\u001b\u202E\u2066]/.test(text) && !/^INJECTED/m.test(text),
    JSON.stringify(text));
  // A page marked as dropped.
  const dropped = fixture('name-dropped', { 'start.html': START, 'detail.html': DETAIL,
    [`${bad}.html`]: '<!-- dropped -->\n' });
  const one = run(dropped, packArgs(dropped));
  clean(one.err);
  assert.ok(lines(one.err).includes('Dropped: x   INJECTED [31m.html'), one.err);
  // A page whose name the pack refuses.
  const refused = fixture('name-refused', { 'start.html': START, 'detail.html': DETAIL,
    [`${bad}.html`]: DETAIL });
  const two = run(refused, packArgs(refused));
  assert.equal(two.status, 1, two.out);
  clean(two.out);
  assert.deepEqual(lines(two.out), ['Name each page with at most 32 lower-case letters, digits '
    + 'and hyphens: x   INJECTED [31m.html', 'Packed nothing: 1 finding.']);
  // A link in a version that --check reads.
  const where = fixture('name-link', { 'start.html': START, 'detail.html': DETAIL });
  assert.equal(run(where, packArgs(where)).status, 0);
  fs.symlinkSync(path.join(where.draft, 'start.html'), path.join(where.draft, `${bad}.html`));
  const three = run(where, [`--check=${where.draft}`]);
  assert.notEqual(three.status, 0, three.out);
  clean(three.out + three.err);
  assert.match(three.out, new RegExp('^Write the version in .* anew with the pack: '
    + 'x {3}INJECTED \\[31m\\.html is a link\\.\\nChecked nothing: 1 finding\\.\\n$'));
});

test('a CSS string with no closing quote at the end of the CSS is refused', () => {
  const close = 'Close the CSS string with its quote: start.html line 1, ';
  assert.deepEqual(check(pageOf('head', '<style>a{font-family:"Element(\\</style>')),
    [`${close}""Element(\\".`]);
  assert.deepEqual(check(pageOf('head', '<style>a{content:"x</style>')), [`${close}""x".`]);
  assert.deepEqual(check(pageOf('body', '<p style="font-family:\'Element(">x</p>')),
    [`${close}"'Element(".`]);
});

test('expression( and attr( are refused in CSS, also inside a string', () => {
  for (const [css, fn] of [['.a{content:"attr(x)"}', 'attr'],
    ['.a{content:"expression("}', 'expression'], [".a{content:'ATTR (x)'}", 'attr'],
    ['.a{content:"\\65 xpression("}', 'expression']]) {
    assert.match(check(pageOf('head', `<style>${css}</style>`)).join('\n'),
      new RegExp(`^Rewrite the CSS string without ${fn}\\(, counted with spaces removed: `), css);
  }
  assert.deepEqual(check(pageOf('head', '<style>.a{content:"element("}</style>')), []);
});

test('a loaded sheet drops a string that the text search refuses; a page fails', () => {
  const css = '.q::after{content:"Seat tr(ow)"}.r{content:"data: text";color:red}'
    + '.s{content:"Row 3"}';
  assert.deepEqual(check(pageOf('head', `<style>${css}</style>`)), [
    'Rewrite the CSS string without attr(, counted with spaces removed: start.html line 1, '
      + '"Seat tr(ow)".',
    'Rewrite the CSS string without data:text, counted with spaces removed: start.html line 1, '
      + '"data: text".']);
  assert.equal(check(pageOf('body', '<p style="content:\'expression (x)\'">x</p>')).length, 1);
  const where = fixture('sheet-string', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'), css);
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  assert.deepEqual(done.err.split('\n').filter(Boolean), [
    'Dropped: content:"Seat tr(ow)" in assets/app.css',
    'Dropped: content:"data: text"; in assets/app.css']);
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.match(start, /\.q::after\{\}\.r\{color:red\}\.s\{content:"Row 3"\}/);
});

test('a refused address in a quoted url() gives one finding, and a sheet drops it', () => {
  const css = '.a{background:url("data:text/html,x")}.b{background:url(\'javascript:x\')}';
  assert.deepEqual(check(pageOf('head', `<style>${css}</style>`)), [
    'Use only a data: picture or {{checkout}}/<path> in CSS: start.html line 1, '
      + '"data:text/html,x".',
    'Use only a data: picture or {{checkout}}/<path> in CSS: start.html line 1, '
      + '"javascript:x".']);
  const where = fixture('sheet-quoted-url', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'), css);
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  assert.deepEqual(done.err.split('\n').filter(Boolean), ['Dropped: data:text/html,x in '
    + 'assets/app.css', 'Dropped: javascript:x in assets/app.css']);
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.doesNotMatch(start, /data:text|javascript:/);
});

test('a page has at most 10,000 start tags, the 5 tags around the snippet included', () => {
  assert.equal((template.match(/<[A-Za-z]/g) || []).length, 5);
  const TAGS = 'Write at most 10,000 tags; each < before a letter counts, and the pack adds one '
    + 'per data-to: start.html line 1.';
  assert.deepEqual(check(pageOf('body', '<i></i>'.repeat(9995))), []);
  assert.deepEqual(check(pageOf('body', '<i></i>'.repeat(9996))), [TAGS]);
  // A < before a letter in text or a comment counts too; </ does not.
  assert.deepEqual(check(pageOf('body', `<!--${'<x>'.repeat(9996)}-->`)), [TAGS]);
  assert.deepEqual(check(pageOf('body', `<!--${'<x></x>'.repeat(9995)}-->`)), []);
});

test('a tag has at most 256 attributes, also a tag that the tokenizer reads in text', () => {
  const p = (n) => '<p ' + Array.from({ length: n }, (_, k) => `data-a${k + 1}="x"`).join(' ')
    + '>x</p>';
  const ATTRS = 'Write at most 256 attributes on one tag; each < or </ before a letter starts a '
    + 'tag: start.html line 1.';
  assert.deepEqual(check(pageOf('body', p(256))), []);
  assert.deepEqual(check(pageOf('body', p(257))), [ATTRS]);
  const words = (n) => Array.from({ length: n }, (_, k) => `w${k}`).join(' ');
  assert.deepEqual(check(pageOf('head', `<style>/*<x ${words(257)}*/</style>`)), [ATTRS]);
  // In "<x w0 … w253*/</style>", the tokenizer also starts the attribute names < and style, so
  // 254 words make 256 attributes.
  assert.deepEqual(check(pageOf('head', `<style>/*<x ${words(254)}*/</style>`)), []);
  assert.deepEqual(check(pageOf('head', `<style>/*<x ${words(255)}*/</style>`)), [ATTRS]);
  // A quoted > ends no tag, and an end tag counts as a tag.
  assert.deepEqual(check(pageOf('body', `<p title="${'>'.repeat(3)} ${words(300)}">x</p>`)), []);
  assert.deepEqual(check(pageOf('body', `<p>x</p ${words(257)}>`)).slice(0, 1), [ATTRS]);
});

test('the pack counts the tags of the page that it writes, with a link per data-to', () => {
  const tagsOf = (text) => (text.match(/<[A-Za-z]/g) || []).length;
  const pageWith = (links, total) => {
    const marked = '<span data-to="detail">Open</span>'.repeat(links);
    const page = START.replace('<div class="logo"></div>', marked);
    return page.replace('</body>', '<i></i>'.repeat(total - tagsOf(page)) + '</body>');
  };
  // START has 2 data-to elements, one of them a <span>. With 98 more spans, the source has
  // 9,950 tags, and over 10,000 after the pack puts an <a> around each span.
  const source = pageWith(98, 9950);
  assert.equal(tagsOf(source), 9950);
  const where = fixture('many-links', { 'start.html': source, 'detail.html': DETAIL });
  const done = run(where, packArgs(where));
  assert.equal(done.status, 1, done.out + done.err);
  assert.deepEqual(done.out.split('\n').filter(Boolean), ['Write at most 10,000 tags; each < '
    + 'before a letter counts, and the pack adds one per data-to: start.html line 9.',
  'Packed nothing: 1 finding.']);
  // 6,000 tags with 5,000 data-to elements fail too.
  const more = fixture('more-links', { 'start.html': pageWith(5000, 6000), 'detail.html': DETAIL });
  const refused = run(more, packArgs(more));
  assert.equal(refused.status, 1, refused.out + refused.err);
  assert.match(refused.out, /^Write at most 10,000 tags;/m);
});

test('stroke-dasharray is refused as an SVG attribute and as a CSS property', () => {
  assert.deepEqual(check(pageOf('body', '<svg><circle r="10" stroke-dasharray="2"/></svg>')),
    ['Remove the attribute stroke-dasharray from <circle>: start.html line 1, "2".']);
  for (const css of ['circle{stroke-dasharray:2}', 'circle{fill:red;STROKE-DASHARRAY : 2}']) {
    assert.deepEqual(check(pageOf('head', `<style>${css}</style>`)).length, 1, css);
  }
  assert.equal(check(pageOf('body', '<svg><circle r="1" style="stroke-dasharray:2"/></svg>'))
    .length, 1);
  assert.deepEqual(check(pageOf('body',
    '<svg><circle r="10" stroke-dashoffset="2" style="stroke-dashoffset:1"/></svg>')), []);
  assert.deepEqual(check(pageOf('head', '<style>.a{border:1px dashed #333}</style>')), []);
  const where = fixture('sheet-dash', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'), '.c{stroke-dasharray:2;color:red}');
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  assert.deepEqual(done.err.split('\n').filter(Boolean),
    ['Dropped: stroke-dasharray:2; in assets/app.css']);
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.match(start, /\.c\{color:red\}/);
});

test('behavior counts only as a property name, in a page and in a loaded sheet', () => {
  const classes = '.behavior{color:red}.behavior:hover{color:blue}';
  assert.deepEqual(check(pageOf('head', `<style>${classes}</style>`)), []);
  assert.deepEqual(check(pageOf('body', '<p style="color:red">x</p>')), []);
  for (const css of ['.a{behavior:url(x.htc)}', '.a{color:red; -ms-behavior : url(x)}',
    '.a{/* x */-moz-binding:url(x)}']) {
    assert.notDeepEqual(check(pageOf('head', `<style>${css}</style>`)), [], css);
  }
  assert.notDeepEqual(check(pageOf('body', '<p style="behavior:url(x)">x</p>')), []);
  for (const css of ['.a{.b{color:red}behavior:none}', '.a{.b{color:red} -moz-binding:none}']) {
    assert.match(pack.cssRefusals(css, 'sheet').map((r) => r[1]).join('\n'),
      /^Remove (behavior|-moz-binding) from the CSS$/m, css);
    assert.notDeepEqual(check(pageOf('head', `<style>${css}</style>`)), [], css);
  }
  const where = fixture('sheet-behavior', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'), `${classes}\n.c{behavior:url(x)}`);
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out);
  assert.deepEqual(done.err.split('\n').filter(Boolean),
    ['Dropped: behavior:url(x) in assets/app.css']);
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.match(start, /\.behavior\{color:red\}\.behavior:hover\{color:blue\}\n\.c\{\}/);
});

test('all <use> elements of a page copy at most 100,000 elements, targets included', () => {
  const svg = (paths) => '<svg><defs><g id="a">' + '<path d="M0 0"/>'.repeat(paths)
    + '</g></defs>' + '<use href="#a"/>'.repeat(1000) + '</svg>';
  assert.deepEqual(check(pageOf('body', svg(99))), []);
  assert.deepEqual(check(pageOf('body', svg(100))), ['Draw the page with fewer <use> elements: '
    + 'they copy over 100,000 elements, each target with the elements in it: start.html line 1.']);
});

test('all <use> elements of a page copy at most 1,048,576 characters, targets included', () => {
  const svg = (xs) => `<svg><defs><text id="a">${'x'.repeat(xs)}</text></defs>`
    + '<use href="#a"/>'.repeat(1000) + '</svg>';
  assert.deepEqual(check(pageOf('body', svg(1047))), []);
  assert.deepEqual(check(pageOf('body', svg(1048))), ['Draw the page with fewer <use> elements: '
    + 'they copy over 1,048,576 characters of attribute values and text, each target with the '
    + 'elements in it: start.html line 1.']);
  // A decoded reference counts as one character; &#x1F600; is one code point of two units.
  const refs = (ref, n) => `<svg><defs><text id="a">${ref.repeat(n)}</text></defs>`
    + '<use href="#a"/>'.repeat(1000) + '</svg>';
  assert.deepEqual(check(pageOf('body', refs('&#x1F600;', 1047))), []);
  assert.deepEqual(check(pageOf('body', refs('&amp;', 1047))), []);
  assert.equal(check(pageOf('body', refs('&#x1F600;', 1048))).length, 1);
});

test('a <stop> contains no element', () => {
  assert.deepEqual(check(pageOf('body', '<svg><defs><linearGradient id="g"><stop offset="0"><rect '
    + 'width="1" height="1"/></stop></linearGradient></defs></svg>')),
  ['Put no element in <stop>: start.html line 1.']);
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
  fs.mkdirSync(path.join(checkout, '.git'));
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
    artifacts: where.artifacts, cwd: where.checkout, home: where.home,
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
  assert.match(start, new RegExp('src:url\\(data:font/woff2;base64,d09GMmZvbnQ=\\) '
    + 'format\\("woff2"\\),url\\(data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAA'
    + 'LAAAAAABAAEAAAIBRAA7\\)'));
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
  const twice = run(where, [`--unpack=${v1}`, `--pages=${where.pages}`]);
  assert.equal(twice.status, 1);
  assert.match(twice.out, /^Change the pages in .*mockup-pages, with no --unpack: it has pages/);
  assert.equal(fs.readFileSync(path.join(where.pages, 'start.html'), 'utf8'), START);
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
  assert.match(missing.out, /^Write each page anew, with no --unpack: .* does not exist/);
  assert.match(missing.out, /\nUnpacked nothing: 1 finding\.\n$/);
  const v1 = path.join(where.artifacts, 'mockup', 'main', 'v1');
  const unusable = ['{"screens": [', '{"screens": [{"id": "../x"}]}',
    '{"screens": [{"id": "a"}, {"id": "a"}]}', '{"screens": [{"id": "a"}]}'];
  for (const text of unusable) {
    write(path.join(v1, 'screens.json'), text);
    const { status, out } = run(where, [`--unpack=${v1}`, `--pages=${pages}`]);
    assert.equal(status, 1, text);
    assert.match(out, /^Write each page anew, with no --unpack:/, text);
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
  assert.match(result.out, /Packed nothing: (1 finding|\d+ findings)\.\n$/);
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
    ['outside', '<img src="{{checkout}}/../outside.png" alt="x">', /outside the checkout/],
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
  // Only the text search of contract.md finds an address in a string.
  write(path.join(where.checkout, 'assets', 'app.css'),
    '.a::after{content:"url(https://example.com/x.png)"}');
  const { status, out } = run(where, packArgs(where));
  assert.equal(status, 1);
  assert.match(out, /^Use only a data: picture.*: start\.html line 4, the sheet assets\/app\.css/m);
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

test('a sheet of 1 MiB with refused functions packs within 2 s', () => {
  const where = fixture('sheet-large', { 'start.html': START, 'detail.html': DETAIL });
  const n = Math.floor((MiB - 10) / 8);
  write(path.join(where.checkout, 'assets', 'app.css'), `a{b:${'image() '.repeat(n)}}`);
  const begin = Date.now();
  const done = run(where, packArgs(where));
  assert.ok(Date.now() - begin < 2000, `${Date.now() - begin} ms`);
  assert.equal(done.status, 0, done.out);
  write(path.join(where.checkout, 'assets', 'app.css'), 'a{}'.repeat(MiB / 3 + 1));
  const over = run(where, packArgs(where));
  assert.equal(over.status, 1);
  assert.match(over.out, /the sheet has \d+ bytes, over the limit of a page/);
});

test('a refused rule around an @import packs with neither, with no stack trace', () => {
  const where = fixture('sheet-overlap', { 'start.html': START, 'detail.html': DETAIL });
  write(path.join(where.checkout, 'assets', 'app.css'),
    '@document x{a:image(}; @import "base.css"; )');
  const done = run(where, packArgs(where));
  assert.equal(done.status, 0, done.out + done.err);
  assert.match(done.err, /^Dropped: @document x\{a:image\(\} in assets\/app\.css\n$/);
  const start = fs.readFileSync(path.join(where.draft, 'start.html'), 'utf8');
  assert.match(start, /<style data-sheet="assets\/app\.css">; \.base\{color:#123\}\n \)<\/style>/);
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

test('{{checkout}} is the nearest folder with .git, and never contains the home folder', () => {
  const page = DETAIL.replace('</body>', '<img src="{{checkout}}/assets/logo.png" alt="x"></body>');
  const where = fixture('git-top', { 'start.html': page });
  const deeper = path.join(where.checkout, 'src', 'app');
  fs.mkdirSync(deeper, { recursive: true });
  const fromDeeper = run({ ...where, checkout: deeper }, packArgs(where));
  assert.equal(fromDeeper.status, 0, fromDeeper.out + fromDeeper.err);
  // A .git file, as in a worktree, marks a checkout too; git settings are not read.
  fs.rmSync(path.join(where.checkout, '.git'), { recursive: true });
  fs.writeFileSync(path.join(where.checkout, '.git'), 'gitdir: /elsewhere\n');
  assert.equal(run({ ...where, checkout: deeper }, packArgs(where)).status, 0);
  fs.rmSync(path.join(where.checkout, '.git'));
  const none = run(where, packArgs(where));
  assert.equal(none.status, 1);
  assert.match(none.out, /Fix src of <img>, the working folder is in no git checkout/);
  const home = path.join(where.checkout, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(where.checkout, '.git'));
  const fromHome = run({ ...where, home }, packArgs(where));
  assert.equal(fromHome.status, 2);
  assert.match(fromHome.err, /contains the home folder/);
});

test('with no entry in the user database, the home folder comes from $HOME', (t) => {
  const where = fixture('no-passwd', { 'start.html': DETAIL });
  const saved = process.env.HOME;
  t.after(() => { process.env.HOME = saved; });
  process.env.HOME = path.join(where.checkout, 'home');
  fs.mkdirSync(process.env.HOME);
  const userInfo = () => { throw new Error('no passwd entry'); };
  const result = { out: '', err: '' };
  const status = pack.main(packArgs(where), {
    artifacts: where.artifacts, cwd: where.checkout, userInfo,
    stdout: { write: (chunk) => { result.out += chunk; } },
    stderr: { write: (chunk) => { result.err += chunk; } },
  });
  assert.equal(status, 2, result.out + result.err);
  assert.match(result.err, /contains the home folder/);
});

test('a .ttf file packs only with a table directory after its first four bytes', () => {
  const table = (tag) => Buffer.concat([Buffer.from(tag, 'latin1'), Buffer.alloc(12)]);
  const font = (count, tags) => Buffer.concat([Buffer.from([0, 1, 0, 0, 0, count]),
    Buffer.alloc(6), ...tags.map(table)]);
  const cases = [
    [font(2, ['cmap', 'glyf']), 0], [font(0, []), 1], [font(65, ['cmap']), 1],
    [font(1, ['\x00\x01ab']), 1], [font(2, ['cmap']), 1],
  ];
  for (const [bytes, status] of cases) {
    const where = fixture(`ttf-${status}-${bytes.length}-${bytes[5]}`,
      { 'start.html': START, 'detail.html': DETAIL });
    write(path.join(where.checkout, 'assets', 'f.ttf'), bytes);
    write(path.join(where.checkout, 'assets', 'app.css'),
      '@font-face{font-family:F;src:url(f.ttf)}');
    const done = run(where, packArgs(where));
    assert.equal(done.status, 0, done.out);
    const dropped = /Dropped: f\.ttf in assets\/app\.css/.test(done.err);
    assert.equal(dropped, status === 1, bytes.toString('hex'));
  }
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
  assert.equal(wrong.status, 2);
  assert.match(wrong.err, /Set --start to one of: start\./);
});

test('the pack reads a page only as a plain file of the pages folder', () => {
  const cases = {
    symlink: (where) => fs.symlinkSync(path.join(where.checkout, 'assets', 'base.css'),
      path.join(where.pages, 'next.html')),
    hardlink: (where) => fs.linkSync(path.join(where.checkout, 'assets', 'base.css'),
      path.join(where.pages, 'next.html')),
    folder: (where) => fs.mkdirSync(path.join(where.pages, 'next.html')),
  };
  for (const [name, make] of Object.entries(cases)) {
    const where = fixture(`page-${name}`, { 'start.html': DETAIL });
    make(where);
    const result = run(where, packArgs(where));
    assert.equal(result.status, 1, name);
    assert.match(result.out + result.err, /it is a link or a folder/, name);
    assert.deepEqual(fs.readdirSync(where.draft), [], name);
  }
  // A screen may be named secrets: the secret names apply to files of the checkout.
  const named = fixture('page-secrets', { 'secrets.html': DETAIL.replace('"start"', '"secrets"') });
  assert.equal(run(named, packArgs(named, 'secrets')).status, 0);
});

test('--unpack and --check read a version file only as a plain file', () => {
  for (const kind of ['symlink', 'hardlink']) {
    const where = fixture(`version-${kind}`, { 'start.html': DETAIL });
    const v1 = path.join(where.artifacts, 'mockup', 'main', 'v1');
    for (const [name, bytes] of version()) write(path.join(v1, name), bytes);
    const other = path.join(where.checkout, 'assets', 'next.html');
    fs.renameSync(path.join(v1, 'next.html'), other);
    if (kind === 'symlink') fs.symlinkSync(other, path.join(v1, 'next.html'));
    else fs.linkSync(other, path.join(v1, 'next.html'));
    const checked = run(where, [`--check=${v1}`]);
    assert.equal(checked.status, 1, kind);
    assert.match(checked.out, /next\.html is a link\.\nChecked nothing: 1 finding\.\n$/, kind);
    const pages = path.join(where.artifacts, 'again', 'mockup-pages');
    const unpacked = run(where, [`--unpack=${v1}`, `--pages=${pages}`]);
    assert.equal(unpacked.status, 1, kind);
    assert.match(unpacked.out, /has next\.html as a link or a folder/, kind);
    assert.deepEqual(fs.readdirSync(pages), [], kind);
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
  for (const [pages, out] of [[where.pages, other], [other, where.draft]]) {
    assert.equal(run(where, [`--pages=${pages}`, `--out=${out}`, '--start=start']).status, 2);
  }
  write(path.join(where.pages, 'Bad.html'), 'x');
  const named = run(where, packArgs(where));
  assert.equal(named.status, 1);
  assert.match(named.out, /at most 32 lower-case.*\nPacked nothing: 1 finding\.\n$/);
});

test('--check exits 0 on a pass, 1 on findings, 2 on bad arguments, 3 on unreadable files', () => {
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
  assert.equal(run(where, [`--check=${path.join(where.artifacts, 'gone')}`]).status, 2);
  write(path.join(dir, 'screens.json'), '{"start":');
  const json = run(where, [`--check=${dir}`]);
  assert.equal(json.status, 1);
  assert.match(json.out, /^Write screens\.json as UTF-8 JSON .*\nChecked .*: 4 files, 1 finding\./);
  fs.rmSync(path.join(dir, 'screens.json'));
  assert.equal(run(where, [`--check=${dir}`]).status, 1);
  const unreadable = path.join(dir, 'start.html');
  fs.chmodSync(unreadable, 0);
  const blocked = run(where, [`--check=${dir}`]);
  fs.chmodSync(unreadable, 0o644);
  if (process.getuid && process.getuid() !== 0) assert.equal(blocked.status, 3);
  const noRoot = run({ ...where, artifacts: path.join(tmp, 'no-artifacts') }, packArgs(where));
  assert.equal(noRoot.status, 3);
  assert.match(noRoot.err, /^Make the artifact folder .* readable: it cannot be read\.\n$/);
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
