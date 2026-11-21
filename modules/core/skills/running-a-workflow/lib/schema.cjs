// The check of a JSON document against a JSON Schema, for the type of any module. It throws for a
// keyword or form that it does not read, so that no schema it would misread passes a document.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { MAX_INTEGER, MIN_INTEGER, integerFault, pointerKey, scan } = require('./raw-json.cjs');

// The keywords that the check applies, and those that only describe.
const APPLIED = new Set([
  'type', 'required', 'additionalProperties', 'properties', 'enum', 'const', 'pattern',
  'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'uniqueItems', 'items',
  '$ref', 'oneOf', 'allOf', 'if', 'then', 'not',
]);
// format is an annotation in JSON Schema 2020-12: Qory Apiary and this check assert no format.
// x-qory-fill marks a member that qory fills, which outbox.cjs reads; it asserts nothing.
const NOTES = new Set([
  '$schema', '$id', 'title', 'description', 'format', '$defs', 'x-qory-fill',
]);

const WORDS = {
  object: 'an object', array: 'a list', string: 'text', integer: 'a whole number',
  number: 'a number', boolean: 'true or false', null: 'null',
};

// entryCount and characterCount return count with the word entry or character, in the plural
// for any count but 1.
const entryCount = (count) => `${count} ${count === 1 ? 'entry' : 'entries'}`;
const characterCount = (count) => `${count} ${count === 1 ? 'character' : 'characters'}`;

// kind returns the JSON Schema type of a parsed JSON value.
function kind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

const codePoints = (text) => [...text].length;

// clip returns text cut to size characters, the last 3 of them "...", so that the line of a
// finding with a long list of values or a long pattern stays at most 200 characters.
const clip = (text, size) => (codePoints(text) > size ? `${[...text].slice(0, size - 3).join('')}...`
  : text);

// The most characters of a JSON pointer on the first line of a finding, and of a member name
// in quotes there: with a file name of up to 20 characters, the fix stays within 100.
const POINTER = 28;
const MEMBER = 20;

// brief returns text, or its start and its end with ... between them when it has more than
// size characters, as short of core (lib/base.cjs) does, so that the end of a JSON pointer, the
// member, stays on the first line.
function brief(text, size) {
  const chars = [...text];
  if (chars.length <= size) return text;
  const head = Math.ceil((size - 3) / 2);
  return `${chars.slice(0, head).join('')}...${chars.slice(head - size + 3).join('')}`;
}

// The most levels of objects and lists that a document may nest: the readers of a document
// recurse once per level, so 64 keeps them far from the limit of the call stack.
const MAX_DEPTH = 64;

// deepAt returns the first list or object nested more than MAX_DEPTH levels deep, as { node, at },
// at being its JSON pointer with each key escaped. It walks with a list, so that a document of
// any depth gives no stack overflow, and returns null when value nests no deeper.
function deepAt(value) {
  const nested = (node) => node !== null && typeof node === 'object';
  const open = nested(value) ? [{ node: value, level: 1, parent: null, key: '' }] : [];
  while (open.length) {
    const entry = open.pop();
    if (entry.level > MAX_DEPTH) {
      const keys = [];
      for (let at = entry; at.parent; at = at.parent) keys.push(at.key);
      const escape = (key) => shown(pointerKey(key), Infinity)
        .slice(1, -1);
      return { node: entry.node, at: keys.reverse().map((key) => `/${escape(key)}`).join('') };
    }
    const keys = Object.keys(entry.node);
    for (let place = keys.length - 1; place >= 0; place -= 1) {
      const child = entry.node[keys[place]];
      if (nested(child)) {
        open.push({ node: child, level: entry.level + 1, parent: entry, key: keys[place] });
      }
    }
  }
  return null;
}

// depthLine returns the line after the fix for value when it nests more than MAX_DEPTH levels
// deep, such as "The list at /0/0/0 is 65 levels deep.", or null when it nests no deeper.
function depthLine(value) {
  const deep = deepAt(value);
  if (!deep) return null;
  return `The ${Array.isArray(deep.node) ? 'list' : 'object'} at ${brief(deep.at, POINTER)} ` +
    `is ${MAX_DEPTH + 1} levels deep.`;
}

// canonical returns value as JSON with the members of each object in sorted order, so that two
// values that JSON Schema counts as equal, as uniqueItems compares them, give the same text.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// scalar is true for a JSON value that === compares as JSON Schema does.
const scalar = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

// The keywords whose value the check reads in one form only. JSON Schema allows more forms,
// such as a list of types or a schema as additionalProperties, and errors would apply them
// wrongly, so compile throws for each other form.
const FORMS = {
  type: {
    accepts: (value) => typeof value === 'string' && Object.hasOwn(WORDS, value),
    text: 'one type name',
  },
  additionalProperties: { accepts: (value) => typeof value === 'boolean', text: 'true or false' },
  enum: {
    accepts: (value) => Array.isArray(value) && value.every(scalar),
    text: 'a list of text, numbers, true, false or null',
  },
  const: { accepts: scalar, text: 'text, a number, true, false or null' },
  uniqueItems: { accepts: (value) => value === true, text: 'true' },
};

// compile checks that each keyword of schema is one that this check reads, in a form that it
// reads, and compiles each pattern with the u flag. It returns the patterns by their source.
function compile(schema, file) {
  const patterns = new Map();
  const walk = (node, where) => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      throw new Error(`Fix ${path.basename(file)}.\n${where} of ${file} is no schema object.`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (!APPLIED.has(key) && !NOTES.has(key)) {
        throw new Error(`Fix ${path.basename(file)}.\nThe keyword ${key} at ${where} of ${file} ` +
          'is one that lib/schema.cjs does not check.');
      }
      const form = Object.hasOwn(FORMS, key) ? FORMS[key] : null;
      if (form && !form.accepts(value)) {
        throw new Error(`Fix ${path.basename(file)}.\nWrite ${key} at ${where} of ${file} as ` +
          `${form.text}, the only form that lib/schema.cjs checks.`);
      }
      if (key === 'pattern') patterns.set(value, new RegExp(value, 'u'));
      if (key === '$defs' || key === 'properties') {
        for (const [name, sub] of Object.entries(value)) walk(sub, `${where}/${key}/${name}`);
      } else if (['items', 'not', 'if', 'then'].includes(key)) {
        walk(value, `${where}/${key}`);
      } else if (key === 'oneOf' || key === 'allOf') {
        value.forEach((sub, place) => walk(sub, `${where}/${key}/${place}`));
      }
    }
  };
  walk(schema, '#');
  return patterns;
}

// inlineExternal returns schema with each $ref to a definition of another schema, written as
// <$id>#/$defs/<name>, replaced by that definition, which it finds in a *.schema.json file of
// folder whose $id is the address. The definition may refer to others of its file by
// #/$defs/<name>; those are written out too. Where the $ref has other keywords beside it, they
// stay and the definition goes into their allOf. The check reads no address over a network.
function inlineExternal(schema, folder, file) {
  let ids = null;
  const find = (id) => {
    if (!ids) {
      ids = new Map();
      for (const name of fs.readdirSync(folder).filter((one) => one.endsWith('.schema.json'))) {
        const other = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
        if (typeof other.$id === 'string') ids.set(other.$id, other);
      }
    }
    return ids.get(id);
  };
  const fix = (reason) => new Error(`Fix ${path.basename(file)}.\n${reason}`);
  const write = (node, home, depth) => {
    if (Array.isArray(node)) return node.map((one) => write(one, home, depth));
    if (typeof node !== 'object' || node === null) return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = key === '$ref' ? value : write(value, home, depth);
    }
    if (typeof out.$ref !== 'string' || (!home && out.$ref.startsWith('#'))) return out;
    if (depth > 8) throw fix(`$ref ${out.$ref} of ${file} refers to itself without end.`);
    const [id, pointer] = out.$ref.startsWith('#') ? [null, out.$ref.slice(1)]
      : out.$ref.split('#');
    const other = id === null ? home : find(id);
    const match = /^\/\$defs\/([^/]+)$/.exec(pointer || '');
    if (!other || !match || !other.$defs || !Object.hasOwn(other.$defs, match[1])) {
      throw fix(`$ref ${out.$ref} of ${file} matches no definition of a file in ${folder}.`);
    }
    const { $ref, ...rest } = out;
    const definition = write(other.$defs[match[1]], other, depth + 1);
    if (!Object.keys(rest).length) return definition;
    return { ...rest, allOf: [...(rest.allOf || []), definition] };
  };
  return write(schema, null, 0);
}

// load reads <folder>/<type>.schema.json.
function load(folder, type) {
  const file = path.join(folder, `${type}.schema.json`);
  const schema = inlineExternal(JSON.parse(fs.readFileSync(file, 'utf8')), folder, file);
  return { file, schema, patterns: compile(schema, file) };
}

// A pattern of one list of characters, ^[^...]* or ^[^...]+, that a string fails by one character
// of the list.
const CHARACTER_LIST = /^\^\[\^[^\]]*\][*+]\$$/;

// refusedAt returns the first character of text that pattern, a CHARACTER_LIST, refuses, and its
// index, or null for another form of pattern or when no single character fails.
function refusedAt(text, pattern, regexp) {
  if (!CHARACTER_LIST.test(pattern)) return null;
  let index = 0;
  for (const char of text) {
    if (!regexp.test(char)) return { char, index };
    index += char.length;
  }
  return null;
}

// sentence returns text with a full stop, unless it ends with ..., which a cut leaves.
const sentence = (text) => (text.endsWith('...') ? text : `${text}.`);

// clipPattern returns pattern as visible writes it, cut to size characters, with no escape cut.
function clipPattern(pattern, size) {
  const text = visible(pattern);
  if (codePoints(text) <= size) return text;
  const kept = [];
  let length = 0;
  for (const unit of text.match(/\\u\{[0-9a-f]+\}|\\u[0-9a-f]{4}|\\.|[^]/gu)) {
    if (length + codePoints(unit) > size - 3) break;
    kept.push(unit);
    length += codePoints(unit);
  }
  return `${kept.join('')}...`;
}

// dropRepeated returns findings without a "Write ... so that it matches its pattern." whose place
// also has a "Remove U+XXXX from ..." finding: the code point is the cause of both.
function dropRepeated(findings) {
  const places = new Set(findings.map((one) => /^Remove U\+[0-9A-F]+ from (?:line \d+ of )?(.*)\.$/m
    .exec(one.split('\n')[0])).filter(Boolean).map((match) => match[1]));
  return findings.filter((one) => {
    const match = /^Write (.*) so that it matches its pattern\.$/.exec(one.split('\n')[0]);
    return !(match && places.has(match[1]));
  });
}

// nullPointers returns the JSON pointer of each null in value, which MAX_DEPTH bounds.
function nullPointers(value) {
  const found = [];
  const open = [[value, '']];
  while (open.length) {
    const [node, at] = open.pop();
    if (node === null) found.push(at);
    else if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        open.push([child, `${at}/${Array.isArray(node) ? key : pointerKey(key)}`]);
      }
    }
  }
  return found;
}

// errors returns the findings of value, the JSON of file, against the schema; def names an entry
// of $defs to check alone. extra.raw (scan of lib/raw-json.cjs) adds the rules of a delivered
// output; extra.mark(at) gets the pointer of a string before its pattern runs.
function errors(loaded, value, file, def, extra = {}) {
  const { raw = null, mark = null } = extra;
  const deep = depthLine(value);
  if (deep) return [`Cut the nesting of ${file} to ${MAX_DEPTH} levels.\n${deep}`];
  const { schema: root, patterns } = loaded;
  const out = [];
  const nulls = new Set();
  const resolve = (ref) => {
    const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(ref);
    if (!match || !root.$defs || !root.$defs[match[1]]) {
      throw new Error(`Fix ${path.basename(loaded.file)}.\n$ref ${ref} of ${loaded.file} ` +
        'matches no entry of $defs.');
    }
    return root.$defs[match[1]];
  };
  // typesOf returns the types that schema allows: its type, that of the entry of $defs it refers
  // to, the types of the members of oneOf and anyOf, or those of the first member of allOf.
  const typesOf = (schema, depth = 0) => {
    let one = schema;
    for (let hops = 0; one.type === undefined && one.$ref && hops < 8; hops += 1) {
      one = resolve(one.$ref);
    }
    if (one.type !== undefined) return new Set([one.type]);
    const out = new Set();
    if (depth >= 8) return out;
    for (const sub of [...(one.oneOf || []), ...(one.anyOf || [])]) {
      typesOf(sub, depth + 1).forEach((type) => out.add(type));
    }
    for (const sub of one.allOf || []) {
      const found = typesOf(sub, depth + 1);
      if (found.size) return found;
    }
    return out;
  };
  // top is false for a schema that applies to the node of another schema, such as a member of
  // allOf: the rules of raw run once for the node.
  const visit = (schema, node, at, found, top = true) => {
    if (schema.$ref) visit(resolve(schema.$ref), node, at, found, false);
    const pointer = brief(at, POINTER);
    const where = at ? `${pointer} of ${file}` : file;
    const whole = pointer === at ? '' : `\nThe whole JSON pointer is ${at}.`;
    // add adds the finding of fix, the words after the place, with cause on the next line.
    const add = (verb, fix, cause) => found.push(`${verb} ${where} ${fix}.` +
      `${cause ? `\n${cause}.` : ''}${whole}`);
    const actual = kind(node);
    if (raw && actual === 'null') nulls.add(at);
    if (raw && top && actual === 'null' && !typesOf(schema).has('null')) {
      add('Write', 'as a value other than null', 'A delivered output has no null');
      return;
    }
    const types = raw && top && raw.has(at) ? typesOf(schema) : new Set();
    if (types.has('number') && !Number.isFinite(Number(raw.get(at)))) {
      add('Write', 'as a finite number', `It is written ${clip(raw.get(at), 40)}`);
    }
    if (actual === 'integer' && types.has('integer') && !types.has('number')) {
      const token = raw.get(at);
      const fault = integerFault(token);
      if (fault === 'form') {
        add('Write', 'as a whole number with no fraction and no exponent',
          `It is written ${clip(token, 40)}`);
      } else if (fault === 'large') {
        add('Set', `to at most ${MAX_INTEGER}`, `It is ${clip(token, 40)}`);
      } else if (fault === 'small') {
        add('Set', `to at least ${MIN_INTEGER}`, `It is ${clip(token, 40)}`);
      }
    }
    if (schema.type) {
      const fits = schema.type === actual || (schema.type === 'number' && actual === 'integer');
      if (!fits) {
        add('Write', `as ${WORDS[schema.type]}`, `It is ${WORDS[actual]}`);
        return;
      }
    }
    if (schema.enum && !schema.enum.some((one) => one === node)) {
      add('Set', 'to a value that the schema lists',
        `The schema lists ${clip(schema.enum.join(', '), 120)}. It is ${shown(node)}`);
    }
    if (Object.hasOwn(schema, 'const') && schema.const !== node) {
      add('Set', `to ${shown(schema.const)}`, `It is ${shown(node)}`);
    }
    if (actual === 'string') {
      const count = codePoints(node);
      if (schema.minLength !== undefined && count < schema.minLength) {
        add('Write', `as text of at least ${characterCount(schema.minLength)}`, `It has ${count}`);
      }
      if (schema.maxLength !== undefined && count > schema.maxLength) {
        add('Cut', `to at most ${characterCount(schema.maxLength)}`, `It has ${count}`);
      }
      if (schema.pattern && mark) mark(at);
      if (schema.pattern && !patterns.get(schema.pattern).test(node)) {
        const refused = refusedAt(node, schema.pattern, patterns.get(schema.pattern));
        // The description is the cause only when it fits whole: 150 characters alone, 120
        // beside the value. Else the cause is the pattern.
        const rule = schema.description && schema.description.replace(/\.$/, '');
        const dump = `The pattern is ${clipPattern(schema.pattern, 120)}`;
        if (refused) {
          // The first refused character, with its line in a text of more than one line.
          const code = refused.char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
          const row = /[\r\n]/.test(node)
            ? ` line ${node.slice(0, refused.index).split(/\r\n|\n|\r/).length} of` : '';
          found.push(`Remove U+${code} from${row} ${where}.\n` +
            `${sentence(rule && codePoints(rule) <= 150 ? rule : dump)}${whole}`);
        } else {
          add('Write', 'so that it matches its pattern',
            `${sentence(rule && codePoints(rule) <= 120 ? rule : dump)} It is ${shown(node)}`);
        }
      }
    }
    if (actual === 'integer' || actual === 'number') {
      if (schema.minimum !== undefined && node < schema.minimum) {
        add('Set', `to at least ${schema.minimum}`, `It is ${node}`);
      }
      if (schema.maximum !== undefined && node > schema.maximum) {
        add('Set', `to at most ${schema.maximum}`, `It is ${node}`);
      }
    }
    if (actual === 'array') {
      if (schema.minItems !== undefined && node.length < schema.minItems) {
        add('Give', `at least ${entryCount(schema.minItems)}`, `It has ${node.length}`);
      }
      if (schema.maxItems !== undefined && node.length > schema.maxItems) {
        add('Cut', `to at most ${entryCount(schema.maxItems)}`, `It has ${node.length}`);
      }
      if (schema.uniqueItems) {
        const seen = new Set();
        const twice = node.find((item) => {
          const key = canonical(item);
          return seen.has(key) || !seen.add(key);
        });
        if (twice !== undefined) add('Give', 'each entry once', `${shown(twice)} is there twice`);
      }
      if (schema.items) {
        node.forEach((item, place) => visit(schema.items, item, `${at}/${place}`, found));
      }
    }
    if (actual === 'object') {
      for (const key of schema.required || []) {
        if (!Object.hasOwn(node, key)) found.push(`Add the member ${key} to ${where}.${whole}`);
      }
      const properties = schema.properties || {};
      for (const [key, member] of Object.entries(node)) {
        if (Object.hasOwn(properties, key)) {
          visit(properties[key], member, `${at}/${pointerKey(key)}`, found);
        } else if (schema.additionalProperties === false) {
          const name = shown(key, MEMBER);
          found.push(`Remove the member ${name} from ${where}.\nThe schema has no ` +
            `${name === shown(key) ? 'such member' : `member ${shown(key)}`}.${whole}`);
        }
      }
    }
    for (const sub of schema.allOf || []) visit(sub, node, at, found, false);
    if (schema.if) {
      const trial = [];
      visit(schema.if, node, at, trial, false);
      if (!trial.length && schema.then) visit(schema.then, node, at, found, false);
    }
    if (schema.oneOf) {
      const fits = schema.oneOf.filter((sub) => {
        const trial = [];
        visit(sub, node, at, trial, false);
        return !trial.length;
      }).length;
      if (fits !== 1) {
        add('Write', `in exactly one of its ${schema.oneOf.length} forms`, `It fits ${fits}`);
      }
    }
    if (schema.not) {
      const trial = [];
      visit(schema.not, node, at, trial, false);
      if (!trial.length) add('Write', 'in another form', `The schema excludes ${shown(node)}`);
    }
  };
  visit(def ? resolve(`#/$defs/${def}`) : root, value, '', out);
  // A null that no schema was applied to, such as a member that the schema does not list.
  if (raw) {
    for (const at of nullPointers(value).filter((one) => !nulls.has(one))) {
      const pointer = brief(at, POINTER);
      const whole = pointer === at ? '' : `\nThe whole JSON pointer is ${at}.`;
      out.push(`Write ${at ? `${pointer} of ${file}` : file} as a value other than null.\n` +
        `A delivered output has no null.${whole}`);
    }
  }
  return dropRepeated(out);
}

// The characters that JSON.stringify leaves as they are and that no finding may show: each Cf
// (the bidirectional marks, joiners and tags among them), the C1 controls, DEL, U+2028, U+2029.
const UNSHOWN = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

// escape returns char as an escape: \u202e, or \u{e0041} above U+FFFF.
const escape = (char) => {
  const code = char.codePointAt(0);
  return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, '0')}`;
};

// escaped returns json, as JSON.stringify wrote it, with each character of UNSHOWN escaped.
const escaped = (json) => json.replace(UNSHOWN, escape);

// visible returns text with each control character and each character of UNSHOWN as its
// escape, such as \u0000, so that a pattern on the line of a finding has none of them.
const visible = (text) => text.replace(UNSHOWN, escape);

// shown returns value as JSON.stringify writes it, cut to limit characters (40 by default), a
// refused character counting as its escape, which is never cut. Text keeps its quotes.
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

module.exports = { MAX_DEPTH, load, errors, compile, shown, escaped, depthLine, scan };
