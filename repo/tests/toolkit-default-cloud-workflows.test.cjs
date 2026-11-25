'use strict';

// The one default cloud workflow list (DEFAULT_CLOUD_WORKFLOWS): what turning governance on carries, what
// the governance check reports missing, and what a refresh adds, over the states a repository can be in
// (nothing there, one missing, all current, edited, outdated, a clashing file, unreadable, governance
// off). Every repository is a throwaway folder; nothing is written to GitHub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const workflows = require(path.join(ROOT, 'repo/scripts/toolkit-cloud-workflows.cjs'));
const conformance = require(path.join(ROOT, 'repo/scripts/toolkit-governance-conformance.cjs'));
const proposal = require(path.join(ROOT, 'repo/scripts/toolkit-governance-proposal.cjs'));
const governed = require(path.join(ROOT, 'repo/scripts/governed-test-shards.cjs'));
const guard = require(path.join(ROOT, 'skills/secure-ci-cd/scripts/personal-data-guard.cjs'));
const COMMIT = workflows.toolkitHead(ROOT);

const CHECK = '.github/workflows/personal-data-guard.yml', SWEEP = '.github/workflows/personal-data-sweep.yml', SCRIPT = '.github/scripts/personal-data-guard.cjs', CONFIG = '.github/personal-data-guard.json';
const GUARD_FILES = [CHECK, SWEEP, SCRIPT, CONFIG];
const AUTO_MERGE = '.github/workflows/dependency-auto-merge.yml';
// Every file a governed repository with a usable shard list carries, spelt out so the list in the code
// cannot drop one unnoticed.
const EXPECTED = {
  'programme-sweep': ['.github/workflows/toolkit-programme-sweep.yml'],
  'programme-sweep-gate': ['.github/workflows/toolkit-programme-sweep-gate.yml'],
  'personal-data-guard': GUARD_FILES,
  'dependency-auto-merge': [AUTO_MERGE],
  'test-shards': ['.github/workflows/toolkit-test-shards.yml'],
  'shard-timings': ['.github/workflows/toolkit-shard-timings.yml'],
};
const SHARD_LIST = { schema: governed.MANIFEST_SCHEMA, systems: { linux: { command: ['node', '--test', '{files}'], discover: 'tests/*.test.js', shards: [{ id: 'linux-1', files: ['tests/a.test.js'] }, { id: 'linux-2', rest: true }] } } };

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function put(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

const read = (dir, file) => fs.readFileSync(path.join(dir, ...file.split('/')), 'utf8');

// A repository with a usable shard list. `installed` writes every default workflow, as a merged turn-on
// pull request leaves them.
function repository(t, { installed = false, shards = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'default-cloud-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '--quiet', '-b', 'main']);
  if (shards) {
    put(dir, governed.MANIFEST_REL, JSON.stringify(SHARD_LIST));
    for (const name of ['a', 'b']) put(dir, `tests/${name}.test.js`, '');
  }
  if (installed) for (const [file, text] of Object.entries(turnOn(dir).files)) put(dir, file, text);
  return dir;
}

// What a turn-on pull request from this Toolkit commit carries here.
const turnOn = (dir, ciShards = 'yes') => proposal.cloudWorkflowFiles(dir, { root: ROOT, commit: COMMIT, ciShards });
const plan = dir => workflows.plan({ repo: dir, root: ROOT, commit: COMMIT, ciShards: 'yes' });
const YES = () => ({ ci_shards: { answer: 'yes' }, required_checks: ['Toolkit test shards'] });
const findings = dir => conformance.cloudWorkflowFindings({ root: dir }, ROOT, { cloudWorkflowsCommit: COMMIT, mergedBinding: YES });
const drift = dir => findings(dir).filter(entry => entry.severity === 'drift').map(entry => entry.message);

test('the one list names every Toolkit cloud workflow, and turn-on, check and refresh read only it', t => {
  assert.deepEqual(workflows.DEFAULT_CLOUD_WORKFLOWS.map(row => row.id), Object.keys(EXPECTED));
  assert.deepEqual([...workflows.DEFAULT_FILES].sort(), Object.values(EXPECTED).flat().sort());
  for (const name of ['WORKFLOWS', 'SHARD_WORKFLOWS']) assert.equal(workflows[name], undefined, `${name} is gone`);
  const dir = repository(t);
  assert.deepEqual(Object.keys(turnOn(dir).files).sort(), Object.values(EXPECTED).flat().sort());
  assert.deepEqual([...new Set(plan(dir).rows.map(row => row.id))], Object.keys(EXPECTED));
  // A cloud workflow added to the Toolkit later joins the list, unless it only serves the Toolkit itself.
  const listed = workflows.DEFAULT_CLOUD_WORKFLOWS.map(row => path.basename(row.file)), toolkitOnly = ['toolkit-rebump.yml'];
  for (const name of fs.readdirSync(path.join(ROOT, '.github/workflows')).filter(file => file.startsWith('toolkit-') && !toolkitOnly.includes(file))) assert.ok(listed.includes(name), `${name} is not a default cloud workflow`);
});

// Red on the parent: the check was silent for the guard and for dependency auto-merge.
test('a governed repository missing any one default workflow file is told about that file', t => {
  const dir = repository(t, { installed: true });
  assert.deepEqual(drift(dir), [], 'all current: clean');
  for (const [id, files] of Object.entries(EXPECTED)) {
    for (const file of files) {
      const text = read(dir, file);
      fs.rmSync(path.join(dir, ...file.split('/')));
      const found = drift(dir);
      assert.equal(found.length, 1, `${id} ${file}: ${found.join(' | ')}`);
      assert.ok(found[0].startsWith(`${file} is missing, so `), found[0]);
      assert.match(found[0], /Refresh the repository rules to fix it\.$/);
      put(dir, file, text);
    }
  }
  assert.deepEqual(drift(dir), []);
});

// Red on the parent: the turn-on carried the guard only where its files already existed, and its settings
// needed an owner's choice about commit author addresses.
test('a turn-on in a repository with no guard files carries its workflow, script and settings, and no hooks', t => {
  const dir = repository(t, { shards: false });
  const before = fs.readdirSync(path.join(dir, '.git', 'hooks')).sort();
  const carried = turnOn(dir, null);
  assert.equal(carried.warning, null);
  assert.deepEqual(carried.notes, []);
  assert.deepEqual(carried.added, ['programme-sweep', 'programme-sweep-gate', 'personal-data-guard', 'dependency-auto-merge']);
  for (const file of [...GUARD_FILES, AUTO_MERGE]) assert.equal(typeof carried.files[file], 'string', file);
  const config = JSON.parse(carried.files[CONFIG]);
  assert.deepEqual(config.scope, { file_content: true, paths: true, commit_messages: true, branch_names: true, pull_request_text: true });
  for (const key of Object.keys(config)) assert.doesNotMatch(key, /identity|author|committer/, 'no setting scans commit author or committer addresses');
  guard.validateConfig(config);
  assert.match(carried.files['.github/scripts/personal-data-guard.cjs'].split('\n')[1], /^\/\/ AI-AGENT-TOOLKIT:secure-ci-cd:VENDORED personal-data-guard guard=\d+ sha256=/);
  assert.match(carried.files['.github/workflows/personal-data-guard.yml'], /^# AI-AGENT-TOOLKIT:secure-ci-cd:WORKFLOW personal-data-guard sha256=/);
  assert.match(carried.files['.github/workflows/personal-data-guard.yml'], /run: node \.github\/scripts\/personal-data-guard\.cjs ci/);
  // No local hooks, and nothing is written to the working tree.
  assert.deepEqual(fs.readdirSync(path.join(dir, '.git', 'hooks')).sort(), before);
  assert.equal(git(dir, ['status', '--porcelain']), '');
});

test('the guard a turn-on carries passes on its own pull request, on a Dependabot sign-off and on a person\'s own commit identity', t => {
  const dir = repository(t, { shards: false });
  put(dir, 'README.md', 'App\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'Start']);
  const base = git(dir, ['rev-parse', 'HEAD']);
  for (const [file, text] of Object.entries(turnOn(dir, null).files)) put(dir, file, text);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'Prepare repository governance and checks']);
  const person = ['jane.tan', 'mailbox.sg'].join('@');
  const signed = `Bump a from 1 to 2\n\nSigned-off-by: dependabot[bot] <${['support', 'github.com'].join('@')}>`;
  git(dir, ['-c', 'user.name=Jane Tan', 'commit', '--quiet', '--allow-empty', `--author=Jane Tan <${person}>`, '-m', signed]);
  const run = spawnSync(process.execPath, [path.join(dir, '.github', 'scripts', 'personal-data-guard.cjs'), 'range', `${base}..HEAD`, '--repo', dir], { cwd: dir, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /Author, committer and tagger addresses: never scanned\./);
  assert.ok(!`${run.stdout}${run.stderr}`.includes(person));
});

test('idempotent: a turn-on or an install where everything is current changes nothing, and an owner\'s settings are never rewritten', t => {
  const dir = repository(t, { installed: true });
  const own = { ...JSON.parse(read(dir, '.github/personal-data-guard.json')), not_scanned: [{ path: '*.png', reason: 'artwork without people' }] };
  put(dir, '.github/personal-data-guard.json', JSON.stringify(own));
  assert.equal(plan(dir).rows.every(row => row.state === 'current'), true);
  assert.deepEqual(turnOn(dir).added, []);
  assert.equal(turnOn(dir).files['.github/personal-data-guard.json'], undefined, 'kept as it is');
  const before = Object.values(EXPECTED).flat().map(file => read(dir, file));
  assert.equal(workflows.apply(plan(dir)).rows.filter(row => row.written).length, 0);
  assert.deepEqual(Object.values(EXPECTED).flat().map(file => read(dir, file)), before);
  assert.deepEqual(drift(dir), []);
});

test('a guard config that still holds the retired identity setting loses it only with the script that stopped reading it', t => {
  const installer = require(path.join(ROOT, 'skills/secure-ci-cd/scripts/install-personal-data-guard.cjs'));
  const dir = repository(t, { installed: true });
  const own = { ...JSON.parse(read(dir, CONFIG)), not_scanned: [{ path: '*.png', reason: 'artwork without people' }] };
  const older = installer.vendoredText('#!/usr/bin/env node\n// older\n'), script = read(dir, SCRIPT);
  for (const extra of [{ identity: 'excluded', identity_reason: 'the owner said so' }, { identity: 'included' }, { identity: 42 }]) {
    // With an older script: both change in the one refresh, and the rest of the config stays.
    put(dir, CONFIG, `${JSON.stringify({ ...own, ...extra }, null, 2)}\n`);
    put(dir, SCRIPT, older);
    assert.deepEqual(workflows.apply(plan(dir)).rows.filter(row => row.written).map(row => row.file), [SCRIPT, CONFIG]);
    assert.deepEqual(JSON.parse(read(dir, CONFIG)), own);
    assert.equal(read(dir, SCRIPT), script);
    assert.deepEqual(findings(dir), []);
    // With the current script: the setting alone, noted and never drift.
    put(dir, CONFIG, JSON.stringify({ ...own, ...extra }));
    assert.deepEqual(findings(dir).map(entry => [entry.severity, entry.message.startsWith(`${CONFIG} holds a setting no guard reads any more`)]), [['info', true]]);
    // A script Toolkit did not write may still read it, so the config waits with it.
    put(dir, SCRIPT, '// my own script\n');
    const text = read(dir, CONFIG);
    assert.equal(workflows.apply(plan(dir)).rows.some(row => row.written), false);
    assert.equal(turnOn(dir).files[CONFIG], undefined);
    assert.equal(read(dir, CONFIG), text);
    put(dir, SCRIPT, script);
  }
  // A config that is not JSON is left to its owner.
  put(dir, CONFIG, 'not json');
  assert.equal(plan(dir).rows.some(row => row.file === CONFIG), false);
});

test('partial and drifted repositories: what is missing is added, an edited or older copy is brought back, and the rest stays', t => {
  const installer = require(path.join(ROOT, 'skills/secure-ci-cd/scripts/install-personal-data-guard.cjs'));
  const cases = [
    ['edited workflow', dir => fs.appendFileSync(path.join(dir, CHECK), '# mine\n'), CHECK, 'edited', 'drift'],
    ['edited script', dir => fs.appendFileSync(path.join(dir, SCRIPT), '// mine\n'), SCRIPT, 'edited', 'drift'],
    ['older workflow', dir => put(dir, CHECK, installer.workflowText('personal-data-guard', 'name: Personal data guard\non: push\n')), CHECK, 'outdated', 'info'],
    ['older script', dir => put(dir, SCRIPT, installer.vendoredText('#!/usr/bin/env node\n// older\n')), SCRIPT, 'outdated', 'info'],
    ['a Dependabot pin bump', dir => put(dir, CHECK, read(dir, CHECK).replace(/actions\/checkout@[0-9a-f]{40} # v[\d.]+/, `actions/checkout@${'b'.repeat(40)} # v99.0.0`)), CHECK, 'outdated', 'info'],
    ['edited sweep', dir => fs.appendFileSync(path.join(dir, SWEEP), '# mine\n'), SWEEP, 'edited', 'drift'],
    ['older auto-merge', dir => put(dir, AUTO_MERGE, `${read(dir, AUTO_MERGE).split('\n')[0]}\nname: Dependency auto-merge\n`), AUTO_MERGE, 'outdated', 'info'],
    ['script without its workflow', dir => fs.rmSync(path.join(dir, CHECK)), CHECK, 'missing', 'drift'],
  ];
  // Each case ends with every file as a turn-on left it, so one repository serves them all.
  const dir = repository(t, { installed: true });
  const installed = Object.values(EXPECTED).flat().map(file => read(dir, file));
  for (const [name, change, file, state, severity] of cases) {
    change(dir);
    const found = findings(dir);
    assert.deepEqual(found.map(entry => entry.severity), [severity], `${name}: ${found.map(entry => entry.message).join(' | ')}`);
    assert.ok(found[0].message.startsWith(file), name);
    const rows = plan(dir);
    assert.equal(rows.rows.find(row => row.file === file).state, state, name);
    assert.deepEqual(workflows.apply(rows).rows.filter(row => row.written).map(row => row.file), [file], `${name}: only that file`);
    assert.deepEqual(Object.values(EXPECTED).flat().map(entry => read(dir, entry)), installed, `${name}: as a turn-on left it`);
  }
});

test('conflicting repositories: a file Toolkit did not write is never overwritten, its workflow is left out whole, and the rest is still installed', t => {
  const mine = 'name: Mine\non: push\n';
  const cases = [
    ['the guard workflow path', dir => put(dir, CHECK, mine), CHECK, 'personal-data-guard'],
    ['the sweep workflow path', dir => put(dir, SWEEP, mine), SWEEP, 'personal-data-guard'],
    ['the check\'s text in the sweep\'s place', dir => put(dir, SWEEP, require(path.join(ROOT, 'skills/secure-ci-cd/scripts/install-personal-data-guard.cjs')).workflowText('personal-data-guard')), SWEEP, 'personal-data-guard'],
    ['the guard script path', dir => put(dir, SCRIPT, '// my own script\n'), SCRIPT, 'personal-data-guard'],
    ['the auto-merge path', dir => put(dir, AUTO_MERGE, mine), AUTO_MERGE, 'dependency-auto-merge'],
    ['a folder in the settings file\'s place', dir => fs.mkdirSync(path.join(dir, CONFIG), { recursive: true }), CONFIG, 'personal-data-guard'],
  ];
  for (const [name, change, file, id] of cases) {
    const dir = repository(t);
    change(dir);
    const kept = fs.lstatSync(path.join(dir, file)).isFile() ? read(dir, file) : null;
    const carried = turnOn(dir);
    const left = new Set(EXPECTED[id]);
    assert.deepEqual(Object.keys(carried.files).sort(), Object.values(EXPECTED).flat().filter(entry => !left.has(entry)).sort(), name);
    assert.equal(carried.added.includes(id), false, name);
    assert.equal(carried.notes.length, 1, name);
    assert.match(carried.notes[0], new RegExp(`^${file.replace(/[.]/g, '\\.')} is not a Toolkit copy, so it is left as it is and the default ${id} workflow is not added around it`));
    workflows.apply(plan(dir));
    for (const other of EXPECTED[id].filter(entry => entry !== file)) assert.equal(fs.existsSync(path.join(dir, other)), false, `${name}: ${other} is not added beside it`);
    if (kept !== null) assert.equal(read(dir, file), kept, name);
    const found = drift(dir);
    assert.equal(found.length, 1, `${name}: ${found.join(' | ')}`);
    assert.match(found[0], /is not a Toolkit copy, so .*\. Move it aside in a pull request, then refresh the repository rules\.$/);
  }
});

test('a default branch other than main: the turn-on carries the guard and dependency auto-merge and says the sweep is left out', t => {
  const dir = repository(t);
  git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
  const carried = turnOn(dir);
  assert.equal(carried.warning, null);
  assert.deepEqual(Object.keys(carried.files).sort(), [...GUARD_FILES, AUTO_MERGE].sort());
  assert.deepEqual(carried.notes, ['The cloud sweep and its gate are left out: the default branch is trunk; the cloud sweep runs only on a main branch.']);
});

test('a link in a default workflow\'s place is never written through', { skip: process.platform === 'win32' && 'links need a Windows setting' }, t => {
  const dir = repository(t);
  const outside = path.join(dir, 'outside.yml');
  fs.writeFileSync(outside, 'mine\n');
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, CHECK));
  workflows.apply(plan(dir));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'mine\n');
  assert.equal(fs.existsSync(path.join(dir, SCRIPT)), false);
});

test('owner choices: governance off reports no missing workflow and its pull request leaves the guard alone; shards on never are left out, not drift', t => {
  const dir = repository(t, { installed: true });
  // The pull request that turns governance off removes only marked cloud copies, so neither copied
  // workflow is one of them.
  for (const file of [...GUARD_FILES, AUTO_MERGE]) {
    assert.equal(workflows.copyIdAt(file, read(dir, file)), null, file);
    assert.equal(workflows.markedCopies(dir).some(copy => copy.file === file), false, file);
  }
  const off = { state: 'DISABLED', root: dir };
  assert.deepEqual(conformance.cloudSweepReachFindings(off, { mergedBinding: () => null }), []);
  const bare = repository(t);
  const never = conformance.cloudWorkflowFindings({ root: bare }, ROOT, { cloudWorkflowsCommit: COMMIT, mergedBinding: () => ({ ci_shards: { answer: 'never' } }) });
  assert.deepEqual(never.filter(entry => /shard/i.test(entry.message)), []);
  assert.ok(never.some(entry => entry.message.startsWith(CHECK)));
});

test('unreadable: a Toolkit checkout that cannot give the copies carries none, says why, and claims nothing added', t => {
  const dir = repository(t);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'default-cloud-empty-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  git(empty, ['init', '--quiet', '-b', 'main']);
  git(empty, ['commit', '--quiet', '--allow-empty', '-m', 'one']);
  const carried = proposal.cloudWorkflowFiles(dir, { root: empty, commit: git(empty, ['rev-parse', 'HEAD']) });
  assert.deepEqual(carried.files, {});
  assert.equal(carried.added, undefined);
  assert.match(carried.warning, /the cloud workflow copies were not refreshed in this pull request \(.* is missing at Toolkit commit /);
  const found = conformance.cloudWorkflowFindings({ root: dir }, empty, { toolkitRoot: empty, cloudWorkflowsCommit: git(empty, ['rev-parse', 'HEAD']), mergedBinding: YES });
  assert.deepEqual(found.map(entry => `${entry.id}:${entry.severity}`), ['CLOUD_WORKFLOWS_UNCHECKED:info']);
});
