// The lists of the fast track: the id of the track, the kinds and the sensitive areas of
// short-path.json in this skill's folder, each area with its name and the file patterns of
// its files, the changes that a repository makes to them, and the match of a file against the
// patterns.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const { extensionsFix, factoryExtensions, isObject, jsonKind, Missing, quote } = lib;

  // A character that no name or pattern of an area contains: a control character (C0, C1 and
  // DEL), a line or paragraph separator, or a bidirectional control or mark, as
  // extensions.schema.json refuses them.
  const CONTROL =
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/;

  const FILE = path.join(__dirname, '..', 'short-path.json');

  // expansions returns each text that the braces of pattern give, such as a/x and b/x for
  // {a,b}/x, or throws an Error for braces that globRegExp cannot read or an empty
  // alternative.
  function expansions(pattern) {
    let out = [''];
    let at = 0;
    while (at < pattern.length) {
      const open = pattern.indexOf('{', at);
      const close = pattern.indexOf('}', at);
      if (close >= 0 && (open < 0 || close < open)) {
        throw new Error('it has } with no { before it');
      }
      if (open < 0) break;
      const end = pattern.indexOf('}', open);
      if (end < 0) throw new Error('it has { with no } after it');
      if (pattern.indexOf('{', open + 1) >= 0 && pattern.indexOf('{', open + 1) < end) {
        throw new Error('it has a brace inside braces');
      }
      const before = pattern.slice(at, open);
      const choices = pattern.slice(open + 1, end).split(',');
      if (choices.includes('')) throw new Error('it has an empty alternative in braces');
      out = out.flatMap((head) => choices.map((choice) => `${head}${before}${choice}`));
      at = end + 1;
    }
    return out.map((head) => `${head}${pattern.slice(at)}`);
  }

  // globRegExp returns the regular expression of a file pattern, a glob from the repository
  // root, or throws an Error with the reason that the pattern cannot be read:
  // - `**` as a whole part between slashes, at the start or in the middle, matches any number
  //   of folders, none included; at the end, after a slash, it matches any path below;
  // - `*` matches any characters except a slash, and `?` one such character, a dot included;
  // - `{a,b}` matches one of its alternatives, which have no braces and no `**`;
  // - any other character matches itself.
  // It matches a path without regard to case, so that `Auth/` is in the area of `**/auth/**`.
  // A pattern that no ref of a file matches once plainRef reads it is refused: one that starts
  // with / or ./, ends with /, has \, an empty part (//), a part . or .. (such as /./, /../ or
  // a leading ../), also in a path that its braces give, an empty alternative, or [ or ],
  // which areaOf would read as the characters themselves.
  function globRegExp(pattern) {
    if (typeof pattern !== 'string' || !pattern) throw new Error('it is empty');
    if (pattern.startsWith('/')) throw new Error('it starts with /');
    if (pattern.startsWith('./')) throw new Error('it starts with ./');
    if (pattern.endsWith('/')) throw new Error('it ends with /: write <folder>/** for its files');
    if (pattern.includes('\\')) throw new Error('it has \\');
    if (pattern.includes('//')) throw new Error('it has //');
    if (/[[\]]/.test(pattern)) throw new Error('it has [ or ], which no pattern supports');
    // Each path that the braces give is checked by its parts, so that {.,src}/auth/** or
    // {a/,b}/x is refused as ./auth/** and a//x are.
    for (const one of expansions(pattern)) {
      const parts = one.split('/');
      if (parts.includes('')) throw new Error('it has an alternative that leaves an empty part');
      if (parts.some((part) => part === '.' || part === '..')) {
        throw new Error('it has a part . or ..');
      }
    }
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
  // each part . left out, such as in .github/./dependabot.yml, each run of / one /, and a
  // leading / left out.
  function plainRef(ref) {
    return ref.replace(/\\/g, '/').replace(/(^|\/)\.(?=\/|$)/g, '$1').replace(/\/{2,}/g, '/')
      .replace(/^\//, '');
  }

  // folderRef reports whether a ref of sources.json is or may be a folder. sources.json and
  // the pulled artifacts contain no file, so push and end --offline cannot look the ref up:
  // every check reads only the ref. A ref names one file only when its last part has a name
  // and an extension, such as en.json or .env.production. A ref that ends with / or \, that
  // plainRef reads as nothing, or whose last part has no extension, such as src, .github or
  // Dockerfile, may be a folder, so the fast track refuses it.
  function folderRef(ref) {
    if (/[\\/]$/.test(ref)) return true;
    const last = plainRef(ref).split('/').pop();
    return !/^.+\.[^.]+$/.test(last);
  }

  // areaOf returns the first area of areas, and its first pattern, that file matches, as
  // { name, pattern }, or null. file is a ref of sources.json, which plainRef reads. The fast
  // track refuses a ref that may be a folder, as folderRef reads it, so only the ref itself
  // is matched.
  function areaOf(file, areas) {
    const plain = plainRef(file);
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

  // moduleLists returns the track id, the kinds and the areas of short-path.json. The track
  // id is one word in lower case, which a proposal writes with a capital first letter, such
  // as fast in "Fast track". A file in another form is a fault of the module: the Error
  // contains the file.
  function moduleLists() {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const why = typeof data.track !== 'string' || !/^[a-z][a-z0-9-]*$/.test(data.track)
      ? 'track is no id of one word in lower case'
      : !Array.isArray(data.kinds) || !data.kinds.every((kind) => typeof kind === 'string')
        ? 'kinds is no list of texts'
        : !Array.isArray(data.sensitive_areas) ? 'sensitive_areas is no list'
          : data.sensitive_areas.map(areaForm).find(Boolean);
    if (why) throw new Error(`Fix ${FILE}: ${why}.`);
    return { track: data.track, kinds: data.kinds, areas: data.sensitive_areas, removedKinds: [] };
  }

  const MODULE = moduleLists();

  // wrapped returns the names of known as lines of at most 150 characters, so that no line of a
  // finding is cut, with a comma after each name but the last.
  function wrapped(known) {
    const lines = [''];
    known.forEach((name, at) => {
      const piece = at < known.length - 1 ? `${name}, ` : name;
      if (lines[lines.length - 1] && lines[lines.length - 1].length + piece.length > 150) {
        lines.push('');
      }
      lines[lines.length - 1] += piece;
    });
    return lines.map((line) => line.trimEnd());
  }

  // names returns the texts of the list key of changes, each of which known has, and adds to
  // found the finding for each that it lacks. A key that is not set is an empty list.
  // factoryExtensions checked the shape.
  function names(changes, key, known, what, found) {
    const list = changes[key] || [];
    for (const name of list) {
      if (!known.includes(name)) {
        found.push(extensionsFix('remove the name not in short-path.json',
          `${key} has ${quote(name)}, which is not a ${what} in short-path.json.\n` +
          `Write each name exactly as one of:\n${wrapped(known).join('\n')}`));
      }
    }
    return list;
  }

  // trackLists returns the track id, the kinds and the areas of the fast track for the check
  // of context:
  // the lists of short-path.json, changed by the keys remove_kinds, remove_sensitive_areas and
  // add_sensitive_areas of factoryExtensions, which checks their shape first.
  // remove_kinds removes kinds and remove_sensitive_areas removes areas, each by a name of
  // short-path.json; add_sensitive_areas adds areas, after those that stay, each with a name
  // on one line and patterns that globRegExp reads. An added area with the name of an area
  // that stays is refused, so that a repository replaces the patterns of an area by removing
  // it and adding an area of that name with other patterns. No key adds a kind. Any other
  // value throws every finding, each with its fix on the first line.
  function trackLists(context) {
    const changes = factoryExtensions(context);
    const found = [];
    const removedKinds = names(changes, 'remove_kinds', MODULE.kinds, 'kind', found);
    const removedAreas = names(changes, 'remove_sensitive_areas',
      MODULE.areas.map((area) => area.name), 'sensitive area', found);
    if (!removedKinds.length && !removedAreas.length && !changes.add_sensitive_areas) {
      return MODULE;
    }
    const kept = MODULE.areas.filter((area) => !removedAreas.includes(area.name));
    const added = changes.add_sensitive_areas || [];
    const key = (area) => area.name.trim().toLowerCase();
    const stays = new Set(kept.map(key));
    const taken = new Set();
    added.forEach((area, at) => {
      const why = areaForm(area);
      if (why) {
        found.push(extensionsFix(`fix area ${at + 1} of add_sensitive_areas`,
          `In area ${at + 1} of add_sensitive_areas, ${why}`));
        return;
      }
      if (stays.has(key(area))) {
        found.push(extensionsFix(`rename area ${at + 1} of add_sensitive_areas`,
          `Area ${at + 1} of add_sensitive_areas has the name ${quote(area.name)}, which is ` +
          'already the name of an area in short-path.json. To replace that area, add the name ' +
          'to remove_sensitive_areas'));
      } else if (taken.has(key(area))) {
        found.push(extensionsFix(`rename area ${at + 1} of add_sensitive_areas`,
          `An earlier added area has the name ${quote(area.name)}`));
      }
      taken.add(key(area));
    });
    if (found.length) throw new Missing(found[0], found.slice(1), true);
    return {
      track: MODULE.track,
      kinds: MODULE.kinds.filter((kind) => !removedKinds.includes(kind)),
      areas: [...kept, ...added],
      removedKinds,
    };
  }

  return { TRACK_LISTS: MODULE, areaForm, areaOf, folderRef, globRegExp, trackLists };
};
