---
name: planning-shape
description: Load before you decide which small workflows a Shape run follows. Contains the fixed order, when each workflow runs, how a person's word maps to a workflow, how to find what changed, where a small workflow's stop goes, and how to count starts.
---

# Planning Shape

A Shape run has four small workflows, in a fixed order: `write-specs`,
`write-technical-decisions`, `make-mockups` and `write-demo-scenarios`. The spec and its
acceptance criteria come first, because the other outputs rest on them. List each workflow
under "Run:", with one fact, or under "Not run:", with the reason. Plan only from what you
read.

Every writer that the work needs drafts in this run, in the recommended direction. So list
each workflow that the work needs, also before a spec exists. An open question holds back
no workflow.

## What you read

- `index.json` in the artifact folder: each version's `id`, `number`, `at` and
  `writer.run_id`.
- The newest `proposal`, `spec`, `acceptance-criteria`, `decision-record` and
  `demo-scenarios`, and from the newest mockup only `screens.json`: its screen ids, and the
  `ac-N` ids that each screen lists.
- The input file, the notes, the newest answers and decisions, and the review comments.
- The log: each small workflow that this run followed, with its report, and each start of
  `shape-reviewer`. An entry `lost` means that the run no longer has what came before it.

## When each workflow runs

Before a spec exists, judge by the ticket and the proposal, and after that by the newest
spec and acceptance criteria. A workflow runs when a word concerns its output, and also:

- `write-specs`: when no spec exists, or when "A stop in the log" routes a stop to it.
- `write-technical-decisions`: when the work leaves open a choice of how to build that the
  newest record does not decide, or a part of the spec that a decision rests on changed.
- `make-mockups`: when the work changes a screen that the newest mockup lacks, or a
  criterion that a screen lists changed.
- `write-demo-scenarios`: when a criterion's planned check "Demo: <title>" has no scenario
  of that title, a scenario has a title that no planned check names, or a criterion in a
  `Shows:` line or its planned check changed.

The reason for a workflow that does not run names the case that is missing, such as that no
screen changes, or that every planned check is "Tests". A word on one output reruns only
what depends on that output.

## Which workflow a person's word concerns

A word counts when its `at` is later than the `at` of the newest version of the type it
concerns, or when it is an open review comment.

1. Route a review comment by its text, to each output that it concerns. Read its `on` only
   as a hint: a round's one comment is on the newest spec, and may concern any output. A
   comment only on a type that no workflow of this run writes, such as `proposal`, stays
   open and concerns no workflow.
2. Map a note by its words. A note with an `artifact_version_id` concerns the type of that
   `id` in `index.json` too.
3. An answer or a changed decision concerns each output that its question is about.
4. A word can concern several types: list each, with a fact that quotes the word. When the
   words stay unclear, list `write-specs`.

## What changed

A criterion keeps its id, such as `ac-1`, so compare by id. Take what changed from the
reports in the log. Without such a report, compare the newest `spec` and
`acceptance-criteria` with the versions that an output rests on: "Spec version:" in the
record, else the largest version whose `at` is earlier than that output's `at`. List each
older version whose folder you lack under "Pull:", all at once, with `Run:` set to `- none`.

## A stop in the log

A small workflow's stop reaches you as its line. "The spec states no screen change, so the
run pushed no mockup." and "No acceptance criterion is shown in a demo, so the run pushed no
demo scenarios." are normal ends and no stops. A later follow of the stopped workflow
settles the stop, and a later push by a workflow that a route lists settles that part.
Route only these:

- The spec needs a change, and a person's word asks for it: list `write-specs`, with a fact
  that quotes that word, then the stopped workflow. The spec's writer and reviewer count
  that quote as a person's word.
- The run needs a `<type>`: list the workflow that writes it, then the stopped workflow.

Write any other stop, and a stop with no person's word behind it, after "Stop:", and list no
workflow.

## Starts

Under "Starts so far:", count each workflow and `shape-reviewer` in the log, also a start
that ended in a stop. With `lost` in the log, count the versions of the first type that a
workflow pushes, such as `spec`, whose `writer.run_id` is the run's id, plus each entry
after `lost` that pushed nothing. Count `shape-reviewer` only after `lost`, because it
pushes nothing.

Each fact and each reason is plain text with no backticks and no asterisks, because it can
reach a member as a gap.
