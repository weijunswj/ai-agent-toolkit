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
  assert.ok(error.message.includes(`registered to a different Toolkit copy (${currentSource}). Codex's Toolkit plugin was not changed.`), error.message);
  assert.ok(error.message.includes(`--repo-root "${repoRoot}" --rebind-marketplace-from "${currentSource}"`), error.message);
  assert.doesNotMatch(error.message, /withheld/);
  // Any other failure keeps the private-by-default message.
  assert.equal(nativePluginRebindFailure('Codex', 'mutation', { status: 1, stdout: 'FAIL: something private' }, helperArgs), null);
  assert.equal(nativePluginRebindFailure('Codex', 'verification', { status: 1, stdout }, helperArgs), null);
  assert.equal(nativePluginRebindFailure('Claude Code', 'mutation', { status: 1, stdout }, helperArgs), null);
});

test('a refused Codex downgrade says which versions conflict and that the plugin was not changed', () => {
  const { nativePluginRebindFailure } = require('../scripts/setup-toolkit-core.cjs');
  const helperArgs = ['repo/scripts/setup-codex-toolkit-plugin.cjs', '--write', '--json', '--repo-root', os.tmpdir()];
  const stdout = `${JSON.stringify({ ok: false, reason_code: 'downgrade-refused', installed_version: '9.9.1', source_version: '9.9.0' })}\n`;
  const error = nativePluginRebindFailure('Codex', 'mutation', { status: 1, stdout }, helperArgs);
  assert.match(error.message, /Codex already has Toolkit 9\.9\.1, which is newer than this Toolkit copy \(9\.9\.0\), so setup refused to downgrade it\. Codex's Toolkit plugin was not changed\./);
  assert.doesNotMatch(error.message, /withheld/);
  const odd = `${JSON.stringify({ ok: false, reason_code: 'downgrade-refused', installed_version: 'x; rm', source_version: '9.9.0' })}\n`;
  assert.equal(nativePluginRebindFailure('Codex', 'mutation', { status: 1, stdout: odd }, helperArgs), null);
});

test('only Codex refusing the file counts as a rejection; other start-up failures are not verified', () => {
  const { probeErrorVerdict } = require('../scripts/codex-config-load-check.cjs');
  for (const message of ['codex app-server exited 1: Error: agents.max_concurrent_threads_per_session must be at least 1',
    'config/read failed: invalid configuration', 'codex app-server exited 1: TOML parse error at line 3']) {
    assert.equal(probeErrorVerdict(new Error(message)).status, 'rejected', message);
  }
  for (const message of ['app-server initialize failed: unsupported client', 'app-server initialize failed: Invalid request: missing field `clientInfo`',
    'app-server initialize failed: unknown field `capabilities`', 'app-server initialize failed: invalid type: string, expected struct',
    'codex app-server exited 3: something unrelated', 'spawn UNKNOWN']) {
    const verdict = probeErrorVerdict(new Error(message));
    assert.equal(verdict.status, 'unverified', message);
    assert.match(verdict.detail, /not verified/);
  }
});

test('a git exit 128 tells the user to run setup outside the Codex sandbox; other failures add nothing', () => {
  const { gitFailureHint } = require('../scripts/setup-toolkit-core.cjs');
  assert.match(gitFailureHint('git', 128), /run setup outside the Codex sandbox/);
  assert.equal(gitFailureHint('git', 1), '');
  assert.equal(gitFailureHint('node', 128), '');
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'toolkit-setup', 'SKILL.md'), 'utf8');
  assert.match(skill, /Run the setup command with escalated permissions \(outside the sandbox\) from the first call/);
});

// Structured failures must never classify the executable path as Codex's diagnosis.
for (const [label, fields, expected] of [
  ['timeout under a toml path', { reason: 'timeout' }, 'unverified'],
  ['unrelated exit under a toml path', { reason: 'exit', hostText: 'unrelated stderr' }, 'unverified'],
  ['failed shutdown under a toml path', { reason: 'stuck' }, 'unverified'],
  ['missing result under a toml path', { reason: 'no-result' }, 'unverified'],
  ['start failure under a toml path', { reason: 'start' }, 'unverified'],
  ['exit with Codex TOML refusal', { reason: 'exit', hostText: 'TOML parse error at line 3' }, 'rejected'],
  ['request error reply without a keyword', { reason: 'error-reply', step: 'request', hostText: 'unsupported value', message: 'request failed: unsupported value' }, 'rejected'],
  ['config/read failed reply', { reason: 'error-reply', step: 'request', hostText: 'config/read failed' }, 'rejected'],
  ['initialize error reply with a config keyword', { reason: 'error-reply', step: 'initialize', hostText: 'TOML parse error' }, 'unverified'],
]) test('verdict: ' + label, () => {
  const { probeErrorVerdict } = require('../scripts/codex-config-load-check.cjs');
  const error = Object.assign(new Error('C:/toml-tools/codex app-server failed'), fields);
  const verdict = probeErrorVerdict(error);
  assert.equal(verdict.status, expected, label);
  assert.doesNotMatch(verdict.detail, /toml-tools/);
});

const CONFIG_FAKE = path.join(__dirname, 'support/fake-codex-config.cjs');
const { npmShim, isolatedEnv } = require('./support/fake-codex-config.cjs');
const { stopFakes } = require('./support/stop-fakes.cjs');
function configFake(t, spec = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toml-config-fake-'));
  const codexHome = path.join(root, '.codex');
  fs.mkdirSync(codexHome);
  const f = { root, codexHome };
  const log = path.join(f.codexHome, 'fake-config.log');
  fs.writeFileSync(path.join(f.codexHome, 'fake-config.json'), JSON.stringify(spec));
  t.after(async () => {
    await stopFakes({ logs: [log] });
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  return { ...f, log };
}
const quickProbe = { timeoutMs: 500, closeTimeoutMs: 100, forceExitTimeoutMs: 100 };

for (const [label, spec, reason, hostText, step] of [
  ['exit', { mode: 'exit', stderr: 'TOML parse error at line 3' }, 'exit', 'TOML parse error at line 3'],
  ['request', { requestError: 'private host words' }, 'error-reply', 'private host words', 'request'],
  ['initialize', { initializeError: 'initialize host words' }, 'error-reply', 'initialize host words', 'initialize'],
  ['timeout', { mode: 'timeout' }, 'timeout', ''],
  ['no-result', { mode: 'no-result' }, 'no-result', ''],
  ['stuck', { mode: 'answer-orphan' }, 'stuck', ''],
]) test('hostText: ' + label, async t => {
  const f = configFake(t, spec);
  const { runAppServerRequest } = require('../scripts/codex-app-server.cjs');
  await assert.rejects(runAppServerRequest(CONFIG_FAKE, f.codexHome, { method: 'config/read', params: {} },
    { ...quickProbe, settleWithoutExit: reason !== 'stuck' }), error => {
    assert.equal(error.reason, reason);
    assert.equal(error.hostText, hostText);
    if (step) assert.equal(error.step, step);
    if (reason === 'exit') assert.equal(error.message, CONFIG_FAKE + ' app-server exited 3: ' + hostText);
    if (step) assert.equal(error.message, (step === 'initialize' ? 'app-server initialize' : 'config/read') + ' failed: ' + hostText);
    return true;
  });
});

test('hostText: unavailable command and native spawn errors keep precise start diagnostics', async t => {
  const f = configFake(t);
  const { runAppServerRequest } = require('../scripts/codex-app-server.cjs');
  const missing = path.join(f.root, 'absent.exe');
  await assert.rejects(runAppServerRequest(missing, f.codexHome, { method: 'config/read', params: {} },
    { ...quickProbe, direct: true, settleWithoutExit: true }), error => {
    assert.equal(error.reason, 'start');
    assert.equal(error.hostText, '');
    assert.match(error.message, /executable is not available/);
    assert.doesNotMatch(error.message, /cannot be started directly/);
    return true;
  });
  // Force the availability/spawn race: the launcher resolved a file that disappeared.
  // The actual native spawn still runs, and must retain ENOENT and empty hostText.
  const launch = require('../scripts/claude-process-launch.cjs');
  const original = launch.directSpawnParts;
  try {
    launch.directSpawnParts = () => ({ command: missing, args: [] });
    await assert.rejects(runAppServerRequest(missing, f.codexHome, { method: 'config/read', params: {} },
      { ...quickProbe, direct: true, settleWithoutExit: true }), error => {
      assert.equal(error.code, 'ENOENT');
      assert.equal(error.hostText, '');
      assert.match(error.message, /spawn .* ENOENT/);
      return true;
    });
  } finally { launch.directSpawnParts = original; }
});

test('runtime: an answer survives failed shutdown; repair probes still require exit', async t => {
  const f = configFake(t, { mode: 'answer-orphan' });
  const options = { ...quickProbe, codexHome: f.codexHome, codexCommand: CONFIG_FAKE };
  const saved = { ...process.env };
  const env = isolatedEnv(f.codexHome, f.root);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, saved); });
  const result = await delegation.inspectCodexMultiAgentRuntime(options);
  assert.equal(result.runtime, 'MultiAgentV1', result.detail);
  const repaired = await delegation.inspectCodexMultiAgentRuntime({ ...options, repairProbe: true });
  assert.equal(repaired.runtime, 'unknown', repaired.detail);
  assert.match(repaired.detail, /did not exit after bounded process-tree termination/);
});

for (const action of ['runtime', 'config/read', 'batchWrite', 'setup']) test('npm-only PATH: ' + action,
  { skip: process.platform !== 'win32' && 'Windows npm command lookup only' }, t => {
  const f = configFake(t);
  const shim = npmShim(f.root, CONFIG_FAKE);
  const env = isolatedEnv(f.codexHome, path.dirname(shim));
  const harness = action === 'runtime'
    ? `require(${JSON.stringify(require.resolve('../scripts/codex-delegation-config.cjs'))}).inspectCodexMultiAgentRuntime({codexHome:process.env.CODEX_HOME,codexCommand:'codex',timeoutMs:1000}).then(r=>console.log(JSON.stringify(r)))`
    : action === 'batchWrite'
    ? `require(${JSON.stringify(require.resolve('../scripts/codex-delegation-config.cjs'))}).editWithCodexAppServer(Buffer.from('# original\\n'),{codexHome:process.env.CODEX_HOME,codexCommand:'codex',runtime:'MultiAgentV1',helperCount:1,timeoutMs:1000}).then(r=>console.log(JSON.stringify({text:r.bytes.toString(),cleanup:r.temporary_cleanup})))`
    : action === 'setup'
    ? `console.log(JSON.stringify(require(${JSON.stringify(require.resolve('../scripts/setup-codex-toolkit-plugin.cjs'))}).inspectCodexPluginList()))`
    : `console.log(JSON.stringify(new (require(${JSON.stringify(require.resolve('../scripts/codex-config-load-check.cjs'))}).CodexConfigLoadCheck)({codexCommand:require('node:path').join(process.env.CODEX_HOME,'absent.exe')}).probe(require('node:path').join(process.env.CODEX_HOME,'config.toml'))))`;
  // batchWrite uses a fresh home; its fake still needs its spec and log in this fixture home.
  env.FAKE_CONFIG_HOME = f.codexHome;
  const r = require('node:child_process').spawnSync(process.execPath, ['-e', harness], { env, cwd: f.root, encoding: 'utf8', timeout: 12000, windowsHide: true });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  if (action === 'runtime') assert.equal(result.runtime, 'MultiAgentV1', result.detail);
  if (action === 'config/read') assert.equal(result.status, 'verified', result.detail);
  if (action === 'batchWrite') { assert.match(result.text, /max_threads = 1/); assert.equal(result.cleanup, 'removed after child exit'); }
  if (action === 'setup') { assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(result.pluginList, { marketplaces: [], plugins: [] }); }
  assert.match(fs.readFileSync(f.log, 'utf8'), action === 'setup' ? /argv plugin --help/ : /method initialize/);
});

test('hostText: invalid commands fail direct validation without host text', async t => {
  const f = configFake(t);
  const { runAppServerRequest } = require('../scripts/codex-app-server.cjs');
  await assert.rejects(runAppServerRequest('invalid\0command', f.codexHome, { method: 'config/read' }), error => {
    assert.equal(error.reason, 'start');
    assert.match(error.message, /unsafe characters/);
    assert.equal(error.hostText, '');
    return true;
  });
});

test('config/read: an answer survives failed shutdown in the synchronous load probe', t => {
  const f = configFake(t, { mode: 'answer-orphan' });
  const result = new CodexConfigLoadCheck({ codexCommand: CONFIG_FAKE }).probe(path.join(f.codexHome, 'config.toml'));
  assert.equal(result.status, 'verified', result.detail);
  assert.match(fs.readFileSync(f.log, 'utf8'), /method config\/read/);
});

test('a probe module-load crash is not verified and keeps the written config bytes', t => {
  const f = fixture(t);
  const snapshot = captureCodexConfigSnapshot(f.configPath);
  const replacementBytes = Buffer.from('# replacement kept after probe crash\n');
  const backup = createCodexConfigBackup(f.configPath, { snapshot, replacementBytes });
  writeRegularFileAtomically(f.configPath, replacementBytes, snapshot.mode);
  const scripts = path.join(f.root, 'scripts');
  fs.mkdirSync(scripts);
  for (const file of ['codex-config-load-check.cjs', 'codex-delegation-backup.cjs', 'codex-delegation-common.cjs']) {
    fs.copyFileSync(path.join(__dirname, '../scripts', file), path.join(scripts, file));
  }
  fs.writeFileSync(path.join(scripts, 'codex-app-server.cjs'), 'throw new Error("TOML module-load failure");\n');
  const Check = require(path.join(scripts, 'codex-config-load-check.cjs')).CodexConfigLoadCheck;
  const check = new Check({ environment: isolatedEnv(f.codexHome, f.root) });
  assert.doesNotThrow(() => {
    assert.equal(check.verify({ configPath: f.configPath, snapshot, backupPath: backup.backup_path, replacementBytes }).status, 'unverified');
  }, 'a crashed probe must never roll back the write');
  assert.deepEqual(fs.readFileSync(f.configPath), replacementBytes);
  assert.equal(check.probe(f.configPath).status, 'unverified', 'a crashed probe cannot reject config.toml');
});

test('batchWrite refuses an answer whose orphan keeps the editor pipes open', async t => {
  const f = configFake(t, { mode: 'answer-orphan' });
  const harness = 'require(' + JSON.stringify(require.resolve('../scripts/codex-delegation-config.cjs')) + ')' +
    '.editWithCodexAppServer(Buffer.from("# original\\n"),{codexHome:process.env.CODEX_HOME,codexCommand:' +
    JSON.stringify(CONFIG_FAKE) + ',runtime:"MultiAgentV1",helperCount:1,timeoutMs:1000,closeTimeoutMs:100,forceExitTimeoutMs:100})' +
    '.then(()=>console.log(JSON.stringify({succeeded:true})),e=>console.log(JSON.stringify({error:e.message})))';
  const env = isolatedEnv(f.codexHome, f.root);
  env.FAKE_CONFIG_HOME = f.codexHome;
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', harness], {
    env, cwd: f.root, encoding: 'utf8', timeout: 12000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.succeeded, undefined, 'batchWrite must wait for editor exit before trusting its answer');
  assert.match(answer.error, /did not exit after bounded process-tree termination/);
  assert.match(fs.readFileSync(f.log, 'utf8'), /method config\/batchWrite/);
});

for (const action of ['setup', 'config/read', 'runtime', 'batchWrite']) test('PATH lookup skips a refused wrapper before a working executable: ' + action,
  { skip: process.platform !== 'win32' }, t => {
  const f = configFake(t);
  const wrapperBin = path.join(f.root, 'wrapper');
  const exeBin = path.join(f.root, 'native');
  fs.mkdirSync(wrapperBin);
  fs.mkdirSync(exeBin);
  const marker = path.join(f.root, 'wrapper-started');
  fs.writeFileSync(path.join(wrapperBin, 'codex.cmd'), '@echo off\r\necho started>"' + marker + '"\r\n');
  const executable = path.join(exeBin, 'codex.exe');
  fs.copyFileSync(process.execPath, executable);
  // Node copied as codex.exe loads the fixture from the native command's first argument.
  // Both files are in scratch working folders; the launcher must select the later .exe.
  fs.writeFileSync(path.join(f.root, 'plugin'), "process.argv.splice(2, 0, 'plugin');\n" + fs.readFileSync(CONFIG_FAKE, 'utf8'));
  fs.copyFileSync(CONFIG_FAKE, path.join(f.codexHome, 'app-server'));
  const nativeLog = path.join(f.root, 'native-started');
  const preload = path.join(f.root, 'native-preload.cjs');
  // batchWrite chooses a new temporary cwd. Give the copied Node its app-server script there.
  fs.writeFileSync(preload, `
if (require('node:path').basename(process.execPath).toLowerCase() === 'codex.exe') {
  require('node:fs').appendFileSync(${JSON.stringify(nativeLog)}, process.execPath + '\\n');
  if (require('node:path').basename(process.argv[1] || '') === 'app-server') {
    require('node:fs').copyFileSync(${JSON.stringify(CONFIG_FAKE)}, require('node:path').join(process.cwd(), 'app-server'));
  }
}
`);
  const env = isolatedEnv(f.codexHome, [wrapperBin, '', '.', 'relative-bin', exeBin].join(path.delimiter));
  env.PATHEXT = '.CMD;.EXE';
  env.FAKE_CONFIG_HOME = f.codexHome;
  env.NODE_OPTIONS = [env.NODE_OPTIONS, '--require=' + JSON.stringify(preload.replace(/\\/g, '/'))].filter(Boolean).join(' ');
  const harness = action === 'setup'
    ? 'console.log(JSON.stringify(require(' + JSON.stringify(require.resolve('../scripts/setup-codex-toolkit-plugin.cjs')) + ').inspectCodexPluginList()))'
    : action === 'runtime'
    ? 'require(' + JSON.stringify(require.resolve('../scripts/codex-delegation-config.cjs')) + ').inspectCodexMultiAgentRuntime({codexHome:process.env.CODEX_HOME,cwd:process.env.CODEX_HOME,timeoutMs:1000}).then(r=>console.log(JSON.stringify(r)))'
    : action === 'batchWrite'
    ? 'require(' + JSON.stringify(require.resolve('../scripts/codex-delegation-config.cjs')) + ').editWithCodexAppServer(Buffer.from("# original\\n"),{codexHome:process.env.CODEX_HOME,runtime:"MultiAgentV1",helperCount:1,timeoutMs:1000}).then(r=>console.log(JSON.stringify({text:r.bytes.toString(),cleanup:r.temporary_cleanup})))'
    : 'console.log(JSON.stringify(new (require(' + JSON.stringify(require.resolve('../scripts/codex-config-load-check.cjs')) + ').CodexConfigLoadCheck)().verify({configPath:' + JSON.stringify(path.join(f.codexHome, 'config.toml')) + '})))';
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', harness], {
    env, cwd: f.root, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.equal(fs.existsSync(marker), false, 'a refused wrapper must never start');
  if (action === 'setup') assert.equal(answer.ok, true, JSON.stringify(answer));
  else if (action === 'runtime') assert.equal(answer.runtime, 'MultiAgentV1', answer.detail);
  else if (action === 'batchWrite') {
    assert.match(answer.text, /max_threads = 1/);
    assert.equal(answer.cleanup, 'removed after child exit');
  }
  else assert.equal(answer.status, 'verified', answer.detail);
  assert.deepEqual([...new Set(fs.readFileSync(nativeLog, 'utf8').trim().split(/\r?\n/).map(file => file.toLowerCase()))], [executable.toLowerCase()], 'the later PATH executable must actually run');
  const expectedMethod = action === 'runtime' ? /method experimentalFeature\/list/ : action === 'batchWrite' ? /method config\/batchWrite/ : /method config\/read/;
  assert.match(fs.readFileSync(f.log, 'utf8'), action === 'setup' ? /argv plugin --help/ : expectedMethod);
});

test('app-server requests always validate direct launches without a non-direct route', async t => {
  const f = configFake(t);
  const { runAppServerRequest } = require('../scripts/codex-app-server.cjs');
  await assert.rejects(runAppServerRequest(path.join(f.root, 'absent.exe'), f.codexHome, { method: 'config/read' }), error => {
    assert.equal(error.reason, 'start', 'the default route must use the direct launcher');
    return true;
  });
});

test('runtime and batchWrite explain a missing program without suggesting a shim fault', async t => {
  const f = configFake(t);
  const saved = { ...process.env };
  const env = isolatedEnv(f.codexHome, f.root);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, saved); });
  const result = await delegation.inspectCodexMultiAgentRuntime({ codexHome: f.codexHome });
  assert.equal(result.runtime, 'unknown');
  assert.match(result.detail, /executable is not available/);
  assert.doesNotMatch(result.detail, /cannot be started directly/);
  await assert.rejects(delegation.editWithCodexAppServer(Buffer.from('# original\n'), {
    codexHome: f.codexHome, runtime: 'MultiAgentV1', helperCount: 1,
  }), error => {
    assert.match(error.message, /executable is not available/);
    assert.doesNotMatch(error.message, /cannot be started directly/);
    return true;
  });
});
