// What the runner of lib/preflight-run.cjs stores while it replays the steps of a demo script
// in a Page of lib/browser.cjs, as the verb film (verbs/film.cjs) asks. The window is
// 1280 x FILM_HEIGHT px, and every file goes to the folder dir, which the verb made new.
// - film: frames of the page as JPEG files f<N>.jpg, from the start of step 1. The sign-in
//   runs before, so no frame has it. finish returns { kind, frames, starts, end }: the
//   time of each frame, the start of each step and the end of the film, in ms from the start
//   of step 1. The film ends HOLD_MS after its last frame, which the page has after the last
//   action, so that its last result shows.
// - pictures: the PNG <name>-step-<N>.png of the page after each step.
// - pages: with widths, the PNG pages-<N>-<width>.png of the page after each step, at each
//   width, then at the width of the window again.
// A capture throws for a file that cannot be written, or for a page that cannot take a picture.
// diskFault tells the first from the second.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILM_HEIGHT = 720;
const WIDTH = 1280;
const HOLD_MS = 1000;

const frameName = (number) => `f${String(number).padStart(6, '0')}.jpg`;

// put writes data to a new file of dir: it fails for a name that exists, a link included.
const put = (dir, file, data) => fs.writeFileSync(path.join(dir, file), data, { flag: 'wx' });

async function startFilm(page, dir) {
  const frames = [];
  const starts = [];
  let t0 = 0;
  let stop = null;
  const frame = (data) => {
    const file = frameName(frames.length + 1);
    put(dir, file, data);
    frames.push({ file, at: Date.now() - t0 });
  };
  return {
    async begin(place) {
      if (place > 0) {
        starts.push(Date.now() - t0);
        return;
      }
      const first = await page.screenshot('jpeg');
      t0 = Date.now();
      starts.push(0);
      frame(first);
      frames[0].at = 0;
      stop = await page.screencast(frame);
    },
    async end() {},
    async stop() {
      const done = stop;
      stop = null;
      if (done) await done();
    },
    async finish() {
      await this.stop();
      frame(await page.screenshot('jpeg'));
      frames.sort((a, b) => a.at - b.at);
      return { kind: 'film', frames, starts, end: frames[frames.length - 1].at + HOLD_MS };
    },
  };
}

function startPictures(page, dir, { kind, name: scenario, widths }) {
  const files = [];
  return {
    async begin() {},
    async end(place) {
      for (const width of kind === 'pages' ? widths : [WIDTH]) {
        if (kind === 'pages') await page.resize(width);
        const file = kind === 'pages' ? `pages-${place + 1}-${width}.png`
          : `${scenario}-step-${place + 1}.png`;
        put(dir, file, await page.screenshot());
        files.push(file);
      }
      if (kind === 'pages') await page.resize(WIDTH);
    },
    async stop() {},
    async finish() {
      return { kind, files };
    },
  };
}

// capture returns { begin(place), end(place), stop(), finish() } for page. begin runs before
// the actions of step place + 1, end after them, and stop ends a film that did not finish.
// spec is { kind: 'film' | 'pictures' | 'pages', dir, name, widths }: name is the scenario of
// a film or of pictures, and widths the widths of pages.
function capture(page, spec) {
  return spec.kind === 'film' ? startFilm(page, spec.dir) : startPictures(page, spec.dir, spec);
}

// The codes of a write that failed for the disk of the machine, not for the page or the script.
const DISK_CODES = ['ENOSPC', 'EIO', 'EDQUOT', 'EROFS', 'EFBIG'];

// diskFault returns the first line of the message of error when a file could not be written
// because of the disk, such as one that is full, and null for any other error, such as a page
// that is closed.
function diskFault(error) {
  if (!error || !DISK_CODES.includes(error.code)) return null;
  return `${error.code}: ${String(error.message || error).split('\n')[0]}`;
}

module.exports = { FILM_HEIGHT, HOLD_MS, capture, diskFault };
