---
name: checking-shape
description: Load before you read a Shape run's outputs together. Contains the steps of the read across outputs, the match of planned checks and demo scenarios, which wins when a criterion and a mockup page differ, where each finding goes, and the check list.
---

# Checking Shape

You read the newest version of each output together, the folder `<type>/main/v<N>/` with the
largest `<N>`: `spec`, `acceptance-criteria`, `decision-record`, `mockup` and
`demo-scenarios`. Each output passed a review of its text, which covered the sentence rules
of `simple-communication`, so check only what a read across them shows: do not load
`artifact-text`, and skip the check list of `artifact-text` and the section "Sentence rules"
of `reviewing-drafts`. Load `simple-communication` only before you write the first `Point:`
line of a finding, as `shape-reviewer` lists. An output with no version counts only as far
as the steps below ask for it.

## Review across the outputs

1. Before you read the outputs, list everything that the person's words ask: the ticket,
   instruction, comments, answers, changed decisions, review comments and `notes`. Read a
   review comment by its text, whatever its `on`. A round comment, with `on` set to
   `{"run": N}`, can concern every output of the stage: list it for the output that it
   names, or else for each output where it fits. Flag each item that no output covers. An
   item in an open question of this run is covered. An output comment only on a type
   that no workflow of this run writes, such as `proposal`, stays open and is no finding.
2. Screen against mockup. Each screen that a part of the spec changes is in `screens.json`
   of the newest mockup, with its title, `ac-N` ids and links. A missing screen, or a
   screen that no part changes, is a finding for `make-mockups`. A page of the mockup has
   its sheets and pictures inside, so search it for the text you check, such as with
   Grep, and read only those lines.
3. Choice against record. Each choice of how to build that the spec leaves open has a
   decision. A line of "Checks:" on a "Rests on:" or "Question:" line is a finding for
   `write-technical-decisions`.
4. Planned checks against demo scenarios. A line of "Checks:" on a planned demo or a
   `Shows:` line, such as a missing scenario, or a scenario that is not removed and is extra
   or lists other ids, is a finding for `write-demo-scenarios`. A planned check "Tests" for
   a criterion that a person can see in the UI, or "Demo" for one that no one can see, is a
   finding for `write-specs`. Each screen that a step cites is in `screens.json`.
5. Criterion against page. Compare the `ac-N` ids that each screen lists with what its
   page shows. Where they differ, the criterion applies, and the mockup states that in
   the visible line that `designing-mockups` lists. A difference with no such line is a
   finding for `make-mockups`, never one for the spec.
6. Age. Read each output against each criterion and part as it states today. A version
   older than the newest spec or criteria that cites a criterion and follows other words
   gets a finding for its workflow. An older version that follows today's words is current,
   and no finding.
7. Contradictions. A decision against the spec, a page or a step against a decision, and
   a step against what a page shows are findings. Where a
   person's word needs the spec or a criterion to change, the finding goes to
   `write-specs`.
8. Reasons. A workflow under the planner's list "Not run" whose reason does not hold against
   the versions gets a finding.

## Which workflow a finding goes to

Each finding has a "Workflow:" line, with the one workflow that changes the output:
`write-specs`, `write-technical-decisions`, `make-mockups` or `write-demo-scenarios`. A
difference from a criterion goes to the workflow of the output that differs. A finding that
only a person can settle goes to the workflow whose output depends on the answer, marked
`person`.

## Check list

The run's Checks, on the newest record and scenarios, cover the criteria on each
"Rests on:" line, the questions on each "Question:" line, and the match of planned demos
and `Shows:` lines both ways; judge the rest.

- The newest spec and acceptance criteria have a version.
- Each changed screen has a mockup screen, and each open choice a decision.
- No output contradicts another, and no output follows an old wording of a criterion or
  part.
- Each mockup page that differs from a criterion states which applies.
- Each finding has its "Workflow:" line and the three marks.
- Each finding is plain text, with no backticks and no asterisks.
