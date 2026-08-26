'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');
const legacyProjectToken = '_' + 'projects';
const legacyCuratedToken = 'curated_' + 'output_for_ai';
const publisherReferencePaths = [
  'skills/context-preserving-ai-publisher/references/audit-and-baseline-workflow.md',
  'skills/context-preserving-ai-publisher/references/validation-strategy.md',
  'skills/context-preserving-ai-publisher/templates/project-module/SOURCE-LOCK.template.json',
  'skills/context-preserving-ai-publisher/templates/project-module/toolkit.project.template.json',
  'skills/context-preserving-ai-publisher/templates/repo-docs/project-module-standard.template.md'
];

function readText(relPath, root = repoRoot) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function copyRepo() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-audit-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !(
        rel === '.git' || rel.startsWith('.git/') ||
        rel === 'node_modules' || rel.startsWith('node_modules/') ||
        rel === '.tmp' || rel.startsWith('.tmp/') ||
        rel === '_dist' || rel.startsWith('_dist/')
      );
    }
  });
  return target;
}

function runAudit(cwd, args = []) {
  return spawnSync(process.execPath, [auditScript, '--workspace', cwd, ...args], { cwd: os.tmpdir(), encoding: 'utf8' });
}

function assertFixtureFails(relPath, fixture, messagePattern = /retired|publishing|source ownership|command|conversion/i) {
  const cwd = copyRepo();
  try {
    const target = path.join(cwd, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `\n${fixture}\n`, 'utf8');
    const result = runAudit(cwd, ['--json']);
    assert.notEqual(result.status, 0, fixture);
    assert.match(result.stdout, messagePattern, fixture);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('canonical surface snapshot has no packs, retired skills, or project tree', () => {
  const audit = require(auditScript);
  const snapshot = audit.snapshot();
  assert.equal(snapshot.schema_version, 2);
  assert.equal(snapshot.project_tree_present, false);
  assert.deepEqual(snapshot.pack_manifests, []);
  assert.equal(snapshot.skills.includes('skills/knowledge-index-updater'), false);
  assert.equal(audit.validate(snapshot).length, 0);
});

test('published surface baseline matches the canonical snapshot', () => {
  const result = runAudit(repoRoot, ['--check']);
  assert.equal(result.status, 0, result.stderr);
});

test('audit allows legacy references only in the five preserved publisher files', () => {
  const audit = require(auditScript);
  assert.deepEqual(publisherReferencePaths.filter(audit.legacyReferenceAllowed), publisherReferencePaths);
  for (const relPath of publisherReferencePaths) {
    const text = readText(relPath);
    assert.ok(text.includes(`${legacyProjectToken}/`) || text.includes(`${legacyCuratedToken}/`), relPath);
  }
  assert.equal(audit.legacyReferenceAllowed('skills/context-preserving-ai-publisher/README.md'), false);
  assert.equal(audit.legacyReferenceAllowed('skills/context-preserving-ai-publisher/references/examples.md'), false);
  assert.equal(audit.validate(audit.snapshot()).length, 0);
});

test('audit rejects a newly introduced legacy reference under a canonical surface', () => {
  const cwd = copyRepo();
  fs.writeFileSync(
    path.join(cwd, 'skills', 'n8n-local-setup', 'references', 'legacy-fixture.md'),
    `${legacyProjectToken}/n8n/${legacyCuratedToken}/reference.md\n`,
    'utf8'
  );
  const result = runAudit(cwd, ['--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /references the retired project\/publisher topology/);
});

test('audit rejects a legacy reference in a non-allowlisted publisher file', () => {
  const cwd = copyRepo();
  fs.writeFileSync(
    path.join(cwd, 'skills', 'context-preserving-ai-publisher', 'references', 'legacy-fixture.md'),
    `${legacyProjectToken}/fixture/${legacyCuratedToken}/file.md\n`,
    'utf8'
  );
  const result = runAudit(cwd, ['--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /skills\/context-preserving-ai-publisher\/references\/legacy-fixture\.md references the retired project\/publisher topology/);
});

test('audit rejects new pack manifests and the retired skill surface', () => {
  const cwd = copyRepo();
  const packDir = path.join(cwd, 'skills', 'fixture', 'packs', 'retired');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'pack.json'), '{}\n', 'utf8');
  const retiredSkill = path.join(cwd, 'skills', 'knowledge-index-updater');
  fs.mkdirSync(retiredSkill, { recursive: true });
  fs.writeFileSync(path.join(retiredSkill, 'SKILL.md'), '---\nname: knowledge-index-updater\ndescription: retired fixture\n---\n', 'utf8');
  fs.writeFileSync(path.join(retiredSkill, 'README.md'), '# retired\n', 'utf8');
  const result = runAudit(cwd, ['--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Pack manifests are not supported/);
  assert.match(result.stdout, /Retired skill surface is present/);
});

test('audit rejects a present legacy project tree', () => {
  const cwd = copyRepo();
  fs.mkdirSync(path.join(cwd, legacyProjectToken), { recursive: true });
  const result = runAudit(cwd, ['--check']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`Legacy ${legacyProjectToken}/ tree is present`));
});

test('active topology audit rejects each known positive retired operation', () => {
  const fixtures = [
    `Current Toolkit source ownership is \`${legacyProjectToken}/development/example/README.md\`.`,
    'Create the standalone `_main/` source and maintain it as the active Toolkit input.',
    'Create a Toolkit project module plus published skill for every new skill.',
    'Maintain a published skill from a Toolkit project module for every new skill.',
    'Use toolkit.project.json to generate a published skill for every new skill.',
    'Use the Toolkit project-to-skill source-to-surface publishing workflow for new skills.',
    'Regenerate generated skill copies through deterministic writeback before review.',
    'Run `node repo/scripts/sync-toolkit-projects.cjs --write` after every edit.'
  ];

  for (const fixture of fixtures) {
    const cwd = copyRepo();
    try {
      fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'active-topology-fixture.md'), `${fixture}\n`, 'utf8');
      const result = runAudit(cwd, ['--json']);
      assert.notEqual(result.status, 0, fixture);
      assert.match(result.stdout, /retired|publishing|source ownership|command|creation/i, fixture);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('shared retired-operation detector covers singular, plural, generated, published, and reverse-order skill operations', () => {
  const audit = require(auditScript);
  const fixtures = [
    'Current Toolkit conversions use a project module and a published skill.',
    'Current Toolkit conversions use project modules and published skills.',
    'Current Toolkit conversions use a project module and a generated skill.',
    'Current Toolkit conversions use project modules and generated skills.',
    'Published skills for current Toolkit conversions are maintained from project modules.',
    'Generated skills for this Toolkit are maintained through project modules.'
  ];

  for (const fixture of fixtures) {
    assert.ok(audit.detectRetiredTopologyOperations(fixture).length > 0, fixture);
  }
});

test('publisher entrypoints cannot exempt current Toolkit operations using product vocabulary', () => {
  const fixtures = [
    'This publisher requires current Toolkit conversions to use a project module plus generated skill.',
    'This generic workflow requires current Toolkit conversions to use a project module plus generated skill.',
    'This skill requires current Toolkit conversions to use a project module plus generated skill.',
    'The standalone context-preserving-ai-publisher routes conversions for this Toolkit through a project module plus generated skill.',
    'The standalone context-preserving-ai-publisher requires our Toolkit to use a project module plus generated skill.',
    'The standalone context-preserving-ai-publisher uses project modules and published skills independently of current Toolkit.',
    'The standalone context-preserving-ai-publisher uses project modules and generated skills outside this repository.'
  ];

  for (const fixture of fixtures) {
    assertFixtureFails('skills/context-preserving-ai-publisher/SKILL.md', fixture);
  }
});

test('publisher scope fails closed for reverse order, possessive, and self-repository forms', () => {
  const fixtures = [
    'Our Toolkit uses project modules and generated skills through the standalone context-preserving-ai-publisher.',
    'Published skills for current Toolkit conversions are maintained from project modules.',
    'Generated skills for this Toolkit are maintained through project modules.',
    'For this repository, the standalone context-preserving-ai-publisher maintains project modules and published skills.',
    "The standalone context-preserving-ai-publisher product uses project modules for Toolkit's generated skills."
  ];

  for (const fixture of fixtures) {
    assertFixtureFails('skills/context-preserving-ai-publisher/SKILL.md', fixture);
  }
});

test('active topology audit accepts direct-canonical guidance, retirement statements, and historical evidence', () => {
  const audit = require(auditScript);
  const directCanonical = 'Create new skills directly under `skills/**` and maintain contracts, runtime, tests, and docs directly under `repo/**`.';
  const negativeRetirement = 'The Toolkit does not maintain project publishing or a generic sync command.';
  const historicalEvidence = `## Historical audit evidence\nEarlier Toolkit operation used \`${legacyProjectToken}/example/_main\`, but that is not current operation.`;

  assert.equal(audit.activeTopologyFinding(directCanonical), null);
  assert.equal(audit.activeTopologyFinding(negativeRetirement), null);
  assert.equal(audit.activeTopologyFinding(historicalEvidence), null);

  const cwd = copyRepo();
  try {
    fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'active-topology-fixture.md'), `${directCanonical}\n${negativeRetirement}\n${historicalEvidence}\n`, 'utf8');
    const result = runAudit(cwd, ['--check']);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('active topology audit covers current skill instruction entrypoints and the repository is clean', () => {
  const audit = require(auditScript);
  const activeFiles = audit.activePolicyFiles();
  assert.ok(activeFiles.includes('skills/agent-skill-supply-chain-audit/SKILL.md'));
  assert.ok(activeFiles.includes('skills/agent-skill-supply-chain-audit/README.md'));
  assert.ok(activeFiles.includes('skills/ui-ux-secure-frontend-design/INSTALL.md'));
  for (const relPath of activeFiles) assert.equal(audit.activeTopologyFinding(readText(relPath), relPath), null, relPath);
  assert.equal(audit.validate(audit.snapshot()).length, 0);
});

test('heading vocabulary cannot exempt a following active retired-topology instruction', () => {
  assertFixtureFails(
    'repo/docs/active-topology-heading-fixture.md',
    '## Historical audit evidence\n\nCreate a Toolkit project module plus published skill for current conversions.'
  );
});

test('unrelated negation cannot exempt a separate active retired-topology instruction', () => {
  assertFixtureFails(
    'repo/docs/active-topology-negation-fixture.md',
    'This unrelated setting is not relevant. Create a Toolkit project module plus published skill for current conversions.'
  );
});

test('multiline retired-topology instructions fail closed', () => {
  assertFixtureFails(
    'repo/docs/active-topology-multiline-fixture.md',
    'Create a Toolkit project module plus\npublished skill for current conversions.'
  );
});

test('split command and path wording cannot evade the retired-command check', () => {
  assertFixtureFails(
    'repo/docs/active-topology-split-command-fixture.md',
    'Run `node repo/scripts/\nsync-toolkit-projects.cjs --write` after conversion.'
  );
});

test('current instructions remain forbidden when they also call a route legacy', () => {
  assertFixtureFails(
    'repo/docs/active-topology-current-plus-legacy-fixture.md',
    'The route is legacy, but agents must use the project-to-skill publishing route for current conversions.'
  );
});

test('active non-publisher skill instructions are included in the permanent gate', () => {
  assertFixtureFails(
    'skills/n8n-agent-rules/SKILL.md',
    'Create a Toolkit project module plus published skill for current conversions.'
  );
});

test('nested skill instruction entrypoints are included in the permanent gate', () => {
  assertFixtureFails(
    'skills/n8n-agent-rules/references/active-fixture/SKILL.md',
    'Create a Toolkit project module plus published skill for current conversions.'
  );
});

test('representative supply-chain publisher routing residue fails closed', () => {
  assertFixtureFails(
    'skills/agent-skill-supply-chain-audit/SKILL.md',
    'For approved Toolkit conversions, use context-preserving-ai-publisher as the publisher workflow for the source-to-surface conversion.'
  );
});

test('explicit retirement wording remains valid', () => {
  const cwd = copyRepo();
  try {
    fs.writeFileSync(
      path.join(cwd, 'repo', 'docs', 'active-topology-retirement-fixture.md'),
      `## Audit history\nEarlier Toolkit operation used \`${legacyProjectToken}/example/_main\`, but that route is not current.\n\nThe Toolkit does not maintain project-to-skill publishing or a generic sync command.\n`,
      'utf8'
    );
    const result = runAudit(cwd, ['--check']);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('standalone publisher product material remains valid without broadening legacy references', () => {
  const audit = require(auditScript);
  const publisherSkill = 'skills/context-preserving-ai-publisher/SKILL.md';
  const publisherReadme = 'skills/context-preserving-ai-publisher/README.md';
  const standaloneProductOperation = 'The separate standalone context-preserving-ai-publisher product uses a project module to maintain generated skill outputs for target repositories.';
  assert.notEqual(
    audit.activeTopologyFinding('Create a Toolkit project module plus published skill.', publisherSkill),
    null
  );
  assert.equal(audit.activeTopologyFinding(standaloneProductOperation, publisherSkill), null);
  assert.notEqual(
    audit.activeTopologyFinding(
      'The separate standalone context-preserving-ai-publisher product requires current Toolkit conversions to use a project module plus generated skill.',
      publisherSkill
    ),
    null
  );
  assert.equal(audit.activeTopologyFinding(readText(publisherSkill), publisherSkill), null);
  assert.equal(audit.activeTopologyFinding(readText(publisherReadme), publisherReadme), null);

  const cwd = copyRepo();
  try {
    fs.appendFileSync(
      path.join(cwd, publisherSkill),
      `\n${standaloneProductOperation}\n`,
      'utf8'
    );
    const result = runAudit(cwd, ['--check']);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
