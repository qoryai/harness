// Rule 13 of scripts/check.sh: prints a fix line for each -reviewer agent that the skill of a
// workflow with a review_group starts and that is no member of that group, for each group
// member that no module defines as an agent, for a review_group that no module provides, and
// for a group whose members differ from the agents whose description has "as an agent of the
// <workflow> session". It reads the folder in its first argument and prints nothing when every
// rule holds. groupOf is the one parser of review_group, which check.sh uses too.
'use strict';

const fs = require('fs');
const path = require('path');

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const dirs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

// groupOf returns the review_group of the body of a workflow entry of a stack, the text
// between its braces, or null.
const groupOf = (body) => {
  const found = /(?:^|,)\s*review_group: ([a-z0-9-]+)/.exec(body);
  return found ? found[1] : null;
};

// entriesOf returns [name, body] of each one-line workflow entry in the text of a stack.
const entriesOf = (text) => [...text.matchAll(/^ {2}([a-z0-9-]+): \{([^}]*)\}/gm)]
  .map((match) => [match[1], match[2]]);

// groupsOf returns the members of each group under provides.agents of the qory-module.yaml
// files of root/modules, as a Map from the group to { members, from }.
function groupsOf(root) {
  const groups = new Map();
  for (const one of dirs(path.join(root, 'modules'))) {
    const text = read(path.join(root, 'modules', one, 'qory-module.yaml'));
    const block = /\nprovides:\n {2}agents:\n((?: {4}.*\n|\s*\n)*)/.exec(text);
    if (!block) continue;
    for (const match of block[1].matchAll(/^ {4}([a-z0-9-]+): \[([^\]]*)\]/gm)) {
      const members = match[2].split(',').map((name) => name.trim()).filter(Boolean);
      const had = groups.get(match[1]);
      groups.set(match[1], { members: [...(had ? had.members : []), ...members],
        from: [...(had ? had.from : []), one] });
    }
  }
  return groups;
}

// sessionAgents returns the agents of root/modules whose front matter has "as an agent of the
// <workflow> session", sorted.
function sessionAgents(root, workflow) {
  const found = [];
  for (const one of dirs(path.join(root, 'modules'))) {
    const dir = path.join(root, 'modules', one, 'agents');
    for (const file of dirs(dir).filter((name) => name.endsWith('.md'))) {
      const front = read(path.join(dir, file)).split('\n---')[0];
      if (front.includes(`as an agent of the ${workflow} session`)) found.push(file.slice(0, -3));
    }
  }
  return found.sort();
}

function main(root) {
  const out = [];
  const modules = dirs(path.join(root, 'modules'));
  const agents = new Set(modules.flatMap((one) => dirs(path.join(root, 'modules', one, 'agents'))
    .filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3))));
  const groups = groupsOf(root);
  for (const [group, { members, from }] of groups) {
    for (const name of members) {
      if (!agents.has(name)) {
        out.push(`Add the agent ${name}, or remove it from the group ${group} of ` +
          `modules/${from[0]}/qory-module.yaml: no module defines it.`);
      }
    }
  }
  for (const stack of dirs(path.join(root, 'stacks'))) {
    const text = read(path.join(root, 'stacks', stack, 'qory-stack.yaml'));
    for (const [workflow, body] of entriesOf(text)) {
      const group = groupOf(body);
      if (!group) continue;
      const found = groups.get(group);
      if (!found) {
        out.push(`Add the group ${group} under provides.agents of a module, or remove ` +
          `review_group from ${workflow} in stacks/${stack}/qory-stack.yaml.`);
        continue;
      }
      for (const one of modules) {
        const skill = read(path.join(root, 'modules', one, 'skills', `workflow-${workflow}`,
          'SKILL.md'));
        for (const ref of skill.matchAll(/\$\{qory:agents\/([a-z0-9-]+)\}/g)) {
          if (!ref[1].endsWith('-reviewer') || found.members.includes(ref[1])) continue;
          out.push(`Add ${ref[1]} to the group ${group}, or start no ${ref[1]} in ` +
            `workflow-${workflow}: qory expects a report only from a member.`);
        }
      }
      const session = sessionAgents(root, workflow);
      const members = [...found.members].sort();
      if (session.length && session.join(' ') !== members.join(' ')) {
        out.push(`Make the group ${group} the agents of the ${workflow} session: ` +
          `${session.join(', ')} have "as an agent of the ${workflow} session" in their ` +
          `description, and the group has ${members.join(', ')}.`);
      }
    }
  }
  return out;
}

module.exports = { groupOf, entriesOf, groupsOf, sessionAgents };
if (require.main === module) {
  for (const line of main(process.argv[2])) console.log(line);
}
