// The lists of a short path: the kinds and the sensitive areas of short-path.json in this
// skill's folder, each area with its name and the file patterns of its files, and the match
// of a file against the patterns.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const { isObject, jsonKind, quote } = lib;

  // A control character, which no name or pattern of an area contains.
  const CONTROL = /[\u0000-\u001f\u007f]/;

  const FILE = path.join(__dirname, '..', 'short-path.json');

  // globRegExp returns the regular expression of a file pattern, a glob from the repository
  // root, or throws an Error with the reason that the pattern cannot be read:
  // - `**` as a whole part between slashes, at the start or in the middle, matches any number
  //   of folders, none included; at the end, after a slash, it matches any path below;
  // - `*` matches any characters except a slash, and `?` one such character, a dot included;
  // - `{a,b}` matches one of its alternatives, which have no braces and no `**`;
  // - any other character matches itself.
  // It matches a path without regard to case, so that `Auth/` is in the area of `**/auth/**`.
  function globRegExp(pattern) {
    if (typeof pattern !== 'string' || !pattern) throw new Error('it is empty');
    if (pattern.startsWith('/')) throw new Error('it starts with /');
    let out = '';
    let brace = false;
    for (let at = 0; at < pattern.length; at += 1) {
      const char = pattern[at];
      if (char === '*' && pattern[at + 1] === '*') {
        const whole = (at === 0 || pattern[at - 1] === '/') &&
          (at + 2 === pattern.length || pattern[at + 2] === '/');
        if (!whole || brace) throw new Error('it has ** that is not a whole part between slashes');
        if (at + 2 === pattern.length) {
          out += '.+';
          at += 1;
        } else {
          out += '(?:[^/]*/)*';
          at += 2;
        }
      } else if (char === '*') {
        out += '[^/]*';
      } else if (char === '?') {
        out += '[^/]';
      } else if (char === '{') {
        if (brace) throw new Error('it has a brace inside braces');
        brace = true;
        out += '(?:';
      } else if (char === '}') {
        if (!brace) throw new Error('it has } with no { before it');
        brace = false;
        out += ')';
      } else if (char === ',' && brace) {
        out += '|';
      } else {
        out += char.replace(/[\\^$.|+()[\]{}]/, '\\$&');
      }
    }
    if (brace) throw new Error('it has { with no } after it');
    return new RegExp(`^${out}$`, 'i');
  }

  // areaOf returns the first area of areas, and its first pattern, that file matches, as
  // { name, pattern }, or null. file is a path from the repository root; a leading ./ is
  // left out.
  function areaOf(file, areas) {
    const plain = file.replace(/^(?:\.\/)+/, '');
    for (const area of areas) {
      const found = area.patterns.find((pattern) => globRegExp(pattern).test(plain));
      if (found) return { name: area.name, pattern: found };
    }
    return null;
  }

  // areaForm returns why value is no area in the form of short-path.json, { name, patterns },
  // with a name and at least one pattern, each a string on one line, or null.
  function areaForm(value) {
    if (!isObject(value)) return `it is ${jsonKind(value)}, not an object`;
    const other = Object.keys(value).find((key) => !['name', 'patterns'].includes(key));
    if (other !== undefined) return `it has the key ${quote(other)}, besides name and patterns`;
    if (typeof value.name !== 'string' || !value.name.trim() || CONTROL.test(value.name)) {
      return 'it has no name: a text on one line';
    }
    if (!Array.isArray(value.patterns) || !value.patterns.length) {
      return `the area ${quote(value.name)} has no patterns: a list of at least one`;
    }
    for (const pattern of value.patterns) {
      if (typeof pattern !== 'string' || CONTROL.test(pattern)) {
        return `a pattern of ${quote(value.name)} is ${jsonKind(pattern)}, not a text on one line`;
      }
      try {
        globRegExp(pattern);
      } catch (error) {
        return `the pattern ${quote(pattern)} of ${quote(value.name)} cannot be read: ` +
          error.message;
      }
    }
    return null;
  }

  // moduleLists returns the kinds and the areas of short-path.json. A file in another form is
  // a fault of the module: the Error contains the file.
  function moduleLists() {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const why = !Array.isArray(data.kinds) || !data.kinds.every((kind) => typeof kind === 'string')
      ? 'kinds is no list of texts'
      : !Array.isArray(data.sensitive_areas) ? 'sensitive_areas is no list'
        : data.sensitive_areas.map(areaForm).find(Boolean);
    if (why) throw new Error(`Fix ${FILE}: ${why}.`);
    return { kinds: data.kinds, areas: data.sensitive_areas };
  }

  const MODULE = moduleLists();

  return { SHORT_PATH: MODULE, areaForm, areaOf, globRegExp };
};
