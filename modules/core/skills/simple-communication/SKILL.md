---
name: simple-communication
description: Load before you write any text a person reads, such as a chat reply, a status report, a decision request, a commit message, a code comment, a pull request description, documentation, UI text, CLI output or an error message. Contains the order of work, the sentence rules, what each kind of text must contain, and a yes-or-no check to run before you send.
---

# Simple communication

## First principle

Write as little as the reader can act on, and never less.

Your reader has little time and will not read a long text to the end. Each sentence
has to justify its place: if the reader can understand and act without it, delete it.
Keep every fact and every piece of context that the reader needs to understand and
act. If the reader has to come back with a question, the text was too short.

The reader is competent. English may be their second language, and they often arrive
without the context you have. The other rules in this skill are ways to meet this
principle.

Two words have one meaning each in this skill. The **surface** is where the text is
read: a terminal, a chat, a commit log, a pull request, a source file, a docs page, a
screen in the product. The **kind of text** is what the text is: a status report, a
commit message, CLI output, an error message, and the other kinds in § What each kind
of text needs.

## How to write any text

Work through these five steps in order.

1. **Decide the reader, the surface and the kind of text.** Who reads the text, what do
   they already know, and where do they read it? If the reader lacks your context,
   apply § Write for a cold reader. Find the ceiling in § Length per kind of text.
2. **Write the point first.** Answer the two questions in § The two questions. If the
   reader must act, the action is the first sentence. If the action makes no sense
   without its cause, one sentence of cause may come before it. A decision request is
   the exception: it follows the order in § Decision requests, with the deciding fact
   first and the question after the terms and today.
3. **Apply the sentence rules** in § Sentence rules.
4. **Trim by the first principle.** Delete anything already in front of the reader,
   every word that the rules flag, and every second statement of a claim. Do not cut a
   field, link or status marker that the project requires, or a fact or piece of
   context that the reader needs to act.
5. **Run the self-check** in § Self-check, then compare the text with the entry for its
   kind in § What each kind of text needs.

## The two questions

Make every text for a person answer two questions:

1. **What happened?** Name the exact cause in plain words. A code by itself is not a
   cause.
2. **What do I do?** One step the reader can do with what is in front of them: the
   file to edit, the command to run, the button to click. If there is nothing to do,
   write that in one clause: "No action needed."

If you do not know the cause, write what you checked and what is still unknown. A
pointer to a log is not a cause.

- **Before:** "Job failed (exit 1). See logs for details."
- **After:** "Run `make migrate`, then push again. The test database has no `orders`
  table, because the migration `0042_orders.sql` did not run in CI."

## Write for a cold reader

A cold reader was not there when you did the work: a reviewer a month later, an on-call
engineer at 03:00, a subagent with an empty context, a user who arrives from a search.
For a cold reader:

- State the goal in one sentence before any detail.
- Write the full path, command, branch or commit. "The file" and "the fix from earlier"
  point at nothing.
- Define each term that the reader may not know where it first appears, or link to a
  definition.
- Do not write "above", "below", "earlier" or "as discussed". Restate the fact or link
  to it.
- Link only to pages the reader can open. For a private dashboard, an internal run id or
  a path on your machine, write in words what it shows.
- Make the reader's change, branch or request the grammatical subject, not an internal
  component that they have never heard of.

## Sentence rules

Each rule is one habit to apply while you write. Longer before-and-after examples are in
[the examples file](references/examples.md), and word swaps are in [the word
list](references/word-list.md).

### Build the sentence

1. **You, active, present.** Write in the second person, active voice and present
   tense, with the actor as the subject. Usually the actor is the reader. "The cache
   directory should be cleared by an operator before an upgrade is attempted" becomes
   "Clear `/var/cache/app` before you upgrade."
2. **Condition before instruction.** "If the health check fails twice, roll back the
   release." The reader learns whether the step applies before reading the step.
3. **One sentence, one idea; conclusion first.** Reasons follow the conclusion. A
   sentence over 25 words usually contains two ideas; split it.
4. **Subject and verb near the front.** Start no heading or instruction with an -ing
   form: "Configure the proxy", not "Configuring the proxy".
5. **Each modifier next to the word it changes.** "Deploy only the API service" and
   "Only deploy the API service" mean different things.
6. **Different openers.** If three sentences in a row start with the same words, merge
   them into one sentence or a list.

### Name things exactly

7. **A noun, not a pronoun for an idea.** When `this`, `it` or `that` could point to
   more than one noun, write the noun again. Repeating a noun is correct in technical
   text.
8. **One word for one thing, one thing for one word.** If it is a "job" in the first
   line, it stays a "job", never a "task" or a "run" later. If "build" means compiling,
   do not use "build" for the CI pipeline in the same text.
9. **No bare id or code.** Write what `ERR_TIMEOUT` means and put the code after it in
   parentheses: "the request timed out after 30 s (`ERR_TIMEOUT`)". Leave an id bare
   only when its list is visible beside it.
10. **No vague "own".** Never write the possessive "own": "the reader's own", "its
    own", "of its own", "on its own", "their own copy". Name the thing as it is:
    - "The job writes to its own directory" becomes "The job writes to `build/out/`,
      which no other job writes to."
    - "the user's own settings" becomes "the settings in `~/.config/tool/config.toml`".
    - "The service restarts on its own" becomes "The service restarts without a
      command from you."

    "Own" as a verb is fine: "the repositories you own".
11. **Plain verbs and plain words.** "You approve it", not "approval is granted"; "use",
    not "leverage"; "start", not "initiate".
12. **The jargon test.** For each specialized term, ask in order: can you avoid it with
    a plain phrase; can a more specific word replace it; if you use it once, can you
    define it in parentheses; if you use it throughout, did you define it once and keep
    it? A name that you coin for a place, a state or a part is a term too: define it.
    Keep the domain terms that the reader needs (`cron`, `migration`, `merge base`).
    Delete process jargon such as "surface the delta" or "the decision model".

### Say only what the reader can check

13. **Software is not a person.** Use no metaphor, idiom or human act for software.
    - **No thinking.** A program does not want, think, see, decide, know or refuse.
    - **No conversation.** Do not write that software "was asked", "could not be
      asked", "answers", "replied" or "refused", as if it took part in a talk. Name the
      operation that failed and its result. "Docker could not be asked whether the
      build container is still running" becomes "The check for the build container's
      state failed: the call to the Docker daemon timed out after 5 seconds."
    - **The verb test.** When the subject is a record, script, file, option or decision
      and the verb is something a person does (waits, climbs, asks, hides), swap it for
      what the code does: runs, reads, writes, returns, calls, exits, links to.
14. **Data does not speak.** When the subject is a document, a UI element, a record,
    code or data, do not use name, carry, hold, tell, say, give or own as its verb. Say
    instead what the thing has, contains, is, shows, links to or is set to. "The row
    contains the user id", not "the row names the user". "The `expires_at` field is set
    to 2026-12-31", not "the field holds the expiry date". The rule covers only those
    subjects. A person may use all seven verbs ("you own the repository"). A program
    that writes output may use them too ("`git status` tells you which files
    changed").
15. **Numbers, not adverbs.** "The page loads in 0.3 s, down from 2.1 s", not "the page
    is much faster". Replace words that age (currently, new, latest, soon) with a
    version, a date, or nothing. Name the moment that "today", "now" or "before"
    refers to: a date, a release or a commit. If you have no number, name the
    measurement that you lack.
16. **Hedge only with information.** "Untested on PostgreSQL 13" shows the reader where
    the risk is; "should mostly work" does not. Do not claim that software always or
    never does something unless you can show the evidence; scope the claim instead. In
    an instruction to a person, "always" and "never" are fine. Give each claim a source
    that the reader can open (a file and line, a log, an issue), and claim no more than
    that source shows.
17. **No feeling words.** Delete robust, seamless, powerful, elegant, dramatic and
    genuinely, then reread the sentence. If the sentence means the same, leave the word
    out. Write "silently" only in its exact sense: the code failed without any error or
    log line.

### Cut

18. **No filler, flattery or shouting.** Delete just, obviously, simply, easy, please
    note, I think, great question, "please" in an instruction, and exclamation marks.
    Do not write imperatives in capitals or bold half of a sentence.
19. **Say it once.** Repeating a claim for emphasis adds nothing, and the reader must
    then compare two wordings.
20. **No shapes that try to sound important.** One habit produces all of them, and one
    repair removes them: state the fact, once.
    - The negation setup: "It's not a network issue. It's DNS." becomes "DNS lookups
      fail." Keep a negation only to correct something the reader believes.
    - The fragment for weight: "One table. That's all." becomes "One table is affected."
    - The rhetorical question: "So why does this matter?" becomes the reason itself.
    - The announcement: "The impact is significant." becomes the consequence: "Every
      signup since 09:00 has failed."

## Length per kind of text

These are ceilings, not targets. Match the length to the work: a fix of one line needs a
report of one line. When the reader needs more, move the extra detail into a collapsed
block (`<details>` on GitHub), a linked page or an appendix. Keep the point and the
action in the visible text. Never cut a fact that a decision depends on to meet a
ceiling.

| Kind of text | Ceiling | Order |
|---|---|---|
| Chat or terminal reply | 5 sentences for a question | answer, then evidence |
| Update while you work | 1 sentence | the event |
| Status report | 150 words | done, left, blocked |
| Decision request | 200 words before the first option | deciding fact, terms and idea, today, why now, question, options, reason |
| Commit message | subject 50 characters (72 at most), body lines 72 characters | change, then why |
| Code comment | 3 lines, unless it documents a contract | the fact that the code cannot show |
| CLI output | 1 line per event; on success, 1 result line by default | progress, then the result last |
| Error message in code | first line 100 characters, and that line contains the fix | fix, cause, value |
| Pull request description | 200 words of visible prose | problem, change, tests |
| Brief for a subagent | 100 to 400 words is typical; as long as the task needs | goal, context, limits, done |
| Documentation | one task or one concept per page or section | goal, steps, result |
| Design document or requirement | 1,500 words; split a larger design into parts | problem, cost, design |
| UI text | 3 words on a button, 2 sentences in a message | action, then result |

## Send only what someone needs

- Send a message for one of these reasons: the reader must act, a result is ready to
  read, or you decided or refused something that the reader must know. Do not send a
  message that only reports progress.
- State a status that is true when the reader reads it. Right after a push, write "CI
  is running on `a1b2c3d`", not "ready to merge".
- In a written report, write in the first person, as one colleague writes to another:
  "I fixed the failing test."

## Decision requests

Recommend an option in every decision. You have read the code and the logs, and the
reader has not. Without your pick, the reader has to repeat your analysis with less
information.

**Before you ask**

- **Decide what you can.** If a choice has a common default, if you can find the
  answer by reading the code, or if one option costs nothing, choose it and mention the
  choice.
- **One decision per request.** If the reader must make two choices, send two
  requests.
- **When you need a fact, not a choice, offer no options and no recommendation.** A fact
  is, for example, the meaning of a setting or the intent behind a request. List the
  steps to get the answer: what to open or run, and what each possible result means.

**Write the request in this order**

1. **The deciding fact.** The one fact on which the choice depends, in the first
   sentence, because the reader reads that sentence first. If the deciding fact uses a
   term, define it there in parentheses (rule 12).
2. **Terms and the idea.** Give a definition for each other term ahead of the place
   where you first use it, including names that you coin. Then state in plain words the
   idea on which the choice depends. The ids, dates and counts of the case come after
   the idea.
3. **Today.** How it works today, at a named moment ("on `main` at `4e1c9b0`"). Follow
   one real case, with values small enough to check by hand.
4. **Why now.** One sentence on why the question comes up at this point.
5. **The question and the way to reply.** One question. Name the action that triggers
   the next step: a reply in this chat, a comment on the pull request, a button on a
   page. Offer only a mechanism that works.
6. **The options.** At most three, labelled (a), (b), (c), with your pick in first
   place, marked "(recommended)"; in a tool with answer buttons, "(Recommended)". Skip
   any "There are three options" preamble, and never present options as a table. Give
   each option four lines:
   - **After:** what changes, shown on the case from step 3.
   - **Cost:** every loss that comes with this option.
   - **Affects:** the people for whom the result changes, now and later.
   - **Undo:** whether a reversal is possible, the steps, and the person or team that
     takes them.

   Mark each part "built" when the option adds it, and "kept" when it exists today.
7. **The reason.** Why you picked your option, in at most two plain sentences about
   cost.

**Throughout:** give each claim a source that the reader can open (rule 16). For a
change to a screen, show a picture of the screen today and after the change. Never set a
default for silence: do not describe what happens when nobody replies, because nothing
proceeds until someone replies.

A full worked request is in [the examples file](references/examples.md), section 2,
and a question of fact is in section 13.

## What each kind of text needs

The sentence rules apply to every kind of text. What changes is what must stay after
you trim. The entries follow the order of the table in § Length per kind of text.

- **Chat or terminal reply.** The answer is the first sentence; evidence follows. When
  you correct something that you said earlier, state the correction without apology or
  a story of the mistake. For several facts, use a `label: value` block.
- **Update while you work.** One sentence, and only for a result, a new plan or a
  blocker. Do not narrate routine steps.
- **Status report.** Three parts: done, left, blocked. Use counts ("2 of 3 endpoints
  return the new field") and name the commit, branch or build that the status applies
  to.
- **Decision request.** The checklist in § Decision requests: deciding fact, terms
  and the idea, today, why now, the question and the way to reply, the options with
  their four lines (after, cost, affects, undo), then the reason.
- **Commit message.** A subject in the imperative mood that states the change: "Read
  config from `$XDG_CONFIG_HOME` first". A body with why the change was needed and what
  it changes for a user. Leave out words that praise the change, such as "clean" or
  "better".
- **Code comment.** Write only what a reader cannot learn from the code: a limit, an
  assumption, or why the code takes this approach. When a comment only restates the next
  statement, it is wrong as soon as that statement changes.
- **CLI output.** The text that a program prints to a terminal: progress lines,
  results, warnings and errors. One line per event. Results go to stdout; progress,
  warnings and diagnostics go to stderr, so a pipe receives only the result. Put the
  result line last, where the reader looks when the prompt returns. On success, print
  only the result by default, and offer a flag such as `--verbose` for more. Offer
  machine-readable output behind a flag such as `--json`. Print no banners, decoration
  or emoji that a script would have to strip, and never use colour as the only signal:
  pair red with the word `error`. For an error line, follow the entry "Error message in
  code".
- **Error message in code.** Start with the fix, then the cause, then the bad value:
  "Set `DATABASE_URL` in `.env`. The server cannot start without a database address."
  Log viewers, toasts and CI summaries often cut a message after its first line. Write
  "try again" only if a retry can succeed. Text that a script prints on every run
  deserves extra care, because every run repeats any error in it.
- **Pull request description.** The problem as a user meets it, what the change does
  about it, and how you tested it. Link the issue and do not restate it. Keep every
  field that the template requires.
- **Brief for a subagent.** The subagent is a cold reader with no memory of the
  conversation. Give the goal and the reason for it; the files, paths and commands; the
  rules and limits that apply, including what not to touch; what "done" means; and what
  to return. Write the facts into the brief instead of "use the context".
- **Documentation.** One task or one concept per page or section. Numbered steps for a
  procedure, each condition before its step. Each rule includes what the reader sees
  when they break it: "Use Python 3.12 for the test suite. Under Python 3.11 the async
  tests fail with `TypeError`." Describe what the software does today; plans go in a
  separate document.
- **Design document or requirement.** Write each requirement so that a reviewer could
  argue against it: include what the problem costs and the reason for this design.
- **UI text.** Use the same words as the documentation. Label a button with the action
  that runs when the reader clicks it: **Delete branch**, not **OK**. In an empty state
  or a confirmation, answer the two questions too.

## Formatting

- Code font for anything the reader types or a program prints: commands, flags, paths,
  field names and values.
- Bold for a button, tab or menu item the reader clicks, with `>` between menu levels:
  **Settings > Tokens**.
- Put each link on the words for its target.
- Link text that describes the destination. Never "here", "this link" or a bare URL.
- Numbered lists for steps in order, bulleted lists for the rest, with each item in the
  same grammatical form.
- A table when you compare two or more items on two or more attributes. A list when each
  item has one attribute. No table with one column.
- Sentence case in headings. No headings in a message shorter than 150 words.
- Dates as `2026-10-18`, versions as exact numbers.
- A serial comma in a list of three or more.
- No fact that exists only in an image: an image does not translate, and a screen
  reader cannot read it.

## When a draft reads as machine-written

Give yourself, or the writer, one instruction: "Rewrite this plainly. Facts only." Most
of the shapes in rule 20 appear because the writer wants the text to impress, and the
instruction removes that aim. A plain rewrite tends to lose formatting and required
fields, so add them back, then run § Self-check.

## Precedence

A project's rules and word list come before this skill. Never remove a field, link or
marker that a project requires. If following a project
rule makes the text fail § Self-check, report the conflict to the maintainer of that
rule.

## Self-check

Answer each question for the draft. Every "no" is a defect to fix before you send.

**The first principle**

1. Can the reader act on the text without asking a question back, and does every
   sentence justify its place (§ First principle)?

**The point**

2. If the reader must act, is the first sentence the action, or one sentence of cause
   and then the action? Otherwise, is the first sentence the answer or what happened?
   (A decision request follows § Decision requests instead: the deciding fact first.)
3. Does the reader learn what to do next, or that nothing is needed?
4. If there is an action, is there exactly one, does it come first or right after one
   sentence of cause, and does the reader have access to everything the action needs?
   (In a decision request, the question comes after the terms, today and why now.)
5. If there are options, are they lettered, with the pick in first place with its mark,
   and a reason of at most two sentences about cost?
6. If the text asks for a decision: is the deciding fact first, then the terms and
   the idea, then today at a named moment, then why now in one sentence? Is there one
   decision, and does each option have the four lines (after, cost, affects, undo),
   shown on one case?
7. If the text asks about a fact: are there steps to get the answer, and no pick?
8. If the reader must reply, does the text include how to reply, through a mechanism
   that works?

**The reader**

9. Could someone who was not there act on the text: full paths and commits, terms
   defined, no "above", "earlier" or "as discussed"?
10. Can the reader open every link, and is every id or code spelled out?
11. Is every status true at the moment the reader reads it?
12. Is the text within the ceiling for its kind, with no required field, link or
    decision fact removed?

**The words**

13. Is every verb literal: no metaphor, and no software that thinks, is asked, answers,
    replies or refuses? When the subject is a document, a UI element, a record, code
    or data, is the verb something other than name, carry, hold, tell, say, give or
    own? (A person or a program that writes output may use those verbs.)
14. Is every possessive "own" gone ("its own", "of its own", "on its own", "the
    reader's own", "their own copy"), with the thing named instead?
15. Is each thing called by one word, and each word used for one thing?
16. Does every `this`, `it` and `that` point to exactly one noun?
17. Are amounts numbers, times dates or versions, and the moment of every "today", "now"
    or "before" named?
18. Is the text free of filler, flattery, feeling words, "please" in instructions,
    exclamation marks, and capitals or bold used for emphasis?
19. Is every hedge a named unknown, every "always" or "never" about software backed by
    evidence, and every claim no wider than a source that the reader can open?
20. Are inflated words, abstract nouns and excluding terms replaced, as listed in
    [the word list](references/word-list.md)?

**The sentences**

21. Is each sentence one idea, in the second person, active voice and present tense?
22. Are the subject and verb near the front, with no heading or instruction that opens
    with an -ing form?
23. Does each condition come before its instruction, and each modifier sit next to its
    word?
24. Is each claim made once?
25. Is the text free of negation setups, fragments for weight, rhetorical questions,
    announcements of importance and three sentences with the same opener?

**The kind of text**

26. Does the text meet the entry for its kind in § What each kind of text needs?
27. Read aloud, does every sentence read without a stumble?

