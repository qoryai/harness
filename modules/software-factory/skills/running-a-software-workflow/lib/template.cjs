// The process template of this module, process.yaml, two folders above this skill's folder:
// the artifact types that Qory Apiary reads from it, as far as the draft checks need them.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROCESS = path.join(__dirname, '..', '..', '..', 'process.yaml');

let limits = null;

// sizeLimit returns the size_limit of type under artifact_types in process.yaml, in bytes:
// the most that Qory Apiary takes for a file of the type, so that a draft check refuses what
// a push refuses. It reads the file once. A type with no size_limit there is a fault of the
// harness, and sizeLimit throws.
function sizeLimit(type) {
  if (!limits) {
    limits = new Map();
    const text = fs.readFileSync(PROCESS, 'utf8').replace(/\r\n?/g, '\n');
    const start = text.indexOf('\nartifact_types:\n');
    let name = null;
    for (const line of start < 0 ? [] : text.slice(start + 1).split('\n').slice(1)) {
      if (/^\S/.test(line)) break;
      const entry = /^ {2}- name: ([a-z0-9-]+)$/.exec(line);
      if (entry) name = entry[1];
      const limit = /^ {4}size_limit: ([0-9]+)$/.exec(line);
      if (limit && name) limits.set(name, Number(limit[1]));
    }
  }
  if (!limits.has(type)) {
    throw new Error(`Set size_limit of ${type} under artifact_types in ${PROCESS}.\n` +
      'The draft check of the type reads it there.');
  }
  return limits.get(type);
}

module.exports = { sizeLimit };
