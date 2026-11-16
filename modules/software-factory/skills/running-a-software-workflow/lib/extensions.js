// The extensions of the module software-factory: the keys that a repository sets under
// harness.extensions.software-factory, checked against extensions.schema.json of this skill
// before any check reads its keys. The schema is in the skill's folder, so that a skills
// folder of a runtime, which has no other file of the module, has it too, and the hash of
// trusted-checks.json covers it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const { isObject, jsonKind, Missing, quote } = lib;

  const SCHEMA_FILE = path.join(__dirname, '..', 'extensions.schema.json');

  const FIX = 'Fix harness.extensions.software-factory in qory.yaml';

  // The words of each type of the schema in a fix.
  const TYPE_WORDS = {
    object: 'a map', array: 'a list', string: 'a text', integer: 'a whole number',
  };

  // The keywords that shapeError reads; any other, but these notes, is a fault of the schema.
  const KEYWORDS = new Set(['type', 'properties', 'additionalProperties', 'required', 'items',
    'minItems', 'minLength', 'pattern', 'minimum', 'maximum']);

  // The pattern of a text on one line: no line break, tab or other control character. A fix
  // states it in words; any other pattern of the schema is quoted.
  const ONE_LINE = '^[^\\u0000-\\u001f\\u007f]+$';
  const NOTES = new Set(['$schema', 'title', 'description']);

  // readSchema returns the schema, or throws an Error with the file for a schema that this
  // file cannot read: no object, or a keyword that shapeError does not read.
  function readSchema() {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
    const walk = (part, at) => {
      if (!isObject(part)) throw new Error(`Fix ${SCHEMA_FILE}: ${at} is no object.`);
      for (const [key, value] of Object.entries(part)) {
        if (NOTES.has(key)) continue;
        if (!KEYWORDS.has(key)) throw new Error(`Fix ${SCHEMA_FILE}: ${at} has ${key}.`);
        if (key === 'properties') {
          for (const [name, one] of Object.entries(value)) walk(one, `${at}.${name}`);
        }
        if (key === 'items') walk(value, `${at}[]`);
      }
    };
    walk(schema, 'the schema');
    return schema;
  }

  const SCHEMA = readSchema();

  // shapeError returns the fix for the first part of value that breaks schema, or null. where
  // is the path of value in the fix, such as add_sensitive_areas[1].patterns.
  function shapeError(value, schema, where) {
    const type = schema.type;
    const fits = type === 'object' ? isObject(value)
      : type === 'array' ? Array.isArray(value)
        : type === 'string' ? typeof value === 'string'
          : type === 'integer' ? Number.isInteger(value) : true;
    if (!fits) {
      const kind = typeof value === 'number' ? String(value) : jsonKind(value);
      return `write ${where} as ${TYPE_WORDS[type]}, not ${kind}`;
    }
    if (type === 'object') {
      const keys = Object.keys(schema.properties || {});
      const other = Object.keys(value).find((key) => !keys.includes(key));
      if (other !== undefined && schema.additionalProperties === false) {
        return `remove the key ${quote(other)} from ${where}. Its keys are ${keys.join(', ')}`;
      }
      for (const key of schema.required || []) {
        if (!Object.hasOwn(value, key)) return `add ${key} to ${where}`;
      }
      for (const key of keys) {
        if (!Object.hasOwn(value, key)) continue;
        const why = shapeError(value[key], schema.properties[key], `${where}.${key}`);
        if (why) return why;
      }
    }
    if (type === 'array') {
      if (schema.minItems && value.length < schema.minItems) {
        return `give ${where} at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`;
      }
      for (let at = 0; at < value.length && schema.items; at += 1) {
        const why = shapeError(value[at], schema.items, `${where}[${at + 1}]`);
        if (why) return why;
      }
    }
    if (type === 'string' && schema.minLength && value.length < schema.minLength) {
      return `write ${where} as a text that is not empty`;
    }
    if (type === 'string' && schema.pattern !== undefined &&
      !new RegExp(schema.pattern, 'u').test(value)) {
      return schema.pattern === ONE_LINE
        ? `write ${where} on one line, with no tab or other control character`
        : `write ${where} as a text that matches ${schema.pattern}`;
    }
    if (type === 'integer' && ((schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum))) {
      return `set ${where} to a whole number from ${schema.minimum} to ${schema.maximum}, not ` +
        `${value}`;
    }
    return null;
  }

  // factoryExtensions returns the keys of software-factory that context.extensions() reads,
  // or {} with none, after it checks all of them against SCHEMA. A key that is not in the
  // schema, or a value of another shape, throws the fix: the check exits 3. Each check then
  // reads only its keys.
  function factoryExtensions(context) {
    const changes = context.extensions()['software-factory'];
    if (changes === undefined) return {};
    const why = shapeError(changes, SCHEMA, 'software-factory');
    if (why) throw new Missing(`${FIX}: ${why}.`);
    return changes;
  }

  return { factoryExtensions };
};
