'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const drift = require('../../skills/external-system-router/scripts/external-capability-drift.cjs');
const router = require('../../skills/external-system-router/scripts/external-system-router.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'external-capability-drift-'));
}

test('deterministic drift emits only new material sanitized evidence and deduplicates unchanged findings', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'value.json'), '{"version":"2.0.0"}\n');
  const config = {
    schemaVersion: drift.CONFIG_SCHEMA_VERSION,
    targets: [{
      key: 'adapter-version',
      kind: 'adapter-version',
      path: 'config/value.json',
      mode: 'json-value-sha256',
      jsonPointer: '/version',
      expectedDigest: router.sha256('1.0.0'),
      publicReference: 'https://github.com/weijunswj/ai-agent-toolkit'
    }]
  };
  fs.writeFileSync(path.join(root, 'config', 'targets.json'), JSON.stringify(config));
  const state = path.join(root, '.tmp', 'external-capability-drift-state.json');
  const output = path.join(root, '.tmp', 'external-capability-drift-report.json');
  const first = drift.run({
    'repository-root': root,
    config: 'config/targets.json',
    state,
    output,
    now: '2026-07-23T00:00:00.000Z'
  });
  assert.equal(first.noAction, false);
  assert.equal(first.findings.length, 1);
  assert.deepEqual(first.guarantees, {
    aiCalls: false,
    browserAccess: false,
    secretReads: false,
    providerWrites: false,
    integrationMutation: false,
    routePromotionOrDemotion: false,
    credentialOperations: false,
    configurationMutation: false
  });
  const second = drift.run({
    'repository-root': root,
    config: 'config/targets.json',
    state,
    output,
    now: '2026-07-23T01:00:00.000Z'
  });
  assert.equal(second.noAction, true);
  assert.deepEqual(second.findings, []);
});

test('drift target paths reject traversal and secret-bearing locations', () => {
  const root = tempRoot();
  assert.throws(() => drift.resolveAllowlistedPath(root, '../outside.json'), /escapes/);
  assert.throws(() => drift.resolveAllowlistedPath(root, '.env.production'), /secret-bearing/);
  assert.throws(() => drift.evaluateTarget(root, {
    key: 'unsafe-upstream',
    kind: 'upstream-release',
    mode: 'git-public-ref-sha256',
    repository: 'https://provider.example/private.git',
    ref: 'refs/heads/main',
    expectedDigest: `sha256:${'a'.repeat(64)}`,
    publicReference: 'https://provider.example/private'
  }, Date.parse('2026-07-23T00:00:00.000Z')), /not allowlisted/);
  assert.throws(() => drift.resolveLocalOutputPath(root, path.join(root, 'README.md'), 'external-capability-drift-report.json'), /exact ignored Toolkit \.tmp path/);
  assert.throws(() => drift.validatePreviousState({ findingDigests: ['not-a-digest'] }), /invalid digest/);
  assert.throws(() => drift.evaluateTarget(root, {
    key: 'credential-bearing-reference', kind: 'stale-audit', lastAuditedAt: '2026-07-22T00:00:00.000Z', maxAgeHours: 1,
    expectedDigest: `sha256:${'a'.repeat(64)}`, publicReference: 'https://user:password@example.com/private'
  }, Date.parse('2026-07-23T00:00:00.000Z')), /credential-free public HTTPS/);
});

test('file drift hashes exact bytes and rejects symlinked evidence', (t) => {
  const root = tempRoot();
  const target = path.join(root, 'value.bin');
  const bytes = Buffer.from([0, 1, 2, 255]);
  fs.writeFileSync(target, bytes);
  const evidence = drift.evaluateTarget(root, {
    key: 'exact-file', kind: 'tool-schema', mode: 'file-sha256', path: 'value.bin',
    expectedDigest: router.sha256(Buffer.from([9])),
    publicReference: 'https://github.com/weijunswj/ai-agent-toolkit'
  }, Date.parse('2026-07-23T00:00:00.000Z'));
  assert.equal(evidence.currentDigest, router.sha256(bytes));

  const outside = path.join(tempRoot(), 'outside.json');
  const link = path.join(root, 'linked.json');
  fs.writeFileSync(outside, '{}');
  try { fs.symlinkSync(outside, link); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(`symlink creation is unavailable: ${error.code}`);
    throw error;
  }
  assert.throws(() => drift.resolveAllowlistedPath(root, 'linked.json'), /non-symlink/);
});

test('hourly workflow is no-AI, credential-free, read-only, and uploads only new material evidence', () => {
  const root = path.resolve(__dirname, '..', '..');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'external-capability-drift.yml'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'repo', 'external-capability', 'targets.json'), 'utf8'));
  assert.match(workflow, /cron: "17 \* \* \* \*"/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /if: steps\.drift\.outputs\.material == 'true'/);
  assert.doesNotMatch(workflow, /openai|anthropic|playwright|secrets\./i);
  assert.doesNotMatch(workflow, /pull_request_target|contents: write|issues: write|git push|curl|Invoke-WebRequest/i);
  assert.ok(
    workflow.indexOf('Upload sanitized evidence only for new material drift')
      < workflow.indexOf('Save deduplication state only after evidence upload succeeds'),
    'deduplication state must be saved only after evidence upload'
  );
  const upstream = config.targets.find((target) => target.key === 'official-n8n-skills-main');
  assert.equal(upstream.mode, 'git-public-ref-sha256');
  assert.equal(upstream.repository, 'https://github.com/n8n-io/skills.git');
  assert.equal(upstream.ref, 'refs/heads/main');
  assert.match(upstream.expectedDigest, /^sha256:[0-9a-f]{64}$/);
  const routerTarget = config.targets.find((target) => target.key === 'external-system-router-version');
  const routerProject = JSON.parse(fs.readFileSync(path.join(root, '_projects', 'development', 'external-system-router', 'toolkit.project.json'), 'utf8'));
  assert.equal(routerTarget.expectedDigest, router.sha256(routerProject.version));
  assert.equal(JSON.stringify(config).includes('token'), false);
});
