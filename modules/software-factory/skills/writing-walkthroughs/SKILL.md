---
name: writing-walkthroughs
description: Load before you write the walkthrough of a verified change. Contains the file, its header, the five sections in their order, their limits, the short form, the sources and the steps.
---

# Writing walkthroughs

Load ${qory:skills/artifact-text} before you write. A walkthrough guides a member through a
change before the member approves it. Reviewers find the reason for a change hardest to
understand, so the walkthrough gives the reason first, then the changed files in groups that
follow a stated order, then the criteria. It shows no state of a criterion: the verification
matrix shows it.

The walkthrough is made on the verified commit, with the risk on merge. A walkthrough that
fails blocks nothing: it changes no verdict and no stage.

No stage requires this file today.

## The file

Write `walkthrough.md` at the top of the artifact folder, once per round. The check script
reads it with the list of the changed files, `.reports/changed-files.json`, which the verb
`files` of the checks script writes. Run no command yourself: the session runs `files` and
the check, and sends you the findings.

The first line is `# Walkthrough: <title>`, in the words of the change. The second line is
the header: `Commit <short commit> · <n> files · <n> lines`. The short commit is the first 7
or more hexadecimal digits of the verified commit, `commit` in `qory.review_session`. Take
`<n> files` and `<n> lines` from `files.length` and `changed_lines` in
`.reports/changed-files.json`. The counts are for the reader: the check does not compare
them, and compares only the commit. Write nothing else before the first `##` heading.

## The sections

Write these five `##` sections, in this order, and no other:

1. `## What and why`: at most 120 words, as exactly 4 bullets, one for each label, each on
   one line, and no other line. `- Problem:` what a member meets today. `- Approach:` what
   the change does, and why this way. `- Not chosen:` a way that the change does not take,
   and why, or `none.` when no other way was considered. `- Shortcoming:` what the change
   leaves worse or open. The `Problem`, `Approach` and `Shortcoming` bullets end with their
   source: a `path:line` such as `lib/invoices/export.ex:12`, or `matrix row AC-1`. The `Not
   chosen` bullet has no source.
2. `## Changes, in <order rule>`: write the order of the groups in the heading, such as
   `## Changes, in build order: data, then endpoint, then screen` or `## Changes, in call
   order`. Write at most 7 groups, each as `### <N>. <name>`, numbered from 1 in that
   order. A group has a purpose of at most 2 sentences, which you may leave out when the
   group name makes the purpose clear, and one line for each file:
   `` - `path` (new, changed, deleted or moved): what changed in it. `path:line` ``. Put each
   moved file, which git reports as a rename with no change, and each generated file, which
   `.gitattributes` marks `linguist-generated`, under `### Other changes`, the last heading.
   Other files may go there too, such as a text file with one new line. List each changed file in exactly one
   group, and list no file that did not change.
3. `## Criteria`: one table with the columns `Criterion`, `Changes` and `Evidence`, and one
   row for each criterion that is not removed. `Criterion` is the id and the first
   sentence of the criterion in quotes, as `AC-1, "Members download a CSV of their
   invoices"`. `Changes` is the numbers of the groups that serve it, such as `1, 2`.
   `Evidence` is `matrix row AC-1`, with the criterion's id. Write no state and no other text
   in the table or the section.
4. `## Risk on merge`: two bullets, `- Undo:` how the merge is undone and by whom, and
   `- Affects:` what changes for whom.
5. `## Not checked`: `Nothing.` when you checked everything you state. Otherwise one bullet
   for each fact that you did not check, with the reason.

A Mermaid diagram is allowed in a numbered group whose call flow or state changes, at most 2
in the walkthrough. Follow ${qory:skills/visuals}. No other code block, and no table but the
one in `## Criteria`.

## Under about 30 changed lines

When the change has fewer than 30 changed lines, the sum of the added and deleted lines in
`.reports/changed-files.json`, write `## What and why`, exactly one numbered group besides
`### Other changes`, `## Criteria`, `## Risk on merge` and `## Not checked`.

## The steps

1. Read `.reports/changed-files.json`, the diff and the criteria. List each changed file once.
2. Choose the order rule, and form at most 7 groups of files that serve one purpose.
3. Write `## What and why`, then the groups, each file with its line, then the table.
4. Check every `path:line` against the file at the commit, and every criterion row against
   the criteria. Remove a claim that you cannot check, and list it under `## Not checked`.
5. Run through the check list of ${qory:skills/checking-walkthroughs}.

## When the check or the reviewer finds something

The session sends back each finding. Round 1 is your first write of the file, round 2 is
the write after the findings of round 1, and the removal is the write after the findings of
round 2. Fix each finding in the file, once per write. A finding of the reviewer never
enters the review round, the end check or the findings ledger.

- A finding of the check script must be fixed: the push check is the same check, and it
  refuses a file with such a finding.
- A claim that the reviewer disproved, and that is still open at the removal: remove the
  false words from the claim. A changed file keeps its line and its group, because the check
  script needs each changed file in exactly one group, so only the false words go. Write no
  note under a false claim, and keep no false claim with a note.
- A claim that cannot be checked: remove it from its line, and list it under
  `## Not checked`, one bullet for each, with the reason.
- After the last edit, the session runs the check script again on the file that it stores.
  If the check script is still red after the removal, the session pushes no walkthrough, and
  the run ends as it would have ended without the walkthrough.

## Limits of this version

- shortcut: after more than one Build run, `pull-request.base`, which `files` reads, is the
  start of the last run, so the list covers the last run only; replace it when the ledger
  base reaches Verify.
- shortcut: the push check reads `.reports/changed-files.json`, a list that the session
  wrote, so it cannot tell a list that a session altered; replace it when qory mounts a
  record that no session writes.
