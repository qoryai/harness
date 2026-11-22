---
name: workflow-verify-a-ticket
description: Verify the change of a Build run as a review session: verify the acceptance lock, run the locked checks, write the verification matrix from their records with the matrix verb, start tamper-reviewer and verification-reviewer, each of which writes one report into the report folder, decide the round from the reports, push the verification, ask one question for each criterion that is not met, and record passed or changes-requested. Use in a headless run of the workflow verify-a-ticket.
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
is the folder in `qory.start_artifacts` of the input file. `<reports>` is the report folder,
`qory.review_session.reports`. `<suite>` is the result of the full suite,
`qory.review_session.suite_result`, a member that qory may leave out. `<N>` is the number
of the acceptance-lock version that a member approved, as step 3 finds it.

## What the session writes

Write nothing in the checkout: Verify changes no file of the change. The files are:

- `<reports>/<agent>.json`, the report of each reviewer, which only that reviewer writes;
- `<folder>/verification.json` and `<folder>/.reports/matrix-record.json`, which `matrix`
  writes, so that no agent types a state;
- `<folder>/questions.json`, which you write in step 12;
- the other files under `<folder>/.reports/` that the checks script writes.

Push only `verification` and `questions`. Write `points.json` in `<folder>` only for an end
through "Points" of `running-a-workflow`, and write no outbox file, no build report and no
submission text. Start no agent that is not one of the two reviewers.

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
   version of `versions`: `<N>` is the `number` of that version. When the entry is missing,
   or `approved_version` is null, or no version has that `id`, start nothing and end as
   "Points" lists, with one `run_again` point. Its text is "No member approved an
   acceptance lock, so the change was not verified." and its `fix` is "Approve the
   acceptance lock, then run Verify again."
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
   - With 2, 3 or 4, end as "Failures" lists for the checks script.
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
   `<folder>/demo-evidence/<name>/v<N>/<name>.json` of each entry left, where `<N>` is its
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
    for each verdict, so that the members read what the verdict rests on. When the push is
    still refused after the third attempt, end with "The run could not push its
    verification." and record no verdict.
11. Take the time of the version, as "The time of a version" of `run-artifacts` lists.
12. Do "The questions", then "The end".

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
writes, and the draft `verification.json` at the top of the artifact folder. It writes
`<reports>/<agent>.json`, such as `<reports>/verification-reviewer.json`. Read no report of
a reviewer, start no reviewer again, and fix no report: "The round" decides.

## The round

Run `<skill folder>/checks.cjs findings round <reports> --reviewers
tamper-reviewer,verification-reviewer` once, and add `--suite <suite>` only when the member
`qory.review_session.suite_result` exists. With no `--suite`, the round has no suite
finding. It reads each report once. A reviewer that wrote no valid report is one blocking
finding. It prints a line per finding, with its proof on the next line.

- With 1, a finding is blocking. Go on to step 10; the verdict is `changes-requested`.
- With 0, no finding is blocking. Go on to step 10.
- With 2 or 3, end as "Failures" lists for the checks script.

## The questions

Ask one question for each row of `<folder>/verification.json` whose `state` is `not_met`.
Read the file with the file tool of your runtime. A criterion in `not_verified` gets no
question, and the verdict is `changes-requested` for it.

Leave out a criterion that has an open question in the newest `questions` with `about.item`
set to its id in lower case, such as `ac-3`. With no row left, write no file and skip the
push of the questions.

Quote a criterion in each text of a question as its id in capitals, a comma, a space and
its first sentence in double quotes, with the words of the criterion and no other:
`AC-3, "<first sentence>"`. An id with no words is wrong, and the check refuses it.

Write the whole document in `<folder>/questions.json` at the top of the artifact folder.
Start from the newest `questions` version, `<folder>/questions/main/v<V>/questions.json`, or
from `{"questions": []}` when the type has no version. Keep every question that exists, in
its order, with all its members as they are, and add each new question at the end, with the
time of step 11 as `at` and these members:

- `id`: `q` and a number above every id in the document.
- `question`: one sentence of at most 500 characters that asks what to do with the
  criterion, quoted as above.
- `state`: `open`.
- `asked`: `{"run": <run.number>, "at": <the time>}`. When `work-item show` gave no
  `run.number`, write no question.
- `about`: `{"type": "acceptance-criteria", "name": "main", "item": "ac-3"}`, with the id of
  the criterion in lower case.
- `context`: two paragraphs. The first starts `**Why:**`, with the fact that the answer
  depends on in its first sentence: why the criterion is not met. The second starts
  `**Checked:**`, with what the row's `evidence` shows, and the check or the scenario. Write
  no plain id: each criterion in the context is quoted the same way.
- `options`: exactly three, each with a `title` and an `explanation` of at most 2
  sentences. Mark the one that the evidence favours with `recommended: true`, and list it
  first.
  1. `Change AC-3, "<first sentence>"`, with `proposal`: the wording of the criterion that
     the change can meet.
  2. `Make it met another way`: the person's change to the work, which sends the work item
     back to Build.
  3. `Withdraw AC-3, "<first sentence>"`: the criterion leaves the acceptance criteria.

  Apiary adds a fourth answer that the person writes, so write no option for it.

Run `<skill folder>/checks.cjs check questions <folder>/questions.json`. With 1, fix the
lines that the script prints, in the file, at most twice, then check again. When it still
exits with 1 or exits 2 or 3, push nothing and end as "Failures" lists for a later step.
Then push: `<qory> artifact push questions <folder>/questions.json`. When the push of the
questions fails after the third attempt, end with "The run stopped after it pushed the
verification, so its questions are missing." and record no verdict.

An open question stops no verdict.

## The end

Record the verdict once, as the last command, with `<qory> run verdict` and no point:

- `passed`, when all of these hold: the verify of step 4 exited with 0; `matrix` printed
  "0 not met, 0 not verified"; step 7 found no failed scenario; and `findings round` exited
  with 0. Every criterion is then met, or a person withdrew it and it has no row.
- `changes-requested`, when any of them fails: a criterion is not met or not verified, a
  scenario failed, or a finding is blocking. Never record `passed` while a scenario of the
  commit under review has the verdict `failed`.

With `changes-requested`, qory writes the findings for the next session of
`implement-changes` from the reports. When the command fails, the run ends with no verdict.

End with one line. After `passed`: "The change passed Verify: <m> criteria are met and no
finding is blocking." After `changes-requested`, the line of `matrix` and the last line of
`findings round`, such as "Wrote verification.json for 4e1c9b0a21ff: 3 met, 1 not met, 0 not
verified. Checked 2 reports: 1 blocking and 0 non-blocking findings."

## Failures

A checks script exit of 2, 3 or 4, a skill that does not load, an input file with no review
session, and a push that fails end the run as "Failures" of `running-a-workflow` lists, with
the lines that this skill gives. No agent can fix a file that a script wrote, so no step of
this skill starts an agent to fix one.
