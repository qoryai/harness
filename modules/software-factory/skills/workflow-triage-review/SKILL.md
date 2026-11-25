---
name: workflow-triage-review
description: Orchestrate the first step of a Build run: sort the feedback that a person gave on the change into fixes, criterion changes and questions, start the feedback triager, the questions writer and the reply writer in that order, push the feedback and the questions, write each criterion change as a new version of the criteria or the scenarios linked to its source, and end with a question to a member when a point has one. Use in a headless run of the workflow triage-review.
---

# Triage the review

This workflow requires subagents.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<output>` is
  `feedback`, `<workflow>` is `triage-review`, and in the lines of its section "Failures",
  `<output>` stands for "feedback".
- ${qory:skills/running-a-software-workflow}: before step 1, in every run, after
  `running-a-workflow`.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of the three cannot be loaded, push nothing and end with "The run could
not load the rules it needs, so it pushed no feedback."

`<folder>` is the artifact folder that the pull prints. Each command that starts with
`<skill folder>/checks.cjs` is the checks script of `running-a-workflow`. A source is one
note of a person, a comment or a reply. A point is one thing that the person asks for in a
source.

## The order of the run

1. Pull, then run `<qory> work-item show`.
2. Run `<skill folder>/checks.cjs feedback open`. It prints one JSON line per source that no
   run sorted, with one line "Words of <id>: <words>" after each. A line "Not asked: <point>,
   <question>" is a question that an earlier run did not push. A line "Waiting for an answer:
   <point>, <question>" is a question with no answer. Its last line starts with "Open
   feedback:".
   - With 0 and no line "Waiting for an answer:", when the `writer.run_id` of the newest
     `feedback` in `index.json` is the `run.id` of `work-item show`, an earlier session of
     this run pushed it: start no agent, and go to step 9.
   - With 0 and no line "Waiting for an answer:", in any other case, nothing is open. Start
     no agent, push nothing, run `<qory> run verdict passed`, and end with "The run found no
     new feedback, so it changed nothing."
   - With 0 and a line "Waiting for an answer:", start no agent, and do "Questions with no
     answer".
   - With 1, go on. The run has sources when a JSON line was printed.
   - With 2 or 3, end as "Failures" of `running-a-workflow` lists for the checks script.
3. Start ${qory:agents/feedback-triager} with the input file's path, the artifact folder,
   the run's number, each line that step 2 printed, unchanged, and any finding to fix. Before
   each start, also one that fixes a finding, run
   `<skill folder>/checks.cjs starts <run> triage-review-1-feedback-triager 3`, as "Count
   the starts" of `running-a-workflow` lists. With sources, it drafts `feedback.json`.
4. With sources, run `<skill folder>/checks.cjs check feedback <folder>/feedback.json`. With
   1, start the triager again with every line quoted, then check again. A finding "Add the
   source <id> to feedback.json." is a note that came during the run: before that start, run
   `<qory> artifact pull questions`, then `<skill folder>/checks.cjs feedback open`, and give
   the triager its lines too. At the third check that exits with 1, or when `starts` exits
   with 1, push nothing and do "Feedback that cannot be sorted".
5. When the triager's list "What only a person can settle" has an item, start
   ${qory:agents/questions-writer} with the input file's path, the artifact folder, the
   run's number and the triager's two lists. Then run
   `<skill folder>/checks.cjs check questions <folder>/questions.json`, and fix its findings
   as "Check before each push" of `running-a-workflow` lists.
6. With sources, start ${qory:agents/reply-writer} with the input file's path, the artifact
   folder, the run's number, the path `<folder>/feedback.json`, the ids of its new points,
   and the ids of the questions. It adds the `reply` of each new point. Then run the check
   of step 4 again. A finding on a `reply` goes to the reply writer, and a finding on a
   question, such as "Give q5 2 to 4 options.", to the questions writer, as "Check before
   each push" lists. Any other finding goes to the triager, as step 4 lists; when the triager
   adds points then, start the reply writer again with their ids.
7. With sources, push the feedback:
   `<qory> artifact push feedback <folder>/feedback.json`. Then take the time, as "The time
   of a version" of `run-artifacts` lists. With no source, the time is the largest `at` in
   `index.json`.
8. When step 5 wrote questions, start the questions writer with the artifact folder, the
   time and its newest lists, then run
   `<qory> artifact push questions <folder>/questions.json`. The feedback is pushed first,
   because the `about` of a question can be a point of it.
9. Run `<qory> artifact pull`, then `<skill folder>/checks.cjs feedback points`. It prints
   one line "Fix first: <id>: <change>" per fix that Build has not built, and one JSON line
   per group of criterion changes that no version has. Keep `<k>`, the number of lines that
   start with "Fix first:". With 2 or 3, end as "Failures" lists for the checks script.
   With a JSON line, do "Criterion changes" before step 10.
10. Run `<skill folder>/checks.cjs feedback open` again. With a line "Not asked:", end as
    "Failures" of `running-a-workflow` lists for a step after the push. With a line "Waiting
    for an answer:", or an `answer` point that "Criterion changes" kept, do "Questions with
    no answer", with those points too. A JSON line is a source that came during the run: the
    next run of this workflow sorts it. Otherwise run
    `<qory> run verdict passed` as the last command, and end with "The run sorted the
    feedback: <k> to fix in Build."

"Notes in a start" of `running-a-workflow` applies to each start. The questions writer and
the reply writer get one start each, besides the start with the time, the starts for a
finding of a check, and the start for the points that the triager adds after a finding.

## Criterion changes

Do this section after step 9 when `feedback points` printed a JSON line, and before step 10.
Each JSON line is a group: the points of one source for one output, which one version of
that output makes. A group has these members:

- `decision`: the id of the source, which the version links to;
- `output`: `acceptance-criteria` or `demo-scenarios`;
- `points`: each change, with the person's words in `quote`. A point with an `item` changes
  that criterion or scenario, and a point with no `item` adds one at the end. In a group of
  `demo-scenarios`, a point whose `id` is a criterion id, such as `ac-2`, follows a change of
  that criterion in a newer version of the acceptance criteria: its `quote` has the row
  `before` and `after`, and its `item` is the scenario that shows the criterion, or there is
  none when a new scenario shows it;
- `waiting`: only when a question has no answer that the group depends on: a question of
  the source about the output, or a question about a point of the group, such as one that a
  writer of the group raised.

Take the groups one at a time, in the order of the lines. `<writer>` and `<reviewer>` are
${qory:agents/spec-writer} and ${qory:agents/spec-reviewer} for `acceptance-criteria`, and
${qory:agents/scenario-writer} and ${qory:agents/scenario-reviewer} for `demo-scenarios`.
`<file>` is `acceptance-criteria.json` or `demo-scenarios.md`.

1. Skip a group with `waiting`: `feedback open` in step 10 prints a line "Waiting for an
   answer:" for each of its questions, so they end the run.
2. Start `<writer>` with the input file's path, the artifact folder, the run's number, the
   line "A change from a person's feedback:" and the group's JSON line after it, unchanged,
   and no other source or note. It changes the copy of the newest version, as its skill
   lists in "A change from a person's feedback", and lists under "Already so:" each point
   that the newest version already meets.
3. Run `<skill folder>/checks.cjs feedback amended <output> --decision <decision>`, with
   `--same <id>` for each point on the writer's list "Already so:". With 1, start the
   writer again with each finding quoted, then run `feedback amended` again. Start the
   writer at most twice for these findings. When it still exits with 1, do "A change that
   the run could not write". With 2 or 3, end as "Failures" lists for the checks script.
4. Run `check <output>` as "Check before each review" lists, and count the start of
   `<reviewer>` as "Count the starts" lists, with `triage-review-<n>-<reviewer>-<decision>`
   as `<name>`. Start `<reviewer>` with the input file's path, the artifact folder, the run's
   number, the line "A change from a person's feedback:" and the group's JSON line after
   it, the writer's list "Already so:" and the lines of the check. With a finding, start the
   writer with each finding quoted, then do step 3 and this step again. When `starts`
   exits with 1, or a finding stays after the third start, do "A change that the run could
   not write".
5. Push once with the link: `<qory> artifact push <output> <folder>/<file> --decision
   <decision>`, also when the file has the same bytes as the newest version. "Push only
   what changed" does not apply to this push, because the link ends the points. Then take
   the next group.

When the writer lists an item under "What only a person can settle", or reports
`Blocked: needs a change to criterion` or `Blocked: needs a new criterion`, push nothing
for the group, keep one `answer` point for it, and take the next group. Start the questions
writer with the writer's report, then check and push the questions as steps 5 and 8 list.
The text of the point is "The feedback "<words>" changes the approved criteria, so a member
decides it.", or, for a group of `demo-scenarios`, "The feedback "<words>" changes the
approved demo scenarios, so a member decides it.", with `<words>` the text after "Words of
<decision>: ", and its `question` is the id of the question that the questions writer adds
for the item.

After the last group, run `<qory> artifact pull` and `feedback points` again. A new JSON
line is a group that a push of this run started, such as the demo scenarios of a changed
Demo criterion: take it as above. `feedback points` prints the group of the demo scenarios
of a source only after the criteria version of that source, unless the group of the
criteria has `waiting`, so that one group has the source's points on the scenarios and
those of each changed Demo criterion. A pushed group stays pushed when a later group fails.
After a crash, step 9 prints only the groups that no version has.

### A change that the run could not write

Push nothing for the group, and end as "Points" of `running-a-workflow` lists, with each
`answer` point of this section and one `run_again` point. Its text is "The run could not
write the change to AC-2, "<first sentence>", that you asked for.", with the id and the first
sentence of the `item` of the group's first point that has one, as "Stops on the spec" of
`running-a-software-workflow` reads them. With no such point, or for the demo scenarios, its
text is "The run could not write the change to the <words> that you asked for.", with
"acceptance criteria" or "demo scenarios" as `<words>`. Its `fix` is "Run Build again.":
another start of the writer and the reviewer can write the change.

## Questions with no answer

Write `points.json` with one `answer` point per question on a line "Waiting for an answer:",
as "Points" of `running-a-workflow` lists, then end as that section lists. The `question` of
the point is the id of the question on that line. An `answer` point that "Criterion changes"
kept on the same question is that point. A line followed by "Words of <id>: <words>" is a
question that a group of criterion changes waits for. `<id>` is the point of the group that
the question is about: a point of the feedback, or, for a ripple point, a criterion id such
as `ac-2`, with the words of the point of the source that changed that criterion. The text of
its point is "The feedback "<words>" changes the approved criteria, so a member decides
it.", with `<words>` the text after "Words of <id>: ", or "The feedback "<words>" changes the
approved demo scenarios, so a member decides it." for a group of `demo-scenarios`. Read the
output of the group in `output` of the JSON line, in the newest output of `feedback points`,
whose `points` have the id `<id>`. For any other line, read the question in
`<folder>/questions.json`, else in the newest version, with the file tool of your runtime.
`<words>` is what the context has in its first double quotes, unchanged, and `<criterion
text>` what it has in its second double quotes. The text of the point is one of these, by
the words that follow in the context:

- "can mean": "The feedback "<words>" can be read 2 ways, and a user sees a different result
  for each." With 3 or 4 readings, write that number.
- "cannot be built as written": "The feedback "<words>" cannot be built as written: <the
  cause in one clause>."
- "removes", in a question whether to keep the part that is built: "The feedback
  removes "<criterion text>", and the change already has <the built part, in one clause>."
- "adds", "changes" or "removes", in any other question: "The feedback "<words>" changes the
  approved criteria, so a member decides it."

## Feedback that cannot be sorted

End as "Points" of `running-a-workflow` lists with one `run_again` point: "The run could not
sort the feedback "<words>"." `<words>` is the text after "Words of <id>: " of the first
source.

## A point outside the fast track

When the triager reports a line "Blocked: outside the fast track: "<words>" is not <kind>:
<reason>", push nothing, and end as "Points" of `running-a-workflow` lists with one
`run_again` point. Its text is "The feedback "<words>" is not <kind>: <reason>." Its `fix` is
"Pick Switch to Standard to build this change on the Standard track, because the Fast track
is only for <kind>."

## Failures

A failure of an agent, a missing report, and any other "Blocked:" line end the run as
"Failures" of `running-a-workflow` lists. When a push fails after the feedback is stored, the
next run of this workflow finds the question as "Not asked:".
