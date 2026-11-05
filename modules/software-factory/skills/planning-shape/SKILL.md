---
name: planning-shape
description: Load before you decide which small workflows a Shape run follows. Contains the fixed order, when each workflow runs, how a person's word maps to a workflow, what a rule's changed text reruns, where a small workflow's stop goes, and how to count starts.
---

# Planning Shape

A Shape run has four small workflows, in a fixed order: `write-specs`,
`write-technical-decisions`, `make-mockups` and `write-test-features`. Test features come
last because they cite rules and screens, and the two workflows before them can stop on a
rule. Each workflow is either under "Run:", with one fact, or under "Not run:", with the
reason. A member sees the spec's statements at the gate, so a reason that rests on one of
them quotes it. Plan only from what you read, and list only the workflows that the next
versions need.

## What you read

- `index.json` in the artifact folder: every version of each type, with its `id`, `number`,
  `at` and `writer.run_id`.
- The newest version of `spec`, `decision-record`, `mockup` and `test-features`. From a
  mockup, read only `screens.json`: its screen ids, and `data-rules` in each `source`.
- The input file, the notes, the newest answers and the review comments.
- The log: each small workflow that this run followed, with its report, and each start of
  `shape-reviewer`. An entry `lost` means that the run no longer has what came before it.

## When each workflow runs

- `write-specs` runs when no spec version exists, when the newest spec has the line
  `Screens that change: open until the questions are answered.`, when a word concerns the
  spec, or when the section "A stop in the log" routes a stop to it. Otherwise, the reason
  is that no word concerns the spec.
- `write-technical-decisions` runs when "Open technical choices:" lists a choice that the
  newest record has no decision for, when a rule that a decision rests on changed, or when a
  word concerns the record. Otherwise, the reason is that line's `none`, or that each
  decision still holds.
- `make-mockups` runs when "Screens that change:" lists a screen that the newest mockup
  lacks, when a rule in a page's `data-rules` changed, or when a word concerns the mockup.
  Otherwise, the reason is that line's `none` with its reason, or that each screen still
  holds.
- `write-test-features` runs when the spec has a rule that is not removed and a rule has no
  scenario, a rule that a scenario cites changed, or a word concerns the features.
  Otherwise, the reason is that the spec has no rule yet, that every rule is removed, or
  that each scenario still holds.

On the first start of a run with no spec version, list only `write-specs`, and give each
other workflow the reason "The spec's statements decide this after its push." While the
newest spec has an open line, the other three do not run: use that line as the reason.

A note or a comment on one output reruns only what depends on that output.

## Which workflow a person's word concerns

A word counts when its `at` is later than the `at` of the newest version of the type it
concerns, or when it is an open review comment.

1. A review comment concerns the type in `on.artifact`. A comment on a type that no
   workflow of this run writes, such as `proposal`, stays open and concerns no workflow.
2. A note with an `artifact_version_id` starts with the type of that `id` in `index.json`.
   Read its words too, because a note on a spec version may ask how to build.
3. A note with `artifact_version_id` set to `null` covers the whole stage: map it by its
   words.
4. An answer concerns the type that its question asks about.
5. A word can concern several types: list each. When the words stay unclear, list
   `write-specs`.

## A rule's changed text

A rule's changed text reruns the decision that rests on it, each screen whose `data-rules`
lists it, and each scenario that cites it. A rule keeps its id, so compare by id.

Take the changed ids from the reports in the log. With no such report, take the spec version
each output rests on: "Spec version:" in the record, and otherwise the largest spec version
whose `at` is earlier than that output's `at`. When it is older than the newest spec and
you lack its folder, list that version under "Pull:", with `Run:` set to `- none`. List
every version you need at once. Then compare the two versions rule by rule.

## A stop in the log

A small workflow's stop reaches you as its line. The line that a spec states no screen change
is no stop. A later follow of that workflow in the log settled the stop, so leave it out. A later push by the workflow that a route below lists
settled that part, so list only the stopped workflow. Route only these:

- Rule `<id>` needs a change, or the spec needs a new rule, and a person's word asks for it:
  list `write-specs`, with a fact that quotes that word, also from a comment on another
  type, then the stopped workflow. The spec's writer and reviewer count that quote as a
  person's word.
- The run needs a `<type>`: list the workflow that writes it, then the stopped workflow.

For any other line, write it after "Stop:", and list no workflow. So does a stop with no
person's word behind it, such as a rule's wording that lets no step show it, because the
spec's writer has no word to apply.

## Starts

Under "Starts so far:", count each workflow and `shape-reviewer` in the log, also a start
that ended in a stop. With `lost` in the log, count the versions of a workflow's type whose
`writer.run_id` is the run's id, plus each entry after `lost` that pushed nothing. Count
`shape-reviewer` only after `lost`, because it pushes nothing.

Each fact and each reason is plain text with no backticks and no asterisks, because it can
reach a member as a gap.
