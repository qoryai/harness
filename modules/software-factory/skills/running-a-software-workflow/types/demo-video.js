// The check of the standard type demo-video, one artifact per demo scenario: the film
// scenario-<N>.mp4 and its WebVTT file scenario-<N>.vtt, with one cue per step of the newest
// demo script of the scenario.
'use strict';

module.exports = (lib) => {
  const { lineList, newestNamed, parseJson, plural, quote } = lib;

  const FILE = /^(scenario-[1-9][0-9]?)\.(mp4|vtt)$/;

  // cues returns the text of each cue of a WebVTT file and the start of the first, or null when
  // the file does not start with WEBVTT. NOTE, STYLE and REGION blocks are no cue.
  function cues(text) {
    const list = lineList(text);
    if (!/^(?:﻿)?WEBVTT(?:[ \t].*)?$/.test(list[0] || '')) return null;
    const blocks = [];
    let block = [];
    for (const line of list.slice(1)) {
      if (line.trim() === '') {
        if (block.length) blocks.push(block);
        block = [];
      } else block.push(line);
    }
    if (block.length) blocks.push(block);
    const out = [];
    for (const lines of blocks) {
      const timing = lines.findIndex((line) => line.includes('-->'));
      if (timing < 0 || timing > 1) continue;
      out.push({ start: lines[timing].split('-->')[0].trim(),
        text: lines.slice(timing + 1).join('\n') });
    }
    return out;
  }

  function demoVideo(run, files) {
    const names = [...files.keys()];
    const ids = new Set(names.map((name) => FILE.exec(name)[1]));
    run.did('files');
    if (ids.size > 1) {
      run.find(`Give the demo-video version the files of one scenario: it has those of ` +
        `${[...ids].sort().join(', ')}.`);
      return;
    }
    if (ids.size === 0) {
      if (!run.findings.length) run.find('Add scenario-<N>.mp4 and scenario-<N>.vtt.');
      return;
    }
    const [scenario] = ids;
    for (const extension of ['mp4', 'vtt']) {
      if (!files.has(`${scenario}.${extension}`)) {
        run.find(`Add ${scenario}.${extension} to the files: a demo-video version has the film ` +
          'and its WebVTT file.');
      }
    }
    const vtt = files.get(`${scenario}.vtt`);
    if (vtt === undefined) return;
    run.did('cues');
    const list = cues(vtt);
    if (!list) {
      run.find(`Start ${scenario}.vtt with the line WEBVTT.`);
      return;
    }
    if (list.length && list[0].start !== '00:00:00.000') {
      run.find(`Start the first cue of ${scenario}.vtt at 00:00:00.000, the start of step 1: ` +
        `it starts at ${quote(list[0].start)}.`);
    }
    const newest = newestNamed(run.context, 'demo-script', scenario, `${scenario}.json`);
    if (!newest) {
      run.find(`Push the demo script of ${scenario} before its film: the artifacts have no ` +
        `demo-script version named ${scenario}.`);
      return;
    }
    const steps = parseJson(newest.text, `demo-script ${scenario} version ${newest.number}`,
      'steps').steps;
    if (list.length !== steps.length) {
      run.find(`Give ${scenario}.vtt one cue per step of the demo script, ` +
        `${plural(steps.length, 'cue')}: it has ${list.length}.`);
    }
    list.slice(0, steps.length).forEach((cue, place) => {
      const title = steps[place] && steps[place].title;
      if (cue.text !== title) {
        run.find(`Set the text of cue ${place + 1} of ${scenario}.vtt to the title of step ` +
          `${place + 1} of the demo script, ${quote(String(title))}.`);
      }
    });
  }

  return {
    type: 'demo-video',
    main: 'scenario-<N>.vtt',
    words: 'demo video',
    reviewer: null,
    mainOptional: true,
    allowed: (name) => FILE.test(name),
    binary: (name) => name.endsWith('.mp4'),
    // The films of several scenarios at the top of the artifact folder are several artifacts,
    // so end takes none of them as a draft of this type.
    draft: () => false,
    check: demoVideo,
  };
};
