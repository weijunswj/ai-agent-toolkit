'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-project-source-locks.cjs');
const googleLock = 'repo/source-watch/provenance/google-design-md/SOURCE-LOCK.json';
const uiUxLock = 'repo/source-watch/provenance/ui-ux-pro-max/SOURCE-LOCK.json';

function copyRepo() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'source-lock-audit-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !(
        rel === '.git' || rel.startsWith('.git/') ||
        rel === 'node_modules' || rel.startsWith('node_modules/') ||
        rel === '.tmp' || rel.startsWith('.tmp/') ||
        rel === '_dist' || rel.startsWith('_dist/')
      );
    }
  });
  return target;
}

function runAudit(cwd) {
  return spawnSync(process.execPath, [auditScript, '--workspace', cwd], {
    cwd: os.tmpdir(),
    encoding: 'utf8'
  });
}

function readLock(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, googleLock), 'utf8'));
}

function readUiUxLock(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, uiUxLock), 'utf8'));
}

function writeLock(cwd, lock) {
  fs.writeFileSync(path.join(cwd, googleLock), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

test('active source locks reject duplicate source/root/blob mappings', () => {
  const cwd = copyRepo();
  try {
    const lock = readLock(cwd);
    lock.files.push({ ...lock.files.find((entry) => entry.source_path === 'docs/spec.md') });
    writeLock(cwd, lock);

    const result = runAudit(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicate active source\/root\/blob mapping/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('active source locks reject duplicate source/root/blob mappings across locks', () => {
  const cwd = copyRepo();
  try {
    const google = readLock(cwd);
    const uiUx = readUiUxLock(cwd);
    const original = google.files.find((entry) => entry.source_path === 'docs/spec.md');
    uiUx.files.push({ ...original });
    writeLock(cwd, google);
    fs.writeFileSync(path.join(cwd, uiUxLock), `${JSON.stringify(uiUx, null, 2)}\n`, 'utf8');

    const result = runAudit(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicate active source\/root\/blob mapping/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('noncanonical source paths fail closed even without a duplicate', () => {
  const variants = [
    './docs/spec.md',
    'docs//spec.md',
    'docs/./spec.md',
    'docs\\spec.md',
    'docs/sub/../spec.md',
    '/docs/spec.md',
    'C:\\docs\\spec.md'
  ];

  for (const sourcePath of variants) {
    const cwd = copyRepo();
    try {
      const lock = readLock(cwd);
      lock.files.find((entry) => entry.source_path === 'docs/spec.md').source_path = sourcePath;
      writeLock(cwd, lock);

      const result = runAudit(cwd);
      assert.notEqual(result.status, 0, sourcePath);
      assert.match(result.stderr, /source_path .*canonical|source_path .*repo-relative|source_path .*path segments|source_path .*backslashes/, sourcePath);
      assert.doesNotMatch(result.stderr, /duplicate active source\/root\/blob mapping/, sourcePath);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('noncanonical root-surface paths fail closed even without a duplicate', () => {
  const canonicalRoot = 'skills/frontend-art-direction/references/design-md-contract.md';
  const variants = [
    `./${canonicalRoot}`,
    'skills//frontend-art-direction/references/design-md-contract.md',
    'skills/frontend-art-direction/./references/design-md-contract.md',
    'skills\\frontend-art-direction\\references\\design-md-contract.md',
    'skills/frontend-art-direction/references/../references/design-md-contract.md',
    `/${canonicalRoot}`,
    'C:\\skills\\frontend-art-direction\\references\\design-md-contract.md'
  ];

  for (const rootSurfacePath of variants) {
    const cwd = copyRepo();
    try {
      const lock = readLock(cwd);
      lock.files.find((entry) => entry.source_path === 'docs/spec.md').root_surface_path = rootSurfacePath;
      writeLock(cwd, lock);

      const result = runAudit(cwd);
      assert.notEqual(result.status, 0, rootSurfacePath);
      assert.match(result.stderr, /root_surface_path .*canonical|root_surface_path .*repo-relative|root_surface_path .*path segments|root_surface_path .*backslashes/, rootSurfacePath);
      assert.doesNotMatch(result.stderr, /duplicate active source\/root\/blob mapping/, rootSurfacePath);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('noncanonical equivalent source paths cannot bypass duplicate protection', () => {
  const cwd = copyRepo();
  try {
    const lock = readLock(cwd);
    const original = lock.files.find((entry) => entry.source_path === 'docs/spec.md');
    lock.files.push({ ...original, source_path: './docs/spec.md' });
    writeLock(cwd, lock);

    const result = runAudit(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /source_path .*canonical|source_path .*path segments/);
    assert.doesNotMatch(result.stderr, /Project source-lock audit passed/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('active source locks allow one source mapping to different root surfaces', () => {
  const cwd = copyRepo();
  try {
    const lock = readLock(cwd);
    const original = lock.files.find((entry) => entry.source_path === 'docs/spec.md');
    lock.files.push({
      ...original,
      root_surface_path: 'skills/frontend-art-direction/README.md',
      notes: 'Reviewed alternative local adaptation surface for the focused audit fixture.'
    });
    writeLock(cwd, lock);

    const result = runAudit(cwd);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('the two canonical active source locks pass unchanged', () => {
  const cwd = copyRepo();
  try {
    const result = runAudit(cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passed for 2 lock file\(s\)/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
