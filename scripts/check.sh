#!/bin/sh
# Checks that qory reads this repository and composes the core, software and authoring
# stacks, and that the agents and skills follow the rules that docs/modules.md lists in
# the section "What the script checks".
#
# Usage: scripts/check.sh
# Set `QORY` to the qory binary to run; the default is `qory`.
#
# Every compose runs with --dry-run, except the one that writes the settings of the
# software stack into a temporary checkout. So the script writes only to a temporary
# directory, and the script removes that directory on exit.
set -u

QORY=${QORY:-qory}
ENTRY=skills/simple-communication
VISUALS_ENTRY=skills/visuals
SOFTWARE_ENTRY=skills/explore-a-ticket
# The other entries that every compose of the core stack lists.
CORE_ENTRIES="skills/run-artifacts skills/artifact-text skills/writing-questions skills/checking-questions skills/reviewing-drafts agents/questions-reviewer"
# The other entries that only a compose of the software stack lists.
SOFTWARE_ENTRIES="skills/writing-proposals skills/checking-proposals skills/exploring-code agents/code-explorer agents/proposal-reviewer"
# The entries that only a compose of the authoring stack lists.
AUTHORING_ENTRIES="skills/writing-agents skills/writing-skills agents/harness-reviewer"
# Rule 5: PRD is matched by case, and the terms of the table "Terms that exclude" of
# simple-communication's word list in any case.
BANNED_CASED='(^|[^[:alnum:]_])PRD([^[:alnum:]_]|$)'
BANNED_ANY_CASE='(^|[^[:alnum:]_])(white-?list(s|ed|ing)?|black-?list(s|ed|ing)?|gr[ae]y-?list(s|ed|ing)?|masters?|slaves?|sanity checks?|dumm(y|ies)|grandfathered|crippled|lame|gimpy)([^[:alnum:]_]|$)'

# A relative QORY path stays valid after `run` changes directory.
case $QORY in
/*) ;;
*/*) QORY=$(pwd -P)/$QORY ;;
esac

ROOT=$(CDPATH= cd -P -- "$(dirname -- "$0")/.." >/dev/null && pwd -P) || exit 1

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

# front_matter FILE: prints the lines between the two --- lines at the top of FILE.
front_matter() {
	awk 'NR == 1 { if ($0 != "---") exit; next } $0 == "---" { exit } { print }' "$1"
}

# body FILE: prints FILE without its front matter.
body() {
	awk 'NR == 1 && $0 == "---" { on = 1; next }
		on && $0 == "---" { on = 0; next }
		!on { print }' "$1"
}

# Each rule below takes a directory that contains modules/. It sets OUT to what breaks
# the rule, and returns 0 when nothing does.

# rule_sections DIR: rule 1, each agent has the three required sections.
rule_sections() {
	OUT=
	for file in "$1"/modules/*/agents/*.md; do
		[ -f "$file" ] || continue
		for section in 'Guardrails' 'Stop conditions' 'Expected output'; do
			grep -Fqx "## $section" "$file" ||
				add "Add the section ## $section to $file."
		done
	done
	[ -z "$OUT" ]
}

# rule_tools DIR: rule 2, an agent's tools key lists Bash, Edit or Write only with a line
# in the body for that tool: `Tool exception: <tool>, because <reason>`.
rule_tools() {
	OUT=
	for file in "$1"/modules/*/agents/*.md; do
		[ -f "$file" ] || continue
		tools=$(front_matter "$file" | awk '/^tools[ \t]*:/ { on = 1; print; next }
			on && /^[ \t]+-/ { print; next }
			{ on = 0 }')
		for tool in Bash Edit Write; do
			printf '%s\n' "$tools" |
				grep -Eq "[^[:alnum:]_]$tool([^[:alnum:]_]|\$)" || continue
			body "$file" | grep -Eq "^Tool exception: $tool, because [^[:space:]]" ||
				add "Remove $tool from the tools key of $file, or add the line 'Tool exception: $tool, because <reason>' to its body."
		done
	done
	[ -z "$OUT" ]
}

# rule_model DIR: rule 3, an agent's front matter has no model key.
rule_model() {
	OUT=
	for file in "$1"/modules/*/agents/*.md; do
		[ -f "$file" ] || continue
		if front_matter "$file" | grep -Eq '^model[[:space:]]*:'; then
			add "Remove the model key from the front matter of $file."
		fi
	done
	[ -z "$OUT" ]
}

# Rule 4 reads a list item with its indented lines. It removes the reference, and any
# further references joined by ", with", " or", " and" or ",". The words that follow,
# after a comma or a colon, must start with a word of the moment list.
MOMENT_AWK='
function check(rest) {
	if (item == "") return
	rest = item
	sub(/^[ \t]*- /, "", rest)
	while (match(rest, /^[$][{]qory:skills\/[^}]*[}]/)) {
		rest = substr(rest, RLENGTH + 1)
		if (match(rest, /^(, with | or | and |, )[$][{]qory:/))
			rest = substr(rest, RLENGTH - 6)
	}
	sub(/^[,:]?[ ]*/, "", rest)
	if (rest !~ /^(first|next|last|before|after|when|while|once|only when|at the start|in step)([^a-z]|$)/)
		print start ": " item
	item = ""
}
/^[ \t]*- [$][{]qory:skills\// { check(); item = $0; start = FNR; next }
item != "" && /^[ \t]+[^ \t-]/ { line = $0; sub(/^[ \t]+/, "", line); item = item " " line; next }
{ check() }
END { check() }
'

# rule_moments DIR: rule 4, each list item that starts with a reference to a skill states
# its moment.
rule_moments() {
	OUT=
	for file in "$1"/modules/*/agents/*.md "$1"/modules/*/skills/*/SKILL.md; do
		[ -f "$file" ] || continue
		items=$(awk "$MOMENT_AWK" "$file")
		[ -z "$items" ] && continue
		add "State the moment right after the reference, in $file, line $items"
	done
	[ -z "$OUT" ]
}

# word_lines DIR GREP_ARGUMENT...: prints each line of an agent or skill file that matches.
# The word list of simple-communication contains the words as examples.
word_lines() {
	dir=$1
	shift
	find "$dir/modules" -type f -name '*.md' \( -path '*/agents/*' -o -path '*/skills/*' \) \
		! -path '*/modules/core/skills/simple-communication/references/*' \
		-exec grep -n -E "$@" /dev/null {} +
}

# rule_words DIR: rule 5, no agent or skill file contains a banned word.
rule_words() {
	OUT=$(word_lines "$1" -e "$BANNED_CASED"
		word_lines "$1" -i -e "$BANNED_ANY_CASE")
	[ -z "$OUT" ] && return 0
	OUT="Replace each word on these lines, as simple-communication's word list states:
$OUT"
	return 1
}

# allow_rules FILE: prints the lines of the allow list of a settings file.
allow_rules() {
	awk '/"allow"[ ]*:[ ]*\[/ { on = 1; next } on && /\]/ { on = 0 } on { print }' "$1"
}

# rule_allow DIR [FILE]: rule 6, each skill and agent of the core and software-factory
# modules has its allow rule in FILE, by default the settings of the software-factory
# module. A read run denies, with no prompt, each tool call that no allow rule covers, so
# a run cannot load a skill or start an agent without its rule. simple-communication has
# no rule, because runs do not load it. Codex composes no settings, so the entry listing
# of the compose checks is the coverage for Codex.
rule_allow() {
	OUT=
	settings=${2:-$1/modules/software-factory/settings/claude/settings.json}
	if [ ! -f "$settings" ]; then
		add "Add the settings file $settings: the file is missing."
		return 1
	fi
	allowed=$(allow_rules "$settings")
	for file in "$1"/modules/core/skills/*/SKILL.md "$1"/modules/software-factory/skills/*/SKILL.md; do
		[ -f "$file" ] || continue
		name=$(basename "$(dirname "$file")")
		[ "$name" = simple-communication ] && continue
		printf '%s\n' "$allowed" | grep -Fq "\"Skill(harness:$name)\"" ||
			add "Add \"Skill(harness:$name)\" to permissions.allow, because $settings lacks it."
	done
	for file in "$1"/modules/core/agents/*.md "$1"/modules/software-factory/agents/*.md; do
		[ -f "$file" ] || continue
		name=$(basename "$file" .md)
		printf '%s\n' "$allowed" | grep -Fq "\"Agent(harness:$name)\"" ||
			add "Add \"Agent(harness:$name)\" to permissions.allow, because $settings lacks it."
	done
	[ -z "$OUT" ]
}

# fixture: makes a new directory $FIX with an agent $AGENT and a skill $SKILL that pass
# every rule, and $SETTINGS with their allow rules.
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
  "permissions": {
    "allow": [
      "Skill(harness:sample)",
      "Agent(harness:sample-agent)"
    ]
  }
}
EOF
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

# expect_passes TEXT RULE ARGUMENT...: fails unless RULE accepts the fixture.
expect_passes() {
	text=$1
	shift
	"$@" || fail "$text"
	pass "$text"
}

run "$ROOT" "$QORY" version
[ "$RC" -eq 0 ] || fail "qory version exits 0 (exit status $RC)"
printf '%s\n' "$OUT" | sed -n 1p

expect "qory config exits 0" 0 "$ROOT" "$QORY" config

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
	for entry_name in $CORE_ENTRIES $SOFTWARE_ENTRIES; do
		expect_entry "checkout extending software by path: harness compose --dry-run --runtime $runtime lists $entry_name" \
			"$entry_name"
	done
	for entry_name in $AUTHORING_ENTRIES; do
		expect_no_entry "checkout extending software by path: harness compose --dry-run --runtime $runtime does not list $entry_name" \
			"$entry_name"
	done
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
for rule in rule_sections rule_tools rule_model rule_moments rule_words rule_allow; do
	expect_passes "fixture: $rule passes on the good files" "$rule" "$FIX"
done

for bad_section in 'Guardrails' 'Stop conditions' 'Expected output'; do
	fixture
	good_agent | grep -Fvx "## $bad_section" >"$AGENT"
	expect_broken "rule 1 fails on an agent with no ## $bad_section" "## $bad_section" rule_sections "$FIX"
done

for bad_tool in Bash Edit Write; do
	fixture
	good_agent | sed "s/^tools: .*/tools: Read, $bad_tool/" >"$AGENT"
	expect_broken "rule 2 fails on an agent with $bad_tool and no exception" "$bad_tool" rule_tools "$FIX"
	printf '\nTool exception: %s\n' "$bad_tool" >>"$AGENT"
	expect_broken "rule 2 fails on an exception for $bad_tool with no reason" "$bad_tool" rule_tools "$FIX"
	printf 'Tool exception: %s, because the role needs it.\n' "$bad_tool" >>"$AGENT"
	expect_passes "rule 2 passes on an exception for $bad_tool with a reason" rule_tools "$FIX"
done
fixture
good_agent | sed 's/^tools: .*/tools: Read, Bash, Edit/' >"$AGENT"
printf '\nTool exception: Bash, because the role needs it.\n' >>"$AGENT"
expect_broken "rule 2 fails when an exception covers one of two tools" "Edit" rule_tools "$FIX"

fixture
good_agent | awk '{ print } /^tools:/ { print "model: sample" }' >"$AGENT"
expect_broken "rule 3 fails on an agent with a model key" "model key" rule_model "$FIX"

for bad in '- ${qory:skills/sample}' \
	'- ${qory:skills/sample}: the rules of the work.' \
	'- ${qory:skills/sample}, with ${qory:skills/other}: what it lists when a push fails.'; do
	fixture
	printf '%s\n' "$bad" >>"$SKILL"
	expect_broken "rule 4 fails on a skill with the item: $bad" "$bad" rule_moments "$FIX"
	fixture
	printf '%s\n' "$bad" >>"$AGENT"
	expect_broken "rule 4 fails on an agent with the item: $bad" "$bad" rule_moments "$FIX"
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
expect_broken "rule 6 fails with no settings file" "settings file" rule_allow "$FIX"
fixture
mkdir -p "$FIX/modules/core/skills/simple-communication" || exit 1
good_skill >"$FIX/modules/core/skills/simple-communication/SKILL.md"
expect_passes "rule 6 passes on simple-communication with no allow rule" rule_allow "$FIX"

# The rules, on the files of this repository.
rule_sections "$ROOT" || fail "rule 1: each agent has the three required sections"
pass "rule 1: each agent has the three required sections"
rule_tools "$ROOT" || fail "rule 2: each agent's Bash, Edit or Write has a stated exception"
pass "rule 2: each agent's Bash, Edit or Write has a stated exception"
rule_model "$ROOT" || fail "rule 3: no agent has a model key"
pass "rule 3: no agent has a model key"
rule_moments "$ROOT" || fail "rule 4: each listed skill states its moment"
pass "rule 4: each listed skill states its moment"
rule_words "$ROOT" || fail "rule 5: no agent or skill has a banned word"
pass "rule 5: no agent or skill has a banned word"

rule_allow "$ROOT" || fail "rule 6: the settings of software-factory allow each skill and agent"
pass "rule 6: the settings of software-factory allow each skill and agent"
# This compose writes into $TMP/software, so that the check can read the composed settings.
expect "checkout extending software by path: harness compose --no-links --runtime claude exits 0" \
	0 "$TMP/software" "$QORY" harness compose --no-links --runtime claude
rule_allow "$ROOT" "$TMP/software/.qory/harness/claude/settings.json" ||
	fail "rule 6: the settings composed for the software stack on claude allow each skill and agent"
pass "rule 6: the settings composed for the software stack on claude allow each skill and agent"
