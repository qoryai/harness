---
name: running-a-software-workflow
description: Load in the main session of a small or high-level workflow of the software factory, after running-a-workflow, and never in an agent. Contains the further repositories, the stops on the spec and its criteria, the files that each check takes, and the plain words of each type.
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
`acceptance-criteria.md`, `decision-record` with `decision-record.md`, and `demo-scenarios`
with `demo-scenarios.md`. A mockup has no checks, and its reviewer gets no "Checks:".

## Types in plain words

In the text of a point and in the last line of "The end", name each type in these words:
"spec" for `spec`, "acceptance criteria" for `acceptance-criteria`, "technical decision
record" for `decision-record`, "mockups" for `mockup`, and "demo scenarios" for
`demo-scenarios`.
