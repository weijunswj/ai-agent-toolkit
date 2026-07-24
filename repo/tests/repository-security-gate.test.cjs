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
const lockPath = path.join(mainRoot, 'config', 'tool-lock.json');
const {
  applySuppressions,
  classifyRepository,
  deduplicateFindings,
  genericJsonFindings,
  riskClassification,
  runAdapter,
  runConsumerInvariants,
  scanToolkitRules,
  shellDescriptor,
  stableFinding,
  validateSuppressions,
  validateToolLock
} = require(runnerPath);

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

test('scanner findings preserve diagnostics, deduplicate exact repeats, and fail closed on collisions', () => {
  const parsed = [
    { kind: 'shellcheck', filepath: '.github\\workflows\\ci.yml', line: 7, column: 3, message: 'shellcheck reported SC2086' },
    { kind: 'shellcheck', filepath: '.github/workflows/ci.yml', line: 7, column: 3, message: 'shellcheck reported SC2046' },
    { kind: 'shellcheck', filepath: '.github/workflows/ci.yml', line: 7, column: 3, message: 'shellcheck reported SC2086' }
  ];
  const findings = genericJsonFindings('actionlint', repoRoot, parsed);
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
    schema_version: 2,
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
      tool_version: '1.1.0',
      rule_version: '1.1.0',
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
  const root = temporaryRepository({ 'src/index.js': 'module.exports = 1;\n', 'package.json': '{}\n' });
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
  const root = temporaryRepository({
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
  const root = temporaryRepository({
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

test('PR mode binds evidence to the exact clean checkout for branch and detached HEAD', () => {
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
    assert.equal(match.status, 0, match.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(ordinary.root, 'security-reports', 'security-gate.json'), 'utf8'));
    assert.equal(report.head, ordinary.head);
    assert.equal(report.scanned_head_digest, `git-sha1:${ordinary.head}`);
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
    assert.equal(match.status, 0, match.stderr);
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

test('release mode preserves exact-head and clean-tree guarantees while full and scheduled route', () => {
  const root = temporaryRepository({ 'README.md': '# documentation\n' });
  try {
    for (const mode of ['full', 'scheduled']) {
      const result = runNode([runnerPath, 'scan', '--mode', mode, '--repo', root], root);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /SECURITY_PROFILE_EXEMPT/);
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
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(state.root, 'security-reports', 'security-gate.json'), 'utf8'));
    assert.equal(report.scanned_head_digest, `git-sha1:${state.base}`);
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
      schema_version: 2,
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
        tool_version: '1.1.0',
        rule_version: '1.1.0',
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
    const reportDir = path.join(state.root, 'security-reports');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'security-gate.json'), `${JSON.stringify({
      schema_version: 2,
      state: 'SECURITY_PASS',
      base: state.base,
      head,
      scanned_head_digest: `git-sha1:${head}`,
      profile: 'SECURITY_PROFILE_TOOLING_LIBRARY',
      versions: {},
      coverage: [],
      findings: [],
      unverified_areas: []
    })}\n`, 'utf8');
    const packetPath = path.join(reportDir, 'packet.json');
    const result = runNode([
      runnerPath, 'review-packet', '--repo', state.root,
      '--base', state.base, '--head', head,
      '--report', path.join(reportDir, 'security-gate.json'),
      '--output', packetPath
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
      runnerPath, 'review-packet', '--repo', state.root,
      '--base', state.base, '--head', head,
      '--report', path.join(reportDir, 'security-gate.json'),
      '--output', packetPath
    ], state.root);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(fs.readFileSync(packetPath, 'utf8')).changed_file_manifest.sha256, packet.changed_file_manifest.sha256);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('workflows separate untrusted PR scans from privileged candidate execution', () => {
  const gate = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'repository-security-gate.yml'), 'utf8');
  const candidate = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'security-candidate-validation.yml'), 'utf8');
  assert.match(gate, /^  pull_request:/m);
  assert.doesNotMatch(gate, /pull_request_target/);
  assert.match(gate, /permissions:\r?\n  contents: read/);
  assert.doesNotMatch(gate, /\bsecrets\./);
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
