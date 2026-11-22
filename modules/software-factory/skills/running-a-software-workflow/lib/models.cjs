// The model of an agent start, which step end writes into each attempt of the build ledger and
// matrix reads for the agents of Verify. A Claude Code run has its model only in two files of
// the composed harness: the model: line of the agent file, which qory writes for a tier with a
// model, and the model of the session's settings.json, which qory writes into claude/. The
// plugin folder is the folder two levels above the checks script: claude/plugin in a run, which
// --plugin-dir loads, and claude/ or the .claude of the checkout in a session that reads the
// checkout. settings.json is in the plugin folder or beside it. With neither file, the agent
// runs on the runtime's default, and the model is unknown.
//
// shortcut: the model of a Codex session is not read, so the ledger records unknown; read the
// model of codex/config.toml when the report needs it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A model id as the build ledger takes it: 1 to 100 printable ASCII characters.
const MODEL = /^[!-~]{1,100}$/;

module.exports = (lib) => {
  const { isObject } = lib;

  // valid returns id, or unknown when it is no model id that the build ledger takes.
  const valid = (id) => (MODEL.test(id) ? id : 'unknown');

  // codex reports whether plugin is a folder that Codex reads skills from: a Codex home, the
  // CODEX_HOME of a run, which has the config.toml that qory writes into each Codex home, or
  // the .agents of a checkout, which links the skills of the Codex home. Codex runs each agent
  // of a home for two runtimes on the main model, so a model: line in the agent files of
  // claude/ beside it is not the model of a Codex agent.
  const codex = (plugin) => path.basename(plugin) === '.agents' ||
    fs.existsSync(path.join(plugin, 'config.toml'));

  // modelOf returns the model of an agent: its file's model: line, which qory writes for the
  // tier, unless the value is an unresolved ${qory:...} name; else settings, the model of the
  // session. A folder of Codex gives unknown.
  function modelOf(plugin, agent, settings) {
    if (codex(plugin)) return 'unknown';
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

  // sessionModel returns the model of the settings.json in the plugin folder, else of the one
  // beside it, or unknown.
  function sessionModel(plugin) {
    const files = [path.join(plugin, 'settings.json'), path.join(plugin, '..', 'settings.json')];
    for (const file of files) {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      return isObject(data) && typeof data.model === 'string' ? valid(data.model) : 'unknown';
    }
    return 'unknown';
  }

  // agentModel returns the model of a start of agent, for the plugin folder of the session.
  const agentModel = (plugin, agent) => modelOf(plugin, agent, sessionModel(plugin));

  return { agentModel, modelOf, sessionModel };
};
