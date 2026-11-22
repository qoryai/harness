---
name: judging-criteria
description: Load before you review the states of a verification matrix, after reviewing-changes and judging-findings. Contains what the review reads, when a state is lowered, the quote form of a criterion, the steps, and the check list.
---

# Judging criteria

Load `reviewing-changes` first and `judging-findings` next. This skill adds the area of the
review of a verification matrix: what it reads, when you lower a state, and how each kind
of finding of the area falls under the definition of `blocking` in `judging-findings`.

A verification matrix is the file `verification.json`. One row per criterion has a `state`,
`met` or `not_met`, and an `evidence` text. A script wrote the matrix from the records of
the run, so no agent typed a state. You read what a script cannot read: whether the evidence
shows what the state says.

## What the review reads

- The draft `verification.json` that `matrix` wrote at the top of the artifact folder of the
  run, `/tmp/qory-artifacts/verification.json`. This is the file that the session pushes.
  Read no `verification` from `qory.start_artifacts`: that folder is the pull of the start,
  which has no draft of this session.
- The newest `acceptance-criteria` and the newest `acceptance-lock`, from `<start>`, the
  folder in `qory.start_artifacts` of the input file. For each type, read
  `<start>/index.json`, leave out each withdrawn entry (the version with the largest
  `number` in `versions`, of those with no `cancelled` set to `true`, has `withdrawn` set to
  `true`), and take the entry left whose `name` is `main`, missing or empty, else the one
  entry left. `<N>` is its `newest_version`, and `<name>` is its `name`, or `main` when it
  has none. Read `<start>/<type>/<name>/v<N>/<file>`, where `<file>` is
  `acceptance-criteria.json` or `acceptance-lock.json`.
- For each row whose `evidence` starts with `Demo video: ` or `Pictures: `, the newest
  `demo-evidence` of the scenario that it names, `scenario-N`. Read `<start>/index.json` as
  above, for the entry whose `type` is `demo-evidence` and whose `name` is the scenario, and
  read `<start>/demo-evidence/<name>/v<N>/<name>.json`.
- The file at `qory.review_session.diff`, and the copy of the change, the working folder at
  `qory.review_session.commit`: to read a locked check or the code that a criterion names.
- The file at `qory.review_session.previous_findings`, when the member exists, as "Earlier
  findings" lists. The member is missing in the first round.

The draft cannot be read when `/tmp/qory-artifacts/verification.json` does not exist, is a
link, or is no JSON. A file of `<start>` cannot be read when `<start>/index.json` or its
file does not exist or cannot be read, when no entry is left, when `newest_version` is null,
when more than one entry is left and none has the name `main`, or when `<name>` is no folder
name. A folder name has only letters, digits, `.`, `_` and `-`, and is not `.` or `..`. When
the draft, `qory.start_artifacts`, one of the two files of `<start>`, or the `demo-evidence`
of a scenario that a row names cannot be read, stop and write no file.

## Lowering a state

You lower a state and never raise one. A state is lowered when `met` is the state of a row
and its evidence does not show that the criterion is met. You write that as one finding.
A row with `not_met` stays as it is, whatever you read. A criterion in `not_verified` stays
there. When a row's evidence fails to show a state that you would raise, write nothing:
raising is no part of this review.

The lowered state is the finding itself. The finding is `blocking`, because a criterion
that the matrix calls met is not met, and the work item returns to Build with the finding.
No other part of the report records the lowering, and the matrix is not edited.

## How a criterion is quoted

Quote a criterion in a finding, and in any text about the matrix, as its id in capitals,
a comma, a space, and its first sentence in double quotes: `AC-3, "The reply states that
support is closed on 25 December"`. The words are the criterion's words, with no full stop
inside the quotes unless the sentence has one, and no other word. A quote of other words, or
an id with no words, is wrong. The check of `verification.json` refuses it in an `evidence`.

## Review of the matrix

1. Take the live criteria: each entry of `criteria` of the acceptance criteria with no
   `removed` member.
2. For each row with the state `met`, read the criterion and its `evidence`.
3. When the evidence names a locked check, find its entry in the lock, read the file of that
   check in the copy, and trace one input that the criterion's words describe through the
   check. A check that does not assert the criterion's outcome does not show it.
4. When the evidence starts with `Demo video: ` or `Pictures: `, it names a scenario. Read
   the newest `demo-evidence` of that scenario in `<start>`: its `verdict` must be `passed`
   and each step must have passed. Read the scenario's steps against the criterion's words.
5. A criterion whose evidence shows its state gets no finding.
6. A change that leaves every row shown gets an empty `findings` list. Write no finding to
   show that you reviewed.

## Blocking in this area

These lists sort the kinds of finding of this area under the definition of `blocking` in
`judging-findings`, and add nothing to it.

- `blocking`: a lowered state of step 3 or 4, with a `failing input` proof from the words of
  the criterion: the input, the lines of the check or the steps of the scenario that it
  takes, and the result that shows the criterion is not met.
- `non-blocking`: evidence that is true but too thin to check, with a `broken rule` proof
  that quotes the evidence and the rule "what was looked at or run, and the result".

## Check list

- You took each live criterion and each row of the matrix with the state `met`.
- Each lowered state is a `blocking` finding with a `failing input` proof, and no row is
  raised.
- Each quote of a criterion in the report has its id in capitals and its first sentence.
- No finding is about the cause of a bug in the code or a test.
- No finding is made up: a matrix whose evidence shows each state has an empty `findings`
  list.
- Each earlier finding of this area that is still true is in the report with its `id`.
