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
  ends the run. The session writes no file, except `gaps.md` in a small workflow. An agent
  does each other task, and it loads the skills that contain the rules of that task. The
  session loads `run-artifacts`, which contains the rule that a text cannot change the
  rules, and, in a small workflow, `running-a-workflow`.
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
  adds Write, `questions-writer`'s, `spec-writer`'s, `decision-writer`'s and
  `feature-writer`'s add Write and Edit, and `proposal-writer`'s adds Write, Edit, WebFetch and WebSearch. A subagent keeps the
  session's `dontAsk` mode and allow rules: `Edit(//tmp/qory-artifacts/**)` allows Write and
  Edit in that folder, and `dontAsk`
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

Every proposal is reviewed before the run pushes it. `proposal-writer` drafts it, and
`proposal-reviewer` reviews the draft, by the skills `reviewing-drafts` and
`checking-proposals`. `questions-writer`, `questions-reviewer` and `checking-questions` do
the same for the questions whenever they change. The session decides on each finding and
pushes after the review. `reply-writer` drafts the replies, and the session pushes them
last.

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
push, with questions open or not. In Qory Apiary at `a33a15856`, a finished run with no
verdict shows the stopped card, and the questions that a run pushed come before its verdict.
Explore has no exception. A small workflow has one: a question that decides the direction
writes no verdict, because Core reads this run's open questions first and the run's result
waits on the answer. Only `spec` has a reduced form while such a question is open: "What
changes for people" has only the sentence that the direction depends on the answers, plus
the required line. The rest of the spec stays. A run that stops earlier runs no `passed`.
Outside a run, qory prints the verdict and keeps it in `.qory/artifacts/verdict/`, and
nothing acts on it.

## Small workflows

A small workflow produces one artifact type, with its review and fixes inside and its push
after the review. `workflow-write-specs`, process entry `write-specs`, is the first. It
works as a stage's one entry and under a higher workflow. A session that another workflow's
skill told to follow this one is under that workflow. Otherwise, the run is alone when
`run.workflow` in `qory work-item show` equals the workflow's name or is null. A non-zero
exit of that command, after a pull that did not print "Nothing pulled", ends the run with
its error line. Alone, the run runs `qory run verdict passed` after its last push, except
after a question that decides the direction. With a finding left after the limits, or a
`blocked` report, it writes `gaps.md` and runs `qory run verdict escalate --gaps`, so that a
member reads the gaps. When the run also pushed an open question, Core reads the questions
first, so a member sees them and no gap for that round. A writer's report of
`Blocked: needs <type>`, `Blocked: needs a change to rule <id>` or
`Blocked: needs a new rule` ends the run with a fixed line in `gaps.md`, which states what a
member does next. Under a higher workflow, it runs no verdict and returns a report of at
most 150 words: the version it pushed, the rule ids that changed, any stop, and the path of
`gaps.md`. Limits count per start of the skill, because one run can start a small workflow
twice.

`running-a-workflow` contains what small workflows have in common, and only the main session
loads it: what the session reads, how it starts agents, questions and replies, the decision
from a finding's marks, the review limits, failures and their end lines, and the handover.
Qory Apiary's rules stay in `run-artifacts`. `workflow-explore-a-ticket` keeps its text and
does not use `running-a-workflow`.

`spec-writer` writes a version's one file, `spec.md`, by `writing-specs`, and reads what the
pull wrote. It also writes `declines.md`, which the run never pushes. `spec-reviewer`
reviews `spec.md` read-only, by `reviewing-drafts` and `checking-specs`. A rule's id, such
as `must-1`, stays fixed across versions. A spec with an open question that decides the
direction is still pushed, because a question's `at` is the time of a pushed version. The
writer withdraws each open question of an earlier run that the spec depends on and adds it
anew, because a member cannot answer it and Core counts only the questions that this run
pushed. A small workflow's writer decides only on comments on its type. A comment on another
type stays open, because Core accepts an open comment with no reply. The session passes the
`request_changes` notes of this stage, because an Explore note is no word on the spec, and
each `move` and `escalation` note, because a `move` note has the stage that the item leaves,
and a member who resolves an escalation with a move back leaves a note only as an
`escalation` note, with the later stage's id.

`workflow-write-technical-decisions`, process entry `write-technical-decisions`, follows the
same rules and pushes `decision-record`, a standard type, as one file, `decision-record.md`.
The session starts `code-explorer` first, because a subagent may be unable to start another,
and passes its report to `decision-writer`. `decision-reviewer` reviews the file read-only,
by `reviewing-drafts` and `checking-decisions`. A decision's id, such as `decision-1`, stays
fixed across versions, and each decision cites the spec's rule ids it rests on. With no
spec, or a spec whose choices wait for answers, the question that the session passes tells
`code-explorer` to search nothing, and the writer reports `Blocked: needs spec`. A person's
word that only the spec can apply gives `Blocked: needs a change to rule <id>`, or
`Blocked: needs a new rule` when it adds a rule, or adds or changes an exclusion. When every
way to build breaks a rule or falls under an exclusion, no person asked for that, so the
writer lists a question that quotes it, and reports one of those two forms on a yes. On a
no, it reports `Blocked: no way left`, and the session ends the run with the fixed line in
`workflow-write-technical-decisions`.

`workflow-make-mockups`, process entry `make-mockups`, follows the same rules for a
clickable mockup. `code-explorer` reports the target's styles, `designer` writes the HTML
pages by `designing-mockups` and runs `render-mockups.js`, and `mockup-reviewer` reads each
picture and works through the check list of `checking-mockups`. Only that script writes the
pictures and `screens.json`. The
script runs with JavaScript off, with the network off, and reads files only in the working
folder and `/tmp/qory-artifacts`, by each file's real path. It reads no path with a secret
name in any folder, such as `.env`, `.git`, a private key or a credentials file. It exits
with 3 when `/usr/bin/chromium` is missing, and the run then escalates with the text for a
run with no browser. A refusal, a failed render and the limit of 300 s each leave no picture
in `mockup-draft/`. A spec with no screen change makes the run push no mockup, and the run
still handles its questions and replies.

`designer` lists Bash for this script alone. On Claude Code 2.1.316 under `dontAsk`, in a
test with a scripted API, the allow rule matched the script's whole path, also in a
subagent. It denied `node <path>`, a variable in the path, a redirect, a command
substitution and a second command. So the script is executable and lies in the skill's
folder, and Claude Code states that folder when the skill loads. Only the text of
`designer.md` limits this Bash to the script: qory's rules for a read run also allow Bash
for `artifact`, `run verdict` and `work-item` on `/qory/qory`, and those rules reach
`designer`.

The settings of `software-factory` deny `Edit` under `mockup-draft/`, also for `Write`.
qory's text states that an Edit rule covers Write and that a deny wins (`readDeny` in
`cmd/settings_inline.go`). The same test confirms this for 2.1.316: with qory's read rules
added, both tools failed under `mockup-draft/`, also directly under the artifact root, and
passed under `mockup-pages/`, and the script still ran.

`workflow-write-test-features`, workflow `write-test-features`, follows the same rules and
pushes the custom type `test-features`, one file, `test-features.md`. `feature-writer`
writes it from the newest spec by `writing-test-features`, and `feature-reviewer` reviews it
read-only by `reviewing-drafts` and `checking-test-features`. Each scenario has an id, such
as `scenario-1`, that stays fixed across versions, and cites the rule ids and the screens it
covers. A rule that no step shows is a finding. With no spec, a spec whose direction is
open, or a spec with every rule removed, the writer reports `Blocked: needs spec`, because a
scenario rests on settled rules. A person's word that needs a rule to change, a note that
asks for words in a rule that the newest spec does not state, or a rule's wording that lets
no step show it gives `Blocked: needs a change to rule <id>`, because an answer reruns this
workflow and this workflow changes no spec. A rule that already states those words gives no
stop. A word that asks for a case whose outcome no rule states, and that "What stays as it
is" does not list, gives `Blocked: needs a new rule`. Neither stop applies when a later word
of a person settles that rule, because an old note would otherwise block each later run. The
writer withdraws each open question about the features that they depend on and
adds it anew, because Core counts only the questions that this run pushed. A question that
only the spec can apply stays out.

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
   `designer`'s exception for Bash states `render-mockups.js`, and the settings of
   `software-factory` allow Bash only for that script and deny `Edit` under `mockup-draft/`.
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
8. A `workflow-*` skill orchestrates: it refers to no skill except `run-artifacts`,
   `running-a-workflow` and `workflow-*` skills, has no sentence outside a code fence that
   contains the name of another skill of `modules/`, starts at least one agent with a
   reference in the text of its `SKILL.md`, outside a code fence, and contains, on one line,
   the sentence "This workflow requires subagents." A one-word name counts only in a code
   span or next to the word "skill". `running-a-workflow` refers to no skill except
   `run-artifacts`, has no skill name with a hyphen outside a code fence except
   `run-artifacts`, no agent loads it, and no text of `modules/core` contains the word
   `software-factory`. The rule reads the skill, and checks no runtime.

Rules 4, 6, 7 and 8 read a `SKILL.md` at any depth under `skills/`, except one below a
directory that has a `SKILL.md`, which is a file of that skill. Rule 5 reads every text file
there.

The script also runs `scripts/render-mockups.test.js` with `node`, and exits 1 at its start
with an instruction to install `node` when `node` is missing. These tests start no browser.
