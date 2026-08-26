'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const validateScript = path.join(repoRoot, 'repo', 'scripts', 'validate-toolkit.cjs');
const legacyProjectToken = '_' + 'projects';
const legacyCuratedToken = 'curated_' + 'output_for_ai';
const publisherReferencePaths = [
  'skills/context-preserving-ai-publisher/references/audit-and-baseline-workflow.md',
  'skills/context-preserving-ai-publisher/references/validation-strategy.md',
  'skills/context-preserving-ai-publisher/templates/project-module/SOURCE-LOCK.template.json',
  'skills/context-preserving-ai-publisher/templates/project-module/toolkit.project.template.json',
  'skills/context-preserving-ai-publisher/templates/repo-docs/project-module-standard.template.md'
];
const immutableGrandfatheredSkillIds = [
  'agent-skill-supply-chain-audit',
  'ai-coding-agent-rules',
  'context-preserving-ai-publisher',
  'knowledge-index-updater',
  'n8n-agent-rules',
  'n8n-local-setup',
  'n8n-workflow-helper-scripts',
  'n8n-workflow-templates',
  'secure-cicd-installer',
  'ui-ux-secure-frontend-design',
  'windows-localhost-workflows'
];
const currentPostGateSkillIds = [
  'codex-ssh-hostinger-coolify-setup-maintainer',
  'github-governance-review-reconciler',
  'local-ai-stack-safety',
  'managed-app-foundation-review',
  'project-completion-audit',
  'self-hosted-service-safety',
  'toolkit-setup'
];
const skillCreationOperationalFreeTextFields = [
  'existing_skill_review',
  'trigger',
  'decision_reason',
  'unique_value',
  'runtime_footprint',
  'local_assets',
  'output_contract',
  'anti_bloat_review',
  'safety_boundary',
  'third_party_audit',
  'publisher_workflow',
  'routing'
];
const sharedRetiredOperationVariants = [
  'Current Toolkit conversions use project modules and published skills.',
  'Current Toolkit conversions use project modules and generated skills.',
  'Current Toolkit conversions use a project module and published skills.',
  'Current Toolkit conversions use project modules and a published skill.',
  'Published skills for current Toolkit conversions are maintained from project modules.',
  'Generated skills for this Toolkit are maintained through project modules.'
];

function readText(relPath, root = repoRoot) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function copyRepo() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-validate-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !(
        rel === '.git' || rel.startsWith('.git/') ||
        rel === 'node_modules' || rel.startsWith('node_modules/') ||
        rel === '.tmp' || rel.startsWith('.tmp/') ||
        rel === '.n8n-local' || rel.startsWith('.n8n-local/') ||
        rel === '.n8n-workflow-backups' || rel.startsWith('.n8n-workflow-backups/') ||
        rel === '_dist' || rel.startsWith('_dist/')
      );
    }
  });
  return target;
}

function runValidate(cwd) {
  return spawnSync(process.execPath, [validateScript], { cwd, encoding: 'utf8' });
}

function addCurrentSkill(cwd, skillName) {
  const skillDir = path.join(cwd, 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${skillName}\ndescription: Fixture current skill for gate testing.\n---\n\n# Fixture\n`, 'utf8');
  fs.writeFileSync(path.join(skillDir, 'README.md'), `# ${skillName}\n`, 'utf8');
}

function insertBefore(filePath, marker, content) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(text.includes(marker), `${filePath} must contain ${marker}`);
  fs.writeFileSync(filePath, text.replace(marker, `${content}${marker}`), 'utf8');
}

function addSkillToCatalogs(cwd, skillName) {
  insertBefore(
    path.join(cwd, 'repo', 'contracts', 'agent-rules', 'toolkit-skill-routing.md'),
    '\n## Routing Maintenance',
    `| \`${skillName}\` | Fixture route used to prove current-skill gate enforcement. |\n`
  );

  insertBefore(
    path.join(cwd, 'README.md'),
    '\n## Install Skills By Platform',
    `| [${skillName}](skills/${skillName}/) | Fixture catalog entry used to prove current-skill gate enforcement. |\n`
  );

  const matrixPath = path.join(cwd, 'repo', 'docs', 'SKILL-SAFETY-MATRIX.md');
  const matrix = fs.readFileSync(matrixPath, 'utf8').replace(/\r\n/g, '\n');
  const sourceRow = matrix.split('\n').find((line) => line.startsWith('| [managed-app-foundation-review]'));
  assert.ok(sourceRow, 'skill safety matrix fixture source row');
  const fixtureRow = sourceRow
    .replace('[managed-app-foundation-review](../../skills/managed-app-foundation-review/)', `[${skillName}](../../skills/${skillName}/)`)
    .replace('managed-app-foundation-review', skillName);
  insertBefore(matrixPath, '\n## Description Review Notes', `${fixtureRow}\n`);
}

function updateBaseline(cwd, mutate) {
  const baselinePath = path.join(cwd, 'repo', 'docs', 'skill-creation-center-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  mutate(baseline);
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

test('direct canonical topology validates without retired project or MCP surfaces', () => {
  const validator = require(validateScript);
  assert.equal(fs.existsSync(path.join(repoRoot, legacyProjectToken)), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'mcp')), false);
  assert.equal(validator.skillDirs().includes('skills/knowledge-index-updater'), false);
  assert.deepEqual(validator.validate(), []);
});

test('skill routing and safety coverage match the direct skill surface', () => {
  const validator = require(validateScript);
  const skills = validator.skillDirs().map((relPath) => path.basename(relPath)).sort();
  const routing = validator.parseSkillRouting(readText('repo/contracts/agent-rules/toolkit-skill-routing.md'));
  assert.deepEqual([...routing.routed, ...routing.omitted.map((entry) => entry.name)].sort(), skills);
  assert.equal(routing.omitted.some((entry) => entry.name === 'knowledge-index-updater'), false);
  assert.equal(new Set(skills).size, skills.length);
});

test('Skill Creation Center preserves grandfathered IDs and keyed post-gate evidence', () => {
  const baseline = JSON.parse(readText('repo/docs/skill-creation-center-baseline.json'));
  const validator = require(validateScript);
  const current = validator.skillDirs().map((relPath) => path.basename(relPath)).sort();
  const grandfathered = new Set(baseline.grandfathered_skill_ids);
  const reviewed = new Set(Object.keys(baseline.skill_creation_review));

  assert.equal(baseline.schema_version, 2);
  assert.deepEqual(baseline.grandfathered_skill_ids, immutableGrandfatheredSkillIds);
  assert.deepEqual(validator.IMMUTABLE_GRANDFATHERED_SKILL_IDS, immutableGrandfatheredSkillIds);
  assert.equal(grandfathered.has('knowledge-index-updater'), true);
  assert.equal(reviewed.has('knowledge-index-updater'), false);
  assert.deepEqual(current.filter((skill) => !grandfathered.has(skill)).sort(), [...reviewed].sort());
  assert.deepEqual(validator.validate(), []);
});

test('all seven current post-gate reviews use direct-canonical evidence and existing checks', () => {
  const baseline = JSON.parse(readText('repo/docs/skill-creation-center-baseline.json'));
  const validator = require(validateScript);
  assert.deepEqual(baseline.reviewed_skill_ids, currentPostGateSkillIds);
  assert.deepEqual(Object.keys(baseline.skill_creation_review).sort(), [...currentPostGateSkillIds].sort());

  for (const skill of currentPostGateSkillIds) {
    const review = baseline.skill_creation_review[skill];
    assert.match(review.publisher_workflow, /direct-canonical/i);
    assert.match(review.publisher_workflow, new RegExp(`skills/${skill}/`));
    assert.match(review.publisher_workflow, /repo\/\*\*/);
    assert.doesNotMatch(JSON.stringify({ publisher_workflow: review.publisher_workflow, validation: review.validation }), new RegExp(`sync-toolkit-projects\\.cjs|_projects[\\/]|${legacyCuratedToken}|_main|source[- ]to[- ]surface|(?:generated|deterministic)[\\s\\S]*(?:copy|publication|writeback)`, 'i'));
    assert.ok(review.validation.some((command) => /^node\s+repo\/scripts\/validate-toolkit\.cjs(?:\s|$)/.test(command)));
    for (const command of review.validation) {
      for (const target of validator.validationCommandTargets(command)) {
        assert.equal(fs.statSync(path.join(repoRoot, target)).isFile(), true, `${skill}: ${target}`);
      }
    }
  }
  assert.deepEqual(validator.validate(), []);
});

test('validation command parser accepts quoted canonical targets and ordinary options', () => {
  const validator = require(validateScript);
  const command = 'node --test "repo/tests/skill-routing.test.cjs" --test-name-pattern "direct canonical" --workspace repo/scripts/validate-toolkit.cjs';
  assert.deepEqual(validator.validationCommandTargets(command), [
    'repo/tests/skill-routing.test.cjs',
    'repo/scripts/validate-toolkit.cjs'
  ]);
  assert.equal(validator.validationCommandTargetFinding(command), null);
});

test('validator rejects noncanonical or missing validation targets in copied workspaces', () => {
  const cases = [
    ['missing canonical target', 'node --test repo/tests/does-not-exist.test.cjs', /missing current target/],
    ['Windows backslash target', String.raw`node --test repo\tests\skill-routing.test.cjs`, /noncanonical repository target spelling/],
    ['dot-prefixed target', 'node --test ./repo/tests/skill-routing.test.cjs', /noncanonical repository target spelling/],
    ['repeated separator target', 'node --test repo//tests/skill-routing.test.cjs', /noncanonical repository target spelling/],
    ['traversal target', 'node --test repo/tests/../tests/skill-routing.test.cjs', /noncanonical repository target spelling/],
    ['absolute POSIX target', 'node --test /repo/tests/skill-routing.test.cjs', /noncanonical repository target spelling/],
    ['Windows drive target', String.raw`node --test C:\repo\tests\skill-routing.test.cjs`, /noncanonical repository target spelling/]
  ];

  for (const [label, command, expected] of cases) {
    const cwd = copyRepo();
    try {
      updateBaseline(cwd, (baseline) => {
        baseline.skill_creation_review['github-governance-review-reconciler'].validation.push(command);
      });
      const result = runValidate(cwd);
      assert.notEqual(result.status, 0, label);
      assert.match(result.stderr, expected, label);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('Skill Creation and published-surface consumers share the retired-operation detector', () => {
  const audit = require(path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs'));
  for (const variant of sharedRetiredOperationVariants) {
    assert.ok(audit.detectRetiredTopologyOperations(variant).length > 0, variant);
  }

  for (const variant of sharedRetiredOperationVariants) {
    const cwd = copyRepo();
    try {
      updateBaseline(cwd, (baseline) => {
        baseline.skill_creation_review['github-governance-review-reconciler'].existing_skill_review += ` ${variant}`;
      });
      const result = runValidate(cwd);
      assert.notEqual(result.status, 0, variant);
      assert.match(result.stderr, /skill_creation_review\.github-governance-review-reconciler\.existing_skill_review/, variant);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('validator rejects the shared retired operation in every applicable operational free-text field', () => {
  const injection = 'Current Toolkit conversions use project modules and published skills.';
  for (const field of skillCreationOperationalFreeTextFields) {
    const cwd = copyRepo();
    try {
      updateBaseline(cwd, (baseline) => {
        baseline.skill_creation_review['github-governance-review-reconciler'][field] += ` ${injection}`;
      });
      const result = runValidate(cwd);
      assert.notEqual(result.status, 0, field);
      assert.match(result.stderr, new RegExp(`skill_creation_review\\.github-governance-review-reconciler\\.${field}`), field);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('validator rejects shared retired-operation variants in validation commands', () => {
  for (const variant of sharedRetiredOperationVariants) {
    const cwd = copyRepo();
    try {
      updateBaseline(cwd, (baseline) => {
        baseline.skill_creation_review['github-governance-review-reconciler'].validation.push(`node --test repo/tests/skill-routing.test.cjs ${variant}`);
      });
      const result = runValidate(cwd);
      assert.notEqual(result.status, 0, variant);
      assert.match(result.stderr, /skill_creation_review\.github-governance-review-reconciler\.validation command/, variant);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('Skill Creation operational evidence does not exempt historical retired-operation wording', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['github-governance-review-reconciler'].routing += ' Earlier Toolkit operation used project modules and published skills, but that route is not current.';
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skill_creation_review\.github-governance-review-reconciler\.routing/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('closed Skill Creation enum fields remain enum-validated', () => {
  for (const [field, expected] of [
    ['decision', /decision must be extend_existing_skill or new_project_skill/],
    ['source_provenance', /source_provenance is invalid/]
  ]) {
    const cwd = copyRepo();
    try {
      updateBaseline(cwd, (baseline) => {
        baseline.skill_creation_review['github-governance-review-reconciler'][field] = sharedRetiredOperationVariants[0];
      });
      const result = runValidate(cwd);
      assert.notEqual(result.status, 0, field);
      assert.match(result.stderr, expected, field);
      assert.doesNotMatch(result.stderr, new RegExp(`skill_creation_review\\.github-governance-review-reconciler\\.${field} .*retired`, 'i'), field);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('validator shares the exact five-file publisher reference allowlist', () => {
  const validator = require(validateScript);
  const audit = require(path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs'));
  assert.deepEqual(publisherReferencePaths.filter(audit.legacyReferenceAllowed), publisherReferencePaths);
  assert.equal(audit.legacyReferenceAllowed('skills/context-preserving-ai-publisher/README.md'), false);
  assert.deepEqual(validator.validate(), []);
});

test('source locks are discovered only from canonical source-watch provenance', () => {
  const audit = require(path.join(repoRoot, 'repo', 'scripts', 'audit-project-source-locks.cjs'));
  const result = audit.auditSourceLocks();
  assert.deepEqual(result.errors, []);
  assert.equal(result.locks.length, 2);
  assert.ok(result.locks.every((relPath) => relPath.startsWith('repo/source-watch/provenance/')));
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
  const target = path.join(cwd, 'skills', 'n8n-local-setup', 'references', 'legacy-reference-fixture.md');
  fs.writeFileSync(target, `${legacyProjectToken}/fixture/${legacyCuratedToken}/file.md\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references the retired project\/publisher topology/);
});

test('validator rejects legacy references in a non-allowlisted publisher file', () => {
  const cwd = copyRepo();
  const target = path.join(cwd, 'skills', 'context-preserving-ai-publisher', 'references', 'legacy-fixture.md');
  fs.writeFileSync(target, `${legacyProjectToken}/fixture/${legacyCuratedToken}/file.md\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /references the retired project\/publisher topology/);
});

test('validator rejects a deleted sync command in current review validation evidence', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['github-governance-review-reconciler'].validation.push('node repo/scripts/sync-toolkit-projects.cjs --check');
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retired sync-toolkit-projects\.cjs/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects a current review publisher workflow using a project _main source', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['local-ai-stack-safety'].publisher_workflow += ` Active source: ${legacyProjectToken}/local/_main/SKILL.md.`;
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retired _projects path/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects curated deterministic publication claims in current review evidence', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['managed-app-foundation-review'].publisher_workflow += ` Current workflow publishes ${legacyCuratedToken} through generated deterministic publication.`;
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retired curated-output publishing/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects a retired source-to-surface publisher claim without direct-canonical evidence', () => {
  const cwd = copyRepo();
  try {
    updateBaseline(cwd, (baseline) => {
      baseline.skill_creation_review['toolkit-setup'].publisher_workflow = 'context-preserving-ai-publisher source-to-surface publisher workflow for the current skill.';
    });
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must state direct-canonical maintenance/);
    assert.match(result.stderr, /retired source-to-surface publishing/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects a current skill without direct-canonical review evidence', () => {
  const cwd = copyRepo();
  const baselinePath = path.join(cwd, 'repo', 'docs', 'skill-creation-center-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  delete baseline.skill_creation_review['managed-app-foundation-review'];
  baseline.reviewed_skill_ids = baseline.reviewed_skill_ids.filter((id) => id !== 'managed-app-foundation-review');
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing skill_creation_review evidence for current skill managed-app-foundation-review/);
});

test('validator rejects a new current skill without review evidence', () => {
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

test('validator rejects a new skill added to the mutable grandfathered list', () => {
  const cwd = copyRepo();
  try {
    addCurrentSkill(cwd, 'zz-future-current-skill');
    const baselinePath = path.join(cwd, 'repo', 'docs', 'skill-creation-center-baseline.json');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    baseline.grandfathered_skill_ids.push('zz-future-current-skill');
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /grandfathered_skill_ids must equal the immutable pre-gate legacy set/);
    assert.doesNotMatch(result.stderr, /missing skill_creation_review evidence for current skill zz-future-current-skill/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects an arbitrary grandfathered ID even without a matching skill', () => {
  const cwd = copyRepo();
  try {
    const baselinePath = path.join(cwd, 'repo', 'docs', 'skill-creation-center-baseline.json');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    baseline.grandfathered_skill_ids.push('zz-arbitrary-grandfathered-id');
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /grandfathered_skill_ids must equal the immutable pre-gate legacy set/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects removal of a legitimate historical grandfathered ID', () => {
  const cwd = copyRepo();
  try {
    const baselinePath = path.join(cwd, 'repo', 'docs', 'skill-creation-center-baseline.json');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    baseline.grandfathered_skill_ids = baseline.grandfathered_skill_ids.filter((id) => id !== 'windows-localhost-workflows');
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /grandfathered_skill_ids must equal the immutable pre-gate legacy set/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('validator rejects incomplete keyed review evidence', () => {
  const cwd = copyRepo();
  try {
    const baselinePath = path.join(cwd, 'repo', 'docs', 'skill-creation-center-baseline.json');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    baseline.skill_creation_review['managed-app-foundation-review'].trigger = ' ';
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

    const result = runValidate(cwd);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skill_creation_review\.managed-app-foundation-review\.trigger must be a non-empty evidence string/);
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

test('validation workflow contains only retained read-only checks', () => {
  const workflow = readText('.github/workflows/validate.yml');
  assert.match(workflow, /node repo\/scripts\/sync-agent-instruction-shims\.cjs --check/);
  assert.match(workflow, /node repo\/scripts\/sync-repo-doc-contract\.cjs --check/);
  assert.match(workflow, /node repo\/scripts\/audit-project-source-locks\.cjs/);
  assert.match(workflow, /node repo\/scripts\/audit-published-surfaces\.cjs --check/);
  assert.match(workflow, /node repo\/scripts\/validate-toolkit\.cjs/);
  assert.match(workflow, /node --test repo\/tests\/\*\.test\.cjs/);
  assert.doesNotMatch(workflow, /sync-toolkit-projects\.cjs|package-skills\.cjs|package-packs\.cjs/);
});

test('retired publisher and writeback machinery remains absent', () => {
  for (const relPath of [
    'repo/scripts/sync-toolkit-projects.cjs',
    'repo/scripts/package-skills.cjs',
    'repo/scripts/package-packs.cjs'
  ]) assert.equal(fs.existsSync(path.join(repoRoot, relPath)), false, relPath);
});

test('managed source-of-truth and instruction checks pass from an explicit workspace', () => {
  for (const script of [
    'repo/scripts/sync-agent-instruction-shims.cjs',
    'repo/scripts/sync-repo-doc-contract.cjs',
    'repo/scripts/validate-toolkit.cjs'
  ]) {
    const cwd = copyRepo();
    const result = spawnSync(process.execPath, [path.join(repoRoot, script), '--workspace', cwd, ...(script.includes('validate-toolkit') ? [] : ['--check'])], {
      cwd: os.tmpdir(),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `${script}\n${result.stderr}`);
  }
});
