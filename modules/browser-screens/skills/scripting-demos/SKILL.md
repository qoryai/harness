---
name: scripting-demos
description: Write the demo script of each approved demo scenario that has none: start the demo author once per scenario, build the script from its actions and the approved scenario, and push it. Use in a Build run of implement-changes, after the last deliverable, when the check of demo scripts lists a scenario to script.
---

# Scripting demos

A demo script contains the browser actions of one approved demo scenario. The demo author,
${qory:agents/demo-author}, writes only the actions. The verb `demo write` of the checks
script adds the title, the expected result of each step, the evidence and the version of the
demo scenarios from the approved scenario, so no agent types them. The script replays the
actions in a browser later, so the screens must exist: this skill runs after the last
deliverable of the build.

`workflow-implement-changes` loads this skill when `demo check` lists a scenario with no
demo script. Its words `<qory>`, `<folder>`, `<inputs>` and `<skill folder>/checks.cjs` mean
here what they mean there. `<skill folder>/checks.cjs` is the checks script of
`running-a-workflow`.

The line of `demo check` that starts with "Write the demo script of" lists the scenarios to
script, in the order to script them, and shows the version `<S>` of the demo scenarios that
they come from. `<scenarios>` is the file
`<folder>/demo-scenarios/main/v<S>/demo-scenarios.md`.

## For each scenario

Do these steps for one scenario `<id>`, such as `scenario-1`, before the next scenario.

1. Run `<skill folder>/checks.cjs notes browser-demo-author`, as "Notes in a start" of
   `running-a-workflow` lists, with no `--files`.
2. Start the demo author in the foreground, as "Starting agents" of `running-a-workflow`
   lists, with the input file's path, `<folder>`, the path of the build plan that the run
   started with, the run's number, the notes, `<id>`, the path of `<scenarios>`, and the
   path `<folder>/.demo/<id>.actions.json`, where it writes its file. Write its report to
   `<folder>/.reports/browser-demo-author-<n>.md` and check it, as "Check each report"
   lists. A report whose last word is `blocked`, and a start that fails, end the run as
   "Failures" of `running-a-workflow` lists, with "The demo script of <id>, <the title>" as
   the work and "demo script" as `<output>`. When the report has a line that starts with
   `Blocked: no screen for` or `Blocked: no action for`, the cause is that line, in plain
   words.
3. Run `<skill folder>/checks.cjs demo write <id>`. With 0, the script `.demo/<id>.json` of
   the artifact folder is built. With 1 and a first line that starts with "Fix the
   scenario", the scenario breaks a rule that the demo author cannot fix: end as "Failures"
   lists, with that line's cause as the cause. With another 1, start the demo author again,
   at most twice, with each line that `demo write` printed, quoted, the path of its last
   report and the path of its file, and tell it to fix only those lines. Check its report as
   step 2 lists, and run `demo write` again. When `demo write` still exits with 1 after the
   second start, end as "Failures" lists, with the cause "its actions still break the rules
   for a demo script after two fixes". With 2 or 3, end as "Failures" lists for the checks
   script.
4. Run `<skill folder>/checks.cjs check demo-script <folder>/.demo/<id>.json --inputs
   <inputs>`, as "Check before each push" of `running-a-workflow` lists. With 1, the script
   breaks a rule that `demo write` does not check: end as "Failures" lists, with the first
   line that `check` printed as the cause. With 2 or 3, end as "Failures" lists for the
   checks script.
5. Push it, as "Push only what changed" of `running-a-workflow` lists:

   ```
   <qory> artifact push demo-script --name <id> <folder>/.demo/<id>.json
   ```

   When the push exits with 4 or fails, run step 4 again, then push again, at most twice
   more. When the third push also fails, end as "Failures" lists, with the cause "the push
   of the demo script failed".

A demo script that a member uploaded and a script that an earlier round pushed are not
rewritten: `demo check` lists only the scenarios with no script.

When every scenario has its script, go back to "The order of the run" of
`workflow-implement-changes`.
