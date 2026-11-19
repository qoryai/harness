// The part of the Mermaid hook of Qory Apiary that decides whether a block is drawn as a
// diagram: the text it draws, its type, the syntax that loads an address, and its limits.
// A port of assets/js/hooks/mermaid.js of qoryai/apiary, so that a check of the harness
// refuses a block that Qory Apiary shows as text, which no word count may leave out.
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

// source returns the text of a block as Qory Apiary draws it: without each line that has a
// directive (%%{), without each line with a link statement, and without front matter at its
// start (mermaid.js:195-202).
function source(text) {
  return withoutFrontMatter(
    text.split(/\r\n|\r|\n/)
      .filter((line) => !line.includes('%%{') && !LINK_STATEMENTS.some((one) => one.test(line))),
  ).join('\n');
}

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

// The words of a flowchart statement that are no link: the statements of other kinds.
const NOT_LINKS = /^\s*(subgraph|end|style|classDef|class|linkStyle|direction|click)(\s|$)/;

// A link of a flowchart: its two ends, with a head, and a link with a text in two parts,
// "A -- text --> B", which the first replace turns into "A --> B".
const TEXT_LINK = /(?:--|==|-\.)[ \t]+(?:(?!--|==|-\.)[^\n])+?[ \t]+(?=-{2,}|={2,}|-?\.+-)/g;
const LINK = /(?:[<ox](?=--|==|-\.))?(?:-{2,}|={2,}|-\.+-?|\.+-|~{3,})[>ox]?/g;

// nodes returns the number of nodes that one side of a link has: names joined by "&".
function nodes(side) {
  return side.split('&').filter((name) => name.trim() !== '').length;
}

// statementEdges returns how many edges one statement of a flowchart adds.
function statementEdges(statement) {
  if (statement.trim().startsWith('%%') || NOT_LINKS.test(statement)) return 0;
  let rest = statement.replace(/"[^"]*"/g, '""').replace(/\|[^|]*\|/g, '');
  for (let before = ''; before !== rest;) {
    before = rest;
    rest = rest.replace(/\[[^[\]]*\]|\([^()]*\)|\{[^{}]*\}/g, '');
  }
  const sides = rest.replace(TEXT_LINK, '').split(LINK);
  let total = 0;
  for (let index = 0; index + 1 < sides.length; index += 1) {
    total += nodes(sides[index]) * nodes(sides[index + 1]);
  }
  return total;
}

// edges returns how many edges the text of a flowchart has, as Mermaid adds them in the
// flowchart database, which stops at maxEdges: a link between two sides adds one edge for
// each pair of nodes, so "A & B --> C" adds 2, and "A --> B --> C" adds 2. Text in quotes,
// in |...| and in brackets is no node. The count reads the statements that look like links,
// with no check that Mermaid reads them. mermaid.js sets maxEdges but has no count of its own.
function edges(text) {
  let total = 0;
  let typed = false;
  for (const line of text.split('\n')) {
    let rest = line;
    if (!typed && rest.trim() !== '' && !rest.trim().startsWith('%%')) {
      typed = true;
      rest = rest.replace(/^\s*(flowchart|graph)(\s+(TB|TD|BT|RL|LR))?/, '');
    }
    for (const statement of rest.split(';')) total += statementEdges(statement);
  }
  return total;
}

// refusal returns why Qory Apiary shows the Mermaid block with this text as text, or draws
// it as an error, as { reason, found }, or null when it draws the block. reason is `type`,
// `loads`, `size` or `edges`.
function refusal(text) {
  const shown = source(text);
  if (!TYPES.includes(typeOf(shown))) return { reason: 'type', found: typeOf(shown) };
  if (loads(shown)) return { reason: 'loads' };
  if (shown.length > MAX_CHARACTERS) return { reason: 'size', found: shown.length };
  if (['flowchart', 'graph'].includes(typeOf(shown))) {
    const count = edges(shown);
    if (count > MAX_EDGES) return { reason: 'edges', found: count };
  }
  return null;
}

module.exports = { MAX_CHARACTERS, MAX_EDGES, TYPES, edges, loads, refusal, source, typeOf };
