'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const intendedImplicitSkills = [
  'agent-skill-supply-chain-audit',
  'n8n-agent-rules',
  'toolkit-setup'
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

test('OpenAI invocation policy keeps only safety and setup routers implicit', () => {
  const actualImplicit = skillNames().filter((name) => allowImplicit(name));
  assert.deepEqual(actualImplicit, intendedImplicitSkills);
  assert.equal(allowImplicit('project-completion-audit'), false, 'project-completion-audit must remain explicit-only');
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

test('knowledge-index-updater keeps verbose edge guidance behind references', () => {
  const sourceSkill = readText('_projects/knowledge/knowledge-index-updater/_main/skill/SKILL.md');
  const generatedSkill = readText('skills/knowledge-index-updater/SKILL.md');
  for (const [label, text] of [['source', sourceSkill], ['generated', generatedSkill]]) {
    assert.ok(text.split('\n').length < 420, label + ' knowledge-index-updater SKILL.md should stay progressively disclosed');
    assert.doesNotMatch(text, /^#### Recommended Codex automation prompt$/m);
    assert.doesNotMatch(text, /^#### Static fallback prompt for external schedulers that cannot load skills$/m);
    assert.match(text, /references\/update-confirmation\.md/);
    assert.match(text, /references\/scheduled-updater-prompts\.md/);
  }

  for (const relPath of [
    '_projects/knowledge/knowledge-index-updater/_main/skill/references/update-confirmation.md',
    '_projects/knowledge/knowledge-index-updater/_main/skill/references/scheduled-updater-prompts.md',
    'skills/knowledge-index-updater/references/update-confirmation.md',
    'skills/knowledge-index-updater/references/scheduled-updater-prompts.md'
  ]) {
    assert.ok(fs.existsSync(path.join(repoRoot, relPath)), relPath + ' must be packaged');
  }
});
