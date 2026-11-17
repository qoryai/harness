// The proof of the kind "a text that the product shows": the files are JSON translation files,
// and the commits change the wording of existing entries only. The proof, for each changed
// file:
// - the file is a translation file: it matches a file pattern of the kind in short-path.json,
//   where <lang> is the code of the language;
// - both commits have the file as a JSON object, with the same keys, each a text or the same
//   other value, at the start commit and at HEAD;
// - each entry with changed text has the same placeholders in the same number, by the
//   placeholder expressions of the kind in short-path.json;
// - each entry with changed text is in every language file of its group, the files at HEAD
//   whose path differs from the file's only in the code of the language, at HEAD.
'use strict';

const git = require('./git.js');
const { jsonLayout } = require('./layout.js');

// The code of a language in a pattern: two or three letters, and parts after - or _.
const LANG_CODE = '(?<lang>[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)';
const MARK = 'LANGMARK';
// The deepest nesting of a translation file that the proof reads.
const MOST_DEPTH = 64;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
// A changed text that has a link, markup, an entity or a template expression is no plain text: the
// kind never changes it. A placeholder such as {{name}} or {count} is no template expression.
const RISKY = new RegExp([String.raw`[a-z0-9+.-]://`, String.raw`(?:^|[\s(])//[a-z0-9]`,
  String.raw`\bwww\.`, String.raw`\b(?:mailto|javascript|data|tel):`, String.raw`<[a-z/!?]`,
  String.raw`&[a-z#0-9]+;`, String.raw`\$\{`, String.raw`\{%`, String.raw`%\}`, '<%', '%>',
  String.raw`\{#`, String.raw`#\}`, String.raw`\{\{(?!\s*[\w.]+\s*\}\})`].join('|'), 'iu');

module.exports = (lib) => {
  const { Missing, cut, globRegExp, quote } = lib;

  // langPatterns returns, for each file pattern of the kind, the regular expression that
  // matches a path and gives the place of the code of the language in its indices.
  function langPatterns(patterns) {
    return patterns.map((pattern) => new RegExp(
      globRegExp(pattern.replace('<lang>', MARK)).source.replace(MARK, LANG_CODE), 'idu'));
  }

  // groupOf returns { index, key } for file, the first pattern that matches and the path with
  // the code of the language left out, or null when no pattern matches.
  function groupOf(patterns, file) {
    for (let index = 0; index < patterns.length; index += 1) {
      const found = patterns[index].exec(file);
      if (found) {
        const [from, to] = found.indices.groups.lang;
        return { index, key: `${file.slice(0, from)}<lang>${file.slice(to)}` };
      }
    }
    return null;
  }

  // flatten returns a Map of each entry of the JSON value: the key is the JSON text of its
  // path, and the value is { type, value, path }. An object or a list with no member is an
  // entry too, of the type "object" or "list", so that the keys of both commits are the same
  // only when the shape is.
  function flatten(value, path = [], out = new Map()) {
    if (path.length > MOST_DEPTH) throw new RangeError('too deep');
    const leaf = (type, content) => out.set(JSON.stringify(path), { type, value: content, path });
    if (Array.isArray(value)) {
      if (!value.length) leaf('list');
      value.forEach((item, at) => flatten(item, [...path, at], out));
    } else if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value);
      if (!keys.length) leaf('object');
      keys.forEach((key) => flatten(value[key], [...path, key], out));
    } else {
      leaf(value === null ? 'null' : typeof value, value);
    }
    return out;
  }

  // parse returns the entries of the bytes as flatten returns them, or { problem } with the
  // reason that they are no JSON object.
  function parse(bytes) {
    let data;
    try {
      data = JSON.parse(UTF8.decode(bytes).replace(/^\uFEFF/, ''));
    } catch (error) {
      return { problem: error instanceof TypeError ? 'it is not valid UTF-8'
        : `it is no valid JSON: ${cut(String(error.message), 60)}` };
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { problem: 'its top value is no object' };
    }
    try {
      return { entries: flatten(data) };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return { problem: `it nests deeper than ${MOST_DEPTH} levels`, deep: true };
    }
  }

  const dotted = (entry) => entry.path.join('.');

  // placeholders returns the placeholders of value, each match of the expression, the first
  // alternative that matches at a place taking it: the sorted list, and the list in text
  // order for the printf placeholders that no number or name marks, such as %s, whose
  // meaning is their place.
  function placeholders(expression, value) {
    const all = value.match(expression) || [];
    return {
      all,
      sorted: [...all].sort(),
      positional: all.filter((one) => /^%(?!\{)(?!\d+\$)/.test(one)),
    };
  }

  // samePlaceholders reports whether two values have the same placeholders.
  const samePlaceholders = (one, two) => one.sorted.join('\u0000') === two.sorted.join('\u0000') &&
    one.positional.join('\u0000') === two.positional.join('\u0000');

  // listed returns names for a line: the first two, then the count of the rest.
  function listed(names) {
    const shownNames = names.slice(0, 2).map((name) => quote(name)).join(', ');
    return names.length > 2 ? `${shownNames} and ${names.length - 2} more`
      : shownNames;
  }

  // productTextProof adds the findings of the kind to found, for the context ctx of lib/proof.js
  // and its helpers h.
  function productTextProof(ctx, found, h) {
    const kind = 'a text that the product shows';
    const data = ctx.lists.kindData[kind];
    const patterns = langPatterns(data.files);
    const expression = new RegExp(data.placeholders.map((one) => `(?:${one})`).join('|'), 'gu');
    for (const file of ctx.paths) {
      if (!groupOf(patterns, file)) {
        found.push(h.notOfKind(ctx, file, 'a translation file',
          `The kind ${quote(kind)} changes translation files only, and ` +
          `${quote(h.shown(ctx, file))} matches no file pattern of that kind in short-path.json.`));
      }
    }
    const changed = [];
    for (const change of ctx.net) {
      if (h.late(ctx, found)) return;
      const group = groupOf(patterns, change.file);
      if (!group || !h.regular(ctx, change, found)) continue;
      if (change.status !== 'M') {
        found.push(h.takeOut(ctx, change.file,
          `it is ${change.status === 'A' ? 'a new' : 'a deleted'} language file`,
          'The kind changes the wording of entries that exist at the start commit and at HEAD.'));
        continue;
      }
      const bytes = h.blobs(ctx, change, found);
      if (!bytes) continue;
      const read = { before: bytes.before.toString('utf8'), after: bytes.after.toString('utf8') };
      if (h.whitespace(read.before, read.after)) {
        found.push(h.whitespaceFinding(ctx, change.file));
        continue;
      }
      const before = parse(bytes.before);
      const after = parse(bytes.after);
      const bad = before.problem ? ['the start commit', before] : after.problem ? ['HEAD', after]
        : null;
      if (bad && bad[1].deep) {
        found.push(h.finding(h.fitted(h.shown(ctx, change.file),
          (name) => `Propose the standard track: ${name} nests too deeply.`),
        `At ${bad[0]}, ${bad[1].problem}.`));
        continue;
      }
      if (bad) {
        found.push(h.finding(h.fitted(h.shown(ctx, change.file),
          (name) => `Write ${name} as a JSON object at both commits.`),
        `At ${bad[0]}, ${bad[1].problem}.`));
        continue;
      }
      const already = found.length;
      const keys = entriesProblem(ctx, change, before.entries, after.entries, expression, found,
        h);
      if (found.length === already && jsonLayout(read.before) !== jsonLayout(read.after)) {
        found.push(h.takeOut(ctx, change.file, 'it changes white space outside the texts',
          'The kind changes the wording of entries, and the layout of the file, its white space ' +
            'and its other characters, stays as at the start commit.'));
        continue;
      }
      if (keys.length) changed.push({ change, group, keys });
    }
    missingEntries(ctx, found, changed, patterns, h);
  }

  // entriesProblem adds the findings of the entries of one file, and returns the keys of the
  // entries whose text changed, each as { key, entry }.
  function entriesProblem(ctx, change, before, after, expression, found, h) {
    const shownFile = h.shown(ctx, change.file);
    const added = [...after.keys()].filter((key) => !before.has(key));
    const removed = [...before.keys()].filter((key) => !after.has(key));
    if (added.length || removed.length) {
      const named = (keys, map) => keys.map((key) => dotted(map.get(key)));
      found.push(h.finding(h.fitted(shownFile,
        (name) => `Restore the keys of ${name} to those of the start commit.`),
      `The commits add ${listed(named(added, after)) || 'no key'} and remove ` +
      `${listed(named(removed, before)) || 'no key'}.`));
      return [];
    }
    const out = [];
    for (const [key, was] of before) {
      const now = after.get(key);
      if (was.type !== now.type) {
        found.push(h.finding(h.fitted(shownFile,
          (name) => `Restore the type of the entry ${quote(cut(dotted(was), 30))} in ${name}.`),
        `It is ${was.type} at the start commit and ${now.type} at HEAD.`));
      } else if (was.value !== now.value) {
        if (was.type !== 'string') {
          found.push(h.finding(h.fitted(shownFile,
            (name) => `Take the change to ${quote(cut(dotted(was), 30))} out of ${name}: ` +
              'it is no text.'),
          `The kind changes text only, and the entry is ${was.type}.`));
          continue;
        }
        if (RISKY.test(was.value) || RISKY.test(now.value)) {
          found.push(h.finding(h.fitted(shownFile,
            (name) => `Take the change to ${quote(cut(dotted(was), 30))} out of ${name}: it has a ` +
              'link or markup.'),
          'A changed text with a link, markup or a template expression on either side is no ' +
            'plain wording, and the kind never changes it.'));
          continue;
        }
        const one = placeholders(expression, was.value);
        const two = placeholders(expression, now.value);
        if (!samePlaceholders(one, two)) {
          found.push(h.finding(h.fitted(shownFile,
            (name) => `Restore the placeholders of ${quote(cut(dotted(was), 30))} in ${name}.`),
          `The start commit has ${one.all.map((item) => quote(item)).join(', ') || 'none'}, and ` +
          `HEAD has ${two.all.map((item) => quote(item)).join(', ') || 'none'}.`));
        } else {
          out.push({ key, entry: was });
        }
      }
    }
    return out;
  }

  // missingEntries adds a finding for each entry with changed text that a language file of
  // its group lacks at HEAD, or a file of the group that is no JSON object at HEAD.
  function missingEntries(ctx, found, changed, patterns, h) {
    if (!changed.length) return;
    const tree = git.names(git.ok(Missing, ctx.top, ['ls-tree', '-r', '-z', '--name-only',
      ctx.head], 'Run the proof again', { env: ctx.env, raw: true, timeout: h.left(ctx) }))
      .filter((one) => one.utf8).map((one) => one.text);
    const cache = new Map();
    const entriesOf = (file) => {
      if (!cache.has(file)) {
        const id = git.ok(Missing, ctx.top, ['rev-parse', `${ctx.head}:${file}`],
          'Run the proof again', { env: ctx.env, timeout: h.left(ctx) }).trim();
        cache.set(file, parse(h.blob(ctx, id) || Buffer.alloc(0)));
      }
      return cache.get(file);
    };
    for (const { change, group, keys } of changed) {
      const peers = tree.filter((file) => {
        const other = groupOf(patterns, file);
        return file !== change.file && other && other.index === group.index &&
          other.key === group.key;
      });
      for (const peer of peers) {
        const got = entriesOf(peer);
        if (got.problem) {
          found.push(h.finding(h.fitted(h.shown(ctx, peer),
            (name) => `Write ${name} as a JSON object at HEAD.`),
          `It is a language file of ${quote(h.shown(ctx, change.file))}: ${got.problem}.`));
          continue;
        }
        for (const { key, entry } of keys) {
          if (!got.entries.has(key)) {
            found.push(h.finding(h.fitted(h.shown(ctx, peer),
              (name) => `Add the entry ${quote(cut(dotted(entry), 30))} to ${name}, or take its ` +
                'change out.'),
            `The commits change that entry in ${quote(h.shown(ctx, change.file))}, and every ` +
            'language file of its group has each entry that a change touches.'));
          }
        }
      }
    }
  }

  return { productTextProof };
};
