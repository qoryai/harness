---
name: writing-submissions
description: Load before you write the title and the description of the draft pull request of a Build run. Contains the file, the title, the four parts, their limits, what Disclosed contains and the check list.
---

# Writing submissions

Load ${qory:skills/artifact-text} before you write. The submission is the title and the
description that a reviewer reads first, so state only what a record of the run shows.

## The file

Write `.reports/submission.md` in the artifact folder, once. The verb `report-build` of
the checks script reads it and renders the result tables, so you type no result: no count,
no pass or fail and no time. The first line is `# <title>`. After it come exactly four
parts, as `##` headings, in this order: `## Problem`, `## Change`, `## Tests` and
`## Disclosed`. No other heading, no table of results.

## The limits

- The title is one line of at most 256 characters, with no tab and no control character.
  It is not only spaces, and it has no invisible character, such as U+200B, U+202E or
  U+FEFF.
- The description, from `## Problem` to the end, has at most 20000 characters and no NUL.
  No line of it starts with `<!-- qory:start -->` or `<!-- qory:end -->`.
- No secret, key or token in either. Write where it is.

## The sources

State a fact only when one of these records shows it:

- `build-plan.md`: `## Summary`, and the Change and Files cells of `## Deliverables`.
- `.reports/build-ledger.json` of the artifact folder: which deliverable rows are `done`,
  and the `Left out:` list in the `report` of each row.
- The records of the checks under `.reports/runs/` of the artifact folder: which checks
  ran.

## The title

Write the change in the imperative mood, as the subject of a commit message: "Export only
the filtered rows". Use the words of `## Summary` of the build plan.

## The parts

- `## Problem`: what a user meets today, in one to three sentences, from `## Summary` of
  the build plan.
- `## Change`: one item for each deliverable with a `done` row in the ledger, in the order
  of the plan: its Change cell in plain words, and its Files.
- `## Tests`: the checks that the records show ran, by name or command, and the files of
  the checks that the plan lists. Write no result: the build report has the results.
- `## Disclosed`: what the reader needs to know before they merge, as a list:
  - what the change left out: each item in the `report` of a row of
    `.reports/build-ledger.json`, and each planned change that has no `done` row. In a
    `report`, the line `Left out:` starts a list of lines `- <item>: <risk>`, which ends at
    the first line that is not such an item. `Left out: none` is an empty list;
  - each known limit that a record states;
  - what did not run: each command of `## Commands` of the build plan that the records of
    the checks lack, and each check that a record shows as not run.

  When a record shows none of these, write `Nothing.` under the part.

## Check list

- The first line is `# <title>`, one line that meets "The limits".
- The four parts are there, in the order of the list above, and no other heading.
- Each fact is in the build plan, the ledger or a record of a check.
- No result is typed: no count, no pass or fail, no time.
- Each deliverable of the ledger with a `done` row is in `## Change`.
- `## Disclosed` has each item of the three kinds, or `Nothing.`
- No secret, and no word that praises the change.
