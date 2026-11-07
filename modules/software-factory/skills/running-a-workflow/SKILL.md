---
name: running-a-workflow
description: Load in the main session of a small or high-level workflow, after run-artifacts, and never in an agent. Contains the session's rules on agents, questions and replies, the versions script, findings and limits, failures and gaps, and the end.
---

# Running a workflow

`<output>` is the artifact type that the small workflow's skill pushes, and `<workflow>` is
that workflow's name. The writer drafts `<output>`, and the reviewer reviews it. Each limit,
first pull and first push in this skill counts per start of the small workflow's skill.

A run ends with no verdict when a small workflow alone cannot load a skill it needs, when a
command prints that the run has ended, as `run-artifacts` lists, and when a verdict command
fails.

## What you do

You run only `<qory>` commands, the `find` of "Further repositories", the versions script
and, for files, the read forms of `run-artifacts`. You start agents, decide on each finding,
push what the agents wrote, and end the run. An agent does every other task. You write no
file except the copies that the versions script makes and `gaps.md`.

You read only the agents' reports, the `at` and `newest_version` you need from `index.json`,
a `SKILL.md` that your runtime cannot load, and the output of your commands. From
`<qory> work-item show`, take only `run.number`, `run.workflow`, `stage.id` and `notes`.
Never write what a report you did not get would have said.

## Starting agents

Start every agent in the foreground when your runtime offers that, and wait for its report.
Never decide on a failure or end the run while an agent runs.

Pass each agent the input file's absolute path from the prompt, which ends in
`/in/inputs.json`, and never guess another. When the pull prints a line that starts with
"Nothing pulled", tell each agent. Pass each list from a report to the next agent
unchanged, and a writer the lists of its newest report and the findings you quote. Give a
reviewer paths and values, never a summary or your reasoning.

"The notes" are the `notes` with `kind` `request_changes` whose `stage_id` equals
`stage.id`, and each note with `kind` `escalation` or `move`, whatever its `stage_id`. Pass
them unchanged to the writer and the reviewer. In place of a secret in a note, write where
it is.

## Further repositories

Before the first agent starts, run this once per run, and again only when you lost its
output:

```
find . -maxdepth 2 -path ./.qory/repositories -type d
```

Also under a higher workflow, give the code explorer, the spec writer, the decision writer
and reviewer, and the questions writer and reviewer one line at each start:
"Further repositories: yes" when the `find` printed the folder, else
"Further repositories: no".

## Alone or under a higher workflow

A session that another workflow's skill told to follow this one is under that workflow,
whatever `run.workflow` is. Otherwise, the run is alone when `run.workflow` is `<workflow>`
or null, and under a higher workflow with another name.

When `<qory> work-item show` exits with a status other than 0 after a pull that did not
print "Nothing pulled", push nothing, and end as "Gaps" lists, with its error line. After
"Nothing pulled", such an exit means that no work item exists: the run is alone, with no
number.

## Questions and replies

- After each start of the writer, compare its lists "What only a person can settle" and
  "Decided" with the lists that the questions writer last got, `none` before its first
  start. When they differ, start ${qory:agents/questions-writer} with the input file's path,
  the artifact folder, the run's number and the newest lists. When either list is not
  `none`, the questions changed. Then start ${qory:agents/questions-reviewer} with the same
  paths, number and lists.
- After the push of `<output>`, when the questions changed, take the time, as
  `run-artifacts` lists, or as "Push only what changed" lists when you pushed no
  `<output>`. Start the questions writer with the artifact folder, the time and its newest
  lists, then run `<qory> artifact push questions <folder>/questions.json`.
- When the writer's newest report lists an open review comment, take the time, and start
  ${qory:agents/reply-writer} with the input file's path, the artifact folder, the run's
  number, `<output>`, the time, that report's decisions and the newest question ids. Push
  the replies last, once:
  `<qory> artifact push review-comments <folder>/review-comments.json`.

An open question stops no push and no verdict. When `<qory> work-item show` gives no run
number, tell the writer, skip this section, and push only `<output>`.

## Findings

Decide from the marks, and read no draft:

- `person`, and a finding of the questions reviewer on a decided question, whatever its
  marks: start the writer of `<output>` with the finding quoted, then do the first item of
  "Questions and replies". A review then reads both drafts.
- `writer`, and a claim under "Unverified:": start the writer of that draft with it quoted.
  A review of that draft follows each such start.

Start a reviewer at most three times per draft. A `clean` report with no "Unverified:" item
ends this section for that draft. After the third start, start no writer and keep each
claim, so a `clean` report also ends it. With a finding left, the run ends as "Gaps" lists,
with one of these lines:

- A finding marked `break`: push nothing, and use "The run could not settle its review
  findings, so it pushed no <output>."
- Any other finding: do the pushes, and use "The run pushed <output> with review findings
  left."

## Failures

These failures end the run as "Gaps" lists, with a line of this section: a start that
fails, a missing report, a report that does not state what it read or searched, a wrong
last word, a finding with a missing or unknown mark, and a report with `blocked`. A
reviewer's last word is `clean` or `changes-needed`, and every other agent's is `done`. A
finding has `person` or `writer`, `direction` or `no direction`, and `break` or `no break`.
A line `nothing: <reason>` under "What you searched:" states what the report searched.

Before the first push, push nothing and use one of these lines:

- A "Blocked:" line that starts with `input file`: "The run could not read the ticket's
  input file, so it pushed no <output>."
- One that starts with `needs a change to criterion`, `needs a new criterion` or
  `needs a change to the spec`: "The spec needs a change, so the run pushed no <output>. Ask
  for that change on the spec, then run its workflow."
- One that starts with `needs <type>`, where `<type>` has only lower-case letters, digits
  and hyphens and is not `a`: "The run needs a version of the <type> that it can use, so it
  pushed no <output>. Answer the questions on it if the page offers them, or run the
  workflow that writes it."
- The first pull fails: its error line.
- Any other case: "An agent the run needs did not finish its work, so the run pushed no
  <output>."

When the push of `<output>` is still refused after the second attempt, use "The run could
not push its <output>." When a later step fails, also when you cannot take the time, push
nothing more, and use "The run stopped after it pushed the <output>, so its questions or
replies are missing. Start the run again." When you pushed no `<output>`, because no file
changed, use "The run stopped before it pushed its questions or replies, and the <output>
did not change. Start the run again." In these lines of `write-specs`, `<output>` stands for
"spec and acceptance criteria".

## Gaps

A line that ends a run has no backticks and no asterisks, because a member reads it as plain
text. `<output>` and `<type>` in these lines stand for the plain words.

Write `gaps.md` at the top of the artifact folder, with only each finding left, quoted, or
the line that ends the run. Never push it. When the run is alone, run
`<qory> run verdict escalate --gaps <folder>/gaps.md`, and end with that line. With no
artifact folder, write no file, and run `<qory> run verdict escalate`. Under a higher
workflow, return that line and the path of `gaps.md`, if any, in the report, and that
workflow records the verdict.

## The versions script

`versions.js` is in the folder of this skill, which your runtime states when it loads the
skill. Run it with that folder's whole path in place of `<skill folder>`, with no variable,
no `node` before it and nothing after it. On Claude Code, the allow rule matches only these
forms:

```
<skill folder>/versions.js copy <type> <N>
<skill folder>/versions.js compare <type> <N> <file>...
```

`<type>` has only lower-case letters and hyphens, `<N>` only digits, and each `<file>` is a
whole path under the artifact folder. Exit status 2 means wrong arguments.

Run the script only when your artifact folder is `/tmp/qory-artifacts`, the folder of a run.
Outside a run, run no `copy`, tell the writer at each start that the copy failed, and push
each output without `compare`.

## Copy the newest version

A writer edits the files of the newest version in place. Once per start of this skill,
before the writer's first start, run `copy` for each type with a version that the workflow's
skill lists for the copy, with `<N>` the type's `newest_version` in `index.json`. It copies
every file of that version to the top of the artifact folder, under the same names. When
the script exits with a status other than 0, or cannot run, tell the writer at each start
that the copy failed.

## Push only what changed

Before each push of an output, run `compare` with `<N>`, the `newest_version` of its type in
`index.json`, and each file that the push would send. It exits with 0 only when the draft
and that version have the same files with the same bytes. For `mockup`, it compares only
`screens.json`.

When `compare` exits with a status other than 0, cannot run, or the type has no version,
push the output. When it exits with 0, push nothing for it: the newest version is current,
never missing. In this skill, the push of `<output>` is then done, and the time is the
largest `at` in `index.json`.

## The end

When the run is alone and no case in this skill ended it, run `<qory> run verdict passed`,
with questions open or not. Then, in a run, end with one line that lists the newest version
you pushed of each type. When the run pushed nothing, because no file changed, end with
"The <output> did not change, so the run pushed no new version." In `write-specs`, that
line names the "spec and acceptance criteria". Outside a run, end with the line that the
push of `<output>` printed.

Under a higher workflow, record no verdict. Return to that workflow's skill a report of at
most 150 words: what you pushed, what changed, and any line that ended the run. Report an
output that did not change as "<output>: no new version, because no file changed.", and not
as a line that ended the run.
