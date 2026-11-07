---
name: checking-decisions
description: Load before you write a decision record, and before you review one. Contains what a version contains, the steps of a review, and the check list.
---

# Checking decisions

A writer works through the check list before it reports. A reviewer does the section "Review
of a record", then the check list.

## What a version contains

A version is one Markdown file, `decision-record.md`. Members read all of it. A decision id
and an `ac-N` are terms that members read, not words of the system that runs you.
`declines.md` is no part of a version.

## Review of a record

1. Before you read the draft, list everything that the person's words ask on how to build
   the work, also in `notes` and in the review comments whose words concern the record.
   Flag each item that the draft drops, narrows or widens, unless the writer's list "What
   only a person can settle" covers it, or the newest spec states it, also as an exclusion,
   when it is on what the work delivers. An item that only the spec can apply and that it
   does not state is a finding marked `writer` and `break`, and its Fix is the writer's
   `Blocked: needs a change to criterion <ac-N>`, `Blocked: needs a new criterion` or
   `Blocked: needs a change to the spec`. A note whose words concern only another type is no
   word on the record, and needs no finding. A note on a spec version that asks how to build
   is a word on the record.
2. In the newest version under `spec/main/`, each technical choice that the `## Changes`
   parts leave open needs a decision. Each id under "Rests on:" is a criterion that the
   decision depends on. An open decision with `- Rests on: no criterion yet.` is no finding
   when step 4 holds for it. A decision that contradicts a rule or a `Stays:` point, or adds
   an outcome no rule states, is a finding that quotes both. Check each decision, also one
   kept from the newest record, against every criterion it rests on, as the newest
   acceptance criteria state it.
3. Check each fact of a "Today:" item against the file it cites. A file of a further
   repository, such as `web: src/cart.ts`, is at `.qory/repositories/web/src/cart.ts` in
   the working folder. A false fact is a finding. So is an option of the decision's question
   that the facts leave cheaper than the chosen way, when "Why:" gives no reason for the
   chosen way. "The ticket has no target." is true only when the input file has no
   `target`. "The run has no files of the target." is true only when the input file has
   `target` and a listing of the working folder shows no file outside `.git` and `.qory`.
   With Glob, list with pattern `*`. With the line "Further repositories: yes", a file under
   `.qory/repositories` counts too: list again with `path: ".qory/repositories"`.
4. An item `- Decision: open until the questions are answered.` needs a question with no
   recommended option, in the writer's list or open with `asked.run` set to the run's
   number. With neither, it is a finding marked `writer` and `break`. A decision that a
   question with a recommended option covers follows that option. A decision whose decided
   question a person answered follows the answer.
5. Of the review comments whose words concern the record, an open one is applied, asked by
   this run's questions or listed in `declines.md`, and is on the writer's list "Review
   comments". A closed one with the reply `changed` keeps the change unless a later word
   removes it. A closed one that a fact from a higher workflow quotes has its part on the
   record applied, unless its last reply declined, answered or asked about that part.
6. When you get the path of `declines.md`, check each fact against its source. A fact that
   is false, or that you could not check, is a finding marked `writer` and `break`. With no
   path, leave any such file unread.
7. A contradiction inside the record, or with this run's questions, is a finding. The
   questions are `questions.json` at the top of the artifact folder or, when it is not
   there, the newest version under `questions/main/`.
8. A decision that rests on a source of `kind` `page` in the newest proposal's
   `sources.json` matches when it states what the entry or the proposal's text states, and
   is a finding when it does not. List a decision that rests on another public page under
   "Unverified:". Check a decision that rests on a source of `kind` `file` against the
   file.

## Check list

The run's Checks cover the section, the items of each decision in order, the form of a
removed or open decision, the criteria on "Rests on:" and the state of the question on
"Question:", decision ids against the newest version, the word limit, images, links,
characters and paths; judge the rest.

- The text "The spec leaves no technical choice open." stands only when the spec's
  `## Changes` parts leave no technical choice open, no further choice exists, and no
  version has a decision.
- An open decision's "Why:" states what the answer decides.
- The question on "Question:" has as options the ways considered: a decided question
  whose `decision.option` is the decision's way, or a question that a person answers. The
  record lists no other way.
- "Rests on:" copies no criterion's text. `- Rests on: no criterion, by the answer.` stands
  only when an answer states that the spec needs no rule.
- The record drops, narrows and widens no item that the person's words ask on how to build
  the work, and where they differ, it follows the latest word.
- Each decision, except an open one, states one way to build the work, with no steps or
  tasks. No decision changes a rule, adds an outcome, or settles what only a person can
  settle.
- Nothing in the record comes from no source.
- A public page is a link, and a file is its path, with no link.
