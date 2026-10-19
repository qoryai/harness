# Word list

Open this file when you check the words in a draft (self-check questions 13, 14 and 17
to 20 in [the skill](../SKILL.md)). Each table has the word to avoid on the left and the
replacement on the right. A project's word list comes before this file.

## Delete

Each of these words can go without a change in meaning.

| Avoid | Reason |
|---|---|
| just, simply, really, basically, very, actually, essentially | Filler or an intensifier with no content. |
| easy, easily, simple, straightforward, obviously, clearly, of course, naturally | The writer cannot know how hard the task is for this reader. If it is hard for them, the word reads as blame. |
| note that, it's important to note, please note, keep in mind, it's worth noting | An announcement in place of the fact. Write the fact. |
| please, in an instruction | An instruction is not a favour. Keep "please" for a real request. |
| honestly, to be fair, frankly, to be honest | Claiming honesty here suggests its absence elsewhere. |
| you're absolutely right, great question, happy to help | Flattery. Start with the answer. |
| I think, I believe, we believe, in my opinion | Either state what you checked, or name what you do not know. |
| fwiw, imho, ymmv, tl;dr | Chat abbreviations that a second-language reader may not know. |
| ! | Technical text does not use exclamation marks. |

## Openers that announce a point

Delete the opener; the sentence after it is the point.

| Avoid | Write instead |
|---|---|
| here's the thing, here's why, here's what happened | the next sentence, without the opener |
| let me walk you through, let me explain | the first step |
| the truth is, let me be clear, it turns out | the claim |
| make no mistake, let that sink in, when all is said and done | the claim, with no emphasis |
| think about it, you already know this, plot twist | the point |
| the next section explains, as you will see, this page covers | nothing; start the section |
| the stakes are high, this matters a lot, the impact is significant | the consequence, in numbers |

## Plain words

| Avoid | Write |
|---|---|
| utilize, leverage | use; or the exact verb, such as "build on" |
| prior to | before |
| facilitate | help, let |
| in the event that | if |
| initiate, commence | start |
| has the ability to, is able to | can |
| terminate, abort, kill (a process) | stop, end, cancel, exit |
| subsequent to | after |
| execute | run |
| regarding, with regard to | about |
| in order to | to |
| allows you to | lets you |
| it is required that, it is necessary that | must |
| a number of, various | the number, or the list |
| via | through, with, by |
| impact (verb) | affect |
| comprise | contain, include, consist of |
| key (meaning important) | the reason it matters, or nothing |
| performant | the property: fast, low-latency, small in memory |
| desired | wanted, required |
| actionable | concrete; or name the action |
| learnings | what we learned |
| native (feature) | included, built in |
| etc., e.g., i.e. | and so on, for example, that is |

## Verbs hidden in nouns

Turn the noun back into a verb, and name who acts. Plain words win even when they
are longer.

| Avoid | Write |
|---|---|
| approval was granted | you approved it |
| make a determination | decide |
| perform a validation of | check, validate |
| the implementation of the change | the change |
| provide assistance | help |
| reconciliation | comparing A with B to confirm they still agree |
| descoped | not part of this change |
| non-goals | what this change will not do |
| disposition | what I decided |

## Metaphor, idiom and process jargon

| Avoid | Write |
|---|---|
| blast radius | the affected services, users or files |
| under the hood | inside the code |
| off the shelf, out of the box | built in, ready-made |
| circle back, revisit later | the date, or the condition for the next step |
| deep dive | what you examined, by name |
| move the needle, game-changer | what changes, in numbers |
| low-hanging fruit | the cheapest fix |
| on the same page | agreement on X; name X |
| unpack | explain |
| lean into, double down | do more of |
| moving forward, going forward | next; or the date |
| source of truth | the primary record |
| first-class | supported directly |
| break-glass | emergency access |
| ingest | import, load |
| post-mortem | incident review |
| surface the delta | list the differences |
| the pipeline, the gate, the orchestrator (as the subject) | the change, the branch, or the reader, with what happens to it |

## Verbs for software and data

Software does not want, think, see, decide, know, refuse or feel, and it takes no part
in a conversation: nobody asks it anything, and it does not answer or reply.

When the subject is a document, a UI element, a record, code or data, do not use name,
carry, hold, tell, say, give or own as its verb. Write the operation, or what the thing
has, contains, is, shows, links to or is set to. The ban covers only those subjects: a
person may use all seven verbs ("you own the repository"). A program that writes
output may use them too ("`git status` tells you which files changed").

Never use the possessive "own" ("its own", "of its own", "on its own").

| Avoid | Write |
|---|---|
| the server sees the header | the server reads the header |
| the parser wants a closing brace | the parser requires a closing brace |
| the job knows that it failed | the job stores the exit status |
| Docker could not be asked whether the build container is still running | the check for the build container's state failed: the call to the Docker daemon timed out after 5 seconds |
| the registry answered that the image is missing | the registry returned `404` for the image `app:2.4.1` |
| the database refused the connection | the connection to the database failed with `password authentication failed` |
| the scheduler decided to skip it | the scheduler skipped it, because … |
| the linter refused the change | the change fails the lint check, because … |
| the script walks up to the repository root | the script reads the repository root from `git rev-parse --show-toplevel` |
| a request waits for the lock | a request blocks until the lock is released |
| the table names the owner | the table contains the owner's user id |
| the config holds the port | the port is set to `8080` in the config |
| the record carries a deadline | the record has a deadline |
| the trace tells you where the time went | the trace shows the time spent in each call |
| the lockfile says which version to install | the lockfile lists version `4.2.0` |
| the token gives the tenant | the token contains the tenant id |
| the exit code says that the tests passed | the exit code is `0`, so the tests passed |
| the job writes to its own directory | the job writes to `build/out/`, which no other job writes to |
| the user's own settings | the settings in `~/.config/tool/config.toml` |
| the service restarts on its own | the service restarts without a command from you |
| their own copy of the file | the copy of the file in the branch |

## Words that age

These words stop being true after the day you write them. Write the fact behind each one.

| Avoid | Write |
|---|---|
| currently, at the moment, presently | nothing; the present tense is enough |
| new, brand-new | the release or date it arrived in |
| latest, newest | the number of that version |
| old, outdated | the version that replaced it |
| soon, shortly | a date, or no promise |
| recently, lately | the exact date |
| eventually, someday | the event that must come first, or delete it |
| at the time of writing | nothing |
| now supports | supports |
| higher, lower (version) | later, earlier |

## Claims nobody can check

| Avoid | Write |
|---|---|
| fastest, best, simplest | the measurement: "imports 1 GB in 40 s; version 2.3 took 6 min" |
| robust, powerful, seamless, effortless, elegant | what it does: "keeps serving reads when 1 of 3 replicas is down" |
| guarantees, ensures, prevents (said of a security control) | helps prevent; and name the control |
| X % faster, with nothing linked | the number, what was measured, on which machine, and a link to the run |
| the queue never loses a message | the queue stores a message until a consumer acknowledges it |
| better than tool Y | what this tool does |

"Always" and "never" are fine in an instruction to a person ("never commit a secret").
They are a defect in a claim about what software does, because a single
counter-example is enough to falsify it.

## Terms that exclude

Replace these every time, in prose and in identifiers you add: branch names, variables,
test names, comments. No sentence needs the word on the left. Renaming an existing
identifier, such as a database column, is a separate change, reviewed separately; do
not slip it into an unrelated diff.

| Replace | With |
|---|---|
| "whitelist", "blacklist" (noun) | allowlist, denylist |
| "whitelist", "blacklist" (verb) | allow, deny, or a sentence that lists which items are allowed |
| "graylist" | provisional list |
| "master" (a branch, a node, a copy) | main, primary, controller, parent |
| "master" and "slave" | primary and replica |
| "sanity check" | quick check, validation |
| "dummy" value | placeholder |
| "grandfathered" | exempt |
| "crippled", "lame", "gimpy" | limited, broken, or what is wrong |
| "turn a blind eye", "blind to" | ignore, unaware of |
| "man-hours", "manpower" | person-hours, staff |
| "manned", "unmanned" | staffed, uncrewed |
| "man-made" | artificial, synthetic |
| "you guys", "guys" | everyone, all of you |
| "he" for any person | they |
| "ghetto" (makeshift) | makeshift, a workaround |
| "gypsy" | Romani, Roma |
| "gypped" | cheated |
| "ninja", "rockstar", "guru" | expert |
| "dojo" | workshop |
| "brown bag" | lunch session |
| "man-in-the-middle" attack | attack by an on-path attacker |
| "DMZ", "demilitarized zone" | perimeter network |
| "native" (of people) | who you mean |
| "mom test", "girlfriend test" | first-time user test |
| "abnormal", "deficient", "deformed" (said of a person) | a description of the difference, said of the thing and not the person |
| "gray-box" (testing) | "translucent-box" |

## Constructions that translate badly

- **Phrasal verbs.** "Carry out" becomes "run", "hold off" becomes "delay", "take down"
  becomes "stop". "Set up", "log in" and "sign in" are fine.
- **Noun stacks.** Use at most two nouns in front of a noun. "Deployment rollback
  approval request queue" becomes "the queue of requests to approve a rollback".
- **Dropped "that".** "Check that the port is free", not "check the port is free".
  "The rules that you wrote", not "the rules you wrote".
- **Conjunctions with two meanings.** Write "because", not "as" or "since"; "although",
  not "while"; "after", not "once"; "whether", not "if", when there are alternatives.
- **Idioms and culture.** Sports, war, holidays, seasons and local quarters ("the
  summer release", "Q3 push") mean different things to different readers. Write the
  date.
- **Dates.** `03/04` is March 4 in one country and 3 April in another. Use `2026-03-04`.

## Spelling

Pick one spelling per term and keep it in the whole text, for example "frontend",
"backend", "file system", "time zone", "lifecycle", "inline", "plain text". Use "log
in" and "sign in" as verbs, "login" and "sign-in" as nouns.

## Keep

A term from the reader's field is not jargon: `cron`, `migration`, `merge base`,
`replica`, `idempotent`. Use these, with a short definition the first time, if the
reader may be new to them.
