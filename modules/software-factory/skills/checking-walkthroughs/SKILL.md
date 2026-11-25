---
name: checking-walkthroughs
description: Load before you write a walkthrough, and before you review one. Contains what the check script enforces, the steps of a review against the diff, and the check list.
---

# Checking walkthroughs

A writer works through the check list before it reports. A reviewer does the section "Review
of a walkthrough", then the check list. The rules of the layout are in
${qory:skills/writing-walkthroughs}.

## What the script enforces

The script `checks.cjs check walkthrough` and the push check run the same code
(`types/walkthrough.cjs`). They enforce these rules, with these limits:

- The first line is `# Walkthrough: <title>`, and the next line starts with `Commit ` and 7
  or more hexadecimal digits, which are the start of the verified commit. The counts after it
  (`· <n> files · <n> lines`) are not checked. Nothing else is before the first `##`.
- The five sections are there in order: `## What and why`, `## Changes, in <order rule>`,
  `## Criteria`, `## Risk on merge`, `## Not checked`.
- `## What and why` has at most 120 words, and exactly one bullet each for `Problem`,
  `Approach`, `Not chosen` and `Shortcoming`, and no other line. The `Problem`, `Approach`
  and `Shortcoming` bullets end with a `path:line` or `matrix row AC-N`.
- `## Changes` has at most 7 numbered groups, in order, then `### Other changes` last. A
  purpose has at most 2 sentences, a file has one line that starts with its path in
  backticks, and a Mermaid diagram is one that Qory Apiary draws. The walkthrough has at
  most 2 diagrams, each in a numbered group, and no other code block.
- `## Criteria` has one table with the columns `Criterion`, `Changes` and `Evidence`, one row
  for each live criterion, each quoted as the criteria quote it, `Changes` with the numbers
  of existing groups, and `Evidence` as `matrix row AC-N`. It has no other text.
- `## Risk on merge` has the two bullets `- Undo:` and `- Affects:`.
- `## Not checked` reads `Nothing.`, or is bullets.
- Each changed file of `.reports/changed-files.json` is in exactly one group, no listed file
  is outside it, each moved (`R100`) or generated file is under `### Other changes`, and a
  change under 30 changed lines has exactly one group besides `### Other changes`.
- The list is of the verified commit: its `head` is the verified commit.

In a push, the check reads `.reports/changed-files.json` only when the store has it, and
skips the rules of the file list otherwise.

## Review of a walkthrough

The script checks the layout, not the facts. You check:

1. Each file line against the diff: the path is a file of the change, the word in
   parentheses is true (new, changed, deleted or moved), what the line says changed is in the
   diff, and its `path:line` shows it at the verified commit.
2. Each claim of `## What and why` against the diff and the files: the problem, the
   approach, the way that was not chosen and the shortcoming are true, and none is a claim
   about a change that the diff does not make. Check that no significant change of the diff
   is left out of the groups' lines.
3. Each group: its files serve one purpose, which its name and purpose state, and the order
   rule of the heading holds for the numbers.
4. Each row of the table: the `Changes` cell names the groups whose files serve the
   criterion, and the walkthrough states no state of a criterion anywhere.
5. `## Risk on merge`: the undo is possible as it says, and `Affects` names what the diff
   changes for members.
6. `## Not checked`: it lists each fact that the walkthrough states without a check.

Mark each finding `writer`, as `reviewing-drafts` lists. A walkthrough that fails blocks
nothing, so no finding is `blocking` and none enters the findings round.

Report a claim that you disproved as a finding with the claim and the fact that disproves
it, as a `path:line`. The writer removes the false words from the claim. The file line of a
changed file stays, because the check script needs each changed file in one group. The
writer writes no note under a false claim.

## After the findings of round 2

The writer fixes the findings of round 1 in round 2. For a finding of round 2 that is still
open, the removal is the last write:

- A claim that the reviewer disproved: the writer removes the false words, and keeps no false
  claim with a note.
- A claim that cannot be checked: the writer lists it under `## Not checked`.
- The session runs the check script again on the file that it stores. If the check script is
  still red, the session pushes no walkthrough: the run ends as it would have ended without
  the walkthrough.

## Check list

- The header's commit starts the verified commit.
- Each changed file is in one group, and each file line is true.
- Each source is a `path:line` that shows the claim at the verified commit, or a matrix row.
- The order rule is stated, and the groups follow it.
- The reason for the change comes first, in at most 120 words.
- A diagram stands only in a group whose call flow or state changes, shows that change and
  nothing else, and follows ${qory:skills/visuals}.
- No criterion state is written, no text claims a result that no record shows, and no secret
  is in the walkthrough.
- Each sentence follows ${qory:skills/simple-communication}.
