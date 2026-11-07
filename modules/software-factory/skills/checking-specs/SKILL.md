---
name: checking-specs
description: Load before you write or review a spec and its acceptance criteria. Contains what a version contains, the steps of a review, and the check list.
---

# Checking specs

A writer works through the check list before it reports. A reviewer does the section
"Review of a spec", then the check list, and reads both drafts together, so that a rule and
its criteria cannot drift apart.

## What a version contains

A `spec` version is one file, `spec.md`, and an `acceptance-criteria` version is one file,
`acceptance-criteria.md`. Members read all of both. An `ac-N` is a term that members read,
not a word of the system that runs you. `declines.md` is no part of a version.

## Review of a spec

1. Before you read the drafts, list what the person's words ask, also in `notes`, in a
   person's word that a fact or finding quotes, in the newest proposal and in the review
   comments whose words concern the spec or the criteria. A quote that differs from its
   source is a finding. Flag each item that the drafts drop, narrow or widen, unless the
   writer's list "What only a person can settle" or a `Stays:` point covers it.
2. Compare each `ac-N` with the row of the same id in the newest version under
   `acceptance-criteria/main/`. A renumbered criterion, whose text moved to another id so
   that an id now states another criterion, is a finding.
3. A rule with no criterion, a criterion that rests on no rule, and a criterion whose values
   differ from its rule are findings that quote both. A rule whose "After" waits for an
   answer needs no criterion.
4. `Demo` on a criterion that no person can see in the UI, or `Tests` on one that a person
   sees on a mockup screen that a part names, is a finding.
5. With more than 7 criteria that are not removed, a missing split question or a criterion
   dropped or merged to stay at 7 is a finding, marked `writer` and `break`. The split
   question is a question in the writer's list that proposes a split into sub-items. The
   count of criteria on the last line of "Checks:" is no finding by itself.
6. Check each rule against its source. A file `web: src/cart.ts` is at
   `.qory/repositories/web/src/cart.ts` in the working folder. A rule on a page of the
   proposal's `sources.json` states only what the entry or the proposal states. List a rule
   that rests on another page under "Unverified:".
7. Of the review comments whose words concern the spec or the criteria, an open one is
   applied, asked by this run's questions or listed in `declines.md`, and is on the writer's
   list "Review comments". A closed one with the reply `changed` keeps the change unless a
   later word removes it. A closed one that a fact from a higher workflow quotes has its
   part on the spec or the criteria applied, unless its last reply declined, answered or
   asked about that part.
8. When you get the path of `declines.md`, check each fact against its source. A false fact,
   or one you could not check, is a finding marked `writer` and `break`.
9. A contradiction inside or between the drafts, or with this run's questions, is a finding.
   The questions are `questions.json` at the top of the artifact folder or, when it is not
   there, the newest version under `questions/main/`.

## Check list

When you review, the run gives you the lines of its checks script under "Checks:", as
`reviewing-drafts` lists. In `spec.md`, the script checks the four sections in order, at
least one part under `## Changes`, the table with the columns "Rule", "Today" and "After"
that opens each part, the summary of 1 to 3 sentences, the limit of 450 words, and at most
3 points per part. In `acceptance-criteria.md`, it checks the summary, then the table and
nothing after it, each id as `ac-` and a number on one row, each criterion as one sentence
of at most 25 words with the planned check `Demo: <title>` or `Tests`, each removed row, and
that the ids keep the newest version's ids and numbers. In both, it checks the characters,
each link and image, `.qory/repositories` and each path of the machine the run is on. Judge
the rest of the check list.

- The background starts with one sentence that names the proposal version, linked to
  `work_item.url` when the input file has one, or "This spec follows the ticket.", and adds
  only facts that the run found.
- Each part under `## Changes` has no Mermaid diagram or wireframe. A part that changes a
  screen has `Mockup screen: <screen id>` as its first point.
- No rule has an id, a file name, a field name, a technology or a plan.
- A part that follows the recommended option of an open question has one point on what
  changes with another answer. A rule that waits for a question with no recommended option
  has the "After" "Waits for the answer on <the point>."
- Each exclusion that a person recorded is a `Stays:` point with its reason, and no rule
  contradicts it.
- Each criterion is one checkable statement, and no text states a criterion as met.
- The drafts follow the latest word of a person. Nothing in them comes from no source.
- "Sources" lists every page and file used, and no ticket, comment, answer or review
  comment.
