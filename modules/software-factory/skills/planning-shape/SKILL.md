---
name: planning-shape
description: Load before you decide which small workflows a Shape run follows. Contains what to read, when each workflow runs, how a person's word maps to a workflow, what changed, and where a stop goes.
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

- `write-specs`: when no spec exists, when a person's word asks for a screen that the newest
  spec does not list as `Mockup screen:`, until a follow of `write-specs` after the word's
  `at` (rule 4 of "Which workflow a person's word concerns"), or when "A stop in the log"
  routes a stop to it.
- `write-technical-decisions`: when the work leaves open a choice of how to build that the
  newest record does not decide, or a criterion on a decision's "Rests on:" line changed.
- `make-mockups`: when the work changes a screen that the newest mockup lacks, or a
  criterion that a screen lists changed.
- `write-demo-scenarios`: when a criterion's check "Demo: <title>" has no scenario of that
  title, a scenario that is not removed has a title that no criterion's check names, or a
  criterion in a `Shows:` line or its check changed.

The reason for a workflow that does not run names the missing case. A word on one output
reruns only what depends on that output. A word that asks for a screen that the newest spec
does not list as `Mockup screen:` depends on the spec too: it reruns `write-specs`, then
`make-mockups`, until a follow of `write-specs` after the word's `at`.

## Which workflow a person's word concerns

A word counts when it is an open review comment, or when none of these settled it:

- a version of the type it concerns, with a later `at`;
- a version of `spec`, `acceptance-criteria`, `decision-record`, `mockup` or
  `demo-scenarios` with a later `at`, whose `writer.kind` is `run` and whose
  `writer.run_id` is the passed run, because that run read the word. A version of another
  earlier run settles no word;
- a follow in the log of the workflow that writes the type.

1. Route a review comment by its text, to each output that it concerns. In an output
   comment, the type in `on` is only a hint. A round comment, with `on` set to
   `{"run": N}`, can concern every output of the stage: when it names one output, route it
   to the workflow of that output, and otherwise to each workflow whose output it fits. An
   output comment only on a type that no workflow of this run writes, such as `proposal`,
   stays open and concerns no workflow. Rule 4 adds `write-specs` to a comment that asks
   for a screen, also when the comment is about the mockup only.
2. Map a note and each line that starts with "Fix first:" by its words. A note with an
   `artifact_version_id` also concerns the type of that `id` in `index.json`.
3. An answer or a changed decision concerns each output that its question is about.
4. A word that asks for a screen, such as "draw a mockup of the export screen", needs the
   spec to change when the newest spec does not list that screen as
   `Mockup screen: <screen id>`, because `designer` draws only the screens that the spec
   lists. List `write-specs`, then `make-mockups`, each with a fact that quotes the word.
   `checking-shape` routes a word that needs the spec to change the same way. When the
   newest spec lists the screen and the newest mockup lacks it, list `make-mockups` alone.
   After a follow of `write-specs` in the log after the word's `at`, the spec needs no
   further change for the word, also when the reply of the spec writer has outcome
   `declined` or `asked`. Then list `make-mockups` when the newest spec lists the screen and
   the newest mockup lacks it. Otherwise, when the spec does not list the screen and no other
   word or change needs `make-mockups`, list it under "Not run", with that reason.
5. List each type that a word concerns, with a fact that quotes the word. When the words
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
later push by a workflow that a route lists settles that part. The line about no mockup is
a stop when a person's word asks for a screen that the newest spec does not list as
`Mockup screen:`, and the log has no follow of `write-specs` after the word's `at`: the
spec needs a change, and the first item below routes it. Route only these:

- The spec needs a change, and a person's word asks for it, such as a screen that the newest
  spec does not list as `Mockup screen:`: list `write-specs`, with a fact that quotes that
  word, then the stopped workflow.
- The run needs a `<type>`: list the workflow that writes it, then the stopped workflow.

Write any other stop, and a stop with no person's word behind it, after "Stop:", and list no
workflow.
