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

test('cloud workflows: the copies carry no header line that only holds in the Toolkit', () => {
  const copies = [
    workflows.render('programme-sweep', source(SWEEP.file), COMMIT),
    workflows.render('programme-sweep-gate', source(GATE.file), COMMIT),
    workflows.render('programme-sweep-gate', source(GATE.file), COMMIT, { file: 'ci.yml', name: 'CI' }),
  ];
  const wrong = [/a Validate run finishes/, /only its own script from main/, /`programme\.cjs refresh` from the commit it checked out/, /when an issue or pull request changed or a CI run finished/];
  for (const text of copies) for (const phrase of wrong) assert.doesNotMatch(text, phrase);
  assert.match(copies[1], /where the gate follows one/);
  assert.match(copies[0], /a governed\n# repository's copy checks the Toolkit out at a pinned commit/);
});

test('cloud workflows: a renamed or removed CI workflow leaves a faithful gate copy outdated, never edited', t => {
  const toolkit = toolkitHistory(t);
  for (const at of ['one', 'two']) {
    const repo = tempRepo(t);
    const ciFile = path.join(repo, '.github/workflows/ci.yml');
    const gateFile = path.join(repo, GATE.file);
    fs.mkdirSync(path.dirname(ciFile), { recursive: true });
    fs.writeFileSync(ciFile, 'name: CI\non: push\n');
    fs.writeFileSync(gateFile, workflows.render('programme-sweep-gate', source(GATE.file), toolkit[at], { file: 'ci.yml', name: 'CI' }));
    const state = () => workflows.plan({ repo, root: toolkit.dir, commit: toolkit.two }).rows.find(row => row.id === 'programme-sweep-gate').state;
    assert.equal(state(), at === 'two' ? 'current' : 'outdated', `${at}: faithful`);
    fs.writeFileSync(ciFile, 'name: Build\non: push\n');
    assert.equal(state(), 'outdated', `${at}: CI workflow renamed`);
    fs.rmSync(ciFile);
    assert.equal(state(), 'outdated', `${at}: CI workflow removed`);
    assert.deepEqual(conformance.cloudWorkflowFindings({ root: repo }, toolkit.dir, { cloudWorkflowsCommit: toolkit.two }).filter(entry => entry.severity === 'drift').map(entry => entry.message).filter(message => message.includes('gate')), [], `${at}: no drift`);
    // Broken CI lines are a hand edit, even with the hash recomputed.
    const text = fs.readFileSync(gateFile, 'utf8');
    const lines = text.split('\n');
    const body = lines.slice(1).join('\n').replace('    workflows: ["CI"]\n', '    workflows: [CI, Other]\n');
    const hash = require('node:crypto').createHash('sha256').update(body.replace(/^(\s+(?:- )?uses: [^@\s]+)@[^\n]*$/gm, '$1'), 'utf8').digest('hex').slice(0, 12);
    fs.writeFileSync(gateFile, `${lines[0].replace(/sha256=[0-9a-f]{12}/, `sha256=${hash}`)}\n${body}`);
    assert.equal(state(), 'edited', `${at}: broken CI lines`);
  }
});

// A throwaway Toolkit history: the real render file and workflow files at commit one, a workflow
// comment changed at commit two, and optionally the render file changed at commit three.
function toolkitHistory(t) {
  const dir = tempRepo(t);
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  const commit = message => { git(dir, ['add', '-A']); git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '--quiet', '-m', message]); return git(dir, ['rev-parse', 'HEAD']); };
  const RENDER = 'repo/scripts/toolkit-cloud-workflows-render.cjs';
  put(RENDER, source(RENDER));
  for (const row of workflows.WORKFLOWS) put(row.file, source(row.file));
  const one = commit('one');
  put(SWEEP.file, source(SWEEP.file).replace('# Toolkit Programme Sweep:', '# Toolkit Programme Sweep (two):'));
  const two = commit('two');
  put(RENDER, `${source(RENDER)}// changed\n`);
  const three = commit('three');
  return { dir, one, two, three };
}

test('cloud workflows: an older copy is re-rendered at its own commit, so an edit with a recomputed hash is drift', t => {
  const toolkit = toolkitHistory(t);
  const repo = tempRepo(t);
  const sweepFile = path.join(repo, SWEEP.file);
  const state = () => workflows.plan({ repo, root: toolkit.dir, commit: toolkit.two }).rows.find(row => row.id === 'programme-sweep').state;
  const older = workflows.render('programme-sweep', source(SWEEP.file), toolkit.one);
  fs.mkdirSync(path.dirname(sweepFile), { recursive: true });
  fs.writeFileSync(sweepFile, older);
  assert.equal(state(), 'outdated', 'a faithful older copy is only a note');
  fs.writeFileSync(sweepFile, older.replace(/actions\/setup-node@[0-9a-f]{40} # v[\d.]+/, `actions/setup-node@${'b'.repeat(40)} # v99.0.0`));
  assert.equal(state(), 'outdated', 'a Dependabot pin bump is still only a note');
  // An added step with the hash recomputed: the hash check alone cannot see it.
  const forge = text => {
    const lines = text.split('\n');
    const body = lines.slice(1).join('\n').replace('      - name: Set up Node\n', '      - name: Extra\n        run: echo hi\n\n      - name: Set up Node\n');
    const hash = require('node:crypto').createHash('sha256').update(body.replace(/^(\s+(?:- )?uses: [^@\s]+)@[^\n]*$/gm, '$1'), 'utf8').digest('hex').slice(0, 12);
    return `${lines[0].replace(/sha256=[0-9a-f]{12}/, `sha256=${hash}`)}\n${body}`;
  };
  fs.writeFileSync(sweepFile, forge(older));
  assert.equal(state(), 'edited', 'the re-render at the copy\'s own commit shows the added step');
  fs.writeFileSync(sweepFile, forge(workflows.render('programme-sweep', source(SWEEP.file), toolkit.two)));
  assert.equal(state(), 'edited', 'the same at the current commit');
  // When the re-render cannot be trusted or made, the hash check is all there is.
  const fallback = commit => workflows.plan({ repo, root: toolkit.dir, commit }).rows.find(row => row.id === 'programme-sweep').state;
  fs.writeFileSync(sweepFile, forge(workflows.render('programme-sweep', source(SWEEP.file), toolkit.one)));
  assert.equal(fallback(toolkit.three), 'edited', 'checked against commit one, whose render file matches the running one');
  fs.writeFileSync(sweepFile, forge(workflows.render('programme-sweep', source(SWEEP.file), toolkit.three)));
  assert.equal(workflows.plan({ repo, root: toolkit.dir, commit: toolkit.two }).rows.find(row => row.id === 'programme-sweep').state, 'outdated', 'the render file changed at that commit, so it is not re-rendered');
  fs.writeFileSync(sweepFile, forge(workflows.render('programme-sweep', source(SWEEP.file), OTHER)));
  assert.equal(state(), 'outdated', 'a commit this checkout does not have is not re-rendered');
  assert.deepEqual(conformance.cloudWorkflowFindings({ root: repo }, toolkit.dir, { cloudWorkflowsCommit: toolkit.two }).map(entry => entry.id).includes('CLOUD_WORKFLOW_OUTDATED'), true);
  fs.writeFileSync(sweepFile, forge(older));
  assert.ok(conformance.cloudWorkflowFindings({ root: repo }, toolkit.dir, { cloudWorkflowsCommit: toolkit.two }).some(entry => entry.id === 'CLOUD_WORKFLOW_DRIFT' && entry.severity === 'drift'), 'conformance reports it as drift');
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
  // A Dependabot bump of an action pin reads as an older copy, not a hand edit.
  workflows.apply(workflows.plan({ repo, root: ROOT, commit: COMMIT }));
  const bumped = fs.readFileSync(sweepFile, 'utf8').replace(/actions\/setup-node@[0-9a-f]{40} # v[\d.]+/, `actions/setup-node@${'b'.repeat(40)} # v99.0.0`);
  fs.writeFileSync(sweepFile, bumped);
  assert.equal(workflows.plan({ repo, root: ROOT, commit: COMMIT }).rows.find(row => row.id === 'programme-sweep').state, 'outdated');
  // A pin moved to a branch is a hand edit, even though the hash leaves pins out.
  fs.writeFileSync(sweepFile, bumped.replace(/actions\/create-github-app-token@[0-9a-f]{40} # v[\d.]+/, 'actions/create-github-app-token@main'));
  assert.equal(workflows.plan({ repo, root: ROOT, commit: COMMIT }).rows.find(row => row.id === 'programme-sweep').state, 'edited');
  // A hand edit of the Toolkit checkout with a recomputed hash is still an edit.
  const pinned = workflows.render('programme-sweep', source(SWEEP.file), COMMIT);
  const lines = pinned.split('\n');
  const forged = lines.slice(1).join('\n').replace(`ref: ${COMMIT}\n          path: .toolkit\n          persist-credentials: false\n\n`, `ref: ${OTHER}\n          path: .toolkit\n          persist-credentials: false\n\n`);
  const crypto = require('node:crypto');
  const hash = crypto.createHash('sha256').update(forged.replace(/^(\s+(?:- )?uses: [^@\s]+)@[^\n]*$/gm, '$1'), 'utf8').digest('hex').slice(0, 12);
  fs.writeFileSync(sweepFile, `${lines[0].replace(/sha256=[0-9a-f]{12}/, `sha256=${hash}`)}\n${forged}`);
  assert.equal(workflows.plan({ repo, root: ROOT, commit: COMMIT }).rows.find(row => row.id === 'programme-sweep').state, 'edited');
  // The CI workflow named on install is kept by a later refresh without the option.
  fs.writeFileSync(path.join(repo, '.github/workflows/ci.yml'), 'name: CI\non: push\n');
  assert.equal(run(['--repo', repo, '--ci-workflow', 'ci.yml']), 0);
  assert.equal(run(['--repo', repo]), 0);
  assert.match(fs.readFileSync(path.join(repo, GATE.file), 'utf8'), /CI_WORKFLOW: ci\.yml/);
  assert.equal(run(['--repo', repo, '--check']), 0);
  // Once that CI workflow is gone, a refresh drops the CI trigger instead of failing.
  fs.rmSync(path.join(repo, '.github/workflows/ci.yml'));
  assert.equal(run(['--repo', repo]), 0);
  assert.doesNotMatch(fs.readFileSync(path.join(repo, GATE.file), 'utf8'), /CI_WORKFLOW|workflow_run:/);
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
  // An older Toolkit branch, from before the installer, is recognised too.
  const older = tempRepo(t);
  fs.mkdirSync(path.join(older, 'repo', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(older, 'repo', 'scripts', 'toolkit-governance-conformance.cjs'), '');
  assert.equal(workflows.isToolkitCheckout(older), true);
  assert.deepEqual(conformance.cloudWorkflowFindings({ root: older }, ROOT, { cloudWorkflowsCommit: COMMIT }), []);
  const repo = tempRepo(t);
  git(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
  assert.throws(() => workflows.plan({ repo, root: ROOT, commit: COMMIT }), /default branch is trunk/);
  // The pinned commit must be on origin/main of the Toolkit checkout.
  const toolkit = tempRepo(t);
  git(toolkit, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'one']);
  git(toolkit, ['remote', 'add', 'origin', 'https://github.com/someone-else/ai-agent-toolkit.git']);
  assert.throws(() => workflows.toolkitCommit(toolkit), /origin is not weijunswj\/ai-agent-toolkit/, 'a fork\'s commit is never pinned');
  git(toolkit, ['remote', 'set-url', 'origin', 'https://github.com/weijunswj/ai-agent-toolkit.git']);
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

test('governance check names a governed repository the cloud sweep skips, with the fix, and never as drift', () => {
  let merged = null;
  const reach = () => conformance.cloudSweepReachFindings({ root: '/repo' }, { mergedBinding: root => { assert.equal(root, '/repo'); return merged; } });
  const ids = () => reach().map(entry => `${entry.id}:${entry.severity}`);
  assert.deepEqual(ids(), [], 'no merged binding, nothing to say');
  merged = { repository: 'acme/app', store: { repository: 'acme/evidence' } };
  assert.deepEqual(ids(), []);
  merged = { repository: 'acme/app', state: { branch: 'toolkit-state' } };
  assert.deepEqual(ids(), ['CLOUD_SWEEP_PUBLIC_STATE:info']);
  assert.match(reach()[0].message, /public branch[^]*toolkit store[^]*programme\.cjs refresh by hand/);
  merged = { repository: 'acme/app', store: { repository: 'someone/evidence' } };
  assert.deepEqual(ids(), ['CLOUD_SWEEP_FOREIGN_STORE:info']);
  assert.match(reach()[0].message, /someone\/evidence belongs to another owner/);
  // Toolkit no longer sweeps from a computer, so the sweep's own skip warnings never point to one.
  for (const status of ['public_state', 'foreign_store']) assert.doesNotMatch(action.skipWarning('acme/app', status), /computer/);
});
