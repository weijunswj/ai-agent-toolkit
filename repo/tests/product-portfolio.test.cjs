'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const expectedProducts = [
  'codex-ssh-hostinger-coolify-setup-maintainer',
  'frontend-art-direction',
  'github-program-reconciler',
  'local-ai-safety',
  'managed-app-foundation-review',
  'n8n-environment-setup',
  'n8n-safety-router',
  'n8n-workflow-transport',
  'release-readiness-audit',
  'repository-agent-rules',
  'secure-ci-cd',
  'self-hosted-service-safety',
  'skill-product-review',
  'toolkit-setup',
  'windows-local-dev-services'
];
const predecessorIds = [
  'agent-skill-supply-chain-audit',
  'ai-coding-agent-rules',
  'context-preserving-ai-publisher',
  'github-governance-review-reconciler',
  'local-ai-stack-safety',
  'n8n-agent-rules',
  'n8n-local-setup',
  'n8n-workflow-helper-scripts',
  'n8n-workflow-templates',
  'project-completion-audit',
  'secure-cicd-installer',
  'ui-ux-secure-frontend-design',
  'windows-localhost-workflows'
];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function currentProducts() {
  return fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(root, 'skills', id, 'SKILL.md')))
    .sort();
}

test('active portfolio is exactly the approved 15 products', () => {
  assert.deepEqual(currentProducts(), expectedProducts);
  assert.equal(fs.existsSync(path.join(root, 'skills', 'n8n-workflow-templates')), false);
  assert.equal(fs.existsSync(path.join(root, 'skills', 'context-preserving-ai-publisher')), false);
});

test('active public routing and install surfaces contain no predecessor resolution', () => {
  const surfaces = [
    '.gitattributes',
    'README.md',
    'repo/contracts/agent-rules/toolkit-skill-routing.md',
    'repo/contracts/source-of-truth-contract.md',
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/HOW-TO-USE.md',
    'repo/docs/SKILL-SAFETY-MATRIX.md'
  ];
  for (const product of expectedProducts) {
    for (const relPath of ['SKILL.md', 'README.md', 'agents/openai.yaml']) {
      const candidate = `skills/${product}/${relPath}`;
      if (fs.existsSync(path.join(root, candidate))) surfaces.push(candidate);
    }
  }

  for (const relPath of surfaces) {
    const text = read(relPath).replaceAll('toolkit-github-program-reconciler.cjs', 'E3_INTERNAL_RUNTIME');
    for (const predecessor of predecessorIds) {
      assert.equal(text.includes(predecessor), false, `${relPath} resolves retired product ${predecessor}`);
    }
  }
});

test('migration ledger records the complete atomic portfolio transition', () => {
  const ledger = JSON.parse(read('repo/contracts/skill-product-migration-ledger.json'));
  const portfolioTransitions = ledger.transitions.slice(1);
  const predecessors = portfolioTransitions.flatMap((entry) => entry.predecessor_ids).sort();

  assert.equal(portfolioTransitions.length, 12);
  assert.deepEqual(predecessors, predecessorIds);
  assert.equal(portfolioTransitions.filter((entry) => entry.disposition === 'merge').length, 1);
  assert.equal(portfolioTransitions.filter((entry) => entry.disposition === 'rename').length, 10);
  assert.equal(portfolioTransitions.filter((entry) => entry.disposition === 'remove').length, 1);
  assert.equal(
    portfolioTransitions.find((entry) => entry.transition_id === 'n8n-workflow-templates-removal').content_disposition,
    'fixture-only'
  );
});

test('repository agent rules carry the binding shipping law through managed surfaces', () => {
  const surfaces = [
    'repo/contracts/agent-rules/ai-coding-agent-execution.md',
    'repo/contracts/agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/repository-agent-rules/repo-local/AGENTS.managed.template.md',
    'AGENTS.md'
  ];
  for (const relPath of surfaces) {
    const text = read(relPath);
    assert.match(text, /COMPLETE THE BASICS -> SHIP -> OBSERVE -> IMPROVE/, relPath);
    assert.match(text, /`SHIP_BLOCKER` or `POST_SHIP`/, relPath);
    assert.match(text, /Shipping bias never bypasses mutation or deployment authority/, relPath);
    assert.match(text, /Perfection is not completion/, relPath);
  }
});
