'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'source-watch-pr.yml');
const helperPath = path.join(repoRoot, 'repo', 'scripts', 'update-source-watch-review-branch.sh');
const legacyProjectToken = '_' + 'projects';
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
  assert.match(workflow, /uses:\s*actions\/checkout@[0-9a-f]{40} # v7\.\d+\.\d+$/m);
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
  assert.match(helper, /git fetch --no-tags origin "refs\/heads\/\$BRANCH:\$inspection_ref"/);
  assert.match(helper, /git merge-base origin\/main "\$tip"/);
  assert.match(helper, /git rev-list --parents --reverse "\$base\.\.\$tip"/);
  assert.match(helper, /git diff-tree --no-commit-id --name-only --no-renames -r "\$parent" "\$commit"/);
  assert.match(helper, /git ls-tree "\$commit" -- "\$REPORT_PATH"/);
  assert.match(helper, /git cat-file -e "origin\/main:\$REPORT_PATH"/);
  const noOpIndex = helper.indexOf('if [[ "$generated_report_blob" == "$report_tip_blob" ]]; then');
  const finalObserveIndex = helper.indexOf('observe_remote_branch', noOpIndex);
  const noOpOutputIndex = helper.indexOf("write_output 'pushed=false'", finalObserveIndex);
  assert.ok(noOpIndex >= 0 && finalObserveIndex > noOpIndex && noOpOutputIndex > finalObserveIndex);
  assert.match(helper, /\[\[ "\$OBS_STATE" != 'present' \|\| "\$OBS_SHA" != "\$remote_sha" \]\]/);
});

test('source-watch helper builds the commit off the checkout and pushes fast-forward only', () => {
  assert.match(helper, /GIT_INDEX_FILE="\$temp_index" git read-tree "\$parent_commit"/);
  assert.match(helper, /git update-index --add --cacheinfo "100644,\$report_blob,\$REPORT_PATH"/);
  assert.match(helper, /git commit-tree "\$new_tree" -p "\$parent_commit"/);
  assert.match(helper, /changed_files="\$\(git diff-tree --no-commit-id --name-only --no-renames -r "\$parent_commit" "\$new_commit"\)"/);
  assert.match(helper, /\[\[ "\$changed_files" != "\$REPORT_PATH" \]\]/);
  // The checkout must stay on trusted main for the later workflow steps.
  assert.doesNotMatch(helper, /git\s+(?:switch|checkout|reset|config|add|commit\s)/);
  const pushes = helper.split('\n').filter((line) => /push_review_branch\s+origin/.test(line));
  assert.deepEqual(pushes.map((line) => line.trim()), ['if ! push_review_branch origin "$new_commit:refs/heads/$BRANCH"; then']);
  assert.doesNotMatch(helper, /git\s+push[^\n]*HEAD:main\b/i);
  // The push token goes only to that one push, through git's environment configuration.
  assert.match(helper, /GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0='http\.https:\/\/github\.com\/\.extraheader' GIT_CONFIG_VALUE_0="\$header"/);
  assert.doesNotMatch(helper, /remote\s+set-url|x-access-token:\$\{GH_TOKEN\}@/);
});

test('the notifier never force-pushes or deletes, because the repository forbids it on every branch', () => {
  for (const [name, text] of [['helper', helper], ['workflow', workflow]]) {
    assert.doesNotMatch(text, /--force\b/, `${name} has no --force`);
    assert.doesNotMatch(text, /force-with-lease|force-if-includes/, `${name} has no lease push`);
    assert.doesNotMatch(text, /(?:git push|push_review_branch)[^\n]*\s-f\b/, `${name} has no -f push flag`);
    assert.doesNotMatch(text, /(?:git push|push_review_branch)[^\n]*\s-d\b/, `${name} has no -d push flag`);
    assert.doesNotMatch(text, /--mirror|--prune|--delete/, `${name} has no mirror, prune or delete push`);
    assert.doesNotMatch(text, /["'\s]\+(?:"|\$|HEAD|refs\/|[0-9a-f]{7})/, `${name} has no + refspec`);
    assert.doesNotMatch(text, /["'\s]:refs\//, `${name} has no empty-source delete refspec`);
    assert.doesNotMatch(text, /git\/refs|force=true|-X\s*DELETE|--method\s+DELETE/i, `${name} has no ref API write`);
    assert.doesNotMatch(text, /--delete-branch|git\s+branch\s+-[dD]/, `${name} never deletes a branch`);
  }
});

test('every step after the branch update re-checks that it runs trusted main code', () => {
  for (const marker of [
    '      - name: Plan exact review notification PR lifecycle',
    '      - name: Apply exact review notification PR lifecycle',
    '      - name: Close review notification PR when nothing is left to review'
  ]) {
    const start = workflow.indexOf(marker);
    assert.notEqual(start, -1, marker);
    const end = workflow.indexOf('\n      - name:', start + marker.length);
    const step = workflow.slice(start, end === -1 ? undefined : end);
    assert.match(step, /set -euo pipefail\n(?:\s*#[^\n]*\n)?\s*test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse origin\/main\)"/, marker);
  }
});

test('the helper refuses any branch it cannot extend, instead of rebuilding it', () => {
  assert.match(helper, /^refuse\(\) \{\n[\s\S]*?exit 1\n\}/m);
  for (const reason of [
    'trusted main already contains the report path',
    'the branch shares no history with trusted main',
    'the branch has no report commits after trusted main',
    'is not a single-parent report commit',
    'changes paths other than the report',
    'does not leave the report as a regular file',
    'the remote branch could not be fetched for inspection'
  ]) {
    assert.ok(helper.includes(reason), reason);
  }
});

test('source-watch helper rejects symlink reports and never sources notification content', () => {
  assert.match(helper, /-L "\$REPORT_TEMP"/);
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
  assert.doesNotMatch(observation, /inspection_ref|push/);
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
  assert.doesNotMatch(workflow, new RegExp(`git add[^\\n]*(?:${legacyProjectToken}|SOURCE-LOCK\\.json)`, 'i'));
  assert.doesNotMatch(workflow, new RegExp(`cp .*${legacyProjectToken}|install .*${legacyProjectToken}`, 'i'));
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
    /--json number,state,headRefName,baseRefName,headRepositoryOwner,headRepository,isCrossRepository,author/
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

test('no actionable drift skips branch update and the create-or-update lifecycle', () => {
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

function closeStep() {
  const marker = '      - name: Close review notification PR when nothing is left to review';
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, 'close step is present');
  const nextStep = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, nextStep);
}

test('the close step runs only when nothing is actionable and never deletes the branch', () => {
  const step = closeStep();
  assert.match(step, /if: steps\.source_updates\.outputs\.pr_needed == 'false'/);
  assert.match(step, /--actionable false/);
  assert.doesNotMatch(step, /--actionable true/);
  assert.match(step, /plan_close --mode verify-plan --expected-action close-open --expected-number "\$PR_NUMBER"\n\s+gh pr close "\$PR_NUMBER"/);
  assert.doesNotMatch(step, /--delete-branch|gh api|git push|gh pr (?:merge|edit|create|reopen)/);
  assert.match(step, /fail-ambiguous-open\)[\s\S]*?exit 1/);
});

// Runs the close step's script with a stub gh that serves the given open PRs and records closes.
function runCloseStep(t, openPullRequests) {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-watch-close-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const step = closeStep();
  const runIndex = step.indexOf('        run: |\n');
  const script = step.slice(runIndex + '        run: |\n'.length)
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .filter((line) => !line.startsWith('test "$(git rev-parse HEAD)"'))
    .join('\n');
  const state = path.join(root, 'open.json');
  const log = path.join(root, 'gh.log');
  fs.writeFileSync(state, JSON.stringify(openPullRequests));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  const stub = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$STUB_LOG"
if [[ "$1 $2" == 'pr list' ]]; then cat "$STUB_STATE"; exit 0; fi
if [[ "$1 $2" == 'pr close' ]]; then printf '[]' > "$STUB_STATE"; exit 0; fi
exit 1
`;
  fs.writeFileSync(path.join(binDir, 'gh'), stub);
  fs.chmodSync(path.join(binDir, 'gh'), 0o755);
  const bash = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe'].find((candidate) => fs.existsSync(candidate)) || 'bash'
    : 'bash';
  const result = spawnSync(bash, ['-c', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      STUB_STATE: state,
      STUB_LOG: log,
      RUNNER_TEMP: root,
      GITHUB_REPOSITORY: 'weijunswj/ai-agent-toolkit',
      GH_TOKEN: '',
      BRANCH: 'source-watch/review-active-third-party-updates',
      BASE_BRANCH: 'main',
      EXPECTED_OWNER: 'weijunswj'
    }
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  return { result, calls };
}

function openNotice(number, author = { login: 'app/github-actions', is_bot: true }) {
  return {
    number,
    state: 'OPEN',
    headRefName: 'source-watch/review-active-third-party-updates',
    baseRefName: 'main',
    headRepositoryOwner: { login: 'weijunswj' },
    headRepository: { nameWithOwner: 'weijunswj/ai-agent-toolkit' },
    isCrossRepository: false,
    author
  };
}

test('the close step closes the one bot notice and keeps its branch', { skip: process.platform === 'win32' }, (t) => {
  const { result, calls } = runCloseStep(t, [openNotice(579)]);
  assert.equal(result.status, 0, result.stderr);
  const closes = calls.filter((call) => call.startsWith('pr close'));
  assert.equal(closes.length, 1);
  assert.match(closes[0], /^pr close 579 --repo weijunswj\/ai-agent-toolkit --comment /);
  assert.doesNotMatch(closes[0], /--delete-branch/);
});

test('the close step leaves a person\'s PR open and fails closed on two notices', { skip: process.platform === 'win32' }, (t) => {
  const person = runCloseStep(t, [openNotice(600, { login: 'weijunswj', is_bot: false })]);
  assert.equal(person.result.status, 0, person.result.stderr);
  assert.equal(person.calls.filter((call) => call.startsWith('pr close')).length, 0);
  const ambiguous = runCloseStep(t, [openNotice(601), openNotice(602)]);
  assert.notEqual(ambiguous.result.status, 0);
  assert.equal(ambiguous.calls.filter((call) => call.startsWith('pr close')).length, 0);
});

test('source-watch PR notifier documents advisory actions as report-only', () => {
  assert.match(workflow, /\[source-watch\] Review active source-watch updates/);
  assert.match(workflow, /Advisory actions, when present, are read from `repo\/source-watch\/advisory-targets\.json`\./);
  assert.match(workflow, /No advisory tracking document was changed by this workflow\./);
  assert.match(workflow, /If advisory action is taken, update the advisory document in a separate human-reviewed PR\./);
  assert.match(workflow, /No toolkit rules, skills, hooks, repo-map guidance, or cleanup guidance were modified or deleted\./);
  assert.match(workflow, /For Host Harness Capability Drift Review, classify affected toolkit components using the linked template before proposing changes\./);
  assert.match(workflow, /separate evidence-backed PR/);
});
