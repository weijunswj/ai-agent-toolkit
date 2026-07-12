'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const config = require('../scripts/codex-delegation-config.cjs');
const setup = require('../scripts/setup-toolkit.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-delegation-'));
}

function tempConfig() {
  return path.join(tempRoot(), '.codex', 'config.toml');
}

function writeConfig(configPath, text, mode) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, text, mode === undefined ? undefined : { mode });
}

function proposedEditor(text) {
  return async () => ({ bytes: Buffer.from(text), editor: 'deterministic test editor' });
}

function appendAgents(text, eol = '\n') {
  const separator = text && !text.endsWith(eol) ? `${eol}${eol}` : (text ? eol : '');
  return `${text}${separator}[agents]${eol}max_threads = 1${eol}max_depth = 1${eol}`;
}

test('tomllib inspection ignores agents examples and markers inside multiline strings', () => {
  const fixtures = [
    [
      'developer_instructions = """',
      'Documentation example:',
      '[agents]',
      'max_threads = 6',
      '# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1',
      'max_depth = 2',
      '# AI-AGENT-TOOLKIT:END CODEX-DELEGATION-LIMITS',
      '"""',
      ''
    ].join('\n'),
    [
      "developer_instructions = '''",
      '[agents]',
      'max_threads = 1',
      'max_depth = 1',
      "'''",
      ''
    ].join('\r\n'),
    'developer_instructions = "fake max_threads = 1 and max_depth = 1"\n'
  ];

  for (const text of fixtures) {
    const configPath = tempConfig();
    writeConfig(configPath, text);
    const state = config.inspectCodexDelegationConfig(configPath);
    assert.equal(state.status, 'unconfigured', text);
    assert.notEqual(state.status, 'configured', text);
    assert.equal(fs.readFileSync(configPath, 'utf8'), text);
  }
});

test('tomllib inspection requires exact integer agent values', () => {
  for (const [value, expectedType] of [['1.0', 'float'], ['"1"', 'str'], ['true', 'bool']]) {
    const configPath = tempConfig();
    writeConfig(configPath, `[agents]\nmax_threads = ${value}\nmax_depth = 1\n`);
    const state = config.inspectCodexDelegationConfig(configPath);
    assert.equal(state.status, 'conflicting');
    assert.match(state.detail, new RegExp(`max_threads.*${expectedType}`));
  }
});

test('tomllib rejects duplicate real assignments and malformed TOML without writing', async () => {
  for (const text of [
    '[agents]\nmax_threads = 1\nmax_threads = 1\nmax_depth = 1\n',
    '[agents]\nmax_threads = [\n'
  ]) {
    const configPath = tempConfig();
    writeConfig(configPath, text);
    let editorCalled = false;
    const prepared = await config.prepareCodexDelegationChange(configPath, {
      editor: async () => { editorCalled = true; return { bytes: Buffer.alloc(0) }; }
    });
    assert.equal(prepared.state.status, 'conflicting');
    assert.equal(editorCalled, false);
    assert.equal(fs.readFileSync(configPath, 'utf8'), text);
  }
});

test('real agents child tables and comments remain valid insertion inputs', async () => {
  for (const eol of ['\n', '\r\n']) {
    const configPath = tempConfig();
    const original = [
      '# before agents',
      '[agents]',
      '# role settings remain',
      '',
      '[agents.security-reviewer]',
      'description = "Explicit specialist"',
      '# after role',
      ''
    ].join(eol);
    const proposed = original.replace(`[agents]${eol}`, `[agents]${eol}max_threads = 1${eol}max_depth = 1${eol}`);
    writeConfig(configPath, original);
    assert.equal(config.inspectCodexDelegationConfig(configPath).status, 'unconfigured');
    const prepared = await config.prepareCodexDelegationChange(configPath, { editor: proposedEditor(proposed) });
    assert.equal(prepared.changed, true);
    assert.equal(prepared.proposed.status, 'configured');
    assert.equal(prepared.proposed.max_threads, 1);
    assert.equal(prepared.proposed.max_depth, 1);
    assert.ok(proposed.includes(`# role settings remain${eol}`));
    assert.equal(fs.readFileSync(configPath, 'utf8'), original, 'preparation must not mutate the real config');
  }
});

test('official app-server batchWrite route is used against isolated CODEX_HOME', async () => {
  const root = tempRoot();
  const configPath = path.join(root, '.codex', 'config.toml');
  const fakeCodex = path.join(root, 'fake-codex-app-server.cjs');
  const original = 'model = "gpt-5.6"\n';
  writeConfig(configPath, original);
  fs.writeFileSync(fakeCodex, `
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n');
  if (message.method === 'config/batchWrite') {
    const configPath = path.join(process.env.CODEX_HOME, 'config.toml');
    const text = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    fs.writeFileSync(configPath, text + '\\n[agents]\\nmax_threads = 1\\nmax_depth = 1\\n');
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n');
  }
});
`, 'utf8');

  const prepared = await config.prepareCodexDelegationChange(configPath, { codexCommand: fakeCodex, codexHome: path.dirname(configPath) });
  assert.equal(prepared.changed, true);
  assert.equal(prepared.proposed.status, 'configured');
  assert.match(prepared.editor, /app-server config\/batchWrite/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
});

test('existing config backup records exact bytes and exact restore metadata', async () => {
  const configPath = tempConfig();
  const original = Buffer.from('model = "gpt-5.6"\r\n# exact bytes\r\n');
  writeConfig(configPath, original, 0o640);
  const prepared = await config.prepareCodexDelegationChange(configPath, {
    editor: proposedEditor(appendAgents(original.toString('utf8'), '\r\n'))
  });
  assert.equal(prepared.backup_root, path.join(path.dirname(configPath), '.ai-agent-toolkit-backups', 'codex-config'));
  const committed = await config.commitCodexDelegationChange(prepared);
  assert.equal(committed.status, 'configured');
  assert.equal(committed.changed, true);
  assert.ok(fs.existsSync(committed.backup_path));
  const metadata = JSON.parse(fs.readFileSync(committed.backup_path, 'utf8'));
  assert.equal(metadata.original.existed, true);
  assert.equal(metadata.original.file_type, 'regular');
  assert.equal(metadata.original.byte_length, original.length);
  if (process.platform !== 'win32') assert.equal(metadata.original.mode, 0o640);
  assert.match(committed.restore_command, /--restore-codex-config-backup/);
  const committedBytes = fs.readFileSync(configPath);
  const repeated = await config.prepareCodexDelegationChange(configPath, {
    editor: async () => { throw new Error('configured repeat must not invoke editor'); }
  });
  assert.equal(repeated.changed, false);
  assert.deepEqual(fs.readFileSync(configPath), committedBytes, 'repeat setup must be byte-for-byte idempotent');
  config.restoreCodexConfigBackup(committed.backup_path);
  assert.deepEqual(fs.readFileSync(configPath), original);
  if (process.platform !== 'win32') assert.equal(fs.statSync(configPath).mode & 0o777, 0o640);
});

test('restore removes a config that did not exist before explicit limit', async () => {
  const configPath = tempConfig();
  const prepared = await config.prepareCodexDelegationChange(configPath, {
    editor: proposedEditor('[agents]\nmax_threads = 1\nmax_depth = 1\n')
  });
  const committed = await config.commitCodexDelegationChange(prepared);
  assert.equal(fs.existsSync(configPath), true);
  const restored = config.restoreCodexConfigBackup(committed.backup_path);
  assert.equal(restored.removed, true);
  assert.equal(fs.existsSync(configPath), false);
});

test('downstream failure restores exact prior state and leaves no temp files', async () => {
  const configPath = tempConfig();
  const original = Buffer.from('model = "gpt-5.6"\n');
  writeConfig(configPath, original);
  const prepared = await config.prepareCodexDelegationChange(configPath, {
    editor: proposedEditor(appendAgents(original.toString('utf8')))
  });
  await assert.rejects(
    config.commitCodexDelegationChange(prepared, { afterCommit: async () => { throw new Error('downstream setup failed'); } }),
    /exact prior Codex config was restored/
  );
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.deepEqual(fs.readdirSync(path.dirname(configPath)).filter((name) => name.includes('.tmp-')), []);
});

test('unsupported symlink and special-file topology fails closed', async (t) => {
  const root = tempRoot();
  const target = path.join(root, 'target.toml');
  const link = path.join(root, 'config-link.toml');
  fs.writeFileSync(target, '[agents]\nmax_threads = 1\nmax_depth = 1\n');
  try {
    fs.symlinkSync(target, link, 'file');
    const linkState = config.inspectCodexDelegationConfig(link);
    assert.equal(linkState.status, 'conflicting');
    assert.equal(linkState.topology.file_type, 'symlink');
    assert.equal(linkState.topology.symlink_target, target);
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') t.diagnostic('Symlink creation unavailable on this Windows host');
    else throw error;
  }

  const directoryPath = path.join(root, 'config-directory.toml');
  fs.mkdirSync(directoryPath);
  const directoryState = config.inspectCodexDelegationConfig(directoryPath);
  assert.equal(directoryState.status, 'conflicting');
  assert.equal(directoryState.topology.file_type, 'directory');

  if (process.platform === 'win32') {
    t.diagnostic('FIFO creation is unavailable on Windows; special-file topology is covered on POSIX hosts');
    return;
  }
  const fifoPath = path.join(root, 'config-fifo.toml');
  const fifo = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
  assert.equal(fifo.status, 0, fifo.stderr || fifo.error?.message);
  const fifoState = config.inspectCodexDelegationConfig(fifoPath);
  assert.equal(fifoState.status, 'conflicting');
  assert.equal(fifoState.topology.file_type, 'special');
});

test('keep, skip, configured no-op, and repeated inspection create no backup', async () => {
  const configPath = tempConfig();
  const configured = '[agents]\nmax_threads = 1\nmax_depth = 1\n';
  writeConfig(configPath, configured);
  const current = { delegation: config.inspectCodexDelegationConfig(configPath) };
  for (const choice of ['keep', 'skip']) {
    const result = await setup.prepareHostDelegationControl({
      host: 'codex',
      setupChoices: { codexDelegationControl: choice },
      codexCli: ''
    }, current);
    assert.equal(result.changed, false);
  }
  const noOp = await config.prepareCodexDelegationChange(configPath, {
    editor: async () => { throw new Error('configured no-op must not invoke editor'); }
  });
  assert.equal(noOp.changed, false);
  assert.equal(fs.readFileSync(configPath, 'utf8'), configured);
  assert.equal(fs.existsSync(path.join(path.dirname(configPath), '.ai-agent-toolkit-backups')), false);
});

test('explicit limit plan is opt-in while recommended setup keeps config unchanged', () => {
  const limited = setup.setupPlan(setup.parseArgs(['--plan', '--codex-delegation-control', 'limit']));
  const limitedStep = limited.steps.find((step) => step.id === 'host_delegation_control');
  assert.match(limitedStep.commands.join('\n'), /preview, back up, and transactionally set agents\.max_threads=1 and agents\.max_depth=1/);

  const recommended = setup.parseArgs(['--execute', '--yes-recommended']);
  assert.equal(recommended.setupChoices.codexDelegationControl, '');
  const unsupported = setup.setupPlan(setup.parseArgs(['--plan', '--host', 'claude-code']));
  assert.deepEqual(unsupported.steps.find((step) => step.id === 'host_delegation_control').commands, []);
});
