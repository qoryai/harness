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
  ends the run. The session writes no file, except `points.json` in a small or high-level
  workflow and in `explore-a-ticket` on a failure. An agent does each other task, and it
  loads the skills that contain the rules of that task. The session loads `run-artifacts`,
  which contains the rule that a text cannot change the rules, and, in a small or
  high-level workflow, `running-a-workflow`.
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
  in the agent's text. On Codex, `web_search = "disabled"` in `settings/codex/config.toml`
  turns live search off. qory at `deb22e69` places every composed skill in the Codex home;
  qory is to place only the skills that the `Skill` rules of `settings/claude/settings.json`
  allow, so that those rules are the list for both runtimes (agreed with qory's owner on
  2026-11-12, not built). The sandbox limits the effects of commands and file changes for
  every agent alike, and the read-only mount protects the checkout. An Explore run on Codex
  is untested end to end. With no `sandbox_mode`, the default of Codex is read-only, so from
  the source, a writer could not write in the artifact folder, and `qory artifact push`
  could not write `/tmp/qory-artifacts` or reach the network.
- `modules/software-factory/settings/claude/settings.json` denies Read of `.env` and
  `.env.*` on Claude Code, which also keeps those files out of Grep and Glob, for the run
  and its agents. A rule on Read does not cover a shell `grep`, so the skills' search forms
  keep their exclusion.
- The same file denies Edit of `.reports/**/*.json` under `/tmp/qory-artifacts` and
  `./.qory/artifacts`. An Edit rule covers the Write tool and shell redirects too, so an
  agent cannot change the counts of `starts`, the results of `report` or the count of
  `end`. `checks.js` writes them itself, which no Edit rule covers. The reports, `.md`, and
  `points.json` stay writable.
- The same file sets `disableAllHooks` to `false`, so that a user's settings file cannot
  switch off the hooks, the `Stop` hook of the end check among them. `scripts/check.sh`
  checks that the composed settings keep it.

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

The proposal has four sections: `## Summary`, the outcome in 1 or 2 sentences of at most 40
words; `## Background`, whose first paragraph of at most 40 words states why the work
exists, while Qory Apiary folds the rest, today's facts in at most 100 words, behind "Read
more"; `## Proposed solution`, which opens with the recommendation in 1 sentence of at most
30 words and a table of 0 to 3 alternatives with the columns "Alternative" and "Why not",
then has a `###` heading for each part of the work; and `## Sources`. Each part starts with
one picture: a Mermaid diagram for a flow or a sequence of steps, an SVG wireframe for a
screen, an email or a form, with today and after side by side, or a table with the columns
"Today" and "After" for a change of values or rules. A Today/After table has 2 to 6 rows,
each of which changes something, and a single change is one sentence instead. A part has at
most 120 words and at most three short points after its picture. Each table cell has at most
12 words, and a "Why not" cell at most 15. The proposal has at most 450 words: every word
but those of Mermaid blocks, wireframe links and `## Sources`, so tables, the whole
background, code blocks and headings count, and so does the reason of each decided question,
because members read those reasons right under the proposal. The section "Limits" of
`writing-proposals` lists these limits, and its section "Refused phrases" lists the phrases
of a reply to a comment, such as "you are correct", that the proposal never contains outside
code and text in double quotes. `checks.js` checks the counts and tables of these limits;
the writer and the reviewer judge the rest, such as one outcome per point. The proposal
states the outcome and the decisions that a person approves, in short plain points. Each
screen state, each field and each edge case belongs in the spec that Shape writes, and
`proposal-reviewer` flags such detail in a proposal as a finding marked `writer`,
`no direction` and `no break`. An edge case or a field that the ticket or an answer settles,
or that a decision rests on, stays in the proposal.

The pictures and the parts are the shape of a Markdown document whose skill follows the
section "Markdown documents" of `artifact-text`. That section contains them, and the
section "A Markdown document" of `reviewing-drafts` checks them. A skill can replace a rule
of that section for its document, and lists each rule that it replaces. For a proposal,
`writing-proposals` replaces the rules on the summary, the first paragraph of the
background, one picture under each part's heading, the reason of a part with no picture,
the points, the word limit and the rule that every other line stays byte for byte: a part
with a single change starts with that change's sentence, and a newest proposal that breaks
a limit is cut to it. `writing-proposals` and `checking-proposals`
refer to those sections, and contain the rules of a proposal: its sections, its limits, its
sources, the examples, and how to draw a picture by `visuals`.

Until a member answers a question, each run is in the first round and asks every question
that the work needs. When the session passes an agent the id of the run's stage, as every
small workflow does, the first round instead lasts until a person writes a `questions`
version in that stage: `index.json` has a `questions` version with that `stage_id` whose
`writer.kind` is not `run`. Without the stage's id, an answer from Explore would put every
Shape run in a later round. A later run asks a new question when it follows from an answer,
with that answer's question in `follows`, or when it replies to a review comment. It takes
any other point by the rule "Decide or ask": a point that the rule escalates is asked with
no `follows`, and a point that the rule lets the run decide becomes a decided question,
which the draft follows. `reading-the-work` lists these rules, and `checking-questions`
checks them.

Each writer decides or asks each open point by the rule "Decide or ask" of
`writing-questions`, in Explore and Shape alike. It asks a person only when the point
changes the scope, the cost or the direction, cannot be undone once the work is delivered,
needs a value that only a person knows, or conflicts with an answer. It lists each other
point under "Decided" in its report, and `questions-writer` adds it as a new question with
`state` `decided`: 2 to 4 options with none recommended, and `decision` with the chosen
option, a reason with the source that settled it, the run and the time. A decided question
is not open, so it stops no approval. A run that learns more withdraws the question, which
keeps `decision`, and decides again in a new one. A member changes a decision by answering
the question, and no run changes that answer. `checking-questions` lists the findings on a
decision, and the session sends each to the writer of the draft.

An answer settles what it states. An answer can state limits and give the choice back,
such as "Keep the current PostgreSQL. What do you recommend for the report tables?". The run
then chooses inside those limits and asks no question back. It adds a decided question whose
`follows` lists the answered question, with 2 to 4 options inside the limits and a reason
that cites the answer, and the draft follows that choice with no point on another answer.
What the answer does not state stays under "Decide or ask". By `reviewing-drafts`, a choice
inside the limits is no finding, and a reviewer marks a choice that breaks a limit
`person`, `direction` and `break`.

`proposal-writer` writes the proposal before `questions-writer` writes any question, and
`questions-writer` asks only where the draft proposal has a gap or a choice in it needs a
person's confirmation. The proposed solution covers each part of the work. A part that an
open question covers follows the question's recommended option, with one point on what
changes with another answer. Only a question with no recommended option leaves its part
without a solution, and only such a question decides the direction. When the work changes
something a person sees, such as a page, a dialog, a form or an email, the proposal has an
SVG wireframe of where each element and each piece of copy goes. `checking-proposals` lists
these rules, and a reviewer marks a finding on one of them `direction`, which the session
never keeps before the reviewer's third start. A line of the checks on the points or an
image of a part of the proposed solution is marked `direction` too. After that start, the
session keeps such a finding with a reason, and the run still pushes a proposal. It starts
no writer on a finding of that review, but a check before a push or a refused push still
starts the writer, which changes only the lines that the findings quote, and the check must
pass before the push.

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
push, with questions open or not. An `explore-a-ticket` run that pushes no proposal because
of a failure, before the first push, after a refused push of the proposal, on review
findings it could not settle, or with no run number, writes `points.json` with a first
point, the line that ends it, with the action `run_again`, and runs
`qory run verdict escalate --points <folder>/points.json`. A finding left after the last
review that is marked `person` becomes an open question. When the run escalates on
other review findings, it pushes those questions and adds an `answer` point for each.
Otherwise the run ends with the questions open and with `passed`. With no artifact folder,
it writes `points.json` in `/tmp/qory-artifacts`. Any other `explore-a-ticket` run that
stops earlier runs no verdict: one that stops after the proposal's push, one whose proposal
did not change, one that ends when a command prints that the run has ended, and one whose
verdict command fails. In a run, when the run pushed a `questions` version, Qory Apiary
reads that version before the verdict. Outside a run, qory prints the verdict and keeps it
in `.qory/artifacts/verdict/`, and nothing acts on it.

## Small workflows

A small workflow produces one artifact type, with its review and fixes inside and its push
after the review. `workflow-write-specs`, process entry `write-specs`, is the first. It
works as a stage's one entry and under a higher workflow. A session that another workflow's
skill told to follow this one is under that workflow. Otherwise, the run is alone when
`run.workflow` in `qory work-item show` equals the workflow's name or is null. A non-zero
exit of that command, after a pull that did not print "Nothing pulled", ends the run with
the point "The run could not read its work item." Alone, a run ends with a verdict. It ends
with none when a skill it needs cannot be loaded, when a command prints that the run has
ended, and when a verdict command fails. It runs `qory run verdict passed` after its last
push, with questions open or not, because an open question stops no push. On a failure it
writes `points.json` and runs `qory run verdict escalate --points <folder>/points.json`, so
that a member reads what the run needs from them: a finding left after the limits, a
`blocked` report, a failed start, a missing report, or a step that fails after the push.
Each point is one sentence of plain text on what is wrong or missing, with the action
`answer` or `run_again`, and Qory Apiary shows the step for the action. A finding marked
`person`, whatever its marks `direction` and `break`, becomes an open question, and its
point has `answer` and the question's id. So does a writer's report of
`Blocked: needs <type>`, `Blocked: needs a change to criterion <ac-N>`,
`Blocked: needs a new criterion` or `Blocked: needs a change to the spec`. The run pushes
those questions before the verdict. Any other finding, and a failure that another round can
fix, gets `run_again`. A point contains no file name, question id, agent name or label of a
finding: the reviewer notes stay in the run's files. Under a higher workflow, it records no
verdict and returns a report of at most 150 words: the version it pushed, the ids that
changed, any stop, and the path of `points.json`. Limits count per follow, a start of the
skill, because one run can start a small workflow twice. The session counts the starts of
each reviewer in the counts of the run, under the name `<workflow>-<n>-<reviewer>`, such as
`write-specs-1-questions-reviewer`, where `<n>` is the follow's number, 1 for a run alone.
One name for every questions reviewer would let one small workflow use up the starts of the
next.

`running-a-workflow` contains what small workflows have in common, and only the main session
loads it: what the session reads, how it starts agents, questions and replies, the decision
from a finding's marks, the review limits, failures and their end lines, and the handover.
The session runs the `find` for `.qory/repositories` once per run, also under a higher
workflow, as in Explore. It gives the code explorer, the spec writer, the decision writer
and reviewer, and the questions writer and reviewer the line "Further repositories: yes" or
"no", and a decision reviewer lists that folder only with "yes". Qory Apiary's rules stay in
`run-artifacts`. `workflow-explore-a-ticket` keeps its text and does not use
`running-a-workflow`.

A round that follows a verdict `changes-requested` of the current stage with `run_again`
points fixes those points first. The session of a run alone runs `checks.js fixes` once,
after a `qory work-item show` that exited with 0 and before the first agent starts, and
again only when it lost the output. After an exit with 1, the session passes each line that
starts with "Fix first:", quoted, ahead of the notes, wherever it passes the notes. Each
writer fixes first each point about the drafts that it writes, and each reviewer checks
that each such point about the drafts that it reviews is fixed. Under Shape, the planner
maps each line by its words, as it maps a note, each small workflow passes the lines to its
writer and reviewer, `shape-reviewer` checks that each point about the pushed outputs is
fixed, and a small workflow runs no `fixes`. A round after any other verdict, after none,
after an exit of `fixes` with 2 or 3, or after a `fixes` that cannot run or is refused runs
as before: "Failures" stops no run for this step, because the check after the round finds
the same problem again. Explore loads no `running-a-workflow`, so its rounds run no
`fixes`.

In a later round, a writer changes only the parts that a word concerns, because a writer
that drafts every file anew spends tokens on text that did not change. Before the writer's
first start, the session copies the newest version of each type that the writer drafts to
the top of the artifact folder, with `versions.js copy <type> <N>`, where `<N>` is the
type's `newest_version` in `index.json`. The writer edits those files in place, as
`reading-the-work` lists: it changes only what an answer, a review comment, a note or a
finding concerns, keeps every other line byte for byte, and never reads a file only to write
it out again. Only when the session tells it that the copy failed does the writer copy the
files with Read and Write, and its report lists each such file under "What you read:". Such
a copy can differ from the version in a byte, such as a line end, so the run may then push a
version with no change that a member sees. A proposal lists each copied wireframe that still
applies, because a version contains only the files of its push. `make-mockups` copies
nothing, because `designer` edits the pages that `pack-mockups.js --unpack` wrote.

Before each push, the session runs `versions.js compare <type> <N> <file>...` with each file
that the push would send. The script prints each file that changed, was added or was
dropped, and exits with 0 only when the draft and the version have the same files with the
same bytes, so a dropped wireframe counts as a change. The session pushes the output when
the script exits with another status or cannot run, or when the type has no version. For a
mockup it compares `screens.json` and every packed page, because the pack script writes the
same bytes for the same pages. Explore copies and compares the proposal the same way.
An output with no new version is current: the time for questions and replies is then the
largest `at` in `index.json`. A run alone that pushed nothing ends with "The <output> did
not change, so the run pushed no new version.", and under Shape such an output is no stop.
When a later step fails after no push, the line starts with "The run stopped before it
pushed its questions or replies", and claims no push. A run cannot remove a whole artifact
yet: Qory Apiary has no call for it.

`versions.js` is in the folder of `running-a-workflow`. It takes `<type>` only as lower-case
letters and hyphens and `<N>` only as digits, works only in `/tmp/qory-artifacts`, the
artifact folder of a read run (`preparation.TempStore` in qory). It exits with 1 for a
missing folder, a file outside the folder, two files with the same name, and a link where a
copy would write. `scripts/versions.test.js` tests it. The settings of `software-factory`
allow it with one rule in the form of the render script's,
`Bash($QORY_HARNESS_HOME/claude/plugin/skills/running-a-workflow/versions.js *)`, because
`dontAsk` denies a command that no rule allows. The Explore session takes the folder of
`workflow-explore-a-ticket` and puts `running-a-workflow` in place of its last name.
Untested: no run and no Claude Code test has matched this rule yet. When `compare` fails,
the session pushes, and when `copy` fails, the writer copies the files, so a failure costs
tokens, not a result. Outside a run, the artifact folder is `.qory/artifacts`, so the
session runs no versions script: the writer copies the files, and the session pushes each
output.

`checks.js`, in the folder of `running-a-workflow`, checks what needs no judgment, so a
script, not an agent's prose, decides it, and a run cannot skip it. It reads no network;
only `end` and `fixes` reach it, through qory. Of the environment it reads `HOME`, the home
folder, `end` reads `QORY_RUN_ID`, and both pass the environment to qory. The check of
machine paths refuses that folder when it has two or more parts, such as `/home/sam`, or
is `/root`. A general folder such as `/tmp`, or no `HOME`, adds no refused folder. It
writes only `.reports/starts.json`, `.reports/local.json`, `.reports/results.json`,
`.reports/end.json` and, from `end`, `points.json`. It refuses a file that is a link with
exit 3, and a draft file above 256 KB with one finding, so that no check runs long.

- `checks.js check <type> <file>...`: the session runs it on each draft before each start
  of a reviewer, and passes the output under "Checks:". It runs it again on the files of
  each push. Its files are under the artifact folder: `/tmp/qory-artifacts` in a run, else
  `.qory/artifacts`. The script takes the folder from the files' real path, so a
  `/tmp/qory-artifacts` left from an earlier run is never used for files outside it.
  `report` takes its folder the same way.
- Before the proposal reviewer, `check proposal` is a gate: `proposal-reviewer` starts only
  on a proposal whose check exits with 0. After a check with findings, the session starts
  `proposal-writer` again with the findings, at most 2 times before each review, and these
  starts use no start of the reviewer. When the check still finds something, the run pushes
  no proposal and ends with "The run could not make its proposal pass its checks, so it
  pushed no proposal." `check proposal` adds to the words of `proposal.md` the reason of
  each decided question in `questions.json` at the top of the artifact folder, else in the
  newest questions version. The fix in its finding includes a shorter reason only when this
  run decided that question, because a stored decision does not change. When
  `check proposal` cannot read `questions.json`, it counts no reason and reports nothing on
  that file, and `check questions` reports the error. `push proposal` counts `proposal.md`
  alone: qory gives that check no questions folder, and the run pushes its questions after
  the proposal, so the newest version would be out of date.
- `checks.js check points <folder>/points.json`: the session runs it before
  `qory run verdict escalate`. It checks a JSON list of 1 to 20 points, each with only
  `text`, `action` and `question`. The text is plain text of 1 to 500 characters on one
  line, in 1 sentence, ending with a full stop and stating no step, with no Markdown, label
  of a finding, question id, file name or agent name. The action is `answer` or `run_again`.
  A point `answer` has the id of an open question in `questions.json` at the top of the
  artifact folder, else in the newest version, and a point `run_again` has none. qory checks
  the same form against `contracts/harness/v1/verdict.schema.json` before it sends the
  verdict; only this check reads the questions and the words of the text.
- `checks.js push <type> <file>...`: the form that qory runs on a push. The working folder
  has the pull layout, `index.json` and `<type>/<name>/v<N>/`, and the files may lie in
  another folder, under their version names.
- `checks.js report <agent> <file>`: after each agent returns, the session writes its
  report to `<artifact folder>/.reports/<agent>-<n>.md` and checks it: the last word, each
  list that the agent's "Expected output" requires, and a `Blocked:` line that starts with
  `needs` against the lines that `running-a-workflow` lists. The last word is the last line
  that is only one of the agent's last words, with no indent, and with a blank line or the
  end of the report after it. A line in a code block is no last word. Lines after it, such
  as a list of sources, are no finding, and the script checks their lists and lines with the
  rest of the report.
  The script reads the words, lists and lines from `## Expected output` of
  `<plugin>/agents/<agent>.md`, or from the section of a skill that it names, such as "The
  report" of `reviewing-drafts`. `<plugin>` is the folder two levels above the path that
  started the script. The compose writes the script into the plugin as a link to the
  module's source, and the script keeps the link's path, so it reads the agents of every
  module. A missing agent file exits 3. The script adds each result, with the report's
  SHA-256, to `.reports/results.json`, except a check of the same bytes as the same file's
  newest entry, as the same agent, so a check run again counts no fix. With a finding,
  its last line ends with "fix 1 of 2." or "fix 2 of 2.", and the session starts the agent
  again to fix only its report. That start does not count toward the agent's start limit.
  The session runs no `starts` before it. After the third failure in a row, the line
  starts its fix part with "Start no fix", and the start counts as failed.
- `checks.js starts <run> <name> <limit>`: the session runs it before each start of a
  reviewer, each follow of a Shape workflow and each start of `shape-reviewer`, except a
  start that fixes only a report. `<run>` is the run's id, such as `run_9f4n2`, or
  `local` when the session has none. It keeps the count of each run apart in
  `.reports/starts.json`, so no count carries over to the next run and a lost session in a
  run loses no start. It exits with 1 when the next start would pass the limit, and with 3
  when a count in the file is not a whole number of 0 or more.
- `checks.js begin`: a session with no `run.id` runs it once, before its first `starts`.
  That is a session outside a run, or a run whose `qory work-item show` failed. It makes a
  new key from the time and 4 random bytes, such as `local-20261107093000-9f2c4e1a`,
  writes it to `.reports/local.json` of the artifact folder and prints it. `starts local`
  counts under that key. `begin` and `starts` both use the first artifact folder that
  exists: `/tmp/qory-artifacts` in a run, else `.qory/artifacts`. `run.id` is the same on
  every run outside a run, and the session has no clock command, so the script makes the
  key. A lost session runs `begin` again, so its counts start from 0 again.
- `checks.js fixes`: the session of a run alone runs it once, after a `qory work-item show`
  that exited with 0. It runs `work-item show` again and reads `verdict`, the work item's
  newest verdict, which can come from an earlier run or stage. The verdict counts only when
  `index.json` of the artifact folder, which the session's pull wrote, lists its
  `version.id` under the type `verdict` with a `stage_id` equal to the work item's
  `stage.id`. For such a verdict `changes-requested`, it prints "Fix first: <text>" for
  each point `run_again`, in the verdict's order, then one line on what it checked, and
  exits with 1. A point's text keeps up to 500 characters, so such a line can pass 200
  characters; a longer text ends in `...` at 500. A text with only control and refused
  characters prints no line. A verdict that is null or absent, `passed` or `escalate`, one
  of another stage, one with no entry in `index.json` or with no `index.json`, and
  `changes-requested` with no point `run_again` give exit 0 and no such line. A
  `work-item show` that fails, prints no JSON object, or prints a verdict with no `verdict`
  string or a `points` value other than a list or null gives exit 3. An absent `verdict`
  counts as null, because a `.qory/work-item.json` outside a run may have none. It uses
  `/qory/qory`, or `qory` from `PATH`, as `end` does, and writes no file.
- `checks.js end <folder>`: a hook runs it when the session tries to end. Outside a run,
  when `QORY_RUN_ID` is not set, or when the folder does not exist, it checks nothing and
  exits 0. It then runs `work-item show` for the run's id and `artifact pull verdict`. When
  the pulled `index.json` lists a version of `verdict` that this run wrote, the run has
  ended: it checks nothing and exits 0. So a Shape run that recorded its verdict ends,
  though a small workflow left a failing draft and `points.json`. With `points.json`, and no
  report `<agent>-<n>.md` and no draft at the top of the folder newer than it, the run ended
  through "Points": it checks `points.json` as `check points` does. When that passes, it
  runs `run verdict escalate --points <folder>/points.json`, ignores a failure of that
  command, and exits 0. So a session that writes `points.json` and runs no verdict still
  ends with `escalate`. A finding of `points.json` counts with the findings that follow. A
  `points.json` with a newer report or draft, such as one that a small workflow returned to
  Shape, ends nothing. Else it checks each draft at the top of the folder as `check` does,
  except a copy that has the same files and bytes as the newest version of its type. It
  checks that the newest report `<agent>-<n>.md` of each agent passed `report`, as that
  agent, with the text it has now, and that each agent that `starts.json` counts has a
  report: the name itself, such as `proposal-reviewer`, or the part after `<workflow>-<n>-`.
  A `results.json` or `starts.json` that cannot be read is a finding. With a finding, it
  exits 1. It counts its failed checks in `.reports/end.json`, and a passing check sets the
  count to 0. An `end.json` that cannot be read, or whose count is not a whole number of 0
  or more, counts as the last check. At the third, it writes `points.json`, runs
  `run verdict escalate --points <folder>/points.json`, and exits 0. It writes one point
  `run_again` for each kind of problem, such as "The draft of the spec still breaks 2 format
  rules.", with no agent name and no step for the session. When `points.json` exists, `end`
  keeps each of its points that passes the check of a point, and adds its points after them.
  With more than 20 in all, it keeps the first 19 and adds one point: "The run ended with
  drafts or reports that still break their format rules." These commands use `/qory/qory`,
  or `qory` from `PATH` when `/qory/qory` does not exist.

The hook runs `checks.js end` through an adapter in `modules/software-factory/hooks/`,
which the compose places at `$QORY_HARNESS_HOME/hooks/`. `end-gate.js` picks the folder:
`/tmp/qory-artifacts` when `QORY_RUN_ID` is set and the folder exists, else the first
`.qory/artifacts` up to the folder with `.git`. The walk starts at `CLAUDE_PROJECT_DIR`
when it is set, else at the session's working folder, so a session in a subfolder checks
the checkout's folder. Claude Code sets `CLAUDE_PROJECT_DIR` to the project folder, and
Gemini CLI sets it to the session's working folder.
`end-gate.js` loads `checks.js` and runs its `end` in a separate node process. When
`checks.js` throws, at load or while it runs, a missing file included, that process exits 4
and prints the fix first: "Send this error to the harness maintainers: the end check
crashed, so the session ended without checking its drafts and reports.", then the error's
first line and its stack. A crash writes no `points.json`. Without exit 4, node exits 1
for a script that does not load, the status of findings, and the session goes on without
a count of failed checks. Each runtime's adapter turns exit 1 into what that runtime reads,
and lets the session end on any other status:

| Runtime | Fragment | Event | How the session goes on |
|---|---|---|---|
| Claude Code | `settings/claude/settings.json` | `Stop` | exit 2, findings on stderr |
| Gemini CLI | `settings/gemini/settings.json` | `AfterAgent` | `decision: deny`, `reason` |
| Cursor | `settings/cursor/hooks.json` | `stop` | `followup_message` |
| Copilot CLI | `settings/copilot/hooks.json` | `agentStop` | `decision: block`, `reason` |
| Codex | `settings/codex/config.toml` | `Stop` | exit 2, findings on stderr |

On Claude Code and Codex, an end at the third check prints the findings as
`systemMessage`, which the runtime shows to the user. On Codex, the adapter also prints a
check that failed itself as `systemMessage` and exits 0, because Codex drops stderr on exit
0. On Cursor, the adapter checks only a stop whose `status` is `completed`, so a session
that the user stopped, or that failed, ends with no check.

Only Claude Code and Codex are tested: on Claude Code 2.1.319, a `Stop` hook that exits 2
keeps a headless `claude -p` session going. On Codex 0.167.2, a `Stop` hook in
`$CODEX_HOME/config.toml` that exits 2 keeps a `codex exec` turn going, and
`QORY_HARNESS_HOME` reaches the hook. A hook in `$CODEX_HOME` runs only when its hash is
trusted. qory is to write this hook's `trusted_hash` into the run's read-only
`config.toml` and start Codex without `--dangerously-bypass-hook-trust`, because that flag
also trusts hooks that the agent writes. qory at `deb22e69` writes no `trusted_hash` yet,
so the hook does not run.
The other three follow their documentation. Cursor's
[hooks page](https://cursor.com/docs/hooks) does not say whether these hooks run in
`cursor-agent`, the Cursor CLI; its [CLI changelog](https://cursor.com/docs/cli/changelog)
lists stop hooks from January 2026. Copilot CLI reads the hook only from `.github/hooks` of
the checkout, which a compose with links writes. OpenCode has no hook that keeps a
headless `opencode run` going, and Amp and Goose render no hooks, so these runtimes end
with no check.

Only `checks.js` writes the `.json` files under `.reports/`. On Claude Code, the settings
deny `Edit` of `//tmp/qory-artifacts/.reports/**/*.json`, `/.qory/artifacts/...` and
`./.qory/artifacts/...`. A rule that starts with `/` is relative to its settings source:
for the project's `.claude/settings.json` and for the settings that qory passes inline in
a run, that is the folder where the session started; a `./` rule is relative to the
current folder ([permissions](https://code.claude.com/docs/en/permissions)). On the other
three runtimes, `reports-guard-<runtime>.js` runs before each tool call, through
`reports-guard.js`, and only in a run. It denies a write, edit or delete of a path under
`.reports/` that ends in `.json`, and a shell command that reaches `.reports` and does more
than run `checks.js`. The guard splits the command into words in Node and runs no shell. A
command reaches `.reports` when:

- its text contains `.reports`;
- a word contains `.reports` as the shell reads it: with its quotes and backslashes
  removed, each backslash and the line break after it dropped, each `$'...'` decoded, and
  a `~` at its start read as `HOME`, `~+` as the working folder and `~-` as `OLDPWD`, as in
  `'.rep''orts'` and `$'.\x72eports'`;
- a word with an unquoted `*`, `?`, `[` or `{`, or a folder part of that word, matches a
  path under `.reports`, as in `.rep*`, `.r?ports` and `{.reports,x}`;
- it has `$`, a backtick or `eval`, and also a `.r` with no letter, digit or `_` before
  it, as at the start of a path part. So `d=.rep; cat $d/x` is denied, and
  `grep -n "foo$" src/b.rs` and `cat foo.rs $X` pass. This rule also denies an ordinary
  command, such as `ls $HOME/.rustup`.

`fs.globSync` expands a glob from the working folder of the command, which the hook's
input contains: `cwd`, and on Gemini CLI also `tool_input.dir_path`. A `**` counts as `*`,
as in bash without `globstar`, so no glob walks a whole tree. The guard denies a word with
a glob when `fs.globSync` throws on it, such as "pattern is too long", which bash still
expands, and when the word starts with another `~name`, such as `~voldy`. It denies a word
that starts with `~-` when `OLDPWD` is not set. `fs.globSync` exists from Node 22; on an
older Node, the guard denies each word with a glob.

The first line of a deny for the last three cases is "Leave .reports/ to checks.js, and
name other files with no `$`, backtick, eval or glob." The second line contains the part of
the command that reaches `.reports`. A command still reaches the folder past the guard
through a variable built without `.r`, or with a `.r` after a letter, digit or `_`, as in
`d=x.rep; cat ${d#x}orts/starts.json`, `shopt -s dotglob`, `find` or `cp -r` of the parent
folder, a glob after a `cd` in the command, `python -c`, or a script that it writes to a
file and then runs. Each hook has a timeout of 10 seconds. A guard that crashes or runs
past it lets the call run on Cursor and Copilot CLI: both fail open. On Cursor, the guard
never prints `allow`, for the reason in the paragraph after the list of hooks. The hooks:

- Gemini CLI: the `BeforeTool` hook, for `write_file`, `replace` and `run_shell_command`.
  It denies with `decision: deny` and `reason`.
- Cursor: the `preToolUse` hook for `Write` and `Delete`, and the `beforeShellExecution`
  hook for a command that the guard can deny: one with `.r`, `*`, `?`, `[`, `{`, `$`, a
  backtick, a quote, a backslash, `~` or `eval`. So an ordinary command, such as
  `git status`, starts no hook. It denies with `permission: deny` and exit code 2.
- Copilot CLI: the `preToolUse` hook, for `create`, `edit`, `apply_patch`,
  `str_replace_editor`, `bash` and `powershell`, and for `write_bash` and
  `write_powershell`, which type text into a running shell. It denies with
  `permissionDecision: deny` and `permissionDecisionReason`.

On a call that the guard does not deny, the Cursor adapter prints nothing and exits 0. It
never prints `permission: allow`, because
[Cursor's hooks page](https://cursor.com/docs/agent/hooks) does not say whether `allow`
skips Cursor's approval prompt and allowlist. The same page states that exit code 2 blocks
the call, and that a hook that fails, with no output among the failures, lets the call run
unless `failClosed` is true. The hooks leave `failClosed` off, so a pass runs the call.
Copilot CLI documents no argument names for `create`, `edit`, `apply_patch`, `write_bash`
and `write_powershell`. So the guard reads every argument of a write except the text that
the tool writes, and checks each string argument of `write_bash` and `write_powershell` as
a shell command.

Gemini CLI removes from a hook's environment each variable that is not on an allow list
when `GITHUB_SHA` is set or `SURFACE` is `Github`
([configuration](https://geminicli.com/docs/reference/configuration)). So
`settings/gemini/settings.json` adds to `security.environmentVariableRedaction.allowed`
the variables that the hooks and qory read in a run: `QORY_RUN_ID`, `QORY_RUN_API`,
`QORY_HARNESS_HOME`, and `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` in both cases, through
which qory reaches the gateway. Gemini CLI passes `PATH` and `HOME` by default.

The types are `proposal`, `spec`, `acceptance-criteria`, `decision-record`,
`demo-scenarios`, `questions` and `review-comments`. A check reads the newest version of
its own type for ids, and the newest version of the types it relates to: `demo-scenarios`
reads the criteria, `decision-record` the criteria and the questions, and `review-comments`
the questions and `index.json`. A type with no version counts as empty. A type with two
names and no `main`, a version folder without its file, an `index.json` that contradicts
itself, and `review-comments` with no `index.json` exit 3. The checks:

- sections, parts and the form of each criterion, scenario and decision, as the writing
  skills state them;
- the limits of a proposal that the section "Limits" of `writing-proposals` lists: a summary
  of 1 or 2 sentences and at most 40 words, a first paragraph of the background of at most
  40 words and at most 100 words after it, a recommendation of 1 sentence and at most 30
  words, a table of 1 to 3 alternatives or none, at most 120 words and 3 points per part, a
  Today/After table of 2 to 6 rows that each change something, with no "After" cell that
  states no change, such as "Unchanged" or "The same as today", at most 12 words per cell
  and 15 per "Why not" cell, and at most 450 words with the reasons of the decided
  questions; and the refused phrases of `writing-proposals`, outside `## Sources`, code
  blocks, code spans and text in double quotes;
- the other limits: at most 450 words in a spec and a decision record, a summary of 1 to 3
  sentences in a spec, the criteria and the scenarios, at most 3 points per part in a spec,
  a criterion of 1 sentence and at most 25 words, at most 8 steps per scenario and 12
  scenarios, in a new question a `question` of one sentence of 1 to 500 characters with no
  Markdown, a `context` of 1 to 20000 characters and at most 120 words, an option `title`
  of 1 to 200 characters and an `explanation` of 1 to 2000 characters and at most 2
  sentences, a `decision.reason` of at most 2 sentences and 40 words when it is new or
  differs from the newest questions, and a new reply of at most 80 words;
- ids: `ac-N`, each criterion, decision and scenario id once and not renumbered or reused
  against the newest version, one scenario per title, a decided question's id above every
  id of the newest questions, and the ids that `follows`, "Rests on:", "Question:",
  `Shows:` and a reply cite; "Rests on: no criterion yet." only on an open decision;
- the states of the questions, as Qory Apiary checks them on a push: a new question is
  `open` with no `decision`, or `decided` with `decision.run` equal to `asked.run`. A
  question of the newest version does not become `decided`, and keeps its `decision`, or
  its lack of one. A question with a `decision` keeps its `question` and `options` in every
  state, and a question that stays answered or decided keeps its `context`;
- each entry of the questions, the review comments, the replies and the sources is a JSON
  object;
- the proposal's `## Sources`: only list items, or only the line "No public page and no
  file.", and the same pages and files as `sources.json`; and each `file` ref;
- the refused characters and control characters of `artifact-text`, each link and image,
  `.qory/repositories`, and a path of the machine the run is on: `/tmp/qory-artifacts`,
  `/qory/`, `/workspace/`, a folder of `.qory`, a home folder by `~/`, `/Users/<name>/`,
  `/home/agent/` (the home folder in qory's agent image), the home folder of the user that
  runs the script, from `HOME` (only with two or more parts, or `/root`), and
  `/var/folders/`. A general top folder such as `/run/`, `/lib/` or `/tmp/` is no such
  path, and neither is another folder under `/home/`, so an app route such as
  `/home/orders/12` or `/run/12` passes. A route in a code span is no such path when the
  span has a method, such as `GET /home/orders/12`, or a link of the text has the route.

A line is one finding that starts with the fix, of at most 200 characters, with no control
character, and a quote from a draft of at most 80 characters. At most 50 findings are
printed, then one line with the number left out. The last line states what the script
checked, and names only the checks that ran. Above 7 criteria, `checking-specs` asks for a
split, so the count goes on the last line and is no finding. It exits with 0 with no finding, 1 with findings, 2 for
wrong arguments and 3 for an input it cannot read. With 2 or 3, or when the script cannot
run, the session stops and ends with `escalate`, so a check that cannot run never passes.
With 1 before a push, the session sends the findings to the writer. A finding of the checks
left after the last review start ends the run like one marked `break`, because a push with
it fails. Each checking skill lists what the checks cover, and its reviewer judges the
rest. `scripts/checks.test.js` breaks each rule in a copy of the testdata and watches the
check fail. The settings allow the script with one rule,
`Bash($QORY_HARNESS_HOME/claude/plugin/skills/running-a-workflow/checks.js *)`. Untested: no
run has matched this rule yet.

A module states the checks that qory runs on a push under `push_checks`: one entry per
type, with the command and the types that the check reads. For `demo-scenarios`:

```yaml
push_checks:
  - type: demo-scenarios
    command: [skills/running-a-workflow/checks.js, push, demo-scenarios]
    reads: [acceptance-criteria]
```

`decision-record` reads `[acceptance-criteria, questions]`, `review-comments` reads
`[questions]`, and the other four types read nothing. A module without `push_checks` pushes
with no check. `software-factory` declares one entry for each of the seven types, and none
for `verdict`, which qory refuses. qory runs the checks in a walled run only. A push that
they refuse exits with 4, with the findings, and the session sends them to the writer and
pushes once more. `review-comments` reads only the questions folder, because qory writes the
whole `index.json` for every check. `approved_version` in `index.json` is a version id, such
as `av_prop2`, as the run API sets it.

`spec-writer` writes `spec.md` and `acceptance-criteria.md` by `writing-specs`, and reads
what the pull wrote. It also writes `declines.md`, which the run never pushes.
`spec-reviewer` reviews both files together, read-only, by `reviewing-drafts` and
`checking-specs`, so that a rule and its criteria cannot drift apart. The session pushes
the spec, then the criteria, the standard type `acceptance-criteria`, so that a later stage
takes the criteria by type. It checks the two files apart and pushes each only when it
changed.

The spec is a Markdown document with `## Summary`, `## Background`, `## Changes` and
`## Sources`. Its background is one sentence that links to the proposal version it follows.
Each part opens with a table with the columns "Rule", "Today" and "After", and a part that
changes a screen names its mockup screen and draws no wireframe. The spec has no rule ids.

`acceptance-criteria.md` has a summary and one table with the columns "Id", "Criterion" and
"Planned check". A criterion's id, such as `ac-1`, stays fixed across versions, and a
removed id is never reused. `spec-reviewer` checks that no criterion is renumbered: the text
of an `ac-N` never moves to another id. A rule whose "After" waits for an answer has no
criterion until the answer comes, because a criterion needs values. The planned check is
`Demo: <title>` when a person can see the criterion in the UI, else `Tests`: Shape plans the
check, and Build records how each criterion was met. A work item has at most 7 criteria.
Above 7, the writer drops and merges none, and asks whether to split the work item into
sub-items, because a split changes the scope.

Each writer of Shape writes in the direction of the option that a question recommends or
that the run decided, and asks a question in a later round only as `reading-the-work` lists,
with no withdrawal and new entry for the same question. A writer decides each review comment
whose words concern its output, whatever the comment's `on`. A comment from **Run another
round** has `on` set to `{"run": N}`, the run whose round the member commented on, and can
concern every output of the stage. A comment that concerns only other outputs stays open,
because Qory Apiary accepts an open comment with no reply. The reviewer gets the writer's
list "Review comments" and the planner's fact. An open comment on the output that the list
lacks is a finding. The reviewers of the spec, decisions, mockups and demo scenarios also
flag a closed comment that the fact quotes when the draft does not apply the part on its
output that the last reply left open. The session passes the `request_changes` notes of this
stage, because an Explore note is no word on the spec, and each `move` and `escalation`
note, because a `move` note has the stage that the item leaves, and a member who resolves an
escalation with a move back leaves a note only as an `escalation` note, with the later
stage's id.

`workflow-write-technical-decisions`, process entry `write-technical-decisions`, follows the
same rules and pushes `decision-record`, a standard type, as one file, `decision-record.md`.
The session starts `code-explorer` first, because a subagent may be unable to start another,
and passes its report to `decision-writer`. `decision-reviewer` reviews the file read-only,
by `reviewing-drafts` and `checking-decisions`. A decision's id, such as `decision-1`, stays
fixed across versions, and each decision cites the `ac-N` ids it rests on. Its item
"Question:" has the id of its question in `questions.json`, whose options are the ways the
writer considered, so the record lists no other way. When a member answers a decided
question, the writer changes that decision to follow the answer. Every open choice differs
in what it costs later, so the writer decides a difference in cost too, unless only a person
can accept that cost. The record has no "Spec version:" line: a record that did not change
gets no new version, so such a line would force a push or go stale. The writer and the
reviewer check each decision against the criteria it rests on in every start, and
`checking-shape` checks each `ac-N` on a "Rests on:" line against the newest criteria. With
no spec, the question that the session passes tells `code-explorer` to search nothing, and
the writer reports `Blocked: needs spec`. A person's word that only the spec can apply gives
`Blocked: needs a change to criterion <ac-N>`, `Blocked: needs a new criterion` when it adds
a rule, or `Blocked: needs a change to the spec` when it adds or changes an exclusion. When
every way to build breaks a rule or falls under an exclusion, no person asked for that, so
the writer lists a question that quotes it, and reports
`Blocked: needs a change to the spec` on a yes. On a no, it reports `Blocked: no way left`,
and the session ends the run with the fixed line in `workflow-write-technical-decisions`, as
an `answer` point: a question asks whether the spec changes.

`workflow-make-mockups`, process entry `make-mockups`, follows the same rules for a
clickable mockup. `code-explorer` reports the target's styles, and `designer` writes one
HTML page per screen in `mockup-pages/` by `designing-mockups`. Then `designer` runs two
scripts of that skill:

1. `pack-mockups.js` writes the version to `mockup-draft/`: one self-contained page per
   screen, `<screen id>.html`, and `screens.json`. It puts each `.css` sheet of the
   checkout into a `<style>`, and each PNG, JPEG, GIF or WebP picture and each font into
   the page as a `data:` address, when the file's extension and first bytes name the same
   type. From such a sheet it drops each `@import` and `url()` that it cannot put into the
   page: a hosted address, a missing file, a file with a secret name, or a file of another
   type, such as an SVG file. It also drops each declaration or rule that the pack
   refuses, such as `-webkit-image-set()` or `behavior`. It prints
   `Dropped: <what> in <sheet>` for each, and exits with 0 when nothing else fails. It
   makes each `data-to="<screen id>"` a link to that screen's page. `screens.json` is
   `{start, screens: [{id, title, file, criteria, links: [{to, label}]}]}`, with no
   coordinates and no pictures. The script fails on a page with a script, an attribute
   that starts with `on`, a `javascript:` address, a frame, a form, `<object>`, `<embed>`,
   `<base>`, `<meta http-equiv>`, an SVG file as an image, an address in the page outside
   the version other than a `data:` picture, a `data-to` with no such screen, or a screen
   that cannot be reached from the start screen. Qory Apiary checks the same rules again
   when the run pushes the version. The script reads files only in the checkout and in
   `/tmp/qory-artifacts`, by each file's real path, and reads no file of the checkout with
   a secret name, such as `.env`, `.git`, a private key or a credentials file. The
   checkout is the nearest folder from the working folder upwards with a `.git` entry,
   found without git, so that a git setting such as `core.worktree` has no effect. It is
   never the root of the disk or a folder that contains the home folder of the user's
   account. Outside a checkout, each `{{checkout}}` address is a finding. The script reads
   a page or a file of a version only as a plain file, not through a link. It exits with
   1 on findings, 2 on a wrong argument or folder, and 3 when a file cannot be read;
   `designer` then stops with `blocked`. `--unpack` writes the pages of a version back to
   an empty `mockup-pages/`, and `--check=<dir>` checks a packed version.
2. `render-mockups.js` renders each packed page to a picture in `mockup-render/`, with
   JavaScript and the network off, and runs the styling tests. The pictures are for
   `mockup-reviewer` only, and the run pushes none. The script exits with 3 when the run's
   image has no Chromium at `/usr/bin/chromium`, and the run then escalates with the text
   for a run with no browser. A page fails when a marked element has only the browser's
   default styles, unless the page has the line for styling derived from sources. A colour
   counts as styling when it differs from the tag's default; for a tag that inherits its
   colour, which is any tag but a link, a button or a form field, it must also differ from
   the parent's computed value. The underline counts when it differs from the tag's
   default. So a menu link with `color: inherit; text-decoration: none` counts as styled. A
   failure names a marked element by its tag, target and label, cut to 80 characters with
   no control character.

`mockup-reviewer` reads each picture in `mockup-render/`, each page in `mockup-pages/` and
`mockup-draft/screens.json`, and works through the check list of `checking-mockups`. It
searches a packed page only for a check that needs it, because the page has its sheets and
pictures inside. The run pushes `screens.json` and the packed pages. A member sees the
start screen in a frame on the version page of Qory Apiary. A click on a linked element
opens its screen, and a list of screen titles beside the frame opens any screen. Each page
lists the `ac-N` ids it shows in `data-criteria`, and the designer draws each screen that a
part of the spec names as `Mockup screen:`. A spec that names no screen makes the run push
no mockup, and the run still handles its questions and replies.

`designer` lists Bash for the two mockup scripts alone. On Claude Code 2.1.316 under
`dontAsk`, in a test with a scripted API, the allow rule of the render script matched the
script's whole path, also in a subagent. It denied `node <path>`, a variable in the path, a
redirect, a command substitution and a second command. The allow rule of the pack script
has the same form, and that test did not run it. Each script is executable and lies in the
skill's folder, and Claude Code states that folder when the skill loads. Only
the text of `designer.md` limits this Bash to the scripts: qory's rules for a read run also
allow Bash for `artifact`, `run verdict` and `work-item` on `/qory/qory`, the settings allow
the versions and checks scripts of `running-a-workflow`, and those rules reach `designer`.

The settings of `software-factory` deny `Edit` under `mockup-draft/` and under
`mockup-render/`, also for `Write`. qory's text states that an Edit rule covers Write and
that a deny wins (`readDeny` in `cmd/settings_inline.go`). The same test confirms this for
2.1.316 under `mockup-draft/`: with qory's read rules added, both tools failed there, also
directly under the artifact root, and passed under `mockup-pages/`, and the script still
ran. The deny under `mockup-render/` has the same form, and that test did not run it.

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
stops no workflow. `workflow-shape-a-ticket` tells the run to decide every point that the
rule "Decide or ask" of `writing-questions` allows, and to ask only what a person must
answer by it, such as a change of scope or a split of the work item. A session follows only
what the planner lists, so a word on one output reruns only what depends on that output.

`shape-planner` reads the input file, the notes, `index.json` and the newest versions by
`planning-shape`, read-only. Each of the four workflows is under "Run:" with one fact, or
under "Not run:" with the reason. Before a spec exists, the planner lists every workflow
that the ticket and the proposal need. After a push of the spec or the criteria, the session
starts it again, and it plans from the spec and the acceptance criteria. It also starts
again after a small workflow's stop, and when the session lost the list.

- **A person's word.** The planner routes a review comment by its text, to each output it
  concerns. For a comment on one output, the planner reads the type in `on` only as a hint.
  A comment from **Run another round** has `on` set to `{"run": N}`, the run whose round
  the member commented on. The planner routes it to the workflow of the output that it
  names, or else to each workflow whose output it fits. A note maps by the type of its
  `artifact_version_id` and by its words, because that key is `null` by default and a note
  on a spec version may ask how to build. A word can map to several workflows, and each fact
  quotes it. Each writer gets its fact and applies a comment that the fact quotes. When an
  earlier workflow closed the comment, the writer applies the part on its output, unless the
  last reply declined, answered or asked about that part. For "rename the button, and use a
  queue instead of cron", `spec-writer` may decline the button, and `decision-writer` still
  applies the queue. When the words stay unclear, `write-specs` runs.
- **Older versions.** A pull writes one folder per type, and only
  `artifact pull <type> --version <N>` writes an older one. The planner has no shell, so it
  lists what it needs under "Pull:", and the session pulls and starts it again.
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
- **Settled words.** A word counts for a workflow until a later version of its type, a later
  version of a Shape output that the passed run wrote, or a follow of that workflow in the
  log settles it. The passed run is the run that recorded the work item's newest verdict,
  when that verdict is `passed`. `verdict` from `qory work-item show` has the verdict and
  its `version`, with `id` and `number`. The verdict is a version of the type `verdict` in
  `index.json`, and its `writer.run_id` is the passed run. A version of another earlier run
  settles no word: with a Shape run that pushed spec v3 and escalated, and an Explore run
  that passed after it, spec v3 settles no word on a mockup. A run that passed read every
  word, and an output that it left with no new version is current, so a word that it already
  read does not rerun its workflow in each later round. Without a report in the log, the
  planner compares the newest spec and criteria with the newest versions that the passed run
  wrote, and else with the largest version older than the output.
- **Findings.** Each workflow with findings or claims is followed once per pass, with all of
  them quoted, and a return from the reviewer follows only those workflows. A push of the
  spec or the criteria plans again, and the other findings wait for their workflow's
  start.
- **Limits.** `write-specs` runs at most three times in a run, each other workflow at most
  twice, and `shape-reviewer` at most three times. One more start ends the run with
  `escalate`, and the finding or fact becomes a point, as for a finding left. The session
  counts each follow and start with `checks.js starts <run> <name> <limit>`, where `<run>`
  is `run.id`, or `local` when the session has none. A start that fixes only a report does
  not count toward the agent's start limit. The script keeps the counts of each run in the
  artifact folder, so a lost log loses no start. The number of a follow names the reviewers'
  counts for that follow, such as `write-specs-2-spec-reviewer`, because the review limits
  count per follow.

`shape-reviewer` reads the pushed outputs together by `reviewing-drafts` and
`checking-shape`, read-only: screen against mockup, choice against record, criterion against
page, and the planned checks against the demo scenarios both ways. Each planned check
"Demo: <title>" in `acceptance-criteria.md` has a scenario with that title in
`demo-scenarios.md` whose `Shows:` line lists the criterion, and each `ac-N` in a `Shows:`
line has the planned check "Demo" with that scenario's title. Where a criterion and a
mockup page differ, the criterion applies, and the mockup states that in a visible line.
Each finding names the one workflow that changes the output, and the session sends it to
that workflow's writer.

A run ends with one of these verdicts, except in the two ends that the paragraph after the
list names:

- `qory run verdict passed`, after `shape-reviewer` reports `clean`, with questions open or
  not.
- `qory run verdict escalate --points <folder>/points.json`, on a failure: a stop that the
  planner cannot route, a finding left after the limits, a `blocked` report, a failed start
  or a missing report. On a "Stop:" line after a small workflow's `points.json`, the run
  passes that file on. A point reaches a member as plain text, so it has no backticks and
  no asterisks.

Two ends have no verdict, both in `run-artifacts`: a push that fails because the run has
ended, and a verdict command that fails. When a skill of the run cannot be loaded, the
session ends the run with `escalate` and "The run could not load the rules it needs." The
stack sets `time_limit: 4h`. At the limit, pushed versions stay, and a next round plans
again from them.

The run does not read the work item's state again before each push. `qory work-item show`
prints `stage.state`, but qory's documentation lists no values for it, and on Qory Apiary's
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
  needs a `proposal`. Shape runs the workflow `shape-a-ticket` once per run, with no loop,
  reads a `proposal` when one exists, and needs a `spec` and `acceptance-criteria`, with
  `decision-record`, `mockup` and `demo-scenarios` as optional outputs. Build, Verify and
  Release run no workflow. Each stage ends with a gate at which a member approves the
  result. Each stage has a `description`: one paragraph of plain text, at most 500
  characters, on what the stage does and what exists when it ends.
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

`machine:` sets the machine type that a workflow runs on, by the type's key on the Qory
Apiary instance. `machine:` under `process` sets the type for every workflow of the process.
`machine:` on an entry of a stage's `sequence` sets the type for that entry's workflow, in
place of the process's type. A machine type sets only the size of the machine. Every run
uses the standard image, which has Chromium, so the render of a mockup needs no
`machine:` entry. This template sets `machine: default` under `process` and on no entry.
`default` is a reserved word and no key: it means the instance's default machine type, so
it works on every instance. `qory config` does not check `machine:`.

If the instance has no machine type with a key that the file sets, each workflow that uses
the key runs on the instance's default type. The workflow's settings on the stage form then
show a notice with the missing key next to the **Machine type** picker, where a person picks
a type.

When an instance admin changes a key, Qory Apiary updates the workspaces, templates and
waiting runs that use the key. Before the admin saves, the form lists each file that a
workspace was made from and that uses the key, by repository, module path and commit, for a
person to fix. If a file stays unfixed, a new workspace made from it uses the default type
for that key, with the same notice next to the **Machine type** picker on the stage form.

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
   `designer`'s exception for Bash states `pack-mockups.js` and `render-mockups.js`, and
   the settings of `software-factory` allow Bash only for those scripts and for
   `versions.js` and `checks.js`, the versions and checks scripts of `running-a-workflow`,
   and deny `Edit` under `mockup-draft/` and `mockup-render/`.
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
   qory `17347187`, `dontAsk` and these rules reach only Claude Code. qory is to place only
   the skills that the `Skill` rules allow in a Codex home (not built at qory `deb22e69`),
   so the rule is to check that list for Codex too; until then, the entries that the compose
   lists are the check for Codex. A compose for Codex also writes `web_search = "disabled"`
   and the `Stop` hook into `config.toml`, which the script checks.
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
9. The testdata in `modules/software-factory/testdata/` passes `checks.js push` for each
   type, in a copy that has version 1 of the acceptance criteria and the questions. The
   questions also pass in a copy whose version 1 has only `q1`, `q2` and `q4`, so that the
   limits of new questions run on the others.
   `scripts/checks.test.js` also checks that each note of `notes.json` has `null` or a
   version id of `index.json`.
10. Each citation `<skill> (SKILL.md:<from>-<to>: "<quote>")` in `checks.js` names a skill
    under `modules/`, each range lies inside that skill's `SKILL.md`, and the quote is in
    one of the ranges. The rule joins the lines of a range with single spaces, so a quote
    may cross a line break. A citation with no quote fails the rule, and so does each
    `(SKILL.md:` that is no whole citation on one line.

Rules 4, 6, 7 and 8 read a `SKILL.md` at any depth under `skills/`, except one below a
directory that has a `SKILL.md`, which is a file of that skill. Rule 5 reads every text file
there.

The script also runs `scripts/pack-mockups.test.js`, `scripts/render-mockups.test.js`,
`scripts/versions.test.js`, `scripts/checks.test.js` and rule 9 with `node`, and exits 1 at
its start with an instruction to install `node` when `node` is missing. These tests start
no browser.
