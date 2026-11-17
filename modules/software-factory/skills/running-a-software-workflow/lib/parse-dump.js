#!/usr/bin/env node
// The dump of one file by the parser of its language, for the proofs of lib/proof-parsers.js.
//
//   parse-dump.js <parsers folder> <language> <mode> <data as JSON>   the file on stdin
//
// language is ts, tsx, js, jsx, sql, html, css, scss or tokens. mode is comment, text or look:
// - comment: the parse tree without comments, so that two files whose dumps are equal differ in
//   comments and white space only. A comment that a tool reads (a type check directive, a
//   bundler or linter marker, a hint, a conditional comment) stays in the dump with its text;
// - text: the tree with each text value that a person reads masked: the strings of a code file
//   that are no key, address, module name or comparison, the text of a page. Every comment stays
//   in the dump;
// - look: the tree with each value of colour, typography, spacing, border, corner radius and
//   shadow masked, in CSS, SCSS, CSS variables, design tokens, CSS-in-JS and the classes of
//   Tailwind, by the tables in the JSON argument. Layout, @font-face and anything that loads a
//   file never mask. Every comment stays in the dump.
// The dump ends with a line LAYOUT: the text with the comments left out and each masked value
// replaced by a mark (lib/layout.js), so that a change of white space outside them differs too.
// It prints the dump on stdout and exits 0. A file that does not parse exits 2 with "parse error:
// <reason>" on stderr, and a parser that the folder lacks exits 3 with "missing <package>". It
// loads each parser with require() by its absolute path in the folder, and runs nothing of the
// file. The caller sets a time limit and an empty environment.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { layout, jsonLayout } = require('./layout.js');

const [folder, language, mode, dataText] = process.argv.slice(2);
const data = JSON.parse(dataText || '{}');
const source = fs.readFileSync(0);
const text = source.toString('utf8');
const out = [];

function fail(reason, code = 2) {
  process.stderr.write(code === 2 ? `parse error: ${String(reason).split('\n')[0]}\n`
    : `${reason}\n`);
  process.exit(code);
}

// load returns the package of the folder: require() by its absolute path, and for a package that
// is an ES module, the import of the file that its package.json exports.
async function load(name) {
  const where = path.join(folder, name);
  if (!fs.existsSync(path.join(where, 'package.json'))) fail(`missing ${name}`, 3);
  try {
    return require(where);
  } catch (error) {
    if (error.code !== 'ERR_REQUIRE_ESM') throw error;
    const meta = JSON.parse(fs.readFileSync(path.join(where, 'package.json'), 'utf8'));
    const entry = meta.exports && meta.exports['.'];
    const file = typeof entry === 'string' ? entry : (entry && (entry.import || entry.default)) ||
      meta.module || meta.main;
    return import(pathToFileURL(path.join(where, file)).href);
  }
}

// ---- the look values ----------------------------------------------------------------------

// The words of a comment that a scanner or a linter reads as a suppression: the comment is code.
const SUPPRESSION = ['nosemgrep', 'nosec', 'nosonar', 'sonar', 'lgtm', 'codeql', 'gitleaks',
  String.raw`allowlist\s+secret`, String.raw`pragma:\s*allowlist`, String.raw`pyre-(?:ignore|fixme)`,
  'snyk', 'trufflehog', 'detect-secrets', 'bandit', 'noqa', 'tslint', 'jshint', 'jslint',
  'stylelint', 'rubocop', 'pylint', String.raw`type:\s*ignore`].join('|');

const GROUPS = new Map();
for (const [group, names] of Object.entries(data.properties || {})) {
  for (const name of names) GROUPS.set(name, group);
}
const VARIABLE_WORDS = data.variable_words || {};
const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|transparent|currentcolor)$/i;

// The functions that a look value may call: colours, numbers and lengths. Any other function,
// such as url(), image(), image-set(), src(), element(), paint(), cross-fade() or a gradient,
// can load a file or draw one.
const VALUE_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab',
  'oklch', 'color', 'color-mix', 'light-dark', 'calc', 'min', 'max', 'clamp', 'var', 'abs',
  'sign', 'round', 'mod', 'rem', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow',
  'sqrt', 'hypot', 'log', 'exp']);

// valueOk reports whether a value loads nothing and builds nothing: it has no escape, @import
// or interpolation, and each function that it calls is one of VALUE_FUNCTIONS.
function valueOk(value) {
  if (typeof value !== 'string' || value.trim() === '' || /\\|@import|#\{|\$\{/i.test(value)) {
    return false;
  }
  for (const call of value.matchAll(/([A-Za-z_-][\w-]*)\s*\(/g)) {
    if (!VALUE_FUNCTIONS.has(call[1].toLowerCase())) return false;
  }
  return true;
}

// variableGroup returns the group of a CSS variable or an SCSS variable by the first word of
// its name, or colour for a colour value, or null.
function variableGroup(name, value) {
  if (!valueOk(value)) return null;
  const word = name.replace(/^(--|\$|@)/, '').toLowerCase().split(/[-_]/)[0];
  if (Object.hasOwn(VARIABLE_WORDS, word)) return VARIABLE_WORDS[word];
  return COLOR_VALUE.test(value.trim()) ? 'color' : null;
}

// declaration returns the dump line of a declaration: its property and group when the value is a
// look value, else the property and value.
function declaration(prop, value, important) {
  const lower = prop.toLowerCase();
  let group = null;
  if (/^(--|\$)/.test(prop)) group = variableGroup(prop, value);
  else if (GROUPS.has(lower) && valueOk(value)) group = GROUPS.get(lower);
  const flag = important ? ' !important' : '';
  return group ? `DECL ${prop} <${group}>${flag}` : `DECL ${prop}: ${value}${flag}`;
}

// ---- Tailwind -----------------------------------------------------------------------------

const TAILWIND = data.tailwind || { utilities: [] };

// valuesOf returns the list of the values of a row of the table: the colours of the palette, the
// named list of the table, or the list itself.
function valuesOf(row) {
  if (row.values === 'colors') {
    const palette = [];
    for (const color of TAILWIND.colors || []) {
      for (const shade of TAILWIND.shades || []) palette.push(`${color}-${shade}`);
    }
    return [...palette, ...(TAILWIND.keywords || [])];
  }
  if (typeof row.values === 'string') return TAILWIND[row.values] || [];
  return row.values || [];
}

const CLASS_ROWS = (TAILWIND.utilities || []).map((row) => ({ row, values: new Set(valuesOf(row)) }));

// classKey returns "tw:<variants>|<flags>|<property>" for a class of the table, else
// "raw:<class>". A swap counts when both classes have the same key: the same variants, the same
// property, and the same sign and importance.
function classKey(token) {
  let rest = token;
  const variants = [];
  for (let depth = 0, from = 0, at = 0; at < token.length; at += 1) {
    if (token[at] === '[') depth += 1;
    else if (token[at] === ']') depth -= 1;
    else if (token[at] === ':' && depth === 0) {
      variants.push(token.slice(from, at));
      from = at + 1;
      rest = token.slice(from);
    }
  }
  let flags = '';
  if (rest.startsWith('!')) {
    flags += '!';
    rest = rest.slice(1);
  }
  if (rest.startsWith('-')) {
    flags += '-';
    rest = rest.slice(1);
  }
  if (/[\[\]()]/.test(rest)) return `raw:${token}`;
  for (const { row, values } of CLASS_ROWS) {
    let body = null;
    if (rest === row.prefix) body = '';
    else if (rest.startsWith(`${row.prefix}-`)) body = rest.slice(row.prefix.length + 1);
    if (body === null) continue;
    if (row.opacity && /\/(?:[0-9]{1,3})$/.test(body)) body = body.replace(/\/[0-9]{1,3}$/, '');
    if (values.has(body) && (!flags.includes('-') || row.negative)) {
      return `tw:${variants.join(':')}|${flags}|${row.property}`;
    }
  }
  return `raw:${token}`;
}

const classesLine = (value) => `CLASSES ${value.split(/\s+/).filter(Boolean).map(classKey).join(' ')}`;

// ---- CSS and SCSS ---------------------------------------------------------------------------

// cssWalk pushes the dump of the postcss node to sink, at depth. raw is true inside a rule that
// never counts, such as @font-face.
function cssWalk(node, depth, raw, sink, ranges, base) {
  const ind = ' '.repeat(depth);
  if (node.type === 'comment') {
    sink.push(`${ind}COMMENT ${JSON.stringify(node.text)}`);
    return;
  }
  if (node.type === 'decl') {
    const line = raw ? `DECL ${node.prop}: ${node.value}${node.important ? ' !important' : ''}`
      : declaration(node.prop, node.value, node.important);
    sink.push(ind + line);
    // A masked value is a range of the layout: from the colon and its white space to the end of
    // the value, as postcss reads it.
    if (!raw && ranges && /^DECL [^:]*<[a-z]+>/.test(line) && node.source && node.source.start) {
      const value = (node.raws.value && node.raws.value.raw) || node.value;
      const start = base + node.source.start.offset + node.prop.length +
        (node.raws.between || ':').length;
      ranges.push([start, start + value.trimEnd().length]);
    }
    return;
  }
  let kept = raw;
  if (node.type === 'atrule') {
    sink.push(`${ind}ATRULE @${node.name} ${JSON.stringify(node.params)}`);
    // @font-face, and any rule that loads a file, never counts.
    kept = raw || /^(?:-[a-z]+-)?(?:font-face|font-feature-values|import|charset|namespace|property)$/i
      .test(node.name);
  } else if (node.type === 'rule') {
    sink.push(`${ind}RULE ${JSON.stringify(node.selector)}`);
  } else {
    sink.push(`${ind}${String(node.type).toUpperCase()}`);
  }
  for (const child of node.nodes || []) cssWalk(child, depth + 1, kept, sink, ranges, base);
}

// cssLines returns the dump lines of the CSS text at depth, parsed with syntax, or throws the
// syntax error. With ranges, it adds to it the range of each masked value, from base.
function cssLines(syntax, css, depth, ranges = null, base = 0) {
  const sink = [];
  cssWalk(syntax.parse(css), depth, false, sink, ranges, base);
  return sink;
}

// ---- TypeScript and JavaScript ------------------------------------------------------------

// The attributes of a JSX element that hold text for a person.
const TEXT_ATTRIBUTES = new Set(['title', 'alt', 'placeholder', 'label', 'aria-label',
  'aria-description', 'aria-placeholder', 'aria-roledescription']);
const CSS_TAG = new RegExp('^(?:css|keyframes|createGlobalStyle|injectGlobal|' +
  'styled(?:\\.[A-Za-z0-9_]+|\\([^)]*\\))(?:\\.attrs\\([^)]*\\))?)$');

// The comment text that a tool reads, as the first trial of this proof listed them.
const DIRECTIVE = new RegExp([
  '@ts-', '<reference', '<amd-module', '<amd-dependency', '@jsx',
  '__pure__', '__no_side_effects__', '__inline__', '__noinline__', '__key__',
  'webpack', '@vite-ignore', 'sourcemappingurl', 'sourceurl', '@flow', '@noflow',
  'eslint', 'prettier-ignore', 'biome-ignore', 'deno-lint-ignore', 'dprint-ignore',
  'istanbul', String.raw`c8\s+ignore`, String.raw`v8\s+ignore`,
  String.raw`^/\*\s*(globals?|exported)\b`, SUPPRESSION,
].join('|'), 'i');

async function typescript() {
  const ts = await load('typescript');
  const K = ts.SyntaxKind;
  const scripts = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS,
    jsx: ts.ScriptKind.JSX };
  const sf = ts.createSourceFile(`f.${language}`, text, ts.ScriptTarget.Latest, true,
    scripts[language]);
  if (sf.parseDiagnostics.length) {
    fail(ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, ' '));
  }
  const shebang = ts.getShebang(text);
  if (shebang) out.push(`SHEBANG ${shebang}`);

  // In .js and .jsx files, tsc with checkJs reads JSDoc tags as types and modifiers. Each /**
  // comment is parsed alone, and its tags are compared without their prose.
  const jsFile = language === 'js' || language === 'jsx';
  const PROSE = new Set([K.JSDocText, K.JSDocLink, K.JSDocLinkCode, K.JSDocLinkPlain]);
  function jsdocTags(comment) {
    const parsed = ts.parseIsolatedJSDocComment(comment);
    if (!parsed || !parsed.jsDoc) return [];
    const lines = [];
    (function visit(node, depth) {
      if (PROSE.has(node.kind)) return;
      const kids = [];
      ts.forEachChild(node, (kid) => { kids.push(kid); });
      let line = ' '.repeat(depth) + K[node.kind];
      if (!kids.length) line += ` ${JSON.stringify(comment.slice(node.pos, node.end).trim())}`;
      lines.push(line);
      kids.forEach((kid) => visit(kid, depth + 1));
    }(parsed.jsDoc, 0));
    return lines.length > 1 ? lines : [];
  }

  const commentRanges = [];
  const maskRanges = [];
  const seen = new Set();
  function comments(token) {
    const ranges = (ts.getLeadingCommentRanges(text, token.pos) || [])
      .concat(ts.getTrailingCommentRanges(text, token.end) || []);
    for (const range of ranges) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      const comment = text.slice(range.pos, range.end);
      if (mode !== 'comment') {
        out.push(`COMMENT ${JSON.stringify(comment)}`);
      } else {
        if (DIRECTIVE.test(comment)) out.push(`DIRECTIVE ${JSON.stringify(comment)}`);
        else commentRanges.push([range.pos, range.end]);
        if (jsFile && comment.startsWith('/**')) {
          for (const line of jsdocTags(comment)) out.push(`JSDOC ${line}`);
        }
      }
    }
  }

  // sweep reads the comments of every token below node, for a subtree that the dump replaces.
  function sweep(node) {
    const kids = node.getChildren(sf);
    if (!kids.length) comments(node);
    kids.forEach(sweep);
  }

  // cookJsxText applies the JSX rule for white space to one text.
  function cookJsxText(value) {
    const lines = value.split(/\r\n|\n|\r/);
    let last = -1;
    lines.forEach((line, at) => { if (/[^ \t]/.test(line)) last = at; });
    let cooked = '';
    lines.forEach((line, at) => {
      let piece = line.replace(/\t/g, ' ');
      if (at !== 0) piece = piece.replace(/^[ ]+/, '');
      if (at !== lines.length - 1) piece = piece.replace(/[ ]+$/, '');
      if (piece) cooked += at !== last ? `${piece} ` : piece;
    });
    return cooked;
  }

  const attributeName = (attribute) => attribute.name.getText(sf);

  // codeString reports whether a string, or the static text of a template, is no text value: a
  // key, a name, a module, a comparison, a directive, a tag's template or an attribute that is no
  // text.
  function codeString(node) {
    const parent = node.parent;
    switch (parent.kind) {
      case K.ImportDeclaration: case K.ExportDeclaration: case K.ExternalModuleReference:
      case K.LiteralType: case K.ModuleDeclaration: case K.ImportAttribute: case K.ImportSpecifier:
      case K.ExportSpecifier: case K.PropertySignature: case K.MethodSignature:
      case K.PropertyDeclaration: case K.MethodDeclaration: case K.GetAccessor: case K.SetAccessor:
      case K.EnumMember: case K.BindingElement: case K.ComputedPropertyName: case K.CaseClause:
      case K.TaggedTemplateExpression:
        return true;
      case K.PropertyAssignment:
        return parent.name === node;
      case K.ElementAccessExpression:
        return parent.argumentExpression === node;
      case K.BinaryExpression:
        return [K.EqualsEqualsToken, K.EqualsEqualsEqualsToken, K.ExclamationEqualsToken,
          K.ExclamationEqualsEqualsToken, K.InKeyword, K.InstanceOfKeyword, K.LessThanToken,
          K.GreaterThanToken, K.LessThanEqualsToken, K.GreaterThanEqualsToken]
          .includes(parent.operatorToken.kind);
      case K.CallExpression:
        return parent.expression.kind === K.ImportKeyword ||
          (parent.expression.kind === K.Identifier && parent.expression.text === 'require');
      case K.NewExpression:
        return parent.expression.kind === K.Identifier && parent.expression.text === 'RegExp';
      case K.TemplateExpression: case K.TemplateSpan:
        return (parent.kind === K.TemplateSpan ? parent.parent : parent).parent.kind ===
          K.TaggedTemplateExpression;
      case K.ExpressionStatement: {
        const list = parent.parent && parent.parent.statements;
        if (!list || !([K.SourceFile, K.Block, K.ModuleBlock].includes(parent.parent.kind))) {
          return false;
        }
        const before = list.slice(0, list.indexOf(parent));
        return before.every((one) => one.kind === K.ExpressionStatement &&
          one.expression.kind === K.StringLiteral);
      }
      case K.JsxAttribute:
        return !TEXT_ATTRIBUTES.has(attributeName(parent));
      case K.JsxExpression:
        return !(parent.parent.kind === K.JsxAttribute &&
          TEXT_ATTRIBUTES.has(attributeName(parent.parent)));
      default:
        return false;
    }
  }

  const MASKED = new Set([K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateHead,
    K.TemplateMiddle, K.TemplateTail]);

  const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

  // literalValue returns the value of a literal as text, or null for any other node.
  function literalValue(node) {
    if (node.kind === K.StringLiteral || node.kind === K.NoSubstitutionTemplateLiteral) {
      return node.text;
    }
    if (node.kind === K.NumericLiteral) return node.text;
    if (node.kind === K.PrefixUnaryExpression && node.operator === K.MinusToken &&
      node.operand.kind === K.NumericLiteral) {
      return `-${node.operand.text}`;
    }
    return null;
  }

  // lookNode dumps a node of a look value and returns true, or returns false for a node that
  // is none.
  function lookNode(node, depth) {
    const ind = ' '.repeat(depth);
    if (node.kind === K.JsxAttribute && ['className', 'class'].includes(attributeName(node))) {
      const init = node.initializer;
      const value = init && (init.kind === K.StringLiteral ? init
        : init.kind === K.JsxExpression && init.expression &&
          [K.StringLiteral, K.NoSubstitutionTemplateLiteral].includes(init.expression.kind)
          ? init.expression : null);
      if (value) {
        out.push(`${ind}JsxAttribute ${JSON.stringify(attributeName(node))} ${classesLine(value.text)}`);
        maskRanges.push([value.getStart(sf), value.end]);
        sweep(node);
        return true;
      }
    }
    if (node.kind === K.PropertyAssignment && [K.Identifier, K.StringLiteral].includes(node.name.kind)) {
      const prop = kebab(node.name.text);
      const value = literalValue(node.initializer);
      if (GROUPS.has(prop) && value !== null) {
        out.push(`${ind}PropertyAssignment ${declaration(prop, value, false)}`);
        if (/<[a-z]+>/.test(declaration(prop, value, false))) {
          maskRanges.push([node.initializer.getStart(sf), node.initializer.end]);
        }
        sweep(node);
        return true;
      }
    }
    return false;
  }

  // The tagged templates of CSS with no substitution are parsed as CSS in a look dump: the
  // lines of each are made first, with the lines of its tag.
  const postcss = mode === 'look' ? await load('postcss') : null;
  const templates = new Map();
  if (mode === 'look') {
    (function find(node) {
      if (node.kind === K.TaggedTemplateExpression &&
        node.template.kind === K.NoSubstitutionTemplateLiteral &&
        CSS_TAG.test(node.tag.getText(sf).replace(/\s+/g, ''))) {
        try {
          const found = [];
          const lines = cssLines(postcss, node.template.text, 1, found,
            node.template.getStart(sf) + 1);
          // The offsets are those of the cooked text, so a template with an escape has none.
          const exact = node.template.getText(sf).slice(1, -1) === node.template.text;
          if (exact) maskRanges.push(...found);
          templates.set(node, [`TaggedTemplateExpression ${JSON.stringify(node.tag.getText(sf))}`,
            ...lines]);
        } catch {
          // A template that is no CSS is code, and walk dumps it as such.
        }
      }
      ts.forEachChild(node, find);
    }(sf));
  }

  function walkJsxChildren(node, depth) {
    let buffer = '';
    const flush = () => {
      if (buffer) {
        out.push(`${' '.repeat(depth)}JsxTextCooked ${mode === 'text' ? 'STR' : JSON.stringify(buffer)}`);
      }
      buffer = '';
    };
    for (const child of node.children) {
      if (child.kind === K.JsxText) {
        buffer += cookJsxText(child.getText(sf));
        if (mode === 'text') maskRanges.push([child.pos, child.end]);
        comments(child);
      } else if (child.kind === K.JsxExpression && !child.expression && !child.dotDotDotToken) {
        for (const token of child.getChildren(sf)) comments(token);
        if (mode === 'comment') commentRanges.push([child.getStart(sf), child.end]);
      } else {
        flush();
        walk(child, depth);
      }
    }
    flush();
  }

  function walk(node, depth) {
    if (node.kind >= K.FirstJSDocNode && node.kind <= K.LastJSDocNode) return;
    const ind = ' '.repeat(depth);
    if (templates.has(node)) {
      for (const line of templates.get(node)) out.push(ind + line);
      sweep(node);
      return;
    }
    if (mode === 'look' && lookNode(node, depth)) return;
    if (node.kind === K.JsxElement || node.kind === K.JsxFragment) {
      const isElement = node.kind === K.JsxElement;
      out.push(ind + K[node.kind]);
      walk(isElement ? node.openingElement : node.openingFragment, depth + 1);
      walkJsxChildren(node, depth + 1);
      walk(isElement ? node.closingElement : node.closingFragment, depth + 1);
      return;
    }
    const children = node.getChildren(sf);
    let line = ind + K[node.kind];
    if (node.flags & ts.NodeFlags.BlockScoped) line += ` flags=${node.flags & ts.NodeFlags.BlockScoped}`;
    if (children.length === 0) {
      const masked = mode === 'text' && MASKED.has(node.kind) && !codeString(node);
      if (masked) maskRanges.push([node.getStart(sf), node.end]);
      line += masked ? ' STR' : ` ${JSON.stringify(node.getText(sf))}`;
      comments(node);
    }
    out.push(line);
    for (const child of children) walk(child, depth + 1);
  }

  walk(sf, 0);
  out.push(`LAYOUT ${JSON.stringify(layout(text, commentRanges, maskRanges))}`);
}

// ---- SQL ------------------------------------------------------------------------------------

const SQL_DIRECTIVE = new RegExp([
  String.raw`^/\*\s*[+!]`, String.raw`\+goose`, String.raw`\+migrate`, 'migrate:', 'flyway',
  'liquibase', 'changeset', 'rollback', 'precondition', 'atlas:', 'sqlfluff', 'noqa',
  String.raw`^(--|/\*)\s*name\s*:`, SUPPRESSION,
].join('|'), 'i');

async function sql() {
  const pg = await load('libpg-query');
  await pg.loadModule();
  let tree;
  let scan;
  try {
    tree = pg.parseSync(text);
    scan = pg.scanSync(text);
  } catch (error) {
    fail(error.message);
  }
  const strip = (key, value) => {
    if (/location$|^stmt_len$/.test(key)) return undefined;
    if (mode === 'text' && key === 'A_Const' && value && value.sval) {
      return { ...value, sval: { sval: 'STR' } };
    }
    return value;
  };
  out.push(`TREE ${JSON.stringify(tree, strip, 1)}`);
  // The offsets of the tokens are bytes, so the layout reads the text one byte to a character.
  const bytes = source.toString('latin1');
  const commentRanges = [];
  const maskRanges = [];
  for (const token of scan.tokens) {
    const comment = token.tokenName === 'C_COMMENT' || token.tokenName === 'SQL_COMMENT';
    if (!comment) {
      const masked = mode === 'text' && ['SCONST', 'USCONST'].includes(token.tokenName);
      if (masked) maskRanges.push([token.start, token.end]);
      out.push(`TOKEN ${JSON.stringify(masked ? 'STR' : token.text)}`);
    } else if (mode !== 'comment') {
      out.push(`COMMENT ${JSON.stringify(token.text)}`);
    } else if (SQL_DIRECTIVE.test(token.text)) {
      out.push(`DIRECTIVE ${JSON.stringify(token.text)}`);
    } else {
      commentRanges.push([token.start, token.end]);
    }
  }
  out.push(`LAYOUT ${JSON.stringify(layout(bytes, commentRanges, maskRanges))}`);
}

// ---- HTML -----------------------------------------------------------------------------------

// A comment of HTML is code for a browser, a server or a build tool when it has a conditional
// marker, a server tag (PHP, ESI, SSI), a CDATA section, template syntax, or a suppression.
const HTML_DIRECTIVE = new RegExp([String.raw`\[if\b`, String.raw`\[endif\]`, String.raw`^\s*#`, 'prettier-ignore',
  'htmlhint', String.raw`\bbuild:`, 'endbuild', String.raw`^\s*\/?ko\b`, String.raw`<\?`,
  String.raw`\?>`, String.raw`<!\[CDATA\[`, String.raw`\]\]>`, String.raw`<!--`, '-->', 'esi:',
  '<esi', String.raw`\{\{`, String.raw`\{%`, String.raw`\{#`, '<%', '%>', String.raw`\$\{`,
  SUPPRESSION].join('|'), 'i');

async function html() {
  const { parse } = await load('parse5');
  const postcss = mode === 'look' ? await load('postcss') : null;
  // Scripting off: <noscript> content is parsed as markup, as a browser without JS does.
  const doc = parse(text, { sourceCodeLocationInfo: true, scriptingEnabled: false });
  const cut = [];
  const maskRanges = [];

  // valueRange adds the range of the value of an attribute of the element to the masks.
  function maskValue(element, attr) {
    const where = element.sourceCodeLocation && element.sourceCodeLocation.attrs &&
      element.sourceCodeLocation.attrs[attr.name.toLowerCase()];
    if (!where) return;
    const equals = text.slice(where.startOffset, where.endOffset).indexOf('=');
    if (equals >= 0) maskRanges.push([where.startOffset + equals + 1, where.endOffset]);
  }

  function attribute(depth, element, attr) {
    const name = attr.name.toLowerCase();
    if (mode === 'text' && TEXT_ATTRIBUTES.has(name)) {
      maskValue(element, attr);
      return [attr.name, 'STR'];
    }
    if (mode === 'look' && name === 'class') {
      maskValue(element, attr);
      return [attr.name, classesLine(attr.value)];
    }
    if (mode === 'look' && name === 'style') {
      maskValue(element, attr);
      try {
        return [attr.name, cssLines(postcss, attr.value, 0).map((line) => line.trim()).join(' ')];
      } catch {
        // A style that is no CSS is compared as text.
      }
    }
    return [attr.name, attr.value];
  }

  function walk(node, depth) {
    const ind = ' '.repeat(depth);
    let buffer = null;
    const tag = node.tagName;
    const flush = () => {
      if (buffer !== null) {
        if (mode === 'look' && tag === 'style') {
          try {
            out.push(...cssLines(postcss, buffer, depth));
            buffer = null;
            return;
          } catch {
            // A style that is no CSS is compared as text.
          }
        }
        const raw = ['script', 'style'].includes(tag);
        out.push(`${ind}TEXT ${mode === 'text' && !raw ? 'STR' : JSON.stringify(buffer)}`);
      }
      buffer = null;
    };
    const kids = node.content ? node.content.childNodes : node.childNodes || [];
    for (const child of kids) {
      if (child.nodeName === '#comment') {
        if (mode !== 'comment') {
          flush();
          out.push(`${ind}COMMENT ${JSON.stringify(child.data)}`);
        } else if (HTML_DIRECTIVE.test(child.data)) {
          flush();
          out.push(`${ind}DIRECTIVE ${JSON.stringify(child.data)}`);
        } else if (child.sourceCodeLocation) {
          cut.push([child.sourceCodeLocation.startOffset, child.sourceCodeLocation.endOffset]);
        }
      } else if (child.nodeName === '#text') {
        buffer = (buffer || '') + child.value;
        const raw = ['script', 'style'].includes(tag);
        if (child.sourceCodeLocation && ((mode === 'text' && !raw) ||
          (mode === 'look' && tag === 'style'))) {
          maskRanges.push([child.sourceCodeLocation.startOffset, child.sourceCodeLocation.endOffset]);
        }
      } else if (child.nodeName === '#documentType') {
        flush();
        out.push(`${ind}DOCTYPE ${JSON.stringify([child.name, child.publicId, child.systemId])}`);
      } else {
        flush();
        const attrs = child.attrs.map((attr) => [attr.namespace || '', attr.prefix || '',
          ...attribute(depth, child, attr)]);
        out.push(`${ind}ELEMENT ${JSON.stringify([child.namespaceURI, child.tagName, attrs])}`);
        walk(child, depth + 1);
      }
    }
    flush();
  }
  walk(doc, 0);

  if (mode === 'comment') {
    cut.sort((a, b) => a[0] - b[0]);
    let rest = '';
    let at = 0;
    for (const [start, end] of cut) {
      if (start < at) continue;
      rest += text.slice(at, start);
      at = end;
    }
    rest += text.slice(at);
    out.push(`SOURCE WITHOUT COMMENTS ${JSON.stringify(rest)}`);
  }
  out.push(`LAYOUT ${JSON.stringify(layout(text, mode === 'comment' ? cut : [], maskRanges))}`);
}

// ---- CSS, SCSS and design tokens -------------------------------------------------------------

async function css() {
  const postcss = await load('postcss');
  const syntax = language === 'scss' ? await load('postcss-scss') : postcss;
  try {
    const ranges = [];
    out.push(...cssLines(syntax, text, 0, ranges));
    out.push(`LAYOUT ${JSON.stringify(layout(text, [], ranges))}`);
  } catch (error) {
    fail(error.reason || error.message);
  }
}

// tokens dumps a JSON file of design tokens: an object with a $value or value member is a token
// of its $type or type, which a group may give to its tokens, and a token of a look type masks
// its value.
function tokens() {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail(error.message);
  }
  const types = new Set(data.token_types || []);
  const walk = (node, depth, inherited, key) => {
    const ind = ' '.repeat(depth);
    if (node === null || typeof node !== 'object') {
      out.push(`${ind}${JSON.stringify(key)}: ${JSON.stringify(node)}`);
      return;
    }
    const declared = node.$type !== undefined ? node.$type : node.type;
    const kind = typeof declared === 'string' ? declared : inherited;
    const member = Object.hasOwn(node, '$value') ? '$value' : Object.hasOwn(node, 'value') ? 'value'
      : null;
    out.push(`${ind}${JSON.stringify(key)}: ${Array.isArray(node) ? 'LIST' : 'OBJECT'}`);
    for (const [name, child] of Object.entries(node)) {
      if (name === member && types.has(kind) && valueOk(JSON.stringify(child))) {
        out.push(`${ind} ${JSON.stringify(name)}: <${kind}>`);
      } else {
        walk(child, depth + 1, kind, name);
      }
    }
  };
  walk(value, 0, null, '');
  out.push(`LAYOUT ${JSON.stringify(jsonLayout(text))}`);
}

// ---- python-free main -------------------------------------------------------------------------

async function main() {
  if (['ts', 'tsx', 'js', 'jsx'].includes(language)) await typescript();
  else if (language === 'sql') await sql();
  else if (language === 'html') await html();
  else if (language === 'css' || language === 'scss') await css();
  else if (language === 'tokens') tokens();
  else fail(`no parser for ${language}`, 3);
  process.stdout.write(`${out.join('\n')}\n`);
}

main().catch((error) => {
  process.stderr.write(`parse error: ${String(error && error.message).split('\n')[0]}\n`);
  process.exit(2);
});
