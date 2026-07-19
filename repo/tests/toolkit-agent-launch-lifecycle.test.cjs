'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const control = require('../scripts/toolkit-agent-control.cjs');
const pluginSetup = require('../scripts/setup-claude-toolkit-plugin.cjs');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test('detached Claude supervisor forces medium non-fast invocation and releases its reservation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-agent-lifecycle-'));
  const cache = path.join(root, 'cache');
  const sourceRoot = path.resolve(__dirname, '..', '..');
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/hooks/hooks.json', 'repo/scripts/toolkit-agent-control.cjs', 'repo/scripts/claude-process-launch.cjs', 'repo/scripts/toolkit-claude-agent-hook.cjs']) {
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
    material_benefit: 'The isolated parser work is independent and improves implementation quality.',
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

test('failed checker execution releases its reservation and pending review identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-agent-lifecycle-missing-env-'));
  const cache = path.join(root, 'cache');
  const sourceRoot = path.resolve(__dirname, '..', '..');
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/hooks/hooks.json', 'repo/scripts/toolkit-agent-control.cjs', 'repo/scripts/claude-process-launch.cjs', 'repo/scripts/toolkit-claude-agent-hook.cjs']) {
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
    "process.stdout.write('{}');",
    '',
  ].join('\n'));
  const activationProof = pluginSetup.installedActivationProof(pluginEntry, control.CONTROL_VERSION);
  const result = control.launch({
    role: control.ROLES.CHECKER,
    host: control.HOSTS.CLAUDE,
    model: control.MODEL_CONTRACT[control.HOSTS.CLAUDE].checker,
    effort: 'medium',
    depth: 1,
    read_only: true,
    may_edit: false,
    may_commit: false,
    may_push: false,
    may_open_pr: false,
    may_merge_pr: false,
    may_spawn_children: false,
    review_id: 'failed-checker-lifecycle',
    child_responsibility: 'Implement the isolated parser shard and focused unit coverage.',
    parent_responsibility: 'Review the integration interface and reconcile adjacent contracts.',
    integration_plan: 'The root owns interface reconciliation and final integration judgement.',
    validation_plan: 'The root runs cross-shard validation and reviews the final combined diff.',
    material_benefit: 'The isolated parser work is independent and improves implementation quality.',
    child_prompt: 'private prompt remains on stdin',
  }, {
    root,
    claudeCli: fake,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'REQUIRED_CHILD_CONFIG')),
    profile: { schema: control.SCHEMA, host: 'claude-code', topology: control.TOPOLOGIES.CLAUDE_DIRECT,
      capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST,
      queue_limit: control.MAX_QUEUE, reservation_limit: control.EMERGENCY_WORKER_CEILING,
      controller_version: control.CONTROL_VERSION, enforcement_verified: true, activation_proof: activationProof, status: 'configured', supported: true },
    resourceState: { physical_total: 32 * control.GIB, physical_available: 20 * control.GIB, commit_total: 48 * control.GIB, commit_available: 32 * control.GIB, host_responsive: true },
  });
  assert.equal(result.status, 'launched');
  let reservations = [{}];
  let checkerReviews = [{}];
  let error = '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = JSON.parse(fs.readFileSync(control.statePath({ root }), 'utf8'));
    reservations = state.reservations;
    checkerReviews = state.checker_reviews;
    if (fs.existsSync(result.error_path)) error = fs.readFileSync(result.error_path, 'utf8');
    if (reservations.length === 0 && error) break;
    await wait(25);
  }
  assert.equal(reservations.length, 0);
  assert.equal(checkerReviews.length, 0);
  assert.match(error, /missing required child config/);
});
