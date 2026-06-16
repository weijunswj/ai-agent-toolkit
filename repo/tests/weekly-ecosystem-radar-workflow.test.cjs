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

test('weekly ecosystem radar is scheduled-only and PR-only with no issue permission', () => {
  assert.match(workflow, /^name:\s*Weekly Ecosystem Radar\s*$/m);
  assert.match(workflow, /^\s{2}schedule:\s*$/m);
  assert.match(workflow, /^\s*-\s*cron:\s*"37 6 \* \* 2"\s*$/m);
  assert.doesNotMatch(workflow, /^\s*workflow_dispatch:\s*$/m);
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

test('weekly ecosystem radar handles no-diff runs without creating useless PRs', () => {
  const updateScript = stepScript('Update weekly radar branch');
  assert.match(updateScript, /if git diff --cached --quiet; then/);
  assert.match(updateScript, /echo "pushed=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(updateScript, /echo "pushed=true" >> "\$GITHUB_OUTPUT"/);

  const existingPrScript = stepScript('Find existing weekly radar PR');
  assert.match(existingPrScript, /if: steps\.radar\.outputs\.pr_needed == 'true' && steps\.update_branch\.outputs\.pushed != 'true'/);
  assert.match(existingPrScript, /gh pr view "\$BRANCH" --repo "\$GITHUB_REPOSITORY" >/);
  assert.match(existingPrScript, /echo "exists=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(existingPrScript, /echo "exists=false" >> "\$GITHUB_OUTPUT"/);
  assert.doesNotMatch(existingPrScript, /gh pr create|gh pr edit/i);

  const openScript = stepScript('Open or update weekly radar PR');
  assert.match(
    openScript,
    /if: steps\.radar\.outputs\.pr_needed == 'true' && \(steps\.update_branch\.outputs\.pushed == 'true' \|\| steps\.existing_pr\.outputs\.exists == 'true'\)/
  );
  assert.match(openScript, /gh pr edit "\$BRANCH"/);
  assert.match(openScript, /gh pr create --repo "\$GITHUB_REPOSITORY"/);

  const skipScript = stepScript('Skip weekly radar PR without diff');
  assert.match(
    skipScript,
    /if: steps\.radar\.outputs\.pr_needed == 'true' && steps\.update_branch\.outputs\.pushed != 'true' && steps\.existing_pr\.outputs\.exists != 'true'/
  );
  assert.match(skipScript, /No report commit was pushed and no existing open radar PR was found, so no PR was created\./);
  assert.match(skipScript, />> "\$GITHUB_STEP_SUMMARY"/);
  assert.doesNotMatch(skipScript, /gh pr create|gh pr edit|git add|git commit|git push/i);
});

test('weekly ecosystem radar PR body documents the non-mutating safety contract', () => {
  assert.match(workflow, /\[ecosystem-radar\] Weekly ecosystem radar review/);
  for (const required of [
    'This PR is a weekly ecosystem radar report only.',
    'The scheduled workflow stages only `repo/source-watch/reviews/weekly-ecosystem-radar.md`.',
    'No `_projects/**`, `SOURCE-LOCK.json`, generated `skills/**`, advisory baselines, provider or deployment config, secrets, or application code were staged by the workflow.',
    'No issues are created and no `issues: write` permission is requested.',
    'No source pins or advisory baselines were changed.',
    'No upstream code was executed and no upstream packages were installed.',
    'No live deployment actions, provider calls, notification tests, or production mutations are allowed.',
    'No auto-merge is allowed.',
    'Advisory baseline advancement requires a separate human-approved PR.'
  ]) {
    assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), required);
  }
});
