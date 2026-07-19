'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const control = require('../scripts/toolkit-agent-control.cjs');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-checker-')); }
function resources(overrides = {}) {
  return { physical_total: 32 * control.GIB, physical_available: 20 * control.GIB, commit_total: 48 * control.GIB,
    commit_available: 32 * control.GIB, host_responsive: true, source: 'fixture', ...overrides };
}
function ready(overrides = {}) {
  return { implementation_complete: true, focused_validation_passed: true, diff_ready: true,
    changed_files: ['repo/scripts/example.cjs'], change_kind: 'behavior', ...overrides };
}
function context(overrides = {}) {
  return control.checkerContext({ task_contract: 'Implement bounded behavior.', changed_files: ['repo/scripts/example.cjs'],
    diff: 'diff --git a/example b/example\n+safe change', focused_validation: '3 tests passed',
    surrounding_invariants: 'Preserve user state and fail closed.', ...overrides });
}
function options(host, work, overrides = {}) {
  return { host, root: work, enforcementVerified: true, adapter: `toolkit-controlled-${host}`,
    resourceState: resources(), ...overrides };
}

test('deterministic checker trigger requires meaningful code and skips only proven trivial docs', () => {
  assert.equal(control.checkerRequirement(ready()).required, true);
  const trivial = control.checkerRequirement(ready({ changed_files: ['docs/wording.md'], change_kind: 'typo-only-docs' }));
  assert.equal(trivial.required, false);
  assert.equal(trivial.result, control.CHECKER_RESULTS.SKIPPED_TRIVIAL);
  assert.equal(control.checkerRequirement(ready({ changed_files: ['skills/example/SKILL.md'], change_kind: 'typo-only-docs' })).required, true);
  assert.equal(control.checkerRequirement(ready({ changed_files: ['repo/scripts/setup.cjs'], change_kind: 'mechanical-comment-only' })).required, true);
});

test('checker context is bounded and contains only the review contract', () => {
  const value = context();
  assert.deepEqual(Object.keys(value), ['task_contract', 'changed_files', 'diff', 'focused_validation', 'surrounding_invariants', 'review_checks']);
  assert.ok(Object.isFrozen(value));
  assert.throws(() => context({ diff: 'x'.repeat(control.CHECKER_CONTEXT_LIMITS.diff + 1) }), /bounded checker context/i);
});

test('worker and checker mappings are sticky first-class launch contracts', () => {
  const workerBase = control.checkerLaunchSpec(control.HOSTS.CLAUDE, context(), { review_id: 'worker-contract' });
  const worker = control.validateLaunchSpec({ ...workerBase, role: control.ROLES.WORKER, model: undefined });
  assert.equal(worker.model, control.MODEL_CONTRACT[control.HOSTS.CLAUDE].worker);
  assert.throws(() => control.validateLaunchSpec({ ...workerBase, role: control.ROLES.WORKER, model: 'silent-upgrade' }), /sticky host model/i);
  const invocation = control.claudeInvocation(worker, { claudeCli: process.execPath, env: {} });
  assert.deepEqual(invocation.raw_args.slice(0, 6), ['--print', '--output-format', 'json', '--model', 'fable-5', '--effort']);
  const checker = control.checkerLaunchSpec(control.HOSTS.CLAUDE, context(), { review_id: 'checker-contract' });
  const checkerInvocation = control.claudeInvocation(checker, { claudeCli: process.execPath, env: {} });
  assert.deepEqual(checkerInvocation.raw_args.slice(0, 6), ['--print', '--output-format', 'json', '--model', 'opus-4.8', '--effort']);
});

test('checker contract is direct, read-only, non-fast, non-recursive, and host-model specific', () => {
  for (const host of Object.values(control.HOSTS)) {
    const spec = control.checkerLaunchSpec(host, context(), { review_id: `review-${host}` });
    assert.equal(spec.role, control.ROLES.CHECKER);
    assert.equal(spec.model, control.MODEL_CONTRACT[host].checker);
    assert.equal(spec.effort, 'medium');
    assert.equal(spec.read_only, true);
    for (const key of ['may_edit', 'may_commit', 'may_push', 'may_open_pr', 'may_merge_pr', 'may_spawn_children']) assert.equal(spec[key], false);
    assert.equal(control.validateLaunchSpec(spec).depth, 1);
    assert.throws(() => control.validateLaunchSpec({ ...spec, effort: 'low' }), /medium/i);
    assert.throws(() => control.validateLaunchSpec({ ...spec, model: 'silent-upgrade' }), /sticky host model/i);
    assert.throws(() => control.validateLaunchSpec({ ...spec, depth: 2 }), /nested/i);
    assert.throws(() => control.validateLaunchSpec({ ...spec, may_edit: true }), /read-only/i);
  }
});

test('Codex and OpenCode adapters use canonical admission and deny unverified bypasses', () => {
  for (const host of [control.HOSTS.CODEX, control.HOSTS.OPENCODE]) {
    const spec = control.checkerLaunchSpec(host, context(), { review_id: `verified-${host}` });
    assert.equal(control.admissionDecision(spec, options(host, root())).result, control.RESULTS.START);
    assert.equal(control.admissionDecision(spec, { ...options(host, root()), enforcementVerified: false }).result, control.RESULTS.REFUSE);
    assert.equal(control.admissionDecision(spec, { ...options(host, root()), adapter: 'bypass' }).result, control.RESULTS.REFUSE);
  }
});

test('exactly one checker reserves memory and completion releases it', () => {
  const work = root();
  const first = control.admissionDecision(control.checkerLaunchSpec(control.HOSTS.CODEX, context(), { review_id: 'one' }), options(control.HOSTS.CODEX, work));
  assert.equal(first.result, control.RESULTS.START);
  const second = control.admissionDecision(control.checkerLaunchSpec(control.HOSTS.CODEX, context(), { review_id: 'two' }), options(control.HOSTS.CODEX, work));
  assert.equal(second.result, control.RESULTS.REFUSE);
  assert.match(second.reason, /exactly one/i);
  assert.equal(control.releaseReservation(first.reservation_id, { root: work }), true);
  assert.equal(JSON.parse(fs.readFileSync(control.statePath({ root: work }), 'utf8')).reservations.length, 0);
});

test('memory remains the hard gate and CPU cannot override it', () => {
  const spec = control.checkerLaunchSpec(control.HOSTS.CODEX, context(), { review_id: 'memory' });
  const deniedRoot = root();
  const denied = control.admissionDecision(spec, options(control.HOSTS.CODEX, deniedRoot, {
    resourceState: resources({ physical_available: control.GIB, commit_available: control.GIB, cpu_idle_percent: 100 }),
  }));
  assert.equal(denied.result, control.RESULTS.REFUSE);
  assert.match(denied.reason, /memory/i);
  assert.equal(fs.existsSync(control.statePath({ root: deniedRoot })), false);
  const unknown = control.admissionDecision(spec, options(control.HOSTS.CODEX, root(), { resourceState: null }));
  assert.equal(unknown.result, control.RESULTS.REFUSE);
  const unresponsive = control.admissionDecision(spec, options(control.HOSTS.CODEX, root(), { resourceState: resources({ host_responsive: false }) }));
  assert.equal(unresponsive.result, control.RESULTS.REFUSE);
});

test('existing reservations reduce headroom and concurrent admissions cannot overbook', async () => {
  const work = root();
  const expensive = control.checkerLaunchSpec(control.HOSTS.CODEX, context(), { review_id: 'expensive', estimated_memory_bytes: 7 * control.GIB });
  assert.equal(control.admissionDecision(expensive, options(control.HOSTS.CODEX, work)).result, control.RESULTS.START);
  const worker = { ...expensive, role: control.ROLES.WORKER, review_id: undefined };
  assert.equal(control.admissionDecision(worker, options(control.HOSTS.CODEX, work)).result, control.RESULTS.QUEUE);
});

test('checker results distinguish pass, findings, and admission-denied self-review fallback', () => {
  assert.equal(control.checkerResult(control.CHECKER_RESULTS.PASS).status, 'PASS');
  const findings = control.checkerResult(control.CHECKER_RESULTS.FINDINGS, { findings: [{ file: 'x.cjs', evidence: 'branch fails closed incorrectly' }] });
  assert.equal(findings.findings.length, 1);
  assert.throws(() => control.checkerResult(control.CHECKER_RESULTS.PASS, { findings: [{}] }), /PASS/);
  assert.throws(() => control.checkerAdmissionOutcome({ result: control.RESULTS.REFUSE }), /self-review/i);
  const denied = control.checkerAdmissionOutcome({ result: control.RESULTS.REFUSE }, { root_self_review_performed: true });
  assert.equal(denied.status, control.CHECKER_RESULTS.ADMISSION_DENIED);
  assert.equal(denied.root_self_review_performed, true);
  assert.doesNotMatch(denied.reason, /bytes|GB|path|pid/i);
});

test('manual limits can further restrict but never weaken hard memory admission', () => {
  const host = control.HOSTS.CODEX;
  const spec = control.checkerLaunchSpec(host, context(), { review_id: 'manual' });
  const restrictive = { capacity_mode: control.CAPACITY_MODES.MANUAL, manual_maximum: 1, worker_estimate_bytes: control.DEFAULT_WORKER_COST };
  const work = root();
  assert.equal(control.admissionDecision(spec, options(host, work, { profile: restrictive })).result, control.RESULTS.START);
  const another = { ...spec, role: control.ROLES.WORKER, review_id: undefined };
  assert.equal(control.admissionDecision(another, options(host, work, { profile: restrictive })).result, control.RESULTS.QUEUE);
  assert.equal(control.admissionDecision(spec, options(host, root(), { profile: restrictive, resourceState: resources({ physical_available: control.GIB, commit_available: control.GIB }) })).result, control.RESULTS.REFUSE);
});