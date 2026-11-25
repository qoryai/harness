// shown, for qory.yaml findings and the .git/info/exclude finding, and escaped: a copy of core's
// lib/schema.cjs, because repository-settings.cjs loads without the library. shortcut: a test
// compares both copies.
'use strict';

const codePoints = (text) => [...text].length;

// The characters that JSON.stringify leaves as they are and that no finding may show: each Cf
// (the bidirectional marks, joiners and tags among them), the C1 controls, DEL, U+2028, U+2029.
const UNSHOWN = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

// escaped returns json with each character of UNSHOWN as an escape: \u202e, or \u{e0041} above
// U+FFFF.
const escaped = (json) => json.replace(UNSHOWN, (char) => {
  const code = char.codePointAt(0);
  return code > 0xffff ? `\\u{${code.toString(16)}}`
    : `\\u${code.toString(16).padStart(4, '0')}`;
});

// shown returns value as JSON.stringify writes it, cut to limit characters, with no escape cut.
function shown(value, limit = 40) {
  const json = escaped(JSON.stringify(value));
  const text = typeof value === 'string';
  const body = text ? json.slice(1, -1) : json;
  const units = body.match(/\\u[0-9a-f]{4}|\\u\{[0-9a-f]+\}|\\.|[^]/gu) || [];
  const sizes = units.map((unit) => codePoints(unit));
  if (sizes.reduce((sum, one) => sum + one, 0) <= limit) return json;
  const kept = [];
  let size = 0;
  units.forEach((unit, place) => {
    size += sizes[place];
    if (size <= limit - 3) kept.push(unit);
  });
  const cutText = `${kept.join('')}...`;
  return text ? `"${cutText}"` : cutText;
}

module.exports = { escaped, shown };
