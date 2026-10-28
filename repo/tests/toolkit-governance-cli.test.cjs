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
const { recordMerged } = require('./toolkit-governed-fixture-support.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = path.join(repoRoot, 'repo', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const conformance = require(path.join(scripts, 'toolkit-governance-conformance.cjs'));
const plainTextInstaller = require(path.join(scripts, '..', '..', 'skills', 'secure-ci-cd', 'scripts', 'install-plain-text-check.cjs'));
const catalogue = require(path.join(scripts, 'toolkit-governance-catalogue.cjs'));
const managedBlock = require(path.join(scripts, 'toolkit-managed-block.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const migration = require(path.join(scripts, 'toolkit-governance-migration.cjs'));

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

// Every dependency and security setting on, on a public repository.
const SECURE = () => ({
  ok: true, visibility: 'public', allow_auto_merge: false, alerts: 'enabled', security_updates: 'enabled',
  secret_scanning: 'enabled', push_protection: 'enabled', code_scanning: 'enabled', private_reporting: 'enabled',
  binding: { status: 'missing' },
});

// A default branch that requires the binding's one check, pinned, with merge commits only.
const BRANCH_PROTECTED = () => ({
  ok: true, default_branch: 'main', classic: null, toolkit_ruleset: null,
  repository: { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true },
  rules: [
    { type: 'pull_request', ruleset_id: 1, parameters: { allowed_merge_methods: ['merge'] } },
    { type: 'required_status_checks', ruleset_id: 1, parameters: { required_status_checks: [{ context: 'validate', integration_id: 15368 }] } },
  ],
});
const WORKFLOW = [
  'on:', '  pull_request:', 'jobs:', '  tests:', '    runs-on: ubuntu-latest', '  validate:', '    needs: [tests]', '    if: ${{ always() }}',
  '    runs-on: ubuntu-latest', '    steps:', '      - env:', '          TEST_LEGS: ${{ toJSON(needs) }}', '        run: node repo/scripts/run-tests.cjs --verify-ci s', '',
].join('\n');

async function run(ctx, cwd, argv, { answer = 'yes', interactive = true, rulesetReader = PROTECTED, protectionReader = BRANCH_PROTECTED, securityReader = SECURE, securityWriter = null } = {}) {
  const stdout = sink();
  const stderr = sink();
  const asked = [];
  const cli = new ToolkitGovernanceCli({
    stdout, stderr, cwd, interactive,
    ask: async (question) => { asked.push(question); return answer; },
    registryOptions: { registryPath: ctx.registryPath, testOnly: true },
    rulesetReader,
    protectionReader,
    securityReader,
    ...(securityWriter ? { securityWriter } : {}),
  });
  const code = await cli.main(argv);
  return { code, stdout: stdout.text(), stderr: stderr.text(), asked };
}

function expectedBlockText(version) {
  const expected = conformance.expectedGovernedBlock();
  return managedBlock.renderBlock({ ...expected, version: version || expected.version });
}

// The plain-text check a governed repository carries: the copy and the settings the installer writes.
function writePlainTextCheck(repo, settings = { schema: 'toolkit-plain-text-config/v1' }) {
  fs.mkdirSync(path.join(repo, '.github', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'scripts', 'plain-text-check.cjs'), plainTextInstaller.vendoredText());
  fs.writeFileSync(path.join(repo, '.github', 'plain-text.json'), JSON.stringify(settings));
}

function writeGoverned(repo, { blockText = expectedBlockText(), binding = true, repository = 'example-owner/example-repo', plainText = true } = {}) {
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), `# Repo\n\n${blockText}\n`);
  if (plainText) writePlainTextCheck(repo);
  if (binding) {
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify({
      schema: 'toolkit.programme-binding.v2', repository, governance: 'enabled',
      parents: [{ issue: 7, record_prefix: 'INT-EX', writer_prefix: 'EX' }],
      store: { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/' },
      required_checks: ['validate'],
    }));
    fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), WORKFLOW);
    fs.writeFileSync(path.join(repo, '.github', 'dependabot.yml'), 'version: 2\nupdates:\n  - package-ecosystem: "github-actions"\n    directory: "/"\n');
  }
}

// Every file under `dir` with its content digest, to prove a command wrote nothing.
// Records the user's yes, as the governance gate does from their reply, and, where the repository has
// a binding, this computer's read of it as merged on the default branch: only a merged binding decides.
function enable(ctx, repo) {
  require(path.join(scripts, 'toolkit-governance-gate.cjs')).writeGovernanceDecision(repo, 'enable', { registryOptions: { registryPath: ctx.registryPath, testOnly: true } });
  if (fs.existsSync(path.join(repo, '.github', 'toolkit-programme.json'))) recordMerged(repo, { registryPath: ctx.registryPath });
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
  assert.match(enabled.asked[0], /^Enable Toolkit's GitHub governance for /);
  assert.doesNotMatch(enabled.asked[0], /paid|Secret Protection|Code Security|billed/, 'the enable question asks nothing about paid features');
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
    assert.equal(fs.existsSync(path.join(repo, '.ai-agent-toolkit')), false, 'nothing is written into the repository');
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
  enable(ctx, conformant); // stale and edited share its remote, so the one yes covers them
  const unasked = gitRepo(ctx, 'unasked', 'https://github.com/example-owner/unasked.git');
  writeGoverned(unasked, { repository: 'example-owner/unasked' });
  const incomplete = gitRepo(ctx, 'incomplete', 'https://github.com/example-owner/incomplete.git');
  writeGoverned(incomplete, { binding: false });
  const plain = gitRepo(ctx, 'plain', 'https://github.com/example-owner/plain.git');

  const snapshot = treeDigest(ctx.root);
  const codes = {};
  for (const [name, repo] of Object.entries({ conformant, stale, edited, unasked, incomplete, plain })) {
    const result = await run(ctx, repo, ['check', '--json']);
    const parsed = JSON.parse(result.stdout);
    codes[name] = [result.code, parsed.status, parsed.findings.map(entry => entry.id).sort().join(',')];
  }
  assert.deepEqual(codes, {
    conformant: [0, 'conformant', ''],
    stale: [1, 'drift', 'GOVERNED_BLOCK_STALE'],
    edited: [1, 'drift', 'GOVERNED_BLOCK_EDITED'],
    unasked: [1, 'drift', 'DECISION_PENDING'],
    incomplete: [1, 'drift', 'DECISION_PENDING'],
    plain: [1, 'drift', 'DECISION_PENDING'],
  });

  const decisions = fs.readFileSync(ctx.registryPath);
  fs.writeFileSync(ctx.registryPath, 'corrupt');
  const broken = await run(ctx, conformant, ['check', '--json']);
  assert.equal(broken.code, 2);
  assert.equal(JSON.parse(broken.stdout).status, 'error');
  fs.writeFileSync(ctx.registryPath, decisions);
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
  assert.equal(JSON.parse(offline.stdout).default_branch_protection.checks.P5.status, 'not-checked');
  // The first line never says plain "conformant" while items are unverified.
  assert.match((await run(ctx, conformant, ['check', '--offline'])).stdout, /^Conformance: conformant \(\d+ items? unverified\)$/m);

  // Default-branch protection drift is drift; GitHub unreadable is unverified, never conformant.
  const squash = () => { const read = BRANCH_PROTECTED(); read.rules[0].parameters.allowed_merge_methods = ['merge', 'squash']; return read; };
  const loose = await run(ctx, conformant, ['check', '--json'], { protectionReader: squash });
  assert.equal(loose.code, 1);
  assert.deepEqual(JSON.parse(loose.stdout).findings.map(entry => entry.id), ['PROTECTION_MERGE_METHODS']);
  const unread = JSON.parse((await run(ctx, conformant, ['check', '--json'], { protectionReader: () => ({ ok: false, reason: 'gh-unavailable' }) })).stdout);
  assert.equal(unread.default_branch_protection.status, 'unverified');
  assert.deepEqual(unread.findings.map(entry => entry.id), ['PROTECTION_CHECKS_MISMATCH_UNVERIFIED', 'PROTECTION_CHECK_UNPINNED_UNVERIFIED', 'PROTECTION_MERGE_METHODS_UNVERIFIED']);
  assert.match((await run(ctx, conformant, ['check'])).stdout, /Default-branch protection: conformant/);

  // An ENABLED repository needs a current plain-text check, unless its settings record why it is off.
  const PROTECTED_RUN = { rulesetReader: PROTECTED };
  const checkIds = async () => JSON.parse((await run(ctx, conformant, ['check', '--json'], PROTECTED_RUN)).stdout).findings.map(entry => entry.id);
  const copy = path.join(conformant, '.github', 'scripts', 'plain-text-check.cjs');
  const settingsFile = path.join(conformant, '.github', 'plain-text.json');
  fs.rmSync(settingsFile);
  assert.deepEqual(await checkIds(), ['PLAIN_TEXT_CHECK_MISSING']);
  fs.writeFileSync(settingsFile, JSON.stringify({ schema: 'toolkit-plain-text-config/v1', off_reason: 'issue numbers are published here on purpose' }));
  assert.deepEqual(await checkIds(), ['PLAIN_TEXT_CHECK_OFF']);
  fs.writeFileSync(settingsFile, JSON.stringify({ schema: 'toolkit-plain-text-config/v1' }));
  fs.appendFileSync(copy, '// local edit\n');
  assert.deepEqual(await checkIds(), ['PLAIN_TEXT_CHECK_DRIFT']);
  writePlainTextCheck(conformant);
  assert.deepEqual(await checkIds(), []);

  // Enabled without the binding is incomplete; disabled with a block reports it ignored.
  await run(ctx, incomplete, ['enable']);
  const enabledIncomplete = JSON.parse((await run(ctx, incomplete, ['check', '--json'])).stdout);
  assert.deepEqual(enabledIncomplete.findings.map(entry => entry.id), ['BINDING_MISSING', 'MERGED_BINDING_UNKNOWN'], 'the default branch has not been read on this computer yet');
  assert.equal(enabledIncomplete.no_force_push_ruleset.status, 'present', 'the ruleset applies to every ENABLED repository');
  // A merged binding decides, so a local disable is refused; a merged disabled turns it off everywhere.
  const refusedDisable = await run(ctx, stale, ['disable']);
  assert.equal(refusedDisable.code, 2);
  assert.match(refusedDisable.stderr, /merged on the default branch decides/);
  recordMerged(stale, { registryPath: ctx.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'disabled' }) });
  const ignored = await run(ctx, stale, ['check', '--json']);
  assert.equal(ignored.code, 0);
  assert.deepEqual(JSON.parse(ignored.stdout).findings.map(entry => entry.id), ['REPOSITORY_DISABLED', 'GOVERNED_BLOCK_IGNORED']);
  // DISABLED and UNDECIDED repositories never ask GitHub about default-branch protection.
  for (const repo of [stale, unasked]) {
    let asked = false;
    const result = JSON.parse((await run(ctx, repo, ['check', '--json'], { protectionReader: () => { asked = true; return BRANCH_PROTECTED(); } })).stdout);
    assert.equal(asked, false, repo);
    assert.equal(result.default_branch_protection, null, repo);
  }
});

test('SC-01: security turns on the free settings of a governed repository without a question, and only there', async (t) => {
  const ctx = scratch(t);
  const governed = gitRepo(ctx, 'governed');
  writeGoverned(governed);
  const undecided = gitRepo(ctx, 'undecided', 'https://github.com/example-owner/undecided.git');
  writeGoverned(undecided, { repository: 'example-owner/undecided' });
  enable(ctx, governed);
  let on = false;
  const writes = [];
  const securityReader = () => ({ ...SECURE(), alerts: on ? 'enabled' : 'disabled' });
  const securityWriter = (slug, plan) => { writes.push(slug); on = true; return plan.alerts ? [{ setting: 'alerts', ok: true, reason: null }] : []; };
  const refused = await run(ctx, undecided, ['security'], { securityReader, securityWriter });
  assert.equal(refused.code, 1);
  assert.match(refused.stdout, /only in a governed repository/);
  assert.deepEqual(writes, []);
  const applied = await run(ctx, governed, ['security'], { securityReader, securityWriter, interactive: false });
  assert.equal(applied.code, 0, applied.stdout);
  assert.equal(applied.asked.length, 0);
  assert.deepEqual(writes, ['example-owner/example-repo']);
  assert.match(applied.stdout, /Dependabot alerts turned on\.\n- example-owner\/example-repo: read back\./);
  const again = await run(ctx, governed, ['security'], { securityReader, securityWriter });
  assert.match(again.stdout, /already on/);
  assert.equal(writes.length, 1);
  // The change is recorded with what GitHub showed before.
  const record = JSON.parse(fs.readFileSync(path.join(path.dirname(ctx.registryPath), migration.RECORD_BASENAME), 'utf8'));
  const last = record.runs.at(-1);
  assert.equal(last.command, 'security');
  assert.equal(last.securities[0].prior.alerts, 'disabled');
  assert.deepEqual(last.securities[0].settings, [{ setting: 'alerts', ok: true, reason: null }]);
});

test('SC-02: security never says "already on" or "read back" when GitHub could not be read, and exits 2', async (t) => {
  const ctx = scratch(t);
  const governed = gitRepo(ctx, 'governed');
  writeGoverned(governed);
  enable(ctx, governed);
  const writes = [];
  const securityWriter = (slug, plan) => { writes.push(plan); return [{ setting: 'alerts', ok: true, reason: null }]; };
  const unread = await run(ctx, governed, ['security'], { securityReader: () => ({ ok: false, reason: 'gh-unavailable' }), securityWriter });
  assert.equal(unread.code, 2);
  assert.deepEqual(writes, [], 'nothing is written when GitHub cannot be read');
  assert.match(unread.stdout, /nothing changed: GitHub could not be read/);
  assert.doesNotMatch(unread.stdout, /already on|read back\./);
  // The write works but the read-back does not: unverified, exit 2.
  let reads = 0;
  const flaky = () => (reads++ === 0 ? { ...SECURE(), alerts: 'disabled' } : { ok: false, reason: 'gh-unavailable' });
  const unverified = await run(ctx, governed, ['security'], { securityReader: flaky, securityWriter });
  assert.equal(unverified.code, 2);
  assert.match(unverified.stdout, /could not read back: Dependabot alerts/);
  // The read-back works, but the written setting alone reads unreadable: still unverified, exit 2.
  let partReads = 0;
  const partial = () => (partReads++ === 0 ? { ...SECURE(), alerts: 'disabled' } : { ...SECURE(), alerts: 'unreadable' });
  const part = await run(ctx, governed, ['security'], { securityReader: partial, securityWriter });
  assert.equal(part.code, 2, part.stdout);
  assert.match(part.stdout, /could not read back: Dependabot alerts/);
  assert.doesNotMatch(unverified.stdout, /read back\./);
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
  assert.equal(JSON.parse((await run(ctx, repo, ['catalogue', '--json'])).stdout).state, 'UNDECIDED', 'the block and binding alone are not an answer');
  enable(ctx, repo);
  const listed = JSON.parse((await run(ctx, repo, ['catalogue', '--json'])).stdout);
  assert.equal(listed.state, 'ENABLED');
  assert.ok(listed.skills.some(entry => entry.skill === 'github-program-reconciler'));
});

test('S-10 (new modules): only the state module reads the decision file, AGENTS.md and the binding', () => {
  for (const file of ['toolkit-governance.cjs', 'toolkit-governance-conformance.cjs', 'toolkit-governance-catalogue.cjs', 'toolkit-governance-ruleset.cjs', 'toolkit-governance-protection.cjs', 'toolkit-governance-migration.cjs', 'toolkit-governance-security.cjs']) {
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

test('H3: repair moves an unreadable decisions file aside only after a typed yes in a terminal, and names it everywhere', async (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const options = { registryPath: ctx.registryPath, testOnly: true };
  // Nothing to repair while the file reads (or is missing).
  for (const setup of [() => {}, () => run(ctx, repo, ['enable'])]) {
    await setup();
    const fine = await run(ctx, repo, ['repair']);
    assert.equal(fine.code, 0);
    assert.match(fine.stdout, /reads fine .*nothing to repair/);
  }
  fs.appendFileSync(ctx.registryPath, 'junk');
  const damaged = fs.readFileSync(ctx.registryPath);
  const named = new RegExp(ctx.registryPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const status = await run(ctx, repo, ['status']);
  assert.equal(status.code, 2);
  assert.match(status.stdout, named);
  assert.match(status.stdout, /toolkit-governance\.cjs" repair/);
  const check = conformance.checkConformance(repo, { ...options, offline: true });
  assert.match(check.findings.find(item => item.id === 'STATE_ERROR').message, named);
  const disable = await run(ctx, repo, ['disable']);
  assert.match(disable.stderr, named);
  for (const [label, runOptions, code] of [
    ['an agent without a terminal', { interactive: false }, 2],
    ['not confirmed', { answer: 'no' }, 1],
  ]) {
    const refused = await run(ctx, repo, ['repair'], runOptions);
    assert.equal(refused.code, code, label);
    assert.deepEqual(fs.readFileSync(ctx.registryPath), damaged, `${label}: nothing moved`);
  }
  const repaired = await run(ctx, repo, ['repair', '--json']);
  assert.equal(repaired.code, 0, repaired.stderr);
  const result = JSON.parse(repaired.stdout);
  assert.equal(fs.existsSync(ctx.registryPath), false);
  assert.deepEqual(fs.readFileSync(result.moved_to), damaged, 'the damaged file is kept next to the original');
  assert.equal(path.dirname(result.moved_to), path.dirname(ctx.registryPath));
  assert.deepEqual([governance.governanceState(repo, options).state, governance.governanceState(repo, options).rule], ['UNDECIDED', 'R7'], 'the question is asked again');
});
