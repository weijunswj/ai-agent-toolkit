'use strict';

// The test shards workflow and Shard Timings copies a governed repository with a shard list carries:
// the render from the Toolkit's template and workflow, copying only where a usable list exists, and
// drift when the list's shards change or a copy is edited by hand.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const workflows = require(path.join(ROOT, 'repo/scripts/toolkit-cloud-workflows.cjs'));
const conformance = require(path.join(ROOT, 'repo/scripts/toolkit-governance-conformance.cjs'));
const governed = require(path.join(ROOT, 'repo/scripts/governed-test-shards.cjs'));
const COMMIT = workflows.toolkitHead(ROOT);
const OTHER = 'a'.repeat(40);
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const SHARDS = workflows.SHARD_WORKFLOWS.find(row => row.id === 'test-shards');
const TIMINGS = workflows.SHARD_WORKFLOWS.find(row => row.id === 'shard-timings');
const BOTH = { systems: { linux: ['linux-1', 'linux-2'], windows: ['windows-1', 'windows-2', 'windows-3'] } };

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function tempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-shards-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '--quiet']);
  return dir;
}

const put = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };

function list(shards = [{ id: 'linux-1', files: ['tests/a.test.js'] }, { id: 'linux-2', rest: true }], extra = {}) {
  return { schema: governed.MANIFEST_SCHEMA, systems: { linux: { command: ['node', '--test', '{files}'], discover: 'tests/*.test.js', shards } }, ...extra };
}

function governedRepo(t, manifest = list()) {
  const repo = tempRepo(t);
  put(repo, 'tests/a.test.js', 'x\n');
  put(repo, 'tests/b.test.js', 'x\n');
  put(repo, 'tests/c.test.js', 'x\n');
  if (manifest) put(repo, governed.MANIFEST_REL, JSON.stringify(manifest, null, 2));
  return repo;
}

// Recomputes the header hash after a hand edit of the body, as a forger would.
function forge(text, edit) {
  const lines = text.split('\n');
  const body = edit(lines.slice(1).join('\n'));
  const hash = crypto.createHash('sha256').update(body.replace(/^(\s+(?:- )?uses: [^@\s]+)@[^\n]*$/gm, '$1'), 'utf8').digest('hex').slice(0, 12);
  return `${lines[0].replace(/sha256=[0-9a-f]{12}/, `sha256=${hash}`)}\n${body}`;
}

const rowState = (repo, id, commit = COMMIT, root = ROOT) => workflows.plan({ repo, root, commit }).rows.find(row => row.id === id)?.state;

test('test shards copy: a job per system with the list\'s shard ids, the pinned Toolkit runner and the gate', () => {
  const text = workflows.render('test-shards', source(SHARDS.source), COMMIT, BOTH);
  assert.match(text, /^  linux:\n[^]*?^        shard: \["linux-1","linux-2"\]$/m);
  assert.match(text, /^  windows:\n[^]*?^        shard: \["windows-1","windows-2","windows-3"\]$/m);
  assert.match(text, /^  gate:\n    name: Toolkit test shards\n    needs: \[linux, windows\]\n    if: \$\{\{ !cancelled\(\) \}\}\n/m, 'the gate runs after every shard, also a failed one');
  for (const system of ['linux', 'windows']) {
    assert.ok(text.includes(`run: node .toolkit/repo/scripts/run-tests.cjs --repo-root . --shard \${{ matrix.shard }} --os ${system} --summary "\${{ runner.temp }}/summary/test-summary-\${{ matrix.shard }}-attempt-\${{ github.run_attempt }}.json"`), `${system} runs its shard through the Toolkit runner`);
  }
  // The same artifact name as Toolkit's own shards, uploaded even when the shard failed.
  const uploads = text.match(/- name: Upload test summary\n        if: \$\{\{ !cancelled\(\) \}\}\n[^\n]+\n        with:\n          name: test-summary-\$\{\{ matrix\.shard \}\}-attempt-\$\{\{ github\.run_attempt \}\}-\$\{\{ github\.sha \}\}\n/g) || [];
  assert.equal(uploads.length, 2);
  assert.ok(source('.github/workflows/validate.yml').includes('name: test-summary-${{ matrix.shard }}-attempt-${{ github.run_attempt }}-${{ github.sha }}'));
  assert.match(text, /pattern: test-summary-\*-\$\{\{ github\.sha \}\}\n/, 'the gate reads only this commit\'s summaries');
  assert.match(text, /run: node \.toolkit\/repo\/scripts\/run-tests\.cjs --repo-root \. --verify "\$RUNNER_TEMP\/test-summaries"\n/);
  assert.equal((text.match(new RegExp(`repository: weijunswj/ai-agent-toolkit\\n {10}ref: ${COMMIT}\\n {10}path: \\.toolkit\\n`, 'g')) || []).length, 3, 'every job checks the Toolkit out at the pinned commit');
  assert.doesNotMatch(text, /TOOLKIT_[A-Z]/, 'no placeholder is left');
});

test('test shards copy: least privilege, no secrets, no kept credentials, every action pinned to a Toolkit pin', () => {
  const text = workflows.render('test-shards', source(SHARDS.source), COMMIT, BOTH);
  assert.match(text, /^permissions:\n  contents: read\n\n/m);
  assert.doesNotMatch(text, /^ +permissions:/m, 'no job widens the token');
  assert.doesNotMatch(text, /secrets\.|github\.token|GH_TOKEN|pull_request_target|workflow_run/);
  const checkouts = text.match(/uses: actions\/checkout@[^\n]+\n        with:\n(?: {10}[^\n]+\n)+/g);
  assert.equal(checkouts.length, 6);
  for (const step of checkouts) assert.match(step, /persist-credentials: false/);
  // The template is not under .github/workflows, so Dependabot never bumps it: its pins must be ones
  // the Toolkit's own workflows use.
  const own = fs.readdirSync(path.join(ROOT, '.github/workflows')).map(name => source(`.github/workflows/${name}`)).join('\n');
  for (const [line, pin] of text.matchAll(/^\s+uses: (\S+@[0-9a-f]{40} # v[\d.]+)$/gm)) assert.ok(own.includes(`uses: ${pin}`), `${line.trim()} matches a pin the Toolkit's own workflows use`);
  assert.equal((text.match(/^\s+uses: /gm) || []).length, (text.match(/^\s+uses: \S+@[0-9a-f]{40} # v[\d.]+$/gm) || []).length, 'every action is pinned by commit');
});

test('test shards copy: a system the list does not name has no job, and bad shard ids stop the render', () => {
  const linux = workflows.render('test-shards', source(SHARDS.source), COMMIT, { systems: { linux: ['linux-1'] } });
  assert.doesNotMatch(linux, /^  windows:|--os windows/m);
  assert.match(linux, /    needs: \[linux\]\n/);
  const windows = workflows.render('test-shards', source(SHARDS.source), COMMIT, { systems: { windows: ['windows-1', 'windows-2'] } });
  assert.doesNotMatch(windows, /^  linux:|--os linux/m);
  assert.match(windows, /    needs: \[windows\]\n/);
  assert.equal((windows.match(/ref: [0-9a-f]{40}\n/g) || []).length, 2);
  for (const bad of [null, { systems: {} }, { systems: { linux: [] } }, { systems: { linux: ['windows-1'] } }, { systems: { linux: ['linux-1', 'linux-1'] } }, { systems: { mac: ['mac-1'] } }, { systems: { linux: ['linux-1"]'] } }]) {
    assert.throws(() => workflows.render('test-shards', source(SHARDS.source), COMMIT, bad), /shard ids/);
  }
  assert.throws(() => workflows.render('test-shards', source(SHARDS.source).replace('needs: [linux, windows]', 'needs: [linux]'), COMMIT, BOTH), /changed shape/);
});

test('shard timings copy: the Toolkit\'s own workflow, checking the Toolkit out and refreshing the repository\'s own list', () => {
  const original = source(TIMINGS.source);
  const text = workflows.render('shard-timings', original, COMMIT);
  assert.match(text, /- name: Check out this run's commit\n[^\n]+\n        with:\n          ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false\n\n      - name: Check out the Toolkit\n[^\n]+\n        with:\n          repository: weijunswj\/ai-agent-toolkit\n          ref: [0-9a-f]{40}\n          path: \.toolkit\n          persist-credentials: false\n/);
  assert.match(text, /node \.toolkit\/repo\/scripts\/refresh-shard-timings\.cjs --repo-root "\$GITHUB_WORKSPACE" --fail-if-due\n/);
  assert.match(text, /node \.toolkit\/repo\/scripts\/refresh-shard-timings\.cjs --repo-root "\$GITHUB_WORKSPACE" --open-pr\n/);
  assert.doesNotMatch(text, /node repo\/scripts\/|Validate run on main|^# shard manifest\./m, 'nothing that only holds in the Toolkit');
  assert.match(text, /\.github\/toolkit-test-shards\.json/);
  assert.equal((text.match(/secrets\./g) || []).length, (original.match(/secrets\./g) || []).length, 'no new secret use');
  assert.match(text, /actions\/workflows\/toolkit-shard-timings\.yml\/runs/, 'the due check reads the copy\'s own runs');
  assert.doesNotMatch(text.slice(text.indexOf('- name: Check out the Toolkit'), text.indexOf('- name: Set up Node')), /secrets\.|token/);
  assert.throws(() => workflows.render('shard-timings', original.replace('node repo/scripts/refresh-shard-timings.cjs --open-pr', 'echo'), COMMIT), /changed shape/);
});

test('cloud workflows: the shard copies go only to a repository with a usable shard list, with the reason otherwise', t => {
  const out = [];
  const run = (repo, argv = []) => workflows.main(['--repo', repo, ...argv], { out: { write: text => out.push(text) }, err: { write: text => out.push(text) }, root: ROOT, commit: COMMIT });
  const none = governedRepo(t, null);
  assert.equal(run(none), 0);
  assert.equal(fs.existsSync(path.join(none, SHARDS.file)), false);
  assert.equal(fs.existsSync(path.join(none, TIMINGS.file)), false);
  assert.match(out.join(''), /- test-shards: not copied, the repository has no shard list at \.github\/toolkit-test-shards\.json\.\n- shard-timings: not copied, the repository has no shard list/);
  // A list that does not validate copies nothing either, and says why.
  const broken = governedRepo(t, list([{ id: 'linux-1', files: ['tests/missing.test.js'] }, { id: 'linux-2', rest: true }]));
  const plan = workflows.plan({ repo: broken, root: ROOT, commit: COMMIT });
  assert.deepEqual(plan.rows.map(row => row.id), ['programme-sweep', 'programme-sweep-gate']);
  assert.match(plan.not_copied[0].reason, /^the shard list \.github\/toolkit-test-shards\.json is not usable \(linux-1: tests\/missing\.test\.js is not a file discover finds\)$/);
  // A usable list: both copies, current on --check.
  const good = governedRepo(t);
  out.length = 0;
  assert.equal(run(good), 0);
  assert.match(fs.readFileSync(path.join(good, SHARDS.file), 'utf8'), /^# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED test-shards toolkit=/);
  assert.match(fs.readFileSync(path.join(good, TIMINGS.file), 'utf8'), /^# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED shard-timings toolkit=/);
  assert.equal(run(good, ['--check']), 0);
  assert.doesNotMatch(out.join(''), /not copied/);
  // The list's own workflow name; a name another Toolkit copy uses is refused.
  const named = governedRepo(t, list(undefined, { workflow: 'shards.yml' }));
  assert.equal(run(named), 0);
  assert.ok(fs.existsSync(path.join(named, '.github/workflows/shards.yml')));
  const clash = governedRepo(t, list(undefined, { workflow: 'toolkit-shard-timings.yml' }));
  assert.match(workflows.plan({ repo: clash, root: ROOT, commit: COMMIT }).not_copied[0].reason, /names toolkit-shard-timings\.yml for its workflow, a file another Toolkit copy uses/);
  // The copied jobs set up Node only: a list whose command needs another runtime is refused by name,
  // never copied to fail on every file.
  for (const command of [['python', '-m', 'pytest', '{files}'], ['C:/Python312/python.exe', '{files}'], ['pytest', '{files}'], ['npx', 'jest', '{files}']]) {
    const pythonList = list(undefined);
    pythonList.systems.linux.command = command;
    const other = governedRepo(t, pythonList);
    const plan = workflows.plan({ repo: other, root: ROOT, commit: COMMIT });
    assert.deepEqual(plan.rows.map(row => row.id).filter(id => id === 'test-shards' || id === 'shard-timings'), [], command.join(' '));
    assert.equal(plan.not_copied.length, 2);
    assert.match(plan.not_copied[0].reason, /runs (python|pytest|npx), and the copied shard jobs set up Node only/);
    assert.equal(fs.existsSync(path.join(other, '.github/workflows/toolkit-test-shards.yml')), false);
  }
  const nodeExe = list(undefined);
  nodeExe.systems.linux.command = ['/usr/local/bin/node', '--test', '{files}'];
  assert.equal(workflows.plan({ repo: governedRepo(t, nodeExe), root: ROOT, commit: COMMIT }).not_copied.length, 0, 'node by any path is supported');
  // A list removed later leaves the copies alone and says so.
  fs.rmSync(path.join(good, governed.MANIFEST_REL));
  const after = workflows.plan({ repo: good, root: ROOT, commit: COMMIT });
  assert.equal(after.rows.length, 2);
  assert.match(after.not_copied.find(row => row.id === 'test-shards').reason, /the Toolkit copy at \.github\/workflows\/toolkit-test-shards\.yml is left as it was$/);
});

test('cloud workflows: a change to the list\'s shards makes the test shards copy outdated, a hand edit makes it edited', t => {
  const repo = governedRepo(t);
  workflows.apply(workflows.plan({ repo, root: ROOT, commit: COMMIT }));
  assert.equal(rowState(repo, 'test-shards'), 'current');
  const copy = path.join(repo, SHARDS.file);
  const installed = fs.readFileSync(copy, 'utf8');
  // The list gains a shard: the copy is behind, not tampered with.
  put(repo, governed.MANIFEST_REL, JSON.stringify(list([{ id: 'linux-1', files: ['tests/a.test.js'] }, { id: 'linux-2', files: ['tests/b.test.js'] }, { id: 'linux-3', rest: true }])));
  assert.equal(rowState(repo, 'test-shards'), 'outdated');
  assert.equal(rowState(repo, 'shard-timings'), 'current', 'Shard Timings does not follow the shard ids');
  // A hand edit with a recomputed hash is still found against the copy's own shard ids.
  fs.writeFileSync(copy, forge(installed, body => body.replace('    timeout-minutes: 60\n', '    timeout-minutes: 600\n')));
  assert.equal(rowState(repo, 'test-shards'), 'edited');
  // Broken matrix lines are a hand edit too.
  fs.writeFileSync(copy, forge(installed, body => body.replace('shard: ["linux-1","linux-2"]', 'shard: [linux-1, other]')));
  assert.equal(rowState(repo, 'test-shards'), 'edited');
  fs.writeFileSync(copy, forge(installed, body => body.replace('shard: ["linux-1","linux-2"]', 'shard: ["linux-1","windows-2"]')));
  assert.equal(rowState(repo, 'test-shards'), 'edited');
  // A refresh rewrites it to the new shard ids.
  workflows.apply(workflows.plan({ repo, root: ROOT, commit: COMMIT }));
  assert.match(fs.readFileSync(copy, 'utf8'), /shard: \["linux-1","linux-2","linux-3"\]/);
  assert.equal(rowState(repo, 'test-shards'), 'current');
  // An older Toolkit commit this checkout does not have: outdated.
  fs.writeFileSync(copy, workflows.render('test-shards', source(SHARDS.source), OTHER, { systems: { linux: ['linux-1', 'linux-2', 'linux-3'] } }));
  assert.equal(rowState(repo, 'test-shards'), 'outdated');
});

// A throwaway Toolkit history with the render file, the template and the workflows at commit one, and
// a template comment changed at commit two.
function toolkitHistory(t) {
  const dir = tempRepo(t);
  const commit = message => { git(dir, ['add', '-A']); git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '--quiet', '-m', message]); return git(dir, ['rev-parse', 'HEAD']); };
  for (const file of ['repo/scripts/toolkit-cloud-workflows-render.cjs', ...workflows.WORKFLOWS.map(row => row.file), ...workflows.SHARD_WORKFLOWS.map(row => row.source)]) put(dir, file, source(file));
  const one = commit('one');
  put(dir, SHARDS.source, source(SHARDS.source).replace('# Toolkit Test Shards:', '# Toolkit Test Shards (two):'));
  const two = commit('two');
  return { dir, one, two };
}

test('cloud workflows: an older test shards copy is re-rendered at its own commit with its own shard ids', t => {
  const toolkit = toolkitHistory(t);
  const repo = governedRepo(t);
  const copy = path.join(repo, SHARDS.file);
  const older = workflows.render('test-shards', source(SHARDS.source), toolkit.one, { systems: { linux: ['linux-1', 'linux-2', 'linux-9'] } });
  put(repo, SHARDS.file, older);
  assert.equal(rowState(repo, 'test-shards', toolkit.two, toolkit.dir), 'outdated', 'older commit and other shard ids, faithful');
  fs.writeFileSync(copy, forge(older, body => body.replace('    timeout-minutes: 10\n', '    timeout-minutes: 11\n')));
  assert.equal(rowState(repo, 'test-shards', toolkit.two, toolkit.dir), 'edited');
});

test('governance check: the shard copies flow through as drift and as outdated notes, with their own consequence', t => {
  const repo = governedRepo(t);
  const findings = () => conformance.cloudWorkflowFindings({ root: repo }, ROOT, { cloudWorkflowsCommit: COMMIT });
  const ids = () => findings().map(entry => `${entry.id}:${entry.severity}`);
  assert.deepEqual(ids(), Array(4).fill('CLOUD_WORKFLOW_DRIFT:drift'), 'all four copies are missing');
  assert.match(findings()[2].message, /toolkit-test-shards\.yml is missing, so this repository's Toolkit test shards and their gate do not run as the Toolkit wrote them/);
  assert.match(findings()[3].message, /toolkit-shard-timings\.yml is missing, so this repository's test shard timings are not refreshed/);
  assert.match(findings()[0].message, /programme board gets no cloud sweep/);
  workflows.apply(workflows.plan({ repo, root: ROOT, commit: COMMIT }));
  assert.deepEqual(ids(), []);
  put(repo, governed.MANIFEST_REL, JSON.stringify(list([{ id: 'linux-1', files: ['tests/a.test.js'] }, { id: 'linux-3', rest: true }])));
  assert.deepEqual(ids(), ['CLOUD_WORKFLOW_OUTDATED:info']);
  assert.match(findings()[0].message, /the shard list's shards/);
  fs.appendFileSync(path.join(repo, TIMINGS.file), '# local edit\n');
  assert.deepEqual(ids(), ['CLOUD_WORKFLOW_OUTDATED:info', 'CLOUD_WORKFLOW_DRIFT:drift']);
  // Without a list, nothing is copied and nothing is reported missing.
  const bare = governedRepo(t, null);
  assert.deepEqual(conformance.cloudWorkflowFindings({ root: bare }, ROOT, { cloudWorkflowsCommit: COMMIT }).map(entry => entry.message).filter(message => /shard/.test(message)), []);
});

test('governance enable proposal carries the shard copies only where the list exists', t => {
  const proposal = require(path.join(ROOT, 'repo/scripts/toolkit-governance-proposal.cjs'));
  const withList = proposal.cloudWorkflowFiles(governedRepo(t), { root: ROOT, commit: COMMIT });
  assert.deepEqual(Object.keys(withList.files).sort(), [...workflows.WORKFLOWS.map(row => row.file), SHARDS.file, TIMINGS.file].sort());
  const without = proposal.cloudWorkflowFiles(governedRepo(t, null), { root: ROOT, commit: COMMIT });
  assert.deepEqual(Object.keys(without.files).sort(), workflows.WORKFLOWS.map(row => row.file).sort());
});
