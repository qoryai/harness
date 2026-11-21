---
name: checking-data-changes
description: Load before you review a change to stored data, after reviewing-changes and judging-findings. Contains what the review reads, the area it covers, the steps, what is blocking in that area and the proof it needs, and the check list.
---

# Checking data changes

Load `reviewing-changes` first and `judging-findings` next. This skill adds the area of the
review of data changes: what it reads, the steps, and how each kind of finding of the area
falls under the definition of `blocking` in `judging-findings`.

## What the review reads

Each value is one of "The values of the review" of `judging-findings`.

- `diff`: the lines that the change adds and removes. Read all of it.
- `commit`: the read-only copy of the change. Search it with Grep and Glob, with
  its path as the folder. Read the migrations that come before the changed one: the rows
  that exist are the rows that the earlier migrations and the code allow.
- `suite_result`: the result of the full suite. Its `output_tail`, the last
  lines of the output of the suite, is the source of a `failing check` proof. A red locked
  check is a finding that qory writes.
- `previous_findings`, when it exists, as "Earlier findings" lists.
- `build_report`, when it exists. A claim in it, such as "the migration is
  safe", is no proof. Read the migration.

You run no migration and read no database. Your proof comes from the lines that you read.

## The area

The `paths` of `data-reviewer` are the migration, schema and model files, so a panel step
starts this review for a change in them. The review covers each such file of the change, and the code of the change that
reads or writes the table, column or field that they change. It reports data that a change
loses, makes fail or leaves wrong.

The review of the code also reports data loss, in step 5 of `checking-code`. Write each
finding that you can prove, also when that review may write it as well: you read only the
data side. A bug in code that touches no stored data, a failing test and a criterion that
is not met are outside this area: their reviewers write them. Write no finding about a
migration that the change does not touch.

## Earlier findings

When `previous_findings` exists, re-read the lines of each finding in it, as
`reviewing-changes` and `judging-findings` list. This skill narrows their rule to the
findings of the area of this review: repeat, with its id, each such finding that is still
true. Leave out the findings of each other area, because the reviewer of that area repeats
them.

## Review of data changes

1. List the migration, schema and model files of the diff. Put the migrations in the order
   that they run: by the number or the time in the file name, as the tool of the repository
   orders them.
2. Existing rows: for each migration, say what it does to a row that exists. Look for a
   dropped or renamed column or table; a type that gets narrower (a shorter text, a bigint
   to an int, a decimal with fewer places); a new `NOT NULL` with no default and no
   backfill; a new unique key, foreign key or check that a row that exists may break; and
   a changed default. Find in the earlier migrations and in the code which values a row can
   have: a column that was nullable has rows with no value.
3. The way back: look for an `up` with no `down`, a `down` that raises or does nothing, and
   a `down` that cannot restore what `up` removed, such as the values of a dropped column.
   A step that cannot be undone needs a guard that the migration shows: a copy of the data,
   or a check that the data is unused.
4. Order and drift: look for a migration whose number or time is older than a migration
   that exists, two migrations that change the same table in conflict, a model or schema
   file that has a field with no migration, a migration with no change to the model, and a
   schema dump (`schema.rb`, `structure.sql`, `schema.prisma`) that the change does not
   update.
5. The code that reads and writes: Grep the copy for each column, table or field that the
   change drops, renames or retypes. Code that still reads the old name, writes the old
   type, or leaves out a new required field is a bug of this area.
6. Old code on the new schema: while a release goes out, the code of the release before runs
   against the new schema, and the new code may run against the old one. Look for a
   migration that drops or renames a column or table, or adds a required column with no
   default, in the same change as the code that stops using it, so the old code fails
   until it is replaced. The safe order is to add first, move the code, and drop in a later
   change. Find the old code in the removed lines of the diff and in the code that the
   change leaves as it is. Check a file of the repository, such as a rolling deploy or a
   migration that runs before the new code starts, to see whether the two releases overlap.
7. Wide writes: a data migration or a backfill with no `where`, a `where` wider than its
   rule, a delete that cascades to tables outside the migration, and an update of every
   row in one statement on a table that a file of the repository shows as large.
8. Locks: an index made with no `CONCURRENTLY` where the database supports it, a column
   with a default added on a database version that rewrites the table, and a data step in
   the same transaction as a change of structure. Give the table size that a
   file of the repository shows; with none, the finding is `non-blocking`.
9. The same defect in another migration of the change is a separate finding for each one.
10. The suite: write no finding for a red suite, because the run writes it. You may cite the
   lines of `output_tail` of `suite_result` that show a check fail as the `failing check`
   of a defect that you name. Prove the other defects with a `failing input`.

## Blocking in this area

These lists sort the kinds of finding of this area under the definition of `blocking` in
`judging-findings`, and add nothing to it. A break in this area is a state of the data that
makes a migration fail, or that a migration loses or corrupts. Write its proof as the row or
the state, the lines that make it, the step of the migration that it meets, and the result.

- `blocking`, with a `failing input` traced through the quoted lines: a row that the earlier
  migrations or the code can make, and that makes a migration of step 2 fail or that it
  changes; a step 3 that destroys data with no way back and no
  guard; code of step 5 that fails on the new structure; old code of step 6 that fails during the deploy, when a file of the
  repository shows that the two releases overlap, with the request that the old code
  handles, its line, the dropped or renamed column and the error; a write of step 7 that
  reaches rows outside its rule; or a `failing check`.
- `non-blocking`: a missing `down` for a step that loses no data; drift of step 4 that
  breaks nothing now; old code of step 6 with no file that shows an overlap; a lock of step 8 with no size to show; a break of a rule of the
  repository, such as a guide for migrations, with a `broken rule` proof that quotes the
  file and the line of the rule.
- A loss that you cannot prove by reading is `non-blocking`, or you leave it out.

## Check list

- You listed each migration, schema file and model file of the diff, in the order that the
  migrations run.
- Each migration is traced against the rows that exist, with the values that the earlier
  migrations and the code allow.
- Each step that cannot be undone has a guard or a finding.
- Each dropped, renamed or retyped column, table or field has its readers and writers
  checked with Grep.
- Each dropped, renamed or newly required column is checked against the code of the release
  before.
- Each data write has a `where` no wider than its rule.
- Each defect is a separate finding, with a proof that repeats it.
- No finding is for code that touches no stored data, for a failing test, for a
  criterion, or for a migration that the change does not touch.
- No finding is for a red suite.
- Each earlier finding of this area that is still true is in the report with its `id`.
