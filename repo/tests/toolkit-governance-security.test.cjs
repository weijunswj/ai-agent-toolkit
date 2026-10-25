'use strict';

// Dependency and security settings (toolkit-governance-security.cjs) and the Dependabot auto-merge
// workflow, tested against this invariant model and closure matrix.
//
// Actors: the owner (answers in their own chat or terminal, merges pull requests); an agent (runs
// `toolkit governance check` and `security`, and can edit any working tree); Dependabot (opens and
// updates its pull requests); anyone else with write access (can push to a Dependabot branch); the
// auto-merge workflow (the built-in token only).
//
//   I1 Free settings (S1, S2; S4-S6 on a public repository) are turned on by `security` and
//      `migrate` in an ENABLED repository with a binding, with no question: the owner's governance
//      yes covers them.
//   I2 Paid settings (S4, S5 on a private or internal repository) are turned on only when the
//      binding merged on the default branch says paid_security "on". The working tree, a binding
//      that is not merged, invalid or unreadable never turns them on.
//   I3 "Allow auto-merge" and the workflow file follow only the merged binding's patch-minor, and
//      the setting needs conformant default-branch protection with at least one required check.
//   I4 Nothing is written when GitHub cannot be read; a read-back that fails is unverified, never
//      "applied" or "read back"; every change keeps what GitHub showed before.
//   I5 A write GitHub refuses as not on the plan or against an organisation policy is left alone
//      and is not a failure; any other refusal fails.
//   I6 Default setup is never turned on over an advanced CodeQL workflow, and a dependabot config
//      (.yml or .yaml) or workflow Toolkit did not write is never replaced.
//   I7 The workflow turns auto-merge on only for a pull request Dependabot opened and last pushed,
//      when the base branch's binding says patch-minor and a ruleset there requires a check, for a
//      patch or minor update that is not from 0.x (0.0.x: none), with no maintainer change, and for
//      GitHub Actions only with github_actions "auto-merge" (the default is "owner"). Anything else
//      turns auto-merge off if it was on and leaves one comment. A push by anyone else, or a base
//      branch change, turns it off and tells the owner.
//
// Closure matrix: MATRIX (verdict: visibility x merged binding x working tree x GitHub read x plan
// x protection x files), APPLY (writes x read-back x refusals), WORKFLOW and DISARM (the
// workflow's runtime branches), plus SE-01, SE-02, SE-07 to SE-10 for files, reader, writer and
// binding schema. A path not in these tables is a gap in the model.

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

function binding(policy, paid = null) {
  return JSON.stringify({
    schema: 'toolkit.programme-binding.v1', repository: 'example-owner/example-repo', parent_issue: 1,
    record_prefix: 'INT-EX-', writer_prefix: 'INT-EX-',
    store: { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/' },
    required_checks: ['validate'],
    ...(policy ? { dependency_updates: policy } : {}),
    ...(paid ? { paid_security: paid } : {}),
  });
}

const merged = (policy, paid) => ({ status: 'ok', text: binding(policy, paid) });
const ON = Object.freeze({
  ok: true, visibility: 'public', allow_auto_merge: true, alerts: 'enabled', security_updates: 'enabled',
  secret_scanning: 'enabled', push_protection: 'enabled', code_scanning: 'enabled', private_reporting: 'enabled',
  binding: merged(),
});
const reader = (overrides = {}) => () => ({ ...ON, ...overrides });
const CONFORMANT = Object.freeze({ status: 'conformant', reason: null });
const PRIVATE = Object.freeze({ visibility: 'private', private_reporting: 'not-on-plan' });
const PAID_OFF = Object.freeze({ secret_scanning: 'disabled', push_protection: 'disabled', code_scanning: 'disabled' });
const NO_PLAN = Object.freeze({ secret_scanning: 'not-on-plan', push_protection: 'not-on-plan', code_scanning: 'not-on-plan' });
const PATCH_MINOR = Object.freeze({ auto_merge: 'patch-minor' });
const COVERED = 'updates:\n  - package-ecosystem: "npm"\n    directory: "/"\n';

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
  assert.match(text, /package-ecosystem: "github-actions"[^]*?ignore:\n {6}- dependency-name: "dependabot\/fetch-metadata"/, 'the template pin moves with Toolkit, not Dependabot');
  assert.equal(text.match(/ignore:/g).length, 1, 'only the GitHub Actions entry ignores anything');
  assert.doesNotMatch(text, /major/);
});

test('SE-02: a hand-written dependabot.yml or .yaml is read in block and inline styles, and gaps are named', (t) => {
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
  fs.renameSync(path.join(root, '.github', 'dependabot.yml'), path.join(root, '.github', 'dependabot.yaml'));
  assert.equal(security.dependabotFile(root), '.github/dependabot.yaml');
  assert.deepEqual(security.uncoveredEcosystems(security.detectEcosystems(root), security.readDependabotConfig(root)), []);
});

// The verdict matrix. Each row: the repository files, what GitHub reads (overrides of ON, or a
// function), the default-branch protection, and what the verdict must say. `checks` lists only the
// statuses the row is about; `fixes` and `files` only the keys it is about.
const MATRIX = [
  { id: 'M01 public, everything on, binding merged', files: { 'package.json': '{}', '.github/dependabot.yml': COVERED }, protection: CONFORMANT,
    expect: { status: 'conformant', policy_source: 'default-branch', fixes: { alerts: false, secret_scanning: false, code_scanning: false, private_reporting: false, allow_auto_merge: false } } },
  { id: 'M02 public, free settings off (I1)', read: { alerts: 'disabled', push_protection: 'disabled', code_scanning: 'disabled', private_reporting: 'disabled', allow_auto_merge: false },
    expect: { status: 'drift', checks: { S1: 'drift', S2: 'ok', S4: 'drift', S5: 'drift', S6: 'drift', S7: 'ok', S8: 'not-applicable' }, details: { S4: ['Push protection is off'] },
      fixes: { alerts: true, security_updates: false, secret_scanning: true, code_scanning: true, private_reporting: true, allow_auto_merge: false, paid: false } } },
  { id: 'M03 public, the working tree asks for auto-merge, the default branch does not (I3)', working: binding(PATCH_MINOR, 'on'), read: { allow_auto_merge: false }, protection: CONFORMANT,
    expect: { checks: { S7: 'ok' }, fixes: { allow_auto_merge: false }, files: { workflow: false }, pending: { auto_merge: 'patch-minor', github_actions: 'owner', paid_security: 'on' } } },
  { id: 'M04 private, the working tree says paid on, the default branch has no answer (I2)', working: binding(null, 'on'), read: { ...PRIVATE, ...PAID_OFF },
    expect: { status: 'drift', checks: { S4: 'not-applicable', S5: 'not-applicable', S6: 'not-applicable', S8: 'drift' }, fixes: { secret_scanning: false, code_scanning: false, paid: true }, pending: { paid_security: 'on' } } },
  { id: 'M05 private, the binding on the default branch is unreadable (I2, I3)', read: { ...PRIVATE, ...PAID_OFF, binding: { status: 'unreadable' } }, protection: CONFORMANT,
    expect: { status: 'unverified', policy_source: 'unreadable', checks: { S7: 'unverified', S8: 'unverified', S4: 'not-applicable' }, fixes: { secret_scanning: false, code_scanning: false, allow_auto_merge: false } } },
  { id: 'M06 private, the binding is not merged yet', read: { ...PRIVATE, binding: { status: 'missing' } },
    expect: { status: 'drift', policy_source: 'not-merged', checks: { S8: 'drift' }, details: { S8: [/not on the default branch yet: ask the owner[^]*record only the owner's own answer/] } } },
  { id: 'M07 private, the merged binding is invalid', read: { ...PRIVATE, binding: { status: 'ok', text: '{"schema":"x"}' } },
    expect: { status: 'drift', policy_source: 'invalid', checks: { S7: 'unverified', S8: 'drift' }, details: { S8: [/not valid/] } } },
  { id: 'M08 private, unanswered, the plan offers the paid features', read: { ...PRIVATE, ...PAID_OFF },
    expect: { status: 'drift', checks: { S4: 'not-applicable', S5: 'not-applicable', S8: 'drift' }, details: { S8: [/paid Secret Protection and Code Security[^]*billed per active committer; default off/] }, fixes: { secret_scanning: false, code_scanning: false } } },
  { id: 'M09 private, answered off, the plan offers them', read: { ...PRIVATE, ...PAID_OFF, binding: merged(null, 'off') },
    expect: { status: 'conformant', checks: { S8: 'ok' }, fixes: { secret_scanning: false, code_scanning: false, private_reporting: false } } },
  { id: 'M10 private, answered on, off on GitHub (I2)', read: { ...PRIVATE, ...PAID_OFF, binding: merged(null, 'on') },
    expect: { status: 'drift', checks: { S4: 'drift', S5: 'drift', S8: 'ok' }, fixes: { secret_scanning: true, code_scanning: true, paid: true } } },
  { id: 'M11 private, answered on, already on', read: { ...PRIVATE, binding: merged(null, 'on') },
    expect: { status: 'conformant', fixes: { secret_scanning: false, code_scanning: false } } },
  { id: 'M12 private, answered on, the plan does not offer them', read: { ...PRIVATE, ...NO_PLAN, binding: merged(null, 'on') },
    expect: { status: 'drift', checks: { S4: 'drift', S5: 'drift' }, details: { S4: [/needs GitHub Team or Enterprise Cloud\); buy it or set paid_security to off/] }, fixes: { secret_scanning: false, code_scanning: false } } },
  { id: 'M13 internal is treated like private', read: { visibility: 'internal', private_reporting: 'not-on-plan', ...PAID_OFF },
    expect: { status: 'drift', checks: { S4: 'not-applicable', S6: 'not-applicable', S8: 'drift' }, fixes: { secret_scanning: false, paid: true } } },
  { id: 'M14 an advanced CodeQL workflow is never replaced by default setup (I6)', files: { '.github/workflows/codeql.yml': 'jobs:\n  a:\n    steps:\n      - uses: github/codeql-action/init@v3\n' }, read: { code_scanning: 'disabled' },
    expect: { checks: { S5: 'ok' }, details: { S5: [/codeql\.yml \(advanced setup\)/] }, fixes: { code_scanning: false } } },
  { id: 'M15 a dependabot.yaml counts (I6)', files: { 'package.json': '{}', '.github/dependabot.yaml': COVERED },
    expect: { checks: { S3: 'ok' }, files: { dependabot: false } } },
  { id: 'M16 merged patch-minor, nothing in place yet (I3)', read: { allow_auto_merge: false, binding: merged(PATCH_MINOR) }, protection: CONFORMANT,
    expect: { checks: { S7: 'drift' }, details: { S7: [`${security.WORKFLOW_REL} is missing`, 'the repository does not allow auto-merge'] }, fixes: { allow_auto_merge: true }, files: { workflow: true } } },
  { id: 'M17 merged patch-minor, protection unverified', read: { allow_auto_merge: false, binding: merged(PATCH_MINOR) }, protection: { status: 'unverified', reason: null }, workflow: true,
    expect: { checks: { S7: 'drift' }, fixes: { allow_auto_merge: false } } },
  { id: 'M18 merged patch-minor, protection unverified, setting already on', read: { binding: merged(PATCH_MINOR) }, protection: { status: 'unverified', reason: null }, workflow: true,
    expect: { checks: { S7: 'unverified' }, fixes: { allow_auto_merge: false } } },
  { id: 'M19 merged patch-minor, the binding names no required checks', read: { allow_auto_merge: false, binding: merged(PATCH_MINOR) }, protection: { status: 'unverified', reason: 'binding-has-no-required-checks' }, workflow: true,
    expect: { checks: { S7: 'drift' }, details: { S7: ['the repository does not allow auto-merge', 'the binding names no required checks, so auto-merge could merge untested code'] }, fixes: { allow_auto_merge: false } } },
  { id: 'M20 merged patch-minor, protection drift', read: { binding: merged(PATCH_MINOR) }, protection: { status: 'drift', reason: null }, workflow: true,
    expect: { checks: { S7: 'drift' } } },
  { id: 'M21 merged patch-minor, everything in place', read: { binding: merged(PATCH_MINOR) }, protection: CONFORMANT, workflow: true,
    expect: { checks: { S7: 'ok' }, fixes: { allow_auto_merge: false }, files: { workflow: false } } },
  { id: 'M22 merged binding: GitHub Actions default to the owner', read: { binding: merged(PATCH_MINOR) },
    expect: { policy: { auto_merge: 'patch-minor', github_actions: 'owner', paid_security: null } } },
  { id: 'M23 offline checks only the files', files: { 'package.json': '{}' }, offline: true,
    expect: { status: 'drift', policy_source: 'offline', checks: { S1: 'not-checked', S3: 'drift', S7: 'not-checked', S8: 'not-checked' }, fixes: null, files: { dependabot: true, workflow: false }, readerCalled: false } },
  { id: 'M24 GitHub unreadable (I4)', read: () => ({ ok: false, reason: 'gh-unavailable' }), protection: CONFORMANT,
    expect: { status: 'unverified', policy_source: 'unreadable', checks: { S1: 'unverified', S7: 'unverified', S8: 'unverified' }, fixes: null } },
];

test('SE-03 (MATRIX): the verdict for every row of the closure matrix', async (t) => {
  for (const row of MATRIX) {
    await t.test(row.id, (st) => {
      const files = { ...(row.files || {}), ...(row.working ? { '.github/toolkit-programme.json': row.working } : {}) };
      const root = repo(st, files);
      if (row.workflow) security.writeSecurityFiles(root, { workflow: true });
      let called = false;
      const read = typeof row.read === 'function' ? row.read : reader(row.read || {});
      const result = security.dependencySecurity(root, { offline: Boolean(row.offline), reader: (slug) => { called = true; return read(slug); }, protectionResult: row.protection || null });
      const want = row.expect;
      if (want.status) assert.equal(result.status, want.status, JSON.stringify(result.checks));
      if (want.policy_source) assert.equal(result.policy_source, want.policy_source);
      if (want.policy) assert.deepEqual(result.policy, want.policy);
      for (const [id, status] of Object.entries(want.checks || {})) assert.equal(result.checks[id].status, status, `${id}: ${result.checks[id].details.join('; ')}`);
      for (const [id, details] of Object.entries(want.details || {})) {
        assert.equal(result.checks[id].details.length, details.length, `${id}: ${result.checks[id].details.join('; ')}`);
        details.forEach((detail, index) => (detail instanceof RegExp ? assert.match(result.checks[id].details[index], detail) : assert.equal(result.checks[id].details[index], detail)));
      }
      if (want.fixes === null) assert.equal(result.fixes, null);
      else for (const [key, value] of Object.entries(want.fixes || {})) assert.equal(result.fixes[key], value, `fixes.${key}`);
      for (const [key, value] of Object.entries(want.files || {})) assert.equal(result.files[key], value, `files.${key}`);
      if (want.pending) for (const [key, value] of Object.entries(want.pending)) assert.equal(result.pending_policy[key], value, `pending.${key}`);
      else assert.equal(result.pending_policy, null);
      if (want.readerCalled === false) assert.equal(called, false);
    });
  }
});

test('SE-04: a repository on another host is not-applicable', (t) => {
  assert.equal(security.dependencySecurity(repo(t, {}, 'https://gitlab.com/a/b.git')).status, 'not-applicable');
});

// The apply matrix: what `applySecurity` and `describeOutcome` do with each write and read-back.
const ALERTS_OFF = Object.freeze({ alerts: 'disabled' });
const ok = setting => ({ setting, ok: true, reason: null });
const refused = (setting, reason) => ({ setting, ok: false, reason });
const APPLY = [
  { id: 'A01 GitHub unreadable: nothing is written (I4)', before: () => ({ ok: false, reason: 'gh-unavailable' }),
    expect: { result: 'unverified', writes: 0, lines: [/nothing changed: GitHub could not be read/, /could not check S1/], never: [/read back\./, /already on/] } },
  { id: 'A02 written and read back', before: reader(ALERTS_OFF), writer: () => [ok('alerts')], after: reader(),
    expect: { result: 'applied', writes: 1, prior: 'disabled', lines: [/Dependabot alerts turned on\./, /read back\./] } },
  { id: 'A03 written, the read-back fails (I4)', before: reader(ALERTS_OFF), writer: () => [ok('alerts')], after: () => ({ ok: false, reason: 'gh-unavailable' }),
    expect: { result: 'unverified', writes: 1, lines: [/could not read the settings back/], never: [/: read back\./] } },
  { id: 'A04 written, the read-back throws (I4)', before: reader(ALERTS_OFF), writer: () => [ok('alerts')], after: () => { throw new Error('boom'); },
    expect: { result: 'unverified', writes: 1, never: [/: read back\./] } },
  { id: 'A05 written, but still off', before: reader(ALERTS_OFF), writer: () => [ok('alerts')], after: reader(ALERTS_OFF),
    expect: { result: 'failed', writes: 1, lines: [/reading back still shows off: Dependabot alerts/] } },
  { id: 'A06 refused as not on the plan: left alone (I5)', before: reader({ code_scanning: 'disabled' }), writer: () => [refused('code_scanning', 'not-on-plan')], after: reader({ code_scanning: 'disabled' }),
    expect: { result: 'applied', writes: 1, unavailable: ['code_scanning'], lines: [/CodeQL code scanning left alone: GitHub does not allow it here \(not on this plan\)/] } },
  { id: 'A07 refused by an organisation policy: left alone (I5)', before: reader({ private_reporting: 'disabled' }), writer: () => [refused('private_reporting', 'refused-by-policy')], after: reader({ private_reporting: 'disabled' }),
    expect: { result: 'applied', writes: 1, unavailable: ['private_reporting'], lines: [/an organisation or enterprise policy/] } },
  { id: 'A08 refused for another reason: failed (I5)', before: reader({ private_reporting: 'disabled' }), writer: () => [refused('private_reporting', 'forbidden')], after: reader({ private_reporting: 'disabled' }),
    expect: { result: 'failed', writes: 1, lines: [/not turned on \(forbidden\)/] } },
  { id: 'A09 nothing to do', before: reader(), writer: () => [], after: reader(),
    expect: { result: 'nothing', writes: 0, never: [/turned on/] } },
];

test('SE-05 (APPLY): every write and read-back outcome, and what is said about it', async (t) => {
  for (const row of APPLY) {
    await t.test(row.id, (st) => {
      const root = repo(st, { 'package.json': '{}', '.github/dependabot.yml': COVERED });
      const before = security.dependencySecurity(root, { reader: row.before, protectionResult: CONFORMANT });
      let writes = 0;
      const outcome = security.applySecurity(root, before, {
        writer: (...args) => { writes += 1; return row.writer(...args); },
        fileWriter: () => [],
        reread: () => security.dependencySecurity(root, { reader: row.after || row.before, protectionResult: CONFORMANT }),
      });
      const want = row.expect;
      assert.equal(outcome.result, want.result);
      assert.equal(writes, want.writes);
      if (want.prior) assert.equal(outcome.prior.alerts, want.prior);
      if (want.unavailable) assert.deepEqual(outcome.unavailable, want.unavailable);
      const text = security.describeOutcome(before.slug, root, before, outcome).join('\n');
      for (const line of want.lines || []) assert.match(text, line);
      for (const line of want.never || []) assert.doesNotMatch(text, line);
    });
  }
});

test('SE-06: the policy comes from the committed binding through the state module, never from the working tree', (t) => {
  const identity = { valid: true, remote: { host: 'github.com', path: '/example-owner/example-repo.git' } };
  const root = repo(t, { '.github/toolkit-programme.json': binding(PATCH_MINOR, 'on') });
  const own = security.committedPolicy({ ok: true, binding: merged() }, identity);
  assert.equal(own.source, 'default-branch');
  assert.deepEqual(own.policy, { auto_merge: 'off', github_actions: 'owner', paid_security: null });
  for (const read of [null, { ok: false }, { ok: true }, { ok: true, binding: { status: 'unreadable' } }]) {
    assert.deepEqual(security.committedPolicy(read, identity).policy, { auto_merge: 'off', github_actions: 'owner', paid_security: null });
  }
  const other = JSON.stringify({ ...JSON.parse(binding(PATCH_MINOR, 'on')), repository: 'someone/else' });
  assert.equal(security.committedPolicy({ ok: true, binding: { status: 'ok', text: other } }, identity).source, 'invalid', 'a binding for another repository is not an answer');
  const text = fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-governance-security.cjs'), 'utf8');
  assert.doesNotMatch(text, /readFileSync\([^)]*programme|toolkit-programme\.json['"]/, 'the module never reads the working-tree binding itself');
  assert.ok(root);
});

test('SE-07: the file writer never replaces a file Toolkit did not write (I6)', (t) => {
  const root = repo(t, { 'package.json': '{}', '.github/dependabot.yml': 'mine\n', [security.WORKFLOW_REL]: 'name: mine\n' });
  assert.deepEqual(security.writeSecurityFiles(root, { dependabot: true, workflow: true }), []);
  assert.equal(fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8'), 'mine\n');
  assert.equal(security.workflowState(root), 'foreign');
  fs.writeFileSync(path.join(root, ...security.WORKFLOW_REL.split('/')), '# Toolkit dependency auto-merge v0\nold\n');
  assert.equal(security.workflowState(root), 'outdated');
  assert.deepEqual(security.writeSecurityFiles(root, { workflow: true }), [{ file: security.WORKFLOW_REL, result: 'written' }]);
  assert.equal(security.workflowState(root), 'current');
  const yaml = repo(t, { 'package.json': '{}', '.github/dependabot.yaml': 'mine\n' });
  assert.deepEqual(security.writeSecurityFiles(yaml, { dependabot: true }), [], 'a dependabot.yaml is never doubled');
  assert.equal(fs.existsSync(path.join(yaml, '.github', 'dependabot.yml')), false);
});

function fakeGh(responses, log) {
  return (command, args) => {
    log.push(args.slice(1));
    const response = responses[args[1]];
    if (typeof response === 'string') return { status: 1, stdout: '', stderr: response };
    return { status: 0, stdout: response === undefined ? '' : JSON.stringify(response), stderr: '' };
  };
}

test('SE-08: the reader only reads, hides nothing it could not see, and reads the binding from the default branch', () => {
  const calls = [];
  const content = Buffer.from(binding(PATCH_MINOR)).toString('base64');
  const read = security.ghSecurityReader('o/r', { spawn: fakeGh({
    'repos/o/r': { private: false, visibility: 'public', default_branch: 'main', permissions: { admin: true }, allow_auto_merge: false, security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'disabled' } } },
    'repos/o/r/vulnerability-alerts': 'gh: Not Found (HTTP 404)',
    'repos/o/r/automated-security-fixes': { enabled: true, paused: false },
    'repos/o/r/code-scanning/default-setup': { state: 'not-configured' },
    'repos/o/r/private-vulnerability-reporting': { enabled: false },
    'repos/o/r/contents/.github/toolkit-programme.json?ref=main': { encoding: 'base64', content },
  }, calls) });
  assert.deepEqual(read, {
    ok: true, visibility: 'public', allow_auto_merge: false, alerts: 'disabled', security_updates: 'enabled', secret_scanning: 'enabled',
    push_protection: 'disabled', code_scanning: 'disabled', private_reporting: 'disabled', binding: { status: 'ok', text: binding(PATCH_MINOR) },
  });
  assert.ok(calls.every(args => !args.includes('-X')), 'reads are GETs');
  // Without admin rights GitHub hides the settings: a 404 is unreadable, not off.
  const guest = security.ghSecurityReader('o/p', { spawn: fakeGh({
    'repos/o/p': { private: true, default_branch: 'main', permissions: { admin: false } },
    'repos/o/p/vulnerability-alerts': 'gh: Not Found (HTTP 404)',
    'repos/o/p/automated-security-fixes': 'gh: Not Found (HTTP 404)',
    'repos/o/p/code-scanning/default-setup': 'gh: Not Found (HTTP 404)',
    'repos/o/p/contents/.github/toolkit-programme.json?ref=main': 'gh: Not Found (HTTP 404)',
  }, []) });
  assert.deepEqual([guest.alerts, guest.secret_scanning, guest.code_scanning, guest.binding.status], ['unreadable', 'unreadable', 'unreadable', 'missing']);
  // An admin on a plan without the paid features: not on this plan.
  const admin = security.ghSecurityReader('o/p', { spawn: fakeGh({
    'repos/o/p': { private: true, default_branch: 'main', permissions: { admin: true }, security_and_analysis: null },
    'repos/o/p/code-scanning/default-setup': 'gh: Advanced Security must be enabled for this repository (HTTP 403)',
  }, []) });
  assert.deepEqual([admin.alerts, admin.secret_scanning, admin.code_scanning, admin.private_reporting, admin.binding.status], ['enabled', 'not-on-plan', 'not-on-plan', 'not-on-plan', 'unreadable']);
  // No visibility: nothing is guessed.
  assert.deepEqual(security.ghSecurityReader('o/x', { spawn: fakeGh({ 'repos/o/x': { default_branch: 'main' } }, []) }), { ok: false, reason: 'visibility-unreadable' });
});

test('SE-09: the writer calls only the endpoints for the fixes it is given, and names refusals', () => {
  const writes = [];
  const writer = (command, args, options) => { writes.push({ args: args.slice(1), input: options.input }); return { status: 0, stdout: '', stderr: '' }; };
  const results = security.ghSecurityWriter('o/r', { alerts: true, security_updates: false, secret_scanning: true, code_scanning: false, private_reporting: true, allow_auto_merge: false }, { spawn: writer });
  assert.deepEqual(results.map(entry => [entry.setting, entry.ok]), [['alerts', true], ['secret_scanning', true], ['private_reporting', true]]);
  assert.deepEqual(writes.map(entry => entry.args.slice(0, 2)), [['-X', 'PUT'], ['-X', 'PATCH'], ['-X', 'PUT']]);
  assert.deepEqual(JSON.parse(writes[1].input), { security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } });
  writes.length = 0;
  security.ghSecurityWriter('o/p', { secret_scanning: true, code_scanning: true, paid: true }, { spawn: writer });
  assert.deepEqual(writes.map(entry => JSON.parse(entry.input)), [
    { security_and_analysis: { secret_protection: { status: 'enabled' }, secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } },
    { security_and_analysis: { code_security: { status: 'enabled' } } },
    { state: 'configured' },
  ], 'on a private repository the paid product goes on first');
  const answer = stderr => security.ghSecurityWriter('o/r', { alerts: true }, { spawn: () => ({ status: 1, stdout: '', stderr }) })[0].reason;
  assert.equal(answer('gh: Secret Protection is not available on this plan (HTTP 403)'), 'not-on-plan');
  assert.equal(answer('gh: This setting is disabled by your organization (HTTP 422)'), 'refused-by-policy');
  assert.equal(answer('gh: Must have admin rights to Repository. (HTTP 403)'), 'forbidden');
  assert.equal(answer('gh: Validation Failed (HTTP 422)'), 'gh-request-failed');
});

const TEMPLATE = fs.readFileSync(path.join(ROOT, ...security.WORKFLOW_TEMPLATE_REL.split('/')), 'utf8');

test('SE-10: the auto-merge workflow stays guarded, and this repository carries the current copy', () => {
  assert.ok(TEMPLATE.startsWith('# Toolkit dependency auto-merge v2.'));
  assert.match(TEMPLATE, /^on:\n {2}pull_request:\n {4}types: \[opened, reopened, synchronize, edited\]\n/m, 'never pull_request_target');
  assert.doesNotMatch(TEMPLATE, /pull_request_target|actions\/checkout|secrets\./, 'no PR code checkout and no secrets');
  assert.match(TEMPLATE, /^permissions:\n {2}contents: write\n {2}pull-requests: write\n\n/m);
  assert.match(TEMPLATE, /^ {2}auto-merge:\n[^\n]*\n {4}if: github\.event\.pull_request\.user\.login == 'dependabot\[bot\]' && github\.actor == 'dependabot\[bot\]' && github\.event\.action != 'edited'\n/m);
  assert.match(TEMPLATE, /^ {2}disarm:\n[^\n]*\n {4}if: github\.event\.pull_request\.user\.login == 'dependabot\[bot\]' && \(\(github\.event\.action != 'edited' && github\.actor != 'dependabot\[bot\]'\) \|\| \(github\.event\.action == 'edited' && github\.event\.changes\.base\)\)\n/m,
    'a push by anyone else, or a base change, turns auto-merge off (I7)');
  for (const uses of TEMPLATE.match(/uses: \S+/g)) assert.match(uses, /@[0-9a-f]{40}$/, `${uses} is pinned to a full SHA`);
  assert.match(TEMPLATE, /contents\/\.github\/toolkit-programme\.json\?ref=\$BASE/, 'the policy is read from the base branch');
  assert.match(TEMPLATE, /github_actions \/\/ "owner"/, 'GitHub Actions updates default to the owner');
  assert.deepEqual([...new Set(TEMPLATE.match(/gh pr merge [^\n]*/g))].sort(), ['gh pr merge --auto --merge "$PR_URL"', 'gh pr merge --disable-auto "$PR_URL"'], 'merge commits only, always through auto-merge');
  assert.equal(security.workflowState(ROOT), 'current');
  const own = security.dependencySecurity(ROOT, { offline: true });
  assert.equal(own.checks.S3.status, 'ok', 'this repository covers its own ecosystems');
  assert.equal(fs.readFileSync(path.join(ROOT, '.github', 'dependabot.yml'), 'utf8'), security.renderDependabotConfig(security.detectEcosystems(ROOT)), 'this repository carries the config Toolkit writes');
});

// The shell of each `run: |` block in the workflow, by job.
function runBlocks(text) {
  const blocks = {};
  let job = null;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const name = /^ {2}([\w-]+):$/.exec(lines[index]);
    if (name) job = name[1];
    const run = /^( *)run: \|$/.exec(lines[index]);
    if (!run) continue;
    const indent = run[1].length + 2;
    const body = [];
    while (index + 1 < lines.length && (lines[index + 1].trim() === '' || lines[index + 1].startsWith(' '.repeat(indent)))) body.push(lines[(index += 1)].slice(indent));
    blocks[job] = body.join('\n');
  }
  return blocks;
}

const HAS_SHELL = process.platform !== 'win32' && ['bash', 'jq', 'base64'].every(tool => childProcess.spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0);

// Runs one job's shell with a fake `gh` that answers from the row and logs every call.
function runJob(t, job, env) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-auto-merge-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const log = path.join(folder, 'gh.log');
  fs.writeFileSync(path.join(folder, 'gh'), [
    '#!/usr/bin/env bash',
    'echo "$*" >> "$GH_LOG"',
    'if [ "$1" = api ]; then',
    '  case "$2" in',
    '    */contents/*) if [ -n "${FAKE_BINDING_FAIL:-}" ]; then exit 1; fi; printf "%s" "$FAKE_BINDING" | base64; exit 0 ;;',
    '    */rules/branches/*) if [ -n "${FAKE_RULES_FAIL:-}" ]; then exit 1; fi; echo "$FAKE_REQUIRED"; exit 0 ;;',
    '  esac',
    'fi',
    'if [ "$1 $2" = "pr view" ]; then',
    '  case "$*" in *autoMergeRequest*) echo "$FAKE_ARMED" ;; *comments*) echo "$FAKE_COMMENTS" ;; esac',
    'fi',
    'exit 0',
    '',
  ].join('\n'), { mode: 0o755 });
  const result = childProcess.spawnSync('bash', ['-c', runBlocks(TEMPLATE)[job]], {
    encoding: 'utf8', env: { ...process.env, PATH: `${folder}${path.delimiter}${process.env.PATH}`, GH_LOG: log, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  return { calls, armed: /pr merge --auto --merge/.test(calls), disarmed: /pr merge --disable-auto/.test(calls), commented: /pr comment/.test(calls), stdout: result.stdout };
}

const patch = (prevVersion = '1.2.3', updateType = 'version-update:semver-patch') => JSON.stringify([{ dependencyName: 'x', prevVersion, newVersion: '', updateType }]);
const BASE_ENV = Object.freeze({
  REPOSITORY: 'o/r', BASE: 'main', PR_URL: 'https://github.com/o/r/pull/1', UPDATE_TYPE: 'version-update:semver-patch', ECOSYSTEM: 'npm_and_yarn',
  MAINTAINER_CHANGES: 'false', UPDATED_DEPENDENCIES: patch(), FAKE_BINDING: binding(PATCH_MINOR), FAKE_REQUIRED: '1', FAKE_ARMED: 'false', FAKE_COMMENTS: '0',
});
const WORKFLOW = [
  { id: 'W01 patch, everything allowed: auto-merge on', env: {}, expect: { armed: true, commented: false } },
  { id: 'W02 minor from 1.x: auto-merge on', env: { UPDATE_TYPE: 'version-update:semver-minor', UPDATED_DEPENDENCIES: patch('1.2.3', 'version-update:semver-minor') }, expect: { armed: true } },
  { id: 'W03 binding off on the base branch, armed before: turned off', env: { FAKE_BINDING: binding(), FAKE_ARMED: 'true' }, expect: { armed: false, disarmed: true, commented: false } },
  { id: 'W04 binding unreadable: treated as off', env: { FAKE_BINDING_FAIL: '1' }, expect: { armed: false, commented: false } },
  { id: 'W05 rules unreadable: no auto-merge', env: { FAKE_RULES_FAIL: '1' }, expect: { armed: false } },
  { id: 'W06 no required check: no auto-merge', env: { FAKE_REQUIRED: '0' }, expect: { armed: false } },
  { id: 'W07 major: flagged', env: { UPDATE_TYPE: 'version-update:semver-major' }, expect: { armed: false, commented: true } },
  { id: 'W08 unknown update type: flagged', env: { UPDATE_TYPE: '' }, expect: { armed: false, commented: true } },
  { id: 'W09 maintainers changed: flagged', env: { MAINTAINER_CHANGES: 'true' }, expect: { armed: false, commented: true } },
  { id: 'W10 GitHub Actions, default owner: flagged', env: { ECOSYSTEM: 'github_actions' }, expect: { armed: false, commented: true } },
  { id: 'W11 GitHub Actions, binding says auto-merge: allowed', env: { ECOSYSTEM: 'github_actions', FAKE_BINDING: binding({ auto_merge: 'patch-minor', github_actions: 'auto-merge' }) }, expect: { armed: true } },
  { id: 'W12 minor from 0.x: flagged', env: { UPDATE_TYPE: 'version-update:semver-minor', UPDATED_DEPENDENCIES: patch('0.4.1', 'version-update:semver-minor') }, expect: { armed: false, commented: true } },
  { id: 'W13 patch from 0.0.x: flagged', env: { UPDATED_DEPENDENCIES: patch('0.0.3') }, expect: { armed: false, commented: true } },
  { id: 'W14 patch from 0.x: allowed', env: { UPDATED_DEPENDENCIES: patch('0.4.1') }, expect: { armed: true } },
  { id: 'W15 update details unreadable: flagged', env: { UPDATED_DEPENDENCIES: 'not json' }, expect: { armed: false, commented: true } },
  { id: 'W16 flagged while armed: turned off too', env: { UPDATE_TYPE: 'version-update:semver-major', FAKE_ARMED: 'true' }, expect: { armed: false, disarmed: true, commented: true } },
  { id: 'W17 flagged again: one comment only', env: { UPDATE_TYPE: 'version-update:semver-major', FAKE_COMMENTS: '1' }, expect: { armed: false, commented: false } },
];
const DISARM = [
  { id: 'D01 a push by someone else while armed: off, owner told', env: { ACTION: 'synchronize', FAKE_ARMED: 'true' }, expect: { disarmed: true, commented: true, said: /someone other than Dependabot/ } },
  { id: 'D02 a push by someone else, not armed: owner told', env: { ACTION: 'synchronize' }, expect: { disarmed: false, commented: true } },
  { id: 'D03 the base branch changed', env: { ACTION: 'edited', FAKE_ARMED: 'true' }, expect: { disarmed: true, commented: true, said: /base branch changed/ } },
  { id: 'D04 told once only', env: { ACTION: 'synchronize', FAKE_COMMENTS: '1' }, expect: { commented: false } },
];

test('SE-11 (WORKFLOW, DISARM): the workflow\'s runtime branches, run with a fake gh', { skip: HAS_SHELL ? false : 'needs bash, jq and base64 (not on Windows)' }, async (t) => {
  for (const [job, rows] of [['auto-merge', WORKFLOW], ['disarm', DISARM]]) {
    for (const row of rows) {
      await t.test(row.id, (st) => {
        const result = runJob(st, job, { ...BASE_ENV, ...row.env });
        for (const key of ['armed', 'disarmed', 'commented']) if (key in row.expect) assert.equal(result[key], row.expect[key], `${key}\n${result.calls}`);
        if (row.expect.said) assert.match(result.stdout, row.expect.said);
        assert.doesNotMatch(result.calls, /pr merge (?!--auto --merge|--disable-auto)/, 'no other merge');
      });
    }
  }
});

test('SE-12: the binding accepts only the known dependency update values', () => {
  const base = JSON.parse(binding());
  programmeState.validateBinding({ ...base, dependency_updates: { auto_merge: 'patch-minor', github_actions: 'owner' } });
  programmeState.validateBinding({ ...base, dependency_updates: {} });
  programmeState.validateBinding({ ...base, paid_security: 'off' });
  assert.throws(() => programmeState.validateBinding({ ...base, paid_security: 'yes' }), /paid_security must be off or on/);
  for (const bad of [{ auto_merge: 'all' }, { github_actions: 'yes' }, { auto_merge: 'off', extra: true }, 'patch-minor']) {
    assert.throws(() => programmeState.validateBinding({ ...base, dependency_updates: bad }), /dependency_updates/);
  }
  for (const file of ['.github/toolkit-programme.json', 'skills/repository-agent-rules/repo-local/toolkit-programme.template.json']) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).dependency_updates.github_actions, 'owner', `${file}: GitHub Actions updates stay with the owner`);
  }
});
