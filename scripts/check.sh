#!/bin/sh
# Checks that qory reads this repository and composes the core, software and authoring
# stacks, and that the agents and skills follow the rules that docs/modules.md lists in
# the section "What the script checks".
#
# Usage: scripts/check.sh
# Set `QORY` to the qory binary to run; the default is `qory`.
#
# Every compose runs with --dry-run, except the ones that write the settings and hook files
# of the core and software stacks into temporary checkouts. So the script writes only to a
# temporary directory, and the script removes that directory on exit.
set -u

QORY=${QORY:-qory}
ENTRY=skills/simple-communication
VISUALS_ENTRY=skills/visuals
SOFTWARE_ENTRY=skills/workflow-explore-a-ticket
# The other entries that every compose of the core stack lists.
CORE_ENTRIES="hooks/end-gate.cjs hooks/reports-guard.cjs hooks/tool-guard.cjs skills/run-artifacts skills/running-a-workflow skills/reading-the-work skills/artifact-text skills/writing-questions skills/checking-questions skills/replying-to-comments skills/reviewing-drafts agents/questions-writer agents/questions-reviewer agents/reply-writer"
# The other entries that only a compose of the software stack lists.
SOFTWARE_ENTRIES="skills/writing-proposals skills/checking-proposals skills/exploring-code agents/code-explorer agents/proposal-writer agents/proposal-reviewer skills/workflow-write-specs skills/running-a-software-workflow skills/running-checks skills/writing-specs skills/checking-specs agents/spec-writer agents/spec-reviewer skills/workflow-write-technical-decisions skills/writing-decisions skills/checking-decisions agents/decision-writer agents/decision-reviewer skills/workflow-make-mockups skills/designing-mockups skills/checking-mockups agents/designer agents/mockup-reviewer skills/workflow-write-demo-scenarios skills/writing-demo-scenarios skills/checking-demo-scenarios agents/scenario-writer agents/scenario-reviewer skills/workflow-shape-a-ticket skills/planning-shape skills/checking-shape agents/shape-planner agents/shape-reviewer"
# The entries that only a compose of the authoring stack lists.
AUTHORING_ENTRIES="skills/writing-agents skills/writing-skills agents/harness-reviewer"
# Rule 5: PRD, matched by case, and in any case: whitelist, blacklist, graylist, greylist,
# master, slave, sanity check, sanity-check, dummy, grandfathered, crippled, lame, gimpy.
# The three lists also match with a hyphen, and with -s, -ed or -ing. master, slave and
# sanity check also match with -s, and dummy as dummies.
BANNED_CASED='(^|[^[:alnum:]_])PRD([^[:alnum:]_]|$)'
BANNED_ANY_CASE='(^|[^[:alnum:]_])(white-?list(s|ed|ing)?|black-?list(s|ed|ing)?|gr[ae]y-?list(s|ed|ing)?|masters?|slaves?|sanity[ -]checks?|dumm(y|ies)|grandfathered|crippled|lame|gimpy)([^[:alnum:]_]|$)'
# Rule 11: the words of software work, which a file of modules/core contains in no case, as
# whole words. A part goes into the lowest module whose words it needs, and core is for every
# kind of workspace: customer care, marketing or software. Each word, with
# its forms, and the reason that it is software work:
# - software, also in software-factory: the name of the kind of work and of its module.
# - repository, repositories, repo, repos: where code lives; a target elsewhere is a place
#   in another system.
# - git, GitHub: the version control tool and a code forge. `.git`, with the dot directly
#   before it, is no such word: the end check stops its walk up at the folder with `.git`,
#   where qory keeps the artifact store, and checking-questions leaves `.git` out of a
#   search.
# - commit, commits, committed, committing: a change recorded in a repository.
# - diff, diffs, diffing: the lines of code that a change adds and removes.
# - branch, branches, branching: a line of commits.
# - pull request, pull-request, pull_request and their plurals, and PR and PRs in upper
#   case (PR_WORDS): a change proposed to a code forge.
# - test, tests, tested, testing: code that checks code. `.test(`, the method of a regular
#   expression in JavaScript, is no such word.
# - criterion, criteria: the acceptance criteria of a spec.
# - spec, specs, specification, specifications: the document of the software change.
# - codebase, codebases, source code: code.
# - deploy, deploys, deployed, deploying, deployment, deployments: shipping software.
# test, commit and deploy also have plain senses, such as an A/B test of an email. The list
# keeps them, because core needs none of those senses and uses a plain word in their place,
# such as check, record or send. These words stay off the list, because core needs them in a
# sense outside software work, and the rule cannot tell that sense from the software one:
# - code: a code block or code span of Markdown.
# - merge and database: the line of each agent "merge nothing, write to no database", which
#   binds an agent in every kind of work.
# - API: the run API of Qory Apiary.
# - wireframe and mockup: the picture of a screen, an email or a form.
# - ticket: the work that a run takes in, in every kind of workspace.
# - build: "build on it", for an answer that settles a question, and building a name.
# checkout and bug appear in no file of core. A shop's checkout and a fault that a customer
# reports are plain senses of the two words in customer care, which a later text of core
# may need.
# The skill simple-communication is exempt, except for software-factory: it holds the
# writing rules for every kind of text, including commit messages and pull requests.
CORE_WORDS='software|repositor(y|ies)|repos?|git|github|commit(s|ted|ting)?|diff(s|ing)?|branch(es|ing)?|pull[ _-]requests?|test(s|ed|ing)?|criteri(on|a)|specs?|specifications?|codebases?|source code|deploy(s|ed|ing|ments?)?'
PR_WORDS='PRs?'

# A relative QORY path stays valid after `run` changes directory.
case $QORY in
/*) ;;
*/*) QORY=$(pwd -P)/$QORY ;;
esac

ROOT=$(CDPATH= cd -P -- "$(dirname -- "$0")/.." >/dev/null && pwd -P) || exit 1
# The testdata that rule 9 checks.
TESTDATA=$ROOT/modules/software-factory/testdata

command -v node >/dev/null 2>&1 || {
	printf 'Install node, and run the script again: it runs the tests of the scripts and the checks of the testdata.\n' >&2
	exit 1
}

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT
trap 'exit 130' HUP INT TERM

# HOME and XDG_CONFIG_HOME point into $TMP, so qory reads no user
# configuration file from $XDG_CONFIG_HOME/qory. A qory.yaml in a directory
# above the checkout that the user owns still applies to every qory call.
mkdir "$TMP/home" "$TMP/config" "$TMP/consumer" "$TMP/software" "$TMP/authoring" || exit 1
HOME=$TMP/home
XDG_CONFIG_HOME=$TMP/config
export HOME XDG_CONFIG_HOME

OUT=
RC=0

# run DIR COMMAND...: runs COMMAND in DIR, and sets OUT to its output and RC
# to its exit status. If cd to DIR fails, OUT contains the error of cd.
run() {
	dir=$1
	shift
	OUT=$(CDPATH= cd -- "$dir" 2>&1 && "$@" 2>&1)
	RC=$?
}

pass() {
	printf 'ok    %s\n' "$1"
}

# fail TEXT: prints the failed check and the output of its command, and exits 1.
fail() {
	printf 'FAIL  %s\n' "$1"
	printf '%s\n' "$OUT"
	exit 1
}

# expect TEXT CODE DIR COMMAND...: runs COMMAND in DIR and fails unless its exit
# status is CODE.
expect() {
	text=$1
	code=$2
	shift 2
	run "$@"
	[ "$RC" -eq "$code" ] || fail "$text (exit status $RC)"
	pass "$text"
}

# expect_entry TEXT [ENTRY]: fails unless OUT lists ENTRY as an entry. ENTRY
# defaults to $ENTRY.
expect_entry() {
	entry=${2:-$ENTRY}
	printf '%s\n' "$OUT" | grep -Eq "^[[:space:]]*$entry([[:space:]]|\$)" ||
		fail "$1"
	pass "$1"
}

# expect_no_entry TEXT ENTRY: fails if OUT lists ENTRY as an entry.
expect_no_entry() {
	if printf '%s\n' "$OUT" | grep -Eq "^[[:space:]]*$2([[:space:]]|\$)"; then
		fail "$1"
	fi
	pass "$1"
}

# add LINE: adds LINE to OUT.
add() {
	OUT="$OUT$1
"
}

# The UTF-8 byte order mark, which an editor may write at the start of a file.
BOM=$(printf '\357\273\277')

# front_matter FILE: prints the lines between the two --- lines at the top of FILE, after
# any blank lines, with no carriage return and no byte order mark.
front_matter() {
	awk -v bom="$BOM" '{ sub(/\r$/, "") }
		NR == 1 && index($0, bom) == 1 { $0 = substr($0, length(bom) + 1) }
		!on { if ($0 ~ /^[ \t]*$/) next; if ($0 !~ /^---[ \t]*$/) exit; on = 1; next }
		/^---[ \t]*$/ { exit }
		{ print }' "$1"
}

# in_fence(LINE) returns 1 for a line that opens, closes or sits inside a code fence. A
# fence closes on the same character, at least as many times, with nothing after it.
FENCE_AWK='
function in_fence(line, rest, mark, n) {
	rest = line
	sub(/^[ \t]*/, "", rest)
	n = 0
	if (match(rest, /^`+/) || match(rest, /^~+/)) {
		mark = substr(rest, 1, 1)
		n = RLENGTH
	}
	if (fence_n) {
		if (n >= fence_n && mark == fence_mark && substr(rest, n + 1) ~ /^[ \t]*$/)
			fence_n = 0
		return 1
	}
	if (n >= 3 && !(mark == "`" && substr(rest, n + 1) ~ /`/)) {
		fence_mark = mark
		fence_n = n
		return 1
	}
	return 0
}
'

# prose FILE: prints FILE with no front matter, no code fence, no carriage return and no
# byte order mark.
prose() {
	awk -v bom="$BOM" "$FENCE_AWK"'
		{ sub(/\r$/, "") }
		NR == 1 && index($0, bom) == 1 { $0 = substr($0, length(bom) + 1) }
		state == 0 {
			if ($0 ~ /^[ \t]*$/) next
			if ($0 ~ /^---[ \t]*$/) { state = 1; next }
			state = 2
		}
		state == 1 { if ($0 ~ /^---[ \t]*$/) state = 2; next }
		in_fence($0) { next }
		{ print }' "$1"
}

# Reads front matter, and prints the value of the tools key with no comment: every line up
# to the next top-level key. \047 is a single quote.
TOOLS_AWK='
function clean(text) {
	sub(/(^|[ \t])#.*$/, "", text)
	return text
}
on && /^["\047]?[A-Za-z_][A-Za-z0-9_-]*["\047]?[ \t]*:/ { on = 0 }
/^["\047]?tools["\047]?[ \t]*:/ { on = 1; sub(/^[^:]*:/, ""); print clean($0); next }
on { print clean($0) }
'

# Each rule below takes a directory that contains modules/. It sets OUT to what breaks
# the rule, and returns 0 when nothing does.

# rule_sections DIR: rule 1, each agent has the three required sections, outside its code
# fences and front matter.
rule_sections() {
	OUT=
	for file in "$1"/modules/*/agents/*.md; do
		[ -f "$file" ] || continue
		agent_text=$(prose "$file")
		for section in 'Guardrails' 'Stop conditions' 'Expected output'; do
			printf '%s\n' "$agent_text" | grep -Eq "^## $section[[:space:]]*\$" ||
				add "Add the section ## $section to $file."
		done
	done
	[ -z "$OUT" ]
}

# rule_tools DIR: rule 2, an agent has a tools key, because an agent with none gets every
# tool. The key lists Bash, Edit, Write, WebFetch or WebSearch only with a line outside the
# code fences of the body for that tool: `Tool exception: <tool>, because <reason>`. No
# agent lists Agent, NotebookEdit or MultiEdit, with or without such a line. A reviewer or
# code-explorer or shape-planner lists only Read, Grep, Glob and Skill.
rule_tools() {
	OUT=
	for file in "$1"/modules/*/agents/*.md; do
		[ -f "$file" ] || continue
		tools=$(front_matter "$file" | awk "$TOOLS_AWK")
		if ! printf '%s\n' "$tools" | grep -q '[[:alnum:]]'; then
			add "Add a tools key to $file: an agent with no tools key gets every tool."
			continue
		fi
		agent_text=$(prose "$file")
		for tool in Bash Edit Write WebFetch WebSearch; do
			printf '%s\n' "$tools" |
				grep -Eq "(^|[^[:alnum:]_])$tool([^[:alnum:]_]|\$)" || continue
			printf '%s\n' "$agent_text" | grep -Eq "^Tool exception: $tool, because [^[:space:]]" ||
				add "Remove $tool from the tools key of $file, or add the line 'Tool exception: $tool, because <reason>' to its body."
		done
		for tool in Agent NotebookEdit MultiEdit; do
			printf '%s\n' "$tools" |
				grep -Eq "(^|[^[:alnum:]_])$tool([^[:alnum:]_]|\$)" &&
				add "Remove $tool from the tools key of $file: no agent lists it."
		done
		case $(basename "$file" .md) in
		*-reviewer | code-explorer | shape-planner)
			extra=$(printf '%s\n' "$tools" | tr -cs '[:alnum:]_' '\n' | grep -v '^$' |
				grep -Evx 'Read|Grep|Glob|Skill' | tr '\n' ' ')
			[ -z "$extra" ] ||
				add "Remove $extra from the tools key of $file: it lists only Read, Grep, Glob and Skill."
			;;
		esac
	done
	[ -z "$OUT" ]
}

# The Bash rules for the two mockup scripts, which the settings of software-factory allow.
RENDER_RULE='"Bash($QORY_HARNESS_HOME/claude/plugin/skills/designing-mockups/render-mockups.cjs *)"'
PACK_RULE='"Bash($QORY_HARNESS_HOME/claude/plugin/skills/designing-mockups/pack-mockups.cjs *)"'
# The two Bash rules that the settings of core allow: the main session runs the versions
# script, which copies the newest version and compares a draft with it, and the checks
# script, which checks drafts and reports and counts the starts of each agent.
VERSIONS_RULE='"Bash($QORY_HARNESS_HOME/claude/plugin/skills/running-a-workflow/versions.cjs *)"'
CHECKS_RULE='"Bash($QORY_HARNESS_HOME/claude/plugin/skills/running-a-workflow/checks.cjs *)"'
DRAFT_DENY='"Edit(//tmp/qory-artifacts/**/mockup-draft/**)"'
RENDER_DENY='"Edit(//tmp/qory-artifacts/**/mockup-render/**)"'
# The line of designer's Bash exception, which names both mockup scripts.
DESIGNER_EXCEPTION='Tool exception: Bash, because you run only `pack-mockups.cjs` and `render-mockups.cjs`.'

# rule_designer DIR: rule 2, the exception for designer. Its Bash exception is
# DESIGNER_EXCEPTION, the settings of software-factory allow Bash only for the two mockup
# scripts, those of core only for VERSIONS_RULE and CHECKS_RULE, and the settings of
# software-factory deny Edit, which also covers Write, in the two folders that only the
# mockup scripts write to.
rule_designer() {
	OUT=
	file=$1/modules/software-factory/agents/designer.md
	core_settings=$1/modules/core/settings/claude/settings.json
	if [ -f "$core_settings" ]; then
		others=$(permission_rules "$core_settings" allow | grep -F '"Bash' |
			grep -Fvx -e "$VERSIONS_RULE" -e "$CHECKS_RULE")
		[ -z "$others" ] ||
			add "Remove these rules from permissions.allow of $core_settings, because Bash is only for the versions script and the checks script: $others"
	fi
	settings=$1/modules/software-factory/settings/claude/settings.json
	[ -f "$settings" ] || { [ -z "$OUT" ]; return; }
	others=$(permission_rules "$settings" allow | grep -F '"Bash' |
		grep -Fvx -e "$RENDER_RULE" -e "$PACK_RULE")
	[ -z "$others" ] ||
		add "Remove these rules from permissions.allow of $settings, because Bash is only for the mockup scripts: $others"
	[ -f "$file" ] || { [ -z "$OUT" ]; return; }
	prose "$file" | grep -Fxq -- "$DESIGNER_EXCEPTION" ||
		add "Write this line as the Bash exception of $file, because designer runs only the mockup scripts: $DESIGNER_EXCEPTION"
	for rule in "$PACK_RULE" "$RENDER_RULE"; do
		permission_rules "$settings" allow | grep -Fxq -- "$rule" ||
			add "Add $rule to permissions.allow of $settings: designer runs that script."
	done
	for rule in "$DRAFT_DENY" "$RENDER_DENY"; do
		permission_rules "$settings" deny | grep -Fxq -- "$rule" ||
			add "Add $rule to permissions.deny of $settings: only the mockup scripts write there."
	done
	[ -z "$OUT" ]
}

# Reads front matter, and prints the value of each model key, with no comment and no quotes
# around it: a tier as its name after "+", and any other value after "=". A tier is
# ${qory:light}, ${qory:fast} or ${qory:thinking}, the three tiers of qory (Tiers in
# internal/module/references.go). \047 is a single quote.
MODEL_AWK='
/^["\047]?model["\047]?[ \t]*:/ {
	value = $0
	sub(/^[^:]*:/, "", value)
	sub(/(^|[ \t])#.*$/, "", value)
	sub(/^[ \t]+/, "", value)
	sub(/[ \t]+$/, "", value)
	q = substr(value, 1, 1)
	if (length(value) >= 2 && (q == "\"" || q == "\047") && substr(value, length(value)) == q)
		value = substr(value, 2, length(value) - 2)
	if (value ~ /^[$][{]qory:(light|fast|thinking)[}]$/)
		print "+" substr(value, 8, length(value) - 8)
	else
		print "=" value
}
'

# Reads docs/modules.md, and prints a line for each row of the tier table, the table with the
# header "| Tier | Agents |" in the section "Agents". A row is each line with a "|" up to the
# next line with none, with or without a "|" at its start, and a carriage return at its end
# is left out:
# - "<tier> <name>" for each name or pattern in a code span, and "<tier> !<name>" for each
#   name in the list after "except": the row lists every *-reviewer except demo-reviewer;
# - "%tier <cell>" for a tier cell that is not `light`, `fast` or `thinking`;
# - "%text <tier> <text>" for the text left in the names cell after the code spans and the
#   words ",", "and", "every" and "except" are removed.
TIER_TABLE_AWK='
BEGIN { EXCEPT = "except[ \t]+`[^`]+`([ \t]*(,|and|, and)[ \t]+`[^`]+`)*" }
function trim(text) {
	gsub(/^[ \t]+|[ \t]+$/, "", text)
	return text
}
{ sub(/\r$/, "") }
/^## / { on = ($0 ~ /^## Agents[ \t]*$/); table = 0; next }
!on { next }
!/[|]/ { table = 0; next }
{
	row = $0
	sub(/^[ \t]*[|]/, "", row)
}
!table {
	n = split(row, cells, "|")
	table = (n >= 2 && trim(cells[1]) == "Tier" && trim(cells[2]) == "Agents")
	next
}
/^[ \t:|-]*$/ { next }
{
	split(row, cells, "|")
	cell = trim(cells[1])
	if (cell !~ /^`(light|fast|thinking)`$/) { print "%tier " cell; next }
	tier = substr(cell, 2, length(cell) - 2)
	line = cells[2]
	rest = line
	while (match(rest, EXCEPT)) {
		names = substr(rest, RSTART, RLENGTH)
		rest = substr(rest, RSTART + RLENGTH)
		while (match(names, /`[^`]+`/)) {
			print tier " !" substr(names, RSTART + 1, RLENGTH - 2)
			names = substr(names, RSTART + RLENGTH)
		}
	}
	gsub(EXCEPT, " ", line)
	left = line
	while (match(line, /`[^`]+`/)) {
		print tier " " substr(line, RSTART + 1, RLENGTH - 2)
		line = substr(line, RSTART + RLENGTH)
	}
	gsub(/`[^`]*`/, " ", left)
	gsub(/,/, " ", left)
	left = " " left " "
	while (match(left, /[ \t](and|every|except)[ \t]/))
		left = substr(left, 1, RSTART) substr(left, RSTART + RLENGTH - 1)
	gsub(/[ \t]+/, " ", left)
	left = trim(left)
	if (left != "") print "%text " tier " " left
}
'

# tier_rows DIR: prints the rows of the tier table of DIR/docs/modules.md, as
# TIER_TABLE_AWK prints them, and nothing when the file is missing.
tier_rows() {
	[ -f "$1/docs/modules.md" ] && awk "$TIER_TABLE_AWK" "$1/docs/modules.md"
}

# GLOB_AWK: the function overlap(p, q) of awk, which returns 1 when some name matches both
# patterns p and q. In a pattern, * matches any text, and each other character itself.
GLOB_AWK='
function overlap(p, q) {
	if (p == "" && q == "") return 1
	if (substr(p, 1, 1) == "*")
		return overlap(substr(p, 2), q) || (q != "" && overlap(p, substr(q, 2)))
	if (substr(q, 1, 1) == "*")
		return overlap(p, substr(q, 2)) || (p != "" && overlap(substr(p, 2), q))
	if (p != "" && q != "" && substr(p, 1, 1) == substr(q, 1, 1))
		return overlap(substr(p, 2), substr(q, 2))
	return 0
}
'

# Reads the rows of tier_rows, and prints the tier of the agent n: the tier of the row that
# lists its name, else the tier of a row whose pattern matches it and that does not except
# it, else nothing. So demo-reviewer, which the `thinking` row excepts, is fast.
AGENT_TIER_AWK=$GLOB_AWK'
/^%/ { next }
substr($2, 1, 1) == "!" { except[$1 SUBSEP substr($2, 2)] = 1; next }
index($2, "*") { pattern[++count] = $2; tier[count] = $1; next }
$2 == n && named == "" { named = $1 }
END {
	if (named != "") { print named; exit }
	for (k = 1; k <= count; k++)
		if (overlap(pattern[k], n) && !((tier[k] SUBSEP n) in except)) { print tier[k]; exit }
}
'

# agent_tier NAME ROWS: prints the tier that the rows of the tier table, ROWS from
# tier_rows, give the agent NAME, and nothing for an agent with no tier.
agent_tier() {
	printf '%s\n' "$2" | awk -v n="$1" "$AGENT_TIER_AWK"
}

# short TEXT [MAX]: prints TEXT, or its first MAX - 3 characters and "..." when it has more
# than MAX, 24 by default, so that a first line of a message stays within 100 characters.
short() {
	max=${2:-24}
	if [ "${#1}" -gt "$max" ]; then
		printf '%s...\n' "$(printf '%s' "$1" | cut -c "1-$((max - 3))")"
	else
		printf '%s\n' "$1"
	fi
}

# Reads the rows of tier_rows, and prints a line for each conflict that makes a tier depend
# on the order of the rows:
# - "excepted <tier> <name>" for a name that a row lists and a row of the same tier excepts;
# - "twice - <name> - <tiers>" for a name that rows of two or more tiers list, with the
#   tiers as "thinking, fast and light";
# - "pattern <tier> <pattern> <tier> <pattern>" for two patterns of rows of different tiers
#   that match a common name;
# - "name <tier> <pattern> <tier> <name>" for a pattern that matches a name of a row of
#   another tier, when no row of the pattern's tier excepts that name.
TIER_OVERLAP_AWK=$GLOB_AWK'
/^%/ { next }
substr($2, 1, 1) == "!" { except[$1 SUBSEP substr($2, 2)] = 1; next }
index($2, "*") { pattern[++count] = $2; ptier[count] = $1; next }
{ name[++names] = $2; ntier[names] = $1 }
END {
	for (i = 1; i <= names; i++) {
		if ((ntier[i] SUBSEP name[i]) in except)
			print "excepted " ntier[i] " " name[i]
		if (name[i] in twice) continue
		twice[name[i]] = 1
		list = ntier[i]
		last = ""
		delete seen
		seen[ntier[i]] = 1
		for (j = i + 1; j <= names; j++)
			if (name[i] == name[j] && !(ntier[j] in seen)) {
				seen[ntier[j]] = 1
				if (last != "") list = list ", " last
				last = ntier[j]
			}
		if (last != "") print "twice - " name[i] " - " list " and " last
	}
	for (i = 1; i <= count; i++) {
		for (j = i + 1; j <= count; j++)
			if (ptier[i] != ptier[j] && overlap(pattern[i], pattern[j]))
				print "pattern " ptier[i] " " pattern[i] " " ptier[j] " " pattern[j]
		for (j = 1; j <= names; j++)
			if (ptier[i] != ntier[j] && overlap(pattern[i], name[j]) &&
				!((ptier[i] SUBSEP name[j]) in except))
				print "name " ptier[i] " " pattern[i] " " ntier[j] " " name[j]
	}
}
'

# rule_tier_table DIR: rule 3, rule_model can read each row of the tier table of
# DIR/docs/modules.md, section "Agents": a tier `light`, `fast` or `thinking` in code font,
# and names and patterns in code font. A name is listed under one tier, and not excepted by
# a row of that tier. A pattern such as *-reviewer lists after "except" each name of a row
# of another tier that it matches, and two patterns of rows of different tiers match no
# common name, so the order of the rows changes no tier.
rule_tier_table() {
	OUT=
	rows=$(tier_rows "$1")
	if [ -z "$rows" ]; then
		add "Add the tier table to docs/modules.md, section \"Agents\"."
		add "  docs/modules.md has no table with the header \"| Tier | Agents |\" in the section \"Agents\", and rule 3 reads the tier of each agent from that table."
		return 1
	fi
	while read -r kind tier cell_text; do
		case $kind in
		%tier)
			cell="$tier${cell_text:+ $cell_text}"
			add "In docs/modules.md, replace the tier $(short "$cell") with \`light\`, \`fast\` or \`thinking\`."
			add "  A row of the tier table of docs/modules.md, section \"Agents\", has the tier cell $cell, and rule 3 reads only those three tiers in code font." ;;
		%text)
			add "In docs/modules.md, put $(short "$cell_text") of the \`$tier\` row in code font, or remove it."
			add "  The names cell of the \`$tier\` row of the tier table of docs/modules.md, section \"Agents\", has the text $cell_text outside code font, and rule 3 reads a name only in code font." ;;
		esac
	done <<EOF
$rows
EOF
	while read -r kind tier pattern other match; do
		case $kind in
		excepted)
			add "In docs/modules.md, list or except \`$(short "$pattern")\` in the \`$tier\` rows, not both."
			add "  The tier table of docs/modules.md, section \"Agents\", lists $pattern under the tier $tier, and a row of the tier $tier lists $pattern after except." ;;
		twice)
			add "In docs/modules.md, list \`$(short "$pattern")\` in one row of the tier table."
			add "  The tier table of docs/modules.md, section \"Agents\", lists $pattern under the tiers $match, and rule 3 takes the tier of the first row." ;;
		pattern)
			add "In docs/modules.md, change \`$(short "$pattern" 18)\` or \`$(short "$match" 18)\`: no name may match both."
			add "  In the tier table of docs/modules.md, section \"Agents\", the pattern $pattern of the tier $tier and the pattern $match of the tier $other match a common name, so the tier of that name depends on the order of the rows." ;;
		name)
			add "In docs/modules.md, add except \`$(short "$match")\` to the \`$(short "$pattern")\` row."
			add "  The tier table of docs/modules.md, section \"Agents\", lists $match under the tier $other, and the pattern $pattern of the tier $tier matches $match." ;;
		esac
	done <<EOF
$(printf '%s\n' "$rows" | awk "$TIER_OVERLAP_AWK")
EOF
	[ -z "$OUT" ]
}

# rule_model DIR: rule 3, an agent's model key, when it has one, is a tier, because the
# person who composes the harness chooses the model for each tier. A model id fails. The
# tier is the one that the tier table of DIR/docs/modules.md gives the agent's file name,
# and an agent with no tier there has no model key. The first line of each message is the
# fix.
rule_model() {
	OUT=
	table="docs/modules.md, section \"Agents\""
	rows=$(tier_rows "$1")
	for file in "$1"/modules/*/agents/*.md; do
		[ -f "$file" ] || continue
		name=$(basename "$file" .md)
		path=${file#"$1"/}
		want=$(agent_tier "$name" "$rows")
		models=$(front_matter "$file" | awk "$MODEL_AWK")
		values=$(printf '%s\n' "$models" | grep '^=')
		if [ -n "$values" ]; then
			value=$(printf '%s\n' "$values" | head -n 1 | cut -c 2-)
			cause='The model key has no value on its line.'
			[ -z "$value" ] || cause="The model key is set to $value."
			if [ -n "$want" ]; then
				add "Write model: \${qory:$want} in $path."
				add "  $cause $table, lists $name under the tier $want. The person who composes the harness chooses the model for each tier, so an agent sets no model id."
			else
				add "Remove the model key from $path."
				add "  $cause $table, lists no tier for $name. An agent with no tier runs on the main model."
			fi
			continue
		fi
		tiers=$(printf '%s\n' "$models" | sed -n 's/^+//p')
		have=$(printf '%s\n' "$tiers" | grep -v '^$' | grep -Fvx -e "$want" | head -n 1)
		if [ -n "$want" ] && [ -n "$have" ]; then
			add "Write model: \${qory:$want} in $path."
			add "  The model key is set to \${qory:$have}, and $table, lists $name under the tier $want."
		elif [ -n "$want" ] && [ -z "$tiers" ]; then
			add "Add model: \${qory:$want} to $path."
			add "  The front matter has no model key, so $name runs on the main model, and $table, lists $name under the tier $want."
		elif [ -n "$have" ]; then
			add "Remove the model key from $path."
			add "  The model key is set to \${qory:$have}, and $table, lists no tier for $name. An agent with no tier runs on the main model."
		fi
	done
	[ -z "$OUT" ]
}

# Rule 4 reads a list item outside a code fence, with its indented lines, and leaves out a
# byte order mark at the start of the file. It removes the reference, also in a code span
# or bold, and any further references joined by ", with", " or", " and", ", or", ", and" or
# ",". The words that follow, after a comma or a colon, must be a moment, in any case:
# first, next or last with a comma or a colon after it, or another moment word with
# further words after it.
MOMENT_AWK=$FENCE_AWK'
function check(rest) {
	if (item == "") return
	rest = item
	sub(/^[ \t]*([-*+]|[0-9]+[.)])[ \t]+[`*_]*/, "", rest)
	while (match(rest, /^[$][{]qory:skills\/[^}]*[}]/)) {
		rest = substr(rest, RLENGTH + 1)
		if (match(rest, /^[`*_]*(, with | or | and |, or |, and |, )[`*_]*[$][{]qory:/))
			rest = substr(rest, RLENGTH - 6)
	}
	sub(/^[`*_]*[,:]?[`*_]*[ ]*/, "", rest)
	rest = tolower(rest)
	if (rest !~ /^(first|next|last)[,:]/ &&
		rest !~ /^(before|after|when|while|once|only when|at the start|in step) +[^ ]/)
		print start ": " item
	item = ""
}
FNR == 1 && index($0, bom) == 1 { $0 = substr($0, length(bom) + 1) }
in_fence($0) { check(); next }
/^[ \t]*([-*+]|[0-9]+[.)])[ \t]+[`*_]*[$][{]qory:skills\// { check(); item = $0; start = FNR; next }
item != "" && /^[ \t]+[^ \t]/ && !/^[ \t]*([-*+]|[0-9]+[.)])[ \t]/ {
	line = $0
	sub(/^[ \t]+/, "", line)
	item = item " " line
	next
}
{ check() }
END { check() }
'

# skill_files DIR: prints the SKILL.md of each skill under DIR/modules, as a path from that
# folder. A SKILL.md below a directory that has a SKILL.md is a file of that skill, not a
# skill. The search goes to any depth, so that the rules read a skill in a group,
# skills/<group>/<name>/SKILL.md, and skip none with no message. This harness uses no group.
# The path of the checkout does not change the result.
skill_files() {
	(CDPATH= cd -- "$1/modules" &&
		find . -type f -name SKILL.md -path './*/skills/*' \
			! -path './*/skills/SKILL.md' | LC_ALL=C sort |
		awk '{
			path[NR] = $0
			dir = $0
			sub(/\/SKILL\.md$/, "", dir)
			folder[NR] = dir
			has[dir] = 1
		}
		END {
			for (i = 1; i <= NR; i++) {
				dir = folder[i]
				keep = 1
				while (keep && sub(/\/[^\/]*$/, "", dir))
					if (dir in has) keep = 0
				if (keep) print path[i]
			}
		}')
}

# moments_of FILE: adds to OUT each list item of FILE that states no moment.
moments_of() {
	items=$(awk -v bom="$BOM" "$MOMENT_AWK" "$1")
	[ -z "$items" ] ||
		add "State the moment right after the reference, in $1, line $items"
}

# rule_moments DIR: rule 4, each list item that starts with a reference to a skill states
# its moment.
rule_moments() {
	OUT=
	for file in "$1"/modules/*/agents/*.md; do
		[ -f "$file" ] || continue
		moments_of "$file"
	done
	while IFS= read -r skill; do
		[ -n "$skill" ] && moments_of "$1/modules/${skill#./}"
	done <<EOF
$(skill_files "$1")
EOF
	[ -z "$OUT" ]
}

# word_lines DIR GREP_ARGUMENT...: prints each line that matches in an agent or in a text
# file under a skill. The paths start under modules/, so the path of the checkout does not
# change the result. The word list of simple-communication contains the words as examples.
word_lines() {
	dir=$1
	shift
	(CDPATH= cd -- "$dir/modules" &&
		find . -type f \( -path './*/agents/*.md' -o -path './*/skills/*' \) \
			! -path './core/skills/simple-communication/references/*' \
			-exec grep -I -n -E "$@" /dev/null {} +)
}

# rule_words DIR: rule 5, no agent or skill file contains a banned word.
rule_words() {
	OUT=$(word_lines "$1" -e "$BANNED_CASED"
		word_lines "$1" -i -e "$BANNED_ANY_CASE")
	[ -z "$OUT" ] && return 0
	OUT="Replace each word on these lines under modules/, as simple-communication's word list states:
$OUT"
	return 1
}

# permission_rules FILE LIST: prints each string of permissions.LIST in a JSON settings
# file, with its quotes, one per line. It walks the characters, so the layout of the file
# and a bracket inside a rule do not change the result.
permission_rules() {
	awk -v list="$2" '{ text = text $0 "\n" }
	END {
		size = length(text)
		for (i = 1; i <= size; i++) {
			c = substr(text, i, 1)
			if (c == "\"") {
				word = ""
				for (i++; i <= size; i++) {
					c = substr(text, i, 1)
					if (c == "\"") break
					if (c == "\\") { word = word c; i++; c = substr(text, i, 1) }
					word = word c
				}
				if (depth == 3 && type[3] == "[" && key[1] == "permissions" && key[2] == list)
					print "\"" word "\""
				last = word
			} else if (c == ":") {
				key[depth] = last
			} else if (c == "{" || c == "[") {
				depth++
				type[depth] = c
				key[depth] = ""
			} else if (c == "}" || c == "]") {
				depth--
			}
		}
	}' "$1"
}

# skill_names DIR: prints the folder name of each skill of DIR, one per line.
skill_names() {
	skill_files "$1" | while IFS= read -r path; do
		basename "$(dirname "$path")"
	done
}

# rule_allow DIR [FILE]: rule 6, each skill and agent of the core and software-factory
# modules has its allow rule in FILE, by default the Claude settings of the core and
# software-factory modules together, no rule of FILE is in both allow and deny, and each Skill or Agent rule of
# allow is for a skill or an agent under modules. The rule checks that the settings
# match the entries. A skill with an allowed-tools key needs its rule under dontAsk on Claude
# Code 2.1.316; a skill with no such key loaded with no rule, in a test with a scripted API. An
# agent with no rule is untested. No skill here has the key, and the list stays complete.
# qory passes these rules only to Claude Code. At qory 91f02f0, a Codex home has no allow
# list and gets every composed skill (internal/render/codex/codex.go and
# internal/render/address.go). For Codex, the check is that
# harness compose --dry-run --runtime codex for the software stack lists every skill and
# agent of core and software-factory (ENTRY, VISUALS_ENTRY, SOFTWARE_ENTRY, CORE_ENTRIES
# and SOFTWARE_ENTRIES), and no entry of AUTHORING_ENTRIES.
rule_allow() {
	OUT=
	dir=$1
	if [ -n "${2-}" ]; then
		settings=$2
		missing="Add the settings file $2: the file is missing."
		set -- "$2"
	else
		settings="the Claude settings of core and software-factory"
		set -- "$dir/modules/core/settings/claude/settings.json" \
			"$dir/modules/software-factory/settings/claude/settings.json"
		missing="Add the settings file $1 or $2: neither file exists."
	fi
	allowed=
	denied=
	found=
	for file in "$@"; do
		[ -f "$file" ] || continue
		found=yes
		allowed="$allowed$(permission_rules "$file" allow)
"
		denied="$denied$(permission_rules "$file" deny)
"
	done
	set -- "$dir"
	if [ -z "$found" ]; then
		add "$missing"
		return 1
	fi
	known_skills=$(skill_names "$1")
	known_agents=$(for file in "$1"/modules/*/agents/*.md; do basename "$file" .md; done)
	while IFS= read -r rule; do
		[ -n "$rule" ] || continue
		printf '%s\n' "$denied" | grep -Fxq -- "$rule" &&
			add "Remove $rule from permissions.deny or permissions.allow of $settings: it is in both."
		case $rule in
		'"Skill(harness:'*)
			name=${rule#\"Skill\(harness:}
			name=${name%\)\"}
			printf '%s\n' "$known_skills" | grep -Fxq -- "$name" ||
				add "Remove $rule from permissions.allow of $settings: no skill $name exists under modules."
			;;
		'"Agent(harness:'*)
			name=${rule#\"Agent\(harness:}
			name=${name%\)\"}
			printf '%s\n' "$known_agents" | grep -Fxq -- "$name" ||
				add "Remove $rule from permissions.allow of $settings: no agent $name exists under modules."
			;;
		esac
	done <<EOF
$allowed
EOF
	while IFS= read -r skill; do
		case $skill in
		./core/* | ./software-factory/*) ;;
		*) continue ;;
		esac
		name=$(basename "$(dirname "$skill")")
		printf '%s\n' "$allowed" | grep -Fxq "\"Skill(harness:$name)\"" ||
			add "Add \"Skill(harness:$name)\" to permissions.allow, because $settings lacks it."
	done <<EOF
$(skill_files "$1")
EOF
	for file in "$1"/modules/core/agents/*.md "$1"/modules/software-factory/agents/*.md; do
		[ -f "$file" ] || continue
		name=$(basename "$file" .md)
		printf '%s\n' "$allowed" | grep -Fxq "\"Agent(harness:$name)\"" ||
			add "Add \"Agent(harness:$name)\" to permissions.allow, because $settings lacks it."
	done
	[ -z "$OUT" ]
}

# With this variable set to 1, Claude Code 2.1.316 runs an Agent call in the foreground, in a
# test with a scripted API. See docs/modules.md, section "Agents".
BACKGROUND_VAR=CLAUDE_CODE_DISABLE_BACKGROUND_TASKS

# json_strings FILE: prints each string value of a JSON file as <path> <value>, with one tab
# between them, one per line. A path is the keys and the array indexes, joined by dots.
json_strings() {
	awk '{ text = text $0 "\n" }
	END {
		size = length(text)
		for (i = 1; i <= size; i++) {
			c = substr(text, i, 1)
			if (c == "\"") {
				word = ""
				for (i++; i <= size; i++) {
					c = substr(text, i, 1)
					if (c == "\"") break
					if (c == "\\") { word = word c; i++; c = substr(text, i, 1) }
					word = word c
				}
				j = i + 1
				while (substr(text, j, 1) ~ /[ \t\n\r]/) j++
				if (substr(text, j, 1) == ":") {
					part[depth] = word
				} else {
					path = ""
					for (k = 1; k <= depth; k++)
						path = path (k > 1 ? "." : "") part[k]
					print path "\t" word
				}
			} else if (c == "{" || c == "[") {
				depth++
				array[depth] = (c == "[")
				part[depth] = 0
			} else if (c == "}" || c == "]") {
				depth--
			} else if (c == "," && array[depth]) {
				part[depth]++
			}
		}
	}' "$1"
}

# rule_background DIR: rule 6, the settings of the software-factory module set BACKGROUND_VAR
# to the string 1 under env.
rule_background() {
	OUT=
	settings=$1/modules/software-factory/settings/claude/settings.json
	tab=$(printf '\t')
	json_strings "$settings" | grep -Fxq "env.$BACKGROUND_VAR${tab}1" ||
		add "Set env.$BACKGROUND_VAR to \"1\" in $settings, or an Agent call runs in the background."
	[ -z "$OUT" ]
}

# rule_launch_env REPORT: rule 6, the compose report of a harness lists BACKGROUND_VAR with the
# value 1 under launch_env.claude. The compose moves env out of the composed settings, into
# the process's environment.
rule_launch_env() {
	OUT=
	json_strings "$1" | awk -F '\t' -v name="$BACKGROUND_VAR" '
		$1 ~ /^launch_env[.]claude[.][0-9]+[.]name$/ && $2 == name {
			want = $1
			sub(/name$/, "value", want)
		}
		{ value[$1] = $2 }
		END { exit !(want != "" && value[want] == "1") }' ||
		add "Set env.$BACKGROUND_VAR to \"1\" in the settings of software-factory: $1 lacks it under launch_env.claude with the value 1."
	[ -z "$OUT" ]
}

# Reads a stack file, and prints each name under its workflows key: a block mapping or a
# flow mapping. \047 is a single quote.
WORKFLOWS_AWK='
function clean(text) {
	sub(/(^|[ \t])#.*$/, "", text)
	return text
}
function plain(text) {
	gsub(/["\047 \t\n]/, "", text)
	return text
}
{ sub(/\r$/, "") }
on && /^["\047]?[A-Za-z_][A-Za-z0-9_-]*["\047]?[ \t]*:/ { on = 0 }
/^["\047]?workflows["\047]?[ \t]*:/ { on = 1; sub(/^[^:]*:/, ""); value = clean($0); next }
on { value = value "\n" clean($0) }
END {
	text = value
	sub(/^[ \t\n]*/, "", text)
	if (substr(text, 1, 1) == "{") {
		size = length(text)
		for (i = 1; i <= size; i++) {
			c = substr(text, i, 1)
			if (c == "{") { depth++; word = "" }
			else if (c == "}") depth--
			else if (depth == 1) {
				if (c == ":") { print plain(word); word = "" }
				else if (c == ",") word = ""
				else word = word c
			}
		}
		exit
	}
	count = split(value, lines, "\n")
	indent = -1
	for (i = 1; i <= count; i++) {
		if (lines[i] ~ /^[ \t]*$/) continue
		match(lines[i], /^[ \t]*/)
		if (indent < 0) indent = RLENGTH
		if (RLENGTH == indent && lines[i] ~ /:/) {
			word = lines[i]
			sub(/:.*$/, "", word)
			print plain(word)
		}
	}
}
'

# Reads front matter, and prints the value of the name key with no comment and no quotes.
NAME_AWK='
/^["\047]?name["\047]?[ \t]*:/ {
	sub(/^[^:]*:/, "")
	sub(/(^|[ \t])#.*$/, "")
	gsub(/["\047 \t]/, "")
	print
	exit
}
'

# rule_workflows DIR: rule 7, each workflow of a stack has a skill workflow-<name>, because
# qory looks that name up first, and a skill with the plain name is not enough. Each
# workflow-* skill is a workflow of a stack, and its name key equals its folder name,
# because qory reads no skill front matter.
rule_workflows() {
	OUT=
	workflows=
	for stack in "$1"/stacks/*/qory-stack.yaml; do
		[ -f "$stack" ] || continue
		workflows="$workflows$(awk "$WORKFLOWS_AWK" "$stack")
"
	done
	folders=
	while IFS= read -r skill; do
		[ -n "$skill" ] || continue
		name=$(basename "$(dirname "$skill")")
		folders="$folders$name
"
		case $name in
		workflow-*) ;;
		*) continue ;;
		esac
		printf '%s' "$workflows" | grep -Fxq -- "${name#workflow-}" ||
			add "Rename the skill $name, or add ${name#workflow-} to the workflows key of a stack: no stack lists that workflow."
		key=$(front_matter "$1/modules/${skill#./}" | awk "$NAME_AWK")
		[ "$key" = "$name" ] ||
			add "Set name: $name in $skill under modules/: its front matter sets name: $key, and qory reads only the folder name."
	done <<EOF
$(skill_files "$1")
EOF
	while IFS= read -r workflow; do
		[ -n "$workflow" ] || continue
		printf '%s' "$folders" | grep -Fxq -- "workflow-$workflow" ||
			add "Add the skill workflow-$workflow: the workflow $workflow of a stack has no such skill."
	done <<EOF
$workflows
EOF
	[ -z "$OUT" ]
}

# rule_orchestrators DIR: rule 8, a workflow-* skill orchestrates: it refers to no skill except
# run-artifacts, running-a-* and workflow-* skills, names no other skill of modules/
# outside a code fence, starts at least one agent, and contains the sentence that the workflow requires subagents. A one-word name
# counts only in a code span or next to the word skill, because it can be an ordinary word.
# An agent reference counts only in the text of SKILL.md, because one in a code fence or in
# another file starts no agent. The other checks read every Markdown file of the skill's
# directory, because the compose reads references in each of them. A running-a-* skill, such
# as running-a-workflow, is for a main session: it refers to no skill except run-artifacts,
# has no skill name with a hyphen outside a code fence except run-artifacts and running-a-*,
# and no agent loads it. The rule reads the skill, and checks no runtime.
rule_orchestrators() {
	OUT=
	known_skills=$(skill_names "$1")
	while IFS= read -r skill; do
		[ -n "$skill" ] || continue
		name=$(basename "$(dirname "$skill")")
		case $name in
		workflow-*) ;;
		*) continue ;;
		esac
		dir=$1/modules/$(dirname "${skill#./}")
		references=$(find "$dir" -type f -name '*.md' -exec cat {} + |
			grep -Eo '[$][{]qory:(skills|agents)/[^}]*[}]')
		others=$(printf '%s\n' "$references" | grep -F 'qory:skills/' |
			grep -Fvx -e '${qory:skills/run-artifacts}' |
			grep -Fv -e '${qory:skills/running-a-' -e '${qory:skills/workflow-')
		[ -z "$others" ] ||
			add "Move the skill reference to an agent, because $name does no task itself: $others"
		prose "$1/modules/${skill#./}" | grep -Fq 'qory:agents/' ||
			add "Start an agent in the text of $name's SKILL.md, outside a code fence: a workflow's skill does no task itself."
		skill_text=$(find "$dir" -type f -name '*.md' | while IFS= read -r md; do
			prose "$md"
		done)
		for other in $known_skills; do
			case $other in
			run-artifacts | running-a-* | workflow-* | "$name") continue ;;
			esac
			before='(^|[^[:alnum:]_-])'
			after='([^[:alnum:]_-]|$)'
			case $other in
			*-*) pattern="$before$other$after" ;;
			*) pattern="\`$other\`|${before}skills?[[:space:]]+$other$after|$before$other[[:space:]]+skills?$after" ;;
			esac
			printf '%s\n' "$skill_text" | tr '\n' ' ' | grep -Eiq "$pattern" &&
				add "Remove the skill name $other from $name, because an agent uses that skill and $name does no task itself."
		done
		prose "$1/modules/${skill#./}" | grep -Fq 'This workflow requires subagents.' ||
			add "Add the sentence 'This workflow requires subagents.' to $name, on one line."
	done <<EOF
$(skill_files "$1")
EOF
	for shared in "$1"/modules/*/skills/running-a-*/SKILL.md; do
		[ -f "$shared" ] || continue
		main=$(basename "$(dirname "$shared")")
		others=$(grep -Eo '[$][{]qory:skills/[^}]*[}]' "$shared" |
			grep -Fvx '${qory:skills/run-artifacts}')
		[ -z "$others" ] ||
			add "Move the skill reference out of $main, because an agent uses that skill: $others"
		shared_text=$(find "$(dirname "$shared")" -type f -name '*.md' | while IFS= read -r md; do
			prose "$md"
		done)
		for other in $known_skills; do
			case $other in
			run-artifacts | running-a-*) continue ;;
			*-*) ;;
			*) continue ;;
			esac
			printf '%s\n' "$shared_text" | tr '\n' ' ' |
				grep -Eiq "(^|[^[:alnum:]_-])$other([^[:alnum:]_-]|\$)" &&
				add "Remove the skill name $other from $main, because an agent uses that skill."
		done
	done
	for file in "$1"/modules/*/agents/*.md; do
		[ -f "$file" ] || continue
		main=$(grep -Eo '[$][{]qory:skills/running-a-[^}]*[}]' "$file" | head -n 1)
		[ -z "$main" ] ||
			add "Remove the reference $main from $file, because only a main session loads it."
	done
	[ -z "$OUT" ]
}

# rule_core_words DIR: rule 11, no file of DIR/modules/core, outside the skill
# simple-communication, contains a word of CORE_WORDS, in any case, or of PR_WORDS, by case,
# as a whole word, and no file of simple-communication contains software-factory. `.test(`
# does not count, and neither does the folder name `.git` when no letter, digit or `_` comes
# before the dot, so `app.git` counts. Each finding is a line, as <file>:<line>:<text>, with
# the path under modules/.
rule_core_words() {
	OUT=$(CDPATH= cd -- "$1/modules" 2>/dev/null &&
		find ./core -type f ! -path './core/skills/simple-communication/*' | sort |
		while IFS= read -r file; do
			grep -Iq '' "$file" || continue
			sed -E 's/[.]test[(]/.(/g; s/(^|[^[:alnum:]_])[.]git([^[:alnum:]_]|$)/\1.\2/g' "$file" \
				>"$TMP/core-words"
			{
				grep -n -i -E "(^|[^[:alnum:]_])($CORE_WORDS)([^[:alnum:]_]|\$)" "$TMP/core-words"
				grep -n -E "(^|[^[:alnum:]_])($PR_WORDS)([^[:alnum:]_]|\$)" "$TMP/core-words"
			} | sort -t: -k1,1n -u | sed "s|^|${file#./}:|"
		done
		find ./core/skills/simple-communication -type f 2>/dev/null | sort |
			while IFS= read -r file; do
				grep -Iq '' "$file" || continue
				grep -n -i -E '(^|[^[:alnum:]_])software-factory([^[:alnum:]_]|$)' "$file" |
					sed "s|^|${file#./}:|"
			done)
	[ -z "$OUT" ] && return 0
	OUT="Write these lines of modules/core without the words of software work that rule 11 of scripts/check.sh lists, or move the text to software-factory: core is for every kind of workspace.
$OUT"
	return 1
}

# rule_cjs DIR: rule 12, no file under DIR/modules ends in .js. Node loads a .js file as an
# ES module when the nearest package.json above it sets "type": "module", as a target
# repository may, and there require is not defined. Node loads a .cjs file as CommonJS under
# any package.json. Each finding is a line with its fix and the path under modules/.
rule_cjs() {
	OUT=$(CDPATH= cd -- "$1/modules" 2>/dev/null &&
		find . -type f -name '*.js' | sort | while IFS= read -r file; do
			printf 'Rename modules/%s to .cjs.\n' "${file#./}"
		done)
	[ -z "$OUT" ] && return 0
	reason="A module's scripts must load as CommonJS in a repository whose package.json"
	OUT="$OUT
$reason sets \"type\": \"module\"."
	return 1
}

# rule_citations DIR: rule 10, each citation `<skill> (SKILL.md:<ranges>: "<quote>")` in the
# checks scripts, each .cjs file under a skill running-a-*workflow of DIR/modules, names a skill
# of DIR/modules, each range lies inside its SKILL.md (from 1 up to the last line, with from at
# most to), and the quote is in one of the ranges. The rule joins the lines of a range with
# single spaces before it looks for the quote, so a quote may cross a line break. A citation
# with no quote is a finding, and so is each `(SKILL.md:` that the pattern of a citation does
# not match, such as a citation across two lines.
rule_citations() {
	OUT=
	find "$1"/modules/*/skills -path '*/skills/running-a-*workflow/*' -name '*.cjs' -type f \
		2>/dev/null | sort >"$TMP/scripts"
	[ -s "$TMP/scripts" ] || {
		add "Add the checks script under $1/modules/*/skills/running-a-workflow: the rule reads its citations."
		return 1
	}
	while IFS= read -r script; do
		citations "$1" "$script" "${script#"$1"/modules/*/skills/}"
	done <"$TMP/scripts"
	[ -z "$OUT" ]
}

# citations DIR FILE SHOWN: the checks of rule 10 on one script FILE, which the findings call
# SHOWN.
citations() {
	script=$2
	shown=$3
	grep -n '(SKILL\.md:' "$script" |
		sed -E 's/[a-z][a-z-]* \(SKILL\.md:[0-9][0-9, -]*(: "[^"]*")?\)//g' |
		grep '(SKILL\.md:' | cut -d: -f1 >"$TMP/unmatched"
	while IFS= read -r line; do
		add "Write the citation on line $line of $shown on one line, as <skill> (SKILL.md:<ranges>: \"<quote>\"): the rule matches no citation there."
	done <"$TMP/unmatched"
	while IFS= read -r citation; do
		[ -n "$citation" ] || continue
		case $citation in
		*'SKILL.md:'*': "'*'")') ;;
		*)
			add "Quote the rule in the citation $citation in $shown: write <skill> (SKILL.md:<ranges>: \"<quote>\")."
			continue
			;;
		esac
		name=${citation%% *}
		ranges=${citation#*SKILL.md:}
		quote=${ranges#*: \"}
		quote=${quote%\")}
		ranges=${ranges%%:*}
		file=
		for candidate in "$1"/modules/*/skills/"$name"/SKILL.md; do
			[ -f "$candidate" ] && file=$candidate
		done
		if [ -z "$file" ]; then
			add "Cite a skill of modules in $shown: $citation names no skill with a SKILL.md."
			continue
		fi
		count=$(wc -l <"$file" | tr -d ' ')
		bad=$(printf '%s\n' "$ranges" | tr ',' '\n' | awk -v n="$count" '{
			gsub(/ /, "")
			split($0, r, "-")
			from = r[1] + 0
			to = (r[2] == "" ? from : r[2] + 0)
			if (from < 1 || to < from || to > n) print $0
		}')
		if [ -n "$bad" ]; then
			add "Fix the citation $citation in $shown: $name has $count lines, so $(printf '%s' "$bad" | tr '\n' ' ')is no range of it."
			continue
		fi
		printf '%s\n' "$ranges" | tr ',' '\n' | awk -v file="$file" '{
			gsub(/ /, "")
			split($0, r, "-")
			from = r[1] + 0
			to = (r[2] == "" ? from : r[2] + 0)
			text = ""
			line = 0
			while ((getline row <file) > 0) {
				line++
				if (line >= from && line <= to) text = text " " row
			}
			close(file)
			gsub(/[ \t]+/, " ", text)
			print text
		}' | grep -qF -- "$quote" ||
			add "Fix the citation $citation in $shown: the quote is in none of the lines $ranges of $name."
	done <<EOF
$(grep -oE '[a-z][a-z-]* \(SKILL\.md:[0-9][0-9, -]*(: "[^"]*")?\)' "$script")
EOF
}

# fixture: makes a new directory $FIX with an agent $AGENT and a skill $SKILL that pass
# every rule, $SETTINGS with their allow rules, and the docs/modules.md of this repository,
# whose tier table rule 3 reads.
fixture() {
	FIX=$TMP/fixture
	rm -rf "$FIX"
	mkdir -p "$FIX/modules/core/agents" "$FIX/modules/core/skills/sample" \
		"$FIX/modules/software-factory/settings/claude" || exit 1
	AGENT=$FIX/modules/core/agents/sample-agent.md
	SKILL=$FIX/modules/core/skills/sample/SKILL.md
	SETTINGS=$FIX/modules/software-factory/settings/claude/settings.json
	good_agent >"$AGENT" || exit 1
	good_skill >"$SKILL" || exit 1
	good_settings >"$SETTINGS" || exit 1
	mkdir -p "$FIX/docs" && cp "$ROOT/docs/modules.md" "$FIX/docs/modules.md" || exit 1
}

good_agent() {
	cat <<'EOF'
---
name: sample-agent
description: Reads sample records, read-only. Use before a run writes about them.
tools: Read, Grep, Glob, Skill
---

You read sample records.

## Guardrails

You read only.

## The work

- ${qory:skills/sample}, first: what this step takes from the skill.

## Stop conditions

- If a skill cannot be loaded, report `blocked`.

## Expected output

A report as text.
EOF
}

good_skill() {
	cat <<'EOF'
---
name: sample
description: Load before you write a sample. Contains the rules of a sample.
---

# Sample

- ${qory:skills/other}, with
  ${qory:skills/another}: before you write the sample.
EOF
}

good_settings() {
	cat <<'EOF'
{
  "env": {
    "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS": "1"
  },
  "permissions": {
    "allow": [
      "Skill(harness:sample)",
      "Agent(harness:sample-agent)"
    ]
  }
}
EOF
}

# agent_with TEXT: writes $AGENT with the front matter lines TEXT, read as printf %b, in
# place of its tools line.
agent_with() {
	{
		printf '%s\n' '---' 'name: sample-agent'
		printf '%b\n' "$1"
		printf '%s\n' '---'
		good_agent | sed '1,5d'
	} >"$AGENT" || exit 1
}

# expect_broken TEXT WORD RULE ARGUMENT...: fails unless RULE rejects the fixture and OUT
# contains WORD.
expect_broken() {
	text=$1
	word=$2
	shift 2
	if "$@"; then
		OUT="$1 passed on $FIX"
		fail "$text"
	fi
	printf '%s\n' "$OUT" | grep -Fq -- "$word" || fail "$text"
	pass "$text"
}

# expect_broken_first TEXT WORD COMMAND...: as expect_broken, with WORD on the first line
# of OUT, where a reader looks for the fix.
expect_broken_first() {
	text=$1
	word=$2
	shift 2
	if "$@"; then
		OUT="$1 passed on $FIX"
		fail "$text"
	fi
	printf '%s\n' "$OUT" | sed -n 1p | grep -Fq -- "$word" || fail "$text"
	pass "$text"
}

# expect_passes TEXT RULE ARGUMENT...: fails unless RULE accepts the fixture.
expect_passes() {
	text=$1
	shift
	"$@" || fail "$text"
	pass "$text"
}

# agent_named NAME: renames $AGENT to NAME.md in the same folder.
agent_named() {
	mv "$AGENT" "${AGENT%/*}/$1.md" || exit 1
	AGENT=${AGENT%/*}/$1.md
}

# expect_same_with_bom TEXT FILE RULE: fails unless RULE gives the same exit status and the
# same output on the fixture after a byte order mark goes at the start of FILE.
expect_same_with_bom() {
	"$3" "$FIX"
	plain_rc=$?
	plain_out=$OUT
	{ printf '%s' "$BOM"; cat "$2"; } >"$2.new" && mv "$2.new" "$2" || exit 1
	"$3" "$FIX"
	bom_rc=$?
	if [ "$bom_rc" -ne "$plain_rc" ] || [ "$OUT" != "$plain_out" ]; then
		OUT="Without the byte order mark, exit status $plain_rc:
$plain_out
With it, exit status $bom_rc:
$OUT"
		fail "$1"
	fi
	pass "$1"
}

run "$ROOT" "$QORY" version
[ "$RC" -eq 0 ] || fail "qory version exits 0 (exit status $RC)"
printf '%s\n' "$OUT" | sed -n 1p

expect "qory config exits 0" 0 "$ROOT" "$QORY" config

# process.yaml sets withdrawable: false for acceptance-lock and build-ledger. Outside a run,
# qory reads that flag from the exported modules and exits 4 before it writes a file.
for type in acceptance-lock build-ledger; do
	LOCKED="qory artifact push $type --withdraw exits 4: process.yaml sets withdrawable: false"
	run "$ROOT" "$QORY" artifact push "$type" --name main --withdraw
	if [ "$RC" -ne 4 ] || ! printf '%s\n' "$OUT" |
		grep -Fq "The artifact type $type has withdrawable set to false"; then
		fail "$LOCKED (exit status $RC)"
	fi
	pass "$LOCKED"
done

# qory exits 2 for every error, so the check also requires the error text.
NORUNTIME="harness compose --dry-run without --runtime exits 2 with 'target.runtime is required'"
run "$ROOT" "$QORY" harness compose --dry-run
if [ "$RC" -ne 2 ] ||
	! printf '%s\n' "$OUT" | grep -Fq 'target.runtime is required'; then
	fail "$NORUNTIME (exit status $RC); qory.yaml in the repository, or a qory.yaml in a directory above the checkout, can set the runtime"
fi
pass "$NORUNTIME: the repository sets no runtime"

for runtime in claude codex; do
	expect "harness compose --dry-run --runtime $runtime exits 0" \
		0 "$ROOT" "$QORY" harness compose --dry-run --runtime "$runtime"
	expect_entry "harness compose --dry-run --runtime $runtime lists $ENTRY"
	expect_entry "harness compose --dry-run --runtime $runtime lists $VISUALS_ENTRY" \
		"$VISUALS_ENTRY"
	for entry_name in $CORE_ENTRIES; do
		expect_entry "harness compose --dry-run --runtime $runtime lists $entry_name" \
			"$entry_name"
	done
	for entry_name in $AUTHORING_ENTRIES; do
		expect_no_entry "harness compose --dry-run --runtime $runtime does not list $entry_name" \
			"$entry_name"
	done
done

# The checkout in $TMP/consumer extends the core stack of this repository by
# path. The path is a single-quoted YAML string, with each ' doubled.
run "$TMP/consumer" git init -q
[ "$RC" -eq 0 ] || fail "git init in $TMP/consumer exits 0 (exit status $RC)"
QROOT=$(printf '%s\n' "$ROOT" | sed "s/'/''/g")
printf "harness: {extends: {path: '%s', stack: core}}\n" "$QROOT" \
	>"$TMP/consumer/qory.yaml" || exit 1

expect "checkout extending core by path: harness compose --dry-run --runtime claude exits 0" \
	0 "$TMP/consumer" "$QORY" harness compose --dry-run --runtime claude
expect_entry "checkout extending core by path: harness compose --dry-run --runtime claude lists $ENTRY"

# The checkout in $TMP/software extends the software stack of this repository by
# path, as a checkout in a software-factory workspace does.
run "$TMP/software" git init -q
[ "$RC" -eq 0 ] || fail "git init in $TMP/software exits 0 (exit status $RC)"
printf "harness: {extends: {path: '%s', stack: software}}\n" "$QROOT" \
	>"$TMP/software/qory.yaml" || exit 1

for runtime in claude codex; do
	expect "checkout extending software by path: harness compose --dry-run --runtime $runtime exits 0" \
		0 "$TMP/software" "$QORY" harness compose --dry-run --runtime "$runtime"
	expect_entry "checkout extending software by path: harness compose --dry-run --runtime $runtime lists $SOFTWARE_ENTRY" \
		"$SOFTWARE_ENTRY"
	expect_entry "checkout extending software by path: harness compose --dry-run --runtime $runtime lists $VISUALS_ENTRY" \
		"$VISUALS_ENTRY"
	for entry_name in $ENTRY $CORE_ENTRIES $SOFTWARE_ENTRIES; do
		expect_entry "checkout extending software by path: harness compose --dry-run --runtime $runtime lists $entry_name" \
			"$entry_name"
	done
	for entry_name in $AUTHORING_ENTRIES; do
		expect_no_entry "checkout extending software by path: harness compose --dry-run --runtime $runtime does not list $entry_name" \
			"$entry_name"
	done
done

# A compose for Codex writes the modules' Codex settings into config.toml of the Codex home: the
# Stop hook of core that runs the end check, the PreToolUse and PreModelRequest hooks of core that
# run the tool guard and its step limit, and live web search off from software-factory. The core
# stack gets the hooks alone.
CODEX_CONFIG="$TMP/software/.qory/harness/codex/config.toml"
expect "checkout extending software by path: harness compose --runtime codex exits 0" \
	0 "$TMP/software" "$QORY" harness compose --runtime codex
for line in 'web_search = "disabled"' '[[hooks.Stop]]' 'hooks/end-gate-codex.cjs' \
	'[[hooks.PreToolUse]]' 'matcher = "*"' 'hooks/tool-guard-codex.cjs' \
	'[[hooks.PreModelRequest]]'; do
	if grep -Fq -- "$line" "$CODEX_CONFIG" 2>/dev/null; then
		pass "harness compose --runtime codex writes $line into config.toml"
	else
		fail "harness compose --runtime codex writes $line into $CODEX_CONFIG"
	fi
done
CORE_CODEX="$TMP/consumer/.qory/harness/codex/config.toml"
expect "checkout extending core by path: harness compose --runtime codex exits 0" \
	0 "$TMP/consumer" "$QORY" harness compose --runtime codex
for line in '[[hooks.Stop]]' 'hooks/end-gate-codex.cjs' '[[hooks.PreToolUse]]' \
	'matcher = "*"' 'hooks/tool-guard-codex.cjs' '[[hooks.PreModelRequest]]'; do
	grep -Fq -- "$line" "$CORE_CODEX" 2>/dev/null ||
		fail "core: harness compose --runtime codex writes $line into $CORE_CODEX"
	pass "core: harness compose --runtime codex writes $line into config.toml"
done
! grep -Fq 'web_search' "$CORE_CODEX" 2>/dev/null ||
	fail "core: harness compose --runtime codex writes no web_search into $CORE_CODEX"
pass "core: harness compose --runtime codex writes no web_search into config.toml"

# Gemini CLI and OpenCode have no workflow commands to list. The compose for each of them
# must still exit 0.
for runtime in gemini opencode; do
	expect "checkout extending software by path: harness compose --dry-run --runtime $runtime exits 0" \
		0 "$TMP/software" "$QORY" harness compose --dry-run --runtime "$runtime"
done

# The checkout in $TMP/authoring extends the authoring stack of this repository by path.
# From the core module, the stack takes only simple-communication.
run "$TMP/authoring" git init -q
[ "$RC" -eq 0 ] || fail "git init in $TMP/authoring exits 0 (exit status $RC)"
printf "harness: {extends: {path: '%s', stack: authoring}}\n" "$QROOT" \
	>"$TMP/authoring/qory.yaml" || exit 1

for runtime in claude codex; do
	expect "checkout extending authoring by path: harness compose --dry-run --runtime $runtime exits 0" \
		0 "$TMP/authoring" "$QORY" harness compose --dry-run --runtime "$runtime"
	for entry_name in $ENTRY $AUTHORING_ENTRIES; do
		expect_entry "checkout extending authoring by path: harness compose --dry-run --runtime $runtime lists $entry_name" \
			"$entry_name"
	done
	for entry_name in $VISUALS_ENTRY $SOFTWARE_ENTRY $CORE_ENTRIES $SOFTWARE_ENTRIES; do
		expect_no_entry "checkout extending authoring by path: harness compose --dry-run --runtime $runtime does not list $entry_name" \
			"$entry_name"
	done
done

# Each rule must fail on a bad file, so each bad file below breaks one rule. The first
# check shows that the files of the fixture break none.
fixture
for rule in rule_sections rule_tools rule_model rule_moments rule_words rule_allow rule_workflows rule_orchestrators rule_core_words; do
	expect_passes "fixture: $rule passes on the good files" "$rule" "$FIX"
done

for bad_section in 'Guardrails' 'Stop conditions' 'Expected output'; do
	fixture
	good_agent | grep -Fvx "## $bad_section" >"$AGENT"
	expect_broken "rule 1 fails on an agent with no ## $bad_section" "## $bad_section" rule_sections "$FIX"
	printf '\n```text\n## %s\n```\n' "$bad_section" >>"$AGENT"
	expect_broken "rule 1 fails on ## $bad_section only inside a code fence" "## $bad_section" rule_sections "$FIX"
	fixture
	good_agent | grep -Fvx "## $bad_section" |
		awk -v heading="## $bad_section" 'NR == 2 { print heading } { print }' >"$AGENT"
	expect_broken "rule 1 fails on ## $bad_section only inside the front matter" "## $bad_section" rule_sections "$FIX"
done
fixture
good_agent | sed 's/^## Guardrails$/## Guardrails  /' >"$AGENT"
expect_passes "rule 1 passes on a section heading with trailing whitespace" rule_sections "$FIX"
good_agent | awk '{ printf "%s\r\n", $0 }' >"$AGENT"
expect_passes "rule 1 passes on an agent with CRLF lines" rule_sections "$FIX"
# A byte order mark at the start of a file changes no result of rules 1, 2 and 4.
fixture
good_agent | grep -Fvx '## Guardrails' |
	awk 'NR == 2 { print "## Guardrails" } { print }' >"$AGENT"
expect_broken "rule 1 fails on ## Guardrails only inside the front matter, before a byte order mark" \
	"## Guardrails" rule_sections "$FIX"
expect_same_with_bom "rule 1 gives the same result on ## Guardrails only inside the front matter after a byte order mark" \
	"$AGENT" rule_sections
fixture
expect_same_with_bom "rule 1 gives the same result on a good agent after a byte order mark" \
	"$AGENT" rule_sections

for bad_tool in Bash Edit Write WebFetch WebSearch; do
	fixture
	good_agent | sed "s/^tools: .*/tools: Read, $bad_tool/" >"$AGENT"
	expect_broken "rule 2 fails on an agent with $bad_tool and no exception" "$bad_tool" rule_tools "$FIX"
	printf '\nTool exception: %s\n' "$bad_tool" >>"$AGENT"
	expect_broken "rule 2 fails on an exception for $bad_tool with no reason" "$bad_tool" rule_tools "$FIX"
	printf 'Tool exception: %s, because the role needs it.\n' "$bad_tool" >>"$AGENT"
	expect_passes "rule 2 passes on an exception for $bad_tool with a reason" rule_tools "$FIX"
done
for bad_tool in Agent NotebookEdit MultiEdit; do
	fixture
	good_agent | sed "s/^tools: .*/tools: Read, $bad_tool/" >"$AGENT"
	printf '\nTool exception: %s, because the role needs it.\n' "$bad_tool" >>"$AGENT"
	expect_broken "rule 2 fails on $bad_tool, also with an exception" "Remove $bad_tool" rule_tools "$FIX"
done
for bad_name in sample-reviewer code-explorer shape-planner; do
	bad_file=modules/core/agents/$bad_name.md
	fixture
	good_agent >"$FIX/$bad_file"
	expect_passes "rule 2 passes on the four read tools in $bad_name" rule_tools "$FIX"
	good_agent | sed 's/^tools: .*/tools: Read, Grep, Glob, Skill, Write/' >"$FIX/$bad_file"
	printf '\nTool exception: Write, because the role needs it.\n' >>"$FIX/$bad_file"
	expect_broken "rule 2 fails on Write in $bad_name, also with an exception" "Remove Write" rule_tools "$FIX"
	good_agent | sed 's/^tools: .*/tools: Read, Task/' >"$FIX/$bad_file"
	expect_broken "rule 2 fails on any other tool in $bad_name" "Remove Task" rule_tools "$FIX"
done
fixture
good_agent | sed 's/^tools: .*/tools: Read, Bash, Edit/' >"$AGENT"
printf '\nTool exception: Bash, because the role needs it.\n' >>"$AGENT"
expect_broken "rule 2 fails when an exception covers one of two tools" "Edit" rule_tools "$FIX"
fixture
agent_with 'description: Reads records.'
expect_broken "rule 2 fails on an agent with no tools key" "Add a tools key" rule_tools "$FIX"
for bad_value in 'tools:\n- Bash' \
	'tools:\n  - Bash' \
	'tools: [\n Read,\n Bash\n]' \
	'tools: Read,\n  Bash' \
	'tools: >-\n  Read, Bash' \
	'tools:\n  # The search tool.\n  - Bash' \
	'"tools": Read, Bash'; do
	fixture
	agent_with "$bad_value"
	expect_broken "rule 2 fails on Bash with no exception in: $bad_value" "Remove Bash" rule_tools "$FIX"
done
fixture
agent_with 'tools: Read, Bash'
printf '\n```text\nTool exception: Bash, because the role needs it.\n```\n' >>"$AGENT"
expect_broken "rule 2 fails on an exception inside a code fence" "Remove Bash" rule_tools "$FIX"
fixture
agent_with 'tools: Read\nhooks: Bash'
expect_passes "rule 2 stops reading the tools key at the next top-level key" rule_tools "$FIX"
fixture
agent_with 'tools:\n  # Bash is left out.\n  - Read'
expect_passes "rule 2 passes on a comment with the word Bash" rule_tools "$FIX"
fixture
agent_with 'Tool exception: Bash, because it runs a script.\ntools: Read, Bash'
expect_broken "rule 2 fails on an exception only inside the front matter, before a byte order mark" \
	"Remove Bash" rule_tools "$FIX"
expect_same_with_bom "rule 2 gives the same result on an exception only inside the front matter after a byte order mark" \
	"$AGENT" rule_tools
fixture
agent_with 'tools: Read, Bash'
printf '\nTool exception: Bash, because it runs a script.\n' >>"$AGENT"
expect_passes "rule 2 passes on an exception in the body, before a byte order mark" rule_tools "$FIX"
expect_same_with_bom "rule 2 gives the same result on an exception in the body after a byte order mark" \
	"$AGENT" rule_tools

# designer_fixture EXCEPTION RULE: writes the agent designer with the line EXCEPTION, and
# settings with the Bash allow rule RULE.
designer_fixture() {
	fixture
	mkdir -p "$FIX/modules/software-factory/agents" || exit 1
	{
		good_agent | sed 's/^name: .*/name: designer/; s/^tools: .*/tools: Read, Bash/'
		printf '\n%s\n' "$1"
	} >"$FIX/modules/software-factory/agents/designer.md"
	printf '{"permissions": {"allow": [%s], "deny": [%s]}}\n' "$2" "${3-$DRAFT_DENY, $RENDER_DENY}" >"$SETTINGS"
}
MOCKUP_RULES="$PACK_RULE, $RENDER_RULE"
designer_fixture "$DESIGNER_EXCEPTION" "$MOCKUP_RULES"
expect_passes "rule 2 passes on designer's exception, in the Bash exception check" rule_tools "$FIX"
expect_passes "rule 2 passes on designer's exception and the mockup scripts' allow rules" \
	rule_designer "$FIX"
CORE_SETTINGS_FIX=$FIX/modules/core/settings/claude/settings.json
designer_fixture "$DESIGNER_EXCEPTION" "$MOCKUP_RULES"
mkdir -p "$(dirname "$CORE_SETTINGS_FIX")" || exit 1
printf '{"permissions": {"allow": [%s]}}\n' "$VERSIONS_RULE, $CHECKS_RULE" >"$CORE_SETTINGS_FIX"
expect_passes "rule 2 passes on the versions and checks scripts' rules in the settings of core" \
	rule_designer "$FIX"
printf '{"permissions": {"allow": [%s]}}\n' "$CHECKS_RULE, \"Bash(node *)\"" >"$CORE_SETTINGS_FIX"
expect_broken "rule 2 fails on another Bash allow rule in the settings of core" \
	'Bash(node *)' rule_designer "$FIX"
designer_fixture "$DESIGNER_EXCEPTION" "$MOCKUP_RULES, $VERSIONS_RULE"
expect_broken "rule 2 fails on the versions script's rule in the settings of software-factory" \
	'running-a-workflow/versions.cjs' rule_designer "$FIX"
designer_fixture 'Tool exception: Bash, because the role needs it.' "$MOCKUP_RULES"
expect_broken "rule 2 fails on a designer exception that does not name both mockup scripts" \
	"Write this line as the Bash exception" rule_designer "$FIX"
designer_fixture 'Tool exception: Bash, because you run only the render script, `render-mockups.cjs`.' \
	"$MOCKUP_RULES"
expect_broken "rule 2 fails on the designer exception that names only the render script" \
	"Write this line as the Bash exception" rule_designer "$FIX"
designer_fixture "$DESIGNER_EXCEPTION" '"Read(a)"'
expect_broken "rule 2 fails on designer with no allow rule for the mockup scripts" \
	"Add" rule_designer "$FIX"
designer_fixture "$DESIGNER_EXCEPTION" "$RENDER_RULE"
expect_broken "rule 2 fails on designer with no allow rule for the pack script" \
	'pack-mockups.cjs' rule_designer "$FIX"
designer_fixture "$DESIGNER_EXCEPTION" "$MOCKUP_RULES, \"Bash(node *)\""
expect_broken "rule 2 fails on another Bash allow rule beside the mockup scripts'" \
	'Bash(node *)' rule_designer "$FIX"
designer_fixture "$DESIGNER_EXCEPTION" "$MOCKUP_RULES" '"Read(a)"'
expect_broken "rule 2 fails on designer with no deny rule for the draft folder" \
	'mockup-draft' rule_designer "$FIX"
designer_fixture "$DESIGNER_EXCEPTION" "$MOCKUP_RULES" "$DRAFT_DENY"
expect_broken "rule 2 fails on designer with no deny rule for the render folder" \
	'mockup-render' rule_designer "$FIX"
fixture
printf '{"permissions": {"allow": ["Bash"]}}\n' >"$SETTINGS"
expect_broken "rule 2 fails on a Bash allow rule with no agent named designer" \
	'"Bash"' rule_designer "$FIX"
fixture
expect_passes "rule 2 passes with no designer and no Bash allow rule" rule_designer "$FIX"

# Rule 3: the tier of the tier table passes, and a model id, another tier or anything else on
# the model line fails. sample-agent is not in the table, sample-reviewer has the tier
# thinking, and code-explorer has the tier fast.
MODEL_FIX="Remove the model key from modules/core/agents/sample-agent.md."
for pair in sample-reviewer:thinking code-explorer:fast demo-reviewer:fast \
	build-planner:thinking browser-demo-author:fast; do
	fixture
	agent_with "tools: Read\nmodel: \${qory:${pair#*:}}"
	agent_named "${pair%:*}"
	expect_passes "rule 3 passes on ${pair%:*} with the tier ${pair#*:}" rule_model "$FIX"
done
fixture
agent_with 'tools: Read\nmodel: ${qory:fast}'
agent_named sample-reviewer
expect_broken_first "rule 3 fails on a reviewer with the tier fast" \
	"Write model: \${qory:thinking} in modules/core/agents/sample-reviewer.md." rule_model "$FIX"
expect_broken "rule 3 names the tier it refuses and the table" \
	'The model key is set to ${qory:fast}, and docs/modules.md, section "Agents", lists sample-reviewer under the tier thinking.' \
	rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: ${qory:light}'
agent_named demo-reviewer
expect_broken_first "rule 3 fails on demo-reviewer with the tier light" \
	"Write model: \${qory:fast} in modules/core/agents/demo-reviewer.md." rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: ${qory:thinking}'
agent_named code-explorer
expect_broken_first "rule 3 fails on code-explorer with the tier thinking" \
	'Write model: ${qory:fast} in' rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: ${qory:thinking}\nmodel: ${qory:fast}'
agent_named sample-reviewer
expect_broken "rule 3 fails on a second model key with another tier" \
	'set to ${qory:fast}, and' rule_model "$FIX"
fixture
agent_named sample-reviewer
expect_broken_first "rule 3 fails on a reviewer with no model key" \
	"Add model: \${qory:thinking} to modules/core/agents/sample-reviewer.md." rule_model "$FIX"
expect_broken "rule 3 states that the reviewer runs on the main model" \
	'The front matter has no model key, so sample-reviewer runs on the main model' rule_model "$FIX"
for tier in light fast thinking; do
	fixture
	agent_with "tools: Read\nmodel: \${qory:$tier}"
	expect_broken_first "rule 3 fails on the tier $tier in an agent that the table does not list" \
		"Remove the model key from modules/core/agents/sample-agent.md." rule_model "$FIX"
	expect_broken "rule 3 states that the table lists no tier for the agent, for $tier" \
		"The model key is set to \${qory:$tier}, and docs/modules.md, section \"Agents\", lists no tier for sample-agent." \
		rule_model "$FIX"
done
fixture
agent_with 'tools: Read\n"model": "${qory:thinking}"'
agent_named sample-reviewer
expect_passes "rule 3 passes on a quoted model key and a quoted tier" rule_model "$FIX"
fixture
agent_with "tools: Read\nmodel: '\${qory:fast}'  # the tier of code-explorer"
agent_named code-explorer
expect_passes "rule 3 passes on a tier in single quotes with a comment" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: ${qory:fast}'
agent_named code-explorer
awk '{ printf "%s\r\n", $0 }' "$AGENT" >"$AGENT.new" && mv "$AGENT.new" "$AGENT"
expect_passes "rule 3 passes on a tier in CRLF front matter" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: ${qory:fast}'
agent_named sample-reviewer
expect_same_with_bom "rule 3 gives the same result on a wrong tier after a byte order mark" \
	"$AGENT" rule_model
fixture
good_agent | awk '{ print } /^tools:/ { print "model: sample-model-1" }' >"$AGENT"
expect_broken_first "rule 3 fails on an agent with a model id" "$MODEL_FIX" rule_model "$FIX"
expect_broken "rule 3 names the model id it refuses" "set to sample-model-1." rule_model "$FIX"
fixture
agent_with 'tools: Read\n"model": sample'
expect_broken_first "rule 3 fails on a quoted model key with a model id" "$MODEL_FIX" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: sample'
{ printf '\n'; cat "$AGENT"; } >"$AGENT.new" && mv "$AGENT.new" "$AGENT"
expect_broken_first "rule 3 fails on a model id after a blank first line" "$MODEL_FIX" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: sample'
awk '{ printf "%s\r\n", $0 }' "$AGENT" >"$AGENT.new" && mv "$AGENT.new" "$AGENT"
expect_broken_first "rule 3 fails on a model id in CRLF front matter" "$MODEL_FIX" rule_model "$FIX"
for bad_value in '${qory:heavy}' '${qory:skills/sample}' '${qory:Fast}' '${qory:fast}-1' \
	'sample ${qory:fast}' '"${qory:fast}' '${qory:fast}#high' '${qory: fast}' \
	'"${qory:fast} # x"'; do
	fixture
	agent_with "tools: Read\nmodel: $bad_value"
	expect_broken_first "rule 3 fails on the model value $bad_value" "$MODEL_FIX" rule_model "$FIX"
done
fixture
agent_with 'tools: Read\nmodel:'
expect_broken_first "rule 3 fails on a model key with no value" "$MODEL_FIX" rule_model "$FIX"
expect_broken "rule 3 states that the model key has no value" "has no value on its line" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: sample-model-1'
agent_named sample-reviewer
expect_broken_first "rule 3 fails on a model id in a listed agent, with its tier as the fix" \
	"Write model: \${qory:thinking} in modules/core/agents/sample-reviewer.md." rule_model "$FIX"
expect_broken "rule 3 names the model id and the tier of a listed agent" \
	'set to sample-model-1. docs/modules.md, section "Agents", lists sample-reviewer under the tier thinking.' \
	rule_model "$FIX"

# Rule 3: agent_tier reads the tier of each agent from the rows of the tier table, a name
# before a pattern, and a pattern only for a name that its row does not except.
ROWS=$(tier_rows "$ROOT")
for pair in demo-reviewer:fast sample-reviewer:thinking code-explorer:fast spec-writer:; do
	want=${pair#*:}
	got=$(agent_tier "${pair%:*}" "$ROWS")
	OUT="agent_tier ${pair%:*} prints '$got'."
	text="agent_tier gives ${pair%:*} ${want:+the tier }${want:-no tier}"
	[ "$got" = "$want" ] || fail "$text"
	pass "$text"
done
# tier_docs SED_SCRIPT: writes $FIX/docs/modules.md, the docs of this repository changed by
# SED_SCRIPT.
tier_docs() {
	mkdir -p "$FIX/docs" || exit 1
	sed "$1" "$ROOT/docs/modules.md" >"$FIX/docs/modules.md" || exit 1
}
fixture
expect_passes "rule 3 passes on the tier table of this repository" rule_tier_table "$FIX"
fixture
tier_docs '/^| `fast` |/a\
| `light` | `sample-light` |
'
expect_passes "rule 3 passes on a light row in the tier table" rule_tier_table "$FIX"
agent_with 'tools: Read\nmodel: ${qory:light}'
agent_named sample-light
expect_passes "rule 3 passes on an agent of the light row with the tier light" rule_model "$FIX"
agent_with 'tools: Read\nmodel: ${qory:fast}'
expect_broken_first "rule 3 fails on an agent of the light row with the tier fast" \
	'Write model: ${qory:light} in modules/core/agents/sample-light.md.' rule_model "$FIX"
fixture
tier_docs 's/ except `demo-reviewer`/ except `demo-reviewer` and `sample-reviewer`/'
expect_passes "rule 3 passes on a name that the *-reviewer row excepts and no row lists" \
	rule_tier_table "$FIX"
agent_named sample-reviewer
expect_passes "rule 3 passes on such a name with no model key" rule_model "$FIX"
agent_with 'tools: Read\nmodel: ${qory:thinking}'
expect_broken_first "rule 3 fails on such a name with a model key" \
	'Remove the model key from modules/core/agents/sample-reviewer.md.' rule_model "$FIX"
fixture
tier_docs 's/ except `demo-reviewer`//'
expect_broken_first "rule 3 fails when the docs drop the exception for demo-reviewer" \
	'In docs/modules.md, add except `demo-reviewer` to the `*-reviewer` row.' rule_tier_table "$FIX"
expect_broken "rule 3 names the row of demo-reviewer and the pattern that matches it" \
	'lists demo-reviewer under the tier fast, and the pattern *-reviewer of the tier thinking matches demo-reviewer.' \
	rule_tier_table "$FIX"
fixture
tier_docs '/^| `fast` |/s/ |$/, `demo-*` |/'
expect_broken_first "rule 3 fails on two patterns of different tiers that match a common name" \
	'In docs/modules.md, change `*-reviewer` or `demo-*`: no name may match both.' rule_tier_table "$FIX"
expect_broken "rule 3 states that the order of the rows would decide the tier" \
	'the pattern *-reviewer of the tier thinking and the pattern demo-* of the tier fast match a common name' \
	rule_tier_table "$FIX"
fixture
tier_docs 's/`build-planner`, /`build-planner`, `code-explorer`, /'
expect_broken_first "rule 3 fails on a name that rows of two tiers list" \
	'In docs/modules.md, list `code-explorer` in one row of the tier table.' rule_tier_table "$FIX"
expect_broken "rule 3 names both tiers of a name listed twice" \
	'lists code-explorer under the tiers thinking and fast' rule_tier_table "$FIX"
fixture
tier_docs 's/`build-planner`, /`build-planner`, `code-explorer`, /; /^| `fast` |/a\
| `light` | `code-explorer` |
'
expect_broken "rule 3 names all three tiers of a name listed three times" \
	'lists code-explorer under the tiers thinking, fast and light, and rule 3' rule_tier_table "$FIX"
fixture
tier_docs 's/`build-planner`, /`build-planner`, `demo-reviewer`, /; s/ and `demo-reviewer` |$/ |/'
expect_broken_first "rule 3 fails on a name that a row of its tier also excepts" \
	'In docs/modules.md, list or except `demo-reviewer` in the `thinking` rows, not both.' \
	rule_tier_table "$FIX"
fixture
tier_docs '/^| `fast` |/s/ |$/, `*-explorer` |/'
expect_passes "rule 3 passes on two patterns of different tiers with no common name" \
	rule_tier_table "$FIX"
fixture
tier_docs '/^| `fast` |/a\
| `light` | `sample-very-long-agent-name-reviewer` |
'
expect_broken_first "rule 3 shortens a long name in the first line" \
	'In docs/modules.md, add except `sample-very-long-agen...` to the `*-reviewer` row.' \
	rule_tier_table "$FIX"
for bad_tier in '| light | `sample-light` |' '| `thinkng` | `sample-light` |' '| `Light` | `sample-light` |'; do
	fixture
	tier_docs "/^| \`fast\` |/a\\
$bad_tier
"
	cell=$(printf '%s\n' "$bad_tier" | cut -d '|' -f 2 | sed 's/^ *//; s/ *$//')
	expect_broken_first "rule 3 fails on the tier cell $cell" \
		"In docs/modules.md, replace the tier $cell with \`light\`, \`fast\` or \`thinking\`." \
		rule_tier_table "$FIX"
done
fixture
tier_docs '/^| `fast` |/a\
| `light` | sample-light |
'
expect_broken_first "rule 3 fails on a name outside code font" \
	'In docs/modules.md, put sample-light of the `light` row in code font, or remove it.' rule_tier_table "$FIX"
fixture
tier_docs '/^| `fast` |/a\
| `light` | `sample-light`, a long text outside code font |
'
expect_broken_first "rule 3 shortens a long text outside code font in the first line" \
	'In docs/modules.md, put a long text outside c... of the `light` row in code font, or remove it.' \
	rule_tier_table "$FIX"
expect_broken "rule 3 states the whole text outside code font" \
	'has the text a long text outside code font outside code font' rule_tier_table "$FIX"
fixture
tier_docs '/^| `fast` |/a\
`light` | `sample-light` |
'
expect_passes "rule 3 passes on a row with no pipe at its start" rule_tier_table "$FIX"
OUT="agent_tier sample-light prints '$(agent_tier sample-light "$(tier_rows "$FIX")")'."
[ "$(agent_tier sample-light "$(tier_rows "$FIX")")" = light ] ||
	fail "agent_tier reads a row with no pipe at its start"
pass "agent_tier reads a row with no pipe at its start"
fixture
tier_docs '/^| `fast` |/a\
`Light` | `sample-light` |
'
expect_broken_first "rule 3 fails on a bad tier in a row with no pipe at its start" \
	'In docs/modules.md, replace the tier `Light` with `light`, `fast` or `thinking`.' \
	rule_tier_table "$FIX"
fixture
awk '{ printf "%s\r\n", $0 }' "$ROOT/docs/modules.md" >"$FIX/docs/modules.md" || exit 1
expect_passes "rule 3 passes on a tier table with CRLF lines" rule_tier_table "$FIX"
agent_with 'tools: Read\nmodel: ${qory:fast}'
agent_named code-explorer
expect_passes "rule 3 reads the tier of an agent from a tier table with CRLF lines" \
	rule_model "$FIX"
fixture
rm "$FIX/docs/modules.md"
expect_broken_first "rule 3 fails on a checkout with no tier table" \
	'Add the tier table to docs/modules.md, section "Agents".' rule_tier_table "$FIX"
fixture
agent_with 'tools: Read\nmodel: ${qory:fast}\nmodel: sample'
expect_broken "rule 3 fails on a second model key with a model id" "set to sample." rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel:\n  sample'
expect_broken "rule 3 fails on a model id on the next indented line" "has no value on its line" \
	rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel:\t${qory:fast}'
agent_named code-explorer
expect_passes "rule 3 passes on a tier after a tab" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel : ${qory:fast}'
agent_named code-explorer
expect_passes "rule 3 passes on a tier with a space before the colon" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodels: sample'
expect_passes "rule 3 passes on a models key" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmetadata:\n  model: sample'
expect_passes "rule 3 passes on an indented model key" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: opus'
{ printf '%s' "$BOM"; cat "$AGENT"; } >"$AGENT.new" && mv "$AGENT.new" "$AGENT"
expect_broken_first "rule 3 fails on a model id in a file that starts with a byte order mark" \
	"$MODEL_FIX" rule_model "$FIX"
fixture
printf '\nmodel: sample\n' >>"$AGENT"
expect_passes "rule 3 passes on the words model: in the body" rule_model "$FIX"

for bad in '- ${qory:skills/sample}' \
	'- ${qory:skills/sample}: the rules of the work.' \
	'- ${qory:skills/sample}, with ${qory:skills/other}: what it lists when a push fails.' \
	'- ${qory:skills/sample}: first-class rules.' \
	'- ${qory:skills/sample}: last names.' \
	'- ${qory:skills/sample}: next-of-kin.' \
	'- ${qory:skills/sample}: after-action notes.' \
	'- ${qory:skills/sample}: when' \
	'* ${qory:skills/sample}: the rules of the work.' \
	'+ ${qory:skills/sample}: the rules of the work.' \
	'1. ${qory:skills/sample}: the rules of the work.' \
	'-  ${qory:skills/sample}: the rules of the work.'; do
	fixture
	printf '%s\n' "$bad" >>"$SKILL"
	expect_broken "rule 4 fails on a skill with the item: $bad" "$bad" rule_moments "$FIX"
	fixture
	printf '%s\n' "$bad" >>"$AGENT"
	expect_broken "rule 4 fails on an agent with the item: $bad" "$bad" rule_moments "$FIX"
done
for good in '- ${qory:skills/sample}, ${qory:skills/other}, or ${qory:skills/another}: before you write.' \
	'- ${qory:skills/sample}: Before you write.' \
	'- ${qory:skills/sample}, First: what this step takes.' \
	'- ${qory:skills/sample}, last: what this step takes.' \
	'-  ${qory:skills/sample}: when you write.' \
	'* ${qory:skills/sample}: when you write.' \
	'+ ${qory:skills/sample}: when you write.' \
	'1. ${qory:skills/sample}: when you write.'; do
	fixture
	printf '%s\n' "$good" >>"$SKILL"
	expect_passes "rule 4 passes on the item: $good" rule_moments "$FIX"
done
fixture
printf '```text\n- ${qory:skills/sample}: the rules of the work.\n```\n' >>"$SKILL"
expect_passes "rule 4 passes on an item inside a code fence" rule_moments "$FIX"
fixture
printf '```text\n- ${qory:skills/sample}: the rules of the work.\n```\n' >"$SKILL"
expect_passes "rule 4 passes on a code fence on the first line, before a byte order mark" \
	rule_moments "$FIX"
expect_same_with_bom "rule 4 gives the same result on a code fence on the first line after a byte order mark" \
	"$SKILL" rule_moments
fixture
printf '%s\n' '- ${qory:skills/sample}: the rules of the work.' >"$SKILL"
expect_broken "rule 4 fails on an item on the first line, before a byte order mark" \
	'1: - ${qory:skills/sample}' rule_moments "$FIX"
expect_same_with_bom "rule 4 gives the same result on an item on the first line after a byte order mark" \
	"$SKILL" rule_moments
fixture
expect_same_with_bom "rule 4 gives the same result on a good agent after a byte order mark" \
	"$AGENT" rule_moments
fixture
mkdir -p "$FIX/modules/core/skills/group/grouped" || exit 1
good_skill >"$FIX/modules/core/skills/group/grouped/SKILL.md"
printf '%s\n' '- ${qory:skills/sample}: the rules of the work.' >>"$FIX/modules/core/skills/group/grouped/SKILL.md"
expect_broken "rule 4 fails on a skill in a group under skills" "group/grouped" rule_moments "$FIX"
for bad in '- `${qory:skills/sample}`: the rules of the work.' \
	'- **${qory:skills/sample}**: the rules of the work.' \
	'- **${qory:skills/sample}:** the rules of the work.'; do
	fixture
	printf '%s\n' "$bad" >>"$SKILL"
	expect_broken "rule 4 fails on the item: $bad" "$bad" rule_moments "$FIX"
done
for good in '- `${qory:skills/sample}`: before you write.' \
	'- **${qory:skills/sample}**: before you write.' \
	'- **${qory:skills/sample}:** before you write.' \
	'- `${qory:skills/sample}`, with `${qory:skills/other}`: before you write.'; do
	fixture
	printf '%s\n' "$good" >>"$SKILL"
	expect_passes "rule 4 passes on the item: $good" rule_moments "$FIX"
done
# A SKILL.md below a directory that has a SKILL.md is not a skill. The folder names sort
# before and after SKILL.md.
for inner in Notes references; do
	fixture
	mkdir -p "$FIX/modules/core/skills/sample/$inner" || exit 1
	printf '%s\n' '- ${qory:skills/sample}: the rules of the work.' \
		>"$FIX/modules/core/skills/sample/$inner/SKILL.md"
	expect_passes "rule 4 passes on a SKILL.md under the folder $inner of a skill" rule_moments "$FIX"
	expect_passes "rule 6 passes on a SKILL.md under the folder $inner of a skill" rule_allow "$FIX"
done

for bad_word in PRD whitelist blacklist slave; do
	fixture
	printf 'Write the %s first.\n' "$bad_word" >>"$SKILL"
	expect_broken "rule 5 fails on a skill with the word $bad_word" "$bad_word" rule_words "$FIX"
	fixture
	printf 'Write the %s first.\n' "$bad_word" >>"$AGENT"
	expect_broken "rule 5 fails on an agent with the word $bad_word" "$bad_word" rule_words "$FIX"
done
fixture
mkdir -p "$FIX/modules/core/skills/simple-communication/references" || exit 1
printf 'Replace whitelist.\n' >"$FIX/modules/core/skills/simple-communication/references/word-list.md"
expect_passes "rule 5 passes on the word list of simple-communication" rule_words "$FIX"
fixture
printf 'Run the sanity-check first.\n' >>"$SKILL"
expect_broken "rule 5 fails on the word sanity-check" "sanity-check" rule_words "$FIX"
fixture
printf 'Write the PRD first.\n' >"$FIX/modules/core/skills/sample/notes.txt"
expect_broken "rule 5 fails on a text file of a skill that is not Markdown" "notes.txt" rule_words "$FIX"
OUTER=$TMP/agents/checkout
mkdir -p "$OUTER/modules/core" || exit 1
printf 'Write the PRD first.\n' >"$OUTER/modules/core/notes.md"
expect_passes "rule 5 passes on a file outside agents and skills when the checkout's path has agents" rule_words "$OUTER"

fixture
good_settings | grep -Fv 'Skill(harness:sample)' >"$SETTINGS"
expect_broken "rule 6 fails on a skill with no allow rule" "Skill(harness:sample)" rule_allow "$FIX"
fixture
good_settings | grep -Fv 'Agent(harness:sample-agent)' >"$SETTINGS"
expect_broken "rule 6 fails on an agent with no allow rule" "Agent(harness:sample-agent)" rule_allow "$FIX"
fixture
sed 's/"allow"/"deny"/' "$SETTINGS" >"$FIX/composed.json"
expect_broken "rule 6 fails when a composed settings file has the rules only under deny" \
	"Skill(harness:sample)" rule_allow "$FIX" "$FIX/composed.json"
fixture
rm "$SETTINGS"
expect_broken "rule 6 fails with no settings file, and names both paths" \
	"Add the settings file $FIX/modules/core/settings/claude/settings.json or $FIX/modules/software-factory/settings/claude/settings.json: neither file exists." \
	rule_allow "$FIX"
fixture
cat >"$SETTINGS" <<'EOF'
{
  "permissions": {
    "allow": [],
    "deny": [
      "Skill(harness:sample)",
      "Agent(harness:sample-agent)"
    ]
  }
}
EOF
expect_broken "rule 6 fails on an empty allow list with the rules under deny" \
	"Skill(harness:sample)" rule_allow "$FIX"
fixture
printf '%s\n' '{"allow": ["Skill(harness:sample)", "Agent(harness:sample-agent)"], "permissions": {}}' >"$SETTINGS"
expect_broken "rule 6 fails on an allow list outside permissions" \
	"Skill(harness:sample)" rule_allow "$FIX"
fixture
printf '%s\n' '{"permissions": {"allow": ["Skill(harness:sample)", "Agent(harness:sample-agent)"]}}' >"$SETTINGS"
expect_passes "rule 6 passes on a one-line allow list" rule_allow "$FIX"
fixture
cat >"$SETTINGS" <<'EOF'
{
  "permissions": {
    "allow": [
      "Read(a[0])",
      "Skill(harness:sample)",
      "Agent(harness:sample-agent)"
    ]
  }
}
EOF
expect_passes "rule 6 passes on a rule with a bracket before the other rules" rule_allow "$FIX"
fixture
mkdir -p "$FIX/modules/core/skills/group/grouped" || exit 1
good_skill >"$FIX/modules/core/skills/group/grouped/SKILL.md"
expect_broken "rule 6 fails on a skill in a group under skills with no allow rule" \
	"Skill(harness:grouped)" rule_allow "$FIX"
fixture
printf '%s\n' '{"permissions": {"allow": ["Skill(harness:sample)", "Agent(harness:sample-agent)"], "deny": ["Skill(harness:sample)"]}}' >"$SETTINGS"
expect_broken "rule 6 fails on a rule in both allow and deny" "it is in both" rule_allow "$FIX"
fixture
printf '%s\n' '{"permissions": {"allow": ["Skill(harness:sample)", "Agent(harness:sample-agent)"], "deny": ["Read(./.env)"]}}' >"$SETTINGS"
expect_passes "rule 6 passes on a deny list with other rules" rule_allow "$FIX"
fixture
good_settings | sed 's/"Skill(harness:sample)",/"Skill(harness:sample)", "Skill(harness:gone)",/' >"$SETTINGS"
expect_broken "rule 6 fails on an allow rule for a skill that does not exist" \
	"Skill(harness:gone)" rule_allow "$FIX"
fixture
good_settings | sed 's/"Agent(harness:sample-agent)"/"Agent(harness:sample-agent)", "Agent(harness:gone)"/' >"$SETTINGS"
expect_broken "rule 6 fails on an allow rule for an agent that does not exist" \
	"Agent(harness:gone)" rule_allow "$FIX"
fixture
good_settings | sed 's/"Agent(harness:sample-agent)"/"Agent(harness:sample-agent)", "Read(sample)"/' >"$SETTINGS"
expect_passes "rule 6 passes on an allow rule for neither a skill nor an agent" rule_allow "$FIX"

fixture
expect_passes "rule 6 passes on settings that set the variable for the foreground" rule_background "$FIX"
fixture
printf '%s\n' '{"permissions": {"allow": []}}' >"$SETTINGS"
expect_broken "rule 6 fails on settings with no such variable" "$BACKGROUND_VAR" rule_background "$FIX"
fixture
printf '%s\n' '{"env": {"CLAUDE_CODE_DISABLE_BACKGROUND_TASKS": "0"}}' >"$SETTINGS"
expect_broken "rule 6 fails on settings that set the variable to 0" "$BACKGROUND_VAR" rule_background "$FIX"
fixture
printf '%s\n' '{"permissions": {"env": {"CLAUDE_CODE_DISABLE_BACKGROUND_TASKS": "1"}}}' >"$SETTINGS"
expect_broken "rule 6 fails on the variable outside the top-level env" "$BACKGROUND_VAR" rule_background "$FIX"
fixture
printf '%s\n' '{"env":{"CLAUDE_CODE_DISABLE_BACKGROUND_TASKS":1}}' >"$SETTINGS"
expect_broken "rule 6 fails on the variable set to a number" "$BACKGROUND_VAR" rule_background "$FIX"

fixture
REPORT=$FIX/report.json
printf '%s\n' '{"launch_env": {"claude": [{"name": "OTHER", "value": "0"}, {"name": "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "value": "1", "fixed": false}]}}' >"$REPORT"
expect_passes "rule 6 passes on a report with the variable under launch_env.claude" rule_launch_env "$REPORT"
printf '%s\n' '{"launch_env": {"claude": [{"name": "OTHER", "value": "1"}]}}' >"$REPORT"
expect_broken "rule 6 fails on a report with no such variable" "launch_env.claude" rule_launch_env "$REPORT"
printf '%s\n' '{"launch_env": {"claude": [{"name": "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "value": "0"}, {"name": "OTHER", "value": "1"}]}}' >"$REPORT"
expect_broken "rule 6 fails on a report with the variable set to 0" "launch_env.claude" rule_launch_env "$REPORT"
printf '%s\n' '{"launch_env": {"codex": [{"name": "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "value": "1"}]}}' >"$REPORT"
expect_broken "rule 6 fails on a report with the variable under another runtime" "launch_env.claude" rule_launch_env "$REPORT"
printf '%s\n' '{"target": {"claude": [{"name": "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "value": "1"}]}}' >"$REPORT"
expect_broken "rule 6 fails on a report with the variable outside launch_env" "launch_env.claude" rule_launch_env "$REPORT"

# workflow_skill FOLDER NAME: writes the skill in FOLDER, under the skills of a module, with
# NAME in its front matter.
workflow_skill() {
	mkdir -p "$FIX/modules/sample/skills/$1" || exit 1
	printf -- '%s\nname: %s\n%s\n' '---' "$2" '---' >"$FIX/modules/sample/skills/$1/SKILL.md"
}
# stack_with TEXT: writes a stack whose text after its name is TEXT, read as printf %b.
stack_with() {
	mkdir -p "$FIX/stacks/sample" || exit 1
	printf 'name: sample\n%b\n' "$1" >"$FIX/stacks/sample/qory-stack.yaml"
}

fixture
stack_with 'workflows:\n  sample-flow: {access: read}\nextending:\n  kinds: [skills]'
expect_broken "rule 7 fails on a workflow with no skill" "workflow-sample-flow" rule_workflows "$FIX"
workflow_skill sample-flow sample-flow
expect_broken "rule 7 fails on a workflow with only a skill of the plain name" \
	"workflow-sample-flow" rule_workflows "$FIX"
fixture
stack_with 'workflows:\n  sample-flow: {access: read}'
workflow_skill workflow-sample-flow workflow-sample-flow
expect_passes "rule 7 passes on a workflow and its skill" rule_workflows "$FIX"
fixture
stack_with 'workflows: {sample-flow: {access: read}, other-flow: {}}'
workflow_skill workflow-sample-flow workflow-sample-flow
expect_broken "rule 7 reads each workflow of a flow mapping" "workflow-other-flow" rule_workflows "$FIX"
fixture
stack_with 'workflows:\n  sample-flow:\n    access: read'
workflow_skill workflow-sample-flow workflow-sample-flow
expect_passes "rule 7 passes on a workflow with a nested key" rule_workflows "$FIX"
fixture
workflow_skill workflow-orphan workflow-orphan
expect_broken "rule 7 fails on a workflow skill that no stack lists" "workflows key" rule_workflows "$FIX"
fixture
stack_with 'workflows:\n  sample-flow: {access: read}\nextending:\n  kinds: [skills]'
workflow_skill workflow-sample-flow sample-flow
expect_broken "rule 7 fails on a workflow skill whose name differs from its folder" \
	"Set name: workflow-sample-flow" rule_workflows "$FIX"
fixture
stack_with 'workflows:\n  sample-flow: {access: read}'
workflow_skill group/workflow-sample-flow workflow-sample-flow
expect_passes "rule 7 passes on a workflow skill in a group under skills" rule_workflows "$FIX"
fixture
stack_with 'workflows:\n  sample-flow: {access: read}\nextending:\n  kinds: [skills]'
awk '{ printf "%s\r\n", $0 }' "$FIX/stacks/sample/qory-stack.yaml" >"$FIX/stacks/sample/new" &&
	mv "$FIX/stacks/sample/new" "$FIX/stacks/sample/qory-stack.yaml"
workflow_skill workflow-sample-flow workflow-sample-flow
expect_passes "rule 7 passes on a stack with CRLF lines" rule_workflows "$FIX"
fixture
stack_with 'workflows:\n  sample-flow: {access: read}'
workflow_skill workflow-sample-flow 'workflow-sample-flow # the name'
expect_passes "rule 7 passes on a name key with a comment" rule_workflows "$FIX"
fixture
workflow_skill group/workflow-orphan workflow-orphan
expect_broken "rule 7 fails on a workflow skill in a group that no stack lists" \
	"workflows key" rule_workflows "$FIX"
fixture
mkdir -p "$FIX/modules/core/skills/simple-communication" || exit 1
good_skill >"$FIX/modules/core/skills/simple-communication/SKILL.md"
expect_broken "rule 6 fails on simple-communication with no allow rule" \
	"Skill(harness:simple-communication)" rule_allow "$FIX"

# orchestrator_skill TEXT: writes the skill workflow-sample-flow with the body TEXT, read as
# printf %b.
orchestrator_skill() {
	workflow_skill workflow-sample-flow workflow-sample-flow
	printf '%b\n' "$1" >>"$FIX/modules/sample/skills/workflow-sample-flow/SKILL.md"
}
GOOD_BODY='This workflow requires subagents.\n\n- ${qory:skills/run-artifacts}: before step 1.\n\n1. Start ${qory:agents/sample-agent}.'

fixture
orchestrator_skill "$GOOD_BODY"
expect_passes "rule 8 passes on a workflow skill that orchestrates" rule_orchestrators "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"
expect_same_with_bom "rule 8 gives the same result on a workflow skill after a byte order mark" \
	"$FIX/modules/sample/skills/workflow-sample-flow/SKILL.md" rule_orchestrators
fixture
orchestrator_skill '1. Start ${qory:agents/sample-agent}.'
sed '1a\
description: This workflow requires subagents.' "$FIX/modules/sample/skills/workflow-sample-flow/SKILL.md" \
	>"$TMP/skill.new" && mv "$TMP/skill.new" "$FIX/modules/sample/skills/workflow-sample-flow/SKILL.md"
expect_broken "rule 8 fails on the sentence only inside the front matter, before a byte order mark" \
	"requires subagents" rule_orchestrators "$FIX"
expect_same_with_bom "rule 8 gives the same result on the sentence only inside the front matter after a byte order mark" \
	"$FIX/modules/sample/skills/workflow-sample-flow/SKILL.md" rule_orchestrators
fixture
orchestrator_skill "$GOOD_BODY"'\n- ${qory:skills/sample}: before step 2.'
expect_broken "rule 8 fails on a workflow skill that refers to another skill" \
	'qory:skills/sample' rule_orchestrators "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"
printf '%s\n' '- ${qory:skills/sample}: before step 2.' \
	>"$FIX/modules/sample/skills/workflow-sample-flow/notes.md"
expect_broken "rule 8 fails on a skill reference in another file of the workflow skill" \
	'qory:skills/sample' rule_orchestrators "$FIX"
fixture
orchestrator_skill 'This workflow requires subagents.\n\n- ${qory:skills/run-artifacts}: before step 1.'
expect_broken "rule 8 fails on a workflow skill that starts no agent" "Start an agent" \
	rule_orchestrators "$FIX"
fixture
orchestrator_skill '- ${qory:skills/run-artifacts}: before step 1.\n\n1. Start ${qory:agents/sample-agent}.'
expect_broken "rule 8 fails on a workflow skill with no sentence on subagents" "requires subagents" \
	rule_orchestrators "$FIX"
fixture
orchestrator_skill '```text\nThis workflow requires subagents.\n```\n\n1. Start ${qory:agents/sample-agent}.'
expect_broken "rule 8 fails on the sentence only inside a code fence" "requires subagents" \
	rule_orchestrators "$FIX"
fixture
orchestrator_skill 'This workflow requires subagents.\n\n```text\n${qory:agents/sample-agent}\n```'
expect_broken "rule 8 fails on an agent reference only inside a code fence" "Start an agent" \
	rule_orchestrators "$FIX"
fixture
orchestrator_skill 'This workflow requires subagents.'
mkdir -p "$FIX/modules/sample/skills/workflow-sample-flow/references" || exit 1
printf '%s\n' '1. Start ${qory:agents/sample-agent}.' \
	>"$FIX/modules/sample/skills/workflow-sample-flow/references/steps.md"
expect_broken "rule 8 fails on an agent reference only in references/" "Start an agent" \
	rule_orchestrators "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"'\n\nLoad `sample` before step 2.'
expect_broken "rule 8 fails on a sentence that loads another skill by its name" \
	"skill name sample" rule_orchestrators "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"'\n\nFollow the skill `sample` before step 2.'
expect_broken "rule 8 fails on a sentence that names another skill with any verb" \
	"skill name sample" rule_orchestrators "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"'\n\nBefore step 2, load the\nsample skill.'
expect_broken "rule 8 fails on such a sentence over two lines" "skill name sample" rule_orchestrators "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"
printf '%s\n' 'Load the skill sample first.' >"$FIX/modules/sample/skills/workflow-sample-flow/notes.md"
expect_broken "rule 8 fails on such a sentence in another file" "skill name sample" rule_orchestrators "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"'\n\nLoad this one skill. Read the sample-data file.'
expect_passes "rule 8 passes on a word that only contains another skill's name" rule_orchestrators "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"'\n\nFollow the skill `run-artifacts`.'
expect_passes "rule 8 passes on the name run-artifacts" rule_orchestrators "$FIX"
fixture
mkdir -p "$FIX/modules/sample/skills/running-a-workflow" || exit 1
printf '%s\n' 'Start ${qory:agents/sample-agent}, as ${qory:skills/run-artifacts} lists.' \
	>"$FIX/modules/sample/skills/running-a-workflow/SKILL.md"
expect_passes "rule 8 passes on running-a-workflow with an agent and run-artifacts" rule_orchestrators "$FIX"
orchestrator_skill "$GOOD_BODY"'\n- ${qory:skills/running-a-workflow}: before step 1.\n\nDecide as `running-a-workflow` lists.'
expect_passes "rule 8 passes on a reference to running-a-workflow and its name" rule_orchestrators "$FIX"
orchestrator_skill "$GOOD_BODY"'\n- ${qory:skills/running-a-workflow}: before step 1.\n- ${qory:skills/sample}: before step 2.'
expect_broken "rule 8 fails on another skill's reference beside running-a-workflow" \
	'qory:skills/sample' rule_orchestrators "$FIX"
orchestrator_skill "$GOOD_BODY"'\n- ${qory:skills/writing-specs}: before step 2.'
expect_broken "rule 8 fails on a workflow skill's reference to writing-specs" \
	'qory:skills/writing-specs' rule_orchestrators "$FIX"
fixture
mkdir -p "$FIX/modules/sample/skills/running-a-workflow" || exit 1
printf '%s\n' '- ${qory:skills/writing-specs}: before you write.' \
	>"$FIX/modules/sample/skills/running-a-workflow/SKILL.md"
expect_broken "rule 8 fails on running-a-workflow's reference to writing-specs" \
	'qory:skills/writing-specs' rule_orchestrators "$FIX"
fixture
printf '%s\n' '- ${qory:skills/running-a-workflow}: before you start.' >>"$AGENT"
expect_broken "rule 8 fails on an agent that loads running-a-workflow" \
	'Remove the reference ${qory:skills/running-a-workflow}' rule_orchestrators "$FIX"
fixture
printf '%s\n' 'The module software-factory has these agents.' >>"$SKILL"
expect_broken "rule 11 fails on a core text with the word software-factory" \
	'core/skills/sample/SKILL.md:' rule_core_words "$FIX"
fixture
printf '%s\n' 'Run the Tests before you push.' >>"$SKILL"
expect_broken "rule 11 fails on a planted software word in a core skill, in any case" \
	'core/skills/sample/SKILL.md:' rule_core_words "$FIX"
fixture
printf '%s\n' '// Write the spec.' >"$FIX/modules/core/skills/sample/check.cjs"
expect_broken "rule 11 fails on a software word in a script of core" \
	'core/skills/sample/check.cjs:1:// Write the spec.' rule_core_words "$FIX"
fixture
printf '%s\n' 'if (/^x/.test(line)) process.exit(1);' >"$FIX/modules/core/skills/sample/check.cjs"
mkdir -p "$FIX/modules/core/skills/simple-communication" "$FIX/modules/software-factory/skills/plain" ||
	exit 1
printf '%s\n' 'Write the commit message in the imperative.' \
	>"$FIX/modules/core/skills/simple-communication/SKILL.md"
printf '%s\n' 'Write the spec and run the tests.' >"$FIX/modules/software-factory/skills/plain/SKILL.md"
printf '%s\n' 'Specify the attests and the protest.' >>"$SKILL"
expect_passes "rule 11 passes on .test(, simple-communication, software-factory and words that contain one" \
	rule_core_words "$FIX"
for word in git GitHub pull_request branching diffing Specification; do
	fixture
	printf 'Read the %s first.\n' "$word" >>"$SKILL"
	expect_broken "rule 11 fails on the word $word in a core skill" \
		"core/skills/sample/SKILL.md:" rule_core_words "$FIX"
done
fixture
printf '%s\n' 'Leave out .git, and read `.git` and '"'"'.git'"'"' as folders.' >>"$SKILL"
printf '%s\n' "if (fs.existsSync(path.join(at, '.git'))) return start;" \
	>"$FIX/modules/core/skills/sample/check.cjs"
expect_passes "rule 11 passes on the folder name .git in a core skill and a script" \
	rule_core_words "$FIX"
fixture
printf '%s\n' 'Clone https://forge.example.com/acme/app.git first.' >>"$SKILL"
expect_broken "rule 11 fails on a name that ends in .git in a core skill" \
	'core/skills/sample/SKILL.md:' rule_core_words "$FIX"
fixture
printf '%s\n' 'Leave out .git, and run git status.' >>"$SKILL"
expect_broken "rule 11 fails on git status beside .git in a core skill" \
	'core/skills/sample/SKILL.md:' rule_core_words "$FIX"
fixture
printf '%s\n' 'Read .github and .GitHub/hooks.' >>"$SKILL"
expect_broken "rule 11 fails on the folder name .github in a core skill" \
	'core/skills/sample/SKILL.md:' rule_core_words "$FIX"
fixture
printf '%s\n' 'Open a PR for each change.' >>"$SKILL"
expect_broken "rule 11 fails on PR in upper case in a core skill" \
	'core/skills/sample/SKILL.md:' rule_core_words "$FIX"
fixture
printf '%s\n' 'Write a pr, a Pr or a PRO plan, and digit the gitter.' >>"$SKILL"
expect_passes "rule 11 passes on pr in other cases and on words that contain git or PR" \
	rule_core_words "$FIX"
fixture
mkdir -p "$FIX/modules/core/skills/simple-communication/references" || exit 1
printf '%s\n' 'The module Software-Factory uses this skill.' \
	>"$FIX/modules/core/skills/simple-communication/references/examples.md"
expect_broken "rule 11 fails on software-factory in simple-communication" \
	'core/skills/simple-communication/references/examples.md:1:' rule_core_words "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"'\n- ${qory:skills/workflow-other-flow}: when the plan lists it.\n\nFollow `workflow-other-flow` next.'
mkdir -p "$FIX/modules/sample/skills/workflow-other-flow" || exit 1
printf '%s\n' 'This workflow requires subagents. Start ${qory:agents/sample-agent}.' \
	>"$FIX/modules/sample/skills/workflow-other-flow/SKILL.md"
expect_passes "rule 8 passes on a workflow skill that refers to a workflow-* skill" rule_orchestrators "$FIX"
HIGH_BODY=$GOOD_BODY'\n- ${qory:skills/running-a-workflow}: before step 1.\n- ${qory:skills/workflow-other-flow}, ${qory:skills/workflow-third-flow}: when the plan lists it.'
# small_workflow NAME TEXT: writes the skill workflow-NAME with the line TEXT.
small_workflow() {
	mkdir -p "$FIX/modules/sample/skills/workflow-$1" || exit 1
	printf '%s\n' "$2" >"$FIX/modules/sample/skills/workflow-$1/SKILL.md"
}
SMALL_BODY='This workflow requires subagents. Start ${qory:agents/sample-agent}.'
fixture
orchestrator_skill "$HIGH_BODY"
small_workflow other-flow "$SMALL_BODY"
small_workflow third-flow "$SMALL_BODY"
expect_passes "rule 8 passes on a high-level skill with running-a-workflow and two workflow-* skills" \
	rule_orchestrators "$FIX"
orchestrator_skill "$HIGH_BODY"'\n- ${qory:skills/sample}: before step 2.'
expect_broken "rule 8 fails on another skill's reference in a high-level skill" \
	'qory:skills/sample' rule_orchestrators "$FIX"
fixture
mkdir -p "$FIX/modules/core/skills/visuals" "$FIX/modules/core/skills/writing-plans" || exit 1
good_skill >"$FIX/modules/core/skills/visuals/SKILL.md"
good_skill >"$FIX/modules/core/skills/writing-plans/SKILL.md"
orchestrator_skill "$GOOD_BODY"'\n\nThe writer adds visuals only when they help.'
expect_passes "rule 8 passes on a one-word skill name as an ordinary word" rule_orchestrators "$FIX"
orchestrator_skill "$GOOD_BODY"'\n\nLoad the skill visuals.'
expect_broken "rule 8 fails on a one-word skill name next to the word skill" \
	"skill name visuals" rule_orchestrators "$FIX"
orchestrator_skill "$GOOD_BODY"'\n\nRead `visuals` next.'
expect_broken "rule 8 fails on a one-word skill name in a code span" \
	"skill name visuals" rule_orchestrators "$FIX"
orchestrator_skill "$GOOD_BODY"'\n\nFollow writing-plans next.'
expect_broken "rule 8 fails on a skill name with a hyphen in plain words" \
	"skill name writing-plans" rule_orchestrators "$FIX"
fixture
mkdir -p "$FIX/modules/core/skills/visuals" "$FIX/modules/core/skills/writing-plans" \
	"$FIX/modules/sample/skills/running-a-workflow" || exit 1
good_skill >"$FIX/modules/core/skills/visuals/SKILL.md"
good_skill >"$FIX/modules/core/skills/writing-plans/SKILL.md"
printf '%s\n' 'Follow run-artifacts. The writer adds visuals only when they help.' \
	>"$FIX/modules/sample/skills/running-a-workflow/SKILL.md"
expect_passes "rule 8 passes on running-a-workflow with run-artifacts and a one-word name" \
	rule_orchestrators "$FIX"
printf '%s\n' 'Follow writing-plans next.' >"$FIX/modules/sample/skills/running-a-workflow/SKILL.md"
expect_broken "rule 8 fails on a skill name with a hyphen in running-a-workflow" \
	"skill name writing-plans from running-a-workflow" rule_orchestrators "$FIX"
printf '%s\n' '```text' 'Follow writing-plans next.' '```' \
	>"$FIX/modules/sample/skills/running-a-workflow/SKILL.md"
expect_passes "rule 8 passes on that name in a code fence of running-a-workflow" \
	rule_orchestrators "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"'\n\n```text\nLoad the skill sample first.\n```'
expect_passes "rule 8 passes on such a sentence inside a code fence" rule_orchestrators "$FIX"
fixture
mkdir -p "$FIX/modules/sample/skills/plain" || exit 1
printf '%s\n' '- ${qory:skills/sample}: before you write.' >"$FIX/modules/sample/skills/plain/SKILL.md"
expect_passes "rule 8 passes on a skill that is not a workflow's" rule_orchestrators "$FIX"

mkdir -p "$FIX/modules/core/skills/running-a-workflow" || exit 1
CITING=$FIX/modules/core/skills/running-a-workflow/checks.cjs
printf '%s\n' '// sample (SKILL.md:1-2, 3: "Contains the rules of a sample"): a rule.' \
	'// sample (SKILL.md:8-9: "with ${qory:skills/another}"): a quote across a line break.' \
	>"$CITING"
expect_passes "rule 10 passes on quotes inside the cited lines of the skill" rule_citations "$FIX"
printf '// sample (SKILL.md:1-2): a rule.\n' >"$CITING"
expect_broken "rule 10 fails on a citation with no quote" "Quote the rule" rule_citations "$FIX"
printf '// sample (SKILL.md:1-2: "Contains the rules"): a rule.\n' >"$CITING"
expect_broken "rule 10 fails on a quote outside the cited lines" "the quote is in none" \
	rule_citations "$FIX"
printf '// sample (SKILL.md:2-900: "name"): a rule.\n' >"$CITING"
expect_broken "rule 10 fails on a range past the end of the skill" "2-900" rule_citations "$FIX"
printf '// sample (SKILL.md:5-3: "name"): a rule.\n' >"$CITING"
expect_broken "rule 10 fails on a range that ends before it starts" "5-3" rule_citations "$FIX"
printf '// gone (SKILL.md:1: "name"): a rule.\n' >"$CITING"
expect_broken "rule 10 fails on a skill that does not exist" "gone (SKILL.md:1" rule_citations "$FIX"
printf '%s\n' '// sample (SKILL.md:1-2, 3: "Contains the rules' '// of a sample"): a rule.' >"$CITING"
expect_broken "rule 10 fails on a citation across two lines" \
	"line 1 of running-a-workflow/checks.cjs" rule_citations "$FIX"
printf '// sample (SKILL.md:1: "name"): a rule.\n' >"$CITING"
mkdir -p "$FIX/modules/sample/skills/running-a-sample-workflow/types" || exit 1
printf '// sample (SKILL.md:1-2: "Contains the rules"): a rule.\n' \
	>"$FIX/modules/sample/skills/running-a-sample-workflow/types/sample.cjs"
expect_broken "rule 10 fails on a citation in a script of another running-a-* skill" \
	"in running-a-sample-workflow/types/sample.cjs: the quote is in none" rule_citations "$FIX"

fixture
printf '%s\n' "'use strict';" >"$FIX/modules/core/skills/sample/check.js"
expect_broken_first "rule 12 fails on a .js script under modules/" \
	'Rename modules/core/skills/sample/check.js to .cjs.' rule_cjs "$FIX"
printf '%s\n' "$OUT" | grep -Fq 'package.json sets "type": "module"' ||
	fail "rule 12 states why a module's scripts end in .cjs"
pass "rule 12 states why a module's scripts end in .cjs"
fixture
printf '%s\n' "'use strict';" >"$FIX/modules/core/skills/sample/check.cjs"
expect_passes "rule 12 passes on a .cjs script under modules/" rule_cjs "$FIX"

# The rules, on the files of this repository.
rule_sections "$ROOT" || fail "rule 1: each agent has the three required sections"
pass "rule 1: each agent has the three required sections"
rule_tools "$ROOT" || fail "rule 2: each agent's Bash, Edit or Write has a stated exception"
pass "rule 2: each agent's Bash, Edit or Write has a stated exception"
rule_designer "$ROOT" || fail "rule 2: designer's Bash is the pack and render scripts, and Bash rules add only the versions and checks scripts"
pass "rule 2: designer's Bash is the pack and render scripts, and Bash rules add only the versions and checks scripts"
rule_model "$ROOT" || fail "rule 3: an agent's model key is a tier"
pass "rule 3: an agent's model key is a tier"
rule_tier_table "$ROOT" || fail "rule 3: rule 3 reads each row of the tier table of docs/modules.md"
pass "rule 3: rule 3 reads each row of the tier table of docs/modules.md"
rule_moments "$ROOT" || fail "rule 4: each listed skill states its moment"
pass "rule 4: each listed skill states its moment"
rule_words "$ROOT" || fail "rule 5: no agent or skill has a banned word"
pass "rule 5: no agent or skill has a banned word"

rule_workflows "$ROOT" || fail "rule 7: each workflow of a stack and its skill match"
pass "rule 7: each workflow of a stack and its skill match"
rule_orchestrators "$ROOT" || fail "rule 8: each workflow skill orchestrates"
pass "rule 8: each workflow skill orchestrates"
rule_citations "$ROOT" || fail "rule 10: each citation of the checks script quotes its skill"
pass "rule 10: each citation of the checks script quotes its skill"
rule_core_words "$ROOT" || fail "rule 11: no text of core contains a word of software work"
pass "rule 11: no text of core contains a word of software work"
rule_cjs "$ROOT" || fail "rule 12: each script under modules/ ends in .cjs"
pass "rule 12: each script under modules/ ends in .cjs"
rule_background "$ROOT" || fail "rule 6: the settings of software-factory set the variable for the foreground"
pass "rule 6: the settings of software-factory set the variable for the foreground"
rule_allow "$ROOT" || fail "rule 6: the settings of software-factory allow each skill and agent"
pass "rule 6: the settings of software-factory allow each skill and agent"
# These tests need node and no browser.
expect "the pack script's tests pass" 0 "$ROOT" node --test scripts/pack-mockups.test.js
expect "the render script's tests pass" 0 "$ROOT" node --test scripts/render-mockups.test.js
expect "the versions script's tests pass" 0 "$ROOT" node --test scripts/versions.test.js
# The tests of the check runners: run, scope, freeze, diff and probe in git checkouts.
expect "the check runners' tests pass" 0 "$ROOT" node --test scripts/runners.test.js
# The tests of the proof of the fast track: prove, and the proof in check and end, in git
# checkouts.
expect "the proof tests pass" 0 "$ROOT" node --test scripts/proof.test.js
# The tests of the comment proof for shell and Python files, which skip when the interpreters
# are not at the absolute paths of the module (PROOF_TEST_BASH and PROOF_TEST_PYTHON).
expect "the comment proof tests pass" 0 "$ROOT" node --test scripts/proof-comments.test.js
# The tests of the proofs that need a parser, which skip when the pinned parsers are not in
# /opt/qory/parsers/node_modules or in PROOF_TEST_PARSERS.
expect "the parser proof tests pass" 0 "$ROOT" node --test scripts/proof-parsers.test.js
# The checks script's tests break each rule in a copy of the testdata, and watch the check
# fail.
expect "the checks script's tests pass" 0 "$ROOT" node --test scripts/checks.test.js
# The tests of the types of Build and Verify: their JSON Schemas against process.yaml and the
# 40 samples, and each rule of each type in check and push.
expect "the checks of Build and Verify pass their tests" 0 "$ROOT" node --test scripts/build-verify.test.js
# The tests of the findings of a change: a proof per finding, and a closure with its proof.
expect "the findings tests pass" 0 "$ROOT" node --test scripts/findings.test.js
# The tests of the notes in an agent's start: the notes verb, and the report check of the list
# "Notes read:".
expect "the notes tests pass" 0 "$ROOT" node --test scripts/notes.test.js
# The tests of the build ledger: step begin, step end and resume on a checkout with a qory
# stub, whose push runs the push check of build-ledger.
expect "the build ledger's tests pass" 0 "$ROOT" node --test scripts/ledger.test.js
# The tests of the lock on the acceptance checks: lock, lock --verify, and a cancelled run's
# lock in the check and the push of acceptance-lock.
expect "the lock tests pass" 0 "$ROOT" node --test scripts/lock.test.js
# The tests of the guard of tool calls, with the hook input of Claude Code and of Codex.
expect "the tool guard's tests pass" 0 "$ROOT" node --test scripts/tool-guard.test.js
# The tests of the preflight: the browser, the app of the serve command and the sign-in of
# the demo scripts. The sign-in tests start a browser, and skip when the machine has none.
expect "the preflight tests pass" 0 "$ROOT" node --test scripts/preflight.test.js
# Rule 9: the testdata passes the push programs of core and software-factory, which run the
# push form of the checks script. $TMP/artifacts is a copy
# with version 1 of the acceptance criteria and the questions, which the checks of the
# decision record, the demo scenarios and the replies read. $TMP/questions is a copy whose
# questions version 1 has only q1, q2 and q4, so that the limits of new questions run on the
# other questions.
PUSH=$ROOT/modules/software-factory/skills/running-a-software-workflow/workflow-checks.cjs
CORE_PUSH=$ROOT/modules/core/scripts/push-check.cjs
cp -R "$TESTDATA" "$TMP/artifacts" || exit 1
for type in acceptance-criteria questions; do
	case $type in
	questions) file=questions.json ;;
	*) file=$type.md ;;
	esac
	mkdir -p "$TMP/artifacts/$type/main/v1" && cp "$TESTDATA/$file" "$TMP/artifacts/$type/main/v1/" ||
		exit 1
done
expect "rule 9: the testdata's proposal passes every check" 0 "$TMP/artifacts" node "$PUSH" \
	push proposal proposal.md sources.json delayed-order-reply.svg
cp -R "$TESTDATA" "$TMP/questions" && mkdir -p "$TMP/questions/questions/main/v1" || exit 1
node -e '
const fs = require("fs");
const [from, to] = process.argv.slice(1);
const data = JSON.parse(fs.readFileSync(from, "utf8"));
data.questions = data.questions.filter((question) => ["q1", "q2", "q4"].includes(question.id));
fs.writeFileSync(to, JSON.stringify(data, null, 2));
' "$TESTDATA/questions.json" "$TMP/questions/questions/main/v1/questions.json" || exit 1
expect "rule 9: the testdata's new questions pass their limits" 0 "$TMP/questions" node "$CORE_PUSH" \
	push questions questions.json
printf '%s\n' "$OUT" | grep -Fq 'limits of new questions' ||
	fail "rule 9: the check of the testdata's questions ran the limits of new questions"
pass "rule 9: the check of the testdata's questions ran the limits of new questions"
for type in spec acceptance-criteria decision-record demo-scenarios; do
	expect "rule 9: the testdata's $type passes every check" 0 "$TMP/artifacts" node "$PUSH" \
		push "$type" "$type.md"
done
for type in questions review-comments; do
	expect "rule 9: the testdata's $type passes every check of core" 0 "$TMP/artifacts" \
		node "$CORE_PUSH" push "$type" "$type.json"
done
expect "rule 9: the push program of core refuses a type of software-factory" 2 "$TMP/artifacts" \
	node "$CORE_PUSH" push spec spec.md

# push_types FILE: the type, the module and the types that each push check reads in the
# push-checks.json FILE that a compose wrote, one <type>:<module>:<reads> per line.
push_types() {
	node -e '
const checks = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).push_checks;
for (const check of checks) console.log(`${check.type}:${check.module}:${(check.reads || []).join(",")}`);
' "$1"
}
CORE_CHECKS='questions:core:
review-comments:core:questions'
SOFTWARE_CHECKS='acceptance-criteria:software-factory:
acceptance-lock:software-factory:acceptance-criteria
build-ledger:software-factory:
build-plan:software-factory:acceptance-criteria
build-report:software-factory:
decision-record:software-factory:acceptance-criteria,questions
demo-evidence:software-factory:demo-script
demo-scenarios:software-factory:acceptance-criteria
demo-script:software-factory:demo-scenarios
demo-video:software-factory:demo-script
explainer:software-factory:verification,acceptance-criteria
proposal:software-factory:
questions:core:
review-comments:core:questions
screenshot:software-factory:demo-script
spec:software-factory:
submission:software-factory:
verification:software-factory:acceptance-criteria'
# The composes of the core stack, earlier, and of the software stack wrote push-checks.json.
[ "$(push_types "$TMP/consumer/.qory/harness/push-checks.json")" = "$CORE_CHECKS" ] ||
	fail "the core stack's push-checks.json has the checks of questions and review-comments"
pass "the core stack's push-checks.json has the checks of questions and review-comments"
[ "$(push_types "$TMP/software/.qory/harness/push-checks.json")" = "$SOFTWARE_CHECKS" ] ||
	fail "the software stack's push-checks.json has the checks of core and the 16 of software-factory"
pass "the software stack's push-checks.json has the checks of core and the 16 of software-factory"
# The authoring stack composes only simple-communication of core, and still gets the push
# program of core, which lies outside every entry.
expect "checkout extending authoring by path: harness compose --no-links --runtime claude exits 0" \
	0 "$TMP/authoring" "$QORY" harness compose --no-links --runtime claude
[ "$(push_types "$TMP/authoring/.qory/harness/push-checks.json")" = "$CORE_CHECKS" ] ||
	fail "the authoring stack's push-checks.json has the checks of questions and review-comments"
pass "the authoring stack's push-checks.json has the checks of questions and review-comments"
expect "the push program of core in the authoring stack's home passes the testdata's questions" \
	0 "$TMP/artifacts" node "$TMP/authoring/.qory/harness/modules/core/scripts/push-check.cjs" \
	push questions questions.json

# The checks script loads a workflow-checks.cjs only from a skill folder whose hash is in
# modules/core/skills/running-a-workflow/trusted-checks.json. Each runtime's skills folder
# of the software stack loads the checks of software-factory.
for runtime in codex gemini cursor copilot claude; do
	expect "checkout extending software by path: harness compose --no-links --runtime $runtime exits 0" \
		0 "$TMP/software" "$QORY" harness compose --no-links --runtime "$runtime"
done
find -L "$TMP/software/.qory/harness" -path '*/running-a-workflow/checks.cjs' 2>/dev/null |
	sort >"$TMP/checks-scripts"
[ "$(wc -l <"$TMP/checks-scripts")" -ge 8 ] ||
	fail "the software stack's home has checks.cjs in the skills folder of each runtime: $(cat "$TMP/checks-scripts")"
while IFS= read -r script; do
	expect "the software stack's ${script#"$TMP/software/.qory/harness/"} checks the testdata's spec" \
		0 "$TMP/artifacts" node "$script" push spec spec.md
done <"$TMP/checks-scripts"
# $TMP/layer extends the software stack and appends the module team from the checkout. Its
# skill x has a workflow-checks.cjs whose code writes $TMP/marker when it loads.
LAYER=$TMP/layer
mkdir -p "$LAYER/team/skills/x" || exit 1
run "$LAYER" git init -q
[ "$RC" -eq 0 ] || fail "git init in $LAYER exits 0 (exit status $RC)"
printf 'apiVersion: qory.dev/v1alpha1\nname: team\n' >"$LAYER/team/qory-module.yaml" || exit 1
printf -- '---\nname: x\ndescription: Load it to read notes.\n---\n\n# Notes\n' \
	>"$LAYER/team/skills/x/SKILL.md" || exit 1
MARKER=$TMP/marker
marked_checks() {
	printf '%s\n' "require('node:fs').writeFileSync('$MARKER', 'ran');" \
		'module.exports = () => ({ types: [] });' >"$1"
}
marked_checks "$LAYER/team/skills/x/workflow-checks.cjs" || exit 1
printf "harness:\n  extends: {path: '%s', stack: software}\n  modules:\n    - name: team\n      source: {path: ./team}\n" \
	"$QROOT" >"$LAYER/qory.yaml" || exit 1
expect "checkout appending a module to software: harness compose --no-links --runtime claude exits 0" \
	0 "$LAYER" "$QORY" harness compose --no-links --runtime claude
LHOME=$LAYER/.qory/harness
REFUSED="Remove skills/x/workflow-checks.cjs from team: only the stack's modules add checks."
# refused TEXT DIR COMMAND...: COMMAND, run in DIR, exits 3 with REFUSED, and the marker does
# not exist.
refused() {
	text=$1
	shift
	expect "$text" 3 "$@"
	printf '%s\n' "$OUT" | grep -Fq -- "$REFUSED" || fail "$text: the output lacks $REFUSED"
	[ ! -e "$MARKER" ] || fail "$text: the code of the refused file ran"
	pass "$text: the code of the refused file did not run"
}
refused "a module of the checkout stops checks.cjs push in claude's skills folder" \
	"$TMP/artifacts" node "$LHOME/claude/plugin/skills/running-a-workflow/checks.cjs" \
	push questions questions.json
refused "a module of the checkout stops the push check of core" \
	"$TMP/artifacts" node "$LHOME/modules/core/scripts/push-check.cjs" push questions questions.json
refused "a module of the checkout stops the push check of software-factory" \
	"$TMP/artifacts" node \
	"$LHOME/modules/software-factory/skills/running-a-software-workflow/workflow-checks.cjs" \
	push spec spec.md
# $TMP/linked appends the module team, whose skill x is a copy of running-a-software-workflow
# with workflow-checks.cjs as a link to a byte-identical copy in team/evil. require would load
# the lib/documents.cjs beside the link's target, which writes the marker.
TRUSTED_SKILL=$ROOT/modules/software-factory/skills/running-a-software-workflow
LINKED=$TMP/linked
mkdir -p "$LINKED/team/skills" || exit 1
run "$LINKED" git init -q
[ "$RC" -eq 0 ] || fail "git init in $LINKED exits 0 (exit status $RC)"
cp "$LAYER/team/qory-module.yaml" "$LINKED/team/" &&
	cp -R "$TRUSTED_SKILL" "$LINKED/team/skills/x" &&
	cp -R "$TRUSTED_SKILL" "$LINKED/team/evil" &&
	sed 's/^name: running-a-software-workflow$/name: x/' "$TRUSTED_SKILL/SKILL.md" \
		>"$LINKED/team/skills/x/SKILL.md" &&
	marked_checks "$LINKED/team/evil/lib/documents.cjs" &&
	rm "$LINKED/team/skills/x/workflow-checks.cjs" &&
	ln -s ../../evil/workflow-checks.cjs "$LINKED/team/skills/x/workflow-checks.cjs" &&
	cp "$LAYER/qory.yaml" "$LINKED/" || exit 1
for links in --no-links ''; do
	expect "checkout appending a linked workflow-checks.cjs: harness compose $links --runtime claude exits 0" \
		0 "$LINKED" "$QORY" harness compose $links --runtime claude
	refused "a linked workflow-checks.cjs (compose $links) stops checks.cjs push in claude's skills folder" \
		"$TMP/artifacts" node "$LINKED/.qory/harness/claude/plugin/skills/running-a-workflow/checks.cjs" \
		push questions questions.json
	refused "a linked workflow-checks.cjs (compose $links) stops the push check of core" \
		"$TMP/artifacts" node "$LINKED/.qory/harness/modules/core/scripts/push-check.cjs" \
		push questions questions.json
done
# A skill that a session writes into the composed home is refused too.
REFUSED="Remove skills/later/workflow-checks.cjs from "
mkdir -p "$TMP/software/.qory/harness/claude/plugin/skills/later" || exit 1
marked_checks "$TMP/software/.qory/harness/claude/plugin/skills/later/workflow-checks.cjs" || exit 1
refused "a skill written into the software stack's home stops checks.cjs push" \
	"$TMP/artifacts" node "$TMP/software/.qory/harness/claude/plugin/skills/running-a-workflow/checks.cjs" \
	push questions questions.json
rm -rf "$TMP/software/.qory/harness/claude/plugin/skills/later"
# This compose writes into $TMP/software, so that the check can read the composed settings.
expect "checkout extending software by path: harness compose --no-links --runtime claude exits 0" \
	0 "$TMP/software" "$QORY" harness compose --no-links --runtime claude
rule_allow "$ROOT" "$TMP/software/.qory/harness/claude/settings.json" ||
	fail "rule 6: the settings composed for the software stack on claude allow each skill and agent"
pass "rule 6: the settings composed for the software stack on claude allow each skill and agent"
rule_launch_env "$TMP/software/.qory/harness-report.json" ||
	fail "rule 6: the compose report of the software stack lists the variable under launch_env.claude"
pass "rule 6: the compose report of the software stack lists the variable under launch_env.claude"
# A user's settings file cannot switch off the hooks, such as the end check's Stop hook.
OUT=
node -e '
const settings = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
process.exit(settings.disableAllHooks === false ? 0 : 1);
' "$TMP/software/.qory/harness/claude/settings.json" ||
	fail "the settings composed for the software stack on claude set disableAllHooks to false"
pass "the settings composed for the software stack on claude set disableAllHooks to false"
# core_claude_settings FILE: the composed Claude settings FILE have what the settings of core
# add: the Stop hook, the PreToolUse hook of the tool guard for every tool, with onFailure
# "block" on each PreToolUse command hook, its PostToolBatch
# hook of the step limit, the 3 deny rules of .reports/*.json and the 3 of the locks and their
# files, .reports/*.json.lock*, and the allow rules of the skill running-a-workflow and of its
# versions and checks scripts.
core_claude_settings() {
	node -e '
const settings = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const stop = JSON.stringify((settings.hooks || {}).Stop || []);
const pre = (settings.hooks || {}).PreToolUse || [];
// Each PreToolUse command hook blocks the call when the guard fails or times out.
const blocks = pre.every((group) => (group.hooks || []).every((hook) =>
	hook.type !== "command" || hook.onFailure === "block"));
const guard = blocks && pre.some((group) =>
	group.matcher === "*" &&
	JSON.stringify(group.hooks || []).includes("hooks/tool-guard-claude.cjs")) &&
	JSON.stringify((settings.hooks || {}).PostToolBatch || []).includes("hooks/tool-guard-claude.cjs");
const deny = (settings.permissions || {}).deny || [];
const allow = (settings.permissions || {}).allow || [];
const reports = deny.filter((rule) => rule.includes(".reports/**/*.json"));
const locks = deny.filter((rule) => rule.endsWith(".reports/*.json.lock*)"));
// The compose writes the path of the harness home in place of $QORY_HARNESS_HOME.
const wanted = process.argv.slice(2).map((rule) => JSON.parse(rule).split("$QORY_HARNESS_HOME"));
const allowed = wanted.every(([start, end = ""]) =>
	allow.some((rule) => rule.startsWith(start) && rule.endsWith(end)));
process.exit(stop.includes("hooks/end-gate-claude.cjs") && guard && reports.length === 3 &&
	locks.length === 3 && allowed ? 0 : 1);
' "$1" '"Skill(harness:running-a-workflow)"' "$VERSIONS_RULE" "$CHECKS_RULE"
}
core_claude_settings "$TMP/software/.qory/harness/claude/settings.json" ||
	fail "the settings composed for the software stack on claude have the Stop hook, the PreToolUse and PostToolBatch hooks, the 6 deny rules of .reports/ and the 3 allow rules of core"
pass "the settings composed for the software stack on claude have the Stop hook, the PreToolUse and PostToolBatch hooks, the 6 deny rules of .reports/ and the 3 allow rules of core"

# These composes write into $TMP/consumer, so that the check can read the settings and hook
# files that the core stack alone gets on each runtime with hooks.
for runtime in claude gemini cursor copilot; do
	expect "checkout extending core by path: harness compose --no-links --runtime $runtime exits 0" \
		0 "$TMP/consumer" "$QORY" harness compose --no-links --runtime "$runtime"
done
core_claude_settings "$TMP/consumer/.qory/harness/claude/settings.json" ||
	fail "core: the settings composed on claude have the Stop hook, the PreToolUse and PostToolBatch hooks, the 6 deny rules of .reports/ and the 3 allow rules of core"
pass "core: the settings composed on claude have the Stop hook, the PreToolUse and PostToolBatch hooks, the 6 deny rules of .reports/ and the 3 allow rules of core"
# allow_rules FILE...: the allow rules of the Claude settings FILE..., one per line, sorted,
# with each path of a harness home, and $QORY_HARNESS_HOME, as <home>.
allow_rules() {
	node -e '
const fs = require("fs");
const rules = new Set();
for (const file of process.argv.slice(1)) {
	const settings = JSON.parse(fs.readFileSync(file, "utf8"));
	for (const rule of (settings.permissions || {}).allow || []) {
		rules.add(rule.replace(/\$QORY_HARNESS_HOME|\/[^ ()]*\/\.qory\/harness(?=\/claude\/)/, "<home>"));
	}
}
console.log([...rules].sort().join("\n"));
' "$@"
}
# The core stack alone allows each skill and agent of core on claude.
CORE_RULES=$({
	for skill in "$ROOT"/modules/core/skills/*/SKILL.md; do
		printf '"Skill(harness:%s)"\n' "$(basename "$(dirname "$skill")")"
	done
	for agent in "$ROOT"/modules/core/agents/*.md; do
		printf '"Agent(harness:%s)"\n' "$(basename "$agent" .md)"
	done
} | sed 's/^"//; s/"$//')
COMPOSED_CORE=$(allow_rules "$TMP/consumer/.qory/harness/claude/settings.json")
missing=$(printf '%s\n' "$CORE_RULES" | while IFS= read -r rule; do
	printf '%s\n' "$COMPOSED_CORE" | grep -Fxq -- "$rule" || printf '%s\n' "$rule"
done)
[ -z "$missing" ] ||
	fail "core: the settings composed on claude allow each skill and agent of core; missing: $missing"
pass "core: the settings composed on claude allow each skill and agent of core"
# The software stack's composed settings have each allow rule of the settings of core and
# software-factory, and no other.
[ "$(allow_rules "$TMP/software/.qory/harness/claude/settings.json")" = \
	"$(allow_rules "$ROOT/modules/core/settings/claude/settings.json" \
		"$ROOT/modules/software-factory/settings/claude/settings.json")" ] ||
	fail "the settings composed for the software stack on claude have each allow rule of core and software-factory, and no other"
pass "the settings composed for the software stack on claude have each allow rule of core and software-factory, and no other"
for pair in gemini:gemini/settings.json cursor:cursor/hooks.json copilot:copilot/hooks/qory-hooks.json; do
	runtime=${pair%%:*}
	file=$TMP/consumer/.qory/harness/${pair#*:}
	grep -Fq "hooks/end-gate-$runtime.cjs" "$file" ||
		fail "core: the hooks composed on $runtime run end-gate-$runtime.cjs ($file)"
	pass "core: the hooks composed on $runtime run end-gate-$runtime.cjs"
done
