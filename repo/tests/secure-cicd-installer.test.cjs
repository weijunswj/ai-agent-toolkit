'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

const skillPaths = [
  '_projects/cicd/secure-installer/curated_output_for_ai/skills/secure-cicd-installer/SKILL.md',
  'skills/secure-cicd-installer/SKILL.md'
];

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function frontmatterDescription(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'SKILL.md frontmatter description exists');
  const description = match[1].match(/^description:\s*(.+)$/m);
  assert.ok(description, 'SKILL.md frontmatter description exists');
  return description[1];
}

function assertIncludesAll(text, terms, context) {
  for (const term of terms) {
    assert.match(text, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${context}: ${term}`);
  }
}

test('Secure CI/CD source and generated skills expose broad trigger metadata', () => {
  const requiredTriggerTerms = [
    'CI/CD',
    'GitHub Actions',
    'workflows',
    'pipelines',
    'deployment automation',
    'build/test automation',
    'security checks',
    'secret scanning',
    'required checks',
    'branch protection',
    'automated validation'
  ];

  for (const relPath of skillPaths) {
    const description = frontmatterDescription(readText(relPath));
    assertIncludesAll(description, requiredTriggerTerms, relPath);
  }
});

test('Secure CI/CD source and generated skills route to the canonical prompt procedure', () => {
  for (const relPath of skillPaths) {
    const text = readText(relPath);

    assert.match(text, /^## Canonical Procedure$/m, relPath);
    assert.match(
      text,
      /read and follow \[`templates\/cicd\/secure-cicd-prompt\.md`\]\(templates\/cicd\/secure-cicd-prompt\.md\)/i,
      relPath
    );
    assert.match(
      text,
      /Keep \[`templates\/cicd\/secure-cicd-prompt\.md`\]\(templates\/cicd\/secure-cicd-prompt\.md\) loaded/i,
      relPath
    );
    assert.match(text, /not optional background material/i, relPath);
  }
});

test('Secure CI/CD source and generated skills enforce approval gate precedence', () => {
  for (const relPath of skillPaths) {
    const text = readText(relPath);

    assert.match(text, /^## Approval Gate Precedence$/m, relPath);
    assert.match(text, /override any repo-local default.*auto-commit, push, open a pull request, merge, or deploy/is, relPath);
    assert.match(text, /Do not commit, push, create a pull request, merge, or deploy without explicit user approval/i, relPath);
  }
});

test('Secure CI/CD source and generated skills summarize required safe execution shape', () => {
  const requiredExecutionRules = [
    /Inspect the target repo before editing/i,
    /Verify repo access\/state before changes/i,
    /Scan for risky files and secrets before setup/i,
    /Stop if secrets or risky credentials are found/i,
    /Report risky file paths\/status only; never print secret values/i,
    /Prefer CI first; keep deployment disabled unless explicitly approved/i,
    /Run security checks before lint, tests, build, package, or deploy/i,
    /Use GitHub Secrets for private values/i,
    /Never ask the user to paste secret values into chat/i,
    /Create or update `CURRENT_CICD_STATUS\.md`/i,
    /Ask before commit, push, PR creation, merge, or deployment/i,
    /beginner-friendly GitHub Secret setup instructions using secret names only/i,
    /Tell the user where to paste values directly in GitHub or the external platform/i
  ];

  for (const relPath of skillPaths) {
    const text = readText(relPath);
    for (const rule of requiredExecutionRules) {
      assert.match(text, rule, relPath);
    }
    assert.doesNotMatch(text, /MCP spec:/i, `${relPath} should not list an MCP spec as an AI-facing surface`);
  }
});

test('Secure CI/CD canonical prompt still carries the core setup safeguards', () => {
  const prompt = readText('skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md');

  const requiredPromptSafeguards = [
    /verify access and repo state before changing anything/i,
    /must not commit until I approve/i,
    /must not push until I approve/i,
    /must not deploy until I approve/i,
    /Security preflight scan before setup/i,
    /If secrets or risky credentials are found during preflight:[\s\S]*?Stop setup immediately/i,
    /Create or update CURRENT_CICD_STATUS\.md/i,
    /Do not enable deployment automatically/i,
    /After I approve the deployment plan/i,
    /Never ask me to paste real secret values into this chat/i
  ];

  for (const safeguard of requiredPromptSafeguards) {
    assert.match(prompt, safeguard);
  }
});
