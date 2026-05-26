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

const localStackTemplates = [
  {
    source: '_main/templates/local-stack/docker-compose.yml',
    output: 'skills/n8n-local-setup/templates/local-stack/docker-compose.yml'
  },
  {
    source: '_main/templates/local-stack/.env.example',
    output: 'skills/n8n-local-setup/templates/local-stack/.env.example'
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

function applyTextRewrites(text, output) {
  let rewritten = text;
  for (const rewrite of output.text_rewrites || []) {
    rewritten = rewritten.split(rewrite.from).join(rewrite.to);
  }
  return rewritten;
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

test('n8n local setup stack templates are declared exact copy outputs', () => {
  const manifest = localSetupManifest();
  for (const expected of localStackTemplates) {
    const output = manifest.outputs.find((entry) => entry.output === expected.output);
    assert.ok(output, expected.output);
    assert.equal(output.kind, 'copy', expected.output);
    assert.equal(output.source, expected.source, expected.output);
    assert.equal(output.fidelity, 'exact', expected.output);
    assert.ok(manifest.writes.allowed.includes(expected.output), expected.output);
  }
});

test('n8n local setup restored references preserve full source guide bodies', () => {
  const manifest = localSetupManifest();
  for (const expected of restoredReferences) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const recipe = manifest.outputs.find((entry) => entry.output === expected.output);
    const output = stripGeneratedNotices(readText(repoRoot, expected.output));
    assert.equal(output, applyTextRewrites(source, recipe), expected.output);
  }
});

test('n8n local setup stack templates preserve placeholder-only source bodies', () => {
  for (const expected of localStackTemplates) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const output = readText(repoRoot, expected.output);
    assert.equal(output, source, expected.output);
  }
});

test('n8n local setup docs present one Docker Compose Fast Path', () => {
  const mainReadme = readText(repoRoot, '_projects/n8n/local-setup/_main/README.md');
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/1. local setup.md');
  const tunnelling = readText(repoRoot, '_projects/n8n/local-setup/_main/3. tunneling guide.md');
  const composeGuide = readText(repoRoot, '_projects/n8n/local-setup/_main/3a. docker compose + ngrok.md');
  const combined = [mainReadme, localSetup, tunnelling, composeGuide].join('\n');

  assert.match(mainReadme, /## Fast Path/);
  assert.match(localSetup, /## Fast Path/);
  assert.match(combined, /Docker Compose/);
  assert.match(combined, /n8n/);
  assert.match(combined, /Postgres/);
  assert.match(combined, /ngrok/);
  assert.match(combined, /ngrok is the only supported local tunnel path/i);
  assert.match(combined, /The local Postgres service is only n8n's internal runtime database/);
  assert.match(combined, /not Vercel/);
  assert.match(combined, /not Supabase/);
  assert.match(combined, /does not connect to the user's app database|must not connect to the user's app database/);
  assert.match(combined, /Advanced Queue Mode/);
  assert.match(combined, /Redis queues? (execution )?jobs/i);
  assert.match(combined, /worker containers run executions/i);
  assert.match(combined, /Do not add Redis or workers to the default local setup|Do not add Redis or workers to the Fast Path/);
  assert.match(combined, /Never commit `\.env`, credentials, runtime payloads, `\.n8n-local\/`, `\.tmp\/`, or live n8n imports\/exports/);

  assert.doesNotMatch(combined, /Path A - Cloudflare/i);
  assert.doesNotMatch(combined, /Path C - n8n built-in tunnel/i);
  assert.doesNotMatch(combined, /Use \*\*Cloudflare Quick Tunnel\*\* when/i);
  assert.doesNotMatch(combined, /Use \*\*n8n built-in tunnel\*\* when/i);
  assert.doesNotMatch(combined, /ngrok\.exe/);
});

test('n8n local setup compose template uses n8n postgres ngrok without default queue services', () => {
  const compose = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/docker-compose.yml');
  assert.match(compose, /^\s{2}postgres:/m);
  assert.match(compose, /^\s{2}n8n:/m);
  assert.match(compose, /^\s{2}ngrok:/m);
  assert.match(compose, /postgres:16-alpine/);
  assert.match(compose, /docker\.n8n\.io\/n8nio\/n8n:stable/);
  assert.match(compose, /ngrok\/ngrok:latest/);
  assert.match(compose, /DB_TYPE: postgresdb/);
  assert.match(compose, /"127\.0\.0\.1:5678:5678"/);
  assert.match(compose, /"127\.0\.0\.1:4040:4040"/);
  assert.match(compose, /^\s{2}postgres_data:/m);
  assert.match(compose, /^\s{2}n8n_data:/m);
  assert.doesNotMatch(compose, /^\s{2}redis:/m);
  assert.doesNotMatch(compose, /^\s{2}n8n-worker:/m);
  assert.doesNotMatch(compose, /EXECUTIONS_MODE:\s*queue/);
});

test('n8n local setup env example stays placeholder-only', () => {
  const envExample = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/.env.example');
  for (const expected of [
    'POSTGRES_DB=n8n',
    'POSTGRES_USER=n8n',
    'POSTGRES_PASSWORD=replace-with-local-postgres-password',
    'N8N_ENCRYPTION_KEY=replace-with-long-random-value',
    'N8N_HOST=your-reserved-domain.ngrok.app',
    'N8N_PROTOCOL=https',
    'WEBHOOK_URL=https://your-reserved-domain.ngrok.app/',
    'N8N_PROXY_HOPS=1',
    'NGROK_AUTHTOKEN=replace-with-ngrok-authtoken',
    'NGROK_DOMAIN=your-reserved-domain.ngrok.app'
  ]) {
    assert.match(envExample, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(envExample, /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(envExample, /n8n_[A-Za-z0-9_-]{20,}/);
});

test('n8n copied setup references use portable published baseline template links', () => {
  for (const relPath of [
    'skills/n8n-local-setup/references/n8n/local-setup.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md'
  ]) {
    const text = readText(repoRoot, relPath);
    assert.doesNotMatch(text, /\/_projects\/development\/ai-coding-agent-rules\/_main\//, relPath);
    assert.doesNotMatch(text, /\.\.\/\.\.\/\.\.\/development\/ai-coding-agent-rules\/_main\//, relPath);
  }

  assert.match(readText(repoRoot, 'skills/n8n-local-setup/references/n8n/local-setup.md'), /\.\.\/\.\.\/\.\.\/ai-coding-agent-rules\/AGENTS\.template\.md/);
  assert.match(
    readText(repoRoot, 'skills/n8n-local-setup/references/ai-agent-platforms/codex.md'),
    /\[skills\/ai-coding-agent-rules\/AGENTS\.template\.md\]\(\.\.\/\.\.\/\.\.\/ai-coding-agent-rules\/AGENTS\.template\.md\)/
  );
  assert.match(readText(repoRoot, 'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md'), /\.\.\/\.\.\/\.\.\/ai-coding-agent-rules\/CLAUDE\.template\.md/);
  assert.match(readText(repoRoot, 'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md'), /\.\.\/\.\.\/\.\.\/ai-coding-agent-rules\/AGENTS\.template\.md/);
  assert.match(readText(repoRoot, 'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md'), /\.\.\/\.\.\/\.\.\/ai-coding-agent-rules\/GEMINI\.template\.md/);
});

test('n8n local setup pack-installed references are declared by project recipes', () => {
  const report = auditJson();
  const unresolved = report.issues.packInstalledUndeclared
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-local-setup/'));
  assert.deepEqual(unresolved, []);
});

test('codex n8n local pack installs inert generic template and n8n-agent-rules assets', () => {
  const pack = JSON.parse(readText(repoRoot, 'skills/n8n-local-setup/packs/codex-n8n-local/pack.json'));
  for (const expectedPath of [
    'skills/n8n-local-setup/references/n8n/1. local setup.md',
    'skills/n8n-local-setup/references/n8n/3. tunneling guide.md',
    'skills/n8n-local-setup/references/n8n/3a. docker compose + ngrok.md',
    'skills/n8n-local-setup/references/n8n/4. vps hosting.md',
    'skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md',
    'skills/n8n-local-setup/references/n8n/templates/codex-mcp-config.md',
    'skills/n8n-local-setup/templates/local-stack/docker-compose.yml',
    'skills/n8n-local-setup/templates/local-stack/.env.example',
    'skills/ai-coding-agent-rules/AGENTS.template.md',
    'skills/n8n-agent-rules/SKILL.md',
    'skills/n8n-agent-rules/README.md',
    'skills/n8n-agent-rules/n8n-agent-rules.md',
    'skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md',
    'skills/n8n-agent-rules/scripts/install-n8n-agent-adapter.cjs',
    'skills/n8n-local-setup/references/n8n-agent-rules.md',
    'skills/n8n-local-setup/references/n8n/vps-hosting.md'
  ]) {
    assert.ok(pack.installs.includes(expectedPath), expectedPath);
  }
});

test('claude n8n local pack installs inert generic template and n8n-agent-rules assets', () => {
  const pack = JSON.parse(readText(repoRoot, 'skills/n8n-local-setup/packs/claude-code-n8n-local/pack.json'));
  for (const expectedPath of [
    'skills/n8n-local-setup/references/ai-agent-platforms/1. local setup.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/templates/claude-mcp-config.md',
    'skills/n8n-local-setup/templates/local-stack/docker-compose.yml',
    'skills/n8n-local-setup/templates/local-stack/.env.example',
    'skills/ai-coding-agent-rules/CLAUDE.template.md',
    'skills/n8n-agent-rules/SKILL.md',
    'skills/n8n-agent-rules/README.md',
    'skills/n8n-agent-rules/n8n-agent-rules.md',
    'skills/n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md',
    'skills/n8n-agent-rules/scripts/install-n8n-agent-adapter.cjs',
    'skills/n8n-local-setup/references/n8n-agent-rules.md'
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
