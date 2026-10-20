'use strict';

// Claude Code plugin auto-refresh, B1 finding family (PR #522 G2): running-in-place
// identity, held unknown effects across hosts that share one hub, full
// same-version enforcement identity, reports with maintenance OFF, timeout
// budgets and the old-session restart wording. Each test drives the owner
// operation or the bridge with fakes; no real Claude CLI or host state is used.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const refresh = require('../scripts/toolkit-claude-plugin-auto-refresh.cjs');
const bridge = require('../scripts/toolkit-local-bridge.cjs');
const claudeSetup = require('../scripts/setup-claude-toolkit-plugin.cjs');

const COMMIT = 'a'.repeat(40);
const PLUGIN_ID = 'ai-agent-toolkit@ai-agent-toolkit-local';

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-refresh-family-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

// Every file the installed-enforcement identity contract names, plus the
// manifest, so a same-version tree is complete.
function identityFiles() {
  return [...new Set([...refresh.CURRENT_IDENTITY_FILES, ...claudeSetup.INSTALLED_ENFORCEMENT_FILES])];
}

function pluginTree(root, version, marker = 'same') {
  for (const relPath of identityFiles()) {
    if (relPath === '.claude-plugin/plugin.json') continue;
    writeFile(path.join(root, ...relPath.split('/')), `${relPath}:${version}:${marker}\n`);
  }
  writeFile(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ai-agent-toolkit', version }));
  return root;
}

function hub(t) {
  const root = tmp(t);
  const hubPath = path.join(root, 'home', 'current');
  fs.mkdirSync(hubPath, { recursive: true });
  return { root, hubPath, lockRoot: path.dirname(hubPath) };
}

function attemptPath(h) { return path.join(h.lockRoot, refresh.ATTEMPT_FILE); }
function readAttempt(h) { try { return JSON.parse(fs.readFileSync(attemptPath(h), 'utf8')); } catch { return null; } }
function attemptBytes(h) { try { return fs.readFileSync(attemptPath(h), 'utf8'); } catch { return null; } }

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

// The native identity a real helper reports for the args it was given.
function argValue(args, name) { const index = args.indexOf(name); return index === -1 ? '' : args[index + 1]; }
function nativeOf(args) {
  const runningRoot = argValue(args, '--running-plugin-root');
  return {
    ...(runningRoot ? {
      config_home: argValue(args, '--claude-config-home'),
      plugins_root: argValue(args, '--claude-plugins-root'),
      cache_family: path.dirname(runningRoot)
    } : {}),
    project_context: argValue(args, '--project-context')
  };
}

// Scripted helper replies keyed by mode; a reply may depend on the call args.
// Object replies carry the native identity the helper verified for those args.
function helper(d, replies) {
  d.deps.runNode = (script, args, options) => {
    const mode = args[0];
    d.calls.node.push({ mode, args, env: options.env, timeout: options.timeout, cwd: options.cwd });
    const reply = typeof replies[mode] === 'function' ? replies[mode](args, options) : replies[mode];
    if (!reply) throw new Error(`unexpected helper mode ${mode}`);
    if (reply.raw) return reply.raw;
    const report = Object.prototype.hasOwnProperty.call(reply, 'native_identity') ? reply : { ...reply, native_identity: nativeOf(args) };
    return { ok: reply.ok !== false, status: 0, stdout: `${JSON.stringify(report)}\n`, stderr: '', timedOut: false };
  };
  return d;
}

// Claude Code configuration home, plugin cache family and project of one host.
function claudeHome(root, name = 'home-a') {
  const configHome = path.join(root, name, '.claude');
  const family = path.join(configHome, 'plugins', 'cache', 'ai-agent-toolkit-local', 'ai-agent-toolkit');
  const project = path.join(root, name, 'project');
  fs.mkdirSync(project, { recursive: true });
  return { configHome, family, project, env: { CLAUDE_CONFIG_DIR: configHome } };
}

function op(h, { repoPath, runningRoot, env, projectDir, home = h.home || (h.home = claudeHome(h.root)) }, d) {
  return new refresh.ClaudePluginAutoRefreshOperation({
    lockRoot: h.lockRoot, repoPath, runningPluginRoot: runningRoot, executingRoot: runningRoot,
    env: env || home.env, projectDir: projectDir || home.project, deps: d.deps
  });
}

const modes = (d) => d.calls.node.map((call) => call.mode);
const TIMED_OUT = { raw: { ok: false, status: null, stdout: '', stderr: '', timedOut: true } };

function stalePlan(installPath, scope = 'user', projectPath = '') {
  return { ok: true, mode: 'plan', mutation_attempted: false, status: 'stale',
    installed: { version: '3.0.10', scope, install_path: installPath, project_path: projectPath } };
}

function currentPlan(installPath, version, scope = 'user', projectPath = '') {
  return { ok: true, mode: 'plan', mutation_attempted: false, status: 'current',
    installed: { version, scope, install_path: installPath, project_path: projectPath } };
}

function updatedReply(args, scope = 'user', projectPath = '') {
  return { ok: true, mode: 'apply', mutation_attempted: true, status: 'updated', scope, project_path: projectPath,
    from_version: '3.0.10', to_version: '3.0.11', install_path: path.join(path.dirname(argValue(args, '--running-plugin-root')), '3.0.11') };
}

// The complete native target the owner records for a host's install.
function targetFor(home, repoPath, installPath, scope = 'user', projectPath = '') {
  return { plugin_id: PLUGIN_ID, marketplace: 'ai-agent-toolkit-local', scope, project_path: projectPath, install_path: installPath,
    config_home: home.configHome, config_home_source: 'env', plugins_root: path.join(home.configHome, 'plugins'),
    plugins_root_source: 'config-home', cache_family: home.family, source_path: repoPath };
}

// One managed source at 3.0.11 and a stale 3.0.10 cache-backed install in
// one Claude Code configuration home.
function hosts(t) {
  const h = hub(t);
  h.home = claudeHome(h.root);
  const repoPath = pluginTree(path.join(h.root, 'source'), '3.0.11');
  const staleCache = pluginTree(path.join(h.home.family, '3.0.10'), '3.0.10', 'old');
  const currentCache = pluginTree(path.join(h.home.family, '3.0.11'), '3.0.11');
  return { h, repoPath, staleCache, currentCache, home: h.home };
}

// --- B1a: running-in-place identity ---------------------------------------

test('B1a: a session executing from the managed checkout is running-in-place, never fresh, and never updates or clears anything', (t) => {
  const { h, repoPath, staleCache } = hosts(t);
  const d = helper(deps(), {
    '--auto-refresh-plan': (args) => {
      assert.ok(args.includes('--running-in-place'), 'the in-place plan says so');
      assert.ok(!args.includes('--running-plugin-root'), 'the in-place plan never names a cache root');
      return { ok: true, mode: 'plan', mutation_attempted: false, status: 'in-place-record-stale', execution: 'managed-source',
        installed: { version: '3.0.10', scope: 'user', install_path: staleCache, read_from_folder: repoPath },
        reason: 'Claude Code reads Toolkit 3.0.11 directly from the managed checkout, but its install record for the separate plugin cache still reports 3.0.10' };
    }
  });
  const result = op(h, { repoPath, runningRoot: repoPath }, d).run();
  assert.notEqual(result.refresh_status, 'current');
  assert.notEqual(result.status, 'fresh');
  assert.equal(result.execution, 'managed-source');
  assert.equal(result.refresh_status, 'in-place-record-stale');
  assert.equal(result.status, 'action-required');
  assert.equal(result.mutation_attempted, false);
  assert.deepEqual(modes(d), ['--auto-refresh-plan'], 'read-only diagnostics only; no apply');
  assert.equal(readAttempt(h), null, 'no attempt record is written in place');
  const line = refresh.claudeAutoRefreshStdoutLine(result);
  assert.match(line, /No plugin change was made/);
  assert.doesNotMatch(line, /updated|is current/);
});

test('B1a: in place with a consistent native record reports a distinct running-in-place outcome without claiming a cache refresh', (t) => {
  const { h, repoPath } = hosts(t);
  const d = helper(deps(), {
    '--auto-refresh-plan': { ok: true, mode: 'plan', mutation_attempted: false, status: 'in-place-current', execution: 'managed-source',
      installed: { version: '3.0.11', scope: 'user', install_path: path.join(h.root, 'cache', 'x'), read_from_folder: repoPath } }
  });
  const result = op(h, { repoPath, runningRoot: repoPath }, d).run();
  assert.equal(result.refresh_status, 'running-in-place');
  assert.equal(result.status, 'in-place');
  assert.equal(bridge.classifyUpdateReport({ nativePluginCache: result }).kind, 'no-op');
  assert.match(refresh.claudeAutoRefreshStdoutLine(result), /directly from the managed checkout.*no plugin cache to refresh/);
  assert.equal(readAttempt(h), null);
});

test('B1a: in place without native read-in-place evidence, or with a failed check, fails closed with the manual action', (t) => {
  for (const reply of [
    { ok: true, mode: 'plan', mutation_attempted: false, status: 'in-place-unverified', reason: 'Claude Code does not report reading Toolkit from the managed checkout' },
    TIMED_OUT
  ]) {
    const { h, repoPath } = hosts(t);
    const d = helper(deps(), { '--auto-refresh-plan': reply });
    const result = op(h, { repoPath, runningRoot: repoPath }, d).run();
    assert.equal(result.status, 'action-required');
    assert.equal(result.mutation_attempted, false);
    assert.match(result.manual_action, /setup toolkit --host claude-code/);
    assert.deepEqual(modes(d), ['--auto-refresh-plan']);
  }
});

// --- B1b: unknown effect is never cleared by another entry ------------------

test('B1b: held cache-backed update -> in-place session -> the same entry again never re-applies', (t) => {
  const { h, repoPath, staleCache } = hosts(t);
  // 1-2. The cache-backed entry attempts an update; the outcome is unknown and held.
  const first = helper(deps(), { '--auto-refresh-plan': stalePlan(staleCache), '--auto-refresh-apply': TIMED_OUT });
  assert.equal(op(h, { repoPath, runningRoot: staleCache }, first).run().refresh_status, 'unknown-outcome');
  const held = readAttempt(h);
  assert.equal(held.phase, 'held');
  assert.deepEqual(held.target, targetFor(h.home, repoPath, staleCache));
  const heldBytes = attemptBytes(h);

  // 3. A separate source-loaded session starts.
  const inPlace = helper(deps(), {});
  const inPlaceResult = op(h, { repoPath, runningRoot: repoPath }, inPlace).run();
  assert.equal(inPlaceResult.refresh_status, 'held');
  assert.equal(inPlaceResult.status, 'action-required');
  assert.equal(attemptBytes(h), heldBytes, 'the in-place session never rewrites the held record');
  assert.deepEqual(modes(inPlace), []);

  // 4. The first entry starts again: no plan, no second apply.
  const again = helper(deps(), {});
  const second = op(h, { repoPath, runningRoot: staleCache }, again).run();
  assert.equal(second.refresh_status, 'held');
  assert.deepEqual(modes(again), [], 'no automatic second apply');
  assert.equal(attemptBytes(h), heldBytes);
});

test('B1b: an unrelated current entry (other scope or project) never reconciles a held attempt', (t) => {
  const { h, repoPath, staleCache, currentCache } = hosts(t);
  const first = helper(deps(), { '--auto-refresh-plan': stalePlan(staleCache, 'user'), '--auto-refresh-apply': TIMED_OUT });
  op(h, { repoPath, runningRoot: staleCache }, first).run();
  const heldBytes = attemptBytes(h);
  for (const plan of [
    currentPlan(currentCache, '3.0.11', 'project', path.join(h.root, 'some-project')),
    currentPlan(currentCache, '3.0.11', 'local', path.join(h.root, 'some-project')),
    currentPlan(path.join(h.root, 'cache', 'elsewhere'), '3.0.11', 'user')
  ]) {
    const d = helper(deps(), { '--auto-refresh-plan': plan });
    const result = op(h, { repoPath, runningRoot: currentCache }, d).run();
    assert.equal(result.refresh_status, 'held', `${plan.installed.scope} ${plan.installed.install_path}`);
    assert.equal(attemptBytes(h), heldBytes);
    assert.ok(!modes(d).includes('--auto-refresh-apply'));
  }
});

test('B1b: only the same target, independently verified current, reconciles a held attempt', (t) => {
  const { h, repoPath, staleCache, currentCache } = hosts(t);
  const first = helper(deps(), { '--auto-refresh-plan': stalePlan(staleCache, 'user'), '--auto-refresh-apply': TIMED_OUT });
  op(h, { repoPath, runningRoot: staleCache }, first).run();
  const d = helper(deps(), {
    '--auto-refresh-plan': (args) => {
      assert.equal(args[args.indexOf('--running-plugin-root') + 1], currentCache);
      return currentPlan(currentCache, '3.0.11', 'user');
    }
  });
  const result = op(h, { repoPath, runningRoot: currentCache }, d).run();
  assert.equal(result.refresh_status, 'resolved-current');
  assert.equal(d.calls.validate, 1, 'the source is validated before its helper is trusted');
  assert.deepEqual(modes(d), ['--auto-refresh-plan']);
  const record = readAttempt(h);
  assert.equal(record.phase, 'resolved');
  assert.equal(record.resolved_by, 'same-target-verified');
  assert.equal(record.previous.phase, 'held');
});

test('B1b: a crashed in-flight attempt is reconciled only by its own verified target; corrupted or targetless records stay held', (t) => {
  for (const [label, content, reconcilable] of [
    ['crashed in-flight with target', (cache, home, repoPath) => JSON.stringify({ schema: 1, phase: 'in-flight', attempt_id: 'crash', from_version: '3.0.10', to_version: '3.0.11',
      target: targetFor(home, repoPath, cache) }), true],
    ['crashed in-flight with a pre-namespace target', (cache) => JSON.stringify({ schema: 1, phase: 'in-flight', attempt_id: 'crash', from_version: '3.0.10', to_version: '3.0.11',
      target: { plugin_id: PLUGIN_ID, scope: 'user', project_path: '', install_path: cache } }), false],
    ['targetless in-flight', () => JSON.stringify({ schema: 1, phase: 'in-flight', attempt_id: 'old', to_version: '3.0.11' }), false],
    ['corrupted', () => '{ not json', false],
    ['wrong schema', () => JSON.stringify({ schema: 99, phase: 'completed' }), false]
  ]) {
    const { h, repoPath, staleCache, currentCache, home } = hosts(t);
    writeFile(attemptPath(h), content(staleCache, home, repoPath));
    const before = attemptBytes(h);
    const d = helper(deps(), { '--auto-refresh-plan': currentPlan(currentCache, '3.0.11', 'user') });
    const result = op(h, { repoPath, runningRoot: currentCache }, d).run();
    if (reconcilable) {
      assert.equal(result.refresh_status, 'resolved-current', label);
    } else {
      assert.equal(result.refresh_status, 'held', label);
      assert.equal(attemptBytes(h), before, label);
    }
    assert.ok(!modes(d).includes('--auto-refresh-apply'), label);
    if (!reconcilable) {
      // The stale entry itself stays blocked: no plan, no apply.
      const stale = helper(deps(), {});
      assert.equal(op(h, { repoPath, runningRoot: staleCache }, stale).run().refresh_status, 'held', label);
      assert.deepEqual(modes(stale), [], label);
    }
  }
});

test('B1b: a held record survives an unverified same-target check (plan not current, failed or ambiguous)', (t) => {
  for (const reply of [
    { ok: true, mode: 'plan', mutation_attempted: false, status: 'stale-same-version', reason: 'bytes differ' },
    { ok: true, mode: 'plan', mutation_attempted: false, status: 'ambiguous', reason: 'two installs' },
    TIMED_OUT
  ]) {
    const { h, repoPath, staleCache, currentCache } = hosts(t);
    const first = helper(deps(), { '--auto-refresh-plan': stalePlan(staleCache), '--auto-refresh-apply': TIMED_OUT });
    op(h, { repoPath, runningRoot: staleCache }, first).run();
    const before = attemptBytes(h);
    const d = helper(deps(), { '--auto-refresh-plan': reply });
    assert.equal(op(h, { repoPath, runningRoot: currentCache }, d).run().refresh_status, 'held');
    assert.equal(attemptBytes(h), before);
  }
});

test('B1b: repeated SessionStart from CLI (in place) and Desktop (cache) entries sharing one hub never re-admit the held effect', (t) => {
  const { h, repoPath, staleCache } = hosts(t);
  const first = helper(deps(), { '--auto-refresh-plan': stalePlan(staleCache), '--auto-refresh-apply': TIMED_OUT });
  op(h, { repoPath, runningRoot: staleCache }, first).run();
  const before = attemptBytes(h);
  let applies = 0;
  for (let round = 0; round < 3; round += 1) {
    for (const runningRoot of [repoPath, staleCache]) {
      const d = helper(deps(), {});
      const result = op(h, { repoPath, runningRoot }, d).run();
      assert.equal(result.refresh_status, 'held');
      applies += modes(d).filter((mode) => mode === '--auto-refresh-apply').length;
    }
  }
  assert.equal(applies, 0);
  assert.equal(attemptBytes(h), before);
});

test('B1b: the in-flight record names its target before the native update starts', (t) => {
  const { h, repoPath, staleCache } = hosts(t);
  let recordAtApply = null;
  const d = helper(deps(), {
    '--auto-refresh-plan': stalePlan(staleCache, 'project', h.home.project),
    '--auto-refresh-apply': (args) => { recordAtApply = readAttempt(h); return updatedReply(args, 'project', h.home.project); }
  });
  assert.equal(op(h, { repoPath, runningRoot: staleCache }, d).run().refresh_status, 'updated');
  assert.equal(recordAtApply.phase, 'in-flight');
  assert.deepEqual(recordAtApply.target, targetFor(h.home, repoPath, staleCache, 'project', h.home.project));
  assert.equal(recordAtApply.project_context, h.home.project);
});

test('B1: lock contention skips before reading or writing the attempt record', (t) => {
  const { h, repoPath, staleCache } = hosts(t);
  writeFile(attemptPath(h), JSON.stringify({ schema: 1, phase: 'held', outcome: 'unknown-timeout' }));
  const before = attemptBytes(h);
  const d = helper(deps({ acquireLock: () => ({ acquired: false, skipReason: 'busy' }) }), {});
  for (const runningRoot of [repoPath, staleCache]) {
    assert.equal(op(h, { repoPath, runningRoot }, d).run().refresh_status, 'busy');
  }
  assert.equal(attemptBytes(h), before);
  assert.deepEqual(modes(d), []);
});

// --- H1: full installed-enforcement identity ---------------------------------

test('H1: same-version freshness uses the full installed-enforcement identity, including the agent hook and agent control', (t) => {
  const required = ['repo/scripts/toolkit-claude-agent-hook.cjs', 'repo/scripts/toolkit-agent-control.cjs',
    'repo/scripts/claude-process-launch.cjs', 'repo/scripts/setup-claude-toolkit-plugin.cjs', 'repo/scripts/toolkit-local-bridge.cjs'];
  for (const relPath of required) assert.ok(identityFiles().includes(relPath), relPath);
  for (const relPath of [...required, 'repo/contracts/controller-kernel/stack-registry-v3.json']) {
    const h = hub(t);
    const repoPath = pluginTree(path.join(h.root, 'source'), '3.0.11');
    const cache = pluginTree(path.join(h.root, 'cache', '3.0.11'), '3.0.11');
    writeFile(path.join(cache, ...relPath.split('/')), 'drifted\n');
    const d = deps();
    const result = op(h, { repoPath, runningRoot: cache }, d).run();
    assert.equal(result.refresh_status, 'stale-same-version', relPath);
    assert.equal(result.status, 'action-required', relPath);
    assert.deepEqual(modes(d), [], relPath);
  }
  const h = hub(t);
  const repoPath = pluginTree(path.join(h.root, 'source'), '3.0.11');
  const cache = pluginTree(path.join(h.root, 'cache', '3.0.11'), '3.0.11');
  fs.rmSync(path.join(cache, 'repo', 'scripts', 'toolkit-agent-control.cjs'));
  assert.equal(op(h, { repoPath, runningRoot: cache }, deps()).run().refresh_status, 'stale-same-version', 'a missing enforcement file is not current');
  const clean = hub(t);
  const cleanRepo = pluginTree(path.join(clean.root, 'source'), '3.0.11');
  const cleanCache = pluginTree(path.join(clean.root, 'cache', '3.0.11'), '3.0.11');
  const cleanResult = op(clean, { repoPath: cleanRepo, runningRoot: cleanCache }, deps()).run();
  assert.equal(cleanResult.refresh_status, 'current');
  assert.equal(cleanResult.execution, 'plugin-cache');
});

// O2: every local module the Claude hooks and the refresh helper can load,
// including lazily required ones, is part of the enforcement identity, so a
// same-version cache cannot run drifted runtime code that the check ignores.
test('O2: the installed-enforcement identity covers the full local require graph of the Claude hook runtime', () => {
  const entries = ['repo/scripts/toolkit-local-bridge.cjs', 'repo/scripts/toolkit-claude-agent-hook.cjs',
    'repo/scripts/toolkit-claude-plugin-auto-refresh.cjs', 'repo/scripts/setup-claude-toolkit-plugin.cjs'];
  const reached = new Set();
  const visit = (relPath) => {
    if (reached.has(relPath)) return;
    reached.add(relPath);
    const text = fs.readFileSync(path.join(repoRoot, ...relPath.split('/')), 'utf8');
    for (const match of text.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      let next = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), match[1]));
      if (!fs.existsSync(path.join(repoRoot, ...next.split('/'))) && fs.existsSync(path.join(repoRoot, ...`${next}.cjs`.split('/')))) next = `${next}.cjs`;
      if (/\.(cjs|js|json)$/.test(next)) visit(next);
    }
  };
  entries.forEach(visit);
  assert.ok(reached.size > entries.length, 'the graph was walked');
  const missing = [...reached].filter((relPath) => !claudeSetup.INSTALLED_ENFORCEMENT_FILES.includes(relPath));
  assert.deepEqual(missing, []);
});

test('H1: the hook-side identity set and the installed-enforcement validator are one contract', () => {
  for (const relPath of refresh.CURRENT_IDENTITY_FILES) assert.ok(claudeSetup.INSTALLED_ENFORCEMENT_FILES.includes(relPath), relPath);
  for (const relPath of claudeSetup.INSTALLED_ENFORCEMENT_FILES) assert.ok(fs.existsSync(path.join(repoRoot, ...relPath.split('/'))), relPath);
});

// --- H3: timeout coherence ----------------------------------------------------

test('H3: helper worst-case budgets fit the outer apply/plan timeouts and the 600s SessionStart limit', () => {
  const env = refresh.autoRefreshChildEnv({});
  const plan = claudeSetup.autoRefreshBudgetMs('plan', '', env);
  const apply = claudeSetup.autoRefreshBudgetMs('apply', '', env);
  assert.ok(plan <= refresh.PLAN_BUDGET_MS && refresh.PLAN_BUDGET_MS < refresh.PLAN_TIMEOUT_MS, `plan ${plan}`);
  assert.ok(apply <= refresh.APPLY_BUDGET_MS && refresh.APPLY_BUDGET_MS < refresh.APPLY_TIMEOUT_MS, `apply ${apply}`);
  const hookTotal = refresh.HOOK_WORST_CASE_MS;
  assert.ok(hookTotal <= 600000 - 30000, `hook total ${hookTotal}`);
  // Owner overrides that would exceed the pinned budget are replaced, not inherited.
  const overridden = refresh.autoRefreshChildEnv({ CLAUDE_TOOLKIT_CLAUDE_CLI_TIMEOUT_MS: '900000', CLAUDE_TOOLKIT_CLAUDE_PLUGIN_MUTATION_DEADLINE_MS: '3600000' });
  assert.equal(claudeSetup.autoRefreshBudgetMs('apply', '', overridden), apply);
});

test('H3: the operation passes the pinned budget and environment to both helper phases', (t) => {
  const { h, repoPath, staleCache } = hosts(t);
  const d = helper(deps(), {
    '--auto-refresh-plan': stalePlan(staleCache),
    '--auto-refresh-apply': (args) => updatedReply(args)
  });
  op(h, { repoPath, runningRoot: staleCache, env: { ...h.home.env, CLAUDE_TOOLKIT_CLAUDE_CLI_TIMEOUT_MS: '900000' } }, d).run();
  const [plan, apply] = d.calls.node;
  assert.equal(plan.args[plan.args.indexOf('--budget-ms') + 1], String(refresh.PLAN_BUDGET_MS));
  assert.equal(plan.timeout, refresh.PLAN_TIMEOUT_MS);
  assert.equal(apply.args[apply.args.indexOf('--budget-ms') + 1], String(refresh.APPLY_BUDGET_MS));
  assert.equal(apply.timeout, refresh.APPLY_TIMEOUT_MS);
  for (const call of d.calls.node) {
    assert.equal(call.env.CLAUDE_TOOLKIT_CLAUDE_CLI_TIMEOUT_MS, refresh.autoRefreshChildEnv({}).CLAUDE_TOOLKIT_CLAUDE_CLI_TIMEOUT_MS);
    assert.equal(call.env[refresh.RECURSION_ENV], '1');
  }
});

// --- L2: old-session restart wording --------------------------------------------

test('L2: an older Claude session blocked after a refresh is told a fresh session may be enough', () => {
  const text = bridge.downgradeRemediation('claude-plugin');
  assert.match(text, /start a fresh Claude Code session/);
  assert.match(text, /clearing or compacting the conversation keeps the old plugin/);
  assert.doesNotMatch(text, /\/clear|\/compact/, 'slash commands would be redacted as paths by the output sanitizer');
  assert.match(text, /cannot refresh itself automatically/);
  assert.match(text, /setup toolkit --host claude-code/);
});

test('L2: operator lines survive the bridge output path redaction unchanged', () => {
  const results = [
    { refresh_status: 'updated', from_version: '3.0.10', to_version: '3.0.11', scope: 'user', source_commit: COMMIT },
    { refresh_status: 'installed-current' },
    { refresh_status: 'resolved-current' },
    { refresh_status: 'running-in-place', running_version: '3.0.11', source_commit: COMMIT },
    { refresh_status: 'held', status: 'action-required', errors: ['a previous automatic refresh was not verified'], manual_action: refresh.HELD_ACTION },
    { refresh_status: 'in-place-record-stale', status: 'action-required', errors: ['record still reports 3.0.10'], manual_action: refresh.MANUAL_ACTION }
  ];
  for (const result of results) {
    const line = refresh.claudeAutoRefreshStdoutLine(result);
    assert.ok(line, result.refresh_status);
    assert.equal(bridge.sanitizeOutputMessage(line), line, result.refresh_status);
  }
});

// --- H2: action-required report with maintenance OFF ----------------------------

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

function isolatedBridgeHub(t, state) {
  const root = tmp(t);
  const home = path.join(root, 'home');
  const temp = path.join(root, 'temp');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(temp, { recursive: true });
  withEnv(t, {
    CLAUDE_PLUGIN_ROOT: repoRoot, HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, TMPDIR: temp,
    CODEX_HOME: path.join(home, '.codex'), XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: home, LOCALAPPDATA: home
  });
  const hubPath = path.join(home, 'hub', 'current');
  writeFile(path.join(hubPath, 'state.json'), JSON.stringify({
    schema_version: 1, hub_version: '3.0.10', bridge_versions_by_source: {},
    auto_sync_enabled: false, repo_auto_update_enabled: false, codex_plugin_auto_refresh_enabled: false,
    claude_plugin_auto_refresh_enabled: true, repo_path: repoRoot, ...state
  }));
  return { hubPath, temp };
}

function quietly(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.join(' ')); };
  try { return { value: fn(), lines }; } finally { console.log = original; }
}

function reportFiles(temp) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^toolkit-update-.*\.md$/.test(entry.name)) found.push(full);
    }
  };
  walk(temp);
  return found;
}

function offHookRun(hubPath, opened) {
  return bridge.run(['--hook', '--sync-enabled', '--write', '--sync-source', 'claude-plugin', '--hub', hubPath], {
    claudeAutoRefreshExecutingRoot: repoRoot,
    claudeAutoRefreshDeps: {
      acquireLock: () => ({ acquired: true }),
      releaseLock: () => {},
      git: () => ({ ok: false, stdout: '' })
    },
    openUpdateReport: (reportPath) => { opened.push(reportPath); return { ok: true }; }
  });
}

test('H2: with auto-sync and repo auto-update OFF, an action-required refresh still writes one deduplicated report and keeps every OFF flag', (t) => {
  const { hubPath, temp } = isolatedBridgeHub(t, {});
  const stateBefore = fs.readFileSync(path.join(hubPath, 'state.json'), 'utf8');
  const opened = [];
  const first = quietly(() => offHookRun(hubPath, opened));
  assert.match(first.lines.join('\n'), /action required \(source-untrusted\)/);
  const reports = reportFiles(temp);
  assert.equal(reports.length, 1, 'one actionable report');
  const markdown = fs.readFileSync(reports[0], 'utf8');
  assert.match(markdown, /Claude Code native plugin cache auto-refresh: action required/);
  assert.match(markdown, /setup toolkit --host claude-code/);
  assert.equal(opened.length, 1, 'action-required reports follow the failure-only opening rule');
  assert.equal(fs.readFileSync(path.join(hubPath, 'state.json'), 'utf8'), stateBefore, 'hub state and all OFF preferences are untouched');
  quietly(() => offHookRun(hubPath, opened));
  assert.equal(reportFiles(temp).length, 1, 'an unchanged outcome is not reported twice');
});

test('H2: an owner who disabled update reports gets no report; the one-line notice remains', (t) => {
  const { hubPath, temp } = isolatedBridgeHub(t, { update_report_enabled: false });
  const opened = [];
  const run = quietly(() => offHookRun(hubPath, opened));
  assert.match(run.lines.join('\n'), /Toolkit Claude plugin auto-refresh: action required/);
  assert.deepEqual(reportFiles(temp), []);
  assert.deepEqual(opened, []);
});

test('H2: preference OFF writes nothing and runs no refresh even with maintenance OFF', (t) => {
  const { hubPath, temp } = isolatedBridgeHub(t, { claude_plugin_auto_refresh_enabled: false });
  const opened = [];
  const run = quietly(() => offHookRun(hubPath, opened));
  assert.doesNotMatch(run.lines.join('\n'), /auto-refresh/);
  assert.deepEqual(reportFiles(temp), []);
  assert.equal(fs.existsSync(path.join(path.dirname(hubPath), refresh.ATTEMPT_FILE)), false);
});
