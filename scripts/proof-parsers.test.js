// Tests of the proofs that need a parser (lib/proof-parsers.js, lib/parse-dump.js): the kinds "a
// comment", "a text value in a code file" and "a look-only change" for TypeScript, JavaScript,
// SQL, HTML, CSS, SCSS and design tokens. scripts/check.sh runs them. Each case makes a git
// checkout with a base commit and a head commit, and calls the proof as a function with the
// folder of the parsers: /opt/qory/parsers/node_modules, or the folder in PROOF_TEST_PARSERS, with
// the packages that qory's parsers folder pins. Without the packages, the tests are skipped.
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const MODULES = path.join(__dirname, '../modules');
const { LIBRARY } = require(path.join(MODULES, 'core/skills/running-a-workflow/lib/registry.js'));
const SKILL = path.join(MODULES, 'software-factory/skills/running-a-software-workflow');
const { proof } = require(path.join(SKILL, 'workflow-checks.js'))(LIBRARY);
const proofComments = require(path.join(SKILL, 'lib/proof-comments.js'));

const PARSERS = process.env.PROOF_TEST_PARSERS || '/opt/qory/parsers/node_modules';
const NO_PARSERS = ['typescript', 'libpg-query', 'parse5', 'postcss', 'postcss-scss']
  .every((name) => fs.existsSync(path.join(PARSERS, name, 'package.json'))) ? false
  : 'the parsers are not installed';
if (process.env.PROOF_TEST_BASH) proofComments.TOOLS.bash = process.env.PROOF_TEST_BASH;
if (process.env.PROOF_TEST_PYTHON) proofComments.TOOLS.python = process.env.PROOF_TEST_PYTHON;
const NO_PYTHON = fs.existsSync(proofComments.TOOLS.python) ? false : 'python3 is missing';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'proof-parsers-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const ENV = { PATH: process.env.PATH, HOME: tmp, LC_ALL: 'C' };
const LISTS = proof.trackLists({ extensions: () => ({}) });

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

const COMMENT = 'a comment';
const TEXT = 'a text value in a code file';
const LOOK = 'a look-only change';

// scene commits base, then head, and returns what prove needs.
function scene(base, head) {
  count += 1;
  const dir = path.join(tmp, `repo-${count}`);
  fs.mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  const first = commit(dir, base, 'base');
  const inputs = path.join(tmp, `inputs-${count}`, 'inputs.json');
  fs.mkdirSync(path.dirname(inputs), { recursive: true });
  fs.writeFileSync(inputs, JSON.stringify({ qory: { harness_extensions: {},
    start_commits: [{ path: dir, commit: first }], start_artifacts: tmp } }));
  const rest = {};
  for (const name of Object.keys(base)) if (!Object.hasOwn(head, name)) rest[name] = null;
  commit(dir, { ...rest, ...head }, 'head');
  return { dir, inputs };
}

// run proves the change from base to head against kind, with the folder of the parsers.
function run(kind, base, head, parsers = { dir: PARSERS }) {
  const found = scene(base, head);
  const done = proof.prove({ cwd: found.dir, env: ENV, inputs: found.inputs, kind, lists: LISTS,
    parsers });
  for (const line of done.findings) assert.ok(line.split('\n')[0].length <= 100, line);
  return done.findings;
}

// cases defines a test for each [name, base, head, expected] of list: expected is 0 for a
// change that the proof passes and 1 for any other.
function cases(kind, list, skip = NO_PARSERS) {
  for (const [name, base, head, expected] of list) {
    test(`${kind}: ${name}`, { skip }, () => {
      const found = run(kind, base, head);
      assert.equal(found.length ? 1 : 0, expected, found.join('\n'));
    });
  }
}

const r = (text, from, to) => {
  assert.ok(text.includes(from), from);
  return text.replace(from, to);
};

// ---- comments: TypeScript, JavaScript, SQL and HTML -------------------------------------------

const TS = '// Greets a person.\nexport function greet(name: string): string {\n  const s = `Hello ${name} // not a comment`;\n  return s + "/* not a comment */";\n}\n\nexport function pick(a: number) {\n  return /* inline */ a;\n}\n';
const TSX = 'export function Hi(p: { name: string }) {\n  return <div>{/* a note */}Hi {p.name}</div>;\n}\n';
const JS = '/**\n * Adds two numbers.\n * @param {number} a first\n * @param {number} b second\n */\nexport function add(a, b) {\n  // plain comment\n  return a + b;\n}\n';
const SQL = "-- Active users.\nSELECT id, 'a -- b' AS label /* block */\nFROM users\nWHERE active = true;\n";
const FN = 'CREATE FUNCTION one() RETURNS int AS $$\nBEGIN\n  -- body note\n  RETURN 1;\nEND $$ LANGUAGE plpgsql;\n';
const HTML = '<!doctype html>\n<html>\n<!-- page head -->\n<head><title>T</title></head>\n<body>\n<p>Hi</p>\n<script>// script note\nvar x = 1;</script>\n</body>\n</html>\n';
const E = 'let x: number = "s";\n';
const H = '<!doctype html><html><body>\n%s\n</body></html>\n';
const h = (body) => H.replace('%s', body);

// These five files do not parse with the pinned parsers (the HTML-like comments of old scripts, a
// string continuation, UESCAPE and a psql variable), so the proof fails closed on them.
// An HTML text that parse5 reads as a comment but that does not start with <!-- (<! a >, </ a >,
// <?a?> and <![CDATA[ a ]]>) is code: the proof compares its source.
const COMMENT_CASES = [
  ['ts-comment', { 'a.ts': TS }, { 'a.ts': r(r(TS, 'Greets a person.', 'Says hello.'), 'inline', 'x') }, 0],
  ['ts-code', { 'a.ts': TS }, { 'a.ts': r(TS, 'return s +', 'return s.trim() +') }, 1],
  ['ts-jsdoc', { 'a.ts': TS }, { 'a.ts': r(TS, '// Greets a person.', '/**\n * Greets.\n * @param name who\n */') }, 0],
  ['ts-type', { 'a.ts': TS }, { 'a.ts': r(TS, 'a: number', 'a: bigint') }, 1],
  ['ts-template', { 'a.ts': TS }, { 'a.ts': r(TS, '// not a comment`', '// changed`') }, 1],
  ['ts-string', { 'a.ts': TS }, { 'a.ts': r(TS, '/* not a comment */', '/* changed */') }, 1],
  // A change of white space outside comments fails.
  ['ts-whitespace', { 'a.ts': TS }, { 'a.ts': r(r(TS, '  const s', '    const s'), '): string {', '):string{') }, 1],
  ['ts-directive', { 'a.ts': TS }, { 'a.ts': r(TS, '  return s', '  // @ts-ignore\n  return s') }, 1],
  ['ts-asi', { 'a.ts': TS }, { 'a.ts': r(TS, '/* inline */', '/* in\nline */') }, 1],
  ['tsx-comment', { 'a.tsx': TSX }, { 'a.tsx': r(TSX, 'a note', 'another note') }, 0],
  ['tsx-code', { 'a.tsx': TSX }, { 'a.tsx': r(TSX, 'Hi {p', 'Hello {p') }, 1],
  ['js-comment', { 'a.js': JS }, { 'a.js': r(JS, 'plain comment', 'other comment') }, 0],
  ['js-code', { 'a.js': JS }, { 'a.js': r(JS, 'a + b', 'a - b') }, 1],
  ['js-jsdoc-text', { 'a.js': JS }, { 'a.js': r(JS, 'Adds two numbers.', 'Sums.') }, 0],
  ['js-jsdoc-type', { 'a.js': JS }, { 'a.js': r(JS, '{number} a', '{string} a') }, 1],
  ['mjs-comment', { 'a.mjs': JS }, { 'a.mjs': r(JS, 'plain comment', 'other comment') }, 0],
  ['js-crlf', { 'a.js': JS }, { 'a.js': JS.replace(/\n/g, '\r\n') }, 1],
  ['js-parse-error', { 'a.js': JS }, { 'a.js': r(JS, 'return a + b;', 'return a + ;') }, 1],
  ['sql-comment', { 'a.sql': SQL }, { 'a.sql': r(r(SQL, 'Active users.', 'Users.'), 'block', 'x') }, 0],
  ['sql-code', { 'a.sql': SQL }, { 'a.sql': r(SQL, 'true', 'false') }, 1],
  ['sql-dash-string', { 'a.sql': SQL }, { 'a.sql': r(SQL, "'a -- b'", "'a -- c'") }, 1],
  ['sql-keyword-case', { 'a.sql': SQL }, { 'a.sql': r(SQL, 'FROM', 'from') }, 1],
  ['sql-hint', { 'a.sql': SQL }, { 'a.sql': r(SQL, '/* block */', '/*+ SeqScan(users) */') }, 1],
  ['sql-function-body', { 'a.sql': FN }, { 'a.sql': r(FN, '-- body note', '-- note') }, 1],
  ['sql-mysql', { 'a.sql': '-- a\nSELECT `id` FROM t;\n' }, { 'a.sql': '-- b\nSELECT `id` FROM t;\n' }, 1],
  ['html-comment', { 'a.html': HTML }, { 'a.html': r(HTML, 'page head', 'head') }, 0],
  ['html-code', { 'a.html': HTML }, { 'a.html': r(HTML, '<p>Hi', '<p>Hello') }, 1],
  ['html-script-comment', { 'a.html': HTML }, { 'a.html': r(HTML, 'script note', 'note') }, 1],
  ['html-conditional', { 'a.html': HTML }, { 'a.html': r(HTML, '<!-- page head -->', '<!--[if IE]><p>x</p><![endif]-->') }, 1],
  ['html-whitespace', { 'a.html': HTML }, { 'a.html': r(HTML, '<p>Hi</p>', '<p> Hi</p>') }, 1],
  ['file-added', { 'a.ts': TS }, { 'a.ts': TS, 'b.ts': TS }, 1],
  ['file-deleted', { 'a.ts': TS, 'b.ts': TS }, { 'a.ts': TS }, 1],
  ['file-renamed', { 'a.ts': TS }, { 'c.ts': TS }, 1],
  ['unsupported', { 'a.rb': '# x\nputs 1\n' }, { 'a.rb': '# y\nputs 1\n' }, 1],
  ['ts-nocheck-upper', { 'a.ts': `// note\n${E}` }, { 'a.ts': `// @TS-NOCHECK\n${E}` }, 1],
  ['js-tscheck-upper', { 'a.js': '// note\nlet x = 1;\n' }, { 'a.js': '// @TS-CHECK\nlet x = 1;\n' }, 1],
  ['ts-reference-upper', { 'a.ts': '// note\nlet x = 1;\n' }, { 'a.ts': '/// <REFERENCE path="b.ts" />\nlet x = 1;\n' }, 1],
  ['tsx-jsximportsource-lower', { 'a.tsx': '/** note */\nconst e = <div/>;\n' }, { 'a.tsx': '/** @jsximportsource preact */\nconst e = <div/>;\n' }, 1],
  ['ts-expect-error-spacing', { 'a.ts': `//note\n${E}` }, { 'a.ts': `//    @ts-expect-error\n${E}` }, 1],
  ['ts-expect-error-block', { 'a.ts': `/* note */\n${E}` }, { 'a.ts': `/* @ts-expect-error */\n${E}` }, 1],
  ['ts-ignore-comment-text', { 'a.ts': `// @ts-ignore old\n${E}` }, { 'a.ts': `// @ts-ignore new reason\n${E}` }, 1],
  ['ts-triple-slash', { 'a.ts': '/// <reference path="b.ts" />\nlet x=1;\n' }, { 'a.ts': '/// <reference path="c.ts" />\nlet x=1;\n' }, 1],
  ['ts-join-tokens', { 'a.ts': 'let y = a/**/-/**/-b;\n' }, { 'a.ts': 'let y = a-/**/-b;\n' }, 0],
  ['ts-join-tokens2', { 'a.ts': 'let y = a-/**/-b;\n' }, { 'a.ts': 'let y = a--b;\n' }, 1],
  ['js-regex-slashes', { 'a.js': 'const r = /a\\/\\/b/; // c1\n' }, { 'a.js': 'const r = /a\\/\\/b/; // c2\n' }, 0],
  ['js-regex-vs-comment', { 'a.js': 'const r = /a/ // b/;\n' }, { 'a.js': 'const r = /a/ // c/;\n' }, 0],
  ['js-asi-block-newline', { 'a.js': 'function f(){ return /* a */ 1 }\n' }, { 'a.js': 'function f(){ return /* a\n */ 1 }\n' }, 1],
  ['tsx-jsx-comment', { 'a.tsx': 'const e = <div>{/* a */}x</div>;\n' }, { 'a.tsx': 'const e = <div>{/* b */}x</div>;\n' }, 0],
  ['tsx-jsx-comment-removed', { 'a.tsx': 'const e = <div>{/* a */}x</div>;\n' }, { 'a.tsx': 'const e = <div>x</div>;\n' }, 0],
  ['jsx-jsx-comment', { 'a.jsx': 'const e = <div>{/* a */}x</div>;\n' }, { 'a.jsx': 'const e = <div>{/* b */}x</div>;\n' }, 0],
  ['jsx-text-slashes', { 'a.jsx': 'const e = <div>// a</div>;\n' }, { 'a.jsx': 'const e = <div>// b</div>;\n' }, 1],
  ['jsx-in-js', { 'a.js': 'const e = <div>{/* a */}x</div>;\n' }, { 'a.js': 'const e = <div>{/* b */}x</div>;\n' }, 0],
  ['ts-generic-vs-jsx-ext', { 'a.ts': 'const f = <T,>(x: T) => x; // a\n' }, { 'a.ts': 'const f = <T,>(x: T) => x; // b\n' }, 0],
  ['js-jsdoc-type-cast', { 'a.js': 'const x = /** @type {number} */ (y);\n' }, { 'a.js': 'const x = /** @type {string} */ (y);\n' }, 1],
  ['js-jsdoc-readonly', { 'a.js': 'class A { /** note */ x = 1; }\n' }, { 'a.js': 'class A { /** @readonly */ x = 1; }\n' }, 1],
  ['js-jsdoc-private', { 'a.js': 'class A { /** note */ x = 1; }\n' }, { 'a.js': 'class A { /** @private */ x = 1; }\n' }, 1],
  ['js-jsdoc-type-inline-trailing', { 'a.js': 'let a = 1, /** @type {number} */ b = 2;\n' }, { 'a.js': 'let a = 1, /** @type {string} */ b = 2;\n' }, 1],
  ['ts-sourcemap', { 'a.js': 'x();\n//# sourceMappingURL=a.map\n' }, { 'a.js': 'x();\n//# sourceMappingURL=b.map\n' }, 1],
  ['js-pure-trailing', { 'a.js': 'const a = /* x */ f();\n' }, { 'a.js': 'const a = /* #__PURE__ */ f();\n' }, 1],
  ['js-comment-in-template-expr', { 'a.js': 'const s = `${/* a */ x}`;\n' }, { 'a.js': 'const s = `${/* b */ x}`;\n' }, 0],
  ['js-html-comment-legacy', { 'a.js': 'x = 1;\n<!-- a\n' }, { 'a.js': 'x = 1;\n<!-- b\n' }, 1],
  ['js-html-close-comment', { 'a.js': 'x = 1;\n--> y = 2\n' }, { 'a.js': 'x = 1;\n--> y = 3\n' }, 1],
  ['js-two-files-one-code', { 'a.js': '// a\nx=1;\n', 'b.ts': 'let y = 1;\n' }, { 'a.js': '// b\nx=1;\n', 'b.ts': 'let y = 2;\n' }, 1],
  ['js-eslint-inline-trailing', { 'a.js': 'x = 1; // note\n' }, { 'a.js': 'x = 1; // eslint-disable-line\n' }, 1],
  ['js-eslint-block-midline', { 'a.js': 'x = 1; /* note */\n' }, { 'a.js': 'x = 1; /* eslint-disable-line no-undef */\n' }, 1],
  ['js-eslint-after-text', { 'a.js': '// note\nx=1;\n' }, { 'a.js': '//  eslint-disable no-undef\nx=1;\n' }, 1],
  ['js-eslint-jsdoc', { 'a.js': '/* note */\nx=1;\n' }, { 'a.js': '/** eslint-disable */\nx=1;\n' }, 1],
  ['ts-unicode-escape-ident', { 'a.ts': 'let \\u0061 = 1; // a\n' }, { 'a.ts': 'let a = 1; // a\n' }, 1],
  ['js-jsdoc-import', { 'a.js': '/** @import { A } from "./a" */\nlet x = 1;\n' }, { 'a.js': '/** @import { A } from "./b" */\nlet x = 1;\n' }, 1],
  ['js-jsdoc-extends', { 'a.js': '/** @extends {Base<string>} */\nclass A extends Base {}\n' }, { 'a.js': '/** @extends {Base<number>} */\nclass A extends Base {}\n' }, 1],
  ['js-jsdoc-implements', { 'a.js': '/** @implements {I1} */\nclass A {}\n' }, { 'a.js': '/** @implements {I2} */\nclass A {}\n' }, 1],
  ['js-jsdoc-typedef-property', { 'a.js': '/**\n * @typedef {Object} P\n * @property {number} x\n */\nlet y = 1;\n' }, { 'a.js': '/**\n * @typedef {Object} P\n * @property {string} x\n */\nlet y = 1;\n' }, 1],
  ['js-jsdoc-template-add', { 'a.js': '/**\n * @template T\n * @param {T} a\n */\nfunction f(a) {}\n' }, { 'a.js': '/**\n * @template {string} T\n * @param {T} a\n */\nfunction f(a) {}\n' }, 1],
  ['js-jsdoc-description-only', { 'a.js': '/**\n * Old text.\n * @param {number} a first\n */\nfunction f(a) {}\n' }, { 'a.js': '/**\n * New text.\n * @param {number} a the first\n */\nfunction f(a) {}\n' }, 0],
  ['js-tscheck-mixed-case-in-jsx', { 'a.jsx': '// note\nconst e = <div/>;\n' }, { 'a.jsx': '// @TS-NoCheck\nconst e = <div/>;\n' }, 1],
  ['sql-minus-comment-minus', { 'a.sql': 'SELECT 5 -/* a */- 2;\n' }, { 'a.sql': 'SELECT 5 -/* b */- 2;\n' }, 0],
  ['sql-minus-comment-minus-removed', { 'a.sql': 'SELECT 5 -/* a */- 2;\n' }, { 'a.sql': 'SELECT 5 -- 2;\n' }, 1],
  ['sql-op-with-comment', { 'a.sql': 'SELECT 5 +/* a */- 2;\n' }, { 'a.sql': 'SELECT 5 +/* b */- 2;\n' }, 0],
  ['sql-op-comment-join', { 'a.sql': 'SELECT 1 </* a */> 2;\n' }, { 'a.sql': 'SELECT 1 <> 2;\n' }, 1],
  ['sql-nested-comment', { 'a.sql': 'SELECT 1 /* a /* b */ c */;\n' }, { 'a.sql': 'SELECT 1 /* a /* d */ c */;\n' }, 0],
  ['sql-string-continuation', { 'a.sql': "SELECT 'a'\n-- x\n'b';\n" }, { 'a.sql': "SELECT 'a'\n-- y\n'b';\n" }, 1],
  ['sql-string-continuation-sameline', { 'a.sql': "SELECT 'a' -- x\n'b';\n" }, { 'a.sql': "SELECT 'a' /* x */ 'b';\n" }, 1],
  ['sql-uescape', { 'a.sql': "SELECT U&'d!0061t' /* a */ UESCAPE '!';\n" }, { 'a.sql': "SELECT U&'d!0061t' /* b */ UESCAPE '!';\n" }, 1],
  ['sql-hint-added', { 'a.sql': 'SELECT /* a */ 1;\n' }, { 'a.sql': 'SELECT /*+ SeqScan(t) */ 1;\n' }, 1],
  ['sql-psql-var', { 'a.sql': "SELECT :'v' -- a\n;\n" }, { 'a.sql': "SELECT :'v' -- b\n;\n" }, 1],
  ['sql-goose', { 'a.sql': '-- note\nSELECT 1;\n' }, { 'a.sql': '-- +goose Up\nSELECT 1;\n' }, 1],
  ['sql-goose-statementbegin', { 'a.sql': '-- +goose StatementBegin\nSELECT 1;\n' }, { 'a.sql': '-- +goose StatementEnd\nSELECT 1;\n' }, 1],
  ['sql-flyway-upper', { 'a.sql': '-- note\nSELECT 1;\n' }, { 'a.sql': '-- +GOOSE Up\nSELECT 1;\n' }, 1],
  ['sql-sqlc-name', { 'a.sql': '-- name: A :one\nSELECT 1;\n' }, { 'a.sql': '-- name: B :one\nSELECT 1;\n' }, 1],
  ['sql-sqlc-name-nospace', { 'a.sql': '-- note\nSELECT 1;\n' }, { 'a.sql': '--name: B :one\nSELECT 1;\n' }, 1],
  ['sql-dollar-body-code', { 'a.sql': 'CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;\n' }, { 'a.sql': 'CREATE FUNCTION f() RETURNS int AS $$ SELECT 2 $$ LANGUAGE sql;\n' }, 1],
  ['sql-case-keyword', { 'a.sql': 'select 1; -- a\n' }, { 'a.sql': 'SELECT 1; -- a\n' }, 1],
  ['sql-comment-in-ident', { 'a.sql': 'SELECT "a--b" FROM t; -- x\n' }, { 'a.sql': 'SELECT "a--b" FROM t; -- y\n' }, 0],
  ['sql-two-stmts-comment-between', { 'a.sql': 'SELECT 1; /* a */ SELECT 2;\n' }, { 'a.sql': 'SELECT 1; /* b */ SELECT 2;\n' }, 0],
  ['html-empty-comment-abrupt', { 'a.html': h('<!-->visible A-->') }, { 'a.html': h('<!-->visible B-->') }, 1],
  ['html-empty-comment-abrupt2', { 'a.html': h('<!--->visible A-->') }, { 'a.html': h('<!--->visible B-->') }, 1],
  ['html-bang-close', { 'a.html': h('<!-- a --!><p>A</p>-->') }, { 'a.html': h('<!-- a --!><p>B</p>-->') }, 1],
  ['html-textarea', { 'a.html': h('<textarea><!-- a --></textarea>') }, { 'a.html': h('<textarea><!-- b --></textarea>') }, 1],
  ['html-title', { 'a.html': '<title><!-- a --></title>' }, { 'a.html': '<title><!-- b --></title>' }, 1],
  ['html-noscript', { 'a.html': h('<noscript><!-- a --></noscript>') }, { 'a.html': h('<noscript><!-- b --></noscript>') }, 0],
  ['html-xmp', { 'a.html': h('<xmp><!-- a --></xmp>') }, { 'a.html': h('<xmp><!-- b --></xmp>') }, 1],
  ['html-iframe', { 'a.html': h('<iframe><!-- a --></iframe>') }, { 'a.html': h('<iframe><!-- b --></iframe>') }, 1],
  ['html-noembed', { 'a.html': h('<noembed><!-- a --></noembed>') }, { 'a.html': h('<noembed><!-- b --></noembed>') }, 1],
  ['html-plaintext', { 'a.html': h('<plaintext><!-- a -->') }, { 'a.html': h('<plaintext><!-- b -->') }, 1],
  ['html-ie-cond', { 'a.html': h('<!--[if IE]><p>a</p><![endif]-->') }, { 'a.html': h('<!--[if IE]><p>b</p><![endif]-->') }, 1],
  ['html-ie-cond-revealed', { 'a.html': h('<!--[if !IE]><!--><p>a</p><!--<![endif]-->') }, { 'a.html': h('<!--[if !IE]><!--><p>b</p><!--<![endif]-->') }, 1],
  ['html-ie-cond-revealed-comment', { 'a.html': h('<!--[if !IE]><!--><!-- a --><!--<![endif]-->') }, { 'a.html': h('<!--[if !IE]><!--><!-- b --><!--<![endif]-->') }, 0],
  ['html-ie-cond-upper', { 'a.html': h('<!--[IF IE]><p>a</p><![ENDIF]-->') }, { 'a.html': h('<!--[IF IE]><p>b</p><![ENDIF]-->') }, 1],
  ['html-plain-comment', { 'a.html': h('<!-- a -->') }, { 'a.html': h('<!-- b -->') }, 0],
  ['html-comment-dashes', { 'a.html': h('<!-- a -- b -->') }, { 'a.html': h('<!-- a -- c -->') }, 0],
  ['html-bogus-comment', { 'a.html': h('<! a >') }, { 'a.html': h('<! b >') }, 1],
  ['html-bogus-endtag', { 'a.html': h('</ a >') }, { 'a.html': h('</ b >') }, 1],
  ['html-qmark-bogus', { 'a.html': h('<?a?>') }, { 'a.html': h('<?b?>') }, 1],
  ['html-cdata', { 'a.html': h('<![CDATA[a]]>') }, { 'a.html': h('<![CDATA[b]]>') }, 1],
  ['html-comment-in-attr', { 'a.html': h('<p title="<!-- a -->">x</p>') }, { 'a.html': h('<p title="<!-- b -->">x</p>') }, 1],
  ['html-svg-cdata', { 'a.html': h('<svg><![CDATA[a]]></svg>') }, { 'a.html': h('<svg><![CDATA[b]]></svg>') }, 1],
  ['html-comment-joins-text', { 'a.html': h('a<!-- x -->b') }, { 'a.html': h('ab') }, 0],
  ['html-unclosed-comment', { 'a.html': h('<p>x</p><!-- a <p>y</p>') }, { 'a.html': h('<p>x</p><!-- a <p>z</p>') }, 0],
  ['html-script-type-text', { 'a.html': h('<script type="text/template"><!-- a --></script>') }, { 'a.html': h('<script type="text/template"><!-- b --></script>') }, 1],
  ['html-comment-in-pre-start', { 'a.html': h('<pre>\n<!-- a -->x</pre>') }, { 'a.html': h('<pre><!-- a -->\nx</pre>') }, 1],
  ['html-pre-remove-comment', { 'a.html': h('<pre><!-- a -->\nx</pre>') }, { 'a.html': h('<pre>\nx</pre>') }, 1],
  ['html-listing-remove-comment', { 'a.html': h('<listing><!-- a -->\nx</listing>') }, { 'a.html': h('<listing>\nx</listing>') }, 1],
  ['html-pre-add-comment', { 'a.html': h('<pre>\nx</pre>') }, { 'a.html': h('<pre><!---->\nx</pre>') }, 1],
];

// A comment that a server, a template engine or a scanner reads is code.
const HTML_CODE_COMMENTS = ['<?php system($_GET["c"]); ?>', '<![CDATA[ x ]]>', 'esi <esi:include src="/x"/>',
  '{{ 7 * 7 }}', '{% include "/etc/passwd" %}', '<%= 1 %>', '#include virtual="/x"', '${x}'];
for (const body of HTML_CODE_COMMENTS) {
  COMMENT_CASES.push([`html-code-comment ${body.slice(0, 12)}`, { 'a.html': h('<!-- a -->') },
    { 'a.html': h(`<!-- ${body} -->`) }, 1]);
}
for (const word of ['nosemgrep', 'lgtm[js/x]', 'gitleaks:allow', 'pragma: allowlist secret', 'NOSONAR',
  'nosec', 'noqa', 'codeql[js/x]', 'snyk:ignore']) {
  COMMENT_CASES.push([`ts-suppression ${word}`, { 'a.ts': 'f(); // note\n' },
    { 'a.ts': `f(); // ${word}\n` }, 1]);
}
COMMENT_CASES.push(['sql-suppression', { 'a.sql': '-- note\nSELECT 1;\n' }, { 'a.sql': '-- nosemgrep\nSELECT 1;\n' }, 1]);
COMMENT_CASES.push(['html-suppression', { 'a.html': h('<!-- a -->') }, { 'a.html': h('<!-- nosemgrep -->') }, 1]);

// A change of white space outside the comments, with a change of a comment, fails; a comment added,
// removed or moved with its line passes.
COMMENT_CASES.push(
  ['ts: a comment and spaces around code', { 'a.ts': '// a\nconst x=1+2;\n' }, { 'a.ts': '// b\nconst x = 1 + 2;\n' }, 1],
  ['ts: a comment and a new indentation', { 'a.ts': 'if (a) {\n  b(); // a\n}\n' }, { 'a.ts': 'if (a) {\n    b(); // b\n}\n' }, 1],
  ['ts: a comment line removed passes', { 'a.ts': '// a\nf();\n' }, { 'a.ts': 'f();\n' }, 0],
  ['ts: a comment line removed in a block passes', { 'a.ts': 'if (a) {\n  // a\n  b();\n}\n' }, { 'a.ts': 'if (a) {\n  b();\n}\n' }, 0],
  ['ts: a trailing comment added passes', { 'a.ts': 'f();\n' }, { 'a.ts': 'f(); // a\n' }, 0],
  ['ts: a block comment before code passes', { 'a.ts': '  f();\n' }, { 'a.ts': '  /* a */ f();\n' }, 0],
  ['ts: a blank line added with a comment fails', { 'a.ts': '// a\nf();\n' }, { 'a.ts': '// b\n\nf();\n' }, 1],
  ['sql: a comment and spaces', { 'a.sql': '-- a\nselect 1+2;\n' }, { 'a.sql': '-- b\nselect 1 + 2;\n' }, 1],
  ['sql: a comment line removed passes', { 'a.sql': '-- a\nselect 1;\n' }, { 'a.sql': 'select 1;\n' }, 0],
  ['html: a comment and spaces', { 'a.html': h('<!-- a --><p>a</p>') }, { 'a.html': h('<!-- b --><p>a </p>') }, 1],
);
COMMENT_CASES.push(
  ['html: a php tag added', { 'a.html': h('<p>a</p>') }, { 'a.html': h('<p>a</p><?php system($_GET["c"]); ?>') }, 1],
  ['html: a php tag changed', { 'a.html': h('<?php a(); ?>') }, { 'a.html': h('<?php b(); ?>') }, 1],
  ['html: a cdata section added', { 'a.html': h('<p>a</p>') }, { 'a.html': h('<p>a</p><![CDATA[ x ]]>') }, 1],
  ['html: a real comment next to a bogus one', { 'a.html': h('<!-- a --><?x?>') }, { 'a.html': h('<!-- b --><?x?>') }, 0],
);
// Any comment with a word of suppression is code, whatever the language.
for (const word of ['skip the header row', 'ignore this', 'disable it', 'suppress', 'nolint', 'noinspection',
  'nocheck', 'formatter: off', 'allowlist nextline secret', 'Ignored']) {
  COMMENT_CASES.push([`ts-word ${word}`, { 'a.ts': 'f(); // note\n' }, { 'a.ts': `f(); // ${word}\n` }, 1]);
  COMMENT_CASES.push([`html-word ${word}`, { 'a.html': h('<!-- a -->') }, { 'a.html': h(`<!-- ${word} -->`) }, 1]);
}
// A blob that is not valid UTF-8 has no proof of a comment, a text value or a look value.
test('a blob that is no UTF-8 says to propose the standard track', { skip: NO_PARSERS }, () => {
  const bad = Buffer.concat([Buffer.from('f(); // a '), Buffer.from([0xff, 0xfe]), Buffer.from('\n')]);
  const good = 'f(); // a\n';
  for (const kind of [COMMENT, TEXT, LOOK]) {
    for (const [base, head] of [[good, bad], [bad, good]]) {
      const found = run(kind, { 'a.ts': base }, { 'a.ts': head });
      assert.equal(found.length, 1, kind);
      assert.match(found[0], /^Propose the standard track: "a\.ts" is not valid UTF-8\./);
    }
  }
});

cases(COMMENT, COMMENT_CASES);
// A TypeScript file and a Python file, both with comments only.
test('a comment: two languages, comments only', { skip: NO_PARSERS || NO_PYTHON }, () => {
  const py = '# a comment\nx = 1\n';
  assert.deepEqual(run(COMMENT, { 'a.ts': TS, 'a.py': py },
    { 'a.ts': r(TS, 'Greets a person.', 'Hi.'), 'a.py': r(py, 'a comment', 'b') }), []);
});

// ---- text values -----------------------------------------------------------------------------

const LABEL = "export const saveLabel = 'Save';\nexport const cancelLabel = 'Cancel';\n";
const BUTTON = 'export function Save() {\n  return <button title="Save" className="btn">Save</button>;\n}\n';

// A SQL file has no text value proof: each SQL case below fails with the finding to propose the
// standard track.
const TEXT_CASES = [
  ['a changed button label in a TypeScript file passes', { 'a.ts': LABEL }, { 'a.ts': r(LABEL, "'Save'", "'Save it'") }, 0],
  ['a changed label in JSX text and in a title passes', { 'a.tsx': BUTTON }, { 'a.tsx': r(r(BUTTON, '>Save<', '>Save it<'), 'title="Save"', 'title="Save it"') }, 0],
  ['a changed string next to a changed identifier fails', { 'a.ts': LABEL }, { 'a.ts': r(LABEL, "saveLabel = 'Save'", "saveTitle = 'Save it'") }, 1],
  ['a changed identifier fails', { 'a.ts': LABEL }, { 'a.ts': r(LABEL, 'saveLabel', 'saveTitle') }, 1],
  ['a string and a comment together fail', { 'a.ts': LABEL }, { 'a.ts': `// note\n${r(LABEL, "'Save'", "'Save it'")}` }, 1],
  ['a changed import fails', { 'a.ts': "import a from './a';\nexport const x = a;\n" }, { 'a.ts': "import a from './b';\nexport const x = a;\n" }, 1],
  ['a changed key of an object fails', { 'a.ts': "export const o = { 'a': 'one' };\n" }, { 'a.ts': "export const o = { 'b': 'one' };\n" }, 1],
  ['a changed value of an object passes', { 'a.ts': "export const o = { 'a': 'one' };\n" }, { 'a.ts': "export const o = { 'a': 'two' };\n" }, 0],
  ['a changed comparison fails', { 'a.ts': "export const f = (x: string) => x === 'admin';\n" }, { 'a.ts': "export const f = (x: string) => x === 'user';\n" }, 1],
  ['a changed use client directive fails', { 'a.tsx': "'use client';\nexport const x = 1;\n" }, { 'a.tsx': "'use server';\nexport const x = 1;\n" }, 1],
  ['a changed property access by string fails', { 'a.ts': "export const v = o['a'];\n" }, { 'a.ts': "export const v = o['b'];\n" }, 1],
  ['a changed test id attribute fails', { 'a.tsx': 'export const a = <i data-testid="x">y</i>;\n' }, { 'a.tsx': 'export const a = <i data-testid="z">y</i>;\n' }, 1],
  ['a changed class name attribute fails', { 'a.tsx': 'export const a = <i className="x">y</i>;\n' }, { 'a.tsx': 'export const a = <i className="z">y</i>;\n' }, 1],
  ['a changed tagged template fails', { 'a.ts': 'export const q = sql`select 1`;\n' }, { 'a.ts': 'export const q = sql`select 2`;\n' }, 1],
  ['a changed template text with the same substitution passes', { 'a.ts': 'export const m = (n: string) => `Hello ${n}`;\n' }, { 'a.ts': 'export const m = (n: string) => `Hi ${n}`;\n' }, 0],
  ['a changed substitution fails', { 'a.ts': 'export const m = (n: string, k: string) => `Hello ${n}`;\n' }, { 'a.ts': 'export const m = (n: string, k: string) => `Hello ${k}`;\n' }, 1],
  ['a changed number fails', { 'a.ts': 'export const n = 1;\n' }, { 'a.ts': 'export const n = 2;\n' }, 1],
  ['sql: a changed string constant has no proof', { 'a.sql': "SELECT 'a' AS label FROM t;\n" }, { 'a.sql': "SELECT 'b' AS label FROM t;\n" }, 1],
  ['sql: a changed identifier fails', { 'a.sql': "SELECT 'a' AS label FROM t;\n" }, { 'a.sql': "SELECT 'a' AS name FROM t;\n" }, 1],
  ['sql: a changed number fails', { 'a.sql': 'SELECT 1 FROM t;\n' }, { 'a.sql': 'SELECT 2 FROM t;\n' }, 1],
  ['sql: a changed function body fails', { 'a.sql': 'CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;\n' }, { 'a.sql': 'CREATE FUNCTION f() RETURNS int AS $$ SELECT 2 $$ LANGUAGE sql;\n' }, 1],
  ['sql: a changed comment fails', { 'a.sql': "-- a\nSELECT 'a';\n" }, { 'a.sql': "-- b\nSELECT 'a';\n" }, 1],
  ['html: a changed text passes', { 'a.html': h('<p>Hi</p>') }, { 'a.html': h('<p>Hello</p>') }, 0],
  ['html: a changed title attribute passes', { 'a.html': h('<p title="a">Hi</p>') }, { 'a.html': h('<p title="b">Hi</p>') }, 0],
  ['html: a changed href fails', { 'a.html': h('<a href="/a">Hi</a>') }, { 'a.html': h('<a href="/b">Hi</a>') }, 1],
  ['html: a changed script fails', { 'a.html': h('<script>var a = 1;</script>') }, { 'a.html': h('<script>var a = 2;</script>') }, 1],
  ['html: a changed tag fails', { 'a.html': h('<p>Hi</p>') }, { 'a.html': h('<div>Hi</div>') }, 1],
  ['html: a changed comment fails', { 'a.html': h('<!-- a --><p>Hi</p>') }, { 'a.html': h('<!-- b --><p>Hi</p>') }, 1],
];
TEXT_CASES.push(
  ['a string and spaces around code', { 'a.ts': "export const a = 'x';\n" }, { 'a.ts': "export  const a = 'y';\n" }, 1],
  ['a string and a new line', { 'a.ts': "export const a = 'x';\n" }, { 'a.ts': "export const a =\n  'y';\n" }, 1],
  ['html: a text and spaces in a tag', { 'a.html': h('<p class="a">x</p>') }, { 'a.html': h('<p  class="a">y</p>') }, 1],
);
// The deny list of the kind (lib/text-deny.js), and the places that are no text.
const tsCase = (before, after, expected = 1) => [`ts: ${after.trim().slice(0, 60)}`,
  { 'a.ts': `${before}\n` }, { 'a.ts': `${after}\n` }, expected];
TEXT_CASES.push(
  // a comparison, in each form
  tsCase('export const f = (role: string) => role === "admin";', 'export const f = (role: string) => role === "guest";'),
  tsCase('export const f = (role: string) => role == "admin";', 'export const f = (role: string) => role == "guest";'),
  tsCase('export const f = (role: string) => role !== "admin";', 'export const f = (role: string) => role !== "guest";'),
  tsCase('export const f = (role: string) => "admin" === role;', 'export const f = (role: string) => "guest" === role;'),
  tsCase('export const f = (k: string, o: object) => "a" in o;', 'export const f = (k: string, o: object) => "b" in o;'),
  // a case label
  tsCase('export function f(x: string) { switch (x) { case "a": return 1; default: return 2; } }', 'export function f(x: string) { switch (x) { case "b": return 1; default: return 2; } }'),
  // the text that a case returns is text
  tsCase('export function f(x: string) { switch (x) { case "a": return "One"; default: return "Two"; } }', 'export function f(x: string) { switch (x) { case "a": return "First"; default: return "Two"; } }', 0),
  // a type
  tsCase('export let x: "a" | "b" = "a";', 'export let x: "a" | "c" = "a";'),
  tsCase('export type K = "a" | "b";', 'export type K = "a" | "c";'),
  // membership: includes, indexOf and has, with the strings as the list and as the argument
  tsCase('export const f = (x: string) => ["a", "b"].includes(x);', 'export const f = (x: string) => ["a", "c"].includes(x);'),
  tsCase('export const f = (x: string) => ["a", "b"].indexOf(x) >= 0;', 'export const f = (x: string) => ["a", "c"].indexOf(x) >= 0;'),
  tsCase('export const f = (x: string) => new Set(["a", "b"]).has(x);', 'export const f = (x: string) => new Set(["a", "c"]).has(x);'),
  tsCase('export const f = (x: string) => x.includes("a");', 'export const f = (x: string) => x.includes("b");'),
  tsCase('export const f = (x: string) => x.startsWith("a");', 'export const f = (x: string) => x.startsWith("b");'),
  tsCase('export const f = (x: string) => x.endsWith("a");', 'export const f = (x: string) => x.endsWith("b");'),
  tsCase('export const f = (x: string) => x.match("a");', 'export const f = (x: string) => x.match("b");'),
  tsCase('export const f = (m: Map<string, number>) => m.has("a");', 'export const f = (m: Map<string, number>) => m.has("b");'),
  // eval-like calls and commands
  tsCase('eval("a()");', 'eval("b()");'),
  tsCase('export const f = new Function("return 1");', 'export const f = new Function("return 2");'),
  tsCase('setTimeout("a()", 1);', 'setTimeout("b()", 1);'),
  tsCase('setInterval("a()", 1);', 'setInterval("b()", 1);'),
  tsCase('execSync("ls");', 'execSync("pwd");'),
  tsCase('exec("ls");', 'exec("pwd");'),
  tsCase('spawn("ls", ["-la"]);', 'spawn("ls", ["-lh"]);'),
  tsCase('db.query("x");', 'db.query("y");'),
  tsCase('db.execute("x");', 'db.execute("y");'),
  tsCase('fetch("a");', 'fetch("b");'),
  tsCase('const a = require("a");', 'const a = require("b");'),
  tsCase('const a = import("a");', 'const a = import("b");'),
  // a selector and a test id
  tsCase('document.querySelector("#a");', 'document.querySelector("#b");'),
  tsCase('screen.getByText("Save");', 'screen.getByText("Saved");'),
  tsCase('page.locator("text=Save");', 'page.locator("text=Saved");'),
  ['ts: a test id', { 'a.tsx': 'export const A = <i data-testid="a">x</i>;\n' }, { 'a.tsx': 'export const A = <i data-testid="b">x</i>;\n' }, 1],
  // the content of a string
  tsCase('export const a = "See https://a.example/x";', 'export const a = "See https://b.example/x";'),
  tsCase('export const a = "See the page";', 'export const a = "See https://b.example/x";'),
  tsCase('export const a = "<b>Save</b>";', 'export const a = "<b>Saved</b>";'),
  tsCase('export const a = "Hello";', 'export const a = "Hello {{ name }}";'),
  tsCase('export const a = "Hello";', 'export const a = "<%= name %>";'),
  tsCase('export const a = "Hello";', 'export const a = "Hello ${name}";'),
  tsCase('export const a = "select * from t";', 'export const a = "select * from u";'),
  tsCase('export const a = "Hello";', 'export const a = "delete from users where id = 1";'),
  tsCase('export const a = "ls";', 'export const a = "rm -rf /tmp/x";'),
  tsCase('export const a = "Hello";', 'export const a = "echo a && echo b";'),
  tsCase('export const a = "/etc/hosts";', 'export const a = "/etc/passwd";'),
  tsCase('export const a = "Hello";', 'export const a = "../../etc/passwd";'),
  // text for a person passes
  tsCase('export const label = "Save";', 'export const label = "Save it";', 0),
  tsCase('console.log("Saved");', 'console.log("Saved.");', 0),
  tsCase('throw new Error("Failed");', 'throw new Error("Failed to save");', 0),
  tsCase('alert("Saved");', 'alert("Saved the file");', 0),
  tsCase('export const a = "Yes/No";', 'export const a = "Yes/No/Maybe";'),
  tsCase('export const a = "Yes/No";', 'export const a = "Yes or No";', 0),
  ['ts: a JSX label and a title', { 'a.tsx': 'export const A = <b title="Save">Save</b>;\n' }, { 'a.tsx': 'export const A = <b title="Save it">Save it</b>;\n' }, 0],
);

// The characters that join or redirect commands, a scheme with a tab, a host name or an address,
// and the call shape are code; a plain sentence with a full stop, a comma or a parenthesis is text.
for (const text of ['a; b', 'a | b', 'a & b', 'a > b', 'a < b', 'a`b', '$(x)', 'java\tscript:x',
  'vbscript:x', '__import__', 'bash -c x', 'evil.com', 'http://x', '10.0.0.1', '../x', 'f(x)',
  'a/../b', 'x.y.example']) {
  TEXT_CASES.push(tsCase('export const a = "Hello";', `export const a = "${text}";`));
}
for (const text of ['Saved. Next', 'Hello, world.', 'Save (optional)', 'Item added.', 'Yes or no?',
  "It's done", 'Total: 5 items']) {
  TEXT_CASES.push(tsCase('export const a = "Hello";', `export const a = "${text}";`, 0));
}

// Other forms of a link and a command: a wide character, a scheme with a colon and no space, an
// interpolation, a shebang, and a line break in a command line. A colon and a space is text.
for (const text of ['\uff48\uff54\uff54\uff50\uff1a\uff0f\uff0fx', 'id:5', 'ab:c', 'file:x', '#{x}', '#!/bin/sh',
  'ls -la\\nfoo', 'foo\\nls -la', 'java\\nscript:x']) {
  TEXT_CASES.push(tsCase('export const a = "Hello";', `export const a = "${text}";`));
}
for (const text of ['Total: 5 items', 'Note: saved', 'Note: the file is saved', 'Time 10:30']) {
  TEXT_CASES.push(tsCase('export const a = "Hello";', `export const a = "${text}";`, 0));
}

// SQL files have no text value proof.
test('a text value in a SQL file has no proof', { skip: NO_PARSERS }, () => {
  const found = run(TEXT, { 'a.sql': "SELECT 'a';\n" }, { 'a.sql': "SELECT 'b';\n" });
  assert.equal(found.length, 1);
  assert.match(found[0], /^Propose the standard track: "a\.sql" has no text value proof yet\./);
});

cases(TEXT, TEXT_CASES);

const PY_TEXT_CASES = [
  ['python: a changed string passes', { 'a.py': 'LABEL = "Save"\n' }, { 'a.py': 'LABEL = "Save it"\n' }, 0],
  ['python: a changed docstring fails', { 'a.py': 'def f():\n    "doc"\n    return 1\n' }, { 'a.py': 'def f():\n    "other"\n    return 1\n' }, 1],
  ['python: a changed dict key fails', { 'a.py': 'D = {"a": 1}\n' }, { 'a.py': 'D = {"b": 1}\n' }, 1],
  ['python: a changed string next to a changed name fails', { 'a.py': 'LABEL = "Save"\n' }, { 'a.py': 'TITLE = "Save it"\n' }, 1],
  ['python: a changed comparison fails', { 'a.py': 'x = y == "a"\n' }, { 'a.py': 'x = y == "b"\n' }, 1],
  ['python: a changed comment fails', { 'a.py': '# a\nx = "a"\n' }, { 'a.py': '# b\nx = "a"\n' }, 1],
  ['python: a changed number fails', { 'a.py': 'x = 1\n' }, { 'a.py': 'x = 2\n' }, 1],
];
const pyCase = (before, after, expected = 1) => [`python: ${after.trim().slice(0, 60)}`,
  { 'a.py': `${before}\n` }, { 'a.py': `${after}\n` }, expected];
PY_TEXT_CASES.push(
  pyCase('role = get()\nif role == "admin":\n    pass', 'role = get()\nif role == "guest":\n    pass'),
  pyCase('x = y != "a"', 'x = y != "b"'),
  pyCase('x = "a" in y', 'x = "b" in y'),
  pyCase('x = y in ["a", "b"]', 'x = y in ["a", "c"]'),
  pyCase('x = y in {"a", "b"}', 'x = y in {"a", "c"}'),
  pyCase('x = y.index("a")', 'x = y.index("b")'),
  pyCase('x = y.startswith("a")', 'x = y.startswith("b")'),
  pyCase('x = y.endswith("a")', 'x = y.endswith("b")'),
  pyCase('x = d.get("a")', 'x = d.get("b")'),
  pyCase('x = re.match("a", y)', 'x = re.match("b", y)'),
  pyCase('match x:\n    case "a":\n        pass', 'match x:\n    case "b":\n        pass'),
  pyCase('match x:\n    case "a":\n        y = "One"', 'match x:\n    case "a":\n        y = "First"', 0),
  pyCase('x: "A" = 1', 'x: "B" = 1'),
  pyCase('def f(a: "A"):\n    pass', 'def f(a: "B"):\n    pass'),
  pyCase('def f() -> "A":\n    pass', 'def f() -> "B":\n    pass'),
  pyCase('eval("a()")', 'eval("b()")'),
  pyCase('exec("a()")', 'exec("b()")'),
  pyCase('os.system("ls")', 'os.system("pwd")'),
  pyCase('subprocess.run(["ls", "-la"])', 'subprocess.run(["ls", "-lh"])'),
  pyCase('subprocess.check_output("ls", shell=True)', 'subprocess.check_output("pwd", shell=True)'),
  pyCase('cur.execute("a")', 'cur.execute("b")'),
  pyCase('requests.get("a")', 'requests.get("b")'),
  pyCase('__import__("a")', '__import__("b")'),
  pyCase('x = soup.select("a")', 'x = soup.select("b")'),
  pyCase('x = driver.find_element("a")', 'x = driver.find_element("b")'),
  pyCase('x = "See https://a.example"', 'x = "See https://b.example"'),
  pyCase('x = "Hello"', 'x = "<b>Hello</b>"'),
  pyCase('x = "Hello"', 'x = "Hello {{ name }}"'),
  pyCase('x = "Hello"', 'x = "select * from users"'),
  pyCase('x = "Hello"', 'x = "rm -rf /tmp/x"'),
  pyCase('x = "/etc/hosts"', 'x = "/etc/passwd"'),
  pyCase('print("Saved")', 'print("Saved.")', 0),
  pyCase('print("Saved")', 'print("Saved the file")', 0),
  pyCase('sys.exit("Failed")', 'sys.exit("Failed to save")', 0),
  pyCase('raise ValueError("bad")', 'raise ValueError("bad value")', 0),
  pyCase('parser.add_argument("--count", help="Count")', 'parser.add_argument("--count", help="Total")', 0),
  pyCase('parser.add_argument("--count", help="Count")', 'parser.add_argument("--total", help="Count")'),
);
cases(TEXT, PY_TEXT_CASES, NO_PYTHON);

test('a text value in a shell file has no proof', { skip: NO_PARSERS }, () => {
  const found = run(TEXT, { 'a.sh': 'echo "a"\n' }, { 'a.sh': 'echo "b"\n' });
  assert.match(found.join('\n'), /^Propose the standard track: "a\.sh" has no text value proof yet\./);
});

// ---- look-only changes ----------------------------------------------------------------------

const CSS = '.btn {\n  color: #333;\n  padding: 4px 8px;\n  border-radius: 2px;\n  box-shadow: 0 1px 2px #000;\n  display: block;\n  width: 100px;\n}\n';
const SCSS = '$primary: #333;\n$sidebar-width: 200px;\n.btn {\n  color: $primary;\n  &:hover { color: darken($primary, 10%); }\n}\n';
const TOKENS = JSON.stringify({ color: { primary: { $value: '#333333', $type: 'color' } },
  size: { sidebar: { $value: '200px', $type: 'dimension' } },
  note: { $description: 'Used for text.' } }, null, 2);
const CSSINJS = "export const Button = styled.button`\n  color: red;\n  padding: 4px;\n`;\nexport const s = { color: 'red', padding: 4, width: 10 };\n";
const CLASSES = 'export const A = () => <div className="p-2 text-red-500 hover:bg-white">x</div>;\n';

const LOOK_CASES = [
  ['a CSS file whose only change is a color value passes', { 'a.css': CSS }, { 'a.css': r(CSS, '#333', '#444') }, 0],
  ['a changed display declaration fails', { 'a.css': CSS }, { 'a.css': r(CSS, 'display: block', 'display: flex') }, 1],
  ['a changed width fails', { 'a.css': CSS }, { 'a.css': r(CSS, 'width: 100px', 'width: 120px') }, 1],
  ['a changed padding passes', { 'a.css': CSS }, { 'a.css': r(CSS, 'padding: 4px 8px', 'padding: 6px 10px') }, 0],
  ['a changed border-radius passes', { 'a.css': CSS }, { 'a.css': r(CSS, 'border-radius: 2px', 'border-radius: 4px') }, 0],
  ['a changed box-shadow passes', { 'a.css': CSS }, { 'a.css': r(CSS, '0 1px 2px #000', '0 2px 4px #111') }, 0],
  ['a changed selector fails', { 'a.css': CSS }, { 'a.css': r(CSS, '.btn', '.button') }, 1],
  ['a new declaration fails', { 'a.css': CSS }, { 'a.css': r(CSS, 'display: block;', 'display: block;\n  margin: 0;') }, 1],
  ['a changed value that loads a file fails', { 'a.css': 'a { background: #fff; }\n' }, { 'a.css': 'a { background: url(a.png); }\n' }, 1],
  ['a changed comment fails', { 'a.css': `/* a */\n${CSS}` }, { 'a.css': `/* b */\n${CSS}` }, 1],
  ['a changed !important fails', { 'a.css': 'a { color: red; }\n' }, { 'a.css': 'a { color: red !important; }\n' }, 1],
  ['a changed @font-face fails', { 'a.css': '@font-face { font-family: X; src: local(a); font-weight: 400; }\na { color: red; }\n' }, { 'a.css': '@font-face { font-family: X; src: local(a); font-weight: 700; }\na { color: red; }\n' }, 1],
  ['a changed font file fails', { 'a.woff2': 'a' }, { 'a.woff2': 'b' }, 1],
  ['a changed content declaration fails', { 'a.css': 'a::before { content: "a"; }\n' }, { 'a.css': 'a::before { content: "b"; }\n' }, 1],
  ['a changed SCSS variable passes', { 'a.scss': SCSS }, { 'a.scss': r(SCSS, '$primary: #333', '$primary: #444') }, 0],
  ['a changed SCSS variable of a width fails', { 'a.scss': SCSS }, { 'a.scss': r(SCSS, '200px', '300px') }, 1],
  ['a changed argument of a Sass function fails: darken is no colour function of the table', { 'a.scss': SCSS }, { 'a.scss': r(SCSS, '10%', '20%') }, 1],
  ['a changed CSS variable passes', { 'a.css': ':root { --color-primary: #333; --sidebar-width: 200px; }\n' }, { 'a.css': ':root { --color-primary: #444; --sidebar-width: 200px; }\n' }, 0],
  ['a changed CSS variable of a width fails', { 'a.css': ':root { --color-primary: #333; --sidebar-width: 200px; }\n' }, { 'a.css': ':root { --color-primary: #333; --sidebar-width: 300px; }\n' }, 1],
  ['a changed design token colour passes', { 'design/colors.tokens.json': TOKENS }, { 'design/colors.tokens.json': r(TOKENS, '#333333', '#444444') }, 0],
  ['a changed design token dimension fails', { 'design/colors.tokens.json': TOKENS }, { 'design/colors.tokens.json': r(TOKENS, '200px', '300px') }, 1],
  ['a changed design token description fails', { 'design/colors.tokens.json': TOKENS }, { 'design/colors.tokens.json': r(TOKENS, 'Used for text.', 'Used for all text.') }, 1],
  ['a changed design token type fails', { 'design/colors.tokens.json': TOKENS }, { 'design/colors.tokens.json': r(TOKENS, '"color"', '"dimension"') }, 1],
  ['a JSON file that is no token file fails', { 'data.json': TOKENS }, { 'data.json': r(TOKENS, '#333333', '#444444') }, 1],
  ['a CSS-in-JS colour change passes', { 'a.ts': CSSINJS }, { 'a.ts': r(r(CSSINJS, 'color: red;', 'color: blue;'), "color: 'red'", "color: 'blue'") }, 0],
  ['a CSS-in-JS width change fails', { 'a.ts': CSSINJS }, { 'a.ts': r(CSSINJS, 'width: 10', 'width: 12') }, 1],
  ['a CSS-in-JS display change in a template fails', { 'a.ts': CSSINJS }, { 'a.ts': r(CSSINJS, 'padding: 4px;', 'padding: 4px; display: none;') }, 1],
  ['a CSS-in-JS padding change passes', { 'a.ts': CSSINJS }, { 'a.ts': r(CSSINJS, 'padding: 4,', 'padding: 8,') }, 0],
  ['text-red-500 to text-blue-600 passes', { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'text-red-500', 'text-blue-600') }, 0],
  ['a swap with a variant and an opacity passes', { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'hover:bg-white', 'hover:bg-slate-100/50') }, 0],
  ['p-2 to flex fails', { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'p-2', 'flex') }, 1],
  ['p-2 to m-2 fails', { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'p-2', 'm-2') }, 1],
  ['p-2 to px-2 fails', { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'p-2', 'px-2') }, 1],
  ['p-2 to p-4 passes', { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'p-2', 'p-4') }, 0],
  ['text-red-500 to text-sm fails', { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'text-red-500', 'text-sm') }, 1],
  ['a changed variant fails', { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'hover:bg-white', 'focus:bg-white') }, 1],
  ['an added class fails', { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'p-2 ', 'p-2 m-2 ') }, 1],
  ['a class that the table lacks fails', { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'p-2', 'p-[3px]') }, 1],
  ['html: a class swap passes', { 'a.html': h('<p class="text-red-500">x</p>') }, { 'a.html': h('<p class="text-blue-600">x</p>') }, 0],
  ['html: a style attribute colour passes', { 'a.html': h('<p style="color: red">x</p>') }, { 'a.html': h('<p style="color: blue">x</p>') }, 0],
  ['html: a style attribute display fails', { 'a.html': h('<p style="color: red">x</p>') }, { 'a.html': h('<p style="color: red; display: none">x</p>') }, 1],
  ['html: a style element colour passes', { 'a.html': h('<style>a { color: red; }</style>') }, { 'a.html': h('<style>a { color: blue; }</style>') }, 0],
  ['html: a changed text fails', { 'a.html': h('<p>Hi</p>') }, { 'a.html': h('<p>Hello</p>') }, 1],
  ['a changed string of a code file fails', { 'a.ts': "export const a = 'x';\n" }, { 'a.ts': "export const a = 'y';\n" }, 1],
  ['sql has no look proof', { 'a.sql': 'SELECT 1;\n' }, { 'a.sql': 'SELECT 2;\n' }, 1],
];
// A look value that calls a function other than a colour, number or length function fails.
for (const value of ['image-set("a.png" 1x)', 'src("a.png")', 'element(#a)', 'paint(x)',
  'cross-fade(url(a.png), url(b.png), 50%)', 'image(url(a.png))', 'linear-gradient(red, blue)',
  'url(a.png) no-repeat', 'URL( a.png )']) {
  LOOK_CASES.push([`a value with ${value.split('(')[0]} fails`, { 'a.css': 'a { background: #fff; }\n' },
    { 'a.css': `a { background: ${value}; }\n` }, 1]);
}
for (const [prop, value] of [['color', 'color-mix(in srgb, red 50%, blue)'],
  ['padding', 'calc(1px + var(--gap))'], ['color', 'rgb(0 0 0 / 50%)'], ['margin', 'clamp(1px, 2vw, 3px)']]) {
  LOOK_CASES.push([`a value with ${value.split('(')[0]} passes`, { 'a.css': `a { ${prop}: #fff; }\n` },
    { 'a.css': `a { ${prop}: ${value}; }\n` }, 0]);
}
LOOK_CASES.push(
  ['a value and spaces in CSS', { 'a.css': 'a{color:red}\n' }, { 'a.css': 'a { color: blue }\n' }, 1],
  ['a value and an indentation in CSS', { 'a.css': 'a {\n  color: red;\n}\n' }, { 'a.css': 'a {\n    color: blue;\n}\n' }, 1],
  ['a value in CSS with the same layout passes', { 'a.css': 'a { color : red ; }\n' }, { 'a.css': 'a { color : blue ; }\n' }, 0],
  ['a value and spaces in SCSS', { 'a.scss': '$a:#333;\n' }, { 'a.scss': '$a: #444;\n' }, 1],
  ['a class and spaces in a tag', { 'a.tsx': 'export const A = <div className="p-2">x</div>;\n' }, { 'a.tsx': 'export const A = <div  className="p-4">x</div>;\n' }, 1],
  ['a design token and an indentation', { 'a.tokens.json': '{\n  "c": { "$value": "#333", "$type": "color" }\n}\n' }, { 'a.tokens.json': '{\n    "c": { "$value": "#444", "$type": "color" }\n}\n' }, 1],
  ['a design token with the same layout passes', { 'a.tokens.json': '{\n  "c": { "$value": "#333", "$type": "color" }\n}\n' }, { 'a.tokens.json': '{\n  "c": { "$value": "#4444", "$type": "color" }\n}\n' }, 0],
  ['a CSS-in-JS value and spaces', { 'a.ts': "export const s = { color: 'red' };\n" }, { 'a.ts': "export const s = {color: 'blue'};\n" }, 1],
  ['a CSS-in-JS template value and spaces', { 'a.ts': 'export const B = css`color:red;`;\n' }, { 'a.ts': 'export const B = css`color: blue;`;\n' }, 1],
  ['a class with an arbitrary value ends with a bracket', { 'a.tsx': 'export const A = <div className="text-[#fff] p-2">x</div>;\n' }, { 'a.tsx': 'export const A = <div className="text-[#000] p-2">x</div>;\n' }, 1],
);
cases(LOOK, LOOK_CASES);

test('a class that the table lacks says to propose the standard track', { skip: NO_PARSERS }, () => {
  const found = run(LOOK, { 'a.tsx': CLASSES }, { 'a.tsx': r(CLASSES, 'p-2', 'flex') });
  assert.equal(found.length, 1);
  assert.match(found[0], /^Propose the standard track: the class "flex" is not a look-only class\./);
});

test('a class with an arbitrary value is named whole, with its brackets', { skip: NO_PARSERS }, () => {
  const base = 'export const A = <div className="text-[#fff]">x</div>;\n';
  const found = run(LOOK, { 'a.tsx': base }, { 'a.tsx': r(base, 'text-[#fff]', 'text-[#000]') });
  assert.equal(found.length, 1);
  assert.match(found[0], /^Propose the standard track: the class "text-\[#fff\]" is not a look-only class\./);
  const html = '<p class="text-[#fff]">x</p>';
  const inHtml = run(LOOK, { 'a.html': h(html) }, { 'a.html': h(r(html, '[#fff]', '[#000]')) });
  assert.match(inHtml[0], /^Propose the standard track: the class "text-\[#fff\]" is not a look-only class\./);
});

test('a layout change names the code that changed', { skip: NO_PARSERS }, () => {
  const found = run(LOOK, { 'a.css': CSS }, { 'a.css': r(CSS, 'display: block', 'display: flex') });
  assert.equal(found.length, 1);
  assert.match(found[0], /^Take the change to code out of "a\.css": only look values may change\.\n.*DECL display: block became DECL display: flex\.$/);
});

// ---- the folder of the parsers ---------------------------------------------------------------

test('a checkout with a node_modules folder of the same names changes no result', { skip: NO_PARSERS }, () => {
  // A package of the checkout that always fails, and one that always passes, are never loaded:
  // the proof loads the parsers from the folder that it is given, by absolute path.
  const trap = "throw new Error('loaded from the checkout');\n";
  const lie = "module.exports = new Proxy({}, { get() { throw new Error('the checkout'); } });\n";
  for (const [name, body] of [['typescript', trap], ['postcss', lie], ['parse5', trap]]) {
    const base = { [`node_modules/${name}/index.js`]: body,
      [`node_modules/${name}/package.json`]: JSON.stringify({ name, main: 'index.js' }),
      'a.ts': LABEL, 'a.css': CSS, 'a.html': h('<p>Hi</p>') };
    const head = { ...base, 'a.ts': r(LABEL, "'Save'", "'Save it'") };
    assert.deepEqual(run(TEXT, base, head), [], name);
    const bad = { ...base, 'a.ts': r(LABEL, 'saveLabel', 'saveTitle') };
    assert.equal(run(TEXT, base, bad).length > 0, true, name);
    const css = { ...base, 'a.css': r(CSS, '#333', '#444') };
    assert.deepEqual(run(LOOK, base, css).filter((line) => !/node_modules/.test(line)), [], name);
  }
});

test('the parsers folder is missing: the push has a finding, the end has none', () => {
  const base = { 'a.ts': LABEL };
  const head = { 'a.ts': r(LABEL, "'Save'", "'Save it'") };
  const gone = path.join(tmp, 'no-parsers');
  const found = run(TEXT, base, head, { dir: gone });
  assert.equal(found.length, 1);
  assert.match(found[0], /^Propose the standard track: the parsers are not installed\.\n.*has no typescript, which the proof of "a\.ts" needs\./);
  assert.deepEqual(run(TEXT, base, head, { dir: gone, leave: true }), []);
  // A folder with some packages leaves only the others.
  const some = path.join(tmp, 'some-parsers');
  fs.mkdirSync(path.join(some, 'typescript'), { recursive: true });
  fs.writeFileSync(path.join(some, 'typescript', 'package.json'), '{}');
  const partly = run(LOOK, { 'a.css': CSS }, { 'a.css': r(CSS, '#333', '#444') }, { dir: some });
  assert.match(partly[0], /has no postcss/);
});

test('no variable and no flag changes the folder of the parsers', () => {
  for (const file of ['lib/proof-parsers.js', 'lib/parse-dump.js', 'lib/proof.js']) {
    const source = fs.readFileSync(path.join(SKILL, file), 'utf8');
    assert.ok(!/NODE_PATH|process\.env\.[A-Z_]*PARSERS/.test(source), file);
  }
  assert.equal(require(path.join(SKILL, 'lib/proof-parsers.js')).PARSERS,
    '/opt/qory/parsers/node_modules');
  const dump = fs.readFileSync(path.join(SKILL, 'lib/parse-dump.js'), 'utf8');
  assert.ok(!/require\('(?:typescript|postcss|parse5|libpg-query|postcss-scss)'\)/.test(dump));
});
