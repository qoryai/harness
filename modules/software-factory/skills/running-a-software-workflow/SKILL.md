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
`acceptance-criteria.json`, `decision-record` with `decision-record.md`, and
`demo-scenarios` with `demo-scenarios.md`. A mockup has no checks, and its reviewer gets no "Checks:".

## Types in plain words

In the text of a point and in the last line of "The end", name each type in these words:
"spec" for `spec`, "acceptance criteria" for `acceptance-criteria`, "technical decision
record" for `decision-record`, "mockups" for `mockup`, and "demo scenarios" for
`demo-scenarios`.

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
3. After the step, run `checks.cjs step end <id> done`, or `failed` when the step failed.
   Add `--report <file>` with the agent's last report under `.reports`, one
   `--attempt <agent>,<role>,<tier>,<model>` per agent start, one
   `--pushed <type>/<name>/<version>` per version the step stored, and, for a step
   `script:`, `--script-sha256 <sha256>`. When `step end done` exits with 1, the step made
   an edit that no commit of the step has: end as "Failures" lists. `step end failed`
   records the row and exits 0, also when it prints a line that it left the report out:
   go on to the next step.
