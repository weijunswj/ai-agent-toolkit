'use strict';

// `toolkit governance`: accepted answers prepare repository proposals and read them back;
// `check` is read-only with exit codes 0, 1 and 2; the skill catalogue is computed
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
  if (remote && governance.readIdentity(repo).valid) require('./toolkit-governed-fixture-support.cjs').recordAbsent(repo, { registryPath: ctx.registryPath });
  return repo;
}

function sink() {
  const chunks = [];
  return { write: (text) => { chunks.push(String(text)); return true; }, text: () => chunks.join('') };
}

test('Delta closure: status prints recognised ERROR data with exit 2 and valid state with exit 0', async t => {
  for (const invalid of [false, true]) {
    const ctx = scratch(t), repo = gitRepo(ctx, 'status');
    if (invalid) recordMerged(repo, { text: JSON.stringify({ schema: 'invalid-binding' }), registryPath: ctx.registryPath });
    const result = await run(ctx, repo, ['status', '--json']);
    const state = JSON.parse(result.stdout);
    assert.equal(result.code, invalid ? 2 : 0);
    assert.equal(state.state, invalid ? 'ERROR' : 'UNDECIDED');
    if (invalid) { assert.equal(state.rule, 'M0'); assert.equal(state.merged.status, 'invalid'); }
  }
});

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
    registryOptions: { registryPath: ctx.registryPath, testOnly: true, home: ctx.root, host: 'codex' },
    // Fixture origins do not exist: discovery and the status refresh never reach GitHub here.
    discoveryGh: () => ({ ok: false, reason: 'offline' }),
    refresh: () => ({ refreshed: false, error: 'offline' }),
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

// The cloud sweep copies a governed repository carries, rendered at this Toolkit checkout's commit.
function writeCloudWorkflows(repo) {
  const workflows = require(path.join(scripts, 'toolkit-cloud-workflows.cjs'));
  workflows.apply(workflows.plan({ repo, commit: workflows.toolkitHead() }));
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
    writeCloudWorkflows(repo);
  }
}

// Every file under `dir` with its content digest, to prove a command wrote nothing.
// Records the user's yes, as the governance gate does from their reply, and, where the repository has
// a binding, this computer's read of it as merged on the default branch: only a merged binding decides.
function enable(ctx, repo) {
  require('./support/governance-observations.cjs').seedMerged(repo, 'enable', { registryOptions: { registryPath: ctx.registryPath, testOnly: true } });
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
    assert.match(result.stderr, /No answer was recorded.*agent cannot answer/);
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

test('interactive yes/no publishes repository proposals without a laptop decision; decline is an alias', async t => {
  const ctx = scratch(t), repo = gitRepo(ctx, 'repo');
  for (const command of ['disable', 'decline']) {
    let open = [], writes = 0;
    const proposal = { repository: 'example-owner/example-repo', number: 1, head: 'a'.repeat(40), url: 'https://github.com/example-owner/example-repo/pull/1', state: 'open', answer: 'no' };
    const stdout = sink(), stderr = sink();
    const cli = new ToolkitGovernanceCli({ cwd: repo, registryOptions: { registryPath: ctx.registryPath, testOnly: true },
      interactive: true, ask: async () => 'yes', stdout, stderr,
      proposalTransport: { list: () => open, publish() { writes++; open = [proposal]; return proposal; }, read: () => proposal } });
    assert.equal(await cli.main([command]), 0, stderr.text());
    assert.match(stdout.text(), /decision pending[\s\S]*merge this pull request now/);
    assert.equal(governance.governanceState(repo, { registryPath: ctx.registryPath, testOnly: true }).state, 'UNDECIDED');
    assert.equal(writes, 1); assert.equal(fs.existsSync(ctx.registryPath), false);
    const status = JSON.parse((await run(ctx, repo, ['status', '--json'])).stdout);
    assert.equal(status.pending.kind, 'published');
    assert.match(status.pending.text, /merge this pull request now/);
    assert.equal(status.state, 'UNDECIDED');
    assert.equal(status.programme_records_bind, false);
    assert.match((await run(ctx, repo, ['status'])).stdout, /decision pending[\s\S]*merge this pull request now/);
  }
  const incomplete = await run(ctx, repo, ['enable', '--json']);
  assert.equal(incomplete.code, 2);
  assert.equal(JSON.parse(incomplete.stdout).pending, true);
  assert.equal(JSON.parse(incomplete.stdout).error, 'PROPOSAL_ADOPTION_INCOMPLETE');
  assert.equal(fs.existsSync(ctx.registryPath), false);
});

test('not on github.com: DISABLED automatically, enable refuses and disable is a no-op without a question', async t => {
  const ctx = scratch(t);
  for (const [name, remote, reason, text] of [
    ['no-origin', null, 'origin-missing', 'there is no github.com origin remote'],
    ['several', null, 'origin-ambiguous', 'there is more than one origin remote'],
    ['gitlab', 'https://gitlab.com/example-owner/example-repo.git', 'other-host', 'this repository is on gitlab.com'],
  ]) {
    const repo = gitRepo(ctx, name, remote);
    if (name === 'several') {
      git(repo, ['config', '--add', 'remote.origin.url', REMOTE]);
      git(repo, ['config', '--add', 'remote.origin.url', 'https://github.com/example-owner/second.git']);
    }
    const status = JSON.parse((await run(ctx, repo, ['status', '--json'])).stdout);
    assert.deepEqual([status.state, status.rule, status.hold, status.reason], ['DISABLED', 'R8', false, reason], name);
    const shown = (await run(ctx, repo, ['status'])).stdout;
    assert.match(shown, /DISABLED automatically/);
    assert.ok(shown.includes(text));
    const checked = await run(ctx, repo, ['check', '--offline', '--json']);
    assert.equal(checked.code, 0, checked.stderr);
    assert.equal(JSON.parse(checked.stdout).findings[0].id, 'NOT_GITHUB');
    const enable = await run(ctx, repo, ['enable']);
    assert.equal(enable.code, 2);
    assert.match(enable.stderr, /github.com repositories\. Nothing was written\./);
    assert.equal(enable.asked.length, 0);
    for (const interactive of [false, true]) {
      const disabled = await run(ctx, repo, ['disable', '--json'], { interactive });
      assert.equal(disabled.code, 0, disabled.stderr);
      assert.deepEqual(JSON.parse(disabled.stdout), { state: 'DISABLED', writes: 0 });
      assert.deepEqual(disabled.asked, []);
    }
    assert.equal(fs.existsSync(path.join(repo, '.ai-agent-toolkit')), false);
  }
  assert.equal(fs.existsSync(ctx.registryPath), false);
  assert.equal(fs.existsSync(path.join(path.dirname(ctx.registryPath), 'governance-not-github.v1.json')), false);
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
    // A missing machine answer is reported Off without asking a question. The governance App cannot
    // be read in a test run, so it is reported unverified and changes no exit code.
    conformant: [0, 'conformant', 'GOVERNANCE_APP_UNVERIFIED,TASK_AUTO_MERGE_UNSET'],
    stale: [1, 'drift', 'GOVERNANCE_APP_UNVERIFIED,GOVERNED_BLOCK_STALE,TASK_AUTO_MERGE_UNSET'],
    edited: [1, 'drift', 'GOVERNANCE_APP_UNVERIFIED,GOVERNED_BLOCK_EDITED,TASK_AUTO_MERGE_UNSET'],
    unasked: [1, 'drift', 'DECISION_PENDING'],
    incomplete: [1, 'drift', 'DECISION_PENDING'],
    plain: [1, 'drift', 'DECISION_PENDING'],
  });

  fs.writeFileSync(ctx.registryPath, '{damaged');
  const legacyDamage = await run(ctx, conformant, ['check', '--json']);
  assert.equal(legacyDamage.code, 0, 'retired data cannot change a merged decision');
  assert.equal(fs.readFileSync(ctx.registryPath, 'utf8'), '{damaged');
  fs.rmSync(ctx.registryPath);
  assert.deepEqual(treeDigest(ctx.root), snapshot, 'check wrote nothing');

  // The repository's task auto-merge switch is covered in toolkit-task-auto-merge.test.cjs, and
  // the governance App in toolkit-governance-app.test.cjs; these lists leave both out.
  const notTaskAutoMerge = id => !id.startsWith('TASK_AUTO_MERGE') && !id.startsWith('GOVERNANCE_APP');
  // An ENABLED repository without the no-force-push ruleset drifts; one GitHub cannot protect, or
  // that could not be checked, reports it without claiming protection or failing the check.
  const missing = await run(ctx, conformant, ['check', '--json'], { rulesetReader: () => ({ ok: true, rulesets: [] }) });
  assert.equal(missing.code, 1);
  assert.deepEqual(JSON.parse(missing.stdout).findings.map(entry => entry.id).filter(notTaskAutoMerge), ['RULESET_NO_FORCE_PUSH_MISSING']);
  for (const [reader, id, status] of [
    [() => ({ ok: false, reason: 'plan-has-no-rulesets' }), 'RULESET_NOT_ENFORCEABLE', 'not-enforceable'],
    [() => ({ ok: false, reason: 'gh-unavailable' }), 'RULESET_UNVERIFIED', 'unverified'],
  ]) {
    const result = await run(ctx, conformant, ['check', '--json'], { rulesetReader: reader });
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.code, 0, id);
    assert.deepEqual(parsed.findings.map(entry => entry.id).filter(notTaskAutoMerge), [id]);
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
  assert.deepEqual(JSON.parse(loose.stdout).findings.map(entry => entry.id).filter(notTaskAutoMerge), ['PROTECTION_MERGE_METHODS']);
  const unread = JSON.parse((await run(ctx, conformant, ['check', '--json'], { protectionReader: () => ({ ok: false, reason: 'gh-unavailable' }) })).stdout);
  assert.equal(unread.default_branch_protection.status, 'unverified');
  assert.deepEqual(unread.findings.map(entry => entry.id).filter(notTaskAutoMerge), ['PROTECTION_CHECKS_MISMATCH_UNVERIFIED', 'PROTECTION_CHECK_UNPINNED_UNVERIFIED', 'PROTECTION_MERGE_METHODS_UNVERIFIED']);
  assert.match((await run(ctx, conformant, ['check'])).stdout, /Default-branch protection: conformant/);

  // An ENABLED repository needs a current plain-text check, unless its settings record why it is off.
  const PROTECTED_RUN = { rulesetReader: PROTECTED };
  const checkIds = async () => JSON.parse((await run(ctx, conformant, ['check', '--json'], PROTECTED_RUN)).stdout).findings.map(entry => entry.id).filter(notTaskAutoMerge);
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

  // An ENABLED repository needs its cloud sweep copies; a hand edit is drift, an older pin only a note.
  const sweepCopy = path.join(conformant, '.github', 'workflows', 'toolkit-programme-sweep.yml');
  fs.rmSync(sweepCopy);
  assert.deepEqual(await checkIds(), ['CLOUD_WORKFLOW_DRIFT']);
  writeCloudWorkflows(conformant);
  fs.appendFileSync(sweepCopy, '# local edit\n');
  assert.deepEqual(await checkIds(), ['CLOUD_WORKFLOW_DRIFT']);
  writeCloudWorkflows(conformant);
  assert.deepEqual(await checkIds(), [], 'a refresh rewrites an edited copy');

  // Enabled without the binding is incomplete; disabled with a block reports it ignored.
  await run(ctx, incomplete, ['enable']);
  const enabledIncomplete = JSON.parse((await run(ctx, incomplete, ['check', '--json'])).stdout);
  assert.deepEqual(enabledIncomplete.findings.map(entry => entry.id), ['DECISION_PENDING'], 'a yes stays pending until its adoption merges');
  assert.equal(enabledIncomplete.no_force_push_ruleset, null, 'pending yes grants no governed effects');
  // A merged binding decides, so a local disable is refused; a merged disabled turns it off everywhere.
  const refusedDisable = await run(ctx, stale, ['disable']);
  assert.equal(refusedDisable.code, 2);
  assert.match(refusedDisable.stdout, /pending|not published/i);
  recordMerged(stale, { registryPath: ctx.registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'disabled' }) });
  const ignored = await run(ctx, stale, ['check', '--json']);
  assert.equal(ignored.code, 0);
  // Its cloud sweep copies were never removed, so they are reported as left over (info, exit 0).
  assert.deepEqual(JSON.parse(ignored.stdout).findings.map(entry => entry.id), ['REPOSITORY_DISABLED', 'CLOUD_WORKFLOW_LEFT_OVER', 'GOVERNED_BLOCK_IGNORED']);
  // DISABLED and UNDECIDED repositories never ask GitHub about default-branch protection.
  for (const repo of [stale, unasked]) {
    let asked = false;
    const result = JSON.parse((await run(ctx, repo, ['check', '--json'], { protectionReader: () => { asked = true; return BRANCH_PROTECTED(); } })).stdout);
    assert.equal(asked, false, repo);
    assert.equal(result.default_branch_protection, null, repo);
  }
});

test('Toolkit source wrapper exempts its checkout from the vendored plain-text check', async t => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'toolkit-source');
  writeGoverned(repo, { plainText: false });
  for (const [rel, text] of Object.entries({
    'skills/secure-ci-cd/scripts/plain-text-check.cjs': "'use strict';\n",
    'repo/scripts/check-plain-references.cjs': "'use strict';\n",
    '.github/plain-text.json': '{"schema":"toolkit-plain-text-config/v1"}\n',
  })) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  }
  enable(ctx, repo);
  const checkIds = async () => JSON.parse((await run(ctx, repo, ['check', '--json'])).stdout)
    .findings.map(entry => entry.id).filter(id => id.startsWith('PLAIN_TEXT_CHECK_'));
  assert.equal(fs.existsSync(path.join(repo, '.github', 'scripts', 'plain-text-check.cjs')), false);
  assert.deepEqual(await checkIds(), []);
  fs.rmSync(path.join(repo, 'repo', 'scripts', 'check-plain-references.cjs'));
  assert.deepEqual(await checkIds(), ['PLAIN_TEXT_CHECK_DRIFT']);
  // The other half of the exemption: the wrapper is back but the skill's source check is gone.
  fs.writeFileSync(path.join(repo, 'repo', 'scripts', 'check-plain-references.cjs'), "'use strict';\n");
  assert.deepEqual(await checkIds(), []);
  fs.rmSync(path.join(repo, 'skills', 'secure-ci-cd', 'scripts', 'plain-text-check.cjs'));
  assert.deepEqual(await checkIds(), ['PLAIN_TEXT_CHECK_DRIFT']);
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

test('S-10: governance consumers delegate authority reads and have no retired decision reader', () => {
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

test('retired repair and automatic migration routes cannot read, write or move old answers', async t => {
  const ctx = scratch(t), repo = gitRepo(ctx, 'repo');
  fs.writeFileSync(ctx.registryPath, '{damaged');
  for (const command of ['repair']) {
    const result = await run(ctx, repo, [command]);
    assert.equal(result.code, 2); assert.equal(result.asked.length, 0);
    assert.equal(fs.readFileSync(ctx.registryPath, 'utf8'), '{damaged');
  }
});
