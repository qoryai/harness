// The model of an agent start, which step end writes into each attempt of the build ledger and
// matrix reads for the agents of Verify. A run has its model only in the files of the composed
// harness, where qory writes the model of the session and the model of each tier with a map:
// - Claude Code: the model: line of the agent file, and the model of the session's
//   settings.json in claude/. The plugin folder is the folder two levels above the checks
//   script: claude/plugin in a run, which --plugin-dir loads, and claude/ or the .claude of
//   the checkout in a session that reads the checkout. settings.json is in the plugin folder
//   or beside it.
// - Codex: the model of agents/<agent>.toml, and the model of config.toml, in the Codex home:
//   codex/, or, for a session that reads the skills of the checkout's .agents, the folder of
//   CODEX_HOME, which qory sets only for a Codex launch.
// With neither file, the agent runs on the runtime's default, and the model is unknown. A
// session from .agents with no CODEX_HOME gets unknown, since amp, any, copilot, cursor, goose
// and opencode read .agents too.
//
// shortcut: a session of another runtime that reads .agents and inherits a CODEX_HOME from the
// shell of the person gets the models of that Codex home; check the runtime once the run has a
// record of it.
// shortcut: the model of a session of another runtime that reads .agents is not read, so the
// ledger records unknown; read that runtime's files when the report needs it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// A model id as the build ledger takes it: 1 to 100 printable ASCII characters.
const MODEL = /^[!-~]{1,100}$/;
// The largest file of the harness that the lookup reads, in bytes.
const LIMIT = 64 * 1024;
// A top-level key model of a TOML file, with a string value and an optional comment.
const TOML_MODEL = /^[ \t]*model[ \t]*=[ \t]*(?:"([^"\\]*)"|'([^']*)')[ \t]*(?:#.*)?$/;
// A top-level key model of a TOML file in any form, with any value.
const TOML_KEY = /^[ \t]*(?:model|"model"|'model')[ \t]*=/;
// A key whose value starts a multi-line string, and the text after the delimiter.
const TOML_OPEN = /^[ \t]*[^=#[]+=[ \t]*("{3}|'{3})(.*)$/;

// small returns the text of file, null when it does not exist, or false when it is no regular
// file of at most LIMIT bytes or cannot be read. O_NONBLOCK opens a FIFO without a wait.
function small(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  } catch (error) {
    return ['ENOENT', 'ENOTDIR'].includes(error.code) ? null : false;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return false;
    const buffer = Buffer.alloc(LIMIT + 1);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return length > LIMIT ? false : buffer.toString('utf8', 0, length);
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = (lib) => {
  const { isObject } = lib;

  // valid returns id, or unknown when it is no model id that the build ledger takes.
  const valid = (id) => (MODEL.test(id) ? id : 'unknown');

  // codexHome returns the Codex home of plugin, '' for a session from .agents with no Codex
  // home, or null for Claude Code. qory writes no tier into the Codex agents of a home for
  // Codex and another runtime, so the model: lines of claude/ do not apply to Codex.
  function codexHome(plugin, env) {
    if (path.basename(plugin) === '.agents') {
      const home = env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : '';
      return home && fs.existsSync(path.join(home, 'config.toml')) ? home : '';
    }
    return fs.existsSync(path.join(plugin, 'config.toml')) ? plugin : null;
  }

  // tomlModel returns the top-level model of the TOML file, the line model = "<id>" before the
  // first table; null when the file does not exist or has no model; and unknown for a file that
  // small does not read, or a top-level model that is not a string of one line in that form.
  // A line in a multi-line string, from a value that starts with three quotes to the next
  // three, is no key.
  // shortcut: an escaped \""" in a multi-line string ends it, a multi-line string in an array
  // is not skipped, and a line of a nested array that starts with [ ends the top level;
  // qory's EncodeTOML writes none of them; read with a TOML parser when a file has them.
  function tomlModel(file) {
    const text = small(file);
    if (text === null) return null;
    if (text === false) return 'unknown';
    let open = null;
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
      if (open) {
        if (line.includes(open)) open = null;
        continue;
      }
      if (/^[ \t]*\[/.test(line)) return null;
      const match = TOML_MODEL.exec(line);
      if (match) return valid(match[1] === undefined ? match[2] : match[1]);
      if (TOML_KEY.test(line)) return 'unknown';
      const start = TOML_OPEN.exec(line);
      if (start && !start[2].includes(start[1])) open = start[1];
    }
    return null;
  }

  // modelOf returns the model of an agent: in the Codex home home, the model of its
  // agents/<agent>.toml; else its file's model: line, which qory writes for the tier, unless the
  // value is an unresolved ${qory:...} name; else settings, the model of the session.
  function modelOf(plugin, agent, settings, home) {
    if (home) return tomlModel(path.join(home, 'agents', `${agent}.toml`)) || settings;
    for (const folder of lib.pluginFolders(plugin)) {
      const text = small(path.join(folder, 'agents', `${agent}.md`));
      if (!text) continue;
      const front = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n?/g, '\n'));
      const line = front && /^model:[ \t]*["']?([^"'\s]+)["']?[ \t]*$/m.exec(front[1]);
      if (line && !line[1].startsWith('$')) return valid(line[1]);
    }
    return settings;
  }

  // sessionModel returns the model of the session: in the Codex home home, the model of
  // config.toml; else of the settings.json in the plugin folder, else of the one beside it; or
  // unknown.
  function sessionModel(plugin, home) {
    if (home) return tomlModel(path.join(home, 'config.toml')) || 'unknown';
    const files = [path.join(plugin, 'settings.json'), path.join(plugin, '..', 'settings.json')];
    for (const file of files) {
      let data;
      try {
        data = JSON.parse(small(file) || '');
      } catch {
        continue;
      }
      return isObject(data) && typeof data.model === 'string' ? valid(data.model) : 'unknown';
    }
    return 'unknown';
  }

  // agentModel returns the model of a start of agent, for the plugin folder of the session and
  // its environment env.
  function agentModel(plugin, agent, env) {
    const home = codexHome(plugin, env);
    if (home === '') return 'unknown';
    return modelOf(plugin, agent, sessionModel(plugin, home), home);
  }

  return { agentModel };
};
