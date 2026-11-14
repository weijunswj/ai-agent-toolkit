'use strict';

// The re-bump workflow holds a push key, so its shape is pinned: when it runs, what it checks out,
// what it may write, and that it does nothing without the key.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/toolkit-rebump.yml'), 'utf8').replace(/\r\n/g, '\n');
const step = path.join(ROOT, 'repo/scripts/toolkit-rebump-action.sh');
// The workflow without its comment lines.
const code = workflow.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');

test('it runs only on a push to main, one run at a time', () => {
  assert.match(code, /\non:\n  push:\n    branches:\n      - main\n\n/);
  for (const trigger of ['pull_request', 'pull_request_target', 'workflow_dispatch', 'workflow_run', 'schedule', 'issue_comment', 'repository_dispatch']) {
    assert.doesNotMatch(code, new RegExp(`\\b${trigger}\\b`), trigger);
  }
  assert.match(code, /\nconcurrency:\n  group: toolkit-rebump\n  cancel-in-progress: false\n/);
});

test('it checks out the pushed main commit without saved credentials and pins every action', () => {
  const uses = [...code.matchAll(/^\s*uses: (\S+)/gm)].map(match => match[1]);
  assert.equal(uses.length, 2);
  for (const action of uses) assert.match(action, /^actions\/(?:checkout|setup-node)@[0-9a-f]{40}$/, action);
  assert.match(code, /uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n        with:\n          ref: \$\{\{ github\.sha \}\}\n          fetch-depth: 0\n          persist-credentials: false\n/);
  // No expression reaches a shell line: values arrive through env only.
  for (const line of code.split('\n').filter(text => /^\s*run:/.test(text))) assert.doesNotMatch(line, /\$\{\{/, line);
});

test('permissions are read-only except pull request comments, and the key reaches one step only', () => {
  assert.match(code, /\npermissions:\n  contents: read\n\n/);
  assert.match(code, /\n    permissions:\n      contents: read\n      pull-requests: write\n    steps:/);
  assert.equal([...code.matchAll(/^\s*[a-z-]+: write$/gm)].length, 1);
  assert.equal([...code.matchAll(/secrets\./g)].length, 1);
  assert.match(code, /        env:\n          TOOLKIT_REBUMP_TOKEN: \$\{\{ secrets\.TOOLKIT_REBUMP_TOKEN \}\}\n          AUTHORS: \$\{\{ github\.repository_owner \}\}\n          READ_TOKEN: \$\{\{ github\.token \}\}\n          REPOSITORY: \$\{\{ github\.repository \}\}\n        run: bash repo\/scripts\/toolkit-rebump-action\.sh\n/);
  // The comment step uses the built-in token and runs only after a real run.
  assert.match(code, /        if: \$\{\{ steps\.rebump\.outputs\.ran == 'true' \}\}\n        env:\n          GH_TOKEN: \$\{\{ github\.token \}\}\n        run: node repo\/scripts\/toolkit-rebump-report\.cjs /);
});

test('the step script never force-pushes, merges a pull request or names main as a push target', () => {
  const text = fs.readFileSync(step, 'utf8');
  assert.doesNotMatch(text, /--force|force-with-lease|\bpr\s+merge\b|git push|\brebase\b/);
  assert.match(text, /toolkit-rebump-prs\.cjs --apply --authors "\$\{AUTHORS:\?\}"/);
});

// The step script is bash on the Linux runner; Windows has no part in this workflow.
const linuxOnly = { skip: process.platform === 'win32' ? 'the workflow runs on Linux only' : false };
function runStep(t, env) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rebump-step-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bin = path.join(temp, 'bin'); fs.mkdirSync(bin);
  const log = path.join(temp, 'calls.log');
  // Stand-ins that record their call and whether the key was in their environment.
  for (const name of ['gh', 'git', 'node']) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $* key=\${GH_TOKEN:-none}" >> "${log}"\n[ "${name}" = node ] && { echo '{"results":[]}'; exit 1; }\nexit 0\n`, { mode: 0o755 });
  }
  const output = path.join(temp, 'output');
  const result = spawnSync('bash', [step], { cwd: ROOT, encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: temp, RUNNER_TEMP: temp, GITHUB_OUTPUT: output, GITHUB_SERVER_URL: 'https://github.com', AUTHORS: 'owner-1', ...env } });
  return { result, temp, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [], output: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
}

// With no key: a stand-in gh that answers the open pull request list and each one's files.
function runNoKey(t, { open = '', files = {}, failList = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rebump-nokey-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bin = path.join(temp, 'bin'); fs.mkdirSync(bin);
  const log = path.join(temp, 'calls.log');
  fs.writeFileSync(path.join(temp, 'open'), open);
  for (const [number, list] of Object.entries(files)) fs.writeFileSync(path.join(temp, `files-${number}`), list.join('\n'));
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho "gh $2 key=\${GH_TOKEN:-none}" >> "${log}"\n` +
    `case "$2" in *pulls\\?state=open*) ${failList ? 'exit 1' : `cat "${temp}/open"; exit 0`} ;; esac\n` +
    `n=$(echo "$2" | sed -n 's|.*/pulls/\\([0-9]*\\)/files.*|\\1|p'); [ -f "${temp}/files-$n" ] && cat "${temp}/files-$n"; exit 0\n`, { mode: 0o755 });
  for (const name of ['git', 'node']) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit 0\n`, { mode: 0o755 });
  const output = path.join(temp, 'output');
  const result = spawnSync('bash', [step], { cwd: ROOT, encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: temp, RUNNER_TEMP: temp, GITHUB_OUTPUT: output, GITHUB_SERVER_URL: 'https://github.com', AUTHORS: 'owner-1', READ_TOKEN: 'read-token', REPOSITORY: 'owner-1/repo' } });
  return { result, temp, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [], output: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
}

test('with no push key and no stale bump the step reads with the built-in token only and ends green and silent', linuxOnly, t => {
  const { result, calls, output, temp } = runNoKey(t, { open: '5 owner-1\n6 someone-else\n', files: { 5: ['README.md'], 6: ['repo/contracts/toolkit-local-bridge/version.json'] } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '', 'no note on every merge');
  assert.equal(output, 'ran=false\n');
  assert.deepEqual(calls, ['gh repos/owner-1/repo/pulls?state=open&per_page=100 key=read-token', 'gh repos/owner-1/repo/pulls/5/files?per_page=100 key=read-token'], 'other authors are not read; nothing else runs');
  assert.equal(fs.existsSync(path.join(temp, 'rebump-report.json')), false);
});

test('with no push key a listed author\'s pull request carrying a stale bump fails the run naming it and the by-hand step', linuxOnly, t => {
  const { result, output } = runNoKey(t, { open: '5 owner-1\n7 owner-1\n', files: { 5: ['repo/contracts/toolkit-local-bridge/version.json', 'README.md'], 7: ['repo/scripts/x.cjs'] } });
  assert.equal(result.status, 1);
  assert.equal(output, 'ran=false\n');
  assert.match(result.stdout, /^::error title=Toolkit re-bump::Main moved and these pull requests carry a version bump that is now stale: #5\. .+toolkit-rebump-prs\.cjs --apply/m);
  const unread = runNoKey(t, { failList: true });
  assert.equal(unread.result.status, 1, 'a list that cannot be read is red, not green');
  assert.match(unread.result.stdout, /could not be read/);
});

test('with a push key it signs in, runs the command for the listed authors and keeps the report even when a pull request is held', linuxOnly, t => {
  const { result, calls, output, temp } = runStep(t, { TOOLKIT_REBUMP_TOKEN: 'fixture-key' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(output, 'ran=true\n');
  assert.deepEqual(calls, [
    'gh auth setup-git key=fixture-key',
    'git config --global user.name github-actions[bot] key=fixture-key',
    'git config --global user.email github-actions[bot]@users.noreply.github.com key=fixture-key',
    'node repo/scripts/toolkit-rebump-prs.cjs --apply --authors owner-1 key=fixture-key',
  ]);
  assert.equal(fs.readFileSync(path.join(temp, 'rebump-report.json'), 'utf8'), '{"results":[]}\n');
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-key/);
});
