---
name: checking-security
description: Load before you review a change for security holes, after reviewing-changes and judging-findings. Contains what the review reads, the area it covers, the steps, what is blocking in that area and the proof it needs, and the check list.
---

# Checking security

Load `reviewing-changes` first and `judging-findings` next. This skill adds the area of the
review of security: what it reads, the steps, and how each kind of finding of the area falls
under the definition of `blocking` in `judging-findings`.

## What the review reads

- `qory.review.diff`: the lines that the change adds and removes. Read all of it.
- `qory.review.commit`: the read-only copy of the change. Search it with Grep and Glob, with
  its path as the folder, and read each file of the diff in it. A hole is often in a caller
  or a configuration that the diff does not show.
- `qory.review.suite_result`: the result of the full suite. Its `output_tail`, the last
  lines of the output of the suite, is the source of a `failing check` proof. A red locked
  check is a finding that qory writes.
- `qory.review.previous_findings`, when it exists, as "Earlier findings" lists.
- `qory.review.build_report`, when it exists. A claim in it, such as "input is validated",
  is no proof. Read the code.

## The area

The run starts this review only when the change has a file of authentication,
authorisation, secrets, cryptography, input from outside, dependencies or CI workflows.
The review covers the whole change for a security hole that the change adds: a way for a
person or a program to read, change or run what they may not.

The review of the code reports security holes too, in step 4 of `checking-code`. Write each
hole that you can prove, also when that review may write it as well: you read only for
holes, and you read each entry point, secret, dependency and workflow of the change. A bug
that is no hole, a failing test and a criterion that is not met are outside this area:
their reviewers write them. Write no finding about code that the change does not touch and
does not newly call.

## Earlier findings

When `previous_findings` exists, re-read the lines of each finding in it, as
`reviewing-changes` and `judging-findings` list. This skill narrows their rule to the
findings of the area of this review: repeat, with its id, each such finding that is still
true. Leave out the findings of each other area, because the reviewer of that area repeats
them.

## Review of security

1. List the entry points that the change adds or changes: a route, a handler, a webhook, a
   job that reads a message, a command that reads arguments, a file that the program loads.
   For each, name who can reach it and what that person may do.
2. Authentication: a login, a session, a token or a key that the change issues or checks.
   Look for a check that a path skips; a token whose signature, expiry or audience is not
   verified; a credential in the code; a password that is stored or logged as typed, or
   hashed with a fast hash with no salt.
3. Authorisation: for each entry point of step 1, find the line that checks who asks, and
   the line that checks that this person owns the record. Look for a check that comes after
   the action, a role check with no owner check, so that one member reads the record of
   another by its id, and a default that allows.
4. Input from outside: follow each value that a stranger sets to where it ends. Look for a
   value that reaches a query, a shell command, a file path (`..` in it), a template, a
   deserialiser, a redirect address or the address of a fetch, and for output that puts the
   value into a page with no escaping.
5. Secrets and cryptography: a key, token or password in code, a fixture, a log line, an
   error text or a URL; a hash, cipher or mode that is weak for its use, a fixed nonce or
   salt, a random value from a source that is not made for keys, and a check of a
   certificate that the change turns off. Never write the value in your report, also not in
   a quote: write `<value left out>` in its place, and name the file and the line.
6. Dependencies: for each added or changed dependency in a manifest, read the lockfile
   change beside it. Look for a dependency that nothing in the change uses, a version range
   with no upper bound or `latest`, a source that is a branch or a URL, a lockfile that
   changes with no manifest change, and an install script that the change adds.
7. CI workflows: look for a step that runs a value that an outside person sets, such as a
   title, a branch name or a body of a pull request, in a shell line; a trigger that runs
   with secrets on a change from outside; a `permissions` setting wider than the job needs;
   an action that a movable tag or branch names; and a step that prints a secret.
8. Settings that widen access: a listening address open to every host, a debug mode, a
   cross-origin rule that allows every origin together with credentials, and a cookie with
   no `HttpOnly`, `Secure` or `SameSite` setting.
9. The same defect in another place of the change is a separate finding for each place.
10. The suite: write no finding for a red suite, because the run writes it. You may cite the
    lines of `output_tail` of `suite_result` that show a check fail as the `failing check`
    of a hole that you name. Prove the other holes with a `failing input`.

## Blocking in this area

These lists sort the kinds of finding of this area under the definition of `blocking` in
`judging-findings`, and add nothing to it. A hole is a break of what a person may do. Its
proof names who sends what, the lines that the input passes, and what the person then reads,
changes or runs.

- `blocking`, with a `failing input` traced through the quoted lines: an entry point of
  steps 3 or 4 that a person with no right reaches; an input of step 4 that reaches a sink;
  a real secret of step 5 in the change, with its file and line and no value; a check of
  step 2 that a path skips; or a `failing check`.
- `non-blocking`: a dependency or workflow setting of steps 6 to 8 that widens risk and that
  you cannot trace to a person who gains access, such as an unpinned version or a movable
  tag, with the reason in the finding; a weak algorithm used for a value that grants no
  access; a break of a rule of the repository, such as a security policy file, with a
  `broken rule` proof that quotes the file and the line of the rule.
- A hole that you cannot prove by reading is `non-blocking`, or you leave it out.

## Check list

- You listed each entry point of the change and who can reach it.
- Each entry point has the check of who asks and of who owns the record, or a finding.
- Each value from outside is followed to where it ends.
- No secret value is in your report, and each secret in the change has a finding with its
  file and line.
- Each added or changed dependency and each changed workflow is read.
- Each hole is a separate finding, with a proof that repeats it.
- No finding is for a bug that opens no access, for a failing test, for a criterion, or
  for code that the change does not touch.
- No finding is for a red suite.
- Each earlier finding of this area that is still true is in the report with its `id`.
