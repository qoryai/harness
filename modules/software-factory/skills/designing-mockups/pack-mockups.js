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
// reads only files under the working folder and the artifact folder, and no file with a
// secret name.
//
// Output: one finding per line on stdout, each starting with the fix, at most 200
// characters, then one result line. Each `Dropped:` line on stderr names a page or an
// address that the pack left out.
//
// Exit status: 0 done, 1 findings, 2 wrong arguments, 3 an input cannot be read.
'use strict';

const fs = require('node:fs');
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
const MAX_TEXT = 200;
const MAX_CRITERIA = 50;
const MAX_LINKS = 100;
const SCREEN_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CRITERION = /^ac-[1-9][0-9]{0,3}$/;
// An @import of the checkout inlines its sheet; this depth stops a loop of imports.
const MAX_IMPORT_DEPTH = 8;
// A dropped address in an inlined sheet becomes this fragment, which loads nothing.
const DROPPED_URL = 'url(#dropped)';

const LINE = 200;
const QUOTE = 80;
// The findings written out. A list of findings has its first ones as lines and each later one
// as null, so that thousands of findings cost no time to write.
const MAX_FINDINGS = 50;

class Refusal extends Error {}
class Unreadable extends Error {}
// A page that the parser cannot read for certain. at is the offset in the page.
class Unparsable extends Error {
  constructor(at, fix, value) {
    super(fix);
    this.at = at;
    this.value = value;
  }
}

// ---- Text of the output -------------------------------------------------------------------

const CONTROL_ALL = /[\u0000-\u001F\u007F-\u009F]/gu;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;

function cut(text, size) {
  const chars = [...text];
  return chars.length > size ? `${chars.slice(0, size - 3).join('')}...` : text;
}

function quote(text) {
  return `"${cut(String(text).replace(CONTROL_ALL, ' ').trim(), QUOTE)}"`;
}

// finding returns one line: the fix, where, and the bad value in quotes when there is one.
function finding(fix, where, value) {
  const shown = value === undefined || value === '' ? '' : `, ${quote(value)}`;
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
const HEAD_CONTENT = ['title', 'meta', 'style', 'link', 'base'];
// The only parents that a browser keeps for these elements. A browser puts a <tbody> around
// a <tr> directly in a <table>, so the parser refuses that <tr>.
const PARENTS = {
  head: ['html'], body: ['html'], li: ['ul', 'ol'], dt: ['dl', 'div'], dd: ['dl', 'div'],
  tr: ['thead', 'tbody', 'tfoot'], td: ['tr'], th: ['tr'], thead: ['table'],
  tbody: ['table'], tfoot: ['table'], caption: ['table'], colgroup: ['table'], col: ['colgroup'],
  option: ['select', 'optgroup'], optgroup: ['select'], source: ['picture'], title: ['head'],
  meta: ['head'], link: ['head'], base: ['head'],
};
// The only children that a browser keeps in these elements.
const CHILDREN = {
  html: ['head', 'body'], head: HEAD_CONTENT,
  table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'style'],
  thead: ['tr'], tbody: ['tr'], tfoot: ['tr'], tr: ['td', 'th'], colgroup: ['col'],
  select: ['option', 'optgroup'], optgroup: ['option'], option: [],
};
// A browser moves the text in these out, so only white space may stand there.
const NO_TEXT = new Set(words('html head table thead tbody tfoot tr colgroup select optgroup'));
// A start tag of these ends an open p.
const CLOSES_P = new Set(words(`address article aside blockquote details dialog div dl fieldset
  figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre
  section summary table ul li dd dt`));
const P_SCOPE = new Set(words('html table td th caption button marquee object template applet'));
const HEADINGS = new Set(words('h1 h2 h3 h4 h5 h6'));
// The special elements of HTML. A start tag of dd or dt ends an open dd or dt up to the first
// of these that is no address, div or p.
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
    if ((name === 'dd' || name === 'dt') && parent.inDd) {
      fail(at, `Close the open <dd> or <dt> before <${el.name}>, because a browser ends it there`);
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
      const el = {
        kind: 'element', name: tag.name, lname: tag.lname, ns, attrs: tag.attrs, parent,
        children: [], start: i, tagEnd: tag.tagEnd,
      };
      for (const attr of el.attrs) attr.element = el;
      place(el, parent);
      // inP: a p is open that a start tag such as <div> ends. inDd: the same for dd and dt.
      el.inP = ns === 'html' && !P_SCOPE.has(el.lname) && (el.lname === 'p' || !!parent.inP);
      el.inDd = ns === 'html' && (el.lname === 'dd' || el.lname === 'dt'
        || ((!SPECIAL.has(el.lname) || DD_PASS.has(el.lname)) && !!parent.inDd));
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
const FRAGMENT = /^#./;
const REFUSED_AT_RULES = ['import', 'namespace', 'document'];
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
        if (i >= n) break;
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
      found.push({ value: token.value, start: token.start, end: token.end, fontFace, at: k });
    } else if (token.type === 'function' && ['url', 'src'].includes(unprefix(token.name))) {
      let j = k + 1;
      while (tokens[j] && ['ws', 'comment'].includes(tokens[j].type)) j += 1;
      const string = tokens[j];
      j += 1;
      while (tokens[j] && ['ws', 'comment'].includes(tokens[j].type)) j += 1;
      const close = tokens[j];
      if (string && string.type === 'string' && close && close.type === ')') {
        found.push({ value: string.value, start: token.start, end: close.end, fontFace, at: k });
      } else {
        found.push({ value: null, start: token.start, end: token.end, fontFace, at: k });
      }
    }
  }
  return found;
}

// addressRefusal returns why CSS may not use value as an address, or null. mode 'fragment'
// allows only url(#<name>), for an SVG attribute such as fill.
function addressRefusal(value, fontFace, mode) {
  if (value === null) return 'Write one address in quotes in url() or src()';
  const v = trimWs(value);
  if (GAP.test(v)) return 'Remove the space or control character inside the address';
  if (FRAGMENT.test(v)) return null;
  if (mode === 'fragment') return 'Use only url(#<name>) in this attribute';
  if (DATA_IMAGE.test(v) || (fontFace && DATA_FONT.test(v))) return null;
  if (DATA_FONT.test(v)) return 'Use a data: font only inside @font-face';
  return 'Use only a data: picture, url(#<name>) or {{checkout}}/<path> in CSS';
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

const SQUEEZED_WORDS = ['expression(', '-moz-binding', 'javascript:', 'vbscript:', 'data:text'];

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
    const why = addressRefusal(address.value, address.fontFace, mode);
    const value = address.value ?? css.slice(address.start, address.end);
    if (why) refusals.push([address.start, why, value]);
  }
  for (const token of tokens) {
    const name = token.name !== undefined ? unprefix(token.name) : null;
    if (token.type === 'at' && REFUSED_AT_RULES.includes(name)) {
      refusals.push([token.start, `Remove the CSS rule @${token.name}`]);
    } else if (token.type === 'function' && REFUSED_FUNCTIONS.includes(name)) {
      refusals.push([token.start, `Remove the CSS function ${token.name}()`]);
    } else if (token.type === 'ident'
      && (name === 'behavior' || token.name.toLowerCase() === '-moz-binding')) {
      refusals.push([token.start, `Remove ${token.name} from the CSS`]);
    }
    const text = (token.value ?? token.name ?? '').toLowerCase();
    if (/javascript:|vbscript:/.test(norm(text))) {
      refusals.push([token.start, 'Remove the script address from the CSS', text]);
    }
  }
  if (refusals.length) return refusals;
  // The literal reading of contract.md: comments removed, escapes decoded, then searched.
  const plain = decodeCssEscapes(css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')).toLowerCase();
  const squeezed = norm(plain);
  for (const match of plain.matchAll(/(?:url|src)\(([^)]*)\)?/g)) {
    const value = match[1].trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
    const fontFace = mode === 'sheet';
    const why = addressRefusal(value, fontFace, mode);
    if (why) refusals.push([0, why, value]);
  }
  for (const rule of REFUSED_AT_RULES) {
    if (new RegExp(`@(-[a-z0-9]+-)?${rule}`).test(squeezed)) {
      refusals.push([0, `Remove the CSS rule @${rule}`]);
    }
  }
  for (const name of REFUSED_FUNCTIONS) {
    if (squeezed.includes(`${name}(`)) refusals.push([0, `Remove the CSS function ${name}()`]);
  }
  // behavior as a property: scroll-behavior and overscroll-behavior are other properties.
  if (/(?<![a-z0-9_-])behavior/.test(plain)) refusals.push([0, 'Remove behavior from the CSS']);
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
  label input button select option optgroup textarea fieldset legend progress meter output`));
const SVG_ELEMENTS = new Set(words(`svg g defs symbol use title desc path rect circle ellipse
  line polyline polygon text tspan linearGradient radialGradient stop clipPath mask pattern
  image`).map((name) => name.toLowerCase()));
const GLOBAL_ATTRS = new Set(words('id class style title lang dir hidden tabindex role'));
const ARIA = /^aria-[a-z]+$/;
const DATA = /^data-[a-z0-9_.-]+$/;
const CHOICE = 'name multiple size selected disabled label value';
const CELL = 'colspan rowspan scope headers';
const RANGE = 'value min max low high optimum';
const HTML_ATTRS = Object.fromEntries(Object.entries({
  a: 'href', img: 'src srcset alt width height loading decoding',
  source: 'srcset type media sizes',
  input: 'type name value placeholder checked disabled readonly min max step size',
  button: 'type disabled name value', select: CHOICE, option: CHOICE, optgroup: CHOICE,
  textarea: 'name rows cols placeholder disabled readonly', label: 'for', td: CELL, th: CELL,
  col: 'span', colgroup: 'span', ol: 'start reversed type', li: 'value', time: 'datetime',
  meter: RANGE, progress: RANGE, details: 'open', table: 'border',
}).map(([name, list]) => [name, new Set(words(list))]));
const SVG_ATTRS = new Set(words(`viewBox xmlns xmlns:xlink preserveAspectRatio d x y x1 y1 x2
  y2 cx cy r rx ry fx fy dx dy width height points transform rotate textLength lengthAdjust
  offset fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap
  stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit opacity clip-path
  clip-rule mask font-family font-size font-weight font-style text-anchor dominant-baseline
  letter-spacing stop-color stop-opacity gradientUnits gradientTransform spreadMethod
  patternUnits patternContentUnits patternTransform maskUnits maskContentUnits clipPathUnits
  visibility display focusable`).map((name) => name.toLowerCase()));
const SVG_URL_ATTRS = new Set(['fill', 'stroke', 'clip-path', 'mask']);
const INPUT_TYPES = new Set(words(`text email password number search tel url date time checkbox
  radio range color hidden`));
const PAGE_LINK = /^([a-z0-9][a-z0-9-]{0,31})\.html$/;
const MAX_USES = 1000;

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

// fragmentIds returns the id that a fragment such as #p points at, also with its %XX decoded.
function fragmentIds(fragment) {
  const name = fragment.slice(1);
  try {
    return [name, decodeURIComponent(name)];
  } catch {
    return [name];
  }
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
  let uses = 0;
  for (const el of tree.elements) {
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
      if (name === 'style') {
        cssOf(() => attr.start, attr.value, 'declarations');
      } else if (el.ns === 'svg' && SVG_URL_ATTRS.has(name)) {
        cssOf(() => attr.start, attr.value, 'fragment');
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
          report(attr.start, `Set ${attr.name} of <use> to #<id> of this page`, attr.value);
        } else if (fragmentIds(v).some((id) => noUse.has(id))) {
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
function decodePage(bytes, file) {
  if (bytes.length > MAX_PAGE_BYTES) {
    const fix = `Cut the page to ${MAX_PAGE_BYTES} bytes, such as with smaller pictures`;
    return { problem: finding(fix, file, `${bytes.length} bytes`) };
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
const goodText = (value) => typeof value === 'string' && value.isWellFormed()
  && length(value) >= 1 && length(value) <= MAX_TEXT && !CONTROL.test(value);

// parseScreens returns the value of screens.json. It throws Unreadable when the bytes are not
// UTF-8 JSON.
function parseScreens(bytes) {
  let text;
  try {
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) throw new Error('BOM');
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { value: JSON.parse(text), text };
  } catch {
    throw new Unreadable(`Write ${SCREENS} as UTF-8 JSON with no byte order mark: `
      + 'it cannot be read.');
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
// may give, per file, where and keep for checkPage. It returns the findings.
function checkVersion(files, pages = {}) {
  const findings = [];
  if (!files.has(SCREENS)) return [finding(`Add ${SCREENS} to the version`, 'the version folder')];
  let total = 0;
  for (const bytes of files.values()) total += bytes.length;
  if (files.size > MAX_FILES) {
    findings.push(finding(`Keep at most ${MAX_FILES} files in the version`, 'the version folder',
      `${files.size} files`));
  }
  if (total > MAX_VERSION_BYTES) {
    const fix = `Cut the version to ${MAX_VERSION_BYTES} bytes, such as with smaller pictures`;
    findings.push(finding(fix, 'the version folder', `${total} bytes`));
  }
  const bytes = files.get(SCREENS);
  if (bytes.length > MAX_SCREENS_BYTES) {
    findings.push(finding(`Cut ${SCREENS} to ${MAX_SCREENS_BYTES} bytes`, SCREENS,
      `${bytes.length} bytes`));
  }
  const { value, text } = parseScreens(bytes);
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
    const decoded = decodePage(files.get(screen.file), screen.file);
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
  const outside = 'outside the working folder and the artifact folder';
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

// typeOf returns the media type of a picture or font by its first bytes, or null.
function typeOf(bytes) {
  const starts = (text, at = 0) => bytes.subarray(at, at + text.length).toString('latin1') === text;
  if (starts('\x89PNG\r\n\x1A\n')) return 'image/png';
  if (starts('\xFF\xD8\xFF')) return 'image/jpeg';
  if (starts('GIF87a') || starts('GIF89a')) return 'image/gif';
  if (starts('RIFF') && starts('WEBP', 8)) return 'image/webp';
  if (starts('wOF2')) return 'font/woff2';
  if (starts('wOFF')) return 'font/woff';
  if (starts('OTTO')) return 'font/otf';
  if (starts('\x00\x01\x00\x00') || starts('true')) return 'font/ttf';
  return null;
}

// readAsset returns { uri } with the data: URI of a picture, or a font when fonts is true, at
// url, or { refusal }.
function readAsset(url, roots, fonts) {
  const { file, refusal } = fileOf(url, roots);
  if (refusal) return { refusal };
  const size = fs.statSync(file).size;
  if (size > MAX_PAGE_BYTES) {
    return { refusal: `the file has ${size} bytes, over the limit of a page` };
  }
  const bytes = fs.readFileSync(file);
  const type = typeOf(bytes);
  if (!type || (!fonts && !IMAGE_TYPES.includes(type))) {
    const svg = /\.svg$/i.test(file) ? '; draw an SVG file as <svg> in the page' : '';
    const font = fonts ? ' and no font' : '';
    return { refusal: `the file is no PNG, JPEG, GIF or WebP picture${font}${svg}` };
  }
  return { uri: `data:${type};base64,${bytes.toString('base64')}` };
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
    if (edit.start < from) throw new Error(`overlapping edits at ${edit.start}`);
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
  tfoot caption col colgroup li dt dd option optgroup source summary legend`));
const NO_WRAP_PARENT = new Set(words('picture select optgroup'));

// inlineSheet returns the text of the sheet at url, with each @import of a readable sheet
// inlined, each readable picture or font as a data: URI, and each other address dropped. It
// throws Refusal with a finding when the sheet cannot be inlined.
function inlineSheet(url, ctx, label, chain = []) {
  const { file, refusal } = fileOf(url, ctx.roots);
  if (refusal) throw new Refusal(`Fix the link to the sheet, ${refusal}`);
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
  let depth = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.type === '{') depth += 1;
    if (token.type === '}') depth -= 1;
    if (token.type !== 'at' || unprefix(token.name) !== 'import' || depth !== 0) continue;
    let end = k + 1;
    while (end < tokens.length && tokens[end].type !== ';' && tokens[end].type !== '{') end += 1;
    const ruleEnd = tokens[end] ? tokens[end].end : css.length;
    const first = skip(k + 1);
    const address = cssAddresses(tokens.slice(first)).find((a) => a.at === 0);
    const string = tokens[first] && tokens[first].type === 'string' ? tokens[first] : null;
    const value = string ? string.value : address && address.value;
    const after = string ? string.end : address && address.end;
    const ruleStop = tokens[end] ? tokens[end].start : css.length;
    const media = after === undefined || after === null ? '' : css.slice(after, ruleStop).trim();
    let text = '';
    if (value === null || value === undefined || /^(layer|supports)\b/i.test(media)) {
      ctx.dropped(`${css.slice(token.start, ruleEnd)} in ${label}`);
    } else {
      let target = null;
      try {
        target = new URL(value.trim(), base).href;
      } catch {
        // An address that is no URL loads nothing, so the pack drops it.
      }
      const found = target && fileOf(target, ctx.roots).file;
      // A loop of imports, or a deep one, is dropped.
      if (found && !chain.includes(found) && found !== file && chain.length < MAX_IMPORT_DEPTH) {
        const inner = inlineSheet(target, ctx, `${value.trim()} of ${label}`, [...chain, file]);
        text = media ? `@media ${media}{${inner}}` : inner;
      } else {
        ctx.dropped(`${value.trim()} in ${label}`);
      }
    }
    edits.push({ start: token.start, end: ruleEnd, text });
    // The ; or { that ends the rule is read again, so that the depth stays right.
    k = end - 1;
  }
  const imports = edits.map((e) => [e.start, e.end]);
  for (const address of cssAddresses(tokens)) {
    if (imports.some(([s, e]) => address.start >= s && address.start < e)) continue;
    const value = address.value === null ? null : address.value.trim();
    if (value !== null && addressRefusal(value, address.fontFace, 'sheet') === null) continue;
    let uri = null;
    if (value !== null && !/^data:/i.test(value)) {
      let target = null;
      try {
        target = new URL(value, base).href;
      } catch {
        // An address that is no URL loads nothing, so the pack drops it.
      }
      uri = target && readAsset(target, ctx.roots, address.fontFace).uri;
    }
    if (uri && addressRefusal(uri, address.fontFace, 'sheet') === null) {
      edits.push({ start: address.start, end: address.end, text: `url(${uri})` });
    } else {
      ctx.dropped(`${value ?? css.slice(address.start, address.end)} in ${label}`);
      edits.push({ start: address.start, end: address.end, text: DROPPED_URL });
    }
  }
  const inlined = applyEdits(css, edits).text;
  if (/<\/style/i.test(inlined)) {
    throw new Refusal(`Write the rules of ${label} into a <style> in the page: `
      + 'the sheet contains </style');
  }
  return inlined;
}

const checkoutUrl = (ctx, value) => pathToFileURL(ctx.checkout).href + value.slice(TOKEN.length);

// packPage returns the packed text of one page and what screens.json needs of it: title,
// criteria and links. Each finding goes to report.
function packPage(page, ctx, report) {
  const result = { id: page.id, file: `${page.id}.html`, ok: false };
  if (page.bytes.length > MAX_PAGE_BYTES) {
    const fix = `Cut the page to ${MAX_PAGE_BYTES} bytes, such as with smaller pictures`;
    report(() => finding(fix, page.name, `${page.size} bytes`));
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

  // Each address of the checkout in CSS becomes a data: URI.
  const packCss = (css) => {
    let tokens;
    try {
      tokens = cssTokens(css);
    } catch {
      return { css, failed: [] };
    }
    const cssEdits = [];
    const failed = [];
    for (const address of cssAddresses(tokens)) {
      const value = address.value === null ? '' : norm(address.value);
      if (!value.startsWith(TOKEN)) continue;
      const asset = readAsset(checkoutUrl(ctx, value), ctx.roots, address.fontFace);
      const text = `url(${asset.uri})`;
      if (asset.uri) cssEdits.push({ start: address.start, end: address.end, text });
      else failed.push({ address, why: asset.refusal, value });
    }
    return { css: applyEdits(css, cssEdits).text, failed, edits: cssEdits.length };
  };
  const replaceAttr = (attr, value) => {
    edits.push({ start: attr.start, end: attr.end, text: `${attr.name}="${escapeAttr(value)}"` });
  };

  for (const el of tree.elements) {
    const html = el.ns === 'html';
    if (html && el.lname === 'link') {
      const rel = attrOf(el, 'rel');
      const href = attrOf(el, 'href');
      const value = href ? norm(href.value) : '';
      if (el.attrs.length === 2 && rel && rel.value.trim().toLowerCase() === 'stylesheet'
        && value.startsWith(`${TOKEN}/`)) {
        const label = value.slice(TOKEN.length + 1);
        try {
          const css = inlineSheet(checkoutUrl(ctx, value), ctx, label);
          edits.push({
            start: el.start,
            end: el.end,
            text: `<style data-sheet="${escapeAttr(label)}">${css}</style>`,
            sheet: label,
          });
        } catch (error) {
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
      const packed = packCss(body.raw);
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
        const packed = packCss(attr.value);
        for (const { why, value } of packed.failed) {
          fail(range, `Fix the address in style of ${tagOf(el)}, ${why}`, value);
        }
        if (packed.edits && !packed.failed.length) replaceAttr(attr, packed.css);
      } else if ((html && el.lname === 'img' && name === 'src')
        || (el.ns === 'svg' && el.lname === 'image' && isHref(name))) {
        const value = norm(attr.value);
        if (!value.startsWith(TOKEN)) continue;
        const asset = readAsset(checkoutUrl(ctx, value), ctx.roots, false);
        if (asset.uri) replaceAttr(attr, asset.uri);
        else fail(range, `Fix ${attr.name} of ${tagOf(el)}, ${asset.refusal}`, attr.value);
      } else if (html && name === 'srcset') {
        const entries = srcsetUrls(attr.value);
        const srcEdits = [];
        for (const entry of entries) {
          const value = norm(entry.url);
          if (!value.startsWith(TOKEN)) continue;
          const asset = readAsset(checkoutUrl(ctx, value), ctx.roots, false);
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
      const text = `<a href="${to}.html" style="display:contents">`;
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

  const packed = applyEdits(source, edits);
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
  if (!fs.statSync(real).isDirectory()) throw new Refusal(`Set ${flag} to a folder: ${given}`);
  if (name && path.basename(real) !== name) throw wrong();
  return real;
}

function readBytes(file) {
  try {
    return fs.readFileSync(file);
  } catch {
    throw new Unreadable(`Make ${file} readable: it cannot be read.`);
  }
}

// readPage returns the bytes of a page, at most a page's limit and one byte more.
function readPage(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const bytes = Buffer.alloc(MAX_PAGE_BYTES + 1);
    return bytes.subarray(0, fs.readSync(fd, bytes, 0, bytes.length, 0));
  } catch {
    throw new Unreadable(`Make ${file} readable: it cannot be read.`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// readPages returns the pages of pagesDir. It reads only plain files in the folder, so that
// a link cannot make the pack copy a file from elsewhere into a page.
function readPages(pagesDir, errors) {
  const pages = [];
  for (const name of fs.readdirSync(pagesDir).filter((entry) => entry.endsWith('.html')).sort()) {
    const file = path.join(pagesDir, name);
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch {
      throw new Unreadable(`Make ${file} readable: it cannot be read.`);
    }
    if (!stat.isFile() || stat.nlink > 1 || fs.realpathSync(file) !== file) {
      throw new Refusal(`Write ${name} anew as a file in ${pagesDir}: it is a link or a folder.`);
    }
    if (SECRET_NAME.test(name)) {
      throw new Refusal(`Name the page ${name} after its screen: the name looks like a secret.`);
    }
    const bytes = readPage(file);
    if (bytes.toString('utf8').replace(/^\uFEFF/, '').trimStart().startsWith(DROPPED_MARK)) {
      errors.write(`Dropped: ${name}\n`);
    } else {
      pages.push({ id: name.slice(0, -'.html'.length), name, bytes, size: stat.size });
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

// readVersion returns the files of a version folder as a Map of name to bytes. A folder or a
// link in it counts as a file, so that the check refuses it.
function readVersion(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new Unreadable(`Set --check to a version folder that exists: ${dir} cannot be read.`);
  }
  const files = new Map();
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    files.set(entry.name, entry.isFile() ? readBytes(path.join(dir, entry.name)) : Buffer.alloc(0));
  }
  if (!files.has(SCREENS)) throw new Unreadable(`Add ${SCREENS} to ${dir}: it has none.`);
  return files;
}

function pack(options, deps) {
  const root = fs.realpathSync(deps.artifacts);
  const checkout = fs.realpathSync(deps.cwd || process.cwd());
  if (checkout === path.parse(checkout).root) {
    throw new Refusal('Run the script from the working folder: the current folder is the root '
      + 'of the disk.');
  }
  // First of all, because a refusal must leave no page of an earlier pack to push.
  const out = underRoot(options.out, root, '--out', { name: DRAFT_FOLDER, create: true });
  clearOutput(out);
  const pagesDir = underRoot(options.pages, root, '--pages', { name: PAGES_FOLDER });
  const pages = readPages(pagesDir, deps.errors);
  const ids = new Set(pages.map((page) => page.id));
  if (!ids.has(options.start)) throw new Refusal(`Set --start to one of: ${[...ids].join(' ')}.`);
  const findings = [];
  const ctx = {
    checkout, roots: [checkout, root], ids,
    dropped: (text) => deps.errors.write(`Dropped: ${cut(text.replace(CONTROL_ALL, ' '), LINE)}\n`),
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
  const written = checkVersion(readVersion(out));
  if (written.length) {
    clearOutput(out);
    return { findings: written };
  }
  let total = 0;
  for (const bytes of files.values()) total += bytes.length;
  return { result: `${out}: ${packed.length} screens, ${total} bytes` };
}

// ---- Unpack ---------------------------------------------------------------------------------

const SHEET_PATH = /^[A-Za-z0-9._\-/]+$/;

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
      && el.attrs[1].lname === 'style' && el.attrs[1].value === 'display:contents'
      && el.children.length === 1 && el.children[0].kind === 'element'
      && attrOf(el.children[0], 'data-to')) {
      edits.push({ start: el.start, end: el.tagEnd, text: '' });
      edits.push({ start: el.endStart, end: el.end, text: '' });
    } else if (el.lname === 'style' && el.attrs.length === 1
      && el.attrs[0].lname === 'data-sheet') {
      const sheet = el.attrs[0].value;
      if (SHEET_PATH.test(sheet) && !sheet.split('/').includes('..')) {
        const text = `<link rel="stylesheet" href="${TOKEN}/${sheet}">`;
        edits.push({ start: el.start, end: el.end, text });
      }
    }
  }
  return applyEdits(text, edits).text;
}

function unpack(options, deps) {
  const root = fs.realpathSync(deps.artifacts);
  const pagesDir = underRoot(options.pages, root, '--pages', { name: PAGES_FOLDER, create: true });
  const anew = 'Write each page anew, with no --unpack:';
  if (!fs.existsSync(path.resolve(options.unpack)) && inside(realParent(options.unpack), [root])) {
    throw new Refusal(`${anew} ${options.unpack} does not exist, so this mockup has no pages `
      + 'to unpack.');
  }
  const from = underRoot(options.unpack, root, '--unpack');
  const unusable = (why) => new Refusal(`${anew} ${from} ${why}.`);
  let value;
  try {
    ({ value } = parseScreens(fs.readFileSync(path.join(from, SCREENS))));
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
    const file = path.join(from, `${screen.id}.html`);
    try {
      return [screen.id, unpackPage(utf8(fs.readFileSync(file)))];
    } catch {
      throw unusable(`has no readable page ${screen.id}.html`);
    }
  });
  for (const [id, text] of texts) fs.writeFileSync(path.join(pagesDir, `${id}.html`), text);
  return `${pagesDir}: ${texts.length} pages`;
}

// ---- Main -----------------------------------------------------------------------------------

function parseArguments(argv) {
  const options = {};
  for (const argument of argv) {
    const match = /^--(pages|out|start|unpack|check)=(.+)$/s.exec(argument);
    if (!match) {
      throw new Refusal('Use --pages, --out, --start, --unpack or --check, each with a value: '
        + `${argument}`);
    }
    if (options[match[1]] !== undefined) throw new Refusal(`Write --${match[1]} once.`);
    options[match[1]] = match[2];
  }
  const given = Object.keys(options).sort().join(' ');
  if (!['out pages start', 'pages unpack', 'check'].includes(given)) {
    throw new Refusal('Set --pages, --out and --start, or --unpack and --pages, or --check.');
  }
  return options;
}

function writeFindings(stream, findings) {
  const shown = findings.filter((line) => line !== null).slice(0, MAX_FINDINGS);
  for (const line of shown) stream.write(`${line}\n`);
  const left = findings.length - shown.length;
  if (left > 0) {
    stream.write(`Fix these findings first: ${left} more ${left === 1 ? 'is' : 'are'} left out.\n`);
  }
}

// Returns the exit status. Findings and the result go to stdout; Dropped: lines, usage and
// errors go to stderr.
function main(argv, deps = { artifacts: ARTIFACTS }) {
  const results = deps.stdout || process.stdout;
  const errors = deps.stderr || process.stderr;
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    errors.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  try {
    if (options.unpack) {
      results.write(`${unpack(options, deps)}\n`);
      return 0;
    }
    if (options.check) {
      const root = fs.realpathSync(deps.artifacts);
      if (!fs.existsSync(path.resolve(options.check))) {
        const fix = 'Set --check to a version folder that exists';
        throw new Unreadable(`${fix}: ${options.check} does not.`);
      }
      const dir = underRoot(options.check, root, '--check');
      const files = readVersion(dir);
      const findings = checkVersion(files);
      writeFindings(results, findings);
      results.write(`Checked ${dir}: ${files.size} files, ${findings.length} findings.\n`);
      return findings.length ? 1 : 0;
    }
    const { findings, result } = pack(options, { ...deps, errors });
    if (findings) {
      writeFindings(results, findings);
      results.write(`Packed nothing: ${findings.length} findings.\n`);
      return 1;
    }
    results.write(`${result}\n`);
    return 0;
  } catch (error) {
    if (error instanceof Unreadable) {
      errors.write(`${error.message}\n`);
      return 3;
    }
    errors.write(`${error instanceof Refusal ? error.message : error.stack}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  DROPPED_MARK, MAX_PAGE_BYTES, TOKEN, checkPage, checkVersion, cssRefusals, cssTokens,
  decodeRefs, main, parseHtml, srcsetUrls, unpackPage,
};
