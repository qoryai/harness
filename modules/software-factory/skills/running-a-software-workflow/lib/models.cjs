// The model of an agent start, which step end writes into each attempt of the build ledger and
// matrix reads for the agents of Verify. A run has its model only in the files of the composed
// harness, where qory writes the model of the session and the model of each tier with a map:
// - Claude Code: the model: line of the agent file, and the model of the session's
//   settings.json in claude/. The plugin folder is the folder two levels above the checks
//   script: claude/plugin in a run, which --plugin-dir loads, and claude/ or the .claude of
//   the checkout in a session that reads the checkout. settings.json is in the plugin folder
//   or beside it.
// - Codex: the model of agents/<agent>.toml, and the model of config.toml, in the Codex home:
//   codex/, the CODEX_HOME of a run, or the .codex of the checkout beside its .agents.
// With neither file, the agent runs on the runtime's default, and the model is unknown.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A model id as the build ledger takes it: 1 to 100 printable ASCII characters.
const MODEL = /^[!-~]{1,100}$/;
// A top-level key model of a TOML file, with a string value and an optional comment.
const TOML_MODEL = /^[ \t]*model[ \t]*=[ \t]*(?:"([^"\\]*)"|'([^']*)')[ \t]*(?:#.*)?$/;
// A key whose value starts a multi-line string, and the text after the delimiter.
const TOML_OPEN = /^[ \t]*[^=#[]+=[ \t]*("{3}|'{3})(.*)$/;

module.exports = (lib) => {
  const { isObject } = lib;

  // valid returns id, or unknown when it is no model id that the build ledger takes.
  const valid = (id) => (MODEL.test(id) ? id : 'unknown');

  // codexHome returns the Codex home of plugin, the folder that Codex reads skills from, or
  // null for another runtime: plugin itself when it has the config.toml that qory writes into
  // each Codex home, or the .codex beside the .agents of a checkout, which links the skills of
  // the home. A home composed for Codex and another runtime writes no tier into the Codex
  // agents, so Codex runs each agent on the main model, and a model: line in the agent files of
  // claude/ beside it is not the model of a Codex agent.
  function codexHome(plugin) {
    if (path.basename(plugin) === '.agents') return path.join(plugin, '..', '.codex');
    return fs.existsSync(path.join(plugin, 'config.toml')) ? plugin : null;
  }

  // tomlModel returns the top-level model of the TOML file, the line model = "<id>" before the
  // first table, or null when the file has none or cannot be read. A line in a multi-line
  // string, from a value that starts with three quotes to the next three, is no key.
  function tomlModel(file) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    let open = null;
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
      if (open) {
        if (line.includes(open)) open = null;
        continue;
      }
      if (/^[ \t]*\[/.test(line)) return null;
      const match = TOML_MODEL.exec(line);
      if (match) return valid(match[1] === undefined ? match[2] : match[1]);
      const start = TOML_OPEN.exec(line);
      if (start && !start[2].includes(start[1])) open = start[1];
    }
    return null;
  }

  // modelOf returns the model of an agent: on Codex, the model of its agents/<agent>.toml; else
  // its file's model: line, which qory writes for the tier, unless the value is an unresolved
  // ${qory:...} name; else settings, the model of the session.
  function modelOf(plugin, agent, settings) {
    const home = codexHome(plugin);
    if (home) return tomlModel(path.join(home, 'agents', `${agent}.toml`)) || settings;
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

  // sessionModel returns the model of the session: on Codex, the model of config.toml; else of
  // the settings.json in the plugin folder, else of the one beside it; or unknown.
  function sessionModel(plugin) {
    const home = codexHome(plugin);
    if (home) return tomlModel(path.join(home, 'config.toml')) || 'unknown';
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
