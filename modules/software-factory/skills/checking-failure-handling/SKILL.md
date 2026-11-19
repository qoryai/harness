---
name: checking-failure-handling
description: Load before you review how a change handles failure, after reviewing-changes and judging-findings. Contains what the review reads, the area it covers, the steps, what is blocking in that area and the proof it needs, and the check list.
---

# Checking failure handling

Load `reviewing-changes` first and `judging-findings` next. This skill adds the area of the
review of failure handling: what it reads, the steps, and how each kind of finding of the
area falls under the definition of `blocking` in `judging-findings`.

## What the review reads

- `qory.review.diff`: the lines that the change adds and removes. Read all of it.
- `qory.review.commit`: the read-only copy of the change. Search it with Grep and Glob, with
  its path as the folder. Read the callers of each changed function: a caller decides what
  an error or a timeout of the function does next.
- `qory.review.suite_result`: the result of the full suite. Its `output_tail`, the last
  lines of the output of the suite, is the source of a `failing check` proof. A red locked
  check is a finding that qory writes.
- `qory.review.previous_findings`, when it exists, as "Earlier findings" lists.
- `qory.review.build_report`, when it exists. A claim in it, such as "errors are handled",
  is no proof. Read the code.

## The area

The run starts this review only when the change has a file of error handling, retries,
timeouts, queues, jobs or background workers. The review covers the whole change for a
failure that the change drops, repeats or leaves half done: an error, a timeout, a message
that is lost or delivered twice, and a worker that stops.

The review of the code also reports bugs, in step 3 of `checking-code`, among them an
error that the code drops and a retry that repeats a side effect. Write each finding that
you can prove, also when that review may write it as well: you read only the failure side.
A bug on the path with no failure, a security hole, a failing test and a criterion that is
not met are outside this area: their reviewers write them. Write no finding about code that
the change does not touch and does not newly call.

## Earlier findings

When `previous_findings` exists, re-read the lines of each finding in it, as
`reviewing-changes` and `judging-findings` list. This skill narrows their rule to the
findings of the area of this review: repeat, with its id, each such finding that is still
true. Leave out the findings of each other area, because the reviewer of that area repeats
them.

## Review of failure handling

1. List each place where the change calls another system or runs later: a network call, a
   read or write of a disk or a database, a publish to a queue, a job that runs in the
   background, a scheduled task, a thread, a goroutine or an async task. For each, name what
   can fail and what the code does then.
2. Errors: look for an error that is caught and dropped (an empty `catch`, `except: pass`,
   `_ = err`); an error that is logged and then treated as a success; a failure that
   returns a value that looks like a result, such as an empty list or `0`; a catch so wide
   that it hides a fault in the code; an error that is replaced by a new one that loses the
   cause; and a state that says `done` before the work finished.
3. Timeouts: for each call out of step 1, find its timeout. Look for a call with none, where
   the default waits for ever; a timeout longer than the timeout of the caller, so that the
   caller gives up first and the call keeps running; and a lock or a wait with no limit.
4. Retries: look for a retry of an action that does harm twice (a payment, a message, an
   insert with no unique key) with no key that makes the second try a no-op; a retry with no
   limit or with no wait between tries; a retry of an error that cannot change, such as a
   rejected input; and a retry inside a retry, which multiplies the tries.
5. Queues and jobs: look for a message that is acknowledged before its work finishes, so a
   crash loses it; a message that fails and returns to the queue for ever, with no limit and
   no dead-letter place; a job that runs twice when the queue delivers a message twice and
   does its effect twice; a job that stores a whole record where its id would do, so that it
   works on stale data; and a job that starts jobs with no limit.
6. Cleanup: for each error path, find what the step took: a file, a connection, a lock, a
   transaction, a temporary record. Look for one that stays open or taken, and for a write
   of several steps that stops in the middle with nothing that undoes the first steps.
7. Workers and shutdown: look for a background task whose failure stops the whole program
   with no log, a worker that no signal stops, and an error in a task that nobody reads.
8. The same defect in another place of the change is a separate finding for each place.
9. The suite: write no finding for a red suite, because the run writes it. You may cite the
   lines of `output_tail` of `suite_result` that show a check fail as the `failing check`
   of a failure that you name. Prove the other failures with a `failing input`.

## Blocking in this area

These lists sort the kinds of finding of this area under the definition of `blocking` in
`judging-findings`, and add nothing to it. A break in this area is a failure that the code
turns into a wrong result. Its proof names the failure, the line where it occurs, the lines
that it then passes, and the wrong result that follows.

- `blocking`, with a `failing input` traced through the quoted lines: an error of step 2
  that is dropped, so that the caller gets a result that is wrong; a retry of step 4 that
  does its harm twice; a message of step 5 that a crash loses or that fails for ever; a
  step 6 that leaves a half-written state; or a `failing check`.
- `non-blocking`: a call with no timeout when the failure that the proof needs depends on a
  setting that the repository does not show; a retry with no wait that does no harm; a
  worker of step 7 with no stop signal; a break of a rule of the repository, such as a
  guide for errors, with a `broken rule` proof that quotes the file and the line of the
  rule.
- A failure that you cannot trace to a wrong result by reading is `non-blocking`, or you
  leave it out.

## Check list

- You listed each call out and each job, message and task that the change adds or changes,
  and what each does when it fails.
- Each error is handled, passed on with its cause, or a finding.
- Each call out has a timeout shorter than the timeout of its caller.
- Each retry is bounded, waits between tries, and repeats only an action that does no harm
  twice.
- Each job is marked done after its work, ends a failing message, and does no second effect
  on a second delivery.
- Each error path releases what its step took.
- Each failure is a separate finding, with a proof that repeats it.
- No finding is for a bug on the path with no failure, for a security hole, for a failing
  test, for a criterion, or for code that the change does not touch.
- No finding is for a red suite.
- Each earlier finding of this area that is still true is in the report with its `id`.
