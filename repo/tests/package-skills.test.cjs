'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'package-skills.cjs');

function tempCopy() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-skills-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !rel.startsWith('.git') && !rel.startsWith('_dist') && !rel.startsWith('node_modules');
    }
  });
  return target;
}

test('package-skills --check validates inputs and does not write outputs', () => {
  const cwd = tempCopy();
  const result = spawnSync(process.execPath, [script, '--check'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(cwd, '_dist')), false);
  assert.match(result.stdout, /Skill package check passed/);
});

test('all skill folders have README and SKILL files', () => {
  const skillsRoot = path.join(repoRoot, 'skills');
  const skillDirs = [];
  for (const skill of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (skill.isDirectory()) skillDirs.push(path.join(skillsRoot, skill.name));
  }
  assert.ok(skillDirs.length >= 4);
  for (const dir of skillDirs) {
    assert.ok(fs.existsSync(path.join(dir, 'README.md')), dir);
    assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')), dir);
  }
});
