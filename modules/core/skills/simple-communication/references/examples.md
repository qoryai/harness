# Before and after

Open this file when you write one of the kinds of text below and want a full example.
Each "before" contains correct facts in a form the reader cannot use. Each "after"
applies [SKILL.md](../SKILL.md). The note under each pair lists the rules applied.

## 1. A failed CI job, reported to the author

**Before**

> Pipeline `build-and-test #812` did not complete successfully (`stage=verify`,
> `status=E_CHECK`). The verification stage has flagged an issue that needs to be
> addressed. Please investigate the cause described above and push a fix. Logs:
> `internal-ci/runs/812/artifacts`.

**After**

> Add the new `RATE_LIMIT_PER_MINUTE` setting to `config/example.env`, then push. The
> config check compares `config/example.env` with the settings that the code reads,
> and `RATE_LIMIT_PER_MINUTE` is missing from the example file. Your code change passes
> every test.

The action comes first, the cause follows in one sentence, and the reassurance is
last. The bare codes, "above" and the log path that the author cannot open are gone.
Rules: § The two questions, 9, 18, § Write for a cold reader.

## 2. A decision request

**Before**

> During the schema update, several inconsistencies were encountered in the data.
> There are three options for how to proceed: (a) merge (b) halt (c) skip. Please
> advise.

**After**

> **Deciding fact:** 37 email addresses each belong to two accounts. The unique index
> that `0057_unique_email.sql` adds to `users.email` cannot be built while both
> accounts of a pair are in the `users` table.
>
> **Terms:** an *archived account* is an account moved from the `users` table to the
> `archived_users` table. It cannot sign in, and an administrator can move it back from
> **Admin > Accounts**. The choice depends on one idea: which account of each pair stays
> in `users` and can sign in.
>
> **Today** (on `main` at `4e1c9b0`), `users` allows the same address twice, and
> sign-in uses the account created first (`auth/login.py`, line 88:
> `ORDER BY created_at LIMIT 1`). The query
> `SELECT email FROM users GROUP BY email HAVING count(*) = 2` returns 37 addresses. For
> example, `ana@example.com` belongs to account 1041 (created 2023-02-01, no projects)
> and to account 7730 (created 2025-06-14, 6 projects). Ana signs in to 1041 and sees
> none of her 6 projects.
>
> **Why now:** migration `0057_unique_email.sql` is the last step before release 2.4,
> and it stops at the first duplicate address.
>
> How should the migration handle the 37 pairs? Reply in this chat with a letter.
>
> - **(a) Archive the older account of each pair (recommended).**
>   - After: Ana signs in to 7730 and sees her 6 projects. Account 1041 moves to
>     `archived_users`, and the unique index is built.
>   - Cost: the data in the 37 older accounts is hidden until an administrator moves
>     an account back.
>   - Affects: the 37 people with a pair of accounts, and the support team, who
>     handle any request for old data.
>   - Undo: yes, one account at a time. An administrator first changes the email
>     address of the archived account, because the unique index rejects a second
>     account with the same address, then moves it back from **Admin > Accounts**.
> - **(b) Stop the migration until someone merges each pair by hand.**
>   - After: Ana keeps signing in to account 1041 until her pair is merged. The
>     `users` table is kept as it is today, and the index is not built.
>   - Cost: release 2.4 is delayed until all 37 pairs are merged. One person merges
>     37 pairs by hand. Until her pair is merged, Ana signs in to an account without
>     her 6 projects.
>   - Affects: everyone who waits for release 2.4, the 37 people with a pair of
>     accounts, and the person who merges.
>   - Undo: waiting changes no data. A finished merge cannot be reversed in the
>     application; only an operator can restore both accounts from the nightly backup,
>     within 30 days, and only after one of the two accounts gets a different email
>     address.
> - **(c) Delete the older account of each pair.**
>   - After: Ana signs in to 7730. Account 1041 and its data are gone, and the unique
>     index is built.
>   - Cost: the data in the 37 older accounts is lost.
>   - Affects: the 37 people with a pair of accounts, permanently.
>   - Undo: only from the nightly backup, by an operator, within 30 days, and only
>     after the restored account gets a different email address.
>
> I recommend (a): it keeps release 2.4 on schedule, and no data is lost, because an
> archived account can be moved back.

The deciding fact comes first, where the reader looks first, and splits into two
sentences. The term and the idea come next, before the case's ids, dates and counts. "Today" refers
to commit `4e1c9b0`, and the two claims in it link to their sources: a file and line,
and a query. One case (Ana's two accounts) appears under today and under each option.
Each option has the four lines (after, cost, affects, undo). The index is marked "built"
under (a) and (c), and the table "kept" under (b). The records are always called
"accounts", and the persons "people". Rules: 8, 12, 15, 16, § Decision requests.

## 3. A status report

**Before**

> I've been making good progress on the API work and have iterated on a few approaches.
> Things are mostly in place now, and I'll circle back on the remaining bits soon.

**After**

> On branch `feature/pagination`, at `4e1c9b0`:
>
> - Done: `GET /projects` and `GET /users` return `next_cursor`, with 18 new tests.
> - Left: `GET /audit-log`.
> - Blocked: none.

Rules: 15, 18, § What each kind of text needs (status report).

## 4. A chat reply to a question

**Before**

> Good catch! So, for some background, there are a few layers involved here and it
> depends on configuration, but generally speaking, in most setups, a logged-out user
> would not be able to get to that endpoint.

**After**

> No. A logged-out user gets `401` from `/admin/export`, because `require_session`
> runs before every route under `/admin`.

The answer is the first word; the evidence follows it. The check that blocks the
request replaces "in most setups". Rules: 16, 18, § What each kind of text needs (chat
or terminal reply).

## 5. A commit message

**Before**

```text
Huge refactor of config loading, way cleaner and faster now!!
```

**After**

```text
Read config from $XDG_CONFIG_HOME first

Users who keep dotfiles under $XDG_CONFIG_HOME had to symlink the
config file into their home directory. The loader reads
$XDG_CONFIG_HOME/tool/config.toml, and uses ~/.toolrc only when that
file is missing. Startup time is unchanged at 4 ms.
```

Rules: 15, 17, 18, § Length per kind of text.

## 6. A code comment

**Before**

```python
# set the timeout to 30
timeout = 30
```

**After**

```python
# The load balancer closes idle connections after 35 s. Keep this value
# below 35, or clients get connection resets instead of timeouts.
timeout = 30
```

The comment contains the limit that the code cannot show. Rules: § What each kind of
text needs (code comment).

## 7. An error returned by code

**Before**

```go
return errors.New("invalid configuration, please check your settings and try again")
```

**After**

```go
return fmt.Errorf(
    "set listen_port in %s to a number from 1024 to 65535; it is set to %q",
    path, raw,
)
```

The fix is at the start of the message, so it is still visible when a log viewer cuts
the line. The file and the bad value are in the message, and "try again" is gone,
because a retry with the same file fails the same way. Rules: § What each kind of text
needs (error message in code).

## 8. Pull request text

**Before**

> Fixed the bug. Cleaned up some stuff along the way and touched a few tests. Should be
> good to go!

**After**

> Uploading a file with a space in its name returned `400`, so users had to rename
> files before they uploaded them (#214).
>
> The upload handler decodes the file name before it validates it.
>
> Tests: a new test uploads `quarterly report.pdf` and checks for `201`.

The "before" has no problem, no change and no test that a reviewer can check. Rules:
16, 18, § What each kind of text needs (pull request description).

## 9. A brief for a subagent

**Before**

> Look into the flaky test we talked about and fix it if you can. Use your judgement.

**After**

> Goal: make `test_export_csv` in `tests/test_export.py` pass on every run. It fails on
> about 1 run in 10 in CI, and the release needs a green pipeline.
>
> Known so far: the failures all show rows in a different order. The export query in
> `app/export.py` has no `ORDER BY`.
>
> Limits: change only `app/export.py` and `tests/test_export.py`. Do not commit.
>
> Done means: the test passes 50 runs in a row with `pytest -x --count=50
> tests/test_export.py`.
>
> Return: the diff, the command you ran, and its last line of output.

Every fact that the subagent needs is in the brief, because the subagent has none of
the conversation. Rules: § Write for a cold reader, § What each kind of text needs
(brief for a subagent).

## 10. A paragraph of process jargon

**Before**

> To drive alignment across stakeholders, the platform team has operationalized a
> feedback loop that unlocks visibility into deployment health at scale.

**After**

> After each deploy, the deploy script posts the error rate for the next 15 minutes in
> the `#deploys` channel.

The "before" has 21 words and one claim. Replace the claim with the mechanism behind
it. Rules: 11, 12, 13.

## 11. Software as a person, and the vague "own"

**Before**

> The runner could not be asked whether the job finished, so the job kept its own cache
> on its own.

**After**

> The status check for job `lint-412` failed: the runner API returned `503` three times
> in 30 seconds. The cache in `/var/cache/lint-412/` stays on disk until the next run of
> `lint-412` deletes it.

The runner is not a person in a conversation: the check is the operation, and `503` is
its result. The path and the event replace each "own". Rules: 10, 13.

## 12. CLI output

**Before**

```text
==============================
  🚀 deploy-tool v2.4.1 🚀
==============================
Loading config... done!
Connecting... done!
Uploading files.........................
✨ All done! ✨
```

**After**

```text
$ deploy-tool push --env staging
uploaded 214 files (38 MB) to staging in 12 s
```

With `--verbose`, the progress lines go to stderr:

```text
$ deploy-tool push --env staging --verbose
reading deploy.toml
connecting to staging.example.net
uploading 214 files
uploaded 214 files (38 MB) to staging in 12 s
```

The banner, the emoji and the dots are gone, because a script that reads the output
would have to strip them. On success the tool prints one result line to stdout, so
`deploy-tool push ... | tee deploy.log` records only the result. The result line is
last, and it contains the counts and the target. With `--json`, the same result comes
as one JSON object. Rules: 15, 18, § What each kind of text needs (CLI output).

## 13. A question of fact

**Before**

> Quick question about staging, which option do you prefer? (a) before the import
> (b) after the import (recommended).

**After**

> Is the staging database a copy of production from before or after the customer import
> on 2026-10-01 (the job `import-customers` loaded 4,210 customer records)? The test plan
> in `docs/import-test.md` needs a copy from after the import, and I have no access to
> staging.
>
> To find out:
>
> 1. Run `psql staging -c "SELECT max(created_at) FROM imports"`.
> 2. If the result is 2026-10-01 or later, the copy is from after the import. If it is
>    earlier, the copy is from before the import.
>
> Reply in this chat with the date that the query returns.

A fact has one true answer, so the request has no options and no pick. The steps let
the reader find the answer and know what each result means. Rules: § Decision requests
(before you ask).
