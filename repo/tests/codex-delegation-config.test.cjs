'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const helper = require('../scripts/codex-delegation-config.cjs');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-delegation-secure-')); }
function config(rootPath) { return path.join(rootPath, '.codex', 'config.toml'); }
function write(file, bytes, mode) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, mode == null ? undefined : { mode }); }

for (const [name, original] of [
  ['multiline basic', 'developer_instructions = """\nDocumentation example:\n[agents]\nmax_threads = 6\nmax_depth = 4\n# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1\n"""\n'],
  ['multiline literal', "developer_instructions = '''\n[agents]\nmax_threads = 6\nmax_depth = 4\n# AI-AGENT-TOOLKIT:END CODEX-DELEGATION-LIMITS\n'''\n"],
]) {
  test(`${name} strings cannot impersonate real agents structure`, () => {
    const dir = root(); const file = config(dir); write(file, original);
    const state = helper.inspectCodexDelegationConfig(file);
    assert.equal(state.status, 'unconfigured', state.detail);
    const preview = helper.previewCodexDelegation(file);
    assert.equal(preview.status, 'preview', preview.detail);
    assert.ok(preview.proposed_text.startsWith(original));
    assert.match(preview.proposed_text, /\n\[agents\]\n# AI-AGENT-TOOLKIT:BEGIN/);
  });
}

test('exact parsed integers configure without rewrite and preserve comments/CRLF', () => {
  const dir = root(); const file = config(dir);
  const original = '[agents]\r\n# before\r\nmax_threads = 1 # exact\r\nmax_depth = 1\r\n\r\n[agents.security]\r\ndescription = "specialist"\r\n';
  write(file, original);
  const before = fs.readFileSync(file);
  const result = helper.configureCodexDelegation(file);
  assert.equal(result.status, 'configured');
  assert.equal(result.ownership, 'user-owned-compatible');
  assert.equal(result.changed, false);
  assert.deepEqual(fs.readFileSync(file), before);
});

for (const [name, text] of [
  ['float', '[agents]\nmax_threads = 1.0\nmax_depth = 1\n'],
  ['quoted', '[agents]\nmax_threads = "1"\nmax_depth = 1\n'],
  ['duplicate', '[agents]\nmax_threads = 1\nmax_threads = 1\nmax_depth = 1\n'],
  ['wrong', '[agents]\nmax_threads = 2\nmax_depth = 1\n'],
  ['partial', '[agents]\nmax_threads = 1\n'],
  ['dotted', 'agents.max_threads = 1\nagents.max_depth = 1\n'],
  ['inline', 'agents = { max_threads = 1, max_depth = 1 }\n'],
  ['child-only', '[agents.security]\ndescription = "specialist"\n'],
  ['quoted-table', '["agents"]\nmax_threads = 1\nmax_depth = 1\n'],
  ['quoted-inline', '"agents" = { max_threads = 1, max_depth = 1 }\n'],
]) {
  test(`${name} agents configuration fails closed without writing`, () => {
    const dir = root(); const file = config(dir); write(file, text);
    const before = fs.readFileSync(file);
    const result = helper.configureCodexDelegation(file);
    assert.ok(['conflicting', 'unsupported'].includes(result.status), `${result.status}: ${result.detail}`);
    assert.equal(result.changed, false);
    assert.deepEqual(fs.readFileSync(file), before);
  });
}

test('safe real-table insertion parses and is byte-idempotent', () => {
  const dir = root(); const file = config(dir);
  const original = 'model = "gpt-5.6"\n\n[agents]\n# roles follow\n\n[agents.security]\ndescription = "specialist"\n';
  write(file, original);
  const first = helper.configureCodexDelegation(file);
  assert.equal(first.status, 'configured', first.detail);
  assert.equal(first.changed, true);
  const configured = fs.readFileSync(file);
  assert.equal(helper.parseTomlStructurally(configured).ok, true);
  assert.equal(helper.inspectCodexDelegationConfig(file).status, 'configured');
  const second = helper.configureCodexDelegation(file);
  assert.equal(second.changed, false);
  assert.deepEqual(fs.readFileSync(file), configured);
});

test('existing config receives exact backup, preserves POSIX mode, and restores bytes', () => {
  const dir = root(); const oldHome = process.env.HOME; process.env.HOME = dir;
  try {
    const file = config(dir); const original = Buffer.from('model = "gpt-5.6"\n'); write(file, original, 0o640);
    const result = helper.configureCodexDelegation(file);
    assert.equal(result.changed, true);
    assert.ok(fs.existsSync(result.backup_metadata_path));
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o640);
    const restored = helper.restoreCodexDelegationBackup(result.backup_metadata_path);
    assert.equal(restored.exact, true);
    assert.deepEqual(fs.readFileSync(file), original);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  } finally { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; }
});

test('missing config restore removes the file created by explicit limit', () => {
  const dir = root(); const oldHome = process.env.HOME; process.env.HOME = dir;
  try {
    const file = config(dir);
    const result = helper.configureCodexDelegation(file);
    assert.equal(result.changed, true);
    assert.equal(fs.existsSync(file), true);
    const restored = helper.restoreCodexDelegationBackup(result.backup_metadata_path);
    assert.equal(restored.removed_created_file, true);
    assert.equal(fs.existsSync(file), false);
  } finally { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; }
});

test('post-write failure restores exact state and leaves no temporary files', () => {
  const dir = root(); const oldHome = process.env.HOME; process.env.HOME = dir;
  try {
    const file = config(dir); const original = Buffer.from('model = "gpt-5.6"\r\n'); write(file, original);
    assert.throws(() => helper.configureCodexDelegation(file, { afterWrite() { throw new Error('synthetic downstream failure'); } }), /synthetic downstream failure/);
    assert.deepEqual(fs.readFileSync(file), original);
    const leftovers = fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.tmp-'));
    assert.deepEqual(leftovers, []);
  } finally { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; }
});

test('keep, skip, and configured no-op create no backup', () => {
  const dir = root(); const oldHome = process.env.HOME; process.env.HOME = dir;
  try {
    const file = config(dir); write(file, '[agents]\nmax_threads = 1\nmax_depth = 1\n');
    const keep = helper.delegationResultForChoice('keep', file);
    const skip = helper.delegationResultForChoice('skip', file);
    const noOp = helper.configureCodexDelegation(file);
    assert.equal(keep.changed, false); assert.equal(skip.changed, false); assert.equal(noOp.changed, false);
    assert.equal(fs.existsSync(helper.backupRoot ? helper.backupRoot() : path.join(dir, '.ai-agent-toolkit', 'backups', 'codex-delegation')), false);
  } finally { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; }
});

test('symlink and unsupported topology fail closed', { skip: process.platform === 'win32' }, () => {
  const dir = root(); const target = path.join(dir, 'target.toml'); const file = config(dir);
  write(target, 'model = "gpt"\n'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.symlinkSync(target, file);
  const state = helper.inspectCodexDelegationConfig(file);
  assert.equal(state.status, 'unsupported');
  assert.equal(state.file_type, 'symlink');
  assert.equal(fs.readFileSync(target, 'utf8'), 'model = "gpt"\n');

  const special = path.join(dir, '.codex', 'special'); fs.mkdirSync(special);
  const specialState = helper.inspectCodexDelegationConfig(special);
  assert.equal(specialState.status, 'unsupported');
});

test('fake assignments and markers inside strings never report configured', () => {
  const texts = [
    'x = "[agents] max_threads = 1 max_depth = 1"\n',
    'x = "# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1"\n',
    'x = "max_threads = 1"\ny = "max_depth = 1"\n',
  ];
  for (const text of texts) {
    const state = helper.codexDelegationConfigState(Buffer.from(text), '/isolated/config.toml');
    assert.notEqual(state.status, 'configured');
  }
});
