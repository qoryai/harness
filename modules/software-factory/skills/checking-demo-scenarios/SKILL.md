---
name: checking-demo-scenarios
description: Load before you write demo scenarios, and before you review them. Contains what a version contains, the steps of a review, and the check list.
---

# Checking demo scenarios

A writer works through the check list before it reports. A reviewer does the section "Review
of demo scenarios", then the check list.

## What a version contains

A version is one Markdown file, `demo-scenarios.md`. Members read all of it. A scenario's id
and a rule's id are words of the file, not words of the system that runs you. `declines.md`
is no part of a version.

## Review of demo scenarios

1. Before you read the draft, list everything that the person's words ask of the features:
   the ticket, the instruction, the comments, the answers, the review comments whose
   `on.artifact` is `demo-scenarios`, and `notes`. A note whose words concern only another
   type is no word on the features, and needs no finding.
   List each rule of the newest spec, except a removed one, and each screen on its line
   "Screens that change:". Then flag each item that the draft drops, narrows or widens. An
   item that the newest spec lists under "What stays as it is" is not dropped. Neither is a
   word of a person that the writer's list "What only a person can settle" covers, but that
   list covers no rule and no screen. An open question of an earlier run covers an item only
   when that list adds it anew. A person's word that needs a rule to change, a note that
   asks for words in a rule that the newest spec does not state, or a word that asks for a
   case whose outcome no rule states and that "What stays as it is" does not list, is a
   finding marked `writer` and `break`, because the writer reports `blocked` for it. No
   finding applies when the rule states those words, or when a later word of a person, in
   an answer, a comment or a later note, settles that rule.
2. For each rule, read the steps of each scenario that cites it. A rule that no step shows
   is a finding, also when a scenario cites it. A step shows a rule when it does what "How a
   person sees it:" states and sees the outcome. A citation of an id that the newest spec
   does not have, or of a removed rule, is a finding.
3. For each screen, read the steps of each scenario that cites it. A screen that no step
   acts on or sees is a finding. So is a citation of a screen that the line leaves out.
4. Compare the scenario ids with the version under `demo-scenarios/main/` that the pull
   wrote, because every version keeps each id. A renumbered scenario, a reused number or a
   removed heading is a finding.
5. Compare the steps with the newest spec. A step with an outcome that no rule states, as
   the check list defines it, a value that differs from the rule's, or a contradiction of
   "What stays as it is" is a finding that quotes both clauses. Where a rule and a picture
   differ, the rule applies, and a step that follows the rule is no finding.
6. Check every review comment whose `on.artifact` is `demo-scenarios`, open or closed. For an
   open one, the draft applies it, this run's questions ask it, or `declines.md` lists it.
   For a closed one with the reply `changed`, the draft keeps the change unless a later word
   removes it. Leave a comment on another type out of the review.
7. When you get the path of `declines.md`, open the source of each fact, and check the fact
   against it. A fact that is false, or that you could not check, is a finding marked
   `writer` and `break`. With no path, leave any such file unread.
8. Check for contradictions inside the file, and with this run's questions: `questions.json`
   at the top of the artifact folder or, when it is not there, the newest version under
   `questions/main/`. A contradiction is a finding that quotes both clauses.

## Check list

For the writer before it reports, and for a reviewer:

- Each scenario that is not removed has its id, a "Rules:" line and a "Screens:" line, under
  a `##` heading, with at least one "When" and one "Then". A removed scenario has only its
  id and the reason.
- Each rule of the newest spec, except a removed one, has a step that shows it.
- Each screen on the line "Screens that change:" has a step that acts on it or sees it.
- Each scenario that is not removed cites at least one rule, and only rules its steps show.
- Where a rule states a limit or a refusal, the steps show a case on each side of it.
- No step contains a file name, a field name, a command, a technology or a plan.
- No step adds an outcome that no rule states, and no scenario contradicts "What stays as it
  is". The outcome on the allowed side of a limit or a refusal that a rule states counts as
  stated by that rule.
- Nothing in the file comes from no source, and no text contains an assumption.
- The file has no image, no wireframe and no link.
