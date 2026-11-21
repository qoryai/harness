---
name: exploring-code
description: Load before you search a target's files in a run. Contains how to name the destinations that a ticket concerns, which files belong to the target, the order to read them in, the search forms for the target, its further repositories and its destinations, how to keep files with secrets out of a search, what to find for a build plan, and how to report facts.
---

# Exploring code

Load ${qory:skills/run-artifacts} only when you lack Read, Grep or Glob, or have a shell:
then the forms in that skill apply here. You read the target's files in the working folder
and in the folders of its destinations. You change nothing in them.

## Name the destinations

When the question you got is to name the destinations that the ticket concerns, read only
the input file, as `reading-the-work` lists, and search no file: the run copies the files of
a destination only after this start. Name each destination with a `target.address` that the
work may need, by the ticket's words, names and addresses, and no other. Name at most 100,
each once. List each id under "Destinations:" as `- <id>`, and write
`- nothing: the question names the destinations` under "What you searched:". When the work
needs no destination with an address, leave out "Destinations:".

In a later start, when the files show that the work needs a destination whose folder you did
not get, list its id under "Destinations:" too. The run copies more destinations once at
most, so list every one that the work needs.

## The target's files

The target's files include the files in the folder of each line `<id> <folder>` that you got
under "Destinations:": each folder contains the files of one destination. Change nothing in
them. List each folder with `ls -A <folder>`, apart from `.git`.

With no `target` in the input file, read nothing in the working folder. With no line under
"Destinations:" either, report that under "What the files cannot show". Otherwise, run
`ls -A .` in the working folder. The target's files are also what it shows apart from `.git`
and `.qory`. When you got the line "Further repositories: yes", they also include every
further repository: a folder under `.qory/repositories`, which belongs to the target: change
nothing in it. List them with `ls -A .qory/repositories`. Without that line, write
`.qory/repositories` in no tool call, and search only the working folder and the folders
under "Destinations:".

With a shell, after the listing, list the links once in the working folder:

```sh
find . \( -name .git -o -name .qory \) -prune -o -type l -print
```

List the links of each folder under "Destinations:" once too, with
`find <folder> -name .git -prune -o -type l -print`.

Never read a path that the command printed, or a path that goes through one of them: a
link can lead outside the target.

An agent with no shell lists with Glob. Pattern `*` lists every file at any depth: ignore
what is under `.git` and `.qory`. With the line "Further repositories: yes", also use
pattern `*` with `path: ".qory/repositories"`. Use it with `path: "<folder>"` for each
folder under "Destinations:" too.

If no listing shows such a file, or the first call is refused, there are no target's
files: report that, because the work then rests on the ticket alone. That is normal, because
a target can be a place the run has no files of: never ask about it.

## What to read

Read the target before you ask or propose. Stay inside what the ticket asks. Make no full
map of the target. Stop when the picture is clear: when you can describe how the work goes
today and propose a solution, or when only a person can settle what is left. Read in this
order:

1. The files at the top of the working folder, or of each folder under "Destinations:",
   that describe the target, such as a `README`, contribution notes or a build file.
2. Search for the ticket's words: its names, messages, addresses and numbers.
3. The files the search finds, and the files beside them.

After the search, follow these from what you found, as far as the ticket or the question you
got needs:

- The path from a person's action to the outcome.
- The failure path: what happens when a step fails.
- The other users of what you found: what else depends on it.

## What to leave out

Keep `.git`, the rest of `.qory`, generated folders, such as dependencies and build output,
and each file whose name marks it as containing secrets out of every search:

- Search the working folder with
  `grep -r --exclude-dir=.git --exclude-dir=.qory --exclude='.env*' -- <quoted word> .` and
  `find . -name .git -prune -o -name .qory -prune -o -name <quoted pattern> -print`.
- With the line "Further repositories: yes", give further repositories as the start path:
  `grep -r --exclude-dir=.git --exclude='.env*' -- <quoted word> .qory/repositories` and
  `find .qory/repositories -name .git -prune -o -name <quoted pattern> -print`.
- With lines under "Destinations:", give each folder as the start path:
  `grep -r --exclude-dir=.git --exclude='.env*' -- <quoted word> <folder>` and
  `find <folder> -name .git -prune -o -name <quoted pattern> -print`.
- An agent with no shell searches with Grep, `glob: "!.env*"`. With that line, it searches
  again with `path: ".qory/repositories"`, because a search with no path leaves that folder
  out. It searches again with `path: "<folder>"` for each folder under "Destinations:". It
  finds names with Glob, pattern `**/<pattern>`, and ignores what is under `.git` and the
  rest of `.qory`.

When a search prints a line of a file whose name marks it as containing secrets, do not
repeat the line.

## What the files show

A search that finds nothing shows only what the run can read. The thing you searched for
can be in a system the run cannot read. Name that system in the report, and state the
missing result as what the search found, never as a fact about that system.

## For a build plan

When the question you got is for a build plan, read the newest approved acceptance criteria
yourself, as `reading-the-work` lists. After the search above, settle these for each
criterion, and report each as a fact under "Facts:" with its path and line:

- The files that the change touches: where the behaviour lives today and which files depend
  on it. For a behaviour that is new, the folder where code of its kind lives, with one file
  there as an example.
- The tests of that area: their folder, the naming pattern of the test files, one test file
  as an example, the helpers and fixtures that tests there use, and the command that runs
  one test file.
- The commands of the checks, each with the file and line that state it: the linter, the
  type check, the build, the full suite and, when a criterion is shown in a demo, the
  command that starts the app and the address of the app. For each command that
  runs tests, the path of the JUnit XML result file that it writes, or the fact that it
  writes none.

A command that no file states goes under "What the files cannot show". Write no command that
you did not find. State where each thing is, and give no opinion on which change to make.

## Report

An agent whose expected output has this shape reports these three things in it:

```text
What you searched:
- <word> in <folder>
- nothing: no target
- nothing: <reason>

Destinations:
- <id>

Facts:
- <path>:<line>: <fact>

What the files cannot show:
- <what is missing, any system that may have it, and what would settle it>

Blocked: <the path, skill or missing input, and why>
<done or blocked>
```

Write a file of a further repository with its path from the top of the working folder.
Write a file of a destination as its id, a colon and the path inside its folder, such as
`tg_8k2m4n6p8q0r2s4t: src/cart.ts`. Leave out "Destinations:", "Facts:" or "What the files
cannot show:" when it has no item. The last line is one
word: `done` when you finished, and `blocked` when you stopped early. Only `blocked` has the
"Blocked:" line. Put any other line, such as a list of sources, before the last line.
