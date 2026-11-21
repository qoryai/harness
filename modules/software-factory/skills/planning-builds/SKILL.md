---
name: planning-builds
description: Load before you write a build plan. Contains the three sections of the plan, the deliverables table and its Criteria cell, the limit of 7 deliverables, the Files of a deliverable and the check files, the commands table, the App address line, and what to do with a plan of more than 7 deliverables.
---

# Planning builds

Load ${qory:skills/artifact-text} and ${qory:skills/checking-build-plans} before you write.
The check list of `checking-build-plans` lists the form of the plan, and this skill adds
the rest.

A build plan lists the separate changes that Build makes for the approved acceptance
criteria, the files that each change may write, and the commands that check the work. It
contains no code, and it does not repeat the spec.

## Where the draft starts

Write `build-plan.md` at the top of the artifact folder. Plan from the newest approved
`acceptance-criteria`, the `spec`, the newest `demo-scenarios` and the code explorer's
report. The report shows which files exist and which commands the repository has. A file or
a command that neither the report nor a file you read shows does not go into the plan.

Edit in place the copy of the newest `build-plan` that the run made, as `reading-the-work`
lists. A deliverable whose criteria did not change keeps its id.

## The sections

`build-plan.md` has these three sections, in this order, and no other:

1. `## Summary`: one to three sentences on what the build changes. When the Commands table
   has a `serve` row with a command, the Summary also has the line `App address: <url>`,
   as "The app address" lists.
2. `## Deliverables`: one table.
3. `## Commands`: one table.

## The deliverables

The table has the columns `Id`, `Change`, `Criteria`, `Files` and `Check`, with one row per
deliverable.

- **Id:** `d-<N>`, counted from 1, each once. Build makes the deliverables in this order, so
  a deliverable needs nothing from a later one.
- **Change:** one sentence on what the change does, in words that a member reads. A
  deliverable is one change that one agent makes and one reviewer reads at once. Put the
  files and criteria of one behaviour in one deliverable. Never join unrelated changes to
  stay within 7.
- **Criteria:** each criterion that the change meets, as its id and its first sentence in
  quotes, `AC-<N>, "<the criterion's first sentence>"`, with `; ` between two criteria.
  Copy the sentence from the acceptance criteria without its full stop, and never write an
  id alone, such as `AC-1` or `ac-1`. Each criterion that is not removed is in at least one
  row.
- **Files:** every path that the change may write, below the top of the checkout, separated
  by commas. End a folder with `/`. The scope check before the push refuses a commit with a
  path that no Files cell lists. A path that does not exist yet is a file that the change
  creates, and the Change contains the words "new file" for it, with no path.
- **Check:** one value, so a deliverable lists criteria of one check only:
  - for criteria planned as `Tests`, the path of their test file, such as
    `tests/corrected-reply.test.ts`;
  - for criteria planned as `Demo: <title>`, the id of the scenario in the newest
    `demo-scenarios` that has that title, such as `scenario-1`;
  - for a deliverable with no such criterion, `n/a`.

## The check files

The checks of the criteria planned as `Tests` are written and committed before the
deliverables are built, and the scope check before the push refuses every path that no
Files cell lists. So each Check path of a test file is also in the Files of the same row.
When tests of that area use a helper or a fixture, the Files also list the folder with
it, such as `tests/`, so that the helper files of a check fit under Files too. The code
explorer's report shows where the tests of that area live and which helpers they use.

## More than 7 deliverables

A build plan has at most 7 deliverables, and the script that checks it refuses more,
unless the newest member's answer on the work item is "Build all <n> changes in this work
item." with `<n>` of 8 or more: then the limit is `<n>`. When the work needs more than 7
separate changes, still write each of them in the draft, and list each one under "Over the
limit:" in your report, with its Criteria cell. Never drop a criterion, and never merge
unrelated changes to reach 7. The session then asks a member which changes to build, and
pushes no plan.

## The commands

The table has the columns `Kind`, `Command`, `Result file` and `Source`, with one row for
each of the kinds `targeted`, `lint`, `types`, `build` and `full`, and a `serve` row when a
criterion is planned as `Demo`.

- **targeted:** the command that runs the test files of one deliverable. Write it so that
  the paths of the test files come last, with no `#`, `;` or `&&`: the run adds the paths
  at its end. Its Result file is the JUnit XML file that it writes.
- **full:** the command that runs every test, with the same Result file.
- **lint, types, build, serve:** the Result file is `none`.
- **Command:** a command that the explorer's report or a file shows. With no such command,
  write `none` in Command, and in Source the reason, such as "The repository has no
  linter."
- **Source:** where the command comes from, in one of three forms: `repository: <file>`,
  when a file of the repository declares it; `module: <name>`, when a technology module
  provides it; or `found: <file>:<line>`, the file and line that state it.

## The app address

When the Commands table has a `serve` row with a command, the Summary has one line outside
a code block that starts with `App address: ` and ends with the address of the app
after `serve` runs, as an `http` or `https` address in backticks. Take the
address from the explorer's report or from a file that it lists. The Commands table keeps
its four columns: the address is only in the Summary.

## An example

```markdown
## Summary

The saved reply for delayed orders lists the new support hours, and a job sends a corrected
reply to each customer who got the old hours.

App address: `http://localhost:3000/`

## Deliverables

| Id | Change | Criteria | Files | Check |
|---|---|---|---|---|
| d-1 | Change the hours in the saved reply. | AC-1, "The saved reply for delayed orders lists the support hours as 8:00 to 20:00"; AC-2, "The reply states that the hours apply every day, on weekends and public holidays too" | `replies/delayed-order.md` | scenario-1 |
| d-2 | State the closed day in the saved reply. | AC-3, "The reply states that support is closed on 25 December" | `replies/delayed-order.md` | scenario-2 |
| d-3 | Send a corrected reply to each customer who got the old hours. | AC-4, "Each customer who got the reply with the old hours receives a corrected reply that lists the new hours" | `jobs/corrected-reply.ts`, `tests/` | `tests/corrected-reply.test.ts` |

## Commands

| Kind | Command | Result file | Source |
|---|---|---|---|
| targeted | `npm test --` | `reports/junit.xml` | repository: `package.json` |
| lint | none | none | The repository has no linter. |
| types | `npx tsc --noEmit` | none | found: `package.json:12` |
| build | none | none | `package.json` has no build script. |
| full | `npm test` | `reports/junit.xml` | found: `package.json:7` |
| serve | `npm run dev` | none | found: `package.json:6` |
```

## Notes and review comments

Apply each note and each line that starts with "Fix first:" that concerns the plan. A note
that concerns only another output is no word on the plan.
