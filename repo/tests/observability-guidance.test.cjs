'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

test('Secure CI/CD surfaces require privacy-safe deployment and AI observability', () => {
  for (const relPath of [
    '_projects/cicd/secure-installer/_main/README.md',
    'skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md',
    '_projects/cicd/secure-installer/curated_output_for_ai/templates/cicd/CURRENT_CICD_STATUS.template.md',
    'skills/secure-cicd-installer/templates/cicd/CURRENT_CICD_STATUS.template.md',
    'skills/secure-cicd-installer/SKILL.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /privacy-safe/i, relPath);
    assert.match(text, /metadata-only/i, relPath);
    assert.match(text, /PASS\/WARN\/FAIL/, relPath);
    assert.match(text, /AI attempt ledger/i, relPath);
    assert.match(text, /failure taxonomy/i, relPath);
    assert.match(text, /output-shape/i, relPath);
    assert.match(text, /raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data/i, relPath);
    assert.match(text, /provider calls, notification tests, production mutations, (?:(?:or|and) )?auto-remediation/i, relPath);
  }
});

test('self-hosted and managed app skills include metadata-only AI observability baseline', () => {
  for (const relPath of [
    '_projects/development/self-hosted-service-safety/_main/skill/SKILL.md',
    'skills/self-hosted-service-safety/SKILL.md',
    '_projects/development/managed-app-foundation-review/_main/skill/SKILL.md',
    'skills/managed-app-foundation-review/SKILL.md'
  ]) {
    const text = readText(relPath);
    assert.match(text, /privacy-safe/i, relPath);
    assert.match(text, /metadata-only/i, relPath);
    assert.match(text, /PASS\/WARN\/FAIL/, relPath);
    assert.match(text, /AI (?:attempt ledger|modules?)/i, relPath);
    assert.match(text, /failure taxonomy/i, relPath);
    assert.match(text, /output-shape/i, relPath);
    assert.match(text, /raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data/i, relPath);
    assert.match(text, /provider calls, notification tests, production mutations, (?:(?:or|and) )?auto-remediation/i, relPath);
  }
});
