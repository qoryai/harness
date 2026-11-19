// The part of the Mermaid hook of Qory Apiary that decides whether a block is drawn as a
// diagram: the text it draws, its type, the syntax that loads an address, and its limits.
// A port of assets/js/hooks/mermaid.js of qoryai/apiary, so that a check of the harness
// refuses a block that Qory Apiary shows as text, and the words of a block that no diagram
// syntax holds, which the 450 words of a record count.
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

// size returns the length that Mermaid compares with maxTextSize: the text with a line feed
// added, without its %% comment lines (not %%{), and without the white space at its start.
const size = (text) => `${text}\n`.replace(/^\s*%%(?!\{)[^\n]+\n?/gm, '').trimStart().length;

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
// bracket text, which hold no link. The first line with a type loses the type.
function readable(text) {
  let rest = text.split('\n').filter((line) => !line.trim().startsWith('%%')).join('\n')
    .replace(/^(\s*)(?:flowchart|graph)(?:[ \t]+(?:TB|TD|BT|RL|LR))?(?=[\s;]|$)/, '$1')
    .replace(/"[^"]*"/g, '""').replace(/\|[^|\n]*\|/g, '');
  for (let before = ''; before !== rest;) {
    before = rest;
    rest = rest.replace(/\[[^[\]]*\]|\([^()]*\)|\{[^{}]*\}/g, '');
  }
  return rest;
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

// prose returns the lines of a block whose words count toward a word limit. A line is diagram
// syntax, and its words do not count, when it has a link token, starts with a node id and a
// shape that ends the line, opens a block with "{" after at most 3 words, or is a subgraph
// line that ends with a bracket (its title is a label). Some lines are syntax only in their
// own diagram type, and count their words after the first 6, as a line that starts with a
// keyword does: a member or an attribute inside "{" and "}" of a class or entity diagram, a
// "Name : text" line of a class or state diagram, and a lone node id of a flowchart or state
// diagram. A %% comment line counts its words, and a line with a directive (%%{), which Qory
// Apiary does not draw, counts none.
const LINK_TOKEN = /-{2,}|={2,}|~{3,}|-\.|\.-|->|<\||\|\||\*-|\.\.[>|]/;
const NODE_SHAPE = /^[\w.-]+(?:\[|\(|\{|>|@\{).*[\])}](?::::[\w-]+)?;?$/;
const OPENS_BLOCK = /^\S+(?:\s+\S+){0,2}\s*\{$/;
const KEYWORDS = new Set([
  'flowchart', 'graph', 'sequenceDiagram', 'stateDiagram', 'stateDiagram-v2', 'classDiagram',
  'classDiagram-v2', 'erDiagram', 'subgraph', 'end', 'direction', 'style', 'classDef', 'class',
  'linkStyle', 'click', 'participant', 'actor', 'activate', 'deactivate', 'note', 'Note', 'loop',
  'alt', 'else', 'opt', 'par', 'and', 'rect', 'critical', 'option', 'break', 'autonumber',
  'title', 'state', 'namespace', 'box', 'link', 'links', 'callback', 'accTitle', 'accDescr',
  'create', 'destroy', 'interface',
]);
const BLOCK_TYPES = ['classDiagram', 'classDiagram-v2', 'erDiagram'];
const NAMED_TYPES = ['classDiagram', 'classDiagram-v2', 'stateDiagram', 'stateDiagram-v2'];
const ID_TYPES = ['flowchart', 'graph', 'stateDiagram', 'stateDiagram-v2'];
const NAMED_TEXT = /^[^\s:]+\s*:\s*\S/;
const LONE_ID = /^[\w.-]+;?$/;
const FREE_WORDS = 6;

function prose(text) {
  const kept = [];
  const type = typeOf(source(text));
  // bounded keeps the words of a line after its first FREE_WORDS words.
  const bounded = (line) => kept.push(line.split(/\s+/).slice(FREE_WORDS).join(' '));
  let inBlock = false;
  for (const line of shown(text).split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed.includes('%%{')) continue;
    if (trimmed.startsWith('%%')) {
      kept.push(trimmed.slice(2));
    } else if (BLOCK_TYPES.includes(type) && inBlock && trimmed !== '}') {
      bounded(trimmed);
    } else if (BLOCK_TYPES.includes(type) && OPENS_BLOCK.test(trimmed)) {
      inBlock = true;
    } else if (trimmed === '}') {
      inBlock = false;
    } else if (LINK_TOKEN.test(trimmed) || NODE_SHAPE.test(trimmed) || OPENS_BLOCK.test(trimmed)) {
      continue;
    } else if (/^subgraph\s.*[\])}]$/.test(trimmed)) {
      continue;
    } else if (KEYWORDS.has(trimmed.split(/[\s:;]/)[0])) {
      bounded(trimmed);
    } else if (NAMED_TYPES.includes(type) && NAMED_TEXT.test(trimmed)) {
      bounded(trimmed);
    } else if (ID_TYPES.includes(type) && LONE_ID.test(trimmed)) {
      continue;
    } else {
      kept.push(trimmed);
    }
  }
  return kept.join('\n');
}

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
  MAX_CHARACTERS, MAX_EDGES, TYPES, edges, loads, prose, refusal, size, source, typeOf,
};
