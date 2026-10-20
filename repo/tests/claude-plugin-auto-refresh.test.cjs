'use strict';

// Claude Code Toolkit plugin-cache auto-refresh: owner operation, bridge
// wiring, cross-host isolation and the setup preference. Native Claude CLI
// behaviour is covered by fake CLI cases in claude-toolkit-plugin-setup.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const refresh = require('../scripts/toolkit-claude-plugin-auto-refresh.cjs');
const bridge = require('../scripts/toolkit-local-bridge.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');
const claudeSetup = require('../scripts/setup-claude-toolkit-plugin.cjs');

const COMMIT = 'a'.repeat(40);

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-auto-refresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

// A plugin tree with every identity file the same-version check compares.
function pluginTree(root, version, marker = 'same') {
  writeFile(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ai-agent-toolkit', version }));
  for (const relPath of refresh.enforcementIdentityFiles()) {
    if (relPath === '.claude-plugin/plugin.json') continue;
    writeFile(path.join(root, ...relPath.split('/')), `${relPath}:${version}:${marker}\n`);
  }
  return root;
}

// Claude Code installs the plugin at
// <config home>/plugins/cache/<marketplace>/<plugin>/<version>.
function fixture(t, { running = '3.0.10', source = '3.0.11', sameBytes = false } = {}) {
  const root = tmp(t);
  const hubPath = path.join(root, 'home', 'current');
  fs.mkdirSync(hubPath, { recursive: true });
  const repoPath = pluginTree(path.join(root, 'source'), source);
  const configHome = path.join(root, 'claude-home');
  const family = path.join(configHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit');
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  // A same-bytes cache is a separate installed copy; the managed checkout
  // itself is the in-place case covered by claude-plugin-auto-refresh-family.
  const runningRoot = pluginTree(path.join(family, running), running, sameBytes ? 'same' : 'cache');
  return { root, hubPath, repoPath, runningRoot, configHome, family, project };
}

function argValue(args, name) { const index = args.indexOf(name); return index === -1 ? '' : args[index + 1]; }

// The native identity a real helper reports for the args it was given.
function nativeOf(args) {
  return {
    config_home: argValue(args, '--claude-config-home'),
    plugins_root: argValue(args, '--claude-plugins-root'),
    cache_family: path.dirname(argValue(args, '--running-plugin-root')),
    project_context: argValue(args, '--project-context')
  };
}

function deps(overrides = {}) {
  const calls = { lock: 0, release: 0, validate: 0, node: [] };
  const base = {
    acquireLock: () => { calls.lock += 1; return { acquired: true }; },
    releaseLock: () => { calls.release += 1; },
    git: (repoPath, args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { ok: true, stdout: `${repoPath}\n` };
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { ok: true, stdout: `${COMMIT}\n` };
      if (args[0] === 'status') return { ok: true, stdout: '' };
      return { ok: false, stdout: '' };
    },
    validateRepo: () => { calls.validate += 1; },
    runNode: () => { throw new Error('unexpected helper call'); },
    now: () => '2026-10-20T00:00:00.000Z'
  };
  return { calls, deps: { ...base, ...overrides } };
}

function helperReplies(replies, calls, hubPath) {
  return (script, args, options) => {
    const mode = args[0];
    calls.node.push({ mode, args, env: options.env, attemptAtCall: readAttempt(hubPath) });
    const reply = replies[mode];
    if (typeof reply === 'function') return reply(args, options);
    if (!reply) throw new Error(`unexpected helper mode ${mode}`);
    const report = typeof reply.build === 'function' ? reply.build(args) : { ...reply, native_identity: nativeOf(args) };
    return { ok: report.ok !== false, status: 0, stdout: `${JSON.stringify(report)}\n`, stderr: '', timedOut: false };
  };
}

function readAttempt(hubPath) {
  try { return JSON.parse(fs.readFileSync(path.join(path.dirname(hubPath), refresh.ATTEMPT_FILE), 'utf8')); } catch { return null; }
}

function operation(f, depBundle, env = {}) {
  return new refresh.ClaudePluginAutoRefreshOperation({
    lockRoot: path.dirname(f.hubPath),
    repoPath: f.repoPath,
    runningPluginRoot: f.runningRoot,
    executingRoot: f.runningRoot,
    projectDir: f.project,
    env: { CLAUDE_CONFIG_DIR: f.configHome, ...env },
    deps: depBundle.deps
  });
}

const stalePlan = (f) => ({ ok: true, mode: 'plan', mutation_attempted: false, status: 'stale', installed: { version: '3.0.10', scope: 'project', install_path: f.runningRoot, project_path: f.project } });
const updated = (f) => ({ build: (args) => ({ ok: true, mode: 'apply', mutation_attempted: true, status: 'updated', scope: 'project', project_path: f.project,
  install_path: path.join(f.family, '3.0.11'), from_version: '3.0.10', to_version: '3.0.11', native_identity: nativeOf(args) }) });

test('recursion guard and foreign runtime stop before taking the hub lock', (t) => {
  const f = fixture(t);
  const d = deps();
  assert.equal(operation(f, d, { [refresh.RECURSION_ENV]: '1' }).run().refresh_status, 'skipped-recursion');
  const foreign = new refresh.ClaudePluginAutoRefreshOperation({
    lockRoot: path.dirname(f.hubPath), repoPath: f.repoPath,
    runningPluginRoot: f.runningRoot, executingRoot: f.repoPath, env: {}, deps: d.deps
  }).run();
  assert.equal(foreign.refresh_status, 'untrusted-runtime');
  assert.equal(foreign.status, 'action-required');
  assert.equal(d.calls.lock, 0);
});

test('a concurrent refresh owner holding the real hub lock makes the hook skip without any check', (t) => {
  const f = fixture(t);
  const lockRoot = path.dirname(f.hubPath);
  fs.writeFileSync(path.join(lockRoot, 'update.lock'), JSON.stringify({ created_at: new Date().toISOString(), pid: process.ppid, token: 'held' }));
  const d = deps({
    acquireLock: (root) => bridge.acquireLock(root, { hook: true, syncSource: 'claude-plugin' }),
    releaseLock: bridge.releaseLock,
    git: () => { throw new Error('git must not run while another owner holds the lock'); }
  });
  const result = operation(f, d).run();
  assert.equal(result.refresh_status, 'busy');
  assert.equal(result.status, 'skipped');
  assert.ok(fs.existsSync(path.join(lockRoot, 'update.lock')), 'the other owner lock is never removed');
});

test('current cache is a no-op: no validation, no Claude CLI, lock released', (t) => {
  const f = fixture(t, { running: '3.0.11', source: '3.0.11', sameBytes: true });
  const d = deps();
  const result = operation(f, d).run();
  assert.equal(result.refresh_status, 'current');
  assert.equal(result.status, 'fresh');
  assert.equal(d.calls.validate, 0);
  assert.equal(d.calls.node.length, 0);
  assert.equal(d.calls.release, 1);
  assert.equal(refresh.claudeAutoRefreshStdoutLine(result), '');
});

test('same version with drifted bytes and a newer running cache fail closed without mutation', (t) => {
  const drift = fixture(t, { running: '3.0.11', source: '3.0.11' });
  const d1 = deps();
  const drifted = operation(drift, d1).run();
  assert.equal(drifted.refresh_status, 'stale-same-version');
  assert.equal(drifted.status, 'action-required');
  assert.equal(d1.calls.node.length, 0);

  const newer = fixture(t, { running: '3.0.12', source: '3.0.11' });
  const d2 = deps();
  const refused = operation(newer, d2).run();
  assert.equal(refused.refresh_status, 'newer-than-source');
  assert.match(refused.errors[0], /downgrade is refused/);
  assert.equal(d2.calls.node.length, 0);
  assert.match(refresh.claudeAutoRefreshStdoutLine(refused), /No plugin change was made/);
});

test('dirty, moved or unreadable managed source is untrusted before any refresh', (t) => {
  const f = fixture(t);
  for (const [name, git] of [
    ['dirty', (repo, args) => (args[0] === 'status' ? { ok: true, stdout: ' M file\n' } : deps().deps.git(repo, args))],
    ['not-root', (repo, args) => (args[1] === '--show-toplevel' ? { ok: true, stdout: path.dirname(repo) } : deps().deps.git(repo, args))],
    ['no-head', (repo, args) => (args[1] === 'HEAD' ? { ok: false, stdout: '' } : deps().deps.git(repo, args))]
  ]) {
    const d = deps({ git });
    const result = operation(f, d).run();
    assert.equal(result.refresh_status, 'source-untrusted', name);
    assert.equal(d.calls.validate, 0, name);
    assert.equal(d.calls.node.length, 0, name);
  }
});

test('failed managed source validation blocks the plan and the update', (t) => {
  const f = fixture(t);
  const d = deps({ validateRepo: () => { throw new Error('hook-light failed'); } });
  const result = operation(f, d).run();
  assert.equal(result.refresh_status, 'source-validation-failed');
  assert.equal(d.calls.node.length, 0);
  assert.equal(readAttempt(f.hubPath), null);
});

test('stale cache: durable in-flight record precedes the in-place update, which preserves scope and reports a fresh session', (t) => {
  const f = fixture(t);
  const d = deps();
  d.deps.runNode = helperReplies({ '--auto-refresh-plan': stalePlan(f), '--auto-refresh-apply': updated(f) }, d.calls, f.hubPath);
  const result = operation(f, d).run();
  assert.equal(result.refresh_status, 'updated');
  assert.equal(result.status, 'refreshed');
  assert.equal(result.fresh_session_required, true);
  assert.equal(result.scope, 'project');
  assert.deepEqual(d.calls.node.map((call) => call.mode), ['--auto-refresh-plan', '--auto-refresh-apply']);
  assert.equal(d.calls.node[0].attemptAtCall, null, 'read-only plan runs before any attempt record');
  assert.equal(d.calls.node[1].attemptAtCall.phase, 'in-flight', 'attempt is durable before mutation');
  for (const call of d.calls.node) assert.equal(call.env[refresh.RECURSION_ENV], '1');
  const apply = d.calls.node[1].args;
  assert.deepEqual(apply.slice(apply.indexOf('--expected-commit'), apply.indexOf('--expected-commit') + 6),
    ['--expected-commit', COMMIT, '--expected-from-version', '3.0.10', '--expected-to-version', '3.0.11']);
  assert.ok(!apply.includes('--scope') && !apply.includes('--write'), 'apply never chooses a scope or uses the install path');
  assert.equal(readAttempt(f.hubPath).phase, 'completed');
  assert.match(refresh.claudeAutoRefreshStdoutLine(result), /updated 3\.0\.10 -> 3\.0\.11 \(scope project\).*fresh Claude Code session/);
});

test('timeout with unknown outcome is held and never retried automatically', (t) => {
  const f = fixture(t);
  const d = deps();
  d.deps.runNode = helperReplies({
    '--auto-refresh-plan': stalePlan(f),
    '--auto-refresh-apply': () => ({ ok: false, status: null, stdout: '', stderr: '', timedOut: true })
  }, d.calls, f.hubPath);
  const first = operation(f, d).run();
  assert.equal(first.refresh_status, 'unknown-outcome');
  assert.equal(first.mutation_attempted, true);
  assert.match(refresh.claudeAutoRefreshStdoutLine(first), /unverified and will not be retried automatically/);
  assert.equal(readAttempt(f.hubPath).phase, 'held');

  const again = deps();
  const second = operation(f, again).run();
  assert.equal(second.refresh_status, 'held');
  assert.equal(again.calls.node.length, 0, 'no plan or update after an unknown outcome');
  assert.equal(again.calls.validate, 0);
});

test('a crash after the in-flight record (no outcome) is held; only that same install, verified current, resolves it', (t) => {
  const f = fixture(t);
  const target = (fx) => ({ plugin_id: 'ai-agent-toolkit@ai-agent-toolkit-local', marketplace: 'ai-agent-toolkit-local', scope: 'user', project_path: '',
    install_path: path.join(fx.family, '3.0.10'), config_home: fx.configHome, config_home_source: 'env',
    plugins_root: path.join(fx.configHome, 'plugins'), plugins_root_source: 'config-home', cache_family: fx.family, source_path: fx.repoPath });
  const crashed = (fx) => JSON.stringify({ schema: 1, phase: 'in-flight', attempt_id: 'crashed', from_version: '3.0.10', to_version: '3.0.11', target: target(fx) });
  fs.writeFileSync(path.join(path.dirname(f.hubPath), refresh.ATTEMPT_FILE), crashed(f));
  const d = deps();
  const held = operation(f, d).run();
  assert.equal(held.refresh_status, 'held');
  assert.equal(d.calls.node.length, 0);

  // The same install namespace later runs the updated 3.0.11 cache.
  const current = fixture(t, { running: '3.0.11', source: '3.0.11', sameBytes: true });
  fs.writeFileSync(path.join(path.dirname(current.hubPath), refresh.ATTEMPT_FILE), crashed(current));
  const check = deps();
  check.deps.runNode = helperReplies({ '--auto-refresh-plan': { ok: true, mutation_attempted: false, status: 'current',
    installed: { version: '3.0.11', scope: 'user', install_path: current.runningRoot, project_path: '' } } }, check.calls, current.hubPath);
  const resolved = operation(current, check).run();
  assert.equal(resolved.refresh_status, 'resolved-current');
  assert.equal(check.calls.validate, 1);
  assert.deepEqual(check.calls.node.map((call) => call.mode), ['--auto-refresh-plan'], 'read-only verification only');
  assert.equal(readAttempt(current.hubPath).phase, 'resolved');
  assert.equal(readAttempt(current.hubPath).resolved_by, 'same-target-verified');
  assert.equal(readAttempt(current.hubPath).previous.attempt_id, 'crashed');
});

test('a definite native update failure is held; explicit setup opt-in clears the hold with evidence retained', (t) => {
  const f = fixture(t);
  const d = deps();
  d.deps.runNode = helperReplies({
    '--auto-refresh-plan': stalePlan(f),
    '--auto-refresh-apply': { ok: false, mutation_attempted: true, status: 'update-failed', reason: 'exited with 1' }
  }, d.calls, f.hubPath);
  assert.equal(operation(f, d).run().refresh_status, 'update-failed');
  assert.equal(readAttempt(f.hubPath).outcome, 'update-failed');
  assert.equal(bridge.clearClaudeAutoRefreshHold(f.hubPath), true);
  assert.equal(readAttempt(f.hubPath).phase, 'cleared');
  assert.equal(readAttempt(f.hubPath).previous.outcome, 'update-failed');
  assert.equal(bridge.clearClaudeAutoRefreshHold(f.hubPath), false, 'nothing further to clear');
});

test('a plan change detected by apply before mutation is deferred, not held', (t) => {
  const f = fixture(t);
  const d = deps();
  d.deps.runNode = helperReplies({
    '--auto-refresh-plan': stalePlan(f),
    '--auto-refresh-apply': { ok: false, mode: 'apply', mutation_attempted: false, status: 'plan-changed', reason: 'state changed' }
  }, d.calls, f.hubPath);
  const result = operation(f, d).run();
  assert.equal(result.status, 'deferred');
  assert.equal(readAttempt(f.hubPath).outcome, 'not-attempted');
});

test('missing, disabled, ambiguous, foreign-source, newer and crashed plans never reach apply', (t) => {
  for (const status of ['missing', 'disabled', 'ambiguous', 'ambiguous-scope', 'untrusted-source', 'untrusted-runtime', 'newer-than-source']) {
    const f = fixture(t);
    const d = deps();
    d.deps.runNode = helperReplies({ '--auto-refresh-plan': { ok: true, mutation_attempted: false, status, reason: `${status} detail` } }, d.calls, f.hubPath);
    const result = operation(f, d).run();
    assert.equal(result.refresh_status, status);
    assert.equal(result.status, 'action-required');
    assert.deepEqual(d.calls.node.map((call) => call.mode), ['--auto-refresh-plan'], status);
    assert.equal(readAttempt(f.hubPath), null, status);
  }
  const f = fixture(t);
  const d = deps();
  d.deps.runNode = helperReplies({ '--auto-refresh-plan': () => ({ ok: false, status: null, stdout: 'partial', stderr: '', timedOut: true }) }, d.calls, f.hubPath);
  assert.equal(operation(f, d).run().refresh_status, 'plan-failed');
  assert.equal(readAttempt(f.hubPath), null);
});

test('an already-installed current plugin while this session runs an older cache asks only for a fresh session', (t) => {
  const f = fixture(t);
  const d = deps();
  d.deps.runNode = helperReplies({ '--auto-refresh-plan': { ok: true, mutation_attempted: false, status: 'current' } }, d.calls, f.hubPath);
  const result = operation(f, d).run();
  assert.equal(result.status, 'restart-required');
  assert.equal(result.fresh_session_required, true);
  assert.equal(d.calls.node.length, 1);
});

// The terminal records each real producer writes: completed (updated and
// not-attempted) by the stale-cache update, resolved by same-target
// verification, cleared by explicit setup recovery of a malformed record.
function producedTerminalRecords(t) {
  const f = fixture(t);
  const attemptFile = path.join(path.dirname(f.hubPath), refresh.ATTEMPT_FILE);
  const run = (replies) => {
    fs.rmSync(attemptFile, { force: true });
    const d = deps();
    d.deps.runNode = helperReplies(replies, d.calls, f.hubPath);
    operation(f, d).run();
    return readAttempt(f.hubPath);
  };
  const updatedRecord = run({ '--auto-refresh-plan': stalePlan(f), '--auto-refresh-apply': updated(f) });
  const notAttempted = run({ '--auto-refresh-plan': stalePlan(f),
    '--auto-refresh-apply': { ok: false, mode: 'apply', mutation_attempted: false, status: 'plan-changed', reason: 'state changed' } });
  const held = run({ '--auto-refresh-plan': stalePlan(f),
    '--auto-refresh-apply': { ok: false, mutation_attempted: true, status: 'update-failed', reason: 'exited with 1' } });

  const current = fixture(t, { running: '3.0.11', source: '3.0.11', sameBytes: true });
  const currentTarget = { ...held.target, install_path: path.join(current.family, '3.0.10'), config_home: current.configHome,
    plugins_root: path.join(current.configHome, 'plugins'), cache_family: current.family, source_path: current.repoPath, project_path: current.project };
  const currentAttempt = path.join(path.dirname(current.hubPath), refresh.ATTEMPT_FILE);
  fs.writeFileSync(currentAttempt, JSON.stringify({ ...held, to_version: '3.0.11', target: currentTarget }));
  const check = deps();
  check.deps.runNode = helperReplies({ '--auto-refresh-plan': { ok: true, mutation_attempted: false, status: 'current',
    installed: { version: '3.0.11', scope: 'project', install_path: current.runningRoot, project_path: current.project } } }, check.calls, current.hubPath);
  assert.equal(operation(current, check).run().refresh_status, 'resolved-current');
  const resolved = readAttempt(current.hubPath);

  fs.writeFileSync(attemptFile, '[]');
  assert.equal(bridge.clearClaudeAutoRefreshHold(f.hubPath), true);
  const cleared = readAttempt(f.hubPath);
  assert.deepEqual(cleared.previous, { phase: 'unreadable', raw: [] }, 'the malformed old record is retained verbatim');
  fs.rmSync(attemptFile, { force: true });
  return { f, attemptFile, updatedRecord, notAttempted, resolved, cleared };
}

test('F1b: terminal records with malformed nested targets or attestation fields stay held byte-for-byte with zero helper calls', (t) => {
  const { f, attemptFile, updatedRecord: u, notAttempted: n, resolved: r, cleared: c } = producedTerminalRecords(t);
  assert.equal(u.phase, 'completed');
  assert.equal(n.outcome, 'not-attempted');
  assert.equal(r.phase, 'resolved');
  const clone = (record) => JSON.parse(JSON.stringify(record));
  const withTarget = (record, edit) => { const copy = clone(record); copy.target = edit(copy.target); return copy; };
  const without = (record, key) => { const copy = clone(record); delete copy[key]; return copy; };
  const elsewhere = path.join(f.root, 'elsewhere');
  const malformed = [
    ['completed updated, array target', withTarget(u, () => [])],
    ['completed updated, empty target', withTarget(u, () => ({}))],
    ['completed not-attempted, array target', withTarget(n, () => [])],
    ['completed not-attempted, empty target', withTarget(n, () => ({}))],
    ['completed, target without install path', withTarget(u, (x) => { delete x.install_path; return x; })],
    ['completed, target without source path', withTarget(u, (x) => { delete x.source_path; return x; })],
    ['completed, target of another plugin', withTarget(u, (x) => ({ ...x, plugin_id: 'other@ai-agent-toolkit-local' }))],
    ['completed, target with an unknown scope', withTarget(u, (x) => ({ ...x, scope: 'global' }))],
    ['completed, user target naming a project', withTarget(u, (x) => ({ ...x, scope: 'user' }))],
    ['completed, project target with a relative project', withTarget(u, (x) => ({ ...x, project_path: 'project' }))],
    ['completed, target with an unknown home source', withTarget(u, (x) => ({ ...x, config_home_source: 'guessed' }))],
    ['completed, target with an unknown cache-root source', withTarget(u, (x) => ({ ...x, plugins_root_source: 'guessed' }))],
    ['completed, plugins root outside its config home', withTarget(u, (x) => ({ ...x, plugins_root: path.join(elsewhere, 'plugins') }))],
    ['completed, cache family outside its plugins root', withTarget(u, (x) => ({ ...x, cache_family: path.join(elsewhere, 'ai-agent-toolkit') }))],
    ['completed, install path outside its cache family', withTarget(u, (x) => ({ ...x, install_path: path.join(elsewhere, '3.0.10') }))],
    ['completed, install path not a versioned entry', withTarget(u, (x) => ({ ...x, install_path: path.join(x.cache_family, 'latest') }))],
    ['completed updated, scope not the target scope', { ...clone(u), scope: 'user' }],
    ['completed updated, without from version', without(u, 'from_version')],
    ['completed updated, without source commit', without(u, 'source_commit')],
    ['completed updated, malformed source commit', { ...clone(u), source_commit: 'HEAD' }],
    ['completed not-attempted, without reason', without(n, 'reason')],
    ['completed not-attempted, non-text reason', { ...clone(n), reason: 7 }],
    ['completed, unknown outcome', { ...clone(u), outcome: 'probably-updated' }],
    ['resolved, empty target and previous', { ...clone(r), target: {}, previous: {} }],
    ['resolved, array target', withTarget(r, () => [])],
    ['resolved, array previous', { ...clone(r), previous: [] }],
    ['resolved, previous not a pending attempt', { ...clone(r), previous: { ...clone(r.previous), phase: 'completed' } }],
    ['resolved, previous without attempt id', { ...clone(r), previous: without(r.previous, 'attempt_id') }],
    ['resolved, previous without target version', { ...clone(r), previous: without(r.previous, 'to_version') }],
    ['resolved, previous for another target', { ...clone(r), previous: withTarget(r.previous, (x) => ({ ...x, source_path: elsewhere })) }],
    ['resolved, both targets equally malformed', { ...clone(r), target: {}, previous: { ...clone(r.previous), target: {} } }],
    ['cleared, array previous', { ...clone(c), previous: [] }],
    ['cleared, text previous', { ...clone(c), previous: 'held' }],
    ['cleared, empty timestamp', { ...clone(c), cleared_at: '' }]
  ];
  for (const [label, record] of malformed) {
    assert.equal(refresh.classifyAttemptRecord(record).pending, true, label);
    const bytes = JSON.stringify(record);
    fs.writeFileSync(attemptFile, bytes);
    const d = deps();
    const result = operation(f, d).run();
    assert.equal(result.refresh_status, 'held', label);
    assert.equal(d.calls.node.length, 0, `${label}: no plan or apply`);
    assert.equal(d.calls.validate, 0, label);
    assert.equal(fs.readFileSync(attemptFile, 'utf8'), bytes, `${label}: kept byte-for-byte`);
  }

  // Positive controls: every producer-shaped terminal record discharges.
  for (const [label, record] of [['completed updated', u], ['completed not-attempted', n], ['resolved', r], ['cleared malformed record', c],
    ['cleared empty-object record', { ...clone(c), previous: {} }]]) {
    assert.equal(refresh.classifyAttemptRecord(record).pending, false, label);
    fs.writeFileSync(attemptFile, JSON.stringify(record));
    const d = deps();
    d.deps.runNode = helperReplies({ '--auto-refresh-plan': stalePlan(f),
      '--auto-refresh-apply': { ok: false, mutation_attempted: true, status: 'update-failed', reason: 'exited with 1' } }, d.calls, f.hubPath);
    assert.equal(operation(f, d).run().refresh_status, 'update-failed', label);
    assert.deepEqual(d.calls.node.map((call) => call.mode), ['--auto-refresh-plan', '--auto-refresh-apply'], label);
  }
});

function writeHubState(root, state) {
  const hubPath = path.join(root, 'current');
  writeFile(path.join(hubPath, 'state.json'), JSON.stringify({ hub_version: '3.0.10', bridge_versions_by_source: {}, ...state }));
  return hubPath;
}

function withEnv(t, values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

// In-process bridge runs must never touch the real home, temp report folder
// or host configuration.
function isolateBridge(t, root, pluginRoot = repoRoot) {
  const home = path.join(root, 'isolated-home');
  const temp = path.join(root, 'isolated-temp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(temp, { recursive: true });
  withEnv(t, {
    CLAUDE_PLUGIN_ROOT: pluginRoot, HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, TMPDIR: temp,
    CODEX_HOME: path.join(home, '.codex'), XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: home, LOCALAPPDATA: home
  });
  return home;
}

function bridgeRun(argv) {
  const lockCalls = [];
  const testHooks = {
    claudeAutoRefreshExecutingRoot: repoRoot,
    claudeAutoRefreshDeps: { acquireLock: (root) => { lockCalls.push(root); return { acquired: false, skipReason: 'test lock' }; } }
  };
  bridge.run(argv, testHooks);
  return lockCalls;
}

test('bridge runs the Claude refresh only from an opted-in Claude SessionStart hook', (t) => {
  const root = tmp(t);
  const home = isolateBridge(t, root);
  const enabled = writeHubState(path.join(home, 'on'), { claude_plugin_auto_refresh_enabled: true, repo_path: repoRoot });
  const disabled = writeHubState(path.join(home, 'off'), { repo_path: repoRoot });
  const hookArgs = (hub, source) => ['--hook', '--sync-enabled', '--write', '--sync-source', source, '--hub', hub];

  assert.equal(bridgeRun(hookArgs(enabled, 'claude-plugin')).length, 1, 'opted-in Claude hook reaches the refresh owner');
  assert.equal(bridgeRun(hookArgs(disabled, 'claude-plugin')).length, 0, 'default-off preference never refreshes');
  assert.equal(bridgeRun(hookArgs(enabled, 'codex-plugin')).length, 0, 'Codex hooks never refresh Claude');
  assert.equal(bridgeRun(hookArgs(enabled, 'repo')).length, 0, 'repo/OpenCode sync never refreshes Claude');
  assert.equal(bridgeRun(['--sync-enabled', '--write', '--sync-source', 'claude-plugin', '--hub', enabled]).length, 0, 'manual runs never refresh');
  assert.equal(bridgeRun(['--hook', '--sync-enabled', '--sync-source', 'claude-plugin', '--hub', enabled]).length, 0, 'dry-run hooks never refresh');
});

test('an older Claude hook blocked by the downgrade guard never attempts a refresh and says it cannot self-upgrade', (t) => {
  const root = tmp(t);
  const home = isolateBridge(t, root);
  const hub = writeHubState(path.join(home, 'newer'), {
    claude_plugin_auto_refresh_enabled: true, repo_path: repoRoot,
    hub_version: '99.0.0', bridge_versions_by_source: { 'claude-plugin': '99.0.0' }
  });
  let lockCalls = [];
  assert.throws(() => {
    lockCalls = bridgeRun(['--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin', '--hub', hub]);
  }, /Refusing downgrade[\s\S]*cannot refresh itself automatically[\s\S]*setup toolkit --host claude-code/);
  assert.deepEqual(lockCalls, []);
  assert.equal(fs.existsSync(path.join(home, refresh.ATTEMPT_FILE)), false);
});

test('bridge preference flags: default off, setup-only, mutually exclusive, audited', (t) => {
  const root = tmp(t);
  const home = isolateBridge(t, root);
  assert.throws(() => bridge.parseArgs(['--hook', '--enable-claude-plugin-auto-refresh']), /only be changed by setup/);
  assert.throws(() => bridge.parseArgs(['--enable-claude-plugin-auto-refresh', '--disable-claude-plugin-auto-refresh']), /cannot be used together/);
  const hub = writeHubState(path.join(home, 'hub'), {});
  const audit = (args) => {
    const original = console.log;
    console.log = () => {};
    try { return bridge.run(args).audit; } finally { console.log = original; }
  };
  assert.equal(audit(['--audit', '--hub', hub]).claude_plugin_auto_refresh_enabled, false);
  fs.writeFileSync(path.join(path.dirname(hub), refresh.ATTEMPT_FILE), JSON.stringify({ schema: 1, phase: 'held', outcome: 'unknown-timeout' }));
  audit(['--enable-claude-plugin-auto-refresh', '--write', '--hub', hub]);
  const after = audit(['--audit', '--hub', hub]);
  assert.equal(after.claude_plugin_auto_refresh_enabled, true);
  assert.equal(after.claude_plugin_auto_refresh_last_attempt.phase, 'cleared');
  assert.equal(after.codex_plugin_auto_refresh_enabled, false, 'Claude opt-in does not change Codex');
  audit(['--disable-claude-plugin-auto-refresh', '--write', '--hub', hub]);
  assert.equal(audit(['--audit', '--hub', hub]).claude_plugin_auto_refresh_enabled, false);
  // An unknown-state record is pending: audited as unreadable, and cleared only
  // by explicit opt-in with its original content retained.
  const unknown = { schema: 1, phase: 'mystery', attempt_id: 'legacy' };
  fs.writeFileSync(path.join(path.dirname(hub), refresh.ATTEMPT_FILE), JSON.stringify(unknown));
  const unknownAudit = audit(['--audit', '--hub', hub]).claude_plugin_auto_refresh_last_attempt;
  assert.equal(unknownAudit.phase, 'unreadable');
  assert.equal(unknownAudit.pending, true);
  audit(['--enable-claude-plugin-auto-refresh', '--write', '--hub', hub]);
  const recovered = readAttempt(hub);
  assert.equal(recovered.phase, 'cleared');
  assert.deepEqual(recovered.previous, unknown);
});

test('Claude action-required refresh outcomes open an update report; skipped and current do not', () => {
  const classify = (nativePluginCache) => bridge.classifyUpdateReport({ nativePluginCache });
  assert.equal(classify({ host: 'claude-code', status: 'action-required' }).actionable, true);
  assert.equal(classify({ host: 'claude-code', status: 'refreshed' }).kind, 'successful-activity');
  assert.equal(classify({ host: 'claude-code', status: 'skipped' }).kind, 'no-op');
  assert.equal(classify({ host: 'claude-code', status: 'fresh' }).kind, 'no-op');
});

test('the SessionStart hook cannot carry auto-refresh preference flags and the shipped hook stays valid', (t) => {
  const hooksPath = path.join(tmp(t), 'hooks.json');
  writeFile(hooksPath, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node bridge/toolkit-local-bridge.cjs --hook --sync-enabled --write --sync-source claude-plugin --enable-claude-plugin-auto-refresh' }] }] } }));
  assert.match(claudeSetup.verifySessionStartHook(hooksPath).join('\n'), /must not change plugin auto-refresh preferences/);
  assert.deepEqual(claudeSetup.verifySessionStartHook(path.join(repoRoot, '.claude-plugin', 'hooks', 'hooks.json')), []);
});

test('setup asks the Claude-only refresh question, defaults to keep/off, and writes only the chosen bridge flag', () => {
  const current = {
    managed: { currentPath: '', exists: false },
    audit: { repo_auto_update: {}, targets: {}, claude_plugin_auto_refresh_enabled: false },
    runtime: { runtime: 'unknown' },
    delegation: { status: 'unsupported', helper_count: null },
    agentProfile: { supported: true, topology: 'root-only' },
    nativePlugin: { status: 'fresh' }
  };
  const claudeRow = core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'claude-code']), current)
    .find((row) => row.key === 'claudePluginAutoRefresh');
  assert.ok(claudeRow, 'Claude host shows the question');
  assert.equal(claudeRow.recommended, 'keep');
  assert.deepEqual(claudeRow.choices.map((choice) => choice.value), ['enable', 'disable', 'keep']);
  assert.equal(core.setupQuestionSpecs(core.parseArgs(['--plan', '--host', 'codex']), current)
    .some((row) => row.key === 'claudePluginAutoRefresh'), false, 'Codex host never asks it');

  const enabled = core.parseArgs(['--plan', '--host', 'claude-code', '--enable-claude-plugin-auto-refresh']);
  assert.equal(enabled.claudePluginAutoRefresh, true);
  const plan = JSON.stringify(core.setupPlan(enabled));
  assert.match(plan, /--enable-claude-plugin-auto-refresh/);
  assert.doesNotMatch(plan, /codex-plugin-auto-refresh/);
  const skipped = core.parseArgs(['--plan', '--host', 'claude-code', '--skip-claude-plugin-auto-refresh']);
  assert.equal(skipped.claudePluginAutoRefresh, false);
  assert.match(JSON.stringify(core.setupPlan(skipped)), /--disable-claude-plugin-auto-refresh/);
  assert.equal(core.parseArgs(['--plan', '--host', 'claude-code']).claudePluginAutoRefresh, false, 'default off');
});
