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

// The default-branch protection each repository has on the fake GitHub: slug -> null (none) or the
// required checks and merge methods of its rules, and whether Toolkit's own ruleset is there.
function protectionReader(protections) {
  return (slug) => {
    const entry = protections[slug] || { checks: [], methods: ['merge', 'squash', 'rebase'], own: null };
    return {
      ok: true, default_branch: 'main', classic: null, toolkit_ruleset: entry.own ? { id: entry.own } : null,
      repository: { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true },
      rules: [
        { type: 'pull_request', ruleset_id: 5, parameters: { allowed_merge_methods: entry.methods } },
        { type: 'required_status_checks', ruleset_id: 5, parameters: { required_status_checks: entry.checks.map(context => ({ context, integration_id: 15368 })) } },
      ],
    };
  };
}

// Every dependency and security setting on, unless `settings` says otherwise for that slug.
function securityReader(settings = {}) {
  return (slug) => ({
    ok: true, visibility: 'public', allow_auto_merge: false, alerts: 'enabled', security_updates: 'enabled',
    secret_scanning: 'enabled', push_protection: 'enabled', code_scanning: 'enabled', private_reporting: 'enabled',
    ...(settings[slug] || {}),
  });
}

async function migrate(ctx, { answers = ['yes'], interactive = true, rulesets = {}, created = [], argv = null, protections = {}, written = [], writer = null, reader = null, security = {}, securityWriter = null, securityFileWriter = null } = {}) {
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
    protectionReader: reader || protectionReader(protections),
    protectionWriter: writer || ((slug, checks, existing) => {
      written.push({ slug, checks, existing });
      protections[slug] = { checks, methods: ['merge'], own: existing || 9 };
      return { ok: true, id: existing || 9 };
    }),
    securityReader: securityReader(security),
    ...(securityWriter ? { securityWriter } : {}),
    ...(securityFileWriter ? { securityFileWriter } : {}),
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
  // The governed block and binding are not the user's answer: the typed yes records it.
  assert.match(result.stdout, /governed: enable \(carries the governed block and programme binding\)/);
  assert.deepEqual(states(ctx, repos), { governed: 'ENABLED', blockOnly: 'ENABLED', plain: 'DISABLED', noOrigin: 'UNDECIDED', store: 'DISABLED' });
  assert.deepEqual(treeDigest(ctx.projects), before, 'no repository file was written');
  // The block-only repository is enabled without a binding: reported with the template, not written.
  assert.match(result.stdout, /block-only: governance is on but the programme binding is missing\. Copy skills\/repository-agent-rules\/repo-local\/toolkit-programme\.template\.json/);
});

test('M-01: answers can be changed in the same reply; anything else writes nothing', async (t) => {
  const ctx = scratch(t);
  const repos = fixture(ctx);
  for (const answer of ['', 'no', 'yes 99=enable', 'yes 1=maybe', 'yes 4=enable']) {
    // Row 4 is the repository with no origin (sorted: block-only, evidence, governed, no-origin, plain), which cannot change.
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
  const protections = { 'example-owner/governed': { checks: ['validate'], methods: ['merge'], own: null } };
  const accepted = await migrate(ctx, { answers: ['yes'], rulesets, created, protections });
  assert.equal(accepted.code, 0, accepted.stdout);
  assert.deepEqual(created, ['example-owner/block-only'], 'only the ENABLED repository without one');
  assert.match(accepted.stdout, /example-owner\/block-only: ruleset added and read back/);
  assert.equal(accepted.asked.length, 1, 'decisions were already done, so only the ruleset question is asked');
});

test('PR-05: the Toolkit default-branch ruleset is offered after its own yes, written once, and read back', async (t) => {
  const ctx = scratch(t);
  const { governed } = fixture(ctx);
  await migrate(ctx, { answers: ['yes', 'no', 'no'] });
  const rulesets = { 'example-owner/governed': true, 'example-owner/block-only': true };
  const written = [];
  // No job produces the binding's check yet: requiring it would block every merge, so no offer.
  const unproduced = await migrate(ctx, { answers: [], rulesets, written });
  assert.equal(unproduced.asked.length, 0);
  assert.deepEqual(written, []);
  assert.match(unproduced.stdout, /example-owner\/governed: Toolkit ruleset not offered: no workflow job produces "validate", so requiring it would block every merge/);
  // A job whose workflow skips pull requests to the default branch would never report: no offer either.
  fs.mkdirSync(path.join(governed, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(governed, '.github', 'workflows', 'ci.yml'), 'on:\n  pull_request:\n    branches: [release]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n');
  const silent = await migrate(ctx, { answers: [], rulesets, written });
  assert.equal(silent.asked.length, 0);
  assert.match(silent.stdout, /Toolkit ruleset not offered: "validate" does not report on every pull request to the default branch, so requiring it would block those merges/);
  // GitHub unreadable (signed out, or not an admin for classic protection): reported, nothing offered.
  for (const reason of ['gh-unavailable', 'classic-protection-not-visible']) {
    const unread = await migrate(ctx, { answers: [], rulesets, written, reader: () => ({ ok: false, reason }) });
    assert.equal(unread.asked.length, 0, reason);
    assert.match(unread.stdout, new RegExp(`default-branch protection could not be checked on GitHub \\(${reason}\\)`));
  }
  assert.deepEqual(written, []);
  // With the job (an aggregate that is not verified), the workflow problem is shown before the question.
  fs.mkdirSync(path.join(governed, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(governed, '.github', 'workflows', 'ci.yml'), 'on: [pull_request]\njobs:\n  tests:\n    runs-on: ubuntu-latest\n  validate:\n    needs: [tests]\n    if: always()\n    runs-on: ubuntu-latest\n');
  // No yes: nothing written.
  const declined = await migrate(ctx, { answers: ['no'], rulesets, written });
  assert.deepEqual(written, []);
  assert.match(declined.stdout, /example-owner\/governed \(/);
  assert.match(declined.stdout, /workflow \(unverified, fix by hand\): "validate" \(\.github\/workflows\/ci\.yml\) runs after tests/);
  assert.match(declined.asked.at(-1), /every change needs a pull request.*nobody can bypass it\. Updating it replaces any rules already in that ruleset/);
  assert.match(declined.stdout, /"validate" is in the binding but not required/);
  assert.match(declined.stdout, /main allows merge, squash, rebase \(rulesets\)/);
  assert.match(declined.stdout, /Default-branch rulesets not added/);
  // Yes: only the repository with a binding gets the ruleset, then it reads back clean.
  const protections = {};
  const accepted = await migrate(ctx, { answers: ['yes'], rulesets, written, protections });
  assert.equal(accepted.code, 0, accepted.stdout);
  assert.deepEqual(written, [{ slug: 'example-owner/governed', checks: ['validate'], existing: null }]);
  assert.match(accepted.stdout, /example-owner\/governed: ruleset added and read back/);
  // A second run with nothing Toolkit's ruleset can fix asks nothing and writes nothing.
  const again = await migrate(ctx, { answers: [], rulesets, written, protections });
  assert.equal(again.asked.length, 0);
  assert.equal(written.length, 1);
  // Drift in Toolkit's own ruleset is an update of that ruleset, never a second one.
  protections['example-owner/governed'] = { checks: ['validate'], methods: ['merge', 'squash'], own: 9 };
  await migrate(ctx, { answers: ['yes'], rulesets, written, protections });
  assert.deepEqual(written.at(-1), { slug: 'example-owner/governed', checks: ['validate'], existing: 9 });
  // A refused write is reported once and not retried; an extra check in another ruleset is by hand.
  delete protections['example-owner/governed'];
  let calls = 0;
  const refused = await migrate(ctx, { answers: ['yes'], rulesets, protections, writer: () => { calls += 1; return { ok: false, reason: 'gh-request-failed' }; } });
  assert.equal(calls, 1);
  assert.equal(refused.code, 2);
  assert.match(refused.stdout, /example-owner\/governed: not added \(gh-request-failed\)/);
  protections['example-owner/governed'] = { checks: ['validate', 'lint'], methods: ['merge'], own: null };
  const extra = await migrate(ctx, { answers: [], rulesets, written, protections });
  assert.equal(extra.asked.length, 0);
  assert.match(extra.stdout, /"lint" is required but not in the binding/);
  assert.ok(governed);
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

test('SEC-01: free dependency and security settings are turned on by default, without a question, and read back', async (t) => {
  const ctx = scratch(t);
  const { governed } = fixture(ctx);
  fs.writeFileSync(path.join(governed, 'package.json'), '{}');
  // The decision run already writes the missing Dependabot file, asking nothing more about it.
  const first = await migrate(ctx, { answers: ['yes', 'no', 'no'] });
  assert.match(first.stdout, /\.github\/dependabot\.yml written; commit it through a pull request/);
  const rulesets = { 'example-owner/governed': true, 'example-owner/block-only': true };
  const protections = { 'example-owner/governed': { checks: ['validate'], methods: ['merge'], own: null } };
  const settings = { 'example-owner/governed': { alerts: 'disabled', code_scanning: 'disabled' } };
  const calls = [];
  const securityWriter = (slug, plan) => {
    const keys = Object.keys(plan).filter(key => key !== 'paid' && plan[key]);
    calls.push({ slug, plan: keys });
    settings[slug] = {};
    return keys.map(setting => ({ setting, ok: true, reason: null }));
  };
  const applied = await migrate(ctx, { answers: [], rulesets, protections, security: settings, securityWriter });
  assert.equal(applied.code, 0, applied.stdout);
  assert.equal(applied.asked.length, 0, 'on by default: no question');
  assert.deepEqual(calls, [{ slug: 'example-owner/governed', plan: ['alerts', 'code_scanning'] }]);
  assert.match(fs.readFileSync(path.join(governed, '.github', 'dependabot.yml'), 'utf8'), /package-ecosystem: "npm"/);
  assert.match(applied.stdout, /example-owner\/governed: Dependabot alerts turned on\.\n- example-owner\/governed: CodeQL code scanning turned on/);
  assert.match(applied.stdout, /example-owner\/governed: read back/);
  // Nothing left: nothing called. A refused write is reported once and fails the run.
  await migrate(ctx, { answers: [], rulesets, protections, security: settings, securityWriter });
  assert.equal(calls.length, 1);
  settings['example-owner/governed'] = { private_reporting: 'disabled' };
  let refusedCalls = 0;
  const refused = await migrate(ctx, { answers: [], rulesets, protections, security: settings, securityWriter: () => { refusedCalls += 1; return [{ setting: 'private_reporting', ok: false, reason: 'forbidden' }]; } });
  assert.equal(refusedCalls, 1);
  assert.equal(refused.code, 2);
  assert.match(refused.stdout, /private vulnerability reporting not turned on \(forbidden\)/);
  // A private repository: paid features are never turned on without the binding's answer.
  settings['example-owner/governed'] = { visibility: 'private', secret_scanning: 'disabled', push_protection: 'disabled', code_scanning: 'disabled', private_reporting: 'not-on-plan' };
  const privateRun = await migrate(ctx, { answers: [], rulesets, protections, security: settings, securityWriter });
  assert.equal(calls.length, 1, 'nothing paid was written');
  assert.match(privateRun.stdout, /no paid_security answer/);
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
