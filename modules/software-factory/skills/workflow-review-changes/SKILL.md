---
name: workflow-review-changes
description: Review the change of a Build run as a review session: read the build ledger, end with changes requested while a planned deliverable is not built, verify the acceptance lock, start code-reviewer, test-reviewer, acceptance-reviewer and the members of the group role reviewers whose paths match or that have an open finding, each of which writes one report into the report folder, and print the findings of the round from the reports, the earlier findings and the result of the full suite. qory sends the verdict of the round; the session records changes-requested only when the change cannot be reviewed. Use in a headless run of the workflow review-changes.
---

# Review changes

This workflow requires subagents. The session is a review session: it reviews the change
that `implement-changes` committed, in a checkout that it cannot write, and prints the
findings of the round. qory runs the full suite and the locked checks before the session,
and sends the verdict of the round after it.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<workflow>` is
  `review-changes`. The session pushes no artifact, and in the lines of its section
  "Failures", `<output>` stands for "review of the change".
- ${qory:skills/running-a-software-workflow}: before step 1, in every run, after
  `running-a-workflow`.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the three cannot be loaded, start nothing and end with "The run could
not load the rules it needs, so the review of the change did not start."

Each command of this skill that starts with `<skill folder>/checks.cjs` is the checks script
of `running-a-workflow`. `<inputs>` is the path of the input file from the prompt, which
ends in `/in/inputs.json`. `<folder>` is the artifact folder that the pull prints. `<start>`
is the folder in `qory.start_artifacts` of the input file. When `qory.start_artifacts` is
`""`, the run pulled no artifacts at the start, and `<start>` is `<folder>`. `<reports>` is
the report folder, `qory.review_session.reports`, and `<suite>` is the result of the full
suite, `qory.review_session.suite_result`. `<previous>` is
`--previous <qory.review_session.previous_findings>`, the file of the earlier findings of
the stage, when the input file has that member, and nothing when it has none.

## What the session writes

Write nothing in the checkout: the review changes no file of the change. The files are:

- `<reports>/<agent>.json`, the report of each reviewer, which only that reviewer writes;
- `<folder>/.notes/changed-files.txt`, the paths of the change, which you write;
- the files under `<folder>/.reports/` that the checks script writes.

Write `points.json` in `<folder>` only for an end through "Points" of `running-a-workflow`,
and write no outbox file, no build report and no submission text. Start no agent that is
not a reviewer. The tool guard lets a reviewer write only `<reports>/<agent>.json`.

## The order of the run

1. Pull, then run `<qory> work-item show`. Then run `<skill folder>/checks.cjs resume` once,
   as "The build ledger" of `running-a-software-workflow` lists.
2. When the input file has no `qory.review_session`, or `<reports>`, `<suite>`,
   `qory.review_session.diff` or `qory.start_artifacts` is missing, start nothing and end
   as "Failures" lists, with "The review of the change did not start, because the input
   file has no review session."
3. Do "The ledger check".
4. When `work-item show` printed a `run.id`, run `<skill folder>/checks.cjs lock --verify`
   from the working folder, as "Locked files" of `running-a-workflow` lists. With no
   `run.id`, skip this step: outside a run, `lock --verify` reads the local artifact folder.
   - With 0, go on.
   - With 1, a locked file is missing or changed since the lock. End as "Changes
     requested" lists, with the line "<k> locked files differ from the acceptance lock, so
     the change was not reviewed: <paths>." `<paths>` is the path in each line of
     `lock --verify` that starts with "Restore" or "Make", joined by ", ". With one file,
     write "1 locked file differs". When no line contains a path, use "The stored
     acceptance lock differs from its record, so the change was not reviewed."
   - With 2, 3 or 4, end as "Failures" lists for the checks script.
5. Do "The reviewers", then "The round".

## The ledger check

No command prints the planned deliverables that are not built, so read the build plan and
the ledger with the file tool of your runtime only. Read them with no `grep`: the guards of
some runtimes deny it.

1. The plan: the build plan that the run started with. Read `<start>/index.json`. Of its
   entries of `artifacts` whose `type` is `build-plan`, leave out each withdrawn one: an
   entry whose version with the largest `number` in `versions`, of those with no
   `cancelled` set to `true`, has `withdrawn` set to `true`. Take the entry left whose
   `name` is `main` or missing, else the one entry left. `<N>` is its `newest_version`, and
   `<name>` is its `name`, or `main` when it has none. When more than one entry is left and
   none has the name `main`, or when `<name>` is no folder name, read no further and end as
   "Failures" lists for a build plan that cannot be read. A folder name has only letters,
   digits, `.`, `_` and `-`, and is not `.` or `..`. Otherwise read
   `<start>/build-plan/<name>/v<N>/build-plan.md`. A build plan that an agent pushed during
   this run does not count. Take the Id and the Change cell of each row of
   `## Deliverables`.
2. The ledger: read `<folder>/.reports/build-ledger.json`. `resume` writes it from the
   version of `build-ledger` that counts, and removes it when no version exists. When the
   file does not exist, no step has a row yet.
3. A deliverable `d-<N>` is built when the ledger has a row in `steps` with the `id`
   `deliverable:d-<N>`, and the row of that id with the highest `pass` has the `state`
   `done`. Each other deliverable of the plan is not built, also one with no row.

Then decide, in this order, and go no further when a case ends the run:

- When item 1 leaves no entry, or the entry's `newest_version` is null, the work item has
  no build plan. Start nothing and end as "Points" lists, with one `run_again` point. Its
  text is "The work item has no build plan, so the change was not reviewed." and its `fix`
  is "Plan the build, so that a run pushes the build plan."
- When the ledger of item 2 exists and cannot be read, end as "Failures" lists, with "The
  review of the change did not start, because the build ledger could not be read."
- When one or more deliverables are not built, run no `lock --verify`, and end as "Changes
  requested" lists, with the line "<k> of <n> planned changes are not built: <list>."
  `<n>` counts the rows of `## Deliverables`, and `<k>` those that are not built. `<list>`
  is each of them in the order of the plan, as its id and its Change cell in quotes, joined
  by ", ", such as `d-2, "Send the refund"`. With one, write "1 of <n> planned changes is
  not built". While the line has more than 500 characters, cut each Change cell to its
  first 8 words and "...", then leave out the last item and end with "and <m> more", where
  `<m>` counts the items left out.

## The reviewers

The reviewers are the members of the group role `reviewers`. ${qory:agents/code-reviewer},
${qory:agents/test-reviewer} and ${qory:agents/acceptance-reviewer} start for every change;
each other member starts only when a path of the change matches its paths.

1. Read the diff of the change, the file at `qory.review_session.diff`, with the file tool
   of your runtime. Take the path of each file of the change from the header lines of the
   diff, not from its `diff --git` lines, where a path may contain ` b/`:
   - From each line that starts with `+++ `, take the rest of the line; when that rest is
     `/dev/null`, the change deletes the file: take the rest of the `--- ` line before it.
   - Remove one tab at the end, which git adds when the path has a space.
   - When the rest starts with `"`, git wrote it in quotes: remove the two quotes, and read
     `\"` as `"`, `\\` as `\`, `\t` as a tab, `\n` as a line break, and each `\` with
     three octal digits as that byte, so that `\303\251` is `é`.
   - Remove the `a/` or `b/` in front.
   - A renamed or copied file has the lines `rename from <old>` and `rename to <new>`, or
     `copy from` and `copy to`, with no `a/` or `b/`, and has a `+++ ` line only when its
     text changed too. Take both paths, unquote each path as the bullet on quotes lists, and
     take each path only once.
   - Any other file with no `+++ ` line, such as a binary file, has its path only in its
     line `diff --git a/<path> b/<path>`, where both halves are the same: take that path.

   Write those paths, one per line, to `<folder>/.notes/changed-files.txt`, which is
   `<paths>`. When the diff cannot be read, end as "Failures" lists, with "The review of
   the change did not start, because its diff could not be read."
2. Run `<skill folder>/checks.cjs panel --names "${qory:agents/reviewers}" --files <paths>`,
   with `<previous>` at the end. A member with an open finding in the file of `<previous>`
   starts, also when no path of the change matches its paths. Start each member of a
   `Start:` line in turn, each in the foreground. When panel prints a line "Run panel again
   with --after <n>", run it again with that `--after` after those members returned, and
   start the members of its `Start:` lines. A member of a `Skip:` line does not start. With
   exit 1 or more, end as "Failures" lists for the checks script.

Before each start, run `notes <agent> --files <paths>` and count the start, as "Starting
agents" and "Count the starts" of `running-a-workflow` list, with `review-changes-1-<agent>`
as `<name>`. When `starts` exits with 1, start no reviewer for that name: its missing report
counts in "The round".

Pass each reviewer the path of the input file, `<inputs>`, and nothing else. Each reviewer
reads every value of the review from `qory.review_session` of the input file, which qory
writes: the commit, the diff, the earlier findings, `<reports>` and `<suite>`. It writes
`<reports>/<agent>.json`, such as `<reports>/code-reviewer.json`. Read no report of a
reviewer, start no reviewer again, and fix no report: "The round" decides.

## The round

Run `<skill folder>/checks.cjs findings round <reports> --reviewers <names> --suite <suite>`
once, with `<previous>` at the end. `<names>` is the agent name of each member of a `Start:`
line of panel, also one whose start `starts` refused, joined by commas, in the order of the
`Start:` lines, such as `code-reviewer,test-reviewer,acceptance-reviewer,security-reviewer`.
It reads each report and `<suite>` once. A reviewer that wrote no valid report is one
blocking finding, and so is a suite that failed or did not run. It prints a line per
finding, with its proof on the next line. Each earlier finding of a member that its report
neither repeats nor closes stays open.

- With 0 or 1, run no verdict, and end with the last line of `findings round`. After the
  session, qory posts the reports to the findings of the work item, and sends the verdict:
  `changes-requested` while a blocking finding of the stage is open, else `passed`.
- With 2 or 3, end as "Failures" lists for the checks script.

## Changes requested

Write no `points.json` in `<folder>`: `changes-requested` takes no point, and a
`points.json` is only for an end through "Points". Run `<qory> run verdict
changes-requested` with no point, and end with the line that the case lists. The next
session of `implement-changes` then builds what is missing. When the command fails, end with
the same line, and the run ends with no verdict.

## Failures

A checks script exit of 2, 3 or 4, a skill that does not load, an input file with no review
session, a diff that cannot be read and a build plan that cannot be read end the run as
"Failures" of `running-a-workflow` lists. For a build plan that cannot be read, use "The
review of the change did not start, because the build plan could not be read." The session
runs no ledger step, so it runs no `step begin` and no `step end`.
