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
SOFTWARE_ENTRY=skills/workflow-explore-a-ticket
# The other entries that every compose of the core stack lists.
CORE_ENTRIES="skills/run-artifacts skills/reading-the-work skills/artifact-text skills/writing-questions skills/checking-questions skills/replying-to-comments skills/reviewing-drafts agents/questions-writer agents/questions-reviewer agents/reply-writer"
# The other entries that only a compose of the software stack lists.
SOFTWARE_ENTRIES="skills/writing-proposals skills/checking-proposals skills/exploring-code agents/code-explorer agents/proposal-writer agents/proposal-reviewer skills/workflow-write-specs skills/running-a-workflow skills/writing-specs skills/checking-specs agents/spec-writer agents/spec-reviewer skills/workflow-make-mockups skills/designing-mockups skills/checking-mockups agents/designer agents/mockup-reviewer"
# The entries that only a compose of the authoring stack lists.
AUTHORING_ENTRIES="skills/writing-agents skills/writing-skills agents/harness-reviewer"
# Rule 5: PRD, matched by case, and in any case: whitelist, blacklist, graylist, greylist,
# master, slave, sanity check, sanity-check, dummy, grandfathered, crippled, lame, gimpy.
# The three lists also match with a hyphen, and with -s, -ed or -ing. master, slave and
# sanity check also match with -s, and dummy as dummies.
BANNED_CASED='(^|[^[:alnum:]_])PRD([^[:alnum:]_]|$)'
BANNED_ANY_CASE='(^|[^[:alnum:]_])(white-?list(s|ed|ing)?|black-?list(s|ed|ing)?|gr[ae]y-?list(s|ed|ing)?|masters?|slaves?|sanity[ -]checks?|dumm(y|ies)|grandfathered|crippled|lame|gimpy)([^[:alnum:]_]|$)'

# A relative QORY path stays valid after `run` changes directory.
case $QORY in
/*) ;;
*/*) QORY=$(pwd -P)/$QORY ;;
esac

ROOT=$(CDPATH= cd -P -- "$(dirname -- "$0")/.." >/dev/null && pwd -P) || exit 1

command -v node >/dev/null 2>&1 || {
	printf 'Install node, and run the script again: it runs the tests of the render script.\n' >&2
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

# front_matter FILE: prints the lines between the two --- lines at the top of FILE, after
# any blank lines, with no carriage return.
front_matter() {
	awk '{ sub(/\r$/, "") }
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

# prose FILE: prints FILE with no front matter, no code fence and no carriage return.
prose() {
	awk "$FENCE_AWK"'
		{ sub(/\r$/, "") }
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
# code-explorer lists only Read, Grep, Glob and Skill.
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
		*-reviewer | code-explorer)
			extra=$(printf '%s\n' "$tools" | tr -cs '[:alnum:]_' '\n' | grep -v '^$' |
				grep -Evx 'Read|Grep|Glob|Skill' | tr '\n' ' ')
			[ -z "$extra" ] ||
				add "Remove $extra from the tools key of $file: it lists only Read, Grep, Glob and Skill."
			;;
		esac
	done
	[ -z "$OUT" ]
}

# The one Bash rule that the settings of software-factory allow.
RENDER_RULE='"Bash($QORY_HARNESS_HOME/claude/plugin/skills/designing-mockups/render-mockups.js *)"'
DRAFT_DENY='"Edit(//tmp/qory-artifacts/**/mockup-draft/**)"'

# rule_designer DIR: rule 2, the exception for designer. Its Bash exception names the render
# script, the settings of software-factory allow Bash only for that script, and they deny Edit,
# which also covers Write, in the folder that only that script writes to.
rule_designer() {
	OUT=
	file=$1/modules/software-factory/agents/designer.md
	settings=$1/modules/software-factory/settings/claude/settings.json
	[ -f "$settings" ] || return 0
	others=$(permission_rules "$settings" allow | grep -F '"Bash' | grep -Fvx -- "$RENDER_RULE")
	[ -z "$others" ] ||
		add "Remove these rules from permissions.allow of $settings, because Bash is only for the render script: $others"
	[ -f "$file" ] || { [ -z "$OUT" ]; return; }
	prose "$file" | grep -Eq '^Tool exception: Bash, because .*render-mockups\.js' ||
		add "State render-mockups.js in the Bash exception of $file: designer runs only that script."
	permission_rules "$settings" allow | grep -Fxq -- "$RENDER_RULE" ||
		add "Add $RENDER_RULE to permissions.allow of $settings: designer runs that script."
	permission_rules "$settings" deny | grep -Fxq -- "$DRAFT_DENY" ||
		add "Add $DRAFT_DENY to permissions.deny of $settings: only the render script writes there."
	[ -z "$OUT" ]
}

# rule_model DIR: rule 3, an agent's front matter has no model key.
rule_model() {
	OUT=
	for file in "$1"/modules/*/agents/*.md; do
		[ -f "$file" ] || continue
		if front_matter "$file" | grep -Eq "^[\"']?model[\"']?[[:space:]]*:"; then
			add "Remove the model key from the front matter of $file."
		fi
	done
	[ -z "$OUT" ]
}

# Rule 4 reads a list item outside a code fence, with its indented lines. It removes the
# reference, also in a code span or bold, and any further references joined by ", with",
# " or", " and", ", or", ", and" or ",". The words that follow, after a comma or a colon,
# must be a moment, in any case:
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
	items=$(awk "$MOMENT_AWK" "$1")
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
# modules has its allow rule in FILE, by default the settings of the software-factory
# module, no rule of FILE is in both allow and deny, and each Skill or Agent rule of
# allow is for a skill or an agent under modules. The rule checks that the settings
# match the entries. A skill with an allowed-tools key needs its rule under dontAsk on Claude
# Code 2.1.316; a skill with no such key loaded with no rule, in a test with a scripted API. An
# agent with no rule is untested. No skill here has the key, and the list stays complete.
# simple-communication has no rule, because runs do not load it. qory passes these rules only
# to Claude Code, so another runtime needs none of them, and the entry listing of the compose
# checks is the coverage for Codex.
rule_allow() {
	OUT=
	settings=${2:-$1/modules/software-factory/settings/claude/settings.json}
	if [ ! -f "$settings" ]; then
		add "Add the settings file $settings: the file is missing."
		return 1
	fi
	allowed=$(permission_rules "$settings" allow)
	denied=$(permission_rules "$settings" deny)
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
		[ "$name" = simple-communication ] && continue
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
# run-artifacts, running-a-workflow and workflow-* skills, names no other skill of modules/
# outside a code fence, starts at least one agent, and contains the sentence that the workflow requires subagents. A one-word name
# counts only in a code span or next to the word skill, because it can be an ordinary word.
# An agent reference counts only in the text of SKILL.md, because one in a code fence or in
# another file starts no agent. The other checks read every Markdown file of the skill's
# directory, because the compose reads references in each of them. running-a-workflow refers to
# no skill except run-artifacts, has no other skill name with a hyphen outside a code fence, no
# agent loads it, and no text of modules/core contains the word software-factory. The rule reads the skill, and checks no runtime.
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
			grep -Fvx -e '${qory:skills/run-artifacts}' -e '${qory:skills/running-a-workflow}' |
			grep -Fv '${qory:skills/workflow-')
		[ -z "$others" ] ||
			add "Move the skill reference to an agent, because $name does no task itself: $others"
		prose "$1/modules/${skill#./}" | grep -Fq 'qory:agents/' ||
			add "Start an agent in the text of $name's SKILL.md, outside a code fence: a workflow's skill does no task itself."
		skill_text=$(find "$dir" -type f -name '*.md' | while IFS= read -r md; do
			prose "$md"
		done)
		for other in $known_skills; do
			case $other in
			run-artifacts | running-a-workflow | workflow-* | "$name") continue ;;
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
	for shared in "$1"/modules/*/skills/running-a-workflow/SKILL.md; do
		[ -f "$shared" ] || continue
		others=$(grep -Eo '[$][{]qory:skills/[^}]*[}]' "$shared" |
			grep -Fvx '${qory:skills/run-artifacts}')
		[ -z "$others" ] ||
			add "Move the skill reference out of running-a-workflow, because an agent uses that skill: $others"
		shared_text=$(find "$(dirname "$shared")" -type f -name '*.md' | while IFS= read -r md; do
			prose "$md"
		done)
		for other in $known_skills; do
			case $other in
			run-artifacts | running-a-workflow) continue ;;
			*-*) ;;
			*) continue ;;
			esac
			printf '%s\n' "$shared_text" | tr '\n' ' ' |
				grep -Eiq "(^|[^[:alnum:]_-])$other([^[:alnum:]_-]|\$)" &&
				add "Remove the skill name $other from running-a-workflow, because an agent uses that skill."
		done
	done
	for file in "$1"/modules/*/agents/*.md; do
		[ -f "$file" ] || continue
		if grep -Fq '${qory:skills/running-a-workflow}' "$file"; then
			add "Remove the reference to running-a-workflow from $file, because only a main session loads it."
		fi
	done
	core_files=$(grep -rIl -- software-factory "$1/modules/core" 2>/dev/null)
	[ -z "$core_files" ] ||
		add "Remove the word software-factory from these files, because the core stack does not have that module: $core_files"
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
for rule in rule_sections rule_tools rule_model rule_moments rule_words rule_allow rule_workflows rule_orchestrators; do
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
for bad_name in sample-reviewer code-explorer; do
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

# designer_fixture EXCEPTION RULE: writes the agent designer with the line EXCEPTION, and
# settings with the Bash allow rule RULE.
designer_fixture() {
	fixture
	mkdir -p "$FIX/modules/software-factory/agents" || exit 1
	{
		good_agent | sed 's/^name: .*/name: designer/; s/^tools: .*/tools: Read, Bash/'
		printf '\n%s\n' "$1"
	} >"$FIX/modules/software-factory/agents/designer.md"
	printf '{"permissions": {"allow": [%s], "deny": [%s]}}\n' "$2" "${3-$DRAFT_DENY}" >"$SETTINGS"
}
GOOD_EXCEPTION='Tool exception: Bash, because you run only the render script, `render-mockups.js`.'
designer_fixture "$GOOD_EXCEPTION" "$RENDER_RULE"
expect_passes "rule 2 passes on designer's exception, in the Bash exception check" rule_tools "$FIX"
expect_passes "rule 2 passes on designer's exception and the render script's allow rule" rule_designer "$FIX"
designer_fixture 'Tool exception: Bash, because the role needs it.' "$RENDER_RULE"
expect_broken "rule 2 fails on a designer exception that does not state the render script" \
	"State render-mockups.js" rule_designer "$FIX"
designer_fixture "$GOOD_EXCEPTION" '"Read(a)"'
expect_broken "rule 2 fails on designer with no allow rule for the render script" \
	"Add" rule_designer "$FIX"
designer_fixture "$GOOD_EXCEPTION" "$RENDER_RULE, \"Bash(node *)\""
expect_broken "rule 2 fails on another Bash allow rule beside the render script's" \
	'Bash(node *)' rule_designer "$FIX"
designer_fixture "$GOOD_EXCEPTION" "$RENDER_RULE" '"Read(a)"'
expect_broken "rule 2 fails on designer with no deny rule for the draft folder" \
	'mockup-draft' rule_designer "$FIX"
fixture
printf '{"permissions": {"allow": ["Bash"]}}\n' >"$SETTINGS"
expect_broken "rule 2 fails on a Bash allow rule with no agent named designer" \
	'"Bash"' rule_designer "$FIX"
fixture
expect_passes "rule 2 passes with no designer and no Bash allow rule" rule_designer "$FIX"

fixture
good_agent | awk '{ print } /^tools:/ { print "model: sample" }' >"$AGENT"
expect_broken "rule 3 fails on an agent with a model key" "model key" rule_model "$FIX"
fixture
agent_with 'tools: Read\n"model": sample'
expect_broken "rule 3 fails on a quoted model key" "model key" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: sample'
{ printf '\n'; cat "$AGENT"; } >"$AGENT.new" && mv "$AGENT.new" "$AGENT"
expect_broken "rule 3 fails on a model key after a blank first line" "model key" rule_model "$FIX"
fixture
agent_with 'tools: Read\nmodel: sample'
awk '{ printf "%s\r\n", $0 }' "$AGENT" >"$AGENT.new" && mv "$AGENT.new" "$AGENT"
expect_broken "rule 3 fails on a model key in CRLF front matter" "model key" rule_model "$FIX"
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
expect_broken "rule 6 fails with no settings file" "settings file" rule_allow "$FIX"
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
expect_passes "rule 6 passes on simple-communication with no allow rule" rule_allow "$FIX"

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
	'Remove the reference to running-a-workflow' rule_orchestrators "$FIX"
fixture
printf '%s\n' 'The module software-factory has these agents.' >>"$SKILL"
expect_broken "rule 8 fails on a core text with the word software-factory" \
	'word software-factory' rule_orchestrators "$FIX"
fixture
orchestrator_skill "$GOOD_BODY"'\n- ${qory:skills/workflow-other-flow}: when the plan lists it.\n\nFollow `workflow-other-flow` next.'
mkdir -p "$FIX/modules/sample/skills/workflow-other-flow" || exit 1
printf '%s\n' 'This workflow requires subagents. Start ${qory:agents/sample-agent}.' \
	>"$FIX/modules/sample/skills/workflow-other-flow/SKILL.md"
expect_passes "rule 8 passes on a workflow skill that refers to a workflow-* skill" rule_orchestrators "$FIX"
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

# The rules, on the files of this repository.
rule_sections "$ROOT" || fail "rule 1: each agent has the three required sections"
pass "rule 1: each agent has the three required sections"
rule_tools "$ROOT" || fail "rule 2: each agent's Bash, Edit or Write has a stated exception"
pass "rule 2: each agent's Bash, Edit or Write has a stated exception"
rule_designer "$ROOT" || fail "rule 2: designer's Bash and the allow rules cover only the render script"
pass "rule 2: designer's Bash and the allow rules cover only the render script"
rule_model "$ROOT" || fail "rule 3: no agent has a model key"
pass "rule 3: no agent has a model key"
rule_moments "$ROOT" || fail "rule 4: each listed skill states its moment"
pass "rule 4: each listed skill states its moment"
rule_words "$ROOT" || fail "rule 5: no agent or skill has a banned word"
pass "rule 5: no agent or skill has a banned word"

rule_workflows "$ROOT" || fail "rule 7: each workflow of a stack and its skill match"
pass "rule 7: each workflow of a stack and its skill match"
rule_orchestrators "$ROOT" || fail "rule 8: each workflow skill orchestrates"
pass "rule 8: each workflow skill orchestrates"
rule_background "$ROOT" || fail "rule 6: the settings of software-factory set the variable for the foreground"
pass "rule 6: the settings of software-factory set the variable for the foreground"
rule_allow "$ROOT" || fail "rule 6: the settings of software-factory allow each skill and agent"
pass "rule 6: the settings of software-factory allow each skill and agent"
# These tests need node and no browser.
expect "the render script's tests pass" 0 "$ROOT" node --test scripts/render-mockups.test.js
# This compose writes into $TMP/software, so that the check can read the composed settings.
expect "checkout extending software by path: harness compose --no-links --runtime claude exits 0" \
	0 "$TMP/software" "$QORY" harness compose --no-links --runtime claude
rule_allow "$ROOT" "$TMP/software/.qory/harness/claude/settings.json" ||
	fail "rule 6: the settings composed for the software stack on claude allow each skill and agent"
pass "rule 6: the settings composed for the software stack on claude allow each skill and agent"
rule_launch_env "$TMP/software/.qory/harness-report.json" ||
	fail "rule 6: the compose report of the software stack lists the variable under launch_env.claude"
pass "rule 6: the compose report of the software stack lists the variable under launch_env.claude"
