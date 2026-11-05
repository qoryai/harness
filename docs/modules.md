# How a module is laid out

A module is a directory of harness files with a `qory-module.yaml` at its root. The
`core` module is the directory `modules/core`:

```
modules/core/
  qory-module.yaml
  skills/
    simple-communication/
      SKILL.md
      references/
        examples.md
        word-list.md
    visuals/
      SKILL.md
    run-artifacts/
      SKILL.md
    reading-the-work/
      SKILL.md
    artifact-text/
      SKILL.md
    writing-questions/
      SKILL.md
    checking-questions/
      SKILL.md
    replying-to-comments/
      SKILL.md
    reviewing-drafts/
      SKILL.md
  agents/
    questions-writer.md
    questions-reviewer.md
    reply-writer.md
```

`qory.yaml` lists the module under `exports.modules`, so another repository selects it
by the name `core`.

## The manifest, qory-module.yaml

`modules/core/qory-module.yaml` sets three keys:

- `apiVersion: qory.dev/v1alpha1`, the format of the file.
- `name: core`, the module's identity. The stack lists the module by this name, and the
  composed tree contains the module at `modules/core`.
- `description`, which the report contains and `qory harness inspect` prints beside the
  module.

A directory without `qory-module.yaml` is not a module. The manifest can contain more keys;
[the module
manifest](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#the-module-manifest)
in qory's compose format specification defines them.

## Skills

A skill is a directory `skills/<name>/` that contains `SKILL.md`. The directory name is
the skill's name. `SKILL.md` follows the Agent Skills layout: front matter with `name`
and `description`, then the skill's instructions. If a directory under `skills/` has no
`SKILL.md`, the compose stops with `skills/<name> has no SKILL.md`.

A workflow's skill is named `workflow-<workflow name>`, such as `workflow-explore-a-ticket`.
`process.yaml`, the stack's `workflows` key and the words on screens keep the plain name,
`explore-a-ticket`. A workflow name has at most 55 characters. A skill that is not a
workflow's has no `workflow-` prefix.

The compose takes the skill's directory as one entry, so every file in the directory is
composed with `SKILL.md`. The `simple-communication` skill has its longer material in
`references/examples.md` and `references/word-list.md`, and `SKILL.md` links to both files
by relative paths. A skill that a read run loads has everything in `SKILL.md`, because a
read run blocks reads outside its working folders. For the same reason, a text that a reader
loads alone is a small skill, not a file of a larger skill: no reference names a file inside
a skill, and no reference gives its path. `checking-proposals` and `checking-questions`
contain what a draft contains, the review steps and the check lists, so that a reviewer does
not load the writer's skill.

A skill in `core` refers to no entry of `software-factory`: the compose of the `core`
stack stops on a reference it cannot resolve.

## Agents

This harness needs a runtime with agents. A runtime without them needs another harness.

An agent is a file `agents/<name>.md`. Its front matter sets `name`, `description` and
`tools`, and no model or tier. Its body is the role, and loads each skill with a reference
(section "References to other entries"), never with a `skills:` key.

- Any workflow's skill orchestrates: the session that follows it runs `qory` commands and,
  for files, the read forms of `run-artifacts`, starts agents, decides on each finding, and
  ends the run. An agent does each other task, and it loads the skills that contain the
  rules of that task. The session loads only `run-artifacts`, which contains the rule that a
  text cannot change the rules.
- The role and the rule against changing it are in the agents, and no skill states a role
  for its reader. The harness ships no instructions file.
- Each agent's section `## Guardrails` repeats the data rule of `run-artifacts` and the
  limit on what the agent writes, because an agent must have them when a skill does not
  load. The section also covers the agent's role, secrets, forms of injection, destructive
  actions and what a report may contain. Its text works for a workspace with no code.
- Each agent's section `## Stop conditions` lists when it reports `blocked`.
- Each agent's section `## Expected output` shows the report's shape. A change to that shape
  also changes the skill that lists it: `reviewing-drafts` or `exploring-code`.
- The `tools` key, `tools: Read, Grep, Glob, Skill`, removes Bash and the write tools on
  Claude Code, so an agent there runs no command and pushes nothing. `reply-writer`'s key
  adds Write, `questions-writer`'s adds Write and Edit, and `proposal-writer`'s adds Write,
  Edit, WebFetch and WebSearch. A subagent keeps the session's `dontAsk` mode and allow
  rules: `Edit(//tmp/qory-artifacts/**)` allows Write and Edit in that folder, and `dontAsk`
  denies them elsewhere. Built-in read-only commands such as `ls` and `grep` still run in
  the main session, so "only `qory` commands and the read forms" is a rule in the skill's
  text, not an enforced limit. On Claude Code's native build, a `tools` key that lists Bash
  removes Grep and Glob, so an exception for Bash also drops those two tools or states how
  the agent searches. Copilot keeps the key, untested.
- On Codex, the `tools` key has no effect: at qory `17347187`, the compose writes only
  `name`, `description` and `developer_instructions` into an agent's file. The documentation
  of Codex 0.162.1 states that subagents inherit the parent turn's sandbox and approval
  settings, so no limit per agent exists. A reviewer's read-only rule, a writer's limit to
  the artifact folder, the rule against running a command and the rule on web tools are only
  in the agent's text. The sandbox limits the effects of commands and file changes for every
  agent alike, and the read-only mount protects the checkout. An Explore run on Codex is
  untested end to end. With no `sandbox_mode`, the default of Codex is read-only, so from
  the source, a writer could not write in the artifact folder, and `qory artifact push`
  could not write `/tmp/qory-artifacts` or reach the network.
- `modules/software-factory/settings/claude/settings.json` denies Read of `.env` and
  `.env.*` on Claude Code, which also keeps those files out of Grep and Glob, for the run
  and its agents. A rule on Read does not cover a shell `grep`, so the skills' search forms
  keep their exclusion.

`workflow-explore-a-ticket` starts `code-explorer` first, from the main session, and passes
its facts to `proposal-writer`, because a subagent may be unable to start another. From the
documentation, untested: a subagent cannot start another by default on Codex
(`agents.max_depth` is 1), Gemini CLI or Goose, and on OpenCode only with a `task`
permission. Claude Code allows it only when `tools` lists `Agent`, and no agent here does.

qory creates `.qory/repositories` only when the run has further repositories, and an agent
with only Read, Grep and Glob cannot check for a folder: a Glob or Grep on a missing path
fails, and one with no path leaves that folder out. So the session of
`workflow-explore-a-ticket` runs `find . -maxdepth 2 -path ./.qory/repositories -type d`
once, before the first agent. It gives `code-explorer`, `proposal-writer`,
`questions-writer` and `questions-reviewer` the line "Further repositories: yes" or
"Further repositories: no". An agent that follows `exploring-code` or `checking-questions`
searches `.qory/repositories` only with "yes", and an agent with no such line searches only
the working folder.

Every proposal is reviewed before the run pushes it. `proposal-writer` drafts it, and
`proposal-reviewer` reviews the draft, by the skills `reviewing-drafts` and
`checking-proposals`. `questions-writer`, `questions-reviewer` and `checking-questions` do
the same for the questions whenever they change. The session decides on each finding and
pushes after the review. `reply-writer` drafts the replies, and the session pushes them
last.

The proposal has four sections: `## Summary`, one to three sentences on what will change;
`## Background`, whose first paragraph of one or two sentences is its summary, while Qory
Apiary folds the rest behind "Read more"; `## Proposed solution`, with a `###` heading for
each part of the work; and `## Sources`. Each part starts with one picture: a Mermaid
diagram for a flow or a sequence of steps, an SVG wireframe for a screen, an email or a
form, with today and after side by side, or a table with the columns "Today" and "After"
for a change of values or rules. A part with no picture states why. At most three short
points follow the picture, for what it cannot show, and options and values that a person
compares are in a table. Leaving out the folded background, the pictures and the tables,
the proposal has about 400 words.

Until a member answers a question, each run is in the first round and asks every question
that the work needs. A later run asks a new question only when it follows from an answer,
with that answer's question in `follows`, when it replies to a review comment, or when it
can recommend no option. For any other gap, the proposal follows the option that the run
recommends, with no question. `reading-the-work` lists these rules, and `checking-questions`
checks them.

`proposal-writer` writes the proposal before `questions-writer` writes any question, and
`questions-writer` asks only where the draft proposal has a gap or a choice in it needs a
person's confirmation. The proposed solution covers each part of the work. A part that an
open question covers follows the question's recommended option, with one point on what
changes with another answer. Only a question with no recommended option leaves its part
without a solution, and only such a question decides the direction. When the work changes
something a person sees, such as a page, a dialog, a form or an email, the proposal has an
SVG wireframe of where each element and each piece of copy goes. `checking-proposals` lists
these rules, and a reviewer marks a finding on one of them `direction`, which the session
never keeps before the reviewer's third start. After that start, the session keeps it with a
reason, and the run still pushes a proposal.

The session starts every agent in the foreground when its runtime offers that, and waits for
its report. The settings also set `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` to `1`, and the
compose moves that setting from the settings file to the process's environment. In a test on
Claude Code 2.1.316, with a scripted API and no real model, an `Agent` call ran in the
background without the variable, and its report reached the main session after a first
`result` line. With the variable, there is one `result` line, with the agent's report before
it. No qory run was tested. Other runtimes have no such setting, so the skill's rule stays.

An agent lists which skill to load when, with its condition, and loads nothing up front that
a step may not need. A skill that an agent needs and cannot load makes it report `blocked`.
Before the first push, a failed start, a missing report or `blocked` ends the run with
nothing pushed. After the proposal's push, the run pushes nothing more, and ends with a line
that asks the reader of the run's page to start the run again.

A workflow's run that reaches its last step runs `qory run verdict passed` after its last
push, with questions open or not. A run that stops earlier, or that its workflow's skill
ends with another line, runs no `passed`. In a run, Qory Apiary reads the open questions
first, so `passed` does not end the wait for answers. Outside a run, qory prints the verdict
and keeps it in `.qory/artifacts/verdict/`, and nothing acts on it.

## The process template, process.yaml

A module that `exports.modules` lists and that has a `process.yaml` at its folder root is
a factory. The `software-factory` module is one: its `process.yaml` is the process
template that a software-factory workspace starts with. The file sets these keys:

- `apiVersion: qory.dev/v1alpha1`, the format of the file.
- `name`, `summary` and `description`, the texts of the template: `name` has at most 60
  characters, `summary` at most 200, and `description` at most 1200 characters and 80
  words.
- `type: qory.software`, the workspace type.
- `stack: software`, the stack that declares the workflows of the process. `qory.yaml`
  lists it under `exports.stacks`.
- `process`, a `qory.process/v1` document with the stages Explore, Shape, Build, Verify
  and Release. Explore runs the workflow `explore-a-ticket` once per run, with no loop,
  and needs a `proposal`; Shape, Build, Verify and Release run no workflow. Each stage
  ends with a gate at which a member approves the result.
- `artifact_types`, an optional list of the artifact types that the template's workspaces
  use. `acceptance-criteria`, `mockup`, `screenshot`, `demo-video`, `explainer`,
  `decision-record` and `change` are standard types, each with its name alone. `branch` is
  a custom type with `base_view: structured`, `size_limit: 65536` and `max_files: 1`. Its
  `json_schema` is the content of `contracts/harness/v1/branch.schema.json` in the qory
  repository, the format of a work item's branch and the commit in each repository.
  `qory config` checks the form of each entry and that the JSON Schema compiles. qory has
  no list of standard types, so a name alone passes for any name of the right form. A
  workspace made from a template with this list shows only the standard types on the list,
  plus `proposal`, `questions`, `review-comments` and `verdict`, which no workspace can
  hide, and every other standard type is hidden. The list in this template has all seven
  standard types that can be hidden, so a workspace made from it shows every standard
  type.

`qory config` checks the file: each required key is set, the texts are within their
limits, `exports.stacks` lists the stack, and the stack declares every workflow of the
stages under `workflows`.

An approval at a gate covers, for each type in the stage's `outputs`, the newest version
made in that stage, and no other type. A later stage reads an approved version only for a
type in its `inputs`. In this template Build has no `outputs`, so no approval covers a
`branch` version, and Verify has no `inputs`, so it reads no approved version. If you add a
workflow to Build, list `branch` in Build's `outputs` and in the `inputs` of the later
stages.

## AGENTS.md

A module may ship an instruction section as `AGENTS.md` at its root. The compose joins
the `AGENTS.md` files of the stack's modules in the order of the stack, and writes the
result under the file name each runtime reads. The `core` module ships no `AGENTS.md`.

In a repository that extends the `core` stack, the compose appends the `AGENTS.md` files
of that repository's modules after the `AGENTS.md` files of the base stack's modules.

## References to other entries

When a document dispatches another composed entry, write a reference:
`${qory:skills/<name>}` for a skill, `${qory:agents/<name>}` for an agent, or
`${qory:commands/<name>}` for a command. The compose replaces the reference with the
name under which the runtime registers the entry. A program that loads the harness as a
plugin puts a prefix before every name, and there the reference resolves to the
prefixed name.

The compose reads references in agents, commands, output styles, `AGENTS.md`, and every
`.md` file under a skill's directory. If a reference selects a name that no module of the
stack ships and the stack does not bind under `bind`, the compose stops. If the text between
`${qory:` and `}` is not a reference, the compose stops, and the message contains the file
and the text.
[References](https://github.com/qoryai/qory/blob/main/contracts/harness/v1/README.md#references)
in qory's compose format specification defines the rules.

## The harness-authoring module

The `authoring` stack composes the `harness-authoring` module and, from the `core` module,
only `simple-communication`, because the stack lists
`only: {skills: [simple-communication]}`. No run composes this stack, and the `core` and
`software` stacks do not list its entries.

- `writing-agents` and `writing-skills` contain templates as fenced blocks in `SKILL.md`,
  and `writing-skills` has a template of a workflow's skill. A template shows a reference as
  `<skill reference>`, because the compose stops on a reference to a name that no module
  ships.
- `harness-reviewer` judges a change for what the script cannot: scope, least privilege,
  descriptions, whether each stated moment is the true moment, role or identity text in a
  skill, a workflow's skill that does a task itself, and text that assumes code in `core`.

To compose the stack in this repository, leave `qory.yaml` as it is and run:

```sh
qory harness compose --runtime <runtime> -f stacks/authoring/qory-stack.yaml
```

A repository that writes a harness extends the stack: write `stack: authoring` in the
`extends` block of its `qory.yaml`.

## What the script checks

`scripts/check.sh` exists only in the harness repository. It runs these rules on the files
of `modules/`. It also runs each rule on a bad file in a temporary directory, and fails if
the rule passes on that file.

1. An agent has the sections `## Guardrails`, `## Stop conditions` and `## Expected output`,
   outside its code fences and front matter.
2. An agent has a `tools` key, because an agent with no `tools` key gets every tool. The key
   lists Bash, Edit, Write, WebFetch or WebSearch only with an exception for that tool, a
   line in the agent's body outside a code fence: `Tool exception: Bash, because <reason>`.
   No agent lists `Agent`, `NotebookEdit` or `MultiEdit`, with or without an exception. A
   `*-reviewer` agent or `code-explorer` lists only Read, Grep, Glob and Skill.
   On Claude Code's native build, a `tools` key that lists Bash removes Grep and Glob, so an
   exception for Bash also drops those two tools or states how the agent searches.
3. An agent's front matter has no `model` key.
4. A list item outside a code fence that starts with a reference to a skill, such as
   `- ${qory:skills/<name>}`, states its moment. The marker of the item is `-`, `*`, `+` or
   a number, and the reference may be in a code span or bold. After the reference, and after
   further references joined by `, with`, `or`, `and`, `, or`, `, and` or a comma, a comma
   or a colon may come, and then the moment, in any case. The moment is `first`, `next` or
   `last` with a comma or a colon after it, or `before`, `after`, `when`, `while`, `once`,
   `only when`, `at the start` or `in step` with further words after it.
5. An agent, or a text file under a skill, contains no banned word. Matched by case: `PRD`.
   Matched in any case: `whitelist`, `blacklist`, `graylist`, `greylist`, `master`, `slave`,
   `sanity check`, `sanity-check`, `dummy`, `grandfathered`, `crippled`, `lame` and `gimpy`.
   The three lists also match with a hyphen, and with `-s`, `-ed` or `-ing`. `master`,
   `slave` and `sanity check` also match with `-s`, and `dummy` as `dummies`. The folder
   `modules/core/skills/simple-communication/references/` is left out, because its word list
   contains these words as examples.
6. Each skill and agent of the `core` and `software-factory` modules has its allow rule,
   `Skill(harness:<name>)` or `Agent(harness:<name>)`, in
   `modules/software-factory/settings/claude/settings.json` and in the settings composed for
   the `software` stack on `claude`. No rule is in both allow and deny, and each such rule
   under allow is for a skill or an agent that exists under `modules/`. The rule checks that
   the settings match the entries: a skill with an `allowed-tools` key needs its allow rule,
   and the list stays complete. In a test on Claude Code 2.1.316 under `dontAsk`, with a
   scripted API and no real model, a skill with no such key loaded with no allow rule, and a
   skill with the key was denied. No skill here has the key, and an agent with no allow rule
   is untested. The same settings set `env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` to `"1"`,
   and the compose report has that variable with the value `1` under `launch_env.claude`.
   `simple-communication` has no allow rule, because runs do not load it. At
   qory `17347187`, `dontAsk` and these rules reach only Claude Code, so another runtime
   needs none of them. The entries that the compose lists are the check for Codex.
7. Each workflow under a stack's `workflows` key has a skill `workflow-<name>`, and a skill
   with the plain name does not count. Each `workflow-*` skill is a workflow of a stack, and
   the `name` in its front matter equals its folder name, because qory reads no skill front
   matter.
8. A `workflow-*` skill orchestrates: it refers to no skill except `run-artifacts`, has no
   sentence outside a code fence that contains the name of another skill of `modules/`,
   starts at least one agent with a reference in the text of its `SKILL.md`, outside a code
   fence, and contains, on one line, the sentence "This workflow requires subagents." A
   one-word name counts only in a code span or next to the word "skill". The rule reads the
   skill, and checks no runtime.

Rules 4, 6, 7 and 8 read a `SKILL.md` at any depth under `skills/`, except one below a
directory that has a `SKILL.md`, which is a file of that skill. Rule 5 reads every text file
there.
