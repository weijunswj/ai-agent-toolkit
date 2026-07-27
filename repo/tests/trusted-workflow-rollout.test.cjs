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

function steps(workflow, job) {
  return workflow.jobs[job].steps;
}

test('pull_request_target executes the canonical base workflow authority', function() {
  assert.ok(auto.on.pull_request_target);
  const values = steps(auto, 'auto-sync-generated-surfaces');
  const trustedIndex = values.findIndex(function(step) { return step.id === 'checkout_trusted_base'; });
  const preflightIndex = values.findIndex(function(step) { return step.name === 'Preflight guard'; });
  const prIndex = values.findIndex(function(step) { return step.id === 'checkout_pr_data'; });
  assert.ok(trustedIndex >= 0 && trustedIndex < preflightIndex && preflightIndex < prIndex);
  assert.equal(values[trustedIndex].with.ref, '${{ github.event.repository.default_branch }}');
  assert.equal(values[prIndex].if, "${{ github.event_name == 'workflow_dispatch' }}");
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

test('Stage A source-watch is inert for schedule and manual dispatch', function() {
  assert.ok(source.on.schedule);
  assert.ok(Object.hasOwn(source.on, 'workflow_dispatch'));
  assert.deepEqual(source.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.deepEqual(policies.SOURCE_WATCH_POLICY, {
    rollout_stage: 'A',
    publication_mode: 'dry-run',
    scheduled_write_enabled: false,
    manual_canary_enabled: false,
    general_publication_enabled: false
  });
  const text = fs.readFileSync(sourcePath, 'utf8');
  for (const forbidden of ['git push', 'gh pr create', 'git commit', 'force-with-lease']) assert.equal(text.includes(forbidden), false);
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
