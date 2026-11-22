// Rule 13 of scripts/check.sh: prints a fix line for each -reviewer agent that the skill of a
// workflow with a review_group starts and that is no member of that group, for each group
// member that no module defines as an agent, and for a review_group that no module provides.
// It reads the folder in its first argument and prints nothing when every rule holds.
'use strict';

const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const dirs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const modules = dirs(path.join(root, 'modules'));
const agents = new Set(modules.flatMap((one) => dirs(path.join(root, 'modules', one, 'agents'))
  .filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3))));
const groups = new Map();
for (const one of modules) {
  const text = read(path.join(root, 'modules', one, 'qory-module.yaml'));
  const block = /\nprovides:\n {2}agents:\n((?: {4}.*\n|\s*\n)*)/.exec(text);
  if (!block) continue;
  for (const match of block[1].matchAll(/^ {4}([a-z0-9-]+): \[([^\]]*)\]/gm)) {
    const members = match[2].split(',').map((name) => name.trim()).filter(Boolean);
    groups.set(match[1], [...(groups.get(match[1]) || []), ...members]);
    for (const name of members) {
      if (!agents.has(name)) {
        console.log(`Add the agent ${name}, or remove it from the group ${match[1]} of ` +
          `modules/${one}/qory-module.yaml: no module defines it.`);
      }
    }
  }
}
for (const stack of dirs(path.join(root, 'stacks'))) {
  const text = read(path.join(root, 'stacks', stack, 'qory-stack.yaml'));
  for (const match of text.matchAll(/^ {2}([a-z0-9-]+): \{([^}]*)\}/gm)) {
    const group = /(?:^|,)\s*review_group: ([a-z0-9-]+)/.exec(match[2]);
    if (!group) continue;
    const members = groups.get(group[1]);
    if (!members) {
      console.log(`Add the group ${group[1]} under provides.agents of a module, or remove ` +
        `review_group from ${match[1]} in stacks/${stack}/qory-stack.yaml.`);
      continue;
    }
    for (const one of modules) {
      const skill = read(path.join(root, 'modules', one, 'skills', `workflow-${match[1]}`,
        'SKILL.md'));
      for (const ref of skill.matchAll(/\$\{qory:agents\/([a-z0-9-]+)\}/g)) {
        if (!ref[1].endsWith('-reviewer') || members.includes(ref[1])) continue;
        console.log(`Add ${ref[1]} to the group ${group[1]}, or start no ${ref[1]} in ` +
          `workflow-${match[1]}: qory expects a report only from a member.`);
      }
    }
  }
}
