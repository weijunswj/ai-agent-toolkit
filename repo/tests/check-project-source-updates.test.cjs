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

test('no active third-party changes exits cleanly without a PR-needed report', async () => {
  const workspace = tempWorkspace();
  const reportRel = 'repo/source-watch/reviews/active-third-party-updates.md';
  writeJson(path.join(workspace, '_projects', 'design', 'example', 'SOURCE-LOCK.json'), activeLock(lockedSha));

  await withMockGitHub(lockedSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, reportRel, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Checked 1 active third-party source lock\(s\); all pinned commits are current\./);
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
