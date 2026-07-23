'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const control = require('../scripts/toolkit-agent-control.cjs');
const pluginSetup = require('../scripts/setup-claude-toolkit-plugin.cjs');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test('detached Claude supervisor forces medium non-fast invocation and releases its reservation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-agent-lifecycle-'));
  const cache = path.join(root, 'cache');
  const sourceRoot = path.resolve(__dirname, '..', '..');
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/hooks/hooks.json', 'repo/scripts/toolkit-agent-control.cjs', 'repo/scripts/claude-process-launch.cjs', 'repo/scripts/toolkit-claude-agent-hook.cjs', 'repo/scripts/toolkit-claude-n8n-admission-hook.cjs', 'skills/external-system-router/scripts/external-system-router.cjs', 'skills/external-system-router/scripts/n8n-domain-router.cjs']) {
    const target = path.join(cache, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, ...rel.split('/')), target);
  }
  const pluginEntry = { id: pluginSetup.pluginId(), version: control.CONTROL_VERSION, enabled: true, trusted: true, hooksActive: true, installPath: cache };
  const fake = path.join(root, 'fake-claude.cjs');
  const secretPrompt = 'UNIQUE_PRIVATE_PROMPT_8f06f6c1 repository customer fixture';
  const optionMarker = 'ONLY_IN_OPTIONS_ENV_47c1';
  const requiredConfig = 'REQUIRED_CHILD_CONFIG_2a91';
  const parentMarker = 'PARENT_ONLY_ENV_990e';
  fs.writeFileSync(fake, [
    "'use strict';",
    `const pluginEntry = ${JSON.stringify(pluginEntry)};`,
    "if (process.argv[2] === '--version') { process.stdout.write('claude fake\\n'); process.exit(0); }",
    "if (process.argv[2] === 'plugin' && process.argv[3] === 'list') { process.stdout.write(JSON.stringify({ installed: [pluginEntry] }) + '\\n'); process.exit(0); }",
    "let input = ''; process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => { if (process.env.REQUIRED_CHILD_CONFIG !== 'REQUIRED_CHILD_CONFIG_2a91') { console.error('missing required child config'); process.exitCode = 7; return; } process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input, option_marker: process.env.ONLY_IN_OPTIONS_ENV, parent_marker: process.env.PARENT_ONLY_ENV, required_config: process.env.REQUIRED_CHILD_CONFIG, fast_disabled: process.env.CLAUDE_CODE_DISABLE_FAST_MODE, background_disabled: process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS })); });",
    '',
  ].join('\n'));
  const previousParentMarker = process.env.PARENT_ONLY_ENV;
  process.env.PARENT_ONLY_ENV = parentMarker;
  const { PARENT_ONLY_ENV: omittedParentMarker, ...effectiveEnv } = process.env;
  assert.equal(omittedParentMarker, parentMarker);
  const previousUmask = process.umask(0);
  const activationProof = pluginSetup.installedActivationProof(pluginEntry, control.CONTROL_VERSION);
  const result = control.launch({
    child_responsibility: 'Implement the isolated parser shard and focused unit coverage.',
    parent_responsibility: 'Review the integration interface and reconcile adjacent contracts.',
    integration_plan: 'The root owns interface reconciliation and final integration judgement.',
    validation_plan: 'The root runs cross-shard validation and reviews the final combined diff.',
    material_benefit: 'The shorter parser shard runs concurrently and reduces the implementation critical path.',
    tasks_separable: true,
    concurrent_execution_possible: true,
    expected_wall_clock_speedup: 'The parser shard completes while the root handles the longer integration task.',
    root_retains_longest_or_critical_path: true,
    child_task_is_shorter_or_easier: true,
    root_productive_work_declared: true,
    child_prompt: secretPrompt,
  }, {
    root,
    claudeCli: fake,
    env: { ...effectiveEnv, ONLY_IN_OPTIONS_ENV: optionMarker, REQUIRED_CHILD_CONFIG: requiredConfig },
    profile: { schema: control.SCHEMA, host: 'claude-code', topology: control.TOPOLOGIES.CLAUDE_DIRECT,
      capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST,
      queue_limit: control.MAX_QUEUE, reservation_limit: control.EMERGENCY_WORKER_CEILING,
      controller_version: control.CONTROL_VERSION, enforcement_verified: true, activation_proof: activationProof, status: 'configured', supported: true },
    resourceState: { physical_total: 32 * control.GIB, physical_available: 20 * control.GIB, commit_total: 48 * control.GIB, commit_available: 32 * control.GIB, host_responsive: true },
  });
  if (previousParentMarker === undefined) delete process.env.PARENT_ONLY_ENV;
  else process.env.PARENT_ONLY_ENV = previousParentMarker;
  if (process.platform !== 'win32') assert.equal(fs.statSync(result.output_path).mode & 0o777, 0o600);
  process.umask(previousUmask);
  assert.equal(result.result, control.RESULTS.START);
  assert.equal(result.status, 'launched');
  const privateSpec = fs.readFileSync(result.spec_path, 'utf8');
  assert.doesNotMatch(privateSpec, /ONLY_IN_OPTIONS_ENV|REQUIRED_CHILD_CONFIG|PARENT_ONLY_ENV|47c1|2a91|990e/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(result.spec_path).mode & 0o777, 0o600);
    assert.equal(fs.statSync(control.statePath({ root })).mode & 0o777, 0o600);
  }
  let output = '';
  let reservations = [{}];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(result.output_path)) output = fs.readFileSync(result.output_path, 'utf8');
    const state = JSON.parse(fs.readFileSync(control.statePath({ root }), 'utf8'));
    reservations = state.reservations;
    if (output && reservations.length === 0) break;
    await wait(25);
  }
  assert.equal(reservations.length, 0);
  const child = JSON.parse(output);
  assert.equal(child.fast_disabled, '1');
  assert.equal(child.background_disabled, '1');
  assert.deepEqual(child.args, ['--print', '--output-format', 'json', '--model', 'fable-5', '--effort', 'medium', '--disallowedTools', 'Agent', 'Task', '--permission-mode', 'default', '--no-session-persistence']);
  assert.equal(child.args.filter((arg) => arg === '--no-session-persistence').length, 1);
  assert.equal(child.args.includes('Agent'), true);
  assert.equal(child.args.includes('Task'), true);
  assert.equal(child.input, secretPrompt);
  assert.equal(child.args.some((arg) => arg.includes('UNIQUE_PRIVATE_PROMPT_8f06f6c1')), false);
  assert.equal(child.option_marker, optionMarker);
  assert.equal(child.required_config, requiredConfig);
  assert.equal(child.parent_marker, undefined);
  assert.equal(child.args.includes(optionMarker), false);
  assert.equal(child.args.includes(requiredConfig), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(result.error_path).mode & 0o777, 0o600);
});

test('checker execution clears failures and completes only validated structured results', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-agent-lifecycle-missing-env-'));
  const cache = path.join(root, 'cache');
  const sourceRoot = path.resolve(__dirname, '..', '..');
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/hooks/hooks.json', 'repo/scripts/toolkit-agent-control.cjs', 'repo/scripts/claude-process-launch.cjs', 'repo/scripts/toolkit-claude-agent-hook.cjs', 'repo/scripts/toolkit-claude-n8n-admission-hook.cjs', 'skills/external-system-router/scripts/external-system-router.cjs', 'skills/external-system-router/scripts/n8n-domain-router.cjs']) {
    const target = path.join(cache, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, ...rel.split('/')), target);
  }
  const pluginEntry = { id: pluginSetup.pluginId(), version: control.CONTROL_VERSION, enabled: true, trusted: true, hooksActive: true, installPath: cache };
  const fake = path.join(root, 'fake-claude.cjs');
  fs.writeFileSync(fake, [
    "'use strict';",
    `const pluginEntry = ${JSON.stringify(pluginEntry)};`,
    "if (process.argv[2] === '--version') { process.stdout.write('claude fake\\n'); process.exit(0); }",
    "if (process.argv[2] === 'plugin' && process.argv[3] === 'list') { process.stdout.write(JSON.stringify({ installed: [pluginEntry] }) + '\\n'); process.exit(0); }",
    "if (process.env.REQUIRED_CHILD_CONFIG !== 'present') { console.error('missing required child config'); process.exit(7); }",
    "if (process.env.CHECKER_OVERSIZED) { process.stdout.write('x'.repeat(300000)); } else if (process.env.CHECKER_ENVELOPE) { process.stdout.write(process.env.CHECKER_ENVELOPE); } else if (process.env.CHECKER_RESULT) { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: process.env.CHECKER_RESULT })); } else { process.stdout.write('{}'); }",
    '',
  ].join('\n'));
  const activationProof = pluginSetup.installedActivationProof(pluginEntry, control.CONTROL_VERSION);
  const checkerContext = {
    task_contract: 'Review the bounded checker lifecycle fixture against its acceptance contract.',
    changed_files: ['repo/scripts/toolkit-agent-control.cjs'],
    diff: 'bounded checker lifecycle fixture diff',
    focused_validation: 'focused lifecycle fixture validation passed',
    surrounding_invariants: 'The checker remains read-only, local-only, non-recursive, and fail-closed.',
  };
  const launchOptions = {
    root,
    claudeCli: fake,
    profile: { schema: control.SCHEMA, host: 'claude-code', topology: control.TOPOLOGIES.CLAUDE_DIRECT,
      capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST,
      queue_limit: control.MAX_QUEUE, reservation_limit: control.EMERGENCY_WORKER_CEILING,
      controller_version: control.CONTROL_VERSION, enforcement_verified: true, activation_proof: activationProof, status: 'configured', supported: true },
    resourceState: { physical_total: 32 * control.GIB, physical_available: 20 * control.GIB, commit_total: 48 * control.GIB, commit_available: 32 * control.GIB, host_responsive: true },
  };
  const launchChecker = (reviewId, env, controlRoot = root) => control.checkerWorkflow({
    implementation_complete: true,
    focused_validation_passed: true,
    diff_ready: true,
    change_kind: 'behavior',
    ...checkerContext,
    diff: checkerContext.diff + ' ' + reviewId,
  }, { ...launchOptions, root: controlRoot, env });
  const settle = async (launched, controlRoot = root) => {
    assert.equal(launched.status, 'PENDING');
    const outputPath = path.join(controlRoot, 'jobs', `${launched.reservation_id}.stdout.json`);
    const errorPath = path.join(controlRoot, 'jobs', `${launched.reservation_id}.stderr.log`);
    let state;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      state = JSON.parse(fs.readFileSync(control.statePath({ root: controlRoot }), 'utf8'));
      if (state.reservations.length === 0) {
        await wait(150);
        return {
          state: JSON.parse(fs.readFileSync(control.statePath({ root: controlRoot }), 'utf8')),
          launched,
          error: fs.readFileSync(errorPath, 'utf8'),
          output: fs.readFileSync(outputPath, 'utf8'),
        };
      }
      await wait(25);
    }
    return { state, error: '', output: '', launched };
  };

  const failed = await settle(launchChecker('failed-checker-lifecycle', Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'REQUIRED_CHILD_CONFIG'))));
  assert.equal(failed.state.reservations.length, 0);
  assert.equal(failed.state.checker_reviews.length, 0);
  assert.match(failed.error, /missing required child config/);

  const malformed = await settle(launchChecker('malformed-checker-lifecycle', { ...process.env, REQUIRED_CHILD_CONFIG: 'present' }));
  assert.equal(malformed.state.checker_reviews.length, 0);
  assert.equal(malformed.output, '{}');
  assert.match(malformed.error, /successful Claude result envelope/);

  const oversized = await settle(launchChecker('oversized-checker-lifecycle', { ...process.env, REQUIRED_CHILD_CONFIG: 'present', CHECKER_OVERSIZED: '1' }));
  assert.equal(oversized.state.checker_reviews.length, 0);
  assert.equal(oversized.output, '');
  assert.match(oversized.error, /exceeds the bounded result limit/);

  const passPayload = JSON.stringify({ status: control.CHECKER_RESULTS.PASS, findings: [] });
  const passed = await settle(launchChecker('passed-checker-lifecycle', { ...process.env, REQUIRED_CHILD_CONFIG: 'present', CHECKER_RESULT: passPayload }));
  assert.equal(passed.state.checker_reviews.length, 1);
  assert.equal(passed.state.checker_reviews[0].status, 'completed');
  assert.equal(passed.state.checker_reviews[0].result, control.CHECKER_RESULTS.PASS);
  assert.equal(passed.state.checker_reviews[0].findings_count, 0);
  assert.equal(passed.error, '');
  assert.equal(control.checkerResultFromClaudeOutput(passed.output).status, control.CHECKER_RESULTS.PASS);
  assert.equal(control.checkerResultStatus(passed.launched.review_id, { root }).status, control.CHECKER_RESULTS.PASS);
  assert.deepEqual(passed.launched.result_invocation.args.slice(-2), ['--root', path.resolve(root)]);
  assert.match(passed.launched.result_command, /--root/);
  const resultCli = spawnSync(passed.launched.result_invocation.executable,
    passed.launched.result_invocation.args, { encoding: 'utf8', windowsHide: true, shell: false });
  assert.equal(resultCli.status, 0, resultCli.stderr);
  assert.equal(JSON.parse(resultCli.stdout).status, control.CHECKER_RESULTS.PASS);

  const findingsPayload = JSON.stringify({ status: control.CHECKER_RESULTS.FINDINGS, findings: [{ file: 'repo/scripts/toolkit-agent-control.cjs', evidence: 'The bounded fixture exposes an actionable lifecycle defect.' }] });
  const findings = await settle(launchChecker('findings-checker-lifecycle', { ...process.env, REQUIRED_CHILD_CONFIG: 'present', CHECKER_RESULT: findingsPayload }));
  const retrievedFindings = control.checkerResultStatus(findings.launched.review_id, { root });
  assert.equal(retrievedFindings.status, control.CHECKER_RESULTS.FINDINGS);
  assert.equal(retrievedFindings.findings.length, 1);

  const invalidEnvelopes = [
    ['missing-subtype', { type: 'result', is_error: false, result: passPayload }, /successful Claude result envelope/],
    ['max-turns', { type: 'result', subtype: 'error_max_turns', is_error: false, result: passPayload }, /successful Claude result envelope/],
    ['other-subtype', { type: 'result', subtype: 'incompatible', is_error: false, result: passPayload }, /successful Claude result envelope/],
    ['missing-error', { type: 'result', subtype: 'success', result: passPayload }, /successful Claude result envelope/],
    ['explicit-error', { type: 'result', subtype: 'success', is_error: true, result: passPayload }, /successful Claude result envelope/],
    ['partial-result', { type: 'result', subtype: 'success', is_error: false }, /successful Claude result envelope/],
    ['malformed-inner-json', { type: 'result', subtype: 'success', is_error: false, result: '{' }, /payload is not valid JSON/],
  ];
  for (const [name, envelope, errorPattern] of invalidEnvelopes) {
    const caseRoot = path.join(root, 'envelope-cases', name);
    const failedEnvelope = await settle(launchChecker(`invalid-envelope-${name}`, {
      ...process.env,
      REQUIRED_CHILD_CONFIG: 'present',
      CHECKER_ENVELOPE: JSON.stringify(envelope),
    }, caseRoot), caseRoot);
    assert.match(failedEnvelope.error, errorPattern);
    assert.equal(failedEnvelope.state.checker_reviews.some((entry) => entry.review_id === failedEnvelope.launched.review_id), false);
    const retry = await settle(launchChecker(`invalid-envelope-${name}`, {
      ...process.env,
      REQUIRED_CHILD_CONFIG: 'present',
      CHECKER_RESULT: passPayload,
    }, caseRoot), caseRoot);
    assert.equal(control.checkerResultStatus(retry.launched.review_id, { root: caseRoot }).status, control.CHECKER_RESULTS.PASS);
  }
});
