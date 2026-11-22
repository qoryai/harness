// Rule 14 of scripts/check.sh: prints a fix line for each agent of a module that reaches a
// skill running-a-* or workflow-*, by its references ${qory:skills/<name>} and those of each
// skill it reaches. qory reads the references of an agent in its file and of a skill in each
// Markdown file of its folder. It reads the folder in its first argument and prints nothing
// when no agent reaches such a skill.
'use strict';

const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const dirs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const REFERENCE = /\$\{qory:skills\/([^}]*)\}/g;
const WORKFLOW = /^(?:running-a-|workflow-)/;

// skillDirs returns the folders under dir that have a SKILL.md, at any depth, except one below
// such a folder, which is a part of that skill.
function skillDirs(dir) {
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) return [dir];
  return dirs(dir).map((name) => path.join(dir, name))
    .filter((one) => fs.statSync(one).isDirectory()).flatMap(skillDirs);
}

// markdown returns the .md files below dir, sorted.
function markdown(dir) {
  return dirs(dir).map((name) => path.join(dir, name)).flatMap((one) =>
    (fs.statSync(one).isDirectory() ? markdown(one) : one.endsWith('.md') ? [one] : []));
}

// references returns the skill names that files reference, each once, with the first file
// that references each.
function references(files) {
  const out = new Map();
  for (const file of files) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(REFERENCE)) {
      if (!out.has(match[1])) out.set(match[1], file);
    }
  }
  return out;
}

const skills = new Map();
const agents = [];
for (const one of dirs(path.join(root, 'modules'))) {
  const top = path.join(root, 'modules', one);
  for (const dir of skillDirs(path.join(top, 'skills'))) {
    skills.set(path.basename(dir), references(markdown(dir)));
  }
  for (const name of dirs(path.join(top, 'agents')).filter((file) => file.endsWith('.md'))) {
    const file = path.join(top, 'agents', name);
    agents.push({ name: name.slice(0, -3), refs: references([file]) });
  }
}

for (const agent of agents) {
  // A walk over the skills that the agent reaches, each with the way to it.
  const queue = [...agent.refs].map(([name, file]) => ({ name, file, way: [agent.name, name] }));
  const seen = new Set();
  while (queue.length) {
    const { name, file, way } = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    if (WORKFLOW.test(name)) {
      console.log(`Remove \${qory:skills/${name}} from ${path.relative(root, file)}: agent ` +
        `${agent.name} reaches it through ${way.join(' > ')}, and an agent loads no ` +
        'skill running-a-* or workflow-*.');
      continue;
    }
    for (const [next, from] of skills.get(name) || []) {
      queue.push({ name: next, file: from, way: [...way, next] });
    }
  }
}
