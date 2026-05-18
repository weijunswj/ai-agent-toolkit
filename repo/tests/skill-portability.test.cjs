'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-skill-portability.cjs');

function tempCopy() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-skill-portability-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      if (!rel) return true;
      return !(
        rel === '.git' ||
        rel.startsWith('.git/') ||
        rel === 'node_modules' ||
        rel.startsWith('node_modules/') ||
        rel === '_dist' ||
        rel.startsWith('_dist/')
      );
    }
  });
  return target;
}

function runAudit(cwd) {
  return spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
}

test('skill portability audit passes the published skill folders', () => {
  const result = runAudit(repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skill portability audit passed for \d+ skill\(s\)/);
});

test('skill portability audit catches missing README and local references', () => {
  const cwd = tempCopy();
  fs.unlinkSync(path.join(cwd, 'skills', 'windows-localhost-workflows', 'README.md'));
  fs.appendFileSync(
    path.join(cwd, 'skills', 'windows-localhost-workflows', 'SKILL.md'),
    '\n\nSee `references/missing.md` before using this skill.\n'
  );
  const result = runAudit(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing README\.md or INSTALL\.md/);
  assert.match(result.stderr, /references missing local file or folder: references\/missing\.md/);
});

test('skill portability audit catches thin link-only skills', () => {
  const cwd = tempCopy();
  const skillDir = path.join(cwd, 'skills', 'thin-link-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'README.md'), '# Thin link skill\n\nCopy this folder.\n');
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: thin-link-skill',
      'description: thin link test skill.',
      '---',
      '',
      '# Thin',
      '',
      'Read https://example.com/a and https://example.com/b. This is required.'
    ].join('\n')
  );
  const result = runAudit(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /extremely thin/);
  assert.match(result.stderr, /multiple external links but no local support folders/);
});
