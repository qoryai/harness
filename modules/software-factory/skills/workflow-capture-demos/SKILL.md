---
name: workflow-capture-demos
description: Film each approved demo scenario that has no demo evidence for the commit of the work, start demo-reviewer on the frames of each film, push the demo-video or screenshot and the demo-evidence, withdraw the evidence of removed scenarios, and record the verdict. Use in a headless run of the workflow capture-demos.
---

# Capture demos

This workflow requires subagents. The session films the demo scripts of the approved demo
scenarios on the checkout of the work, has `demo-reviewer` judge the frames, and stores one
`demo-evidence` for each scenario. It changes no code, and it never starts
`demo-author`, the agent that writes demo scripts: the demo scripts exist already.

- ${qory:skills/run-artifacts}: before step 1, in every run.
- ${qory:skills/running-a-workflow}: before step 1, in every run. There, `<workflow>` is
  `capture-demos`, and in the lines of its section "Failures", `<output>` stands for "demo
  evidence".
- ${qory:skills/running-a-software-workflow}: before step 1, in every run, after
  `running-a-workflow`.

When your runtime offers no way to load a skill, read each `SKILL.md` where your runtime
lists it. When one of these skills cannot be loaded, start nothing and end with
"The run could not load the rules it needs, so no demo was filmed."

Each command of this skill that starts with `<skill folder>/checks.cjs` is the checks script
of `running-a-workflow`. `<inputs>` is the path of the input file from the prompt, which
ends in `/in/inputs.json`. `<folder>` is the artifact folder that the pull prints. `<id>` is
a scenario id, such as `scenario-2`, and `<N>` its number. Run each call of `preflight` and
`film` with a tool timeout of at least 600 s.

## What the session writes

Write nothing in the checkout. The files are:

- `<folder>/.film/<id>/`, which `film` writes: the film or the pictures, and the frames;
- `<folder>/<id>.json`, which `film record` writes, the demo evidence of the scenario;
- `<folder>/.reports/demo-reviewer-<n>.md`, the reports that "Check each report" of
  `running-a-workflow` lists;
- `<folder>/points.json`, only for the end of "An outside cause".

Push only `demo-video`, `screenshot` and `demo-evidence`, and withdraw only those three
types. Start no agent that is not `demo-reviewer`.

## The order of the run

1. Pull, then run `<qory> work-item show`. When it printed no `run.id`, start nothing and
   end as "Failures" lists, with "No demo was filmed, because the run has no id."
2. Run `<skill folder>/checks.cjs film todo`. It prints "To film: <ids>." and "To withdraw:
   <type> <id>, ...." with "none" for an empty list. A scenario is in "To film" when the
   approved demo scenarios have it, it has a demo script that counts, and it has no demo
   evidence for the commit of the checkout and for that version of the script, or its
   evidence for this commit has the class `setup`. A scenario with evidence of the class
   `product` or `script` for this commit stays as it is. With 1, 2 or 3, end as "Failures"
   lists for the checks script.
3. For each `<type> <id>` of "To withdraw", run
   `<qory> artifact push <type> --name <id> --withdraw`. When the push exits with 4, qory
   kept it: go on with the next. When it exits with any other status, end as
   "Failures" lists, with "The run could not withdraw the evidence of a removed demo
   scenario."
4. With "To film: none", go to "The end".
5. Run `<skill folder>/checks.cjs preflight --inputs <inputs>`. With 0, go on. With 1,
   `preflight` wrote `<folder>/points.json` with one `run_again` point for each missing part,
   and the first lines of its findings each end with the line "Kind: outside" or
   "Kind: setup":
   - When one finding has "Kind: outside", do "An outside cause" with the points that
     `preflight` wrote, also when another finding has "Kind: setup".
   - When every finding has "Kind: setup", do "A setup fault" with the first finding. Its
     cause and its repair are the `text` and the `fix` of its point in `<folder>/points.json`:
     the point whose `fix` is the text after "The fix of its point:" in the finding. The first
     line of a finding is the instruction to end the session, not a cause.
   With 3, end as "Failures" lists for the checks script.
6. Do "One scenario" for each `<id>` of "To film", in the order of the list. Stop at the
   first end that "A setup fault" or "An outside cause" lists.
7. Do "The end".

## One scenario

1. Run `<skill folder>/checks.cjs film <id> --inputs <inputs>`. Sort its exit status and
   output in this order:
   - With 0, go on to step 2.
   - With 4, the film is over the size of one version, or ffmpeg did not finish pass 1, and
     `film` kept the frames. Run `<skill folder>/checks.cjs film recode <id>`. With 0, go on
     to step 2. With 1, the film does not fit even after the second encode: record it with
     the class `script` and the first two lines of the output as the cause, as step 5
     lists, push the evidence, and go to the next scenario. With 3 and "Kind: outside" on a
     line of the output, do "An outside cause". With another status, end as "Failures"
     lists for the checks script.
   - With 5, the run failed in step `<k>` after it recorded the steps before it, and `film`
     kept them. Go on to step 2, then do "The review" with the first line of the output as
     the failure of step `<k>`.
   - With 1 and "Kind: outside" on a line of the output, the workspace lacks the `AGENT_`
     variable of a name that the sign-in or a step types: do "An outside cause". Take the
     person's action from its first line.
   - With 1 and "Kind: setup" on a line of the output, the sign-in failed with every
     variable set: do "A setup fault" with the first two lines of the output.
   - With 1 and the last line "Stored no film: it failed in step <k>." or "Stored no
     pictures: it failed in step <k>.", the script failed before anything was recorded, or
     its title has "-->": record the scenario with the class `script`, the first two lines
     of the output as the cause and `--step <k>`, as step 5 lists. Push the evidence and go
     to the next scenario.
   - With 3 and "Kind: outside" on a line of the output, do "An outside cause": this is a
     browser or ffmpeg that is missing, an ffmpeg that did not finish, or a disk that is
     full. With 3 and "Kind: setup", do "A setup fault" with the first two lines of the
     output.
   - With 2 or another status, or 3 with no "Kind:" line, end as "Failures" lists for the
     checks script.
2. With the evidence `film`, run `<skill folder>/checks.cjs film frames <id>`. With 3 and
   "Kind: outside" (no ffmpeg on the machine), do "An outside cause". With the evidence
   `pictures`, the pictures `<folder>/.film/<id>/<id>-step-<N>.png` are the frames.
3. Review the frames, as "The review" lists. The review gives each step a verdict, and a
   class for a failed step.
4. Push the media once, and take the number that the push printed. With the evidence `film`,
   run `<qory> artifact push demo-video --name <id> <folder>/.film/<id>/<id>.mp4
   <folder>/.film/<id>/<id>.vtt`. With the evidence `pictures`, run `<qory> artifact push
   screenshot --name <id> <folder>/.film/<id>/<id>-step-*.png`. When the push is still
   refused after the third attempt, end with "The run could not push its demo evidence."
   and record no verdict. A scenario with no film has no media, and so has a run that
   failed in a step (exit 5 of `film`): skip this step.
5. Run `<skill folder>/checks.cjs film record <id> --review <report> --media <number>`,
   where `<report>` is `<folder>/.reports/demo-reviewer-<n>.md` of the review. For a run
   that failed in a step, leave out `--media`. For a scenario that has no film, run
   `film record <id> --class <class> --cause "<cause>"`, with `--step <k>` for a step, and
   with no `--media`. Join the lines of a cause with a space, and leave out the line that
   starts with "Kind:". It writes `<folder>/<id>.json`.
   With 1, fix the input that its first line points to and run it again, at most twice,
   then end as "Failures" lists.
6. Run `<skill folder>/checks.cjs check demo-evidence <folder>/<id>.json`. With 1, do the fix
   in its first line, at most twice. Then push it:
   `<qory> artifact push demo-evidence --name <id> <folder>/<id>.json`. When the push is
   still refused after the third attempt, end with "The run could not push its demo
   evidence." and record no verdict.

## The review

1. Run `<skill folder>/checks.cjs notes demo-reviewer`, and count the start, as "Notes in a
   start" and "Count the starts" of `running-a-workflow` list, with
   `capture-demos-<N>-demo-reviewer` as `<name>`. When `starts` exits with 1, start no
   reviewer: its missing report is a failure, as "Failures" lists.
2. Start ${qory:agents/demo-reviewer} in the foreground. Pass it the input file's path
   `<inputs>`, `<folder>`, the scenario id, the path of the newest `demo-script` version of
   the scenario that counts, `<folder>/demo-script/<id>/v<V>/<id>.json`, the paths of the
   frames, the evidence of the scenario, and the path of the notes file. Take `<V>` from
   `<folder>/index.json`: the highest `number` in `versions` of the entry whose `type` is
   `demo-script` and whose `name` is `<id>`, of those with no `cancelled` set to `true`. For
   a run that failed in step `<k>`, add the line "The run failed in step <k>: <the reason
   that `film` printed>". Read no frame yourself.
3. Write its report to `<folder>/.reports/demo-reviewer-<n>.md` and check it, as "Check
   each report" lists. With a last word `blocked`, end as "Failures" lists, with "The
   review of the frames of <id> did not finish, because <its Blocked: line, in plain
   words>, so the run pushed no demo evidence for it."
4. When the report has the line "Needs film:" and the evidence of the scenario is
   `pictures`, run `film <id> --film --inputs <inputs>` and do step 1 of "One scenario"
   again for the film, then `film frames <id>`, then this section again for the new
   frames. Use the new report. The pictures are gone, so the evidence is now `film`.
5. When the report has a failed step with the class `setup`, do "A setup fault" with the
   finding of the first failed step, and record the scenario with the step `<k>` of that
   finding. The report is not used for the evidence of that film.

Judge nothing about a frame yourself: the verdicts are those of the report.

## A setup fault

A setup fault is a failure of the app, its sign-in or its data, which a change to the
repository repairs. A fault that the dev container or the workspace causes is "An outside
cause".

1. The first setup fault of the run gets one retry. Run again the call that found it, once:
   `preflight`, or `film <id>` from step 1 of "One scenario", or, for a review, `film <id>`
   and the review again. When the call passes, go on: a `preflight` that passes removes the
   points that the failed one wrote. When it fails again, or when this is the second setup
   fault of the run, do the next steps.
2. Record the failed evidence for each scenario of "To film" that has no demo evidence for
   this commit yet, the scenario that failed and the ones the run did not reach, and a
   failed `preflight` included, with the class `setup`, `--step 1` (the step `<k>` of a
   review) and, as the cause, the first two lines of the output of `film`, the `text` of
   the point of a failed `preflight`, or the finding of the review. Run
   `film record <id> --class setup --cause "<cause>" --step 1`, check it, and push it, as
   "One scenario" steps 5 and 6 list. A scenario that has evidence of this run
   already keeps it.
3. Run `<qory> run verdict changes-requested` with no point.
4. End with one line: "Setup failed, so <k> demo scenarios have no film: <ids>. <First
   line of the cause> Repair: <the fix>." For `film`, the cause is the first two lines of the
   output and the fix is its first line. For `preflight`, they are the `text` and the `fix`
   of the point, as step 5 of "The order of the run" lists. Cut it to 500 characters. With
   one scenario, write "1 demo scenario has no film". The `<ids>` are the scenarios of
   "To film" that have no film pushed, the failed one included, joined by ", ".

No Build session reads the verdict. Qory Apiary starts `verify-a-ticket` after
`changes-requested`, and Verify reads the failed evidence: a criterion that rests on one of
these scenarios is `not_met`, with the scenario, the step, the class `setup` and the cause
in its row, and Build reads that row in its next round. A new run of `capture-demos` films
the scenarios of the class `setup` again, also for the same commit. A failed scenario that
no criterion rests on reaches Build only through a later round.

## An outside cause

An outside cause is a failure that no change to the repository repairs: the dev container
has no browser or no ffmpeg, ffmpeg runs out of time, the disk is full, or the workspace
lacks `AGENT_<name>` for a variable `<name>` that a demo script types. The script marks it
with the line "Kind: outside".

A first line that starts with "Give the dev container more" is an ffmpeg timeout or a full
disk. The first one of the run gets one retry: run the same call again, once. When it passes,
go on. When it fails again, do the steps below.

1. For a failed `preflight`, `<folder>/points.json` has its points already: go to step 2.
   For `film`, write `<folder>/points.json` as "Points" of `running-a-workflow` lists, with
   one `run_again` point. Its `text` is "The run could not film <ids>, because <the cause in
   plain words>." Its `fix` is the action of the person: the first line of the output up to
   the comma or its final period, then ", then run another round.", such as "Add ffmpeg to
   the dev container, then run another round." or "Add AGENT_<name> in the Variables
   settings, then run another round." For the fix "Add AGENT_<name>", take `<name>` whole
   from the line of the output with "the variable <name> has no value": the first line cuts
   a name of 64 characters to 60 and `...`.
2. Run `<skill folder>/checks.cjs check points <folder>/points.json`. With 1, correct the
   lines it prints, at most twice.
3. Run `<qory> run verdict escalate --points <folder>/points.json`, and end with the text
   of the point.

## The end

Record the verdict once, as the last command, with `<qory> run verdict passed`. The
verdict is `passed` when each scenario of "To film" has its evidence pushed, also when
a scenario failed: a failed scenario of the class `product` or `script` is a fact of the
evidence that Verify reads, not a failure of this session. When the command fails, the run
ends with no verdict.

End with one line, in this form: "Filmed <k> demo scenarios: <m> passed, <n> failed.
Failed: <ids>." With nothing to film, "No demo scenario needs a film, because each has
evidence for this commit." Leave out "Failed:" when none failed. With one scenario, write
"1 demo scenario". When the run withdrew evidence, add "Withdrew the evidence of <ids>."

## Failures

A checks script exit of 2, 3 or 4 that this skill lists no step for, a skill that does not
load, a report that fails the check after two fixes, and a push that fails end the run as
"Failures" of `running-a-workflow` lists, with the lines that this skill lists. Evidence
that the run pushed before stays: a later run films only the scenarios with no evidence
for the commit, or with evidence of the class `setup`.
