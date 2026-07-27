'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const projectPath = '_projects/development/issue-governance/toolkit.project.json';

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function outputPaths(root) {
  const project = JSON.parse(fs.readFileSync(path.join(root, projectPath), 'utf8'));
  const values = project.outputs.map(function(output) {
    const relative = output.output.replace(/\\/g, '/');
    assert.equal(path.isAbsolute(relative), false);
    const parts = relative.split('/');
    assert.equal(parts.some(function(part) { return part === '' || part === '.' || part === '..'; }), false);
    assert.equal(relative.startsWith('skills/issue-governance/'), true);
    return relative;
  });
  assert.equal(new Set(values).size, values.length);
  return values.sort();
}

function snapshot(root, outputs) {
  return Object.fromEntries(outputs.map(function(relative) {
    const file = path.join(root, ...relative.split('/'));
    assert.equal(fs.statSync(file).isFile(), true);
    return [relative, hash(file)];
  }));
}

test('issue-governance generated surface parity is isolated, exact and idempotent', function() {
  const outputs = outputPaths(repoRoot);
  const before = snapshot(repoRoot, outputs);
  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-governance-generated-parity-'));
  const isolated = path.join(tempParent, 'repository');
  try {
    fs.cpSync(repoRoot, isolated, {
      recursive: true,
      filter: function(source) {
        const relative = path.relative(repoRoot, source);
        return relative === '' || (!relative.startsWith('.git') && !relative.startsWith('node_modules') && !relative.startsWith('_dist'));
      }
    });
    const command = path.join(isolated, 'repo', 'scripts', 'sync-toolkit-projects.cjs');
    const first = spawnSync(process.execPath, [command, '--write'], { cwd: isolated, encoding: 'utf8', timeout: 60000 });
    assert.equal(first.status, 0, first.stderr);
    const firstSnapshot = snapshot(isolated, outputs);
    const second = spawnSync(process.execPath, [command, '--write'], { cwd: isolated, encoding: 'utf8', timeout: 60000 });
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(snapshot(isolated, outputs), firstSnapshot);
    const published = [];
    const visit = function(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile()) published.push(path.relative(isolated, absolute).replace(/\\/g, '/'));
      }
    };
    visit(path.join(isolated, 'skills', 'issue-governance'));
    assert.deepEqual(published.sort(), outputs);
    assert.deepEqual(firstSnapshot, before);
    assert.deepEqual(snapshot(repoRoot, outputs), before);
  } finally {
    fs.rmSync(tempParent, { recursive: true, force: true });
  }
});
