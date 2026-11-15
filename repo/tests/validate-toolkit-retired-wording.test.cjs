'use strict';

// validate-toolkit.cjs on copied workspaces: retired-operation wording in Skill Creation review
// fields and validation commands. Split from validate-toolkit-topology.test.cjs so each file stays
// well inside its time budget on Windows, where every copied workspace is slow.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  repoRoot,
  skillCreationOperationalFreeTextFields,
  sharedRetiredOperationVariants,
  copyRepo,
  runValidate,
  validateEachCopy,
  updateBaseline,
} = require('./validate-toolkit-test-support.cjs');

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
