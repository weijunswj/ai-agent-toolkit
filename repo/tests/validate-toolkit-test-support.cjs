'use strict';

// Constants and copied-workspace helpers shared by the validate-toolkit test files. The cases are
// split across files so node --test runs them in parallel; each case copies the repository and runs
// the validator on the copy.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const validateScript = path.join(repoRoot, 'repo', 'scripts', 'validate-toolkit.cjs');
const legacyProjectToken = '_' + 'projects';
const legacyCuratedToken = 'curated_' + 'output_for_ai';
const publisherReferencePaths = [];
const currentSkillIds = [
  'codex-ssh-hostinger-coolify-setup-maintainer',
  'controller-bootstrap',
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
  'toolkit-env',
  'toolkit-setup',
  'windows-local-dev-services'
];
const skillCreationOperationalFreeTextFields = [
  'existing_skill_review',
  'native_capability_review',
  'trigger',
  'invocation_mode_reason',
  'decision_reason',
  'unique_value',
  'runtime_footprint',
  'local_assets',
  'output_contract',
  'anti_bloat_review',
  'overlap_boundary',
  'safety_boundary',
  'third_party_audit',
  'canonical_ownership'
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

function copyFilter(source) {
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

function copyRepo() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-validate-'));
  fs.cpSync(repoRoot, target, { recursive: true, filter: copyFilter });
  return target;
}

function runValidate(cwd) {
  return spawnSync(process.execPath, [validateScript], { cwd, encoding: 'utf8' });
}

// One copied workspace per case, each changed by prepare(cwd, item) and checked by its own validator
// run, a few at a time. Results come back in case order; every copy is removed afterwards.
const PARALLEL_CASES = 4;

async function validateEachCopy(items, prepare) {
  const results = new Array(items.length);
  const copies = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'toolkit-validate-'));
      copies.push(cwd);
      await fs.promises.cp(repoRoot, cwd, { recursive: true, filter: copyFilter });
      prepare(cwd, items[index]);
      results[index] = { item: items[index], result: await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [validateScript], { cwd });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
        child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      }) };
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL_CASES, items.length) }, worker));
  } finally {
    for (const cwd of copies) fs.rmSync(cwd, { recursive: true, force: true });
  }
  return results;
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

function updateMigrationLedger(cwd, mutate) {
  const ledgerPath = path.join(cwd, 'repo', 'contracts', 'skill-product-migration-ledger.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  mutate(ledger);
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

function updateTopologyPolicy(cwd, mutate) {
  const policyPath = path.join(cwd, 'repo', 'contracts', 'topology-scope-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  mutate(policy);
  fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
}

module.exports = Object.freeze({
  repoRoot,
  validateScript,
  legacyProjectToken,
  legacyCuratedToken,
  publisherReferencePaths,
  currentSkillIds,
  skillCreationOperationalFreeTextFields,
  sharedRetiredOperationVariants,
  readText,
  copyRepo,
  runValidate,
  validateEachCopy,
  addCurrentSkill,
  insertBefore,
  addSkillToCatalogs,
  updateBaseline,
  updateMigrationLedger,
  updateTopologyPolicy,
});
