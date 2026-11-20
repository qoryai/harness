// shown and escaped of qory.yaml findings: a copy of core's lib/schema.cjs, because
// repository-settings.cjs loads without the library. shortcut: a test compares both copies.
'use strict';

const codePoints = (text) => [...text].length;

// The characters that JSON.stringify leaves as they are and that no finding may show.
const UNSHOWN = new RegExp('[\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069' +
  '\\u00AD\\u180E\\u200B\\u2060-\\u2064\\uFEFF\\uFFF9-\\uFFFB\\u2028\\u2029]', 'gu');

// escaped returns json with each character of UNSHOWN as its escape, such as \u202e.
const escaped = (json) => json.replace(UNSHOWN, (char) =>
  `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`);

// shown returns value as JSON.stringify writes it, cut to limit characters, with no escape cut.
function shown(value, limit = 40) {
  const json = escaped(JSON.stringify(value));
  const text = typeof value === 'string';
  const units = (text ? json.slice(1, -1) : json).match(/\\u[0-9a-f]{4}|\\.|[^]/gu) || [];
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
