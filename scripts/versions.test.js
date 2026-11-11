// Tests of the versions script of running-a-workflow. scripts/check.sh runs them.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { main } = require(path.join(__dirname, '../modules/software-factory/skills/running-a-workflow/versions.js'));

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'versions-test-')));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// setup makes an artifact folder with proposal version 2 and mockup version 1.
function setup(name) {
  const root = path.join(tmp, name);
  const proposal = path.join(root, 'proposal', 'main', 'v2');
  const mockup = path.join(root, 'mockup', 'main', 'v1');
  fs.mkdirSync(proposal, { recursive: true });
  fs.mkdirSync(mockup, { recursive: true });
  fs.mkdirSync(path.join(root, 'mockup-draft'));
  fs.writeFileSync(path.join(proposal, 'proposal.md'), 'text\n');
  fs.writeFileSync(path.join(proposal, 'sources.json'), '{}\n');
  fs.writeFileSync(path.join(proposal, 'checkout.svg'), '<svg/>\n');
  fs.writeFileSync(path.join(mockup, 'screens.json'), '{"screens":[]}\n');
  fs.writeFileSync(path.join(mockup, 'order.html'), '<p>a</p>\n');
  return root;
}

function run(root, ...argv) {
  let out = '';
  let err = '';
  const status = main(argv, {
    artifacts: root,
    out: { write: (text) => { out += text; } },
    err: { write: (text) => { err += text; } },
  });
  return { status, out, err };
}

const top = (root, ...names) => names.map((name) => path.join(root, name));

test('copy writes every file of the version to the top of the folder', () => {
  const root = setup('copy');
  assert.equal(run(root, 'copy', 'proposal', '2').status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'proposal.md'), 'utf8'), 'text\n');
  assert.ok(fs.existsSync(path.join(root, 'checkout.svg')));
});

test('compare is 0 for a copy with no change', () => {
  const root = setup('same');
  run(root, 'copy', 'proposal', '2');
  const result = run(root, 'compare', 'proposal', '2', ...top(root, 'proposal.md', 'sources.json', 'checkout.svg'));
  assert.equal(result.status, 0);
});

test('compare reports a changed, an added and a dropped file', () => {
  const root = setup('changed');
  run(root, 'copy', 'proposal', '2');
  fs.writeFileSync(path.join(root, 'proposal.md'), 'other\n');
  fs.writeFileSync(path.join(root, 'cart.svg'), '<svg/>\n');
  const result = run(root, 'compare', 'proposal', '2', ...top(root, 'proposal.md', 'sources.json', 'cart.svg'));
  assert.equal(result.status, 1);
  assert.match(result.out, /changed: proposal\.md/);
  assert.match(result.out, /added: cart\.svg/);
  assert.match(result.out, /dropped: checkout\.svg/);
});

test('compare of a mockup compares every page byte for byte', () => {
  const root = setup('mockup');
  const draft = (name) => path.join(root, 'mockup-draft', name);
  fs.writeFileSync(draft('screens.json'), '{"screens":[]}\n');
  fs.writeFileSync(draft('order.html'), '<p>a</p>\n');
  const files = ['screens.json', 'order.html'].map(draft);
  assert.equal(run(root, 'compare', 'mockup', '1', ...files).status, 0);
  fs.writeFileSync(draft('order.html'), '<p>b</p>\n');
  const changed = run(root, 'compare', 'mockup', '1', ...files);
  assert.equal(changed.status, 1);
  assert.equal(changed.out, 'changed: order.html\n');
  const dropped = run(root, 'compare', 'mockup', '1', draft('screens.json'));
  assert.equal(dropped.out, 'dropped: order.html\n');
});

test('a wrong type or number exits 2', () => {
  const root = setup('wrong');
  assert.equal(run(root, 'copy', '../proposal', '2').status, 2);
  assert.equal(run(root, 'copy', 'Proposal', '2').status, 2);
  assert.equal(run(root, 'copy', 'proposal', '2a').status, 2);
  assert.equal(run(root, 'move', 'proposal', '2').status, 2);
  assert.equal(run(root, 'compare', 'proposal', '2').status, 2);
});

test('a file outside the artifact folder, or a missing version, is refused', () => {
  const root = setup('outside');
  const outside = path.join(tmp, 'outside.md');
  fs.writeFileSync(outside, 'x');
  const result = run(root, 'compare', 'proposal', '2', outside);
  assert.equal(result.status, 1);
  assert.match(result.err, /Name a file under/);
  assert.match(run(root, 'copy', 'proposal', '9').err, /Pull proposal version 9 first/);
});

test('copy writes over no link', () => {
  const root = setup('link');
  fs.symlinkSync(path.join(tmp, 'elsewhere.md'), path.join(root, 'proposal.md'));
  const result = run(root, 'copy', 'proposal', '2');
  assert.equal(result.status, 1);
  assert.match(result.err, /Copy over no link/);
});

test('compare exits 1 for two files with the same name', () => {
  const root = setup('twice');
  run(root, 'copy', 'proposal', '2');
  fs.writeFileSync(path.join(root, 'mockup-draft', 'proposal.md'), 'other\n');
  const files = [path.join(root, 'proposal.md'), path.join(root, 'mockup-draft', 'proposal.md')];
  const result = run(root, 'compare', 'proposal', '2', ...files);
  assert.equal(result.status, 1);
  assert.match(result.err, /Name each file once/);
});

test('a file whose name starts with two dots is inside the folder', () => {
  const root = setup('dots');
  run(root, 'copy', 'proposal', '2');
  fs.writeFileSync(path.join(root, '..draft.md'), 'x');
  const result = run(root, 'compare', 'proposal', '2', ...top(root, 'proposal.md', '..draft.md'));
  assert.equal(result.status, 1);
  assert.match(result.out, /added: \.\.draft\.md/);
});

test('a missing artifact folder exits 1 with no stack trace', () => {
  const result = run(path.join(tmp, 'no-folder'), 'copy', 'proposal', '2');
  assert.equal(result.status, 1);
  assert.match(result.err, /Run the script only in a run/);
  assert.doesNotMatch(result.err, /at /);
});
