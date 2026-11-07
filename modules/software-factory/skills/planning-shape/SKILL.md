---
name: planning-shape
description: Load before you decide which small workflows a Shape run follows. Contains what to read, when each workflow runs, how a person's word maps to a workflow, what changed, where a stop goes, and how to count starts.
---

# Planning Shape

A Shape run has four small workflows, in this order: `write-specs`,
`write-technical-decisions`, `make-mockups` and `write-demo-scenarios`. List each under
"Run:", with one fact, or under "Not run:", with the reason, each in plain text with no
backticks and no asterisks. Plan only from what you read. List every workflow that the work
needs, also before a spec exists: an open question stops no workflow.

## What you read

Read the input file, the notes, the newest answers, decisions and review comments,
`index.json`, the newest `proposal`, `spec`, `acceptance-criteria`, `decision-record` and
`demo-scenarios`, and from the newest mockup only `screens.json`: its screen ids, and the
`ac-N` ids that each screen lists.

When the newest verdict that the run gives you has `verdict` `passed`, the passed run is
the `writer.run_id` of its `version` in `index.json`. In the log, an entry `lost` means
that the run no longer has what came before it.

## When each workflow runs

Before a spec exists, judge by the ticket and the proposal, and after that by the newest
spec and acceptance criteria. A workflow runs when a word concerns its output, and also:

- `write-specs`: when no spec exists, or when "A stop in the log" routes a stop to it.
- `write-technical-decisions`: when the work leaves open a choice of how to build that the
  newest record does not decide, or a criterion on a decision's "Rests on:" line changed.
- `make-mockups`: when the work changes a screen that the newest mockup lacks, or a
  criterion that a screen lists changed.
- `write-demo-scenarios`: when a criterion's planned check "Demo: <title>" has no scenario
  of that title, a scenario that is not removed has a title that no planned check names, or
  a criterion in a `Shows:` line or its planned check changed.

The reason for a workflow that does not run names the missing case. A word on one output
reruns only what depends on that output.

## Which workflow a person's word concerns

A word counts when it is an open review comment, or when none of these settled it:

- a version of the type it concerns, with a later `at`;
- a version of `spec`, `acceptance-criteria`, `decision-record`, `mockup` or
  `demo-scenarios` with a later `at`, whose `writer.kind` is `run` and whose
  `writer.run_id` is the passed run, because that run read the word. A version of another
  earlier run settles no word;
- a follow in the log of the workflow that writes the type.

1. Route a review comment by its text, to each output that it concerns. Its `on` is only a
   hint. A comment only on a type that no workflow of this run writes, such as `proposal`,
   stays open and concerns no workflow.
2. Map a note by its words. A note with an `artifact_version_id` also concerns the type of
   that `id` in `index.json`.
3. An answer or a changed decision concerns each output that its question is about.
4. List each type that a word concerns, with a fact that quotes the word. When the words
   stay unclear, list `write-specs`.

## What changed

Compare criteria by id, such as `ac-1`. Take what changed in this run from the reports in
the log. Without such a report, compare the newest `spec` and `acceptance-criteria` with
the newest version of each that the passed run wrote: an output with no later version is
current against them. With no passed run, or no version of that type from it, compare with
the largest version whose `at` is earlier than that output's `at`. List each older version
whose folder you lack under "Pull:", all at once, with `Run:` set to `- none`.

## A stop in the log

A small workflow's stop reaches you as its line. These are normal ends and no stops: "The
spec states no screen change, so the run pushed no mockup.", "No acceptance criterion is
shown in a demo, so the run pushed no demo scenarios.", and an output with no new version
because no file changed. A later follow of the stopped workflow settles the stop, and a
later push by a workflow that a route lists settles that part. Route only these:

- The spec needs a change, and a person's word asks for it: list `write-specs`, with a fact
  that quotes that word, then the stopped workflow.
- The run needs a `<type>`: list the workflow that writes it, then the stopped workflow.

Write any other stop, and a stop with no person's word behind it, after "Stop:", and list no
workflow.

## Starts

Under "Starts so far:", count each workflow and `shape-reviewer` in the log, also a start
that ended in a stop. With `lost` in the log, count for each workflow the versions of its
type whose `writer.run_id` is the run's id, for `write-specs` the larger count of `spec` and
`acceptance-criteria`, and add each entry after `lost` that pushed nothing. Leave out a
follow before `lost` that pushed nothing, also because no file changed. Count
`shape-reviewer` only after `lost`.
