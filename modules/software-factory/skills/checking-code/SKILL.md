---
name: checking-code
description: Load before you review the code of a change, after reviewing-changes and judging-findings. Contains what the review reads, the area it covers, the steps, what is blocking in that area, and the check list.
---

# Checking code

Load `reviewing-changes` first and `judging-findings` next. This skill adds the area of the
review of the code: what it reads, the steps, and how each kind of finding of the area falls
under the definition of `blocking` in `judging-findings`.

## What the review reads

- `qory.review.diff`: the lines that the change adds and removes. Read all of it.
- `qory.review.commit`: the read-only copy of the change. Search it with Grep and Glob, with
  its path as the folder, and read each file of the diff in it.
- `qory.review.suite_result`: the result of the full suite, for a `failing check` proof.
- `qory.review.previous_findings`, when it exists, as "Earlier findings" lists.
- `qory.review.build_report`, when it exists: what the session that made the change states
  that it did. A claim in it is no proof. Judge the code.

## The area

The review of the code covers every file of the change that is not a test file, a fixture
or a setup of the tests. It reports bugs, security holes and data loss in that code, and
the non-blocking findings of that code.

The review of the tests covers the test files, the test setup and the counts of the suite.
The review of the acceptance covers whether the change does what the acceptance criteria and
the build plan ask for, and whether it does more. A finding in another area is left out: its
reviewer writes it. The review of the code never judges whether a change was asked for.
When a bug also breaks a criterion, write the cause in the code: the review of the
acceptance writes the criterion that is not met.

## Earlier findings

Of `previous_findings`, read only the entry whose `reviewer` is the name that you write in
`reviewer` of the report. In it, leave out each finding with no `quote`: the run wrote it,
and writes it again when it still applies. Re-read the lines of each other finding, as
`judging-findings` lists.

## Review of the code

1. Read the whole diff. For each hunk, read the whole changed function or block in the
   copy.
2. For each changed signature, return value, error or default, Grep the copy for its
   callers. A caller that the change breaks is a bug.
3. Bugs: an empty input, one item, the limit and the limit plus one; an error that the code
   misses or drops; a wrong order of steps or a wrong state; a retry that repeats a side
   effect; a resource that stays open; time zones and locales.
4. Security holes: an input that reaches a query, a command, a path, a template or the
   address of a fetch; a new entry point with no access check; a secret in the code or in a
   log; a setting that widens access.
5. Data loss: a migration or a write that drops, truncates or overwrites data; a delete
   with a wider scope than its rule; a step that cannot be undone and has no guard.
6. The same defect in another place of the change is a separate finding for each place. A
   defect in code that the change does not touch and does not newly call is no finding.
7. The suite: write no finding for a red suite, because the run writes it. You may cite a
   failing row of `suite_result` as the `failing check` of a bug that you name. The result
   of the suite has counts and no failing rows yet, which waits on a change to qory: until
   then, prove a bug with a `failing input`.

## Blocking in this area

These lists sort the kinds of finding of this area under the definition of `blocking` in
`judging-findings`, and add nothing to it.

- `blocking`, with a `failing input` traced through the quoted lines, or a `failing check`:
  a bug of step 2 or 3, a security hole of step 4, and data loss of step 5.
- `non-blocking`, with a `broken rule` proof when a file of the repository writes the rule
  down, such as a style guide, with that file and line: dead code that the change adds, an
  unclear name, duplicated code, a missing comment on a limit, and a break of such a rule.
- A bug, a hole or a loss that you cannot prove by reading is `non-blocking`, or you leave
  it out.

## Check list

- You read the whole diff, and each changed block whole in the copy.
- Each changed signature, return value, error and default has its callers checked.
- Each bug, security hole and data loss is a separate finding, with a proof that repeats it.
- No finding is about a test file, the test setup, the counts of the suite or whether the
  change was asked for.
- No finding is about code that the change does not touch and does not newly call.
- No finding is for a red suite.
- Each earlier finding of your entry that is still true is in the report with its `id`.
