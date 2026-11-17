// Tests of the proof of the kind "a comment" for shell and Python files (lib/proof-comments.cjs).
// scripts/check.sh runs them. Each case makes a git checkout with a base commit and a head
// commit, and runs `prove` as a session does, expecting exit 0 for a change of comments only
// and exit 1 for any other. The cases of shell and Python are those that the first trial of
// the proof ran, with two changes that the rules of the proof make: a change of white space
// outside comments fails, and a backquote command substitution with a comment fails.
// The proof runs bash and python3 by the absolute paths in TOOLS of the module. Set
// PROOF_TEST_BASH and PROOF_TEST_PYTHON to other paths to run the tests on a machine whose
// interpreters are elsewhere; a test whose interpreter is missing, or too old, is skipped.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const { main } = require(path.join(MODULES, 'core/skills/running-a-workflow/checks.cjs'));
const { watch } = require('./first-line.js');
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const proofComments = require(path.join(SKILL, 'lib/proof-comments.cjs'));

if (process.env.PROOF_TEST_BASH) proofComments.TOOLS.bash = process.env.PROOF_TEST_BASH;
if (process.env.PROOF_TEST_PYTHON) proofComments.TOOLS.python = process.env.PROOF_TEST_PYTHON;

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'proof-comments-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const ENV = { PATH: process.env.PATH, HOME: tmp, LC_ALL: 'C' };

// The versions of the interpreters, or null when one is missing.
function version(program, args) {
  if (!fs.existsSync(program)) return null;
  const ran = childProcess.spawnSync(program, args, { encoding: 'utf8', env: ENV });
  return ran.status === 0 ? ran.stdout.trim().split('.').map(Number) : null;
}
const BASH = version(proofComments.TOOLS.bash, ['-c', 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"']);
const PYTHON = version(proofComments.TOOLS.python, ['-c',
  'import sys; print("%d.%d" % sys.version_info[:2])']);
const NO_BASH = !BASH || BASH[0] < 5 ? 'bash 5 is not at TOOLS.bash' : false;
const NO_PYTHON = !PYTHON || PYTHON[0] < 3 || PYTHON[1] < 9 ? 'python 3.9 or later is not at TOOLS.python'
  : false;
const OLD_PYTHON = NO_PYTHON || PYTHON[1] < 12 ? 'f-strings parse as one token before Python 3.12'
  : false;

let count = 0;
function sh(dir, ...args) {
  return childProcess.execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c',
    'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false',
    ...args], { env: ENV, encoding: 'utf8' }).trim();
}

function commit(dir, files, message = 'change') {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (content === null) {
      fs.rmSync(file);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return sh(dir, 'rev-parse', 'HEAD');
}

const PROPOSAL = '# Change a comment\n\n## Track\n\nFast track: a comment. Reword a comment.\n\n' +
  'Reason: The change keeps what the product does.\n';

// scene commits base, then head, and returns { dir, inputs, base }.
function scene(base, head) {
  count += 1;
  const dir = path.join(tmp, `repo-${count}`);
  fs.mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  const first = commit(dir, base, 'base');
  const artifacts = path.join(tmp, `pulled-${count}`);
  fs.mkdirSync(path.join(artifacts, 'proposal', 'main', 'v1'), { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'proposal', 'main', 'v1', 'proposal.md'), PROPOSAL);
  const inputs = path.join(tmp, `inputs-${count}`, 'inputs.json');
  fs.mkdirSync(path.dirname(inputs), { recursive: true });
  fs.writeFileSync(inputs, JSON.stringify({ qory: { harness_extensions: {},
    start_commits: [{ path: dir, commit: first }], start_artifacts: artifacts } }));
  // Files that the head deletes are named with null; the others are written as they are.
  const rest = {};
  for (const name of Object.keys(base)) if (!Object.hasOwn(head, name)) rest[name] = null;
  commit(dir, { ...rest, ...head }, 'head');
  return { dir, inputs };
}

// prove runs the verb in the checkout, and returns its status and lines.
function prove(run) {
  let out = '';
  let err = '';
  const first = watch();
  const status = main(['prove', '--inputs', run.inputs], {
    out: { write: (chunk) => { out += chunk; } },
    err: { write: (chunk) => { err += chunk; } },
    plugin: path.join(MODULES, 'core'),
    cwd: run.dir,
    env: ENV,
    home: tmp,
    firstLine: first.firstLine,
  });
  first.check(status, err);
  return { status, out, err, lines: out.split('\n').filter(Boolean) };
}

// A case is [name, files at the base, files at the head, expected status].
function cases(list, skip) {
  for (const [name, base, head, expected] of list) {
    test(`comment proof: ${name}`, { skip: typeof skip === 'function' ? skip(name) : skip }, () => {
      const got = prove(scene(base, head));
      assert.equal(got.status, expected, got.out + got.err);
      for (const line of got.lines.slice(0, -1)) {
        if (!line.startsWith('  ')) assert.ok(line.length <= 100, line);
      }
    });
  }
}

const r = (text, from, to) => {
  assert.ok(text.includes(from), from);
  return text.replace(from, to);
};

// ---- shell -------------------------------------------------------------------------------

const SH = '#!/bin/bash\n# Prints a greeting.\nname="${1:-world}"\necho "hello # $name" # trailing comment\n';

const SHELL_CASES = [
  ['sh-comment', { 'a.sh': SH }, { 'a.sh': r(r(SH, 'Prints a greeting.', 'Greets.'), 'trailing comment', 'x') }, 0],
  ['sh-code', { 'a.sh': SH }, { 'a.sh': r(SH, 'echo ', "printf '%s\\n' ") }, 1],
  ['sh-hash-string', { 'a.sh': SH }, { 'a.sh': r(SH, 'hello # $name', 'hello # $name!') }, 1],
  ['sh-shellcheck-added', { 'a.sh': SH }, { 'a.sh': r(SH, 'echo', '# shellcheck disable=SC2086\necho') }, 1],
  ['sh-shebang-changed', { 'a.sh': SH }, { 'a.sh': r(SH, '#!/bin/bash', '#!/bin/sh') }, 1],
  ['sh-hash-in-word', { 'a.sh': 'echo a#b\n' }, { 'a.sh': 'echo a#c\n' }, 1],
  ['sh-hash-word-start', { 'a.sh': 'echo a #b\n' }, { 'a.sh': 'echo a #c\n' }, 0],
  ['sh-heredoc-hash', { 'a.sh': 'cat <<EOF\n# a\nEOF\n' }, { 'a.sh': 'cat <<EOF\n# b\nEOF\n' }, 1],
  ['sh-heredoc-quoted-hash', { 'a.sh': "cat <<'EOF'\n# a\nEOF\n" }, { 'a.sh': "cat <<'EOF'\n# b\nEOF\n" }, 1],
  ['sh-heredoc-dash-tab', { 'a.sh': 'cat <<-EOF\n\t# a\n\tEOF\n' }, { 'a.sh': 'cat <<-EOF\n\t# b\n\tEOF\n' }, 1],
  ['sh-cmdsubst-comment', { 'a.sh': 'x=$(echo a # c1\n)\n' }, { 'a.sh': 'x=$(echo a # c2\n)\n' }, 0],
  ['sh-cmdsubst-paren-in-comment', { 'a.sh': 'x=$(echo a # c )\necho b\n)\n' }, { 'a.sh': 'x=$(echo a # c )\necho z\n)\n' }, 1],
  ['sh-backtick-comment', { 'a.sh': 'x=`echo a # c` d\necho $x\n' }, { 'a.sh': 'x=`echo a # c` e\necho $x\n' }, 1],
  // A comment in a backquote command substitution fails: bash keeps its text in the dump.
  ['sh-backtick-comment-only', { 'a.sh': 'x=`echo a # c1`\n' }, { 'a.sh': 'x=`echo a # c2`\n' }, 1],
  ['sh-backtick-nl-comment', { 'a.sh': 'x=`echo a # c1\n`\n' }, { 'a.sh': 'x=`echo a # c2\n`\n' }, 1],
  ['sh-semicolon-hash', { 'a.sh': 'echo a;#b\n' }, { 'a.sh': 'echo a;#c\n' }, 0],
  ['sh-param-hash', { 'a.sh': 'echo ${x#a}\n' }, { 'a.sh': 'echo ${x#b}\n' }, 1],
  ['sh-dollar-hash', { 'a.sh': 'echo $#a\n' }, { 'a.sh': 'echo $#b\n' }, 1],
  ['sh-arith-base', { 'a.sh': 'echo $((2#10))\n' }, { 'a.sh': 'echo $((2#11))\n' }, 1],
  ['sh-escaped-space-hash', { 'a.sh': 'echo a\\ #b\n' }, { 'a.sh': 'echo a\\ #c\n' }, 1],
  ['sh-shellcheck', { 'a.sh': '# note\necho $a\n' }, { 'a.sh': '# shellcheck disable=SC2086\necho $a\n' }, 1],
  ['sh-shellcheck-nospace', { 'a.sh': '# note\necho $a\n' }, { 'a.sh': '#shellcheck disable=SC2086\necho $a\n' }, 1],
  ['sh-shebang', { 'a.sh': '#!/bin/sh\necho\n' }, { 'a.sh': '#!/bin/bash\necho\n' }, 1],
  ['sh-brace-hash', { 'a.sh': '{ echo; }#a\n' }, { 'a.sh': '{ echo; }#b\n' }, 1],
  ['sh-dbl-bracket-hash', { 'a.sh': '[[ a == a ]] # x\n' }, { 'a.sh': '[[ a == a ]] # y\n' }, 0],
  ['sh-case-comment', { 'a.sh': 'case $1 in\n # a\n x) echo;; # b\nesac\n' }, { 'a.sh': 'case $1 in\n # c\n x) echo;; # d\nesac\n' }, 0],
  ['sh-line-cont-comment', { 'a.sh': 'echo a \\\n  b # x\n' }, { 'a.sh': 'echo a \\\n  b # y\n' }, 0],
  ['sh-comment-backslash', { 'a.sh': 'echo a # x\necho b\n' }, { 'a.sh': 'echo a # x\\\necho b\n' }, 0],
  ['sh-heredoc-in-cmdsubst', { 'a.sh': 'x=$(cat <<E\n# a\nE\n)\n' }, { 'a.sh': 'x=$(cat <<E\n# b\nE\n)\n' }, 1],
  ['sh-alias-expansion', { 'a.sh': "shopt -s expand_aliases\nalias c='#'\nc echo hi\n" }, { 'a.sh': "shopt -s expand_aliases\nalias c='#'\nc echo ho\n" }, 1],
  ['sh-eval-hash', { 'a.sh': "eval 'echo a #b'\n" }, { 'a.sh': "eval 'echo a #c'\n" }, 1],
  ['sh-hash-after-redirect', { 'a.sh': 'echo a >#f\n' }, { 'a.sh': 'echo a >#g\n' }, 1],
  ['sh-hash-after-pipe', { 'a.sh': 'echo a |# x\ncat\n' }, { 'a.sh': 'echo a |# y\ncat\n' }, 0],
  ['sh-procsubst-comment', { 'a.sh': 'cat <(echo a # x\n)\n' }, { 'a.sh': 'cat <(echo a # y\n)\n' }, 0],
  ['sh-func-comment-in-body', { 'a.sh': 'f() {\n  # a\n  echo\n}\n' }, { 'a.sh': 'f() {\n  # b\n  echo\n}\n' }, 0],
  ['sh-hash-in-assign', { 'a.sh': 'a=#x\n' }, { 'a.sh': 'a=#y\n' }, 1],
  ['sh-hash-in-array', { 'a.sh': 'a=(1 #x\n2)\n' }, { 'a.sh': 'a=(1 #y\n2)\n' }, 0],
  ['sh-nosemgrep', { 'a.sh': 'x=1 # note\n' }, { 'a.sh': 'x=1 # nosemgrep\n' }, 1],
  ['sh-gitleaks', { 'a.sh': 'x=1 # note\n' }, { 'a.sh': 'x=1 # gitleaks:allow\n' }, 1],
  ['sh-comment-and-spaces', { 'a.sh': '# a\necho  a\n' }, { 'a.sh': '# b\necho a\n' }, 1],
  ['sh-comment-and-indent', { 'a.sh': 'if x; then\n  echo a # a\nfi\n' }, { 'a.sh': 'if x; then\n    echo a # b\nfi\n' }, 1],
  ['sh-comment-line-removed', { 'a.sh': '# a\necho a\n' }, { 'a.sh': 'echo a\n' }, 0],
  ['sh-trailing-comment-added', { 'a.sh': 'echo a\n' }, { 'a.sh': 'echo a # a\n' }, 0],
  ['sh-bash-extension', { 'a.bash': 'x=1 # a\n' }, { 'a.bash': 'x=1 # b\n' }, 0],
  ['sh-comment-backslash-hides-code', { 'a.sh': 'echo a # x\\\necho b\n' }, { 'a.sh': 'echo a # x\\\necho c\n' }, 1],
  ['sh-comment-backslash-hides-rm', { 'a.sh': '# note \\\necho safe\n' }, { 'a.sh': '# note \\\nrm -rf /tmp/zz\n' }, 1],
  ['sh-remove-comment-before-backslash', { 'a.sh': 'echo a # x\\\necho b\n' }, { 'a.sh': 'echo a \\\necho b\n' }, 1],
  ['sh-remove-comment-rm', { 'a.sh': 'rm -f old.txt # keep\\\n/\n' }, { 'a.sh': 'rm -f old.txt \\\n/\n' }, 1],
];

cases(SHELL_CASES, NO_BASH);

// ---- Python ------------------------------------------------------------------------------

const PY = '"""Module docstring."""\n# a comment\ndef area(r):\n    """Return the area."""\n    s = "# not a comment"\n    return 3.14 * r * r  # trailing\n';

const PYTHON_CASES = [
  ['py-comment', { 'a.py': PY }, { 'a.py': r(r(PY, 'a comment', 'b comment'), 'trailing', 'x') }, 0],
  ['py-code', { 'a.py': PY }, { 'a.py': r(PY, '3.14', '3.1416') }, 1],
  ['py-docstring', { 'a.py': PY }, { 'a.py': r(PY, 'Return the area.', 'Area of a circle.') }, 1],
  ['py-hex', { 'a.py': PY }, { 'a.py': r(PY, '3.14', '314e-2') }, 1],
  ['py-hash-string', { 'a.py': PY }, { 'a.py': r(PY, '# not a comment', '# changed') }, 1],
  // A change that only adds or removes white space outside comments fails.
  ['py-whitespace', { 'a.py': PY }, { 'a.py': r(PY, '3.14 * r * r', '3.14*r*r') }, 1],
  ['py-type-comment', { 'a.py': PY }, { 'a.py': r(PY, '# trailing', '# type: float') }, 1],
  ['py-tstring-hash', { 'a.py': 'x = t"{1}#a"\n' }, { 'a.py': 'x = t"{1}#b"\n' }, 1],
  ['py-fstring-hash', { 'a.py': 'x = f"{1}#a"\n' }, { 'a.py': 'x = f"{1}#b"\n' }, 1],
  ['py-type-ignore-nospace', { 'a.py': 'x = f()  # note\n' }, { 'a.py': 'x = f()  #type:ignore\n' }, 1],
  ['py-type-ignore-bracket', { 'a.py': 'x = f()  # type: ignore[a]\n' }, { 'a.py': 'x = f()  # type: ignore[b]\n' }, 1],
  ['py-type-comment-func', { 'a.py': 'def f(a):\n    # type: (int) -> int\n    return a\n' }, { 'a.py': 'def f(a):\n    # type: (str) -> int\n    return a\n' }, 1],
  ['py-coding-line3', { 'a.py': 'x = 1\ny = 2\n# -*- coding: utf-8 -*-\n' }, { 'a.py': 'x = 1\ny = 2\n# -*- coding: latin-1 -*-\n' }, 0],
  ['py-coding-line1', { 'a.py': "# hello\nx = 'é'\n" }, { 'a.py': "# -*- coding: latin-1 -*-\nx = 'é'\n" }, 1],
  ['py-coding-line2', { 'a.py': "#!/usr/bin/env python3\n# hello\nx = 'é'\n" }, { 'a.py': "#!/usr/bin/env python3\n# vim: set fileencoding=latin-1 :\nx = 'é'\n" }, 1],
  ['py-prose-encoding', { 'a.py': 'x = 1  # the file encoding: utf-8\n' }, { 'a.py': 'x = 1  # the file encoding: utf8\n' }, 0],
  ['py-prose-pragma', { 'a.py': 'x = 1  # see pragma docs\n' }, { 'a.py': 'x = 1  # see pragma notes\n' }, 0],
  ['py-noqa-case', { 'a.py': 'import os  # note\n' }, { 'a.py': 'import os  # NOQA\n' }, 1],
  ['py-pylint-disable-nospace', { 'a.py': 'x = 1  # note\n' }, { 'a.py': 'x = 1  #pylint:disable=all\n' }, 1],
  ['py-pyright-ignore', { 'a.py': 'x = 1  # note\n' }, { 'a.py': 'x = 1  # pyright: ignore\n' }, 1],
  ['py-backslash-comment-join', { 'a.py': 'x = (1 # a\n + 2)\n' }, { 'a.py': 'x = (1 # b\n + 2)\n' }, 0],
  ['py-number-forms', { 'a.py': 'x = 1_000  # a\n' }, { 'a.py': 'x = 1000  # a\n' }, 1],
  ['py-remove-comment-join', { 'a.py': 'x = [1, # a\n2]\n' }, { 'a.py': 'x = [1, \n2]\n' }, 0],
  ['py-docstring-to-comment', { 'a.py': 'def f():\n    "doc"\n    return 1\n' }, { 'a.py': 'def f():\n    # doc\n    return 1\n' }, 1],
  // The comment keeps its text and moves by white space alone: a change of white space fails.
  ['py-comment-indent-only-block', { 'a.py': 'if x:\n    pass\n    # a\n' }, { 'a.py': 'if x:\n    pass\n# a\n' }, 1],
  ['py-formfeed-comment', { 'a.py': 'x = 1\n\x0c# a\ny = 2\n' }, { 'a.py': 'x = 1\n\x0c# b\ny = 2\n' }, 0],
  ['py-tab-indent-comment', { 'a.py': 'if 1:\n\tx = 1 # a\n' }, { 'a.py': 'if 1:\n\tx = 1 # b\n' }, 0],
  ['py-comment-only-file', { 'a.py': '# a\n' }, { 'a.py': '# b\n' }, 0],
  ['py-cr-only', { 'a.py': 'x = 1 # a\ry = 2\r' }, { 'a.py': 'x = 1 # b\ry = 2\r' }, 0],
  ['py-nosemgrep', { 'a.py': 'x = 1  # note\n' }, { 'a.py': 'x = 1  # nosemgrep\n' }, 1],
  ['py-pyre-ignore', { 'a.py': 'x = 1  # note\n' }, { 'a.py': 'x = 1  # pyre-ignore[1]\n' }, 1],
  ['py-allowlist-secret', { 'a.py': 'x = 1  # note\n' }, { 'a.py': 'x = 1  # pragma: allowlist secret\n' }, 1],
  ['py-nosonar', { 'a.py': 'x = 1  # note\n' }, { 'a.py': 'x = 1  # NOSONAR\n' }, 1],
  ['py-comment-and-spaces', { 'a.py': '# a\nx=1+2\n' }, { 'a.py': '# b\nx = 1 + 2\n' }, 1],
  ['py-comment-and-indent', { 'a.py': 'if a:\n  x = 1  # a\n' }, { 'a.py': 'if a:\n    x = 1  # b\n' }, 1],
  ['py-comment-line-removed', { 'a.py': '# a\nx = 1\n' }, { 'a.py': 'x = 1\n' }, 0],
  ['py-trailing-comment-added', { 'a.py': 'x = 1\n' }, { 'a.py': 'x = 1  # a\n' }, 0],
  ['py-parse-error', { 'a.py': 'x = 1\n' }, { 'a.py': 'x = (\n' }, 1],
];

cases(PYTHON_CASES, NO_PYTHON);
cases([['py-fstring-comment-in-expr', { 'a.py': 'x = f"""{1 # a\n}"""\n' }, { 'a.py': 'x = f"""{1 # b\n}"""\n' }, 0]], OLD_PYTHON);

// ---- the files of the change -------------------------------------------------------------

const FILES_CASES = [
  ['file-added', { 'a.sh': SH }, { 'a.sh': SH, 'b.sh': SH }, 1],
  ['file-deleted', { 'a.sh': SH, 'b.sh': SH }, { 'a.sh': SH }, 1],
  ['file-renamed', { 'a.sh': SH }, { 'c.sh': SH }, 1],
  ['unsupported-extension', { 'a.rb': '# x\nputs 1\n' }, { 'a.rb': '# y\nputs 1\n' }, 1],
  ['two-languages', { 'a.sh': SH, 'a.py': PY }, { 'a.sh': r(SH, 'Prints a greeting.', 'Hi.'), 'a.py': r(PY, 'a comment', 'b') }, 0],
  ['two-languages-one-code', { 'a.py': '# a\nx=1\n', 'b.sh': 'echo a\n' }, { 'a.py': '# b\nx=1\n', 'b.sh': 'echo b\n' }, 1],
  ['line-endings', { 'a.sh': SH }, { 'a.sh': SH.replace(/\n/g, '\r\n') }, 1],
  ['byte-order-mark', { 'a.sh': SH }, { 'a.sh': `\uFEFF${r(SH, 'Prints', 'Says')}` }, 1],
  ['whitespace-only-shell', { 'a.sh': SH }, { 'a.sh': r(SH, 'name="${1:-world}"', 'name="${1:-world}" ') }, 1],
];
cases(FILES_CASES.filter(([name]) => !/py|two-lang/.test(name)), NO_BASH);
cases(FILES_CASES.filter(([name]) => /two-lang/.test(name)), NO_BASH || NO_PYTHON);

test('comment proof: a file mode change fails', { skip: NO_BASH }, () => {
  const run = scene({ 'a.sh': SH }, { 'a.sh': r(SH, 'Prints', 'Says') });
  sh(run.dir, 'update-index', '--chmod=+x', 'a.sh');
  sh(run.dir, 'commit', '-q', '-m', 'mode');
  assert.equal(prove(run).status, 1);
});

// ---- a file that tries to run something ------------------------------------------------------

const lib = { Missing: class extends Error {} };
const shell = proofComments(lib);

// BYPASS closes the wrapper, redefines the commands of the first trap, runs a builtin, undoes
// the redefinition and opens a function again to take the end of the wrapper.
const BYPASS = ":\n}\necho() { :; }\nfalse() { return 0; }\nbuiltin zzz_ran_a_command\nunset -f echo false\nf() { :";

test('comment proof: a file that closes the wrapper runs no command and fails', { skip: NO_BASH }, () => {
  const payloads = [
    BYPASS,
    ":\n}\nbuiltin printf 'EXECUTED\\n'\nf() { :",
    ":\n}\necho() { :; }\nfalse() { return 0; }\nbuiltin printf 'EXECUTED\\n'\nunset -f echo false\nf() { :",
    ":\n}\ndeclare() { builtin printf 'EXECUTED\\n'; }\nf() { :",
    ":\n}\nprintf 'EXECUTED\\n'\nx=$(printf EXECUTED)\n: ${y:=$(printf EXECUTED)}\ntrap - DEBUG\nprintf 'EXECUTED\\n'\nf() { :",
    ":\n}\nshopt -u extdebug\nprintf 'EXECUTED\\n'\nset +T\nprintf 'EXECUTED\\n'\nf() { :",
    '}',
    ':\n}\n}\n',
  ];
  for (const payload of payloads) {
    const got = shell.shellDump(Buffer.from(payload));
    assert.ok(got.problem, payload);
    assert.ok(!got.dump, payload);
    assert.ok(!(got.out || '').includes('EXECUTED'), payload);
  }
  // The closed wrapper is found by name.
  assert.equal(shell.shellDump(Buffer.from(BYPASS)).closes, true);
  // As a change, it fails with the fix to take the brace out.
  const run = scene({ 'a.sh': ':\n' }, { 'a.sh': BYPASS });
  const got = prove(run);
  assert.equal(got.status, 1, got.out);
  assert.match(got.out, /^Make "a\.sh" parse at both commits\.$|^Take the unmatched "\}" out of "a\.sh": it closes the proof's wrapper\.$/m);
  assert.match(got.out, /At HEAD, it closes the function wrapper of the proof, with an unmatched "\}"\./);
});

test('comment proof: a closed wrapper with a loop ends at the time limit with a small output', { skip: NO_BASH }, () => {
  const loop = ':\n}\nuntil false; do echo EXECUTED; printf EXECUTED; done\nf() { :';
  const started = Date.now();
  const got = shell.shellDump(Buffer.from(loop));
  assert.ok(got.problem);
  assert.ok(Date.now() - started < proofComments.LIMIT_MS + 5000);
  assert.ok(!(got.out || '').includes('EXECUTED'));
  assert.ok((got.out || '').length < 10000);
});

test('comment proof: a long run of white space after pragma takes linear time', { skip: NO_PYTHON }, () => {
  const comment = (word) => `x = 1  # pragma${' '.repeat(200000)}${word}\n`;
  const run = scene({ 'a.py': comment('a') }, { 'a.py': comment('b') });
  const started = Date.now();
  prove(run);
  assert.ok(Date.now() - started < 10000, `${Date.now() - started} ms`);
});

test('comment proof: a file of 1 MiB or more is no comment change', { skip: NO_BASH }, () => {
  const big = `# ${'a'.repeat(1024 * 1024)}\n`;
  const run = scene({ 'a.sh': `${big}echo a\n` }, { 'a.sh': `${big.replace('a', 'b')}echo a\n` });
  const got = prove(run);
  assert.equal(got.status, 1, got.out);
  assert.match(got.out, /^Cut "a\.sh" to at most 1 MiB, or take it out of the commits\./m);
});

test('comment proof: a file that closes the wrapper in one commit fails even when both match', { skip: NO_BASH }, () => {
  const run = scene({ 'a.sh': BYPASS }, { 'a.sh': `${BYPASS}\n` });
  assert.equal(prove(run).status, 1);
});

test('comment proof: Python 3.13 parses no t-string, and the finding says so', { skip: NO_PYTHON }, () => {
  const run = scene({ 'a.py': 'x = 1\n' }, { 'a.py': 'x = t"{1}"\ny = (\n' });
  const got = prove(run);
  assert.equal(got.status, 1);
  assert.match(got.out, /Python 3\.13 parses no t-string, so a file with one fails\./);
});
