'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const config = require('../scripts/codex-delegation-config.cjs');
const backup = require('../scripts/codex-delegation-backup.cjs');

const V1_RUNTIME = 'MultiAgentV1';

function inspectConfig(filePath, runtime = V1_RUNTIME) {
  return config.inspectCodexDelegationConfig(filePath, runtime);
}

function configure(filePath, options = {}) {
  return config.configureCodexDelegation(filePath, { runtime: V1_RUNTIME, ...options });
}

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

function restoreOptions(filePath) {
  return { configPath: filePath };
}

function backupRootFor(filePath) {
  return path.join(path.dirname(path.dirname(filePath)), '.ai-agent-toolkit', 'backups', 'codex-delegation');
}

function approvedOptions(preview) {
  return {
    approvedProposal: preview.approval_binding,
    backupGenerationId: preview.backup_generation_id,
  };
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
    const state = inspectConfig(filePath);
    assert.equal(state.status, 'unconfigured');
    const preview = config.previewCodexDelegation(filePath, { runtime: V1_RUNTIME });
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
    '[agents]\nmax_threads = [\n'
  ]) {
    const filePath = configPath();
    writeConfig(filePath, text);
    const before = fs.readFileSync(filePath);
    const result = await configure(filePath, {
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
  const result = await configure(filePath, {
    codexCommand: createFakeCodexAppServer(root),
    codexHome: path.dirname(filePath)
  });
  assert.equal(result.status, 'configured');
  assert.equal(result.changed, true);
  assert.match(result.editor, /app-server config\/batchWrite/);
  const configured = fs.readFileSync(filePath, 'utf8');
  assert.ok(configured.startsWith(original));
  assert.match(configured, /# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1\r?\nmax_threads = 1\r?\nmax_depth = 1\r?\n# AI-AGENT-TOOLKIT:END CODEX-DELEGATION-LIMITS/);
  assert.equal(inspectConfig(filePath).ownership, 'toolkit-managed-v1');
});

test('explicitly approved V1 replacement changes only supported legacy controls', async () => {
  const filePath = configPath();
  const original = '[agents]\n# user helper settings\nmax_threads = 8\nmax_depth = 2\n\n[agents.security-reviewer]\ndescription = "preserve exactly"\n';
  writeConfig(filePath, original);
  const proposed = original.replace('max_threads = 8\nmax_depth = 2', 'max_threads = 1\nmax_depth = 1');
  const blocked = await configure(filePath, { helperCount: 1, editor: proposedEditor(proposed) });
  assert.equal(blocked.changed, false);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);

  const preview = config.previewCodexDelegation(filePath, {
    runtime: V1_RUNTIME,
    helperCount: 1,
    allowUserOwnedReplacement: true,
  });
  assert.equal(preview.status, 'preview');
  const result = await configure(filePath, {
    helperCount: 1,
    allowUserOwnedReplacement: true,
    editor: proposedEditor(proposed),
    ...approvedOptions(preview),
  });
  assert.equal(result.status, 'configured', result.detail);
  assert.equal(result.helper_count, 1);
  assert.equal(result.recursive_hard_block, true);
  const configured = fs.readFileSync(filePath, 'utf8');
  assert.match(configured, /max_threads = 1\nmax_depth = 1/);
  assert.match(configured, /\[agents\.security-reviewer\]\ndescription = "preserve exactly"/);
  assert.doesNotMatch(configured, /multi_agent_v2|max_concurrent_threads_per_session/);
  assert.ok(fs.existsSync(result.backup_metadata_path));
  config.restoreCodexDelegationBackup(result.backup_metadata_path, restoreOptions(filePath));
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
});

test('approved V1 proposal rejects affected-key drift before editor or backup', async () => {
  const filePath = configPath();
  const original = '[agents]\nmax_threads = 8\nmax_depth = 2\n';
  writeConfig(filePath, original);
  const preview = config.previewCodexDelegation(filePath, {
    runtime: V1_RUNTIME,
    helperCount: 1,
    allowUserOwnedReplacement: true,
  });
  const drift = original.replace('max_threads = 8', 'max_threads = 7');
  writeConfig(filePath, drift);
  let editorCalls = 0;
  const result = await configure(filePath, {
    helperCount: 1,
    allowUserOwnedReplacement: true,
    editor: async () => { editorCalls += 1; return { bytes: Buffer.from('unreachable') }; },
    ...approvedOptions(preview),
  });
  assert.equal(result.status, 'approval-stale');
  assert.equal(result.changed, false);
  assert.match(result.detail, /configuration changed after you approved the proposal/i);
  assert.equal(editorCalls, 0);
  assert.equal(fs.readFileSync(filePath, 'utf8'), drift);
  assert.equal(fs.existsSync(backupRootFor(filePath)), false);
});

test('approved V1 proposal rejects unrelated-byte drift before editor or backup', async () => {
  const filePath = configPath();
  const original = 'approval_policy = "on-request"\n[agents]\nmax_threads = 8\nmax_depth = 2\n';
  writeConfig(filePath, original);
  const preview = config.previewCodexDelegation(filePath, {
    runtime: V1_RUNTIME,
    helperCount: 1,
    allowUserOwnedReplacement: true,
  });
  const drift = original.replace('approval_policy = "on-request"', 'approval_policy = "never"');
  writeConfig(filePath, drift);
  let editorCalls = 0;
  const result = await configure(filePath, {
    helperCount: 1,
    allowUserOwnedReplacement: true,
    editor: async () => { editorCalls += 1; return { bytes: Buffer.from('unreachable') }; },
    ...approvedOptions(preview),
  });
  assert.equal(result.status, 'approval-stale');
  assert.equal(editorCalls, 0);
  assert.equal(fs.readFileSync(filePath, 'utf8'), drift);
  assert.equal(fs.existsSync(backupRootFor(filePath)), false);
});

test('approved proposal rejects missing, deleted, and special-file topology drift', async (t) => {
  const cases = [
    {
      name: 'missing-to-created',
      prepare() {},
      drift(filePath) { writeConfig(filePath, 'model = "created later"\n'); },
      verify(filePath) { assert.equal(fs.readFileSync(filePath, 'utf8'), 'model = "created later"\n'); },
    },
    {
      name: 'existing-to-missing',
      prepare(filePath) { writeConfig(filePath, 'model = "approved"\n'); },
      drift(filePath) { fs.rmSync(filePath); },
      verify(filePath) { assert.equal(fs.existsSync(filePath), false); },
    },
    {
      name: 'regular-to-directory',
      prepare(filePath) { writeConfig(filePath, 'model = "approved"\n'); },
      drift(filePath) { fs.rmSync(filePath); fs.mkdirSync(filePath); },
      verify(filePath) { assert.equal(fs.lstatSync(filePath).isDirectory(), true); },
    },
  ];
  if (process.platform !== 'win32') {
    cases.push({
      name: 'regular-to-symlink',
      prepare(filePath) { writeConfig(filePath, 'model = "approved"\n'); },
      drift(filePath) {
        const target = `${filePath}.target`;
        writeConfig(target, 'model = "symlink target"\n');
        fs.rmSync(filePath);
        fs.symlinkSync(target, filePath, 'file');
      },
      verify(filePath) { assert.equal(fs.lstatSync(filePath).isSymbolicLink(), true); },
    });
  } else {
    t.diagnostic('Approval-bound symlink topology drift is covered on POSIX hosts');
  }

  for (const fixture of cases) {
    const filePath = configPath();
    fixture.prepare(filePath);
    const preview = config.previewCodexDelegation(filePath, { runtime: V1_RUNTIME, helperCount: 1, allowUserOwnedReplacement: true });
    assert.equal(preview.status, 'preview', fixture.name);
    fixture.drift(filePath);
    let editorCalls = 0;
    const result = await configure(filePath, {
      helperCount: 1,
      allowUserOwnedReplacement: true,
      editor: async () => { editorCalls += 1; return { bytes: Buffer.from('unreachable') }; },
      ...approvedOptions(preview),
    });
    assert.equal(result.status, 'approval-stale', fixture.name);
    assert.equal(editorCalls, 0, fixture.name);
    fixture.verify(filePath);
    assert.equal(fs.existsSync(backupRootFor(filePath)), false, fixture.name);
  }
});

test('approval binding preserves late concurrent-edit detection after editor precheck', async () => {
  const filePath = configPath();
  const original = 'model = "approved"\n';
  const concurrent = 'model = "late concurrent edit"\n';
  writeConfig(filePath, original);
  const preview = config.previewCodexDelegation(filePath, { runtime: V1_RUNTIME, helperCount: 1, allowUserOwnedReplacement: true });
  let editorCalls = 0;
  const result = await configure(filePath, {
    helperCount: 1,
    editor: async () => {
      editorCalls += 1;
      return { bytes: Buffer.from(appendAgents(original)), editor: 'approval-bound late race editor' };
    },
    beforeCommit() { writeConfig(filePath, concurrent); },
    ...approvedOptions(preview),
  });
  assert.equal(result.status, 'conflicting');
  assert.equal(result.changed, false);
  assert.equal(editorCalls, 1);
  assert.equal(fs.readFileSync(filePath, 'utf8'), concurrent);
});

test('injected editor proposal preserves child tables and supports exact backup restore', async () => {
  const filePath = configPath();
  const original = Buffer.from('[agents]\r\n# user comment\r\n\r\n[agents.security-reviewer]\r\ndescription = "explicit"\r\n');
  const proposed = original.toString('utf8').replace('[agents]\r\n', '[agents]\r\nmax_threads = 1\r\nmax_depth = 1\r\n');
  writeConfig(filePath, original, 0o640);
  const result = await configure(filePath, { editor: proposedEditor(proposed) });
  assert.equal(result.status, 'configured');
  assert.match(fs.readFileSync(filePath, 'utf8'), /# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1\r?\nmax_threads = 1\r?\nmax_depth = 1\r?\n# AI-AGENT-TOOLKIT:END CODEX-DELEGATION-LIMITS/);
  assert.ok(fs.existsSync(result.backup_metadata_path));
  assert.match(result.restore_commands.powershell, /restore-codex-delegation-backup/);
  assert.match(result.restore_commands.posix, /restore-codex-delegation-backup/);
  config.restoreCodexDelegationBackup(result.backup_metadata_path, restoreOptions(filePath));
  assert.deepEqual(fs.readFileSync(filePath), original);
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o640);
});

test('restore removes a config created from an originally missing file', async () => {
  const filePath = configPath();
  const result = await configure(filePath, {
    editor: proposedEditor('[agents]\nmax_threads = 1\nmax_depth = 1\n')
  });
  assert.equal(result.status, 'configured');
  assert.equal(fs.existsSync(filePath), true);
  const restored = config.restoreCodexDelegationBackup(result.backup_metadata_path, restoreOptions(filePath));
  assert.equal(restored.removed_created_file, true);
  assert.equal(fs.existsSync(filePath), false);
});

test('restore refuses to delete a concurrently changed config that was originally missing', async () => {
  const filePath = configPath();
  const result = await configure(filePath, {
    editor: proposedEditor('[agents]\nmax_threads = 1\nmax_depth = 1\n')
  });
  assert.equal(result.status, 'configured');
  const concurrent = Buffer.from('model = "concurrent"\n');
  assert.throws(
    () => config.restoreCodexDelegationBackup(result.backup_metadata_path, {
      ...restoreOptions(filePath),
      beforeDelete() { writeConfig(filePath, concurrent); },
    }),
    /changed immediately before restore deletion/
  );
  assert.deepEqual(fs.readFileSync(filePath), concurrent);
});

test('post-write failure restores the exact prior bytes and removes temporary files', async () => {
  const filePath = configPath();
  const original = Buffer.from('model = "gpt-5.6"\n');
  writeConfig(filePath, original);
  await assert.rejects(
    configure(filePath, {
      editor: proposedEditor(appendAgents(original.toString('utf8'))),
      afterWrite() { throw new Error('synthetic downstream failure'); }
    }),
    /synthetic downstream failure/
  );
  assert.deepEqual(fs.readFileSync(filePath), original);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)).filter((name) => name.includes('.tmp-')), []);
});

test('post-replacement failure signals commitment and restores bytes and mode', async () => {
  const root = tempRoot();
  const filePath = configPath(root);
  const original = Buffer.from('model = "gpt-5.6"\n');
  writeConfig(filePath, original, 0o640);
  await assert.rejects(
    configure(filePath, {
      editor: proposedEditor(appendAgents(original.toString('utf8'))),
      afterReplace() { throw new Error('synthetic post-replacement failure'); },
    }),
    /synthetic post-replacement failure/
  );
  assert.deepEqual(fs.readFileSync(filePath), original);
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)).filter((name) => name.includes('.tmp-')), []);
  const metadataPath = path.join(backupRootFor(filePath), fs.readdirSync(backupRootFor(filePath))[0], 'restore.json');
  const validated = backup.readBackupMetadata(metadataPath, restoreOptions(filePath));
  assert.equal(validated.metadata.original_sha256, backup.captureCodexConfigSnapshot(filePath).sha256);
  assert.deepEqual(fs.readFileSync(validated.metadata.backup_path), original);
});

test('concurrent config edits survive editor, pre-backup, and pre-commit races', async () => {
  for (const phase of ['editor', 'beforeBackup', 'beforeCommit']) {
    const root = tempRoot();
    const filePath = configPath(root);
    const original = 'model = "gpt-5.6"\n';
    const concurrent = `model = "concurrent-${phase}"\n`;
    writeConfig(filePath, original);
    const result = await configure(filePath, {
      editor: async () => {
        if (phase === 'editor') writeConfig(filePath, concurrent);
        return { bytes: Buffer.from(appendAgents(original)), editor: 'race test editor' };
      },
      beforeBackup() {
        if (phase === 'beforeBackup') writeConfig(filePath, concurrent);
      },
      beforeCommit() {
        if (phase === 'beforeCommit') writeConfig(filePath, concurrent);
      },
    });
    assert.equal(result.status, 'conflicting', phase);
    assert.equal(result.changed, false, phase);
    assert.equal(fs.readFileSync(filePath, 'utf8'), concurrent, phase);
  }
});

test('restore metadata rejects arbitrary paths, traversal, schema, and hash tampering', async () => {
  const root = tempRoot();
  const filePath = configPath(root);
  writeConfig(filePath, 'model = "gpt-5.6"\n');
  const result = await configure(filePath, {
    editor: proposedEditor(appendAgents('model = "gpt-5.6"\n')),
  });
  const metadataPath = result.backup_metadata_path;
  const originalMetadata = fs.readFileSync(metadataPath, 'utf8');
  const generation = path.dirname(metadataPath);
  const mutations = [
    (metadata) => { metadata.config_path = path.join(root, 'unrelated.toml'); },
    (metadata) => { metadata.backup_path = path.join(root, 'unrelated.toml'); },
    (metadata) => { metadata.backup_path = path.join(generation, '..', 'config.toml.original'); },
    (metadata) => { metadata.generation = 'wrong-generation'; },
    (metadata) => { metadata.schema = 'ai-agent-toolkit.codex-config-backup.v1'; },
    (metadata) => { metadata.original_sha256 = '0'.repeat(64); },
    (metadata) => { metadata.replacement_sha256 = 'f'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const metadata = JSON.parse(originalMetadata);
    mutate(metadata);
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`);
    assert.throws(() => config.restoreCodexDelegationBackup(metadataPath, restoreOptions(filePath)));
    assert.match(fs.readFileSync(filePath, 'utf8'), /AI-AGENT-TOOLKIT:BEGIN/);
  }
  fs.writeFileSync(metadataPath, originalMetadata);
});

test('restore rejects symlinked metadata, generation, backup file, and target paths', (t) => {
  if (process.platform === 'win32') {
    t.diagnostic('Symlink fixture coverage is unavailable on this Windows host');
    return;
  }
  const root = tempRoot();
  const filePath = configPath(root);
  writeConfig(filePath, 'model = "gpt-5.6"\n');
  return configure(filePath, {
    editor: proposedEditor(appendAgents('model = "gpt-5.6"\n')),
  }).then((result) => {
    const metadataPath = result.backup_metadata_path;
    const generation = path.dirname(metadataPath);
    const backupPath = path.join(generation, 'config.toml.original');
    const originalBackup = fs.readFileSync(backupPath);
    const linkMetadata = path.join(backupRootFor(filePath), 'metadata-link', 'restore.json');
    fs.mkdirSync(path.dirname(linkMetadata));
    fs.symlinkSync(metadataPath, linkMetadata, 'file');
    assert.throws(() => config.restoreCodexDelegationBackup(linkMetadata, restoreOptions(filePath)));

    const realGeneration = `${generation}.real`;
    fs.renameSync(generation, realGeneration);
    fs.symlinkSync(realGeneration, generation, 'dir');
    assert.throws(() => config.restoreCodexDelegationBackup(metadataPath, restoreOptions(filePath)));
    fs.rmSync(generation);
    fs.renameSync(realGeneration, generation);

    fs.rmSync(backupPath);
    const outsideBackup = path.join(root, 'outside.toml');
    fs.writeFileSync(outsideBackup, originalBackup);
    fs.symlinkSync(outsideBackup, backupPath, 'file');
    assert.throws(() => config.restoreCodexDelegationBackup(metadataPath, restoreOptions(filePath)));
    fs.rmSync(backupPath);
    fs.writeFileSync(backupPath, originalBackup);

    const configured = fs.readFileSync(filePath);
    const target = path.join(root, 'target.toml');
    fs.renameSync(filePath, target);
    fs.symlinkSync(target, filePath, 'file');
    assert.throws(() => config.restoreCodexDelegationBackup(metadataPath, restoreOptions(filePath)));
    fs.rmSync(filePath);
    fs.renameSync(target, filePath);
    assert.deepEqual(fs.readFileSync(filePath), configured);
  });
});

test('keep, skip, and configured no-op create no backup or config write', async () => {
  const filePath = configPath();
  const original = '[agents]\nmax_threads = 1\nmax_depth = 1\n';
  writeConfig(filePath, original);
  for (const choice of ['keep', 'skip']) {
    const result = await config.delegationResultForChoice(choice, filePath);
    assert.equal(result.changed, false);
  }
  const noOp = await configure(filePath, {
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
    assert.equal(inspectConfig(link).status, 'unsupported');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') t.diagnostic('Symlink creation unavailable on this Windows host');
    else throw error;
  }
  const directory = path.join(root, 'config-directory.toml');
  fs.mkdirSync(directory);
  assert.equal(inspectConfig(directory).status, 'unsupported');
  if (process.platform === 'win32') {
    t.diagnostic('FIFO creation is unavailable on Windows; special-file topology is covered on POSIX hosts');
    return;
  }
  const fifo = path.join(root, 'config-fifo.toml');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  assert.equal(inspectConfig(fifo).status, 'unsupported');
});
