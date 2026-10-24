'use strict';

// `toolkit governance migrate` (#542): one batched question over the repositories found, evidence
// stores disabled, earlier keys carried over, missing bindings and legacy markers reported (never
// written), idempotent re-runs, one private record, and the no-force-push ruleset offered only
// after a second typed yes. Closure rows M-01 to M-04, NF-05, NF-06 and T-01 (template).

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
const migration = require(path.join(scripts, 'toolkit-governance-migration.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const ruleset = require(path.join(scripts, 'toolkit-governance-ruleset.cjs'));
const managedBlock = require(path.join(scripts, 'toolkit-managed-block.cjs'));
const programmeState = require(path.join(repoRoot, 'skills', 'github-program-reconciler', 'scripts', 'programme-state.cjs'));

function git(cwd, args) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projects = path.join(root, 'projects');
  fs.mkdirSync(projects);
  return { root, projects, registryPath: path.join(root, 'state', 'repository-governance.v1.json') };
}

function gitRepo(ctx, name, remote) {
  const repo = path.join(ctx.projects, name);
  fs.mkdirSync(repo, { recursive: true });
  git(ctx.projects, ['init', '--quiet', repo]);
  if (remote) git(repo, ['remote', 'add', 'origin', remote]);
  return repo;
}

function writeBlock(repo, name = 'TOOLKIT-GOVERNED-RULES') {
  const rendered = managedBlock.renderBlock({ source: 'repo/contracts/agent-rules/toolkit-governed-rules.md', name, version: '1.0.0', body: '# Rules' });
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), `${rendered}\n`);
}

function writeBinding(repo, slug, store) {
  fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify({
    schema: 'toolkit.programme-binding.v1', repository: slug, parent_issue: 3, record_prefix: 'INT-A-', writer_prefix: 'INT-A-',
    store: { kind: 'github', repository: store, branch: 'main', path: 'state/a/' }, required_checks: ['validate'],
  }));
}

// Five repositories: governed (block and binding), block only, plain, no origin, and the
// governed one's evidence store.
function fixture(ctx) {
  const governed = gitRepo(ctx, 'governed', 'https://github.com/example-owner/governed.git');
  writeBlock(governed);
  writeBinding(governed, 'example-owner/governed', 'example-owner/evidence');
  const blockOnly = gitRepo(ctx, 'block-only', 'git@github.com:example-owner/block-only.git');
  writeBlock(blockOnly);
  const plain = gitRepo(ctx, 'plain', 'https://github.com/example-owner/plain');
  const noOrigin = gitRepo(ctx, 'no-origin', null);
  const store = gitRepo(ctx, 'evidence', 'https://github.com/Example-Owner/Evidence.git');
  return { governed, blockOnly, plain, noOrigin, store };
}

function sink() {
  const chunks = [];
  return { write: (text) => { chunks.push(String(text)); return true; }, text: () => chunks.join('') };
}

async function migrate(ctx, { answers = ['yes'], interactive = true, rulesets = {}, created = [], argv = null } = {}) {
  const stdout = sink();
  const stderr = sink();
  const asked = [];
  const queue = [...answers];
  const cli = new ToolkitGovernanceCli({
    stdout, stderr, interactive, cwd: ctx.root,
    ask: async (question) => { asked.push(question); return queue.shift() || ''; },
    registryOptions: { registryPath: ctx.registryPath, testOnly: true },
    rulesetReader: (slug) => ({ ok: true, rulesets: rulesets[slug] ? [ruleset.noForcePushRulesetBody()] : [] }),
    rulesetCreator: (slug) => { created.push(slug); rulesets[slug] = true; return { ok: true, id: 1 }; },
  });
  const code = await cli.main(argv || ['migrate', '--root', ctx.projects]);
  return { code, stdout: stdout.text(), stderr: stderr.text(), asked };
}

function states(ctx, repos) {
  return Object.fromEntries(Object.entries(repos).map(([name, repo]) => [name, governance.governanceState(repo, { registryPath: ctx.registryPath, testOnly: true }).state]));
}

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

test('M-01: one batched question; the evidence store is disabled, the no-origin repository skipped', async (t) => {
  const ctx = scratch(t);
  const repos = fixture(ctx);
  const before = treeDigest(ctx.projects);
  const result = await migrate(ctx, { answers: ['yes', 'no'] });
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.equal(result.asked.filter(question => /apply the proposed answers/.test(question)).length, 1);
  assert.match(result.stdout, /evidence: disable \(evidence store named in a programme binding/);
  assert.match(result.stdout, /no-origin: skip/);
  assert.match(result.stdout, /governed: keep/);
  assert.deepEqual(states(ctx, repos), { governed: 'ENABLED', blockOnly: 'ENABLED', plain: 'DISABLED', noOrigin: 'UNDECIDED', store: 'DISABLED' });
  assert.deepEqual(treeDigest(ctx.projects), before, 'no repository file was written');
  // The block-only repository is enabled without a binding: reported with the template, not written.
  assert.match(result.stdout, /block-only: governance is on but the programme binding is missing\. Copy skills\/repository-agent-rules\/repo-local\/toolkit-programme\.template\.json/);
});

test('M-01: answers can be changed in the same reply; anything else writes nothing', async (t) => {
  const ctx = scratch(t);
  const repos = fixture(ctx);
  for (const answer of ['', 'no', 'yes 99=enable', 'yes 1=maybe', 'yes 3=enable']) {
    // Row 3 is the governed repository (sorted: block-only, evidence, governed, no-origin, plain), which has nothing to change.
    const result = await migrate(ctx, { answers: [answer] });
    assert.equal(result.code, 1, answer);
    assert.equal(fs.existsSync(ctx.registryPath), false, answer);
  }
  // `decline` is the older word for `disable` and is still understood.
  const changed = await migrate(ctx, { answers: ['yes 5=enable 1=decline', 'no'] });
  assert.equal(changed.code, 0, changed.stdout);
  assert.deepEqual(states(ctx, repos), { governed: 'ENABLED', blockOnly: 'DISABLED', plain: 'ENABLED', noOrigin: 'UNDECIDED', store: 'DISABLED' });
  const refused = await migrate(ctx, { interactive: false });
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /Run this yourself in a terminal/);
});

test('M-02: a second run changes nothing and keeps one record per changing run', async (t) => {
  const ctx = scratch(t);
  fixture(ctx);
  await migrate(ctx, { answers: ['yes', 'no'] });
  const recordFile = path.join(path.dirname(ctx.registryPath), migration.RECORD_BASENAME);
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  assert.equal(record.runs.length, 1);
  assert.equal(record.runs[0].decisions.every(entry => entry.result === 'written'), true);
  assert.equal(JSON.stringify(record).includes('example-owner'), false, 'the record holds no remotes');
  const registryBefore = fs.readFileSync(ctx.registryPath);
  const again = await migrate(ctx, { answers: ['no'] });
  assert.equal(again.code, 0);
  assert.match(again.stdout, /Nothing to migrate/);
  assert.deepEqual(fs.readFileSync(ctx.registryPath), registryBefore);
  assert.equal(JSON.parse(fs.readFileSync(recordFile, 'utf8')).runs.length, 1);
});

test('M-04: legacy markers and the early binding name are reported, not rewritten', async (t) => {
  const ctx = scratch(t);
  const legacy = gitRepo(ctx, 'legacy', 'https://github.com/example-owner/legacy.git');
  writeBlock(legacy, 'GLOBAL-AGENTS.MD-TEMPLATE');
  fs.mkdirSync(path.join(legacy, '.github'));
  fs.writeFileSync(path.join(legacy, '.github', 'ai-agent-toolkit-programme.json'), '{}');
  const before = treeDigest(legacy);
  const result = await migrate(ctx, { answers: ['yes', 'no'] });
  assert.match(result.stdout, /old GLOBAL-AGENTS\.MD-TEMPLATE block/);
  assert.match(result.stdout, /ai-agent-toolkit-programme\.json is an early binding name/);
  assert.deepEqual(treeDigest(legacy), before);
});

test('NF-05: missing no-force-push rulesets are added only after a second yes, and read back', async (t) => {
  const ctx = scratch(t);
  fixture(ctx);
  const created = [];
  const declined = await migrate(ctx, { answers: ['yes', 'no'], created });
  assert.deepEqual(created, []);
  assert.match(declined.stdout, /Rulesets not added/);
  const rulesets = { 'example-owner/governed': true };
  const accepted = await migrate(ctx, { answers: ['yes'], rulesets, created });
  assert.equal(accepted.code, 0, accepted.stdout);
  assert.deepEqual(created, ['example-owner/block-only'], 'only the ENABLED repository without one');
  assert.match(accepted.stdout, /example-owner\/block-only: ruleset added and read back/);
  assert.equal(accepted.asked.length, 1, 'decisions were already done, so only the ruleset question is asked');
});

test('NF-06: the ruleset Toolkit adds is the one the check accepts', () => {
  const body = ruleset.noForcePushRulesetBody();
  assert.equal(ruleset.rulesetVerdict([body]).status, 'present');
  assert.equal(ruleset.rulesetVerdict([body]).bypass, 'none');
  const calls = [];
  const spawn = (command, args, options) => { calls.push({ args, input: options.input }); return { status: 0, stdout: '{"id":42}', stderr: '' }; };
  assert.deepEqual(ruleset.ghRulesetCreator('example-owner/example-repo', { spawn }), { ok: true, id: 42 });
  assert.deepEqual(calls[0].args, ['api', '-X', 'POST', 'repos/example-owner/example-repo/rulesets', '--input', '-']);
  assert.deepEqual(JSON.parse(calls[0].input), body);
  const plan = () => ({ status: 1, stdout: '', stderr: 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)' });
  assert.deepEqual(ruleset.ghRulesetCreator('a/b', { spawn: plan }), { ok: false, reason: 'plan-has-no-rulesets' });
});

test('T-01: the binding template is not a valid binding until it is filled in', () => {
  const template = JSON.parse(fs.readFileSync(path.join(repoRoot, ...migration.BINDING_TEMPLATE.split('/')), 'utf8'));
  assert.throws(() => programmeState.validateBinding(template), /parent_issue/);
  const filled = { ...template, repository: 'example-owner/example-repo', parent_issue: 1, store: { ...template.store, repository: 'example-owner/evidence' } };
  assert.doesNotThrow(() => programmeState.validateBinding(filled));
});

test('discovery: the folder itself and the folders directly inside it, each once', (t) => {
  const ctx = scratch(t);
  const top = gitRepo(ctx, 'top', 'https://github.com/example-owner/top.git');
  const nested = path.join(top, 'inner');
  fs.mkdirSync(nested);
  git(top, ['init', '--quiet', nested]);
  const deep = path.join(ctx.projects, 'group', 'deep');
  fs.mkdirSync(deep, { recursive: true });
  git(ctx.projects, ['init', '--quiet', deep]);
  assert.deepEqual(migration.discoverRepositories([ctx.projects, ctx.projects]), [top]);
  assert.deepEqual(migration.discoverRepositories([top]), [top, nested]);
});
