// The lists of the fast track: the id of the track, the kinds and the sensitive areas of
// short-path.json in this skill's folder, each area with its name and the file patterns of
// its files, the changes that a repository makes to them, and the match of a file against the
// patterns. kind_data of short-path.json has the data of the proofs of four kinds: the file
// patterns of a document, the file patterns and placeholders of a text that the product shows,
// the display positions of a text value in a code file, and the tables of a look-only change.
// trackLine reads the first line of ## Track of a proposal.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A character that no name or pattern of an area contains: the one rule of the characters of a
// string, as extensions.schema.json writes it.
const REFUSED = require('./refused.cjs');

module.exports = (lib) => {
  const {
    blank, extensionsFix, factoryExtensions, isObject, jsonKind, lines, Missing, quote, sections,
  } = lib;

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
    return new RegExp(`^${out}$`, 'iu');
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
    if (typeof value.name !== 'string' || !value.name.trim() || REFUSED.test(value.name)) {
      return 'it has no name: a text on one line';
    }
    if (!Array.isArray(value.patterns) || !value.patterns.length) {
      return `the area ${quote(value.name)} has no patterns: a list of at least one`;
    }
    for (const pattern of value.patterns) {
      if (typeof pattern !== 'string' || REFUSED.test(pattern)) {
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

  // The kinds whose proofs read data, with the members of their entry in kind_data. A pattern
  // of a translation file has <lang> once, where the code of the language is.
  const KIND_DATA = {
    'a document': ['files', 'exclude'],
    'a text that the product shows': ['files', 'placeholders'],
    'a text value in a code file': ['attributes', 'props', 'javascript', 'python'],
    'a look-only change': ['token_files', 'token_types', 'properties', 'variable_words',
      'tailwind'],
  };
  const LANG = '<lang>';

  // listOfTexts returns why value is no list of texts on one line, with at least min of them,
  // or null.
  const listOfTexts = (value, min = 1) => (!Array.isArray(value) || value.length < min ||
    !value.every((item) => typeof item === 'string' && !REFUSED.test(item))
    ? 'is no list of texts on one line' : null);

  // filePatterns returns why the list of file patterns cannot be read by globRegExp, with
  // <lang> in each pattern wants times, or null.
  function filePatterns(list, wants) {
    const why = listOfTexts(list);
    if (why) return why;
    for (const item of list) {
      const count = item.split(LANG).length - 1;
      if (!item || count !== wants) {
        return `has the pattern ${quote(item)}, with ${LANG} ${count} times, not ${wants}`;
      }
      try {
        globRegExp(item);
      } catch (error) {
        return `has the pattern ${quote(item)}, which cannot be read: ${error.message}`;
      }
    }
    return null;
  }

  // tailwindForm returns why value is no table of Tailwind classes, or null: lists of values,
  // and utilities, each a prefix, the values (a list, or the name of a list), the property that
  // the class sets and, optionally, opacity and negative as true.
  function tailwindForm(value) {
    if (!isObject(value)) return 'is no object';
    const lists = Object.keys(value).filter((key) => key !== 'utilities');
    for (const key of lists) {
      if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === 'string')) {
        return `has ${quote(key)}, which is no list of texts`;
      }
    }
    if (!Array.isArray(value.utilities) || !value.utilities.length) return 'has no utilities';
    for (const row of value.utilities) {
      if (!isObject(row) || typeof row.prefix !== 'string' || !row.prefix ||
        typeof row.property !== 'string' || !row.property ||
        Object.keys(row).some((key) => !['prefix', 'values', 'property', 'opacity', 'negative']
          .includes(key))) {
        return 'has a utility with no prefix and property, or with another member';
      }
      const known = row.values === 'colors' || (typeof row.values === 'string' &&
        Array.isArray(value[row.values])) || (Array.isArray(row.values) &&
        row.values.every((item) => typeof item === 'string'));
      if (!known) return `has the utility ${quote(row.prefix)} with values that name no list`;
    }
    return null;
  }

  // lookForm returns why the entry of a look-only change is in no form that the proof reads, or
  // null.
  function lookForm(entry) {
    const files = filePatterns(entry.token_files, 0);
    if (files) return `token_files ${files}`;
    const types = listOfTexts(entry.token_types);
    if (types) return `token_types ${types}`;
    if (!isObject(entry.properties) || !Object.values(entry.properties)
      .every((list) => !listOfTexts(list))) return 'properties is no object of lists of texts';
    if (!isObject(entry.variable_words) || !Object.values(entry.variable_words)
      .every((word) => typeof word === 'string')) return 'variable_words is no object of texts';
    const table = tailwindForm(entry.tailwind);
    return table ? `tailwind ${table}` : null;
  }

  // The members of the entry of a language in the data of a text value in a code file, each an
  // object from the name of a callee to the index of its text argument, or to null.
  const CALL_TABLES = ['output_calls', 'error_calls', 'i18n_calls'];
  // A name of a callee: names joined by dots, "a.*" for any one name after "a.", or "*Part" for a
  // name whose last part ends with Part.
  const CALLEE = /^(?:\*[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\.\*)?)$/;

  // displayForm returns why entry, the data of the kind "a text value in a code file", is in no
  // form that the proofs read (lib/display-positions.cjs), or null.
  function displayForm(entry) {
    for (const key of ['attributes', 'props']) {
      const why = listOfTexts(entry[key]) || (entry[key]
        .every((name) => /^[A-Za-z][\w:-]*$/.test(name))
        ? null : 'has a name that is no name of an attribute');
      if (why) return `${key} ${why}`;
    }
    for (const language of ['javascript', 'python']) {
      const calls = entry[language];
      if (!isObject(calls)) return `${language} is ${jsonKind(calls)}, not an object`;
      const other = Object.keys(calls).find((key) => !CALL_TABLES.includes(key));
      if (other !== undefined) return `${language} has the key ${quote(other)}`;
      for (const table of CALL_TABLES) {
        if (!isObject(calls[table])) return `${language} has no ${table}, an object`;
        for (const [name, index] of Object.entries(calls[table])) {
          if (!CALLEE.test(name)) {
            return `${language} ${table} has the name ${quote(name)}, no callee`;
          }
          if (index !== null && !(Number.isInteger(index) && index >= 0 && index <= 9)) {
            return `${language} ${table} has for ${quote(name)} no index from 0 to 9, or null`;
          }
        }
      }
    }
    return null;
  }

  // kindDataForm returns why value, the kind_data of short-path.json for the kinds in kinds, is
  // in no form that the proofs read, or null. Each kind of KIND_DATA has an entry with its
  // members and no other; files is a list of file patterns that globRegExp reads, one line
  // each, and for a text that the product shows each has <lang> once; placeholders is a list
  // of regular expressions that compile and match no empty text.
  function kindDataForm(value, kinds) {
    if (!isObject(value)) return `kind_data is ${jsonKind(value)}, not an object`;
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(KIND_DATA, key)) {
        return `kind_data has the key ${quote(key)}, a kind with no data`;
      }
    }
    for (const [kind, members] of Object.entries(KIND_DATA)) {
      if (!kinds.includes(kind)) continue;
      const entry = value[kind];
      if (!isObject(entry)) return `kind_data has no entry for ${quote(kind)}`;
      const other = Object.keys(entry).find((key) => !members.includes(key));
      if (other !== undefined) return `the entry ${quote(kind)} has the key ${quote(other)}`;
      const missing = members.find((key) => entry[key] === undefined);
      if (missing) return `the entry ${quote(kind)} has no ${missing}`;
      let why = null;
      if (kind === 'a document') {
        why = filePatterns(entry.files, 0) || (filePatterns(entry.exclude, 0) &&
          `has exclude that ${filePatterns(entry.exclude, 0)}`);
      } else if (kind === 'a text that the product shows') {
        why = filePatterns(entry.files, 1);
        for (const item of why ? [] : entry.placeholders) {
          try {
            if (new RegExp(item, 'u').test('')) throw new Error('it matches the empty text');
          } catch (error) {
            why = `has the placeholder ${quote(item)}, no regular expression for a non-empty ` +
              `text: ${error.message}`;
            break;
          }
        }
        why = why || listOfTexts(entry.placeholders);
      } else if (kind === 'a text value in a code file') {
        why = displayForm(entry);
      } else {
        why = lookForm(entry);
      }
      if (why) return `the entry ${quote(kind)} ${why}`;
    }
    return null;
  }

  // moduleLists returns the track id, the kinds, the areas and the kind data of
  // short-path.json. The track id is one word in lower case, which a proposal writes with a
  // capital first letter, such as fast in "Fast track". A file in another form is a fault of
  // the module: the Error contains the file.
  function moduleLists() {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const why = typeof data.track !== 'string' || !/^[a-z][a-z0-9-]*$/.test(data.track)
      ? 'track is no id of one word in lower case'
      : !Array.isArray(data.kinds) || !data.kinds.every((kind) => typeof kind === 'string')
        ? 'kinds is no list of texts'
        : !Array.isArray(data.sensitive_areas) ? 'sensitive_areas is no list'
          : kindDataForm(data.kind_data, data.kinds) ||
            data.sensitive_areas.map(areaForm).find(Boolean);
    if (why) throw new Error(`Fix ${FILE}: ${why}.`);
    return {
      track: data.track, kinds: data.kinds, areas: data.sensitive_areas,
      kindData: data.kind_data, removedKinds: [],
    };
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
      kindData: MODULE.kindData,
      removedKinds,
    };
  }

  // trackLine returns { id, rest, body } for the proposal text: id is the id of the track that
  // the first line of ## Track names, in lower case, such as fast for "Fast track"; rest is
  // what follows "<Name> track" on that line; body is the lines of the section that are not
  // blank or fenced, each trimmed. It returns null for a proposal with no ## Track, or one
  // whose first line starts with no track.
  function trackLine(text) {
    const part = sections(lines(text), 2).slice(1).find((one) => one.title === 'Track');
    if (!part) return null;
    const body = part.lines.filter((line) => !blank(line) && !line.fenced)
      .map((line) => line.text.trim());
    const named = /^([A-Za-z][A-Za-z0-9-]*) track(?=[.:])/.exec(body[0] || '');
    if (!named) return null;
    return { id: named[1].toLowerCase(), rest: body[0].slice(named[0].length), body };
  }

  return {
    TRACK_LISTS: MODULE, areaForm, areaOf, folderRef, globRegExp, trackLists, trackLine,
  };
};
