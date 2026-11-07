---
name: checking-specs
description: Load before you write a spec and its acceptance criteria, and before you review them. Contains what a version contains, the steps of a review, and the check list.
---

# Checking specs

A writer works through the check list before it reports. A reviewer does the section "Review
of a spec", then the check list. The review reads both drafts together, so that a rule and
its criteria cannot drift apart.

## What a version contains

A `spec` version is one file, `spec.md`, and an `acceptance-criteria` version is one file,
`acceptance-criteria.md`. Members read all of both. An `ac-N` is a word that members read,
not a word of the system that runs you. `declines.md` is no part of a version.

## Review of a spec

1. Before you read the drafts, list everything that the person's words ask: the ticket, the
   instruction, the comments, the answers, the review comments whose words concern the spec
   or the criteria, `notes`, a person's word that a fact or finding quotes, and the newest
   proposal. A quote that does not match its source is a finding. Then flag each item that
   the drafts drop, narrow or widen. An item that the writer's list "What only a person can
   settle" or a `Stays:` point covers is not dropped.
2. Compare the `ac-N` ids with the version under `acceptance-criteria/main/`. A renumbered
   criterion, a reused number or a missing row is a finding.
3. Compare each rule of the spec with the criteria. A rule with no criterion, a criterion
   that rests on no rule, and a criterion whose values differ from its rule are findings
   that quote both. A rule whose "After" waits for an answer needs no criterion until the
   answer comes.
4. Check "Planned check". `Demo` on a criterion that no person can see in the UI, or
   `Tests` on one that a person sees on a mockup screen that a part names, is a finding.
5. Count the criteria that are not removed. Above 7, the writer's list has a question that
   proposes a split into sub-items. Without it, or with a
   criterion dropped or merged to stay under 7, the finding is marked `writer` and `break`.
6. Check each rule against its source. A file `web: src/cart.ts` is at
   `.qory/repositories/web/src/cart.ts` in the working folder. A rule on a page of the
   proposal's `sources.json` states only what the entry or the proposal states. List a rule
   that rests on another page under "Unverified:".
7. Check every review comment whose words concern the spec or the criteria, open or closed.
   An open one is applied, asked by this run's questions, or listed in `declines.md`, and is
   on the writer's list "Review comments". A closed one with the reply `changed` keeps the
   change unless a later word removes it. A closed one that a fact from a higher workflow
   quotes has the part that concerns the spec or the criteria applied in the drafts, unless
   its last reply declined, answered or asked about that part.
8. When you get the path of `declines.md`, check each fact against its source. A false fact,
   or one you could not check, is a finding marked `writer` and `break`.
9. Check for contradictions inside and between the drafts, and with this run's questions:
   `questions.json` at the top of the artifact folder or, when it is not there, the newest
   version under `questions/main/`. A contradiction is a finding that quotes both clauses.

## Check list

For the writer before it reports, and for a reviewer:

- `spec.md` has `## Summary`, `## Background`, `## Changes` and `## Sources`, in this order,
  and no other `##` section.
- The background starts with one sentence that names the proposal version, linked to
  `work_item.url` when the input file has one, or "This spec follows the ticket.", and adds
  only facts that the run found.
- Each part under `## Changes` opens with a table with the columns "Rule", "Today" and
  "After". A part that changes a screen has `Mockup screen: <screen id>` as its first point,
  and no wireframe and no image.
- No rule has an id, a file name, a field name, a technology or a plan.
- A part that follows the recommended option of an open question has one point on what
  changes with another answer. A rule that waits for a question with no recommended option
  has the "After" "Waits for the answer on <the point>."
- Each exclusion that a person recorded is a `Stays:` point with its reason, and no rule
  contradicts it.
- `acceptance-criteria.md` has `## Summary`, one to three sentences, then the table with the
  columns "Id", "Criterion" and "Planned check", and nothing else.
- Each criterion is one checkable statement. "Planned check" is `Demo: <title>` or
  `Tests`, and no text states a criterion as met. A removed criterion has
  `Removed, because <the reason>.` and `None`. At most 7 criteria
  are not removed, or the writer's list proposes a split.
- The drafts follow the latest word of a person, and nothing in them comes from no source.
- "Sources" lists every page and file used, and no ticket, comment, answer or review
  comment. No text has `.qory/repositories` or a path of the machine the run is on.
