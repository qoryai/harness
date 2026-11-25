---
name: writing-acceptance-checks
description: Load before you write the acceptance checks of a build. Contains where each check goes, what a check tests, its command, the run on the start commit and what counts as failing there, the support files, the marks that no check has, and the draft of the acceptance lock.
---

# Writing acceptance checks

Load ${qory:skills/checking-acceptance-checks} before you report. Its check list applies to
what you write, and this skill adds the rest.

An acceptance check is a test file that shows one or more criteria planned as `Tests`. The
run locks each check before the build changes code: from then on, no step can change the
check, and each later change must make it pass. So each check fails on the start commit, the
commit of the checkout at the start of the run, and passes once the code meets its criteria.

## Where each check goes

Read the newest build plan, `build-plan/main/v<N>/build-plan.md` of the artifact folder with
the largest `<N>`, and the newest approved acceptance criteria. A check path is a relative
path with no space and no `.` or `..` part, whose file name has an extension, such as
`tests/export.test.ts`; `n/a`, `none`, `-`, `TBD` and a scenario id are none. Each row of
`## Deliverables` whose Check is a check path has one check: the file at that path. Its
criteria are the ones of the Criteria cell of that row.

The check scope of a row is its Check path, and each folder of its Files that is the first
folder of the Check path or lies below it (`src/` and `src/test/resources/` for
`src/test/java/x/FooTest.java`), unless the folder contains a Files entry of any row that is
a file and no Check path, such as `src/` with `src/a.ts`; a Check path with no folder adds
none. A code folder that contains its check, such as `src/export/` for
`src/export/export.test.ts`, is in scope, and `check-reviewer` reports a write there to code
under test. The scope check of the run fails on each changed path outside the check scope of
every row.

- Write the check at its Check path, and nowhere else.
- Write a new helper or fixture of the check only below a folder of the check scope of the
  same row. Another folder of the Files, such as `src/`, is not in it.
- When the Check path already exists, as after an earlier round, edit it in place.
- Change no other file. Code under test, also when the Files of the row list it, a file of
  another row and a file that sets up the tests, such as a config of the test runner or a
  global setup file, stay as they are.
- Write checks only in the working folder, the run's repository.

## What a check tests

- For each criterion of the row, the check has at least one test that states the
  criterion's outcome as an assertion, as a member would check it. Name the test by the
  criterion, such as `AC-4: each customer with the old hours gets a corrected reply`.
- Call the code as its users do: through its public functions, its routes or its commands.
  A test that reads a private detail fails on a later change that meets the criterion.
- When the code that the criterion needs does not exist yet, call it where the build plan
  puts it, such as the "new file" of a deliverable. Read the Change cell and the Files of
  the row for its place and name.
- Use the test framework and the helpers that the tests of that area use: the code
  explorer's facts are in the build plan, and `exploring-code` finds the rest.
- A check has no skip, xfail or only mark, nor the runtime's equivalent, such as
  `test.skip`, `it.only`, `xit`, `@pytest.mark.skip`, `@pytest.mark.xfail`, `t.Skip()` or
  `@Disabled`. A skipped test is red in every run of a locked check.

## The command

The command of a check is the `targeted` command of the build plan, a space, and the Check
path, such as `npm test -- tests/corrected-reply.test.ts` for the command `npm test --`.
Add no flag, no variable and no other path. A row with two criteria has two entries under
`checks`, each with the same path and command.

## The run on the start commit

The checkout is at the start commit, with your checks added and no other change. Run each
check with the checks script of `running-a-workflow`:

```
<skill folder>/checks.cjs run targeted <path> --inputs <input file>
```

`<path>` is the Check path, and `<input file>` is the path of the input file that you got.
Give each such Bash call the timeout 3600000 ms, and run no other command in the same call.

- A check fails right when the run prints the line "Fix the code or the test of each failed
  test, then run targeted again." with a count of failed tests after it, and the output in
  the log shows that an assertion of the check failed because the outcome of the criterion
  is missing. The last line of the run has the id of the record, "The output and the record
  are in .reports/runs/, as <id>.": read `.reports/runs/<id>.json` of the artifact folder,
  and its `exit` is the value of `failed_with`.
- Every other result is wrong: a green run, a missing tool, zero tests, a skipped test, no
  result file, a time-out, or a failure that an error of the check causes, such as a syntax
  error or a wrong import of a helper. Fix the check, and run it again.
- A failed test that passes when it runs alone makes the run green: make the check fail
  alone too.

## The support files

A support file is a file of the repository, other than a check, that the command runs or a
check imports and whose only use is the tests: a helper, a fixture, a setup file, a config
of the test runner, or a script that the command starts. List each one under `support`, a
new one or one that exists. The lock keeps its SHA-256, so no later step can change it. Code
under test is no support file: the build changes it.

## The draft of the lock

Write `acceptance-lock.json` at the top of the artifact folder, as JSON in this shape:

```json
{
  "criteria": {"version": 2},
  "start_commit": "<the start commit>",
  "commit": "<the start commit>",
  "checks": [
    {
      "criterion": "ac-4",
      "path": "tests/corrected-reply.test.ts",
      "command": "npm test -- tests/corrected-reply.test.ts",
      "failed_with": 1
    }
  ],
  "support": [{"path": "tests/helpers/orders.ts"}]
}
```

- `criteria.version`: the number of the approved version of the acceptance criteria, the
  version whose `id` is the `approved_version` of `acceptance-criteria` in `index.json`.
- `start_commit` and `commit`: the commit of `qory.start_commits` in the input file whose
  `path` is the working folder. The run sets `commit` to the commit of the checks before it
  locks them.
- `checks`: one entry for each criterion planned as `Tests`, in the order of the criteria.
  `failed_with` is the exit of the last run of that check.
- `support`: each support file. Leave `support` out when there is none.
- Write no `sha256`, no `criterion_sha256` and no `repository`: the lock fills each `sha256`
  and each `criterion_sha256`.

When you get a line of `scope` or `lock`, change only the file or the field that the line is
about. A line that sets `/criteria/version` contains the version to write.

## Notes and review comments

Apply each note and each line that starts with "Fix first:" that concerns the checks. A note
that concerns only another output is no word on the checks.
