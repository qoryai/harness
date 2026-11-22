---
name: changing-code
description: Load before you change code for one step of a build. Contains the step you get, the paths you may change, the tests of the change, the checks you run before you report, the locked checks, and the list of what you left out.
---

# Changing code

A build changes code in steps. A step is one deliverable of the build plan, such as
`deliverable:d-2`, or one finding to fix, such as `fix:f3`. You change the code of one step
and report. The session then checks the change, commits it when every check is green, and
records the step in the build ledger. You commit nothing and push nothing.

## The step you get

- For a deliverable: its row of `## Deliverables` in the build plan, with its Id, Change,
  Criteria, Files and Check cells. The Change cell states what the step builds. The
  criteria in the Criteria cell are the outcome that the change meets.
- For a finding: its id, its severity, its file and line, and its point. A finding of a
  review has the rest of its text, its quote, problem, fix and proof, in the open findings
  file whose path you get. A finding of Verify is a criterion that was not met, with the
  evidence, or a point of its verdict.
- At a later start of the same step: the lines of each check that was red after your last
  change, and your last report. Fix the cause of those lines first.

Read the build plan at the path that you get, never a draft in the artifact folder. When
the finding is not true, change no file, and give the reason in your line `Change:`.

## The paths you change

Change only the paths that the Files cell of your deliverable lists. For a finding, change
only the paths that the Files cell of a deliverable lists. A path in a Files cell is a file,
or a folder that ends with `/`, whose files you may add or change.

- When the change needs any other path, change no file, and report the change that the
  build plan needs.
- Change no locked file: the file of a locked check and each support file of the acceptance
  lock. A locked check states what the change must meet, so you fix the code, not the
  check.
- Change nothing under `.qory/` and add no `.gitignore` file: the session commits neither.
- Write no key, token or password into a file. Use the name of the variable that contains
  it.

## The tests of the change

- Add or change a test for each branch or calculation that you add, in the test files of
  that area, when they are under the paths you may change. Use the test framework and
  the helpers that the tests of that area use.
- Add no skip, xfail or only mark to a test, nor the runtime's equivalent.
- Keep every test that passed at the start of the step green.

## The checks you run

Run each check in the forms that `running-checks` lists, with the path of the input file as
`--inputs <path>`.

1. After each change, run `checks.cjs run targeted <path>... --inputs <path>` with the test
   files of your change, until they are green.
2. When the Check cell of your deliverable is the path of a locked check, run
   `checks.cjs run locked <criterion> --inputs <path>` with the criterion of that check,
   until it is green. The tool guard denies `run targeted` with the path of a locked file.
3. Before you report, run `checks.cjs run lint --inputs <path>`, `run types` and
   `run build` the same way, and fix each red line that your change causes.

A red check writes the output of its command to `.reports/runs/` of the artifact folder:
read it there. When a check stays red after 5 runs and you find no cause, report the last
line of the check.

## The list of what you left out

Your report ends with the list `Left out:`. Write one line `- <item>: <risk>` for each part
of the step that you did not build, and for each `shortcut:` comment that you wrote, with
the path and line of the comment. Write the list in one of these two forms:

- With no item, the one line `Left out: none`.
- With items, the line `Left out:` alone, then one line per item at the start of the line,
  then the line `# End`. The session reads the list up to that line.

```text
Left out:
- The export keeps no history of earlier files: a member who exports twice loses the first file.
- shortcut: the list loads all rows at once, page it when a workspace has over 5,000 items (`src/items/list.ts:42`): the page loads slowly above that count.
# End
```

Write each item on one line, however long: a line that does not start with `- `, an
indented line included, makes the list unreadable.
