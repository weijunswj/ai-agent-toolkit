'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const reviewState = require('../scripts/source-watch-review-state.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'repo', 'scripts', 'check-project-source-updates.cjs');
const sourceLockRel = 'repo/source-watch/provenance/example/SOURCE-LOCK.json';
const sourceProjectRel = 'repo/source-watch/provenance/example';
const lockedSha = '1111111111111111111111111111111111111111';
const latestSha = '2222222222222222222222222222222222222222';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
        root_surface_path: 'skills/fixture/data.csv',
        source_blob_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      },
      {
        mode: 'adapted',
        source_path: 'src/tool.js',
        root_surface_path: 'skills/fixture/tool.js',
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
    source_repo: 'example-owner/retired-source',
    source_ref: 'main',
    source_commit: 'retired-source-marker',
    source_lifecycle: 'retired_after_migration',
    source_role: 'migration_provenance_only',
    source_update_policy: 'none',
    public_attribution_required: false,
    files: []
  };
}

function reviewStateDoc(reviewedThroughSha) {
  return {
    schema_version: 1,
    policy: {
      cursor_advancement: 'human_advanced_only',
      runtime_updates: 'forbidden',
      adoption_and_review_are_distinct: true
    },
    records: [{
      target_key: `source-lock:${sourceProjectRel}`,
      target_kind: 'source_lock',
      repository: 'example-owner/example-repo',
      ref: 'main',
      source_lock_path: sourceLockRel,
      reviewed_through_sha: reviewedThroughSha,
      reviewed_at: '2026-07-30',
      disposition: 'READ_ONLY_REVIEW_REQUIRED',
      owning_tracker: '#315'
    }]
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

function runScript(workspace, apiBaseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, '--workspace', workspace], {
      cwd: repoRoot,
      env: { ...process.env, SOURCE_WATCH_GITHUB_API_BASE_URL: apiBaseUrl, GITHUB_TOKEN: '' }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('canonical source-watch provenance with no upstream drift produces no report', async () => {
  const workspace = tempWorkspace();
  writeJson(path.join(workspace, sourceLockRel), activeLock());
  await withMockGitHub(lockedSha, async (apiBaseUrl, requests) => {
    const result = await runScript(workspace, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no actionable updates found/i);
    assert.equal(fs.existsSync(path.join(workspace, 'repo/source-watch/reviews/active-third-party-updates.md')), false);
    assert.deepEqual(requests, ['/repos/example-owner/example-repo/commits/main']);
  });
});

test('upstream drift produces a review-only notification without changing the lock', async () => {
  const workspace = tempWorkspace();
  const lockPath = path.join(workspace, sourceLockRel);
  writeJson(lockPath, activeLock());
  const before = fs.readFileSync(lockPath, 'utf8');
  await withMockGitHub(latestSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR needed: yes/);
  });
  const report = fs.readFileSync(path.join(workspace, 'repo/source-watch/reviews/active-third-party-updates.md'), 'utf8');
  assert.match(report, /This PR is a review notification only\./);
  assert.match(report, /No SOURCE-LOCK pins were changed\./);
  assert.match(report, /No upstream code was executed\./);
  assert.match(report, new RegExp('Adopted commit: `' + lockedSha + '`'));
  assert.match(report, new RegExp('Latest observed commit: `' + latestSha + '`'));
  assert.equal(fs.readFileSync(lockPath, 'utf8'), before);
});

test('human reviewed-through cursor suppresses an already reviewed upstream commit', async () => {
  const workspace = tempWorkspace();
  writeJson(path.join(workspace, sourceLockRel), activeLock());
  writeJson(path.join(workspace, 'repo/source-watch/review-state.json'), reviewStateDoc(latestSha));
  await withMockGitHub(latestSha, async (apiBaseUrl) => {
    const result = await runScript(workspace, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no actionable updates found/i);
  });
});

test('retired migration provenance is ignored and never queried upstream', async () => {
  const workspace = tempWorkspace();
  writeJson(path.join(workspace, 'repo/source-watch/provenance/retired/SOURCE-LOCK.json'), retiredLock());
  await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
    const result = await runScript(workspace, apiBaseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No active third-party source update candidates found/);
    assert.deepEqual(requests, []);
  });
});

test('invalid active source-watch metadata fails closed before any upstream request', async () => {
  const workspace = tempWorkspace();
  const invalid = activeLock();
  invalid.source_update_policy = 'none';
  writeJson(path.join(workspace, sourceLockRel), invalid);
  await withMockGitHub(latestSha, async (apiBaseUrl, requests) => {
    const result = await runScript(workspace, apiBaseUrl);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported SOURCE-LOCK lifecycle metadata/);
    assert.deepEqual(requests, []);
  });
});

test('review-state source-lock identities bind to canonical provenance paths', () => {
  const record = reviewState.validateRecord(reviewStateDoc(latestSha).records[0], 0);
  assert.equal(record.target_key, `source-lock:${sourceProjectRel}`);
  assert.equal(record.source_lock_path, sourceLockRel);
});
