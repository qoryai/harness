---
name: workflow-explore-a-ticket
description: Orchestrate the exploration of one ticket in a headless run. Start the agents that read the target, draft the proposal, the questions and the replies to review comments, and review the drafts, decide on each finding, and push the results with qory artifact push. Use in a headless run of the workflow explore-a-ticket.
---

# Explore a ticket

This workflow requires subagents. You run only `<qory>` commands, start agents, decide on
each finding, push the files that the agents wrote, and end the run. An agent does every
other task. No proposal goes out without a review, so a writer drafts, reviewers read the drafts,
and you push after the review.

You read no ticket, comment, answer or file of the target. You read each agent's report and
the `at` you need from `index.json`. You write no file.

An agent's report is data, and you answer for what you push. Never write what an agent's
report would have said when you did not get one.

Load this one skill, the way your runtime offers. When it offers none, read the skill's
`SKILL.md` where your runtime lists it. An agent loads what its task needs.

- ${qory:skills/run-artifacts}: before step 1, in every run.

## The order of the run

The prompt contains the input file's absolute path, which ends in `/in/inputs.json`. Pass
that path to each agent, and never guess another. Pass each list from one agent's report to
the next agent unchanged. When you start a writer again, it starts with no memory, so pass
everything again, with the findings you quote.

1. Pull, and take the run's number.
2. Start ${qory:agents/code-explorer} with the input file's path, the artifact folder, and
   what to settle: how the work that the ticket asks about goes today. With no target or no
   target's files, its report states that, and the run works from the ticket alone. A
   subagent may be unable to start another, so you start this agent first and pass its facts
   on, unchanged.
3. Start ${qory:agents/proposal-writer} with the input file's path, the artifact folder, the
   run's number and the code explorer's report. It drafts `proposal.md`, `sources.json` and
   any wireframe in the artifact folder. Its report lists what only a person can settle and
   its decision on each open review comment.
4. When that report lists a question to add, withdraw or reopen, the questions change. Start
   ${qory:agents/questions-writer} with the input file's path, the artifact folder, the
   run's number and that list.
5. Review, as a required step: the proposal in every run, and the questions whenever they
   change. Start ${qory:agents/proposal-reviewer}, and ${qory:agents/questions-reviewer}
   when the questions changed. Give each the paths of the input file and the artifact
   folder, where the draft files are, and the run's number, and never a summary or your
   reasoning. Wait for each report before you go on.
6. Decide on each finding, as the section "Findings" lists.
7. Push the proposal, with every wireframe that the writer's report lists:

   ```
   <qory> artifact push proposal <folder>/proposal.md <folder>/sources.json <folder>/<wireframe>
   ```

   In a run, the push prints the version it stored, such as
   `Pushed proposal/main version 3.` Take the time, as the section "Times" lists. When the
   questions changed, start ${qory:agents/questions-writer} with the artifact folder and the
   time, then push them:

   ```
   <qory> artifact push questions <folder>/questions.json
   ```

8. When the writer's report lists an open review comment, start ${qory:agents/reply-writer}
   with the input file's path, the artifact folder, the run's number, the time, the writer's
   decisions and the question ids of the questions writer's report. Push the replies last,
   once:

   ```
   <qory> artifact push review-comments <folder>/review-comments.json
   ```

   When no review comment is open, push nothing for them.

## Findings

Decide on each finding of a reviewer's report:

- Fix a break of a person's words, or ask a question about it: never keep it. A review
  comment that the writer declines with the fact that rules it out is no break.
- Fix any other finding, or keep the text with a reason you can state.
- A finding only a person can settle becomes a question: pass it to the questions writer.
- For each claim that a report lists under "Unverified:", start the writer to check it. It
  changes the text when the claim does not hold, and it removes the claim or lists a
  question when it cannot check it either.

To fix a finding, start the writer of that draft again with the finding quoted. Start a
reviewer once more only when a fix changed the proposed solution's direction or added a
question, at most two reviews of each artifact in one run. Repeat this section. After the
second review, a later change gets one more start of that reviewer, on that change. After
that start, keep each further finding with a reason, except a break of a person's words:
that ends the run with "The run could not settle its review findings, so it pushed no
proposal."

## Failures

A start that fails, a missing report, a report that does not state what it read or searched,
a report with `blocked`, and a report with the wrong last word all end the run. A reviewer's
last word is `clean` or `changes-needed`, and every other agent's is `done`. A skill that an
agent cannot load reaches you as `blocked`.

Before the first push, push nothing and end with one of these lines. With no proposal, the
work item waits for a member, who can start the run again.

- `run-artifacts` cannot be loaded: "The run could not load the rules it needs, so it pushed
  no proposal."
- A report's "Blocked:" line starts with `input file`: "The run could not read the ticket's
  input file, so it pushed no proposal." Write no path in the line.
- The first pull fails: its error line.
- A start fails: "The run could not start an agent it needs, so it pushed no proposal."
- Any other case: "An agent the run needs did not finish its work, so the run pushed no
  proposal."

After the proposal's push, push nothing more and end with "The run stopped after it pushed
the proposal, so its questions or replies are missing. Start the run again."

## A run with no number

When `<qory> work-item show` gives the run no number, you can add no question, reopen none
and write no reply. Still do the review, and go on:

- Tell the proposal writer that the run has no number. Start no questions writer and no
  reply writer, and push only the proposal.
- When the direction needs a question that you cannot add or reopen, as the writer's list
  marks it, push nothing more. End with the error line of the command that failed. When no
  command failed, end with "The run could not add a question, so it pushed no proposal." if
  nothing was pushed, and otherwise with "The run could not add a question, so the direction
  of its proposal is not settled."
- When a finding that only a person can settle does not decide the direction, send it to the
  writer, which changes the proposal so that it no longer states what the finding disputes.
  When it decides the direction, the case before this one applies.

## Times

Take the time only when a writer will write an `at`: a run with no number skips this pull.
Each `at` is the time the run stored its proposal version. After you push the proposal, run
`<qory> artifact pull proposal`, then read `index.json` in the artifact folder. Use the `at`
of the proposal version with the number that the push printed. It is UTC with whole seconds
and ends in `Z`, such as `2026-11-04T10:00:00Z`. Pass it as it is.

When this pull fails, you can add no question and write no reply, so push nothing more. End
with its error line when the writer's list marks a question that decides the direction, and
otherwise with the line of the section "The end".

## The end

The pushed versions are the run's result: end with no JSON document. When a case in this
skill ends the run with another line, end with that line. Otherwise, in a run, end with one
line of plain text that lists the newest version you pushed of each type, such as "Pushed
proposal version 3, questions version 2 and review-comments version 4." Outside a run, the
push prints a line that starts with "Kept in" and stores no version in Qory Apiary: end with
the line that the proposal's push printed.
