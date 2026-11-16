// The counts of a JUnit XML result file, the form that most test runners write: each
// testcase element is a test, with a failure or error element when it failed, and a skipped
// element when it did not run. It reads attributes by a pattern, not by a full XML parser,
// because the counts need only these elements.
'use strict';

const TESTCASE = /<testcase\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/>|>([\s\S]*?)<\/testcase\s*>)/g;
const ATTRIBUTE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };
const unescape = (text) => text.replace(/&(lt|gt|amp|quot|apos);/g, (all, name) => ENTITIES[name]);

function attributes(text) {
  const out = {};
  for (const match of text.matchAll(ATTRIBUTE)) {
    out[match[1]] = unescape(match[2] !== undefined ? match[2] : match[3]);
  }
  return out;
}

// counts returns { tests, failed, skipped, failures }, where failures lists each failed test
// as { name, file }, file being the file attribute, or null. It returns null for text with
// no testsuite or testsuites element, which is no JUnit XML.
function counts(text) {
  if (!/<testsuites?\b/.test(text)) return null;
  const out = { tests: 0, failed: 0, skipped: 0, failures: [] };
  for (const match of text.matchAll(TESTCASE)) {
    const attrs = attributes(match[1]);
    const body = match[3] || '';
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
