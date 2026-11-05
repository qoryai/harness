---
name: checking-shape
description: Load before you read a Shape run's outputs together. Contains the steps of the read across outputs, which wins when a rule and a picture differ, which workflow each finding goes to, and the check list.
---

# Checking Shape

You read the newest version of each output together: `spec`, `decision-record`, `mockup` and
`test-features`. Each output passed a review of its text, so you check what only a read
across them shows, and you skip the check list of `artifact-text`. An output with no version
counts only as far as the steps below ask for it.

## Review across the outputs

1. Before you read the outputs, list everything that the person's words ask: the ticket, the
   instruction, the comments, the answers, the review comments, and `notes`. Flag each item
   that no output covers. An item under "What stays as it is" or in an open question of this
   run is covered.
2. Screen against mockup. Each screen under "Screens that change:" has at least one screen
   in `screens.json` of the newest mockup, and you read each picture as an image. With no
   such screen, or a mockup whose screens the line leaves out, the finding goes to
   `make-mockups`.
3. Choice against record. Each choice under "Open technical choices:" has a decision. Each
   id under "Rests on:" exists in the newest spec and is not removed.
4. Rule against scenario. Each rule that is not removed has a scenario with a step that
   shows it. Each screen that a scenario cites is in `screens.json`, or on the spec's line
   when no mockup exists.
5. Rule against picture. Compare the rule ids in `data-rules`, in each screen's `source` in
   `screens.json`, with what its picture shows. Where a rule and a picture differ, the rule
   applies, and the mockup states that with a visible line:
   `Rule <id> applies here: <what differs>`. A difference with no such line is a finding for
   `make-mockups`, never one for the spec.
6. Age. Read each output against each rule as it states today. A version older than the
   newest spec that cites a rule and follows other words gets a finding for its workflow.
7. Contradictions. A decision against a rule or "What stays as it is", a picture or a step
   against a decision, and a step against what a picture shows are findings that quote both
   clauses. Where a person's word needs a rule to change, the finding goes to `write-specs`.
8. Reasons. Check each reason under the planner's list "Not run" against the versions. A
   workflow whose reason does not hold gets a finding.

## Which workflow a finding goes to

Each finding has a "Workflow:" line, with the one workflow that changes the output:
`write-specs`, `write-technical-decisions`, `make-mockups` or `write-test-features`. Because
the rule applies, a difference from a rule goes to the workflow of the output that differs.
A finding that only a person can settle goes to the workflow whose output depends on the
answer, marked `person`.

## Check list

- The newest spec has a version. A spec with an open line needs no other output.
- Each stated screen has a mockup, each open choice a decision, and each rule a scenario.
- No output contradicts another, and no version rests on a rule's old text.
- Each picture that differs from a rule states which rule applies.
- Each finding has its "Workflow:" line and the three marks.
- Each finding is plain text with no backticks and no asterisks, because it can reach a
  member as a gap.
