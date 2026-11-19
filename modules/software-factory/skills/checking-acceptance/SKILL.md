---
name: checking-acceptance
description: Load before you review a change against its acceptance criteria and build plan, after reviewing-changes and judging-findings. Contains what the review reads, the area it covers, the steps, what is blocking in that area, and the check list.
---

# Checking acceptance

Load `reviewing-changes` first and `judging-findings` next. This skill adds the area of the
review of the acceptance: what it reads, the steps, and how each kind of finding of the area
falls under the definition of `blocking` in `judging-findings`.

## What the review reads

- `qory.review.diff`: the lines that the change adds and removes. Read all of it.
- `qory.review.commit`: the read-only copy of the change. Search it with Grep and Glob, with
  its path as the folder, to trace a criterion through the code.
- `qory.review.suite_result`: the result of the full suite, for a `failing check` proof.
  It has no failing rows yet. The result of the locked checks that qory runs before the
  round is not in `qory.review` yet.
- `qory.review.previous_findings`, when it exists, as "Earlier findings" lists.
- `qory.review.build_report`, when it exists: what the session that made the change states
  that it did.

The review also needs the approved acceptance criteria, the spec and the build plan of the
work item. qory writes no value for them in `qory.review` yet: until then, stop and write
no file. The copy at `commit` contains no `.qory` folder, so do not
look for them there.

## The area

The review of the acceptance covers the change measured against the acceptance criteria,
the spec and the build plan: a criterion that the change does not meet, a planned change
that it does not build or does not build as planned, and work that nobody asked for. It
reads code only to trace a criterion.

The review of the code covers bugs, security holes and data loss in the code, and security
holes, data loss and secrets in the tests and the fixtures. The review of the tests covers
the other findings of the tests, the test setup and the counts of the suite. A finding in
another area is left out: its reviewer writes it. When a bug also breaks a criterion, write
the criterion that is not met: the review of the code writes the cause in the code.

## Earlier findings

When `previous_findings` exists, re-read the lines of each finding in it, as
`reviewing-changes` and `judging-findings` list. Repeat, with its id, each finding of the
area of this review that is still true, and leave out the others. The shape of
`previous_findings` is not in a contract of qory yet.

## Review of the acceptance

1. Take the live criteria: each entry of `criteria` with no `removed` member, in the
   approved acceptance criteria that `qory.review` is to pass. That value is not built
   yet, as "What the review reads" lists. The `check` of each is `Tests` or
   `Demo: <title>`.
2. For each criterion, find the lines of the change that meet it. Trace one input that the
   words of the criterion describe through those lines to the result. A criterion that the
   change meets needs no finding.
3. For each deliverable of the build plan, check that the diff changes its Files so that its
   Change is done. The session before the round already ends on a deliverable with no `done`
   row in the build ledger; in this step, you find one marked `done` that changed nothing.
4. Work that nobody asked for: a behaviour that no rule of the spec requires, or one that
   breaks a `Stays:` point of the spec.
5. A changed path that no Files cell of the build plan lists: a planned change that is not
   as planned.
6. The build report, when it exists: a claim in it that the diff does not show.
7. A criterion whose `check` is `Demo: <title>`: check its code path only. The Verify stage
   runs the demo.
8. A change that meets every criterion and builds every planned change gets an empty
   `findings` list. Write no finding to show that you reviewed.

## Blocking in this area

These lists sort the kinds of finding of this area under the definition of `blocking` in
`judging-findings`, and add nothing to it.

- `blocking`: a criterion that the change does not meet, or meets for only part of its
  cases, step 2. The proof is a `failing input` from the words of the criterion, or a
  `failing check` when the locked check of the criterion is a failing row of
  `suite_result`. Also a deliverable of step 3 whose change is missing, when a criterion of
  its Criteria cell is not met.
- `non-blocking`: a deliverable of step 3 whose change is missing while its criteria are
  met; work of step 4, with a `broken rule` proof that quotes the spec, unless it also
  breaks a criterion; a path of step 5, with a `broken rule` proof that quotes the Files
  cells of the build plan, unless it also breaks a criterion; and a claim of step 6, unless
  it hides a criterion that is not met.

## Check list

- You took each live criterion of the approved acceptance criteria.
- Each criterion is traced with one input through the lines that meet it, or has a finding.
- Each deliverable of the build plan has its change in the diff, or a finding.
- Each behaviour that no rule of the spec requires has a finding.
- Each changed path that no Files cell of the build plan lists has a finding.
- No finding is about the cause of a bug in the code, a test or the test setup.
- No finding is made up: a change that meets every criterion has an empty `findings` list.
- Each earlier finding of this area that is still true is in the report with its `id`.
