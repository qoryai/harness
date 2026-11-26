---
name: checking-build-plans
description: Load before you write a build plan, and before you review one. Contains what a version contains, the steps of a review, the Files rule for check files, and the check list for writer and reviewer alike.
---

# Checking build plans

A writer works through the check list before it reports. A reviewer does the section
"Review of a build plan", then the check list, and reads the plan against the acceptance
criteria and the code explorer's report.

## What a version contains

A `build-plan` version is one file, `build-plan.md`. Members read all of it. Its sections,
columns and cells are in `planning-builds`, and the checks script checks them.

This document is not a Markdown document of `artifact-text`: skip the section "A Markdown
document" of `reviewing-drafts`, with its parts, pictures and word limit. The rest of
`artifact-text` applies.

## Review of a build plan

1. Before you read the plan, list what the person's words ask: the ticket, the notes, a
   person's word that a fact or finding quotes, and the newest approved acceptance
   criteria. A quote that differs from its source is a finding. Where the spec and a newer
   criterion differ, the criterion applies, and a plan that follows the criterion needs no
   finding: a change from a person's feedback changes the criteria and leaves the spec.
2. Each criterion that is not removed is in a row whose Check fits the criterion's
   `check`: a test file path for `Tests`, a scenario id for `Demo`. A row that lists
   criteria of two checks is a finding, because its Check has one value.
3. Each deliverable is one change that one agent makes and one reviewer reads at once. A
   deliverable that joins unrelated changes, or one that splits one behaviour so that no
   part works alone, is a finding. A deliverable that needs a later one is a finding.
4. Compare the Files with the code explorer's report. A change that the report shows in a
   file that no Files cell lists is a finding. So is a path that the change does not need.
   A path that does not exist and that the Change does not mark as a "new file" is a finding.
5. The Files rule: each Check path of a test file is also in the Files of the same row,
   and so is the folder of the helpers and fixtures that tests there use, when the report
   shows some. A missing path is a finding marked `writer`, `no direction` and `no break`.
   The scope check before the push refuses a locked check or a support file of a check that
   no Files cell lists.
6. Each command is one that the explorer's report or a file shows. Read the file and line
   of each `found:` Source: a command that the line does not state, or one that no source
   shows, is a finding. `targeted` has its test files last, with no `#`, `;` or `&&`, and a
   Result file in JUnit XML. A kind with `none` has its reason in Source. A `full` row with
   `none` or no command is a finding. A row with the Source `plan: d-<N>` is a finding unless
   deliverable `d-<N>` creates that command, as the section "No full test suite" of
   `planning-builds` lists.
7. A `serve` row with a command needs the line `App address: <url>` in the Summary, with an
   `http` or `https` address, and the address agrees with what the report shows. A line
   with no such row is a finding too.
8. When the plan has more than 7 deliverables, and the newest answer "Build all <n>
   changes in this work item." of a member has no `<n>` of the plan's number or more, or
   there is none, it is no plan to review: the run asks a member and sends it to no
   reviewer.
9. A note or a line that starts with "Fix first:" that concerns the plan is applied. A
   change that nobody asked for is a finding.

## Check list

When you review, the run gives you the lines of its checks script under "Checks:", as
`reviewing-drafts` lists. In `build-plan.md`, the script checks the three sections in
order; at most 7 deliverables, each with an id `d-<N>` once and a Files cell of paths; each
Criteria cell as `AC-<N>, "<the first sentence>"` with `; ` between criteria and the text
of the criterion; each criterion in a row; a `Tests` criterion with a test file path in
Check and a `Demo` criterion with a scenario id; the kinds and sources of the Commands
table; and the characters of the text. Judge the rest of the check list.

- The Summary says what changes, in 1 to 3 sentences, and agrees with the deliverables.
- Each Change is one sentence in plain words, with no id and no path. It may say "new file"
  for a file that the change creates.
- Each Criteria cell quotes the criterion's first sentence, and no cell has an id alone.
- Each Check path of a test file is in the Files of its row, and the folder of the helpers
  of its tests is too, as the Files rule lists.
- Each command and each Source comes from the explorer's report or from a file that you
  read.
- The `serve` row and the `App address:` line go together.
- The plan has no code and no secret. Each change and each file is one that a criterion or
  the explorer's report calls for.
- Each finding has its three marks, and is plain text with no backticks and no asterisks.
