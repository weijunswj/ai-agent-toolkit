'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  configureCodexDelegation,
  inspectCodexDelegationConfig,
  applyHostDelegationControl,
  parseArgs,
  setupPlan
} = require('../scripts/setup-toolkit.cjs');

function tempConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-delegation-'));
  return path.join(root, '.codex', 'config.toml');
}

test('Codex delegation config preserves unrelated content and is idempotent', () => {
  const configPath = tempConfig();
  const original = [
    'model = "gpt-5.6"',
    '',
    '[agents]',
    '# user role configuration stays untouched',
    '',
    '[agents.security-reviewer]',
    'description = "Explicit security specialist"',
    '',
    '[features]',
    'multi_agent = true',
    ''
  ].join('\r\n');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, original, 'utf8');

  const first = configureCodexDelegation(configPath);
  assert.equal(first.status, 'configured');
  assert.equal(first.changed, true);
  assert.equal(first.max_threads, CODEX_AGENT_MAX_THREADS);
  assert.equal(first.max_depth, CODEX_AGENT_MAX_DEPTH);

  const configured = fs.readFileSync(configPath, 'utf8');
  assert.match(configured, /# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1\r\nmax_threads = 1\r\nmax_depth = 1\r\n# AI-AGENT-TOOLKIT:END CODEX-DELEGATION-LIMITS/);
  assert.equal(
    configured.replace(/# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1\r\nmax_threads = 1\r\nmax_depth = 1\r\n# AI-AGENT-TOOLKIT:END CODEX-DELEGATION-LIMITS\r\n/, ''),
    original,
    'only the Toolkit-managed block should be added'
  );

  const second = configureCodexDelegation(configPath);
  assert.equal(second.status, 'configured');
  assert.equal(second.changed, false);
  assert.equal(fs.readFileSync(configPath, 'utf8'), configured);
});

test('Codex delegation config appends only the supported agents table when absent', () => {
  const configPath = tempConfig();
  const original = 'model = "gpt-5.6"\n';
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, original, 'utf8');

  const result = configureCodexDelegation(configPath);
  const configured = fs.readFileSync(configPath, 'utf8');
  assert.equal(result.status, 'configured');
  assert.ok(configured.startsWith(original));
  assert.match(configured, /\n\[agents\]\n# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1\nmax_threads = 1\nmax_depth = 1\n/);
});

test('Codex delegation config preserves compatible user-owned limits', () => {
  const configPath = tempConfig();
  const original = '[agents]\nmax_threads = 1\nmax_depth = 1\n';
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, original, 'utf8');

  const result = configureCodexDelegation(configPath);
  assert.equal(result.status, 'configured');
  assert.equal(result.ownership, 'user-owned-compatible');
  assert.equal(result.changed, false);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
});

test('Codex delegation config reports conflicting user limits without writing', () => {
  const configPath = tempConfig();
  const original = 'model = "gpt-5.6"\n\n[agents]\nmax_threads = 6\nmax_depth = 2\n';
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, original, 'utf8');

  const result = configureCodexDelegation(configPath);
  assert.equal(result.status, 'conflicting');
  assert.equal(result.changed, false);
  assert.match(result.detail, /were not overwritten/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  assert.equal(inspectCodexDelegationConfig(configPath).status, 'conflicting');
});

test('Codex delegation config rejects unsupported dotted keys without writing', () => {
  const configPath = tempConfig();
  const original = 'agents.max_threads = 4\nagents.max_depth = 1\n';
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, original, 'utf8');

  const result = configureCodexDelegation(configPath);
  assert.equal(result.status, 'conflicting');
  assert.match(result.detail, /unsupported/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
});

test('Codex delegation control reports skipped and unsupported states without writing', () => {
  const configPath = tempConfig();
  const original = '[profile.default]\nmodel = "gpt-5.6"\n';
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, original, 'utf8');
  const current = { delegation: inspectCodexDelegationConfig(configPath) };

  const skipped = applyHostDelegationControl({
    host: 'codex',
    setupChoices: { codexDelegationControl: 'skip' }
  }, current);
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.changed, false);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);

  const unsupported = applyHostDelegationControl({
    host: 'claude-code',
    setupChoices: { codexDelegationControl: 'limit' }
  }, current);
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.changed, false);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
});

test('setup plans emit Codex limits only for the explicit limit choice', () => {
  const limited = setupPlan(parseArgs(['--plan', '--codex-delegation-control', 'limit']));
  const limitedStep = limited.steps.find((step) => step.id === 'host_delegation_control');
  assert.deepEqual(limitedStep.commands, [
    'manage only agents.max_threads=1 and agents.max_depth=1 in ' + path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml')
  ]);

  const unsupported = setupPlan(parseArgs(['--plan', '--host', 'claude-code']));
  const unsupportedStep = unsupported.steps.find((step) => step.id === 'host_delegation_control');
  assert.deepEqual(unsupportedStep.commands, []);
  assert.match(unsupportedStep.title, /unsupported/i);
});
