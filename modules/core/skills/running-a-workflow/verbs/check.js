// check and push: the checks of the files of one version of a type, by rules that need no
// judgment. The types are those of the registry; check also takes points.
'use strict';

const fs = require('node:fs');

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
      usage: ['check <type> <file>...'],
      args: args('check'),
      run(io, what, rest) {
        const { findings, last } = checkFiles('check', folderOf(io, rest[0]),
          typeOf(io, 'check', what), rest, io.home, io.plugin);
        io.print(findings, last);
        return findings.length ? 1 : 0;
      },
    },
    push: {
      usage: ['push <type> <file>...'],
      args: args('push'),
      run(io, what, rest) {
        const { findings, last } = checkFiles('push', fs.realpathSync(io.cwd),
          typeOf(io, 'push', what), rest, io.home);
        io.print(findings, last);
        return findings.length ? 1 : 0;
      },
    },
  },
};
