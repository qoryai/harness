// check and push: the checks of the files of one version of a type, by rules that need no
// judgment. The types are those of the registry; check also takes points.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { folderOf } = require('../lib/base.js');
const { checkFiles } = require('../lib/drafts.js');
const { pointsType } = require('../types/points.js');

// typeOf returns the type of the registry that verb takes by the name type, or null.
function typeOf(io, verb, type) {
  if (verb === 'check' && type === pointsType.type) return pointsType;
  return io.registry().types.find((def) => def.type === type) || null;
}

// args returns the fix for wrong arguments of verb, or null.
function args(verb) {
  return (io, what, rest) => {
    if (!typeOf(io, verb, what)) return `Give a type that the script checks: ${what}`;
    if (!rest.length) return `Give ${verb} each file of the ${what} version.`;
    return null;
  };
}

module.exports = {
  verbs: {
    check: {
      usage: ['check <type> [--inputs <file>] <file>...'],
      args: args('check'),
      run(io, what, rest) {
        const { findings, last, told } = checkFiles('check', folderOf(io, rest[0]),
          typeOf(io, 'check', what), rest, io.home, io.plugin, undefined, null,
          { workingFolder: path.resolve(io.cwd), inputs: io.inputs });
        io.print(findings, last);
        // The lines that the check of the type tells go to stderr, so that stdout keeps only
        // the findings and the line of what the script checked last.
        if (told.length) io.err.write(`${told.join('\n')}\n`);
        return findings.length ? 1 : 0;
      },
    },
    push: {
      usage: ['push <type> [--inputs <file>] <file>...'],
      args: args('push'),
      run(io, what, rest) {
        const cwd = fs.realpathSync(io.cwd);
        // The plugin gives the prefixes of ids, as the registry of typeOf reads them.
        const { findings, last } = checkFiles('push', cwd, typeOf(io, 'push', what), rest,
          io.home, io.plugin, cwd, null, { workingFolder: cwd, inputs: io.inputs });
        io.print(findings, last);
        return findings.length ? 1 : 0;
      },
    },
  },
};
