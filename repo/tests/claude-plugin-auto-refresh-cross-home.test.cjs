'use strict';

// Claude Code plugin auto-refresh across Claude Code configuration homes,
// attempt-record states and native scopes (PR #522 G2 recheck F1/F1b/F2/O3).
// Every case drives the real bridge SessionStart path and the real managed-
// source setup helper against isolated fake native Claude CLIs; see
// claude-plugin-auto-refresh-native-support.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const bridge = require('../scripts/toolkit-local-bridge.cjs');
const { makeWorld, readJson, writeJson } = require('./claude-plugin-auto-refresh-native-support.cjs');

function world(t) {
  const { world: w, cleanup } = makeWorld(repoRoot);
  t.after(cleanup);
  return w;
}

// Home A's stale install starts an automatic update that fails: one apply, held.
function heldHomeA(w, options = {}) {
  const a = w.home({ name: 'home-a', ...options });
  const first = w.session(bridge, a);
  assert.equal(first.status, 'update-failed', first.line);
  assert.equal(w.updates(a).length, 1);
  assert.equal(w.attempt().phase, 'held');
  return a;
}

// --- F1: cross-home held-attempt clearance -----------------------------------

test('F1: a verified-current install in another Claude configuration home never resolves or re-admits a held attempt', (t) => {
  const w = world(t);
  const a = heldHomeA(w);
  const heldBytes = w.attemptBytes();
  const target = w.attempt().target;
  assert.equal(path.resolve(target.config_home), path.resolve(a.configHome));
  assert.equal(path.resolve(target.cache_family), path.resolve(a.family));
  assert.equal(path.resolve(target.source_path), path.resolve(w.source));

  // Home B: same plugin id, user scope, verified current, sharing the hub.
  const b = w.home({ name: 'home-b', version: w.version });
  const fromB = w.session(bridge, b);
  assert.equal(fromB.status, 'held', fromB.line);
  assert.match(fromB.line, /different Claude Code install/);
  assert.equal(w.updates(b).length, 0, 'Home B makes no apply attempt');
  assert.equal(w.attemptBytes(), heldBytes, 'Home B cannot resolve or rewrite Home A\'s record');

  const again = w.session(bridge, a);
  assert.equal(again.status, 'held', again.line);
  assert.equal(w.updates(a).length, 1, 'Home A makes exactly one original apply attempt');
  assert.equal(w.attemptBytes(), heldBytes, 'the held record and its evidence are preserved');
});

test('F1: other homes, cache roots, scopes, scrubbed configuration and missing provenance never clear a held attempt', (t) => {
  const variants = [
    ['project scope in another home', { name: 'home-b', scope: 'project' }, {}],
    ['local scope in another home', { name: 'home-b', scope: 'local' }, {}],
    ['plugin cache root override', { name: 'home-b', cacheDir: 'override' }, {}],
    ['scrubbed configuration home', { name: 'home-b' }, { scrubConfig: true }]
  ];
  for (const [label, homeOptions, sessionOptions] of variants) {
    const w = world(t);
    heldHomeA(w);
    const heldBytes = w.attemptBytes();
    const cacheDir = homeOptions.cacheDir ? path.join(w.root, 'plugin-cache-root') : undefined;
    const b = w.home({ ...homeOptions, version: w.version, ...(cacheDir ? { cacheDir } : {}) });
    const result = w.session(bridge, b, sessionOptions);
    assert.equal(result.status, 'held', `${label}: ${result.line}`);
    assert.equal(w.updates(b).length, 0, label);
    assert.equal(w.attemptBytes(), heldBytes, label);
  }
});

test('F1: the same home and target, natively updated to a new versioned cache, resolves its own held attempt only after full verification', (t) => {
  const w = world(t);
  const a = heldHomeA(w);
  const newCache = w.nativeUpdate(a);
  assert.notEqual(path.resolve(newCache), path.resolve(a.installPath), 'the versioned install path changed');
  const resolved = w.session(bridge, a, { runningRoot: newCache });
  assert.equal(resolved.status, 'resolved-current', resolved.line);
  const record = w.attempt();
  assert.equal(record.phase, 'resolved');
  assert.equal(record.resolved_by, 'same-target-verified');
  assert.equal(record.previous.phase, 'held');
  assert.equal(w.updates(a).length, 1, 'verification is read-only');
  assert.equal(w.session(bridge, a, { runningRoot: newCache }).status, 'silent', 'then simply current');
});

test('F1: source mismatch, another project and a pre-namespace record stay held even for a natively updated same-home cache', (t) => {
  const cases = [
    ['managed source identity mismatch', (w) => { const r = w.attempt(); r.target.source_path = path.join(w.root, 'other-source'); writeJson(w.attemptPath, r); }, {}],
    ['pre-namespace record without provenance', (w) => {
      const r = w.attempt();
      r.target = { plugin_id: r.target.plugin_id, scope: r.target.scope, project_path: r.target.project_path, install_path: r.target.install_path };
      writeJson(w.attemptPath, r);
    }, {}],
    ['attempt for another project', null, { scope: 'project' }]
  ];
  for (const [label, mutate, homeOptions] of cases) {
    const w = world(t);
    const a = heldHomeA(w, homeOptions);
    if (mutate) mutate(w);
    const before = w.attemptBytes();
    const newCache = w.nativeUpdate(a);
    const otherProject = path.join(w.root, 'other-project');
    fs.mkdirSync(otherProject, { recursive: true });
    const result = w.session(bridge, a, { runningRoot: newCache, ...(mutate ? {} : { projectDir: otherProject }) });
    assert.equal(result.status, 'held', `${label}: ${result.line}`);
    assert.equal(w.attemptBytes(), before, label);
    assert.equal(w.updates(a).length, 1, label);
  }
});

// --- F1b: conservative attempt-state admission ---------------------------------

test('F1b: missing, unknown, spoofed-terminal, malformed and wrong-schema records hold every automatic update', (t) => {
  const records = [
    ['missing phase', JSON.stringify({ schema: 1, attempt_id: 'x' })],
    ['unknown phase', JSON.stringify({ schema: 1, phase: 'mystery', attempt_id: 'x' })],
    ['spoofed completed', JSON.stringify({ schema: 1, phase: 'completed' })],
    ['completed without attestation', JSON.stringify({ schema: 1, phase: 'completed', outcome: 'updated', attempt_id: 'x' })],
    ['spoofed resolved', JSON.stringify({ schema: 1, phase: 'resolved', resolved_by: 'someone' })],
    ['spoofed cleared', JSON.stringify({ schema: 1, phase: 'cleared' })],
    ['null', 'null'],
    ['array', '[]'],
    ['wrong schema', JSON.stringify({ schema: 2, phase: 'completed', outcome: 'updated' })],
    ['corrupted', '{ not json']
  ];
  for (const [label, bytes] of records) {
    const w = world(t);
    const a = w.home({ name: 'home-a' });
    fs.mkdirSync(path.dirname(w.attemptPath), { recursive: true });
    fs.writeFileSync(w.attemptPath, bytes);
    for (let round = 0; round < 2; round += 1) {
      const result = w.session(bridge, a);
      assert.equal(result.status, 'held', `${label}: ${result.line}`);
    }
    assert.equal(w.updates(a).length, 0, `${label}: no automatic apply`);
    assert.equal(w.attemptBytes(), bytes, `${label}: kept byte-for-byte`);
    const audit = readJson(path.join(w.hubPath, 'state.json'));
    assert.equal(audit.claude_plugin_auto_refresh_enabled, true, label);
  }
});

test('F1b: only explicit setup opt-in clears an unknown record, retaining it as evidence; the next session may apply once', (t) => {
  const w = world(t);
  const a = w.home({ name: 'home-a' });
  const unknown = JSON.stringify({ schema: 1, phase: 'mystery', attempt_id: 'legacy' });
  fs.mkdirSync(path.dirname(w.attemptPath), { recursive: true });
  fs.writeFileSync(w.attemptPath, unknown);
  assert.equal(w.session(bridge, a).status, 'held');
  assert.equal(w.setupOptIn(bridge), true);
  const cleared = w.attempt();
  assert.equal(cleared.phase, 'cleared');
  assert.deepEqual(cleared.previous, JSON.parse(unknown));
  assert.equal(w.session(bridge, a).status, 'update-failed');
  assert.equal(w.updates(a).length, 1);
  assert.equal(w.session(bridge, a).status, 'held');
  assert.equal(w.updates(a).length, 1);

  const corrupted = world(t);
  const c = corrupted.home({ name: 'home-a' });
  fs.mkdirSync(path.dirname(corrupted.attemptPath), { recursive: true });
  fs.writeFileSync(corrupted.attemptPath, '{ not json');
  corrupted.setupOptIn(bridge);
  assert.equal(corrupted.attempt().previous.raw, '{ not json', 'unparseable bytes are retained');
  assert.equal(corrupted.updates(c).length, 0);
});

test('F1b: a crash after the in-flight record holds; repeated SessionStarts never retry; only the same verified target resolves it', (t) => {
  const w = world(t);
  const a = heldHomeA(w);
  const record = w.attempt();
  writeJson(w.attemptPath, { ...record, phase: 'in-flight', outcome: undefined, held_at: undefined });
  const crashed = w.attemptBytes();
  for (let round = 0; round < 3; round += 1) assert.equal(w.session(bridge, a).status, 'held');
  assert.equal(w.updates(a).length, 1);
  assert.equal(w.attemptBytes(), crashed);
  const newCache = w.nativeUpdate(a);
  assert.equal(w.session(bridge, a, { runningRoot: newCache }).status, 'resolved-current');
});

test('F1b: a failed attempt-state rewrite after a native update leaves the attempt in flight and never retries it', (t) => {
  const w = world(t);
  const a = w.home({ name: 'home-a' });
  w.stageUpdate(a);
  const originalRename = fs.renameSync;
  t.after(() => { fs.renameSync = originalRename; });
  fs.renameSync = (from, to) => {
    if (path.resolve(String(to)) === path.resolve(w.attemptPath) && /"phase": "completed"/.test(fs.readFileSync(from, 'utf8'))) {
      throw Object.assign(new Error('injected attempt-state write failure'), { code: 'EIO' });
    }
    return originalRename(from, to);
  };
  const result = w.session(bridge, a);
  fs.renameSync = originalRename;
  assert.equal(result.status, 'refresh-error', result.line);
  assert.equal(w.attempt().phase, 'in-flight');
  assert.equal(w.updates(a).length, 1);
  assert.equal(w.session(bridge, a).status, 'held');
  assert.equal(w.updates(a).length, 1);
});

// --- F2: project/local execution context ---------------------------------------

test('F2: project and local installs enabled only in their own project are refreshed from that project context', (t) => {
  for (const scope of ['project', 'local']) {
    const w = world(t);
    const a = w.home({ name: 'home-a', scope });
    w.stageUpdate(a);
    const result = w.session(bridge, a);
    assert.equal(result.status, 'updated', `${scope}: ${result.line}`);
    const updates = w.updates(a);
    assert.equal(updates.length, 1, scope);
    assert.deepEqual(updates[0].args.slice(2), ['ai-agent-toolkit@ai-agent-toolkit-local', '--scope', scope]);
    const nativeCalls = w.calls(a).filter((call) => call.args[0] === 'plugin');
    assert.ok(nativeCalls.length >= 3, `${scope}: list, update and verification`);
    for (const call of nativeCalls) assert.equal(path.resolve(call.cwd), path.resolve(a.project), `${scope}: ${call.args.join(' ')} runs in the project`);
    assert.equal(w.attempt().phase, 'completed');
  }
});

test('F2: genuinely disabled, foreign-project and user-scope-disabled-in-project installs are refused without mutation', (t) => {
  const cases = [
    ['project install disabled in its project', { scope: 'project', enabledIn: 'none' }, {}, 'disabled'],
    ['local install disabled by local settings', { scope: 'local', disabledIn: 'local', enabledIn: 'project' }, {}, 'disabled'],
    ['project install of another project', { scope: 'project' }, { foreignProject: true }, 'foreign-project'],
    ['user install disabled in this project', { scope: 'user', disabledIn: 'project' }, {}, 'disabled']
  ];
  for (const [label, homeOptions, sessionOptions, status] of cases) {
    const w = world(t);
    const a = w.home({ name: 'home-a', ...homeOptions });
    w.stageUpdate(a);
    let projectDir;
    if (sessionOptions.foreignProject) {
      projectDir = path.join(w.root, 'other-project');
      fs.mkdirSync(projectDir, { recursive: true });
    }
    const result = w.session(bridge, a, projectDir ? { projectDir } : {});
    assert.equal(result.status, status, `${label}: ${result.line}`);
    assert.equal(w.updates(a).length, 0, label);
    assert.equal(fs.existsSync(w.attemptPath), false, `${label}: no attempt recorded`);
  }
});

// --- O3: failure after the native update starts ----------------------------------

test('O3: an injected helper failure after the native update starts is held as an unknown effect, never retried', (t) => {
  const w = world(t);
  const a = w.home({ name: 'home-a' });
  w.setBehavior(a, { update: 'noop' });
  const preload = path.join(w.root, 'inject-after-update.cjs');
  fs.writeFileSync(preload, `'use strict';
const fs = require('node:fs');
const callsFile = ${JSON.stringify(path.join(a.pluginsRoot, 'fake-calls.jsonl'))};
const original = global.setTimeout;
global.setTimeout = function patched(...args) {
  let started = false;
  try { started = fs.readFileSync(callsFile, 'utf8').includes('"update"'); } catch {}
  if (started) { global.setTimeout = original; throw new Error('injected failure after the native update started'); }
  return original.apply(this, args);
};
`);
  const first = w.session(bridge, a, { preload });
  assert.equal(first.status, 'update-unverified', first.line);
  assert.match(first.line, /will not be retried automatically/);
  assert.equal(w.attempt().phase, 'held');
  assert.equal(w.updates(a).length, 1);
  assert.equal(w.session(bridge, a).status, 'held');
  assert.equal(w.updates(a).length, 1, 'no automatic retry');
});
