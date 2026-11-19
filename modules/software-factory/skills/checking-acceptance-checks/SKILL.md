---
name: checking-acceptance-checks
description: Load before you report the acceptance checks you wrote, and before you review them. Contains what a review of the checks reads, the steps of the review, the findings for a file outside the lock, a changed test setup and a skip mark, and the check list for writer and reviewer alike.
---

# Checking acceptance checks

A writer works through the check list before it reports. A reviewer does the section
"Review of the checks", then the check list, and reads the checks against the acceptance
criteria, the build plan and the records of their runs.

## What the review reads

The work is the draft `acceptance-lock.json` at the top of the artifact folder, the file of
each entry of its `checks` and `support` in the working folder, and the writer's report,
with one item per check under "Checks:". Each item has the id of the record of the last run
of that check, `.reports/runs/<id>.json` of the artifact folder, and the output of its
command is in the file of the record's `logs`. Only the checks script writes those records.

The run passes no "Checks:": the draft has no `sha256` until `lock` fills it, so no checks
script reads it before the review. This document is no Markdown document of
`artifact-text`: skip the section "A Markdown document" of `reviewing-drafts`.

The reviewer reads files only, so the run passes the real changes under "Changed paths:":
the output of `git status --porcelain --untracked-files=all` and of `git diff --name-only
<start commit>`, run in the working folder before each review. A path of a `git status
--porcelain` line is the text after its two status characters and a space, and a rename
lists both of its paths.

In this review, the mark `break` on every finding means that the run must not push the lock
while the finding is left, not what `reviewing-drafts` defines for it.

## Review of the checks

1. Before you read the checks, list what a person asked for in the ticket, the notes, a
   person's answer to a question about a criterion, and the newest approved acceptance
   criteria. A quote that differs from its source is a finding.
2. Each criterion that is not removed and whose `check` is `Tests` has an entry under
   `checks`, and each entry has such a criterion. A missing or extra entry is a finding
   marked `writer`, `no direction` and `break`.
3. Each entry's `path` is the Check cell of a row of the build plan whose Criteria cell
   lists the criterion. A check path is a relative path with no space and no `.` or `..`
   part, whose file name has an extension, such as `tests/export.test.ts`; `n/a`, `none`,
   `-`, `TBD` and a scenario id are none. The check scope of that row is its Check path, and
   each folder of its Files that is the first folder of the Check path or below it, such as
   `tests/` and `tests/helpers/` for `tests/x.test.ts`; a Check path with no folder adds
   none. Each other file that the writer's report lists under "Files:", but
   `acceptance-lock.json`, is a new helper or fixture below a folder of the check scope of
   such a row. A change to code under test, also one that the Files of the row list, to a
   file of another row, or to a file that exists and is no check is a finding marked
   `writer`, `no direction` and `break`. So is each path of "Changed paths:" that the
   writer's "Files:" does not list, except a path under `.qory/` and a Result file of a row
   of `## Commands` in the build plan: the report lacks a change that exists.
4. Each check states the outcome of its criterion as an assertion. A test of another
   outcome, a test that passes whatever the code does, and a test that a later change that
   meets the criterion would fail, such as one that reads a private detail, are findings.
5. Each check fails on the start commit for the right reason. In the record of its item,
   `commit` is the start commit of the input file, `paths` has the check's path, `exit` is
   the entry's `failed_with`, and `counts.failed` is 1 or more. In the log, an assertion of
   the check failed because the outcome is missing. A green run, a failure from an error of
   the check itself, such as a syntax error or a wrong import, and a record that does not
   match the entry are findings marked `break`.
6. The files outside the lock: the command of a check runs, or a check imports, only the
   code under test, the locked checks and the files under `support`. A file of the
   repository whose only use is the tests, such as a helper, a fixture, a setup file or a
   config of the test runner, that the command runs or a check imports, and that the draft
   lists neither as a check nor under `support`, is a finding marked `writer`,
   `no direction` and `break`: a later step could change that file and turn the locked check
   green with no change to the code.
7. The test setup: a check whose command or whose files change the setup of the tests is a
   finding marked `writer`, `no direction` and `break`. Such a change is a flag or a
   variable in the command that the `targeted` command of the build plan lacks, a check
   that writes to a setup file or a config of the test runner, or a changed file that sets
   up the tests of other files.
8. The marks: a test of a check with a skip, xfail or only mark, or the runtime's
   equivalent, such as `test.skip`, `it.only`, `xit`, `@pytest.mark.skip`,
   `@pytest.mark.xfail`, `t.Skip()` or `@Disabled`, is a finding marked `writer`,
   `no direction` and `break`. A locked check with such a mark shows nothing about its
   criterion.
9. Each command is the `targeted` command of the build plan, a space, and the check's path.
10. A note or a line that starts with "Fix first:" that concerns the checks is applied. A
    change that nobody asked for is a finding.

## Check list

- Each criterion planned as `Tests` has a check, and each check has such a criterion.
- Each check is at its Check path, and each new helper or fixture is below a folder of the
  check scope of the same row.
- The report's "Files:" lists each file that the writer wrote, so each path of "Changed
  paths:" of the reviewer is in it.
- Each check states its criterion's outcome as an assertion, and calls the code as its users
  do.
- Each check failed on the start commit with a failed test, and its `failed_with` is the
  `exit` of the record of that run.
- The command runs, and the checks import, no file whose only use is the tests that the
  draft does not list as a check or under `support`.
- No check or command changes the setup of the tests.
- No test has a skip, xfail or only mark, nor the runtime's equivalent.
- `criteria.version` is the approved version, `start_commit` is the start commit, and the
  draft has no `sha256` and no `repository`.
- No check and no report contains a secret.
- Each finding has its three marks, and is plain text with no backticks and no asterisks.
