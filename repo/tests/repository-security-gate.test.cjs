'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const moduleRoot = path.join(repoRoot, '_projects', 'cicd', 'repository-security-gate');
const mainRoot = path.join(moduleRoot, '_main');
const runnerPath = path.join(mainRoot, 'tools', 'security-gate.cjs');
const trustedRunnerPath = path.join(mainRoot, 'tools', 'trusted-security-gate.cjs');
const lockPath = path.join(mainRoot, 'config', 'tool-lock.json');
const {
  applySuppressions,
  canonicalGitPath,
  classifyRepository,
  compareRepositoryIntegrity,
  deduplicateFindings,
  enforcementControlChanges,
  genericJsonFindings,
  resolveScannerPath,
  riskClassification,
  runAdapter,
  runConsumerInvariants,
  scanToolkitRules,
  shellDescriptor,
  stableFinding,
  trackedPathInventory,
  validateSuppressions,
  validateToolLock
} = require(runnerPath);
const { buildAuthority } = require(trustedRunnerPath);

function runNode(args, cwd = repoRoot) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
}

function temporaryRepository(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-security-gate-test-'));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf8');
  }
  return root;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceDigest(filePath) {
  return sha256(fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'));
}

function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commitAll(root, message) {
  runGit(root, ['add', '--all']);
  runGit(root, ['-c', 'user.name=Toolkit Test', '-c', 'user.email=toolkit@example.invalid', 'commit', '-m', message]);
  return runGit(root, ['rev-parse', 'HEAD']);
}

function temporaryGitRepository(files) {
  const root = temporaryRepository(files);
  runGit(root, ['init', '-q']);
  const base = commitAll(root, 'base');
  return { root, base };
}

function exactPathInventory(paths) {
  const exact = new Map(paths.map((item) => [item, '100644 blob synthetic']));
  const aliases = new Map();
  for (const item of paths) {
    const folded = item.toLowerCase();
    aliases.set(folded, [...(aliases.get(folded) || []), item]);
  }
  return { exact, aliases };
}

function createTrustedAuthority(candidateRoot, candidateHead) {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-trusted-authority-test-'));
  const authorityRoot = path.join(container, 'trusted-gate');
  const packRoot = path.join(authorityRoot, 'skills', 'repository-security-gate');
  const operationRoot = path.join(container, 'operation');
  const toolsRoot = path.join(operationRoot, 'tools');
  const reportRoot = path.join(operationRoot, 'reports');
  const scannerHome = path.join(operationRoot, 'scanner-home');
  const sandboxHome = path.join(operationRoot, 'invariant-home');
  const remotes = runGit(candidateRoot, ['remote']);
  if (!remotes.split(/\r?\n/).includes('origin')) {
    runGit(candidateRoot, ['remote', 'add', 'origin', 'https://github.com/synthetic/candidate.git']);
  }
  fs.mkdirSync(packRoot, { recursive: true });
  fs.cpSync(mainRoot, packRoot, { recursive: true });
  fs.mkdirSync(path.join(authorityRoot, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(authorityRoot, '.github', 'workflows', 'repository-security-gate.yml'),
    'name: synthetic protected gate\non: pull_request_target\n',
    'utf8'
  );
  runGit(authorityRoot, ['init', '-q']);
  const authorityCommit = commitAll(authorityRoot, 'trusted authority');
  fs.mkdirSync(toolsRoot, { recursive: true });
  fs.mkdirSync(reportRoot, { recursive: true });
  fs.mkdirSync(scannerHome, { recursive: true });
  fs.mkdirSync(sandboxHome, { recursive: true });
  const workflowBytes = fs.readFileSync(
    path.join(authorityRoot, '.github', 'workflows', 'repository-security-gate.yml')
  );
  const authority = buildAuthority({
    'authority-root': authorityRoot,
    'candidate-root': candidateRoot,
    'target-repository': 'synthetic/target',
    'candidate-repository': 'synthetic/candidate',
    'candidate-head': candidateHead,
    'report-root': reportRoot,
    'tools-dir': toolsRoot,
    'scanner-home': scannerHome,
    'sandbox-home': sandboxHome,
    'authority-mode': 'protected-base',
    'invoking-workflow-commit': authorityCommit,
    'invoking-workflow-digest': `sha256:${sha256(workflowBytes)}`
  });
  return {
    container,
    authorityRoot,
    authorityCommit,
    authority,
    packRoot,
    reportRoot,
    scannerHome,
    sandboxHome,
    toolsRoot,
    runner: path.join(packRoot, 'tools', 'security-gate.cjs'),
    trustedRunner: path.join(packRoot, 'tools', 'trusted-security-gate.cjs')
  };
}

function fileRecord(root, relative) {
  const full = path.join(root, relative);
  return { relative, full, redirected: false, size: fs.lstatSync(full).size };
}

test('self-test covers all profile and malicious classification fixtures', () => {
  const result = runNode([runnerPath, 'self-test']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /12 classification cases, 12 rule cases/);
});

test('content-derived classification cannot self-declare exemption', () => {
  const root = temporaryRepository({
    'security-profile.json': '{"profile":"SECURITY_PROFILE_EXEMPT"}\n',
    '.GitHub/Workflows/check.YML': 'jobs: {}\n',
    'nested/tool.TXT': '#!/usr/bin/env node\n'
  });
  try {
    assert.equal(classifyRepository(root).profile, 'SECURITY_PROFILE_TOOLING_LIBRARY');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tool lock rejects checksum, licence, publisher, transitive binding, stale, blocked-active, and superseded-active drift', () => {
  const original = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(validateToolLock(original, new Date('2026-07-25T00:00:00Z')).valid, true);
  for (const mutate of [
    (lock) => { lock.records.find((item) => item.state === 'active' && item.kind === 'scanner').release_checksum = '0'.repeat(63); },
    (lock) => { lock.records.find((item) => item.state === 'active').license_sha256 = 'bad'; },
    (lock) => { lock.records.find((item) => item.state === 'active').upstream = 'not-an-owner-repo'; },
    (lock) => { lock.records.find((item) => item.state === 'active').publisher = 'different-publisher'; },
    (lock) => { lock.records.find((item) => item.name === 'actionlint').transitive_tools[0].selection = '-ignore'; },
    (lock) => { lock.last_verified_date = '2025-01-01'; },
    (lock) => { const item = lock.records.find((entry) => entry.state === 'active'); item.adoption_decision = 'DEFER'; },
    (lock) => { const item = lock.records.find((entry) => entry.state === 'active'); item.state = 'superseded'; item.adoption_decision = 'ADOPT'; lock.records.push({ ...item, name: `${item.name}-replacement`, state: 'active', release_checksum: null }); }
  ]) {
    const copy = structuredClone(original);
    mutate(copy);
    assert.equal(validateToolLock(copy, new Date('2026-07-25T00:00:00Z')).valid, false);
  }
});

test('an invalid provenance lock blocks scanners before execution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-security-lock-block-'));
  const copiedMain = path.join(root, 'security-gate-main');
  const repository = path.join(root, 'repository');
  try {
    fs.cpSync(mainRoot, copiedMain, { recursive: true });
    fs.mkdirSync(repository);
    fs.writeFileSync(path.join(repository, 'package.json'), '{"name":"synthetic"}\n', 'utf8');
    runGit(repository, ['init', '-q']);
    commitAll(repository, 'synthetic repository');
    const copiedLockPath = path.join(copiedMain, 'config', 'tool-lock.json');
    const copiedLock = JSON.parse(fs.readFileSync(copiedLockPath, 'utf8'));
    copiedLock.records.find((item) => item.name === 'trivy').release_checksum = '0'.repeat(63);
    fs.writeFileSync(copiedLockPath, `${JSON.stringify(copiedLock, null, 2)}\n`, 'utf8');

    const result = runNode([
      path.join(copiedMain, 'tools', 'security-gate.cjs'),
      'scan', '--mode', 'full', '--repo', repository,
      '--tools-dir', path.join(repository, 'must-not-execute')
    ], repository);
    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(repository, 'security-reports', 'security-gate.json'), 'utf8'));
    assert.equal(report.state, 'SECURITY_GATE_UNVERIFIED');
    assert.deepEqual(report.infrastructure_failures, []);
    assert.equal(report.coverage.find((item) => item.layer === 'trivy').status, 'blocked');
    assert.match(report.unverified_areas.join('\n'), /execution blocked by invalid tool provenance lock/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stable findings are deterministic and repository-relative', () => {
  const first = stableFinding('toolkit-rules', 'TKSG001', 'src\\tool.js', 4, 'unsafe   execution');
  const second = stableFinding('toolkit-rules', 'TKSG001', 'src/tool.js', 4, 'unsafe execution');
  assert.equal(first.identity, second.identity);
  assert.equal(first.path, 'src/tool.js');
  assert.doesNotMatch(JSON.stringify(first), /^[A-Za-z]:\\/);
});

test('enforcement-control changes require separate promotion review', () => {
  assert.deepEqual(enforcementControlChanges([
    'README.md',
    '.github/workflows/repository-security-gate.yml',
    'skills/repository-security-gate/config/security-policy.json',
    '_projects/cicd/repository-security-gate/_main/tools/security-gate.cjs'
  ]), [
    '.github/workflows/repository-security-gate.yml',
    'skills/repository-security-gate/config/security-policy.json',
    '_projects/cicd/repository-security-gate/_main/tools/security-gate.cjs'
  ]);
});

test('exact Git path identities preserve case and reject ambiguous case-fold scanner paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-git-path-identity-'));
  try {
    runGit(root, ['init', '-q']);
    const content = path.join(root, 'content.txt');
    fs.writeFileSync(content, 'echo synthetic\n', 'utf8');
    const blob = runGit(root, ['hash-object', '-w', content]);
    const treeInput = [
      `100644 blob ${blob}\tFoo.sh`,
      `100644 blob ${blob}\tfoo.sh`,
      `100644 blob ${blob}\tGenerated.js`,
      `100644 blob ${blob}\tgenerated.js`,
      ''
    ].join('\n');
    const treeResult = spawnSync('git', ['mktree'], {
      cwd: root,
      input: treeInput,
      encoding: 'utf8',
      windowsHide: true
    });
    assert.equal(treeResult.status, 0, treeResult.stderr);
    const tree = treeResult.stdout.trim();
    for (const ignoreCase of ['true', 'false']) {
      runGit(root, ['config', 'core.ignorecase', ignoreCase]);
      const inventory = trackedPathInventory(root, tree);
      assert.deepEqual(inventory.caseAliases, [
        ['Foo.sh', 'foo.sh'],
        ['Generated.js', 'generated.js']
      ]);
      assert.equal(resolveScannerPath(root, 'Foo.sh', inventory), 'Foo.sh');
      assert.equal(resolveScannerPath(root, 'foo.sh', inventory), 'foo.sh');
      assert.throws(() => resolveScannerPath(root, 'FOO.sh', inventory), /ambiguous/);
      assert.throws(() => resolveScannerPath(root, '../Foo.sh', inventory), /traverse/);
    }
    const upper = stableFinding('shellcheck', 'SC2086', 'Foo.sh', 1, 'Synthetic diagnostic');
    const lower = stableFinding('shellcheck', 'SC2086', 'foo.sh', 1, 'Synthetic diagnostic');
    assert.notEqual(upper.identity, lower.identity);
    const deduplicated = deduplicateFindings([upper, lower, upper]);
    assert.equal(deduplicated.findings.length, 2);
    assert.equal(deduplicated.findings.find((item) => item.path === 'Foo.sh').occurrence_count, 2);
    const upperOnly = applySuppressions(deduplicated.findings, {
      suppressions: [{
        id: 'upper-only',
        finding_identity: upper.identity,
        path: 'Foo.sh',
        rule: upper.rule,
        tool: upper.tool,
        expires: '2026-08-01'
      }]
    });
    assert.deepEqual(upperOnly.suppressed.map((item) => item.path), ['Foo.sh']);
    assert.deepEqual(upperOnly.active.map((item) => item.path), ['foo.sh']);
    assert.equal(canonicalGitPath('.\\Foo.sh'), 'Foo.sh');
    assert.notEqual(
      stableFinding('shellcheck', 'SC2086', 'Before.sh', 1, 'Synthetic diagnostic').identity,
      stableFinding('shellcheck', 'SC2086', 'before.sh', 1, 'Synthetic diagnostic').identity
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('trusted immutable checkout can certify an exempt candidate while candidate-owned gate replacements cannot self-certify', () => {
  const clean = temporaryGitRepository({ 'README.md': '# synthetic documentation\n' });
  let trusted = null;
  try {
    trusted = createTrustedAuthority(clean.root, clean.base);
    const result = runNode([
      trusted.trustedRunner, 'run',
      '--authority-root', trusted.authorityRoot,
      '--candidate-root', clean.root,
      '--target-repository', 'synthetic/target',
      '--candidate-repository', 'synthetic/candidate',
      '--candidate-head', clean.base,
      '--authority-mode', 'protected-base',
      '--invoking-workflow-commit', trusted.authorityCommit,
      '--invoking-workflow-digest', trusted.authority.bindings.workflow.sha256,
      '--mode', 'full',
      '--tools-dir', trusted.toolsRoot,
      '--report-root', trusted.reportRoot,
      '--scanner-home', trusted.scannerHome,
      '--sandbox-home', trusted.sandboxHome
    ], trusted.container);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(trusted.reportRoot, 'security-gate.json'), 'utf8'));
    assert.equal(report.state, 'SECURITY_PROFILE_EXEMPT');
    assert.equal(report.trusted_authority.commit, trusted.authorityCommit);
    assert.equal(report.trusted_authority.bindings.runner.sha256, trusted.authority.bindings.runner.sha256);
    assert.match(report.report_digest, /^sha256:[0-9a-f]{64}$/);
    const syntheticCore = require(trusted.runner);
    assert.equal(syntheticCore.validateTrustedAuthority(trusted.authority, clean.base).valid, true);
    const digestMismatch = structuredClone(trusted.authority);
    digestMismatch.bindings.runner.sha256 = `sha256:${'0'.repeat(64)}`;
    assert.equal(syntheticCore.validateTrustedAuthority(digestMismatch, clean.base).valid, false);
    fs.rmSync(path.join(trusted.packRoot, 'config', 'security-policy.json'));
    assert.equal(syntheticCore.validateTrustedAuthority(trusted.authority, clean.base).valid, false);
  } finally {
    fs.rmSync(clean.root, { recursive: true, force: true });
    if (trusted) fs.rmSync(trusted.container, { recursive: true, force: true });
  }

  const maliciousFiles = {
    '.github/workflows/repository-security-gate.yml': 'jobs:\n  fake:\n    steps:\n      - run: exit 0\n',
    'skills/repository-security-gate/tools/security-gate.cjs': "process.stdout.write('SECURITY_PASS\\n'); process.exit(0);\n",
    'skills/repository-security-gate/tools/install-pinned-tools.cjs': 'process.exit(0);\n',
    'skills/repository-security-gate/config/security-policy.json': '{"profiles":{"SECURITY_PROFILE_EXEMPT":{}}}\n',
    'skills/repository-security-gate/config/tool-lock.json': '{"records":[]}\n',
    'skills/repository-security-gate/rules/toolkit-rules.json': '{"rules":[]}\n',
    'skills/repository-security-gate/schemas/suppressions.schema.json': '{"additionalProperties":true}\n',
    'security/security-gate-invariants.json': '{"schema_version":1,"profile":"SECURITY_PROFILE_WEB_API","tests":[]}\n',
    'security-reports/security-gate.json': '{"state":"SECURITY_PASS","counterfeit":true}\n'
  };
  const malicious = temporaryGitRepository(maliciousFiles);
  trusted = null;
  try {
    trusted = createTrustedAuthority(malicious.root, malicious.base);
    const result = runNode([
      trusted.trustedRunner, 'run',
      '--authority-root', trusted.authorityRoot,
      '--candidate-root', malicious.root,
      '--target-repository', 'synthetic/target',
      '--candidate-repository', 'synthetic/candidate',
      '--candidate-head', malicious.base,
      '--authority-mode', 'protected-base',
      '--invoking-workflow-commit', trusted.authorityCommit,
      '--invoking-workflow-digest', trusted.authority.bindings.workflow.sha256,
      '--mode', 'full',
      '--tools-dir', trusted.toolsRoot,
      '--report-root', trusted.reportRoot,
      '--scanner-home', trusted.scannerHome,
      '--sandbox-home', trusted.sandboxHome
    ], trusted.container);
    assert.notEqual(result.status, 0);
    const report = JSON.parse(fs.readFileSync(path.join(trusted.reportRoot, 'security-gate.json'), 'utf8'));
    assert.notEqual(report.state, 'SECURITY_PASS');
    assert.equal(report.trusted_authority.commit, trusted.authorityCommit);
    assert.equal(JSON.parse(fs.readFileSync(path.join(malicious.root, 'security-reports', 'security-gate.json'))).counterfeit, true);
  } finally {
    fs.rmSync(malicious.root, { recursive: true, force: true });
    if (trusted) fs.rmSync(trusted.container, { recursive: true, force: true });
  }
});

test('candidate mutation is detected and invariant subprocesses receive no credential environment', () => {
  const state = temporaryGitRepository({
    'src/app.js': 'module.exports = true;\n',
    'security/security-gate-invariants.json': `${JSON.stringify({
      schema_version: 1,
      profile: 'SECURITY_PROFILE_WEB_API',
      tests: [{ id: 'credential-boundary', runner: 'node', path: 'security/invariants/credential.cjs', timeout_seconds: 5 }]
    })}\n`,
    'security/invariants/credential.cjs': [
      "const leaked = process.env.SYNTHETIC_GATE_SECRET || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;",
      "process.stdout.write(JSON.stringify({schema_version:1,test_id:'credential-boundary',status:leaked?'FINDINGS':'PASS',evidence:['credential environment absent']}));",
      ''
    ].join('\n')
  });
  const previous = process.env.SYNTHETIC_GATE_SECRET;
  process.env.SYNTHETIC_GATE_SECRET = 'synthetic-do-not-propagate';
  try {
    const inventory = trackedPathInventory(state.root, state.base);
    const expected = {
      head: state.base,
      tree: runGit(state.root, ['rev-parse', `${state.base}^{tree}`]),
      manifest_sha256: inventory.manifest_sha256,
      tracked_files: inventory.count,
      status: ''
    };
    const invariant = runConsumerInvariants(
      state.root,
      'SECURITY_PROFILE_WEB_API',
      'security/security-gate-invariants.json',
      'full',
      null,
      state.base
    );
    assert.deepEqual(invariant.failures, []);
    assert.deepEqual(invariant.findings, []);
    fs.writeFileSync(path.join(state.root, 'src', 'app.js'), 'module.exports = false;\n', 'utf8');
    assert.equal(compareRepositoryIntegrity(state.root, expected).valid, false);
  } finally {
    if (previous === undefined) delete process.env.SYNTHETIC_GATE_SECRET;
    else process.env.SYNTHETIC_GATE_SECRET = previous;
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('scanner findings preserve diagnostics, deduplicate exact repeats, and fail closed on collisions', () => {
  const parsed = [
    { kind: 'shellcheck', filepath: '.github\\workflows\\ci.yml', line: 7, column: 3, message: 'shellcheck reported SC2086' },
    { kind: 'shellcheck', filepath: '.github/workflows/ci.yml', line: 7, column: 3, message: 'shellcheck reported SC2046' },
    { kind: 'shellcheck', filepath: '.github/workflows/ci.yml', line: 7, column: 3, message: 'shellcheck reported SC2086' }
  ];
  const findings = genericJsonFindings('actionlint', repoRoot, parsed, {
    pathInventory: exactPathInventory(['.github/workflows/ci.yml'])
  });
  assert.notEqual(findings[0].identity, findings[1].identity);
  assert.equal(findings[0].identity, findings[2].identity);
  assert.doesNotMatch(JSON.stringify(findings), /reported SC/);
  const normalized = deduplicateFindings(findings);
  assert.equal(normalized.findings.length, 2);
  assert.equal(normalized.findings.find((item) => item.identity === findings[0].identity).occurrence_count, 2);
  assert.deepEqual(normalized.duplicates, [{ identity: findings[0].identity, occurrence_count: 2 }]);
  assert.deepEqual(normalized.collisions, []);

  const collided = deduplicateFindings([
    findings[0],
    { ...findings[1], identity: findings[0].identity }
  ]);
  assert.deepEqual(collided.collisions, [findings[0].identity]);

  const applied = applySuppressions(normalized.findings, {
    suppressions: [{
      id: 'one',
      finding_identity: findings[0].identity,
      path: findings[0].path,
      rule: findings[0].rule,
      tool: findings[0].tool,
      expires: '2026-08-01'
    }]
  });
  assert.equal(applied.suppressed.length, 1);
  assert.equal(applied.active.length, 1);
  assert.equal(applied.active[0].identity, findings[1].identity);
});

test('suppressions require real authority, introduction, source, and executed test evidence', () => {
  const contents = 'synthetic fixture\n';
  const testContents = "'use strict';\nprocess.stdout.write('ok\\n');\n";
  const { root, base: introductionCommit } = temporaryGitRepository({
    'fixtures/synthetic/sample.txt': contents,
    'repo/tests/compensating.test.cjs': testContents
  });
  const executedTests = new Map([['repo/tests/compensating.test.cjs', sha256(testContents)]]);
  const valid = {
    schema_version: 3,
    suppressions: [{
      id: 'synthetic-one',
      tool: 'toolkit-rules',
      rule: 'TKSG006',
      finding_identity: 'a'.repeat(64),
      path: 'fixtures/synthetic/sample.txt',
      scope: 'synthetic_fixture',
      exploitability_rationale: 'Synthetic fixture only.',
      approver_reference: 'https://github.com/weijunswj/ai-agent-toolkit/issues/284',
      introduction_commit: introductionCommit,
      expires: '2026-08-23',
      compensating_test: 'repo/tests/compensating.test.cjs',
      compensating_test_sha256: sha256(testContents),
      tool_version: '1.2.0',
      rule_version: '1.2.0',
      source_sha256: sha256(contents)
    }]
  };
  try {
    const options = { executedTests };
    const initial = validateSuppressions(valid, root, new Date('2026-07-23T00:00:00Z'), options);
    assert.equal(initial.valid, true, initial.errors.join('\n'));
    const wildcard = structuredClone(valid);
    wildcard.suppressions[0].path = '**/*';
    assert.equal(validateSuppressions(wildcard, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const expired = structuredClone(valid);
    expired.suppressions[0].expires = '2026-07-22';
    assert.equal(validateSuppressions(expired, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const permanent = structuredClone(valid);
    permanent.suppressions[0].expires = '2027-07-23';
    assert.equal(validateSuppressions(permanent, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const changed = structuredClone(valid);
    changed.suppressions[0].source_sha256 = 'c'.repeat(64);
    assert.equal(validateSuppressions(changed, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const incorrectCase = structuredClone(valid);
    incorrectCase.suppressions[0].path = 'fixtures/synthetic/Sample.txt';
    assert.equal(validateSuppressions(incorrectCase, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const versionDrift = structuredClone(valid);
    versionDrift.suppressions[0].rule_version = '2.0.0';
    assert.equal(validateSuppressions(versionDrift, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const fakeCommit = structuredClone(valid);
    fakeCommit.suppressions[0].introduction_commit = 'b'.repeat(40);
    assert.equal(validateSuppressions(fakeCommit, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const missingTest = structuredClone(valid);
    missingTest.suppressions[0].compensating_test = 'repo/tests/missing.test.cjs';
    assert.equal(validateSuppressions(missingTest, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const nonExecuted = validateSuppressions(valid, root, new Date('2026-07-23T00:00:00Z'), { executedTests: new Map() });
    assert.equal(nonExecuted.valid, false);
    const badApproval = structuredClone(valid);
    badApproval.suppressions[0].approver_reference = 'issue-284';
    assert.equal(validateSuppressions(badApproval, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const testDrift = structuredClone(valid);
    testDrift.suppressions[0].compensating_test_sha256 = 'd'.repeat(64);
    assert.equal(validateSuppressions(testDrift, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const toolDrift = structuredClone(valid);
    toolDrift.suppressions[0].tool_version = '9.9.9';
    assert.equal(validateSuppressions(toolDrift, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
    const duplicate = structuredClone(valid);
    duplicate.suppressions.push({ ...duplicate.suppressions[0], id: 'synthetic-two' });
    assert.equal(validateSuppressions(duplicate, root, new Date('2026-07-23T00:00:00Z'), options).valid, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing scanners and invalid mode inputs fail closed without raw source output', () => {
  const { root } = temporaryGitRepository({ 'src/index.js': 'module.exports = 1;\n', 'package.json': '{}\n' });
  try {
    const scan = runNode([runnerPath, 'scan', '--mode', 'full', '--repo', root, '--tools-dir', path.join(root, 'missing')], root);
    assert.equal(scan.status, 2);
    const report = JSON.parse(fs.readFileSync(path.join(root, 'security-reports', 'security-gate.json'), 'utf8'));
    assert.equal(report.state, 'SECURITY_GATE_INFRA_BLOCKED');
    assert.ok(report.infrastructure_failures.length > 0);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    assert.doesNotMatch(JSON.stringify(report), /module\.exports = 1/);
    const invalid = runNode([runnerPath, 'scan', '--mode', 'unknown', '--repo', root], root);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /SECURITY_GATE_UNVERIFIED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('actionlint binds the verified ShellCheck path and ignores a PATH decoy', () => {
  const { root } = temporaryGitRepository({
    '.github/workflows/ci.yml': 'name: ci\non: push\njobs: {}\n',
    [`tools/${process.platform === 'win32' ? 'actionlint.exe' : 'actionlint'}`]: 'verified actionlint\n',
    [`tools/${process.platform === 'win32' ? 'shellcheck.exe' : 'shellcheck'}`]: 'verified shellcheck\n',
    [`decoy/${process.platform === 'win32' ? 'shellcheck.exe' : 'shellcheck'}`]: 'decoy shellcheck\n'
  });
  const files = [fileRecord(root, '.github/workflows/ci.yml')];
  const tools = path.join(root, 'tools');
  const decoySentinel = path.join(root, 'decoy-ran');
  const verifiedSentinel = path.join(root, 'verified-ran');
  try {
    const result = runAdapter('actionlint', root, tools, files, {
      env: { ...process.env, PATH: `${path.join(root, 'decoy')}${path.delimiter}${process.env.PATH || ''}` },
      execute(command, args) {
        assert.equal(command, path.join(tools, process.platform === 'win32' ? 'actionlint.exe' : 'actionlint'));
        const selection = args.indexOf('-shellcheck');
        assert.ok(selection >= 0);
        assert.equal(args[selection + 1], path.join(tools, process.platform === 'win32' ? 'shellcheck.exe' : 'shellcheck'));
        fs.writeFileSync(verifiedSentinel, 'selected\n', 'utf8');
        return {
          status: 1,
          stdout: [
            JSON.stringify({ kind: 'syntax-check', filepath: '.github/workflows/ci.yml', line: 3, column: 1, message: 'jobs section is invalid' }),
            JSON.stringify({ kind: 'shellcheck', filepath: '.github/workflows/ci.yml', line: 3, column: 1, message: 'shellcheck reported SC2086' })
          ].join('\n'),
          stderr: '',
          error: null
        };
      }
    });
    assert.equal(result.status, 'complete');
    assert.equal(result.findings.length, 2);
    assert.equal(fs.existsSync(verifiedSentinel), true);
    assert.equal(fs.existsSync(decoySentinel), false);
    assert.match(result.evidence.shellcheck_selection, /-shellcheck/);
    fs.rmSync(path.join(tools, process.platform === 'win32' ? 'shellcheck.exe' : 'shellcheck'));
    const missing = runAdapter('actionlint', root, tools, files, { execute: () => assert.fail('must not execute') });
    assert.equal(missing.status, 'missing');
    assert.match(missing.failure, /transitive ShellCheck/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ShellCheck and first-party shell rules cover shebang and misleading-extension executables', () => {
  const { root } = temporaryGitRepository({
    'bin/bash-tool': '#!/usr/bin/env bash\neval \"$INPUT\"\n',
    'scripts/misleading.txt': '#!/bin/bash\necho \"$value\"\n',
    'bin/posix-tool': '#!/bin/sh\necho \"$value\"\n',
    'bin/unsupported': '#!/usr/bin/env zsh\necho \"$value\"\n',
    'NOTICE': 'ordinary extensionless text\n',
    [`tools/${process.platform === 'win32' ? 'shellcheck.exe' : 'shellcheck'}`]: 'verified shellcheck\n'
  });
  const files = [
    fileRecord(root, 'bin/bash-tool'),
    fileRecord(root, 'scripts/misleading.txt'),
    fileRecord(root, 'bin/posix-tool'),
    fileRecord(root, 'bin/unsupported'),
    fileRecord(root, 'NOTICE')
  ];
  const invocations = [];
  try {
    assert.equal(shellDescriptor(files[0]).dialect, 'bash');
    assert.equal(shellDescriptor(files[1]).dialect, 'bash');
    assert.equal(shellDescriptor(files[2]).dialect, 'sh');
    assert.equal(shellDescriptor(files[3]).dialect, null);
    assert.equal(shellDescriptor(files[4]), null);
    const result = runAdapter('shellcheck', root, path.join(root, 'tools'), files, {
      execute(command, args) {
        invocations.push({ command, args });
        return { status: 0, stdout: '[]', stderr: '', error: null };
      }
    });
    assert.equal(result.status, 'unverified');
    assert.equal(invocations.length, 3);
    assert.ok(invocations.some((item) => item.args.includes('--shell=bash') && item.args.includes(files[0].full)));
    assert.ok(invocations.some((item) => item.args.includes('--shell=bash') && item.args.includes(files[1].full)));
    assert.ok(invocations.some((item) => item.args.includes('--shell=sh') && item.args.includes(files[2].full)));
    assert.match(result.unverified.join('\n'), /unsupported shell interpreter zsh/);
    const ruleFindings = scanToolkitRules(root, files);
    assert.ok(ruleFindings.some((item) => item.rule === 'TKSG003' && item.path === 'bin/bash-tool'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PR mode binds the exact clean checkout but candidate-owned execution remains unverified', () => {
  function createPair() {
    const state = temporaryGitRepository({ '.gitignore': 'security-reports/\n', 'README.md': '# base\n' });
    fs.writeFileSync(path.join(state.root, 'README.md'), '# head\n', 'utf8');
    state.head = commitAll(state.root, 'head');
    return state;
  }
  const ordinary = createPair();
  try {
    const match = runNode([
      runnerPath, 'scan', '--mode', 'pr', '--repo', ordinary.root,
      '--base', ordinary.base, '--head', ordinary.head, '--internal-only'
    ], ordinary.root);
    assert.equal(match.status, 2, match.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(ordinary.root, 'security-reports', 'security-gate.json'), 'utf8'));
    assert.equal(report.head, ordinary.head);
    assert.equal(report.scanned_head_digest, `git-sha1:${ordinary.head}`);
    assert.equal(report.state, 'SECURITY_GATE_UNVERIFIED');
    assert.match(report.unverified_areas.join('\n'), /trusted authority manifest was not supplied/);
  } finally {
    fs.rmSync(ordinary.root, { recursive: true, force: true });
  }

  const detached = createPair();
  try {
    runGit(detached.root, ['checkout', '--detach', detached.head]);
    const match = runNode([
      runnerPath, 'scan', '--mode', 'pr', '--repo', detached.root,
      '--base', detached.base, '--head', detached.head, '--internal-only'
    ], detached.root);
    assert.equal(match.status, 2, match.stderr);
  } finally {
    fs.rmSync(detached.root, { recursive: true, force: true });
  }
});

test('PR mode rejects mismatched, missing, unreachable, and dirty exact-head claims before reports', () => {
  for (const scenario of ['supplied-base-as-head', 'nonexistent-base', 'nonexistent-head', 'checkout-at-base', 'dirty-tree']) {
    const state = temporaryGitRepository({ '.gitignore': 'security-reports/\n', 'README.md': '# base\n' });
    fs.writeFileSync(path.join(state.root, 'README.md'), '# head\n', 'utf8');
    const head = commitAll(state.root, 'head');
    let baseArg = state.base;
    let headArg = head;
    if (scenario === 'supplied-base-as-head') headArg = state.base;
    if (scenario === 'nonexistent-base') baseArg = 'a'.repeat(40);
    if (scenario === 'nonexistent-head') headArg = 'b'.repeat(40);
    if (scenario === 'checkout-at-base') runGit(state.root, ['checkout', '--detach', state.base]);
    if (scenario === 'dirty-tree') fs.writeFileSync(path.join(state.root, 'unscanned.js'), 'process.exit(0)\n', 'utf8');
    try {
      const result = runNode([
        runnerPath, 'scan', '--mode', 'pr', '--repo', state.root,
        '--base', baseArg, '--head', headArg, '--internal-only'
      ], state.root);
      assert.equal(result.status, 2, `${scenario}: ${result.stderr}`);
      assert.equal(fs.existsSync(path.join(state.root, 'security-reports', 'security-gate.json')), false);
      assert.doesNotMatch(result.stdout, new RegExp(headArg));
    } finally {
      fs.rmSync(state.root, { recursive: true, force: true });
    }
  }
});

test('release mode preserves exact-head and clean-tree guarantees while direct full and scheduled scans cannot self-certify', () => {
  const { root } = temporaryGitRepository({ 'README.md': '# documentation\n' });
  try {
    for (const mode of ['full', 'scheduled']) {
      const result = runNode([runnerPath, 'scan', '--mode', mode, '--repo', root], root);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stdout, /SECURITY_GATE_UNVERIFIED/);
    }
    assert.equal(runNode([runnerPath, 'scan', '--mode', 'pr', '--repo', root], root).status, 2);
    assert.equal(runNode([runnerPath, 'scan', '--mode', 'release', '--repo', root, '--head', '0'.repeat(40)], root).status, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const state = temporaryGitRepository({ '.gitignore': 'security-reports/\n', 'README.md': '# release\n' });
  try {
    const result = runNode([
      runnerPath, 'scan', '--mode', 'release', '--repo', state.root,
      '--head', state.base, '--internal-only'
    ], state.root);
    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(state.root, 'security-reports', 'security-gate.json'), 'utf8'));
    assert.equal(report.scanned_head_digest, `git-sha1:${state.base}`);
    assert.equal(report.state, 'SECURITY_GATE_UNVERIFIED');
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('AI risk classifier skips docs and triggers on security-sensitive executable changes', () => {
  assert.deepEqual(riskClassification(['README.md', 'docs/guide.md']), { required: false, sensitive: [] });
  const result = riskClassification(['src/auth/session.ts', '.github/workflows/release.yml']);
  assert.equal(result.required, true);
  assert.deepEqual(result.sensitive, ['src/auth/session.ts', '.github/workflows/release.yml']);
});

test('consumer invariant manifests execute bounded WEB_API and WORKFLOW_INTEGRATION attacker contracts', () => {
  for (const profile of ['SECURITY_PROFILE_WEB_API', 'SECURITY_PROFILE_WORKFLOW_INTEGRATION']) {
    const id = profile === 'SECURITY_PROFILE_WEB_API' ? 'web-auth-boundary' : 'workflow-authority-boundary';
    const root = temporaryRepository({
      'security/security-gate-invariants.json': `${JSON.stringify({
        schema_version: 1,
        profile,
        tests: [{ id, runner: 'node', path: 'security/invariants/attacker.cjs', timeout_seconds: 5 }]
      }, null, 2)}\n`,
      'security/invariants/attacker.cjs': `process.stdout.write(JSON.stringify({schema_version:1,test_id:${JSON.stringify(id)},status:'PASS',evidence:['synthetic attacker boundary passed']}));\n`
    });
    try {
      const result = runConsumerInvariants(
        root,
        profile,
        'security/security-gate-invariants.json',
        'pr',
        'a'.repeat(40),
        'b'.repeat(40)
      );
      assert.deepEqual(result.failures, []);
      assert.deepEqual(result.findings, []);
      assert.equal(result.consumed[0].status, 'PASS');
      assert.equal(result.executedTests.get('security/invariants/attacker.cjs'), sha256(fs.readFileSync(path.join(root, 'security/invariants/attacker.cjs'), 'utf8')));
      assert.equal(result.base, 'a'.repeat(40));
      assert.equal(result.head, 'b'.repeat(40));
      assert.match(result.manifest_sha256, /^[0-9a-f]{64}$/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('consumer invariant contract rejects missing, traversal, arbitrary shell, timeout, malformed, private, and failing evidence', () => {
  function executeCase(manifest, script, manifestPath = 'security/security-gate-invariants.json') {
    const files = {};
    if (manifest) files['security/security-gate-invariants.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
    if (script !== null) files['security/invariants/test.cjs'] = script;
    const root = temporaryRepository(files);
    const result = runConsumerInvariants(
      root,
      'SECURITY_PROFILE_WEB_API',
      manifestPath,
      'full',
      null,
      'a'.repeat(40)
    );
    return { root, result };
  }
  const baseManifest = {
    schema_version: 1,
    profile: 'SECURITY_PROFILE_WEB_API',
    tests: [{ id: 'attacker', runner: 'node', path: 'security/invariants/test.cjs', timeout_seconds: 1 }]
  };
  const cases = [
    executeCase(null, null),
    executeCase(baseManifest, null, '../outside.json'),
    executeCase({ ...baseManifest, tests: [{ ...baseManifest.tests[0], command: 'node test && mutate' }] }, 'process.exit(0);\n'),
    executeCase(baseManifest, 'while (true) {}\n'),
    executeCase(baseManifest, "process.stdout.write('not json');\n"),
    executeCase(baseManifest, `process.stdout.write(JSON.stringify({schema_version:1,test_id:'attacker',status:'PASS',evidence:[${JSON.stringify(repoRoot)}]}));\n`),
    executeCase(baseManifest, "process.stdout.write(JSON.stringify({schema_version:1,test_id:'attacker',status:'FINDINGS',evidence:['synthetic failure']}));\n")
  ];
  try {
    for (const { result } of cases) {
      assert.ok(result.failures.length > 0 || result.findings.length > 0);
      assert.doesNotMatch(JSON.stringify(result), new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
    assert.match(cases[0].result.failures.join('\n'), /manifest is missing/);
    assert.match(cases[1].result.failures.join('\n'), /manifest path is invalid/);
    assert.match(cases[2].result.failures.join('\n'), /entry is invalid/);
    assert.match(cases[3].result.failures.join('\n'), /did not complete/);
    assert.match(cases[4].result.failures.join('\n'), /malformed or unsafe/);
    assert.match(cases[5].result.failures.join('\n'), /malformed or unsafe/);
    assert.equal(cases[6].result.findings.length, 1);
  } finally {
    for (const { root } of cases) fs.rmSync(root, { recursive: true, force: true });
  }
});

test('consumer and suppression contracts reject symlinked compensating tests when supported', (t) => {
  const { root, base } = temporaryGitRepository({
    'fixtures/synthetic/sample.txt': 'fixture\n',
    'repo/tests/real.test.cjs': "process.stdout.write('ok');\n"
  });
  const linked = path.join(root, 'repo', 'tests', 'linked.test.cjs');
  try {
    try {
      fs.symlinkSync(path.join(root, 'repo', 'tests', 'real.test.cjs'), linked, 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
        t.skip(`File symlinks are unavailable on this host: ${error.code}`);
        return;
      }
      throw error;
    }
    const consumerManifest = {
      schema_version: 1,
      profile: 'SECURITY_PROFILE_WEB_API',
      tests: [{ id: 'linked', runner: 'node', path: 'repo/tests/linked.test.cjs', timeout_seconds: 5 }]
    };
    fs.mkdirSync(path.join(root, 'security'), { recursive: true });
    fs.writeFileSync(path.join(root, 'security', 'security-gate-invariants.json'), `${JSON.stringify(consumerManifest)}\n`, 'utf8');
    const consumer = runConsumerInvariants(
      root,
      'SECURITY_PROFILE_WEB_API',
      'security/security-gate-invariants.json',
      'full',
      null,
      base
    );
    assert.match(consumer.failures.join('\n'), /redirected/);

    const document = {
      schema_version: 3,
      suppressions: [{
        id: 'linked-test',
        tool: 'toolkit-rules',
        rule: 'TKSG006',
        finding_identity: 'a'.repeat(64),
        path: 'fixtures/synthetic/sample.txt',
        scope: 'synthetic_fixture',
        exploitability_rationale: 'Synthetic fixture only.',
        approver_reference: 'https://github.com/weijunswj/ai-agent-toolkit/issues/284',
        introduction_commit: base,
        expires: '2026-08-23',
        compensating_test: 'repo/tests/linked.test.cjs',
        compensating_test_sha256: sourceDigest(path.join(root, 'repo/tests/real.test.cjs')),
        tool_version: '1.2.0',
        rule_version: '1.2.0',
        source_sha256: sha256('fixture\n')
      }]
    };
    const suppression = validateSuppressions(document, root, new Date('2026-07-23T00:00:00Z'), {
      executedTests: new Map([['repo/tests/linked.test.cjs', sourceDigest(path.join(root, 'repo/tests/real.test.cjs'))]])
    });
    assert.equal(suppression.valid, false);
    assert.match(suppression.errors.join('\n'), /regular repository file/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('review packet classifies the complete changed-file manifest before bounded inclusion', () => {
  const state = temporaryGitRepository({
    '.gitignore': 'security-reports/\n',
    'README.md': '# base\n'
  });
  let trusted = null;
  try {
    for (let index = 0; index < 200; index += 1) {
      const relative = `docs/${String(index).padStart(3, '0')}.md`;
      const full = path.join(state.root, relative);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `# Doc ${index}\n`, 'utf8');
    }
    fs.mkdirSync(path.join(state.root, 'z-auth'), { recursive: true });
    fs.writeFileSync(path.join(state.root, 'z-auth', 'session.ts'), 'export const session = true;\n', 'utf8');
    const head = commitAll(state.root, 'large manifest');
    trusted = createTrustedAuthority(state.root, head);
    const inventory = trackedPathInventory(state.root, head);
    const unsignedReport = {
      schema_version: 3,
      gate_version: '1.2.0',
      state: 'SECURITY_PASS',
      repository: 'synthetic/repository',
      candidate_repository: 'synthetic/candidate',
      mode: 'pr',
      base: state.base,
      head,
      scanned_head_digest: `git-sha1:${head}`,
      scanned_tree_digest: `git-sha1:${runGit(state.root, ['rev-parse', `${head}^{tree}`])}`,
      scanned_manifest_digest: `sha256:${inventory.manifest_sha256}`,
      artifact_digest: null,
      profile: 'SECURITY_PROFILE_TOOLING_LIBRARY',
      trusted_authority: trusted.authority,
      path_identity: {
        contract: 'exact-git-path-case-v1',
        tracked_files: inventory.count,
        manifest_digest: `sha256:${inventory.manifest_sha256}`,
        case_fold_aliases: inventory.caseAliases
      },
      versions: {},
      coverage: [],
      findings: [],
      finding_duplicates: [],
      suppressed_findings: [],
      unverified_areas: []
      ,
      infrastructure_failures: [],
      next_action: 'Synthetic trusted evidence.'
    };
    const report = {
      ...unsignedReport,
      report_digest: `sha256:${sha256(`${JSON.stringify(unsignedReport)}\n`)}`
    };
    const reportPath = path.join(trusted.reportRoot, 'security-gate.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report)}\n`, 'utf8');
    const packetPath = path.join(trusted.reportRoot, 'packet.json');
    const result = runNode([
      trusted.runner, 'review-packet', '--repo', state.root,
      '--base', state.base, '--head', head,
      '--report', reportPath,
      '--report-root', trusted.reportRoot,
      '--output', 'packet.json'
    ], state.root);
    assert.equal(result.status, 0, result.stderr);
    const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
    assert.equal(packet.risk_review_required, true);
    assert.equal(packet.changed_file_manifest.total_count, 201);
    assert.equal(packet.changed_file_manifest.included_count, 200);
    assert.equal(packet.changed_file_manifest.omitted_count, 1);
    assert.match(packet.changed_file_manifest.sha256, /^[0-9a-f]{64}$/);
    assert.ok(packet.changed_files.includes('z-auth/session.ts'));
    assert.ok(packet.sensitive_locations.some((item) => item.path === 'z-auth/session.ts'));
    const second = runNode([
      trusted.runner, 'review-packet', '--repo', state.root,
      '--base', state.base, '--head', head,
      '--report', reportPath,
      '--report-root', trusted.reportRoot,
      '--output', 'packet.json'
    ], state.root);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(fs.readFileSync(packetPath, 'utf8')).changed_file_manifest.sha256, packet.changed_file_manifest.sha256);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
    if (trusted) fs.rmSync(trusted.container, { recursive: true, force: true });
  }
});

test('workflow uses protected trusted authority and treats the exact PR checkout as untrusted data', () => {
  const gate = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'repository-security-gate.yml'), 'utf8');
  const trustedRunner = fs.readFileSync(trustedRunnerPath, 'utf8');
  const candidate = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'security-candidate-validation.yml'), 'utf8');
  assert.match(gate, /^  pull_request:/m);
  assert.match(gate, /^  pull_request_target:/m);
  assert.match(gate, /permissions:\r?\n  contents: read\r?\n  pull-requests: read/);
  assert.doesNotMatch(gate, /\bsecrets\./);
  assert.match(gate, /path: trusted-gate[\s\S]*persist-credentials: false/);
  assert.match(gate, /path: candidate[\s\S]*persist-credentials: false/);
  assert.match(gate, /candidate_repository="\$PR_REPOSITORY"/);
  assert.match(gate, /git -c protocol\.version=2 -C candidate fetch --no-tags --depth=1/);
  assert.match(gate, /trusted-security-gate\.cjs/);
  assert.match(gate, /GH_TOKEN: ""[\s\S]*GITHUB_TOKEN: ""/);
  assert.match(gate, /PR head changed after trusted scan/);
  assert.match(gate, /gh api "repos\/\$GITHUB_REPOSITORY\/pulls\/\$PR_NUMBER"/);
  assert.match(gate, /chmod 700 "\$reports"/);
  assert.match(gate, /sudo chown -R root:root trusted-gate candidate/);
  assert.match(gate, /sudo chmod -R a-w trusted-gate candidate/);
  assert.match(gate, /git config --file "\$sandbox_home\/\.gitconfig" --add safe\.directory "\$GITHUB_WORKSPACE\/candidate"[\s\S]*sudo chown -R toolkitgate:toolkitgate "\$sandbox_home"/);
  assert.match(gate, /CANDIDATE_REPOSITORY: \$\{\{ steps\.evidence\.outputs\.candidate_repository \}\}[\s\S]*--candidate-repository "\$CANDIDATE_REPOSITORY"/);
  const bootstrapAuthority = gate.match(/authority_commit="([0-9a-f]{40})"/);
  assert.ok(bootstrapAuthority, 'bootstrap authority must be pinned to an exact commit');
  assert.doesNotMatch(gate, /__TK023_BOOTSTRAP_AUTHORITY_COMMIT__/);
  runGit(repoRoot, ['cat-file', '-e', `${bootstrapAuthority[1]}^{commit}`]);
  assert.doesNotMatch(gate, /working-directory: candidate/);
  assert.match(trustedRunner, /cwd: authorityRoot/);
  assert.doesNotMatch(trustedRunner, /NODE_PATH/);
  assert.doesNotMatch(trustedRunner, /env:\s*process\.env/);
  assert.match(candidate, /^  workflow_dispatch:/m);
  assert.doesNotMatch(candidate, /^  pull_request:/m);
  assert.match(candidate, /ref: refs\/heads\/main/);
  for (const workflow of [gate, candidate]) {
    assert.doesNotMatch(workflow, /uses:\s+[^@\s]+@(?:main|master|v?\d+(?:\.\d+)*)\s*$/m);
  }
});

test('guarded auto-sync suppression is backed by executable trust-boundary evidence', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), 'utf8');
  const preflightIndex = workflow.indexOf('- name: Preflight guard');
  const trustedCheckoutIndex = workflow.indexOf('- name: Checkout trusted base revision');
  const prCheckoutIndex = workflow.indexOf('- name: Checkout PR head commit');
  const syncIndex = workflow.indexOf('- name: Sync deterministic generated surfaces');
  const pushIndex = workflow.indexOf('- name: Push generated surfaces');

  assert.match(workflow, /^  pull_request_target:/m);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /if \(\( changed_file_count > 3000 \)\)/);
  assert.match(workflow, /current_head_sha[\s\S]*if \[\[ "\$current_head_sha" != "\$HEAD_SHA" \]\]/);
  assert.ok(preflightIndex >= 0 && preflightIndex < trustedCheckoutIndex);
  assert.ok(trustedCheckoutIndex < prCheckoutIndex && prCheckoutIndex < syncIndex && syncIndex < pushIndex);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}[\s\S]*path: trusted[\s\S]*persist-credentials: false/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}[\s\S]*path: pr[\s\S]*persist-credentials: false/);
  assert.match(workflow, /node "\$TRUSTED_ROOT\/repo\/scripts\/sync-toolkit-projects\.cjs" --workspace "\$PR_ROOT" --write/);
  assert.match(workflow, /remote_head_sha[\s\S]*if \[\[ "\$remote_head_sha" != "\$HEAD_SHA" \]\][\s\S]*push origin "HEAD:\$\{HEAD_REF\}"/);
});

test('authoritative surfaces contain no mandatory Codex Security workflow', () => {
  const targets = [
    path.join(repoRoot, '_projects', 'development', 'project-completion-audit', '_main', 'skill', 'SKILL.md'),
    path.join(repoRoot, '_projects', 'development', 'ai-coding-agent-rules', '_main', 'repo-local', 'docs', 'agent-playbooks', 'project-completion-audit.md')
  ];
  for (const target of targets) {
    const text = fs.readFileSync(target, 'utf8');
    assert.doesNotMatch(text, /invoke Codex Security|open (?:a )?Security workspace|press Start scan|continue a blocked scan/i);
    assert.match(text, /repository-owned security gate/i);
  }
});

test('source-watch remains notification-only and candidate validation is a separate handoff', () => {
  const sourceWatch = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'source-watch-pr.yml'), 'utf8');
  const candidate = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'security-candidate-validation.yml'), 'utf8');
  assert.match(sourceWatch, /cron: ['"]17 \* \* \* \*['"]/);
  assert.doesNotMatch(sourceWatch, /install-pinned-tools|security-candidate-validation/);
  assert.match(candidate, /manual_review_required/);
  assert.match(candidate, /workflow_dispatch/);
});
