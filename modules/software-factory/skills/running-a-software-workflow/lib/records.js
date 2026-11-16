// The records of the check runners: one JSON file per call of run or probe, and the output of
// each command it ran, in .reports/runs/ of the artifact folder. Each call writes files of a
// new name, so that calls at once need no lock, and the deny rules of .reports/**/*.json keep
// the records from an agent's edit.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

module.exports = (lib) => {
  const { Missing, writeJson } = lib;

  // newRecord returns { id, log(at), write(data) } for a call: log returns the path of the
  // output file of its command number at, and write writes the record.
  function newRecord(root) {
    const folder = path.join(root, '.reports', 'runs');
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch {
      throw new Missing(`Make the artifact folder writable: ${folder} cannot be made.`);
    }
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-` +
      crypto.randomBytes(3).toString('hex');
    return {
      id,
      log: (at) => path.join(folder, `${id}-${at}.log`),
      write: (data) => writeJson(path.join(folder, `${id}.json`), { id, ...data }),
    };
  }

  return { newRecord };
};
