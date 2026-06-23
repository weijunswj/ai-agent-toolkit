'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'repo', 'scripts', 'check-ecosystem-updates.cjs');

const lockedSha = '1111111111111111111111111111111111111111';
const latestSha = '2222222222222222222222222222222222222222';
const advisoryBaselineSha = '3333333333333333333333333333333333333333';
const advisoryLatestSha = '4444444444444444444444444444444444444444';
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
        source_path: 'docs/source.md',
        project_path: '_projects/example/_main/docs/source.md',
        source_blob_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }
    ]
  };
}

function radarConfig(targets) {
  return {
    schema_version: 1,
    targets
  };
}

function githubRepoTarget(overrides = {}) {
  return {
    id: 'ponytail',
    name: 'Ponytail decision ladder',
    kind: 'github_repo',
    enabled: true,
    repo: 'decision-tools/ponytail',
    ref: 'main',
    baseline_sha: advisoryBaselineSha,
    baseline_policy: 'human_advanced_only',
    affects: ['decision_review'],
    ...overrides
  };
}

function githubPathTarget(overrides = {}) {
  return {
    id: 'okf-spec',
    name: 'Open Knowledge Format draft spec',
    kind: 'github_path',
    enabled: true,
    repo: 'example-org/knowledge-catalog',
    ref: 'main',
    path: 'okf/SPEC.md',
    baseline_sha: advisoryBaselineSha,
    baseline_policy: 'human_advanced_only',
    affects: ['knowledge_format'],
    ...overrides
  };
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecosystem-radar-test-'));
}

async function withMockGitHub(routes, fn) {
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

function runScript(workspace, configRel, reportRel, apiBaseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      scriptPath,
      '--workspace', workspace,
      '--config', configRel,
      '--report', reportRel
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ECOSYSTEM_RADAR_GITHUB_API_BASE_URL: apiBaseUrl,
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

test('weekly radar exits cleanly without a report when source pins and advisory targets are current', async () => {
  const workspace = tempWorkspace();
  const configRel = 'repo/ecosystem-radar.json';
  const reportRel = 'repo/source-watch/reviews/weekly-ecosystem-radar.md';
  writeJson(path.join(workspace, '_projects', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));
  writeJson(path.join(workspace, configRel), radarConfig([githubPathTarget()]));

  await withMockGitHub([
    { match: /\/repos\/example-owner\/example-repo\/commits\/main$/, body: { sha: lockedSha } },
    { match: /\/repos\/example-org\/knowledge-catalog\/commits\?/, body: [{ sha: advisoryBaselineSha }] }
  ], async (apiBaseUrl) => {
    const result = await runScript(workspace, configRel, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /all tracked ecosystem targets are current/);
    assert.equal(fs.existsSync(path.join(workspace, reportRel)), false);
  });
});

test('weekly radar requires a PR report when source-lock drift exists without advisory drift', async () => {
  const workspace = tempWorkspace();
  const configRel = 'repo/ecosystem-radar.json';
  const reportRel = 'repo/source-watch/reviews/weekly-ecosystem-radar.md';
  writeJson(path.join(workspace, '_projects', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));
  writeJson(path.join(workspace, configRel), radarConfig([githubPathTarget()]));

  await withMockGitHub([
    { match: /\/repos\/example-owner\/example-repo\/commits\/main$/, body: { sha: latestSha } },
    { match: /\/repos\/example-org\/knowledge-catalog\/commits\?/, body: [{ sha: advisoryBaselineSha }] }
  ], async (apiBaseUrl) => {
    const result = await runScript(workspace, configRel, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR needed: yes \(1 source update, 0 advisory findings\)/);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /Upstream drift detected\. Manual review required\./);
  assert.match(report, /This PR exists because actionable ecosystem drift was detected\./);
  assert.doesNotMatch(report, /weekly ecosystem radar report only/i);
  assert.match(report, /## Source-Lock Drift Requiring Manual Review/);
  assert.match(report, /Source repo: `example-owner\/example-repo`/);
  assert.match(report, /## Advisory Baseline Candidates Requiring Human Approval/);
  assert.match(report, /No advisory baseline candidates require human approval\./);
  assert.match(report, /## Non-Actionable Informational Notes/);
  assert.match(report, /Keep source-pin\/source-file update PRs separate from advisory-baseline PRs\./);
});

test('weekly radar requires a PR report when advisory drift exists without source-lock drift', async () => {
  const workspace = tempWorkspace();
  const configRel = 'repo/ecosystem-radar.json';
  const reportRel = 'repo/source-watch/reviews/weekly-ecosystem-radar.md';
  writeJson(path.join(workspace, '_projects', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));
  writeJson(path.join(workspace, configRel), radarConfig([githubRepoTarget()]));

  await withMockGitHub([
    { match: /\/repos\/example-owner\/example-repo\/commits\/main$/, body: { sha: lockedSha } },
    { match: /\/repos\/decision-tools\/ponytail\/commits\/main$/, body: { sha: advisoryLatestSha } }
  ], async (apiBaseUrl) => {
    const result = await runScript(workspace, configRel, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR needed: yes \(0 source updates, 1 advisory finding\)/);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /Upstream drift detected\. Manual review required\./);
  assert.match(report, /## Source-Lock Drift Requiring Manual Review/);
  assert.match(report, /No source-lock drift requiring manual review was detected\./);
  assert.match(report, /## Advisory Baseline Candidates Requiring Human Approval/);
  assert.match(report, /Ponytail decision ladder/);
  assert.match(report, /Advisory update detected/);
  assert.match(report, /## Non-Actionable Informational Notes/);
  assert.match(report, /Advisory baseline advancement requires a separate human-approved PR\./);
});
test('weekly radar reports existing source-lock drift and advisory target drift without mutating source files', async () => {
  const workspace = tempWorkspace();
  const configRel = 'repo/ecosystem-radar.json';
  const reportRel = 'repo/source-watch/reviews/weekly-ecosystem-radar.md';
  const lockPath = path.join(workspace, '_projects', 'example', 'SOURCE-LOCK.json');
  const sourcePath = path.join(workspace, '_projects', 'example', '_main', 'docs', 'source.md');
  const skillPath = path.join(workspace, 'skills', 'example', 'SKILL.md');
  writeJson(lockPath, activeLock(lockedSha));
  writeJson(path.join(workspace, configRel), radarConfig([githubRepoTarget(), githubPathTarget()]));
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, '# Current source\n');
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, '# Current generated skill\n');
  const beforeLock = fs.readFileSync(lockPath, 'utf8');
  const beforeSource = fs.readFileSync(sourcePath, 'utf8');
  const beforeSkill = fs.readFileSync(skillPath, 'utf8');
  const beforeConfig = fs.readFileSync(path.join(workspace, configRel), 'utf8');

  await withMockGitHub([
    { match: /\/repos\/example-owner\/example-repo\/commits\/main$/, body: { sha: latestSha } },
    { match: /\/repos\/decision-tools\/ponytail\/commits\/main$/, body: { sha: advisoryLatestSha } },
    { match: /\/repos\/example-org\/knowledge-catalog\/commits\?/, body: [{ sha: advisoryLatestSha }] }
  ], async (apiBaseUrl) => {
    const result = await runScript(workspace, configRel, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR needed: yes/);
  });

  assert.equal(fs.readFileSync(lockPath, 'utf8'), beforeLock);
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), beforeSource);
  assert.equal(fs.readFileSync(skillPath, 'utf8'), beforeSkill);
  assert.equal(fs.readFileSync(path.join(workspace, configRel), 'utf8'), beforeConfig);

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /# Weekly Ecosystem Radar/);
  assert.match(report, /Upstream drift detected\. Manual review required\./);
  assert.match(report, /This PR exists because actionable ecosystem drift was detected\./);
  assert.doesNotMatch(report, /weekly ecosystem radar report only/i);
  assert.match(report, /Source repo: `example-owner\/example-repo`/);
  assert.match(report, new RegExp(`Locked commit: \`${lockedSha}\``));
  assert.match(report, new RegExp(`Latest commit: \`${latestSha}\``));
  assert.match(report, /Ponytail decision ladder/);
  assert.match(report, /Open Knowledge Format draft spec/);
  assert.match(report, /No issues are created/);
  assert.match(report, /No SOURCE-LOCK pins were changed/);
  assert.match(report, /No advisory baselines were changed/);
  assert.match(report, /No live deployment actions, provider calls, notification tests, or production mutations were run/);
});

test('weekly radar report removes hidden bidirectional controls from generated markdown', async () => {
  const workspace = tempWorkspace();
  const configRel = 'repo/ecosystem-radar.json';
  const reportRel = 'repo/source-watch/reviews/weekly-ecosystem-radar.md';
  writeJson(path.join(workspace, '_projects', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));
  writeJson(path.join(workspace, configRel), radarConfig([
    githubRepoTarget({
      id: 'bidi-target',
      name: 'Ponytail\u202e decision ladder',
      baseline_sha: null,
      baseline_note: 'Initial baseline\u2066 requires human approval.',
      recommended_action: 'Review advisory concepts\u200f only.'
    })
  ]));

  await withMockGitHub([
    { match: /\/repos\/example-owner\/example-repo\/commits\/main$/, body: { sha: lockedSha } }
  ], async (apiBaseUrl) => {
    const result = await runScript(workspace, configRel, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR needed: yes/);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.doesNotMatch(report, bidiControlPattern);
  assert.match(report, /Ponytail decision ladder/);
  assert.match(report, /Initial baseline requires human approval\./);
  assert.match(report, /Review advisory concepts only\./);
});
test('advisory targets without human baselines require review without calling GitHub for that target', async () => {
  const workspace = tempWorkspace();
  const configRel = 'repo/ecosystem-radar.json';
  const reportRel = 'repo/source-watch/reviews/weekly-ecosystem-radar.md';
  writeJson(path.join(workspace, '_projects', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));
  writeJson(path.join(workspace, configRel), radarConfig([
    githubRepoTarget({
      id: 'baseline-required',
      baseline_sha: null,
      baseline_note: 'Initial advisory baseline requires a separate human-approved PR.'
    })
  ]));

  await withMockGitHub([
    { match: /\/repos\/example-owner\/example-repo\/commits\/main$/, body: { sha: lockedSha } }
  ], async (apiBaseUrl, requests) => {
    const result = await runScript(workspace, configRel, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR needed: yes/);
    assert.deepEqual(requests, ['/repos/example-owner/example-repo/commits/main']);
  });

  const report = fs.readFileSync(path.join(workspace, reportRel), 'utf8');
  assert.match(report, /Advisory baseline required/);
  assert.match(report, /Initial advisory baseline requires a separate human-approved PR/);
  assert.match(report, /Advisory baseline advancement requires a separate human-approved PR/);
});
