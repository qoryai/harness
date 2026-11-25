---
name: workflow-triage-review
description: Orchestrate the first step of a Build run: sort the feedback that a person gave on the change into fixes, criterion changes and questions, start the feedback triager, the questions writer and the reply writer in that order, push the feedback and the questions, and end with a question to a member when a point has one. Use in a headless run of the workflow triage-review.
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
note of a person, a comment or a reply. A point is one thing that a source asks for.

## The order of the run

1. Pull, then run `<qory> work-item show`.
2. Run `<skill folder>/checks.cjs feedback open`. It prints one JSON line per source that no
   run sorted, with one line "Words of <id>: <words>" after each. A line "Not asked: <point>,
   <question>" is a question that an earlier run did not push. A line "Waiting for an answer:
   <point>, <question>" is a question with no answer. Its last line starts with "Open
   feedback:".
   - With 0 and no line "Waiting for an answer:", nothing is open. Start no agent, push
     nothing, run `<qory> run verdict passed`, and end with "The run found no new feedback,
     so it changed nothing."
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

   `shortcut:` a criterion-change point changes no criterion; the next workflow step adds it.
10. Run `<skill folder>/checks.cjs feedback open` again. With a line "Not asked:", end as
    "Failures" of `running-a-workflow` lists for a step after the push. With a line "Waiting
    for an answer:", do "Questions with no answer". A JSON line is a source that came during
    the run: the next run of this workflow sorts it. Otherwise run
    `<qory> run verdict passed` as the last command, and end with "The run sorted the
    feedback: <k> to fix in Build."

"Notes in a start" of `running-a-workflow` applies to each start. The questions writer and
the reply writer get one start each, besides the start with the time and the starts for a
finding of a check.

## Questions with no answer

Write `points.json` with one `answer` point per line "Waiting for an answer:", as "Points" of
`running-a-workflow` lists, then end as that section lists. The `question` of the point is
the id of the question on that line. Read the question in `<folder>/questions.json`, else in
the newest version, with the file tool of your runtime. `<words>` is what the context has in
its first double quotes, unchanged. The text of the point is one of these, by the words that
follow in the context:

- "can mean": "The feedback "<words>" can be read 2 ways, and a user sees a different result
  for each." With 3 or 4 readings, write that number.
- "cannot be built as written": "The feedback "<words>" cannot be built as written: <the
  cause in one clause>."
- "removes", in a question that asks whether to keep the part that is built: "The feedback
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
