'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const moduleRoot = path.join(repoRoot, '_projects', 'cicd', 'repository-security-gate', '_main');
const authorityToolPath = path.join(moduleRoot, 'tools', 'required-check-terminal.cjs');
const producerConfig = JSON.parse(fs.readFileSync(
  path.join(moduleRoot, 'config', 'required-check-producers.json'),
  'utf8'
));
const promotionTemplate = JSON.parse(fs.readFileSync(
  path.join(moduleRoot, 'config', 'ruleset-promotion-plan.json'),
  'utf8'
));
const {
  buildProducerInventory,
  buildTerminalReceipt,
  generateRulesetPlan,
  runGeneratedSurfaceVerification
} = require(authorityToolPath);

let app;

test.before(async () => {
  const appRoot = path.join(moduleRoot, 'app', 'src');
  const publisher = await import(pathToFileUrl(path.join(appRoot, 'check-publisher.mjs')));
  const state = await import(pathToFileUrl(path.join(appRoot, 'run-state.mjs')));
  const evidence = await import(pathToFileUrl(path.join(appRoot, 'evidence-verifier.mjs')));
  const worker = await import(pathToFileUrl(path.join(appRoot, 'worker.mjs')));
  app = { ...publisher, ...state, ...evidence, ...worker };
});

function pathToFileUrl(filePath) {
  return new URL(`file:///${filePath.replace(/\\/g, '/')}`).href;
}

function writeFiles(root, files) {
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf8');
  }
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commitRepository(root) {
  git(root, ['init', '-q']);
  git(root, ['add', '--all']);
  git(root, ['-c', 'user.name=Toolkit Test', '-c', 'user.email=toolkit@example.invalid', 'commit', '-m', 'fixture']);
  return git(root, ['rev-parse', 'HEAD']);
}

function authorityWorkflow(overrides = {}) {
  const terminalIf = overrides.terminalIf || '${{ always() }}';
  const producerContinue = overrides.producerContinue ? '    continue-on-error: true\n' : '';
  return `name: TK-023 protected repository authority
on:
  workflow_dispatch:
permissions: {}
jobs:
  dispatch-authority:
    name: TK-023 authority / verify App dispatch
    runs-on: ubuntu-latest
${producerContinue}    steps:
      - run: exit 0
  producer-inventory:
    name: TK-023 authority / required-check producer inventory
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
  repository-security-scan:
    name: TK-023 authority / repository security worker
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
  generated-surface-fidelity:
    name: TK-023 authority / generated-surface fidelity
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
  validate-worker:
    name: TK-023 authority / validate worker
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
  validate-toolkit-worker:
    name: TK-023 authority / validate toolkit worker
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
  repository-security-terminal:
    name: TK-023 authority / repository security terminal
    if: ${terminalIf}
    needs: [dispatch-authority, producer-inventory, repository-security-scan, generated-surface-fidelity]
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
  validate-terminal:
    name: TK-023 authority / validate terminal
    if: \${{ always() }}
    needs: [dispatch-authority, producer-inventory, generated-surface-fidelity, validate-worker]
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
  validate-toolkit-terminal:
    name: TK-023 authority / validate toolkit terminal
    if: \${{ always() }}
    needs: [dispatch-authority, producer-inventory, generated-surface-fidelity, validate-toolkit-worker]
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
`;
}

function createInventoryPair(candidateFiles, options = {}) {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'tk023-producer-'));
  const authority = path.join(container, 'authority');
  const candidate = path.join(container, 'candidate');
  const authorityFiles = {
    '.github/workflows/repository-security-gate.yml': authorityWorkflow(options.authority || {})
  };
  for (const relative of producerConfig.app.source_files) {
    authorityFiles[`${producerConfig.app.source_root}/${relative}`] = fs.readFileSync(
      path.join(moduleRoot, 'app', ...relative.split('/')),
      'utf8'
    );
  }
  writeFiles(authority, authorityFiles);
  writeFiles(candidate, candidateFiles);
  const authorityCommit = commitRepository(authority);
  const candidateCommit = commitRepository(candidate);
  return {
    container,
    authority,
    candidate,
    authorityCommit,
    candidateCommit,
    inventory() {
      return buildProducerInventory({
        authorityRoot: authority,
        candidateRoot: candidate,
        authorityCommit,
        candidateHead: candidateCommit,
        repository: 'synthetic/toolkit',
        config: producerConfig
      });
    }
  };
}

function withInventoryPair(files, callback, options = {}) {
  const fixture = createInventoryPair(files, options);
  try {
    return callback(fixture);
  } finally {
    fs.rmSync(fixture.container, { recursive: true, force: true });
  }
}

function baselineCandidate(extra = '') {
  return `name: Candidate CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  build:
    name: Candidate build
    runs-on: ubuntu-latest
    steps:
      - run: exit 0
${extra}`;
}

function terminalOptions(contextId = 'repository-security-gate') {
  const context = producerConfig.contexts.find((item) => item.id === contextId);
  const needs = Object.fromEntries(context.mandatory_prerequisites.map((jobId) => [jobId, { result: 'success' }]));
  return {
    config: producerConfig,
    contextId,
    needs,
    repository: 'synthetic/toolkit',
    repositoryId: 1,
    prNumber: 2,
    headSha: '1'.repeat(40),
    headTree: '2'.repeat(40),
    baseSha: '3'.repeat(40),
    baseGeneration: 1,
    authorityCommit: '4'.repeat(40),
    authorityTree: '5'.repeat(40),
    workflowDigest: `sha256:${'6'.repeat(64)}`,
    runId: 7,
    runAttempt: 1,
    attemptGeneration: 1,
    githubJobId: 8,
    correlationId: `tk023:1:2:${'1'.repeat(40)}:abcdef123456`,
    nonce: 'abcdefghijklmnopqrstuv',
    producerInventoryDigest: `sha256:${'7'.repeat(64)}`,
    oidcAttestationId: `sha256:${'8'.repeat(64)}`,
    reportState: contextId === 'repository-security-gate' ? 'SECURITY_PASS' : 'VALIDATION_PASS'
  };
}

function fakeGithub(checkRuns = []) {
  const calls = [];
  return {
    calls,
    async listCheckRuns() { return checkRuns; },
    async createCheckRun({ payload }) {
      calls.push(['create', payload]);
      return { id: 10, external_id: payload.external_id, app: { id: 77 } };
    },
    async updateCheckRun({ checkRunId, payload }) {
      calls.push(['update', checkRunId, payload]);
      return { id: checkRunId, external_id: payload.external_id, app: { id: 77 } };
    }
  };
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function storedZip(entries, compress = false) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, contents] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(contents, 'utf8');
    const encoded = compress ? zlib.deflateRawSync(data) : data;
    const method = compress ? 8 : 0;
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(encoded.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, encoded);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(encoded.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + encoded.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

test('required-check App authority adversarial fixture matrix', async (t) => {
  await t.test('second workflow publishing Validate is rejected', () => {
    withInventoryPair({
      '.github/workflows/ci.yml': baselineCandidate(),
      '.github/workflows/collision.yml': baselineCandidate().replace('Candidate build', 'Validate')
    }, (fixture) => assert.throws(() => fixture.inventory(), /producer uniqueness/));
  });

  await t.test('second workflow publishing Validate Toolkit is rejected', () => {
    withInventoryPair({
      '.github/workflows/ci.yml': baselineCandidate().replace('Candidate build', 'Validate Toolkit')
    }, (fixture) => assert.throws(() => fixture.inventory(), /producer uniqueness/));
  });

  await t.test('local reusable-workflow collision is rejected', () => {
    withInventoryPair({
      '.github/workflows/ci.yml': `name: caller\non: pull_request\njobs:\n  call:\n    uses: ./.github/workflows/reusable.yml\n`,
      '.github/workflows/reusable.yml': baselineCandidate().replace('Candidate build', 'Validate')
    }, (fixture) => assert.throws(() => fixture.inventory(), /producer uniqueness/));
  });

  await t.test('nested reusable-workflow collision is rejected', () => {
    withInventoryPair({
      '.github/workflows/ci.yml': `name: caller\non: pull_request\njobs:\n  call:\n    uses: ./.github/workflows/one.yml\n`,
      '.github/workflows/one.yml': `name: one\non: workflow_call\njobs:\n  call:\n    uses: ./.github/workflows/two.yml\n`,
      '.github/workflows/two.yml': baselineCandidate().replace('Candidate build', 'Validate Toolkit')
    }, (fixture) => assert.throws(() => fixture.inventory(), /producer uniqueness/));
  });

  await t.test('matrix-generated collision is rejected', () => {
    withInventoryPair({
      '.github/workflows/ci.yml': `name: matrix\non: pull_request\njobs:\n  build:\n    name: \${{ matrix.context }}\n    strategy:\n      matrix:\n        context: [Validate, Candidate]\n    runs-on: ubuntu-latest\n    steps:\n      - run: exit 0\n`
    }, (fixture) => assert.throws(() => fixture.inventory(), /producer uniqueness/));
  });

  await t.test('unsupported dynamic job-name expression is rejected', () => {
    withInventoryPair({
      '.github/workflows/ci.yml': baselineCandidate().replace('Candidate build', '${{ github.ref }}')
    }, (fixture) => assert.throws(() => fixture.inventory(), /unsupported dynamic/));
  });

  await t.test('terminal with arbitrary job-level predicate is rejected', () => {
    withInventoryPair({
      '.github/workflows/ci.yml': baselineCandidate()
    }, (fixture) => assert.throws(() => fixture.inventory(), /must use exactly/), {
      authority: { terminalIf: '${{ success() }}' }
    });
  });

  await t.test('failed dependency makes the terminal fail', () => {
    const options = terminalOptions();
    options.needs['repository-security-scan'].result = 'failure';
    const receipt = buildTerminalReceipt(options);
    assert.equal(receipt.status, 'FAIL');
    assert.ok(receipt.failure_codes.includes('TK023_TERMINAL_PREREQUISITE_NOT_SUCCESS'));
  });

  await t.test('mandatory prerequisite using continue-on-error is rejected', () => {
    withInventoryPair({
      '.github/workflows/ci.yml': baselineCandidate()
    }, (fixture) => assert.throws(() => fixture.inventory(), /continue on error/), {
      authority: { producerContinue: true }
    });
  });

  await t.test('cancelled prerequisite makes the terminal fail', () => {
    const options = terminalOptions('validate');
    options.needs['validate-worker'].result = 'cancelled';
    assert.equal(buildTerminalReceipt(options).status, 'FAIL');
  });

  await t.test('missing prerequisite result makes the terminal fail', () => {
    const options = terminalOptions('validate-toolkit');
    delete options.needs['validate-toolkit-worker'];
    const receipt = buildTerminalReceipt(options);
    assert.equal(receipt.status, 'FAIL');
    assert.ok(receipt.failure_codes.includes('TK023_TERMINAL_PREREQUISITE_SET_MISMATCH'));
  });

  await t.test('stale-head terminal evidence cannot verify', async () => {
    const receipt = buildTerminalReceipt(terminalOptions());
    const result = await app.verifyTerminalReceipt(receipt, {
      ...terminalOptions(),
      context_id: 'repository-security-gate',
      context_name: 'Repository security gate',
      repository: 'synthetic/toolkit',
      repository_id: 1,
      pr_number: 2,
      head_sha: '9'.repeat(40),
      head_tree: '2'.repeat(40),
      base_sha: '3'.repeat(40),
      base_generation: 1,
      authority_commit: '4'.repeat(40),
      authority_tree: '5'.repeat(40),
      workflow_path: '.github/workflows/repository-security-gate.yml',
      workflow_digest: `sha256:${'6'.repeat(64)}`,
      run_id: 7,
      run_attempt: 1,
      attempt_generation: 1,
      job_id: 'repository-security-terminal',
      github_job_id: 8,
      correlation_id: terminalOptions().correlationId,
      nonce: terminalOptions().nonce,
      producer_inventory_digest: `sha256:${'7'.repeat(64)}`,
      mandatory_prerequisites: producerConfig.contexts[0].mandatory_prerequisites
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes('TK023_TERMINAL_HEAD_SHA_MISMATCH'));
  });

  await t.test('superseded-head state never maps to success', () => {
    assert.equal(app.conclusionForEvidence('SUPERSEDED', true), 'cancelled');
    assert.notEqual(app.conclusionForEvidence('SUPERSEDED', true), 'success');
  });

  await t.test('old native rerun attempts are rejected by source contract', () => {
    const source = fs.readFileSync(path.join(moduleRoot, 'app', 'src', 'worker.mjs'), 'utf8');
    assert.match(source, /payload\.workflow_run\.run_attempt !== 1/);
    assert.match(source, /fresh App dispatch/i);
  });

  await t.test('same-name check from another integration fails before publication', async () => {
    const github = fakeGithub([{ id: 99, external_id: 'foreign', app: { id: 999 } }]);
    await assert.rejects(app.publishRequiredCheck({
      github,
      state: new app.MemoryRunState(),
      integrationId: 77,
      repositoryId: 1,
      owner: 'synthetic',
      repo: 'toolkit',
      prNumber: 2,
      headSha: '1'.repeat(40),
      contextId: 'validate',
      status: 'in_progress',
      summary: 'synthetic'
    }), /TK023_FOREIGN_SAME_NAME_CHECK/);
    assert.deepEqual(github.calls, []);
  });

  await t.test('conflicting duplicate terminal evidence cannot overwrite a check', async () => {
    const state = new app.MemoryRunState();
    const github = fakeGithub();
    const common = {
      github,
      state,
      integrationId: 77,
      repositoryId: 1,
      owner: 'synthetic',
      repo: 'toolkit',
      prNumber: 2,
      headSha: '1'.repeat(40),
      contextId: 'validate',
      summary: 'synthetic'
    };
    await app.publishRequiredCheck({ ...common, status: 'in_progress' });
    await app.publishRequiredCheck({
      ...common,
      status: 'completed',
      conclusion: 'failure',
      terminalDigest: `sha256:${'1'.repeat(64)}`
    });
    const callsBefore = github.calls.length;
    await assert.rejects(app.publishRequiredCheck({
      ...common,
      status: 'completed',
      conclusion: 'success',
      terminalDigest: `sha256:${'2'.repeat(64)}`
    }), /TK023_TERMINAL_CONFLICT/);
    assert.equal(github.calls.length, callsBefore);
  });

  await t.test('a newer App-issued same-head generation replaces a terminal result and suppresses the stale attempt', async () => {
    const state = new app.MemoryRunState();
    const headSha = '1'.repeat(40);
    const baseRecord = {
      repository_id: 1,
      installation_id: 2,
      repository: 'synthetic/toolkit',
      candidate_repository: 'synthetic/toolkit',
      candidate_repository_id: 1,
      pr_number: 2,
      head_sha: headSha,
      base_sha: '2'.repeat(40),
      base_generation: 1,
      authority_sha: '3'.repeat(40),
      nonce: 'abcdefghijklmnopqrstuv',
      delivery_id: 'delivery-one',
      envelope_digest: `sha256:${'4'.repeat(64)}`
    };
    const headKey = `1/2/${headSha}`;
    const first = await state.beginAttempt(headKey, 'correlation-one', baseRecord);
    const github = fakeGithub();
    const common = {
      github,
      state,
      integrationId: 77,
      repositoryId: 1,
      owner: 'synthetic',
      repo: 'toolkit',
      prNumber: 2,
      headSha,
      contextId: 'validate',
      summary: 'synthetic'
    };
    await app.publishRequiredCheck({
      ...common,
      status: 'completed',
      conclusion: 'failure',
      terminalDigest: `sha256:${'5'.repeat(64)}`,
      attemptGeneration: first.generation,
      correlationId: 'correlation-one'
    });
    const second = await state.beginAttempt(headKey, 'correlation-two', {
      ...baseRecord,
      nonce: 'zyxwvutsrqponmlkjihgfe',
      delivery_id: 'delivery-two',
      envelope_digest: `sha256:${'6'.repeat(64)}`
    });
    assert.equal(second.generation, 2);
    await assert.rejects(app.publishRequiredCheck({
      ...common,
      status: 'completed',
      conclusion: 'success',
      terminalDigest: `sha256:${'7'.repeat(64)}`,
      attemptGeneration: first.generation,
      correlationId: 'correlation-one'
    }), /TK023_STALE_ATTEMPT/);
    await app.publishRequiredCheck({
      ...common,
      status: 'completed',
      conclusion: 'success',
      terminalDigest: `sha256:${'8'.repeat(64)}`,
      attemptGeneration: second.generation,
      correlationId: 'correlation-two'
    });
    assert.equal(state.data.checks.values().next().value.conclusion, 'success');
  });

  await t.test('same-head generation remains monotonic after terminal correlation and head compaction', async () => {
    const state = new app.MemoryRunState();
    const headSha = '1'.repeat(40);
    const headKey = `1/2/${headSha}`;
    const startedAt = Date.parse('2025-01-01T00:00:00.000Z');
    const baseRecord = {
      repository_id: 1,
      installation_id: 2,
      repository: 'synthetic/toolkit',
      candidate_repository: 'synthetic/toolkit',
      candidate_repository_id: 1,
      pr_number: 2,
      head_sha: headSha,
      base_sha: '2'.repeat(40),
      base_generation: 1,
      authority_sha: '3'.repeat(40),
      nonce: 'abcdefghijklmnopqrstuv',
      delivery_id: 'delivery-before-compaction',
      envelope_digest: `sha256:${'4'.repeat(64)}`
    };
    const first = await state.beginAttempt(headKey, 'correlation-before-compaction', baseRecord, startedAt);
    await state.transitionCorrelation('correlation-before-compaction', 'dispatch_intent', {
      ...first.existing,
      state: 'failed',
      failure_code: 'TK023_SYNTHETIC_FAILURE'
    }, startedAt);
    for (let index = 0; index < 256; index += 1) {
      state.data.correlations.set(`newer-terminal-${index}`, {
        repository_id: 1,
        pr_number: index + 10,
        head_sha: String(index % 10).repeat(40),
        state: 'completed',
        updated_at: '2025-01-02T00:00:00.000Z'
      });
    }
    await state.compact(Date.parse('2026-07-27T00:00:00.000Z'));
    assert.equal(state.data.correlations.has('correlation-before-compaction'), false);
    assert.equal(state.data.heads.has(headKey), false);
    const second = await state.beginAttempt(headKey, 'correlation-after-compaction', {
      ...baseRecord,
      nonce: 'zyxwvutsrqponmlkjihgfe',
      delivery_id: 'delivery-after-compaction',
      envelope_digest: `sha256:${'5'.repeat(64)}`
    }, Date.parse('2026-07-27T00:01:00.000Z'));
    assert.ok(second.generation > first.generation);
  });

  await t.test('sealed three-context publication is immutable and resumes per-context progress', async () => {
    const state = new app.MemoryRunState();
    const headSha = '1'.repeat(40);
    const correlationId = 'correlation-sealed';
    const attempt = await state.beginAttempt(`1/2/${headSha}`, correlationId, {
      repository_id: 1,
      installation_id: 2,
      repository: 'synthetic/toolkit',
      candidate_repository: 'synthetic/toolkit',
      candidate_repository_id: 1,
      pr_number: 2,
      head_sha: headSha,
      base_sha: '2'.repeat(40),
      base_generation: 1,
      authority_sha: '3'.repeat(40),
      nonce: 'abcdefghijklmnopqrstuv',
      delivery_id: 'delivery-sealed',
      envelope_digest: `sha256:${'4'.repeat(64)}`
    });
    const contexts = Object.fromEntries(Object.keys(app.CHECK_CONTEXTS).map((contextId, index) => [contextId, {
      conclusion: index === 0 ? 'failure' : 'success',
      summary: 'sealed synthetic outcome',
      terminalDigest: `sha256:${String(index + 1).repeat(64)}`
    }]));
    assert.equal((await state.sealPublicationSet(correlationId, {
      attempt_generation: attempt.generation,
      contexts
    })).duplicate, false);
    await state.markPublicationContext(
      correlationId,
      'repository-security-gate',
      contexts['repository-security-gate'].terminalDigest
    );
    assert.equal((await state.getPublicationSet(correlationId)).progress['repository-security-gate'], 'published');
    await assert.rejects(async () => {
      const result = await state.sealPublicationSet(correlationId, {
        attempt_generation: attempt.generation,
        contexts: {
          ...contexts,
          validate: { ...contexts.validate, conclusion: 'failure' }
        }
      });
      if (!result.ok) throw new Error(result.code);
    }, /TK023_PUBLICATION_SET_CONFLICT/);
  });

  await t.test('terminal compaction retains active authority and archives bounded terminal history', async () => {
    const correlations = [];
    for (let index = 0; index < 300; index += 1) {
      correlations.push([`terminal-${index}`, {
        repository_id: 1,
        pr_number: index + 1,
        head_sha: String(index % 10).repeat(40),
        state: 'completed',
        updated_at: '2025-01-01T00:00:00.000Z'
      }]);
    }
    correlations.push(['active', {
      repository_id: 1,
      pr_number: 999,
      head_sha: 'a'.repeat(40),
      state: 'dispatch_unknown',
      updated_at: '2025-01-01T00:00:00.000Z'
    }]);
    const state = new app.MemoryRunState({ correlations });
    await state.compact(Date.parse('2026-07-27T00:00:00.000Z'));
    assert.equal(state.data.correlations.has('active'), true);
    assert.equal([...state.data.correlations.values()].filter((record) => record.state === 'completed').length, 256);
    assert.equal([...state.data.audit.values()].reduce((sum, record) => sum + (record.count || 0), 0), 44);
    const source = fs.readFileSync(path.join(moduleRoot, 'app', 'src', 'run-state.mjs'), 'utf8');
    assert.match(source, /storage\.transaction/);
    assert.match(source, /storage\.delete/);
  });

  await t.test('dispatch intent and publication reconciliation are durable and duplicate deliveries re-enter reconciliation', () => {
    const worker = fs.readFileSync(path.join(moduleRoot, 'app', 'src', 'worker.mjs'), 'utf8');
    assert.match(worker, /dispatch_unknown/);
    assert.match(worker, /discoverDispatchRun/);
    assert.match(worker, /TK023_DISPATCH_OUTCOME_UNKNOWN/);
    assert.match(worker, /sealPublicationSet/);
    assert.match(worker, /markPublicationContext/);
    assert.doesNotMatch(worker, /if \(delivery\.duplicate\) return/);
  });

  await t.test('scheduled recovery terminalizes an expired unknown dispatch without a workflow run or redelivery', async () => {
    const state = new app.MemoryRunState();
    const github = fakeGithub();
    const startedAt = Date.parse('2026-07-27T00:00:00.000Z');
    const expiresAt = new Date(startedAt + 10 * 60 * 1000).toISOString();
    const headSha = '1'.repeat(40);
    const correlationId = 'correlation-scheduled-recovery';
    const attempt = await state.beginAttempt(`1/2/${headSha}`, correlationId, {
      repository_id: 1,
      installation_id: 2,
      repository: 'synthetic/toolkit',
      candidate_repository: 'synthetic/toolkit',
      candidate_repository_id: 1,
      pr_number: 2,
      head_sha: headSha,
      base_sha: '2'.repeat(40),
      base_generation: 1,
      authority_sha: '3'.repeat(40),
      nonce: 'abcdefghijklmnopqrstuv',
      delivery_id: 'delivery-scheduled-recovery',
      envelope_digest: `sha256:${'4'.repeat(64)}`,
      default_branch: 'main',
      expires_at: expiresAt
    }, startedAt);
    await state.transitionCorrelation(correlationId, 'dispatch_intent', {
      ...attempt.existing,
      state: 'dispatch_unknown'
    }, startedAt);
    let discoveryCalls = 0;
    const result = await app.recoverExpiredDispatches({
      APP_ID: '1',
      APP_INTEGRATION_ID: '77',
      APP_PRIVATE_KEY: 'synthetic',
      DISPATCH_SIGNING_PRIVATE_KEY: 'synthetic',
      WEBHOOK_SECRET: 'synthetic',
      ENROLLED_REPOSITORY_IDS: '1'
    }, {
      now: startedAt + 11 * 60 * 1000,
      stateForRepository: () => state,
      tokenForInstallation: async () => 'synthetic-token',
      githubForToken: () => github,
      discoverRun: async () => {
        discoveryCalls += 1;
        return null;
      }
    });
    assert.deepEqual(result, { ok: true, reconciled: 0, terminalized: 1 });
    assert.equal(discoveryCalls, 1);
    assert.equal(state.data.correlations.get(correlationId).state, 'failed');
    const publication = await state.getPublicationSet(correlationId);
    assert.equal(publication.state, 'published');
    assert.deepEqual(Object.keys(publication.contexts).sort(), Object.keys(app.CHECK_CONTEXTS).sort());
    assert.ok(Object.values(publication.contexts).every((context) => context.conclusion === 'failure'));
    assert.ok(Object.values(publication.progress).every((progress) => progress === 'published'));
    assert.equal(state.data.checks.size, 3);
    assert.ok([...state.data.checks.values()].every((check) =>
      check.state === 'completed' && check.conclusion === 'failure'
    ));
  });

  await t.test('artifact admission requires one complete canonical ZIP entry', async () => {
    const canonical = storedZip([['terminal-receipt.json', '{"ok":true}\n']], true);
    const document = await app.extractSingleJsonArtifact(new Response(canonical));
    assert.deepEqual(document, { ok: true });
    const cases = [
      storedZip([
        ['terminal-receipt.json', '{"ok":true}\n'],
        ['extra.json', '{}\n']
      ]),
      storedZip([
        ['terminal-receipt.json', '{"ok":true}\n'],
        ['terminal-receipt.json', '{"ok":false}\n']
      ]),
      Buffer.concat([canonical, Buffer.from('trailing')])
    ];
    const corrupted = storedZip([['terminal-receipt.json', '{"ok":true}\n']]);
    corrupted[corrupted.indexOf(Buffer.from('{"ok":true}'))] ^= 1;
    cases.push(corrupted);
    for (const archive of cases) {
      await assert.rejects(app.extractSingleJsonArtifact(new Response(archive)), /TK023_ARTIFACT_/);
    }
  });

  await t.test('unparseable workflow with duplicate keys is rejected', () => {
    withInventoryPair({
      '.github/workflows/ci.yml': 'name: broken\nname: duplicate\non: pull_request\njobs:\n  build:\n    runs-on: ubuntu-latest\n'
    }, (fixture) => assert.throws(() => fixture.inventory(), /duplicate YAML key/));
  });

  await t.test('reusable-workflow cycle is rejected', () => {
    withInventoryPair({
      '.github/workflows/ci.yml': 'name: caller\non: pull_request\njobs:\n  call:\n    uses: ./.github/workflows/one.yml\n',
      '.github/workflows/one.yml': 'name: one\non: workflow_call\njobs:\n  call:\n    uses: ./.github/workflows/two.yml\n',
      '.github/workflows/two.yml': 'name: two\non: workflow_call\njobs:\n  call:\n    uses: ./.github/workflows/one.yml\n'
    }, (fixture) => assert.throws(() => fixture.inventory(), /cycle/));
  });

  await t.test('candidate replacement of protected workflow cannot replace authority terminals', () => {
    withInventoryPair({
      '.github/workflows/repository-security-gate.yml': 'name: counterfeit\non: pull_request\njobs:\n  fake:\n    name: Counterfeit pass\n    runs-on: ubuntu-latest\n    steps:\n      - run: exit 0\n'
    }, (fixture) => {
      const inventory = fixture.inventory();
      assert.equal(inventory.status, 'PASS');
      assert.equal(inventory.producer_records.filter((item) => item.role === 'authority' && item.job_id.endsWith('-terminal')).length, 3);
      assert.equal(inventory.producer_records.some((item) => item.role === 'candidate' && item.job_id.endsWith('-terminal')), false);
    });
  });

  await t.test('terminal aggregator that never ran cannot verify', async () => {
    const result = await app.verifyEvidenceBundle({
      inventory: {},
      terminal: {},
      artifact_digest: `sha256:${'0'.repeat(64)}`,
      workflow_run: { event: 'workflow_dispatch', head_sha: '4'.repeat(40), run_attempt: 1 },
      current_pr: { state: 'open', head_sha: '1'.repeat(40) },
      oidc_attestation: null
    }, {
      inventory: {},
      terminal: { mandatory_prerequisites: [] },
      artifact_digest: `sha256:${'0'.repeat(64)}`,
      authority_commit: '4'.repeat(40),
      run_attempt: 1,
      head_sha: '1'.repeat(40),
      github_job_id: 8
    });
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes('TK023_TERMINAL_NOT_PASS'));
  });

  await t.test('broader App permissions are rejected', () => {
    assert.deepEqual(app.auditInstallationPermissions({
      actions: 'write',
      checks: 'write',
      statuses: 'write',
      contents: 'write',
      pull_requests: 'read',
      administration: 'write'
    }), [
      'TK023_PERMISSION_ADMINISTRATION_FORBIDDEN',
      'TK023_PERMISSION_CONTENTS_INVALID'
    ]);
  });

  await t.test('commit-status publication is absent and forbidden', () => {
    const sources = fs.readdirSync(path.join(moduleRoot, 'app', 'src'))
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => fs.readFileSync(path.join(moduleRoot, 'app', 'src', name), 'utf8'))
      .join('\n');
    assert.doesNotMatch(sources, /\/statuses\/|createCommitStatus|create_status/);
    assert.match(JSON.stringify(producerConfig), /"commit_status_publication":false/);
  });

  await t.test('Checks publication is reachable only through the typed publisher', () => {
    const publisher = fs.readFileSync(path.join(moduleRoot, 'app', 'src', 'check-publisher.mjs'), 'utf8');
    const worker = fs.readFileSync(path.join(moduleRoot, 'app', 'src', 'worker.mjs'), 'utf8');
    assert.match(publisher, /publishRequiredCheck/);
    assert.match(publisher, /\/check-runs/);
    assert.match(worker, /publishRequiredCheck\(/);
    assert.doesNotMatch(worker, /\/check-runs/);
    assert.equal((worker.match(/github\.(?:createCheckRun|updateCheckRun)\(/g) || []).length, 0);
    assert.throws(() => app.durableCheckKey(1, 2, '1'.repeat(40), 'unlocked-context'), /invalid/);
  });

  await t.test('candidate worker cannot receive an App token', () => {
    const workflows = [
      '.github/workflows/repository-security-gate.yml',
      '.github/workflows/validate.yml',
      '.github/workflows/validate-toolkit.yml'
    ].map((relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')).join('\n');
    assert.doesNotMatch(workflows, /APP_PRIVATE_KEY|INSTALLATION_TOKEN|DISPATCH_SIGNING_PRIVATE_KEY/);
    assert.doesNotMatch(workflows, /checks:\s*write|statuses:\s*write/);
    assert.match(workflows, /GH_TOKEN: ""[\s\S]*GITHUB_TOKEN: ""/);
  });

  await t.test('promotion generation rejects missing integration ID', () => {
    assert.throws(() => generateRulesetPlan(promotionTemplate, null), /integration ID is required/);
    assert.equal(promotionTemplate.required_integration_id, null);
  });

  await t.test('ruleset plan missing a required context is rejected', () => {
    const plan = structuredClone(promotionTemplate);
    plan.atomic_additions.pop();
    assert.throws(() => generateRulesetPlan(plan, 77), /all three/);
  });

  await t.test('ruleset plan removing CodeQL or code quality is rejected', () => {
    for (const property of ['code_scanning', 'code_quality']) {
      const plan = structuredClone(promotionTemplate);
      plan.preserve[property] = null;
      assert.throws(() => generateRulesetPlan(plan, 77), /existing required control/);
    }
  });

  await t.test('generated-surface mismatch is a finding', () => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'tk023-generated-'));
    const authority = path.join(container, 'authority');
    const candidate = path.join(container, 'candidate');
    const operation = path.join(container, 'operation');
    try {
      const generator = `const fs=require('node:fs');const path=require('node:path');const a=process.argv;const root=a[a.indexOf('--workspace')+1];fs.writeFileSync(path.join(root,'generated.txt'),'expected\\n');\n`;
      writeFiles(authority, {
        'generator.cjs': generator,
        'dependency-lock.json': '{}\n'
      });
      const generatorDigest = `sha256:${crypto.createHash('sha256').update(generator).digest('hex')}`;
      const dependencyBytes = '{}\n';
      const dependencyDigest = `sha256:${crypto.createHash('sha256').update(dependencyBytes).digest('hex')}`;
      writeFiles(authority, {
        'lock.json': `${JSON.stringify({
          runtime: { external_packages: [] },
          generators: [{ path: 'generator.cjs', sha256: generatorDigest, arguments: [] }],
          dependency_lock: { path: 'dependency-lock.json', sha256: dependencyDigest },
          network: false,
          candidate_writeback: false
        })}\n`
      });
      writeFiles(candidate, {
        '_projects/sample/toolkit.project.json': '{"outputs":[{"source":"source.txt","output":"generated.txt"}]}\n',
        'source.txt': 'source\n',
        'generated.txt': 'stale\n'
      });
      const authorityCommit = commitRepository(authority);
      const candidateCommit = commitRepository(candidate);
      const result = runGeneratedSurfaceVerification({
        authorityRoot: authority,
        candidateRoot: candidate,
        operationRoot: operation,
        authorityCommit,
        candidateHead: candidateCommit,
        config: { generated_surface: { generator_lock: 'lock.json' } }
      });
      assert.equal(result.status, 'FINDINGS');
      assert.deepEqual(result.mismatched_paths, ['generated.txt']);
    } finally {
      fs.rmSync(container, { recursive: true, force: true });
    }
  });

  await t.test('generated-surface verification expands declared directory copies into exact files', () => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'tk023-generated-directory-'));
    const authority = path.join(container, 'authority');
    const candidate = path.join(container, 'candidate');
    const operation = path.join(container, 'operation');
    try {
      const generator = [
        "const fs=require('node:fs');",
        "const path=require('node:path');",
        "const args=process.argv;",
        "const root=args[args.indexOf('--workspace')+1];",
        "const source=path.join(root,'_projects','sample','_main','source-dir');",
        "const output=path.join(root,'generated-dir');",
        "fs.mkdirSync(path.join(output,'nested'),{recursive:true});",
        "fs.copyFileSync(path.join(source,'alpha.txt'),path.join(output,'alpha.txt'));",
        "fs.copyFileSync(path.join(source,'nested','beta.txt'),path.join(output,'nested','beta.txt'));",
        ''
      ].join('\n');
      const dependencyBytes = '{}\n';
      writeFiles(authority, {
        'generator.cjs': generator,
        'dependency-lock.json': dependencyBytes,
        'lock.json': `${JSON.stringify({
          runtime: { external_packages: [] },
          generators: [{
            path: 'generator.cjs',
            sha256: `sha256:${crypto.createHash('sha256').update(generator).digest('hex')}`,
            arguments: []
          }],
          dependency_lock: {
            path: 'dependency-lock.json',
            sha256: `sha256:${crypto.createHash('sha256').update(dependencyBytes).digest('hex')}`
          },
          network: false,
          candidate_writeback: false
        })}\n`
      });
      writeFiles(candidate, {
        '_projects/sample/toolkit.project.json': `${JSON.stringify({
          module_path: '_projects/sample',
          outputs: [{
            kind: 'copy',
            source: '_main/source-dir',
            output: 'generated-dir'
          }]
        })}\n`,
        '_projects/sample/_main/source-dir/alpha.txt': 'alpha\n',
        '_projects/sample/_main/source-dir/nested/beta.txt': 'beta\n',
        'generated-dir/alpha.txt': 'alpha\n',
        'generated-dir/nested/beta.txt': 'beta\n'
      });
      const authorityCommit = commitRepository(authority);
      const candidateCommit = commitRepository(candidate);
      const result = runGeneratedSurfaceVerification({
        authorityRoot: authority,
        candidateRoot: candidate,
        operationRoot: operation,
        authorityCommit,
        candidateHead: candidateCommit,
        config: { generated_surface: { generator_lock: 'lock.json' } }
      });
      assert.equal(result.status, 'PASS');
      assert.equal(result.output_count, 2);
      assert.equal(result.mismatch_count, 0);
    } finally {
      fs.rmSync(container, { recursive: true, force: true });
    }
  });

  await t.test('protected generator digest mismatch fails closed', () => {
    const container = fs.mkdtempSync(path.join(os.tmpdir(), 'tk023-generator-drift-'));
    const authority = path.join(container, 'authority');
    const candidate = path.join(container, 'candidate');
    try {
      writeFiles(authority, {
        'generator.cjs': 'process.exit(0);\n',
        'dependency-lock.json': '{}\n',
        'lock.json': `${JSON.stringify({
          runtime: { external_packages: [] },
          generators: [{ path: 'generator.cjs', sha256: `sha256:${'0'.repeat(64)}`, arguments: [] }],
          dependency_lock: {
            path: 'dependency-lock.json',
            sha256: `sha256:${crypto.createHash('sha256').update('{}\n').digest('hex')}`
          },
          network: false,
          candidate_writeback: false
        })}\n`
      });
      writeFiles(candidate, {
        '_projects/sample/toolkit.project.json': '{"outputs":[]}\n',
        'README.md': 'synthetic\n'
      });
      const authorityCommit = commitRepository(authority);
      const candidateCommit = commitRepository(candidate);
      assert.throws(() => runGeneratedSurfaceVerification({
        authorityRoot: authority,
        candidateRoot: candidate,
        operationRoot: path.join(container, 'operation'),
        authorityCommit,
        candidateHead: candidateCommit,
        config: { generated_surface: { generator_lock: 'lock.json' } }
      }), /Protected generator digest mismatch/);
    } finally {
      fs.rmSync(container, { recursive: true, force: true });
    }
  });

  await t.test('state-store loss with ambiguous reconstruction fails closed', async () => {
    const state = new app.MemoryRunState();
    await state.putCorrelation('one', { repository_id: 1, head_sha: '1'.repeat(40) });
    await state.putCorrelation('two', { repository_id: 1, head_sha: '1'.repeat(40) });
    const matches = (await state.listCorrelations()).filter((item) => item.record.head_sha === '1'.repeat(40));
    assert.equal(matches.length, 2);
    const worker = fs.readFileSync(path.join(moduleRoot, 'app', 'src', 'worker.mjs'), 'utf8');
    assert.match(worker, /candidates\.length !== 1/);
    assert.match(worker, /TK023_CORRELATION_AMBIGUOUS/);
  });

  await t.test('duplicate deliveries and nonces are idempotent but conflicting replay is rejected', async () => {
    const state = new app.MemoryRunState();
    assert.equal((await state.acceptDelivery('delivery-1', `sha256:${'1'.repeat(64)}`)).duplicate, false);
    assert.equal((await state.acceptDelivery('delivery-1', `sha256:${'1'.repeat(64)}`)).duplicate, true);
    assert.equal((await state.acceptDelivery('delivery-1', `sha256:${'2'.repeat(64)}`)).code, 'TK023_DELIVERY_CONFLICT');
    const expiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    assert.equal((await state.acceptNonce('nonce-value', 'correlation-1', expiry)).duplicate, false);
    assert.equal((await state.acceptNonce('nonce-value', 'correlation-1', expiry)).duplicate, true);
    assert.equal((await state.acceptNonce('nonce-value', 'correlation-2', expiry)).code, 'TK023_NONCE_REPLAY');
  });

  await t.test('correlation state advances exactly once and terminal receipts retain fail-closed report state', async () => {
    const state = new app.MemoryRunState();
    const record = {
      repository_id: 1,
      installation_id: 2,
      repository: 'synthetic/toolkit',
      candidate_repository: 'synthetic/fork',
      candidate_repository_id: 3,
      pr_number: 4,
      head_sha: '1'.repeat(40),
      base_sha: '2'.repeat(40),
      base_generation: 5,
      authority_sha: '3'.repeat(40),
      nonce: 'abcdefghijklmnopqrstuv',
      delivery_id: 'delivery-1',
      envelope_digest: `sha256:${'4'.repeat(64)}`,
      state: 'dispatched'
    };
    assert.equal((await state.putCorrelation('correlation-1', record)).ok, true);
    assert.equal((await state.transitionCorrelation('correlation-1', 'dispatched', { ...record, state: 'completed' })).ok, true);
    assert.equal(
      (await state.transitionCorrelation('correlation-1', 'dispatched', { ...record, state: 'failed' })).code,
      'TK023_CORRELATION_STATE_CONFLICT'
    );
    const options = terminalOptions();
    options.reportState = 'SECURITY_GATE_UNVERIFIED';
    const receipt = buildTerminalReceipt(options);
    assert.equal(receipt.status, 'FAIL');
    assert.equal(receipt.report_state, 'SECURITY_GATE_UNVERIFIED');
  });
});

test('evidence schemas are strict, bounded, and contain no raw diagnostic fields', () => {
  for (const name of ['producer-inventory.schema.json', 'terminal-receipt.schema.json', 'publication-receipt.schema.json']) {
    const schema = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'schemas', name), 'utf8'));
    assert.equal(schema.additionalProperties, false, name);
    assert.doesNotMatch(JSON.stringify(schema), /raw_output|stdout|stderr|environment|source_excerpt/);
  }
});

test('source-only App package has zero third-party runtime dependencies and no deployment route', () => {
  const packageDocument = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'app', 'package.json'), 'utf8'));
  const wrangler = fs.readFileSync(path.join(moduleRoot, 'app', 'wrangler.jsonc'), 'utf8');
  const project = JSON.parse(fs.readFileSync(
    path.join(repoRoot, '_projects', 'cicd', 'repository-security-gate', 'toolkit.project.json'),
    'utf8'
  ));
  assert.deepEqual(packageDocument.dependencies, {});
  assert.doesNotMatch(JSON.stringify(project.outputs), /_main\/app/);
  assert.doesNotMatch(wrangler, /routes|account_id/);
});

test('producer inventory binds the complete App source closure and one typed publisher', () => {
  withInventoryPair({
    '.github/workflows/ci.yml': baselineCandidate()
  }, (fixture) => {
    const inventory = fixture.inventory();
    const appFiles = inventory.files.filter((item) => item.kind === 'app-authority');
    assert.equal(appFiles.length, producerConfig.app.source_files.length);
    assert.deepEqual(
      appFiles.map((item) => item.path).sort(),
      producerConfig.app.source_files
        .map((relative) => `${producerConfig.app.source_root}/${relative}`)
        .sort()
    );
    assert.ok(inventory.required_contexts.every((context) => context.publisher_declarations === 1));
  });
});

test('App dispatch resolves protected authority from the live default branch and OIDC binds both job identities', () => {
  const worker = fs.readFileSync(path.join(moduleRoot, 'app', 'src', 'worker.mjs'), 'utf8');
  const evidence = fs.readFileSync(path.join(moduleRoot, 'app', 'src', 'evidence-verifier.mjs'), 'utf8');
  assert.match(worker, /repositoryMetadata\.default_branch/);
  assert.match(worker, /defaultBranchState\.commit\?\.sha/);
  assert.match(worker, /ref: correlation\.record\.default_branch/);
  assert.doesNotMatch(worker, /authoritySha\s*=\s*requiredSha\([^;]*baseSha/s);
  assert.match(evidence, /oidc_attestation\.job_id !== expected\.terminal\.job_id/);
  assert.match(evidence, /oidc_attestation\.github_job_id !== expected\.github_job_id/);
});

test('purpose-built protected Toolkit invariants pass current inputs and reject every negative fixture', () => {
  const harness = path.join(moduleRoot, 'tools', 'protected-toolkit-invariants.cjs');
  const fixtures = path.join(moduleRoot, 'fixtures', 'protected-toolkit-invariants', 'negative-cases.json');
  const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'config', 'invariants.json'), 'utf8'));
  const negative = spawnSync(process.execPath, [harness, 'self-test', '--fixtures', fixtures], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(negative.status, 0, negative.stderr);
  assert.equal(JSON.parse(negative.stdout).count, manifest.protected_invariants.length);
  for (const invariant of manifest.protected_invariants) {
    const result = spawnSync(process.execPath, [
      harness,
      'run',
      '--id', invariant.id,
      '--authority-root', repoRoot,
      '--candidate-root', repoRoot
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    assert.equal(result.status, 0, `${invariant.id}: ${result.stderr}`);
    const evidence = JSON.parse(result.stdout);
    assert.equal(evidence.status, 'PASS', invariant.id);
    assert.match(evidence.input_manifest_digest, /^sha256:[0-9a-f]{64}$/);
  }
});
