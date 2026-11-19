---
name: checking-tests
description: Load before you review the tests of a change, after reviewing-changes and judging-findings. Contains what the review reads, the area it covers, the steps, what is blocking in that area, and the check list.
---

# Checking tests

Load `reviewing-changes` first and `judging-findings` next. This skill adds the area of the
review of the tests: what it reads, the steps, and how each kind of finding of the area
falls under the definition of `blocking` in `judging-findings`.

## What the review reads

- `qory.review.diff`: the lines that the change adds and removes. Read all of it.
- `qory.review.commit`: the read-only copy of the change. Search it with Grep and Glob, with
  its path as the folder. The diff shows a deleted test; the copy shows the code that the
  test would run on now.
- `qory.review.suite_result`: the result of the full suite, with the counts `tests`,
  `failed` and `skipped`. Its `output_tail`, the last lines of the output of the suite, is
  the source of a `failing check` proof. When `suite_result` has no `output_tail`, prove a
  `blocking` finding with a `failing input`. A red locked check is a finding that qory
  writes; the review gets no result of the locked checks.
- `qory.review.previous_findings`, when it exists, as "Earlier findings" lists.
- `qory.review.build_report`, when it exists. A claim in it is no proof. Judge the tests.

## The area

The review of the tests covers every test file that the change adds, changes or deletes,
and the test setup: a config of the test runner, a setup file, a helper or a fixture that
other tests use. It reports a failing test that the change skips, deletes or loosens,
changed code with no test, and a test that shows nothing.

The review of the code covers every other file of the change, and also a security hole,
data loss or a secret in a test file, a fixture or the test setup. The review of the
acceptance covers the change against the acceptance criteria and the build plan. A finding
in another area is left out: its reviewer writes it. When the change skips, deletes or
loosens a failing test, write that test: the review of the code writes the bug in the code
under that test. A failing test that the suite shows is the finding that the run writes.

## Earlier findings

When `previous_findings` exists, re-read the lines of each finding in it, as
`reviewing-changes` and `judging-findings` list. This skill narrows their rule to the
findings of the area of this review: repeat, with its id, each such finding that is still
true. Leave out the findings of each other area, because the reviewer of that area repeats
them. The shape of `previous_findings` is not in a contract of qory yet.

## Review of the tests

1. List the test files that the diff adds, changes or deletes.
2. A test that the change deletes, skips, marks to fail, limits with an "only" mark, or
   loosens: an assertion removed, an expected value changed to the new output, a longer
   timeout or more retries. Trace the old test against the new code in the copy. When it
   fails there, the change skips, deletes or loosens a failing test.
3. Changed code with no test: for each changed branch of code that is not a test, Grep the
   test files for a test that reaches it.
4. A test that passes whatever the code does: no assertion, an assertion only on a mock, a
   catch that drops the error, or an assertion on the test's input.
5. A test whose result depends on outside factors: the time, randomness, the order of the
   tests, the network or a sleep.
6. The test setup: a changed config of the test runner, setup file, helper or fixture.
   Trace each test that uses it. This step warns early: the review of the locked checks in
   the Verify stage is the one that binds.
7. The suite: write no finding for a red suite, or for one that did not run, because the
   run writes it. Compare no count of the suite with the skip marks: in step 2, you find
   each test that the change skips.

## Blocking in this area

These lists sort the kinds of finding of this area under the definition of `blocking` in
`judging-findings`, and add nothing to it.

- `blocking`, with a `failing input` that traces the old test through the new code: a test
  of step 2 that fails on the new code, and a change to the setup of step 6 that turns a
  failing test green with no change to the code under test.
- `non-blocking`: a test of step 2 that still passes on the new code, with the reason in the
  finding; changed code with no test, step 3; a test that shows nothing, step 4, unless the
  change loosens it and it fails on the new code, as in step 2; a test of step 5, unless a
  `failing input` shows it failing on the change, such as in another time zone; and any
  other change to the setup, step 6.

## Check list

- You listed each test file that the diff adds, changes or deletes.
- Each deleted, skipped or loosened test is traced against the new code.
- Each changed branch of code has a test that reaches it, or a finding.
- Each change to the test setup is traced through the tests that use it.
- No finding is about code that is not a test, about the acceptance criteria, or about a
  security hole, data loss or a secret in a test.
- A failing test that the change skips, deletes or loosens has a finding on that test, and
  none on the bug in the code.
- No finding is for a red suite or a suite that did not run.
- Each earlier finding of this area that is still true is in the report with its `id`.
