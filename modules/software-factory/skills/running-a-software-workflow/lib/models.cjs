// The model of an agent start, which step end writes into each attempt of the build ledger and
// matrix reads for the agents of Verify. A run has its model only in two files of the composed
// harness: the model: line of the agent file, which qory writes for a tier with a model, and
// the model of the settings.json beside the plugin folder, which qory writes for the session.
// With neither, the agent runs on the runtime's default, and the model is unknown.
//
// shortcut: Codex runs read no model here, so the model is unknown; read `codex/config.toml`
// if a card asks for it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A model id as the build ledger takes it: 1 to 100 printable ASCII characters.
const MODEL = /^[!-~]{1,100}$/;

module.exports = (lib) => {
  const { isObject } = lib;

  // valid returns id, or unknown when it is no model id that the build ledger takes.
  const valid = (id) => (MODEL.test(id) ? id : 'unknown');

  // modelOf returns the model of an agent: its file's model: line, which qory writes for the
  // tier, unless the value is an unresolved ${qory:...} name; else settings, the model of the
  // session.
  function modelOf(plugin, agent, settings) {
    for (const folder of lib.pluginFolders(plugin)) {
      let text;
      try {
        text = fs.readFileSync(path.join(folder, 'agents', `${agent}.md`), 'utf8');
      } catch {
        continue;
      }
      const front = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n?/g, '\n'));
      const line = front && /^model:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m.exec(front[1]);
      if (line && !line[1].startsWith('$')) return valid(line[1]);
    }
    return settings;
  }

  // sessionModel returns the model of the settings.json beside the plugin folder, or unknown.
  function sessionModel(plugin) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(plugin, '..', 'settings.json'), 'utf8'));
      return isObject(data) && typeof data.model === 'string' ? valid(data.model) : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // agentModel returns the model of a start of agent, for the plugin folder of the session.
  const agentModel = (plugin, agent) => modelOf(plugin, agent, sessionModel(plugin));

  return { agentModel, modelOf, sessionModel };
};
