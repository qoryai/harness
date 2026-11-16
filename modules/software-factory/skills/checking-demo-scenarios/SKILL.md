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
is no part of a version. A version with no scenario is a file of 0 bytes, and the run
pushes it with the writer's list "Version note:" as the version's note, which members read
too.

## Review of demo scenarios

1. Before you read the draft, list what the person's words and `notes` ask of the
   scenarios, and each criterion of the newest acceptance criteria whose planned check is
   `Demo`. Flag each item that the draft drops, narrows or widens, except an item on the
   writer's list "What only a person can settle", which covers no criterion. A word that
   needs a criterion to change, or that asks for a scenario whose outcome no criterion
   states, is a finding marked `writer` and `break`, unless a later word of a person
   settles that criterion.
2. A step shows a criterion only when the viewer sees its outcome, with its values: a
   criterion that only the `Shows:` line lists is a finding.
3. When a mockup exists, each "Screen" is a screen id in its `screens.json`. Another value
   is a finding.
4. Compare the steps with the criteria and the spec. An outcome that no criterion states, a
   value that differs from the criterion's, or a contradiction of a `Stays:` point is a
   finding that quotes both clauses. Where a criterion and a mockup page differ, the
   criterion applies.
5. Check every review comment whose words concern the scenarios, open or closed. An open one
   is applied, asked by this run's questions, or listed in `declines.md`, and is on the
   writer's list "Review comments". A closed one with the reply `changed` keeps the change
   unless a later word removes it. A closed one that a fact from a higher workflow quotes
   has its part on the scenarios applied, unless its last reply declined, answered or asked
   about that part.
6. When you get the path of `declines.md`, check each fact against its source. A false fact,
   or one you could not check, is a finding marked `writer` and `break`.
7. Check for contradictions inside the file, and with this run's questions:
   `questions.json` at the top of the artifact folder or, when it is not there, the newest
   version under `questions/main/`. A contradiction is a finding that quotes both clauses.

## Check list

For the writer before it reports, and for a reviewer:

When you review, the run gives you the lines of its checks script under "Checks:", as
`reviewing-drafts` lists. In `demo-scenarios.md`, the script checks the one section
`## Summary` and its 1 to 3 sentences, the heading of each scenario, each id once, one
scenario per title, the form of each scenario or removed scenario, the line `Evidence: film`
or `Evidence: pictures` at the end of each scenario that is not removed, at most 8 steps and
at most 12 scenarios that are not removed. It checks that each criterion planned as
`Demo: <title>` is on the `Shows:` line of the scenario with that title, and that each
`ac-N` on a `Shows:` line is planned so. It checks that the ids keep the newest version's
ids and numbers, and it checks the characters, that the file has no image and no link, and
`.qory/repositories` and each path of the machine the run is on. It passes an empty file
only with 0 bytes, only after a newest version that is not empty, and only when no
criterion is planned as `Demo`. It fails a file whose scenarios are all removed when no
criterion is planned as `Demo`. After an empty newest version, it checks the ids against
the ids in that version's note. Judge the rest of the check list.

- With no criterion planned as `Demo` and a newest version that is not empty, the file is
  empty, and the writer's list "Version note:" has these two lines first, word for word:

  ```text
  No demo scenario is left, so this version of the demo scenarios is empty.
  If no acceptance criterion needs a demo, pick Approve. If one does, pick Request changes, choose the acceptance criteria under About, and quote that criterion in the note of Request changes.
  ```

  Then it has one line `<scenario-N>, "<title>": removed, because <the reason>.` for each
  scenario of the newest version, in the order of the ids, also for each one that it marks
  removed. Each reason is one short clause that the criteria, a person's word or the
  scenario's `Removed, because` line states. A criterion is quoted as
  `AC-1, "<criterion text>"`. Each item ends with a full stop, because the run joins the
  items with one space into a note of one line. The note has no backtick and no other
  Markdown.
- Each `ac-N` on a `Shows:` line has a step that shows it.
- A scenario where every step shows a state that stays on the screen, such as a text, a
  value or a layout, has `Evidence: pictures`. A scenario with a step that shows a change
  over time has `Evidence: film`.
- No step contains a file name, a field name, a command, a technology or a plan, and no step
  shows an outcome that no criterion states.
- Nothing in the file comes from no source, and no text contains an assumption.
