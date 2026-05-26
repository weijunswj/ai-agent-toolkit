'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'source-watch-pr.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');

function workflowPermissions() {
  const match = workflow.match(/^permissions:\n((?:  [A-Za-z-]+: [A-Za-z-]+\n?)+)/m);
  assert.ok(match, 'workflow permissions block is present');
  return match[1].trim().split('\n').map((line) => line.trim()).sort();
}

function updateBranchScript() {
  const marker = '      - name: Update review notification branch';
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, 'update branch step is present');
  const nextStep = workflow.indexOf('\n      - name:', start + marker.length);
  assert.notEqual(nextStep, -1, 'update branch step has an end marker');
  return workflow.slice(start, nextStep);
}

test('source-watch PR notifier remains scheduled-only with minimum write permissions', () => {
  assert.match(workflow, /^name:\s*Source Watch PR Notifier\s*$/m);
  assert.doesNotMatch(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*repository_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*pull_request_target:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*workflow_call:\s*$/m);
  assert.match(
    workflow,
    /intentionally not manually dispatchable[\s\S]{0,120}contents: write[\s\S]{0,120}pull-requests: write/i
  );
  assert.deepEqual(workflowPermissions(), ['contents: write', 'pull-requests: write']);
  assert.doesNotMatch(workflow, /^\s*issues:\s*write\s*$/m);
  assert.match(workflow, /^concurrency:\n  group: source-watch-pr-notifier\n  cancel-in-progress: false$/m);
});

test('source-watch PR notifier runs trusted main code before branch writes', () => {
  assert.match(workflow, /uses:\s*actions\/checkout@v6/);
  assert.match(workflow, /^\s*ref:\s*refs\/heads\/main\s*$/m);
  assert.match(workflow, /^\s*fetch-depth:\s*0\s*$/m);
  assert.match(workflow, /^\s*persist-credentials:\s*false\s*$/m);
  assert.match(workflow, /git fetch origin main/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse origin\/main\)"/);
});

test('source-watch review branch is rebuilt from main and only the report can be staged', () => {
  const script = updateBranchScript();
  assert.match(script, /git switch -C "\$BRANCH" origin\/main/);
  assert.doesNotMatch(script, /origin\/\$BRANCH/);
  assert.doesNotMatch(script, /origin\/"\$BRANCH"/);
  assert.doesNotMatch(script, /refs\/remotes\/origin\/\$BRANCH/);

  const afterSwitch = script.slice(script.indexOf('git switch -C "$BRANCH" origin/main'));
  assert.doesNotMatch(afterSwitch, /node repo\/scripts\//);
  assert.match(script, /REPORT_PATH: repo\/source-watch\/reviews\/active-third-party-updates\.md/);
  assert.match(script, /git add -- "\$REPORT_PATH"/);
  assert.match(script, /staged_files="\$\(git diff --cached --name-only\)"/);
  assert.match(script, /if \[ "\$staged_files" != "\$REPORT_PATH" \]; then/);
  assert.doesNotMatch(script, /git add\s+(?!.*-- "\$REPORT_PATH")/);
});

test('source-watch report writes reject symlinks and push with a lease', () => {
  const script = updateBranchScript();
  assert.match(script, /mkdir -p "\$\(dirname "\$REPORT_PATH"\)"/);
  assert.match(script, /if \[ -L "\$REPORT_PATH" \]; then/);
  assert.match(script, /install -m 0644 "\$REPORT_TEMP" "\$REPORT_PATH"/);
  assert.match(script, /if \[ ! -f "\$REPORT_PATH" \] \|\| \[ -L "\$REPORT_PATH" \]; then/);
  assert.match(script, /git push --force-with-lease="refs\/heads\/\$BRANCH:\$remote_sha" origin "HEAD:\$BRANCH"/);
  assert.doesNotMatch(script, /git push origin "HEAD:main"/i);
});

test('source-watch PR notifier does not become a source updater', () => {
  assert.doesNotMatch(workflow, /gh issue create/i);
  assert.doesNotMatch(workflow, /gh pr merge|--auto/i);
  assert.doesNotMatch(workflow, /repo\/scripts\/safe-source-update\.cjs/i);
  assert.doesNotMatch(workflow, /git add[^\n]*(?:_projects|SOURCE-LOCK\.json)/i);
  assert.doesNotMatch(workflow, /cp .*_projects|install .*_projects/i);
  assert.doesNotMatch(workflow, /git push[^\n]*(?:HEAD:)?main\b/i);
});
