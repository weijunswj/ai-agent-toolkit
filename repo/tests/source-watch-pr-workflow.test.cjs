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

function lifecycleScript() {
  const marker = '      - name: Apply exact review notification PR lifecycle';
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, 'PR lifecycle step is present');
  return workflow.slice(start);
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
  assert.match(workflow, /uses:\s*actions\/checkout@v7/);
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

test('source-watch compares the generated report to the exact remote report before checking out the notification branch', () => {
  const script = updateBranchScript();
  const remoteShaIndex = script.indexOf('remote_sha=');
  const reportInspectionIndex = script.indexOf('git ls-tree "$remote_sha" -- "$REPORT_PATH"');
  const branchCheckoutIndex = script.indexOf('git switch -C "$BRANCH" origin/main');
  assert.ok(remoteShaIndex >= 0, 'remote branch SHA is read');
  assert.ok(reportInspectionIndex > remoteShaIndex, 'report inspection follows the remote SHA read');
  assert.ok(branchCheckoutIndex > reportInspectionIndex, 'trusted-main branch checkout follows report inspection');
  assert.match(script, /generated_report_blob="\$\(git hash-object -- "\$REPORT_TEMP"\)"/);
  assert.match(script, /remote_report_entry="\$\(git ls-tree "\$remote_sha" -- "\$REPORT_PATH"/);
  assert.doesNotMatch(script.slice(0, branchCheckoutIndex), /git show "\$remote_sha:/);
  assert.doesNotMatch(script.slice(0, branchCheckoutIndex), /source-watch\/review-active-third-party-updates.*(?:source|exec)/i);
});

test('identical report bytes emit pushed=false without moving, committing, or pushing the branch', () => {
  const script = updateBranchScript();
  const noOpIndex = script.indexOf('if [ -n "$remote_report_blob" ] && [ "$generated_report_blob" = "$remote_report_blob" ]; then');
  const noOpExitIndex = script.indexOf('exit 0', noOpIndex);
  const branchCheckoutIndex = script.indexOf('git switch -C "$BRANCH" origin/main');
  assert.ok(noOpIndex >= 0, 'identical report comparison is present');
  assert.ok(noOpExitIndex > noOpIndex && noOpExitIndex < branchCheckoutIndex, 'no-op exits before checkout');
  assert.match(script.slice(noOpIndex, noOpExitIndex), /pushed=false/);
  assert.doesNotMatch(script.slice(noOpIndex, noOpExitIndex), /git (?:commit|push|switch)/);
});

test('an unverifiable existing remote report takes the safe rebuild path from trusted main', () => {
  const script = updateBranchScript();
  const reportInspectionIndex = script.indexOf('remote_report_entry=');
  const branchCheckoutIndex = script.indexOf('git switch -C "$BRANCH" origin/main');
  const inspection = script.slice(reportInspectionIndex, branchCheckoutIndex);
  assert.match(inspection, /remote_report_blob=""/);
  assert.match(inspection, /remote_report_type.*blob/);
  assert.match(inspection, /remote_report_mode.*100644/);
  assert.ok(branchCheckoutIndex > reportInspectionIndex);
  assert.match(script, /install -m 0644 "\$REPORT_TEMP" "\$REPORT_PATH"/);
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
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./i);
  assert.doesNotMatch(workflow, /repo\/scripts\/safe-source-update\.cjs/i);
  assert.doesNotMatch(workflow, /git clone|npm (?:install|exec)|\bnpx\b/i);
  assert.doesNotMatch(workflow, /git add[^\n]*(?:_projects|SOURCE-LOCK\.json)/i);
  assert.doesNotMatch(workflow, /cp .*_projects|install .*_projects/i);
  assert.doesNotMatch(workflow, /git push[^\n]*(?:HEAD:)?main\b/i);
});

test('source-watch PR lifecycle metadata queries only exact open PRs', () => {
  assert.match(workflow, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /--state open/);
  assert.doesNotMatch(workflow, /--state all/);
  assert.match(workflow, /--base "\$BASE_BRANCH"/);
  assert.match(workflow, /--head "\$BRANCH"/);
  assert.match(
    workflow,
    /--json number,state,headRefName,baseRefName,headRepositoryOwner,headRepository,isCrossRepository/
  );
  assert.match(workflow, /plan-source-watch-pr-lifecycle\.cjs/);
  assert.doesNotMatch(workflow, /gh pr view "\$BRANCH"/);
});

test('source-watch PR lifecycle never reopens historical closed PRs', () => {
  const script = lifecycleScript();
  assert.match(script, /run: \|\n\s+set -euo pipefail/);
  assert.doesNotMatch(script, /reopen-and-update/);
  assert.doesNotMatch(script, /gh pr reopen/);
  assert.match(script, /create\)[\s\S]*verify_fresh_plan create[\s\S]*gh pr create[\s\S]*verify_open/);
});

test('source-watch PR lifecycle assigns the repository owner on create and update', () => {
  const script = lifecycleScript();
  assert.match(
    script,
    /gh pr edit "\$PR_NUMBER"[^\n]*--add-assignee "\$EXPECTED_OWNER"/
  );
  assert.match(
    script,
    /gh pr create[\s\S]*--assignee "\$EXPECTED_OWNER"[\s\S]*--title "\$PR_TITLE"/
  );
});

test('source-watch PR lifecycle fails closed on ambiguous open matches', () => {
  const script = lifecycleScript();
  const ambiguous = script.slice(
    script.indexOf('            fail-ambiguous-open)'),
    script.indexOf('            update-open)')
  );
  assert.match(ambiguous, /multiple exact matching open PRs/);
  assert.match(ambiguous, /exit 1/);
  assert.doesNotMatch(ambiguous, /gh pr (?:edit|reopen|create)/);
});

test('source-watch PR lifecycle confirms an open exact match after every mutation', () => {
  const script = lifecycleScript();
  assert.match(script, /query_exact_prs > "\$metadata"/);
  assert.match(script, /--mode verify-open/);
  assert.match(
    script,
    /update-open\)[\s\S]*verify_fresh_plan update-open "\$PR_NUMBER"[\s\S]*gh pr edit "\$PR_NUMBER"[\s\S]*verify_open "\$PR_NUMBER"/
  );
  assert.match(script, /verify_fresh_plan create[\s\S]*gh pr create[\s\S]*verify_open/);
});

test('every PR mutation is immediately preceded by a fresh exact lifecycle plan', () => {
  const script = lifecycleScript();
  assert.match(script, /query_exact_prs > "\$metadata"[\s\S]*--mode verify-plan/);
  assert.match(
    script,
    /verify_fresh_plan update-open "\$PR_NUMBER"\n\s+gh pr edit "\$PR_NUMBER"/
  );
  assert.match(script, /verify_fresh_plan create\n\s+gh pr create/);
});

test('fresh ambiguity is checked before any PR mutation', () => {
  const script = lifecycleScript();
  const firstFreshPlan = script.indexOf('verify_fresh_plan update-open "$PR_NUMBER"');
  const firstMutation = script.indexOf('gh pr edit "$PR_NUMBER"');
  assert.ok(firstFreshPlan >= 0 && firstFreshPlan < firstMutation);
  assert.match(script, /--mode verify-plan/);
  assert.match(script, /stale source-watch PR lifecycle plan|expected-action/);
  assert.match(script, /gh pr create[\s\S]*verify_open/);
});

test('no actionable drift skips branch and PR lifecycle steps', () => {
  assert.match(
    workflow,
    /- name: Update review notification branch[\s\S]*?if: steps\.source_updates\.outputs\.pr_needed == 'true'/
  );
  assert.match(
    workflow,
    /- name: Plan exact review notification PR lifecycle[\s\S]*?if: steps\.source_updates\.outputs\.pr_needed == 'true'/
  );
  assert.match(
    workflow,
    /- name: Apply exact review notification PR lifecycle[\s\S]*?if: steps\.source_updates\.outputs\.pr_needed == 'true'/
  );
});

test('source-watch PR notifier documents advisory actions as report-only', () => {
  assert.match(workflow, /\[source-watch\] Review active source-watch updates/);
  assert.match(workflow, /Advisory actions, when present, are read from `repo\/source-watch\/advisory-targets\.json`\./);
  assert.match(workflow, /No advisory tracking document was changed by this workflow\./);
  assert.match(workflow, /If advisory action is taken, update the advisory document in a separate human-reviewed PR\./);
  assert.match(workflow, /No toolkit rules, skills, hooks, memory guidance, repo-map guidance, or cleanup guidance were modified or deleted\./);
  assert.match(workflow, /For Host Harness Capability Drift Review, classify affected toolkit components using the linked template before proposing changes\./);
  assert.match(workflow, /separate evidence-backed PR/);
});
