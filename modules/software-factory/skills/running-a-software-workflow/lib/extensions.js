// The extensions of the module software-factory in a proposal check: the keys that a repository
// sets under harness.extensions.software-factory, which context.extensions() reads from the
// inputs.json that --inputs gives, else from the harness report. The check against
// extensions.schema.json is check of lib/repository-settings.js, the one check of that schema.
'use strict';

const repositorySettings = require('./repository-settings.js');

module.exports = (lib) => {
  const { Missing } = lib;

  // extensionsFix returns the finding for a value of a key that short-path.json cannot take:
  // the first line with the fix, at most 100 characters, as action has at most 46, and the
  // line after it with the cause and the values.
  const extensionsFix = (action, cause) =>
    `Fix ${repositorySettings.PLACE}: ${action}.\n${cause}.`;

  // factoryExtensions returns the keys of software-factory that context.extensions() reads,
  // or {} with none, after check of lib/repository-settings.js checked all of them against
  // extensions.schema.json. A key that is not in the schema, or a value of another shape,
  // throws the first finding of that check: the check exits 3. Each check then reads only
  // its keys.
  function factoryExtensions(context) {
    const changes = context.extensions()['software-factory'];
    if (changes === undefined) return {};
    const findings = repositorySettings.check(changes);
    if (findings.length) throw new Missing(findings[0]);
    return changes;
  }

  return { factoryExtensions, extensionsFix };
};
