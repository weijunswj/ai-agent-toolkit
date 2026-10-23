'use strict';

// validate-toolkit.cjs on copied workspaces: Skill Creation Center review evidence, routing examples,
// the migration ledger, root surfaces and plugin versions. Split from validate-toolkit.test.cjs so the
// copied-workspace cases run in parallel files.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  validateScript,
  readText,
  copyRepo,
  runValidate,
  addCurrentSkill,
  addSkillToCatalogs,
  updateBaseline,
  updateMigrationLedger,
} = require('./validate-toolkit-test-support.cjs');

test('validator rejects a current skill without direct-canonical review evidence', () => {
  const cwd = copyRepo();
  const baselinePath = path.join(cwd, 'repo', 'docs', 'skill-creation-center-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  delete baseline.skill_creation_review['managed-app-foundation-review'];
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing skill_creation_review evidence for current skill managed-app-foundation-review/);
});

test('validator rejects native-creator or manually added current skills without keyed evidence', () => {
  const cwd = copyRepo();
  try {
    addCurrentSkill(cwd, 'fixture-current-skill');
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing skill_creation_review evidence for current skill fixture-current-skill/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator still rejects a catalogued current skill without review evidence', () => {
  const cwd = copyRepo();
  try {
    addCurrentSkill(cwd, 'fixture-catalogued-skill');
    addSkillToCatalogs(cwd, 'fixture-catalogued-skill');
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing skill_creation_review evidence for current skill fixture-catalogued-skill/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects obsolete grandfathered_skill_ids authority', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => { baseline.grandfathered_skill_ids = ['zz-exempt-skill']; });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not contain obsolete or exemption authority field grandfathered_skill_ids/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects obsolete reviewed_skill_ids duplicate authority', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => { baseline.reviewed_skill_ids = Object.keys(baseline.skill_creation_review); });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not contain obsolete or exemption authority field reviewed_skill_ids/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects stale non-current keyed review evidence', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['stale-non-current-skill'] = {
        ...baseline.skill_creation_review['managed-app-foundation-review'],
        public_id: 'stale-non-current-skill'
      };
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /contains stale skill_creation_review evidence for non-current skill stale-non-current-skill/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects a missing required keyed evidence field', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => { delete baseline.skill_creation_review['managed-app-foundation-review'].native_capability_review; });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skill_creation_review\.managed-app-foundation-review must contain the complete exact schema-v3 evidence fields/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects empty required keyed evidence', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => { baseline.skill_creation_review['managed-app-foundation-review'].trigger = ' '; });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skill_creation_review\.managed-app-foundation-review\.trigger must be a non-empty evidence string/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator requires three positive routing examples', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => { baseline.skill_creation_review['managed-app-foundation-review'].positive_routing_examples.length = 2; });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /positive_routing_examples must contain at least three non-empty routing examples/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator requires three near-neighbour negative routing examples', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => { baseline.skill_creation_review['managed-app-foundation-review'].negative_routing_examples.length = 2; });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /negative_routing_examples must contain at least three non-empty routing examples/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator requires overlap or companion boundary evidence', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => { baseline.skill_creation_review['managed-app-foundation-review'].overlap_boundary = ''; });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /overlap_boundary must be a non-empty evidence string/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects keyed and durable public ID mismatch', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => { baseline.skill_creation_review['managed-app-foundation-review'].public_id = 'another-current-product'; });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /public_id must equal its keyed product ID/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('valid append-only portfolio migration ledger passes', () => {
  const validator = require(validateScript);
  const ledger = JSON.parse(readText('repo/contracts/skill-product-migration-ledger.json'));
  assert.equal(ledger.lifecycle, 'transitional_until_s2_closure_review');
  assert.deepEqual(ledger.transitions.map((entry) => entry.transition_id), [
    'knowledge-index-updater-removal',
    'skill-product-review-merge',
    'repository-agent-rules-rename',
    'github-program-reconciler-rename',
    'local-ai-safety-rename',
    'n8n-safety-router-rename',
    'n8n-environment-setup-rename',
    'n8n-workflow-transport-rename',
    'release-readiness-audit-rename',
    'secure-ci-cd-rename',
    'frontend-art-direction-rename',
    'windows-local-dev-services-rename',
    'n8n-workflow-templates-removal'
  ]);
  assert.deepEqual(validator.validate(), []);
});

test('validator rejects malformed migration ledger structure', () => {
  const cwd = copyRepo();
  try {
    updateMigrationLedger(cwd, (ledger) => { ledger.transitions = {}; });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /transitions must be an array/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects duplicate predecessor ownership across migration entries', () => {
  const cwd = copyRepo();
  try {
    updateMigrationLedger(cwd, (ledger) => {
      ledger.transitions.push({
        ...ledger.transitions[0],
        sequence: 2,
        transition_id: 'duplicate-knowledge-removal'
      });
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /predecessor knowledge-index-updater is ambiguously claimed/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects unsupported migration disposition', () => {
  const cwd = copyRepo();
  try {
    updateMigrationLedger(cwd, (ledger) => { ledger.transitions[0].disposition = 'split'; });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /disposition must be rename, merge, or remove/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects a migration predecessor that is still a current product', () => {
  const cwd = copyRepo();
  try {
    updateMigrationLedger(cwd, (ledger) => { ledger.transitions[0].predecessor_ids = ['managed-app-foundation-review']; });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /historical predecessor managed-app-foundation-review is still a current product/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('migration ledger cannot make an unevidenced current skill valid', () => {
  const cwd = copyRepo();
  try {
    addCurrentSkill(cwd, 'fixture-ledger-only-skill');
    updateMigrationLedger(cwd, (ledger) => {
      ledger.transitions.push({
        sequence: 2,
        transition_id: 'fixture-ledger-only-removal',
        predecessor_ids: ['fixture-ledger-only-skill'],
        successor_ids: [],
        disposition: 'remove',
        content_disposition: 'deleted',
        authority: 'Fixture authority that cannot satisfy current creation evidence.',
        reason: 'Fixture proves historical migration data is not current-product authority.'
      });
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing skill_creation_review evidence for current skill fixture-ledger-only-skill/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects a special root MEMORY.md surface', () => {
  const cwd = copyRepo();
  fs.writeFileSync(path.join(cwd, 'MEMORY.md'), '# fixture\n', 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected root entry: MEMORY\.md/);
});

test('validator detects stale plugin package versions', () => {
  const cwd = copyRepo();
  const manifestPath = path.join(cwd, '.codex-plugin', 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = '0.0.0';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version does not match/);
});
