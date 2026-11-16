// The lists of a short path: the kinds and the sensitive areas of short-path.json in this
// skill's folder, each area with its name and the file patterns of its files, the changes
// that a repository makes to them, and the match of a file against the patterns.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const { isObject, jsonKind, Missing, quote, readFile } = lib;

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
  // A pattern that no path of a file matches is refused: one that starts with / or ./, ends
  // with /, or has [ or ], which areaOf would read as the characters themselves.
  function globRegExp(pattern) {
    if (typeof pattern !== 'string' || !pattern) throw new Error('it is empty');
    if (pattern.startsWith('/')) throw new Error('it starts with /');
    if (pattern.startsWith('./')) throw new Error('it starts with ./');
    if (pattern.endsWith('/')) throw new Error('it ends with /: write <folder>/** for its files');
    if (/[[\]]/.test(pattern)) throw new Error('it has [ or ], which no pattern supports');
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

  // plainRef returns a ref of sources.json as a path from the repository root: each \ a /,
  // each run of / one /, and a leading / or ./ left out, again and again.
  function plainRef(ref) {
    let plain = ref.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    while (/^\.?\//.test(plain)) plain = plain.replace(/^\.?\//, '');
    return plain;
  }

  // areaOf returns the first area of areas, and its first pattern, that file matches, as
  // { name, pattern }, or null. file is a ref of sources.json, which plainRef reads. A ref may
  // be a folder, such as `db/migrations` or `src/billing/`: so file is in an area also when a
  // file x right under it matches, as `db/migrations/x` matches `**/migrations/**`.
  function areaOf(file, areas) {
    const plain = plainRef(file).replace(/\/$/, '');
    const paths = [plain, `${plain}/x`];
    for (const area of areas) {
      const found = area.patterns.find((pattern) => {
        const glob = globRegExp(pattern);
        return paths.some((one) => glob.test(one));
      });
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
    return { kinds: data.kinds, areas: data.sensitive_areas, removedKinds: [] };
  }

  const MODULE = moduleLists();

  // The harness report of the compose, under the working folder, and the keys of the changes
  // that a repository makes under extensions.software-factory of its qory.yaml, which the
  // compose copies into the report.
  const REPORT = path.join('.qory', 'harness-report.json');
  const KEYS = ['remove_kinds', 'remove_sensitive_areas', 'add_sensitive_areas'];
  const FIX = 'Fix harness.extensions.software-factory in qory.yaml';

  // names returns the texts of the list key of changes, each of which known has, or throws
  // the fix. A key that is not set is an empty list; null is no list.
  function names(changes, key, known, what) {
    const list = Object.hasOwn(changes, key) ? changes[key] : [];
    if (!Array.isArray(list)) {
      throw new Missing(`${FIX}: write ${key} as a list, not ${jsonKind(list)}.`);
    }
    for (const name of list) {
      if (typeof name !== 'string' || !known.includes(name)) {
        const shown = typeof name === 'string' ? quote(name) : jsonKind(name);
        throw new Missing(`${FIX}: ${key} has ${shown}, which is no ${what} of ` +
          'short-path.json. Write each name as short-path.json writes it.');
      }
    }
    return list;
  }

  // shortPathLists returns the kinds and the areas of a short path for the working folder:
  // the lists of short-path.json, changed by extensions.software-factory of the harness
  // report in the working folder. remove_kinds removes kinds and remove_sensitive_areas
  // removes areas, each by a name of short-path.json; add_sensitive_areas adds areas in the
  // form of short-path.json, after those that stay. An added area with the name of an area
  // that stays is refused, so that a repository replaces the patterns of an area by removing
  // it and adding an area of that name with other patterns. No key adds a kind. With no working folder, no report, no
  // extensions or no key software-factory, the lists of short-path.json apply. Any other form
  // throws the fix.
  function shortPathLists(workingFolder) {
    if (!workingFolder) return MODULE;
    const file = path.join(workingFolder, REPORT);
    if (!fs.existsSync(file)) return MODULE;
    let data;
    try {
      data = JSON.parse(readFile(file, REPORT));
    } catch (error) {
      if (error instanceof Missing) throw error;
      throw new Missing(`Compose the harness again: ${REPORT} is no valid JSON.`);
    }
    if (!isObject(data)) throw new Missing(`Compose the harness again: ${REPORT} is no object.`);
    if (data.extensions === undefined) return MODULE;
    if (!isObject(data.extensions)) {
      throw new Missing(`Fix harness.extensions in qory.yaml: write it as a map, not ` +
        `${jsonKind(data.extensions)}.`);
    }
    const changes = data.extensions['software-factory'];
    if (changes === undefined) return MODULE;
    if (!isObject(changes)) {
      throw new Missing(`${FIX}: write it as a map, not ${jsonKind(changes)}.`);
    }
    const other = Object.keys(changes).find((key) => !KEYS.includes(key));
    if (other !== undefined) {
      throw new Missing(`${FIX}: remove the key ${quote(other)}. The keys are remove_kinds, ` +
        'remove_sensitive_areas and add_sensitive_areas.');
    }
    const removedKinds = names(changes, 'remove_kinds', MODULE.kinds, 'kind');
    const removedAreas = names(changes, 'remove_sensitive_areas',
      MODULE.areas.map((area) => area.name), 'sensitive area');
    const kept = MODULE.areas.filter((area) => !removedAreas.includes(area.name));
    const added = Object.hasOwn(changes, 'add_sensitive_areas')
      ? changes.add_sensitive_areas
      : [];
    if (!Array.isArray(added)) {
      throw new Missing(`${FIX}: write add_sensitive_areas as a list, not ${jsonKind(added)}.`);
    }
    const key = (area) => area.name.trim().toLowerCase();
    const stays = new Set(kept.map(key));
    const taken = new Set();
    added.forEach((area, at) => {
      const why = areaForm(area);
      if (why) {
        throw new Missing(`${FIX}: write area ${at + 1} of add_sensitive_areas as { name, ` +
          `patterns }: ${why}.`);
      }
      if (stays.has(key(area))) {
        throw new Missing(`${FIX}: add ${quote(area.name)} to remove_sensitive_areas first, or ` +
          'give the added area another name: short-path.json has an area of that name.');
      }
      if (taken.has(key(area))) {
        throw new Missing(`${FIX}: give area ${at + 1} of add_sensitive_areas another name: ` +
          `an earlier added area has the name ${quote(area.name)}.`);
      }
      taken.add(key(area));
    });
    return {
      kinds: MODULE.kinds.filter((kind) => !removedKinds.includes(kind)),
      areas: [...kept, ...added],
      removedKinds,
    };
  }

  return { SHORT_PATH: MODULE, areaForm, areaOf, globRegExp, shortPathLists };
};
