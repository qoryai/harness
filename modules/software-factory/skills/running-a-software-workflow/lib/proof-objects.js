// The objects that a proof reads, checked against their ids. A session owns the .git folder of
// its checkout, so an object file there can be written to hold other bytes than its id says: a
// base blob that reads as comment-only, or a tree that hides a path. git reads such an object
// without a check. This module hashes the bytes of each object as git does (SHA-1 or SHA-256 of
// "<type> <size>\0<bytes>", by the length of the id) and throws Forged when one differs.
// verifyHistory checks the commits of the range and the trees that the listing of changed paths
// reads: the new objects of base..HEAD, the base commit, and each tree of the base. The proof
// checks each blob that it reads with verifyBlob.
'use strict';

const crypto = require('node:crypto');

const git = require('./git.js');

// The most objects that verifyHistory reads, and the most bytes that it takes from git.
const MOST_OBJECTS = 100000;
const MAX_BYTES = 256 * 1024 * 1024;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// left returns the milliseconds that a git call may take: what is left of the budget of the proof,
// and at least 1 s, or no limit of its own when the context has no deadline.
const left = (ctx) => (ctx.deadline ? Math.max(1000, ctx.deadline - Date.now()) : undefined);

// Forged is thrown for an object whose bytes have another hash than its id, or that is missing.
class Forged extends Error {
  constructor(id, why) {
    super(`object ${id} ${why}`);
    this.id = id;
    this.why = why;
  }
}

module.exports = (lib) => {
  const { Missing } = lib;

  // digest returns the id that git gives an object of type with bytes, in the format of oid.
  const digest = (oid, type, bytes) => crypto.createHash(oid.length === 64 ? 'sha256' : 'sha1')
    .update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');

  // verifyBlob throws Forged unless bytes are the blob with the id oid.
  function verifyBlob(oid, bytes) {
    if (digest(oid, 'blob', bytes) !== oid) throw new Forged(oid, 'has other bytes than its id');
  }

  // read returns a Map from id to { type, bytes } for the objects ids, as `git cat-file
  // --batch` reads them, after it hashes each. A missing object, or one with another hash,
  // throws Forged.
  function read(ctx, ids) {
    const out = new Map();
    if (!ids.length) return out;
    const raw = git.ok(Missing, ctx.top, ['cat-file', '--batch'], 'Run the proof again',
      { env: ctx.env, input: Buffer.from(`${ids.join('\n')}\n`), raw: true, maxBuffer: MAX_BYTES,
        timeout: left(ctx) });
    let at = 0;
    for (const id of ids) {
      const end = raw.indexOf(0x0a, at);
      const header = end < 0 ? '' : raw.subarray(at, end).toString('latin1').split(' ');
      if (header[0] !== id || header.length !== 3) throw new Forged(id, 'is missing or unreadable');
      const size = Number(header[2]);
      const bytes = raw.subarray(end + 1, end + 1 + size);
      if (bytes.length !== size) throw new Forged(id, 'is cut short');
      if (digest(id, header[1], bytes) !== id) throw new Forged(id, 'has other bytes than its id');
      out.set(id, { type: header[1], bytes });
      at = end + 1 + size + 1;
    }
    return out;
  }

  // oids returns the ids at the start of the lines of text, a list of the lines of git.
  const oids = (text) => text.split('\n').map((line) => line.split(' ')[0])
    .filter((word) => OID.test(word));

  // verifyHistory throws Forged for a commit or tree that the proof reads and whose bytes have
  // another hash than the id: the base commit, each new commit and tree of base..HEAD, and each
  // tree of the base. It throws Missing for a repository that git cannot list.
  function verifyHistory(ctx) {
    const fix = 'Run the proof again';
    const env = { env: ctx.env, timeout: left(ctx) };
    // git refuses an object whose hash differs, as a tree that it must parse; that is a forged
    // object too.
    const run = (args, options = env) => {
      try {
        return git.ok(Missing, ctx.top, args, fix, options);
      } catch (error) {
        if (!(error instanceof Missing) || /ETIMEDOUT/.test(error.message)) throw error;
        throw new Forged(ctx.base, `or an object below it cannot be read by git (${args[0]})`);
      }
    };
    const listed = oids(run(['rev-list', '--objects', `${ctx.base}..HEAD`]));
    const tree = run(['rev-parse', `${ctx.base}^{tree}`]).trim();
    const nested = run(['ls-tree', '-r', '-t', '-z', ctx.base]).split('\0')
      .map((entry) => /^[0-7]+ tree ([0-9a-f]+)\t/.exec(entry)).filter(Boolean)
      .map((found) => found[1]);
    const ids = [...new Set([ctx.base, tree, ...nested, ...listed])];
    if (ids.length > MOST_OBJECTS) {
      throw new Missing('Propose the standard track: the change has too many objects to check.',
        [`The repository lists ${ids.length} commits and trees, and the proof checks at most ` +
          `${MOST_OBJECTS}.`]);
    }
    // The type of each id: only commits and trees are read whole here; a blob is checked when
    // the proof reads it.
    const types = run(['cat-file', '--batch-check=%(objectname) %(objecttype)'],
      { env: ctx.env, input: `${ids.join('\n')}\n`, timeout: left(ctx) }).split('\n')
      .filter(Boolean);
    const wanted = [];
    types.forEach((line, place) => {
      const [id, type] = line.split(' ');
      if (id !== ids[place]) throw new Forged(ids[place], 'is missing or unreadable');
      if (type === 'commit' || type === 'tree') wanted.push(id);
    });
    // A batch of 20,000 objects keeps the output of git small.
    for (let from = 0; from < wanted.length; from += 20000) {
      read(ctx, wanted.slice(from, from + 20000));
    }
  }

  return { Forged, verifyBlob, verifyHistory, read, left };
};

module.exports.Forged = Forged;
