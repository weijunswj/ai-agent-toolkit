'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { INVARIANT_IDS, LaunchFamilyClosure } = require('../scripts/toolkit-v3-launch-assurance.cjs');
const { familyRecheckAdmission } = require('../scripts/toolkit-v3-lifecycle.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const RECORD_PATH = path.join(ROOT, 'repo', 'contracts', 'controller-kernel', 'launch-family-closure-v1.json');
const readRepoFile = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const record = () => JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8'));
const evaluate = (value, reader = readRepoFile) => new LaunchFamilyClosure(value, { readRepoFile: reader }).evaluate({ candidate: 'checkout' });
const pathOf = (value, id) => value.paths.find(p => p.id === id);

test('the checked-in launch family record is closed against this checkout and claims no new native qualification', () => {
  const result = evaluate(record());
  assert.deepEqual(result.gaps, []);
  assert.equal(result.state, 'FAMILY_CLOSED');
  assert.equal(result.qualification_performed_by_evaluation, false);
  const value = record();
  for (const host of ['claude-code', 'codex', 'opencode', 'dot']) assert.ok(value.paths.some(p => p.host === host && p.in_profile), host);
  for (const p of value.paths) assert.deepEqual(Object.keys(p.invariants).sort(), [...INVARIANT_IDS].sort(), p.id);
  // Only the Claude worker launcher carries a native demonstration. The Claude helper hook's earlier
  // demonstration is kept in history: the 19 Oct 2026 receipt showed its failure layers proceed natively
  // before onFailure block; with it, only an absent hook still proceeds.
  assert.deepEqual(value.paths.filter(p => p.native_qualification.status === 'DEMONSTRATED').map(p => p.id).sort(),
    ['claude.worker.gate-session-launcher']);
  assert.equal(pathOf(value, 'claude.helper.parent-agent-hook').native_qualification.history[0].status, 'DEMONSTRATED');
  for (const id of ['claude.helper.parent-agent-hook', 'codex.helper.pretooluse-hook', 'opencode.helper.v1-task']) {
    assert.equal(pathOf(value, id).invariants.GUARD_FAILURE.disposition, 'HELD', id);
    assert.ok(result.guard_failure_layers_not_denied.some(l => l.path === id && l.layer === 'MISSING_OR_DISABLED'), id);
  }
  assert.ok(result.guard_failure_layers_not_denied.some(l => l.path === 'codex.helper.pretooluse-hook' && l.layer === 'HOST_TIMEOUT' && l.outcome === 'PROCEEDS'));
  // Measured 21 Oct 2026 on Claude Code 2.1.304 and 2.1.306: onFailure block blocks the Agent call when the
  // hook cannot start, crashes or times out. Only an absent hook (disabled or uninstalled plugin) proceeds.
  for (const layer of ['PROCESS_START_OR_CRASH', 'HOST_TIMEOUT']) {
    const claudeLayer = pathOf(value, 'claude.helper.parent-agent-hook').invariants.GUARD_FAILURE.failure_layers.find(l => l.layer === layer);
    assert.deepEqual([claudeLayer.outcome, claudeLayer.protection], ['DENIED', 'HOST_BLOCKS_ON_FAILURE'], layer);
  }
  assert.deepEqual(result.guard_failure_layers_not_denied.filter(l => l.path === 'claude.helper.parent-agent-hook').map(l => l.layer), ['MISSING_OR_DISABLED']);
  assert.ok(result.unqualified.some(u => u.path === 'codex.worker.app-server-adapter' && u.status === 'UNQUALIFIED'));
  assert.ok(result.held.some(h => h.invariant === 'dot.persistent-dispatch:PINNED_ROUTE' && h.hold === 'DOT_DISPATCH_OWNED_BY_501'));
  // The retired Toolkit direct launcher is no longer a launch path, inside or outside the profile.
  assert.deepEqual(result.outside_profile, []);
  assert.equal(value.inventory.some(s => s.file === 'repo/scripts/toolkit-agent-control.cjs'), false);
  // The R1c-F1 guard is part of the Claude worker's inherited-configuration claim.
  assert.ok(pathOf(value, 'claude.worker.gate-session-launcher').invariants.INHERITED_CONFIGURATION.code.some(c => c.contains.includes('#configDir(env)')));
});

test('every script that starts a process naming a host and every PreToolUse registration is inventoried', () => {
  const inventoried = new Set(record().inventory.map(s => s.file));
  const scripts = fs.readdirSync(path.join(ROOT, 'repo', 'scripts')).filter(f => /\.(c|m)?js$/.test(f)).map(f => `repo/scripts/${f}`);
  const launching = scripts.filter(file => {
    const source = readRepoFile(file);
    return /\b(spawn|spawnSync|execFile|execFileSync|fork)\(/.test(source) && /claude|codex|opencode/i.test(source);
  });
  assert.ok(launching.length >= 8);
  assert.deepEqual(launching.filter(f => !inventoried.has(f)), [], 'an uninventoried launch site');
  for (const manifest of ['.claude-plugin/hooks/hooks.json', '.codex-plugin/hooks/hooks.json']) {
    const hooks = JSON.parse(readRepoFile(manifest)).hooks;
    assert.ok(Array.isArray(hooks.PreToolUse) && hooks.PreToolUse.length, manifest);
    assert.ok(inventoried.has(manifest), manifest);
    for (const entry of hooks.PreToolUse) for (const hook of entry.hooks) {
      const script = /repo\/scripts\/[\w.-]+\.cjs/.exec(hook.command)[0];
      assert.ok(inventoried.has(script), `${manifest}: ${script}`);
    }
  }
});

test('a claim whose code or test is missing, or a stale inventory, leaves the family open', () => {
  const missingTitle = record();
  pathOf(missingTitle, 'claude.worker.gate-session-launcher').invariants.INHERITED_CONFIGURATION.tests[2].title = 'a test that does not exist';
  const open = evaluate(missingTitle);
  assert.equal(open.state, 'FAMILY_OPEN');
  assert.deepEqual(open.gaps, [{ path: 'claude.worker.gate-session-launcher', invariant: 'INHERITED_CONFIGURATION', missing: 'TEST', file: 'repo/tests/toolkit-gate-session-launcher.test.cjs' }]);
  // Removing the F1 guard from the launcher bytes opens the family as well.
  const withoutGuard = file => file === 'repo/scripts/toolkit-gate-session-launcher.cjs'
    ? readRepoFile(file).replace('this.#configDir(env)', "this.#one(env, 'CLAUDE_CONFIG_DIR')") : readRepoFile(file);
  assert.ok(evaluate(record(), withoutGuard).gaps.some(g => g.missing === 'CODE' && g.invariant === 'INHERITED_CONFIGURATION'));
  const unreadable = evaluate(record(), file => { if (file.endsWith('toolkit-codex-agent-adapter.cjs')) throw new Error('gone'); return readRepoFile(file); });
  assert.ok(unreadable.gaps.some(g => g.path === 'codex.worker.app-server-adapter' && g.missing === 'ENTRYPOINT'));
});

test('malformed or overstated records are refused', () => {
  const cases = [
    ['an invariant left out', v => { delete pathOf(v, 'codex.helper.pretooluse-hook').invariants.GUARD_FAILURE; }, 'LAUNCH_FAMILY_RECORD_INVALID'],
    ['an enforced claim without tests', v => { pathOf(v, 'opencode.helper.v1-task').invariants.PINNED_ROUTE.tests = []; }, 'LAUNCH_FAMILY_ENFORCEMENT_UNSUPPORTED'],
    ['native qualification from source tests only', v => { pathOf(v, 'codex.worker.app-server-adapter').native_qualification.status = 'DEMONSTRATED'; }, 'LAUNCH_FAMILY_QUALIFICATION_UNSUPPORTED'],
    ['a hold without an owner', v => { pathOf(v, 'dot.persistent-dispatch').invariants.PINNED_ROUTE.owner = ''; }, 'LAUNCH_FAMILY_HOLD_INVALID'],
    ['an inventory site pointing at no path', v => { v.inventory[0].path = 'unknown.path'; }, 'LAUNCH_FAMILY_INVENTORY_INVALID'],
    ['a duplicated path', v => { v.paths.push(v.paths[0]); }, 'LAUNCH_FAMILY_PATH_DUPLICATE'],
    ['an owned launcher without entrypoints', v => { pathOf(v, 'claude.worker.gate-session-launcher').entrypoints = []; }, 'LAUNCH_FAMILY_ENTRYPOINT_REQUIRED'],
    ['an unknown disposition', v => { pathOf(v, 'claude.worker.gate-session-launcher').invariants.OBSERVED_ROUTE.disposition = 'COVERED'; }, 'LAUNCH_FAMILY_DISPOSITION_INVALID'],
    // The 19 Oct 2026 overstatement: a hook-process error was said to deny, so the path stayed demonstrated.
    ['a demonstrated hook path whose guard failure is held', v => { pathOf(v, 'claude.helper.parent-agent-hook').native_qualification.status = 'DEMONSTRATED'; }, 'LAUNCH_FAMILY_QUALIFICATION_UNSUPPORTED'],
    ['a guard-failure claim enforced while a layer proceeds', v => {
      const p = pathOf(v, 'claude.helper.parent-agent-hook'), layers = p.invariants.GUARD_FAILURE.failure_layers;
      p.invariants.GUARD_FAILURE = { disposition: 'ENFORCED', evidence: 'SOURCE_TEST', failure_layers: layers,
        code: [{ file: 'repo/scripts/toolkit-claude-agent-hook.cjs', contains: 'Toolkit could not verify the Claude topology safely; continue root-only.' }],
        tests: [{ file: 'repo/tests/toolkit-agent-control.test.cjs', title: 'a Claude hook whose decision modules cannot load still denies Agent and Task as a handled decision' }] };
    }, 'LAUNCH_FAMILY_GUARD_FAILURE_OVERSTATED'],
    ['the guard credited where the host never runs it', v => {
      const layer = pathOf(v, 'codex.helper.pretooluse-hook').invariants.GUARD_FAILURE.failure_layers.find(l => l.layer === 'HOST_TIMEOUT');
      layer.outcome = 'DENIED'; layer.protection = 'GUARD_DENIES';
    }, 'LAUNCH_FAMILY_GUARD_FAILURE_OVERSTATED'],
    ['a host failure block credited to a hook that never runs', v => {
      const layer = pathOf(v, 'claude.helper.parent-agent-hook').invariants.GUARD_FAILURE.failure_layers.find(l => l.layer === 'MISSING_OR_DISABLED');
      layer.outcome = 'DENIED'; layer.protection = 'HOST_BLOCKS_ON_FAILURE';
    }, 'LAUNCH_FAMILY_GUARD_FAILURE_OVERSTATED'],
    ['a denied layer without protection', v => { pathOf(v, 'opencode.helper.v1-task').invariants.GUARD_FAILURE.failure_layers[0].protection = 'NONE'; }, 'LAUNCH_FAMILY_GUARD_FAILURE_OVERSTATED'],
    ['a hook path without its failure layers', v => { delete pathOf(v, 'codex.helper.pretooluse-hook').invariants.GUARD_FAILURE.failure_layers; }, 'LAUNCH_FAMILY_FAILURE_LAYERS_REQUIRED'],
    ['a missing failure layer', v => { pathOf(v, 'codex.helper.pretooluse-hook').invariants.GUARD_FAILURE.failure_layers.pop(); }, 'LAUNCH_FAMILY_FAILURE_LAYERS_REQUIRED'],
    ['a process-only native claim', v => {
      const p = pathOf(v, 'claude.worker.gate-session-launcher');
      for (const id of Object.keys(p.invariants)) if (p.invariants[id].evidence === 'NATIVE') p.invariants[id].evidence = 'PROCESS';
    }, 'LAUNCH_FAMILY_QUALIFICATION_UNSUPPORTED'],
    ['an unknown evidence class', v => { pathOf(v, 'codex.helper.pretooluse-hook').invariants.PINNED_ROUTE.evidence = 'CRAFTED_EVENT'; }, 'LAUNCH_FAMILY_ENFORCEMENT_UNSUPPORTED'],
    ['a superseded claim without its successor', v => { delete pathOf(v, 'claude.helper.parent-agent-hook').native_qualification.history[0].superseded_by; }, 'LAUNCH_FAMILY_RECORD_INVALID']
  ];
  for (const [name, mutate, code] of cases) {
    const value = record(); mutate(value);
    assert.throws(() => new LaunchFamilyClosure(value, { readRepoFile }), e => e.code === code, name);
  }
  assert.throws(() => new LaunchFamilyClosure(record(), {}), e => e.code === 'LAUNCH_FAMILY_READER_REQUIRED');
});

test('a same-family correction recheck needs a closed family on the exact candidate, not just a passing reproducer', () => {
  const closed = new LaunchFamilyClosure(record(), { readRepoFile }).evaluate({ candidate: 'c2' });
  const base = { family_id: 'automated-launch-route', candidate: 'c2', closure: closed, same_family_not_passed: 1,
    root_cause_reassessment_digest: null, latest_reproducer_passes: true };
  const admitted = familyRecheckAdmission(base);
  assert.equal(admitted.admissible, true);
  assert.equal(admitted.latest_reproducer_sufficient, false);
  assert.equal(admitted.genuine_defects_waived, false);
  const refused = [
    ['only the latest reproducer passes', { closure: null }, 'V3_FAMILY_CLOSURE_REQUIRED'],
    ['a closure of another family', { family_id: 'other-family' }, 'V3_FAMILY_CLOSURE_REQUIRED'],
    ['a closure evaluated on an earlier candidate', { candidate: 'c3' }, 'V3_FAMILY_CLOSURE_STALE'],
    ['an open family', { closure: { ...closed, state: 'FAMILY_OPEN', gaps: [{ path: 'x', missing: 'TEST' }] } }, 'V3_FAMILY_CLOSURE_OPEN'],
    ['a third same-family recheck without a root-cause reassessment', { same_family_not_passed: 2 }, 'V3_FAMILY_ROOT_CAUSE_REASSESSMENT_REQUIRED'],
    ['a malformed count', { same_family_not_passed: -1 }, 'V3_FAMILY_RECHECK_INVALID']
  ];
  for (const [name, change, code] of refused) assert.throws(() => familyRecheckAdmission({ ...base, ...change }), e => e.code === code, name);
  const reassessed = familyRecheckAdmission({ ...base, same_family_not_passed: 4, root_cause_reassessment_digest: 'a'.repeat(64) });
  assert.equal(reassessed.root_cause_reassessment_digest, 'a'.repeat(64));
});
