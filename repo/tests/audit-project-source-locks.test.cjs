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

test('active source locks allow one source mapping to different root surfaces', () => {
  const cwd = copyRepo();
  try {
    const lock = readLock(cwd);
    const original = lock.files.find((entry) => entry.source_path === 'docs/spec.md');
    lock.files.push({
      ...original,
      root_surface_path: 'skills/ui-ux-secure-frontend-design/README.md',
      notes: 'Reviewed alternative local adaptation surface for the focused audit fixture.'
    });
    writeLock(cwd, lock);

    const result = runAudit(cwd);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
