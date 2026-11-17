// fixes: the points of the newest verdict that a round fixes first.
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  CONTROL_ALL, Missing, REFUSED_ALL, artifactFolder, cut, isObject, plainLine, plural, qoryPath,
} = require('../lib/base.js');
const { POINT_TEXT } = require('../types/points.js');

// Each point that fixes prints starts with this.
const FIX_FIRST = 'Fix first: ';

// The most bytes that fixes reads from `work-item show`: the snapshot's comments, ticket and
// instruction stay within 768 KiB, and the rest of it is small.
const SHOW_BYTES = 4 * 1024 * 1024;

// fixes returns each point run_again of the work item's newest verdict when that verdict is
// changes-requested and its version has the stage id of the work item, as a line, and the
// last line; see the top of the script.
function fixes(io) {
  const qory = qoryPath();
  const skip = 'Go on with no point to fix first.\n';
  const show = childProcess.spawnSync(qory, ['work-item', 'show'],
    { env: io.env, encoding: 'utf8', timeout: 20000, maxBuffer: SHOW_BYTES });
  if (show.error) {
    throw new Missing(`${skip}${qory} work-item show could not run: ${show.error.message}.`);
  }
  if (show.status !== 0) {
    throw new Missing(`${skip}${qory} work-item show exited with ${show.status}.`);
  }
  let item;
  try {
    item = JSON.parse(show.stdout);
  } catch {
    item = null;
  }
  if (!isObject(item)) {
    throw new Missing(`${skip}${qory} work-item show printed no JSON object.`);
  }
  // A work item of .qory/work-item.json outside a run may have no verdict.
  const newest = Object.hasOwn(item, 'verdict') ? item.verdict : null;
  const what = 'Checked the newest verdict of the work item:';
  if (newest === null) return { lines: [], last: `${what} it has none, so no point comes first.` };
  if (!isObject(newest) || typeof newest.verdict !== 'string' ||
      !(newest.points === undefined || newest.points === null || Array.isArray(newest.points))) {
    throw new Missing(`${skip}The verdict that ${qory} work-item show printed is no object ` +
      'with a verdict and a list of points.');
  }
  const name = plainLine(newest.verdict);
  if (newest.verdict !== 'changes-requested') {
    return { lines: [], last: `${what} ${name}, so no point comes first.` };
  }
  const stage = isObject(item.stage) ? item.stage.id : null;
  const version = isObject(newest.version) ? newest.version.id : null;
  if (!verdictOfStage(io, version, stage)) {
    return { lines: [], last: `${what} ${name}, from no version of verdict in index.json ` +
      'with the stage of the work item, so no point comes first.' };
  }
  const lines = (newest.points || [])
    .filter((point) => isObject(point) && point.action === 'run_again' &&
      typeof point.text === 'string')
    .map((point) => point.text.replace(CONTROL_ALL, ' ').replace(REFUSED_ALL, '').trim())
    .filter(Boolean)
    .map((text) => FIX_FIRST + cut(text, POINT_TEXT));
  if (!lines.length) {
    return { lines, last: `${what} ${name} with no point run_again, so no point comes first.` };
  }
  return { lines, last: `${what} ${name}, so the round fixes ` +
    `${plural(lines.length, 'point')} first.` };
}

// verdictOfStage reports whether index.json of the artifact folder lists the version id of
// verdict with the stage id stage. A missing folder or index.json, or one that cannot be
// read, lists no such version.
function verdictOfStage(io, id, stage) {
  if (typeof id !== 'string' || !id || typeof stage !== 'string' || !stage) return false;
  try {
    const index = JSON.parse(fs.readFileSync(path.join(artifactFolder(io), 'index.json'),
      'utf8'));
    return index.artifacts
      .filter((one) => isObject(one) && one.type === 'verdict' && Array.isArray(one.versions))
      .flatMap((one) => one.versions)
      .some((one) => isObject(one) && one.id === id && one.stage_id === stage);
  } catch {
    return false;
  }
}

module.exports = {
  verbs: {
    fixes: {
      usage: ['fixes'],
      args: (io, what) => (what === undefined ? null : 'Give fixes no argument.'),
      run(io) {
        // A point's text may have 500 characters, so these lines are not cut to LINE.
        const { lines, last } = fixes(io);
        io.out.write([...lines, plainLine(last)].join('\n') + '\n');
        return lines.length ? 1 : 0;
      },
    },
  },
};
