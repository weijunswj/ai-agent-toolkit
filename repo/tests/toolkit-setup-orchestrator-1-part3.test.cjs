'use strict';
const test = require('node:test');
const {
  assert, fs, path, spawnSync, repoRoot, script, tmpRoot, isolatedHomeEnv, writeFile, createFakeCodexAppServer, run, runTestGit, escapeRegExp,
  createGitBackedSetupRepo, createGitBackedRealSetupRepo, createFakeManagedSetupScript,
  runWithUnclosedStdin, codexConfig, backupFiles, displayedBankReference, auditFixture, specsForAudit, parseConciseInFreshProcess
} = require('./toolkit-setup-test-support.cjs');
const core = require('../scripts/setup-toolkit-core.cjs');
function snapshotTree(root) {
  const entries = [];
  const visit = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      entries.push([path.relative(root, file), item.isDirectory() ? null : fs.readFileSync(file).toString('base64')]);
      if (item.isDirectory()) visit(file);
    }
  };
  visit(root);
  return entries;
}

// Split by complete test declarations to keep the per-file time budget.
test('canonical question specification orders delegation before plugin auto-refresh for TTY and stdin', () => {
  const args = core.parseArgs(['--execute']);
  const current = {
    managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: {} },
    delegation: { status: 'unconfigured', detail: 'not configured' },
    nativePlugin: { status: 'not checked' },
  };
  const keys = core.setupQuestionSpecs(args, current).map((spec) => spec.key);
  assert.deepEqual(keys, [
    'managedCheckout', 'repoAutoUpdate', 'updateReports', 'updateReportRetention', 'codexDocLimit', 'codexHelperCapacity', 'codexPluginAutoRefresh',
  ]);
  assert.equal(args.setupChoices.codexHelperCapacity, '');
});

test('agent-facing setup docs match the report question rows', () => {
  const args = core.parseArgs(['--plan']);
  const current = {
    managed: { currentPath: '', selectedPath: '', defaultPath: '', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: {} },
    delegation: { status: 'unconfigured', detail: 'not configured' },
    nativePlugin: { status: 'not checked' },
  };
  const reportRows = core.setupQuestionSpecs(args, current)
    .filter((spec) => /report/i.test(`${spec.key} ${spec.title}`));
  assert.deepEqual(reportRows.map((spec) => spec.key), ['updateReports', 'updateReportRetention']);
  assert.equal(reportRows.some((spec) => /open/i.test(spec.key)), false);

  const docs = [
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/HOW-TO-USE.md',
    'repo/docs/TOOLKIT-LOCAL-BRIDGE.md',
    'skills/toolkit-setup/SKILL.md',
  ];
  for (const relPath of docs) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /report creation|update report writes|meaningful update reports (?:stay|are) enabled/i, relPath);
    assert.match(text, /report creation and retention|report(?:\/log)? retention|reports\/logs older than|reports.*kept for/i, relPath);
    assert.match(text, /(?:action-required|failed or safety-blocked|reports (?:needing|requiring) action)[^.;\n]{0,120}open automatically/i, relPath);
    assert.match(text, /successful[^.;\n]{0,100}reports (?:remain|stay) closed/i, relPath);
    assert.doesNotMatch(text, /(?:question bank|wizard)[^.\n]*(?:report auto-open|report opening)/i, relPath);
    assert.doesNotMatch(text, /(?:ask|answer|pipe|choice)[^.\n]{0,100}(?:report auto-open|report opening)/i, relPath);
  }
});

test('canonical wizard renderer is compact, aligned, and free of implementation vocabulary', () => {
  const args = core.parseArgs(['--plan']);
  const current = {
    managed: { currentPath: '', selectedPath: 'C:\\hidden', defaultPath: 'C:\\hidden', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: {
      repo_auto_update: { enabled: false },
      update_report_enabled: true,
      update_report_open_enabled: true,
      update_report_retention_days: 7,
      codex_plugin_auto_refresh_enabled: false,
    },
    runtime: { runtime: 'MultiAgentV2' },
    delegation: { status: 'unconfigured', helper_count: null, detail: 'technical detail' },
    nativePlugin: { status: 'fresh' },
  };
  const planned = core.plannedQuestionBank(args, current);
  const text = core.renderSetupQuestionBank(planned.specs);
  const terminal = core.renderSetupQuestionBankTerminal(planned.specs);
  assert.match(text, /## 1\. Updates and reports[\s\S]*## 2\. Computer performance/);
  assert.doesNotMatch(text, /## \d+\. Toolkit in your coding apps/);
  assert.doesNotMatch(text, /Update report auto-open|MultiAgentV[12]|max_threads|max_concurrent|AI-AGENT-TOOLKIT|PR #|issue #|C:\\|restore command|migration/i);
  assert.doesNotMatch(text, /Codex helper agents|One helper at most|Use a custom number/i);
  assert.doesNotMatch(text, /\bAdvanced(?: options)?\b|Show advanced choices|More options/);
  assert.doesNotMatch(text, /\*\*Choices:\*\*[^\n]*(?:\/|\|)/);
  assert.doesNotMatch(terminal, /Codex helper agents|One helper at most|Use a custom number/i);
  assert.doesNotMatch(terminal, /Choices:[^\n]*(?:\/|,)/);
  assert.match(text, /Bank reference: [\s\S]*Reply with either:[\s\S]*- `all recommended`[\s\S]*setup-toolkit-question-bank:complete/);
  for (const spec of planned.specs) assert.ok(spec.description.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2, spec.key);

  current.delegation.helper_count = 4;
  assert.equal(core.setupQuestionSpecs(args, current).find((spec) => spec.key === 'codexHelperCapacity').recommended, 'one-helper');
});
