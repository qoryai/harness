---
name: running-a-software-workflow
description: Load in the main session of a small or high-level workflow of the software factory, after running-a-workflow, and never in an agent. Contains the further repositories, the stops on the spec and its criteria, the files that each check takes, the plain words of each type, and the steps of the build ledger.
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
  `needs a change to the spec`, with an `answer` point:
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
     limit, so run no `starts` before it. For the first script of a demo scenario it counts:
     run the two `starts` that `scripting-demos` lists for it. Then run the call again. When
     the line is still there after two such starts, run `step end <id> failed`, and end as
     "Failures" lists.
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
