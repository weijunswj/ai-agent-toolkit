'use strict';

// Merge trains follow governance: they run only while the merged binding has governance enabled and
// task_prs.merge_train is not off, and land names the auto route only on the task auto-merge switch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const train = require('../scripts/toolkit-merge-train.cjs');
const governance = require('../scripts/toolkit-governance-state.cjs');
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const { fixture, built } = require('./support/merge-train-fixture.cjs');

const v2 = (extra = {}) => ({
  schema: 'toolkit.programme-binding.v2', repository: 'example/repo', governance: 'enabled',
  parents: [{ issue: 1, record_prefix: 'INT-EX-' }],
  store: { kind: 'github', repository: 'example/TRANSPORT-repo', branch: 'main', path: 'state/example/repo/' },
  required_checks: ['validate'], ...extra,
});

test('binding: task_prs.merge_train is on or off beside auto_merge, and nothing else', () => {
  for (const value of ['on', 'off']) assert.equal(programmeState.validateBinding(v2({ task_prs: { merge_train: value } })).task_prs.merge_train, value);
  assert.ok(programmeState.validateBinding(v2({ task_prs: { auto_merge: 'after-gates', merge_train: 'off' } })));
  for (const task_prs of [{ merge_train: 'maybe' }, { merge_train: true }, { trains: 'on' }]) {
    assert.throws(() => programmeState.validateBinding(v2({ task_prs })), /task_prs may hold only auto_merge \(off or after-gates\) and merge_train \(off or on\)/);
  }
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'programme-state', 'binding-v2.schema.json'), 'utf8'));
  assert.deepEqual(schema.properties.task_prs.properties.merge_train, { enum: ['off', 'on'] });
  assert.equal(governance.trainSwitchOf(v2({ task_prs: { merge_train: 'off' } })), 'off');
  assert.equal(governance.trainSwitchOf(v2()), null);
});

test('mergeTrain: on only in a fresh enabled binding, where no key means on', t => {
  const f = fixture(t);
  const read = () => governance.mergeTrain(f.repo, f.opts.registryOptions);
  assert.deepEqual([read().on, read().reason], [true, 'default-on']);
  f.governed({ merge_train: 'on' });
  assert.deepEqual([read().on, read().reason], [true, 'repository-on']);
  f.governed({ merge_train: 'off' });
  assert.deepEqual([read().on, read().reason], [false, 'repository-off']);
  f.governed(null, { governance: 'disabled' });
  assert.deepEqual([read().on, read().reason], [false, 'fresh-enabled-binding-required']);
  assert.equal(governance.mergeTrain(f.repo, { userHome: path.join(f.root, 'empty-home'), testOnly: true }).on, false, 'no binding read: off');
  assert.equal(governance.mergeTrain(null).on, false);
});

test('with trains off, build, catchup and land refuse; verify, body and eject still run', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const { result, out } = built(f, [f.member(1, one), f.member(2, two)]);
  const live = path.join(f.root, 'live.json');
  fs.writeFileSync(live, JSON.stringify({ 50: { state: 'OPEN', head: result.head }, 1: { state: 'OPEN', head: one }, 2: { state: 'OPEN', head: two } }));
  for (const binding of [[{ merge_train: 'off' }], [null, { governance: 'disabled' }]]) {
    f.governed(...binding);
    const off = /merge trains are off here \((repository-off|fresh-enabled-binding-required)\).*Merge each ready pull request alone/;
    assert.throws(() => train.run(['build', '--manifest', f.manifestFile({ members: [f.member(1, one)] }, 'again.json'), '--branch', 'toolkit-train/two', '--main', 'main'], f.repo, f.opts), off);
    assert.throws(() => train.run(['catchup', '--manifest', out, '--main', 'main'], f.repo, f.opts), off);
    assert.throws(() => train.run(['land', '--manifest', out, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live], f.repo, f.opts), off);
    const cli = f.cli('land', '--manifest', out, '--pr', '50', '--head', result.head, '--main', 'main', '--live', live);
    assert.equal(cli.status, 1);
    assert.match(JSON.parse(cli.stdout).error, off);
    assert.equal(train.run(['verify', '--manifest', out, '--head', result.head, '--main', 'main'], f.repo, f.opts).ok, true);
    assert.equal(train.run(['body', '--manifest', out], f.repo, f.opts).ok, true);
  }
  f.git('switch', '--quiet', 'toolkit-train/one');
  assert.equal(train.run(['eject', '--manifest', out, '--pr', '2', '--reason', 'governance turned off', '--main', 'main'], f.repo, f.opts).ok, true);
});

test('land names the auto route only with task auto-merge on, a clean scope and UAT line, and no RISKY member', t => {
  const f = fixture(t);
  const one = f.branch('pr-1', { 'b.txt': 'b\n' });
  const two = f.branch('pr-2', { 'c.txt': 'c\n' });
  const land = (manifest, head) => {
    const live = path.join(f.root, 'live.json');
    fs.writeFileSync(live, JSON.stringify({ 50: { state: 'OPEN', head }, 1: { state: 'OPEN', head: one }, 2: { state: 'OPEN', head: two } }));
    return train.run(['land', '--manifest', manifest, '--pr', '50', '--head', head, '--main', 'main', '--live', live], f.repo, f.opts);
  };
  const plain = built(f, [f.member(1, one), f.member(2, two)]);
  f.governed({ auto_merge: 'after-gates' });
  let landed = land(plain.out, plain.result.head);
  assert.equal(landed.ok, true, landed.problems.join('\n'));
  assert.deepEqual([landed.merge.route, landed.merge.route_reasons], ['auto', []]);

  f.governed({ auto_merge: 'off' });
  landed = land(plain.out, plain.result.head);
  assert.deepEqual([landed.merge.route, landed.merge.route_reasons], ['owner', ['task auto-merge is off here (repository-off)']]);

  f.governed({ auto_merge: 'after-gates' });
  const risky = JSON.parse(fs.readFileSync(plain.out, 'utf8'));
  risky.members[1] = { ...risky.members[1], tier: 'RISKY', owner_ok: 'owner typed merge 2' };
  const riskyFile = path.join(f.root, 'risky.json');
  fs.writeFileSync(riskyFile, JSON.stringify(risky));
  landed = land(riskyFile, plain.result.head);
  assert.equal(landed.merge.route, 'owner');
  assert.deepEqual(landed.merge.route_reasons, ["RISKY members wait for the owner's merge card: #2"]);

  // A member that changes a merge-authority path (a CI workflow) sends the train to the owner too.
  const ci = f.branch('pr-3', { '.github/workflows/ci.yml': 'name: ci\n' });
  f.git('branch', '--quiet', '-D', 'toolkit-train/one');
  const scoped = built(f, [f.member(1, one), f.member(3, ci)]);
  const live = path.join(f.root, 'live-ci.json');
  fs.writeFileSync(live, JSON.stringify({ 50: { state: 'OPEN', head: scoped.result.head }, 1: { state: 'OPEN', head: one }, 3: { state: 'OPEN', head: ci } }));
  landed = train.run(['land', '--manifest', scoped.out, '--pr', '50', '--head', scoped.result.head, '--main', 'main', '--live', live], f.repo, f.opts);
  assert.equal(landed.merge.route, 'owner');
  assert.ok(landed.merge.route_reasons.some(reason => reason.startsWith('.github/workflows/ci.yml: ')), landed.merge.route_reasons.join('\n'));
});
