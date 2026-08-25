'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillRoot = path.join(repoRoot, 'skills', 'n8n-local-setup');
const legacyProjectToken = '_' + 'projects';
const legacyCuratedToken = 'curated_' + 'output_for_ai';
const legacyTopologyPattern = new RegExp(`${legacyProjectToken}|${legacyCuratedToken}`);

function read(relPath) {
  return fs.readFileSync(path.join(skillRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function exists(relPath) {
  return fs.existsSync(path.join(skillRoot, relPath));
}

test('n8n local setup is a self-contained direct skill surface', () => {
  assert.equal(exists('SKILL.md'), true);
  assert.equal(exists('README.md'), true);
  assert.equal(exists('agents/openai.yaml'), true);
  assert.match(read('SKILL.md'), /^name: n8n-local-setup$/m);
  assert.match(read('SKILL.md'), /repo\/source-watch\/provenance\//);
  assert.match(read('SKILL.md'), /repo\/contracts\//);
  assert.doesNotMatch(read('SKILL.md'), legacyTopologyPattern);
});

test('n8n local setup retains the required local and production templates', () => {
  for (const relPath of [
    'templates/.n8n-local/docker-compose.yml',
    'templates/.n8n-local/.env.example',
    'templates/.n8n-local/_n8n-local.cmd',
    'templates/.n8n-local/scripts/n8n-local-menu.ps1',
    'templates/.n8n-production-cloudflare/docker-compose.yml',
    'templates/.n8n-production-cloudflare/.env.example',
    'templates/.n8n-production-cloudflare/_n8n-production-cloudflare.cmd',
    'templates/.n8n-production-cloudflare/scripts/n8n-production-cloudflare-menu.ps1',
    'templates/production-server-backups/README.md',
    'templates/production-server-backups/n8n-production-backup.sh.template',
    'templates/mcp-configs/README.md',
    'templates/mcp-configs/codex-mcp-config.md',
    'templates/mcp-configs/claude-mcp-config.md',
    'templates/mcp-configs/opencode-mcp-config.md',
    'templates/mcp-configs/antigravity-mcp-config.md'
  ]) assert.equal(exists(relPath), true, relPath);
});

test('n8n local setup retains its canonical runtime references and safety boundary', () => {
  for (const relPath of [
    'references/n8n/README.md',
    'references/n8n/local-setup.md',
    'references/n8n/hostinger-vps.md',
    'references/n8n/production-cloudflare-tunnel.md',
    'references/ai-agent-platforms/README.md',
    'references/ai-agent-platforms/codex.md',
    'references/ai-agent-platforms/claude-code.md',
    'references/ai-agent-platforms/opencode.md',
    'references/ai-agent-platforms/antigravity.md',
    'references/ai-agent-platforms/chatgpt-web.md',
    'references/ai-agent-platforms/claude-web.md'
  ]) {
    const text = read(relPath);
    assert.doesNotMatch(text, legacyTopologyPattern);
    assert.doesNotMatch(text, /(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,})/);
  }
  const skill = read('SKILL.md');
  const rulesAdapter = fs.readFileSync(path.join(repoRoot, 'skills', 'n8n-agent-rules', 'adapters', 'AGENTS.n8n-brief.template.md'), 'utf8');
  assert.match(rulesAdapter, /Do not run live n8n, Docker, import\/export, sync, activation, execution, publish\/unpublish, credential, deployment, or production actions without explicit current-turn approval/i);
  assert.match(skill, /Keep tokens, API keys, webhook secrets, tunnel tokens, `.env` values/i);
});

test('n8n local setup has no retired pack manifest or project-module output', () => {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(skillRoot, full).replace(/\\/g, '/'));
    }
  }
  walk(skillRoot);
  assert.equal(files.some((relPath) => relPath.endsWith('/pack.json') || relPath === 'pack.json'), false);
  assert.equal(files.some((relPath) => relPath.includes(legacyProjectToken) || relPath.includes(legacyCuratedToken)), false);
});
