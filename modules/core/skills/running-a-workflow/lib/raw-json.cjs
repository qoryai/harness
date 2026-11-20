// The numbers of a JSON text as written, which JSON.parse rounds: 34.0 and 34 are one number
// to it, and so are 9223372036854775807 and 9223372036854775808. scan reads the text once,
// skips the strings, and lists each number token with its JSON pointer, written as
// lib/schema.cjs writes the place of a value.
'use strict';

// The largest integer of a delivered output: 2^63 - 1, which a 64-bit signed integer holds.
const MAX_INTEGER = 9223372036854775807n;

// scan returns a map from the pointer of each number of text, which JSON.parse accepted, to
// its token. A member that an object repeats counts once, as its last value, as JSON.parse
// reads it. It reads with a list of open objects and lists, so that a deep text needs no
// recursion.
function scan(text) {
  const numbers = new Map();
  const open = [];
  const drop = (prefix) => {
    for (const key of [...numbers.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}/`)) numbers.delete(key);
    }
  };
  // The pointer of the value that starts next.
  const here = () => {
    const top = open.at(-1);
    if (!top) return '';
    return top.list ? `${top.at}/${top.index}` : `${top.at}/${top.key}`;
  };
  let place = 0;
  while (place < text.length) {
    const char = text[place];
    if (/\s/.test(char) || char === ':') {
      place += 1;
    } else if (char === '{' || char === '[') {
      open.push({ at: here(), list: char === '[', index: 0, key: '', keys: new Set(),
        wantKey: char === '{' });
      place += 1;
    } else if (char === '}' || char === ']') {
      open.pop();
      place += 1;
    } else if (char === ',') {
      const top = open.at(-1);
      if (top.list) top.index += 1;
      else top.wantKey = true;
      place += 1;
    } else if (char === '"') {
      let end = place + 1;
      while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      const top = open.at(-1);
      if (top && !top.list && top.wantKey) {
        top.key = JSON.parse(text.slice(place, end + 1));
        top.wantKey = false;
        if (top.keys.has(top.key)) drop(here());
        top.keys.add(top.key);
      }
      place = end + 1;
    } else {
      let end = place;
      while (end < text.length && !/[\s,\]}]/.test(text[end])) end += 1;
      const token = text.slice(place, end);
      if (!['null', 'true', 'false'].includes(token)) numbers.set(here(), token);
      place = end;
    }
  }
  return numbers;
}

// integerFault returns why the number token, written for a whole number, is refused, or null:
// 'form' for a fraction or an exponent, such as 34.0 or 3E1, and 'size' for a value above
// MAX_INTEGER.
function integerFault(token) {
  if (/[.eE]/.test(token)) return 'form';
  return BigInt(token) > MAX_INTEGER ? 'size' : null;
}

module.exports = { MAX_INTEGER, integerFault, scan };
