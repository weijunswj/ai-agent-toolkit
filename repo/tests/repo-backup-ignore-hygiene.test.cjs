'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const ignoreScript = path.join(repoRoot, 'repo', 'scripts', 'repo-ignore-hygiene.cjs');
const backupScript = path.join(repoRoot, 'repo', 'scripts', 'repo-local-backup.cjs');
const {
  RULES,
  CHOICES,
  inspectIgnoreHygiene,
  previewIgnoreHygiene,
  applyIgnoreHygiene,
  passiveIgnoreHygiene,
} = require('../scripts/repo-ignore-hygiene.cjs');
const {
  BACKUP_SCHEMA,
  CANONICAL_BACKUP_DIR,
  LEGACY_BACKUP_DIR,
  createRepoLocalBackup,
  inspectRepoLocalBackup,
  restoreRepoLocalBackup,
} = require('../scripts/repo-local-backup.cjs');

function tempRoot(label = 'repo') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `toolkit-${label}-`));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: 'utf8', shell: false, windowsHide: true, env: options.env || process.env });
}

function git(root, ...args) {
  const result = run('git', ['-C', root, ...args]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initRepo(label = 'repo') {
  const root = tempRoot(label);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'toolkit-test@example.invalid');
  git(root, 'config', 'user.name', 'Toolkit Test');
  return root;
}

function write(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

function read(filePath) {
  return fs.readFileSync(filePath);
}

function hashTree(directory) {
  if (!fs.existsSync(directory)) return null;
  const hash = crypto.createHash('sha256');
  const visit = (current, relative = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      hash.update(rel);
      if (entry.isDirectory()) visit(path.join(current, entry.name), rel);
      else hash.update(fs.readFileSync(path.join(current, entry.name)));
    }
  };
  visit(directory);
  return hash.digest('hex');
}

function approve(root, choice) {
  const preview = previewIgnoreHygiene(root, choice);
  return applyIgnoreHygiene(root, { choice, approval_digest: preview.approval_digest });
}

test('Toolkit repository tracks canonical and legacy narrow ignore coverage', () => {
  const result = inspectIgnoreHygiene(repoRoot);
  assert.equal(result.canonical.coverage, '.gitignore');
  assert.equal(result.legacy.coverage, '.gitignore');
  assert.equal(result.canonical.matches[0].pattern, RULES.canonical);
  assert.equal(result.legacy.matches[0].pattern, '.agent-toolkit-backups/');
});

test('neither rule exists and preview proposes only the exact canonical and legacy lines', () => {
  const root = initRepo();
  const preview = previewIgnoreHygiene(root, CHOICES.GITIGNORE);
  assert.deepEqual(preview.exact_lines_proposed, [RULES.canonical, RULES.legacy]);
  assert.equal(preview.coverage.canonical.coverage, 'not-covered');
  assert.equal(preview.coverage.legacy.coverage, 'not-covered');
  assert.equal(preview.user_approval_required, true);
  assert.match(preview.backup_content_action, /No backup content will be moved, merged, rewritten, or deleted/);
});

test('canonical and legacy exact or equivalent rules are recognized without duplication', async (t) => {
  const cases = [
    { name: 'canonical anchored', text: '/_agent-toolkit-backups/\n', proposed: [RULES.legacy] },
    { name: 'legacy existing unanchored', text: '.agent-toolkit-backups/\n', proposed: [RULES.canonical] },
    { name: 'both', text: '_agent-toolkit-backups\n/.agent-toolkit-backups/\n', proposed: [] },
  ];
  for (const fixture of cases) await t.test(fixture.name, () => {
    const root = initRepo();
    write(path.join(root, '.gitignore'), fixture.text);
    const preview = previewIgnoreHygiene(root, CHOICES.GITIGNORE);
    assert.deepEqual(preview.exact_lines_proposed, fixture.proposed);
    if (!fixture.proposed.length) assert.equal(approve(root, CHOICES.GITIGNORE).changed, false);
  });
});

test('coverage in local exclude and coverage in both locations are reported accurately', () => {
  const root = initRepo();
  const exclude = git(root, 'rev-parse', '--git-path', 'info/exclude');
  write(path.resolve(root, exclude), `${RULES.canonical}\n${RULES.legacy}\n`);
  let result = inspectIgnoreHygiene(root);
  assert.equal(result.canonical.coverage, '.git/info/exclude');
  assert.equal(result.legacy.coverage, '.git/info/exclude');
  write(path.join(root, '.gitignore'), `${RULES.canonical}\n${RULES.legacy}\n`);
  result = inspectIgnoreHygiene(root);
  assert.equal(result.canonical.coverage, 'both');
  assert.equal(result.legacy.coverage, 'both');
});


test('an explicit tracked choice adds exact rules even when local-only coverage already exists', () => {
  const root = initRepo();
  const exclude = git(root, 'rev-parse', '--git-path', 'info/exclude');
  write(path.resolve(root, exclude), `${RULES.canonical}\n${RULES.legacy}\n`);
  const preview = previewIgnoreHygiene(root, CHOICES.GITIGNORE);
  assert.deepEqual(preview.exact_lines_proposed, [RULES.canonical, RULES.legacy]);
  assert.equal(preview.coverage.canonical.coverage, '.git/info/exclude');
  assert.equal(preview.working_tree_dirty, true);
  const result = applyIgnoreHygiene(root, { choice: CHOICES.GITIGNORE, approval_digest: preview.approval_digest });
  assert.equal(result.changed, true);
  assert.equal(read(path.join(root, '.gitignore')).toString('utf8'), `${RULES.canonical}\n${RULES.legacy}\n`);
});

test('a demonstrably covering broader pattern is reported truthfully and is not duplicated', () => {
  const root = initRepo();
  write(path.join(root, '.gitignore'), '_agent-toolkit-*\n.agent-toolkit-*\n');
  const result = inspectIgnoreHygiene(root);
  assert.equal(result.canonical.coverage, '.gitignore');
  assert.equal(result.legacy.coverage, '.gitignore');
  assert.equal(result.canonical.matches[0].kind, 'broader-demonstrated-coverage');
  assert.deepEqual(previewIgnoreHygiene(root, CHOICES.GITIGNORE).exact_lines_proposed, []);
});

test('missing gitignore is previewed and created only after exact approval', () => {
  const root = initRepo();
  const preview = previewIgnoreHygiene(root, CHOICES.GITIGNORE);
  assert.equal(preview.target_existed, false);
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), false);
  assert.throws(() => applyIgnoreHygiene(root, { choice: CHOICES.GITIGNORE, approval_digest: '0'.repeat(64) }), /missing, stale/);
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), false);
  const result = applyIgnoreHygiene(root, { choice: CHOICES.GITIGNORE, approval_digest: preview.approval_digest });
  assert.equal(result.changed, true);
  assert.equal(read(path.join(root, '.gitignore')).toString('utf8'), `${RULES.canonical}\n${RULES.legacy}\n`);
});

test('missing local exclude parent is created only inside a real Git repository after approval', () => {
  const root = initRepo();
  const exclude = path.resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude'));
  fs.rmSync(path.dirname(exclude), { recursive: true, force: true });
  const preview = previewIgnoreHygiene(root, CHOICES.EXCLUDE);
  assert.equal(preview.target_existed, false);
  const result = applyIgnoreHygiene(root, { choice: CHOICES.EXCLUDE, approval_digest: preview.approval_digest });
  assert.equal(result.changed, true);
  assert.equal(read(exclude).toString('utf8'), `${RULES.canonical}\n${RULES.legacy}\n`);
});

test('non-Git repository fails visibly without mutation', () => {
  const root = tempRoot('not-git');
  const before = fs.readdirSync(root);
  assert.throws(() => previewIgnoreHygiene(root), /real Git repository/);
  assert.deepEqual(fs.readdirSync(root), before);
});

test('decline and proceed-with-warning are explicit byte-for-byte non-mutations', () => {
  const root = initRepo();
  write(path.join(root, '.gitignore'), '# keep me\n');
  const before = read(path.join(root, '.gitignore'));
  for (const choice of [CHOICES.DECLINE, CHOICES.PROCEED_WARNING]) {
    const preview = previewIgnoreHygiene(root, choice);
    if (choice === CHOICES.PROCEED_WARNING) assert.throws(() => applyIgnoreHygiene(root, { choice, approval_digest: preview.approval_digest }), /parent operation remains safe/);
    const result = applyIgnoreHygiene(root, { choice, approval_digest: preview.approval_digest, parent_operation_safe: choice === CHOICES.PROCEED_WARNING });
    assert.equal(result.changed, false);
    if (choice === CHOICES.PROCEED_WARNING) assert.match(result.warning, /unresolved/);
    assert.deepEqual(read(path.join(root, '.gitignore')), before);
  }
});

test('passive inspection reports only and never writes', () => {
  const root = initRepo();
  const before = hashTree(root);
  const result = passiveIgnoreHygiene(root);
  assert.equal(result.status, 'warning');
  assert.equal(result.changed, false);
  assert.match(result.message, /read-only/);
  assert.equal(hashTree(root), before);
});

test('repeat run is idempotent and preserves comments and LF formatting', () => {
  const root = initRepo();
  const target = path.join(root, '.gitignore');
  write(target, '# first\ncustom/\n');
  approve(root, CHOICES.GITIGNORE);
  const once = read(target);
  assert.equal(approve(root, CHOICES.GITIGNORE).changed, false);
  assert.deepEqual(read(target), once);
  assert.equal(once.toString(), `# first\ncustom/\n${RULES.canonical}\n${RULES.legacy}\n`);
});

test('CRLF, LF, Unicode, ordering, and final-newline state are preserved', async (t) => {
  const cases = [
    { name: 'crlf final newline', before: Buffer.from('# café\r\nkeep/\r\n'), expected: `# café\r\nkeep/\r\n${RULES.canonical}\r\n${RULES.legacy}\r\n` },
    { name: 'lf final newline', before: Buffer.from('# café\nkeep/\n'), expected: `# café\nkeep/\n${RULES.canonical}\n${RULES.legacy}\n` },
    { name: 'no final newline', before: Buffer.from('# café\nkeep/'), expected: `# café\nkeep/\n${RULES.canonical}\n${RULES.legacy}` },
  ];
  for (const fixture of cases) await t.test(fixture.name, () => {
    const root = initRepo();
    const target = path.join(root, '.gitignore');
    write(target, fixture.before);
    approve(root, CHOICES.GITIGNORE);
    assert.equal(read(target).toString('utf8'), fixture.expected);
  });
});

test('paths with spaces and shell metacharacters are passed as arguments to the CLI', () => {
  const parent = tempRoot('path-parent');
  const root = path.join(parent, 'repo with spaces & [brackets]');
  fs.mkdirSync(root);
  git(root, 'init', '-q');
  const result = run(process.execPath, [ignoreScript, 'preview', '--repo', root, '--choice', CHOICES.GITIGNORE], { cwd: repoRoot });
  assert.equal(result.status, 0, result.stderr);
  const preview = JSON.parse(result.stdout);
  assert.deepEqual(preview.exact_lines_proposed, [RULES.canonical, RULES.legacy]);
});

test('canonical and legacy backup contents remain byte-for-byte untouched by ignore choices', () => {
  const root = initRepo();
  write(path.join(root, CANONICAL_BACKUP_DIR, 'current.bin'), Buffer.from([0, 1, 2, 255]));
  write(path.join(root, LEGACY_BACKUP_DIR, 'legacy.bin'), Buffer.from([9, 8, 7, 0]));
  const beforeCanonical = hashTree(path.join(root, CANONICAL_BACKUP_DIR));
  const beforeLegacy = hashTree(path.join(root, LEGACY_BACKUP_DIR));
  const preview = previewIgnoreHygiene(root, CHOICES.GITIGNORE);
  assert.equal(preview.canonical_folder_exists, true);
  assert.equal(preview.legacy_folder_exists, true);
  applyIgnoreHygiene(root, { choice: CHOICES.GITIGNORE, approval_digest: preview.approval_digest });
  assert.equal(hashTree(path.join(root, CANONICAL_BACKUP_DIR)), beforeCanonical);
  assert.equal(hashTree(path.join(root, LEGACY_BACKUP_DIR)), beforeLegacy);
});

test('local exclude choice keeps the tracked working tree clean while gitignore changes only gitignore', () => {
  const localRoot = initRepo('local-exclude');
  write(path.join(localRoot, 'tracked.txt'), 'tracked\n');
  git(localRoot, 'add', 'tracked.txt');
  git(localRoot, 'commit', '-qm', 'fixture');
  approve(localRoot, CHOICES.EXCLUDE);
  assert.equal(git(localRoot, 'status', '--short'), '');

  const trackedRoot = initRepo('tracked-ignore');
  write(path.join(trackedRoot, 'tracked.txt'), 'tracked\n');
  git(trackedRoot, 'add', 'tracked.txt');
  git(trackedRoot, 'commit', '-qm', 'fixture');
  approve(trackedRoot, CHOICES.GITIGNORE);
  assert.equal(git(trackedRoot, 'status', '--short'), '?? .gitignore');
});

test('new backups use only the canonical root, avoid collisions, and emit privacy-safe metadata', () => {
  const root = initRepo('backup');
  write(path.join(root, 'docs', 'file.txt'), 'secret-content\r\n');
  write(path.join(root, LEGACY_BACKUP_DIR, 'keep.bin'), Buffer.from([1, 2, 3]));
  const legacyBefore = hashTree(path.join(root, LEGACY_BACKUP_DIR));
  const options = {
    operation: 'managed-rules-repair',
    timestamp: '2026-07-21T01:02:03.004Z',
    nonce: 'abc123',
    changes: [{ path: 'docs/file.txt', capture: 'managed-region', replacementBytes: 'replacement\n' }],
  };
  const first = createRepoLocalBackup(root, options);
  const second = createRepoLocalBackup(root, options);
  assert.equal(path.dirname(first.generation_path), path.join(root, CANONICAL_BACKUP_DIR));
  assert.notEqual(first.generation_path, second.generation_path);
  assert.match(path.basename(second.generation_path), /-001$/);
  assert.equal(fs.existsSync(path.join(root, LEGACY_BACKUP_DIR)), true);
  assert.equal(hashTree(path.join(root, LEGACY_BACKUP_DIR)), legacyBefore);
  assert.equal(first.metadata.schema, BACKUP_SCHEMA);
  assert.equal(first.metadata.repository.root, '.');
  assert.equal(first.metadata.files[0].capture, 'managed-region');
  assert.equal(first.metadata.files[0].original.line_endings, 'crlf');
  assert.equal(first.metadata.files[0].original.final_newline, true);
  const serialized = JSON.stringify(first.metadata);
  assert.doesNotMatch(serialized, /secret-content|replacement\n|toolkit-test@example/);
  assert.equal(first.metadata.retention.automatic_deletion, false);
});

test('exact restore preserves bytes and keeps the backup', () => {
  const root = initRepo('restore');
  const target = path.join(root, 'folder with spaces', 'a&b.txt');
  const original = Buffer.from('café\r\nlast');
  const replacement = Buffer.from('changed\n');
  write(target, original);
  const backup = createRepoLocalBackup(root, {
    operation: 'test-restore',
    changes: [{ path: 'folder with spaces/a&b.txt', replacementBytes: replacement }],
  });
  write(target, replacement);
  const inspected = inspectRepoLocalBackup(root, backup.metadata_path);
  assert.equal(inspected.files[0].path, 'folder with spaces/a&b.txt');
  const result = restoreRepoLocalBackup(root, backup.metadata_path);
  assert.deepEqual(read(target), original);
  assert.equal(result.backup_retained, true);
  assert.equal(fs.existsSync(backup.metadata_path), true);
});

test('inspection and exact restore are supported through the shell-free CLI', () => {
  const root = initRepo('restore cli & spaces');
  const relative = 'folder with spaces/a&b.txt';
  const target = path.join(root, ...relative.split('/'));
  const original = Buffer.from('original\r\n');
  const replacement = Buffer.from('replacement\n');
  write(target, original);
  const backup = createRepoLocalBackup(root, {
    operation: 'cli-restore',
    changes: [{ path: relative, replacementBytes: replacement }],
  });
  write(target, replacement);
  const metadata = path.relative(root, backup.metadata_path);
  const inspected = run(process.execPath, [backupScript, 'inspect', '--repo', root, '--metadata', metadata], { cwd: repoRoot });
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).files[0].path, relative);
  const restored = run(process.execPath, [backupScript, 'restore', '--repo', root, '--metadata', metadata], { cwd: repoRoot });
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(read(target), original);
  assert.equal(JSON.parse(restored.stdout).backup_retained, true);
});
test('restore returns an originally missing file to missing state', () => {
  const root = initRepo('missing-restore');
  const target = path.join(root, 'new.txt');
  const replacement = Buffer.from('created\n');
  const backup = createRepoLocalBackup(root, {
    operation: 'create-file',
    changes: [{ path: 'new.txt', replacementBytes: replacement }],
  });
  write(target, replacement);
  restoreRepoLocalBackup(root, backup.metadata_path);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(backup.metadata_path), true);
});

test('unknown schema, traversal, outside path, and checksum mismatch fail closed', async (t) => {
  const cases = [
    { name: 'future schema', mutate: (value) => { value.schema = 'ai-agent-toolkit.repo-local-backup.v99'; }, error: /schema is unsupported/ },
    { name: 'path traversal', mutate: (value) => { value.files[0].path = '../outside.txt'; }, error: /unsafe path segment|escapes/ },
    { name: 'outside absolute', mutate: (value) => { value.files[0].path = path.resolve(os.tmpdir(), 'outside.txt'); }, error: /repository-relative/ },
    { name: 'checksum mismatch', mutate: (value) => { value.files[0].original.sha256 = '0'.repeat(64); }, error: /checksum/ },
  ];
  for (const fixture of cases) await t.test(fixture.name, () => {
    const root = initRepo();
    write(path.join(root, 'a.txt'), 'old\n');
    const backup = createRepoLocalBackup(root, { operation: 'tamper-test', changes: [{ path: 'a.txt', replacementBytes: 'new\n' }] });
    const metadata = JSON.parse(read(backup.metadata_path));
    fixture.mutate(metadata);
    write(backup.metadata_path, `${JSON.stringify(metadata, null, 2)}\n`);
    assert.throws(() => inspectRepoLocalBackup(root, backup.metadata_path), fixture.error);
  });
});

test('partial backup failure leaves no incomplete generation that is treated as valid', () => {
  const root = initRepo('partial-backup');
  write(path.join(root, 'a.txt'), 'a');
  assert.throws(() => createRepoLocalBackup(root, {
    operation: 'partial-backup',
    changes: [{ path: 'a.txt', replacementBytes: 'b' }],
    afterBackupFile: () => { throw new Error('injected backup failure'); },
  }), /injected backup failure/);
  const names = fs.readdirSync(path.join(root, CANONICAL_BACKUP_DIR));
  assert.equal(names.length, 1);
  assert.match(names[0], /^\.incomplete-/);
  assert.equal(fs.existsSync(path.join(root, CANONICAL_BACKUP_DIR, names[0], 'restore.json')), false);
});

test('partial target restore failure rolls back the exact pre-restore state', () => {
  const root = initRepo('partial-restore');
  write(path.join(root, 'a.txt'), 'old-a\r\n');
  write(path.join(root, 'b.txt'), 'old-b\n');
  const backup = createRepoLocalBackup(root, {
    operation: 'multi-restore',
    changes: [
      { path: 'a.txt', replacementBytes: 'new-a\n' },
      { path: 'b.txt', replacementBytes: 'new-b\r\n' },
    ],
  });
  write(path.join(root, 'a.txt'), 'new-a\n');
  write(path.join(root, 'b.txt'), 'new-b\r\n');
  const beforeA = read(path.join(root, 'a.txt'));
  const beforeB = read(path.join(root, 'b.txt'));
  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path, {
    afterTargetMutation: ({ index }) => { if (index === 0) throw new Error('injected target failure'); },
  }), /exact prior target state was restored/);
  assert.deepEqual(read(path.join(root, 'a.txt')), beforeA);
  assert.deepEqual(read(path.join(root, 'b.txt')), beforeB);
  assert.equal(fs.existsSync(backup.metadata_path), true);
});


test('failure after target displacement restores the exact pre-restore state', () => {
  const root = initRepo('displacement-failure');
  const target = path.join(root, 'a.txt');
  write(target, 'old\r\n');
  const backup = createRepoLocalBackup(root, {
    operation: 'displacement-failure',
    changes: [{ path: 'a.txt', replacementBytes: 'new\n' }],
  });
  write(target, 'new\n');
  const before = read(target);
  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path, {
    afterTargetDisplaced: () => { throw new Error('injected displacement failure'); },
  }), /exact prior target state was restored/);
  assert.deepEqual(read(target), before);
  assert.equal(fs.existsSync(backup.metadata_path), true);
});

test('current replacement checksum mismatch refuses restore without mutation', () => {
  const root = initRepo('replacement-drift');
  write(path.join(root, 'a.txt'), 'old\n');
  const backup = createRepoLocalBackup(root, { operation: 'drift', changes: [{ path: 'a.txt', replacementBytes: 'new\n' }] });
  write(path.join(root, 'a.txt'), 'user changed\n');
  const before = read(path.join(root, 'a.txt'));
  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path), /does not match/);
  assert.deepEqual(read(path.join(root, 'a.txt')), before);
});
