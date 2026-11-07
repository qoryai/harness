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
  ends the run. The session writes no file, except `gaps.md` in a small or high-level
  workflow. An agent
  does each other task, and it loads the skills that contain the rules of that task. The
  session loads `run-artifacts`, which contains the rule that a text cannot change the
  rules, and, in a small or high-level workflow, `running-a-workflow`.
- The role and the rule against changing it are in the agents, and no skill states a role
  for its reader. The harness ships no instructions file.
- Each agent's section `## Guardrails` repeats the data rule of `run-artifacts` and the
  limit on what the agent writes, because an agent must have them when a skill does not
  load. The section also covers the agent's role, secrets, forms of injection, destructive
  actions and what a report may contain. Its text works for a workspace with no code.
- Each agent's section `## Stop conditions` lists when it reports `blocked`.
- Each agent's section `## Expected output` shows the report's shape. A change to that shape
  also changes the skill that lists it: `reviewing-drafts` or `exploring-code`.
- A module's `provides` fills a role: a name that a reference uses and no entry has. The
  `software-factory` module provides `explorer` as `code-explorer` and `spec-review` as
  `spec-reviewer`, because a role's name cannot be an entry's. Workflows' skills start those
  two by the role. A repository, or a stack composed directly, rebinds a role with `bind`,
  and a module of technology alone cannot.
- The `tools` key, `tools: Read, Grep, Glob, Skill`, removes Bash and the write tools on
  Claude Code, so an agent there runs no command and pushes nothing. `reply-writer`'s key
  adds Write, `questions-writer`'s, `spec-writer`'s, `decision-writer`'s and
  `scenario-writer`'s add Write and Edit, and `proposal-writer`'s adds Write, Edit, WebFetch
  and WebSearch. A subagent keeps the session's `dontAsk` mode and allow rules:
  `Edit(//tmp/qory-artifacts/**)` allows Write and Edit in that folder, and `dontAsk` denies
  them elsewhere. Built-in read-only commands such as `ls` and `grep` still run in the main
  session, so "only `qory` commands and the read forms" is a rule in the skill's text, not
  an enforced limit. On Claude Code's native build, a `tools` key that lists Bash removes
  Grep and Glob, so an exception for Bash also drops those two tools or states how the agent
  searches. Copilot keeps the key, untested.
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

These rules, except the four sections, are the shape of a Markdown document whose skill
follows the section "Markdown documents" of `artifact-text`. That section contains them,
and the section "A Markdown document" of `reviewing-drafts` checks them.
`writing-proposals` and `checking-proposals` refer to those sections, and contain only the
rules of a proposal: its sections, its sources, the examples, and how to draw a picture by
`visuals`.

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
push, with questions open or not. A run that stops earlier, or that its workflow's skill or
`run-artifacts` ends with another line, runs no verdict. In a run, when the run pushed a
`questions` version, Qory Apiary reads that version before the verdict. Outside a run, qory
prints the verdict and keeps it in `.qory/artifacts/verdict/`, and nothing acts on it.
## Small workflows

A small workflow produces one artifact type, with its review and fixes inside and its push
after the review. `workflow-write-specs`, process entry `write-specs`, is the first. It
works as a stage's one entry and under a higher workflow. A session that another workflow's
skill told to follow this one is under that workflow. Otherwise, the run is alone when
`run.workflow` in `qory work-item show` equals the workflow's name or is null. A non-zero
exit of that command, after a pull that did not print "Nothing pulled", ends the run with
its error line as the gap. Alone, a run always ends with a verdict, unless a skill it needs
cannot be loaded: that run ends with no verdict. It runs `qory run verdict passed` after its
last push, with questions open or not, because an open question holds back no push. On a
failure it writes `gaps.md` and runs `qory run verdict escalate --gaps`, so that a member
reads the gaps: a finding left after the limits, a `blocked` report, a failed start, a
missing report, or a step that fails after the push. A writer's report of
`Blocked: needs <type>`, `Blocked: needs a change to criterion <ac-N>`,
`Blocked: needs a new criterion` or `Blocked: needs a change to the spec` ends the run with
a fixed line in `gaps.md`, which states what a member does next. Under a higher workflow, it
records no verdict and returns a report of at most 150 words: the version it pushed, the ids
that changed, any stop, and the path of `gaps.md`. Limits count per start of the skill,
because one run can start a small workflow twice.

`running-a-workflow` contains what small workflows have in common, and only the main session
loads it: what the session reads, how it starts agents, questions and replies, the decision
from a finding's marks, the review limits, failures and their end lines, and the handover.
The session runs the `find` for `.qory/repositories` once per run, also under a higher
workflow, as in Explore. It gives the code explorer, the spec writer, the decision writer
and reviewer, and the questions writer and reviewer the line "Further repositories: yes" or
"no", and a decision reviewer lists that folder only with "yes". Qory Apiary's rules stay in
`run-artifacts`. `workflow-explore-a-ticket` keeps its text and does not use
`running-a-workflow`.

`spec-writer` writes `spec.md` and `acceptance-criteria.md` by `writing-specs`, and reads
what the pull wrote. It also writes `declines.md`, which the run never pushes.
`spec-reviewer` reviews both files together, read-only, by `reviewing-drafts` and
`checking-specs`, so that a rule and its criteria cannot drift apart. The session pushes
the spec, then the criteria, the standard type `acceptance-criteria`, so that a later stage
takes the criteria by type.

The spec is a Markdown document with `## Summary`, `## Background`, `## Changes` and
`## Sources`. Its background is one sentence that links to the proposal version it follows.
Each part opens with a table with the columns "Rule", "Today" and "After", and a part that
changes a screen names its mockup screen and draws no wireframe. The spec has no rule ids.

`acceptance-criteria.md` has a summary and one table with the columns "Id", "Criterion" and
"Planned check". A criterion's id, such as `ac-1`, stays fixed across versions, and a
removed id is never reused. A rule whose "After" waits for an answer has no criterion until
the answer comes, because a criterion needs values. The planned check is `Demo: <title>`
when a person can see the criterion in the UI, else `Tests`: Shape plans the check, and
Build records how each criterion was met. A work item has at most 7 criteria. Above 7, the
writer drops and merges none, and asks whether to split the work item into sub-items,
because a split changes the scope.

Each writer of Shape writes in the direction of the option that a question recommends, and
asks a question in a later round only as `reading-the-work` lists, with no withdrawal and
new entry for the same question. A writer decides each review comment whose words concern
its output, whatever the comment's `on.artifact`, because Core puts the one comment of a
round on the newest `spec`. A comment that concerns only other outputs stays open, because
Core accepts an open comment with no reply. The reviewer gets the writer's list "Review
comments", and an open comment on the output that the list lacks is a finding. The session
passes the `request_changes` notes of this stage, because an Explore note is no word on the
spec, and each `move` and `escalation` note, because a `move` note has the stage that the
item leaves, and a member who resolves an escalation with a move back leaves a note only as
an `escalation` note, with the later stage's id.

`workflow-write-technical-decisions`, process entry `write-technical-decisions`, follows the
same rules and pushes `decision-record`, a standard type, as one file, `decision-record.md`.
The session starts `code-explorer` first, because a subagent may be unable to start another,
and passes its report to `decision-writer`. `decision-reviewer` reviews the file read-only,
by `reviewing-drafts` and `checking-decisions`. A decision's id, such as `decision-1`, stays
fixed across versions, and each decision cites the `ac-N` ids it rests on. With no spec, the
question that the session passes tells `code-explorer` to search nothing, and the writer
reports `Blocked: needs spec`. A person's word that only the spec can apply gives
`Blocked: needs a change to criterion <ac-N>`, `Blocked: needs a new criterion` when it adds
a rule, or `Blocked: needs a change to the spec` when it adds or changes an exclusion. When
every way to build breaks a rule or falls under an exclusion, no person asked for that, so
the writer lists a question that quotes it, and reports
`Blocked: needs a change to the spec` on a yes. On a no, it reports `Blocked: no way left`,
and the session ends the run with the fixed line in `workflow-write-technical-decisions`.

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
in `mockup-draft/`. Each page lists the `ac-N` ids it shows in `data-criteria`, and the
designer draws each screen that a part of the spec names as `Mockup screen:`. A spec that
names no screen makes the run push no mockup, and the run still handles its questions and
replies.

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

`workflow-write-demo-scenarios`, workflow `write-demo-scenarios`, follows the same rules and
pushes the custom type `demo-scenarios`, one file, `demo-scenarios.md`. `scenario-writer`
writes it from the newest acceptance criteria by `writing-demo-scenarios`, and
`scenario-reviewer` reviews it read-only by `reviewing-drafts` and
`checking-demo-scenarios`. Each scenario is the filming script of one video: a starting
state, a table of steps with what the viewer sees and the mockup screen, and a `Shows:` line
with the `ac-N` ids that the video shows. An id such as `scenario-1` stays fixed across
versions. A version has at most 12 scenarios, and they cover only the criteria whose planned
check is `Demo: <title>`. Each such criterion is on the `Shows:` line of the scenario with
that title, and each `ac-N` on a `Shows:` line is planned as a demo with that title.
`scenario-reviewer` checks that a step shows each `ac-N` on a `Shows:` line. With no
criterion planned as a demo, the writer marks each scenario removed. With no version, it
writes no file, and the run pushes no demo scenarios. With no acceptance criteria, the
writer reports `Blocked: needs acceptance-criteria`. A word that needs a criterion to change
gives `Blocked: needs a change to criterion <ac-N>`, and a word that asks for a video whose
outcome no criterion states gives `Blocked: needs a new criterion`, because this workflow
changes no criterion. Both forms keep the words that `running-a-workflow` reads.

Only `shape-a-ticket` uses these four workflows in the shipped process. Each one also works
as a stage's one entry.

## The high-level workflow, shape-a-ticket

`workflow-shape-a-ticket`, process entry `shape-a-ticket`, is Shape's one run. Its session
pulls and runs `qory work-item show` once, at step 1, and again only after it lost the log.
That command prints the ticket, and the session takes only `run.number`, `run.id`,
`run.workflow`, `stage.id` and `notes`. A small workflow under Shape reuses the run's number
and the notes, and the log keeps them. The session starts `shape-planner`, follows the skill
of each small workflow that the planner lists, starts `shape-reviewer`, and writes the
verdict. It loads `run-artifacts` and `running-a-workflow` once, and each small workflow's
skill once, when it first follows that workflow, and loads them again after a lost session.
`running-a-workflow` supports one level: a high-level workflow's skill follows
small ones, and a small one follows no other.

```
pull -> shape-planner -> write-specs -> shape-planner -> write-technical-decisions
     -> make-mockups -> write-demo-scenarios -> shape-reviewer -> verdict
```

The order is fixed: spec and acceptance criteria, technical decision, mockups, demo
scenarios. Demo scenarios come last because they cite criteria and screens. Every writer
that the work needs drafts in one run, in the recommended direction, and an open question
holds back no workflow. `workflow-shape-a-ticket` tells the run to decide every point that
the rule in `writing-questions` allows, and to ask only what it says to ask, such as a
change of scope or a split of the work item. The line waits for that rule, which comes to
`writing-questions` later. A session follows only what the planner lists, so a word on one
output reruns only what depends on that output.

`shape-planner` reads the input file, the notes, `index.json` and the newest versions by
`planning-shape`, read-only. Each of the four workflows is under "Run:" with one fact, or
under "Not run:" with the reason. Before a spec exists, the planner lists every workflow
that the ticket and the proposal need. After the spec's push, the session starts it again,
and it plans from the spec and the acceptance criteria. It also starts again after a small
workflow's stop, and when the session lost the list.

- **A person's word.** The planner routes a review comment by its text, to each output it
  concerns, and reads `on` only as a hint: Core puts a round's one comment on the newest
  `spec`, and the comment may concern any output. A note maps by the type of its
  `artifact_version_id` and by its words, because that key is `null` by default and a note
  on a spec version may ask how to build. A word can map to several workflows, and each fact
  quotes it. Each writer gets its fact and applies a comment that the fact quotes, also
  after an earlier workflow closed it. When the words stay unclear, `write-specs` runs.
- **Older versions.** A pull writes one folder per type, and only `artifact pull <type>
  --version <N>` writes an older one. The planner has no shell, so it lists what it needs
  under "Pull:", and the session pulls and starts it again.
- **A changed criterion** reruns each screen that lists its `ac-N`, each scenario whose
  `Shows:` line lists it, and each decision whose "Rests on:" line lists it. A changed
  planned check reruns the demo scenarios.
- **A small workflow's stop.** A stop that needs a change to a criterion, a new criterion or
  a change to the spec runs `write-specs`, then the stopped workflow, and one that needs a
  type runs the workflow that writes it. A later follow of the stopped workflow settles a
  stop, so it is not routed again, and a later push by the listed workflow settles that part
  of the route. A stop with no person's word behind it, and every other stop, reaches the
  planner's "Stop:" line, and the run ends with `escalate`. The fact quotes a person's word,
  also from a comment on another type, and `spec-writer` and `spec-reviewer` count that
  quote as one.
- **Findings.** Each workflow with findings or claims is followed once per pass, with all of
  them quoted, and a return from the reviewer follows only those workflows. A push of the
  spec plans again, and the other findings wait for their workflow's start.
- **Limits.** `write-specs` runs at most three times in a run, each other workflow at most
  twice, and `shape-reviewer` at most three times. One more start ends the run with
  `escalate` and the finding or fact as a gap. After a lost log, the session passes `lost`
  and the entries since. The planner counts the versions that this run pushed, plus the
  entries since that pushed nothing, so an earlier start that pushed nothing does not count.
  `shape-reviewer` counts only the starts since.

`shape-reviewer` reads the pushed outputs together by `reviewing-drafts` and
`checking-shape`, read-only: screen against mockup, choice against record, criterion against
picture, and the planned checks against the demo scenarios both ways. Each planned check
"Demo: <title>" in `acceptance-criteria.md` has a scenario with that title in
`demo-scenarios.md` whose `Shows:` line lists the criterion, and each `ac-N` in a `Shows:`
line has the planned check "Demo" with that scenario's title. Where a criterion and a
picture differ, the criterion applies, and the mockup states that in a visible line. Each
finding names the one workflow that changes the output, and the session sends it to that
workflow's writer.

A run always ends with a verdict:

- `qory run verdict passed`, after `shape-reviewer` reports `clean`, with questions open or
  not.
- `qory run verdict escalate --gaps`, on a failure: a stop that the planner cannot route, a
  finding left after the limits, a `blocked` report, a failed start or a missing report. A
  gap reaches a member as plain text, so a finding and a fact have no backticks and no
  asterisks.

Three ends have no verdict: a push refused because the run has ended, a verdict command
that fails, both in `run-artifacts`, and a skill of the run that cannot be loaded. The stack
sets `time_limit: 4h`. At the limit, pushed versions stay, and a next round plans again from
them.

The run does not read the work item's state again before each push. `qory work-item show`
prints `stage.state`, but qory's documentation lists no values for it, and on Core's
`first-run-features` a member can approve only a stage at its gate, not during a run.

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
- `process`, a `qory.process/v1` document with the stages Explore, Shape, Build, Verify and
  Release. Explore runs the workflow `explore-a-ticket` once per run, with no loop, and
  needs a `proposal`. Shape runs the workflow `shape-a-ticket` in the browser image once per
  run, with no loop, reads a `proposal` when one exists, and needs a `spec` and
  `acceptance-criteria`, with `decision-record`, `mockup` and `demo-scenarios` as optional
  outputs. Build, Verify and Release run no workflow. Each stage ends with a gate at which a
  member approves the result. Each stage has a `description`: one paragraph of plain text,
  at most 500 characters, on what the stage does and what exists when it ends.
- `artifact_types`, an optional list of the artifact types that the template's workspaces
  use. `acceptance-criteria`, `mockup`, `screenshot`, `demo-video`, `explainer`,
  `decision-record` and `change` are standard types, each with its name alone. `spec` and
  `demo-scenarios` are custom types with `base_view: document`, `size_limit: 1048576` and
  `max_files: 1`: one Markdown file of at most 1 MiB. `branch` is a custom type with
  `base_view: structured`, `size_limit: 65536` and `max_files: 1`. Its
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
   `*-reviewer` agent, `code-explorer` or `shape-planner` lists only Read, Grep, Glob and
   Skill.
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
