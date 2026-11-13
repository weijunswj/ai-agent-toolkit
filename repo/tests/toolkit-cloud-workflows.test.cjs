'use strict';

// The cloud sweep copies a governed repository carries: the render from the Toolkit's own workflow
// files, the installer and its --check, and the Toolkit-root split in the sweep action.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const workflows = require(path.join(ROOT, 'repo/scripts/toolkit-cloud-workflows.cjs'));
const action = require(path.join(ROOT, 'repo/scripts/toolkit-programme-sweep-action.cjs'));
const conformance = require(path.join(ROOT, 'repo/scripts/toolkit-governance-conformance.cjs'));
const COMMIT = workflows.toolkitHead(ROOT);
const OTHER = 'a'.repeat(40);
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const SWEEP = workflows.WORKFLOWS.find(row => row.id === 'programme-sweep');
const GATE = workflows.WORKFLOWS.find(row => row.id === 'programme-sweep-gate');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function tempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-workflows-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '--quiet']);
  return dir;
}

function capture() {
  const chunks = [];
  return { write: text => { chunks.push(String(text)); return true; }, text: () => chunks.join('') };
}

// Undoes the render, so a copy can be compared with its source line for line.
function unrender(text, { ci = null } = {}) {
  const lines = text.split('\n');
  assert.match(lines[0], new RegExp(`^# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED [a-z-]+ toolkit=${COMMIT} sha256=[0-9a-f]{12}$`));
  assert.match(lines[1], /^# A copy of the Toolkit's own workflow, pinned to the Toolkit commit above\./);
  let body = lines.slice(2).join('\n');
  body = body.replace(/\n      - name: Check out the Toolkit\n        uses: [^\n]+\n        with:\n          repository: [^\n]+\n          ref: [0-9a-f]{40}\n          path: \.toolkit\n          persist-credentials: false\n\n/, '\n');
  body = body.replace(/          repository: weijunswj\/ai-agent-toolkit\n          ref: [0-9a-f]{40}\n          path: \.toolkit\n/g, '          ref: TOOLKIT\n');
  body = body.replace(/node \.toolkit\/repo\/scripts\//g, 'node repo/scripts/');
  body = body.replace('- name: Check out the gate from the Toolkit', '- name: Check out the gate from main');
  if (ci) body = body.replace(`workflows: [${JSON.stringify(ci.name)}]`, 'workflows: [Validate]').replace(`CI_WORKFLOW: ${ci.file}`, 'CI_WORKFLOW: validate.yml');
  return body;
}

test('cloud workflows: the sweep copy is the Toolkit file plus a pinned Toolkit checkout and .toolkit paths', () => {
  const text = workflows.render('programme-sweep', source(SWEEP.file), COMMIT);
  const original = source(SWEEP.file).replace(/          ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false\n          sparse-checkout/, '          ref: TOOLKIT\n          persist-credentials: false\n          sparse-checkout');
  assert.equal(unrender(text), original, 'nothing else changes');
  assert.match(text, /- name: Check out this run's commit\n[^\n]+\n        with:\n          ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false\n\n      - name: Check out the Toolkit\n/, 'the governed checkout stays and the Toolkit comes next');
  assert.doesNotMatch(text, /node repo\/scripts\//, 'every script runs from the Toolkit checkout');
  assert.equal((text.match(/repository: weijunswj\/ai-agent-toolkit\n {10}ref: ([0-9a-f]{40})/g) || []).length, 2, 'the sweep and the follow-up check the Toolkit out');
  assert.equal((text.match(new RegExp(`ref: ${COMMIT}`, 'g')) || []).length, 2, 'both at the pinned commit');
  for (const uses of text.match(/^\s+uses: \S+/gm)) assert.match(uses, /@[0-9a-f]{40}$/, `${uses.trim()} is pinned by commit`);
  assert.equal((text.match(/secrets\./g) || []).length, (source(SWEEP.file).match(/secrets\./g) || []).length, 'no new secret use');
  const toolkitStep = text.slice(text.indexOf('- name: Check out the Toolkit'), text.indexOf('- name: Set up Node'));
  assert.doesNotMatch(toolkitStep, /secrets\.|token/, 'the Toolkit checkout uses no token');
  assert.doesNotMatch(text, /^\s+(pull_request|pull_request_target):/m, 'still never for pull requests');
});

test('cloud workflows: the gate copy checks the Toolkit out and follows the repository CI or drops the trigger', () => {
  const plain = workflows.render('programme-sweep-gate', source(GATE.file), COMMIT);
  assert.doesNotMatch(plain, /workflow_run:|CI_WORKFLOW/, 'without a CI workflow the trigger and its input go');
  assert.match(plain, /- name: Check out the gate from the Toolkit\n[^\n]+\n        with:\n          repository: weijunswj\/ai-agent-toolkit\n          ref: [0-9a-f]{40}\n          path: \.toolkit\n          persist-credentials: false\n          sparse-checkout: repo\/scripts\/toolkit-programme-sweep-gate\.cjs/);
  assert.match(plain, /run: node \.toolkit\/repo\/scripts\/toolkit-programme-sweep-gate\.cjs\n/);
  assert.doesNotMatch(plain, /ref: main/);
  const ci = { file: 'ci.yml', name: 'Build and test' };
  const followed = workflows.render('programme-sweep-gate', source(GATE.file), COMMIT, ci);
  assert.match(followed, /workflow_run:\n    workflows: \["Build and test"\]\n    types: \[completed\]/);
  assert.match(followed, /CI_WORKFLOW: ci\.yml/);
  assert.equal(unrender(followed, { ci }), source(GATE.file).replace(/          ref: main\n/, '          ref: TOOLKIT\n'));
  assert.equal(workflows.ciWorkflowName('name: "CI"\non: push\n'), 'CI');
  assert.equal(workflows.ciWorkflowName('on: push\n'), null);
});

test('cloud workflows: a source that changed shape stops the render', () => {
  assert.throws(() => workflows.render('programme-sweep', source(SWEEP.file).replace("Check out this run's commit", 'Check out'), COMMIT), /changed shape/);
  assert.throws(() => workflows.render('programme-sweep-gate', source(GATE.file).replace('ref: main', 'ref: trunk'), COMMIT), /changed shape/);
  assert.throws(() => workflows.render('programme-sweep', source(SWEEP.file), 'abc'), /40-character/);
});

test('cloud workflows: install, check, refresh and the refusals', t => {
  const repo = tempRepo(t);
  const out = capture();
  const err = capture();
  const run = (argv, commit = COMMIT) => workflows.main(argv, { out, err, root: ROOT, commit });
  assert.equal(run(['--repo', repo, '--check']), 1, 'missing copies are drift');
  assert.equal(run(['--repo', repo]), 0);
  for (const row of workflows.WORKFLOWS) assert.ok(fs.existsSync(path.join(repo, row.file)), `${row.file} written`);
  assert.match(out.text(), /shard-timings: not copied/);
  assert.equal(run(['--repo', repo, '--check']), 0, 'current');
  const sweepFile = path.join(repo, SWEEP.file);
  fs.appendFileSync(sweepFile, '# local edit\n');
  assert.equal(workflows.plan({ repo, root: ROOT, commit: COMMIT }).rows.find(row => row.id === 'programme-sweep').state, 'edited');
  assert.equal(run(['--repo', repo]), 0, 'a refresh rewrites an edited copy');
  assert.equal(workflows.plan({ repo, root: ROOT, commit: COMMIT }).rows.every(row => row.state === 'current'), true);
  // A copy rendered at another commit is outdated.
  fs.writeFileSync(sweepFile, workflows.render('programme-sweep', source(SWEEP.file), OTHER));
  assert.equal(workflows.plan({ repo, root: ROOT, commit: COMMIT }).rows.find(row => row.id === 'programme-sweep').state, 'outdated');
  // The CI workflow named on install is kept by a later refresh without the option.
  fs.writeFileSync(path.join(repo, '.github/workflows/ci.yml'), 'name: CI\non: push\n');
  assert.equal(run(['--repo', repo, '--ci-workflow', 'ci.yml']), 0);
  assert.equal(run(['--repo', repo]), 0);
  assert.match(fs.readFileSync(path.join(repo, GATE.file), 'utf8'), /CI_WORKFLOW: ci\.yml/);
  assert.equal(run(['--repo', repo, '--check']), 0);
  assert.equal(run(['--repo', repo, '--ci-workflow', 'missing.yml']), 2);
  assert.equal(run(['--repo', repo, '--ci-workflow', '../x.yml']), 2);
  // A same-named file that is not a Toolkit copy is never overwritten.
  fs.writeFileSync(sweepFile, 'name: Mine\non: push\n');
  assert.equal(run(['--repo', repo]), 2);
  assert.equal(fs.readFileSync(sweepFile, 'utf8'), 'name: Mine\non: push\n');
  assert.match(err.text(), /not a Toolkit copy/);
});

test('cloud workflows: a Toolkit checkout, another default branch and an unpublished commit are refused', t => {
  const err = capture();
  assert.equal(workflows.main(['--repo', ROOT], { out: capture(), err, root: ROOT, commit: COMMIT }), 2);
  assert.match(err.text(), /Toolkit source checkout/);
  const repo = tempRepo(t);
  git(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
  assert.throws(() => workflows.plan({ repo, root: ROOT, commit: COMMIT }), /default branch is trunk/);
  // The pinned commit must be on origin/main of the Toolkit checkout.
  const toolkit = tempRepo(t);
  git(toolkit, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'one']);
  assert.throws(() => workflows.toolkitCommit(toolkit), /not on origin\/main/);
  git(toolkit, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  assert.equal(workflows.toolkitCommit(toolkit), git(toolkit, ['rev-parse', 'HEAD']));
});

test('cloud workflows: governance check reports a missing or edited copy as drift and an older pin as a note', t => {
  const repo = tempRepo(t);
  const ids = () => conformance.cloudWorkflowFindings({ root: repo }, ROOT, { cloudWorkflowsCommit: COMMIT }).map(entry => `${entry.id}:${entry.severity}`);
  assert.deepEqual(ids(), ['CLOUD_WORKFLOW_DRIFT:drift', 'CLOUD_WORKFLOW_DRIFT:drift']);
  workflows.apply(workflows.plan({ repo, root: ROOT, commit: COMMIT }));
  assert.deepEqual(ids(), []);
  fs.writeFileSync(path.join(repo, SWEEP.file), workflows.render('programme-sweep', source(SWEEP.file), OTHER));
  assert.deepEqual(ids(), ['CLOUD_WORKFLOW_OUTDATED:info']);
  assert.deepEqual(conformance.cloudWorkflowFindings({ root: ROOT }, ROOT), [], 'the Toolkit runs its own files');
});

test('cloud workflows: the sweep action runs Toolkit code from its own checkout in the governed folder', () => {
  const seen = [];
  const spawn = (file, args, options) => { seen.push({ args, options }); return { status: 0, stdout: '{"results":[]}', stderr: '' }; };
  action.runRefresh({ root: '/work/governed', env: {}, spawn });
  action.runFooterSweep({ root: '/work/governed', env: {}, repository: 'o/r', token: 't', author: 'o', since: 'x', spawn });
  assert.equal(seen[0].args[0], path.join(action.TOOLKIT_ROOT, 'skills', 'github-program-reconciler', 'scripts', 'programme.cjs'));
  assert.equal(seen[1].args[0], path.join(action.TOOLKIT_ROOT, 'repo', 'scripts', 'toolkit-github-footer-sweep.cjs'));
  for (const call of seen) assert.equal(call.options.cwd, '/work/governed', 'the governed repository stays the working folder');
  assert.equal(action.TOOLKIT_ROOT, path.resolve(ROOT));
});

test('cloud workflows: the governance enable proposal carries the copies', () => {
  const text = fs.readFileSync(path.join(ROOT, 'repo/scripts/toolkit-governance-proposal.cjs'), 'utf8');
  assert.match(text, /require\('\.\/toolkit-cloud-workflows\.cjs'\)\.WORKFLOWS\.map\(workflow => workflow\.file\)/);
  assert.deepEqual(workflows.WORKFLOWS.map(row => row.file), ['.github/workflows/toolkit-programme-sweep.yml', '.github/workflows/toolkit-programme-sweep-gate.yml']);
});
