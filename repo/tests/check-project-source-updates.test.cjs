'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'repo', 'scripts', 'check-project-source-updates.cjs');

const lockedSha = '1111111111111111111111111111111111111111';
const latestSha = '2222222222222222222222222222222222222222';
const advisoryBaselineSha = '3333333333333333333333333333333333333333';
const advisoryLatestSha = '4444444444444444444444444444444444444444';
const bidiControlPattern = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const securityActionCommit = '5555555555555555555555555555555555555555';
const securityLicense = 'Synthetic MIT licence fixture.\n';

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

function writeSecurityToolLock(workspace, overrides = {}) {
  const record = {
    name: 'synthetic-action',
    kind: 'github_action',
    purpose: 'Synthetic source-watch fixture',
    upstream: 'example-owner/example-action',
    publisher: 'example-owner',
    release: securityActionCommit,
    commit: securityActionCommit,
    license: 'MIT',
    license_file: 'LICENSE',
    license_sha256: require('node:crypto').createHash('sha256').update(securityLicense).digest('hex'),
    commercial_use: 'approved',
    redistribution: 'approved',
    expected_release_asset: null,
    release_checksum: null,
    signature_attestation: null,
    container_digest: null,
    supported_platforms: ['github-actions'],
    output_schema: 'github-action',
    rules_database_version: 'not_applicable',
    adoption_decision: 'ADOPT',
    state: 'active',
    ...overrides
  };
  writeJson(path.join(workspace, 'skills', 'repository-security-gate', 'config', 'tool-lock.json'), {
    schema_version: 1,
    lock_version: '1.0.0',
    first_approved_date: '2026-07-23',
    last_verified_date: '2026-07-23',
    records: [record]
  });
}

function securityToolRoutes(commit = securityActionCommit) {
  return [
    {
      match: /\/repos\/example-owner\/example-action$/,
      body: { archived: false, disabled: false }
    },
    {
      match: /\/repos\/example-owner\/example-action\/contents\/LICENSE\?ref=/,
      body: { content: Buffer.from(securityLicense).toString('base64') }
    },
    {
      match: /\/repos\/example-owner\/example-action\/commits\//,
      body: { sha: commit }
    }
  ];
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
    assert.match(result.stdout, /Checked 1 active third-party source lock\(s\) and 0 security-tool record\(s\); all pins are current\./);
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
    assert.match(report, new RegExp(`Locked commit: \`${lockedSha}\``));
    assert.match(report, new RegExp(`Latest commit: \`${latestSha}\``));
    assert.match(report, /Update policy: `manual_review_required`/);
    assert.match(report, /Public attribution required: `true`/);
    assert.match(report, /`exact` `src\/data\.csv`/);
    assert.match(report, /`adapted` `src\/tool\.js`/);
    assert.match(report, /- \[ \] Review upstream diff manually\./);
    assert.match(report, /No SOURCE-LOCK pins were changed\./);
    assert.match(report, /No upstream code was executed\./);
  });
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
  writeJson(lockPath, activeLock(lockedSha));
  fs.mkdirSync(path.dirname(mainPath), { recursive: true });
  fs.writeFileSync(mainPath, 'id,name\n1,Current\n');
  const beforeLock = fs.readFileSync(lockPath, 'utf8');
  const beforeMain = fs.readFileSync(mainPath, 'utf8');

  await withMockGitHub(latestSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
  });

  assert.equal(fs.readFileSync(lockPath, 'utf8'), beforeLock);
  assert.equal(fs.readFileSync(mainPath, 'utf8'), beforeMain);
});

test('security-tool metadata watch deduplicates unchanged exact evidence', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeSecurityToolLock(workspace);
  await withMockGitHubRoutes(securityToolRoutes(), async (apiBaseUrl, requests) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0 active third-party source lock\(s\) and 1 security-tool record\(s\); all pins are current/);
    assert.equal(fs.existsSync(path.join(workspace, reportRel)), false);
    assert.equal(requests.length, 3);
  });
});

test('security-tool source failure is unverified and writes no misleading report', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeSecurityToolLock(workspace);
  await withMockGitHubRoutes(securityToolRoutes().slice(0, 1), async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GitHub API request failed \(404\)/);
    assert.equal(fs.existsSync(path.join(workspace, reportRel)), false);
  });
});

test('security-tool commit drift creates notification-only candidate handoff', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeSecurityToolLock(workspace);
  await withMockGitHubRoutes(securityToolRoutes('6666666666666666666666666666666666666666'), async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 security-tool update/);
    const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
    assert.match(report, /commit_drift/);
    assert.match(report, /separate quarantined candidate-validation lane/);
    assert.match(report, /No upstream code was executed/);
  });
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
    assert.match(result.stdout, /PR needed: yes \(0 source updates, 0 security-tool updates, 1 advisory action\)/);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /# Active Source Watch Review/);
  assert.match(report, /## Advisory Actions Requiring Review/);
  assert.match(report, /Open Knowledge Format draft spec/);
  assert.match(report, /Advisory update detected/);
  assert.match(report, new RegExp(`Baseline commit: \`${advisoryBaselineSha}\``));
  assert.match(report, new RegExp(`Latest commit: \`${advisoryLatestSha}\``));
  assert.match(report, /Recommendation: Review draft spec changes only/);
  assert.match(report, /Action taken: Not implemented in toolkit source\./);
  assert.match(report, /Remaining work: Decide whether any reviewed concept should become first-party toolkit documentation\./);
  assert.match(report, /Remove this advisory target after any accepted concept is implemented/);
  assert.match(report, new RegExp(`Update \`${advisoryRel}\` when advisory action is taken`));
  assert.equal(fs.readFileSync(advisoryPath, 'utf8'), beforeAdvisory);
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
    assert.match(result.stdout, /Checked 1 active third-party source lock\(s\), 0 security-tool record\(s\), and 1 advisory target\(s\); no actionable updates found\./);
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
    assert.match(result.stdout, /PR needed: yes \(0 source updates, 0 security-tool updates, 1 advisory action\)/);
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
    assert.match(result.stdout, /PR needed: yes \(0 source updates, 0 security-tool updates, 1 advisory action\)/);
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
    assert.match(result.stdout, /Checked 0 active third-party source lock\(s\), 0 security-tool record\(s\), and 1 advisory target\(s\); no actionable updates found\./);
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
