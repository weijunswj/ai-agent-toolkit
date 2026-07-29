'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const YAML = require('yaml');

const repoRoot = path.resolve(__dirname, '..', '..');
const trusted = path.join(repoRoot, 'repo', 'scripts', 'trusted-workflows');
const autoPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
const sourcePath = path.join(repoRoot, '.github', 'workflows', 'source-watch-pr.yml');
const auto = YAML.parse(fs.readFileSync(autoPath, 'utf8'));
const source = YAML.parse(fs.readFileSync(sourcePath, 'utf8'));
const policies = require(path.join(trusted, 'writeback-policy.cjs'));
const rehearsalVerifier = require(path.join(trusted, 'auto-sync', 'verify-rehearsal-pr.cjs'));

function steps(workflow, job) {
  return workflow.jobs[job].steps;
}

test('pull_request_target executes the canonical base workflow authority', function() {
  assert.ok(auto.on.pull_request_target);
  const values = steps(auto, 'auto-sync-generated-surfaces');
  const trustedIndex = values.findIndex(function(step) { return step.id === 'checkout_trusted_base'; });
  const preflightIndex = values.findIndex(function(step) { return step.name === 'Preflight guard'; });
  const verifyIndex = values.findIndex(function(step) { return step.id === 'verify_rehearsal_pr'; });
  const prIndex = values.findIndex(function(step) { return step.id === 'checkout_pr_data'; });
  const dryRunIndex = values.findIndex(function(step) { return step.name === 'Emit deterministic dry-run proposal'; });
  const revalidateIndex = values.findIndex(function(step) { return step.id === 'revalidate_rehearsal_pr'; });
  assert.ok(trustedIndex >= 0 && trustedIndex < preflightIndex && preflightIndex < verifyIndex &&
    verifyIndex < prIndex && prIndex < dryRunIndex && dryRunIndex < revalidateIndex);
  assert.equal(values[trustedIndex].with.ref, '${{ github.event.repository.default_branch }}');
  assert.equal(values[prIndex].if, "${{ github.event_name == 'workflow_dispatch' }}");
  assert.equal(values[prIndex].with.ref, '${{ steps.verify_rehearsal_pr.outputs.head_sha }}');
});

test('Stage A auto-sync writeback is structurally disabled', function() {
  assert.deepEqual(auto.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.deepEqual(policies.AUTO_SYNC_POLICY, { rollout_stage: 'A', writeback_enabled: false, general_enabled: false });
  const reachable = steps(auto, 'auto-sync-generated-surfaces').filter(function(step) {
    return step.if !== '${{ false }}' && !/checkout pr head/i.test(step.name || '');
  });
  assert.equal(reachable.some(function(step) { return /commit|push/i.test(step.name || ''); }), false);
  assert.equal(auto.env.WRITEBACK_ENABLED, 'false');
  assert.equal(auto.env.GENERAL_ENABLED, 'false');
});

test('Stage A auto-sync dry-run emits strict no-write evidence', function() {
  const helper = path.join(trusted, 'auto-sync', 'dry-run.cjs');
  const result = spawnSync(process.execPath, [helper, '310', '1ec500712bdf043ab261cbbe2b4003713d3ebfee', 'pull_request_target', ''], {
    cwd: repoRoot, encoding: 'utf8', timeout: 5000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^\{[^\r\n]*\}\n$/);
  const value = JSON.parse(result.stdout);
  assert.equal(value.commit_attempts, 0);
  assert.equal(value.push_attempts, 0);
  assert.equal(value.checkout_executed_as_code, false);
  assert.equal(value.rehearsal_executed, false);
});

test('Stage A manual rehearsal generates the exact proposal in PR data without executing it', function() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-a-rehearsal-'));
  const prRoot = path.join(workspace, 'pr');
  const originalPolicyHash = fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'issue-governance', '_main', 'policy', 'issue-governance-policy.json'));
  fs.cpSync(repoRoot, prRoot, {
    recursive: true,
    filter: function(source) {
      const relative = path.relative(repoRoot, source);
      return relative !== '.git' && !relative.startsWith('.git' + path.sep) &&
        relative !== 'node_modules' && !relative.startsWith('node_modules' + path.sep);
    }
  });
  const source = path.join(prRoot, '_projects', 'development', 'issue-governance', 'curated_output_for_ai', 'skills', 'issue-governance', 'README.md');
  const marker = '\nStage A bounded rehearsal marker.\n';
  fs.appendFileSync(source, marker);
  const git = function(args) {
    const value = spawnSync('git', args, { cwd: prRoot, encoding: 'utf8', timeout: 30000 });
    assert.equal(value.status, 0, value.stderr);
  };
  try {
    git(['init', '--quiet']);
    git(['config', 'user.email', 'stage-a@example.invalid']);
    git(['config', 'user.name', 'Stage A Test']);
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'fixture']);
    const helper = path.join(trusted, 'auto-sync', 'dry-run.cjs');
    const generated = spawnSync(process.execPath, [helper, '310', '1'.repeat(40), 'workflow_dispatch', prRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, GITHUB_WORKSPACE: workspace }
    });
    assert.equal(generated.status, 0, generated.stderr);
    assert.equal(generated.stderr, '');
    assert.match(generated.stdout, /^\{[^\r\n]*\}\n$/);
    const evidence = JSON.parse(generated.stdout);
    assert.equal(evidence.rehearsal_executed, true);
    assert.equal(evidence.generated_change_count, 1);
    assert.match(evidence.generated_change_digest, /^[0-9a-f]{64}$/);
    assert.match(fs.readFileSync(path.join(prRoot, 'skills', 'issue-governance', 'README.md'), 'utf8'), /Stage A bounded rehearsal marker/);
    assert.deepEqual(
      fs.readFileSync(path.join(repoRoot, '_projects', 'development', 'issue-governance', '_main', 'policy', 'issue-governance-policy.json')),
      originalPolicyHash
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

function validPullRequestRecord() {
  return {
    number: 310,
    state: 'open',
    base: {
      ref: 'main',
      repo: { id: 10020053, full_name: 'weijunswj/ai-agent-toolkit' }
    },
    head: {
      sha: '1'.repeat(40),
      repo: { id: 10020053, full_name: 'weijunswj/ai-agent-toolkit' }
    }
  };
}

function expectedRehearsal(phase = 'initial') {
  return rehearsalVerifier.expectedTuple(
    phase,
    '10020053',
    'weijunswj/ai-agent-toolkit',
    '310',
    '1'.repeat(40)
  );
}

test('manual rehearsal rejects the wrong PR number returned by API authority', function() {
  assert.throws(function() {
    rehearsalVerifier.verifyRecord({ ...validPullRequestRecord(), number: 311 }, expectedRehearsal());
  }, /TW_REHEARSAL_PR_MISMATCH/);
});

test('manual rehearsal rejects a requested head that differs from the current PR head', function() {
  const record = validPullRequestRecord();
  record.head.sha = '2'.repeat(40);
  assert.throws(function() { rehearsalVerifier.verifyRecord(record, expectedRehearsal()); }, /TW_REHEARSAL_HEAD_MISMATCH/);
});

test('manual rehearsal revalidation rejects head movement after the dry run', function() {
  const frozen = rehearsalVerifier.verifyRecord(validPullRequestRecord(), expectedRehearsal());
  const moved = validPullRequestRecord();
  moved.head.sha = '2'.repeat(40);
  const expected = rehearsalVerifier.expectedTuple(
    'revalidate',
    frozen.repository_id,
    frozen.repository,
    String(frozen.pr_number),
    frozen.head_sha
  );
  assert.throws(function() { rehearsalVerifier.verifyRecord(moved, expected); }, /TW_REHEARSAL_HEAD_MISMATCH/);
});

test('manual rehearsal rejects a fork pull request', function() {
  const record = validPullRequestRecord();
  record.head.repo = { id: 999, full_name: 'fork/repository' };
  assert.throws(function() { rehearsalVerifier.verifyRecord(record, expectedRehearsal()); }, /TW_REHEARSAL_FORK/);
});

test('manual rehearsal rejects a pull request targeting the wrong base', function() {
  const record = validPullRequestRecord();
  record.base.ref = 'release';
  assert.throws(function() { rehearsalVerifier.verifyRecord(record, expectedRehearsal()); }, /TW_REHEARSAL_BASE/);
});

test('manual rehearsal revalidation rejects a PR closed during rehearsal', function() {
  const record = validPullRequestRecord();
  record.state = 'closed';
  assert.throws(function() { rehearsalVerifier.verifyRecord(record, expectedRehearsal('revalidate')); }, /TW_REHEARSAL_NOT_OPEN/);
});

test('manual rehearsal accepts and freezes one exact verified PR tuple', function() {
  const tuple = rehearsalVerifier.verifyRecord(validPullRequestRecord(), expectedRehearsal());
  assert.deepEqual({
    repository_id: tuple.repository_id,
    repository: tuple.repository,
    pr_number: tuple.pr_number,
    head_sha: tuple.head_sha,
    base_ref: tuple.base_ref,
    state: tuple.state,
    same_repository: tuple.same_repository
  }, {
    repository_id: '10020053',
    repository: 'weijunswj/ai-agent-toolkit',
    pr_number: 310,
    head_sha: '1'.repeat(40),
    base_ref: 'main',
    state: 'open',
    same_repository: true
  });
  assert.match(tuple.tuple_digest, /^[0-9a-f]{64}$/);
});

test('manual rehearsal workflow emits only verified tuple outputs after read-only API checks', function() {
  const values = steps(auto, 'auto-sync-generated-surfaces');
  const verify = values.find(function(step) { return step.id === 'verify_rehearsal_pr'; });
  const dryRun = values.find(function(step) { return step.name === 'Emit deterministic dry-run proposal'; });
  const revalidate = values.find(function(step) { return step.id === 'revalidate_rehearsal_pr'; });
  assert.equal(verify.env.GITHUB_TOKEN, '${{ github.token }}');
  assert.equal(verify.env.GITHUB_API_URL, '${{ github.api_url }}');
  assert.match(verify.run, /verify-rehearsal-pr\.cjs/);
  assert.equal(dryRun.env.PR_NUMBER, '${{ github.event.pull_request.number || steps.verify_rehearsal_pr.outputs.pr_number }}');
  assert.equal(dryRun.env.HEAD_SHA, '${{ github.event.pull_request.head.sha || steps.verify_rehearsal_pr.outputs.head_sha }}');
  assert.match(revalidate.run, /revalidate/);
  assert.equal(rehearsalVerifier.TIMEOUT_MS, 10000);
  assert.equal(rehearsalVerifier.MAX_RESPONSE_BYTES, 256 * 1024);
});

test('Stage A source-watch is a scheduled-only notification with canonical PR #316 lifecycle', function() {
  assert.ok(source.on.schedule);
  assert.equal(Object.hasOwn(source.on, 'workflow_dispatch'), false);
  assert.equal(Object.hasOwn(source.on, 'repository_dispatch'), false);
  assert.equal(Object.hasOwn(source.on, 'pull_request'), false);
  assert.equal(Object.hasOwn(source.on, 'pull_request_target'), false);
  assert.equal(Object.hasOwn(source.on, 'workflow_call'), false);
  assert.deepEqual(source.permissions, { contents: 'write', 'pull-requests': 'write' });
  const text = fs.readFileSync(sourcePath, 'utf8');
  assert.equal(/^\s*issues:\s*write\s*$/m.test(text), false, 'no issues: write');
  assert.equal(/^\s*id-token:\s*write\s*$/m.test(text), false, 'no id-token: write');
  assert.equal(/^\s*actions:\s*write\s*$/m.test(text), false, 'no actions: write');
  assert.ok(text.includes('plan-source-watch-pr-lifecycle.cjs'), 'planner present');
  assert.ok(text.includes('--mode plan'), 'plan mode present');
  assert.ok(text.includes('--mode verify-plan'), 'stale-plan check present');
  assert.ok(text.includes('verify_fresh_plan'), 'fresh plan guard present');
  assert.ok(text.includes('CAPTURE_NODE_TOOLCHAIN_SHA256'), 'bootstrap digest pin present');
  assert.ok(text.includes('VERIFY_CLOSURE_MANIFEST_SHA256'), 'bootstrap digest pin present');
});

test('Stage B1 canary and Stage B2 general activation remain separate controller gates', function() {
  const document = fs.readFileSync(path.join(repoRoot, 'repo', 'docs', 'trusted-workflow-rollout.md'), 'utf8');
  const template = fs.readFileSync(path.join(repoRoot, '.github', 'ISSUE_TEMPLATE', 'privileged-workflow-activation.md'), 'utf8');
  assert.match(document, /Stage B1[\s\S]*exact canary PR number and head SHA/i);
  assert.match(document, /Stage B2[\s\S]*second reviewed PR/i);
  assert.match(template, /General enablement remains false/);
});

test('all privileged external actions are full-SHA manifest-bound and used once', function() {
  const manifest = JSON.parse(fs.readFileSync(path.join(trusted, 'external-actions-manifest.json'), 'utf8'));
  const privileged = [
    ['.github/workflows/auto-sync-generated-surfaces.yml', auto],
    ['.github/workflows/source-watch-pr.yml', source]
  ];
  const observed = [];
  for (const [workflowPath, workflow] of privileged) {
    for (const [jobId, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps) {
        if (!step.uses) continue;
        assert.match(step.uses, /^[^@]+@[0-9a-f]{40}$/);
        observed.push(workflowPath + '#' + jobId + '.' + step.id);
        if (step.uses.startsWith('actions/setup-node@')) assert.equal(step.with['package-manager-cache'], false);
      }
    }
  }
  const declared = manifest.actions.flatMap(function(action) { return action.locations; }).sort();
  assert.deepEqual(observed.sort(), declared);
});

test('bootstrap hashing uses only the locked absolute executable and exact arguments', function() {
  for (const workflowPath of [autoPath, sourcePath]) {
    const text = fs.readFileSync(workflowPath, 'utf8');
    const invocations = text.match(/\/usr\/bin\/sha256sum --binary -- [A-Za-z0-9_./-]+/g) || [];
    assert.equal(invocations.length, 2);
    assert.equal(text.includes('sha256sum --check'), false);
    assert.equal(text.includes('/usr/bin/sha256sum --binary -- repo/scripts/trusted-workflows/capture-node-toolchain.cjs'), true);
    assert.equal(text.includes('/usr/bin/sha256sum --binary -- repo/scripts/trusted-workflows/verify-closure-manifest.cjs'), true);
  }
});

test('source-watch append-only planner refuses branch movement and never selects force', function() {
  const planner = require(path.join(trusted, 'source-watch', 'update-notification.cjs')).planAppendOnlyUpdate;
  const base = { main_sha: 'a'.repeat(40), digest: 'b'.repeat(64), branch_exists: true, old_sha: 'c'.repeat(40), reread_sha: 'c'.repeat(40), historical_safe: true, bytes_changed: true };
  assert.deepEqual(planner(base), { action: 'fast-forward', expected_old_sha: 'c'.repeat(40) });
  assert.deepEqual(planner({ ...base, reread_sha: 'd'.repeat(40) }), { action: 'retry-from-new-tip', observed_sha: 'd'.repeat(40) });
  assert.equal(fs.readFileSync(path.join(trusted, 'source-watch', 'update-notification.cjs'), 'utf8').includes('force'), false);
});

test('source-watch notification PR deduplication is exact', function() {
  const choose = require(path.join(trusted, 'source-watch', 'upsert-notification-pr.cjs')).chooseNotificationPR;
  const digest = 'a'.repeat(64);
  assert.deepEqual(choose([], digest), { action: 'create-one', branch: 'source-watch/aaaaaaaaaaaa' });
  assert.deepEqual(choose([{ number: 7, head: 'source-watch/aaaaaaaaaaaa', state: 'open' }], digest), {
    action: 'update-existing', number: 7, branch: 'source-watch/aaaaaaaaaaaa'
  });
  assert.throws(function() {
    choose([{ number: 7, head: 'source-watch/aaaaaaaaaaaa', state: 'open' }, { number: 8, head: 'source-watch/aaaaaaaaaaaa', state: 'open' }], digest);
  }, /AMBIGUOUS/);
});
