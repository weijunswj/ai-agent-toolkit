'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

const skillPaths = [
  'skills/secure-ci-cd/SKILL.md'
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
    'automated validation',
    'CI check-up',
    'is CI still up to date'
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
    assert.match(text, /override any repo-local default that would otherwise merge, deploy, push to the default branch or force-push/i, relPath);
    assert.match(
      text,
      /Before merging, deploying, pushing to the default branch, force-pushing, deleting, or changing real keys or secrets, pause, explain the risk, name the exact target and action, and ask for explicit user approval for that exact action/i,
      relPath
    );
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
    /Create or update `docs\/ci-cd\/CURRENT_CICD_STATUS\.md`/i,
    /Commit, push a non-default branch and open or update its PR without asking; ask a clear approval question before a merge \(where a merge guard is known to run, its question is that ask\), deployment, default-branch or force push, delete, or real-key change/i,
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
  const prompt = readText('skills/secure-ci-cd/templates/cicd/secure-cicd-prompt.md');

  const requiredPromptSafeguards = [
    /verify access and repo state before changing anything/i,
    /before any direct push to the default branch or force-push you must pause, name the branch and remote, explain the risk, and ask for my approval/i,
    /Before merging, you must pause, name the pull request, explain what will happen, and ask for my approval/i,
    /Before deploying, you must pause, name the environment and deployment target, explain the risk, and ask for my approval/i,
    /Security preflight scan before setup/i,
    /If secrets or risky credentials are found during preflight:[\s\S]*?Stop setup immediately/i,
    /Create or update `?docs\/ci-cd\/CURRENT_CICD_STATUS\.md`?/i,
    /check whether the repo already has a CI\/CD, deployment, operations, or status document under `docs\/`/i,
    /Pause before deployment planning/i,
    /After I approve the deployment plan/i,
    /Never ask me to paste real secret values into this chat/i
  ];

  for (const safeguard of requiredPromptSafeguards) {
    assert.match(prompt, safeguard);
  }
});

// The skill once asked before every commit, push and pull request, against Git Completion and the
// owner's standing OK for reversible steps; merges, deploys, default-branch or force pushes, deletes
// and real keys keep their ask.
test('Secure CI/CD runs reversible Git steps without asking and keeps the ask for irreversible ones', () => {
  const surfaces = [
    'skills/secure-ci-cd/SKILL.md',
    'skills/secure-ci-cd/references/secure-ci-cd.md',
    'skills/secure-ci-cd/templates/cicd/secure-cicd-prompt.md',
    'skills/secure-ci-cd/templates/cicd/ci-checkup.md',
    'repo/docs/SKILL-SAFETY-MATRIX.md'
  ];
  const overStrict = [
    /before (commit|committing)\b[^.\n]*\b(push|pushing)\b/i,
    /before committing you must pause/i,
    /Before pushing, you must pause/i,
    /ask me whether to (commit|push)/i,
    /ask me before creating it/i,
    /ask before (pushing|commit)/i,
    /for commit, push, pull request creation/i,
    /approval required before commit/i,
    /in control of commits/i,
    /auto-commit, push, open a pull request/i
  ];
  for (const relPath of surfaces) {
    const text = readText(relPath);
    for (const pattern of overStrict) assert.doesNotMatch(text, pattern, `${relPath}: ${pattern}`);
  }
  const keepsAsk = {
    'skills/secure-ci-cd/references/secure-ci-cd.md': /Before merging, deploying, pushing to the default branch, force-pushing or deleting, pause, name the exact target and action, explain the risk, and ask for explicit approval/,
    'skills/secure-ci-cd/templates/cicd/secure-cicd-prompt.md': /For merge, deploy, default-branch push, force-push, delete or secret actions, pause first, name the exact target\/action, explain the risk, and ask for my approval/,
    'skills/secure-ci-cd/templates/cicd/ci-checkup.md': /ask before merge or deploy where the repository has no standing approval/,
    'repo/docs/SKILL-SAFETY-MATRIX.md': /explicit approval required before merge, deploy, default-branch or force push, delete, settings, secret, release, or other external mutation/
  };
  // A push to a non-default branch whose workflow deploys outside the approved plan is a deploy, so it keeps the ask.
  const prompt = readText('skills/secure-ci-cd/templates/cicd/secure-cicd-prompt.md');
  assert.match(prompt, /11\. Push only to a non-default branch; ask before any default-branch push or any push whose workflow deploys outside the approved plan\./);
  assert.match(prompt, /5\. Push a setup branch without asking; ask for the default branch \(step 3\) or when a workflow from step 4 deploys outside the approved plan\./);
  for (const [relPath, pattern] of Object.entries(keepsAsk)) assert.match(readText(relPath), pattern, relPath);
});
