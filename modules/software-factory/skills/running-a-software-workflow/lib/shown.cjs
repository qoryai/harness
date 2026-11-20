// The text of a value in a finding of qory.yaml: shown and escaped.
// shortcut: a copy of the same two functions of core's lib/schema.cjs, because
// repository-settings.cjs loads without the library, which holds that file; replace the
// copy when that file takes the library, and change both together until then.
'use strict';

const codePoints = (text) => [...text].length;

// The characters that JSON.stringify leaves as they are and that no text of a finding may
// have: the controls of C1 and DEL, and the refused characters of core (lib/base.cjs,
// REFUSED_SET): the bidirectional marks and controls, the invisible characters, and the line
// and paragraph separators.
const UNSHOWN = new RegExp('[\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069' +
  '\\u00AD\\u180E\\u200B\\u2060-\\u2064\\uFEFF\\uFFF9-\\uFFFB\\u2028\\u2029]', 'gu');

// escaped returns json, as JSON.stringify wrote it, with each character of UNSHOWN as its
// escape, such as ‮.
const escaped = (json) => json.replace(UNSHOWN, (char) =>
  `\\u${char.codePointAt(0).toString(16).padStart(4, '0')}`);

// shown returns a value for a finding as JSON.stringify writes it, cut to limit characters, 40
// by default, as written: a control character or a refused character counts as its escape,
// such as \u0002, and a list or an object is cut too. Text keeps its quotes. No escape is cut in
// two.
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
