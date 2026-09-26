'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..', '..');
const validateScript = path.join(repoRoot, 'repo', 'scripts', 'validate-toolkit.cjs');
const legacyProjectToken = '_' + 'projects';
const legacyCuratedToken = 'curated_' + 'output_for_ai';
const publisherReferencePaths = [];
const currentSkillIds = [
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

const ORACLE_SOURCE_PATH = 'repo/tests/toolkit-authority-packet-test-support.cjs';
const ORACLE_SOURCE_BLOB = '11daf32ac5a6ddf1a2bdab0d2acbf6fdb8ff40da';
// Pinned I:path bytes seed only the isolated fixture; the test never reads the repository object database.
const PINNED_ORACLE_SOURCE_BROTLI_BASE64 = [
    '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'
].join('');
function parseWorkflowScalar(value) {
  return String(value || '').trim().replace(/^'(.*)'$/, '$1');
}

function parseValidationWorkflowSteps(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIndex === -1) return { steps: [], errors: ['missing jobs section'] };
  const jobIndex = lines.findIndex((line, index) => index > jobsIndex && /^  validate:\s*$/.test(line));
  if (jobIndex === -1) return { steps: [], errors: ['missing validate job'] };
  const nextJobIndex = lines.findIndex((line, index) => index > jobIndex && /^  [A-Za-z0-9_-]+:\s*$/.test(line));
  const jobEnd = nextJobIndex === -1 ? lines.length : nextJobIndex;
  const stepsIndex = lines.findIndex((line, index) => index > jobIndex && index < jobEnd && /^    steps:\s*$/.test(line));
  if (stepsIndex === -1) return { steps: [], errors: ['missing validate job steps'] };
  const stepStartIndexes = [];
  for (let index = stepsIndex + 1; index < jobEnd; index += 1) {
    if (/^      -(?:\s|$)/.test(lines[index])) stepStartIndexes.push(index);
  }
  const steps = stepStartIndexes.map((start, stepIndex) => {
    const end = stepStartIndexes[stepIndex + 1] === undefined ? jobEnd : stepStartIndexes[stepIndex + 1];
    const block = lines.slice(start, end);
    const step = { name: '', uses: '', fields: {}, inputs: {}, source: block.join('\n') };
    const name = block[0].match(/^ {6}-\s+name:\s*(.*?)\s*$/);
    if (name) step.name = parseWorkflowScalar(name[1]);
    let inWith = false;
    for (const line of block) {
      const field = line.match(/^ {8}([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/);
      if (field) {
        if (field[1] === 'with') {
          inWith = true;
          continue;
        }
        inWith = false;
        step.fields[field[1]] = parseWorkflowScalar(field[2]);
        if (field[1] === 'uses') step.uses = step.fields.uses;
        continue;
      }
      if (!inWith) continue;
      const input = line.match(/^ {10}([A-Za-z0-9_-]+):(?:[ \t]*(.*))?$/);
      if (input) step.inputs[input[1]] = parseWorkflowScalar(input[2]);
    }
    return step;
  });
  return { steps, errors: [] };
}

function validationWorkflowCheckoutErrors(source) {
  const parsed = parseValidationWorkflowSteps(source);
  if (parsed.errors.length) return parsed.errors;
  const errors = [];
  const checkouts = parsed.steps.filter((step) => /^actions\/checkout@/.test(step.uses));
  if (checkouts.length !== 1) errors.push('validate job must have exactly one checkout action');
  const checkout = checkouts[0];
  if (!checkout) return errors;
  if (checkout.uses !== 'actions/checkout@v7') errors.push('checkout must use actions/checkout@v7');
  if (checkout.inputs['fetch-depth'] !== '0') errors.push('checkout must fetch full history');
  if (checkout.inputs['persist-credentials'] !== 'false') errors.push('checkout must disable persisted credentials');
  if (checkout.inputs.ref !== undefined) errors.push('checkout must preserve event-ref selection');
  if (checkout.fields.if !== undefined) errors.push('checkout acquisition must not be conditionally bypassed');
  if (checkout.fields['continue-on-error'] === 'true') errors.push('checkout acquisition must not ignore failure');
  const validationIndex = parsed.steps.findIndex((step) => (
    step.source.includes('node repo/scripts/validate-toolkit.cjs') ||
    step.source.includes('node --test repo/tests/*.test.cjs')
  ));
  if (validationIndex === -1) errors.push('existing validation floor is missing');
  else if (parsed.steps.indexOf(checkout) >= validationIndex) errors.push('checkout must precede the existing validation floor');
  return errors;
}

function fixtureGit(context, cwd, args, options = {}) {
  return spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: options.encoding || 'utf8',
    input: options.input,
    env: context.env,
    windowsHide: true
  });
}

function fixtureGitOk(context, cwd, args, options = {}) {
  const result = fixtureGit(context, cwd, args, options);
  assert.equal(result.status, 0, 'git ' + args.join(' ') + ' failed: ' + String(result.stderr));
  return Buffer.isBuffer(result.stdout) ? result.stdout : result.stdout.trim();
}

function createHostedSourceObjectFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-hosted-object-'));
  try {
    const globalConfig = path.join(root, 'empty-git-config');
    fs.writeFileSync(globalConfig, '', 'utf8');
    const env = { ...process.env };
    for (const key of [
      'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES',
      'GIT_PREFIX', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'
    ]) delete env[key];
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Toolkit Git-object fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Toolkit Git-object fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid'
    });
    const context = { env };
    const sourceBytes = zlib.brotliDecompressSync(Buffer.from(PINNED_ORACLE_SOURCE_BROTLI_BASE64, 'base64'));
    const sourceRepo = path.join(root, 'origin-work');
    const bareRepo = path.join(root, 'origin.git');
    fs.mkdirSync(sourceRepo);
    fixtureGitOk(context, sourceRepo, ['init']);
    fixtureGitOk(context, sourceRepo, ['checkout', '-b', 'main']);

    const sourceFilePath = path.join(sourceRepo, ...ORACLE_SOURCE_PATH.split('/'));
    fs.mkdirSync(path.dirname(sourceFilePath), { recursive: true });
    fs.writeFileSync(sourceFilePath, sourceBytes);
    fs.writeFileSync(path.join(sourceRepo, 'base.txt'), 'base\n', 'utf8');
    const oracleBlob = fixtureGitOk(context, sourceRepo, ['hash-object', '--stdin'], { input: sourceBytes });
    assert.equal(oracleBlob, ORACLE_SOURCE_BLOB, 'embedded source bytes must retain the pinned Git blob identity');
    fixtureGitOk(context, sourceRepo, ['add', '--all']);
    fixtureGitOk(context, sourceRepo, ['commit', '-m', 'Fixture base']);

    fixtureGitOk(context, sourceRepo, ['checkout', '-b', 'r-side']);
    fs.writeFileSync(path.join(sourceRepo, 'r-side.txt'), 'R side\n', 'utf8');
    fixtureGitOk(context, sourceRepo, ['add', '--all']);
    fixtureGitOk(context, sourceRepo, ['commit', '-m', 'Fixture R']);
    const rCommit = fixtureGitOk(context, sourceRepo, ['rev-parse', 'HEAD']);

    fixtureGitOk(context, sourceRepo, ['checkout', 'main']);
    for (let index = 1; index <= 5; index += 1) {
      fs.writeFileSync(path.join(sourceRepo, 'base-progress.txt'), 'base ' + index + '\n', 'utf8');
      fixtureGitOk(context, sourceRepo, ['add', '--all']);
      fixtureGitOk(context, sourceRepo, ['commit', '-m', 'Fixture BASE ' + index]);
    }
    const baseCommit = fixtureGitOk(context, sourceRepo, ['rev-parse', 'HEAD']);

    fixtureGitOk(context, sourceRepo, ['checkout', 'r-side']);
    fixtureGitOk(context, sourceRepo, ['merge', '--no-ff', '-m', 'Fixture I merge', 'main']);
    const integrationCommit = fixtureGitOk(context, sourceRepo, ['rev-parse', 'HEAD']);
    const integrationParents = fixtureGitOk(context, sourceRepo, ['rev-list', '--parents', '-n', '1', integrationCommit]).split(/\s+/);
    assert.deepEqual(integrationParents, [integrationCommit, rCommit, baseCommit]);

    fs.writeFileSync(path.join(sourceRepo, 'candidate.txt'), 'candidate C\n', 'utf8');
    fixtureGitOk(context, sourceRepo, ['add', '--all']);
    fixtureGitOk(context, sourceRepo, ['commit', '-m', 'Fixture candidate C']);
    const candidateCommit = fixtureGitOk(context, sourceRepo, ['rev-parse', 'HEAD']);
    assert.equal(fixtureGitOk(context, sourceRepo, ['rev-parse', 'HEAD^']), integrationCommit);

    const mergeTree = fixtureGitOk(context, sourceRepo, ['rev-parse', candidateCommit + '^{tree}']);
    const syntheticMerge = fixtureGitOk(context, sourceRepo, ['commit-tree', mergeTree, '-p', baseCommit, '-p', candidateCommit], {
      input: Buffer.from('Synthetic PR merge\n', 'utf8')
    });
    fixtureGitOk(context, sourceRepo, ['update-ref', 'refs/pull/17/merge', syntheticMerge]);
    const syntheticParents = fixtureGitOk(context, sourceRepo, ['rev-list', '--parents', '-n', '1', syntheticMerge]).split(/\s+/);
    assert.deepEqual(syntheticParents, [syntheticMerge, baseCommit, candidateCommit]);

    fixtureGitOk(context, sourceRepo, ['checkout', '-b', 'depth-descendant', candidateCommit]);
    for (let index = 1; index <= 5; index += 1) {
      fs.writeFileSync(path.join(sourceRepo, 'descendant-' + index + '.txt'), 'descendant ' + index + '\n', 'utf8');
      fixtureGitOk(context, sourceRepo, ['add', '--all']);
      fixtureGitOk(context, sourceRepo, ['commit', '-m', 'Fixture descendant ' + index]);
    }
    const descendantCommit = fixtureGitOk(context, sourceRepo, ['rev-parse', 'HEAD']);
    const distance = Number(fixtureGitOk(context, sourceRepo, ['rev-list', '--count', integrationCommit + '..' + descendantCommit]));
    assert.ok(distance > 4, 'descendant fixture must be beyond depth 4');

    fixtureGitOk(context, sourceRepo, ['branch', 'candidate', candidateCommit]);
    fs.mkdirSync(bareRepo);
    fixtureGitOk(context, bareRepo, ['init', '--bare']);
    const originUrl = pathToFileURL(bareRepo).href;
    fixtureGitOk(context, sourceRepo, ['remote', 'add', 'origin', originUrl]);
    fixtureGitOk(context, sourceRepo, [
      'push', 'origin',
      'refs/heads/main:refs/heads/main',
      'refs/heads/r-side:refs/heads/r-side',
      'refs/heads/candidate:refs/heads/candidate',
      'refs/heads/depth-descendant:refs/heads/depth-descendant',
      'refs/pull/17/merge:refs/pull/17/merge'
    ]);

    return {
      root,
      context,
      originUrl,
      bareRepo,
      integrationCommit,
      candidateCommit,
      syntheticMerge,
      descendantCommit,
      events: [
        { label: 'direct candidate checkout', ref: 'refs/heads/candidate', commit: candidateCommit },
        { label: 'synthetic PR merge checkout', ref: 'refs/pull/17/merge', commit: syntheticMerge },
        { label: 'descendant beyond depth 4', ref: 'refs/heads/depth-descendant', commit: descendantCommit }
      ]
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function acquireFixtureEventCheckout(fixture, event, fullHistory) {
  const checkout = path.join(fixture.root, 'checkout-' + event.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + (fullHistory ? '-full' : '-shallow'));
  fs.mkdirSync(checkout);
  fixtureGitOk(fixture.context, checkout, ['init']);
  fixtureGitOk(fixture.context, checkout, ['remote', 'add', 'origin', fixture.originUrl]);
  const fetchArgs = ['fetch', '--no-tags'];
  if (!fullHistory) fetchArgs.push('--depth=1');
  fetchArgs.push('origin', event.ref);
  fixtureGitOk(fixture.context, checkout, fetchArgs);
  fixtureGitOk(fixture.context, checkout, ['checkout', '--detach', 'FETCH_HEAD']);
  assert.equal(fs.existsSync(path.join(checkout, '.git', 'objects', 'info', 'alternates')), false);
  return checkout;
}

function oracleManifestSourceGuard(context, cwd, sourceCommit, expectedBlob, runner = fixtureGit) {
  const mismatch = { code: 'ORACLE_MANIFEST_SOURCE_HARNESS_MISMATCH' };
  const revisionPath = sourceCommit + ':' + ORACLE_SOURCE_PATH;
  const resolved = runner(context, cwd, ['rev-parse', revisionPath]);
  if (resolved.status !== 0 || resolved.stdout.trim() !== expectedBlob) return mismatch;
  const read = runner(context, cwd, ['show', revisionPath], { encoding: 'buffer' });
  if (read.status !== 0 || !Buffer.isBuffer(read.stdout)) return mismatch;
  const independentHash = runner(context, cwd, ['hash-object', '--stdin'], { input: read.stdout });
  if (independentHash.status !== 0 || independentHash.stdout.trim() !== expectedBlob) return mismatch;
  return { code: 'PASS', blob: resolved.stdout.trim(), bytes: read.stdout, independentlyHashed: independentHash.stdout.trim() };
}

function fixtureBlobHash(context, cwd, bytes) {
  const result = fixtureGit(context, cwd, ['hash-object', '--stdin'], { input: bytes });
  assert.equal(result.status, 0, 'git hash-object --stdin failed: ' + String(result.stderr));
  return result.stdout.trim();
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

test('Skill Creation Center schema v3 keys exactly match all current products', () => {
  const baseline = JSON.parse(readText('repo/docs/skill-creation-center-baseline.json'));
  const validator = require(validateScript);
  const current = validator.skillDirs().map((relPath) => path.basename(relPath)).sort();

  assert.equal(baseline.schema_version, 3);
  assert.equal(Object.hasOwn(baseline, 'grandfathered_skill_ids'), false);
  assert.equal(Object.hasOwn(baseline, 'reviewed_skill_ids'), false);
  assert.deepEqual(current, currentSkillIds);
  assert.deepEqual(Object.keys(baseline.skill_creation_review).sort(), currentSkillIds);
  assert.equal(Object.hasOwn(baseline.skill_creation_review, 'knowledge-index-updater'), false);
  assert.deepEqual(validator.validate(), []);
});

test('all current product reviews use direct-canonical evidence and existing checks', () => {
  const baseline = JSON.parse(readText('repo/docs/skill-creation-center-baseline.json'));
  const validator = require(validateScript);
  assert.deepEqual(Object.keys(baseline.skill_creation_review).sort(), currentSkillIds);

  for (const skill of currentSkillIds) {
    const review = baseline.skill_creation_review[skill];
    assert.equal(review.public_id, skill);
    assert.match(review.canonical_ownership, /direct-canonical/i);
    assert.match(review.canonical_ownership, new RegExp(`skills/${skill}/`));
    assert.match(review.canonical_ownership, /repo\/\*\*/);
    assert.equal(review.positive_routing_examples.length >= 3, true);
    assert.equal(review.negative_routing_examples.length >= 3, true);
    assert.equal(review.overlap_boundary.trim().length >= 12, true);
    assert.doesNotMatch(JSON.stringify({ canonical_ownership: review.canonical_ownership, validation: review.validation }), new RegExp(`sync-toolkit-projects\\.cjs|_projects[\\/]|${legacyCuratedToken}|_main|source[- ]to[- ]surface|(?:generated|deterministic)[\\s\\S]*(?:copy|publication|writeback)`, 'i'));
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
        baseline.skill_creation_review['github-program-reconciler'].validation.push(command);
      });
      const result = runValidate(cwd);
      assert.notEqual(result.status, 0, label);
      assert.match(result.stderr, expected, label);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
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

test('Skill Creation and published-surface consumers share the retired topology atom detector', () => {
  const audit = require(path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs'));
  for (const variant of sharedRetiredOperationVariants) {
    assert.ok(audit.detectRetiredTopologyAtoms(variant).length > 0, variant);
  }

  for (const variant of sharedRetiredOperationVariants) {
    const cwd = copyRepo();
    try {
      updateBaseline(cwd, (baseline) => {
        baseline.skill_creation_review['github-program-reconciler'].existing_skill_review += ` ${variant}`;
      });
      const result = runValidate(cwd);
      assert.notEqual(result.status, 0, variant);
      assert.match(result.stderr, /skill_creation_review\.github-program-reconciler\.existing_skill_review/, variant);
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
        baseline.skill_creation_review['github-program-reconciler'][field] += ` ${injection}`;
      });
      const result = runValidate(cwd);
      assert.notEqual(result.status, 0, field);
      assert.match(result.stderr, new RegExp(`skill_creation_review\\.github-program-reconciler\\.${field}`), field);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('Skill Creation retains exactly the fourteen operational free-text fields', () => {
  assert.deepEqual(skillCreationOperationalFreeTextFields, [
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
  ]);
  assert.equal(skillCreationOperationalFreeTextFields.length, 14);
});

test('validator rejects shared retired-operation variants in validation commands', () => {
  for (const variant of sharedRetiredOperationVariants) {
    const cwd = copyRepo();
    try {
      updateBaseline(cwd, (baseline) => {
        baseline.skill_creation_review['github-program-reconciler'].validation.push(`node --test repo/tests/skill-routing.test.cjs ${variant}`);
      });
      const result = runValidate(cwd);
      assert.notEqual(result.status, 0, variant);
      assert.match(result.stderr, /skill_creation_review\.github-program-reconciler\.validation command/, variant);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
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

test('validator and surface audit keep the publisher reference allowlist empty', () => {
  const validator = require(validateScript);
  const audit = require(path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs'));
  assert.deepEqual(publisherReferencePaths.filter(audit.legacyReferenceAllowed), []);
  assert.equal(audit.legacyReferenceAllowed('skills/skill-product-review/README.md'), false);
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

test('both hosted validation workflows fetch full event history before their validation floor', () => {
  const specs = [
    { path: '.github/workflows/validate.yml', dispatch: false },
    { path: '.github/workflows/validate-toolkit.yml', dispatch: true }
  ];
  for (const spec of specs) {
    const source = readText(spec.path);
    assert.deepEqual(validationWorkflowCheckoutErrors(source), [], spec.path);
    assert.match(source, /^on:\n  pull_request:\n/m, spec.path + ' pull_request trigger');
    assert.match(source, /^  push:\n    branches:\n      - main$/m, spec.path + ' main push trigger');
    assert.match(source, /^permissions:\n  contents: read$/m, spec.path + ' read-only permissions');
    if (spec.dispatch) assert.match(source, /^  workflow_dispatch:$/m, spec.path + ' workflow_dispatch trigger');
    else assert.doesNotMatch(source, /^  workflow_dispatch:$/m, spec.path + ' retains its existing trigger set');
    if (spec.path.endsWith('validate.yml')) {
      for (const command of [
        'node repo/scripts/sync-repo-doc-contract.cjs --check',
        'node repo/scripts/sync-agent-instruction-shims.cjs --check',
        'node repo/scripts/audit-project-source-locks.cjs',
        'node repo/scripts/audit-published-surfaces.cjs --check',
        'node repo/scripts/audit-fallback-risk.cjs',
        'node repo/scripts/validate-toolkit.cjs',
        'node --test repo/tests/*.test.cjs',
        'node repo/scripts/audit-skill-portability.cjs',
        'node repo/scripts/run-design-tests.cjs',
        'git diff --check'
      ]) assert.ok(source.includes(command), spec.path + ' retains ' + command);
    } else {
      for (const command of [
        'node --check repo/scripts/validate-toolkit.cjs',
        'node repo/scripts/validate-toolkit.cjs',
        'node --test repo/tests/*.test.cjs',
        'git diff --check'
      ]) assert.ok(source.includes(command), spec.path + ' retains ' + command);
    }
  }
});

test('validation workflow checkout regressions reject missing, shallow, misplaced, overridden, or bypassed acquisition', () => {
  const specs = ['.github/workflows/validate.yml', '.github/workflows/validate-toolkit.yml'];
  for (const relPath of specs) {
    const source = readText(relPath);
    const withoutDepth = source.replace(/^          fetch-depth: 0\n/m, '');
    const variants = [
      ['omitted fetch depth', withoutDepth],
      ['shallow depth one', source.replace('fetch-depth: 0', 'fetch-depth: 1')],
      ['depth placed on setup-node', withoutDepth.replace('          node-version: 22', '          node-version: 22\n          fetch-depth: 0')],
      ['checkout overridden to I', source.replace('          persist-credentials: false', '          persist-credentials: false\n          ref: d04dea7938e791725e7e43b293b6fe35be14ac9e')],
      ['checkout overridden to main', source.replace('          persist-credentials: false', '          persist-credentials: false\n          ref: main')],
      ['checkout acquisition bypassed', source.replace(/^      - name: Checkout\n[\s\S]*?(?=^      - name: Set up Node)/m, '')]
    ];
    for (const [label, variant] of variants) {
      assert.ok(variant !== source, relPath + ' variant must mutate source: ' + label);
      assert.notDeepEqual(validationWorkflowCheckoutErrors(variant), [], relPath + ' must reject ' + label);
    }
  }
});

test('hosted source-object contract proves shallow failure, isolated full-history success, and candidate preservation', () => {
  const fixture = createHostedSourceObjectFixture();
  try {
    assert.ok(fixture.originUrl.startsWith('file:'), 'fixture acquisition must use only the isolated local origin');
    const originAlternates = path.join(fixture.bareRepo, 'objects', 'info', 'alternates');
    assert.equal(fs.existsSync(originAlternates), false, 'fixture origin must not borrow an alternate object database');
    const expectedBlob = ORACLE_SOURCE_BLOB;
    const revisionPath = fixture.integrationCommit + ':' + ORACLE_SOURCE_PATH;
    const sourceBytes = zlib.brotliDecompressSync(Buffer.from(PINNED_ORACLE_SOURCE_BROTLI_BASE64, 'base64'));
    assert.equal(fixtureBlobHash(fixture.context, fixture.bareRepo, sourceBytes), expectedBlob);

    for (const event of fixture.events) {
      const intendedCommit = fixtureGitOk(fixture.context, fixture.bareRepo, ['rev-parse', event.ref]);
      const intendedTree = fixtureGitOk(fixture.context, fixture.bareRepo, ['rev-parse', intendedCommit + '^{tree}']);
      assert.equal(intendedCommit, event.commit, event.label + ' intended event commit');
      const shallow = acquireFixtureEventCheckout(fixture, event, false);
      const full = acquireFixtureEventCheckout(fixture, event, true);
      try {
        assert.equal(fixtureGitOk(fixture.context, shallow, ['rev-parse', 'HEAD']), intendedCommit, event.label + ' shallow event commit');
        const missingCommit = fixtureGit(fixture.context, shallow, ['cat-file', '-e', fixture.integrationCommit + '^{commit}']);
        assert.notEqual(missingCommit.status, 0, event.label + ' depth-1 checkout must lack I');
        const missingPath = fixtureGit(fixture.context, shallow, ['rev-parse', revisionPath]);
        assert.notEqual(missingPath.status, 0, event.label + ' exact I:path lookup must fail at depth 1');
        assert.equal(fixtureBlobHash(fixture.context, shallow, fs.readFileSync(path.join(shallow, ...ORACLE_SOURCE_PATH.split('/')))), expectedBlob,
          event.label + ' must still have matching workspace bytes available');
        assert.equal(oracleManifestSourceGuard(fixture.context, shallow, fixture.integrationCommit, expectedBlob).code,
          'ORACLE_MANIFEST_SOURCE_HARNESS_MISMATCH', event.label + ' unchanged oracle-style guard must fail closed');

        assert.equal(fixtureGitOk(fixture.context, full, ['rev-parse', 'HEAD']), intendedCommit, event.label + ' full-history event commit');
        assert.equal(fixtureGitOk(fixture.context, full, ['rev-parse', 'HEAD^{tree}']), intendedTree, event.label + ' full-history event tree');
        assert.equal(fixtureGit(fixture.context, full, ['cat-file', '-e', fixture.integrationCommit + '^{commit}']).status, 0,
          event.label + ' full history must contain I');
        const resolved = fixtureGit(fixture.context, full, ['rev-parse', revisionPath]);
        assert.equal(resolved.status, 0, event.label + ' full history must resolve I:path');
        assert.equal(resolved.stdout.trim(), expectedBlob, event.label + ' I:path must resolve to the pinned blob');
        const guarded = oracleManifestSourceGuard(fixture.context, full, fixture.integrationCommit, expectedBlob);
        assert.equal(guarded.code, 'PASS', event.label + ' oracle-style guard positive control');
        assert.equal(guarded.blob, expectedBlob);
        assert.equal(guarded.independentlyHashed, expectedBlob, event.label + ' independently Git-hashed bytes');
        assert.deepEqual(guarded.bytes, sourceBytes, event.label + ' source bytes read from the real fixture object');
      } finally {
        fs.rmSync(shallow, { recursive: true, force: true });
        fs.rmSync(full, { recursive: true, force: true });
      }
    }

    const shallow = acquireFixtureEventCheckout(fixture, fixture.events[0], false);
    const full = acquireFixtureEventCheckout(fixture, fixture.events[0], true);
    try {
      assert.equal(oracleManifestSourceGuard(fixture.context, full, fixture.integrationCommit, '0000000000000000000000000000000000000000').code,
        'ORACLE_MANIFEST_SOURCE_HARNESS_MISMATCH', 'incorrect expected blob must fail closed');
      const revisionPath = fixture.integrationCommit + ':' + ORACLE_SOURCE_PATH;
      const mockedRevParse = (context, cwd, args, options = {}) => {
        if (args[0] === 'rev-parse' && args[1] === revisionPath) {
          return { status: 0, stdout: ORACLE_SOURCE_BLOB + '\n', stderr: '' };
        }
        return fixtureGit(context, cwd, args, options);
      };
      assert.equal(oracleManifestSourceGuard(fixture.context, shallow, fixture.integrationCommit, ORACLE_SOURCE_BLOB, mockedRevParse).code,
        'ORACLE_MANIFEST_SOURCE_HARNESS_MISMATCH', 'mocked Git output without a real readable object must fail closed');
      assert.equal(oracleManifestSourceGuard(fixture.context, full, fixture.integrationCommit, ORACLE_SOURCE_BLOB).code,
        'PASS', 'real full-history object remains the only positive path');
    } finally {
      fs.rmSync(shallow, { recursive: true, force: true });
      fs.rmSync(full, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
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
