---
name: reviewing-changes
description: Load before you review a change that a run made, in any round, and before you close a finding of such a review. Contains what a reviewer of a change may do, the order of a review, a finding with its proof and severity, the closure of a finding, the judgement of earlier closures, and the report.
---

# Reviewing changes

A change is all that a run changed in the work since the run started. You review the whole
change once per round, at the frozen state that the run passes you, and never one part of
it while the run still builds the rest. A finding of a change has the fields of a finding of
a draft, as the section "A finding" of ${qory:skills/reviewing-drafts} lists, with a proof
and a severity in place of the marks. Load `reviewing-drafts` and
${qory:skills/simple-communication} before you write a finding.

## What you may do

- Read the change, the words of the people who asked for the work, and any file of the work.
- Run checks, and read what they print.
- Plant a fault only in a copy of the work in a temporary folder.
- Change no file of the work, and start no agent. Your report is the only output of your
  review.

You start with no memory of other reviews. The run passes you paths and values, and never
the report of another reviewer.

## The order of a review

1. Read the words of the people who asked for the work, as the run passes them.
2. In a round after the first, read the findings file, `findings.json`, whose path the run
   passes you. It lists each earlier finding, its state, and how it was closed. Judge each
   closure that the section "Earlier findings" asks you to judge.
3. Read the whole change at the frozen state, then what the section on review of the skill
   you review against lists.
4. Before you write a finding, repeat its proof. A problem that you cannot prove goes under
   "Unverified:".

## A finding

Each finding contains Quote, Problem, Fix and Point, as the section "A finding" of
`reviewing-drafts` lists, and these two fields in place of Marks:

- Proof: the form of the proof, a colon, and the steps that repeat the problem, on one line
  of at most 1,000 characters. "The proof" lists the forms.
- Severity: `break` or `no break`, as "Severity" lists.

Write no id: the run adds an id to each finding, such as `f4`, when it records your report.

## Severity

- `break`: the change does not do what the people asked for, or breaks what worked before,
  and a proof of the form `failing check`, `planted fault` or `failing input` shows it. A
  break blocks the change: only a break finding starts another round.
- `no break`: every other finding. It starts no round.

When none of those three forms proves the problem, the finding is `no break`, or the claim
goes under "Unverified:". Your judgement alone makes no break.

## The proof

A proof starts with one of these forms, a colon and a space, then the steps:

- `failing check`: a check that fails on the change. Name the check, how to run it, and what
  it prints.
- `planted fault`: a fault that you planted in a copy of the work, which the checks of the
  change do not catch. Name the fault, where you planted it, and the checks that still pass.
- `failing input`: an input that gives a wrong result. Name the input, the step that takes
  it, the result it gives, and the result that the people asked for.
- `broken rule`: only for `no break`. Name the rule, where it is written, and the lines
  that break it.

The skill you review against may list these forms in the words of its kind of work.

## A closure

The agent that fixes a finding closes it with a closing proof, one item per finding under
"Closed:" in its report: `- <id>: <closing proof>`, such as
`- f4: passing check: the check of refunds passes when you run it on the fix.` The
closing form matches the form of the proof:

| Proof | Closing proof |
|---|---|
| `failing check` | `passing check`: the same check passes on the fix |
| `planted fault` | `caught fault`: the checks fail on the same planted fault |
| `failing input` | `passing input`: the same input gives the result that was asked for |
| `broken rule` | `kept rule`: the lines keep the rule |

A finding with no closing proof stays open.

## Earlier findings

In `findings.json`, each finding has `state`, `open` or `closed`, and a closed finding has
`closure`, with its closing proof. A closure that no review judged has `closure.held` set
to null. Write one item under "Earlier findings:" for each such closure of a finding that
you made, after you repeat its closing proof and its proof:

- `- <id>: holds` when the closing proof holds and the proof no longer shows the problem.
- `- <id>: open: <proof>` when the problem is still there, with a proof in the forms of
  "The proof".

You may judge the closure of a finding that another reviewer made in the same way. Write no
new finding on a problem that an earlier finding states: judge that finding, or leave an
open one as it is.

## The report

Report as text, in this shape:

```text
What you read:
- <path>
- Could not read <path>: <why>

Earlier findings:
- <id>: holds
- <id>: open: <proof>

Findings:
1. Quote: "<the words or lines that the finding rests on>"
   Problem: <what the change breaks or lacks, and how>
   Fix: <what must hold>
   Proof: <failing check, planted fault, failing input or broken rule>: <the steps>
   Severity: <break or no break>
   Point: <one sentence that a member reads when the finding is left>

Unverified:
- <the claim>: <why you could not prove it>

Blocked: <the path or skill, and why>
<clean, changes-needed or blocked>
```

The last line is one word:

- `clean`: you finished the review with no finding, and each closure that you judged
  holds. Leave out "Findings:". Invent no finding.
- `changes-needed`: you finished the review with at least one finding, or with an earlier
  finding that is open again. With no new finding, write "Findings:" with the item
  `- none`.
- `blocked`: you stopped before the end of the review. Only this result has the "Blocked:"
  line.

Only a round after the first has "Earlier findings:". Leave out "Unverified:" when it has no
item. Put any other line, such as a list of sources, before the last line.
