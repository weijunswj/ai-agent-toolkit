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
  cleanupRepoLocalRestoreResidue,
  main: backupMain,
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

function privatePaths(root) {
  const gitDirectory = path.resolve(root, git(root, 'rev-parse', '--absolute-git-dir'));
  const exclude = path.resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude'));
  return [root, gitDirectory, exclude];
}

function assertPathless(value, paths) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const normalized = serialized.replace(/\\\\/g, '\\').replace(/\\/g, '/').toLowerCase();
  for (const privatePath of paths) {
    const needle = path.resolve(privatePath).replace(/\\/g, '/').toLowerCase();
    assert.equal(normalized.includes(needle), false, `private path leaked: ${needle}`);
  }
}

function captureError(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to fail.');
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

test('ignore-hygiene API outcomes and routine errors never expose private resolved paths', () => {
  const root = initRepo('pathless-api');
  const paths = privatePaths(root);
  const status = passiveIgnoreHygiene(root);
  const preview = previewIgnoreHygiene(root, CHOICES.GITIGNORE);
  const declinePreview = previewIgnoreHygiene(root, CHOICES.DECLINE);
  const declined = applyIgnoreHygiene(root, { choice: CHOICES.DECLINE, approval_digest: declinePreview.approval_digest });
  const warningPreview = previewIgnoreHygiene(root, CHOICES.PROCEED_WARNING);
  const warning = applyIgnoreHygiene(root, {
    choice: CHOICES.PROCEED_WARNING,
    approval_digest: warningPreview.approval_digest,
    parent_operation_safe: true,
  });
  const updated = applyIgnoreHygiene(root, { choice: CHOICES.GITIGNORE, approval_digest: preview.approval_digest });
  const coveredPreview = previewIgnoreHygiene(root, CHOICES.GITIGNORE);
  const covered = applyIgnoreHygiene(root, { choice: CHOICES.GITIGNORE, approval_digest: coveredPreview.approval_digest });
  for (const result of [status, preview, declined, warning, updated, covered]) assertPathless(result, paths);
  assert.match(preview.repository_identity_sha256, /^[a-f0-9]{64}$/);
  assert.equal(preview.target_file, '.gitignore');
  assert.equal(preview.coverage.files.gitignore.label, '.gitignore');
  assert.equal(preview.coverage.files.info_exclude.label, '.git/info/exclude');
  assert.equal(updated.target_file, '.gitignore');

  const localRoot = initRepo('pathless-api-local');
  const localPaths = privatePaths(localRoot);
  const localPreview = previewIgnoreHygiene(localRoot, CHOICES.EXCLUDE);
  const localUpdated = applyIgnoreHygiene(localRoot, { choice: CHOICES.EXCLUDE, approval_digest: localPreview.approval_digest });
  assert.equal(localUpdated.target_file, '.git/info/exclude');
  assertPathless(localUpdated, localPaths);

  const staleRoot = initRepo('pathless-api-stale');
  const stalePaths = privatePaths(staleRoot);
  const stalePreview = previewIgnoreHygiene(staleRoot, CHOICES.GITIGNORE);
  write(path.join(staleRoot, '.gitignore'), 'concurrent-change/\n');
  assertPathless(captureError(() => applyIgnoreHygiene(staleRoot, {
    choice: CHOICES.GITIGNORE,
    approval_digest: stalePreview.approval_digest,
  })).message, stalePaths);

  const unsafeRoot = initRepo('pathless-api-unsafe');
  const unsafePaths = privatePaths(unsafeRoot);
  fs.mkdirSync(path.join(unsafeRoot, '.gitignore'));
  assertPathless(captureError(() => previewIgnoreHygiene(unsafeRoot, CHOICES.GITIGNORE)).message, unsafePaths);
  const invalidTarget = path.join(unsafeRoot, 'nested');
  fs.mkdirSync(invalidTarget);
  assertPathless(captureError(() => previewIgnoreHygiene(invalidTarget, CHOICES.GITIGNORE)).message, unsafePaths);

  const unsafeExcludeRoot = initRepo('pathless-api-unsafe-exclude');
  const unsafeExcludePaths = privatePaths(unsafeExcludeRoot);
  const unsafeExclude = path.resolve(unsafeExcludeRoot, git(unsafeExcludeRoot, 'rev-parse', '--git-path', 'info/exclude'));
  fs.unlinkSync(unsafeExclude);
  fs.mkdirSync(unsafeExclude);
  assertPathless(captureError(() => previewIgnoreHygiene(unsafeExcludeRoot, CHOICES.EXCLUDE)).message, unsafeExcludePaths);
});

test('ignore-hygiene spawned CLI output and routine errors never expose private resolved paths', () => {
  const root = initRepo('pathless-cli');
  const paths = privatePaths(root);
  const invoke = (...args) => run(process.execPath, [ignoreScript, ...args, '--repo', root], { cwd: repoRoot });
  const status = invoke('status');
  const previewRun = invoke('preview', '--choice', CHOICES.GITIGNORE);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(previewRun.status, 0, previewRun.stderr);
  const preview = JSON.parse(previewRun.stdout);
  const declinePreview = JSON.parse(invoke('preview', '--choice', CHOICES.DECLINE).stdout);
  const declined = invoke('apply', '--choice', CHOICES.DECLINE, '--approval-digest', declinePreview.approval_digest);
  const warningPreview = JSON.parse(invoke('preview', '--choice', CHOICES.PROCEED_WARNING).stdout);
  const warning = invoke('apply', '--choice', CHOICES.PROCEED_WARNING, '--approval-digest', warningPreview.approval_digest, '--parent-operation-safe');
  const updated = invoke('apply', '--choice', CHOICES.GITIGNORE, '--approval-digest', preview.approval_digest);
  const coveredPreview = JSON.parse(invoke('preview', '--choice', CHOICES.GITIGNORE).stdout);
  const covered = invoke('apply', '--choice', CHOICES.GITIGNORE, '--approval-digest', coveredPreview.approval_digest);
  for (const result of [status, previewRun, declined, warning, updated, covered]) {
    assert.equal(result.status, 0, result.stderr);
    assertPathless(`${result.stdout}\n${result.stderr}`, paths);
  }

  const localRoot = initRepo('pathless-cli-local');
  const localPaths = privatePaths(localRoot);
  const localPreviewRun = run(process.execPath, [ignoreScript, 'preview', '--repo', localRoot, '--choice', CHOICES.EXCLUDE], { cwd: repoRoot });
  const localPreview = JSON.parse(localPreviewRun.stdout);
  const localUpdated = run(process.execPath, [ignoreScript, 'apply', '--repo', localRoot, '--choice', CHOICES.EXCLUDE, '--approval-digest', localPreview.approval_digest], { cwd: repoRoot });
  assert.equal(localUpdated.status, 0, localUpdated.stderr);
  assertPathless(`${localUpdated.stdout}\n${localUpdated.stderr}`, localPaths);

  const staleRoot = initRepo('pathless-cli-stale');
  const stalePaths = privatePaths(staleRoot);
  const stalePreview = JSON.parse(run(process.execPath, [ignoreScript, 'preview', '--repo', staleRoot, '--choice', CHOICES.GITIGNORE], { cwd: repoRoot }).stdout);
  write(path.join(staleRoot, '.gitignore'), 'concurrent-change/\n');
  const stale = run(process.execPath, [ignoreScript, 'apply', '--repo', staleRoot, '--choice', CHOICES.GITIGNORE, '--approval-digest', stalePreview.approval_digest], { cwd: repoRoot });
  assert.notEqual(stale.status, 0);
  assertPathless(`${stale.stdout}\n${stale.stderr}`, stalePaths);

  const unsafeRoot = initRepo('pathless-cli-unsafe');
  const unsafePaths = privatePaths(unsafeRoot);
  fs.mkdirSync(path.join(unsafeRoot, '.gitignore'));
  const unsafe = run(process.execPath, [ignoreScript, 'preview', '--repo', unsafeRoot, '--choice', CHOICES.GITIGNORE], { cwd: repoRoot });
  assert.notEqual(unsafe.status, 0);
  assertPathless(`${unsafe.stdout}\n${unsafe.stderr}`, unsafePaths);

  const unsafeExcludeRoot = initRepo('pathless-cli-unsafe-exclude');
  const unsafeExcludePaths = privatePaths(unsafeExcludeRoot);
  const unsafeExcludePath = path.resolve(unsafeExcludeRoot, git(unsafeExcludeRoot, 'rev-parse', '--git-path', 'info/exclude'));
  fs.unlinkSync(unsafeExcludePath);
  fs.mkdirSync(unsafeExcludePath);
  const unsafeExclude = run(process.execPath, [ignoreScript, 'preview', '--repo', unsafeExcludeRoot, '--choice', CHOICES.EXCLUDE], { cwd: repoRoot });
  assert.notEqual(unsafeExclude.status, 0);
  assertPathless(`${unsafeExclude.stdout}\n${unsafeExclude.stderr}`, unsafeExcludePaths);
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
  assert.equal(result.status, 'restored');
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

test('restore revalidates each target immediately before displacement and rolls back earlier mutations', () => {
  const root = initRepo('restore-target-race');
  const firstTarget = path.join(root, 'a.txt');
  const secondTarget = path.join(root, 'b.txt');
  write(firstTarget, 'old-a\n');
  write(secondTarget, 'old-b\r\n');
  const backup = createRepoLocalBackup(root, {
    operation: 'restore-target-race',
    changes: [
      { path: 'a.txt', replacementBytes: 'new-a\n' },
      { path: 'b.txt', replacementBytes: 'new-b\n' },
    ],
  });
  write(firstTarget, 'new-a\n');
  write(secondTarget, 'new-b\n');
  const firstBefore = read(firstTarget);
  const concurrentBytes = Buffer.from('concurrent-b\r\n');
  const backupBefore = hashTree(backup.generation_path);
  let stdout = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { stdout += chunk; return true; };
  try {
    assert.throws(() => backupMain(['node', backupScript, 'restore', '--repo', root, '--metadata', backup.metadata_path], {
      beforeTargetDisplacement: ({ index }) => { if (index === 1) write(secondTarget, concurrentBytes); },
    }), /exact prior target state was restored/);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(read(firstTarget), firstBefore);
  assert.deepEqual(read(secondTarget), concurrentBytes);
  assert.deepEqual(privateRestoreResidue(root), []);
  assert.equal(hashTree(backup.generation_path), backupBefore);
  assert.doesNotMatch(stdout, /"exact"\s*:\s*true/);
});

function privateRestoreResidue(root) {
  return fs.readdirSync(root).filter((name) => name.includes('.toolkit-restore-') || name.includes('.toolkit-rollback-'));
}

function rollbackResiduePath(target, generationPath, cleanupId) {
  const generationIdentity = crypto.createHash('sha256').update(path.basename(generationPath), 'utf8').digest('hex').slice(0, 12);
  return path.join(path.dirname(target), `.${path.basename(target)}.toolkit-rollback-${generationIdentity}-${cleanupId}`);
}

function transientError(code) {
  return Object.assign(new Error('injected transient cleanup failure'), { code });
}

test('restore rejects a POSIX symlinked files directory before reading external payload bytes', { skip: process.platform === 'win32' }, () => {
  const root = initRepo('payload-files-symlink');
  const target = path.join(root, 'a.txt');
  write(target, 'old\n');
  const backup = createRepoLocalBackup(root, { operation: 'payload-link', changes: [{ path: 'a.txt', replacementBytes: 'new\n' }] });
  write(target, 'new\n');
  const external = tempRoot('external-payload');
  write(path.join(external, '0000.original'), 'external-secret\n');
  const filesDirectory = path.join(backup.generation_path, 'files');
  fs.renameSync(filesDirectory, path.join(backup.generation_path, 'files-original'));
  fs.symlinkSync(external, filesDirectory, 'dir');
  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path), /ancestor must be a real directory|exact completed generation/);
  assert.deepEqual(read(target), Buffer.from('new\n'));
  assert.deepEqual(read(path.join(external, '0000.original')), Buffer.from('external-secret\n'));
});

test('restore rejects a symlinked completed-generation ancestor', { skip: process.platform === 'win32' }, () => {
  const root = initRepo('payload-generation-symlink');
  const target = path.join(root, 'a.txt');
  write(target, 'old\n');
  const backup = createRepoLocalBackup(root, { operation: 'generation-link', changes: [{ path: 'a.txt', replacementBytes: 'new\n' }] });
  write(target, 'new\n');
  const relocated = `${backup.generation_path}-relocated`;
  fs.renameSync(backup.generation_path, relocated);
  fs.symlinkSync(relocated, backup.generation_path, 'dir');
  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path), /unsupported filesystem type|real directory|junction or symbolic link/);
  assert.deepEqual(read(target), Buffer.from('new\n'));
});

test('restore rejects a Windows junctioned files directory when junction capability exists', { skip: process.platform !== 'win32' }, (t) => {
  const root = initRepo('payload-files-junction');
  const target = path.join(root, 'a.txt');
  write(target, 'old\r\n');
  const backup = createRepoLocalBackup(root, { operation: 'payload-junction', changes: [{ path: 'a.txt', replacementBytes: 'new\r\n' }] });
  write(target, 'new\r\n');
  const external = tempRoot('junction-payload');
  write(path.join(external, '0000.original'), 'external-secret\r\n');
  const filesDirectory = path.join(backup.generation_path, 'files');
  fs.renameSync(filesDirectory, path.join(backup.generation_path, 'files-original'));
  try {
    fs.symlinkSync(external, filesDirectory, 'junction');
  } catch (error) {
    if (error && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip(`Windows junction capability unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path), /exact completed generation|real directory/);
  assert.deepEqual(read(target), Buffer.from('new\r\n'));
});

test('restore preparation cleans earlier temps when the second payload read fails', () => {
  const root = initRepo('prepare-read-failure');
  write(path.join(root, 'a.txt'), 'old-a\n');
  write(path.join(root, 'b.txt'), 'old-b\n');
  const backup = createRepoLocalBackup(root, {
    operation: 'prepare-read',
    changes: [
      { path: 'a.txt', replacementBytes: 'new-a\n' },
      { path: 'b.txt', replacementBytes: 'new-b\n' },
    ],
  });
  write(path.join(root, 'a.txt'), 'new-a\n');
  write(path.join(root, 'b.txt'), 'new-b\n');
  const beforeA = read(path.join(root, 'a.txt'));
  const beforeB = read(path.join(root, 'b.txt'));
  const backupBefore = hashTree(backup.generation_path);
  let reads = 0;
  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path, {
    readBackupFile: (filePath) => {
      reads += 1;
      if (reads === 2) throw new Error('injected payload read failure');
      return fs.readFileSync(filePath);
    },
  }), /before any target mutation/);
  assert.deepEqual(read(path.join(root, 'a.txt')), beforeA);
  assert.deepEqual(read(path.join(root, 'b.txt')), beforeB);
  assert.deepEqual(privateRestoreResidue(root), []);
  assert.equal(hashTree(backup.generation_path), backupBefore);
});

test('restore preparation cleans all partial temps when the second temp write fails', () => {
  const root = initRepo('prepare-write-failure');
  write(path.join(root, 'a.txt'), 'old-a\n');
  write(path.join(root, 'b.txt'), 'old-b\n');
  const backup = createRepoLocalBackup(root, {
    operation: 'prepare-write',
    changes: [
      { path: 'a.txt', replacementBytes: 'new-a\n' },
      { path: 'b.txt', replacementBytes: 'new-b\n' },
    ],
  });
  write(path.join(root, 'a.txt'), 'new-a\n');
  write(path.join(root, 'b.txt'), 'new-b\n');
  const beforeA = read(path.join(root, 'a.txt'));
  const beforeB = read(path.join(root, 'b.txt'));
  const backupBefore = hashTree(backup.generation_path);
  let writes = 0;
  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path, {
    writeRestoreTemp: (filePath, bytes, options) => {
      writes += 1;
      fs.writeFileSync(filePath, bytes, options);
      if (writes === 2) throw new Error('injected temp write failure');
    },
  }), /before any target mutation/);
  assert.deepEqual(read(path.join(root, 'a.txt')), beforeA);
  assert.deepEqual(read(path.join(root, 'b.txt')), beforeB);
  assert.deepEqual(privateRestoreResidue(root), []);
  assert.equal(hashTree(backup.generation_path), backupBefore);
});

test('restore preparation rejects a missing target parent without creating it or mutating targets', () => {
  const root = initRepo('prepare-missing-parent');
  const firstTarget = path.join(root, 'a.txt');
  const missingParent = path.join(root, 'removed-parent');
  const secondTarget = path.join(missingParent, 'b.txt');
  write(firstTarget, 'old-a\n');
  write(secondTarget, 'old-b\r\n');
  const backup = createRepoLocalBackup(root, {
    operation: 'prepare-missing-parent',
    changes: [
      { path: 'a.txt', replacementBytes: 'new-a\n' },
      { path: 'removed-parent/b.txt', replacementExisted: false },
    ],
  });
  write(firstTarget, 'new-a\n');
  fs.unlinkSync(secondTarget);
  fs.rmdirSync(missingParent);
  const firstBefore = read(firstTarget);
  const backupBefore = hashTree(backup.generation_path);

  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path), /before any target mutation/);
  assert.deepEqual(read(firstTarget), firstBefore);
  assert.equal(fs.existsSync(missingParent), false);
  assert.deepEqual(privateRestoreResidue(root), []);
  assert.equal(hashTree(backup.generation_path), backupBefore);
});

test('restore preparation rejects substituted payload bytes before target mutation', () => {
  const root = initRepo('prepare-payload-substitution');
  write(path.join(root, 'a.txt'), 'old-a\n');
  write(path.join(root, 'b.txt'), 'old-b\r\n');
  const backup = createRepoLocalBackup(root, {
    operation: 'prepare-payload-substitution',
    changes: [
      { path: 'a.txt', replacementBytes: 'new-a\n' },
      { path: 'b.txt', replacementBytes: 'new-b\n' },
    ],
  });
  write(path.join(root, 'a.txt'), 'new-a\n');
  write(path.join(root, 'b.txt'), 'new-b\n');
  const beforeA = read(path.join(root, 'a.txt'));
  const beforeB = read(path.join(root, 'b.txt'));
  const backupBefore = hashTree(backup.generation_path);

  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path, {
    readBackupFile: (filePath) => filePath.endsWith('0001.original') ? Buffer.from('substituted\n') : fs.readFileSync(filePath),
  }), /before any target mutation/);
  assert.deepEqual(read(path.join(root, 'a.txt')), beforeA);
  assert.deepEqual(read(path.join(root, 'b.txt')), beforeB);
  assert.deepEqual(privateRestoreResidue(root), []);
  assert.equal(hashTree(backup.generation_path), backupBefore);
});

test('creation and metadata validation reject canonical and legacy backup evidence paths without mutation', async (t) => {
  for (const backupDirectory of [CANONICAL_BACKUP_DIR, LEGACY_BACKUP_DIR]) {
    for (const originallyExists of [true, false]) {
      await t.test(`${backupDirectory} target ${originallyExists ? 'present' : 'missing'}`, () => {
        const root = initRepo('protected-backup-root');
        const protectedPath = `${backupDirectory}/nested/evidence.txt`;
        if (originallyExists) write(path.join(root, ...protectedPath.split('/')), 'evidence\n');
        const canonicalTree = path.join(root, CANONICAL_BACKUP_DIR);
        const legacyTree = path.join(root, LEGACY_BACKUP_DIR);
        const beforeCanonical = hashTree(canonicalTree);
        const beforeLegacy = hashTree(legacyTree);
        assert.throws(() => createRepoLocalBackup(root, {
          operation: 'protected-create',
          changes: [{ path: protectedPath, replacementBytes: 'replacement\n' }],
        }), /must not target Toolkit backup evidence/);
        assert.equal(hashTree(canonicalTree), beforeCanonical);
        assert.equal(hashTree(legacyTree), beforeLegacy);
      });
    }
  }
  for (const backupDirectory of [CANONICAL_BACKUP_DIR, LEGACY_BACKUP_DIR]) {
    await t.test(`metadata nested under ${backupDirectory}`, () => {
      const root = initRepo('protected-metadata-root');
      const target = path.join(root, 'a.txt');
      write(target, 'old\n');
      const backup = createRepoLocalBackup(root, { operation: 'protected-metadata', changes: [{ path: 'a.txt', replacementBytes: 'new\n' }] });
      write(target, 'new\n');
      const metadata = JSON.parse(read(backup.metadata_path));
      metadata.files[0].path = `${backupDirectory}/${metadata.generation}/nested/evidence.txt`;
      write(backup.metadata_path, `${JSON.stringify(metadata, null, 2)}\n`);
      const canonicalBefore = hashTree(path.join(root, CANONICAL_BACKUP_DIR));
      const legacyBefore = hashTree(path.join(root, LEGACY_BACKUP_DIR));
      assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path), /must not target Toolkit backup evidence/);
      assert.deepEqual(read(target), Buffer.from('new\n'));
      assert.equal(hashTree(path.join(root, CANONICAL_BACKUP_DIR)), canonicalBefore);
      assert.equal(hashTree(path.join(root, LEGACY_BACKUP_DIR)), legacyBefore);
    });
  }
});

test('creation and restore metadata reject case-varied canonical and legacy backup roots on every platform', async (t) => {
  const variants = ['_Agent-Toolkit-Backups', '.Agent-Toolkit-Backups'];
  for (const backupDirectory of variants) {
    await t.test(`creation rejects ${backupDirectory}`, () => {
      const root = initRepo('protected-case-create');
      const canonicalBefore = hashTree(path.join(root, CANONICAL_BACKUP_DIR));
      const legacyBefore = hashTree(path.join(root, LEGACY_BACKUP_DIR));
      assert.throws(() => createRepoLocalBackup(root, {
        operation: 'protected-case-create',
        changes: [{ path: `${backupDirectory}/nested/evidence.txt`, replacementBytes: 'replacement\n' }],
      }), /must not target Toolkit backup evidence/);
      assert.equal(hashTree(path.join(root, CANONICAL_BACKUP_DIR)), canonicalBefore);
      assert.equal(hashTree(path.join(root, LEGACY_BACKUP_DIR)), legacyBefore);
    });

    await t.test(`metadata rejects ${backupDirectory}`, () => {
      const root = initRepo('protected-case-metadata');
      const target = path.join(root, 'a.txt');
      write(target, 'old\n');
      const backup = createRepoLocalBackup(root, { operation: 'protected-case-metadata', changes: [{ path: 'a.txt', replacementBytes: 'new\n' }] });
      write(target, 'new\n');
      const metadata = JSON.parse(read(backup.metadata_path));
      metadata.files[0].path = `${backupDirectory}/nested/evidence.txt`;
      write(backup.metadata_path, `${JSON.stringify(metadata, null, 2)}\n`);
      const backupBefore = hashTree(backup.generation_path);
      assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path), /must not target Toolkit backup evidence/);
      assert.deepEqual(read(target), Buffer.from('new\n'));
      assert.equal(hashTree(backup.generation_path), backupBefore);
    });
  }
});

test('transient rollback-temp cleanup retries remain bounded and can succeed', () => {
  const root = initRepo('cleanup-retry');
  const target = path.join(root, 'a.txt');
  write(target, 'old\n');
  const backup = createRepoLocalBackup(root, { operation: 'cleanup-retry', changes: [{ path: 'a.txt', replacementBytes: 'new\n' }] });
  write(target, 'new\n');
  let attempts = 0;
  const result = restoreRepoLocalBackup(root, backup.metadata_path, {
    unlinkFile: (filePath) => {
      if (filePath.includes('.toolkit-rollback-') && attempts < 2) {
        attempts += 1;
        throw transientError('EPERM');
      }
      attempts += 1;
      fs.unlinkSync(filePath);
    },
    waitForCleanupRetry: () => {},
  });
  assert.equal(result.status, 'restored');
  assert.equal(result.temporary_cleanup_complete, true);
  assert.equal(Object.hasOwn(result, 'cleanup_id'), false);
  assert.equal(attempts, 3);
  assert.deepEqual(read(target), Buffer.from('old\n'));
  assert.deepEqual(privateRestoreResidue(root), []);
});

test('cleanup retry exhaustion reports non-success without rolling back restored bytes and supports follow-up cleanup', () => {
  const root = initRepo('cleanup-exhaustion');
  const target = path.join(root, 'a.txt');
  write(target, 'old\r\n');
  const backup = createRepoLocalBackup(root, { operation: 'cleanup-exhaustion', changes: [{ path: 'a.txt', replacementBytes: 'new\n' }] });
  write(target, 'new\n');
  const backupBefore = hashTree(backup.generation_path);
  let attempts = 0;
  const failRollbackUnlink = (filePath) => {
    if (filePath.includes('.toolkit-rollback-')) {
      attempts += 1;
      throw transientError('EBUSY');
    }
    fs.unlinkSync(filePath);
  };
  const result = restoreRepoLocalBackup(root, backup.metadata_path, {
    unlinkFile: failRollbackUnlink,
    waitForCleanupRetry: () => {},
  });
  assert.equal(attempts, 4);
  assert.equal(result.status, 'cleanup-incomplete');
  assert.match(result.cleanup_id, /^[a-f0-9]{24}$/);
  assert.equal(result.restored, true);
  assert.equal(result.temporary_residue_detected, true);
  assert.equal(result.temporary_residue_count, 1);
  assert.deepEqual(read(target), Buffer.from('old\r\n'));
  assert.equal(privateRestoreResidue(root).length, 1);
  assert.equal(hashTree(backup.generation_path), backupBefore);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const previousExitCode = process.exitCode;
  const originalWrite = process.stdout.write;
  let output = '';
  process.exitCode = 0;
  process.stdout.write = (chunk) => { output += chunk; return true; };
  try {
    const cliResult = backupMain(['node', backupScript, 'cleanup', '--repo', root, '--metadata', backup.metadata_path, '--cleanup-id', result.cleanup_id], {
      unlinkFile: failRollbackUnlink,
      waitForCleanupRetry: () => {},
    });
    assert.equal(cliResult.status, 'cleanup-incomplete');
    assert.equal(cliResult.cleanup_id, result.cleanup_id);
    assert.equal(process.exitCode, 2);
    assert.doesNotMatch(output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = previousExitCode;
  }

  const cleanup = cleanupRepoLocalRestoreResidue(root, backup.metadata_path, result.cleanup_id);
  assert.equal(cleanup.status, 'cleanup-complete');
  assert.equal(Object.hasOwn(cleanup, 'cleanup_id'), false);
  assert.deepEqual(privateRestoreResidue(root), []);
  assert.deepEqual(read(target), Buffer.from('old\r\n'));
  assert.equal(hashTree(backup.generation_path), backupBefore);
});

test('cleanup requires the exact opaque ID and never scans same-prefix decoys', () => {
  const root = initRepo('cleanup-exact-id');
  const target = path.join(root, 'a.txt');
  write(target, 'old\r\n');
  const backup = createRepoLocalBackup(root, { operation: 'cleanup-exact-id', changes: [{ path: 'a.txt', replacementBytes: 'new\n' }] });
  write(target, 'new\n');
  const backupBefore = hashTree(backup.generation_path);
  const result = restoreRepoLocalBackup(root, backup.metadata_path, {
    unlinkFile: (filePath) => {
      if (filePath.includes('.toolkit-rollback-')) throw transientError('EBUSY');
      fs.unlinkSync(filePath);
    },
    waitForCleanupRetry: () => {},
  });
  const genuineResidue = rollbackResiduePath(target, backup.generation_path, result.cleanup_id);
  const decoy = `${genuineResidue}-decoy`;
  write(decoy, 'new\n');
  const targetBefore = read(target);

  assert.throws(() => cleanupRepoLocalRestoreResidue(root, backup.metadata_path), /Cleanup ID/);
  assert.throws(() => cleanupRepoLocalRestoreResidue(root, backup.metadata_path, 'ABC'), /Cleanup ID/);
  assert.throws(() => backupMain(['node', backupScript, 'cleanup', '--repo', root, '--metadata', backup.metadata_path]), /Cleanup ID/);
  assert.throws(() => backupMain(['node', backupScript, 'cleanup', '--repo', root, '--metadata', backup.metadata_path, '--cleanup-id', 'ABC']), /Cleanup ID/);
  assert.deepEqual(read(target), targetBefore);
  assert.equal(fs.existsSync(genuineResidue), true);
  assert.equal(fs.existsSync(decoy), true);

  const wrongId = result.cleanup_id === '0'.repeat(24) ? '1'.repeat(24) : '0'.repeat(24);
  const wrong = cleanupRepoLocalRestoreResidue(root, backup.metadata_path, wrongId);
  assert.equal(wrong.status, 'cleanup-not-found');
  assert.equal(Object.hasOwn(wrong, 'cleanup_id'), false);
  assert.equal(fs.existsSync(genuineResidue), true);
  assert.equal(fs.existsSync(decoy), true);

  const previousExitCode = process.exitCode;
  const originalWrite = process.stdout.write;
  process.exitCode = 0;
  process.stdout.write = () => true;
  try {
    const cliWrong = backupMain(['node', backupScript, 'cleanup', '--repo', root, '--metadata', backup.metadata_path, '--cleanup-id', wrongId]);
    assert.equal(cliWrong.status, 'cleanup-not-found');
    assert.equal(process.exitCode, 2);
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = previousExitCode;
  }

  const cleanup = cleanupRepoLocalRestoreResidue(root, backup.metadata_path, result.cleanup_id);
  assert.equal(cleanup.status, 'cleanup-complete');
  assert.equal(fs.existsSync(genuineResidue), false);
  assert.equal(fs.existsSync(decoy), true);
  assert.deepEqual(read(decoy), Buffer.from('new\n'));
  assert.deepEqual(read(target), Buffer.from('old\r\n'));
  assert.equal(hashTree(backup.generation_path), backupBefore);
});

test('cleanup revalidates target and exact candidate immediately before deletion', async (t) => {
  for (const drift of ['target', 'candidate']) await t.test(`${drift} drift`, () => {
    const root = initRepo(`cleanup-${drift}-race`);
    const target = path.join(root, 'a.txt');
    write(target, 'old\r\n');
    const backup = createRepoLocalBackup(root, {
      operation: `cleanup-${drift}-race`,
      changes: [{ path: 'a.txt', replacementBytes: 'new\n' }],
    });
    write(target, 'new\n');
    const backupBefore = hashTree(backup.generation_path);
    const restored = restoreRepoLocalBackup(root, backup.metadata_path, {
      unlinkFile: (filePath) => {
        if (filePath.includes('.toolkit-rollback-')) throw transientError('EBUSY');
        fs.unlinkSync(filePath);
      },
      waitForCleanupRetry: () => {},
    });
    const residue = rollbackResiduePath(target, backup.generation_path, restored.cleanup_id);
    const targetDrift = Buffer.from('concurrent-target\n');
    const candidateDrift = Buffer.from('concurrent-candidate\n');
    const result = cleanupRepoLocalRestoreResidue(root, backup.metadata_path, restored.cleanup_id, {
      beforeCleanupCandidateDelete: () => {
        if (drift === 'target') write(target, targetDrift);
        else write(residue, candidateDrift);
      },
    });
    assert.equal(result.status, 'cleanup-incomplete');
    assert.equal(result.temporary_residue_count, 1);
    assert.equal(result.target_drift_detected, drift === 'target');
    assert.equal(result.candidate_drift_detected, drift === 'candidate');
    assert.equal(result.restored, drift !== 'target');
    assert.equal(fs.existsSync(residue), true);
    assert.deepEqual(read(target), drift === 'target' ? targetDrift : Buffer.from('old\r\n'));
    assert.deepEqual(read(residue), drift === 'candidate' ? candidateDrift : Buffer.from('new\n'));
    assert.equal(hashTree(backup.generation_path), backupBefore);
    assertPathless(result, privatePaths(root));
  });
});

test('restore rejects a pre-existing exact rollback destination before target mutation', () => {
  const root = initRepo('cleanup-preexisting-destination');
  const target = path.join(root, 'a.txt');
  const fixedCleanupId = 'a'.repeat(24);
  write(target, 'old\n');
  const backup = createRepoLocalBackup(root, { operation: 'cleanup-preexisting-destination', changes: [{ path: 'a.txt', replacementBytes: 'new\n' }] });
  write(target, 'new\n');
  const rollbackDestination = rollbackResiduePath(target, backup.generation_path, fixedCleanupId);
  write(rollbackDestination, 'decoy\n');
  const targetBefore = read(target);
  const backupBefore = hashTree(backup.generation_path);

  assert.throws(() => restoreRepoLocalBackup(root, backup.metadata_path, { testCleanupId: fixedCleanupId }), /before any target mutation/);
  assert.deepEqual(read(target), targetBefore);
  assert.deepEqual(read(rollbackDestination), Buffer.from('decoy\n'));
  assert.deepEqual(privateRestoreResidue(root), [path.basename(rollbackDestination)]);
  assert.equal(hashTree(backup.generation_path), backupBefore);
});
