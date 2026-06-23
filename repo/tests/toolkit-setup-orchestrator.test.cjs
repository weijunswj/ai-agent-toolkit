'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const script = path.join(repoRoot, 'repo', 'scripts', 'setup-toolkit.cjs');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-setup-'));
}

function isolatedHomeEnv(root) {
  return {
    PATH: process.env.PATH || '',
    USERPROFILE: root,
    HOME: root,
    LOCALAPPDATA: path.join(root, 'local-app-data'),
    VIRTUAL_ENV: '',
    CONDA_PREFIX: '',
    UV_PYTHON: ''
  };
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
    timeout: 10000,
    windowsHide: true
  });
}

function flattenCommands(plan) {
  return plan.steps.flatMap((step) => step.commands || []);
}

test('setup toolkit plan is full journey rather than plugin verify only', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json', '--repo-root', repoRoot], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);

  const plan = JSON.parse(result.stdout);
  assert.equal(plan.name, 'setup toolkit');
  assert.deepEqual(plan.steps.map((step) => step.id), [
    'trusted_repo_state',
    'codex_native_plugin_cache',
    'lite_validation',
    'repo_backed_auto_update',
    'bridge_audit',
    'non_native_target_approval',
    'approved_target_sync'
  ]);

  const commands = flattenCommands(plan);
  assert.deepEqual(commands.slice(0, 4), [
    'git status --short',
    'git switch main',
    'git fetch origin main',
    'git merge --ff-only origin/main'
  ]);
  assert.ok(commands.includes('node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json'));
  assert.ok(commands.includes('node repo/scripts/setup-codex-toolkit-plugin.cjs --write --json'));
  assert.ok(commands.includes('node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json'));
  assert.ok(commands.includes('node repo/scripts/validate-toolkit.cjs'));
  assert.ok(commands.includes('node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs'));
  assert.ok(commands.includes(`node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path "${repoRoot}" --repo-branch main --enable-auto-sync --write`));
  assert.ok(commands.includes('node repo/scripts/toolkit-local-bridge.cjs --audit'));
  assert.ok(commands.includes('node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write'));

  const text = JSON.stringify(plan);
  assert.doesNotMatch(text, /repo\/tests\/toolkit-local-bridge\.test\.cjs/);
  assert.doesNotMatch(text, /npm\s+run\s+validate:all/);
  assert.doesNotMatch(text, /--open-update-report|--enable-update-report-open/);
  assert.doesNotMatch(text, /\b(?:npm|pip|docker|n8n)\s+(?:install|run|compose|import|export)\b/i);
  assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit')), false, 'plan mode must not write user-local bridge state');
});

test('setup toolkit plan keeps repo auto-update and target writes approval-gated', () => {
  const root = tmpRoot();
  const result = run(['--plan', '--json', '--repo-root', repoRoot], {
    env: isolatedHomeEnv(root)
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);

  const repoStep = plan.steps.find((step) => step.id === 'repo_backed_auto_update');
  assert.equal(repoStep.approval_required, true);
  assert.equal(repoStep.write_flag, '--write-repo-auto-update');
  assert.match(repoStep.approval_question, /repo-backed auto-update/i);
  assert.match(repoStep.approval_question, /main/i);
  assert.doesNotMatch(repoStep.commands.join('\n'), /--enable-target/);

  const targetStep = plan.steps.find((step) => step.id === 'non_native_target_approval');
  assert.equal(targetStep.approval_required, true);
  assert.match(targetStep.approval_question, /OpenCode/);
  assert.match(targetStep.approval_question, /Antigravity 2/);
  assert.match(targetStep.approval_question, /~\/\.config\/opencode\/skills\/ai-agent-toolkit/);
  assert.match(targetStep.approval_question, /~\/\.gemini\/config\/plugins\/ai-agent-toolkit/);

  const syncStep = plan.steps.find((step) => step.id === 'approved_target_sync');
  assert.equal(syncStep.approval_required, true);
  assert.equal(syncStep.write_flag, '--enable-target <opencode|ag2>');
  assert.match(syncStep.commands.join('\n'), /--enable-target opencode --enable-target ag2 --write/);
  assert.match(syncStep.commands.join('\n'), /--sync-enabled --write/);
});

test('setup docs route literal setup toolkit to the orchestrator', () => {
  const relPaths = [
    '_projects/development/toolkit-local-bridge/curated_output_for_ai/skills/toolkit-setup/SKILL.md',
    'skills/toolkit-setup/SKILL.md',
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/TOOLKIT-LOCAL-BRIDGE-V2.md',
    'repo/docs/HOW-TO-USE.md'
  ];

  for (const relPath of relPaths) {
    const text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    assert.match(text, /setup toolkit/i, relPath);
    assert.match(text, /node repo\/scripts\/setup-toolkit\.cjs --execute/i, relPath);
  }
});
