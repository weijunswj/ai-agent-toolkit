'use strict';

// validate-toolkit.cjs on copied workspaces: validation targets, the retired project and publisher
// topology, retired-operation wording and enum fields. Split from validate-toolkit.test.cjs so the
// copied-workspace cases run in parallel files.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  repoRoot,
  legacyProjectToken,
  legacyCuratedToken,
  skillCreationOperationalFreeTextFields,
  sharedRetiredOperationVariants,
  copyRepo,
  runValidate,
  validateEachCopy,
  updateBaseline,
  updateTopologyPolicy,
} = require('./validate-toolkit-test-support.cjs');

test('validator rejects noncanonical or missing validation targets in copied workspaces', async () => {
  const cases = [
    ['missing canonical target', 'node --test repo/tests/does-not-exist.test.cjs', /missing current target/],
    ['Windows backslash target', String.raw`node --test repo\tests\skill-routing.test.cjs`, /noncanonical repository target spelling/],
    ['dot-prefixed target', 'node --test ./repo/tests/skill-routing.test.cjs', /noncanonical repository target spelling/],
    ['repeated separator target', 'node --test repo//tests/skill-routing.test.cjs', /noncanonical repository target spelling/],
    ['traversal target', 'node --test repo/tests/../tests/skill-routing.test.cjs', /noncanonical repository target spelling/],
    ['absolute POSIX target', 'node --test /repo/tests/skill-routing.test.cjs', /noncanonical repository target spelling/],
    ['Windows drive target', String.raw`node --test C:\repo\tests\skill-routing.test.cjs`, /noncanonical repository target spelling/]
  ];

  const results = await validateEachCopy(cases, (cwd, [, command]) => {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['github-program-reconciler'].validation.push(command);
    });
  });
  for (const { item: [label, , expected], result } of results) {
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, expected, label);
  }
});

test('validator rejects a cross-class normalized policy alias collision', () => {
  const cwd = copyRepo();
  try {
    updateTopologyPolicy(cwd, (policy) => {
      policy.standalone_identity_definitions[2].aliases.push('project_module');
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicates normalized alias from primitive_definitions\.retired-project-module/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('Skill Creation and published-surface consumers share the retired topology atom detector', async () => {
  const audit = require(path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs'));
  for (const variant of sharedRetiredOperationVariants) {
    assert.ok(audit.detectRetiredTopologyAtoms(variant).length > 0, variant);
  }

  const results = await validateEachCopy(sharedRetiredOperationVariants, (cwd, variant) => {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['github-program-reconciler'].existing_skill_review += ` ${variant}`;
    });
  });
  for (const { item: variant, result } of results) {
    assert.notEqual(result.status, 0, variant);
    assert.match(result.stderr, /skill_creation_review\.github-program-reconciler\.existing_skill_review/, variant);
  }
});

test('validator rejects the shared retired operation in every applicable operational free-text field', async () => {
  const injection = 'Current Toolkit conversions use project modules and published skills.';
  const results = await validateEachCopy(skillCreationOperationalFreeTextFields, (cwd, field) => {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['github-program-reconciler'][field] += ` ${injection}`;
    });
  });
  for (const { item: field, result } of results) {
    assert.notEqual(result.status, 0, field);
    assert.match(result.stderr, new RegExp(`skill_creation_review\\.github-program-reconciler\\.${field}`), field);
  }
});

test('validator rejects shared retired-operation variants in validation commands', async () => {
  const results = await validateEachCopy(sharedRetiredOperationVariants, (cwd, variant) => {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['github-program-reconciler'].validation.push(`node --test repo/tests/skill-routing.test.cjs ${variant}`);
    });
  });
  for (const { item: variant, result } of results) {
    assert.notEqual(result.status, 0, variant);
    assert.match(result.stderr, /skill_creation_review\.github-program-reconciler\.validation command/, variant);
  }
});

test('Skill Creation operational evidence does not exempt historical retired-operation wording', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['github-program-reconciler'].overlap_boundary += ' Earlier Toolkit operation used project modules and published skills, but that route is not current.';
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skill_creation_review\.github-program-reconciler\.overlap_boundary/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('closed Skill Creation enum fields remain enum-validated', () => {
  for (const [field, expected] of [
    ['decision', /decision must be retain_current_product or new_product/],
    ['source_provenance', /source_provenance is invalid/]
  ]) {
    const cwd = copyRepo();
    try {
      updateBaseline(cwd, (baseline) => {
        baseline.skill_creation_review['github-program-reconciler'][field] = sharedRetiredOperationVariants[0];
      });
      const result = runValidate(cwd);
      assert.notEqual(result.status, 0, field);
      assert.match(result.stderr, expected, field);
      assert.doesNotMatch(result.stderr, new RegExp(`skill_creation_review\\.github-program-reconciler\\.${field} .*retired`, 'i'), field);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('validator rejects a legacy project tree in a copied workspace', () => {
  const cwd = copyRepo();
  fs.mkdirSync(path.join(cwd, legacyProjectToken), { recursive: true });
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`Legacy ${legacyProjectToken}/ tree must not exist`));
});

test('validator rejects retired skills and pack manifests', () => {
  const cwd = copyRepo();
  const retiredSkill = path.join(cwd, 'skills', 'knowledge-index-updater');
  fs.mkdirSync(retiredSkill, { recursive: true });
  fs.writeFileSync(path.join(retiredSkill, 'SKILL.md'), '---\nname: knowledge-index-updater\ndescription: retired fixture\n---\n', 'utf8');
  fs.writeFileSync(path.join(retiredSkill, 'README.md'), '# retired\n', 'utf8');
  const packDir = path.join(cwd, 'skills', 'fixture', 'packs', 'old');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'pack.json'), '{}\n', 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Retired skill surface is present/);
  assert.match(result.stderr, /Pack manifests are not supported/);
});

test('validator rejects legacy publisher references in canonical files', () => {
  const cwd = copyRepo();
  const target = path.join(cwd, 'repo', 'contracts', 'legacy-reference-fixture.md');
  fs.writeFileSync(target, `${legacyProjectToken}/fixture/${legacyCuratedToken}/file.md\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references the retired project\/publisher topology/);
});

test('validator rejects legacy publisher references in ordinary canonical skills', () => {
  const cwd = copyRepo();
  const target = path.join(cwd, 'skills', 'n8n-environment-setup', 'references', 'legacy-reference-fixture.md');
  fs.writeFileSync(target, `${legacyProjectToken}/fixture/${legacyCuratedToken}/file.md\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references the retired project\/publisher topology/);
});

test('validator rejects legacy references in a non-allowlisted publisher file', () => {
  const cwd = copyRepo();
  const target = path.join(cwd, 'skills', 'skill-product-review', 'references', 'legacy-fixture.md');
  fs.writeFileSync(target, `${legacyProjectToken}/fixture/${legacyCuratedToken}/file.md\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references the retired project\/publisher topology/);
});

test('validator rejects a deleted sync command in current review validation evidence', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['github-program-reconciler'].validation.push('node repo/scripts/sync-toolkit-projects.cjs --check');
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retired-sync-toolkit-projects-command/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects current canonical ownership using a project _main source', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['local-ai-safety'].canonical_ownership += ` Active source: ${legacyProjectToken}/local/_main/SKILL.md.`;
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retired-projects-source-root/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects curated deterministic publication claims in current ownership evidence', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['managed-app-foundation-review'].canonical_ownership += ` Current workflow publishes ${legacyCuratedToken} through generated deterministic publication.`;
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retired-curated-output-root/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects a retired source-to-surface claim without direct-canonical ownership', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['toolkit-setup'].canonical_ownership = 'context-preserving-ai-publisher source-to-surface publisher workflow for the current skill.';
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must state direct-canonical maintenance/);
    assert.match(result.stderr, /retired-source-to-surface/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
