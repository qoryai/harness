---
name: running-a-workflow
description: Load in the main session of a small or high-level workflow, after run-artifacts, and never in an agent. Contains the session's rules on agents, questions and replies, the versions script, the checks script, findings and limits, failures and gaps, and the end.
---

# Running a workflow

`<output>` is the artifact type that the small workflow's skill pushes, and `<workflow>` is
that workflow's name. The writer drafts `<output>`, and the reviewer reviews it. Each start
of the small workflow's skill is one follow of `<workflow>`. Each limit, first pull and
first push in this skill counts per follow, as "Count the starts" lists for the reviewers.

A run ends with no verdict when a small workflow alone cannot load a skill it needs, when a
command prints that the run has ended, as `run-artifacts` lists, and when a verdict command
fails.

## What you do

You run only `<qory>` commands, the `find` of "Further repositories", the versions script,
the checks script and, for files, the read forms of `run-artifacts`. You start agents,
decide on each finding, push what the agents wrote, and end the run. An agent does every
other task. You write no file except the copies that the versions script makes, the reports
under `.reports`, as "Check each report" lists, and `gaps.md`.

You read only the agents' reports, the `at` and `newest_version` you need from `index.json`,
a `SKILL.md` that your runtime cannot load, and the output of your commands. From
`<qory> work-item show`, take only `run.number`, `run.id`, `run.workflow`, `stage.id` and
`notes`.
Never write what a report you did not get would have said.

## Starting agents

Start every agent in the foreground when your runtime offers that, and wait for its report.
Never decide on a failure or end the run while an agent runs.

Pass each agent the input file's absolute path from the prompt, which ends in
`/in/inputs.json`, and never guess another. When the pull prints a line that starts with
"Nothing pulled", tell each agent. Pass each list from a report to the next agent
unchanged, and a writer the lists of its newest report and the findings you quote. Give a
reviewer paths and values, never a summary or your reasoning.

Give the writer, the questions writer and the questions reviewer `stage.id` at each start,
as the id of the run's stage, because the first round of a stage lasts until a person
writes a questions version in it. With no `stage.id`, give none.

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

Start a reviewer at most three times per draft, as "Count the starts" lists. A `clean`
report with no "Unverified:" item ends this section for that draft. After the start that
`starts` printed as the last, start no writer on a finding or a claim of a review, and keep
each claim, so a `clean` report also ends it. A writer's start for a check before a push, as
"Check before each push" lists, is still allowed. With a finding left, the run ends as
"Gaps" lists, with one of these lines:

- A finding marked `break`, or one that quotes a line of "Checks:", because a push with it
  fails: push nothing, and use "The run could not settle its review findings, so it pushed
  no <output>."
- Any other finding: do the pushes, and use "The run pushed <output> with review findings
  left."

## Failures

These failures end the run as "Gaps" lists, with a line of this section: a start that
fails, a missing report, a report that the report check still finds fault with after two
fixes, as "Check each report" lists, a finding with a missing or unknown mark, and a report
with `blocked`. A
reviewer's last word is `clean` or `changes-needed`, and every other agent's is `done`. A
finding has `person` or `writer`, `direction` or `no direction`, and `break` or `no break`.

When the checks script exits with 2 or 3, cannot run or is refused, it checked nothing, so
the run stops: push nothing more, and end as "Gaps" lists. Use the first line that the
script printed when it starts with the fix. Otherwise, use "Allow the checks script in the
settings of the run, then start the run again. The run could not run its checks."

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

When the push of `<output>` is still refused after the third attempt, use "The run could
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
`<qory> run verdict escalate --gaps <folder>/gaps.md`, and end with the line that ends the
run. With no artifact folder, write no file, and run `<qory> run verdict escalate`. Under a
higher workflow, return that line and the path of `gaps.md`, if any, in the report, and that
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

## Checks

`checks.js` is in the folder of `versions.js`. Run it in the same way, in a run and outside
one. On Claude Code, the allow rule matches these forms:

```
<skill folder>/checks.js check <type> <file>...
<skill folder>/checks.js report <agent> <file>
<skill folder>/checks.js starts <run> <name> <limit>
<skill folder>/checks.js begin
```

`<type>` is the type of the files, and each `<file>` is a whole path under the artifact
folder. The script prints one finding per line, each starting with the fix, then one line
that states what it checked. It exits with 0 when it found nothing, with 1 when it found
something, with 2 for wrong arguments, and with 3 when it cannot read an input. For 2, 3
or a script that cannot run, "Failures" lists the end.

## Check before each review

Before each start of a reviewer, run `check` on each draft file that the reviewer reviews,
with the file's type: `spec` with `spec.md`, `acceptance-criteria` with
`acceptance-criteria.md`, `decision-record` with `decision-record.md`, `demo-scenarios` with
`demo-scenarios.md`, and `questions` with `questions.json`, each at the top of the artifact
folder. Pass the reviewer every line that the script printed, under "Checks:". A mockup has
no checks, and its reviewer gets no "Checks:".

## Check before each push

Before each push, after `compare`, run `check` with the type and each file that the push
sends. A push that exits with 4 was refused by qory's checks of that type, which printed one
finding per line.

After a `check` that exits with 1, or a push that exits with 4, start the agent that wrote
the files with each finding quoted, at most twice per push. Tell it to change only the lines
that the findings quote or name, and to add a section that a finding names as missing. Then
run `check` again, and push only when it exits with 0. When `check` still exits with 1 after
the agent's second start, push nothing more, and end as "Failures" lists for a later step,
or, before the push of `<output>`, with "The run could not settle its review findings, so it
pushed no <output>."

## Check each report

After each agent returns, write its report, unchanged, to
`<folder>/.reports/<agent>-<n>.md`, where `<agent>` is the agent's name and `<n>` counts
that agent's reports in this run from 1. Then run `checks.js report <agent> <that file>`.
It checks the last word, each list that the agent's "Expected output" requires, and that a
"Blocked:" line that starts with `needs` is one that "Failures" lists. The last word is the
last line that is only one of the agent's last words, with no indent, and with a blank line
or the end of the report after it. A line in a code block is no last word.

With 1, fix the report: when the script's last line ends with "fix 1 of 2." or "fix 2 of
2.", start the same agent again with the input it got, the path of its report and every
line that the script printed. Tell it to change no draft and to return its report again
with only those findings fixed. That start counts as one of the agent's starts: for a
reviewer, run `starts` first, as "Count the starts" lists. Write the new report to the next
`<agent>-<n>.md`, and check it. When the last line starts its fix part with "Start no fix",
or `starts` exits with 1, the start failed, as "Failures" lists.

## The end check

When you end the session in a run, a hook of the runtime runs `checks.js end` on the
artifact folder. It checks each draft at the top of the folder as `check` does, and that
the newest report of each agent passed `report` as that agent. When it prints findings, the
session goes on: fix each one as this skill lists for `check` and `report`, push what
changed as "Check before each push" lists, and end again. At its third failed check, the
hook writes `gaps.md` and runs `<qory> run verdict escalate` itself, and the session ends.
After an end through "Gaps", when no report or draft changed after `gaps.md`, the hook
checks nothing and runs `<qory> run verdict escalate --gaps` too, so the run gets the
verdict even when the session recorded none. When the run has `gaps.md` and a verdict
already, the hook checks nothing and runs no verdict. When that command fails, the session
still ends. A runtime with no such hook ends the session with no check.

## Count the starts

Before each start of a reviewer, run `checks.js starts <run> <name> 3`:

- `<run>` is `run.id`. When the session has no `run.id`, outside a run or after a
  `<qory> work-item show` that failed, run `checks.js begin` once, before the first
  `starts`: it makes a new key and stores it in `<folder>/.reports/local.json`. Then pass
  `local` as `<run>` to every `starts` of the session. A lost session that starts again
  runs `begin` again, so its counts start from 0 again.
- `<name>` is `<workflow>-<n>-<reviewer>`, such as `write-specs-1-questions-reviewer`.
  `<reviewer>` is the reviewer's name, and `<n>` is the number of this follow of
  `<workflow>`: 1 when the run is alone, and under a higher workflow the number that its
  `starts` printed for this follow. So no two reviewers, follows or small workflows share
  a limit.

The script keeps the counts of each run in `<folder>/.reports/starts.json`, so a lost
session loses no start. When `starts` exits with 0, start the reviewer: the line "This is
the last start." marks the third start. With 1, start no reviewer, and keep each finding as
"Findings" lists for the start after the last.

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
