---
name: checking-decisions
description: Load before you write a decision record, and before you review one. Contains what a version contains, the steps of a review, and the check list.
---

# Checking decisions

A writer works through the check list before it reports. A reviewer does the section "Review
of a record", then the check list.

## What a version contains

A version is one Markdown file, `decision-record.md`. Members read all of it. A decision id,
an `ac-N` and the spec's version number are words of the record, not words of the system
that runs you. `declines.md` is no part of a version.

## Review of a record

1. Before you read the draft, list everything that the person's words ask on how to build
   the work: the ticket, the instruction, the comments, the answers, the review comments
   whose words concern the record, and `notes`. Then flag each item that the draft drops,
   narrows or widens. An item that the writer's list "What only a person can settle" covers
   is not dropped. An item on what the work delivers that the newest spec states, also as an
   exclusion, is not dropped. An item that only the spec can apply and that it does not
   state is a finding marked `writer` and `break`, and its Fix is the writer's
   `Blocked: needs a change to criterion <ac-N>`, `Blocked: needs a new criterion` or
   `Blocked: needs a change to the spec`. A note whose words concern only another type is no
   word on the record, and needs no finding. A note on a spec version that asks how to build
   is a word on the record.
2. Compare the decision ids with the version under `decision-record/main/` that the pull
   wrote, because every version keeps each id. A renumbered decision, a reused number or a
   decision whose heading is gone is a finding.
3. Read the newest version under `spec/main/`. Each technical choice that its `## Changes`
   parts leave open needs a decision. Each id under "Rests on:" exists in the newest
   acceptance criteria, is not removed, and is a criterion that the decision depends on. An
   open decision with `- Rests on: no criterion yet.` is no finding when step 5 holds for
   it. A decision that contradicts a rule or a `Stays:` point, or that adds an outcome no
   rule states, is a finding that quotes both. When "Spec version:" in the version of the
   record that the pull wrote is older than the newest spec, check each decision against
   every criterion it rests on.
4. Open each file that a "Today:" item cites, and check the fact against the file. A file of
   a further repository, such as `web: src/cart.ts`, is at
   `.qory/repositories/web/src/cart.ts` in the working folder. A false fact is a finding. So
   is a way under "Other ways:" that the facts leave cheaper than the chosen way, when
   "Why:" gives no reason for the chosen way. "The ticket has no target." is true only when
   the input file has no `target`. "The run has no files of the target." is true only when
   the input file has `target` and a listing of the working folder shows no file outside
   `.git` and `.qory`. With Glob, list with pattern `*`. With the line
   "Further repositories: yes", a file under `.qory/repositories` counts too: list again
   with `path: ".qory/repositories"`.
5. An item `- Decision: open until the questions are answered.` needs a question with no
   recommended option, in the writer's list or open with `asked.run` set to the run's
   number. With neither, it is a finding marked `writer` and `break`. A decision that a
   question with a recommended option covers follows that option.
6. Check every review comment whose words concern the record, open or closed. For an open
   one, the draft applies it, this run's questions ask it, or `declines.md` lists it, and
   the writer's list "Review comments" has it. For a closed one with the reply `changed`,
   the draft keeps the change unless a later word removes it.
7. When you get the path of `declines.md`, open the source of each fact, and check the fact
   against it. A fact that is false, or that you could not check, is a finding marked
   `writer` and `break`. With no path, leave any such file unread.
8. Check for contradictions inside the record, and with this run's questions:
   `questions.json` at the top of the artifact folder or, when it is not there, the newest
   version under `questions/main/`. A contradiction is a finding that quotes both clauses.
9. You fetch no web page. A decision that rests on a source of `kind` `page` in the newest
   proposal's `sources.json` is not unverified: it matches when it states what the entry or
   the proposal's text states. A decision that does not match is a finding. List a decision
   that rests on another public page under "Unverified:". Check a decision that rests on a
   source of `kind` `file` against the file.

## Check list

For the writer before it reports, and for a reviewer:

- The record starts with "Spec version:" and the number of the newest spec, then the heading
  "Decisions". The text "The spec leaves no technical choice open." is the only text under
  that heading, and only when the spec's `## Changes` parts leave no technical choice open,
  no further choice exists, and no version has a decision.
- Each decision has its id and these items, in order: "Decision:", "Rests on:", "Today:",
  "Why:", "Other ways:" with at least one way, and "Cost:". A removed decision has only its
  heading and the reason. An open decision has every item except "Cost:", its "Why:" states
  what the answer decides, and its "Other ways:" lists each way that the answer chooses
  between.
- "Rests on:" lists at least one `ac-N`, no removed criterion, and no copy of a criterion's
  text. The exceptions are `- Rests on: no criterion yet.` in an open decision and
  `- Rests on: no criterion, by the answer.` when an answer states that the spec needs no
  rule.
- The record drops, narrows and widens no item that the person's words ask on how to build
  the work, and where they differ, it follows the latest word.
- Each decision, except an open one, states one way to build the work. No decision has steps
  or tasks.
- No decision changes a rule, adds an outcome, or settles what only a person can settle.
- Nothing in the record comes from no source, and no text contains an assumption.
- A public page is a link, and a file is its path, with no link.
- No text has `.qory/repositories` or a path of the machine the run is on.
- The record has no image and no wireframe.
