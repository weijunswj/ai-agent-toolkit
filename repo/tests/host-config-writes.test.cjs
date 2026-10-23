'use strict';

require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexConfigLoadCheck } = require('../scripts/codex-config-load-check.cjs');
const { captureCodexConfigSnapshot, createCodexConfigBackup, writeRegularFileAtomically } = require('../scripts/codex-delegation-backup.cjs');
const delegation = require('../scripts/codex-delegation-config.cjs');
const { GlobalRules } = require('../scripts/toolkit-global-rules.cjs');
const { ClaudeUserSettings } = require('../scripts/toolkit-claude-user-settings.cjs');
const { ClaudeSubagentDepthSetting } = require('../scripts/toolkit-claude-subagent-depth.cjs');
const { CodexFeeder } = require('../scripts/toolkit-env-feeders.cjs');

function fixture(t, initial = Buffer.from('# exact bytes\r\nmodel = "example"\r\n')) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-config-write-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const codexHome = path.join(root, '.codex');
  const configPath = path.join(codexHome, 'config.toml');
  fs.mkdirSync(codexHome);
  if (initial !== null) fs.writeFileSync(configPath, initial);
  return { root, codexHome, configPath, initial };
}

function fakeServer(root, reject = false) {
  const command = path.join(root, reject ? 'reject.cjs' : 'accept.cjs');
  fs.writeFileSync(command, `
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');
  if (request.method === 'config/read') {
    fs.writeFileSync(path.join(process.env.CODEX_HOME, 'load-check-ran'), 'yes');
    process.stdout.write(JSON.stringify({ id: request.id, ${reject ? 'error: { message: "agents.max_concurrent_threads_per_session must be at least 1 secret=SENSITIVE_VALUE" }' : 'result: { config: { secret: "SENSITIVE_VALUE" } }'} }) + '\\n');
  }
});
`);
  return command;
}

test('Codex own config/read accepts the written file without exposing the returned config', t => {
  const f = fixture(t);
  const result = new CodexConfigLoadCheck({ codexCommand: fakeServer(f.root) }).probe(f.configPath);
  assert.equal(result.status, 'verified', result.detail);
  assert.equal(fs.readFileSync(path.join(f.codexHome, 'load-check-ran'), 'utf8'), 'yes');
  assert.doesNotMatch(JSON.stringify(result), /SENSITIVE_VALUE/);
});

test('Codex rejection restores exact backup bytes and reports host error, restoration and backup', t => {
  const f = fixture(t, Buffer.from('\uFEFF# exact original\r\nmodel = "example"\r\n'));
  const snapshot = captureCodexConfigSnapshot(f.configPath);
  const replacementBytes = Buffer.from('[agents]\nmax_threads = 0\n');
  const backup = createCodexConfigBackup(f.configPath, { snapshot, replacementBytes });
  writeRegularFileAtomically(f.configPath, replacementBytes, snapshot.mode);
  assert.throws(() => new CodexConfigLoadCheck({ codexCommand: fakeServer(f.root, true) }).verify({
    configPath: f.configPath, snapshot, backupPath: backup.backup_path, replacementBytes,
  }), error => {
    assert.match(error.message, /agents.max_concurrent_threads_per_session must be at least 1/);
    assert.match(error.message, /previous file was restored exactly/);
    assert.ok(error.message.includes(backup.backup_path));
    assert.doesNotMatch(error.message, /SENSITIVE_VALUE/);
    return true;
  });
  assert.deepEqual(fs.readFileSync(f.configPath), f.initial);
});

test('unavailable Codex reports not verified and never claims a load proof', t => {
  const f = fixture(t);
  const result = new CodexConfigLoadCheck({ probe: () => ({ status: 'unverified', detail: 'not verified: Codex could not be started' }) }).verify({ configPath: f.configPath });
  assert.equal(result.detail, 'not verified: Codex could not be started');
});

test('Codex rejection removes a setup-created config when the previous file was absent', t => {
  const f = fixture(t, null);
  const snapshot = captureCodexConfigSnapshot(f.configPath);
  const replacementBytes = Buffer.from('[agents]\nmax_threads = 0\n');
  fs.writeFileSync(f.configPath, replacementBytes);
  assert.throws(() => new CodexConfigLoadCheck({ codexCommand: fakeServer(f.root, true) }).verify({
    configPath: f.configPath, snapshot, replacementBytes,
  }), /setup-created file was removed/);
  assert.equal(fs.existsSync(f.configPath), false);
});

test('explicit backup restoration checks Codex and rolls back the rejected restore', t => {
  const f = fixture(t);
  const snapshot = captureCodexConfigSnapshot(f.configPath);
  const replacementBytes = Buffer.from('# current replacement\n');
  const backup = createCodexConfigBackup(f.configPath, { snapshot, replacementBytes });
  fs.writeFileSync(f.configPath, replacementBytes);
  assert.throws(() => delegation.restoreCodexDelegationBackup(backup.metadata_path, {
    configPath: f.configPath, codexCommand: fakeServer(f.root, true),
  }), /previous file was restored exactly/);
  assert.deepEqual(fs.readFileSync(f.configPath), replacementBytes);
});

test('rollback preserves a concurrent edit instead of replacing it', t => {
  const f = fixture(t);
  const snapshot = captureCodexConfigSnapshot(f.configPath);
  const replacementBytes = Buffer.from('# replacement\n');
  const backup = createCodexConfigBackup(f.configPath, { snapshot, replacementBytes });
  fs.writeFileSync(f.configPath, '# concurrent edit\n');
  assert.throws(() => new CodexConfigLoadCheck({ probe: () => ({ status: 'rejected' }) }).verify({ configPath: f.configPath, snapshot, backupPath: backup.backup_path, replacementBytes }), /rollback failed.*concurrent edit/);
  assert.equal(fs.readFileSync(f.configPath, 'utf8'), '# concurrent edit\n');
});

test('V1 zero is refused before preview, editor or any write; one means one helper', async t => {
  // https://learn.chatgpt.com/docs/config-file/config-reference and /docs/agent-configuration/subagents
  // (2026-10-23) exclude the primary. Codex CLI 0.164.0 requires the helper cap >= 1.
  const f = fixture(t);
  assert.throws(() => delegation.previewCodexDelegation(f.configPath, { runtime: 'MultiAgentV1', helperCount: 0 }), /cannot limit helpers to zero/);
  await assert.rejects(delegation.configureCodexDelegation(f.configPath, { runtime: 'MultiAgentV1', helperCount: 0, editor: () => { throw new Error('must not run'); } }), /at least 1/);
  assert.deepEqual(fs.readFileSync(f.configPath), f.initial);
  const preview = delegation.previewCodexDelegation(f.configPath, { runtime: 'MultiAgentV1', helperCount: 1 });
  assert.match(preview.proposed_block, /max_threads = 1\r?\nmax_depth = 1/);
});

test('owned broken V1 zero requires a normal approved proposal and repairs to one helper', async t => {
  const broken = Buffer.from(`[agents]\n${delegation.expectedLegacyBlock(1).replace('max_threads = 1', 'max_threads = 0')}\n`);
  const f = fixture(t, broken);
  assert.equal(delegation.inspectCodexDelegationConfig(f.configPath, 'MultiAgentV1').status, 'repair-required');
  const options = { runtime: 'MultiAgentV1', codexHome: f.codexHome, helperCount: 1 };
  const preview = delegation.previewCodexDelegation(f.configPath, options);
  assert.equal(preview.requires_user_confirmation, true);
  assert.match(preview.proposed_block, /max_threads = 1/);
  const held = await delegation.configureCodexDelegation(f.configPath, options);
  assert.equal(held.status, 'approval-required');
  assert.deepEqual(fs.readFileSync(f.configPath), broken);
  const repaired = await delegation.configureCodexDelegation(f.configPath, { ...options,
    approvedProposal: preview.approval_binding, codexCommand: fakeServer(f.root),
    editor: async () => ({ bytes: Buffer.from('[agents]\nmax_threads = 1\nmax_depth = 1\n') }),
  });
  assert.equal(repaired.status, 'configured', repaired.detail);
  assert.equal(repaired.load_check.status, 'verified');
});

test('helper writer rolls back when Codex rejects its structurally valid proposal', async t => {
  const f = fixture(t);
  await assert.rejects(delegation.configureCodexDelegation(f.configPath, { runtime: 'MultiAgentV1',
    codexCommand: fakeServer(f.root, true), editor: async () => ({ bytes: Buffer.concat([f.initial, Buffer.from('\n[agents]\nmax_threads = 1\nmax_depth = 1\n')]) }),
  }), /previous file was restored exactly/);
  assert.deepEqual(fs.readFileSync(f.configPath), f.initial);
});

test('document limit writer rolls back when Codex refuses the effective config', t => {
  const f = fixture(t);
  const owner = new GlobalRules({ environment: { HOME: f.root, USERPROFILE: f.root, CODEX_HOME: f.codexHome }, harnesses: ['codex'],
    codexDocLimit: 'raise', loadCheckOptions: { codexCommand: fakeServer(f.root, true) },
  });
  assert.throws(() => owner.refresh(), /previous file was restored exactly/);
  assert.deepEqual(fs.readFileSync(f.configPath), f.initial);
});

test('both Claude settings writers roll back exact bytes on failed JSON read-back', t => {
  for (const Owner of [ClaudeUserSettings, ClaudeSubagentDepthSetting]) {
    const f = fixture(t);
    const configDir = path.join(f.root, '.claude');
    fs.mkdirSync(configDir);
    const file = path.join(configDir, 'settings.json');
    const original = Buffer.from('{\r\n  "theme": "dark"\r\n}\r\n');
    fs.writeFileSync(file, original);
    const owner = new Owner({ environment: { CLAUDE_CONFIG_DIR: configDir }, controlRoot: path.join(f.root, 'control'),
      settingsWriteOptions: { afterReplace: file => fs.writeFileSync(file, '{invalid') },
    });
    assert.throws(() => owner.apply('enable'), /JSON read-back check.*previous file was restored exactly.*Backup:/);
    assert.deepEqual(fs.readFileSync(file), original);
  }
});

test('both Claude settings writers remove a newly-created file on JSON read-back failure', t => {
  for (const Owner of [ClaudeUserSettings, ClaudeSubagentDepthSetting]) {
    const f = fixture(t);
    const configDir = path.join(f.root, '.claude');
    const owner = new Owner({ environment: { CLAUDE_CONFIG_DIR: configDir }, controlRoot: path.join(f.root, 'control'),
      settingsWriteOptions: { afterReplace: file => fs.writeFileSync(file, '{invalid') },
    });
    assert.throws(() => owner.apply('enable'), /setup-created file was removed/);
    assert.equal(fs.existsSync(path.join(configDir, 'settings.json')), false);
  }
});

test('broken V1 zero can be discovered through an isolated runtime probe without changing the active file', async t => {
  const broken = Buffer.from(`[agents]\n${delegation.expectedLegacyBlock(1).replace('max_threads = 1', 'max_threads = 0')}\n`);
  const f = fixture(t, broken);
  const command = path.join(f.root, 'runtime.cjs');
  fs.writeFileSync(command, `
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    const broken = fs.readFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), 'utf8').includes('max_threads = 0');
    process.stdout.write(JSON.stringify({ id: request.id, ...(broken ? { error: { message: 'agents.max_concurrent_threads_per_session must be at least 1' } } : { result: {} }) }) + '\\n');
  }
  if (request.method === 'experimentalFeature/list') process.stdout.write(JSON.stringify({ id: request.id, result: { data: [{ name: 'multi_agent', enabled: true }, { name: 'multi_agent_v2', enabled: false }] } }) + '\\n');
});
`);
  const result = await delegation.inspectCodexMultiAgentRuntime({ codexHome: f.codexHome, codexCommand: command });
  assert.equal(result.runtime, 'MultiAgentV1', result.detail);
  assert.match(result.detector, /isolated repair probe/);
  assert.deepEqual(fs.readFileSync(f.configPath), broken);
});

test('Codex env feeder also rolls back on effective-config rejection', async t => {
  const initial = Buffer.from('[mcp_servers.example]\nurl = "https://example.invalid"\n');
  const f = fixture(t, initial);
  const owner = new CodexFeeder({ codexHome: f.codexHome, commandFor: () => 'helper',
    loadCheckOptions: { codexCommand: fakeServer(f.root, true) },
    editor: async () => ({ bytes: Buffer.concat([initial, Buffer.from('http_headers_helper = "helper"\n')]) }),
  });
  await assert.rejects(owner.project({ server: 'example', header: 'Authorization', name: 'EXAMPLE_KEY' }, { backupDir: path.join(f.root, 'backups') }), /previous file was restored exactly/);
  assert.deepEqual(fs.readFileSync(f.configPath), initial);
});

test('a refused Codex marketplace rebind tells the user why and the one command that approves it', () => {
  const { nativePluginRebindFailure } = require('../scripts/setup-toolkit-core.cjs');
  const repoRoot = path.join(os.tmpdir(), 'toolkit-candidate');
  const helperArgs = ['repo/scripts/setup-codex-toolkit-plugin.cjs', '--write', '--json', '--repo-root', repoRoot];
  const currentSource = path.join(os.tmpdir(), 'example-home', '.ai-agent-toolkit', 'source', 'ai-agent-toolkit');
  const stdout = `${JSON.stringify({ ok: false, reason_code: 'marketplace-rebind-required', current_source: currentSource })}\n`;
  const error = nativePluginRebindFailure('Codex', 'mutation', { status: 1, stdout }, helperArgs);
  assert.ok(error.message.includes(`registered to a different Toolkit copy (${currentSource}). Setup changed nothing.`), error.message);
  assert.ok(error.message.includes(`--repo-root "${repoRoot}" --rebind-marketplace-from "${currentSource}"`), error.message);
  assert.doesNotMatch(error.message, /withheld/);
  // Any other failure keeps the private-by-default message.
  assert.equal(nativePluginRebindFailure('Codex', 'mutation', { status: 1, stdout: 'FAIL: something private' }, helperArgs), null);
  assert.equal(nativePluginRebindFailure('Codex', 'verification', { status: 1, stdout }, helperArgs), null);
  assert.equal(nativePluginRebindFailure('Claude Code', 'mutation', { status: 1, stdout }, helperArgs), null);
});
