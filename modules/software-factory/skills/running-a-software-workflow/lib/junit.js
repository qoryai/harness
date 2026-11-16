// The counts of a JUnit XML result file, the form that most test runners write: each
// testcase element is a test, with a failure or error element when it failed, and a skipped
// element when it did not run. It reads the elements in one pass, not by a full XML parser,
// because the counts need only these elements, and reads each character a fixed number of
// times, so that a file of 16 MB takes no longer than a parse. Comments and CDATA sections
// count as no element. A file whose testsuite elements have more tests, failures, errors or
// skips than its testcase elements, or with a failure or error outside every testcase, is a
// mismatch, which the check counts as red.
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

// plain returns text with a space in place of each comment and CDATA section, so that no
// element inside one counts. An unclosed one runs to the end of text.
function plain(text) {
  const parts = [];
  let at = 0;
  let comment = -2;
  let cdata = -2;
  while (at < text.length) {
    if (comment !== -1 && comment < at) comment = text.indexOf('<!--', at);
    if (cdata !== -1 && cdata < at) cdata = text.indexOf('<![CDATA[', at);
    const starts = [comment, cdata].filter((one) => one !== -1);
    if (!starts.length) break;
    const from = Math.min(...starts);
    const end = from === comment ? text.indexOf('-->', from + 4) : text.indexOf(']]>', from + 9);
    parts.push(text.slice(at, from), ' ');
    at = end === -1 ? text.length : end + 3;
  }
  parts.push(text.slice(at));
  return parts.join('');
}

// testcases returns { attrs, body, from, to } for each testcase element of text, body being
// '' for an empty element, and from and to the bounds of the element in text.
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
    out.push({ attrs, body, from: at, to: next });
    at = text.indexOf('<testcase', next);
  }
  return out;
}

// key returns the words that tell one testcase from another: its classname and its name.
const key = (attrs) => `${attrs.classname || ''}\n${attrs.name || ''}`;

// mismatch returns the words of the first mismatch of text with out, or null.
function mismatch(text, out, cases) {
  let last = 0;
  for (const one of cases) {
    if (/<(?:failure|error)\b/.test(text.slice(last, one.from))) break;
    last = one.to;
  }
  if (/<(?:failure|error)\b/.test(text.slice(last))) {
    return 'a failure or error element is outside every testcase element';
  }
  const suite = /<testsuites?(?=[\s/>])/g;
  for (let found = suite.exec(text); found; found = suite.exec(text)) {
    const end = startTag(text, found.index + found[0].length);
    if (end === -1) break;
    const attrs = attributes(text.slice(found.index + found[0].length, end - 1));
    const number = (name) => (/^[0-9]+$/.test(attrs[name] || '') ? Number(attrs[name]) : 0);
    const limits = [
      ['tests', number('tests'), out.tests],
      ['failures and errors', number('failures') + number('errors'), out.failed],
      ['skipped', number('skipped'), out.skipped],
    ];
    const over = limits.find(([, stated, counted]) => stated > counted);
    if (over) {
      return `a ${found[0].slice(1)} element counts ${over[1]} for ${over[0]}, and the ` +
        `testcase elements count ${over[2]}`;
    }
    suite.lastIndex = end;
  }
  return null;
}

// counts returns { tests, failed, skipped, failures, cases, mismatch } of text, or null when
// it has no testsuite element: failures has { name, file, key } of each failed testcase,
// cases has { key, state } of each testcase, and mismatch is null or its words.
function counts(raw) {
  const text = plain(raw);
  if (!/<testsuites?\b/.test(text)) return null;
  const out = { tests: 0, failed: 0, skipped: 0, failures: [], cases: [], mismatch: null };
  const found = testcases(text);
  for (const { attrs, body } of found) {
    out.tests += 1;
    let state = 'passed';
    if (/<(?:failure|error)\b/.test(body)) {
      state = 'failed';
      out.failed += 1;
      out.failures.push({ name: attrs.name || attrs.classname || '', file: attrs.file || null,
        key: key(attrs) });
    } else if (/<skipped\b/.test(body)) {
      state = 'skipped';
      out.skipped += 1;
    }
    out.cases.push({ key: key(attrs), state });
  }
  out.mismatch = mismatch(text, out, found);
  return out;
}

module.exports = { counts };
