// The numbers of a JSON text as written, which JSON.parse rounds: 34.0 and 34 are one number
// to it. scan lists each number token with its JSON pointer, in one pass over the text.
'use strict';

// The range of an integer of a delivered output: a 64-bit signed integer.
const MAX_INTEGER = 9223372036854775807n;
const MIN_INTEGER = -9223372036854775808n;

// The most levels that scan follows. A text that nests deeper gets the depth finding of
// lib/schema.cjs before any number rule, so scan lists nothing for it.
const MAX_LEVELS = 256;

// pointerKey returns key as a JSON pointer writes a member name: ~ as ~0 and / as ~1.
const pointerKey = (key) => key.replace(/~/g, '~0').replace(/\//g, '~1');

// scan returns a map from the JSON pointer of each number of text, which JSON.parse accepted,
// to its token. A repeated member counts once, as its last value, as JSON.parse reads it.
// The tree has one slot per member, so a repeated key replaces its slot in constant time.
function scan(text) {
  const open = [];
  let top = null;
  const attach = (node) => {
    const parent = open.at(-1);
    if (!parent) top = node;
    else if (parent.list) parent.kids[parent.index] = node;
    else parent.kids.set(parent.key, node);
  };
  let place = 0;
  while (place < text.length) {
    const char = text[place];
    if (/\s/.test(char) || char === ':') {
      place += 1;
    } else if (char === '{' || char === '[') {
      if (open.length >= MAX_LEVELS) return new Map();
      const list = char === '[';
      const node = { list, kids: list ? [] : new Map(), index: 0, key: '', wantKey: !list };
      attach(node);
      open.push(node);
      place += 1;
    } else if (char === '}' || char === ']') {
      open.pop();
      place += 1;
    } else if (char === ',') {
      const parent = open.at(-1);
      if (parent.list) parent.index += 1;
      else parent.wantKey = true;
      place += 1;
    } else if (char === '"') {
      let end = place + 1;
      while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      const parent = open.at(-1);
      if (parent && !parent.list && parent.wantKey) {
        parent.key = JSON.parse(text.slice(place, end + 1));
        parent.wantKey = false;
      } else {
        attach({});
      }
      place = end + 1;
    } else {
      let end = place;
      while (end < text.length && !/[\s,\]}]/.test(text[end])) end += 1;
      const token = text.slice(place, end);
      attach(['null', 'true', 'false'].includes(token) ? {} : { token });
      place = end;
    }
  }
  const numbers = new Map();
  const walk = [[top, '']];
  while (walk.length) {
    const [node, at] = walk.pop();
    if (!node) continue;
    if (node.token !== undefined) {
      numbers.set(at, node.token);
    } else if (node.kids) {
      const kids = node.list ? node.kids.map((kid, index) => [kid, `${at}/${index}`])
        : [...node.kids].map(([key, kid]) => [kid, `${at}/${pointerKey(key)}`]);
      walk.push(...kids.reverse());
    }
  }
  return numbers;
}

// integerFault returns why the number token, written for a whole number, is refused, or null:
// 'form' for a fraction or an exponent, such as 34.0 or 3E1, 'large' above MAX_INTEGER and
// 'small' below MIN_INTEGER.
function integerFault(token) {
  if (/[.eE]/.test(token)) return 'form';
  const value = BigInt(token);
  if (value > MAX_INTEGER) return 'large';
  return value < MIN_INTEGER ? 'small' : null;
}

module.exports = { MAX_INTEGER, MIN_INTEGER, integerFault, pointerKey, scan };
