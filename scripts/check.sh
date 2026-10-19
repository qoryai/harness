#!/bin/sh
# Checks that qory reads this repository and composes the core stack.
#
# Usage: scripts/check.sh
# Set `QORY` to the qory binary to run; the default is `qory`.
#
# Every compose runs with --dry-run, so the script writes only to a temporary
# directory, and the script removes that directory on exit.
set -u

QORY=${QORY:-qory}
ENTRY=skills/simple-communication

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
mkdir "$TMP/home" "$TMP/config" "$TMP/consumer" || exit 1
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

# expect_entry TEXT: fails unless OUT lists $ENTRY as an entry.
expect_entry() {
	printf '%s\n' "$OUT" | grep -Eq "^[[:space:]]*$ENTRY([[:space:]]|\$)" ||
		fail "$1"
	pass "$1"
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
