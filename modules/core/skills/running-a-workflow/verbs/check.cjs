// check and push: the checks of the files of one version of a type, by rules that need no
// judgment. The types are those of the registry; check also takes points.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { folderOf } = require('../lib/base.cjs');
const { checkFiles } = require('../lib/drafts.cjs');
const { pointsType } = require('../types/points.cjs');

// typeOf returns the type of the registry that verb takes by the name type, or null.
function typeOf(io, verb, type) {
  if (verb === 'check' && type === pointsType.type) return pointsType;
  return io.registry().types.find((def) => def.type === type) || null;
}

// phraseFiles returns the reply-phrases.json files of the registry for def, or null for
// points, which is no type of the registry.
const phraseFiles = (io, def) => (def === pointsType ? null : io.registry().phraseFiles);

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
        const def = typeOf(io, 'check', what);
        const { findings, last, told } = checkFiles('check', folderOf(io, rest[0]), def, rest,
          io.home, io.plugin, undefined, null,
          { workingFolder: path.resolve(io.cwd), inputs: io.inputs,
            phraseFiles: phraseFiles(io, def) });
        io.print(findings, last);
        // io.print wrote the findings to stdout and the line of what the script checked to
        // stderr. The lines that the check of the type tells follow that line on stderr.
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
        const def = typeOf(io, 'push', what);
        const { findings, last } = checkFiles('push', cwd, def, rest, io.home, io.plugin, cwd,
          null, { workingFolder: cwd, inputs: io.inputs, phraseFiles: phraseFiles(io, def) });
        io.print(findings, last);
        return findings.length ? 1 : 0;
      },
    },
  },
};
