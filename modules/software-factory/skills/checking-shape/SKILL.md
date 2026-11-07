---
name: checking-shape
description: Load before you read a Shape run's outputs together. Contains the steps of the read across outputs, the match of planned checks and demo scenarios, which wins when a criterion and a picture differ, where each finding goes, and the check list.
---

# Checking Shape

You read the newest version of each output together, the folder `<type>/main/v<N>/` with the
largest `<N>`: `spec`, `acceptance-criteria`, `decision-record`, `mockup` and
`demo-scenarios`. Each output passed a review of its text,
so check only what a read across them shows: do not load `artifact-text`, and skip its check
list. An output with no version counts only as far as the steps below ask for it.

## Review across the outputs

1. Before you read the outputs, list everything that the person's words ask: the ticket,
   instruction, comments, answers, changed decisions, review comments and `notes`. Read a
   review comment by its text, whatever output its `on` names. Flag each item that no
   output covers. An item in an open question of this run is covered. A
   comment only on a type that no workflow of this run writes, such as `proposal`, stays
   open and is no finding.
2. Screen against mockup. Each screen that a part of the spec changes is in `screens.json`
   of the newest mockup, and you read each picture as an image. A missing screen, or a
   screen that no part changes, is a finding for `make-mockups`.
3. Choice against record. Each choice of how to build that the spec leaves open has a
   decision, and each `ac-N` on a "Rests on:" line exists in the newest acceptance criteria
   and is not removed.
4. Planned checks against demo scenarios, both ways:
   - each planned check "Demo: <title>" in `acceptance-criteria.md` has a scenario with
     that title in `demo-scenarios.md`, whose `Shows:` line lists that `ac-N`;
   - each `ac-N` in a `Shows:` line has the planned check "Demo: <that scenario's title>".

   A missing scenario, and a scenario that is not removed and is extra or lists other ids,
   are findings for `write-demo-scenarios`. A planned check "Tests" for a criterion that a
   person can see in the UI, or "Demo" for one that no one can see, is a finding for
   `write-specs`. Each screen that a step cites is in `screens.json`.
5. Criterion against picture. Compare the `ac-N` ids that each screen lists with what its
   picture shows. Where they differ, the criterion applies, and the mockup states that in
   the visible line that `designing-mockups` lists. A difference with no such line is a
   finding for `make-mockups`, never one for the spec.
6. Age. Read each output against each criterion and part as it states today. A version
   older than the newest spec or criteria that cites a criterion and follows other words
   gets a finding for its workflow. An older version that follows today's words is current,
   and no finding.
7. Contradictions. A decision against the spec, a picture or a step against a decision, and
   a step against what a picture shows are findings. Where a
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

- The newest spec and acceptance criteria have a version.
- Each changed screen has a mockup screen, and each open choice a decision.
- The planned checks "Demo" and the `Shows:` lines match both ways.
- No output contradicts another, and no output follows an old wording of a criterion or
  part.
- Each picture that differs from a criterion states which applies.
- Each finding has its "Workflow:" line and the three marks.
- Each finding is plain text, with no backticks and no asterisks.
