'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'weekly-ecosystem-radar.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');

function workflowPermissions() {
  const match = workflow.match(/^permissions:\n((?:  [A-Za-z-]+: [A-Za-z-]+\n?)+)/m);
  assert.ok(match, 'workflow permissions block is present');
  return match[1].trim().split('\n').map((line) => line.trim()).sort();
}

function stepScript(name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `${name} step is present`);
  const nextStep = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, nextStep === -1 ? workflow.length : nextStep);
}

test('weekly ecosystem radar is scheduled and manually dispatchable with no issue permission', () => {
  assert.match(workflow, /^name:\s*Weekly Ecosystem Radar\s*$/m);
  assert.match(workflow, /^\s{2}schedule:\s*$/m);
  assert.match(workflow, /^\s*-\s*cron:\s*"37 6 \* \* 2"\s*$/m);
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*repository_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*pull_request_target:\s*$/m);
  assert.deepEqual(workflowPermissions(), ['contents: write', 'pull-requests: write']);
  assert.doesNotMatch(workflow, /^\s*issues:\s*write\s*$/m);
  assert.doesNotMatch(workflow, /gh issue create/i);
  assert.doesNotMatch(workflow, /gh pr merge|--auto/i);
});

test('weekly ecosystem radar runs trusted main code before branch writes', () => {
  assert.match(workflow, /uses:\s*actions\/checkout@v6/);
  assert.match(workflow, /^\s*ref:\s*refs\/heads\/main\s*$/m);
  assert.match(workflow, /^\s*fetch-depth:\s*0\s*$/m);
  assert.match(workflow, /^\s*persist-credentials:\s*false\s*$/m);
  assert.match(workflow, /git fetch origin main/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /node repo\/scripts\/audit-project-source-locks\.cjs/);
  assert.match(workflow, /node repo\/scripts\/check-ecosystem-updates\.cjs --report "\$REPORT_TEMP"/);
});

test('weekly ecosystem radar stages only the generated report path', () => {
  const script = stepScript('Update weekly radar branch');
  assert.match(script, /BRANCH: codex\/weekly-ecosystem-radar/);
  assert.match(script, /REPORT_PATH: repo\/source-watch\/reviews\/weekly-ecosystem-radar\.md/);
  assert.match(script, /git switch -C "\$BRANCH" origin\/main/);
  assert.match(script, /git add -- "\$REPORT_PATH"/);
  assert.match(script, /staged_files="\$\(git diff --cached --name-only\)"/);
  assert.match(script, /if \[ "\$staged_files" != "\$REPORT_PATH" \]; then/);
  assert.doesNotMatch(script, /git add\s+(?!.*-- "\$REPORT_PATH")/);
  assert.doesNotMatch(script, /git add[^\n]*(?:_projects|SOURCE-LOCK\.json|skills\/|repo\/ecosystem-radar\.json)/i);
  assert.doesNotMatch(script, /node repo\/scripts\//);
});

test('weekly ecosystem radar rejects symlink report writes and pushes with a lease', () => {
  const script = stepScript('Update weekly radar branch');
  assert.match(script, /mkdir -p "\$\(dirname "\$REPORT_PATH"\)"/);
  assert.match(script, /if \[ -L "\$REPORT_PATH" \]; then/);
  assert.match(script, /install -m 0644 "\$REPORT_TEMP" "\$REPORT_PATH"/);
  assert.match(script, /if \[ ! -f "\$REPORT_PATH" \] \|\| \[ -L "\$REPORT_PATH" \]; then/);
  assert.match(script, /git push --force-with-lease="refs\/heads\/\$BRANCH:\$remote_sha" origin "HEAD:\$BRANCH"/);
  assert.doesNotMatch(script, /git push origin "HEAD:main"/i);
});

test('weekly ecosystem radar keeps job summary but creates a PR notification whenever drift exists', () => {
  const updateScript = stepScript('Update weekly radar branch');
  assert.match(updateScript, /if git diff --cached --quiet; then/);
  assert.match(updateScript, /git commit --allow-empty -m "Record weekly ecosystem radar review"/);
  assert.doesNotMatch(updateScript, /echo "pushed=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(updateScript, /echo "pushed=true" >> "\$GITHUB_OUTPUT"/);

  assert.doesNotMatch(workflow, /Find existing weekly radar PR/);
  assert.doesNotMatch(workflow, /Skip weekly radar PR without diff/);
  assert.doesNotMatch(workflow, /No report commit was pushed and no existing open radar PR was found, so no PR was created\./);

  const openScript = stepScript('Open or update weekly radar PR');
  assert.match(openScript, /BRANCH: codex\/weekly-ecosystem-radar/);
  assert.match(openScript, /PR_TITLE: "\[radar\] Weekly ecosystem update review"/);
  assert.match(
    openScript,
    /if: steps\.radar\.outputs\.pr_needed == 'true' && steps\.update_branch\.outputs\.pushed == 'true'/
  );
  assert.match(openScript, /gh pr edit "\$BRANCH"/);
  assert.match(openScript, /gh pr create --repo "\$GITHUB_REPOSITORY"/);

  const summaryScript = stepScript('Write weekly radar job summary');
  assert.match(summaryScript, />> "\$GITHUB_STEP_SUMMARY"/);
  assert.match(summaryScript, /Upstream drift detected\. Manual review required\./);
  assert.match(summaryScript, /No upstream source drift or advisory changes were detected\./);
  assert.doesNotMatch(summaryScript, /gh pr create|gh pr edit|git add|git commit|git push/i);
});
test('weekly ecosystem radar PR body documents the non-mutating safety contract', () => {
  assert.match(workflow, /\[radar\] Weekly ecosystem update review/);
  assert.doesNotMatch(workflow, /weekly ecosystem radar report only/i);
  for (const required of [
    'Upstream drift detected. Manual review required.',
    'This PR exists because actionable ecosystem drift was detected.',
    'Source-lock drift requiring manual review is listed in the generated report.',
    'Advisory baseline candidates requiring human approval are listed separately in the generated report.',
    'Non-actionable informational notes are listed separately in the generated report.',
    'The workflow stages only `repo/source-watch/reviews/weekly-ecosystem-radar.md`.',
    'No `_projects/**`, `SOURCE-LOCK.json`, generated `skills/**`, advisory baselines, provider or deployment config, secrets, or application code were staged by the workflow.',
    'No issues are created and no `issues: write` permission is requested.',
    'No source pins or advisory baselines were changed.',
    'No upstream code was executed and no upstream packages were installed.',
    'No live deployment actions, provider calls, notification tests, or production mutations are allowed.',
    'No auto-merge is allowed.',
    'Advisory baseline advancement requires a separate human-approved PR.',
    'Keep source-pin/source-file update PRs separate from advisory-baseline PRs.'
  ]) {
    assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), required);
  }
});
