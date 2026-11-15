#!/usr/bin/env node
// The push checks of core, for the types questions and review-comments:
//
//   push-check.js push <type> <file>...   the form that `qory artifact push` runs
//
// runs `checks.js push` of running-a-workflow with the same arguments, and with the folder
// of the module core as its plugin folder, so that it reads the agents and skills of every
// module of the home.
//
// The file lies outside every entry of the module: qory composes a module's other files
// whatever its exclude or only leaves out, so a stack that composes only some skills of core
// still has the program of each push check that core declares.
'use strict';

const path = require('node:path');

// TYPES are the types that core declares push checks for in qory-module.yaml.
const TYPES = ['questions', 'review-comments'];

if (require.main === module) {
  const argv = process.argv.slice(2);
  try {
    if (argv[0] !== 'push' || !TYPES.includes(argv[1]) || argv.length < 3) {
      process.stderr.write(`Give push ${TYPES.join('|')} <file>...: push-check.js runs only ` +
        'the push checks of core.\n');
      process.exitCode = 2;
    } else {
      // <home>/modules/core/scripts/push-check.js, as qory started it.
      const core = path.dirname(path.dirname(path.resolve(process.argv[1])));
      const checks = path.join(core, 'skills', 'running-a-workflow', 'checks.js');
      process.exitCode = require(checks).main(argv, { plugin: core });
    }
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 3;
  }
}
