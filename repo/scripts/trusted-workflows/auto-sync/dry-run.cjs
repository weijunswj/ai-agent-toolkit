#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AUTO_SYNC_POLICY } = require('../writeback-policy.cjs');
const { result, fail, opaque } = require('../protocol.cjs');

if (process.argv.length !== 6 || !/^[1-9][0-9]*$/.test(process.argv[2]) || !/^[0-9a-f]{40}$/.test(process.argv[3]) ||
    !['pull_request_target', 'workflow_dispatch'].includes(process.argv[4])) {
  fail('TW_AUTOSYNC_DRY_RUN_ARGUMENTS');
}

const eventName = process.argv[4];
if (eventName === 'pull_request_target') {
  result({
    mode: 'metadata-only',
    proposal_ready: true,
    rehearsal_executed: false,
    target_pr: opaque(process.argv[2]),
    target_head: opaque(process.argv[3]),
    checkout_executed_as_code: false,
    commit_attempts: 0,
    push_attempts: 0,
    policy: AUTO_SYNC_POLICY
  });
  process.exit(0);
}

const workspace = process.env.GITHUB_WORKSPACE;
if (!workspace || !path.isAbsolute(workspace)) fail('TW_AUTOSYNC_WORKSPACE');
const workspaceReal = fs.realpathSync.native(workspace);
const expectedRoot = path.join(workspaceReal, 'pr');
const requestedRoot = path.resolve(process.argv[5]);
let prRoot;
try {
  prRoot = fs.realpathSync.native(requestedRoot);
} catch {
  fail('TW_AUTOSYNC_PR_ROOT');
}
if (prRoot !== expectedRoot || fs.lstatSync(requestedRoot).isSymbolicLink()) fail('TW_AUTOSYNC_PR_ROOT');

const trustedRepo = path.resolve(__dirname, '..', '..', '..', '..');
const syncScript = path.join(trustedRepo, 'repo', 'scripts', 'sync-toolkit-projects.cjs');
const sync = spawnSync(process.execPath, [syncScript, '--write', '--workspace', prRoot], {
  cwd: trustedRepo,
  encoding: 'utf8',
  timeout: 120000,
  windowsHide: true,
  shell: false,
  env: { ...process.env, NODE_OPTIONS: '' },
  maxBuffer: 1024 * 1024
});
if (sync.error || sync.status !== 0 || sync.signal || sync.stderr !== '') fail('TW_AUTOSYNC_GENERATION');

const status = spawnSync('git', ['-C', prRoot, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], {
  cwd: trustedRepo,
  encoding: 'utf8',
  timeout: 30000,
  windowsHide: true,
  shell: false,
  maxBuffer: 1024 * 1024
});
if (status.error || status.status !== 0 || status.signal || status.stderr !== '') fail('TW_AUTOSYNC_STATUS');
const changed = status.stdout.split('\0').filter(Boolean).map((record) => record.slice(3).replace(/\\/g, '/')).sort();
if (changed.some((file) => file === '' || path.posix.isAbsolute(file) || file.split('/').some((part) => part === '..') ||
    !(file === 'README.md' || file.startsWith('skills/') || file.startsWith('.codex-plugin/') || file.startsWith('.claude-plugin/')))) {
  fail('TW_AUTOSYNC_SCOPE');
}
const digest = crypto.createHash('sha256');
for (const relative of changed) {
  const file = path.join(prRoot, ...relative.split('/'));
  digest.update(relative).update('\0').update(fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from('deleted')).update('\0');
}
result({
  mode: 'dry-run',
  proposal_ready: true,
  rehearsal_executed: true,
  target_pr: opaque(process.argv[2]),
  target_head: opaque(process.argv[3]),
  generated_change_count: changed.length,
  generated_change_digest: digest.digest('hex'),
  checkout_executed_as_code: false,
  commit_attempts: 0,
  push_attempts: 0,
  policy: AUTO_SYNC_POLICY
});
