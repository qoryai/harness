// The part of the Mermaid hook of Qory Apiary that decides whether a block is drawn as a
// diagram: the text it draws, its type, the syntax that loads an address, and its limits.
// A port of assets/js/hooks/mermaid.js of qoryai/apiary, so that a check of the harness
// refuses a block that Qory Apiary shows as text, and counts the words of a diagram that are no
// syntax, which the 450 words of a record count after the free words of each diagram.
'use strict';

// The settings of mermaid.js (lines 158-159): maxTextSize and maxEdges.
const MAX_CHARACTERS = 20000;
const MAX_EDGES = 200;

// The diagram types that the hook draws (mermaid.js:262-271), as the first word of the first
// line of a block that is not blank and not a %% comment.
const TYPES = [
  'flowchart', 'graph', 'sequenceDiagram', 'stateDiagram', 'stateDiagram-v2', 'classDiagram',
  'classDiagram-v2', 'erDiagram',
];

const fence = (line) => /^\s*-{3}\s*$/.test(line);

// withoutFrontMatter drops the leading front matter blocks (--- to ---, after blank lines);
// an opening --- with no closing one drops the rest (mermaid.js:172-178).
function withoutFrontMatter(lines) {
  let list = lines;
  for (;;) {
    let start = 0;
    while (start < list.length && list[start].trim() === '') start += 1;
    if (start === list.length || !fence(list[start])) return list;
    const end = list.findIndex((line, at) => at > start && fence(line));
    if (end === -1) return [];
    list = list.slice(end + 1);
  }
}

// The statements that add a link or a call (mermaid.js:185-189).
const LINK_STATEMENTS = [
  /(^|;)\s*click(\s|$)/i,
  /(^|;)\s*(link|callback)(\s*`[^`]*`|\s+[^\s"`]+)\s*"/i,
  /(^|;)\s*links?\s+[^\s:;|"<>-][^\s:;|"<>]*\s*:/i,
];

// shown returns text as Qory Apiary shows a code block: without the invisible characters,
// with U+FFFD for each control character except tab, line feed and carriage return, and for
// each unpaired surrogate (lib/apiary/external_text.ex:49,114-121, called by
// lib/apiary_web/live/artifact_live/markdown.ex:336).
const INVISIBLE = /[\p{Cf}\u2028\u2029\u034F\u17B4\u17B5\u180B-\u180D\u180F]/gu;
const KEPT = new Set(['\u200C', '\u200D']);
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const UNPAIRED = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function shown(text) {
  return text.replace(UNPAIRED, '\uFFFD').replace(INVISIBLE, (char) => (KEPT.has(char) ? char : ''))
    .replace(CONTROL, '\uFFFD');
}

// source returns the text of a block as Qory Apiary draws it: as shown, without each line that
// has a directive (%%{), without each line with a link statement, and without front matter at
// its start (mermaid.js:195-202).
function source(text) {
  return withoutFrontMatter(
    shown(text).split(/\r\n|\r|\n/)
      .filter((line) => !line.includes('%%{') && !LINK_STATEMENTS.some((one) => one.test(line))),
  ).join('\n');
}

// size returns the length that Mermaid compares with maxTextSize, of the text of a code block
// (which ends with a line feed): without its %% comment lines (not %%{), the blank lines before
// each of them, and the white space at its start. One pass; a pattern with "^\\s*" is quadratic
// on blank lines.
function size(text) {
  const kept = [];
  let blank = [];
  for (const line of `${text}\n`.split('\n').slice(0, -1)) {
    if (/^\s*%%(?!\{)[^\n]/.test(line)) {
      blank = [];
    } else if (/^\s*$/.test(line)) {
      blank.push(line);
    } else {
      kept.push(...blank, line);
      blank = [];
    }
  }
  return `${[...kept, ...blank].join('\n')}\n`.trimStart().length;
}

// directive reports whether text has a line with a directive (%%{), as Qory Apiary reads it.
const directive = (text) => shown(text).includes('%%{');

// firstLine returns the first line of text that is not blank and not a %% comment, trimmed
// (mermaid.js:254-258).
function firstLine(text) {
  const found = text.split(/\r\n|\r|\n/).map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('%%'));
  return found === undefined ? '' : found;
}

// typeOf returns the first word of the first line, up to a space or a ";" (mermaid.js:275).
const typeOf = (text) => firstLine(text).split(/[\s;]/)[0];

// The CSS that loads an address, looked for in lower case, as written and with its comments
// dropped and its escapes read (mermaid.js:207-216).
const CSS_ADDRESSES = ['url(', 'image-set(', '@import'];

function unescaped(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-f]{1,6})[ \t\n\f\r]?|\\([\s\S])/gi, (_, code, char) => {
      if (code === undefined) return char === '\n' ? '' : char;
      const point = parseInt(code, 16);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '�';
    });
}

// dataBlocks returns each node data block (A@{ ... }) of text, from "@{" to the "}" that
// closes it, outside quotes; a block with no end runs to the end (mermaid.js:220-243).
function dataBlocks(text) {
  const blocks = [];
  let at = text.indexOf('@{');
  while (at !== -1) {
    let depth = 0;
    let quote = null;
    let end = text.length;
    for (let index = at + 1; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === '\\' && quote === '"') index += 1;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    blocks.push(text.slice(at, end));
    at = text.indexOf('@{', end);
  }
  return blocks;
}

// loads reports whether drawing text would load an address (mermaid.js:289-296): CSS with an
// address, a node with an image, a sequence diagram's properties or details line, and an
// event modeling diagram with a "<".
function loads(text) {
  if (/^eventmodeling/i.test(firstLine(text)) && text.includes('<')) return true;
  const written = text.toLowerCase();
  const read = unescaped(text).toLowerCase();
  if (CSS_ADDRESSES.some((css) => written.includes(css) || read.includes(css))) return true;
  if (dataBlocks(text).some((block) => /\bimg\b/i.test(block) || block.includes('\\'))) return true;
  return /(^|;)\s*(properties|details)(\s|$)/im.test(text);
}

// The statements of a flowchart that add no link. A node may be called direction, so only
// "direction" with a direction after it is no link.
const NOT_LINKS = new RegExp(
  '^\\s*(?:(?:subgraph|end|style|classDef|class|linkStyle|click)(?:\\s|$)' +
    '|direction\\s+(?:TB|TD|BT|RL|LR)(?:\\s|$))',
);

// A link of a flowchart has two ends. A link with a text in two parts, "A -- text --> B" or
// "A--text-->B", loses its first part, so that the second part is its only token.
const CLOSER = '(?=-{2,}|={2,}|-?\\.+-)';
const TEXT_LINK = new RegExp(
  '(?<![-=.<])(?:--|==|-\\.)(?:[ \\t]+(?:(?!--|==|-\\.)[^\\n;])+?[ \\t]+' +
    `|(?![-=.>xo\\s])(?:(?!--|==|-\\.)[^\\n;])*?)${CLOSER}`,
  'g',
);
const LINK = /(?:[<ox](?=--|==|-\.))?(?:-{2,}|={2,}|-\.+-?|\.+-|~{3,})[>ox]?/g;
const ENDS_IN_LINK = new RegExp(`${LINK.source}\\s*$`);
const STARTS_WITH_LINK = new RegExp(`^\\s*${LINK.source}`);

// nodes returns the number of nodes that one side of a link has: names joined by "&", and at
// least 1, so that a link with a side the count cannot read still counts.
function nodes(side) {
  return Math.max(1, side.split('&').filter((name) => name.trim() !== '').length);
}

// statementEdges returns how many edges one statement of a flowchart adds.
function statementEdges(statement) {
  if (NOT_LINKS.test(statement)) return 0;
  const sides = statement.replace(TEXT_LINK, '').split(LINK);
  let total = 0;
  for (let index = 0; index + 1 < sides.length; index += 1) {
    total += nodes(sides[index]) * nodes(sides[index + 1]);
  }
  return total;
}

// readable returns text without its %% comment lines, its quoted text and its |...| and
// bracket text (Mermaid reads no link in them), with each run of spaces and tabs as one
// space, so that TEXT_LINK takes linear time. The first line with a type loses the type.
function readable(text) {
  let rest = text.split('\n').filter((line) => !line.trim().startsWith('%%')).join('\n')
    .replace(/^(\s*)(?:flowchart|graph)(?:[ \t]+(?:TB|TD|BT|RL|LR))?(?=[\s;]|$)/, '$1')
    .replace(/"[^"]*"/g, '""').replace(/\|[^|\n]*\|/g, '');
  for (let before = ''; before !== rest;) {
    before = rest;
    rest = rest.replace(/\[[^[\]]*\]|\([^()]*\)|\{[^{}]*\}/g, '');
  }
  return rest.replace(/[ \t]+/g, ' ');
}

// edges returns at least the edges that Mermaid adds, never fewer: each link token adds one edge
// for each pair of nodes of its two sides (& groups), a link at the end or start of a line joins
// the next or previous line, and a text link "A -- t --> B" is one token.
function edges(text) {
  const joined = [];
  for (const part of readable(text).split(/[;\n]/)) {
    if (part.trim() === '') continue;
    const last = joined.length - 1;
    if (last >= 0 && (ENDS_IN_LINK.test(joined[last]) || STARTS_WITH_LINK.test(part))) {
      joined[last] += ` ${part}`;
    } else {
      joined.push(part);
    }
  }
  return joined.reduce((sum, statement) => sum + statementEdges(statement), 0);
}

// The words of a diagram that are no syntax. Syntax is a node id, a link token, a keyword and the
// brackets of a shape; every other word is text: a label ("..." and [...], (...), {...}, |...|, or
// "-- t -->"), the text after ":" (a message, a state text, a relation), a note, a title, a
// comment, a class member and an entity attribute. A word is a run of characters with no white
// space that has a letter or a digit; the core word count, which reads Markdown, is not used,
// because Markdown in a label would hide words. Each diagram has FREE_WORDS free words, and each
// word after them counts toward the 450 words of a record.
const FREE_WORDS = 150;
const LINK_TOKEN = /-{2,}|={2,}|~{3,}|-\.|\.-|->|-\)|<\||\|\||\*-|\.\.[>|]/;
const LINK_END = /[-=.>~<|)*{}]$/;
const COLON = /(?<!:):(?!:)/;
const OPENS_BLOCK = /^\S+(?:\s+\S+){0,2}\s*\{$/;
const HEADER = new RegExp(`^(?:${TYPES.slice().sort((a, b) => b.length - a.length).join('|')})` +
  '(?:[ \\t]+(?:TB|TD|BT|RL|LR))?');
const KEYWORDS = new Set([
  'end', 'direction', 'activate', 'deactivate', 'autonumber', 'rect', 'namespace', 'create',
  'destroy', 'interface', 'link', 'links', 'callback', 'click', 'state', 'note', 'Note',
  'participant', 'actor', 'title', 'accTitle', 'accDescr', 'box', 'loop', 'alt', 'else', 'opt',
  'par', 'and', 'critical', 'option', 'break', 'subgraph', 'class',
]);
// The keywords whose line is syntax: its words are node ids, class names and CSS properties,
// which no reader sees. In a class diagram, "class" starts a class with a label, so it is no
// such keyword there.
const STYLE_KEYWORDS = new Set(['style', 'classDef', 'class', 'linkStyle', 'cssClass']);
// The keywords whose line has no text but a label that brackets or quotes hold.
const NO_TEXT = new Set([
  'end', 'direction', 'activate', 'deactivate', 'autonumber', 'rect', 'namespace', 'create',
  'destroy', 'interface', 'link', 'links', 'callback', 'click', 'state', 'class',
]);
const BLOCK_TYPES = ['classDiagram', 'classDiagram-v2', 'erDiagram'];
const ID_TYPES = ['flowchart', 'graph', 'stateDiagram', 'stateDiagram-v2'];

// count returns the number of words of text.
const count = (text) => (text.match(/\S+/g) || [])
  .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

// labels returns the text of a line in quotes, in brackets and, with pipes true, in |...|, and
// the rest of the line with a space for each of those characters, in one pass. A quote, a
// bracket or a pipe that nothing closes holds the rest of the line.
function labels(line, { brackets, pipes }) {
  let text = '';
  let rest = '';
  let depth = 0;
  let quoted = false;
  let piped = false;
  for (const char of line) {
    if (quoted) {
      if (char === '"') quoted = false;
      else text += char;
      rest += ' ';
    } else if (char === '"') {
      quoted = true;
      text += ' ';
      rest += ' ';
    } else if (brackets && '[({'.includes(char)) {
      depth += 1;
      text += ' ';
      rest += ' ';
    } else if (brackets && depth > 0 && '])}'.includes(char)) {
      depth -= 1;
      text += ' ';
      rest += ' ';
    } else if (depth > 0 || piped) {
      if (pipes && depth === 0 && char === '|') piped = false;
      else text += char;
      rest += ' ';
    } else if (pipes && char === '|') {
      piped = true;
      text += ' ';
      rest += ' ';
    } else {
      rest += char;
    }
  }
  return { text, rest };
}

// linkLine returns the number of words of a line with a link token that are no syntax: a word
// that is not a node id. A node id is the one word at the start of the line, after a link
// token, or after "&".
function linkLine(rest) {
  let total = 0;
  let expectId = true;
  for (const token of rest.split(/\s+/).filter(Boolean)) {
    if (token === '&') {
      expectId = true;
    } else if (LINK_TOKEN.test(token)) {
      expectId = LINK_END.test(token);
    } else if (expectId) {
      expectId = false;
    } else {
      total += count(token);
    }
  }
  return total;
}

// restWords returns the number of words of a line, after its labels, that are no syntax.
function restWords(trimmed, type, inBlock) {
  const named = /^(\S+?)\s*:(?!:)\s*(.*)$/.exec(trimmed);
  const keyword = trimmed.split(/[\s:;]/)[0];
  if (LINK_TOKEN.test(trimmed)) {
    const colon = COLON.exec(trimmed);
    if (colon) {
      return linkLine(trimmed.slice(0, colon.index)) + count(trimmed.slice(colon.index + 1));
    }
    return linkLine(trimmed);
  }
  if (KEYWORDS.has(keyword)) {
    const after = trimmed.slice(keyword.length);
    if (NO_TEXT.has(keyword)) return 0;
    if (keyword === 'participant' || keyword === 'actor') {
      return count(after.split(/\bas\b/)[1] || '');
    }
    if ((keyword === 'note' || keyword === 'Note') && COLON.test(after)) {
      return count(after.slice(COLON.exec(after).index + 1));
    }
    return count(after);
  }
  if (inBlock) return count(trimmed);
  if (/^[\w.-]+;?$/.test(trimmed) && ID_TYPES.includes(type)) return 0;
  if (named && !/\s/.test(named[1])) return count(named[2]);
  return count(trimmed);
}

// diagramWords returns the number of words of the text of a Mermaid block that are no syntax.
// A line with a directive (%%{) is no text that Qory Apiary draws, and counts none.
function diagramWords(text) {
  const type = typeOf(source(text));
  const options = { brackets: type !== 'erDiagram', pipes: ['flowchart', 'graph'].includes(type) };
  let total = 0;
  let inBlock = false;
  let header = false;
  for (const line of shown(text).split(/\r\n|\r|\n/)) {
    let trimmed = line.trim();
    if (trimmed.includes('%%{')) continue;
    if (trimmed.startsWith('%%')) {
      total += count(trimmed.slice(2));
      continue;
    }
    const first = trimmed.split(/[\s:;]/)[0];
    if (STYLE_KEYWORDS.has(first) && (first !== 'class' || !BLOCK_TYPES.includes(type))) continue;
    if (!header && trimmed.split(/[\s;]/)[0] === type) {
      header = true;
      trimmed = trimmed.replace(HEADER, '').trim();
    }
    if (BLOCK_TYPES.includes(type) && inBlock) {
      if (trimmed === '}') inBlock = false;
      else total += count(trimmed);
      continue;
    }
    if (BLOCK_TYPES.includes(type) && OPENS_BLOCK.test(trimmed)) {
      inBlock = true;
      continue;
    }
    const split = labels(trimmed, options);
    total += count(split.text);
    let rest = split.rest.replace(/:::[\w-]+/g, ' ');
    const comment = rest.indexOf('%%');
    if (comment !== -1) {
      total += count(rest.slice(comment + 2));
      rest = rest.slice(0, comment);
    }
    rest = rest.replace(/[ \t]+/g, ' ').replace(TEXT_LINK, (match) => {
      total += count(match.slice(2));
      return '';
    }).trim();
    total += restWords(rest.replace(/;$/, ''), type, inBlock);
  }
  return total;
}

// charged returns the number of words of the block that count toward a word limit: the words
// of the diagram after the first FREE_WORDS.
const charged = (text) => Math.max(0, diagramWords(text) - FREE_WORDS);

// refusal returns why Qory Apiary shows the Mermaid block with this text as text, or draws
// it as an error, as { reason, found }, or null when it draws the block. reason is `type`,
// `loads`, `size` or `edges`.
function refusal(text) {
  const drawn = source(text);
  if (!TYPES.includes(typeOf(drawn))) return { reason: 'type', found: typeOf(drawn) };
  if (loads(drawn)) return { reason: 'loads' };
  const length = size(drawn);
  if (length > MAX_CHARACTERS) return { reason: 'size', found: length };
  if (['flowchart', 'graph'].includes(typeOf(drawn))) {
    const count = edges(drawn);
    if (count > MAX_EDGES) return { reason: 'edges', found: count };
  }
  return null;
}

module.exports = {
  FREE_WORDS, MAX_CHARACTERS, MAX_EDGES, TYPES, charged, diagramWords, directive, edges, loads,
  refusal, size, source, typeOf,
};
