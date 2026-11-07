---
name: running-a-workflow
description: Load in the main session of a small or high-level workflow, after run-artifacts, and never in an agent. Contains the session's rules on agents, questions and replies, findings and limits, failures and gaps, and the end.
---

# Running a workflow

`<output>` stands for the artifact type that the small workflow's skill pushes, `<workflow>`
for that workflow's name, the writer drafts `<output>`, and the reviewer reviews it. Each
limit in this skill, and each case of a first pull or a first push, counts per start of the
small workflow's skill.

A run always ends with a verdict: `passed` after its pushes, as "The end" lists, or
`escalate` on a failure, as "Gaps" lists. Under a higher workflow, that workflow records it.

## What you do

You run only `<qory>` commands, the `find` of the section "Further repositories", the
`diff` of the section "Push only what changed" and, for files, the read forms of
`run-artifacts`, start agents, decide on each finding, push what the agents wrote, and end
the run. An agent does every other task. You write no file, with one exception: `gaps.md`,
as the section "Gaps" lists.

You read only each agent's report, the `at` and the `newest_version` you need from
`index.json`, a skill's `SKILL.md` when your runtime cannot load it, and the output of each
command you run. From
`<qory> work-item show`, take only `run.number`, `run.workflow`, `stage.id` and `notes`.
Never write what a report you did not get would have said.

## Starting agents

Start every agent in the foreground when your runtime offers that, and wait for its report.
Never decide on a failure or end the run while an agent runs.

The prompt contains the input file's absolute path, which ends in `/in/inputs.json`. Pass it
to each agent, and never guess another. When the pull prints a line that starts with
"Nothing pulled", tell each agent. Pass each list from a report to the next agent unchanged.
Pass a writer the lists of its newest report and the findings you quote. Give a reviewer
paths and values, never a summary or your reasoning.

"The notes" are the `notes` with `kind` `request_changes` whose `stage_id` equals
`stage.id`, and each note with `kind` `escalation` or `move`, whatever its `stage_id`. Pass
them unchanged to the writer and the reviewer. If a note contains a secret, write where it
is in its place.

## Further repositories

qory creates `.qory/repositories` only when the run has further repositories. Before the
first agent starts, run this once per run, and again only when you lost its output:

```
find . -maxdepth 2 -path ./.qory/repositories -type d
```

Also under a higher workflow, give the code explorer, the spec writer, the decision writer
and reviewer, and the questions writer and reviewer one line at each start:
"Further repositories: yes" when the `find` printed the folder, else
"Further repositories: no".

## Alone or under a higher workflow

A session that another workflow's skill told to follow this one is under that workflow,
whatever `run.workflow` is. Otherwise, the run is alone when `run.workflow` equals
`<workflow>` or is null. With another name, it is under a higher workflow.

When `<qory> work-item show` exits with a status other than 0 after a pull that did not
print "Nothing pulled", push nothing, and end as "Gaps" lists, with its error line. After a
pull that printed "Nothing pulled", such an exit means that no work item exists: the run is
alone, with no number.

## Questions and replies

- After each start of the writer, compare its list "What only a person can settle" with the
  list that the questions writer last got, `none` before its first start. When they differ,
  start ${qory:agents/questions-writer} with the input file's path, the artifact folder, the
  run's number and the newest list. When that list is not `none`, the questions changed.
  Then start ${qory:agents/questions-reviewer} with the input file's path, the artifact
  folder, the run's number and that list.
- After the push of `<output>`, when the questions changed, take the time, as
  `run-artifacts` lists, or as "Push only what changed" lists when you pushed no
  `<output>`. Start the questions writer with the artifact folder, the time and its newest
  lists, then run `<qory> artifact push questions <folder>/questions.json`.
- When the writer's newest report lists an open review comment, take the time, and start
  ${qory:agents/reply-writer} with the input file's path, the artifact folder, the run's
  number, `<output>`, the time, that report's decisions and the newest question ids. Push
  the replies last, once:
  `<qory> artifact push review-comments <folder>/review-comments.json`.

An open question holds back no push and no verdict. When `<qory> work-item show` gives no
run number, tell the writer, skip this section, and push only `<output>`.

## Findings

Decide from the marks, and read no draft:

- `person`: start the writer of `<output>` with the finding quoted, then do the first item
  of "Questions and replies". A review then reads both drafts.
- `writer`, and a claim under "Unverified:": start the writer of that draft with it quoted.
  A review of that draft follows each such start.

Start a reviewer at most three times per draft. A `clean` report with no "Unverified:" item
ends this section for that draft. After the third start, start no writer, and keep each
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

- A "Blocked:" line starts with `input file`: "The run could not read the ticket's input
  file, so it pushed no <output>."
- A "Blocked:" line starts with `needs a change to criterion`, `needs a new criterion` or
  `needs a change to the spec`: "The spec needs a change, so the run pushed no <output>. Ask
  for that change on the spec, then run its workflow."
- A "Blocked:" line starts with `needs <type>`, and `<type>` has only lower-case letters,
  digits and hyphens and is not `a`: "The run needs a <type> it can use, so it pushed no
  <output>. Answer the questions on it if the page offers them, or run the workflow that
  writes it."
- The first pull fails: its error line.
- Any other case: "An agent the run needs did not finish its work, so the run pushed no
  <output>."

When the push of `<output>` is still refused after the second attempt, use "The run could
not push its <output>." When a later step fails, also when you cannot take the time, push
nothing more, and use "The run stopped after it pushed the <output>, so its questions or
replies are missing. Start the run again."

## Gaps

A member reads each line that ends a run as plain text, so it has no backticks and no
asterisks. `<output>` and `<type>` in these lines stand for the plain words.

Write `gaps.md` at the top of the artifact folder. It contains only each finding left,
quoted, or the line that ends the run. Never push it. When the run is alone, run
`<qory> run verdict escalate --gaps <folder>/gaps.md`, and end with that line. With no
artifact folder, write no file, and run `<qory> run verdict escalate`. Under a higher
workflow, return that line and the path of `gaps.md`, if any, in the report, and that
workflow records the verdict.

## Push only what changed

A writer edits a copy of the newest version, so a file that nothing concerns stays the same.
Push an output only when its files differ from the newest version that the pull wrote.
Before each push of an output, take `<N>`, the `newest_version` of its type in `index.json`.
Compare each file that the push would send with the file of the same name in that version,
one command per file:

```
diff -q <file to push> <folder>/<type>/main/v<N>/<file name>
```

Exit status 0 means that the two files are the same. When a `diff` exits with 1 or 2, when
it cannot run, or when the type has no version, push the output. When every file is the
same, push nothing for it: the newest version is current, never missing. In this skill, the
push of `<output>` is then done, and the time is the largest `at` in `index.json`.

## The end

When the run is alone and no case in this skill ended it, run `<qory> run verdict passed`,
with questions open or not. Then, in a run, end with one line that lists the newest version
you pushed of each type. When the run pushed nothing, because no file changed, end with
"The <output> did not change, so the run pushed no new version." Outside a run, end with
the line that the push of `<output>` printed.

Under a higher workflow, record no verdict. Return to that workflow's skill with a report
of at most 150 words: what you pushed, what changed, and any line that ended the run. An
output that did not change is no line that ended the run: report it as "<output>: no new
version, because no file changed."
