---
name: checking-acceptance
description: Load before you review a change against its acceptance criteria and build plan, after reviewing-changes and judging-findings. Contains what the review reads, the area it covers, the steps, what is blocking in that area, and the check list.
---

# Checking acceptance

Load `reviewing-changes` first and `judging-findings` next. This skill adds the area of the
review of the acceptance: what it reads, the steps, and how each kind of finding of the area
falls under the definition of `blocking` in `judging-findings`.

## What the review reads

Each value is one of "The values of the review" of `judging-findings`.

- `diff`: the lines that the change adds and removes. Read all of it.
- `commit`: the read-only copy of the change. Search it with Grep and Glob, with
  its path as the folder, to trace a criterion through the code.
- `suite_result`: the result of the full suite. Its `output_tail`, the last
  lines of the output of the suite, is the source of a `failing check` proof. When
  `suite_result` has no `output_tail`, prove with a `failing input` that a criterion is not
  met. A red locked check is a finding that qory writes; the review gets no result of the
  locked checks.
- `previous_findings`, when it exists, as "Earlier findings" lists.
- `build_report`, when it exists: what the session that made the change states
  that it did.
- `outputs`, when it exists: read the `title` and the `text` of the draft pull request
  from its member `pull-request`, which the input file contains inline. Either part can be
  absent. When `outputs` or its member `pull-request` is missing, check no text of a pull
  request and go on. shortcut: `qory.review_session.outputs` is absent until qory adds it;
  with it absent, the acceptance reviewer checks no pull request text.

The review also reads the newest version of the acceptance criteria, the spec and the build
plan of the work item, from `<start>`, the folder in `qory.start_artifacts` of the input
file. When `qory.start_artifacts` is `""`, the run pulled no artifacts at the start, and
`<start>` is `/tmp/qory-artifacts`, the artifact folder of the run. The copy at `commit`
contains no `.qory` folder, so do not look for them there. Read `<start>/index.json`. Then,
for each of the types `acceptance-criteria`, `spec` and `build-plan`:

- Of the entries of `artifacts` with that `type`, leave out each withdrawn one: an entry
  whose version with the largest `number` in `versions`, of those with no `cancelled` set
  to `true`, has `withdrawn` set to `true`.
- Take the entry left whose `name` is `main`, missing or empty, else the one entry left.
  `<N>` is the entry's `newest_version`, and `<name>` is its `name`, or `main` when the
  `name` is missing or empty.
- Read `<start>/<type>/<name>/v<N>/<file>`, where `<file>` is `acceptance-criteria.json`,
  `spec.md` or `build-plan.md`.

The file of a type cannot be read when `<start>/index.json` or
`<start>/<type>/<name>/v<N>/<file>` does not exist or cannot be read, when no entry is
left, when the entry's `newest_version` is null, when more than one entry is left and none
has the name `main`, or when `<name>` is no folder name. A folder name has only letters,
digits, `.`, `_` and `-`, and is not `.` or `..`. When `qory.start_artifacts` is missing,
or one of the three files cannot be read, stop and write no file.

## The area

The review of the acceptance covers the change measured against the acceptance criteria,
the spec and the build plan: a criterion that the change does not meet, a deliverable that
it does not build or does not build as planned, and work that nobody asked for. It reads
code only to trace a criterion.

The review of the code covers bugs, security holes and data loss in the code, and security
holes, data loss and secrets in the tests, the fixtures and the test setup. The review of
the tests covers the other findings of the tests and the test setup. A finding in another
area is left out: its reviewer writes it. When a bug also breaks a criterion, write
the criterion that is not met: the review of the code writes the cause in the code.

## Earlier findings

When `previous_findings` exists, do "Earlier findings" of `reviewing-changes` and
`judging-findings`. This skill narrows their rule to the findings of your role, the area of
this review: repeat or close each of them by its id. Leave the findings of each other role
alone, because the reviewer of that area repeats or closes them, and a report that repeats
or closes them counts as no report.

## Review of the acceptance

1. Take the live criteria: each entry of `criteria` with no `removed` member, in the
   acceptance criteria that "What the review reads" lists. The `check` of each is
   `Tests` or `Demo: <title>`.
2. For each criterion, find the lines of the change that meet it. Trace one input that the
   words of the criterion describe through those lines to the result. A criterion that the
   change meets needs no finding.
3. For each deliverable of the build plan, check that the diff changes its Files so that its
   Change is done. The session before the round already ends on a deliverable whose row
   with the highest pass in the build ledger is not `done`, or that has no row; in this
   step, you find one marked `done` that changed nothing.
4. Work that nobody asked for: a behaviour that no rule of the spec requires, or one that
   breaks a `Stays:` point of the spec.
5. A changed path that no Files cell of the build plan lists: a deliverable that is not
   built as planned.
6. The build report and the text of the draft pull request, when they exist: a
   claim in them that the diff or the records of the run do not show.
7. A criterion whose `check` is `Demo: <title>`: check its code path only. The Verify stage
   runs the demo.
8. A change that meets every criterion and builds every deliverable gets an empty
   `findings` list. Write no finding to show that you reviewed.

## Blocking in this area

These lists sort the kinds of finding of this area under the definition of `blocking` in
`judging-findings`, and add nothing to it.

- `blocking`: a criterion that the change does not meet, or meets for only part of its
  cases, step 2. The proof is a `failing input` from the words of the criterion, or a
  `failing check` when `output_tail` of `suite_result` shows a test of the criterion fail.
  A red locked check needs no finding, because qory writes it. Also a deliverable of step 3
  whose change is missing, when a criterion of its Criteria cell is not met.
- `non-blocking`: a deliverable of step 3 whose change is missing while its criteria are
  met; work of step 4, with a `broken rule` proof that quotes the spec, unless it also
  breaks a criterion; a path of step 5, with a `broken rule` proof that quotes the Files
  cells of the build plan, unless it also breaks a criterion; and a claim of step 6. Write
  no finding for a claim of step 6 that states that a criterion is met when the change does
  not meet it: the `blocking` finding of that criterion from step 2 covers it.

## Check list

- You took each live criterion of the acceptance criteria.
- Each criterion is traced with one input through the lines that meet it, or has a finding.
- Each deliverable of the build plan has its change in the diff, or a finding.
- Each behaviour that no rule of the spec requires has a finding.
- Each changed path that no Files cell of the build plan lists has a finding.
- No finding is about the cause of a bug in the code, a test or the test setup.
- No finding is made up: a change that meets every criterion has an empty `findings` list.
- Each open finding of this area in `previous_findings` is repeated with its `id` while it
  is still true, and closed in `closes` otherwise.
