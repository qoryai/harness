// The counts of a JUnit XML result file, the form that most test runners write: each
// testcase element is a test, with a failure or error element when it failed, and a skipped
// element when it did not run. It reads the elements in one pass, not by a full XML parser,
// because the counts need only these elements, and reads each character a fixed number of
// times, so that a file of 16 MB takes no longer than a parse.
'use strict';

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };
const unescape = (text) => text.replace(/&(lt|gt|amp|quot|apos);/g, (all, name) => ENTITIES[name]);

const NAME_START = /[A-Za-z_:]/;
const NAME = /[-A-Za-z0-9_:.]/;
const SPACE = /\s/;

// attributes returns the attributes of the text of a start tag, as name="value" or
// name='value'. It reads each character once.
function attributes(text) {
  const out = {};
  let at = 0;
  while (at < text.length) {
    if (!NAME_START.test(text[at])) {
      at += 1;
      continue;
    }
    const from = at;
    while (at < text.length && NAME.test(text[at])) at += 1;
    const name = text.slice(from, at);
    while (at < text.length && SPACE.test(text[at])) at += 1;
    if (text[at] !== '=') continue;
    at += 1;
    while (at < text.length && SPACE.test(text[at])) at += 1;
    const quote = text[at];
    if (quote !== '"' && quote !== '\'') continue;
    const end = text.indexOf(quote, at + 1);
    if (end === -1) break;
    out[name] = unescape(text.slice(at + 1, end));
    at = end + 1;
  }
  return out;
}

// startTag returns the end of the start tag whose attributes begin at from, the index after
// its >, or -1 when the text ends first. A > inside a quoted attribute value is part of it.
function startTag(text, from) {
  for (let at = from; at < text.length; at += 1) {
    const char = text[at];
    if (char === '>') return at + 1;
    if (char === '"' || char === '\'') {
      at = text.indexOf(char, at + 1);
      if (at === -1) return -1;
    }
  }
  return -1;
}

// testcases returns { attrs, body } for each testcase element of text, body being '' for an
// empty element.
function testcases(text) {
  const out = [];
  const name = /^<testcase[\s/>]/;
  let closing = -2;
  let at = text.indexOf('<testcase');
  while (at !== -1) {
    if (!name.test(text.slice(at, at + 10))) {
      at = text.indexOf('<testcase', at + 9);
      continue;
    }
    const end = startTag(text, at + 9);
    if (end === -1) break;
    const attrs = attributes(text.slice(at + 9, end - 1));
    let body = '';
    let next = end;
    if (text[end - 2] !== '/') {
      if (closing !== -1 && closing < end) closing = text.indexOf('</testcase', end);
      if (closing === -1) break;
      body = text.slice(end, closing);
      next = closing + 10;
    }
    out.push({ attrs, body });
    at = text.indexOf('<testcase', next);
  }
  return out;
}

function counts(text) {
  if (!/<testsuites?\b/.test(text)) return null;
  const out = { tests: 0, failed: 0, skipped: 0, failures: [] };
  for (const { attrs, body } of testcases(text)) {
    out.tests += 1;
    if (/<(?:failure|error)\b/.test(body)) {
      out.failed += 1;
      out.failures.push({ name: attrs.name || attrs.classname || '', file: attrs.file || null });
    } else if (/<skipped\b/.test(body)) {
      out.skipped += 1;
    }
  }
  return out;
}

module.exports = { counts };
