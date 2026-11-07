---
name: checking-demo-scenarios
description: Load before you write demo scenarios, and before you review them. Contains what a version contains, the steps of a review, and the check list.
---

# Checking demo scenarios

A writer works through the check list before it reports. A reviewer does the section "Review
of demo scenarios", then the check list.

## What a version contains

A version is one Markdown file, `demo-scenarios.md`. Members read all of it. A scenario id
and an `ac-N` are words of the file, not words of the system that runs you. `declines.md`
is no part of a version.

## Review of demo scenarios

1. Before you read the draft, list what the person's words and `notes` ask of the
   scenarios, and each criterion of the newest acceptance criteria whose planned check is
   `Demo`. Flag each item that the draft drops, narrows or widens, except an item on the
   writer's list "What only a person can settle", which covers no criterion. A word that
   needs a criterion to change, or that asks for a video whose outcome no criterion states,
   is a finding marked `writer` and `break`, unless a later word of a person settles that
   criterion.
2. Check the mapping of criteria and scenarios that the check list states. A step shows a
   criterion only when the viewer sees its outcome, with its values: a criterion that only
   the `Shows:` line lists is a finding.
3. When a mockup exists, each "Screen" is a screen id in its `screens.json`. Another value
   is a finding.
4. Compare the scenario ids with the version under `demo-scenarios/main/`. A renumbered
   scenario, a reused number or a removed heading is a finding.
5. Compare the steps with the criteria and the spec. An outcome that no criterion states, a
   value that differs from the criterion's, or a contradiction of a `Stays:` point is a
   finding that quotes both clauses. Where a criterion and a picture differ, the criterion
   applies.
6. Check every review comment whose words concern the scenarios, open or closed. An open one
   is applied, asked by this run's questions, or listed in `declines.md`, and is on the
   writer's list "Review comments". A closed one with the reply `changed` keeps the change
   unless a later word removes it. A closed one that a fact from a higher workflow quotes
   has its part on the scenarios applied, unless its last reply declined, answered or asked
   about that part.
7. When you get the path of `declines.md`, check each fact against its source. A false fact,
   or one you could not check, is a finding marked `writer` and `break`.
8. Check for contradictions inside the file, and with this run's questions:
   `questions.json` at the top of the artifact folder or, when it is not there, the newest
   version under `questions/main/`. A contradiction is a finding that quotes both clauses.

## Check list

For the writer before it reports, and for a reviewer:

- The file has `## Summary`, one to three sentences, then one `###` heading per scenario,
  and no Background.
- Each scenario that is not removed has `scenario-<N>: <title>`, a "Starting state:" line,
  a table with the columns "Step", "Action", "What the viewer sees" and "Screen", and a
  `Shows:` line. A removed scenario has only its heading and the reason.
- At most 12 scenarios are not removed. With no criterion planned as `Demo`, each scenario
  is removed.
- Each criterion planned as `Demo: <title>` is on the `Shows:` line of the scenario with
  that title, and each `ac-N` on a `Shows:` line is planned as `Demo: <that title>`.
- Each `ac-N` on a `Shows:` line has a step that shows it.
- No step contains a file name, a field name, a command, a technology or a plan, and no step
  shows an outcome that no criterion states.
- Nothing in the file comes from no source, and no text contains an assumption.
- The file has no image, no wireframe and no link.
