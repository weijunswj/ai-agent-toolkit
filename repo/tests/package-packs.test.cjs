'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'package-packs.cjs');

function tempCopy() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-packs-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !rel.startsWith('.git') && !rel.startsWith('_dist') && !rel.startsWith('node_modules');
    }
  });
  return target;
}

test('every pack has valid pack manifest and existing install paths', () => {
  const skillsRoot = path.join(repoRoot, 'skills');
  const packFiles = [];
  for (const skill of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;
    const packsRoot = path.join(skillsRoot, skill.name, 'packs');
    if (!fs.existsSync(packsRoot)) continue;
    for (const pack of fs.readdirSync(packsRoot, { withFileTypes: true })) {
      const manifest = path.join(packsRoot, pack.name, 'pack.json');
      if (pack.isDirectory() && fs.existsSync(manifest)) packFiles.push(manifest);
    }
  }
  assert.equal(packFiles.length, 5);
  for (const file of packFiles) {
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(pack.requires_approval, true);
    assert.equal(pack.run_commands, false);
    for (const installPath of pack.installs) {
      assert.ok(fs.existsSync(path.join(repoRoot, installPath)), `${file} -> ${installPath}`);
    }
  }
});

test('package-packs --check validates inputs and does not write outputs', () => {
  const cwd = tempCopy();
  const result = spawnSync(process.execPath, [script, '--check'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(cwd, '_dist')), false);
  assert.match(result.stdout, /Pack package check passed/);
});

test('package-packs writes full pack metadata in non-check mode', () => {
  const cwd = tempCopy();
  const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const sourcePack = JSON.parse(fs.readFileSync(path.join(cwd, 'skills', 'secure-cicd-installer', 'packs', 'secure-cicd', 'pack.json'), 'utf8'));
  const packagedPackPath = path.join(cwd, '_dist', 'packs', 'secure-cicd', 'pack.json');
  const installPlanPath = path.join(cwd, '_dist', 'packs', 'secure-cicd', 'install-plan.json');
  assert.equal(fs.existsSync(packagedPackPath), true);
  assert.equal(fs.existsSync(installPlanPath), true);

  const packagedPack = JSON.parse(fs.readFileSync(packagedPackPath, 'utf8'));
  const installPlan = JSON.parse(fs.readFileSync(installPlanPath, 'utf8'));
  for (const generated of [packagedPack, installPlan]) {
    assert.equal(generated.requires_approval, sourcePack.requires_approval);
    assert.equal(generated.run_commands, sourcePack.run_commands);
    assert.deepEqual(generated.writes_allowed, sourcePack.writes_allowed);
    assert.deepEqual(generated.writes_denied, sourcePack.writes_denied);
    assert.equal(generated.risk_level, sourcePack.risk_level);
    assert.deepEqual(generated.notes, sourcePack.notes);
    assert.equal(generated.path, 'skills/secure-cicd-installer/packs/secure-cicd/pack.json');
  }
});
