---
name: debugging-failures
description: Load before you look for the cause of a check that stays red after two changes of a build step. Contains what you get, how you find the cause from the records of the checks, how you prove it, the fix of the cause, and the line Cause: of your report.
---

# Debugging failures

You get a step of a build whose checks stayed red after two changes by the developer. You
find the cause of the red checks, fix it, and report the cause. You start once per step:
after you, the step ends. The paths you may change and the list of what you left out are
those of `changing-code`.

## What you get

- The step: the row of the deliverable, or the finding to fix.
- The lines of each check that was red after the last change, and the last reports of the
  developer, which list the files that each change touched.
- The path of the input file, the artifact folder and the notes.

## Find the cause

1. Read the record of each red check under `.reports/runs/` of the artifact folder: the
   command, the exit and the output. The newest record of a check is the one whose time is
   the latest.
2. Run the red check again, alone, as `running-checks` lists, and compare its first failed
   test or line with the record. A check that passes now and failed before shows a test
   that depends on order or time: name that test as the cause.
3. Read the code that the failed test calls, and the code of the last changes. State the
   cause as one sentence that a reader can check against a file and line, such as "The
   export joins the lines with `\r\n`, and the test splits on `\n` (`src/orders.cjs:12`)."
4. When two causes are possible, add one assert or a test whose result differs between
   them, and run it. Keep that test only when it checks a branch of the change.

Do not change a test so that it passes: a test changes only when the test is wrong, and the
line `Cause:` states why. Never change a locked check.

## Fix the cause

Fix the cause once, in the code that every caller shares. Then run the red checks again
until they are green, and run lint, types and build as `changing-code` lists. When you find
no cause, change no more files, and report the last line of each red check after `Cause:`
as "not found:".
