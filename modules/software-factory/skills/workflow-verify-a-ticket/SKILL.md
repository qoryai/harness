---
name: workflow-verify-a-ticket
description: Verify the change of a Build run as a review session: verify the acceptance lock, run the locked checks, write the verification matrix from their records with the matrix verb, start tamper-reviewer and verification-reviewer, each of which writes one report into the report folder, decide the round from the reports, push the verification, write, check, review and push the walkthrough, and record passed or changes-requested. Use in a headless run of the workflow verify-a-ticket.
---

# Verify a ticket

This workflow requires subagents. The session is a review session: it checks the change that
Build committed against the acceptance criteria, in a checkout that it cannot push from, and
records the verdict of Verify. It changes no code.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<workflow>` is
  `verify-a-ticket`, and in the lines of its section "Failures", `<output>` stands for
  "verification".
- ${qory:skills/running-a-software-workflow}: before step 1, in every run, after
  `running-a-workflow`.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the first three skills cannot be loaded, start nothing and end with
"The run could not load the rules it needs, so the change was not verified."

Each command of this skill that starts with `<skill folder>/checks.cjs` is the checks script
of `running-a-workflow`. `<inputs>` is the path of the input file from the prompt, which
ends in `/in/inputs.json`. `<folder>` is the artifact folder that the pull prints. `<start>`
is the folder in `qory.start_artifacts` of the input file. When `qory.start_artifacts` is
`""`, the run pulled no artifacts at the start, and `<start>` is `<folder>`. `<reports>` is
the report folder, `qory.review_session.reports`. `<suite>` is the result of the full suite,
`qory.review_session.suite_result`, a member that qory may leave out. `<N>` is the number
of the acceptance-lock version that a member approved, as step 3 finds it.

## What the session writes

Write nothing in the checkout: Verify changes no file of the change. The files are:

- `<reports>/<agent>.json`, the report of each reviewer, which only that reviewer writes;
- `<folder>/verification.json` and `<folder>/.reports/matrix-record.json`, which `matrix`
  writes, so that no agent types a state;
- `<folder>/walkthrough.md`, which only walkthrough-writer writes, in step 11;
- the other files under `<folder>/.reports/` that the checks script writes.

Push only `verification` and `walkthrough`. Write `points.json` in `<folder>`
only for an end through "Points" of `running-a-workflow`, and write no outbox file, no build
report and no submission text. Start no agent that is not one of the two reviewers or one of
the two walkthrough agents.

## The order of the run

1. Pull, then run `<qory> work-item show`. Then run `<skill folder>/checks.cjs resume` once,
   as item 1 of "The build ledger" of `running-a-software-workflow` lists. Verify runs no
   ledger step, so it runs no `step begin` and no `step end`.
2. When `work-item show` printed no `run.id`, or the input file has no
   `qory.review_session`, or `<reports>`, `qory.review_session.commit`,
   `qory.review_session.diff` or `qory.start_artifacts` is missing, start nothing and end as
   "Failures" lists, with "The change was not verified, because the run has no id or the
   input file has no review session."
3. Find `<N>`. Read `<start>/index.json` with the file tool of your runtime. In its entry of
   `artifacts` whose `type` is `acceptance-lock`, `approved_version` is the `id` of a
   version of `versions`: `<N>` is the `number` of that version. Otherwise start nothing and
   end as "Points" lists, with one `run_again` point:
   - With no such entry, the text is "The work item has no acceptance lock, so the change
     was not verified." and the `fix` is "Lock the acceptance checks in Build and approve
     the lock, then run Verify again."
   - With the entry, and `approved_version` null or the `id` of no version, the text is "No
     member approved an acceptance lock, so the change was not verified." and the `fix` is
     "Approve the acceptance lock, then run Verify again."
4. Run `<skill folder>/checks.cjs lock --verify --version <N>` from the working folder, as
   "Locked files" of `running-a-workflow` lists. This is the verify that binds: it pulls the
   lock again from the run.
   - With 0, go on.
   - With 1, a locked file is missing or changed since the lock. Start no agent, push
     nothing, and run `<qory> run verdict changes-requested` with no point. End with the
     line "<k> locked files differ from the acceptance lock, so the change was not
     verified: <paths>." `<paths>` is the path in each line of `lock --verify` that starts
     with "Restore" or "Make", joined by ", ". With one file, write "1 locked file
     differs". When no line contains a path, use "The stored acceptance lock differs from
     its record, so the change was not verified."
   - With 3 and the first line "Ask a member to approve acceptance-lock version <M>.", a
     newer lock version that no member approved exists. Start nothing and end as "Points"
     lists, with one `run_again` point. Its text is "A member approved acceptance lock
     version <N>, but version <M> is newer, so the change was not verified." and its `fix`
     is "Approve acceptance lock version <M>, then run Verify again."
   - With 2, 4, or 3 with another first line, end as "Failures" lists for the checks script.
5. Run `<skill folder>/checks.cjs run locked --inputs <inputs>` from the working folder,
   once. It runs the locked checks on the checkout of the commit
   under review and writes its record under `<folder>/.reports/runs/`. With 0 or 1, go on:
   a red check is a result, and `matrix` reads it. With 2, 3 or 4, end as "Failures" lists
   for the checks script.
6. Run `<skill folder>/checks.cjs matrix --version <N>` once. It pulls the criteria, the
   demo evidence and the build ledger from the run, and writes `<folder>/verification.json`
   and its record. It prints one last line, "Wrote verification.json for <commit>: <m> met,
   <n> not met, <k> not verified." Keep the three counts. With a status other than 0, end as
   "Failures" lists for the checks script.
7. Read the demo evidence of the run, with the file tool of your runtime only. Read
   `<folder>/index.json`. For each entry of `artifacts` whose `type` is `demo-evidence`,
   leave out the entry when its version with the largest `number` in `versions`, of those
   with no `cancelled` set to `true`, has `withdrawn` set to `true`. Read
   `<folder>/demo-evidence/<name>/v<D>/<name>.json` of each entry left, where `<D>` is its
   `newest_version`. A scenario is failed when its `commit` is
   `qory.review_session.commit` and its `verdict` is not `passed`. Keep the names of the
   failed scenarios, also when no criterion rests on them.
8. Run `<skill folder>/checks.cjs check verification <folder>/verification.json`. A script
   wrote the draft, so no agent can fix it: with 1, 2 or 3, end as "Failures" lists for the
   checks script.
9. Do "The reviewers", then "The round".
10. Push the draft with `<qory> artifact push verification <folder>/verification.json`,
    after "Push only what changed" of `running-a-workflow`: run
    `<skill folder>/versions.cjs compare verification <V> <folder>/verification.json`,
    where `<V>` is the `newest_version` of `verification` in `<folder>/index.json`, and push
    when it exits with a status other than 0 or the type has no version. Push the matrix
    for each verdict that step 11 records, so that the members read what the verdict rests
    on. A run that ends before this step pushes nothing: each `run_again` end, the
    `changes-requested` end of step 4 and each end as "Failures" lists. When the push is
    still refused after the third attempt, end with "The run could not push its
    verification." and record no verdict.
11. Do "The walkthrough", then "The end".

## The reviewers

The reviewers are the members of the group role `verify-reviewers`, which have no `paths`:
${qory:agents/tamper-reviewer} and ${qory:agents/verification-reviewer} both start in every
run. Start `tamper-reviewer` first, then `verification-reviewer`, each in the foreground.

Before each start, run `<skill folder>/checks.cjs notes <agent>` with no `--files`, and
count the start, as "Starting agents" and "Count the starts" of `running-a-workflow` list,
with `verify-a-ticket-1-<agent>` as `<name>`. When `starts` exits with 1, start no reviewer
for that name: its missing report counts in "The round".

Pass each reviewer the path of the input file, `<inputs>`, and nothing else. Each reviewer
reads every value of the review from `qory.review_session` of the input file, which qory
writes. `verification-reviewer` also reads the draft `verification.json` at the top of the
artifact folder. Each reviewer writes `<reports>/<agent>.json`, such as
`<reports>/verification-reviewer.json`. Read no report of a reviewer, start no reviewer
again, and fix no report: "The round" decides.

## The round

Run `<skill folder>/checks.cjs findings round <reports> --reviewers
tamper-reviewer,verification-reviewer` once, and add `--suite <suite>` only when the member
`qory.review_session.suite_result` exists. With no `--suite`, the round has no suite
finding. It reads each report once. A reviewer that wrote no valid report is one blocking
finding. It prints a line per finding, with its proof on the next line.

- With 1, a finding is blocking. Go on to step 10; the verdict is `changes-requested`.
- With 0, no finding is blocking. Go on to step 10.
- With 2 or 3, end as "Failures" lists for the checks script.

## The walkthrough

The walkthrough guides a member through the change before the member approves it. It
blocks nothing: it changes no verdict, and the verdict stays the last command of the run.
Its two agents load the skills for its layout. No stage requires it.

A step that says "keep the reason" ends this section: go to "The end", and push no
walkthrough. "The end" adds one line that shows the reason. Round 1 is the first
write of `walkthrough.md`, round 2 the write after the findings of round 1, and the removal
is the write after the findings of round 2.

1. Run `<skill folder>/checks.cjs files` once. It writes
   `<folder>/.reports/changed-files.json` from the pull request of Build. With a status
   other than 0, keep the reason "the list of changed files was not written".
2. Start the writer: round 1 here, and the rounds that 6a and 6c name. Run
   `<skill folder>/checks.cjs notes walkthrough-writer` with no `--files`, and count the
   start with `starts`, as "The reviewers" lists, with
   `verify-a-ticket-1-walkthrough-writer` as `<name>`. When `notes` exits with a status
   other than 0, or `starts` exits with a status other than 0, keep the reason "an agent or
   the check script failed". Otherwise start ${qory:agents/walkthrough-writer} in the
   foreground. Pass it `<inputs>` and `<folder>`, and nothing else. It writes
   `<folder>/walkthrough.md`. When the start fails, or the file does not exist after it,
   keep the same reason.
3. Run `<skill folder>/checks.cjs check walkthrough <folder>/walkthrough.md`. With 0, go
   on to 4. With 1, the lines that it printed are the findings of the round: after round 1
   go to 6a, and after round 2 go to 6b, and start no reviewer. With 2, 3 or 4, keep the
   reason "an agent or the check script failed".
4. Run `notes walkthrough-reviewer` with no `--files`, and count the start, as "The
   reviewers" lists, with `verify-a-ticket-1-walkthrough-reviewer` as `<name>`. When
   `notes` exits with a status other than 0, or `starts` exits with a status other than 0,
   keep the reason "the review of the walkthrough did not finish". Otherwise start
   ${qory:agents/walkthrough-reviewer} in the foreground, with `<inputs>` and `<folder>`
   and nothing else. It reports as text.
5. When the last line of the report is `clean`, go to 7. When it is `changes-needed`, its
   findings are the findings of the round: after round 1 go to 6a, and after round 2 go to
   6b. For any other result, keep the reason "the review of the walkthrough did not
   finish": the last line `blocked`, another last line, no report, an error, or a start
   that does not end.
6. The findings of a round:
   - 6a, after round 1: start the writer again as in step 2, with the findings quoted
     unchanged. This is round 2. Do steps 3, 4 and 5 again.
   - 6b, after round 2: go to 6c. A red check in round 2 skips the reviewer, so the findings
     of 6b are the lines that the check printed, or the findings of the reviewer.
   - 6c, the removal: start the writer as in step 2, with the findings quoted and these
     words: "Remove the false words of each claim that the reviewer disproved, and keep the
     line and the group of each changed file. List under ## Not checked what you could not
     check. Write no note under a false claim." Then run step 3 once, on the file that is
     stored. With 0, go to 7. With another status, keep the reason "the check still failed
     after the removal".
7. Push the walkthrough with `<qory> artifact push walkthrough <folder>/walkthrough.md`.
   When the push is still refused after the third attempt, keep the reason "the push was
   refused 3 times". Go on to "The end" in either case: a refused push ends nothing.

A reviewer finding never enters "The round", the verdict or the findings ledger. Start no
agent of this section after "The end" begins.

## The end

Record the verdict once, as the last command, with `<qory> run verdict` and no point:

- `passed`, when all of these hold: the verify of step 4 exited with 0; `matrix` printed
  "0 not met, 0 not verified"; step 7 found no failed scenario; and `findings round` exited
  with 0. Every criterion is then met, or a person withdrew it and it has no row.
- `changes-requested`, when any of them fails: a criterion is not met or not verified, step
  7 found a failed scenario, or a finding is blocking. Never record `passed` while step 7
  has a failed scenario.

With `changes-requested`, qory writes the findings for the next session of
`implement-changes` from the reports. When the command fails, the run ends with no verdict.

End with one line, and a second line when "The walkthrough" kept a reason: "The walkthrough
was not stored: <reason>." The first line, after `passed`: "The change passed Verify: <m>
criteria are met and no finding is blocking.", or, with one criterion, "The change passed
Verify: 1 criterion is met and no finding is blocking." After `changes-requested`, the line
of `matrix` and the last line of `findings round`, and, when step 7 kept names, "Failed
scenarios: <names>." with the names joined by ", ". Such a line reads "Wrote
verification.json for 4e1c9b0a21ff: 3 met, 1 not met, 0 not verified. Checked 2 reports: 1
blocking and 0 non-blocking findings. Failed scenarios: scenario-2."

## Failures

A checks script exit of 2, 3 or 4, a skill that does not load, an input file with no review
session, and a push that fails end the run as "Failures" of `running-a-workflow` lists, with
the lines that this skill lists. No agent can fix a file that a script wrote, so no step of
this skill starts an agent to fix one.
