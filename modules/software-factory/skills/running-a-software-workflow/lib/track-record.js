// The record of the track that proposal-reviewer writes at the end of each report, which
// the report check reads through the records of workflow-checks.js and the check of the
// fast track reads in the newest report.
'use strict';

module.exports = (lib) => {
  const { lines } = lib;

  // TRACK_READ starts the record of the track that an agent writes at the end of each report
  // when the text block of its Expected output has the line "Track read:": that line, a code
  // block with the lines of ## Track that the agent read, and the line "Track review: clean" or
  // "Track review: changes-needed", each marker at column 0, then the last word.
  const TRACK_READ = 'Track read:';

  // trackRecordOf returns the record of the track at the end of a report as { lines, result },
  // with each line of the code block trimmed and blank lines left out, or { error } with what
  // the report has in place of the record, after the words "the report has". The markers are
  // read with their leading spaces, so an indented record is no record, and a report with two
  // "Track read:" lines has no record.
  function trackRecordOf(text) {
    const all = lines(text);
    while (all.length && !all[all.length - 1].text.trim()) all.pop();
    const count = all.filter((line) => !line.fenced && line.text.trim() === TRACK_READ).length;
    if (count > 1) return { error: `${count} lines "${TRACK_READ}"` };
    let at = all.length - 2;
    while (at >= 0 && !all[at].text.trim()) at -= 1;
    const result = at >= 0 && !all[at].fenced &&
      /^Track review: (clean|changes-needed)$/.exec(all[at].text.trimEnd());
    if (!result) {
      return { error: 'no line "Track review: clean" or "Track review: changes-needed" before ' +
        'the last word' };
    }
    const read = all.findIndex((line) => !line.fenced && line.text.trimEnd() === TRACK_READ);
    const opening = read >= 0 && all[read + 1] && all[read + 1].fenced &&
      /^(`{3,}|~{3,})/.exec(all[read + 1].text);
    let close = read + 2;
    while (opening && close < at && !(all[close].fenced &&
      new RegExp(`^${opening[1][0] === '`' ? '`' : '~'}{${opening[1].length},}\\s*$`)
        .test(all[close].text))) {
      close += 1;
    }
    if (!opening || close >= at || all.slice(close + 1, at).some((line) => line.text.trim())) {
      return { error: `no line "${TRACK_READ}" and code block right before "Track review:"` };
    }
    return {
      lines: all.slice(read + 2, close).map((line) => line.text.trim()).filter(Boolean),
      result: result[1],
    };
  }

  return { TRACK_READ, trackRecordOf };
};
