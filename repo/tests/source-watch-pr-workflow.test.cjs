'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'source-watch-pr.yml');
const helperPath = path.join(repoRoot, 'repo', 'scripts', 'update-source-watch-review-branch.sh');
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const helper = fs.readFileSync(helperPath, 'utf8').replace(/\r\n/g, '\n');

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

test('source-watch review branch delegates to the trusted helper', () => {
  const script = updateBranchScript();
  assert.match(script, /REPORT_TEMP: \$\{\{ steps\.source_updates\.outputs\.report_temp \}\}/);
  assert.match(script, /REPORT_PATH: repo\/source-watch\/reviews\/active-third-party-updates\.md/);
  assert.match(script, /bash repo\/scripts\/update-source-watch-review-branch\.sh/);
  assert.doesNotMatch(script, /git\s+(?:commit|push|switch|ls-remote|fetch)/);
});

test('source-watch helper models present, absent, and unverified observations', () => {
  assert.match(helper, /set -euo pipefail/);
  assert.match(helper, /OBS_STATE='unverified'/);
  assert.match(helper, /OBS_STATE='absent'/);
  assert.match(helper, /OBS_STATE='present'/);
  assert.match(helper, /Initial Source Watch branch observation was unverified/);
  assert.match(helper, /Unable to establish a valid Source Watch branch authority/);
});

test('source-watch helper verifies the report-only commit before a no-op and rechecks the exact ref', () => {
  assert.match(helper, /git fetch --no-tags --force origin "refs\/heads\/\$BRANCH:\$inspection_ref"/);
  assert.match(helper, /git rev-list --parents -n 1 "\$remote_sha"/);
  assert.match(helper, /git merge-base --is-ancestor "\$remote_parent" origin\/main/);
  assert.match(helper, /git diff-tree --no-commit-id --name-only --no-renames -r "\$remote_parent" "\$remote_sha"/);
  assert.match(helper, /git ls-tree "\$remote_sha" -- "\$REPORT_PATH"/);
  const noOpIndex = helper.indexOf("if [[ \"$remote_no_op_verified\" == true ]]; then");
  const finalObserveIndex = helper.indexOf('observe_remote_branch', noOpIndex);
  const noOpOutputIndex = helper.indexOf("write_output 'pushed=false'", finalObserveIndex);
  assert.ok(noOpIndex >= 0 && finalObserveIndex > noOpIndex && noOpOutputIndex > finalObserveIndex);
  assert.match(helper, /\[\[ "\$OBS_STATE" != 'present' \|\| "\$OBS_SHA" != "\$remote_sha" \]\]/);
});

test('source-watch helper stages only the report and uses both exact lease forms', () => {
  assert.match(helper, /git switch -C "\$BRANCH" origin\/main/);
  assert.match(helper, /git add -- "\$REPORT_PATH"/);
  assert.match(helper, /staged_files="\$\(git diff --cached --name-only\)"/);
  assert.match(helper, /\[\[ "\$staged_files" != "\$REPORT_PATH" \]\]/);
  assert.match(helper, /git push --force-with-lease="refs\/heads\/\$BRANCH:" origin "HEAD:\$BRANCH"/);
  assert.match(helper, /git push --force-with-lease="refs\/heads\/\$BRANCH:\$remote_sha" origin "HEAD:\$BRANCH"/);
  assert.doesNotMatch(helper, /git\s+push\s+origin\s+"HEAD:\$BRANCH"/);
  assert.doesNotMatch(helper, /git\s+push[^\n]*HEAD:main\b/i);
});

test('source-watch helper rejects symlink reports and never sources notification content', () => {
  assert.match(helper, /-L "\$REPORT_TEMP"/);
  assert.match(helper, /-L "\$REPORT_PATH"/);
  assert.doesNotMatch(helper, /git\s+show\s+"\$remote_sha:/);
  assert.doesNotMatch(helper, /(^|\n)\s*source\s+"/);
});

test('source-watch helper binds the exact notification branch and report path', () => {
  assert.match(helper, /expected_branch='source-watch\/review-active-third-party-updates'/);
  assert.match(helper, /expected_report_path='repo\/source-watch\/reviews\/active-third-party-updates\.md'/);
  assert.match(helper, /Refusing unexpected Source Watch branch/);
  assert.match(helper, /Refusing unexpected Source Watch report path/);
});

test('source-watch helper keeps unverified observations out of inspection refs and leases', () => {
  const observationStart = helper.indexOf('observe_remote_branch()');
  const observationEnd = helper.indexOf('\n}\n\nobserve_remote_branch', observationStart);
  const observation = helper.slice(observationStart, observationEnd);
  assert.match(observation, /OBS_STATE='unverified'/);
  assert.match(observation, /OBS_SHA=''/);
  assert.match(helper, /inspection_ref="refs\/source-watch\/inspect\/\$remote_sha"/);
  assert.match(helper, /remote_sha="\$OBS_SHA"/);
  assert.doesNotMatch(observation, /inspection_ref|force-with-lease/);
});

test('source-watch workflow only invokes the helper after report validation', () => {
  const updateStep = updateBranchScript();
  assert.ok(updateStep.indexOf('test -f "$REPORT_TEMP"') < updateStep.indexOf('bash repo/scripts/update-source-watch-review-branch.sh'));
  assert.ok(updateStep.indexOf('test ! -L "$REPORT_TEMP"') < updateStep.indexOf('bash repo/scripts/update-source-watch-review-branch.sh'));
});

test('source-watch helper passes shell syntax validation', () => {
  const bash = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'].find((candidate) => fs.existsSync(candidate)) || 'bash'
    : 'bash';
  const result = require('node:child_process').spawnSync(bash, ['-n', helperPath], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.error);
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
