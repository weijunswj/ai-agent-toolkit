'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const test = require('node:test');
const reviewState = require('../scripts/source-watch-review-state.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'repo', 'scripts', 'check-project-source-updates.cjs');

const lockedSha = '1111111111111111111111111111111111111111';
const latestSha = '2222222222222222222222222222222222222222';
const advisoryBaselineSha = '3333333333333333333333333333333333333333';
const advisoryLatestSha = '4444444444444444444444444444444444444444';
const reviewedSourceSha = '5555555555555555555555555555555555555555';
const reviewedAdvisorySha = '6666666666666666666666666666666666666666';
const newerSeededSha = '7777777777777777777777777777777777777777';
const bidiControlPattern = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function activeLock(sourceCommit = lockedSha) {
  return {
    source_repo: 'example-owner/example-repo',
    source_ref: 'main',
    source_commit: sourceCommit,
    source_lifecycle: 'active',
    source_role: 'third_party_attribution_source',
    source_update_policy: 'manual_review_required',
    public_attribution_required: true,
    files: [
      {
        mode: 'exact',
        source_path: 'src/data.csv',
        project_path: '_projects/design/example/_main/src/data.csv',
        source_blob_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      },
      {
        mode: 'adapted',
        source_path: 'src/tool.js',
        project_path: '_projects/design/example/_main/src/tool.js',
        source_blob_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        notes: 'Adapted for toolkit local-only execution.'
      },
      {
        mode: 'excluded',
        source_path: 'package.json',
        notes: 'Excluded from the toolkit subset.'
      }
    ]
  };
}

function retiredLock() {
  return {
    source_repo: 'weijunswj/retired-source',
    source_ref: 'main',
    source_commit: 'retired-source-marker',
    source_lifecycle: 'retired_after_migration',
    source_role: 'migration_provenance_only',
    source_update_policy: 'none',
    public_attribution_required: false,
    files: []
  };
}

function advisoryDoc(targets) {
  return {
    schema_version: 1,
    policy: {
      report_only_when_actionable: true,
      maintenance_note: 'When a daily PR asks for action, update recommendation, action_taken, and remaining_work; remove a target once SOURCE-LOCK daily source-watch owns it or it is no longer relevant.'
    },
    targets
  };
}

function reviewStateDoc(records) {
  return {
    schema_version: 1,
    policy: {
      cursor_advancement: 'human_advanced_only',
      runtime_updates: 'forbidden',
      adoption_and_review_are_distinct: true
    },
    records: records.sort((a, b) => a.target_key.localeCompare(b.target_key))
  };
}

function sourceReviewRecord({
  projectPath = '_projects/design/example',
  sourceLockPath = `${projectPath}/SOURCE-LOCK.json`,
  repository = 'example-owner/example-repo',
  ref = 'main',
  reviewedThroughSha = reviewedSourceSha,
  disposition = 'READ_ONLY_REVIEW_REQUIRED',
  owningTracker = '#315'
} = {}) {
  return {
    target_key: `source-lock:${projectPath}`,
    target_kind: 'source_lock',
    repository,
    ref,
    source_lock_path: sourceLockPath,
    reviewed_through_sha: reviewedThroughSha,
    reviewed_at: '2026-07-30',
    disposition,
    owning_tracker: owningTracker
  };
}

function advisoryReviewRecord({
  id = 'okf-spec',
  kind = 'github_path',
  repository = 'example-org/knowledge-catalog',
  ref = 'main',
  path: targetPath = 'okf/SPEC.md',
  reviewedThroughSha = reviewedAdvisorySha,
  disposition = 'READ_ONLY_REVIEW_REQUIRED',
  owningTracker = '#248'
} = {}) {
  const record = {
    target_key: `advisory:${id}`,
    target_kind: 'advisory',
    repository,
    ref,
    advisory_target_id: id,
    reviewed_through_sha: reviewedThroughSha,
    reviewed_at: '2026-07-30',
    disposition,
    owning_tracker: owningTracker
  };
  if (kind === 'github_path') record.path = targetPath;
  return record;
}

function githubPathAdvisory(overrides = {}) {
  return {
    id: 'okf-spec',
    name: 'Open Knowledge Format draft spec',
    kind: 'github_path',
    enabled: true,
    state: 'watching',
    repo: 'example-org/knowledge-catalog',
    ref: 'main',
    path: 'okf/SPEC.md',
    baseline_sha: advisoryBaselineSha,
    baseline_policy: 'human_advanced_only',
    recommendation: 'Review draft spec changes only; do not copy spec text from the daily source-watch PR.',
    action_taken: 'Not implemented in toolkit source.',
    remaining_work: 'Decide whether any reviewed concept should become first-party toolkit documentation.',
    removal_condition: 'Remove this advisory target after any accepted concept is implemented and normal SOURCE-LOCK tracking owns future upstream source drift.',
    ...overrides
  };
}

function manualAdvisory(overrides = {}) {
  return {
    id: 'planning-note',
    name: 'Planning note',
    kind: 'manual',
    enabled: true,
    state: 'watching',
    recommendation: 'Keep for reference only.',
    action_taken: 'No toolkit action needed.',
    remaining_work: 'None.',
    removal_condition: 'Remove when no longer relevant.',
    ...overrides
  };
}

function hostHarnessReviewTarget(overrides = {}) {
  return {
    id: 'host-harness-capability-drift-review',
    name: 'Host Harness Capability Drift Review',
    kind: 'manual',
    enabled: true,
    state: 'watching',
    review_cadence_days: 90,
    last_reviewed_at: null,
    review_template: 'repo/source-watch/templates/host-harness-capability-drift-review.md',
    evidence_sources: [
      'OpenAI Codex changelog: https://developers.openai.com/codex/changelog',
      'Claude Code changelog: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md'
    ],
    toolkit_scope: [
      'skills/**',
      'AGENTS.md, CLAUDE.md, GEMINI.md, and .agents/rules/**',
      'MEMORY.md guidance'
    ],
    classification_options: [
      'Keep',
      'Shrink',
      'Move to hook',
      'Move to host-native feature',
      'Delete',
      'Needs benchmark/eval before decision'
    ],
    recommendation: 'Run the template on cadence.',
    action_taken: 'Review lane added. No toolkit component has been changed by source-watch.',
    remaining_work: 'Perform the next cadence review using the template.',
    removal_condition: 'Remove only if another maintained lane owns this review.',
    ...overrides
  };
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'source-watch-test-'));
}

async function withMockGitHub(sha, fn) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ sha }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withMockGitHubRoutes(routes, fn) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    const route = routes.find((candidate) => candidate.match.test(request.url));
    if (!route) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: `No route for ${request.url}` }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(route.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function runScript(workspace, reportRel, apiBaseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, '--workspace', workspace, '--report', reportRel], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SOURCE_WATCH_GITHUB_API_BASE_URL: apiBaseUrl,
        GITHUB_TOKEN: ''
      }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function runScriptWithArgs(workspace, args, apiBaseUrl, envOverrides = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, '--workspace', workspace, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...envOverrides,
        SOURCE_WATCH_GITHUB_API_BASE_URL: apiBaseUrl,
        GITHUB_TOKEN: ''
      }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

test('no active third-party changes exits cleanly without a PR-needed report', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeJson(path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));

  await withMockGitHub(lockedSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
     assert.match(result.stdout, /Checked 1 active third-party source lock\(s\); no actionable updates found\./);
    assert.equal(fs.existsSync(path.join(workspace, reportRel)), false);
  });
});

test('active third-party latest commit drift generates a PR-needed report', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeJson(path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));

  await withMockGitHub(latestSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR needed: yes/);

    const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
    assert.match(report, /PR needed: yes/);
    assert.match(report, /Source repo: `example-owner\/example-repo`/);
    assert.match(report, /Source ref: `main`/);
    assert.match(report, new RegExp(`Adopted commit: \`${lockedSha}\``));
    assert.match(report, /Reviewed-through commit: `\(none; adopted commit used\)`/);
    assert.match(report, new RegExp(`Latest observed commit: \`${latestSha}\``));
    assert.match(report, /Update policy: `manual_review_required`/);
    assert.match(report, /Public attribution required: `true`/);
    assert.match(report, /`exact` `src\/data\.csv`/);
    assert.match(report, /`adapted` `src\/tool\.js`/);
    assert.match(report, /- \[ \] Review upstream diff manually\./);
    assert.match(report, /No review-state cursors were changed\./);
    assert.match(report, /No SOURCE-LOCK pins were changed\./);
    assert.match(report, /No upstream code was executed\./);
  });
});

test('an adopted old source pin with a current reviewed-through cursor produces no finding', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeJson(path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));
  writeJson(path.join(workspace, 'repo/source-watch/review-state.json'), reviewStateDoc([
    sourceReviewRecord({ reviewedThroughSha: latestSha })
  ]));

  await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no actionable updates found/);
    assert.equal(fs.existsSync(path.join(workspace, reportRel)), false);
    assert.deepEqual(requests, ['/repos/example-owner/example-repo/commits/main']);
  });
});

test('a source cursor behind the latest upstream state produces one finding with distinct identities', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeJson(path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));
  writeJson(path.join(workspace, 'repo/source-watch/review-state.json'), reviewStateDoc([
    sourceReviewRecord({ reviewedThroughSha: reviewedSourceSha })
  ]));

  await withMockGitHub(latestSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, new RegExp(`Adopted commit: \`${lockedSha}\``));
  assert.match(report, new RegExp(`Reviewed-through commit: \`${reviewedSourceSha}\``));
  assert.match(report, new RegExp(`Latest observed commit: \`${latestSha}\``));
  assert.match(report, /Prior disposition: `READ_ONLY_REVIEW_REQUIRED`/);
  assert.match(report, /Owning tracker: `#315`/);
  assert.match(report, /differs from the human-reviewed-through commit/);
});

test('a missing source review cursor falls back to the adopted source pin', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeJson(path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));

  await withMockGitHub(latestSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /Reviewed-through commit: `\(none; adopted commit used\)`/);
  assert.match(report, /no reviewed-through cursor exists/);
});

test('seeded Google, UI/UX Pro Max, and n8n review identities suppress exactly their approved states', async () => {
  const googleSha = '9bf8eae67128b6cc55ad9bf86665767deb4c11cd';
  const uiUxSha = '4857a2c5ef989794751a0f66b8545a4a49566286';
  const n8nSha = '046c330c9308bbfc54ceab1adbe3d8fc6bebc8fa';
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  const googleLock = activeLock(lockedSha);
  googleLock.source_repo = 'google-labs-code/design.md';
  const uiUxLock = activeLock(lockedSha);
  uiUxLock.source_repo = 'nextlevelbuilder/ui-ux-pro-max-skill';
  writeJson(path.join(workspace, '_projects', 'design', 'google-design-md', 'SOURCE-LOCK.json'), googleLock);
  writeJson(path.join(workspace, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json'), uiUxLock);
  writeJson(path.join(workspace, advisoryRel), advisoryDoc([{
    id: 'n8n-skills-hook-compatibility',
    name: 'Official n8n Skills Windows hook compatibility',
    kind: 'github_repo',
    enabled: true,
    state: 'watching',
    repo: 'n8n-io/skills',
    ref: 'main',
    baseline_sha: advisoryBaselineSha,
    recommendation: 'Review the compatibility contract only.',
    action_taken: 'No source-watch mutation.',
    remaining_work: 'Review future changes under the tracker.',
    removal_condition: 'Remove when SOURCE-LOCK owns future tracking.'
  }]));
  writeJson(path.join(workspace, 'repo/source-watch/review-state.json'), reviewStateDoc([
    sourceReviewRecord({
      projectPath: '_projects/design/google-design-md',
      sourceLockPath: '_projects/design/google-design-md/SOURCE-LOCK.json',
      repository: googleLock.source_repo,
      reviewedThroughSha: googleSha,
      disposition: 'SEPARATE_IMPLEMENTATION_PR_RECOMMENDED',
      owningTracker: '#322'
    }),
    sourceReviewRecord({
      projectPath: '_projects/design/ui-ux-pro-max',
      sourceLockPath: '_projects/design/ui-ux-pro-max/SOURCE-LOCK.json',
      repository: uiUxLock.source_repo,
      reviewedThroughSha: uiUxSha,
      disposition: 'READ_ONLY_REVIEW_REQUIRED',
      owningTracker: '#323'
    }),
    advisoryReviewRecord({
      id: 'n8n-skills-hook-compatibility',
      kind: 'github_repo',
      repository: 'n8n-io/skills',
      reviewedThroughSha: n8nSha,
      owningTracker: '#244'
    })
  ]));

  await withMockGitHubRoutes([
    { match: /\/repos\/google-labs-code\/design\.md\/commits\/main$/, body: { sha: googleSha } },
    { match: /\/repos\/nextlevelbuilder\/ui-ux-pro-max-skill\/commits\/main$/, body: { sha: uiUxSha } },
    { match: /\/repos\/n8n-io\/skills\/commits\/main$/, body: { sha: n8nSha } }
  ], async (apiBaseUrl) => {
    const result = await runScriptWithArgs(workspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no actionable updates found/);
  });
  assert.equal(fs.existsSync(path.join(workspace, reportRel)), false);
});

test('repository seeds the exact authorized n8n cursor and excludes the prior typo', () => {
  const authorizedSha = '046c330c9308bbfc54ceab1adbe3d8fc6bebc8fa';
  const invalidSha = ['046c330c9308bbfc5', '5ceab1adbe3d8fc6', 'bebc8fa'].join('');
  const reviewStatePath = path.join(repoRoot, 'repo', 'source-watch', 'review-state.json');
  const reviewStateText = fs.readFileSync(reviewStatePath, 'utf8');
  const document = JSON.parse(reviewStateText);
  const record = document.records.find((candidate) => candidate.target_key === 'advisory:n8n-skills-hook-compatibility');
  assert.ok(record, 'the seeded n8n review record exists');
  assert.equal(record.reviewed_through_sha, authorizedSha);
  assert.doesNotMatch(reviewStateText, new RegExp(invalidSha));
  assert.throws(
    () => execFileSync('git', ['grep', '-n', invalidSha, '--', '.'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }),
    (error) => error && error.status === 1,
    'the prior invalid SHA is absent from tracked repository content'
  );
});

test('a commit newer than a seeded cursor appears exactly once', async () => {
  const seededSha = '9bf8eae67128b6cc55ad9bf86665767deb4c11cd';
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const lock = activeLock(lockedSha);
  lock.source_repo = 'google-labs-code/design.md';
  writeJson(path.join(workspace, '_projects', 'design', 'google-design-md', 'SOURCE-LOCK.json'), lock);
  writeJson(path.join(workspace, 'repo/source-watch/review-state.json'), reviewStateDoc([
    sourceReviewRecord({
      projectPath: '_projects/design/google-design-md',
      sourceLockPath: '_projects/design/google-design-md/SOURCE-LOCK.json',
      repository: lock.source_repo,
      reviewedThroughSha: seededSha,
      disposition: 'SEPARATE_IMPLEMENTATION_PR_RECOMMENDED',
      owningTracker: '#322'
    })
  ]));

  await withMockGitHub(newerSeededSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
  });
  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.equal((report.match(/^### /gm) || []).length, 1);
  assert.match(report, new RegExp(`Reviewed-through commit: \`${seededSha}\``));
  assert.match(report, new RegExp(`Latest observed commit: \`${newerSeededSha}\``));
});

test('a review-state identity mismatch cannot suppress a source-watch finding', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeJson(path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));
  writeJson(path.join(workspace, 'repo/source-watch/review-state.json'), reviewStateDoc([
    sourceReviewRecord({ repository: 'different-owner/different-repo', reviewedThroughSha: latestSha })
  ]));

  await withMockGitHub(latestSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
  });
  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /Reviewed-through commit: `\(none; adopted commit used\)`/);
  assert.match(report, /Adopted commit:/);
});

test('review-state validation rejects malformed SHA, duplicate key, date, disposition, and identity', () => {
  const valid = sourceReviewRecord();
  const validDocument = reviewStateDoc([valid]);
  assert.doesNotThrow(() => reviewState.validateReviewStateDocument(validDocument, 'review-state.json'));
  assert.throws(
    () => reviewState.validateReviewStateDocument({ ...validDocument, unsupported: true }, 'review-state.json'),
    /unsupported top-level field unsupported/
  );
  assert.throws(
    () => reviewState.validateReviewStateDocument({
      ...validDocument,
      policy: { ...validDocument.policy, unsupported: true }
    }, 'review-state.json'),
    /policy contains unsupported field unsupported/
  );
  assert.throws(
    () => reviewState.validateReviewStateDocument({
      ...validDocument,
      records: [{ ...valid, unsupported: true }]
    }, 'review-state.json'),
    /contains unsupported field unsupported/
  );
  assert.throws(
    () => reviewState.validateReviewStateDocument({
      ...validDocument,
      policy: { ...validDocument.policy, description: 42 }
    }, 'review-state.json'),
    /policy\.description must be a non-empty string/
  );
  assert.throws(
    () => reviewState.validateReviewStateDocument({
      ...validDocument,
      policy: { ...validDocument.policy, description: '   ' }
    }, 'review-state.json'),
    /policy\.description must be a non-empty string/
  );
  assert.throws(
    () => reviewState.validateReviewStateDocument(reviewStateDoc([{ ...valid, reviewed_through_sha: '1234' }]), 'review-state.json'),
    /40-character SHA/
  );
  assert.throws(
    () => reviewState.validateReviewStateDocument(reviewStateDoc([valid, { ...valid }]), 'review-state.json'),
    /duplicate target key/
  );
  assert.throws(
    () => reviewState.validateReviewStateDocument(reviewStateDoc([{ ...valid, reviewed_at: '2026-02-30' }]), 'review-state.json'),
    /valid calendar date/
  );
  assert.throws(
    () => reviewState.validateReviewStateDocument(reviewStateDoc([{ ...valid, disposition: 'MAYBE' }]), 'review-state.json'),
    /disposition is unsupported/
  );
  assert.throws(
    () => reviewState.validateReviewStateDocument(reviewStateDoc([valid]), 'review-state.json', [{
      ...reviewState.sourceLockIdentity({ relPath: valid.source_lock_path, lock: activeLock() }),
      repository: 'other-owner/other-repo'
    }]),
    /identity mismatch/
  );
});

test('retired internal locks are ignored and do not call GitHub', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeJson(path.join(workspace, '_projects', 'n8n', 'retired', 'SOURCE-LOCK.json'), retiredLock());

  await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No active third-party source update candidates found/);
    assert.deepEqual(requests, []);
  });
});

test('inconsistent active no-update locks fail closed without GitHub calls', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const lock = activeLock(lockedSha);
  lock.source_update_policy = 'none';
  writeJson(path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json'), lock);

  await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported SOURCE-LOCK lifecycle metadata/);
    assert.deepEqual(requests, []);
    assert.equal(fs.existsSync(path.join(workspace, reportRel)), false);
  });
});

test('source update check does not mutate _main content or SOURCE-LOCK pins', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const lockPath = path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json');
  const mainPath = path.join(workspace, '_projects', 'design', 'example', '_main', 'src', 'data.csv');
  const reviewStatePath = path.join(workspace, 'repo/source-watch/review-state.json');
  writeJson(lockPath, activeLock(lockedSha));
  writeJson(reviewStatePath, reviewStateDoc([sourceReviewRecord()]));
  fs.mkdirSync(path.dirname(mainPath), { recursive: true });
  fs.writeFileSync(mainPath, 'id,name\n1,Current\n');
  const beforeLock = fs.readFileSync(lockPath, 'utf8');
  const beforeMain = fs.readFileSync(mainPath, 'utf8');
  const beforeReviewState = fs.readFileSync(reviewStatePath, 'utf8');

  await withMockGitHub(latestSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
  });

  assert.equal(fs.readFileSync(lockPath, 'utf8'), beforeLock);
  assert.equal(fs.readFileSync(mainPath, 'utf8'), beforeMain);
  assert.equal(fs.readFileSync(reviewStatePath, 'utf8'), beforeReviewState);
});

test('daily source-watch reports actionable advisory drift from the advisory document', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  const advisoryPath = path.join(workspace, advisoryRel);
  writeJson(path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));
  writeJson(advisoryPath, advisoryDoc([githubPathAdvisory()]));
  const beforeAdvisory = fs.readFileSync(advisoryPath, 'utf8');

  await withMockGitHubRoutes([
    { match: /\/repos\/example-owner\/example-repo\/commits\/main$/, body: { sha: lockedSha } },
    { match: /\/repos\/example-org\/knowledge-catalog\/commits\?/, body: [{ sha: advisoryLatestSha }] }
  ], async (apiBaseUrl) => {
    const result = await runScriptWithArgs(workspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR needed: yes \(0 source updates, 1 advisory action\)/);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /# Active Source Watch Review/);
  assert.match(report, /## Advisory Actions Requiring Review/);
  assert.match(report, /Open Knowledge Format draft spec/);
  assert.match(report, /Advisory update detected/);
   assert.match(report, new RegExp(`Compatibility baseline: \`${advisoryBaselineSha}\``));
   assert.match(report, /Reviewed-through commit: `\(none; compatibility baseline used\)`/);
   assert.match(report, new RegExp(`Latest observed commit: \`${advisoryLatestSha}\``));
  assert.match(report, /Recommendation: Review draft spec changes only/);
  assert.match(report, /Action taken: Not implemented in toolkit source\./);
  assert.match(report, /Remaining work: Decide whether any reviewed concept should become first-party toolkit documentation\./);
  assert.match(report, /Remove this advisory target after any accepted concept is implemented/);
  assert.match(report, new RegExp(`Update \`${advisoryRel}\` when advisory action is taken`));
  assert.equal(fs.readFileSync(advisoryPath, 'utf8'), beforeAdvisory);
});

test('advisory review cursor takes precedence over the compatibility baseline', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  writeJson(path.join(workspace, advisoryRel), advisoryDoc([githubPathAdvisory()]));
  writeJson(path.join(workspace, 'repo/source-watch/review-state.json'), reviewStateDoc([
    advisoryReviewRecord({ reviewedThroughSha: advisoryLatestSha })
  ]));

  await withMockGitHubRoutes([
    { match: /\/repos\/example-org\/knowledge-catalog\/commits\?/, body: [{ sha: advisoryLatestSha }] }
  ], async (apiBaseUrl, requests) => {
    const result = await runScriptWithArgs(workspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no actionable updates found/);
    assert.equal(fs.existsSync(path.join(workspace, reportRel)), false);
    assert.deepEqual(requests, ['/repos/example-org/knowledge-catalog/commits?sha=main&path=okf%2FSPEC.md&per_page=1']);
  });
});

test('advisory review cursor drift reports compatibility baseline, cursor, and latest identities', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  writeJson(path.join(workspace, advisoryRel), advisoryDoc([githubPathAdvisory()]));
  writeJson(path.join(workspace, 'repo/source-watch/review-state.json'), reviewStateDoc([
    advisoryReviewRecord({ reviewedThroughSha: reviewedAdvisorySha })
  ]));

  await withMockGitHubRoutes([
    { match: /\/repos\/example-org\/knowledge-catalog\/commits\?/, body: [{ sha: advisoryLatestSha }] }
  ], async (apiBaseUrl) => {
    const result = await runScriptWithArgs(workspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, new RegExp(`Compatibility baseline: \`${advisoryBaselineSha}\``));
  assert.match(report, new RegExp(`Reviewed-through commit: \`${reviewedAdvisorySha}\``));
  assert.match(report, new RegExp(`Latest observed commit: \`${advisoryLatestSha}\``));
  assert.match(report, /Prior disposition: `READ_ONLY_REVIEW_REQUIRED`/);
  assert.match(report, /Owning tracker: `#248`/);
});

test('advisory target without a review cursor preserves the baseline fallback', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  writeJson(path.join(workspace, advisoryRel), advisoryDoc([githubPathAdvisory()]));

  await withMockGitHubRoutes([
    { match: /\/repos\/example-org\/knowledge-catalog\/commits\?/, body: [{ sha: advisoryLatestSha }] }
  ], async (apiBaseUrl) => {
    const result = await runScriptWithArgs(workspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /Reviewed-through commit: `\(none; compatibility baseline used\)`/);
  assert.match(report, /compatibility baseline; no reviewed-through cursor exists/);
});

test('an advisory target with neither cursor nor baseline remains baseline-required', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  writeJson(path.join(workspace, advisoryRel), advisoryDoc([githubPathAdvisory({ baseline_sha: null })]));

  await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
    const result = await runScriptWithArgs(workspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(requests, []);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /Advisory baseline required/);
});

test('GitHub path advisory targets ignore unrelated commits and report path-specific commits', async () => {
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  const noDriftWorkspace = tempWorkspace();
  writeJson(path.join(noDriftWorkspace, advisoryRel), advisoryDoc([githubPathAdvisory()]));
  await withMockGitHubRoutes([
    { match: /\/repos\/example-org\/knowledge-catalog\/commits\?/, body: [{ sha: advisoryBaselineSha }] }
  ], async (apiBaseUrl, requests) => {
    const result = await runScriptWithArgs(noDriftWorkspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(noDriftWorkspace, reportRel)), false);
    assert.deepEqual(requests, ['/repos/example-org/knowledge-catalog/commits?sha=main&path=okf%2FSPEC.md&per_page=1']);
  });

  const driftWorkspace = tempWorkspace();
  writeJson(path.join(driftWorkspace, advisoryRel), advisoryDoc([githubPathAdvisory()]));
  await withMockGitHubRoutes([
    { match: /\/repos\/example-org\/knowledge-catalog\/commits\?/, body: [{ sha: advisoryLatestSha }] }
  ], async (apiBaseUrl) => {
    const result = await runScriptWithArgs(driftWorkspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
  });
  assert.match(fs.readFileSync(path.join(driftWorkspace, reportRel), 'utf8'), /Advisory update detected/);
});

test('daily source-watch ignores non-actionable current advisory targets', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  writeJson(path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));
  writeJson(path.join(workspace, advisoryRel), advisoryDoc([manualAdvisory()]));

  await withMockGitHub(lockedSha, async (apiBaseUrl, requests) => {
    const result = await runScriptWithArgs(workspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Checked 1 active third-party source lock\(s\) and 1 advisory target\(s\); no actionable updates found\./);
    assert.equal(fs.existsSync(path.join(workspace, reportRel)), false);
    assert.deepEqual(requests, ['/repos/example-owner/example-repo/commits/main']);
  });
});

test('daily source-watch reports pending manual advisory actions without GitHub calls for that target', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  writeJson(path.join(workspace, advisoryRel), advisoryDoc([
    manualAdvisory({
      state: 'pending_action',
      recommendation: 'Start implementation only after reviewing the linked design note.',
      action_taken: 'Reviewed and accepted as a toolkit candidate.',
      remaining_work: 'Create a separate implementation PR or remove this target if rejected.'
    })
  ]));

  await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
    const result = await runScriptWithArgs(workspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR needed: yes \(0 source updates, 1 advisory action\)/);
    assert.deepEqual(requests, []);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /Pending advisory action/);
  assert.match(report, /Start implementation only after reviewing the linked design note\./);
  assert.match(report, /Create a separate implementation PR or remove this target if rejected\./);
});

test('daily source-watch reports due host-harness capability drift reviews without mutating advisory state', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  const advisoryPath = path.join(workspace, advisoryRel);
  writeJson(advisoryPath, advisoryDoc([
    hostHarnessReviewTarget({ last_reviewed_at: '2026-01-01' })
  ]));
  const beforeAdvisory = fs.readFileSync(advisoryPath, 'utf8');

  await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
    const result = await runScriptWithArgs(
      workspace,
      ['--report', reportRel, '--advisory-doc', advisoryRel],
      apiBaseUrl,
      { SOURCE_WATCH_TODAY: '2026-07-05' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR needed: yes \(0 source updates, 1 advisory action\)/);
    assert.deepEqual(requests, []);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /Host Harness Capability Drift Review/);
  assert.match(report, /Periodic review due/);
  assert.match(report, /Review cadence: `90 day\(s\)`/);
  assert.match(report, /Last reviewed: `2026-01-01`/);
  assert.match(report, /OpenAI Codex changelog/);
  assert.match(report, /Claude Code changelog/);
  assert.match(report, /Classification options: Keep, Shrink, Move to hook, Move to host-native feature, Delete, Needs benchmark\/eval before decision/);
  assert.match(report, /No toolkit rules, skills, hooks, memory guidance, repo-map guidance, or cleanup guidance were modified or deleted\./);
  assert.match(report, /separate evidence-backed PR/);
  assert.equal(fs.readFileSync(advisoryPath, 'utf8'), beforeAdvisory);
});

test('daily source-watch ignores host-harness capability drift reviews before cadence elapses', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  writeJson(path.join(workspace, advisoryRel), advisoryDoc([
    hostHarnessReviewTarget({ last_reviewed_at: '2026-06-01' })
  ]));

  await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
    const result = await runScriptWithArgs(
      workspace,
      ['--report', reportRel, '--advisory-doc', advisoryRel],
      apiBaseUrl,
      { SOURCE_WATCH_TODAY: '2026-07-05' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Checked 0 active third-party source lock\(s\) and 1 advisory target\(s\); no actionable updates found\./);
    assert.equal(fs.existsSync(path.join(workspace, reportRel)), false);
    assert.deepEqual(requests, []);
  });
});

test('daily source-watch removes hidden bidirectional controls from advisory report text', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  const advisoryRel = 'repo/source-watch/advisory-targets.json';
  writeJson(path.join(workspace, advisoryRel), advisoryDoc([
    manualAdvisory({
      state: 'pending_action',
      name: 'Planning\u202e note',
      recommendation: 'Review advisory concepts\u200f only.'
    })
  ]));

  await withMockGitHub(latestSha, async (apiBaseUrl) => {
    const result = await runScriptWithArgs(workspace, ['--report', reportRel, '--advisory-doc', advisoryRel], apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.doesNotMatch(report, bidiControlPattern);
  assert.match(report, /Planning note/);
  assert.match(report, /Review advisory concepts only\./);
});
