'use strict';

// Dependency and security settings (toolkit-governance-security.cjs): ecosystems are found and the
// written dependabot.yml covers them; settings that are off drift, paid-only ones on a private
// repository never do; auto-merge needs the binding's permission, the workflow, the repository
// setting and a protected default branch; the reader only reads; the writers touch only what they
// are told to and never a file Toolkit did not write; and the auto-merge workflow stays guarded.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const security = require(path.join(ROOT, 'repo', 'scripts', 'toolkit-governance-security.cjs'));
const programmeState = require(path.join(ROOT, 'skills', 'github-program-reconciler', 'scripts', 'programme-state.cjs'));

function repo(t, files = {}, remote = 'https://github.com/example-owner/example-repo.git') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-security-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  childProcess.execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
  if (remote) childProcess.execFileSync('git', ['-C', root, 'remote', 'add', 'origin', remote], { windowsHide: true });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

function binding(policy) {
  return JSON.stringify({
    schema: 'toolkit.programme-binding.v1', repository: 'example-owner/example-repo', parent_issue: 1,
    record_prefix: 'INT-EX-', writer_prefix: 'INT-EX-',
    store: { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/' },
    required_checks: ['validate'],
    ...(policy ? { dependency_updates: policy } : {}),
  });
}

const ON = Object.freeze({
  ok: true, visibility: 'public', allow_auto_merge: true, alerts: 'enabled', security_updates: 'enabled',
  secret_scanning: 'enabled', push_protection: 'enabled', code_scanning: 'enabled', private_reporting: 'enabled',
});
const reader = (overrides = {}) => () => ({ ...ON, ...overrides });
const CONFORMANT = Object.freeze({ status: 'conformant', reason: null });

test('SE-01: ecosystems are found at the root and one folder down, and the written config covers them', (t) => {
  const root = repo(t, {
    'package.json': '{}', 'web/package.json': '{}', 'requirements.txt': '', 'Dockerfile': 'FROM scratch\n',
    '.github/workflows/ci.yml': 'on: push\n', 'node_modules/x/package.json': '{}', '.hidden/go.mod': '',
  });
  const detected = security.detectEcosystems(root);
  assert.deepEqual([...detected], [['docker', ['/']], ['github-actions', ['/']], ['npm', ['/', '/web']], ['pip', ['/']]]);
  assert.equal(security.readDependabotConfig(root), null);
  fs.writeFileSync(path.join(root, '.github', 'dependabot.yml'), security.renderDependabotConfig(detected));
  assert.deepEqual(security.uncoveredEcosystems(detected, security.readDependabotConfig(root)), []);
  const text = fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8');
  assert.match(text, /package-ecosystem: "github-actions"\n {4}directory: "\/"\n[\s\S]*?default-days: 7/);
  assert.match(text, /update-types: \["patch", "minor"\]/);
  assert.doesNotMatch(text, /major/);
});

test('SE-02: a hand-written dependabot.yml is read in block and inline styles, and gaps are named', (t) => {
  const root = repo(t, {
    'package.json': '{}', 'requirements.txt': '', 'web/package.json': '{}',
    '.github/dependabot.yml': [
      'version: 2', 'updates:',
      '  - package-ecosystem: "npm"  # front end', '    directories:', '      - "/"', '    schedule:', '      interval: "daily"',
      "  - package-ecosystem: 'pip'", '    directories: ["/"]', '',
    ].join('\n'),
  });
  const missing = security.uncoveredEcosystems(security.detectEcosystems(root), security.readDependabotConfig(root));
  assert.deepEqual(missing, [{ ecosystem: 'npm', directory: '/web' }]);
  fs.writeFileSync(path.join(root, '.github', 'dependabot.yml'), 'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: "/**"\n  - package-ecosystem: pip\n    directory: /\n');
  assert.deepEqual(security.uncoveredEcosystems(security.detectEcosystems(root), security.readDependabotConfig(root)), []);
});

test('SE-03: every setting on is conformant; settings that are off drift and become the fixes', (t) => {
  const root = repo(t, { '.github/toolkit-programme.json': binding(), 'package.json': '{}', '.github/dependabot.yml': 'updates:\n  - package-ecosystem: "npm"\n    directory: "/"\n' });
  assert.equal(security.dependencySecurity(root, { reader: reader(), protectionResult: CONFORMANT }).status, 'conformant');
  const off = security.dependencySecurity(root, { reader: reader({ alerts: 'disabled', push_protection: 'disabled', code_scanning: 'disabled', private_reporting: 'disabled', allow_auto_merge: false }) });
  assert.equal(off.status, 'drift');
  assert.deepEqual(Object.fromEntries(Object.entries(off.checks).map(([id, check]) => [id, check.status])), { S1: 'drift', S2: 'ok', S3: 'ok', S4: 'drift', S5: 'drift', S6: 'drift', S7: 'ok' });
  assert.deepEqual(off.checks.S4.details, ['Push protection is off']);
  assert.deepEqual(off.fixes, { alerts: true, security_updates: false, secret_scanning: true, code_scanning: true, private_reporting: true, allow_auto_merge: false });
  assert.deepEqual(off.files, { dependabot: false, workflow: false });
});

test('SE-04: on a private repository the paid features are not on this plan, never drift', (t) => {
  const root = repo(t, { '.github/toolkit-programme.json': binding() });
  const result = security.dependencySecurity(root, { reader: reader({ visibility: 'private', secret_scanning: 'not-on-plan', push_protection: 'not-on-plan', code_scanning: 'not-on-plan', private_reporting: 'not-on-plan' }) });
  assert.equal(result.status, 'conformant');
  assert.equal(result.checks.S4.status, 'not-on-plan');
  assert.equal(result.checks.S5.status, 'not-on-plan');
  assert.equal(result.checks.S6.status, 'not-applicable');
  assert.deepEqual(Object.values(result.fixes).filter(Boolean), []);
});

test('SE-05: auto-merge needs the binding, the workflow, the repository setting and a protected branch', (t) => {
  const policy = { auto_merge: 'patch-minor' };
  const root = repo(t, { '.github/toolkit-programme.json': binding(policy) });
  const missing = security.dependencySecurity(root, { reader: reader({ allow_auto_merge: false }), protectionResult: CONFORMANT });
  assert.equal(missing.checks.S7.status, 'drift');
  assert.deepEqual(missing.checks.S7.details, [`${security.WORKFLOW_REL} is missing`, 'the repository does not allow auto-merge']);
  assert.deepEqual([missing.fixes.allow_auto_merge, missing.files.workflow], [true, true]);
  security.writeSecurityFiles(root, missing.files);
  assert.equal(security.workflowState(root), 'current');
  assert.equal(security.dependencySecurity(root, { reader: reader(), protectionResult: CONFORMANT }).checks.S7.status, 'ok');
  // No required checks, or a drifting branch: drift, and the setting is not offered.
  const bare = security.dependencySecurity(root, { reader: reader({ allow_auto_merge: false }), protectionResult: { status: 'unverified', reason: 'binding-has-no-required-checks' } });
  assert.match(bare.checks.S7.details.join(), /no required checks/);
  assert.equal(bare.fixes.allow_auto_merge, false);
  assert.equal(security.dependencySecurity(root, { reader: reader(), protectionResult: { status: 'drift', reason: null } }).checks.S7.status, 'drift');
  assert.equal(security.dependencySecurity(root, { reader: reader(), protectionResult: { status: 'unverified', reason: null } }).checks.S7.status, 'unverified');
  // Off (the default): nothing more is needed, and a present workflow is harmless.
  const offRoot = repo(t, { '.github/toolkit-programme.json': binding() });
  const off = security.dependencySecurity(offRoot, { reader: reader({ allow_auto_merge: false }) });
  assert.equal(off.checks.S7.status, 'ok');
  assert.deepEqual(off.policy, { auto_merge: 'off', github_actions: 'auto-merge' });
});

test('SE-06: offline checks the files only; unreadable GitHub is unverified; another host is not-applicable', (t) => {
  const root = repo(t, { '.github/toolkit-programme.json': binding(), 'package.json': '{}' });
  let called = false;
  const offline = security.dependencySecurity(root, { offline: true, reader: () => { called = true; return ON; } });
  assert.equal(called, false);
  assert.equal(offline.checks.S1.status, 'not-checked');
  assert.equal(offline.checks.S3.status, 'drift');
  assert.equal(offline.fixes, null);
  assert.deepEqual(offline.files, { dependabot: true, workflow: false });
  const unread = security.dependencySecurity(root, { reader: () => ({ ok: false, reason: 'gh-unavailable' }) });
  assert.equal(unread.checks.S1.status, 'unverified');
  assert.equal(security.dependencySecurity(repo(t, {}, 'https://gitlab.com/a/b.git')).status, 'not-applicable');
});

test('SE-07: the file writer never replaces a file Toolkit did not write', (t) => {
  const root = repo(t, { 'package.json': '{}', '.github/dependabot.yml': 'mine\n', [security.WORKFLOW_REL]: 'name: mine\n' });
  assert.deepEqual(security.writeSecurityFiles(root, { dependabot: true, workflow: true }), []);
  assert.equal(fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8'), 'mine\n');
  assert.equal(security.workflowState(root), 'foreign');
  fs.writeFileSync(path.join(root, ...security.WORKFLOW_REL.split('/')), '# Toolkit dependency auto-merge v0\nold\n');
  assert.equal(security.workflowState(root), 'outdated');
  assert.deepEqual(security.writeSecurityFiles(root, { workflow: true }), [{ file: security.WORKFLOW_REL, result: 'written' }]);
  assert.equal(security.workflowState(root), 'current');
});

test('SE-08: the reader only reads; the writer calls only the endpoints for the fixes it is given', () => {
  const calls = [];
  const responses = {
    'repos/o/r': { private: false, visibility: 'public', allow_auto_merge: false, security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'disabled' } } },
    'repos/o/r/automated-security-fixes': { enabled: true, paused: false },
    'repos/o/r/code-scanning/default-setup': { state: 'not-configured' },
    'repos/o/r/private-vulnerability-reporting': { enabled: false },
  };
  const spawn = (command, args) => {
    calls.push(args.slice(1));
    if (args[1] === 'repos/o/r/vulnerability-alerts') return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
    return { status: 0, stdout: JSON.stringify(responses[args[1]]), stderr: '' };
  };
  const read = security.ghSecurityReader('o/r', { spawn });
  assert.deepEqual(read, { ok: true, visibility: 'public', allow_auto_merge: false, alerts: 'disabled', security_updates: 'enabled', secret_scanning: 'enabled', push_protection: 'disabled', code_scanning: 'disabled', private_reporting: 'disabled' });
  assert.ok(calls.every(args => !args.includes('-X')), 'reads are GETs');
  const writes = [];
  const writer = (command, args, options) => { writes.push({ args: args.slice(1), input: options.input }); return { status: 0, stdout: '', stderr: '' }; };
  const results = security.ghSecurityWriter('o/r', { alerts: true, security_updates: false, secret_scanning: true, code_scanning: false, private_reporting: true, allow_auto_merge: false }, { spawn: writer });
  assert.deepEqual(results.map(entry => [entry.setting, entry.ok]), [['alerts', true], ['secret_scanning', true], ['private_reporting', true]]);
  assert.deepEqual(writes.map(entry => entry.args.slice(0, 2)), [['-X', 'PUT'], ['-X', 'PATCH'], ['-X', 'PUT']]);
  assert.deepEqual(JSON.parse(writes[1].input), { security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } });
  const privateRead = security.ghSecurityReader('o/p', { spawn: (command, args) => (args[1] === 'repos/o/p'
    ? { status: 0, stdout: JSON.stringify({ private: true, security_and_analysis: null }), stderr: '' }
    : args[1] === 'repos/o/p/vulnerability-alerts' ? { status: 0, stdout: '', stderr: '' }
      : { status: 1, stdout: '', stderr: 'gh: Advanced Security must be enabled for this repository (HTTP 403)' }) });
  assert.deepEqual([privateRead.alerts, privateRead.secret_scanning, privateRead.code_scanning, privateRead.private_reporting], ['enabled', 'not-on-plan', 'not-on-plan', 'not-on-plan']);
});

test('SE-09: the auto-merge workflow stays guarded, and this repository carries the current copy', () => {
  const template = fs.readFileSync(path.join(ROOT, ...security.WORKFLOW_TEMPLATE_REL.split('/')), 'utf8');
  assert.ok(template.startsWith('# Toolkit dependency auto-merge v'));
  assert.match(template, /^on:\n {2}pull_request:\n/m, 'never pull_request_target');
  assert.doesNotMatch(template, /pull_request_target|actions\/checkout|secrets\./, 'no PR code checkout and no secrets');
  assert.match(template, /^permissions:\n {2}contents: write\n {2}pull-requests: write\n\n/m);
  assert.match(template, /if: github\.event\.pull_request\.user\.login == 'dependabot\[bot\]' && github\.actor == 'dependabot\[bot\]'/);
  for (const uses of template.match(/uses: \S+/g)) assert.match(uses, /@[0-9a-f]{40}$/, `${uses} is pinned to a full SHA`);
  assert.match(template, /contents\/\.github\/toolkit-programme\.json\?ref=\$BASE/, 'the policy is read from the base branch');
  assert.match(template, /select\(\.type == "required_status_checks"\)/);
  assert.deepEqual(template.match(/gh pr merge [^\n]*/g), ['gh pr merge --auto --merge "$PR_URL"'], 'merge commits only, always through auto-merge');
  assert.match(template, /version-update:semver-patch\|version-update:semver-minor\)/);
  assert.equal(security.workflowState(ROOT), 'current');
  const own = security.dependencySecurity(ROOT, { offline: true });
  assert.equal(own.checks.S3.status, 'ok', 'this repository covers its own ecosystems');
});

test('SE-10: the binding accepts only the known dependency update values', () => {
  const base = JSON.parse(binding());
  programmeState.validateBinding({ ...base, dependency_updates: { auto_merge: 'patch-minor', github_actions: 'owner' } });
  programmeState.validateBinding({ ...base, dependency_updates: {} });
  for (const bad of [{ auto_merge: 'all' }, { github_actions: 'yes' }, { auto_merge: 'off', extra: true }, 'patch-minor']) {
    assert.throws(() => programmeState.validateBinding({ ...base, dependency_updates: bad }), /dependency_updates/);
  }
});
