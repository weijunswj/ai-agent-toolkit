'use strict';

// `toolkit governance`: decisions are written only after a typed yes at a terminal and
// read back; `check` is read-only with exit codes 0, 1 and 2; the skill catalogue is computed
// per state and fails on drift. Closure rows H-06 and H-07 (unit parts), K-01, C-01, C-02, S-10
// (for the new modules).

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = path.join(repoRoot, 'repo', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const conformance = require(path.join(scripts, 'toolkit-governance-conformance.cjs'));
const catalogue = require(path.join(scripts, 'toolkit-governance-catalogue.cjs'));
const managedBlock = require(path.join(scripts, 'toolkit-managed-block.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const repoState = require(path.join(scripts, 'toolkit-governance-repo-state.cjs'));

const REMOTE = 'https://github.com/example-owner/example-repo.git';

function git(cwd, args) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, registryPath: path.join(root, 'state', 'repository-governance.v1.json') };
}

function gitRepo(ctx, name, remote = REMOTE) {
  const repo = path.join(ctx.root, name);
  fs.mkdirSync(repo, { recursive: true });
  git(ctx.root, ['init', '--quiet', repo]);
  if (remote !== null) git(repo, ['remote', 'add', 'origin', remote]);
  return repo;
}

function sink() {
  const chunks = [];
  return { write: (text) => { chunks.push(String(text)); return true; }, text: () => chunks.join('') };
}

const PROTECTED = () => ({ ok: true, rulesets: [{ enforcement: 'active', target: 'branch', conditions: { ref_name: { include: ['~ALL'], exclude: [] } }, rules: [{ type: 'non_fast_forward' }], bypass_actors: [] }] });

async function run(ctx, cwd, argv, { answer = 'yes', interactive = true, rulesetReader = PROTECTED } = {}) {
  const stdout = sink();
  const stderr = sink();
  const asked = [];
  const cli = new ToolkitGovernanceCli({
    stdout, stderr, cwd, interactive,
    ask: async (question) => { asked.push(question); return answer; },
    registryOptions: { registryPath: ctx.registryPath, testOnly: true },
    rulesetReader,
  });
  const code = await cli.main(argv);
  return { code, stdout: stdout.text(), stderr: stderr.text(), asked };
}

function expectedBlockText(version) {
  const expected = conformance.expectedGovernedBlock();
  return managedBlock.renderBlock({ ...expected, version: version || expected.version });
}

function writeGoverned(repo, { blockText = expectedBlockText(), binding = true } = {}) {
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), `# Repo\n\n${blockText}\n`);
  if (binding) {
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify({
      schema: 'toolkit.programme-binding.v1', repository: 'example-owner/example-repo', parent_issue: 7,
      record_prefix: 'INT-EX', writer_prefix: 'EX',
      store: { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/' },
      required_checks: ['validate'],
    }));
  }
}

// Every file under `dir` with its content digest, to prove a command wrote nothing.
function treeDigest(dir) {
  const out = {};
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

test('H-07 (unit): without a terminal nothing is recorded', async (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  for (const command of ['enable', 'disable', 'decline']) {
    const result = await run(ctx, repo, [command], { interactive: false });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Nothing was written: .*ask the user in chat instead: "Enable Toolkit's automated GitHub tracking governance for this repository\?.*run this in your own terminal/);
    assert.equal(result.asked.length, 0);
  }
  assert.equal(fs.existsSync(ctx.registryPath), false);
});

test('H-06 (unit): anything but yes writes nothing and keeps the repository UNDECIDED', async (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  for (const answer of ['', 'y', 'enable', 'no', 'yes please']) {
    const result = await run(ctx, repo, ['disable'], { answer });
    assert.equal(result.code, 1, JSON.stringify(answer));
    assert.match(result.stdout, /Nothing was written/);
  }
  assert.equal(fs.existsSync(ctx.registryPath), false);
  const status = await run(ctx, repo, ['status', '--json']);
  assert.equal(JSON.parse(status.stdout).state, 'UNDECIDED');
});

test('enable and disable: confirmed, written, read back; repeats write nothing; decline is an alias', async (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const disabled = await run(ctx, repo, ['disable']);
  assert.equal(disabled.code, 0, disabled.stderr);
  assert.match(disabled.asked[0], /Turn off Toolkit's GitHub governance for .*\nThe global rules and coding gates still apply here/);
  assert.match(disabled.stdout, /Recorded\. State: DISABLED/);
  const before = fs.readFileSync(ctx.registryPath);
  for (const command of ['disable', 'decline']) {
    const again = await run(ctx, repo, [command]);
    assert.match(again.stdout, /Already disabled/, command);
  }
  assert.deepEqual(fs.readFileSync(ctx.registryPath), before);
  const reopen = await run(ctx, repo, ['reopen']);
  assert.match(reopen.stdout, /^Nothing changed\. /);
  assert.match(reopen.stdout, /run `node "[^`]*toolkit-governance\.cjs" enable`/);
  assert.deepEqual(fs.readFileSync(ctx.registryPath), before, 'reopen writes nothing');

  const enabled = await run(ctx, repo, ['enable', '--json']);
  assert.equal(enabled.code, 0, enabled.stderr);
  const enabledState = JSON.parse(enabled.stdout);
  assert.deepEqual([enabledState.state, enabledState.rule, enabledState.materials_complete], ['ENABLED', 'R5', false]);
  // The older word still works: declining an enabled repository records a disable.
  const off = await run(ctx, repo, ['decline', '--json']);
  assert.equal(JSON.parse(off.stdout).reason, 'user-disabled');
});

test('not on github.com: enable refuses, disable records the ok and reads back DISABLED; a plain folder has nothing to decide', async (t) => {
  const ctx = scratch(t);
  for (const [name, remote] of [['no-origin', null], ['gitlab', 'https://gitlab.com/example-owner/example-repo.git']]) {
    const repo = gitRepo(ctx, name, remote);
    const status = JSON.parse((await run(ctx, repo, ['status', '--json'])).stdout);
    assert.deepEqual([status.state, status.rule], ['UNDECIDED', 'R9'], name);
    assert.match((await run(ctx, repo, ['status'])).stdout, /works only for github\.com repositories, so it will be DISABLED here once you say ok/);
    const enable = await run(ctx, repo, ['enable']);
    assert.equal(enable.code, 2, name);
    assert.match(enable.stderr, /cannot be enabled here\. Nothing was written\./);
    assert.equal(enable.asked.length, 0);
    const headless = await run(ctx, repo, ['disable'], { interactive: false });
    assert.equal(headless.code, 2);
    assert.match(headless.stderr, /ask the user in chat instead: "Reply ok to turn GitHub governance off for this repository\."/);
    const declined = await run(ctx, repo, ['disable'], { answer: 'no' });
    assert.equal(declined.code, 1);
    const disabled = await run(ctx, repo, ['disable']);
    assert.equal(disabled.code, 0, disabled.stderr);
    assert.match(disabled.asked[0], /Turn off Toolkit's GitHub governance for .*\nIt works only for github\.com repositories/);
    assert.match(disabled.stdout, /Recorded\. State: DISABLED/);
    assert.equal(JSON.parse((await run(ctx, repo, ['status', '--json'])).stdout).rule, 'R8');
    assert.equal(JSON.parse(fs.readFileSync(repoState.filePath(repo), 'utf8')).basis, 'not on github.com');
    const again = await run(ctx, repo, ['disable']);
    assert.equal(again.code, 0);
    assert.match(again.stdout, /Already disabled/);
  }
  assert.equal(fs.existsSync(ctx.registryPath), false, 'the registry only holds github.com decisions');
  const plain = path.join(ctx.root, 'plain-folder');
  fs.mkdirSync(plain);
  if (governance.findGitRoot(plain) === null) {
    const result = await run(ctx, plain, ['enable']);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /not inside a git repository, so GitHub governance is DISABLED automatically/);
  }
});

test('K-01: check exit codes and read-only behaviour', async (t) => {
  const ctx = scratch(t);
  const conformant = gitRepo(ctx, 'conformant');
  writeGoverned(conformant);
  const stale = gitRepo(ctx, 'stale');
  writeGoverned(stale, { blockText: expectedBlockText('0.0.1') });
  const edited = gitRepo(ctx, 'edited');
  writeGoverned(edited, { blockText: expectedBlockText().replace(/\n([^\n]+)\n(<!-- AI-AGENT-TOOLKIT:[^\n]*:END)/, '\n$1 (edited)\n$2') });
  const incomplete = gitRepo(ctx, 'incomplete');
  writeGoverned(incomplete, { binding: false });
  const plain = gitRepo(ctx, 'plain');

  const snapshot = treeDigest(ctx.root);
  const codes = {};
  for (const [name, repo] of Object.entries({ conformant, stale, edited, incomplete, plain })) {
    const result = await run(ctx, repo, ['check', '--json']);
    const parsed = JSON.parse(result.stdout);
    codes[name] = [result.code, parsed.status, parsed.findings.map(entry => entry.id).sort().join(',')];
  }
  assert.deepEqual(codes, {
    conformant: [0, 'conformant', ''],
    stale: [1, 'drift', 'GOVERNED_BLOCK_STALE'],
    edited: [1, 'drift', 'GOVERNED_BLOCK_EDITED'],
    incomplete: [1, 'drift', 'DECISION_PENDING'],
    plain: [1, 'drift', 'DECISION_PENDING'],
  });

  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, 'corrupt');
  const broken = await run(ctx, conformant, ['check', '--json']);
  assert.equal(broken.code, 2);
  assert.equal(JSON.parse(broken.stdout).status, 'error');
  fs.rmSync(path.dirname(ctx.registryPath), { recursive: true });
  assert.deepEqual(treeDigest(ctx.root), snapshot, 'check wrote nothing');

  // An ENABLED repository without the no-force-push ruleset drifts; one GitHub cannot protect, or
  // that could not be checked, reports it without claiming protection or failing the check.
  const missing = await run(ctx, conformant, ['check', '--json'], { rulesetReader: () => ({ ok: true, rulesets: [] }) });
  assert.equal(missing.code, 1);
  assert.deepEqual(JSON.parse(missing.stdout).findings.map(entry => entry.id), ['RULESET_NO_FORCE_PUSH_MISSING']);
  for (const [reader, id, status] of [
    [() => ({ ok: false, reason: 'plan-has-no-rulesets' }), 'RULESET_NOT_ENFORCEABLE', 'not-enforceable'],
    [() => ({ ok: false, reason: 'gh-unavailable' }), 'RULESET_UNVERIFIED', 'unverified'],
  ]) {
    const result = await run(ctx, conformant, ['check', '--json'], { rulesetReader: reader });
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.code, 0, id);
    assert.deepEqual(parsed.findings.map(entry => entry.id), [id]);
    assert.equal(parsed.no_force_push_ruleset.status, status);
  }
  let called = false;
  const offline = await run(ctx, conformant, ['check', '--json', '--offline'], { rulesetReader: () => { called = true; return PROTECTED(); } });
  assert.equal(called, false);
  assert.equal(JSON.parse(offline.stdout).no_force_push_ruleset.status, 'not-checked');
  assert.equal((await run(ctx, conformant, ['status', '--offline'])).code, 2, '--offline belongs to check only');

  // Enabled without the binding is incomplete; disabled with a block reports it ignored.
  await run(ctx, incomplete, ['enable']);
  const enabledIncomplete = JSON.parse((await run(ctx, incomplete, ['check', '--json'])).stdout);
  assert.deepEqual(enabledIncomplete.findings.map(entry => entry.id), ['BINDING_MISSING']);
  assert.equal(enabledIncomplete.no_force_push_ruleset.status, 'present', 'the ruleset applies to every ENABLED repository');
  await run(ctx, stale, ['disable']);
  const ignored = await run(ctx, stale, ['check', '--json']);
  assert.equal(ignored.code, 0);
  assert.deepEqual(JSON.parse(ignored.stdout).findings.map(entry => entry.id), ['GOVERNED_BLOCK_IGNORED']);
});

test('I-12: enforcement is reported as shipped, never as active, and Codex names its trust step', () => {
  const status = conformance.enforcementStatus();
  assert.deepEqual(status.claude_code, { status: 'shipped', reason: 'installed-state-not-checked' });
  assert.deepEqual(status.codex, { status: 'shipped', reason: 'runs-once-you-trust-the-plugin-hooks' });
  assert.equal(status.opencode.status, 'unsupported');
  assert.equal(status.cloud_and_projects.status, 'unsupported');
});

test('C-01: the catalogue sources agree (every skill has a tier, routed skills exist)', (t) => {
  assert.deepEqual(catalogue.catalogueProblems(), []);
  const ctx = scratch(t);
  const fixture = path.join(ctx.root, 'toolkit');
  fs.mkdirSync(path.join(fixture, 'repo', 'contracts', 'agent-rules'), { recursive: true });
  for (const name of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(fixture, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'skills', name, 'SKILL.md'), `# ${name}\n`);
  }
  fs.writeFileSync(path.join(fixture, ...catalogue.TIERS_REL.split('/')), JSON.stringify({
    schema: catalogue.TIERS_SCHEMA, tiers: catalogue.TIERS, skills: { alpha: 'portable', gamma: 'governed' },
  }));
  fs.writeFileSync(path.join(fixture, 'repo', 'contracts', 'agent-rules', 'toolkit-skill-routing.md'), '| Skill | Use |\n|---|---|\n| `alpha` | a |\n| `delta` | d |\n');
  const problems = catalogue.catalogueProblems(fixture);
  assert.ok(problems.some(line => line.includes('skill beta has no governance tier')), problems.join('\n'));
  assert.ok(problems.some(line => line.includes('names gamma')), problems.join('\n'));
  assert.ok(problems.some(line => line.includes('routes delta')), problems.join('\n'));
});

test('C-02: governed-only skills are offered only in a complete ENABLED repository, portable ones everywhere', async (t) => {
  const governedOnly = Object.entries(catalogue.loadTiers().skills).filter(([, tier]) => tier === 'governed').map(([name]) => name);
  assert.ok(governedOnly.includes('github-program-reconciler'));
  const names = (state, materialsComplete) => catalogue.catalogueFor(state, { materialsComplete }).map(entry => entry.skill);
  for (const name of governedOnly) {
    assert.ok(names('ENABLED', true).includes(name));
    for (const [state, complete] of [['ENABLED', false], ['DISABLED', false], ['UNDECIDED', false]]) {
      assert.equal(names(state, complete).includes(name), false, `${name} in ${state}`);
    }
  }
  // Portable skills come with the plugin: every state offers them, an undecided repository included.
  const portable = Object.entries(catalogue.loadTiers().skills).filter(([, tier]) => tier === 'portable').map(([name]) => name).sort();
  for (const state of ['UNDECIDED', 'DISABLED']) assert.deepEqual(names(state, false).sort(), portable, state);
  assert.ok(portable.includes('repository-agent-rules'));
  assert.ok(portable.includes('controller-bootstrap'));
  assert.ok(names('ENABLED', true).includes('controller-bootstrap'));
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  writeGoverned(repo);
  const listed = JSON.parse((await run(ctx, repo, ['catalogue', '--json'])).stdout);
  assert.equal(listed.state, 'ENABLED');
  assert.ok(listed.skills.some(entry => entry.skill === 'github-program-reconciler'));
});

test('S-10 (new modules): only the state module reads the decision file, AGENTS.md and the binding', () => {
  for (const file of ['toolkit-governance.cjs', 'toolkit-governance-conformance.cjs', 'toolkit-governance-catalogue.cjs', 'toolkit-governance-ruleset.cjs', 'toolkit-governance-migration.cjs']) {
    const text = fs.readFileSync(path.join(scripts, file), 'utf8');
    assert.equal(/repository-governance\.v1\.json|['"]AGENTS\.md['"]|toolkit-programme\.json['"]|parseRegistryBytes/.test(text.replace(/^\s*\/\/.*$/gm, '')), false, file);
  }
});

test('usage errors exit 2', async (t) => {
  const ctx = scratch(t);
  for (const argv of [[], ['nope'], ['status', 'extra']]) {
    const result = await run(ctx, ctx.root, argv);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /^Usage: node "[^"]*toolkit-governance\.cjs" /);
  }
});

test('the reconciler runs no programme command unless GitHub governance is ENABLED, whatever files the repository carries', (t) => {
  const ctx = scratch(t);
  const home = path.join(ctx.root, 'home');
  fs.mkdirSync(home);
  const programme = path.join(repoRoot, 'skills', 'github-program-reconciler', 'scripts', 'programme.cjs');
  for (const [name, remote] of [['gitlab', 'https://gitlab.com/example-owner/example-repo.git'], ['github-undecided', REMOTE]]) {
    const repo = gitRepo(ctx, name, remote);
    writeGoverned(repo, { binding: name !== 'github-undecided' });
    const result = childProcess.spawnSync(process.execPath, [programme, 'show', '--parent'], { cwd: repo, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home }, windowsHide: true });
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr + result.stdout, /GITHUB_GOVERNANCE_OFF|GitHub governance is (UNDECIDED|DISABLED)/, name);
  }
});
