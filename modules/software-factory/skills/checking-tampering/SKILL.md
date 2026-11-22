---
name: checking-tampering
description: Load before you review whether a change tampers with the locked acceptance checks, after reviewing-changes and judging-findings. Contains what the review reads, the area, the steps, what is blocking, and the check list.
---

# Checking tampering

Load `reviewing-changes` first and `judging-findings` next. This skill adds the area of the
review of tampering: what it reads, the steps, and how each kind of finding of the area
falls under the definition of `blocking` in `judging-findings`.

A locked check is a check that the acceptance lock lists: its file, its command and the
files under `support`. The lock stores a SHA-256 for each of them, and `run locked` of
Verify refuses a changed one. The lock cannot see a file that a locked check runs or imports
and that it does not list, and it cannot see a skip mark in a test that it does not list.
This review reads those two gaps in the diff.

## What the review reads

- The file at `qory.review_session.diff`: the lines that the change adds and removes. Read
  all of it.
- The copy of the change: the working folder, at `qory.review_session.commit`. Search it
  with Grep and Glob to trace what a locked command runs and what a locked file imports.
- The file at `qory.review_session.previous_findings`, when the member exists, as "Earlier
  findings" lists. The member is missing in the first round.

The review also reads the newest acceptance lock from `<start>`, the folder in
`qory.start_artifacts` of the input file. The copy of the change contains no `.qory` folder,
so do not look for the lock there. Read `<start>/index.json`. Of the entries of `artifacts`
with the `type` `acceptance-lock`, leave out each withdrawn one: an entry whose version with
the largest `number` in `versions`, of those with no `cancelled` set to `true`, has
`withdrawn` set to `true`. Take the entry left whose `name` is `main`, missing or empty,
else the one entry left. `<N>` is the entry's `newest_version`, and `<name>` is its `name`,
or `main` when the `name` is missing or empty. Read
`<start>/acceptance-lock/<name>/v<N>/acceptance-lock.json`.

The lock cannot be read when `<start>/index.json` or that file does not exist or cannot be
read, when no entry is left, when `newest_version` is null, when more than one entry is left
and none has the name `main`, or when `<name>` is no folder name. A folder name has only
letters, digits, `.`, `_` and `-`, and is not `.` or `..`. When `qory.start_artifacts` is
missing, or the lock cannot be read, stop and write no file.

## The area

The review of tampering covers the change measured against the lock: a file that a locked
check could run or import, and a test mark that hides a test. It reads no other part of the
change. The review of the code covers bugs in the code, the review of the tests covers the
quality of the tests, and the review of the acceptance covers the criteria. A finding in
another area is left out: its reviewer writes it.

## Review of tampering

1. Take the entries of `checks` and `support` of the lock. Each has a `path`; each check
   also has a `command`.
2. List the paths that the diff adds, changes or deletes.
3. For each changed path that the lock does not list, find out whether a locked check uses
   it. A locked command runs it, or a locked file, or a file that one of those imports or
   loads, reads it. Trace the command and the imports with Grep in the copy. A file that is
   code under test is no finding: the lock leaves it free, because the criterion is about
   its behaviour. A file whose only use is the tests, such as a helper, a fixture, a setup
   file or a config of the test runner, is a finding when a locked check uses it: a change
   there can turn a locked check green with no change to the code under test.
4. A changed path that the lock lists is no finding: `run locked` refuses it by its hash.
5. Each test that the change newly skips, or newly marks with a skip or an xfail mark, or
   the runtime's equivalent, is a finding. The marks are `test.skip`, `xit`,
   `@pytest.mark.skip`, `@pytest.mark.xfail`, `t.Skip()` and `@Disabled`. `it.only` is no
   skip mark, but it skips every other test of its file, so it is blocking like a skip mark.
   A skipped test does not fail a suite, so no red result shows it. Find each such test in
   the added lines of the diff, and in a changed line that adds a mark to an existing test.
   A mark that exists in the state before the change is no finding.
6. A change that touches no unlisted file that a locked check uses and adds no mark gets an
   empty `findings` list. Write no finding to show that you reviewed.

## Blocking in this area

These lists sort the kinds of finding of this area under the definition of `blocking` in
`judging-findings`, and add nothing to it. This review gets no result of the locked
checks, so a proof is a `failing input`: trace the check through the changed file, or name
the test and its mark.

- `blocking`: a changed file of step 3 that a locked check uses, when tracing the check
  through that file shows that the check passes with the code under test unchanged; and
  each mark of step 5 on a test that exists in the state before the change, because the
  test then no longer runs.
- `non-blocking`: a changed file of step 3 that a locked check uses, when the change
  keeps what the check asserts. It has a `broken rule` proof that quotes the lock entry.

## Check list

- You took each entry of `checks` and `support` of the lock.
- Each changed path that the lock does not list is traced through the locked commands and
  the imports of the locked files.
- Each existing test that the change newly skips, or marks with a skip, xfail or only mark,
  has a `blocking` finding.
- No finding is about a path that the lock lists, about code under test, or about a bug.
- No finding is made up: a change that tampers with nothing has an empty `findings` list.
- Each earlier finding of this area that is still true is in the report with its `id`.
