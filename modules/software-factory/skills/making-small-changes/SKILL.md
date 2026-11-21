---
name: making-small-changes
description: Load before you change code or review a change: how small a change is, and what it never cuts.
---

# Making small changes

1. **The approved plan is the floor.** Build everything that the approved plan lists. "Small"
   decides how you build each part, never whether. If the plan cannot be built as written, stop,
   change no file, and report the change the plan needs.
2. **Find the full reach first.** Before you edit, list each caller, test, fixture, setting and
   export that the change touches. A change that leaves one of them broken is not complete.
3. **Reuse in this order:** change nothing when the plan needs nothing; then code that the
   repository has; then the standard library; then a dependency that is installed. Add no new
   dependency for code of a few lines.
4. **Write nothing for later.** Add no option, setting, wrapper or abstraction that the plan does
   not need. Delete code before you add code. Keep the structure of the files you touch.
5. **Fix the cause once.** For a bug, find every caller of the broken code, and fix the cause in
   the shared code, not at each caller.
6. **Keep the guards.** Code that you move or merge keeps its error handling and validation. Never
   cut validation of input from outside, handling that prevents data loss, security checks or
   accessibility.
7. **Prove new logic.** Logic with a branch or a calculation gets one small test or assert.
8. **Mark a known limit** in a code comment: `shortcut: <the limit>, <when to replace it>`.
9. **Report what you left out.** In your report, list each thing that you left out and each
   `shortcut:`, with its risk, one line each.
