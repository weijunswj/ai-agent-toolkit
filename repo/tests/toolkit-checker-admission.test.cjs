'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const control = require('../scripts/toolkit-agent-control.cjs');
const processLaunch = require('../scripts/claude-process-launch.cjs');

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
function workflowInput(overrides = {}) {
  return {
    ...ready(),
    task_contract: 'Review the supported bounded checker workflow against its production contract.',
    diff: 'diff --git a/example b/example\n+supported workflow change',
    focused_validation: 'The focused checker workflow suite passed.',
    surrounding_invariants: 'Identity, resource admission, and private transport remain fail closed.',
    ...overrides,
  };
}
function workerFields() {
  return {
    tasks_separable: true,
    concurrent_execution_possible: true,
    expected_wall_clock_speedup: 'The shorter child task completes while the root handles the longer critical-path task.',
    root_retains_longest_or_critical_path: true,
    child_task_is_shorter_or_easier: true,
    root_productive_work_declared: true,
  };
}
function options(host, work, overrides = {}) {
  return { host, root: work, enforcementVerified: true, adapter: `toolkit-controlled-${host}`,
    resourceState: resources(), ...overrides };
}function decision(spec, launchOptions) {
  const profile = launchOptions.profile || { capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST };
  return control.resourceAdmissionDecision(spec, profile, launchOptions.resourceState, launchOptions);
}

test('deterministic checker trigger requires meaningful code and skips only proven trivial docs', () => {
  assert.equal(control.checkerRequirement(ready()).required, true);
  const trivial = control.checkerRequirement(ready({ changed_files: ['docs/wording.md'], change_kind: 'typo-only-docs' }));
  assert.equal(trivial.required, false);
  assert.equal(trivial.result, control.CHECKER_RESULTS.SKIPPED_TRIVIAL);
  assert.equal(control.checkerRequirement(ready({ changed_files: ['skills/example/SKILL.md'], change_kind: 'typo-only-docs' })).required, true);
  assert.equal(control.checkerRequirement(ready({ changed_files: ['repo/scripts/setup.cjs'], change_kind: 'mechanical-comment-only' })).required, true);
  assert.equal(control.checkerRequirement(ready({ changed_files: ['src/runtime.js'], change_kind: 'generated-only-authoritative-validated', authoritative_source_independently_validated: true })).required, true);
  const generated = control.checkerRequirement(ready({ changed_files: ['skills/example/SKILL.md'], change_kind: 'generated-only-authoritative-validated', authoritative_source_independently_validated: true }));
  assert.equal(generated.result, control.CHECKER_RESULTS.SKIPPED_TRIVIAL);
});

test('supported checker workflow handles trivial, malformed, admission-denied, and unforgeable inputs', () => {
  const trivialRoot = root();
  const trivial = control.checkerWorkflow(workflowInput({ changed_files: ['docs/wording.md'], change_kind: 'typo-only-docs' }), { root: trivialRoot });
  assert.equal(trivial.status, control.CHECKER_RESULTS.SKIPPED_TRIVIAL);
  assert.equal(fs.existsSync(control.statePath({ root: trivialRoot })), false);

  const malformedRoot = root();
  assert.throws(() => control.checkerWorkflow(workflowInput({ diff: '' }), { root: malformedRoot }), /Diff is required/i);
  assert.equal(fs.existsSync(control.statePath({ root: malformedRoot })), false);
  for (const forged of ['child_prompt', 'checker_context_digest', 'review_id', 'role', 'model', 'may_edit']) {
    assert.throws(() => control.validateCheckerWorkflowInput(workflowInput({ [forged]: 'forged' })), /unsupported fields/i);
  }

  const denied = control.checkerWorkflow(workflowInput(), { root: root(), claudeCli: process.execPath });
  assert.equal(denied.status, control.CHECKER_RESULTS.ADMISSION_DENIED);
  assert.equal(denied.root_self_review_required, true);
  assert.match(denied.root_self_review_contract, /bounded root self-review/i);
});

test('actual checker CLI accepts bounded private stdin and returns SKIPPED_TRIVIAL without launching', () => {
  const script = path.join(__dirname, '..', 'scripts', 'toolkit-agent-control.cjs');
  const work = root();
  const privateTask = 'PRIVATE_TASK_CONTRACT_NOT_IN_ARGV_72d4';
  const input = workflowInput({ task_contract: privateTask, changed_files: ['docs/wording.md'], change_kind: 'typo-only-docs' });
  const argv = [script, 'checker', '--input', '-', '--root', work];
  const result = spawnSync(process.execPath, argv, {
    input: JSON.stringify(input), encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, control.CHECKER_RESULTS.SKIPPED_TRIVIAL);
  assert.equal(fs.existsSync(control.statePath({ root: work })), false);
  assert.equal(argv.some((arg) => arg.includes(privateTask)), false);
});

test('owned private checker input is bounded, topology-verified, and removed after reading', () => {
  const work = root();
  const inputs = path.join(work, 'inputs');
  fs.mkdirSync(inputs);
  const owned = path.join(inputs, 'bounded.json');
  fs.writeFileSync(owned, JSON.stringify(workflowInput()), { mode: 0o600 });
  assert.equal(control.readCheckerWorkflowInput(owned, { root: work }).task_contract, workflowInput().task_contract);
  assert.equal(fs.existsSync(owned), false);
  const outside = path.join(work, 'outside.json');
  fs.writeFileSync(outside, '{}', { mode: 0o600 });
  assert.throws(() => control.readCheckerWorkflowInput(outside, { root: work }), /direct private children/i);
  assert.equal(fs.existsSync(outside), true);
});

test('checker context is bounded and contains only the review contract', () => {
  const value = context();
  assert.deepEqual(Object.keys(value), ['task_contract', 'changed_files', 'diff', 'focused_validation', 'surrounding_invariants', 'review_checks']);
  assert.ok(Object.isFrozen(value));
  assert.throws(() => context({ diff: 'x'.repeat(control.CHECKER_CONTEXT_LIMITS.diff + 1) }), /bounded checker context/i);
  assert.throws(() => context({ diff: '' }), /Diff is required/i);
  assert.throws(() => context({ focused_validation: '   ' }), /Focused validation is required/i);
  assert.throws(() => control.checkerLaunchSpec(control.HOSTS.CODEX, { ...context(), diff: '' }), /Diff is required/i);
  assert.throws(() => context({ changed_files: Array.from({ length: 200 }, (_, index) => String(index) + '-' + 'x'.repeat(400)) }), /Changed-file list exceeds/i);
  assert.deepEqual(context({ changed_files: ['./docs/guide.md'] }).changed_files, ['docs/guide.md']);
  assert.throws(() => context({ changed_files: ['C:/private/guide.md'] }), /repository-relative/i);
  const instructionPath = control.checkerRequirement({ implementation_complete: true, focused_validation_passed: true, diff_ready: true, changed_files: ['./AGENTS.md'], change_kind: 'typo-only-docs' });
  assert.equal(instructionPath.required, true);
  const absolutePath = control.checkerRequirement({ implementation_complete: true, focused_validation_passed: true, diff_ready: true, changed_files: ['C:/repo/docs/guide.md'], change_kind: 'typo-only-docs' });
  assert.equal(absolutePath.required, true);
  const notReady = control.checkerRequirement({ implementation_complete: false, focused_validation_passed: false, diff_ready: false, changed_files: ['C:/repo/docs/guide.md'], change_kind: 'typo-only-docs' });
  assert.equal(notReady.ready, false);
});

test('worker and checker mappings are sticky first-class launch contracts', () => {
  const checkerBase = control.checkerLaunchSpec(control.HOSTS.CLAUDE, context(), { review_id: 'worker-contract' });
  const worker = control.validateLaunchSpec({ ...checkerBase, ...workerFields(), role: control.ROLES.WORKER, model: control.MODEL_CONTRACT[control.HOSTS.CLAUDE].worker, review_id: undefined });
  assert.equal(worker.model, control.MODEL_CONTRACT[control.HOSTS.CLAUDE].worker);
  assert.throws(() => control.validateLaunchSpec({ ...worker, model: 'silent-upgrade' }), /sticky host model/i);
  const invocation = control.claudeInvocation(worker, { claudeCli: process.execPath, env: {} });
  assert.deepEqual(invocation.raw_args.slice(0, 6), ['--print', '--output-format', 'json', '--model', 'fable-5', '--effort']);
  assert.equal(invocation.env.AI_AGENT_TOOLKIT_CHECKER, undefined);
  const checker = control.checkerLaunchSpec(control.HOSTS.CLAUDE, context(), { review_id: 'checker-contract' });
  const checkerInvocation = control.claudeInvocation(checker, { claudeCli: process.execPath, env: {} });
  const checkerPrompt = JSON.parse(checker.child_prompt);
  assert.match(checkerPrompt.instructions, /read-only adversarial review/i);
  assert.deepEqual(checkerPrompt.result_contract.statuses, [control.CHECKER_RESULTS.PASS, control.CHECKER_RESULTS.FINDINGS]);
  assert.equal(checkerPrompt.context.diff, context().diff);
  assert.deepEqual(checkerInvocation.raw_args.slice(0, 6), ['--print', '--output-format', 'json', '--model', 'opus-4.8', '--effort']);
  assert.deepEqual(checkerInvocation.raw_args.slice(checkerInvocation.raw_args.indexOf('--tools') + 1, checkerInvocation.raw_args.indexOf('--disallowedTools')), ['Read', 'Glob', 'Grep']);
  assert.deepEqual(checkerInvocation.raw_args.slice(checkerInvocation.raw_args.indexOf('--disallowedTools') + 1, checkerInvocation.raw_args.indexOf('--permission-mode')), ['Agent', 'Task', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']);
  assert.equal(checkerInvocation.raw_args[checkerInvocation.raw_args.indexOf('--permission-mode') + 1], 'plan');
  assert.equal(checkerInvocation.env.AI_AGENT_TOOLKIT_CHECKER, '1');
});

for (const extension of ['cmd', 'bat']) {
  test(`Windows ${extension} Claude wrapper is transformed exactly once for worker and checker execution`, { skip: process.platform !== 'win32' }, () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), `Claude Controller & ${extension} `));
    const captureScript = path.join(work, 'capture args.cjs');
    const wrapper = path.join(work, `claude wrapper (safe).${extension}`);
    fs.writeFileSync(captureScript, [
      "'use strict';",
      "const fs=require('node:fs');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',(chunk)=>{input+=chunk;});",
      "process.stdin.on('end',()=>{fs.writeFileSync(process.env.CAPTURE_PATH,JSON.stringify({args:process.argv.slice(2),input,checker:process.env.AI_AGENT_TOOLKIT_CHECKER,fast:process.env.CLAUDE_CODE_DISABLE_FAST_MODE}));process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify({status:'PASS',findings:[]})}));});",
      '',
    ].join('\n'));
    fs.writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${captureScript}" %*\r\n`);
    const original = processLaunch.claudeSpawnParts;
    let conversions = 0;
    processLaunch.claudeSpawnParts = (...args) => {
      conversions += 1;
      const parts = original(...args);
      assert.equal(parts.windowsVerbatimArguments, true);
      assert.match(parts.command.toLowerCase(), /cmd\.exe$/);
      return parts;
    };
    try {
      const checker = control.checkerLaunchSpec(control.HOSTS.CLAUDE, context({ diff: `wrapper ${extension} checker diff` }));
      const worker = { ...checker, ...workerFields(), role: control.ROLES.WORKER, model: control.MODEL_CONTRACT[control.HOSTS.CLAUDE].worker,
        review_id: undefined, child_prompt: 'private worker prompt with spaces & metacharacters | kept on stdin' };
      for (const [role, spec] of [['worker', worker], ['checker', checker]]) {
        const capturePath = path.join(work, `${role} capture & result.json`);
        const invocation = control.claudeInvocation(spec, { claudeCli: wrapper, env: { ...process.env, CAPTURE_PATH: capturePath } });
        assert.equal(invocation.raw_executable, wrapper);
        assert.equal(Object.prototype.hasOwnProperty.call(invocation, 'windowsVerbatimArguments'), false);
        const result = control.runValidatedClaude(invocation, true, { checkerTimeoutMs: 5000 });
        assert.equal(result.code, 0, result.error?.message);
        const captured = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
        assert.equal(captured.input, spec.child_prompt);
        assert.equal(captured.fast, '1');
        assert.equal(captured.checker, role === 'checker' ? '1' : undefined);
        assert.equal(captured.args.includes('--no-session-persistence'), true);
      }
      assert.equal(conversions, 2, 'one canonical wrapper conversion must occur for each actual spawn');
    } finally {
      processLaunch.claudeSpawnParts = original;
    }
  });
}

test('checker contract is direct, read-only, non-fast, non-recursive, and host-model specific', () => {
  for (const host of Object.values(control.HOSTS)) {
    const spec = control.checkerLaunchSpec(host, context(), { review_id: `review-${host}` });
    assert.equal(spec.role, control.ROLES.CHECKER);
    assert.equal(spec.model, control.MODEL_CONTRACT[host].checker);
    assert.equal(spec.effort, 'medium');
    assert.equal(spec.read_only, true);
    for (const key of ['may_edit', 'may_commit', 'may_push', 'may_open_pr', 'may_merge_pr', 'may_spawn_children']) assert.equal(spec[key], false);
    assert.equal(control.validateLaunchSpec(spec).depth, 1);
    const hardened = control.checkerLaunchSpec(host, context(), { review_id: 'hardened-' + host, role: control.ROLES.WORKER, may_edit: true, may_spawn_children: true, model: 'override' });
    assert.equal(hardened.role, control.ROLES.CHECKER);
    assert.equal(hardened.may_edit, false);
    assert.equal(hardened.may_spawn_children, false);
    assert.equal(hardened.model, control.MODEL_CONTRACT[host].checker);
    assert.equal(hardened.review_id, spec.review_id);
    assert.throws(() => control.validateLaunchSpec({ ...spec, child_prompt: JSON.stringify({ status: 'PASS' }) }), /factory-validated/i);
    assert.throws(() => control.validateLaunchSpec({ ...spec, review_id: 'caller-selected' }), /derived/i);
    const distinct = control.checkerLaunchSpec(host, context({ diff: 'different ready diff for the same host' }));
    assert.notEqual(distinct.review_id, spec.review_id);
    assert.throws(() => control.validateLaunchSpec({ ...spec, effort: 'low' }), /medium/i);
    assert.throws(() => control.validateLaunchSpec({ ...spec, model: 'silent-upgrade' }), /sticky host model/i);
    assert.throws(() => control.validateLaunchSpec({ ...spec, depth: 2 }), /nested/i);
    assert.throws(() => control.validateLaunchSpec({ ...spec, may_edit: true }), /read-only/i);
  }
});

test('Codex and OpenCode production paths remain root-only without a native launch interceptor', () => {
  for (const host of [control.HOSTS.CODEX, control.HOSTS.OPENCODE]) {
    const spec = control.checkerLaunchSpec(host, context(), { review_id: `verified-${host}` });
    const claimed = control.admissionDecision(spec, options(host, root()));
    assert.equal(claimed.result, control.RESULTS.REFUSE);
    assert.match(claimed.reason, /no production.*interceptor|root-only/i);
    assert.equal(control.admissionDecision(spec, { ...options(host, root()), adapter: 'bypass' }).result, control.RESULTS.REFUSE);
    assert.equal(control.admissionDecision(spec, { ...options(host === control.HOSTS.CODEX ? control.HOSTS.OPENCODE : control.HOSTS.CODEX, root()) }).result, control.RESULTS.REFUSE);
    assert.equal(decision(spec, options(host, root(), { profile: { capacity_mode: control.CAPACITY_MODES.ROOT_ONLY, manual_maximum: 0 } })).result, control.RESULTS.REFUSE);
  }
});

test('exactly one checker reserves memory and completion releases it', () => {
  const work = root();
  const firstSpec = control.checkerLaunchSpec(control.HOSTS.CODEX, context());
  const first = decision(firstSpec, options(control.HOSTS.CODEX, work));
  assert.equal(first.result, control.RESULTS.START);
  const secondSpec = control.checkerLaunchSpec(control.HOSTS.CODEX, context({ diff: 'second distinct ready diff' }));
  const second = decision(secondSpec, options(control.HOSTS.CODEX, work));
  assert.equal(second.result, control.RESULTS.REFUSE);
  assert.match(second.reason, /exactly one/i);
  assert.equal(control.updateCheckerReview(firstSpec.review_id, 'completed', { root: work, checker_result: control.checkerResult(control.CHECKER_RESULTS.PASS) }), true);
  assert.equal(control.releaseReservation(first.reservation_id, { root: work }), true);
  const completedState = JSON.parse(fs.readFileSync(control.statePath({ root: work }), 'utf8'));
  assert.equal(completedState.reservations.length, 0);
  assert.equal(completedState.checker_reviews[0].result, control.CHECKER_RESULTS.PASS);
  const repeated = decision(control.checkerLaunchSpec(control.HOSTS.CODEX, context()), options(control.HOSTS.CODEX, work));
  assert.equal(repeated.result, control.RESULTS.REFUSE);
  assert.match(repeated.reason, /already admitted/i);
  const nextReview = decision(control.checkerLaunchSpec(control.HOSTS.CODEX, context({ diff: 'third distinct ready diff' })), options(control.HOSTS.CODEX, work));
  assert.equal(nextReview.result, control.RESULTS.START);
});
test('failed checker launch clears only pending review identity so the required review can retry', () => {
  const work = root();
  const spec = control.checkerLaunchSpec(control.HOSTS.CODEX, context(), { review_id: 'failed-before-check' });
  const admitted = decision(spec, options(control.HOSTS.CODEX, work));
  assert.equal(admitted.result, control.RESULTS.START);
  assert.equal(control.clearPendingCheckerReview(spec.review_id, { root: work }), true);
  assert.equal(control.releaseReservation(admitted.reservation_id, { root: work }), true);
  assert.equal(decision(spec, options(control.HOSTS.CODEX, work)).result, control.RESULTS.START);
});
test('stale reservation recovery reclaims only its orphaned pending checker identity', () => {
  const work = root();
  const spec = control.checkerLaunchSpec(control.HOSTS.CODEX, context(), { review_id: 'orphaned-pending' });
  const admitted = decision(spec, options(control.HOSTS.CODEX, work));
  assert.equal(admitted.result, control.RESULTS.START);
  const raw = JSON.parse(fs.readFileSync(control.statePath({ root: work }), 'utf8'));
  raw.reservations[0].expires_at_ms = 1;
  raw.checker_reviews[0].expires_at_ms = Date.now() + 60_000;
  const expiredReserved = control.recoverState(structuredClone(raw), Date.now());
  assert.equal(expiredReserved.reservations.length, 0);
  assert.equal(expiredReserved.checker_reviews.length, 0);
  raw.reservations[0].status = 'running';
  raw.reservations[0].owner_pid = 99999999;
  const deadRunning = control.recoverState(raw, Date.now());
  assert.equal(deadRunning.reservations.length, 0);
  assert.equal(deadRunning.checker_reviews.length, 0);
});

test('memory remains the hard gate and CPU cannot override it', () => {
  const spec = control.checkerLaunchSpec(control.HOSTS.CODEX, context(), { review_id: 'memory' });
  const deniedRoot = root();
  const denied = decision(spec, options(control.HOSTS.CODEX, deniedRoot, {
    resourceState: resources({ physical_available: control.GIB, commit_available: control.GIB, cpu_idle_percent: 100 }),
  }));
  assert.equal(denied.result, control.RESULTS.REFUSE);
  assert.match(denied.reason, /memory/i);
  assert.equal(fs.existsSync(control.statePath({ root: deniedRoot })), false);
  const unknown = decision(spec, options(control.HOSTS.CODEX, root(), { resourceState: null }));
  assert.equal(unknown.result, control.RESULTS.REFUSE);
  const unresponsive = decision(spec, options(control.HOSTS.CODEX, root(), { resourceState: resources({ host_responsive: false }) }));
  assert.equal(unresponsive.result, control.RESULTS.REFUSE);
});

test('existing reservations reduce headroom and concurrent admissions cannot overbook', async () => {
  const work = root();
  const expensive = control.checkerLaunchSpec(control.HOSTS.CODEX, context(), { review_id: 'expensive', estimated_memory_bytes: 7 * control.GIB });
  assert.equal(decision(expensive, options(control.HOSTS.CODEX, work)).result, control.RESULTS.START);
  const worker = { ...expensive, ...workerFields(), role: control.ROLES.WORKER, review_id: undefined };
  assert.equal(decision(worker, options(control.HOSTS.CODEX, work)).result, control.RESULTS.QUEUE);
});

test('queue tickets are bound to the original host and child role', () => {
  const work = root();
  const checker = control.checkerLaunchSpec(control.HOSTS.CODEX, context(), { review_id: 'queue-worker' });
  const worker = { ...checker, ...workerFields(), role: control.ROLES.WORKER, model: control.MODEL_CONTRACT[control.HOSTS.CODEX].worker, review_id: undefined };
  const pressured = options(control.HOSTS.CODEX, work, { resourceState: resources({ physical_available: 9 * control.GIB }) });
  const queued = decision(worker, pressured);
  assert.equal(queued.result, control.RESULTS.QUEUE);
  const wrongHost = { ...worker, host: control.HOSTS.OPENCODE, model: control.MODEL_CONTRACT[control.HOSTS.OPENCODE].worker, queue_id: queued.queue_id };
  assert.equal(decision(wrongHost, options(control.HOSTS.OPENCODE, work)).result, control.RESULTS.REFUSE);
  const wrongRole = control.checkerLaunchSpec(control.HOSTS.CODEX, context(), { review_id: 'queue-checker', queue_id: queued.queue_id });
  assert.equal(decision(wrongRole, options(control.HOSTS.CODEX, work)).result, control.RESULTS.REFUSE);
  assert.equal(decision({ ...worker, queue_id: queued.queue_id }, options(control.HOSTS.CODEX, work)).result, control.RESULTS.START);
});
test('legacy role-less queue tickets migrate to worker and remain retryable', () => {
  const work = root();
  const checker = control.checkerLaunchSpec(control.HOSTS.CODEX, context({ diff: 'legacy queue migration diff' }));
  const worker = { ...checker, ...workerFields(), role: control.ROLES.WORKER, model: control.MODEL_CONTRACT[control.HOSTS.CODEX].worker, review_id: undefined, checker_context_digest: undefined };
  const queued = decision(worker, options(control.HOSTS.CODEX, work, { resourceState: resources({ physical_available: 9 * control.GIB }) }));
  assert.equal(queued.result, control.RESULTS.QUEUE);
  const state = JSON.parse(fs.readFileSync(control.statePath({ root: work }), 'utf8'));
  delete state.queue[0].role;
  fs.writeFileSync(control.statePath({ root: work }), JSON.stringify(state));
  const retried = decision({ ...worker, queue_id: queued.queue_id }, options(control.HOSTS.CODEX, work));
  assert.equal(retried.result, control.RESULTS.START);
});

test('bounded checker execution timeout terminates the child process', () => {
  const invocation = {
    raw_executable: process.execPath,
    raw_args: ['-e', 'setInterval(() => {}, 1000)'],
    env: process.env,
    stdin: Buffer.from('bounded checker timeout fixture'),
  };
  const result = control.runValidatedClaude(invocation, true, { checkerTimeoutMs: 50 });
  assert.equal(result.code, 1);
  assert.equal(result.error?.code, 'ETIMEDOUT');
});

test('checker results distinguish pass, findings, and admission-denied self-review fallback', () => {
  assert.equal(control.checkerResult(control.CHECKER_RESULTS.PASS).status, 'PASS');
  const findings = control.checkerResult(control.CHECKER_RESULTS.FINDINGS, { findings: [{ file: 'x.cjs', evidence: 'branch fails closed incorrectly' }] });
  assert.equal(findings.findings.length, 1);
  const passEnvelope = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ status: 'PASS', findings: [] }) });
  assert.equal(control.checkerResultFromClaudeOutput(passEnvelope).status, control.CHECKER_RESULTS.PASS);
  const findingsEnvelope = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ status: 'FINDINGS', findings: [{ file: 'x.cjs', evidence: 'bounded actionable evidence' }] }) });
  assert.equal(control.checkerResultFromClaudeOutput(findingsEnvelope).findings.length, 1);
  assert.throws(() => control.checkerResultFromClaudeOutput('{}'), /envelope/i);
  for (const envelope of [
    { type: 'result', is_error: false, result: JSON.stringify({ status: 'PASS', findings: [] }) },
    { type: 'result', subtype: 'error_max_turns', is_error: false, result: JSON.stringify({ status: 'PASS', findings: [] }) },
    { type: 'result', subtype: 'other', is_error: false, result: JSON.stringify({ status: 'PASS', findings: [] }) },
    { type: 'result', subtype: 'success', result: JSON.stringify({ status: 'PASS', findings: [] }) },
    { type: 'result', subtype: 'success', is_error: true, result: JSON.stringify({ status: 'PASS', findings: [] }) },
    { type: 'result', subtype: 'success', is_error: false },
  ]) assert.throws(() => control.checkerResultFromClaudeOutput(JSON.stringify(envelope)), /envelope/i);
  assert.throws(() => control.checkerResultFromClaudeOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{' })), /payload.*JSON/i);
  assert.throws(() => control.checkerResult(control.CHECKER_RESULTS.PASS, { findings: [{}] }), /PASS/);
  const requiredReview = control.checkerAdmissionOutcome({ result: control.RESULTS.REFUSE });
  assert.equal(requiredReview.status, control.CHECKER_RESULTS.ADMISSION_DENIED);
  assert.equal(requiredReview.root_self_review_required, true);
  assert.equal(requiredReview.root_self_review_performed, false);
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
  assert.equal(decision(spec, options(host, work, { profile: restrictive })).result, control.RESULTS.START);
  const another = { ...spec, ...workerFields(), role: control.ROLES.WORKER, review_id: undefined };
  assert.equal(decision(another, options(host, work, { profile: restrictive })).result, control.RESULTS.QUEUE);
  assert.equal(decision(spec, options(host, root(), { profile: restrictive, resourceState: resources({ physical_available: control.GIB, commit_available: control.GIB }) })).result, control.RESULTS.REFUSE);
});
