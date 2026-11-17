// The proof of the kind "a comment" for shell and Python files: the change from the start
// commit to HEAD changes comments only. The proof compares what the parser of each language
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
// two interpreters; qory's agent image has bash 5.2 and Python 3.13. Python 3.13 parses no
// t-string, so a file with one fails.
'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { layout, shellComments } = require('./layout.js');
const { PATTERNS } = require('./text-deny.js');

// The absolute paths of the interpreters. Only the tests change them, in the test process.
const TOOLS = { bash: '/bin/bash', python: '/usr/bin/python3' };
const LIMIT_MS = 10000;
const MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_FILE = 1024 * 1024;
// The words of a line of shell that a linter or a scanner reads: the line is code.
const SHELL_DIRECTIVE = new RegExp(['shellcheck', 'shfmt', 'nosemgrep', 'nosec', 'nosonar', 'lgtm',
  'codeql', 'gitleaks', String.raw`allowlist\s+secret`, 'snyk', 'trufflehog', 'detect-secrets',
  'noqa', 'bandit',
  String.raw`\b(?:ignor|skip|disabl|suppress|allowlist|nolint|noinspection|nosec|nocheck)\w*`,
  String.raw`formatter:\s*(?:off|on)`].join('|'), 'iu');
const LANGUAGES = { '.sh': 'sh', '.bash': 'sh', '.py': 'py' };

// The program that prints the dump of a Python file: stdin is the file, stdout the dump, and
// stderr "parse error: <reason>" with exit status 3 when the file does not parse.
const PY_DUMP = String.raw`
import ast, io, json, re, sys, tokenize, unicodedata
PY_DIRECTIVE = re.compile(
    r"noqa|nosec|pragma\s{0,20}:?\s{0,20}no\s{0,20}(cover|branch)|(^|#)\s{0,20}type\s{0,20}:"
    r"|\b(pyright|mypy|pylint|isort|fmt|ruff|yapf|pyre|pytype)\s{0,20}:"
    r"|nosemgrep|nosonar|lgtm|codeql|gitleaks|allowlist\s{1,20}secret|pyre-(ignore|fixme)|snyk"
    r"|trufflehog|detect-secrets|bandit"
    r"|\b(ignor|skip|disabl|suppress|allowlist|nolint|noinspection|nosec|nocheck)\w*"
    r"|formatter:\s{0,20}(off|on)",
    re.I,
)
PY_CODING = re.compile(rb"^[ \t\f]*#.*?coding[:=]", re.I)
MODE = sys.argv[1] if len(sys.argv) > 1 else "comment"

def layout(text, comments, masks):
    """The text with the comments left out and each mask replaced by one mark (lib/layout.js)."""
    ranges = sorted([(s, min(e, len(text)), True) for s, e in masks] +
                    [(s, min(e, len(text)), False) for s, e in comments],
                    key=lambda r: (r[0], -r[1]))
    ranges = [r for r in ranges if 0 <= r[0] < r[1]]
    out, at = [], 0
    for s, e, mask in ranges:
        if s < at:
            continue
        if mask:
            out.append(text[at:s])
            out.append("\u0001")
            at = e
            continue
        frm = s
        while frm > at and text[frm - 1] in " \t":
            frm -= 1
        line_start = frm == 0 or text[frm - 1] in "\r\n"
        after = e
        while after < len(text) and text[after] in " \t":
            after += 1
        line_end = after >= len(text) or text[after] in "\r\n"
        if line_start and line_end:
            to = after
            if text[to:to + 2] == "\r\n":
                to += 2
            elif to < len(text):
                to += 1
            out.append(text[at:frm])
            at = to
        elif line_start:
            out.append(text[at:s])
            at = after
        else:
            out.append(text[at:frm])
            at = e
    out.append(text[at:])
    return re.sub(r"[ \t]+(?=\r?\n|\r|$)", "", "".join(out))
def fail(reason):
    sys.stderr.write("parse error: " + reason.replace("\n", " ") + "\n")
    sys.exit(3)
data = sys.stdin.buffer.read()

DENY = re.compile("|".join("(?:%s)" % one for one in json.loads(
    sys.argv[2] if len(sys.argv) > 2 else "[]")), re.I)

def denied(value):
    """A string is no text for a person by DENY, as it is, in its NFKC form, and with its tabs and
    line breaks left out (lib/text-deny.js)."""
    forms = [value, unicodedata.normalize("NFKC", value)]
    forms += [re.sub(r"[\t\n\r]", "", one) for one in forms]
    return any(DENY.search(one) for one in forms)
ARGUMENT_CALLS = re.compile(
    r"^(?:eval|exec|compile|system|popen|spawn|call|check_call|check_output|run|Popen|"
    r"getoutput|getstatusoutput|query|execute|executemany|executescript|fetch|fetchone|"
    r"__import__|import_module|getattr|setattr|hasattr|delattr|open|get|pop|setdefault|"
    r"has_key|index|count|find|rfind|startswith|endswith|match|fullmatch|search|sub|subn|"
    r"findall|finditer|split|select|select_one|find_element|find_elements|find_all|xpath|css|"
    r"locator|query_selector|query_selector_all|get_by_\w+|wait_for_selector|redirect|"
    r"url_for|reverse|render_template|send_file|send_from_directory|loads|load|Template|"
    r"literal_eval|environ|getenv|putenv|connect|request|urlopen|post|put|patch|delete|head)$")
RECEIVER_CALLS = re.compile(r"^(?:startswith|endswith|find|rfind|index|count|join|match)$")

MATCH = getattr(ast, "Match", ())

def call_name(call):
    func = call.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None

class Keep(ast.NodeVisitor):
    """Marks the strings that are no text for a person. A string is no text by its place:
    a docstring, a key, a subscript, a format specification, a comparison, a match pattern, a
    type, a name of an import or an attribute, an argument of a command, a lookup or a selector.
    Its content decides too: a link, markup, a template, SQL, shell syntax or a path (DENY)."""
    def __init__(self):
        self.kept = set()
    def mark(self, node):
        for child in ast.walk(node):
            if isinstance(child, ast.Constant):
                self.kept.add(id(child))
    def visit(self, node):
        body = getattr(node, "body", None)
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) \
                and isinstance(body, list) and body and isinstance(body[0], ast.Expr) \
                and isinstance(body[0].value, ast.Constant):
            self.mark(body[0].value)
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and denied(node.value):
            self.kept.add(id(node))
        if isinstance(node, ast.Dict):
            for key in node.keys:
                if key is not None:
                    self.mark(key)
        elif isinstance(node, ast.Subscript):
            self.mark(node.slice)
        elif isinstance(node, ast.FormattedValue) and node.format_spec is not None:
            self.mark(node.format_spec)
        elif isinstance(node, ast.Compare):
            for operand in [node.left] + node.comparators:
                self.mark(operand)
        elif isinstance(node, MATCH):
            for case in node.cases:
                self.mark(case.pattern)
                if case.guard is not None:
                    self.mark(case.guard)
        elif isinstance(node, ast.arg) and node.annotation is not None:
            self.mark(node.annotation)
        elif isinstance(node, ast.AnnAssign):
            self.mark(node.annotation)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.returns is not None:
            self.mark(node.returns)
        elif isinstance(node, ast.Call):
            name = call_name(node)
            if name and ARGUMENT_CALLS.search(name):
                for arg in node.args:
                    self.mark(arg)
                for keyword in node.keywords:
                    self.mark(keyword.value)
            if name and RECEIVER_CALLS.search(name) and isinstance(node.func, ast.Attribute):
                self.mark(node.func.value)
            if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) \
                    and node.func.value.id in ("subprocess", "os", "re", "shlex", "sqlite3"):
                for arg in node.args:
                    self.mark(arg)
                for keyword in node.keywords:
                    self.mark(keyword.value)
        elif isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "__all__" for t in node.targets):
            self.mark(node.value)
        elif isinstance(node, ast.keyword) and node.arg in ("encoding", "mode", "name", "key"):
            self.mark(node.value)
        self.generic_visit(node)

class Mask(ast.NodeTransformer):
    def __init__(self, kept):
        self.kept = kept
    def visit_Constant(self, node):
        if isinstance(node.value, str) and id(node) not in self.kept:
            return ast.copy_location(ast.Constant(value="STR"), node)
        return node

try:
    tree = ast.parse(data)
    if MODE == "text":
        keep = Keep()
        keep.visit(tree)
        tree = Mask(keep.kept).visit(tree)
    out = [ast.dump(tree, include_attributes=False, indent=1)]
    for n, line in enumerate(data.splitlines()[:2], 1):
        if (n == 1 and line.startswith(b"#!")) or PY_CODING.match(line):
            out.append("DIRECTIVE line %d: %r" % (n, line))
    skip_text = {tokenize.INDENT, tokenize.DEDENT, tokenize.NEWLINE}
    for t in tokenize.tokenize(io.BytesIO(data).readline):
        if t.type == tokenize.COMMENT:
            if MODE == "text":
                out.append("COMMENT " + t.string)
            elif PY_DIRECTIVE.search(t.string):
                out.append("DIRECTIVE " + t.string)
        elif t.type == tokenize.NL:
            continue
        elif t.type in skip_text:
            out.append(tokenize.tok_name[t.type])
        elif MODE == "text" and t.type in (tokenize.STRING, getattr(tokenize, "FSTRING_MIDDLE", -1)):
            out.append("%s STR" % tokenize.tok_name[t.type])
        else:
            out.append("%s %r" % (tokenize.tok_name[t.type], t.string))
    # The layout: the text without the comments, and with each masked string a mark.
    src = data.decode(tokenize.detect_encoding(io.BytesIO(data).readline)[0])
    starts, total = [], 0
    for one in src.split("\n"):
        starts.append(total)
        total += len(one) + 1
    comment_ranges, mask_ranges = [], []
    fstring_middle = getattr(tokenize, "FSTRING_MIDDLE", -1)
    for t in tokenize.generate_tokens(io.StringIO(src).readline):
        if t.type == tokenize.COMMENT and MODE != "text" and not PY_DIRECTIVE.search(t.string):
            comment_ranges.append((starts[t.start[0] - 1] + t.start[1],
                                   starts[t.end[0] - 1] + t.end[1]))
        elif MODE == "text" and t.type in (tokenize.STRING, fstring_middle):
            mask_ranges.append((starts[t.start[0] - 1] + t.start[1],
                                starts[t.end[0] - 1] + t.end[1]))
    out.append("LAYOUT " + json.dumps(layout(src, comment_ranges, mask_ranges)))
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
function spawn(Missing, program, args, input, folder, limit = LIMIT_MS) {
  const ran = childProcess.spawnSync(program, args, {
    input, cwd: folder, env: { PATH: '/nonexistent', LC_ALL: 'C' }, timeout: limit,
    killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT, encoding: 'buffer',
  });
  if (ran.error) {
    if (ran.error.code === 'ENOENT') {
      throw new Missing(`Run the proof where ${program} exists.`,
        [`${program} is the interpreter that the proof of a comment runs, and it is missing.`]);
    }
    return { problem: ran.error.code === 'ETIMEDOUT'
      ? `${path.basename(program)} did not finish the parse within ${limit / 1000} s`
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
  function shellDump(bytes, limit = LIMIT_MS) {
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
        folder, limit);
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
      if (SHELL_DIRECTIVE.test(line)) out.push(`DIRECTIVE ${line.trim()}`);
    }
    // The layout leaves out each comment but a directive and the shebang.
    const kept = shellComments(text).filter(([start, end]) => !(start === 0 && text[1] === '!') &&
      !SHELL_DIRECTIVE.test(text.slice(start, end)));
    out.push(`LAYOUT ${JSON.stringify(layout(text, kept))}`);
    return { dump: out.join('\n') };
  }

  // pythonDump returns { dump } for the bytes of a Python file, or { problem }.
  function pythonDump(bytes, mode = 'comment', limit = LIMIT_MS) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qory-proof-'));
    let ran;
    try {
      ran = spawn(Missing, TOOLS.python, ['-I', '-S', '-c', PY_DUMP, mode,
        JSON.stringify(PATTERNS)], bytes, folder, limit);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
    if (ran.problem) return { problem: ran.problem };
    if (ran.status !== 0) {
      return { problem: firstLine(ran.err, []) || `python exit ${ran.status}` };
    }
    return { dump: ran.out };
  }

  
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

  // commonProblems returns the problems of a pair of blobs that no dump can show, as a list of
  // { fix, cause }, or null for none: a file over MAX_FILE, other line endings, or a byte order
  // mark that one commit has and the other has not.
  function commonProblems(before, after) {
    if (before.length > MAX_FILE || after.length > MAX_FILE) {
      return [{ fix: 'cut', cause: 'The proof reads a file of at most 1 MiB.' }];
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
    return null;
  }

  // What the dumps leave out, by mode, for the line of a difference.
  const LEFT_OUT = { comment: 'the comments are left out', text: 'the text values are masked',
    look: 'the look values are masked' };

  // What the layout leaves out, by mode, for the cause of a change of layout.
  const LEFT_OUT_OF = { comment: 'the comments', text: 'the text values',
    look: 'the look values' };

  // compare returns the problems of one changed file as a list of { fix, cause }, or [] for a
  // file whose two dumps are the same: dumpOf(bytes) returns { dump } or { problem, closes },
  // note is added to the cause of a file that does not parse.
  function compare(before, after, dumpOf, mode, note = '') {
    const dumps = [];
    for (const [name, bytes] of [['the start commit', before], ['HEAD', after]]) {
      const got = dumpOf(bytes);
      if (got.problem) {
        return [{ fix: 'parse', cause: `At ${name}, ${got.problem}.${note}`, closes: got.closes,
          missing: got.missing }];
      }
      dumps.push(got.dump);
    }
    if (dumps[0] === dumps[1]) return [];
    const found = difference(dumps[0], dumps[1]);
    if (found.before.startsWith('LAYOUT') || found.after.startsWith('LAYOUT')) {
      return [{ fix: 'layout', cause: `The text outside ${LEFT_OUT_OF[mode]} has other white space ` +
        'or other characters at HEAD.' }];
    }
    return [{ fix: found.directive ? 'directive' : 'code', before: found.before,
      after: found.after, cause: `The first difference once ${LEFT_OUT[mode]}: ` +
        `${short(found.before)} became ${short(found.after)}.` }];
  }

  // supports reports whether commentChange has a proof of the file in the mode: a shell file in
  // comment mode, a Python file in comment and text mode.
  function supports(file, mode) {
    const language = LANGUAGES[path.extname(file).toLowerCase()];
    return Boolean(language) && mode !== 'look' && !(language === 'sh' && mode !== 'comment');
  }

  // commentChange returns the problems of one changed shell or Python file, as compare returns
  // them, or null for a file of another language, or a shell file in a mode that has no proof
  // for it. file is its path, before and after are the bytes at the two commits.
  function commentChange(file, before, after, mode = 'comment', deadline = Infinity) {
    const language = LANGUAGES[path.extname(file).toLowerCase()];
    if (!supports(file, mode)) return null;
    const common = commonProblems(before, after);
    if (common) return common;
    const note = language === 'py' ? ' Python 3.13 parses no t-string, so a file with one ' +
      'fails.' : '';
    // Each run takes at most what is left of the budget of the proof.
    const limit = () => Math.max(1000, Math.min(LIMIT_MS, deadline - Date.now()));
    return compare(before, after, language === 'sh' ? (bytes) => shellDump(bytes, limit())
      : (bytes) => pythonDump(bytes, mode, limit()), mode, note);
  }

  return { commentChange, supports, commonProblems, compare, shellDump, pythonDump, LANGUAGES };
};

module.exports.TOOLS = TOOLS;
module.exports.spawn = spawn;
module.exports.LIMIT_MS = LIMIT_MS;
