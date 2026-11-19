// The part of the Mermaid hook of Qory Apiary that decides whether a block is drawn as a
// diagram: the text it draws, its type, the syntax that loads an address, and its limits.
// A port of assets/js/hooks/mermaid.js of qoryai/apiary, so that a check of the harness
// refuses a block that Qory Apiary shows as text, and counts the characters of a diagram, which
// the 450 words of a record count above the free characters of each diagram.
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
  let from = 0;
  for (;;) {
    let start = from;
    while (start < lines.length && lines[start].trim() === '') start += 1;
    if (start === lines.length || !fence(lines[start])) return lines.slice(from);
    let end = start + 1;
    while (end < lines.length && !fence(lines[end])) end += 1;
    if (end === lines.length) return [];
    from = end + 1;
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

// size returns the length that Mermaid compares with maxTextSize: the text with a line feed at
// its end, without its %% comment lines (not %%{), the blank lines before each, and the white
// space at its start. One pass: a pattern with "^\\s*" is quadratic on blank lines.
function size(text) {
  const kept = [];
  let blank = [];
  for (const line of `${text}\n`.split('\n').slice(0, -1)) {
    if (/^\s*%%(?!\{)[^\n]/.test(line)) {
      blank = [];
    } else if (/^\s*$/.test(line)) {
      blank.push(line);
    } else {
      for (const empty of blank) kept.push(empty);
      kept.push(line);
      blank = [];
    }
  }
  return `${kept.concat(blank).join('\n')}\n`.trimStart().length;
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

// withoutComments drops each /* ... */ of text. A /* with no */ after it stays. It looks for each
// end with indexOf: a pattern with a lazy part is quadratic on many /* with no end.
function withoutComments(text) {
  let out = '';
  let from = 0;
  for (let open = text.indexOf('/*'); open !== -1; open = text.indexOf('/*', from)) {
    const close = text.indexOf('*/', open + 2);
    if (close === -1) break;
    out += text.slice(from, open);
    from = close + 2;
  }
  return out + text.slice(from);
}

function unescaped(text) {
  return withoutComments(text)
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
  return propertiesLine(text);
}

// propertiesLine reports what /(^|;)\s*(properties|details)(\s|$)/im reports (mermaid.js:295), in
// one pass: that pattern takes quadratic time on a long run of blank lines.
function propertiesLine(text) {
  for (const found of text.matchAll(/(?:properties|details)(?=\s|$)/gi)) {
    let at = found.index;
    while (at > 0 && !/[;\n\r\u2028\u2029]/.test(text[at - 1]) && /\s/.test(text[at - 1])) at--;
    if (at === 0 || /[;\n\r\u2028\u2029]/.test(text[at - 1])) return true;
  }
  return false;
}

// The statements of a flowchart that add no link. A node may be called direction, so only
// "direction" with a direction after it is no link.
const NOT_LINKS = new RegExp(
  '^\\s*(?:(?:subgraph|end|style|classDef|class|linkStyle|click)(?:\\s|$)' +
    '|direction\\s+(?:TB|TD|BT|RL|LR)(?:\\s|$))',
);

// A link of a flowchart has two ends. A link with a text in two parts, "A -- text --> B" or
// "A--text-->B", loses its first part, so that the second arrow is its only link.
const CLOSER = '(?=-{2,}|={2,}|-?\\.+-)';
const TEXT_LINK = new RegExp(
  '(?<![-=.<])(?:--|==|-\\.)(?:[ \\t]+(?:(?!--|==|-\\.)[^\\n;])+?[ \\t]+' +
    `|(?![-=.>xo\\s])(?:(?!--|==|-\\.)[^\\n;])*?)${CLOSER}`,
  'g',
);
// \.+- starts only at the start of a run of dots, so that a long run takes linear time.
const LINK = /(?:[<ox](?=--|==|-\.))?(?:-{2,}|={2,}|-\.+-?|(?<!\.)\.+-|~{3,})[>ox]?/g;

// endsInLink reports whether text ends in a LINK and white space. It reads back from the end: a
// pattern for it takes quadratic time on a long run of "." or of lines that end in a link.
function endsInLink(text) {
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  const behind = (at, chars) => at >= 0 && chars.includes(text[at]);
  for (const stop of [end, end - 1]) {
    if (stop < end && !behind(stop, '>ox')) continue;
    const last = stop - 1;
    if (behind(last, '-') && behind(last - 1, '-')) return true;
    if (behind(last, '=') && behind(last - 1, '=')) return true;
    if (behind(last, '~') && behind(last - 1, '~') && behind(last - 2, '~')) return true;
    if (behind(last, '-') && behind(last - 1, '.')) return true;
    let dots = behind(last, '-') ? last - 1 : last;
    if (!behind(dots, '.')) continue;
    while (behind(dots, '.')) dots -= 1;
    if (behind(dots, '-')) return true;
  }
  return false;
}
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
  return withoutBrackets(rest).replace(/[ \t]+/g, ' ');
}

// withoutBrackets removes each [...], (...) and {...} group, the innermost first, in one pass.
// A closer that does not match the opener before it stays in the text, so that the result has
// at least the text of a removal that ignores the order of the kinds.
function withoutBrackets(text) {
  const closer = { '[': ']', '(': ')', '{': '}' };
  const out = [];
  const open = [];
  for (const char of text) {
    if (closer[char]) {
      open.push({ char, at: out.length });
    } else if (open.length > 0 && closer[open[open.length - 1].char] === char) {
      out.length = open.pop().at;
      continue;
    }
    out.push(char);
  }
  return out.join('');
}

// edges returns at least the edges that Mermaid adds, never fewer: each link adds one edge
// for each pair of nodes of its two sides (& groups), a link at the end or start of a line joins
// the next or previous line, and a text link "A -- t --> B" is one link.
function edges(text) {
  const joined = [];
  for (const part of readable(text).split(/[;\n]/)) {
    if (part.trim() === '') continue;
    const last = joined.length - 1;
    if (last >= 0 && (endsInLink(joined[last][joined[last].length - 1]) ||
      STARTS_WITH_LINK.test(part))) {
      joined[last].push(part);
    } else {
      joined.push([part]);
    }
  }
  return joined.reduce((sum, parts) => sum + statementEdges(parts.join(' ')), 0);
}

// FREE_CHARACTERS characters of each diagram are free, and each 6 after them cost one word of
// the 450 of a record. The characters are those of source(), with each entity as the character
// it stands for, that are no white space and not in SYMBOLS. The core word count is not used,
// because it reads Markdown.
const FREE_CHARACTERS = 700;
const CHARACTERS_PER_WORD = 6;
const SYMBOLS = new Set([...'-=.<>|*()[]{}:;&~%"\'']);

// The named entities that the decoder knows. Mermaid writes "#name;" as "&name;", and the page
// reads it as HTML. An entity that is not in the list stays text, so that its letters count.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ',
  emsp: ' ', thinsp: ' ', shy: '­', copy: '©', reg: '®',
  trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘',
  rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  bull: '•', middot: '·', times: '×', divide: '÷', deg: '°',
  plusmn: '±', micro: 'µ', para: '¶', sect: '§', euro: '€',
  pound: '£', yen: '¥', cent: '¢', hearts: '♥', spades: '♠',
  clubs: '♣', diams: '♦', larr: '←', rarr: '→', uarr: '↑',
  darr: '↓', harr: '↔', check: '✓', infin: '∞', ne: '≠',
  le: '≤', ge: '≥', sum: '∑', radic: '√', pi: 'π', alpha: 'α',
  beta: 'β', lambda: 'λ', mu: 'μ', omega: 'ω', Omega: 'Ω',
};

// codePoint returns the character of a number, as HTML reads it: U+FFFD for 0, a surrogate and
// a number over 0x10FFFF.
function codePoint(number) {
  const valid = number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff);
  return valid ? String.fromCodePoint(number) : '�';
}

// decoded returns text with each entity as the character it stands for, in one pass: "&#32;",
// "&#x20;", "&name;", and Mermaid's "#32;" and "#name;" ("#x20;" is no number to Mermaid: it
// writes "&x20;", which the page shows as text).
function decoded(text) {
  const entity = /&#([xX][0-9a-fA-F]+|\d+);|#(\d+);|[&#](\w+);/g;
  return text.replace(entity, (all, number, plain, name) => {
    if (number !== undefined) {
      return codePoint(/^[xX]/.test(number) ? parseInt(number.slice(1), 16) : Number(number));
    }
    if (plain !== undefined) return codePoint(Number(plain));
    return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : all;
  });
}

// characters returns the number of characters of the Mermaid block with this text that count.
function characters(text) {
  let count = 0;
  for (const char of decoded(source(text))) {
    if (!SYMBOLS.has(char) && !/\s/u.test(char)) count += 1;
  }
  return count;
}

// charged returns the number of words that the block costs: one for each 6 characters over
// FREE_CHARACTERS.
const charged = (text) => Math.ceil(Math.max(0, characters(text) - FREE_CHARACTERS) /
  CHARACTERS_PER_WORD);

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
  CHARACTERS_PER_WORD, FREE_CHARACTERS, MAX_CHARACTERS, MAX_EDGES, TYPES, characters, charged,
  directive, edges, loads, refusal, size, source, typeOf,
};
