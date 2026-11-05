---
name: exploring-code
description: Load before you read a target's files in a run. Contains which files belong to the target, the order to read them in, the search forms for the target and its further repositories, how to keep files with secrets out of a search, and how to report facts.
---

# Exploring code

Load ${qory:skills/run-artifacts} first: its forms for reading, listing and searching apply
here. You read the target's files in the working folder. You change nothing in them.

## The target's files

Run `ls -A .` and `ls -A .qory/repositories` in the working folder. The target's files are
what the first listing shows apart from `.git` and `.qory`, and every further repository: a
folder under `.qory/repositories`, which belongs to the target: change nothing in it. The
second call fails when there is none.

If neither listing shows such a file, or the first call is refused, there are no target's
files: work from the ticket alone. That is normal, because a target can be a place the run
has no files of: never ask about it.

## What to read

Read the target before you ask or propose. Stay inside what the ticket asks. Make no full
map of the target. Stop when the picture is clear: when you can describe how the work goes
today and propose a solution, or when only a person can settle what is left. Read in this
order:

1. The files at the top of the working folder that describe the target, such as a
   `README`, contribution notes or a build file.
2. Search for the ticket's words: its names, messages, addresses and numbers.
3. The files the search finds, and the files beside them.

## What to leave out

Keep `.git`, the rest of `.qory`, generated folders, such as dependencies and build output,
and each file whose name marks it as containing secrets out of every search:

- Search the working folder with
  `grep -r --exclude-dir=.git --exclude-dir=.qory --exclude='.env*' -- <quoted word> .` and
  `find . -name .git -prune -o -name .qory -prune -o -name <quoted pattern> -print`.
- Give further repositories as the start path:
  `grep -r --exclude-dir=.git --exclude='.env*' -- <quoted word> .qory/repositories` and
  `find .qory/repositories -name .git -prune -o -name <quoted pattern> -print`.

When a search prints a line of a file whose name marks it as containing secrets, do not
repeat the line.

## What the files show

A search that finds nothing shows only what the run can read. The thing you searched for
can be in a system the run cannot read. Name that system in the report, and state the
missing result as what the search found, never as a fact about that system.

## Report

Report these three things, in this shape:

```text
What you searched:
- <word> in <folder>

Facts:
- <path>:<line>: <fact>

What the files cannot show:
- <what is missing, and the system that may have it>

Blocked: <the path, skill or missing input, and why>
blocked
```

Write a file of a further repository with its path from the top of the working folder. Only
a report that stopped early has the last two lines.

Give no judgment: no opinion on what the work should be or which option is right. When a run
follows this skill with no agent, this report is its notes.
