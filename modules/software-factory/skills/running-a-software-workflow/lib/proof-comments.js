// The proof of the kind "a comment" for shell and Python files: the change from the start
// commit to HEAD changes comments only. The proof compares what each language's own parser
// makes of the two blobs, and runs no code of the repository:
// - Python: the program PY_DUMP, run by the python3 of TOOLS, prints the AST of the file with
//   ast.parse, which compiles and runs nothing, and the token stream without comments, so that
//   0x10 and 16, or 'a' and "a", differ. A comment that a tool reads (noqa, type:, pragma,
//   pylint:, and the like), a shebang on line 1 and a coding line on line 1 or 2 are
//   directives: the proof compares their text too.
// - Shell: bash reads the file as the body of a function and `declare -f` prints that body
//   from its parse tree, which has no comments. Nothing of the file runs. The shell is
//   restricted (-r), has an empty PATH and an empty working folder, and a DEBUG trap with
//   extdebug skips every command but the final `declare -f`. The trap has no command word, so
//   no function that the file defines can replace a command of the trap. A function
//   definition does not fire the trap, and a definition runs nothing, so a file that closes the
//   wrapper and defines `echo` or `declare` runs nothing either. A last line `: <random>` in
//   the body shows that the file left the wrapper open: a dump without that line fails the
//   file. A directive is a shebang on line 1 and each line with "shellcheck".
// Each run stops after 10 s and after 16 MiB of output, so a closed wrapper with a loop ends
// by the time limit. A file of more than 1 MiB fails. TOOLS holds the absolute paths of the
// two interpreters; the run image has bash 5.2 and Python 3.13. Python 3.13 parses no
// t-string, so a file with one fails.
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The absolute paths of the interpreters. Only the tests change them, in the test process.
const TOOLS = { bash: '/usr/bin/bash', python: '/usr/bin/python3' };
const LIMIT_MS = 10000;
const MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_FILE = 1024 * 1024;
const LANGUAGES = { '.sh': 'sh', '.bash': 'sh', '.py': 'py' };

// The program that prints the dump of a Python file: stdin is the file, stdout the dump, and
// stderr "parse error: <reason>" with exit status 3 when the file does not parse.
const PY_DUMP = String.raw`
import ast, io, re, sys, tokenize
PY_DIRECTIVE = re.compile(
    r"noqa|nosec|pragma\s*:?\s*no\s*(cover|branch)|(^|#)\s*type\s*:"
    r"|\b(pyright|mypy|pylint|isort|fmt|ruff|yapf|pyre|pytype)\s*:",
    re.I,
)
PY_CODING = re.compile(rb"^[ \t\f]*#.*?coding[:=]", re.I)
def fail(reason):
    sys.stderr.write("parse error: " + reason.replace("\n", " ") + "\n")
    sys.exit(3)
data = sys.stdin.buffer.read()
try:
    tree = ast.parse(data)
    out = [ast.dump(tree, include_attributes=False, indent=1)]
    for n, line in enumerate(data.splitlines()[:2], 1):
        if (n == 1 and line.startswith(b"#!")) or PY_CODING.match(line):
            out.append("DIRECTIVE line %d: %r" % (n, line))
    skip_text = {tokenize.INDENT, tokenize.DEDENT, tokenize.NEWLINE}
    for t in tokenize.tokenize(io.BytesIO(data).readline):
        if t.type == tokenize.COMMENT:
            if PY_DIRECTIVE.search(t.string):
                out.append("DIRECTIVE " + t.string)
        elif t.type == tokenize.NL:
            continue
        elif t.type in skip_text:
            out.append(tokenize.tok_name[t.type])
        else:
            out.append("%s %r" % (tokenize.tok_name[t.type], t.string))
except RecursionError:
    fail("the file nests too deeply")
except MemoryError:
    fail("the parse ran out of memory")
except Exception as e:
    fail(str(e) or type(e).__name__)
sys.stdout.buffer.write("\n".join(out).encode("utf-8", "replace"))
`;

// spawn runs program with args and input in a new empty folder, with an empty environment but
// PATH, and returns { out, err } as latin1 text, or { problem } for a run that did not finish or
// wrote too much. A missing program throws.
function spawn(Missing, program, args, input, folder) {
  const ran = childProcess.spawnSync(program, args, {
    input, cwd: folder, env: { PATH: '/nonexistent', LC_ALL: 'C' }, timeout: LIMIT_MS,
    killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT, encoding: 'buffer',
  });
  if (ran.error) {
    if (ran.error.code === 'ENOENT') {
      throw new Missing(`Run the proof where ${program} exists.`,
        [`${program} is the interpreter that the proof of a comment runs, and it is missing.`]);
    }
    return { problem: ran.error.code === 'ETIMEDOUT'
      ? `${path.basename(program)} did not finish the parse within ${LIMIT_MS / 1000} s`
      : ran.error.code === 'ENOBUFS' ? `${path.basename(program)} wrote more than 16 MiB`
        : `${path.basename(program)} failed: ${ran.error.code || ran.error.message}` };
  }
  return { out: ran.stdout.toString('latin1'), err: ran.stderr.toString('latin1'),
    status: ran.status, signal: ran.signal };
}

// firstLine returns the first line of text that has a character, cut to 100 characters, with
// the names of the random wrapper left out.
function firstLine(text, names) {
  let line = text.trim().split('\n')[0] || '';
  for (const name of names) line = line.split(name).join('<wrapper>');
  return line.replace(/^.*?: line \d+: /, '').slice(0, 100);
}

module.exports = (lib) => {
  const { Missing } = lib;

  // shellDump returns { dump } for the bytes of a shell file, or { problem, closes } where closes
  // is true when the file closes the function wrapper.
  function shellDump(bytes) {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return { problem: 'it is not UTF-8' };
    }
    if (text.includes('\0')) return { problem: 'it has a NUL byte' };
    const name = `__proof_${crypto.randomBytes(8).toString('hex')}`;
    const last = `proof_end_${crypto.randomBytes(8).toString('hex')}`;
    const program = 'shopt -s extdebug extglob\nset -T\n' +
      `trap '[[ $BASH_COMMAND == "declare -f ${name}" ]]' DEBUG\n` +
      `${name}() {\n${text}\n: ${last}\n}\ndeclare -f ${name}\n`;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qory-proof-'));
    let ran;
    try {
      const script = path.join(folder, 'wrapper.sh');
      fs.writeFileSync(script, program, { mode: 0o600 });
      ran = spawn(Missing, TOOLS.bash, ['--norc', '--noprofile', '-r', script], undefined,
        folder);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
    if (ran.problem) return { problem: ran.problem };
    const tail = `    : ${last}\n}\n`;
    const names = [name, last];
    const fail = (problem, extra) => ({ problem, out: ran.out, ...extra });
    if (!ran.out.startsWith(`${name} () `)) {
      return fail(`parse error: ${firstLine(ran.err, names) || `bash exit ${ran.status}`}`);
    }
    if (!ran.out.endsWith(tail)) {
      return fail('it closes the function wrapper of the proof, with an unmatched "}"',
        { closes: true });
    }
    // Only one function is dumped, and the body ends with the last line of the wrapper.
    const body = `${ran.out.slice(name.length, ran.out.length - tail.length)}}\n`;
    const out = body.split('\n').map((line) => `BASH ${line}`);
    const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
    if (lines.length && lines[0].startsWith('#!')) out.push(`DIRECTIVE shebang ${lines[0]}`);
    for (const line of lines) {
      if (line.toLowerCase().includes('shellcheck')) out.push(`DIRECTIVE ${line.trim()}`);
    }
    return { dump: out.join('\n') };
  }

  // pythonDump returns { dump } for the bytes of a Python file, or { problem }.
  function pythonDump(bytes) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qory-proof-'));
    let ran;
    try {
      ran = spawn(Missing, TOOLS.python, ['-I', '-S', '-c', PY_DUMP], bytes, folder);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
    if (ran.problem) return { problem: ran.problem };
    if (ran.status !== 0) {
      return { problem: firstLine(ran.err, []) || `python exit ${ran.status}` };
    }
    return { dump: ran.out };
  }

  const DUMPS = { sh: shellDump, py: pythonDump };

  // short returns text cut to 60 characters, for a line.
  const short = (text) => (text.length <= 60 ? text : `${text.slice(0, 57)}...`);

  // lineEndings returns the sorted kinds of line ending of bytes, as text.
  function lineEndings(bytes) {
    const text = bytes.toString('latin1');
    const kinds = [];
    if (text.includes('\r\n')) kinds.push('CRLF');
    if (/(?<!\r)\n/.test(text)) kinds.push('LF');
    if (/\r(?!\n)/.test(text)) kinds.push('CR');
    return kinds.sort().join('+') || 'none';
  }

  // difference returns { directive, before, after } for the first line where two dumps differ.
  function difference(one, two) {
    const la = one.split('\n');
    const lb = two.split('\n');
    const directives = (lines) => lines.map((line) => line.trim())
      .filter((line) => line.startsWith('DIRECTIVE'));
    const da = directives(la);
    const db = directives(lb);
    if (da.join('\n') !== db.join('\n')) {
      const at = da.findIndex((line, place) => line !== db[place]);
      const place = at < 0 ? da.length : at;
      return { directive: true, before: da[place] || '(none)', after: db[place] || '(none)' };
    }
    for (let at = 0; at < Math.min(la.length, lb.length); at += 1) {
      if (la[at] !== lb[at]) {
        const directive = la[at].trim().startsWith('DIRECTIVE') ||
          lb[at].trim().startsWith('DIRECTIVE');
        return { directive, before: la[at].trim(), after: lb[at].trim() };
      }
    }
    return { directive: false, before: '(the tree)', after: '(a tree of another length)' };
  }

  // commentChange returns the problems of one changed file as a list of { fix, cause }, or []
  // for a file whose change is comments only. file is its path, before and after are the
  // bytes at the two commits.
  function commentChange(file, before, after) {
    const language = LANGUAGES[path.extname(file).toLowerCase()];
    if (!language) return null;
    if (before.length > MAX_FILE || after.length > MAX_FILE) {
      return [{ fix: 'cut', cause: 'The comment proof reads a file of at most 1 MiB.' }];
    }
    const endings = [lineEndings(before), lineEndings(after)];
    if (endings[0] !== endings[1]) {
      return [{ fix: 'line endings', cause: `The line endings are ${endings[0]} at the start ` +
        `commit and ${endings[1]} at HEAD.` }];
    }
    const bom = (bytes) => bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
    if (bom(before) !== bom(after)) {
      return [{ fix: 'byte order mark', cause: 'The commits add or remove a byte order mark.' }];
    }
    const dumps = [];
    for (const [name, bytes] of [['the start commit', before], ['HEAD', after]]) {
      const got = DUMPS[language](bytes);
      if (got.problem) {
        const note = language === 'py' ? ' Python 3.13 parses no t-string, so a file with one ' +
          'fails.' : '';
        return [{ fix: 'parse', cause: `At ${name}, ${got.problem}.${note}`,
          closes: got.closes }];
      }
      dumps.push(got.dump);
    }
    if (dumps[0] === dumps[1]) return [];
    const found = difference(dumps[0], dumps[1]);
    return [{ fix: found.directive ? 'directive' : 'code',
      cause: `The first difference once the comments are left out: ${short(found.before)} ` +
        `became ${short(found.after)}.` }];
  }

  return { commentChange, shellDump, pythonDump, LANGUAGES };
};

module.exports.TOOLS = TOOLS;
module.exports.LIMIT_MS = LIMIT_MS;
