---
name: running-a-software-workflow
description: Load in the main session of a small or high-level workflow of the software factory, after running-a-workflow, and never in an agent. Contains the further repositories, the stops on the spec and its criteria, a criterion that Build cannot meet, Change mode, the files that each check takes, the plain words of each type, and the steps of the build ledger.
---

# Running a software workflow

This skill adds to `running-a-workflow` the parts of a run that use the words of software.
Each section names the section of `running-a-workflow` that it adds to.

## Further repositories

Besides the commands that "What you do" of `running-a-workflow` lists, you run this `find`.
Before the first agent starts, run it once per run, and again only when you lost its
output:

```
find . -maxdepth 2 -path ./.qory/repositories -type d
```

Also under a higher workflow, give the code explorer, the spec writer, and the decision
writer and reviewer one line at each start: "Further repositories: yes" when the `find`
printed the folder, else "Further repositories: no". When it printed the folder, also give
the questions writer and reviewer the line "Also search: .qory/repositories" at each
start.

## Stops on the spec

This line adds to the lines of "Failures" for a "Blocked:" line before the first push:

- One that starts with `needs a change to criterion`, `needs a new criterion` or
  `needs a change to the spec`, with an `answer` point, except a line on a criterion that
  "A blocked criterion" lists:
  - criterion: "<ID>, "<criterion text>", needs a change before the run can write the
    <output>: <the change>." Example: "AC-3, "A member exports up to 50,000 rows to CSV",
    needs a change before the run can write the demo scenarios: the feedback asks for an
    export of the filtered rows only."
  - new criterion: "The acceptance criteria need a new criterion before the run can write
    the <output>: <the change>."
  - spec: "The spec needs a change before the run can write the <output>: <the change>."

  `<ID>` is the id on the "Blocked:" line in upper case, and `<criterion text>` is the first
  sentence of that criterion in the newest acceptance criteria, without its full stop: read
  that line with a read form of `run-artifacts`, besides what "What you do" of
  `running-a-workflow` lets you read. `<the change>` is the change that the "Blocked:"
  line states after the colon that follows its start. When the line states none, end the
  text after `<output>`.

## Checks per type

"Check before each review" runs `check` with these types and files, each at the top of the
artifact folder: `spec` with `spec.md`, `acceptance-criteria` with
`acceptance-criteria.json`, `decision-record` with `decision-record.md`, `demo-scenarios`
with `demo-scenarios.md`, and `build-plan` with `build-plan.md`. A mockup has no checks, and
its reviewer gets no "Checks:". Nor does the reviewer of an acceptance lock: its draft has
no SHA-256 until `checks.cjs lock` fills it and checks it.

## Types in plain words

In the text of a point and in the last line of "The end", name each type in these words:
"spec" for `spec`, "acceptance criteria" for `acceptance-criteria`, "technical decision
record" for `decision-record`, "mockups" for `mockup`, "demo scenarios" for
`demo-scenarios`, "build plan" for `build-plan`, and "acceptance lock" for
`acceptance-lock`.

## The build ledger

In a Build session, these steps add to "What you do" of `running-a-workflow`. Run each
command with `<skill folder>/checks.cjs`, the checks script of `running-a-workflow`. When it
exits 3 with a first line "Run <verb> again after the other call finishes", another call
held the ledger: when that call has ended, run the same command again, once. When it exits
with 2, 3 or 4 otherwise, end as "Failures" lists for the checks script.

1. After the artifact pull, and before the first step, run `checks.cjs resume` once. A line
   "Run <id> again" names a step whose session stopped while it ran: that step runs again.
2. Before each step, run
   `checks.cjs step begin <id> <workflow> --inputs <path> <file>...`, with the id of the
   step, such as `deliverable:d-2`, the name of your workflow, the path of the run's
   inputs, the file that ends in `/in/inputs.json` in the prompt, and the files that your
   workflow lists for the step: its inputs, its skill file and its role's agent file.
   - With "Replay <id>", start no agent and push nothing for the step: read the report
     above that line, and go on to the next step.
   - With "Run <id> as pass <N>", start the step's agent.
   - With "Start no new step", check `points.json` with `check points`, and end the run
     with `escalate`, as "Points" of `running-a-workflow` lists. The script wrote the point.
   - With "Run git stash push" or "Run git reset --keep" and exit 1, a failed step left
     a change or a commit: run that command, then the same `step begin` again. Both
     commands keep the step's files: in a stash, and in the reflog of git.
   - With any other line and exit 1, start no agent, and end as "Failures" lists.
3. The steps `plan`, `checks` and each step of a demo script, `script:scenario-1` and
   `script:scenario-1#2`, end `done` only with a valid report of their reviewer for the file
   as it is, with no blocking finding. Run `checks.cjs step end <id> done` with no flag
   before each start of that reviewer, also when the file did not change, and after each
   review, before you push, lock or run the file. This call exits with 1 and records
   nothing. Do nothing on a line that these cases do not list:
   - Before a start, a line "The report of this file is <path>." has the path: give the
     reviewer `<folder>/<path>` as the report file. With no such line, end as "Failures"
     lists, unless the skill of your workflow lists the line it printed.
   - After a review whose last word is not `blocked`, a line that starts with "Start" and
     the reviewer's name means that the report file is missing or breaks its format, which
     the line after it states. Start the same reviewer again with the input it got, the path
     of its text report and those lines, and tell it to write only its report file, with the
     findings of that text report. That start does not count toward the reviewer's start
     limit, so run no `starts` before it. This applies only when the file did not change
     since that review; a review of a changed file counts as the skill of your workflow
     lists. The reviewed content changed when the path in the line "The report of this file
     is <path>." differs from the path that the call before the start printed. For `checks`,
     the reviewed content also includes the files that the lock lists. Then run the call
     again. When the line is still there after two such starts, run `step end <id> failed`,
     and end as "Failures" lists.
   - After a review, a line that starts with "Fix the blocking findings" means that the
     report file has a blocking finding: push, lock and run nothing. The file needs a fix of
     its writer and a new review, as your workflow lists for a finding marked `break`.
4. After the step, run `checks.cjs step end <id> done`, or `failed` when the step failed.
   Add `--report <file>` with the agent's last report under `.reports`, one
   `--attempt <agent>,<role>,<tier>` per agent start, one
   `--pushed <type>/<name>/<version>` per version the step stored, and, for a step
   `script:`, `--script-sha256 <sha256>`. `step end` adds the model of each start: the
   `model:` of the agent file, else the `model` of the session's `settings.json`; on Codex,
   the `model` of `agents/<agent>.toml`, else of `config.toml`; else `unknown`. When
   `step end done` exits with 1, the step made an edit that no commit of the step has, the
   step's file has no passing review, or the report has a list `Left out:` that
   `report-build` cannot read: with "Fix the list Left out: of your report.", fix the list
   with the writer of the report, then run `step end done` again once. If it exits 1 on
   the list again, run `step end <id> failed --report <file>` with the cause. With a
   line that starts with "Start check-reviewer", "Start plan-reviewer" or "Fix the blocking
   findings", do the steps of your workflow from the start of that reviewer again, or from
   the start of the writer for a blocking finding, then run `step end done` again once. If
   no start of that reviewer is left, or it exits 1 on the review again, run `step end <id>
   failed`, and end as "Failures" lists. Else end as "Failures" lists. `step end failed`
   records the row and exits 0, also when it prints a line that it left the report out:
   go on to the next step.

   The only valid list in a step report is a line `Left out:` (or `**Left out:**`) at the
   start of a line, then one line `- <item>: <risk>` per item (`*` also works as the
   bullet), each at the start of its line. Blank lines are skipped. The list ends at the
   next heading (a line that starts with `#`) or at the end of the report: write it
   last, or follow it with a heading. Any other line in it, and any other spelling of
   the header, such as `## Left out` or `left out:`, makes the list unreadable.
   `Left out: none` is the empty list.

## A blocked criterion

In a Build workflow, a "Blocked:" line of `build-planner` or `acceptance-check-writer` that
starts with `needs a change to criterion <ac-N>` ends the run as this section lists, in
place of "Stops on the spec": the agent cannot meet that criterion as a member approved it.

1. Run `step end <id> failed` for the step that ran the agent, as your workflow lists.
2. Start `questions-writer` as "Points" of `running-a-workflow` lists, with one
   "Add:" item for each such criterion that has no open question with the three answers in
   the newest `questions`, with `about.item` set to its id. The item quotes the "Blocked:"
   line and what the agent checked: the files, the command and its result. The question of
   each item has these members:
   - `question`: "What do you want to do with AC-3, "<first sentence>"?"
   - `context`: a paragraph that starts with `**Why:**`, the cause, and a paragraph that
     starts with `**Checked:**`, the proof: the files, the command and its result. At most
     120 words, and each criterion quoted as in the question.
   - `about`: `{"type": "acceptance-criteria", "name": "main", "item": "ac-3"}`.
   - `options`, exactly three, each with a `title` and an `explanation`:
     1. `Change AC-3, "<first sentence>"`, with `proposal`, the wording that the build can
        meet, and the explanation "The criterion reads as the proposed wording, and Build
        meets it."
     2. `Make it met another way`, with the explanation "Write in the note how."
     3. `Withdraw AC-3, "<first sentence>"`, with the explanation "AC-3, "<first
        sentence>", stays in the criteria, marked withdrawn by you."

   Qory Apiary adds a fourth answer that the person writes, so the question has no option
   for it. `<first sentence>` is the first sentence of the criterion in the newest
   acceptance criteria, without its full stop, as "Stops on the spec" reads it.
3. Write one `answer` point for each criterion, on its question: "AC-3, "<first
   sentence>", cannot be met as approved: <the cause>." Then end as "Points" lists, with
   `escalate`.

`check points` exits with 1 for a blocked criterion with no `answer` point on such a
question, and the end check stops a session that ends with such a line and no
`points.json`. Only the newest report of each agent counts: a later start that meets the
criterion ends the line.

## Change mode

`plan-the-build` and `write-acceptance-checks` redo only what a changed criterion touches.
Right after `checks.cjs resume`, run `checks.cjs changes` once. It pulls the criteria version
that the newest acceptance lock locks, compares it with the criteria version that the run
reads, prints the ids, and writes `.qory/build/changes.json` in the working folder. No agent
writes that file: the tool guard denies the writes below `.qory/build/` that it reads. The
last line of its output is one of these three, and it reads nothing of the build plan
except that a version exists:

- "Full run: <reason>." There is no lock that counts, no build plan or no approved criteria.
  Do the workflow whole, as you would without this section.
- "No criterion changed since acceptance-lock version <N>." Run no `step begin`, start no
  agent, push nothing, and read no stop of the build plan, such as a missing check path:
  the workflow ends as its section "No criterion changed" lists. A build plan that is
  newer than the lock stays as it is.
- "Changes since acceptance-lock version <N>: <a> changed, <b> added, <c> removed." The
  lines before it list the ids as "Changed: ac-2, ac-4.", "Added: ac-5.", "Removed: ac-3.",
  "Checks to write: ac-2, ac-5." and "Checks to drop: ac-3.", each only when it has an id.
  A check to drop is the check of a criterion that is removed or no longer planned as
  `Tests`. Quote these lines when your workflow lists passing the ids to an agent.

When `changes` exits with 1, 2 or 3, end as "Failures" lists for the checks script.
