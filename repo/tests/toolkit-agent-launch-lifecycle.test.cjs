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
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/hooks/hooks.json', 'repo/scripts/toolkit-agent-control.cjs']) {
    const target = path.join(cache, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, ...rel.split('/')), target);
  }
  const pluginEntry = { id: pluginSetup.pluginId(), version: control.CONTROL_VERSION, enabled: true, trusted: true, hooksActive: true, installPath: cache };
  const fake = path.join(root, 'fake-claude.cjs');
  const secretPrompt = 'UNIQUE_PRIVATE_PROMPT_8f06f6c1 repository customer fixture';
  fs.writeFileSync(fake, [
    "'use strict';",
    `const pluginEntry = ${JSON.stringify(pluginEntry)};`,
    "if (process.argv[2] === '--version') { process.stdout.write('claude fake\\n'); process.exit(0); }",
    "if (process.argv[2] === 'plugin' && process.argv[3] === 'list') { process.stdout.write(JSON.stringify({ installed: [pluginEntry] }) + '\\n'); process.exit(0); }",
    "let input = ''; process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input, fast_disabled: process.env.CLAUDE_CODE_DISABLE_FAST_MODE, background_disabled: process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS })));",
    '',
  ].join('\n'));
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
    profile: { schema: control.SCHEMA, host: 'claude-code', topology: control.TOPOLOGIES.CLAUDE_DIRECT,
      capacity_mode: control.CAPACITY_MODES.AUTO, manual_maximum: 0, worker_estimate_bytes: control.DEFAULT_WORKER_COST,
      queue_limit: control.MAX_QUEUE, reservation_limit: control.EMERGENCY_WORKER_CEILING,
      controller_version: control.CONTROL_VERSION, enforcement_verified: true, activation_proof: activationProof, status: 'configured', supported: true },
    resourceState: { physical_total: 32 * control.GIB, physical_available: 20 * control.GIB, commit_total: 48 * control.GIB, commit_available: 32 * control.GIB },
  });
  if (process.platform !== 'win32') assert.equal(fs.statSync(result.output_path).mode & 0o777, 0o600);
  process.umask(previousUmask);
  assert.equal(result.result, control.RESULTS.START);
  assert.equal(result.status, 'launched');
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
  assert.deepEqual(child.args.slice(0, 8), ['--print', '--output-format', 'json', '--effort', 'medium', '--disallowedTools', 'Agent', 'Task']);
  assert.equal(child.args.includes('Agent'), true);
  assert.equal(child.args.includes('Task'), true);
  assert.equal(child.input, secretPrompt);
  assert.equal(child.args.some((arg) => arg.includes('UNIQUE_PRIVATE_PROMPT_8f06f6c1')), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(result.error_path).mode & 0o777, 0o600);
});
