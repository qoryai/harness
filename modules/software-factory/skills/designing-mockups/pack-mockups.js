#!/usr/bin/env node
// Packs a mockup's HTML pages into a version, unpacks a version into editable pages, and
// checks a version by the rules that Qory Apiary also checks on the server.
//
//   pack-mockups.js --pages=<dir>/mockup-pages --out=<dir>/mockup-draft --start=<screen id>
//   pack-mockups.js --unpack=<dir>/mockup/main/v<N> --pages=<dir>/mockup-pages
//   pack-mockups.js --check=<dir>
//
// A version is screens.json plus one self-contained page per screen. The pack inlines each
// linked sheet into <style>, turns each picture and font into a data: URI, and turns each
// data-to into a link to <id>.html. It needs Node only and opens no network connection. It
// reads only files under the checkout and the artifact folder, and no file of the checkout
// with a secret name. The checkout is the nearest folder from the working folder upwards
// with a .git entry; outside a checkout, each {{checkout}} address is a finding.
//
// Output: one finding per line on stdout, each starting with the fix, at most 200
// characters, then one result line, such as `Packed nothing: 2 findings.`. Each `Dropped:`
// line on stderr names a page, an address or a rule that the pack left out. A wrong argument
// or folder, and a file that cannot be read, go to stderr.
//
// Exit status: 0 done, 1 findings, 2 a wrong argument or folder, 3 a file or folder that
// exists cannot be read.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const ARTIFACTS = '/tmp/qory-artifacts';
const TOKEN = '{{checkout}}';
// The agent that writes the pages has no delete tool, so this first line drops a page.
const DROPPED_MARK = '<!-- dropped -->';
const PAGES_FOLDER = 'mockup-pages';
const DRAFT_FOLDER = 'mockup-draft';
const SCREENS = 'screens.json';
const USAGE = 'Usage: pack-mockups.js --pages=<dir>/mockup-pages --out=<dir>/mockup-draft '
  + '--start=<screen id> | --unpack=<dir>/mockup/main/v<N> --pages=<dir>/mockup-pages '
  + '| --check=<dir>';

// The limits of contract.md, which Qory Apiary checks too.
const MAX_SCREENS = 9;
const MAX_FILES = 10;
const MAX_VERSION_BYTES = 10 * 1024 * 1024;
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_SCREENS_BYTES = 64 * 1024;
// limitText writes a limit as SKILL.md does, such as 1 MiB (1,048,576 bytes).
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const limitText = (bytes) => {
  const [unit, size] = bytes % (1024 * 1024) === 0 ? ['MiB', 1024 * 1024] : ['KiB', 1024];
  return `${bytes / size} ${unit} (${grouped(bytes)} bytes)`;
};
const MAX_TEXT = 200;
const MAX_CRITERIA = 50;
const MAX_LINKS = 100;
const SCREEN_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CRITERION = /^ac-[1-9][0-9]{0,3}$/;
// An @import of the checkout inlines its sheet; this depth stops a loop of imports.
const MAX_IMPORT_DEPTH = 8;
// The most sheets that one page inlines, imports included. A small sheet costs the pack about
// as much time as a large one, so the limit on bytes alone lets 70,000 imports through.
const MAX_PAGE_SHEETS = 1000;
// A dropped address in an inlined sheet becomes this transparent GIF of 1 x 1 pixel, which
// loads nothing. contract.md refuses a fragment such as url(#dropped) in CSS.
const DROPPED_DATA = 'data:image/gif;base64,'
  + 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const LINE = 200;
const QUOTE = 80;
// The findings written out. A list of findings has its first ones as lines and each later one
// as null, so that thousands of findings cost no time to write.
const MAX_FINDINGS = 50;

// A finding that stops the pack or unpack: exit status 1.
class Refusal extends Error {}
// The sheets, pictures and fonts of a page pass a limit of a page. at and value, when set,
// place the finding.
class PageTooLarge extends Refusal {}
// A wrong argument or folder: exit status 2.
class ArgumentError extends Error {}
// An input that cannot be read: exit status 3.
class Unreadable extends Error {}
// screens.json that is no UTF-8 JSON: a finding of the version.
class BadJson extends Error {}
// Two changes of the pack to the same text, which applyEdits cannot both make.
class EditOverlap extends Error {
  constructor(at) {
    super(`overlapping edits at ${at}`);
    this.at = at;
  }
}
// A page that the parser cannot read for certain. at is the offset in the page.
class Unparsable extends Error {
  constructor(at, fix, value) {
    super(fix);
    this.at = at;
    this.value = value;
  }
}

// ---- Text of the output -------------------------------------------------------------------

// The characters that output shows as a space: controls, and the marks that reorder or break
// a terminal line, such as U+202E and U+2028. CONTROL alone is a check of contract.md.
const CONTROL_ALL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F'
  + '\\u202A-\\u202E\\u2066-\\u2069\\u2028\\u2029]', 'gu');
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;

function cut(text, size) {
  const chars = [...text];
  return chars.length > size ? `${chars.slice(0, size - 3).join('')}...` : text;
}

function quote(text) {
  return `"${cut(String(text).replace(CONTROL_ALL, ' ').trim(), QUOTE)}"`;
}

// finding returns one line: the fix, where, and the bad value in quotes when there is one. A
// value { written } is shown as written, with its quotes and outer spaces.
function finding(fix, where, value) {
  let shown = value === undefined || value === '' ? '' : `, ${quote(value)}`;
  if (value && typeof value === 'object') shown = `, ${cut(value.written, QUOTE)}`;
  return cut(`${fix}: ${where}${shown}.`.replace(CONTROL_ALL, ' '), LINE);
}

// collect adds a finding to findings, with make called only for one of the first findings.
function collect(findings, make) {
  findings.push(findings.length < MAX_FINDINGS ? make() : null);
}

// append adds the findings of more to findings, keeping the first ones as lines.
function append(findings, more) {
  for (const line of more) collect(findings, () => line);
}

const hex = (code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
const words = (text) => text.split(/\s+/).filter(Boolean);
const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

// lineFinder returns a function from an offset of text to its line number. It finds the line
// in a table of line starts, because a page may have thousands of findings.
function lineFinder(text) {
  const starts = [0];
  for (let k = text.indexOf('\n'); k >= 0; k = text.indexOf('\n', k + 1)) starts.push(k + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}
// The ASCII white space of HTML and CSS.
const WS = /[\t\n\f\r ]/;
const isWs = (c) => c !== undefined && WS.test(c);
// trimWs removes the ASCII white space at both ends of text, as HTML strips it.
function trimWs(text) {
  let start = 0;
  let end = text.length;
  while (start < end && isWs(text[start])) start += 1;
  while (end > start && isWs(text[end - 1])) end -= 1;
  return text.slice(start, end);
}
const collapse = (text) => trimWs(text.replace(/[\t\n\f\r ]+/g, ' '));
// contract.md: the check for script and text addresses removes every ASCII white space and
// control character first.
const norm = (value) => value.replace(/[\u0000-\u0020\u007F]/g, '');
// contract.md: white space or a control character inside an address refuses it.
const GAP = /[\u0000-\u0020\u007F]/;
// contract.md: a keyword value compares after ASCII lower-casing alone.
const asciiLower = (value) => value.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
const length = (text) => [...text].length;

// ---- Character references -------------------------------------------------------------

// The named references that the parser decodes. It refuses every other name in an attribute
// value, because a browser decodes names from a table of 2,231 entries, some with no ";".
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };
const REF = /&(?:#[xX]([0-9A-Fa-f]+);?|#([0-9]+);?|([A-Za-z0-9]+;?))?/g;

// A browser replaces 0, surrogates, numbers past U+10FFFF and 0x80 to 0x9F with other
// characters, and keeps control characters; the parser refuses all of them.
function plainCodePoint(code) {
  if (!(code > 0 && code <= 0x10FFFF)) return false;
  if (code >= 0xD800 && code <= 0xDFFF) return false;
  if (code < 0x20) return [0x09, 0x0A, 0x0C, 0x0D].includes(code);
  return !(code >= 0x7F && code <= 0x9F);
}

// decodeRefs returns raw with each character reference decoded, and the first reference that
// it cannot decode for certain, or null.
function decodeRefs(raw) {
  let bad = null;
  const value = raw.replace(REF, (whole, hexDigits, digits, name, offset) => {
    if (hexDigits !== undefined || digits !== undefined) {
      const code = hexDigits !== undefined ? parseInt(hexDigits, 16) : parseInt(digits, 10);
      if (plainCodePoint(code)) return String.fromCodePoint(code);
    } else if (name !== undefined) {
      const key = name.endsWith(';') ? name.slice(0, -1) : '';
      if (Object.hasOwn(NAMED, key)) return NAMED[key];
    } else if (raw[offset + 1] !== '#') {
      return '&';
    }
    if (!bad) bad = { offset, ref: whole.length > 1 ? whole : raw.slice(offset, offset + 12) };
    return '';
  });
  return { value, bad };
}

// ---- HTML parser ----------------------------------------------------------------------------
//
// The parser reads a subset of HTML in which its tree equals a browser's tree, and refuses
// every page outside that subset: it fails closed. It refuses <?, <![CDATA[ outside SVG,
// an unclosed comment, tag or element, a duplicate attribute, a reference that it cannot
// decode in an attribute value, a NUL or another control character, an end tag that does
// not close the open element, and each place where a browser builds another tree than the
// page shows, because it moves, closes, adds or drops an element: a <div> in a <p>, text in a
// <table>, a <tr> directly in a <table>, or a <dd> in a <div> in an open <dd>.

const HTML_VOID = new Set(words('area base br col embed hr img input link meta source track wbr'));
// A browser reads the content of these as text up to their end tag.
const RAW_TEXT = new Set(['style']);
const ESCAPABLE_TEXT = new Set(['title', 'textarea']);
// A browser reads these with rules that the parser does not follow; contract.md refuses them.
const UNREADABLE = new Set(
  words('script xmp iframe noembed noframes noscript plaintext math template'),
);
// contract.md refuses these: a browser may keep any element inside a <select>, where Qory
// Apiary's parser drops it.
const MENU = new Set(words('select option optgroup'));
const HEAD_CONTENT = ['title', 'meta', 'style', 'link', 'base'];
// The only parents that a browser keeps for these elements. A browser puts a <tbody> around
// a <tr> directly in a <table>, so the parser refuses that <tr>.
const PARENTS = {
  head: ['html'], body: ['html'], li: ['ul', 'ol'], dt: ['dl', 'div'], dd: ['dl', 'div'],
  tr: ['thead', 'tbody', 'tfoot'], td: ['tr'], th: ['tr'], thead: ['table'],
  tbody: ['table'], tfoot: ['table'], caption: ['table'], colgroup: ['table'], col: ['colgroup'],
  source: ['picture'], title: ['head'], meta: ['head'], link: ['head'], base: ['head'],
};
// The only children that a browser keeps in these elements.
const CHILDREN = {
  html: ['head', 'body'], head: HEAD_CONTENT,
  table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'style'],
  thead: ['tr'], tbody: ['tr'], tfoot: ['tr'], tr: ['td', 'th'], colgroup: ['col'],
};
// A browser moves the text in these out, so only white space may stand there.
const NO_TEXT = new Set(words('html head table thead tbody tfoot tr colgroup'));
// A start tag of these ends an open p.
const CLOSES_P = new Set(words(`address article aside blockquote details dialog div dl fieldset
  figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre
  section summary table ul li dd dt`));
const P_SCOPE = new Set(words('html table td th caption button marquee object template applet'));
const HEADINGS = new Set(words('h1 h2 h3 h4 h5 h6'));
// The special elements of HTML. A start tag of li ends an open li, and one of dd or dt an
// open dd or dt, up to the first of these that is no address, div or p.
const SPECIAL = new Set(words(`address applet area article aside base basefont bgsound
  blockquote body br button caption center col colgroup dd details dir div dl dt embed
  fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup
  hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes
  noscript object ol p param plaintext pre script search section select source style summary
  table tbody td template textarea tfoot th thead title tr track ul wbr xmp`));
const DD_PASS = new Set(words('address div p'));

const TAG_NAME = /[A-Za-z][A-Za-z0-9-]*/y;
const ATTR_NAME = /[A-Za-z_:][A-Za-z0-9_:.-]*/y;
const UNQUOTED = /[^\t\n\f\r "'<=>`]+/y;
const END_TAG = /<\/([A-Za-z][A-Za-z0-9-]*)[\t\n\f\r ]*>/y;
const DOCTYPE = /<!doctype[\t\n\f\r ]+html[\t\n\f\r ]*>/iy;

// parseHtml returns the tree of a page: { doc, elements }. Each element has name (as
// written), lname, ns ('html' or 'svg'), attrs, parent, children, start, tagEnd, end and,
// when it has an end tag, endStart. Each attribute has name, lname, raw, value (decoded),
// start, end and valueStart. It throws Unparsable for a page outside the subset.
function parseHtml(src) {
  const doc = { kind: 'document', lname: '#document', children: [], parent: null };
  const elements = [];
  const stack = [doc];
  const seen = { html: null, head: null, body: null, doctype: false, content: false };
  const fail = (at, fix, value) => { throw new Unparsable(at, fix, value); };
  const top = () => stack[stack.length - 1];

  for (let k = 0; k < src.length; k += 1) {
    const code = src.charCodeAt(k);
    if (code === 0) fail(k, 'Remove the NUL character');
    if ((code < 0x20 && !isWs(src[k])) || (code >= 0x7F && code <= 0x9F)) {
      fail(k, `Remove the control character ${hex(code)}`);
    }
  }

  const addText = (start, end, options = {}) => {
    const parent = top();
    const raw = src.slice(start, end);
    if (/[^\t\n\f\r ]/.test(raw)) {
      if (parent === doc) fail(start, 'Move the text into the <body>', raw);
      if (parent.ns === 'html' && NO_TEXT.has(parent.lname)) {
        fail(start, `Move the text out of <${parent.name}> into an element that holds text, `
          + 'because a browser moves it', raw);
      }
      seen.content = true;
    }
    const last = parent.children[parent.children.length - 1];
    if (last && last.kind === 'text' && last.end === start && !options.cdata && !last.cdata) {
      last.raw += raw;
      last.end = end;
    } else {
      parent.children.push({ kind: 'text', raw, start, end, parent, cdata: !!options.cdata });
    }
  };

  // place refuses an element where a browser would not keep it as written.
  const place = (el, parent) => {
    const at = el.start;
    if (parent.ns === 'svg' && (parent.lname === 'title' || parent.lname === 'desc')) {
      fail(at, `Write only text in the SVG <${parent.name}>, because a browser reads `
        + 'elements there as HTML');
    }
    if (el.ns === 'svg' && el.lname !== 'svg') return;
    const name = el.lname;
    if (name === 'html') {
      if (parent !== doc || seen.html) fail(at, 'Write one <html> element around the page');
      seen.html = el;
      return;
    }
    if (parent === doc) fail(at, `Put <${el.name}> inside <html>`);
    if (name === 'head' && (seen.head || parent.children.some((c) => c.kind === 'element'))) {
      fail(at, 'Write one <head> as the first element of <html>');
    }
    if (name === 'body' && (seen.body || !seen.head || seen.head.end === undefined)) {
      fail(at, 'Write one <body> after the closed <head>');
    }
    if (name === 'li' && parent.inLi) {
      fail(at, 'Close the <li> before the next one, because a browser ends it there');
    }
    if ((name === 'dd' || name === 'dt') && parent.inDd) {
      fail(at, `Close the open <dd> or <dt> before <${el.name}>, because a browser ends it there`);
    }
    if (PARENTS[name] && !(parent.ns === 'html' && PARENTS[name].includes(parent.lname))) {
      fail(at, `Put <${el.name}> only inside ${PARENTS[name].map((p) => `<${p}>`).join(' or ')}`
        + ', because a browser moves or drops it elsewhere');
    }
    if (parent.ns === 'html' && CHILDREN[parent.lname] && !CHILDREN[parent.lname].includes(name)) {
      fail(at, `Move <${el.name}> out of <${parent.name}>, because a browser moves or drops it`);
    }
    if (CLOSES_P.has(name) && parent.inP) {
      fail(at, `Close the <p> before <${el.name}>, because a browser ends the p there`);
    }
    if (HEADINGS.has(name) && parent.ns === 'html' && HEADINGS.has(parent.lname)) {
      fail(at, `Close <${parent.name}> before <${el.name}>, because a browser ends it there`);
    }
    if ((name === 'a' || name === 'button') && open[name] > 0) {
      fail(at, `Close the open <${name}> before this one, because a browser ends it there`);
    }
  };
  // The open a and button elements, which a start tag of the same name ends.
  const open = { a: 0, button: 0 };
  const counted = (el) => el.ns === 'html' && Object.hasOwn(open, el.lname);

  const startTag = (i) => {
    TAG_NAME.lastIndex = i + 1;
    const name = TAG_NAME.exec(src)[0];
    const lname = name.toLowerCase();
    let j = i + 1 + name.length;
    const attrs = [];
    const names = new Set();
    let selfClosing = false;
    for (;;) {
      const gap = j;
      while (isWs(src[j])) j += 1;
      if (src[j] === '>') { j += 1; break; }
      if (src[j] === '/') {
        if (src[j + 1] === '>') { selfClosing = true; j += 2; break; }
        fail(j, `Remove the "/" inside the tag <${name}>`);
      }
      if (j >= src.length) fail(i, `Close the tag <${name}> with ">"`);
      if (j === gap) {
        fail(j, `Put a space before the attribute in the tag <${name}>`, src.slice(j, j + 20));
      }
      ATTR_NAME.lastIndex = j;
      const found = ATTR_NAME.exec(src);
      if (!found) fail(j, `Remove the character from the tag <${name}>`, src.slice(j, j + 20));
      const attr = {
        name: found[0], lname: found[0].toLowerCase(), start: j, raw: '', valueStart: null,
      };
      j += found[0].length;
      let k = j;
      while (isWs(src[k])) k += 1;
      if (src[k] === '=') {
        k += 1;
        while (isWs(src[k])) k += 1;
        const q = src[k];
        if (q === '"' || q === "'") {
          const close = src.indexOf(q, k + 1);
          if (close < 0) fail(k, `Close the value of ${attr.name} with ${q}`);
          attr.valueStart = k + 1;
          attr.raw = src.slice(k + 1, close);
          j = close + 1;
        } else {
          UNQUOTED.lastIndex = k;
          const bare = UNQUOTED.exec(src);
          if (!bare || /["'<=`]/.test(src[k + bare[0].length] || '')) {
            fail(k, `Put the value of ${attr.name} in double quotes`);
          }
          attr.valueStart = k;
          attr.raw = bare[0];
          j = k + bare[0].length;
        }
      }
      attr.end = j;
      if (names.has(attr.lname)) {
        fail(attr.start, `Remove the second ${attr.name} attribute from <${name}>`);
      }
      names.add(attr.lname);
      const { value, bad } = decodeRefs(attr.raw);
      if (bad) {
        fail(attr.valueStart + bad.offset, `Write the character itself, or &amp;, in place of the `
          + `reference in ${attr.name}`, bad.ref);
      }
      attr.value = value;
      attrs.push(attr);
    }
    return { name, lname, attrs, selfClosing, tagEnd: j };
  };

  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? src.length : lt;
    if (textEnd > i) addText(i, textEnd);
    if (lt < 0) break;
    i = lt;
    const next = src[i + 1];
    if (src.startsWith('<!--', i)) {
      const close = src.indexOf('-->', i + 4);
      if (close < 0) fail(i, 'Close the comment with -->');
      const body = src.slice(i + 4, close);
      if (body.startsWith('>') || body.startsWith('->') || body.includes('--!>')) {
        fail(i, 'Write the comment as <!-- text -->', src.slice(i, i + 20));
      }
      i = close + 3;
    } else if (next === '!') {
      DOCTYPE.lastIndex = i;
      const doctype = DOCTYPE.exec(src);
      if (doctype && !seen.doctype && !seen.content && stack.length === 1 && !seen.html) {
        seen.doctype = true;
        i += doctype[0].length;
      } else if (src.startsWith('<![CDATA[', i) && top().ns === 'svg') {
        const close = src.indexOf(']]>', i + 9);
        if (close < 0) fail(i, 'Close the CDATA section with ]]>');
        addText(i + 9, close, { cdata: true });
        i = close + 3;
      } else {
        fail(i, 'Remove the markup, or write <!doctype html> first', src.slice(i, i + 20));
      }
    } else if (next === '?') {
      fail(i, 'Remove the processing instruction', src.slice(i, i + 20));
    } else if (next === '/') {
      END_TAG.lastIndex = i;
      const end = END_TAG.exec(src);
      if (!end) fail(i, 'Write the end tag as </name>', src.slice(i, i + 20));
      const current = top();
      if (current === doc || current.lname !== end[1].toLowerCase()) {
        fail(i, current === doc ? 'Remove the end tag, because no element is open'
          : `Close <${current.name}> of line ${lineOf(src, current.start)} before this end tag`,
        end[0]);
      }
      current.endStart = i;
      current.end = i + end[0].length;
      stack.pop();
      if (counted(current)) open[current.lname] -= 1;
      i = current.end;
    } else if (next !== undefined && /[A-Za-z]/.test(next)) {
      const tag = startTag(i);
      const parent = top();
      if (UNREADABLE.has(tag.lname)) fail(i, `Remove the <${tag.name}> element`);
      const ns = parent.ns === 'svg' || tag.lname === 'svg' ? 'svg' : 'html';
      if (ns === 'html' && MENU.has(tag.lname)) {
        fail(i, `Draw the drop-down list as a <button type="button"> in place of <${tag.name}>`);
      }
      const el = {
        kind: 'element', name: tag.name, lname: tag.lname, ns, attrs: tag.attrs, parent,
        children: [], start: i, tagEnd: tag.tagEnd,
      };
      for (const attr of el.attrs) attr.element = el;
      place(el, parent);
      // inP: a p is open that a start tag such as <div> ends. inLi and inDd: the same for
      // li, and for dd and dt.
      el.inP = ns === 'html' && !P_SCOPE.has(el.lname) && (el.lname === 'p' || !!parent.inP);
      const passes = !SPECIAL.has(el.lname) || DD_PASS.has(el.lname);
      el.inLi = ns === 'html' && (el.lname === 'li' || (passes && !!parent.inLi));
      el.inDd = ns === 'html' && (el.lname === 'dd' || el.lname === 'dt'
        || (passes && !!parent.inDd));
      if (ns === 'html' && el.lname !== 'html' && el.lname !== 'head' && el.lname !== 'body') {
        seen.content = true;
      }
      if (el.lname === 'head' && ns === 'html') seen.head = el;
      if (el.lname === 'body' && ns === 'html') seen.body = el;
      parent.children.push(el);
      elements.push(el);
      i = tag.tagEnd;
      if (ns === 'html' && HTML_VOID.has(el.lname)) {
        el.end = i;
      } else if (tag.selfClosing && ns === 'svg') {
        el.end = i;
      } else if (tag.selfClosing) {
        fail(el.start, `Write </${el.name}> after <${el.name}>, because a browser ignores the "/"`);
      } else {
        stack.push(el);
        if (counted(el)) open[el.lname] += 1;
        if (ns === 'html' && (RAW_TEXT.has(el.lname) || ESCAPABLE_TEXT.has(el.lname))) {
          const close = new RegExp(`</${el.lname}[\\t\\n\\f\\r />]`, 'ig');
          close.lastIndex = i;
          const found = close.exec(src);
          if (!found) fail(el.start, `Close <${el.name}> with </${el.lname}>`);
          if (found.index > i) addText(i, found.index);
          i = found.index;
        }
      }
    } else {
      addText(i, i + 1);
      i += 1;
    }
  }
  if (stack.length > 1) fail(top().start, `Close <${top().name}>`);
  if (!seen.html || !seen.head || !seen.body) {
    fail(0, 'Write the page as <html> with a <head> and a <body>');
  }
  return { doc, elements };
}

// textOf returns the text of a node and its descendants, with references decoded, and the
// first reference that it cannot decode, or null.
function textOf(node) {
  let text = '';
  let bad = null;
  // A loop over an array, because a page may nest elements 100,000 deep.
  const pending = [...node.children].reverse();
  while (pending.length) {
    const child = pending.pop();
    if (child.kind === 'text') {
      if (child.cdata) {
        text += child.raw;
      } else {
        const decoded = decodeRefs(child.raw);
        text += decoded.value;
        if (!bad && decoded.bad) bad = { ...decoded.bad, at: child.start + decoded.bad.offset };
      }
    } else if (!(child.ns === 'html' && child.lname === 'style')) {
      for (let k = child.children.length - 1; k >= 0; k -= 1) pending.push(child.children[k]);
    }
  }
  return { text, bad };
}

const attrOf = (el, lname) => el.attrs.find((attr) => attr.lname === lname);

// ---- CSS ------------------------------------------------------------------------------------
//
// contract.md checks CSS after comments are removed and escapes are decoded. The checker does
// that on the text, and also reads the CSS by the tokenizer of CSS Syntax 3, as a browser
// does, so that a comment mark inside a string or url() hides no address. A page passes only
// when both find nothing.

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const FONT_TYPES = ['font/woff2', 'font/woff', 'font/ttf', 'font/otf'];
const dataOf = (types) => new RegExp(`^data:(${types.join('|').replace(/\//g, '\\/')});base64,`
  + '[A-Za-z0-9+/]*={0,2}$', 'i');
const DATA_IMAGE = dataOf(IMAGE_TYPES);
const DATA_FONT = dataOf(FONT_TYPES);
// contract.md: a fragment matches an id byte for byte, and one with % is refused.
const FRAGMENT = /^#[^%]+$/;
const REFUSED_AT_RULES = ['import', 'namespace', 'document'];
// contract.md: behavior loads a script, and with stroke-dasharray a browser may draw millions
// of dashes for one line.
const REFUSED_PROPERTIES = ['behavior', 'stroke-dasharray'];
const REFUSED_FUNCTIONS = ['image', 'image-set', 'cross-fade', 'element', 'paint', 'expression',
  'image-rect', 'attr'];
// A vendor prefix, such as -webkit-, names the same rule or function.
const unprefix = (name) => name.toLowerCase().replace(/^-[a-z0-9]+-(?=.)/, '');
const isHexDigit = (c) => c !== undefined && /[0-9A-Fa-f]/.test(c);
const isNewline = (c) => c === '\n' || c === '\r' || c === '\f';
const isNameStart = (c) => c !== undefined && (/[A-Za-z_]/.test(c) || c > '\u007F');
const isNameChar = (c) => isNameStart(c) || (c !== undefined && /[0-9-]/.test(c));
const NON_PRINTABLE = /[\u0000-\u0008\u000B\u000E-\u001F\u007F]/;

class CssError extends Error {
  constructor(at, fix) {
    super(fix);
    this.at = at;
  }
}

// cssTokens returns the tokens of css, each { type, start, end } plus value or name. It
// throws CssError for an unclosed comment, a string with a line break, or a broken url().
function cssTokens(css) {
  const tokens = [];
  const n = css.length;
  let i = 0;
  const validEscape = (k) => css[k] === '\\' && !isNewline(css[k + 1]);
  // escape reads the escape after the backslash at k, and returns [character, next offset].
  const escape = (k) => {
    let j = k + 1;
    if (j >= n) return ['\uFFFD', j];
    if (isHexDigit(css[j])) {
      let digits = '';
      while (digits.length < 6 && isHexDigit(css[j])) { digits += css[j]; j += 1; }
      if (css[j] === '\r' && css[j + 1] === '\n') j += 2;
      else if (isWs(css[j])) j += 1;
      const code = parseInt(digits, 16);
      const bad = code === 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF);
      return [bad ? '\uFFFD' : String.fromCodePoint(code), j];
    }
    const code = css.codePointAt(j);
    return [String.fromCodePoint(code), j + (code > 0xFFFF ? 2 : 1)];
  };
  const startsIdent = (k) => {
    if (css[k] === '-') return isNameStart(css[k + 1]) || css[k + 1] === '-' || validEscape(k + 1);
    return isNameStart(css[k]) || validEscape(k);
  };
  const consumeName = (k) => {
    let value = '';
    let j = k;
    for (;;) {
      if (isNameChar(css[j])) { value += css[j]; j += 1; }
      else if (validEscape(j)) { const [c, next] = escape(j); value += c; j = next; }
      else return [value, j];
    }
  };
  const startsNumber = (k) => {
    const c = css[k];
    if (/[0-9]/.test(c || '')) return true;
    if (c === '.') return /[0-9]/.test(css[k + 1] || '');
    if (c === '+' || c === '-') {
      const digit = (at) => /[0-9]/.test(css[at] || '');
      return digit(k + 1) || (css[k + 1] === '.' && digit(k + 2));
    }
    return false;
  };
  const push = (type, start, end, extra = {}) => tokens.push({ type, start, end, ...extra });
  while (i < n) {
    const c = css[i];
    const start = i;
    if (css.startsWith('/*', i)) {
      const close = css.indexOf('*/', i + 2);
      if (close < 0) throw new CssError(i, 'Close the CSS comment with */');
      i = close + 2;
      push('comment', start, i);
    } else if (isWs(c)) {
      while (isWs(css[i])) i += 1;
      push('ws', start, i);
    } else if (c === '"' || c === "'") {
      let value = '';
      i += 1;
      for (;;) {
        // A browser closes a string at the end of the CSS only by recovering from an error.
        if (i >= n) throw new CssError(start, 'Close the CSS string with its quote');
        const d = css[i];
        if (d === c) { i += 1; break; }
        if (isNewline(d)) throw new CssError(start, 'Close the CSS string on its line');
        if (d === '\\') {
          if (i + 1 >= n) { i += 1; continue; }
          if (isNewline(css[i + 1])) {
            i += css[i + 1] === '\r' && css[i + 2] === '\n' ? 3 : 2;
            continue;
          }
          const [e, next] = escape(i);
          value += e;
          i = next;
        } else {
          value += d;
          i += 1;
        }
      }
      push('string', start, i, { value });
    } else if (c === '#' && (isNameChar(css[i + 1]) || validEscape(i + 1))) {
      const [value, next] = consumeName(i + 1);
      i = next;
      push('hash', start, i, { value });
    } else if ('(),:;[]{}'.includes(c)) {
      i += 1;
      push(c, start, i);
    } else if (c === '@' && startsIdent(i + 1)) {
      const [name, next] = consumeName(i + 1);
      i = next;
      push('at', start, i, { name });
    } else if (startsNumber(i)) {
      const number = /[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y;
      number.lastIndex = i;
      i += number.exec(css)[0].length;
      if (startsIdent(i)) i = consumeName(i)[1];
      else if (css[i] === '%') i += 1;
      push('number', start, i);
    } else if (css.startsWith('<!--', i) || css.startsWith('-->', i)) {
      i += css[i] === '<' ? 4 : 3;
      push('cdo', start, i);
    } else if (startsIdent(i)) {
      const [name, next] = consumeName(i);
      i = next;
      if (name.toLowerCase() === 'url' && css[i] === '(') {
        let j = i + 1;
        while (isWs(css[j])) j += 1;
        if (css[j] === '"' || css[j] === "'") {
          i += 1;
          push('function', start, i, { name });
          continue;
        }
        let value = '';
        for (;;) {
          const d = css[j];
          if (d === undefined || d === ')') { j += 1; break; }
          if (isWs(d)) {
            while (isWs(css[j])) j += 1;
            if (css[j] === ')' || css[j] === undefined) { j += 1; break; }
            throw new CssError(start, 'Write one address in url()');
          }
          if (d === '"' || d === "'" || d === '(' || NON_PRINTABLE.test(d)) {
            throw new CssError(start, 'Write one address in url()');
          }
          if (d === '\\') {
            if (!validEscape(j)) throw new CssError(start, 'Write one address in url()');
            const [e, next] = escape(j);
            value += e;
            j = next;
          } else {
            value += d;
            j += 1;
          }
        }
        i = Math.min(j, n);
        push('url', start, i, { value });
      } else if (css[i] === '(') {
        i += 1;
        push('function', start, i, { name });
      } else {
        push('ident', start, i, { name });
      }
    } else {
      i += c.codePointAt(0) > 0xFFFF ? 2 : 1;
      push('delim', start, i);
    }
  }
  return tokens;
}

// cssAddresses returns each address of css: a url token, or url( or src( with a string.
// fontFace is true inside an @font-face block.
function cssAddresses(tokens) {
  const found = [];
  let depth = 0;
  let fontDepth = -1;
  let pendingFont = false;
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.type === 'at') pendingFont = unprefix(token.name) === 'font-face';
    else if (token.type === ';') pendingFont = false;
    else if (token.type === '{') {
      depth += 1;
      if (pendingFont && fontDepth < 0) fontDepth = depth;
      pendingFont = false;
    } else if (token.type === '}') {
      if (depth === fontDepth) fontDepth = -1;
      depth = Math.max(0, depth - 1);
    }
    const fontFace = fontDepth >= 0;
    if (token.type === 'url') {
      found.push({ value: token.value, start: token.start, end: token.end, fontFace, at: k,
        string: null });
    } else if (token.type === 'function' && ['url', 'src'].includes(unprefix(token.name))) {
      let j = k + 1;
      while (tokens[j] && ['ws', 'comment'].includes(tokens[j].type)) j += 1;
      const string = tokens[j];
      j += 1;
      while (tokens[j] && ['ws', 'comment'].includes(tokens[j].type)) j += 1;
      const close = tokens[j];
      if (string && string.type === 'string' && close && close.type === ')') {
        found.push({ value: string.value, start: token.start, end: close.end, fontFace, at: k,
          string });
      } else {
        found.push({ value: null, start: token.start, end: token.end, fontFace, at: k });
      }
    }
  }
  return found;
}

// addressRefusal returns why CSS may not use value as an address, or null. mode 'fragment'
// allows only url(#<name>), for the SVG attributes fill, stroke and clip-path, and every
// other mode refuses a fragment.
function addressRefusal(value, fontFace, mode, quoted = true) {
  if (value === null) return 'Write one address in quotes in url() or src()';
  // contract.md compares a quoted address as written. An unquoted address loses its outer
  // whitespace, but keeps an escaped space, as in url(data:...\20).
  const v = value;
  if (trimWs(v) !== v) {
    return quoted ? 'Remove the whitespace at the ends of the quoted address'
      : 'Remove the escaped whitespace at the ends of the address in url()';
  }
  if (GAP.test(v)) return 'Remove the space or control character inside the address';
  if (mode === 'fragment') {
    return FRAGMENT.test(v) ? null : 'Use only url(#<id>), with no %, in this attribute';
  }
  if (v.startsWith('#')) {
    return 'Remove url(#...) from the CSS, and set fill, stroke or clip-path on the SVG element';
  }
  if (DATA_IMAGE.test(v) || (fontFace && DATA_FONT.test(v))) return null;
  if (DATA_FONT.test(v)) return 'Use a data: font only inside @font-face';
  return 'Use only a data: picture or {{checkout}}/<path> in CSS';
}

// decodeCssEscapes decodes each CSS escape of text, as contract.md compares CSS.
function decodeCssEscapes(text) {
  return text.replace(/\\(?:([0-9A-Fa-f]{1,6})(?:\r\n|[\t\n\f\r ])?|(\r\n|[\n\f\r])|([\s\S]))?/g,
    (whole, digits, newline, other) => {
      if (digits) {
        const code = parseInt(digits, 16);
        const bad = code === 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF);
        return bad ? '\uFFFD' : String.fromCodePoint(code);
      }
      if (newline) return '';
      return other === undefined ? '\uFFFD' : other;
    });
}

// isPropertyName returns whether the identifier at k names a property: it starts a
// declaration, after {, ; or } or at the start of a style attribute, and a : follows it. }
// counts, because a declaration may follow a nested rule. So .behavior and .behavior:hover
// are class names.
function isPropertyName(tokens, k) {
  const quiet = (j) => tokens[j] && (tokens[j].type === 'ws' || tokens[j].type === 'comment');
  let before = k - 1;
  while (quiet(before)) before -= 1;
  let after = k + 1;
  while (quiet(after)) after += 1;
  const opens = before < 0 || ['{', ';', '}'].includes(tokens[before].type);
  return opens && !!tokens[after] && tokens[after].type === ':';
}

// refusedTokens returns { k, fix, value } for each token of tokens that contract.md refuses
// in itself: an at-rule, a function, a property name, a script address, or a string that the
// text search refuses.
function refusedTokens(tokens) {
  const found = [];
  // The index of the first token after url( or src(. A string there is skipped, because
  // cssAddresses reports it.
  let address = -1;
  for (const [k, token] of tokens.entries()) {
    const name = token.name !== undefined ? unprefix(token.name) : null;
    if (token.type === 'function' && ['url', 'src'].includes(name)) {
      address = k + 1;
      while (tokens[address] && ['ws', 'comment'].includes(tokens[address].type)) address += 1;
    }
    if (k === address && token.type === 'string') continue;
    if (token.type === 'at' && REFUSED_AT_RULES.includes(name)) {
      found.push({ k, fix: `Remove the CSS rule @${token.name}` });
    } else if (token.type === 'function' && REFUSED_FUNCTIONS.includes(name)) {
      found.push({ k, fix: `Remove the CSS function ${token.name}()` });
    } else if (token.type === 'ident' && isPropertyName(tokens, k)
      && (REFUSED_PROPERTIES.includes(name) || token.name.toLowerCase() === '-moz-binding')) {
      found.push({ k, fix: `Remove ${token.name} from the CSS` });
    }
    const text = (token.value ?? token.name ?? '').toLowerCase();
    const squeezed = norm(text);
    if (/javascript:|vbscript:/.test(squeezed)) {
      found.push({ k, fix: 'Remove the script address from the CSS', value: text });
    } else if (token.type === 'string') {
      // The text search refuses these words in a string after it removes whitespace.
      // Flagging them here makes a loaded sheet drop the declaration instead of failing the
      // page.
      const word = STRING_WORDS.find((w) => squeezed.includes(w));
      if (word) {
        found.push({ k, fix: `Rewrite the CSS string without ${word}, counted with spaces removed`,
          value: token.value });
      }
    }
  }
  return found;
}

// overlaps returns whether range [start, end) overlaps one of ranges, which are sorted by
// start and do not overlap each other.
function overlaps(ranges, [start, end]) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (ranges[mid][0] < end) low = mid + 1;
    else high = mid - 1;
  }
  return high >= 0 && ranges[high][1] > start;
}

const OPENS = new Set(['function', '(', '[']);
const CLOSES = new Set([')', ']']);

// braceDepths returns, per token, the number of { blocks around it. Each tokens array is
// counted once.
const DEPTHS = new WeakMap();
function braceDepths(tokens) {
  if (!DEPTHS.has(tokens)) {
    const depths = new Int32Array(tokens.length);
    let depth = 0;
    tokens.forEach((token, k) => {
      if (token.type === '}') depth = Math.max(0, depth - 1);
      depths[k] = depth;
      if (token.type === '{') depth += 1;
    });
    DEPTHS.set(tokens, depths);
  }
  return DEPTHS.get(tokens);
}

// ruleAround returns the token range [first, last] of the declaration or rule that contains
// token k: from the token after the ; { or } before it, or from k when k is an at-keyword
// that starts a rule, to the ; after it, or to the } of its block when it stands in the
// prelude of a rule, such as @document x {...}. Outside every block, as in CSS Syntax 3, a ;
// ends no style rule, and an at-keyword in its selector starts no at-rule.
function ruleAround(tokens, k) {
  let first = k;
  let depth = 0;
  for (let j = k - 1; j >= 0; j -= 1) {
    const type = tokens[j].type;
    if (CLOSES.has(type)) depth += 1;
    else if (OPENS.has(type)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && (type === ';' || type === '{' || type === '}')) break;
    first = j;
  }
  let lead = first;
  while (lead < k && ['ws', 'comment', 'cdo'].includes(tokens[lead].type)) lead += 1;
  if (lead === k && tokens[k].type === 'at') first = k;
  const styleRule = tokens[lead].type !== 'at' && braceDepths(tokens)[lead] === 0;
  depth = 0;
  for (let j = k; j < tokens.length; j += 1) {
    const type = tokens[j].type;
    if (OPENS.has(type)) depth += 1;
    else if (CLOSES.has(type)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && type === ';' && !styleRule) return [first, j];
    else if (depth === 0 && type === '}') return [first, j - 1];
    else if (depth === 0 && type === '{') {
      let braces = 0;
      for (let b = j; b < tokens.length; b += 1) {
        if (tokens[b].type === '{') braces += 1;
        if (tokens[b].type === '}' && (braces -= 1) === 0) return [first, b];
      }
      return [first, tokens.length - 1];
    }
  }
  return [first, tokens.length - 1];
}

const SQUEEZED_WORDS = ['javascript:', 'vbscript:', 'data:text'];
const STRING_WORDS = ['expression(', 'attr(', 'data:text'];

// cssRefusals returns [offset, fix, value] for each rule of contract.md that css breaks, with
// the offset in css. mode is 'sheet' for <style>, 'declarations' for a style attribute, and
// 'fragment' for an SVG attribute such as fill.
function cssRefusals(css, mode) {
  const refusals = [];
  let tokens;
  try {
    tokens = cssTokens(css);
  } catch (error) {
    if (!(error instanceof CssError)) throw error;
    return [[error.at, error.message, css.slice(error.at, error.at + 40)]];
  }
  for (const address of cssAddresses(tokens)) {
    const why = addressRefusal(address.value, address.fontFace, mode, !!address.string);
    let value = address.value ?? css.slice(address.start, address.end);
    if (address.value !== null && trimWs(address.value) !== address.value) {
      const { start, end } = address.string || address;
      value = { written: css.slice(start, end) };
    }
    if (why) refusals.push([address.start, why, value]);
  }
  for (const { k, fix, value } of refusedTokens(tokens)) {
    refusals.push([tokens[k].start, fix, value]);
  }
  if (refusals.length) return refusals;
  // The text search of contract.md: comments removed, escapes decoded, then searched.
  // Function names and properties count only outside strings, so that
  // font-family:"Element(" passes; a script address, expression( and attr( count anywhere.
  // The comments come from the tokens, so that a /* inside a string or url( stays text.
  const kept = tokens.filter((token) => token.type !== 'comment');
  const textOfTokens = (blank) => kept
    .map((t) => (blank && t.type === 'string' ? '""' : css.slice(t.start, t.end))).join('');
  const decoded = decodeCssEscapes(textOfTokens(false));
  const plain = decoded.toLowerCase();
  const squeezed = norm(plain);
  const bare = decodeCssEscapes(textOfTokens(true)).toLowerCase();
  const bareSqueezed = norm(bare);
  for (const match of decoded.matchAll(/(?:url|src)\(([^)]*)\)?/gi)) {
    const inner = match[1].trim();
    const value = inner.replace(/^(["'])([\s\S]*)\1$/, '$2');
    const fontFace = mode === 'sheet';
    const why = addressRefusal(value, fontFace, mode, value !== inner);
    if (why) refusals.push([0, why, trimWs(value) === value ? value : { written: inner }]);
  }
  for (const rule of REFUSED_AT_RULES) {
    if (new RegExp(`@(-[a-z0-9]+-)?${rule}`).test(squeezed)) {
      refusals.push([0, `Remove the CSS rule @${rule}`]);
    }
  }
  for (const name of REFUSED_FUNCTIONS) {
    const anywhere = name === 'expression' || name === 'attr';
    if ((anywhere ? squeezed : bareSqueezed).includes(`${name}(`)) {
      refusals.push([0, `Remove the CSS function ${name}()`]);
    }
  }
  // A property name only, at the start of a declaration: scroll-behavior, .behavior-note and
  // .behavior:hover are other names.
  const properties = { '-moz-binding': '-moz-binding' };
  for (const name of REFUSED_PROPERTIES) properties[name] = `(?:-[a-z0-9]+-)?${name}`;
  for (const [name, pattern] of Object.entries(properties)) {
    if (new RegExp(`(?:^|[{;}])\\s*${pattern}\\s*:`).test(bare)) {
      refusals.push([0, `Remove ${name} from the CSS`]);
    }
  }
  for (const word of SQUEEZED_WORDS) {
    if (squeezed.includes(word)) refusals.push([0, `Remove ${word} from the CSS`]);
  }
  return refusals;
}

// ---- Page rules (contract.md) -----------------------------------------------------------

const HTML_ELEMENTS = new Set(words(`html head body title meta style main header footer nav
  section article aside div span p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd a img picture source
  figure figcaption table caption thead tbody tfoot tr th td colgroup col strong em b i u s
  small mark code pre kbd samp sub sup br hr blockquote q abbr time address details summary
  label input button textarea fieldset legend progress meter output`));
const SVG_ELEMENTS = new Set(words(`svg g defs symbol use title desc path rect circle ellipse
  line polyline polygon text tspan linearGradient radialGradient stop clipPath
  image`).map((name) => name.toLowerCase()));
const GLOBAL_ATTRS = new Set(words('id class style title lang dir hidden tabindex role'));
const ARIA = /^aria-[a-z]+$/;
const DATA = /^data-[a-z0-9_.-]+$/;
const CELL = 'colspan rowspan scope headers';
const RANGE = 'value min max low high optimum';
const HTML_ATTRS = Object.fromEntries(Object.entries({
  a: 'href', img: 'src srcset alt width height loading decoding',
  source: 'srcset type media sizes',
  input: 'type name value placeholder checked disabled readonly min max step size',
  button: 'type disabled name value',
  textarea: 'name rows cols placeholder disabled readonly', label: 'for', td: CELL, th: CELL,
  col: 'span', colgroup: 'span', ol: 'start reversed type', li: 'value', time: 'datetime',
  meter: RANGE, progress: RANGE, details: 'open', table: 'border',
}).map(([name, list]) => [name, new Set(words(list))]));
const SVG_ATTRS = new Set(words(`viewBox xmlns xmlns:xlink preserveAspectRatio d x y x1 y1 x2
  y2 cx cy r rx ry fx fy dx dy width height points transform rotate textLength lengthAdjust
  offset fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap
  stroke-linejoin stroke-dashoffset stroke-miterlimit opacity clip-path
  clip-rule font-family font-size font-weight font-style text-anchor dominant-baseline
  letter-spacing stop-color stop-opacity gradientUnits gradientTransform spreadMethod
  clipPathUnits visibility display focusable`).map((name) => name.toLowerCase()));
const SVG_URL_ATTRS = new Set(['fill', 'stroke', 'clip-path']);
// The elements that url(#<id>) in fill, stroke or clip-path may point at.
const PAINT_TARGETS = new Set(['lineargradient', 'radialgradient', 'clippath']);
const INPUT_TYPES = new Set(words(`text email password number search tel url date time checkbox
  radio range color hidden`));
const PAGE_LINK = /^([a-z0-9][a-z0-9-]{0,31})\.html$/;
const MAX_USES = 1000;
// contract.md: the elements that all <use> elements of a page copy, each target counted with
// the elements in it.
const MAX_USE_COPIES = 100000;
// contract.md: the characters of attribute values and text that all <use> elements copy.
const MAX_USE_CHARACTERS = 1048576;
const GRADIENTS = new Set(['lineargradient', 'radialgradient']);

// srcsetUrls returns each address of a srcset value with its offsets, by the parsing rules of
// HTML.
function srcsetUrls(value) {
  const urls = [];
  const n = value.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isWs(value[i]) || value[i] === ',')) i += 1;
    if (i >= n) break;
    const start = i;
    while (i < n && !isWs(value[i])) i += 1;
    let url = value.slice(start, i);
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let inParens = false;
      while (i < n) {
        const c = value[i];
        i += 1;
        if (c === '(') inParens = true;
        else if (c === ')') inParens = false;
        else if (c === ',' && !inParens) break;
      }
    }
    urls.push({ url, start, end: start + url.length });
  }
  return urls;
}

function attrAllowed(el, lname) {
  if (GLOBAL_ATTRS.has(lname) || ARIA.test(lname) || DATA.test(lname)) return true;
  if (el.ns === 'svg') {
    return SVG_ATTRS.has(lname)
      || ((el.lname === 'use' || el.lname === 'image') && isHref(lname));
  }
  return !!(HTML_ATTRS[el.lname] && HTML_ATTRS[el.lname].has(lname));
}

const tagOf = (el) => `<${el.name}>`;
const isHref = (lname) => lname === 'href' || lname === 'xlink:href';
const isUse = (el) => el.ns === 'svg' && el.lname === 'use';

// usedIds returns the ids that a <use> may not point at: each id of a <use>, or of an
// element that contains one. A browser copies such a <use> again in each copy, so a few
// lines can make millions of copies.
function usedIds(elements) {
  const withUse = new Set();
  for (let k = elements.length - 1; k >= 0; k -= 1) {
    const el = elements[k];
    if (isUse(el)) withUse.add(el);
    if (withUse.has(el) && el.parent.kind === 'element') withUse.add(el.parent);
  }
  const ids = new Set();
  for (const el of withUse) {
    const id = attrOf(el, 'id');
    if (id) ids.add(id.value);
  }
  return ids;
}

// fragmentsOf returns each address of the CSS value css, such as #a of url(#a).
function fragmentsOf(css) {
  try {
    return cssAddresses(cssTokens(css)).map((address) => trimWs(address.value ?? ''));
  } catch (error) {
    if (!(error instanceof CssError)) throw error;
    return [];
  }
}

// inClipPath returns each SVG clipPath and the elements inside one.
function inClipPath(elements) {
  const inside = new Set();
  for (const el of elements) {
    if ((el.ns === 'svg' && el.lname === 'clippath') || inside.has(el.parent)) inside.add(el);
  }
  return inside;
}

// codePoints returns the number of code points in text.
const PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
const codePoints = (text) => text.length - (text.match(PAIR) || []).length;

// decodedLength returns the number of code points of raw text after a browser decodes its
// references. A reference that decodeRefs cannot decode counts as written, which is never
// less than what a browser makes of it.
function decodedLength(raw) {
  let n = codePoints(raw);
  for (const match of raw.matchAll(REF)) {
    const [whole, hexDigits, digits, name] = match;
    if (hexDigits !== undefined || digits !== undefined) {
      const code = hexDigits !== undefined ? parseInt(hexDigits, 16) : parseInt(digits, 10);
      if (plainCodePoint(code)) n -= whole.length - 1;
    } else if (name !== undefined && name.endsWith(';')
      && Object.hasOwn(NAMED, name.slice(0, -1))) {
      n -= whole.length - 1;
    }
  }
  return n;
}

// sizesOf returns, for each element, the number of elements in it and the code points of the
// attribute values and text in it, the element included.
function sizesOf(elements) {
  const sizes = new Map();
  const sizeOf = (el) => {
    if (!sizes.has(el)) sizes.set(el, { elements: 0, characters: 0 });
    return sizes.get(el);
  };
  for (let k = elements.length - 1; k >= 0; k -= 1) {
    const el = elements[k];
    const size = sizeOf(el);
    size.elements += 1;
    for (const attr of el.attrs) size.characters += codePoints(attr.value);
    const raw = el.ns === 'html' && RAW_TEXT.has(el.lname);
    for (const child of el.children) {
      if (child.kind !== 'text') continue;
      size.characters += raw || child.cdata ? codePoints(child.raw) : decodedLength(child.raw);
    }
    if (el.parent.kind === 'element') {
      const parent = sizeOf(el.parent);
      parent.elements += size.elements;
      parent.characters += size.characters;
    }
  }
  return sizes;
}

// contract.md: a page has at most 10,000 start tags and at most 256 attributes on one tag,
// both counted in the source before parsing.
const MAX_TAGS = 10000;
const MAX_ATTRS = 256;

// startTagLimit returns the offset of the start tag past MAX_TAGS, or -1. A start tag is each
// < followed by an ASCII letter, anywhere in the text.
function startTagLimit(text) {
  const start = /<[A-Za-z]/g;
  for (let n = 1; start.exec(text); n += 1) {
    if (n > MAX_TAGS) return start.lastIndex - 2;
  }
  return -1;
}

// The tag states of the HTML5 tokenizer: tag name, before attribute name, attribute name,
// after attribute name, before attribute value, double-quoted, single-quoted and unquoted
// value, after a quoted value, and self-closing start tag.
const TS = Object.freeze({
  NAME: 0, BEFORE_ATTR: 1, ATTR: 2, AFTER_ATTR: 3, BEFORE_VALUE: 4, DOUBLE: 5, SINGLE: 6,
  UNQUOTED: 7, AFTER_QUOTED: 8, SELF_CLOSING: 9,
});
const TAG_END = -1;
const TAG_STATES = 10;
const isTagSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

// tagStep returns the state after the tokenizer reads c in state, or TAG_END, and whether the
// tokenizer starts an attribute name there. A reconsumed character is read again in the
// next state.
function tagStep(state, c) {
  switch (state) {
    case TS.NAME:
      if (isTagSpace(c)) return [TS.BEFORE_ATTR, false];
      if (c === '/') return [TS.SELF_CLOSING, false];
      return [c === '>' ? TAG_END : TS.NAME, false];
    case TS.BEFORE_ATTR:
      if (isTagSpace(c)) return [TS.BEFORE_ATTR, false];
      if (c === '/' || c === '>') return tagStep(TS.AFTER_ATTR, c);
      return [TS.ATTR, true];
    case TS.ATTR:
      if (isTagSpace(c) || c === '/' || c === '>') return tagStep(TS.AFTER_ATTR, c);
      return [c === '=' ? TS.BEFORE_VALUE : TS.ATTR, false];
    case TS.AFTER_ATTR:
      if (isTagSpace(c)) return [TS.AFTER_ATTR, false];
      if (c === '/') return [TS.SELF_CLOSING, false];
      if (c === '=') return [TS.BEFORE_VALUE, false];
      if (c === '>') return [TAG_END, false];
      return [TS.ATTR, true];
    case TS.BEFORE_VALUE:
      if (isTagSpace(c)) return [TS.BEFORE_VALUE, false];
      if (c === '"') return [TS.DOUBLE, false];
      if (c === "'") return [TS.SINGLE, false];
      return [c === '>' ? TAG_END : TS.UNQUOTED, false];
    case TS.DOUBLE:
      return [c === '"' ? TS.AFTER_QUOTED : TS.DOUBLE, false];
    case TS.SINGLE:
      return [c === "'" ? TS.AFTER_QUOTED : TS.SINGLE, false];
    case TS.UNQUOTED:
      if (isTagSpace(c)) return [TS.BEFORE_ATTR, false];
      return [c === '>' ? TAG_END : TS.UNQUOTED, false];
    case TS.AFTER_QUOTED:
      if (isTagSpace(c)) return [TS.BEFORE_ATTR, false];
      if (c === '/') return [TS.SELF_CLOSING, false];
      return c === '>' ? [TAG_END, false] : tagStep(TS.BEFORE_ATTR, c);
    default:
      return c === '>' ? [TAG_END, false] : tagStep(TS.BEFORE_ATTR, c);
  }
}

// attributeLimit returns the offset of the first tag on which more than MAX_ATTRS attribute
// names start, or -1. Each < or </ followed by an ASCII letter starts a tag, also inside
// another tag, a comment or <style>. Tags that reach the same state at the same character
// read on alike, so only the one with the most attributes is kept per state: the pass reads
// each character in at most 10 states.
function attributeLimit(text) {
  const isLetter = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  let counts = new Int32Array(TAG_STATES).fill(-1);
  let starts = new Int32Array(TAG_STATES);
  let nextCounts = new Int32Array(TAG_STATES);
  let nextStarts = new Int32Array(TAG_STATES);
  let active = false;
  let i = 0;
  while (i < text.length) {
    if (!active) {
      // With no tag open, the next tag starts at a < or </ before a letter. Its name state
      // reads the letter, which starts no attribute.
      i = text.indexOf('<', i);
      if (i < 0) return -1;
      const name = text[i + 1] === '/' ? i + 2 : i + 1;
      if (name < text.length && isLetter(text[name])) {
        counts.fill(-1);
        counts[TS.NAME] = 0;
        starts[TS.NAME] = i;
        active = true;
        i = name + 1;
      } else {
        i += 1;
      }
      continue;
    }
    const c = text[i];
    nextCounts.fill(-1);
    active = false;
    for (let state = 0; state < TAG_STATES; state += 1) {
      if (counts[state] < 0) continue;
      const [after, begins] = tagStep(state, c);
      if (after === TAG_END) continue;
      const n = counts[state] + (begins ? 1 : 0);
      if (n > MAX_ATTRS) return starts[state];
      if (n > nextCounts[after]) {
        nextCounts[after] = n;
        nextStarts[after] = starts[state];
      }
      active = true;
    }
    [counts, nextCounts] = [nextCounts, counts];
    [starts, nextStarts] = [nextStarts, starts];
    // Inside an open tag, a < or </ before a letter starts one more tag.
    if (isLetter(c) && counts[TS.NAME] < 0) {
      const open = text[i - 1] === '<' ? i - 1 : -1;
      const close = text[i - 1] === '/' && text[i - 2] === '<' ? i - 2 : -1;
      if (open >= 0 || close >= 0) {
        counts[TS.NAME] = 0;
        starts[TS.NAME] = Math.max(open, close);
        active = true;
      }
    }
    i += 1;
  }
  return -1;
}

// checkPage checks the text of one page by contract.md. page has file, ids (a Set), title
// (the screen's title, or null to skip that rule), where (offset to a place in words) and
// keep (offset to false for a finding that the caller has already reported). It returns the
// findings, the screens that its links lead to, and the title of the page, or null.
function checkPage(text, page) {
  const findings = [];
  const lines = page.where ? null : lineFinder(text);
  const where = page.where || ((offset) => `${page.file} line ${lines(offset)}`);
  const keep = page.keep || (() => true);
  const report = (offset, fix, value) => {
    if (keep(offset)) collect(findings, () => finding(fix, where(offset), value));
  };
  const tags = startTagLimit(text);
  if (tags >= 0) {
    report(tags, `Write at most ${MAX_TAGS.toLocaleString('en-US')} tags; each < before a `
      + 'letter counts, and the pack adds one per data-to');
  }
  const attrs = attributeLimit(text);
  if (attrs >= 0) {
    report(attrs, `Write at most ${MAX_ATTRS} attributes on one tag; each < or </ before a `
      + 'letter starts a tag');
  }
  let tree;
  try {
    tree = parseHtml(text);
  } catch (error) {
    if (!(error instanceof Unparsable)) throw error;
    report(error.at, error.message, error.value);
    return { findings, links: new Set(), title: null, tree: null };
  }
  const links = new Set();
  const titles = [];
  const cssOf = (offset, css, mode) => {
    for (const [at, fix, value] of cssRefusals(css, mode)) report(offset(at), fix, value);
  };
  const noUse = usedIds(tree.elements);
  const clipped = inClipPath(tree.elements);
  // contract.md: each id once in a page, so that a fragment points at one element.
  const byId = new Map();
  for (const el of tree.elements) {
    const id = attrOf(el, 'id');
    if (!id) continue;
    if (byId.has(id.value)) report(id.start, 'Give each element another id', id.value);
    else byId.set(id.value, el);
  }
  // contract.md: the copies of all <use> elements, each target with the elements, attribute
  // values and text in it.
  const sizes = sizesOf(tree.elements);
  const copied = { elements: 0, characters: 0 };
  const limits = [['elements', MAX_USE_COPIES, 'elements, each target with the elements in it'],
    ['characters', MAX_USE_CHARACTERS, 'characters of attribute values and text, each target '
      + 'with the elements in it']];
  for (const el of tree.elements.filter(isUse)) {
    const href = attrOf(el, 'href') || attrOf(el, 'xlink:href');
    const target = href && byId.get(trimWs(href.value).slice(1));
    if (!target || !trimWs(href.value).startsWith('#')) continue;
    for (const [key, max, what] of limits) {
      const before = copied[key];
      copied[key] += sizes.get(target)[key];
      if (before <= max && copied[key] > max) {
        report(el.start, 'Draw the page with fewer <use> elements: they copy over '
          + `${max.toLocaleString('en-US')} ${what}`);
      }
    }
  }
  let uses = 0;
  for (const el of tree.elements) {
    if (isUse(el) && clipped.has(el)) {
      report(el.start, 'Remove the <use> from the <clipPath>, or draw the shape there');
    }
    const parent = el.parent;
    if (parent.ns === 'svg' && GRADIENTS.has(parent.lname) && el.lname !== 'stop') {
      report(el.start, `Put only <stop> elements in <${parent.name}>`);
    }
    if (parent.ns === 'svg' && parent.lname === 'stop') {
      report(el.start, `Put no element in <${parent.name}>`);
    }
    if (isUse(el)) {
      uses += 1;
      if (uses === MAX_USES + 1) {
        report(el.start, `Draw at most ${MAX_USES} <use> elements in the page`);
      }
    }
    const allowed = el.ns === 'svg' ? SVG_ELEMENTS.has(el.lname) : HTML_ELEMENTS.has(el.lname);
    if (!allowed) {
      report(el.start, `Remove the ${tagOf(el)} element, which a mockup page may not contain`);
      continue;
    }
    if (el.ns === 'html' && el.lname === 'title') titles.push(el);
    if (el.ns === 'html' && el.lname === 'style') {
      const body = el.children[0];
      if (body) cssOf((at) => body.start + at, body.raw, 'sheet');
    }
    if (el.ns === 'html' && el.lname === 'meta') {
      const names = el.attrs.map((attr) => attr.lname).sort().join(' ');
      const charset = names === 'charset' && asciiLower(el.attrs[0].value) === 'utf-8';
      const viewport = names === 'content name'
        && asciiLower(attrOf(el, 'name').value) === 'viewport';
      if (!charset && !viewport) {
        report(el.start, 'Write <meta> only as <meta charset="utf-8"> or '
          + '<meta name="viewport" content="...">', text.slice(el.start, el.tagEnd));
      }
    }
    for (const attr of el.attrs) {
      const name = attr.lname;
      if (!(el.ns === 'html' && el.lname === 'meta') && !attrAllowed(el, name)) {
        report(attr.start, `Remove the attribute ${attr.name} from ${tagOf(el)}`, attr.value);
        continue;
      }
      if (/javascript:|vbscript:|data:text/.test(norm(attr.value).toLowerCase())) {
        report(attr.start, `Remove the script or text address from ${attr.name} of ${tagOf(el)}`,
          attr.value);
        continue;
      }
      const v = trimWs(attr.value);
      if ((name === 'src' || isHref(name)) && GAP.test(v)) {
        report(attr.start, `Remove the space or control character inside ${attr.name} of `
          + `${tagOf(el)}`, attr.value);
        continue;
      }
      if (clipped.has(el) && norm(decodeCssEscapes(attr.value)).toLowerCase().includes('url(')) {
        report(attr.start, `Remove url() from ${attr.name} on or inside the <clipPath>`,
          attr.value);
        continue;
      }
      if (name === 'style') {
        cssOf(() => attr.start, attr.value, 'declarations');
      } else if (el.ns === 'svg' && SVG_URL_ATTRS.has(name)) {
        cssOf(() => attr.start, attr.value, 'fragment');
        for (const fragment of fragmentsOf(attr.value).filter((f) => FRAGMENT.test(f))) {
          const target = byId.get(fragment.slice(1));
          if (!target || target.ns !== 'svg' || !PAINT_TARGETS.has(target.lname)) {
            report(attr.start, `Point url(#<id>) in ${attr.name} at a <linearGradient>, `
              + '<radialGradient> or <clipPath> of the page', attr.value);
          }
        }
      } else if (el.ns === 'html' && el.lname === 'a' && name === 'href') {
        const match = PAGE_LINK.exec(v);
        if (match && page.ids.has(match[1])) links.add(match[1]);
        else {
          report(attr.start, 'Link <a> only to a screen of the mockup, as data-to="<screen id>"',
            attr.value);
        }
      } else if ((el.lname === 'img' && name === 'src')
        || (el.ns === 'svg' && el.lname === 'image' && isHref(name))) {
        if (!DATA_IMAGE.test(v)) {
          report(attr.start, `Use a PNG, JPEG, GIF or WebP file of {{checkout}}/<path> for ${name} `
            + `of ${tagOf(el)}`, attr.value);
        }
      } else if (name === 'srcset') {
        const bad = srcsetUrls(attr.value).find((entry) => !DATA_IMAGE.test(entry.url));
        if (bad) {
          report(attr.start, `Use PNG, JPEG, GIF or WebP files of {{checkout}}/<path> in srcset of `
            + `${tagOf(el)}`, bad.url);
        }
      } else if (el.ns === 'svg' && el.lname === 'use' && isHref(name)) {
        if (!FRAGMENT.test(v)) {
          report(attr.start, `Set ${attr.name} of <use> to #<id> of this page, with no %`,
            attr.value);
        } else if (noUse.has(v.slice(1))) {
          report(attr.start, `Point ${attr.name} of <use> at an element that is no <use> and `
            + 'contains none', attr.value);
        }
      } else if (el.ns === 'html' && el.lname === 'input' && name === 'type') {
        if (!INPUT_TYPES.has(asciiLower(attr.value))) {
          report(attr.start, 'Use another type of <input>', attr.value);
        }
      } else if (el.ns === 'html' && el.lname === 'button' && name === 'type') {
        if (asciiLower(attr.value) !== 'button') {
          report(attr.start, 'Set type of <button> to button, or remove it', attr.value);
        }
      }
    }
  }
  let title = null;
  if (titles.length !== 1) {
    report(titles[1] ? titles[1].start : 0, 'Give the page exactly one <title> in its <head>');
  } else {
    const { text: raw, bad } = textOf(titles[0]);
    if (bad) {
      report(bad.at, 'Write the character itself in place of the reference in <title>', bad.ref);
    } else {
      title = collapse(raw);
      if (page.title !== null && page.title !== undefined && title !== page.title) {
        report(titles[0].start,
          `Make <title> equal the screen's title in ${SCREENS}, ${quote(page.title)}`, title);
      }
    }
  }
  return { findings, links, title, tree };
}

// decodePage returns the text of a page's bytes, or a finding.
function decodePage(bytes, file, size = bytes.length) {
  if (size > MAX_PAGE_BYTES) {
    const fix = `Cut the page to ${limitText(MAX_PAGE_BYTES)}, such as with smaller pictures`;
    return { problem: finding(fix, file, `${size} bytes`) };
  }
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return { problem: finding('Remove the byte order mark from the start of the page', file) };
  }
  try {
    return { text: utf8(bytes) };
  } catch {
    return { problem: finding('Save the page as UTF-8, because it has bytes that are not', file) };
  }
}

// ---- screens.json rules (contract.md) ---------------------------------------------------

// duplicateKey returns the first key that an object of valid JSON text lists twice, or null.
function duplicateKey(text) {
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.object && top.expectKey) {
        const key = JSON.parse(text.slice(i, j + 1));
        if (top.keys.has(key)) return key;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{') stack.push({ object: true, keys: new Set(), expectKey: true });
    else if (c === '[') stack.push({ object: false });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',' && stack.length && stack[stack.length - 1].object) {
      stack[stack.length - 1].expectKey = true;
    }
    i += 1;
  }
  return null;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasKeys = (value, keys) => isObject(value)
  && Object.keys(value).sort().join(' ') === [...keys].sort().join(' ');
// A lone surrogate, which UTF-8 cannot encode. String.isWellFormed needs Node 20.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const goodText = (value) => typeof value === 'string' && !LONE_SURROGATE.test(value)
  && length(value) >= 1 && length(value) <= MAX_TEXT && !CONTROL.test(value);

// parseScreens returns the value of screens.json. It throws BadJson when the bytes are not
// UTF-8 JSON.
function parseScreens(bytes) {
  let text;
  try {
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) throw new Error('BOM');
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { value: JSON.parse(text), text };
  } catch {
    throw new BadJson(`Write ${SCREENS} as UTF-8 JSON with no byte order mark`);
  }
}

// checkScreens returns the findings of a screens.json value, and its screens when their shape
// passes.
function checkScreens(value, text) {
  const findings = [];
  const find = (fix, bad) => findings.push(finding(fix, SCREENS, bad));
  const twice = duplicateKey(text);
  if (twice !== null) find('List each key once in each object', twice);
  if (!hasKeys(value, ['start', 'screens'])) {
    find('Write screens.json as an object with only the keys start and screens');
    return { findings, screens: null };
  }
  const { screens } = value;
  if (!Array.isArray(screens) || screens.length < 1 || screens.length > MAX_SCREENS) {
    find(`List 1 to ${MAX_SCREENS} screens under screens`);
    return { findings, screens: null };
  }
  const ids = new Set();
  let shaped = true;
  for (const [index, screen] of screens.entries()) {
    const at = `screen ${index + 1}`;
    if (!hasKeys(screen, ['id', 'title', 'file', 'criteria', 'links'])) {
      find(`Give ${at} only the keys id, title, file, criteria and links`);
      shaped = false;
      continue;
    }
    if (typeof screen.id !== 'string' || !SCREEN_ID.test(screen.id)) {
      find(`Set the id of ${at} to at most 32 lower-case letters, digits and hyphens`, screen.id);
      shaped = false;
      continue;
    }
    if (ids.has(screen.id)) find('Give each screen another id', screen.id);
    ids.add(screen.id);
    if (!goodText(screen.title)) {
      find(`Set the title of screen ${screen.id} to 1 to ${MAX_TEXT} characters, no control `
        + 'character', String(screen.title));
    }
    if (screen.file !== `${screen.id}.html`) {
      find(`Set the file of screen ${screen.id} to ${screen.id}.html`, String(screen.file));
    }
    const { criteria, links } = screen;
    if (!Array.isArray(criteria) || criteria.length > MAX_CRITERIA
      || !criteria.every((c) => typeof c === 'string' && CRITERION.test(c))
      || new Set(criteria).size !== criteria.length) {
      find(`List at most ${MAX_CRITERIA} different ac-<N> under criteria of screen ${screen.id}`,
        JSON.stringify(criteria));
    }
    if (!Array.isArray(links) || links.length > MAX_LINKS
      || !links.every((l) => hasKeys(l, ['to', 'label']))) {
      find(`List at most ${MAX_LINKS} links, each with only to and label, for screen ${screen.id}`);
      shaped = false;
      continue;
    }
    for (const link of links) {
      if (!goodText(link.label)) {
        find(`Set each label of screen ${screen.id} to 1 to ${MAX_TEXT} characters, no control `
          + 'character', String(link.label));
      }
    }
  }
  if (!shaped) return { findings, screens: null };
  for (const screen of screens) {
    for (const link of screen.links) {
      if (typeof link.to !== 'string' || !ids.has(link.to)) {
        find(`Set each link of screen ${screen.id} to the id of a screen`, String(link.to));
      }
    }
  }
  if (typeof value.start !== 'string' || !ids.has(value.start)) {
    find('Set start to the id of a screen', String(value.start));
  }
  return { findings, screens };
}

const reachFix = (id, start) => `Add a data-to link to screen ${id} on a screen that ${start} `
  + 'reaches';

// unreachable returns the ids of the screens that no chain of links from start reaches.
function unreachable(screens, start, linksOf) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    for (const to of linksOf(id)) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return screens.map((s) => s.id).filter((id) => !seen.has(id));
}

// checkVersion checks the files of a version, a Map of name to bytes, by contract.md. pages
// may give, per file, where and keep for checkPage. folder, from readVersion, gives the number
// of entries and the size of each file, when a file over its limit was not read.
function checkVersion(files, pages = {}, folder = {}) {
  const { count = files.size, sizes = new Map() } = folder;
  const sizeOf = (name) => sizes.get(name) ?? files.get(name).length;
  if (count > MAX_FILES) {
    return [finding(`Keep at most ${MAX_FILES} files in the version`, 'the version folder',
      `${count} files`)];
  }
  const findings = [];
  if (!files.has(SCREENS)) return [finding(`Add ${SCREENS} to the version`, 'the version folder')];
  let total = 0;
  for (const name of files.keys()) total += sizeOf(name);
  if (total > MAX_VERSION_BYTES) {
    const fix = `Cut the version to ${limitText(MAX_VERSION_BYTES)}, such as with smaller `
      + 'pictures';
    findings.push(finding(fix, 'the version folder', `${total} bytes`));
  }
  const bytes = files.get(SCREENS);
  if (sizeOf(SCREENS) > MAX_SCREENS_BYTES) {
    findings.push(finding(`Cut ${SCREENS} to ${limitText(MAX_SCREENS_BYTES)}`, SCREENS,
      `${sizeOf(SCREENS)} bytes`));
    // readVersion reads no file over its limit.
    if (sizes.has(SCREENS)) return findings;
  }
  let parsed;
  try {
    parsed = parseScreens(bytes);
  } catch (error) {
    if (!(error instanceof BadJson)) throw error;
    findings.push(finding(error.message, SCREENS));
    return findings;
  }
  const { value, text } = parsed;
  const checked = checkScreens(value, text);
  append(findings, checked.findings);
  if (!checked.screens) return findings;
  const { screens } = checked;
  const named = new Set(screens.map((s) => s.file));
  for (const name of files.keys()) {
    if (name !== SCREENS && !named.has(name)) {
      const fix = `Remove the file from the version, or list it as a screen in ${SCREENS}`;
      findings.push(finding(fix, name));
    }
  }
  const ids = new Set(screens.map((s) => s.id));
  for (const screen of screens) {
    if (!files.has(screen.file)) {
      findings.push(finding(`Add the page of screen ${screen.id} to the version`, screen.file));
      continue;
    }
    const decoded = decodePage(files.get(screen.file), screen.file, sizeOf(screen.file));
    if (decoded.problem) {
      findings.push(decoded.problem);
      continue;
    }
    const page = checkPage(decoded.text, {
      file: screen.file, ids, title: screen.title, ...pages[screen.file],
    });
    append(findings, page.findings);
    if (!page.tree) continue;
    const listed = [...new Set(screen.links.map((l) => l.to))].sort();
    const linked = [...page.links].sort();
    if (listed.join(' ') !== linked.join(' ')) {
      const fix = `Make the links of screen ${screen.id} in ${SCREENS} lead to the screens that `
        + `its page links to, ${linked.join(' ') || 'none'}`;
      findings.push(finding(fix, SCREENS, listed.join(' ')));
    }
  }
  const byId = new Map(screens.map((s) => [s.id, s]));
  const linksOf = (id) => (byId.has(id) ? byId.get(id).links.map((l) => l.to) : []);
  if (ids.has(value.start)) {
    for (const id of unreachable(screens, value.start, linksOf)) {
      findings.push(finding(reachFix(id, value.start), `${id}.html`));
    }
  }
  return findings;
}

// ---- Files ----------------------------------------------------------------------------------

function inside(file, roots) {
  return roots.some((root) => file === root || file.startsWith(root + path.sep));
}

// The names that the agent's guardrail forbids, because a page could print such a file.
const SECRET_NAME = new RegExp(
  '^(\\.env(\\..*|rc)?|\\.git|\\.netrc|\\.npmrc|\\.pypirc|id_(rsa|dsa|ecdsa|ed25519)'
  + '|(credentials?|secrets?)(\\..*)?|.*\\.(pem|key|p12|pfx|ppk))$',
  'i',
);

// Tests each folder and file name below the root, because a folder above it is no choice of
// the page. fileURLToPath has already decoded the names.
function hasSecretName(file, roots) {
  const root = roots.find((candidate) => inside(file, [candidate]));
  const names = (root ? path.relative(root, file) : file).split(path.sep);
  return names.some((name) => SECRET_NAME.test(name));
}

function realParent(file) {
  let parent = path.resolve(file);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  return fs.realpathSync(parent);
}

// fileOf returns { file } for an address that the pack may read, or { refusal }. It reads
// only a file under a root, by its real path, and no file with a secret name.
function fileOf(url, roots) {
  if (url === null) return { refusal: 'the working folder is in no git checkout' };
  const outside = 'outside the checkout and the artifact folder';
  const secret = 'the name looks like a secret';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:' || parsed.hostname) return { refusal: outside };
    const file = fileURLToPath(parsed);
    if (hasSecretName(file, roots)) return { refusal: secret };
    if (!fs.existsSync(file) && inside(realParent(file), roots)) return { refusal: 'no such file' };
    const real = fs.realpathSync(file);
    if (!inside(real, roots)) return { refusal: outside };
    if (hasSecretName(real, roots)) return { refusal: secret };
    return fs.statSync(real).isFile() ? { file: real } : { refusal: 'not a file' };
  } catch {
    return { refusal: outside };
  }
}

// The media type that each file extension of a picture or font must have by its first bytes.
const EXTENSION_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const isSheet = (file) => /\.css$/i.test(file);

// hasTables returns whether the bytes of a TrueType or OpenType font start with a table
// directory: 1 to 64 tables, each with a tag of printable ASCII. Four bytes alone, such as
// 00 01 00 00, also start other files.
function hasTables(bytes) {
  if (bytes.length < 12) return false;
  const count = bytes.readUInt16BE(4);
  if (count < 1 || count > 64 || bytes.length < 12 + 16 * count) return false;
  for (let k = 0; k < count; k += 1) {
    const tag = bytes.subarray(12 + 16 * k, 16 + 16 * k);
    if (![...tag].every((byte) => byte >= 0x20 && byte <= 0x7E)) return false;
  }
  return true;
}

// typeOf returns the media type of a picture or font by its first bytes, or null.
function typeOf(bytes) {
  const starts = (text, at = 0) => bytes.subarray(at, at + text.length).toString('latin1') === text;
  if (starts('\x89PNG\r\n\x1A\n')) return 'image/png';
  if (starts('\xFF\xD8\xFF')) return 'image/jpeg';
  if (starts('GIF87a') || starts('GIF89a')) return 'image/gif';
  if (starts('RIFF') && starts('WEBP', 8)) return 'image/webp';
  if (starts('wOF2')) return 'font/woff2';
  if (starts('wOFF')) return 'font/woff';
  if (starts('OTTO') && hasTables(bytes)) return 'font/otf';
  if (starts('\x00\x01\x00\x00') && hasTables(bytes)) return 'font/ttf';
  return null;
}

// readAsset returns { uri } with the data: URI of a picture, or a font when fonts is true, at
// url, or { refusal }. It reads a file only when its extension names a picture or font type,
// and uses it only when its first bytes have that type, so that no other file of the
// checkout, such as a settings file, gets into a page.
// charge counts the bytes that the page gets, before a read. cache, a Map, keeps each result
// by file, so that the pack reads a file once for each page, however often the page uses it.
function readAsset(url, roots, fonts, charge = () => {}, cache = null) {
  const { file, refusal } = fileOf(url, roots);
  if (refusal) return { refusal };
  const key = `${fonts ? 'font' : 'picture'}:${file}`;
  const known = cache && cache.get(key);
  if (known) {
    if (known.uri) charge(known.uri.length);
    return known;
  }
  const result = readAssetFile(file, fonts, charge);
  if (cache) cache.set(key, result);
  return result;
}

function readAssetFile(file, fonts, charge) {
  const expected = EXTENSION_TYPES[path.extname(file).toLowerCase()];
  const size = fs.statSync(file).size;
  if (expected && size > MAX_PAGE_BYTES) {
    return { refusal: `the file has ${size} bytes, over the limit of a page` };
  }
  // The length of the data: address of the file, charged before the read and settled after
  // it. A refused file adds nothing to the page, so its charge goes back.
  const bound = expected ? `data:${expected};base64,`.length + Math.ceil(size / 3) * 4 : 0;
  charge(bound);
  const bytes = expected ? readPage(file) : null;
  if (bytes && bytes.length > size) {
    charge(-bound);
    return { refusal: `the file grew past ${size} bytes while the pack read it` };
  }
  const type = bytes && typeOf(bytes);
  if (!type || type !== expected || (!fonts && !IMAGE_TYPES.includes(type))) {
    charge(-bound);
    const svg = /\.svg$/i.test(file) ? '; draw an SVG file as <svg> in the page' : '';
    const font = fonts ? ' and no font' : '';
    return { refusal: `the file is no PNG, JPEG, GIF or WebP picture${font}${svg}` };
  }
  const uri = `data:${type};base64,${bytes.toString('base64')}`;
  charge(uri.length - bound);
  return { uri };
}

const utf8 = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const escapeAttr = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// applyEdits returns text with each edit { start, end, text } applied, and a function that
// returns, for an offset of the result, { at, edit }: the offset of the original text, and
// the edit that inserted the text there, or null.
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let from = 0;
  const spans = [];
  for (const edit of sorted) {
    if (edit.start < from) throw new EditOverlap(edit.start);
    out += text.slice(from, edit.start);
    spans.push({ outStart: out.length, edit });
    out += edit.text;
    from = edit.end;
  }
  out += text.slice(from);
  // A search in the sorted spans, because a page may have thousands of edits.
  const origin = (offset) => {
    let low = 0;
    let high = spans.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (spans[mid].outStart <= offset) low = mid + 1;
      else high = mid - 1;
    }
    const span = spans[high];
    if (!span) return { at: offset, edit: null };
    const after = span.outStart + span.edit.text.length;
    if (offset < after) return { at: span.edit.start, edit: span.edit };
    return { at: offset + span.edit.end - after, edit: null };
  };
  return { text: out, origin };
}

// ---- Pack -----------------------------------------------------------------------------------

// Elements around which a wrapping <a> would be moved by a browser or would break the
// element's function.
const NO_WRAP = new Set(words(`html head body title meta style link base tr td th thead tbody
  tfoot caption col colgroup li dt dd source summary legend`));
const NO_WRAP_PARENT = new Set(words('picture'));
// The style of the <a> that the pack puts around an element with data-to: it adds no box,
// and the element keeps the colour and underline of its parent.
const WRAP_STYLE = 'display:contents;color:inherit;text-decoration:inherit';

// inlineSheet returns the text of the sheet at url, with each @import of a readable sheet
// inlined, each readable picture or font as a data: URI, and each other address dropped. It
// throws Refusal with a finding when the sheet cannot be inlined. ctx.charge counts the
// sheets and the bytes that each sheet and picture adds to the page, before the pack reads it.
function inlineSheet(url, ctx, label, chain = []) {
  const { file, refusal } = fileOf(url, ctx.roots);
  if (refusal) throw new Refusal(`Fix the link to the sheet, ${refusal}`);
  if (!isSheet(file)) throw new Refusal('Link only a .css file of the checkout as a sheet');
  const size = fs.statSync(file).size;
  if (size > MAX_PAGE_BYTES) {
    throw new Refusal(`Write the rules of ${label} that the page needs into a <style> in the `
      + `page: the sheet has ${size} bytes, over the limit of a page`);
  }
  ctx.charge(size, 1);
  let css;
  try {
    css = utf8(fs.readFileSync(file)).replace(/^\uFEFF/, '');
  } catch {
    throw new Refusal(`Write the rules of ${label} into a <style> in the page: `
      + 'the sheet is not UTF-8');
  }
  let tokens;
  try {
    tokens = cssTokens(css);
  } catch (error) {
    if (!(error instanceof CssError)) throw error;
    throw new Refusal(`Write the rules of ${label} into a <style> in the page: ${error.message} `
      + `at line ${lineOf(css, error.at)} of the sheet`);
  }
  const base = pathToFileURL(file).href;
  const edits = [];
  const skip = (k) => {
    let j = k;
    while (tokens[j] && ['ws', 'comment'].includes(tokens[j].type)) j += 1;
    return j;
  };
  const addressAt = new Map(cssAddresses(tokens).map((address) => [address.at, address]));
  // CSS Cascade 5: an @import counts only before every other rule but @charset, an @layer
  // statement and another @import. A form of @import that a browser ignores, such as
  // @-webkit-import, counts as an @import here, because a browser drops it as invalid.
  const QUIET = ['ws', 'comment', 'cdo'];
  let importsAllowed = true;
  // As in CSS Syntax 3, a function, ( [ or { opens a block that only its matching ) ] or }
  // closes. blockEnd returns the index of that closer, or tokens.length.
  const CLOSERS = new Map([['function', ')'], ['(', ')'], ['[', ']'], ['{', '}']]);
  const blockEnd = (k) => {
    const open = [CLOSERS.get(tokens[k].type)];
    for (let j = k + 1; j < tokens.length; j += 1) {
      const type = tokens[j].type;
      if (type === open[open.length - 1]) {
        open.pop();
        if (open.length === 0) return j;
      } else if (CLOSERS.has(type)) {
        open.push(CLOSERS.get(type));
      }
    }
    return tokens.length;
  };
  // The prelude of the at-rule at k ends at the first ; or { outside a block. closed is false
  // when a block in the prelude runs to the end of the sheet.
  const prelude = (k) => {
    let j = k + 1;
    while (j < tokens.length && tokens[j].type !== ';' && tokens[j].type !== '{') {
      if (!CLOSERS.has(tokens[j].type)) j += 1;
      else if ((j = blockEnd(j)) === tokens.length) return { end: j, closed: false };
      else j += 1;
    }
    return { end: j, closed: true };
  };
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (QUIET.includes(token.type)) continue;
    const name = token.type === 'at' ? token.name.toLowerCase() : null;
    const { end, closed } = name === null ? { end: k, closed: true } : prelude(k);
    const block = name !== null && tokens[end]?.type === '{';
    // The last token of the rule: its ; or the } that closes its block.
    const last = block ? blockEnd(end) : end;
    if (name === 'charset' || (name === 'layer' && !block)) {
      k = last;
      continue;
    }
    if (name === null) {
      // Any other token outside every rule starts a style rule, a stray } or ; too. Its
      // selector runs to its {, so that an @import in it is part of the selector, and the
      // drops below drop the whole rule.
      importsAllowed = false;
      let j = k;
      while (j < tokens.length && tokens[j].type !== '{') {
        j = CLOSERS.has(tokens[j].type) ? blockEnd(j) + 1 : j + 1;
      }
      k = j < tokens.length ? blockEnd(j) : tokens.length;
      continue;
    }
    if (unprefix(token.name) !== 'import') {
      importsAllowed = false;
      k = last;
      continue;
    }
    const ruleEnd = tokens[last] ? tokens[last].end : css.length;
    if (block) {
      // A browser drops an @import with a block, block and all, and loads nothing. As an
      // invalid rule, it leaves later imports allowed.
      ctx.dropped(`${css.slice(token.start, ruleEnd)} in ${label}`);
      edits.push({ start: token.start, end: ruleEnd, text: '' });
      k = last;
      continue;
    }
    const first = skip(k + 1);
    const address = addressAt.get(first);
    const string = tokens[first] && tokens[first].type === 'string' ? tokens[first] : null;
    const value = string ? string.value : address && address.value;
    const after = string ? string.end : address && address.end;
    const ruleStop = tokens[end] ? tokens[end].start : css.length;
    const media = after === undefined || after === null ? '' : css.slice(after, ruleStop).trim();
    // A browser loads only @import with no prefix, followed by a string or by url() with no
    // prefix, such as url("b.css"). It ignores @-webkit-import and @import -webkit-url().
    const loaded = token.name.toLowerCase() === 'import' && (string !== null
      || (address && (tokens[first].type === 'url' || tokens[first].name.toLowerCase() === 'url')));
    let text = '';
    // An open block in the media list would take in the inlined rules too.
    if (!importsAllowed || !closed || !loaded || value === null || value === undefined
      || /^(layer|supports)\b/i.test(media)) {
      ctx.dropped(`${css.slice(token.start, ruleEnd)} in ${label}`);
    } else {
      let target = null;
      try {
        target = new URL(trimWs(value), base).href;
      } catch {
        // An address that is no URL loads nothing, so the pack drops it.
      }
      const found = target && fileOf(target, ctx.roots).file;
      const sheet = found && isSheet(found) ? found : null;
      // A loop of imports, or a deep one, is dropped.
      if (sheet && !chain.includes(sheet) && sheet !== file && chain.length < MAX_IMPORT_DEPTH) {
        const inner = inlineSheet(target, ctx, `${trimWs(value)} of ${label}`, [...chain, file]);
        text = media ? `@media ${media}{${inner}}` : inner;
      } else {
        ctx.dropped(`${trimWs(value) || css.slice(token.start, ruleEnd)} in ${label}`);
      }
    }
    edits.push({ start: token.start, end: ruleEnd, text });
    k = last;
  }
  const imports = edits.map((e) => [e.start, e.end]);
  // Each declaration or rule with a refused function, property or at-rule is dropped, because
  // the page cannot change a sheet of the checkout.
  // A token inside the last range found is skipped, so that each token is read about once.
  // A range that would also drop an @import stays, and the check of the page refuses it.
  const drops = [];
  let reached = 0;
  // A url( or src( with other content than one address goes as a whole too: replacing only
  // its function token would end the declaration where a browser does not.
  const unread = cssAddresses(tokens).filter((a) => a.value === null).map((a) => a.at);
  const refused = [...refusedTokens(tokens).map((f) => f.k), ...unread].sort((a, b) => a - b);
  for (const k of refused) {
    if (tokens[k].start < reached) continue;
    const [first, last] = ruleAround(tokens, k);
    let range = [tokens[first].start, tokens[last].end];
    const previous = drops[drops.length - 1];
    const merged = previous && range[0] < previous[1];
    if (merged) range = [previous[0], Math.max(previous[1], range[1])];
    reached = Math.max(reached, range[1]);
    if (overlaps(imports, range)) continue;
    if (merged) previous[1] = range[1];
    else drops.push(range);
  }
  for (const [start, end] of drops) {
    ctx.dropped(`${collapse(css.slice(start, end))} in ${label}`);
    edits.push({ start, end, text: '' });
  }
  const skipped = [...imports, ...drops].sort((a, b) => a[0] - b[0]);
  for (const address of cssAddresses(tokens)) {
    // An unread address that a kept @import range covers stays, and the check of the page
    // refuses it.
    if (address.value === null || overlaps(skipped, [address.start, address.start + 1])) continue;
    const value = trimWs(address.value);
    if (addressRefusal(address.value, address.fontFace, 'sheet', !!address.string) === null) {
      continue;
    }
    // A browser shows a data: address with whitespace at its ends, so the pack writes it
    // trimmed. A checkout address is read trimmed below.
    const call = (uri) => cssCall(css, tokens, address, uri);
    if (addressRefusal(value, address.fontFace, 'sheet') === null) {
      edits.push({ start: address.start, end: address.end, text: call(value) });
      continue;
    }
    let uri = null;
    if (!/^data:/i.test(value)) {
      let target = null;
      try {
        target = new URL(value, base).href;
      } catch {
        // An address that is no URL loads nothing, so the pack drops it.
      }
      uri = target && readAsset(target, ctx.roots, address.fontFace, ctx.charge, ctx.cache).uri;
    }
    if (uri && addressRefusal(uri, address.fontFace, 'sheet') === null) {
      edits.push({ start: address.start, end: address.end, text: call(uri) });
    } else {
      // An empty address shows as its url() or src() as written, such as url( ).
      let written = value;
      if (value !== address.value) {
        written = css.slice((address.string || address).start, (address.string || address).end);
      } else if (value === '') {
        written = css.slice(address.start, address.end);
      }
      ctx.dropped(`${written} in ${label}`);
      edits.push({ start: address.start, end: address.end, text: call(DROPPED_DATA) });
    }
  }
  let inlined;
  try {
    inlined = applyEdits(css, edits).text;
  } catch (error) {
    if (!(error instanceof EditOverlap)) throw error;
    throw new Refusal(`Write the rules of ${label} that the page needs into a <style> in the `
      + 'page: the pack cannot drop its refused rules apart from its @import rules');
  }
  if (/<\/style/i.test(inlined)) {
    throw new Refusal(`Write the rules of ${label} into a <style> in the page: `
      + 'the sheet contains </style');
  }
  return inlined;
}

// cssCall returns the CSS that loads uri in place of address, with the function name as
// written, so that a browser loads what it loaded before. Only url() reads an address with
// no quotes, so every other function, such as src() or -webkit-url(), gets a string.
function cssCall(css, tokens, address, uri) {
  const name = css.slice(address.start, css.indexOf('(', address.start));
  const fn = tokens[address.at];
  const bare = fn.type === 'url' || fn.name.toLowerCase() === 'url';
  return bare ? `${name}(${uri})` : `${name}("${uri}")`;
}

// checkoutUrl returns the file: URL of {{checkout}}/<path>, with the path as written, so that
// a space, % or # in a file name stays part of the name.
const CHECKOUT_PATH = `${TOKEN}/`;
const checkoutUrl = (ctx, value) => (ctx.checkout
  ? pathToFileURL(path.join(ctx.checkout, value.slice(TOKEN.length))).href : null);

// packPage returns the packed text of one page and what screens.json needs of it: title,
// criteria and links. Each finding goes to report.
function packPage(page, ctx, report) {
  const result = { id: page.id, file: `${page.id}.html`, ok: false };
  if (page.bytes.length > MAX_PAGE_BYTES) {
    const fix = `Cut the page to ${limitText(MAX_PAGE_BYTES)}, such as with smaller pictures`;
    report(() => finding(fix, page.name, `over ${grouped(MAX_PAGE_BYTES)} bytes`));
    return result;
  }
  let source;
  try {
    source = utf8(page.bytes).replace(/^\uFEFF/, '');
  } catch {
    report(() => finding('Save the page as UTF-8, because it has bytes that are not', page.name));
    return result;
  }
  const lines = lineFinder(source);
  const where = (offset) => `${page.name} line ${lines(offset)}`;
  let tree;
  try {
    tree = parseHtml(source);
  } catch (error) {
    if (!(error instanceof Unparsable)) throw error;
    report(() => finding(error.message, where(error.at), error.value));
    return result;
  }
  const edits = [];
  const handled = [];
  const find = (offset, fix, value) => report(() => finding(fix, where(offset), value));
  const fail = (range, fix, value) => {
    handled.push(range);
    find(range[0], fix, value);
  };
  // A sheet that imports the same sheet many times, at each level, would inline millions of
  // sheets, and a page can use one picture many times. So the pack counts the bytes that the
  // sheets, pictures and fonts add to the page, each use, before it reads them.
  let inlined = 0;
  let sheets = 0;
  const cache = new Map();
  const charge = (bytes, sheet, fix) => {
    inlined += bytes;
    sheets += sheet;
    if (sheets > MAX_PAGE_SHEETS) {
      throw new PageTooLarge('Import fewer sheets: with their imports, the sheets of the page '
        + `are more than ${grouped(MAX_PAGE_SHEETS)}`);
    }
    if (inlined > MAX_PAGE_BYTES) throw new PageTooLarge(fix);
  };
  const sheetCtx = {
    ...ctx,
    cache,
    charge: (bytes, sheet = 0) => charge(bytes, sheet, 'Import fewer or smaller sheets: with '
      + `their imports and pictures, the sheets of the page pass ${limitText(MAX_PAGE_BYTES)}`),
  };
  const pictureFix = 'Use fewer or smaller pictures: with its sheets, the pictures and fonts '
    + `of the page pass ${limitText(MAX_PAGE_BYTES)}`;
  // readPicture reads a picture, or a font when fonts is true, at a checkout address of the
  // page. Past the limit of a page it throws PageTooLarge, placed at offset with value.
  const readPicture = (value, fonts, offset, written) => {
    try {
      return readAsset(checkoutUrl(ctx, value), ctx.roots, fonts,
        (bytes) => charge(bytes, 0, pictureFix), cache);
    } catch (error) {
      if (error instanceof PageTooLarge) Object.assign(error, { at: offset, value: written });
      throw error;
    }
  };

  // Each address of the checkout in CSS becomes a data: URI.
  const packCss = (css, offsetOf) => {
    let tokens;
    try {
      tokens = cssTokens(css);
    } catch {
      return { css, failed: [] };
    }
    const cssEdits = [];
    const failed = [];
    for (const address of cssAddresses(tokens)) {
      const value = address.value === null ? '' : trimWs(address.value);
      if (!value.startsWith(CHECKOUT_PATH)) continue;
      const asset = readPicture(value, address.fontFace, offsetOf(address), value);
      if (asset.uri) {
        const text = cssCall(css, tokens, address, asset.uri);
        cssEdits.push({ start: address.start, end: address.end, text });
      } else {
        failed.push({ address, why: asset.refusal, value });
      }
    }
    return { css: applyEdits(css, cssEdits).text, failed, edits: cssEdits.length };
  };
  const replaceAttr = (attr, value) => {
    edits.push({ start: attr.start, end: attr.end, text: `${attr.name}="${escapeAttr(value)}"` });
  };

  try {
    for (const el of tree.elements) {
      const html = el.ns === 'html';
      if (html && el.lname === 'link') {
        const rel = attrOf(el, 'rel');
        const href = attrOf(el, 'href');
        const value = href ? trimWs(href.value) : '';
        if (el.attrs.length === 2 && rel && asciiLower(trimWs(rel.value)) === 'stylesheet'
          && value.startsWith(CHECKOUT_PATH)) {
          const label = value.slice(CHECKOUT_PATH.length);
          try {
            const css = inlineSheet(checkoutUrl(ctx, value), sheetCtx, label);
            edits.push({
              start: el.start,
              end: el.end,
              text: `<style data-sheet="${escapeAttr(label)}">${css}</style>`,
              sheet: label,
            });
          } catch (error) {
            if (error instanceof PageTooLarge) {
              throw Object.assign(error, { at: el.start, value: href.value });
            }
            if (!(error instanceof Refusal)) throw error;
            fail([el.start, el.end], error.message, href.value);
          }
        } else {
          const fix = 'Link a sheet only as <link rel="stylesheet" href="{{checkout}}/<path>">';
          fail([el.start, el.end], fix, source.slice(el.start, el.tagEnd));
        }
        continue;
      }
      if (html && el.lname === 'style' && el.children[0]) {
        const body = el.children[0];
        const packed = packCss(body.raw, (address) => body.start + address.start);
        for (const { address, why, value } of packed.failed) {
          const range = [body.start + address.start, body.start + address.end];
          fail(range, `Fix the address in <style>, ${why}`, value);
        }
        if (packed.edits) edits.push({ start: body.start, end: body.end, text: packed.css });
      }
      for (const attr of el.attrs) {
        const name = attr.lname;
        const range = [attr.start, attr.end];
        if (name === 'style') {
          const packed = packCss(attr.value, () => attr.start);
          for (const { why, value } of packed.failed) {
            fail(range, `Fix the address in style of ${tagOf(el)}, ${why}`, value);
          }
          if (packed.edits && !packed.failed.length) replaceAttr(attr, packed.css);
        } else if ((html && el.lname === 'img' && name === 'src')
          || (el.ns === 'svg' && el.lname === 'image' && isHref(name))) {
          const value = trimWs(attr.value);
          if (!value.startsWith(CHECKOUT_PATH)) continue;
          const asset = readPicture(value, false, attr.start, attr.value);
          if (asset.uri) replaceAttr(attr, asset.uri);
          else fail(range, `Fix ${attr.name} of ${tagOf(el)}, ${asset.refusal}`, attr.value);
        } else if (html && name === 'srcset') {
          const entries = srcsetUrls(attr.value);
          const srcEdits = [];
          for (const entry of entries) {
            const value = entry.url;
            if (!value.startsWith(CHECKOUT_PATH)) continue;
            const asset = readPicture(value, false, attr.start, entry.url);
            if (asset.uri) srcEdits.push({ start: entry.start, end: entry.end, text: asset.uri });
            else fail(range, `Fix srcset of ${tagOf(el)}, ${asset.refusal}`, entry.url);
          }
          if (srcEdits.length && !handled.some(([s]) => s === attr.start)) {
            replaceAttr(attr, applyEdits(attr.value, srcEdits).text);
          }
        } else if (html && el.lname === 'a' && name === 'href') {
          const fix = attrOf(el, 'data-to') ? 'Remove href from <a>, because data-to sets it'
            : 'Mark the link with data-to="<screen id>" in place of href';
          fail(range, fix, attr.value);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof PageTooLarge)) throw error;
    // The pack reads no more for the page, which a browser could not show anyway.
    find(error.at, error.message, error.value);
    return result;
  }

  // Each data-to becomes a link to the page of its screen. A browser cannot nest links, so
  // the pack finds each link with a link around it or in it, in two walks of the tree.
  const links = [];
  const isLink = (el) => (el.ns === 'html' && el.lname === 'a') || !!attrOf(el, 'data-to');
  const linkAround = new Set();
  const linkInside = new Set();
  for (const el of tree.elements) {
    const parent = el.parent;
    if (parent.kind === 'element' && (isLink(parent) || linkAround.has(parent))) linkAround.add(el);
  }
  for (let k = tree.elements.length - 1; k >= 0; k -= 1) {
    const el = tree.elements[k];
    if ((isLink(el) || linkInside.has(el)) && el.parent.kind === 'element') {
      linkInside.add(el.parent);
    }
  }
  const marked = tree.elements.filter((el) => attrOf(el, 'data-to'));
  for (const el of marked) {
    const attr = attrOf(el, 'data-to');
    const to = attr.value.trim();
    const name = `${tagOf(el)} data-to="${to}"`;
    if (!ctx.ids.has(to)) {
      const screens = [...ctx.ids].join(' ');
      find(attr.start, `Set data-to of ${tagOf(el)} to one of the screens: ${screens}`, attr.value);
      continue;
    }
    if (linkAround.has(el) || linkInside.has(el)) {
      find(el.start, 'Mark only one of two nested elements with data-to or <a>, because a '
        + 'browser cannot nest links', name);
      continue;
    }
    const aria = attrOf(el, 'aria-label');
    const own = textOf(el);
    const label = aria && collapse(aria.value) ? collapse(aria.value) : collapse(own.text);
    if (!(aria && collapse(aria.value)) && own.bad) {
      const fix = `Write the character itself in place of the reference in the text of ${name}`;
      find(own.bad.at, fix, own.bad.ref);
      continue;
    }
    if (!label) {
      find(el.start, `Give ${name} a text or an aria-label, which the screen list shows`);
      continue;
    }
    if (length(label) > MAX_TEXT) {
      const fix = `Cut the label of ${name} to ${MAX_TEXT} characters, or set a shorter aria-label`;
      find(el.start, fix, label);
      continue;
    }
    if (el.ns === 'html' && el.lname === 'a') {
      const after = el.start + 1 + el.name.length;
      edits.push({ start: after, end: after, text: ` href="${to}.html"` });
    } else if ((el.ns === 'svg' && el.lname !== 'svg') || NO_WRAP.has(el.lname)
      || (el.parent.ns === 'html' && NO_WRAP_PARENT.has(el.parent.lname))) {
      find(el.start, `Move data-to from ${tagOf(el)} to an element inside it, such as a <span>, `
        + 'because a browser moves a link around it', name);
      continue;
    } else {
      const text = `<a href="${to}.html" style="${WRAP_STYLE}">`;
      edits.push({ start: el.start, end: el.start, text });
      edits.push({ start: el.end, end: el.end, text: '</a>' });
    }
    links.push({ to, label });
  }

  const titles = tree.elements.filter((el) => el.ns === 'html' && el.lname === 'title');
  let title = null;
  if (titles.length === 1) {
    const { text, bad } = textOf(titles[0]);
    title = bad ? null : collapse(text);
    if (title !== null && !goodText(title)) {
      find(titles[0].start, `Write a <title> of 1 to ${MAX_TEXT} characters`, title);
      title = null;
    }
  }
  const criteria = [];
  const html = tree.elements[0];
  const marks = attrOf(html, 'data-criteria');
  for (const criterion of marks ? words(marks.value) : []) {
    if (!CRITERION.test(criterion)) {
      find(marks.start, 'List only ac-<N> in data-criteria', criterion);
    } else if (criteria.includes(criterion)) {
      find(marks.start, 'List each ac-<N> once in data-criteria', criterion);
    } else {
      criteria.push(criterion);
    }
  }
  if (criteria.length > MAX_CRITERIA) {
    find(marks.start, `List at most ${MAX_CRITERIA} criteria in data-criteria`);
  }
  if (links.length > MAX_LINKS) {
    find(marked[0].start, `Mark at most ${MAX_LINKS} elements with data-to`);
  }

  let packed;
  try {
    packed = applyEdits(source, edits);
  } catch (error) {
    if (!(error instanceof EditOverlap)) throw error;
    find(error.at, 'Write the marked element and its addresses apart, because the pack '
      + 'cannot change both');
    return result;
  }
  const placeOf = (offset) => {
    const { at, edit } = packed.origin(offset);
    const sheet = edit && edit.sheet ? `, the sheet ${edit.sheet}` : '';
    return `${page.name} line ${lines(at)}${sheet}`;
  };
  // keep is false in each range that already has a finding. It searches the ranges sorted by
  // start, with the farthest end up to each one.
  const ranges = handled.sort((a, b) => a[0] - b[0]);
  const farthest = [];
  for (const [, end] of ranges) farthest.push(Math.max(end, farthest[farthest.length - 1] ?? 0));
  const keep = (offset) => {
    const { at } = packed.origin(offset);
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (ranges[mid][0] <= at) low = mid + 1;
      else high = mid - 1;
    }
    return high < 0 || farthest[high] <= at;
  };
  Object.assign(result, {
    text: packed.text, title, criteria, links, where: placeOf, keep, ok: true,
  });
  return result;
}

function clearOutput(out) {
  for (const name of fs.readdirSync(out)) {
    if (name === SCREENS || name.endsWith('.html') || name.endsWith('.png')) {
      fs.rmSync(path.join(out, name));
    }
  }
}

function underRoot(given, root, flag, { name, create } = {}) {
  const whole = path.resolve(given);
  const wrong = () => new ArgumentError(
    `Set ${flag} to a folder named ${name} under ${root}: ${given}`);
  if (name && path.basename(whole) !== name) throw wrong();
  if (create) {
    let parent = whole;
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    if (!inside(fs.realpathSync(parent), [root])) {
      throw new ArgumentError(`Set ${flag} to a folder under ${root}: ${given}`);
    }
    fs.mkdirSync(whole, { recursive: true });
  }
  let real;
  try {
    real = fs.realpathSync(whole);
  } catch {
    throw new ArgumentError(`Set ${flag} to a folder that exists: ${given}`);
  }
  if (!inside(real, [root])) {
    throw new ArgumentError(`Set ${flag} to a folder under ${root}: ${given}`);
  }
  if (!fs.statSync(real).isDirectory()) {
    throw new ArgumentError(`Set ${flag} to a folder: ${given}`);
  }
  if (name && path.basename(real) !== name) throw wrong();
  return real;
}

// readPage returns the bytes of a page, at most a page's limit and one byte more, or at most
// limit and one byte more.
function readPage(file, limit = MAX_PAGE_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const bytes = Buffer.alloc(limit + 1);
    return bytes.subarray(0, fs.readSync(fd, bytes, 0, bytes.length, 0));
  } catch {
    throw new Unreadable(`Make ${file} readable: it cannot be read.`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// isPlainFile returns whether file is a file with one name, at its real path, so that a
// symbolic or hard link cannot make the script read a file from elsewhere. It throws when
// file does not exist.
function isPlainFile(file) {
  const stat = fs.lstatSync(file);
  return stat.isFile() && stat.nlink === 1 && fs.realpathSync(file) === file;
}

// readPages returns the pages of pagesDir. It reads only plain files in the folder, so that
// a link cannot make the pack copy a file from elsewhere into a page.
function readPages(pagesDir, say) {
  const pages = [];
  for (const name of fs.readdirSync(pagesDir).filter((entry) => entry.endsWith('.html')).sort()) {
    const file = path.join(pagesDir, name);
    let plain;
    try {
      plain = isPlainFile(file);
    } catch {
      throw new Unreadable(`Make ${file} readable: it cannot be read.`);
    }
    if (!plain) {
      throw new Refusal(`Write ${name} anew as a file in ${pagesDir}: it is a link or a folder.`);
    }
    const bytes = readPage(file);
    if (bytes.toString('utf8').replace(/^\uFEFF/, '').trimStart().startsWith(DROPPED_MARK)) {
      say(`Dropped: ${name}`);
    } else {
      pages.push({ id: name.slice(0, -'.html'.length), name, bytes });
    }
  }
  if (!pages.length) {
    throw new Refusal(`Write one .html file per screen in ${pagesDir}: it has none.`);
  }
  if (pages.length > MAX_SCREENS) {
    throw new Refusal(`Use at most ${MAX_SCREENS} screens: ${pagesDir} has ${pages.length}.`);
  }
  for (const page of pages) {
    if (!SCREEN_ID.test(page.id)) {
      throw new Refusal('Name each page with at most 32 lower-case letters, digits and hyphens: '
        + `${page.name}`);
    }
  }
  return pages;
}

// readVersion returns { files, folder } for checkVersion: files, a Map of name to bytes, and
// folder, the number of entries and the size of each file. A folder or a link in it counts as
// a file, so that the check refuses it. It reads no file over its limit, and no file when the
// folder has too many entries.
function readVersion(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new Unreadable(`Make ${dir} readable: it cannot be read.`);
  }
  const files = new Map();
  const sizes = new Map();
  const folder = { count: entries.length, sizes };
  if (entries.length > MAX_FILES) return { files, folder };
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink() || (entry.isFile() && !isPlainFile(file))) {
      throw new Refusal(`Write the version in ${dir} anew with the pack: ${entry.name} is a link.`);
    }
    if (!entry.isFile()) {
      files.set(entry.name, Buffer.alloc(0));
      continue;
    }
    const limit = entry.name === SCREENS ? MAX_SCREENS_BYTES : MAX_PAGE_BYTES;
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      throw new Unreadable(`Make ${file} readable: it cannot be read.`);
    }
    if (size > limit) sizes.set(entry.name, size);
    files.set(entry.name, size > limit ? Buffer.alloc(0) : readPage(file, limit));
  }
  return { files, folder };
}

// checkoutOf returns the folder that {{checkout}} stands for, and that the pack may read: the
// nearest folder from cwd upwards that has a .git entry, or null when none has. It reads no
// git setting, so that core.worktree cannot point it elsewhere. home is the home folder of
// the user, from the user database and not from $HOME.
function checkoutOf(cwd, home) {
  let folder = fs.realpathSync(cwd);
  for (;;) {
    if (fs.existsSync(path.join(folder, '.git'))) break;
    const parent = path.dirname(folder);
    if (parent === folder) return null;
    folder = parent;
  }
  let realHome = home;
  try {
    realHome = fs.realpathSync(home);
  } catch {
    // A home folder that does not exist is inside no checkout.
  }
  if (folder === path.parse(folder).root || inside(realHome, [folder])) {
    throw new ArgumentError(`Run the script from the working folder of the run: ${folder} is `
      + 'the root of the disk or contains the home folder.');
  }
  return folder;
}

// homeFolder returns the home folder of the user from the user database. os.userInfo throws
// when the user has no entry there, and then $HOME is the only source.
function homeFolder(deps) {
  try {
    return (deps.userInfo || os.userInfo)().homedir;
  } catch {
    return os.homedir();
  }
}

const amount = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// artifactRoot returns the real path of the artifact folder.
function artifactRoot(deps) {
  try {
    return fs.realpathSync(deps.artifacts);
  } catch {
    throw new Unreadable(`Make the artifact folder ${deps.artifacts} readable: it cannot be read.`);
  }
}

function pack(options, deps) {
  const root = artifactRoot(deps);
  const checkout = checkoutOf(deps.cwd || process.cwd(), deps.home || homeFolder(deps));
  // First of all, because a refusal must leave no page of an earlier pack to push.
  const out = underRoot(options.out, root, '--out', { name: DRAFT_FOLDER, create: true });
  clearOutput(out);
  const pagesDir = underRoot(options.pages, root, '--pages', { name: PAGES_FOLDER });
  const pages = readPages(pagesDir, deps.errors);
  const ids = new Set(pages.map((page) => page.id));
  if (!ids.has(options.start)) {
    throw new ArgumentError(`Set --start to one of: ${[...ids].join(' ')}.`);
  }
  const findings = [];
  const ctx = {
    checkout, roots: checkout ? [checkout, root] : [root], ids,
    dropped: (text) => deps.errors(`Dropped: ${cut(text, LINE)}`),
  };
  const packed = pages.map((page) => packPage(page, ctx, (make) => collect(findings, make)));
  for (const page of packed.filter((p) => p.ok)) {
    const checked = checkPage(page.text, {
      file: page.file, ids, title: page.title, where: page.where, keep: page.keep,
    });
    append(findings, checked.findings);
  }
  if (!findings.length) {
    const linksOf = (id) => packed.find((p) => p.id === id).links.map((l) => l.to);
    for (const id of unreachable(packed, options.start, linksOf)) {
      findings.push(finding(reachFix(id, options.start), `${id}.html`));
    }
  }
  if (findings.length) return { findings };
  const screens = {
    start: options.start,
    screens: packed.map((p) => ({
      id: p.id, title: p.title, file: p.file, criteria: p.criteria,
      links: p.links.map(({ to, label }) => ({ to, label })),
    })),
  };
  const files = new Map([[SCREENS, Buffer.from(`${JSON.stringify(screens, null, 2)}\n`)]]);
  for (const page of packed) files.set(page.file, Buffer.from(page.text));
  const where = Object.fromEntries(packed.map((p) => [p.file, { where: p.where }]));
  const gate = checkVersion(files, where);
  if (gate.length) return { findings: gate };
  for (const [name, bytes] of files) fs.writeFileSync(path.join(out, name), bytes);
  // The written version, as the push reads it.
  const read = readVersion(out);
  const written = checkVersion(read.files, {}, read.folder);
  if (written.length) {
    clearOutput(out);
    return { findings: written };
  }
  let total = 0;
  for (const bytes of files.values()) total += bytes.length;
  return { result: `${out}: ${amount(packed.length, 'screen')}, ${amount(total, 'byte')}` };
}

// ---- Unpack ---------------------------------------------------------------------------------

const SHEET_PATH = /^[A-Za-z0-9._\-/ %]+$/;

// unpackPage returns the editable text of a packed page: the inserted links removed, each
// inlined sheet linked again, and data-to kept.
function unpackPage(text) {
  const { elements } = parseHtml(text);
  const edits = [];
  for (const el of elements) {
    if (el.ns !== 'html') continue;
    if (el.lname === 'a' && attrOf(el, 'data-to') && attrOf(el, 'href')) {
      const href = attrOf(el, 'href');
      const before = isWs(text[href.start - 1]) ? 1 : 0;
      edits.push({ start: href.start - before, end: href.end, text: '' });
    } else if (el.lname === 'a' && el.attrs.length === 2 && el.attrs[0].lname === 'href'
      && el.attrs[1].lname === 'style' && el.attrs[1].value === WRAP_STYLE
      && el.children.length === 1 && el.children[0].kind === 'element'
      && attrOf(el.children[0], 'data-to')) {
      edits.push({ start: el.start, end: el.tagEnd, text: '' });
      edits.push({ start: el.endStart, end: el.end, text: '' });
    } else if (el.lname === 'style' && el.attrs.length === 1
      && el.attrs[0].lname === 'data-sheet') {
      const sheet = el.attrs[0].value;
      if (!isSheet(sheet)) {
        throw new Refusal(`its sheet ${quote(sheet)} is no .css file`);
      }
      if (SHEET_PATH.test(sheet) && !sheet.split('/').includes('..')) {
        const text = `<link rel="stylesheet" href="${TOKEN}/${sheet}">`;
        edits.push({ start: el.start, end: el.end, text });
      }
    }
  }
  return applyEdits(text, edits).text;
}

function unpack(options, deps) {
  const root = artifactRoot(deps);
  const pagesDir = underRoot(options.pages, root, '--pages', { name: PAGES_FOLDER, create: true });
  const anew = 'Write each page anew, with no --unpack:';
  // Unpack would overwrite a changed page and undo a dropped mark.
  if (fs.readdirSync(pagesDir).some((name) => name.endsWith('.html'))) {
    throw new Refusal(`Change the pages in ${pagesDir}, with no --unpack: it has pages already.`);
  }
  if (!fs.existsSync(path.resolve(options.unpack)) && inside(realParent(options.unpack), [root])) {
    throw new Refusal(`${anew} ${options.unpack} does not exist, so this mockup has no pages `
      + 'to unpack.');
  }
  const from = underRoot(options.unpack, root, '--unpack');
  const unusable = (why) => new Refusal(`${anew} ${from} ${why}.`);
  // plain reads a file of the version only when it is no link, and only up to its limit and
  // the limit of the version.
  let total = 0;
  const plain = (name, limit) => {
    const file = path.join(from, name);
    let ok = false;
    let size = 0;
    try {
      ok = isPlainFile(file);
      size = fs.statSync(file).size;
    } catch {
      throw unusable(`has no readable ${name}`);
    }
    if (!ok) throw unusable(`has ${name} as a link or a folder`);
    total += size;
    if (size > limit) {
      throw unusable(`has ${name} with ${size} bytes, over its limit of ${limitText(limit)}`);
    }
    if (total > MAX_VERSION_BYTES) {
      throw unusable(`has files with over ${limitText(MAX_VERSION_BYTES)}, at ${name}`);
    }
    const bytes = readPage(file, limit);
    if (bytes.length > limit) {
      throw unusable(`has ${name} with over ${limitText(limit)}`);
    }
    return bytes;
  };
  let value;
  const screensBytes = plain(SCREENS, MAX_SCREENS_BYTES);
  try {
    ({ value } = parseScreens(screensBytes));
  } catch {
    throw unusable(`has no readable ${SCREENS}`);
  }
  const screens = isObject(value) && Array.isArray(value.screens) ? value.screens : null;
  const usable = (s) => isObject(s) && typeof s.id === 'string' && SCREEN_ID.test(s.id);
  const unique = screens && new Set(screens.map((s) => s.id)).size === screens.length;
  if (!screens || !screens.every(usable) || !unique) {
    throw unusable('has no list of screens, each with a usable id');
  }
  // Each page first, so that a refusal writes no page.
  const texts = screens.map((screen) => {
    const bytes = plain(`${screen.id}.html`, MAX_PAGE_BYTES);
    let text;
    try {
      text = utf8(bytes);
    } catch {
      throw unusable(`has no readable page ${screen.id}.html`);
    }
    try {
      return [screen.id, unpackPage(text)];
    } catch (error) {
      if (error instanceof Refusal) throw unusable(`has ${screen.id}.html, but ${error.message}`);
      throw unusable(`has no readable page ${screen.id}.html`);
    }
  });
  for (const [id, text] of texts) fs.writeFileSync(path.join(pagesDir, `${id}.html`), text);
  return `${pagesDir}: ${amount(texts.length, 'page')}`;
}

// ---- Main -----------------------------------------------------------------------------------

function parseArguments(argv) {
  const options = {};
  for (const argument of argv) {
    const match = /^--(pages|out|start|unpack|check)=(.+)$/s.exec(argument);
    if (!match) {
      throw new ArgumentError('Use --pages, --out, --start, --unpack or --check, each with a '
        + `value: ${argument}`);
    }
    if (options[match[1]] !== undefined) throw new ArgumentError(`Write --${match[1]} once.`);
    options[match[1]] = match[2];
  }
  const given = Object.keys(options).sort().join(' ');
  if (!['out pages start', 'pages unpack', 'check'].includes(given)) {
    throw new ArgumentError('Set --pages, --out and --start, or --unpack and --pages, or --check.');
  }
  return options;
}

function writeFindings(say, findings) {
  const shown = findings.filter((line) => line !== null).slice(0, MAX_FINDINGS);
  for (const line of shown) say(line);
  const left = findings.length - shown.length;
  if (left > 0) {
    say(`Fix these findings first: ${left} more ${left === 1 ? 'is' : 'are'} left out.`);
  }
}

// lineWriter returns a function that writes one line to stream. A name or value in the line
// may contain a line break or a mark such as U+202E, so each one becomes a space.
const lineWriter = (stream) => (text) => {
  stream.write(`${String(text).replace(CONTROL_ALL, ' ')}\n`);
};

// Returns the exit status. Findings and the result go to stdout; Dropped: lines, usage, an
// unreadable input and a wrong argument go to stderr.
function main(argv, deps = { artifacts: ARTIFACTS }) {
  const results = lineWriter(deps.stdout || process.stdout);
  const errors = lineWriter(deps.stderr || process.stderr);
  const flag = argv.map((a) => /^--(unpack|check)=/.exec(a)).find(Boolean);
  const verb = { unpack: 'Unpacked', check: 'Checked' }[flag && flag[1]] || 'Packed';
  const nothing = `${verb} nothing`;
  try {
    const options = parseArguments(argv);
    if (options.unpack) {
      results(unpack(options, deps));
      return 0;
    }
    if (options.check) {
      const dir = underRoot(options.check, artifactRoot(deps), '--check');
      const { files, folder } = readVersion(dir);
      const findings = checkVersion(files, {}, folder);
      writeFindings(results, findings);
      results(`Checked ${dir}: ${amount(folder.count, 'file')}, `
        + `${amount(findings.length, 'finding')}.`);
      return findings.length ? 1 : 0;
    }
    const { findings, result } = pack(options, { ...deps, errors });
    if (findings) {
      writeFindings(results, findings);
      results(`${nothing}: ${amount(findings.length, 'finding')}.`);
      return 1;
    }
    results(result);
    return 0;
  } catch (error) {
    if (error instanceof ArgumentError) {
      errors(error.message);
      errors(USAGE);
      return 2;
    }
    if (error instanceof Unreadable) {
      errors(error.message);
      return 3;
    }
    if (error instanceof Refusal) {
      results(error.message);
      results(`${nothing}: 1 finding.`);
      return 1;
    }
    for (const line of String(error.stack).split('\n')) errors(line);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  CONTROL_ALL, DROPPED_MARK, MAX_PAGE_BYTES, MAX_PAGE_SHEETS, TOKEN, checkPage, checkVersion,
  cssRefusals, cssTokens, decodeRefs, lineWriter, main, parseHtml, srcsetUrls, unpackPage,
};
