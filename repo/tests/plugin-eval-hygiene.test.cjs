'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const intendedImplicitSkills = [
  'frontend-art-direction',
  'github-program-reconciler',
  'local-ai-safety',
  'managed-app-foundation-review',
  'n8n-environment-setup',
  'n8n-safety-router',
  'n8n-workflow-transport',
  'repository-agent-rules',
  'secure-ci-cd',
  'self-hosted-service-safety',
  'skill-product-review',
  'toolkit-setup',
  'windows-local-dev-services'
];

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function skillNames() {
  return fs.readdirSync(path.join(repoRoot, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(repoRoot, 'skills', name, 'SKILL.md')))
    .sort();
}

function allowImplicit(skillName) {
  const relPath = path.join('skills', skillName, 'agents', 'openai.yaml');
  const fullPath = path.join(repoRoot, relPath);
  assert.ok(fs.existsSync(fullPath), relPath + ' must exist so packaged OpenAI invocation policy is explicit');
  const text = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
  const match = text.match(/^\s*allow_implicit_invocation:\s*(true|false)\s*$/m);
  assert.ok(match, relPath + ' must declare allow_implicit_invocation');
  return match[1] === 'true';
}

test('OpenAI skill metadata declares Codex product surface for plugin grouping', () => {
  for (const skillName of skillNames()) {
    const relPath = path.join('skills', skillName, 'agents', 'openai.yaml');
    const text = readText(relPath);
    assert.match(text, /^\s*products:\s*$/m, relPath + ' must declare policy.products');
    assert.match(text, /^\s*-\s*codex\s*$/m, relPath + ' must include codex in policy.products');
  }
});

test('OpenAI invocation policy matches the behaviourally admitted 13-product implicit set', () => {
  const actualImplicit = skillNames().filter((name) => allowImplicit(name));
  assert.deepEqual(actualImplicit, intendedImplicitSkills);
  for (const skillName of [
    'codex-ssh-hostinger-coolify-setup-maintainer',
    'release-readiness-audit'
  ]) {
    assert.equal(allowImplicit(skillName), false, `${skillName} must remain explicit-only`);
  }
});

test('native plugin default prompts stay within Plugin Eval starter budget', () => {
  for (const relPath of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    const manifest = readJson(relPath);
    assert.equal(manifest.name, 'ai-agent-toolkit', relPath + ' keeps the stable plugin id even inside versioned install cache folders');
    const prompts = manifest.interface?.defaultPrompt;
    assert.ok(Array.isArray(prompts), relPath + ' interface.defaultPrompt must be an array');
    assert.equal(prompts.length, 3, relPath + ' should expose exactly three strong starter prompts');
    assert.ok(prompts.some((prompt) => /setup toolkit/i.test(prompt)), relPath + ' includes setup toolkit starter');
    assert.ok(prompts.some((prompt) => /refresh toolkit/i.test(prompt)), relPath + ' includes refresh toolkit starter');
    assert.ok(prompts.some((prompt) => /audit the local toolkit bridge state/i.test(prompt)), relPath + ' includes bridge audit starter');
  }
});
