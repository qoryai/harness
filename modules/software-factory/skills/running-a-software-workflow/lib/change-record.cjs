// The record that the verb changes writes: .qory/build/changes.json in the working folder (see
// verbs/changes.cjs). The build-plan check reads it. The tool guard denies an agent's writes
// below .qory/build/, and a file written past it can change what is planned, not a check's
// result: keptFiles and lock --verify refuse a wrong result.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The path of the record below the working folder.
const FILE = path.join('.qory', 'build', 'changes.json');

// The most bytes that a read takes: a record lists at most 50 criteria and their paths.
const MAX_BYTES = 1024 * 1024;

// read returns the parsed record of the working folder, or null when the folder has none, a
// link stands in its place or on the way, or the file has more than one link, or is no JSON
// object of at most MAX_BYTES. A file with a second link could be rewritten through that link.
function read(folder) {
  try {
    let at = folder;
    for (const part of FILE.split(path.sep)) {
      at = path.join(at, part);
      if (fs.lstatSync(at).isSymbolicLink()) return null;
    }
    const stat = fs.lstatSync(at);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > MAX_BYTES) return null;
    const data = JSON.parse(fs.readFileSync(at, 'utf8'));
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

module.exports = { FILE, read };
