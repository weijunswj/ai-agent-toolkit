'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const syncScript = path.join(repoRoot, 'repo', 'scripts', 'sync-toolkit-projects.cjs');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');

const restoredReferences = [
  {
    source: '_main/1. local setup.md',
    output: 'skills/n8n-local-setup/references/n8n/local-setup.md'
  },
  {
    source: '_main/2. upgrading.md',
    output: 'skills/n8n-local-setup/references/n8n/upgrading.md'
  },
  {
    source: '_main/3. tunneling guide.md',
    output: 'skills/n8n-local-setup/references/n8n/tunnelling.md'
  },
  {
    source: '_main/3a. docker compose + ngrok.md',
    output: 'skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md'
  },
  {
    source: '_main/4. vps hosting.md',
    output: 'skills/n8n-local-setup/references/n8n/vps-hosting.md'
  },
  {
    source: '_main/5. extra - claude code integration.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md'
  },
  {
    source: '_main/6. extra - opencode integration.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md'
  },
  {
    source: '_main/7. extra - antigravity integration.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md'
  }
];

function tempCopy() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-fidelity-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !rel.startsWith('.git') && !rel.startsWith('_dist') && !rel.startsWith('node_modules');
    }
  });
  return target;
}

function readText(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function stripGeneratedNotices(text) {
  let remaining = text.trimStart();
  while (remaining.startsWith('<!--')) {
    const end = remaining.indexOf('-->');
    assert.notEqual(end, -1, 'generated notice close marker');
    remaining = remaining.slice(end + '-->'.length).trimStart();
  }
  return remaining.trimEnd() + '\n';
}

function localSetupManifest(root = repoRoot) {
  return JSON.parse(readText(root, '_projects/n8n/local-setup/toolkit.project.json'));
}

function auditJson(root = repoRoot) {
  const result = spawnSync(process.execPath, [auditScript, '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('n8n local setup restored references are declared copy outputs', () => {
  const manifest = localSetupManifest();
  for (const expected of restoredReferences) {
    const output = manifest.outputs.find((entry) => entry.output === expected.output);
    assert.ok(output, expected.output);
    assert.equal(output.kind, 'copy', expected.output);
    assert.equal(output.source, expected.source, expected.output);
    assert.equal(output.fidelity, 'exact', expected.output);
    assert.ok(manifest.writes.allowed.includes(expected.output), expected.output);
  }
});

test('n8n local setup restored references preserve full source guide bodies', () => {
  for (const expected of restoredReferences) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const output = stripGeneratedNotices(readText(repoRoot, expected.output));
    assert.equal(output, source, expected.output);
  }
});

test('n8n local setup pack-installed references are declared by project recipes', () => {
  const report = auditJson();
  const unresolved = report.issues.packInstalledUndeclared
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-local-setup/'));
  assert.deepEqual(unresolved, []);
});

test('codex n8n local pack installs local setup link shims', () => {
  const pack = JSON.parse(readText(repoRoot, 'skills/n8n-local-setup/packs/codex-n8n-local/pack.json'));
  for (const expectedPath of [
    'skills/n8n-local-setup/references/n8n/1. local setup.md',
    'skills/n8n-local-setup/references/n8n/3. tunneling guide.md',
    'skills/n8n-local-setup/references/n8n/3a. docker compose + ngrok.md',
    'skills/n8n-local-setup/references/n8n/4. vps hosting.md',
    'skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md',
    'skills/n8n-local-setup/references/n8n/templates/AGENTS.md',
    'skills/n8n-local-setup/references/n8n/templates/codex-mcp-config.md',
    'skills/n8n-local-setup/references/n8n/vps-hosting.md'
  ]) {
    assert.ok(pack.installs.includes(expectedPath), expectedPath);
  }
});

test('claude n8n local pack installs Claude guide link shims', () => {
  const pack = JSON.parse(readText(repoRoot, 'skills/n8n-local-setup/packs/claude-code-n8n-local/pack.json'));
  for (const expectedPath of [
    'skills/n8n-local-setup/references/ai-agent-platforms/1. local setup.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/templates/CLAUDE.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/templates/claude-mcp-config.md'
  ]) {
    assert.ok(pack.installs.includes(expectedPath), expectedPath);
  }
});

test('n8n local setup suspicious published surface findings are resolved', () => {
  const report = auditJson();
  const unresolved = report.issues.suspiciousPublishedSurfaces
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-local-setup/'));
  assert.deepEqual(unresolved, []);
});

test('changing a preserved n8n local setup source guide makes sync check fail stale', () => {
  const cwd = tempCopy();
  fs.appendFileSync(path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', '2. upgrading.md'), '\nStale output regression fixture.\n', 'utf8');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/references\/n8n\/upgrading\.md/);
});

test('published surface baseline check passes after n8n local setup fidelity restoration', () => {
  const result = spawnSync(process.execPath, [auditScript, '--check'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
