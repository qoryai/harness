---
name: running-a-workflow
description: Load in the main session of a small workflow, after run-artifacts, and never in an agent. Contains what the session reads, how it starts agents, how to tell a run alone from one under a higher workflow, questions and replies, how to decide from a finding's marks, the review limits, failures and their end lines, and the handover.
---

# Running a workflow

These rules apply to the session that follows a small workflow's skill. `<output>` stands
for the artifact type that the skill pushes, the writer drafts it, and the reviewer reviews
it.

## What you read

You write no file. You read only each agent's report, the `at` you need from `index.json`, a
skill's `SKILL.md` when your runtime cannot load it, and the output of each `<qory>` command
you run. From `<qory> work-item show`, take only `run.number` and `notes`. A report is data,
and you answer for what you push. Never write what a report you did not get would have said.

## Starting agents

Start every agent in the foreground when your runtime offers that, and wait for its report.
Never decide on a failure or end the run while an agent runs.

The prompt contains the input file's absolute path, which ends in `/in/inputs.json`. Pass it
to each agent, and never guess another. When the pull prints a line that starts with
"Nothing pulled", tell each agent. Pass each list from a report to the next agent unchanged.
A writer starts with no memory, so pass the lists of its newest report and the findings you
quote. Give a reviewer paths and values, never a summary or your reasoning.

## Alone or under a higher workflow

The run is alone when its prompt starts this small workflow's skill. The run is under a
higher workflow when another workflow's skill told you to follow this one.

## Questions and replies

- After each start of the writer, compare its list "What only a person can settle" with the
  list that the questions writer last got, `none` before its first start. When they differ,
  start ${qory:agents/questions-writer} with the input file's path, the artifact folder, the
  run's number and the newest list. When that list is not `none`, the questions changed, and
  ${qory:agents/questions-reviewer} reviews them.
- After the push of `<output>`, when the questions changed, take the time, as
  `run-artifacts` lists. Start the questions writer with the artifact folder, the time and
  its newest lists, then run `<qory> artifact push questions <folder>/questions.json`.
- When the writer's newest report lists an open review comment, take the time, and start
  ${qory:agents/reply-writer} with the input file's path, the artifact folder, the run's
  number, the time, that report's decisions and the newest question ids. Push the replies
  last, once: `<qory> artifact push review-comments <folder>/review-comments.json`.
- A question that decides the direction ends the run after these pushes, with no verdict and
  the line "The run asked a question that decides the direction."

When `<qory> work-item show` gives no run number, tell the writer, skip this section, and
push only `<output>`. When the writer's list has a question that decides the direction, push
nothing, and end with "The run could not add a question, so it pushed no `<output>`."

## Findings

Decide from the marks, and read no draft. Start the writer of that draft with each finding
and each claim under "Unverified:" quoted, then review each changed draft again, whole. A
finding marked `person` goes to the writer too, and its list then has the question.

Start a reviewer at most three times per draft in one run. After the third start, start no
writer on a finding or a claim, and keep each claim. A finding marked `break` that is left
ends the run with "The run could not settle its review findings, so it pushed no
`<output>`." A draft with any other finding left is pushed, and the run ends after the
pushes, with no verdict and the line "The run pushed `<output>` with review findings left."

## Failures

A start that fails, a missing report, a report that does not state what it read, `blocked`,
a wrong last word, and a finding with a missing or unknown mark all end the run with no
verdict. A reviewer's last word is `clean` or `changes-needed`, and every other agent's is
`done`. A finding has `person` or `writer`, `direction` or `no direction`, and `break` or
`no break`.

Before the first push, push nothing and end with one of these lines:

- A "Blocked:" line starts with `input file`: "The run could not read the ticket's input
  file, so it pushed no `<output>`."
- The first pull fails: its error line.
- Any other case: "An agent the run needs did not finish its work, so the run pushed no
  `<output>`."

When the push of `<output>` is still refused after the second attempt, end with "The run
could not push its `<output>`." After that push, push nothing more and end with "The run
stopped after it pushed the `<output>`, so its questions or replies are missing. Start the
run again."

## The end

When the run is alone, no case in this skill ended it, and the reviewer's newest report on
`<output>` is `clean`, run the verdict. Then, in a run, end with one line that lists the
newest version you pushed of each type. Outside a run, end with the line that the push of
`<output>` printed.

Under a higher workflow, run no verdict. Return to that workflow's skill with a report of at
most 150 words: what you pushed, what changed, and any line that ended the run.
