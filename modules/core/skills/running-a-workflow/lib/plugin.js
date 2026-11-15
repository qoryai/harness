// The plugin folder, where agents/ and skills/ are, and the folders beside it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// pluginFolder returns the plugin folder, where agents/ and skills/ are, from the path that
// started the script: <plugin>/skills/running-a-workflow/checks.js. It keeps that path as it
// is, because the compose writes this script there as a link to the module's source, and
// __dirname is the real path of the source, in a module without the other modules' agents.
const pluginFolder = (script) => path.resolve(path.dirname(path.resolve(script)), '..', '..');

// pluginFolders returns the plugin folder, then each folder beside it, so that a script
// started from <home>/modules/<module>/ also reads the agents of the other modules.
function pluginFolders(plugin) {
  const folders = [plugin];
  try {
    const parent = path.dirname(plugin);
    for (const entry of fs.readdirSync(parent)) folders.push(path.join(parent, entry));
  } catch {
    // Only the plugin folder.
  }
  return folders;
}

// agentNames returns the names of the agents of the folders that pluginFolders returns.
function agentNames(plugin) {
  const names = new Set();
  for (const folder of pluginFolders(plugin)) {
    try {
      for (const entry of fs.readdirSync(path.join(folder, 'agents'))) {
        const match = /^([a-z0-9][a-z0-9-]{0,63})\.md$/.exec(entry);
        if (match) names.add(match[1]);
      }
    } catch {
      // A folder with no agents.
    }
  }
  return names;
}

module.exports = {
  pluginFolder, pluginFolders, agentNames,
};
