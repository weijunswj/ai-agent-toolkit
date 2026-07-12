'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const config = require('../scripts/codex-delegation-config.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-delegation-'));
}

function configPath(root = tempRoot()) {
  return path.join(root, '.codex', 'config.toml');
}

function writeConfig(filePath, text, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, mode === undefined ? undefined : { mode });
}

function appendAgents(text, eol = '\n') {
  const separator = text && !text.endsWith(eol) ? `${eol}${eol}` : (text ? eol : '');
  return `${text}${separator}[agents]${eol}max_threads = 1${eol}max_depth = 1${eol}`;
}

function proposedEditor(text) {
  return async () => ({ bytes: Buffer.from(text), editor: 'deterministic test editor' });
}

function createFakeCodexAppServer(root) {
  const fakeCodex = path.join(root, 'fake-codex-app-server.cjs');
  fs.writeFileSync(fakeCodex, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const readline = require('node:readline');",
    "const rl = readline.createInterface({ input: process.stdin });",
    "rl.on('line', (line) => {",
    "  const message = JSON.parse(line);",
    "  if (message.method === 'initialize') process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n');",
    "  if (message.method === 'config/batchWrite') {",
    "    const target = path.join(process.env.CODEX_HOME, 'config.toml');",
    "    const text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';",
    "    const separator = text ? (text.endsWith('\\n') ? '\\n' : '\\n\\n') : '';",
    "    fs.writeFileSync(target, text + separator + '[agents]\\nmax_threads = 1\\nmax_depth = 1\\n');",
    "    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\\n');",
    "  }",
    '});',
    ''
  ].join('\n'));
  return fakeCodex;
}

test('tomllib ignores apparent agents structure inside basic and multiline strings', () => {
  for (const text of [
    'instructions = "[agents] max_threads = 1 max_depth = 1"\n',
    'instructions = """\n[agents]\nmax_threads = 6\nmax_depth = 4\n# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1\n"""\n',
    "instructions = '''\n[agents]\nmax_threads = 1\nmax_depth = 1\n'''\n"
  ]) {
    const filePath = configPath();
    writeConfig(filePath, text);
    const state = config.inspectCodexDelegationConfig(filePath);
    assert.equal(state.status, 'unconfigured');
    const preview = config.previewCodexDelegation(filePath);
    assert.equal(preview.status, 'preview');
    assert.match(preview.proposed_block, /max_threads = 1/);
    assert.match(preview.proposed_block, /max_depth = 1/);
    assert.equal(fs.readFileSync(filePath, 'utf8'), text);
  }
});

test('tomllib rejects non-integer, duplicate, malformed, and conflicting real values without writing', async () => {
  for (const text of [
    '[agents]\nmax_threads = 1.0\nmax_depth = 1\n',
    '[agents]\nmax_threads = "1"\nmax_depth = 1\n',
    '[agents]\nmax_threads = true\nmax_depth = 1\n',
    '[agents]\nmax_threads = 1\nmax_threads = 1\nmax_depth = 1\n',
    '[agents]\nmax_threads = 2\nmax_depth = 1\n',
    '[agents]\nmax_threads = [\n'
  ]) {
    const filePath = configPath();
    writeConfig(filePath, text);
    const before = fs.readFileSync(filePath);
    const result = await config.configureCodexDelegation(filePath, {
      editor: async () => { throw new Error('editor must not run for invalid config'); }
    });
    assert.equal(result.changed, false);
    assert.ok(['conflicting', 'unsupported'].includes(result.status));
    assert.deepEqual(fs.readFileSync(filePath), before);
  }
});

test('official app-server batchWrite prepares an isolated proposal and preserves the real config until commit', async () => {
  const root = tempRoot();
  const filePath = configPath(root);
  const original = 'model = "gpt-5.6"\r\n# preserve formatting\r\n';
  writeConfig(filePath, original);
  const result = await config.configureCodexDelegation(filePath, {
    codexCommand: createFakeCodexAppServer(root),
    codexHome: path.dirname(filePath)
  });
  assert.equal(result.status, 'configured');
  assert.equal(result.changed, true);
  assert.match(result.editor, /app-server config\/batchWrite/);
  assert.ok(fs.readFileSync(filePath, 'utf8').startsWith(original));
});

test('injected editor proposal preserves child tables and supports exact backup restore', async () => {
  const filePath = configPath();
  const original = Buffer.from('[agents]\r\n# user comment\r\n\r\n[agents.security-reviewer]\r\ndescription = "explicit"\r\n');
  const proposed = original.toString('utf8').replace('[agents]\r\n', '[agents]\r\nmax_threads = 1\r\nmax_depth = 1\r\n');
  writeConfig(filePath, original, 0o640);
  const result = await config.configureCodexDelegation(filePath, { editor: proposedEditor(proposed) });
  assert.equal(result.status, 'configured');
  assert.ok(fs.existsSync(result.backup_metadata_path));
  assert.match(result.restore_command, /restore-codex-delegation-backup/);
  config.restoreCodexDelegationBackup(result.backup_metadata_path);
  assert.deepEqual(fs.readFileSync(filePath), original);
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o640);
});

test('restore removes a config created from an originally missing file', async () => {
  const filePath = configPath();
  const result = await config.configureCodexDelegation(filePath, {
    editor: proposedEditor('[agents]\nmax_threads = 1\nmax_depth = 1\n')
  });
  assert.equal(fs.existsSync(filePath), true);
  const restored = config.restoreCodexDelegationBackup(result.backup_metadata_path);
  assert.equal(restored.removed_created_file, true);
  assert.equal(fs.existsSync(filePath), false);
});

test('post-write failure restores the exact prior bytes and removes temporary files', async () => {
  const filePath = configPath();
  const original = Buffer.from('model = "gpt-5.6"\n');
  writeConfig(filePath, original);
  await assert.rejects(
    config.configureCodexDelegation(filePath, {
      editor: proposedEditor(appendAgents(original.toString('utf8'))),
      afterWrite() { throw new Error('synthetic downstream failure'); }
    }),
    /synthetic downstream failure/
  );
  assert.deepEqual(fs.readFileSync(filePath), original);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)).filter((name) => name.includes('.tmp-')), []);
});

test('keep, skip, and configured no-op create no backup or config write', async () => {
  const filePath = configPath();
  const original = '[agents]\nmax_threads = 1\nmax_depth = 1\n';
  writeConfig(filePath, original);
  for (const choice of ['keep', 'skip']) {
    const result = await config.delegationResultForChoice(choice, filePath);
    assert.equal(result.changed, false);
  }
  const noOp = await config.configureCodexDelegation(filePath, {
    editor: async () => { throw new Error('configured no-op must not invoke editor'); }
  });
  assert.equal(noOp.changed, false);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
});

test('symlink, directory, and special topology fail closed', async (t) => {
  const root = tempRoot();
  const target = path.join(root, 'target.toml');
  const link = path.join(root, 'config-link.toml');
  writeConfig(target, 'model = "gpt-5.6"\n');
  try {
    fs.symlinkSync(target, link, 'file');
    assert.equal(config.inspectCodexDelegationConfig(link).status, 'unsupported');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') t.diagnostic('Symlink creation unavailable on this Windows host');
    else throw error;
  }
  const directory = path.join(root, 'config-directory.toml');
  fs.mkdirSync(directory);
  assert.equal(config.inspectCodexDelegationConfig(directory).status, 'unsupported');
  if (process.platform === 'win32') {
    t.diagnostic('FIFO creation is unavailable on Windows; special-file topology is covered on POSIX hosts');
    return;
  }
  const fifo = path.join(root, 'config-fifo.toml');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  assert.equal(config.inspectCodexDelegationConfig(fifo).status, 'unsupported');
});
