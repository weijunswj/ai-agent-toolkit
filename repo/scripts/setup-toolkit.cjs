#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_REPO_BRANCH = 'main';
const DEFAULT_REPO_REMOTE = 'https://github.com/weijunswj/ai-agent-toolkit';
const SUPPORTED_TARGETS = ['opencode', 'ag2'];
const SETUP_PAUSED_FOR_REPO_AUTO_UPDATE_APPROVAL = 20;

function repoRootFromScript() {
  return path.resolve(__dirname, '..', '..');
}

function quote(value) {
  return JSON.stringify(String(value));
}

function slash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeRemote(value) {
  let remote = String(value || '').trim();
  if (/^git@github\.com:/i.test(remote)) {
    remote = remote.replace(/^git@github\.com:/i, 'https://github.com/');
  }
  remote = remote.replace(/\.git$/i, '');
  remote = remote.replace(/\/+$/g, '');
  return remote.toLowerCase();
}

function parseTargetList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    argv,
    plan: false,
    execute: false,
    json: false,
    repoRoot: repoRootFromScript(),
    repoBranch: DEFAULT_REPO_BRANCH,
    repoRemote: DEFAULT_REPO_REMOTE,
    codexCli: '',
    hub: '',
    writeRepoAutoUpdate: false,
    enableTargets: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--plan') args.plan = true;
    else if (arg === '--execute') args.execute = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--repo-root') args.repoRoot = next();
    else if (arg.startsWith('--repo-root=')) args.repoRoot = arg.slice('--repo-root='.length);
    else if (arg === '--repo-branch') args.repoBranch = next();
    else if (arg.startsWith('--repo-branch=')) args.repoBranch = arg.slice('--repo-branch='.length);
    else if (arg === '--repo-remote') args.repoRemote = next();
    else if (arg.startsWith('--repo-remote=')) args.repoRemote = arg.slice('--repo-remote='.length);
    else if (arg === '--codex-cli') args.codexCli = next();
    else if (arg.startsWith('--codex-cli=')) args.codexCli = arg.slice('--codex-cli='.length);
    else if (arg === '--hub') args.hub = next();
    else if (arg.startsWith('--hub=')) args.hub = arg.slice('--hub='.length);
    else if (arg === '--write-repo-auto-update') args.writeRepoAutoUpdate = true;
    else if (arg === '--enable-target') args.enableTargets.push(...parseTargetList(next()));
    else if (arg.startsWith('--enable-target=')) args.enableTargets.push(...parseTargetList(arg.slice('--enable-target='.length)));
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.plan && args.execute) throw new Error('--plan and --execute cannot be used together');
  if (!args.plan && !args.execute && !args.help) args.plan = true;
  args.repoRoot = path.resolve(args.repoRoot);
  args.repoBranch = args.repoBranch || DEFAULT_REPO_BRANCH;
  args.repoRemote = args.repoRemote || DEFAULT_REPO_REMOTE;
  for (const target of args.enableTargets) {
    if (!SUPPORTED_TARGETS.includes(target)) throw new Error(`Unsupported target: ${target}`);
  }
  args.enableTargets = [...new Set(args.enableTargets)];
  return args;
}

function relNodeCommand(relScript, extraArgs = []) {
  return ['node', slash(relScript), ...extraArgs].join(' ');
}

function setupPlan(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || repoRootFromScript());
  const repoBranch = options.repoBranch || DEFAULT_REPO_BRANCH;
  const bridgeBase = ['repo/scripts/toolkit-local-bridge.cjs'];
  const hubArgs = options.hub ? ['--hub', quote(path.resolve(options.hub))] : [];
  const codexCliArgs = options.codexCli ? ['--codex-cli', quote(options.codexCli)] : [];
  const repoAutoUpdateCommand = relNodeCommand(bridgeBase[0], [
    '--enable-repo-auto-update',
    '--repo-path',
    quote(repoRoot),
    '--repo-branch',
    repoBranch,
    '--enable-auto-sync',
    '--write',
    ...hubArgs
  ]);
  const targetArgs = ['--enable-target', 'opencode', '--enable-target', 'ag2', '--write', ...hubArgs];

  return {
    name: 'setup toolkit',
    default_mode: 'plan-only; use --execute to run local setup commands',
    repo_root: repoRoot,
    repo_branch: repoBranch,
    repo_remote: options.repoRemote || DEFAULT_REPO_REMOTE,
    steps: [
      {
        id: 'trusted_repo_state',
        title: 'Verify trusted repo state on main',
        commands: [
          'git status --short',
          'git switch main',
          'git fetch origin main',
          'git merge --ff-only origin/main'
        ],
        stop_if: 'the worktree is dirty, the origin remote is unexpected, the branch is not main after switch, or the update cannot fast-forward'
      },
      {
        id: 'codex_native_plugin_cache',
        title: 'Verify, write only if needed, then verify the Codex native plugin cache',
        commands: [
          relNodeCommand('repo/scripts/setup-codex-toolkit-plugin.cjs', ['--verify', '--json', ...codexCliArgs]),
          relNodeCommand('repo/scripts/setup-codex-toolkit-plugin.cjs', ['--write', '--json', ...codexCliArgs]),
          relNodeCommand('repo/scripts/setup-codex-toolkit-plugin.cjs', ['--verify', '--json', ...codexCliArgs])
        ],
        conditional_write: 'run --write --json only when --verify reports missing, disabled, stale, wrong-source, or invalid installed cache state'
      },
      {
        id: 'lite_validation',
        title: 'Run routine setup lite validation',
        commands: [
          'node repo/scripts/validate-toolkit.cjs',
          'node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs'
        ],
        stop_if: 'either lite validation command fails'
      },
      {
        id: 'repo_backed_auto_update',
        title: 'Configure repo-backed auto-update from this trusted main checkout',
        approval_required: true,
        write_flag: '--write-repo-auto-update',
        approval_question: `Approve enabling repo-backed auto-update from ${repoRoot} on main with auto-sync enabled, writing only Toolkit bridge hub state and no OpenCode or Antigravity 2 targets?`,
        commands: [repoAutoUpdateCommand]
      },
      {
        id: 'bridge_audit',
        title: 'Audit OpenCode and Antigravity 2 bridge state',
        commands: [relNodeCommand(bridgeBase[0], ['--audit', ...hubArgs])],
        write: false
      },
      {
        id: 'non_native_target_approval',
        title: 'Ask before non-native target writes',
        approval_required: true,
        approval_question: 'Do you want to enable OpenCode and/or Antigravity 2 bridge targets? Enabling them writes only Toolkit-managed user-local bridge output into the app-facing target: OpenCode uses ~/.config/opencode/skills/ai-agent-toolkit, and Antigravity 2 uses ~/.gemini/config/plugins/ai-agent-toolkit with skills/ai-agent-toolkit/SKILL.md inside that plugin root.',
        commands: []
      },
      {
        id: 'approved_target_sync',
        title: 'Enable only approved bridge targets, sync enabled targets, then audit',
        approval_required: true,
        write_flag: '--enable-target <opencode|ag2>',
        commands: [
          relNodeCommand(bridgeBase[0], targetArgs),
          relNodeCommand(bridgeBase[0], ['--sync-enabled', '--write', ...hubArgs]),
          relNodeCommand(bridgeBase[0], ['--audit', ...hubArgs])
        ]
      }
    ]
  };
}

function printHelp() {
  console.log([
    'AI Agent Toolkit setup orchestrator',
    '',
    'Default mode is --plan. Use --execute for the literal setup toolkit journey.',
    '',
    'Common commands:',
    '  node repo/scripts/setup-toolkit.cjs --plan',
    '  node repo/scripts/setup-toolkit.cjs --plan --json',
    '  node repo/scripts/setup-toolkit.cjs --execute',
    '  node repo/scripts/setup-toolkit.cjs --execute --write-repo-auto-update',
    '  node repo/scripts/setup-toolkit.cjs --execute --write-repo-auto-update --enable-target opencode',
    '  node repo/scripts/setup-toolkit.cjs --execute --write-repo-auto-update --enable-target opencode --enable-target ag2',
    '',
    'Options:',
    '  --repo-root <path>           trusted local ai-agent-toolkit checkout',
    '  --repo-branch <branch>       default: main',
    '  --repo-remote <url>          default: https://github.com/weijunswj/ai-agent-toolkit',
    '  --codex-cli <path>           explicit Codex CLI for native plugin setup',
    '  --hub <path>                 test override for Toolkit bridge hub',
    '  --write-repo-auto-update    enable repo-backed auto-update and auto-sync in bridge hub state',
    '  --enable-target opencode|ag2 enable approved non-native bridge target after audit'
  ].join('\n'));
}

function assertRepoRoot(repoRoot) {
  const required = [
    path.join(repoRoot, 'AGENTS.md'),
    path.join(repoRoot, 'repo', 'scripts', 'setup-codex-toolkit-plugin.cjs'),
    path.join(repoRoot, 'repo', 'scripts', 'toolkit-local-bridge.cjs'),
    path.join(repoRoot, 'repo', 'scripts', 'validate-toolkit.cjs'),
    path.join(repoRoot, 'repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs')
  ];
  for (const filePath of required) {
    if (!fs.existsSync(filePath)) throw new Error(`Missing setup prerequisite under repo root: ${filePath}`);
  }
}

function runCommand(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  console.log([command, ...args].join(' '));
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
    timeout: options.timeout || 120000,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = options.capture ? result.stderr || '' : '';
    throw new Error(`${label} failed with exit code ${result.status}${stderr ? `: ${stderr.trim()}` : ''}`);
  }
  return result;
}

function runGitCapture(repoRoot, args, label) {
  const result = runCommand(label, 'git', args, { cwd: repoRoot, capture: true, timeout: 60000, allowFailure: true });
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}: ${(result.stderr || '').trim()}`);
  return (result.stdout || '').trim();
}

function verifyAndUpdateTrustedRepo(args) {
  assertRepoRoot(args.repoRoot);
  const status = runGitCapture(args.repoRoot, ['status', '--short'], 'git status --short');
  if (status) throw new Error(`setup toolkit requires a clean worktree before updating main:\n${status}`);

  const remote = runGitCapture(args.repoRoot, ['remote', 'get-url', 'origin'], 'git remote get-url origin');
  if (normalizeRemote(remote) !== normalizeRemote(args.repoRemote)) {
    throw new Error(`Unexpected origin remote for setup toolkit: ${remote}`);
  }

  runCommand('git switch main', 'git', ['switch', args.repoBranch], { cwd: args.repoRoot, timeout: 60000 });
  const branch = runGitCapture(args.repoRoot, ['branch', '--show-current'], 'git branch --show-current');
  if (branch !== args.repoBranch) throw new Error(`Expected branch ${args.repoBranch}, found ${branch || '<detached>'}`);

  runCommand('git fetch origin main', 'git', ['fetch', 'origin', args.repoBranch], { cwd: args.repoRoot, timeout: 120000 });
  runCommand('git merge --ff-only origin/main', 'git', ['merge', '--ff-only', `origin/${args.repoBranch}`], { cwd: args.repoRoot, timeout: 120000 });
}

function nodeScriptArgs(relScript, extraArgs = []) {
  return [path.join(...relScript.split('/')), ...extraArgs];
}

function setupCodexArgs(args, mode) {
  const extra = [mode, '--json'];
  if (args.codexCli) extra.push('--codex-cli', args.codexCli);
  return nodeScriptArgs('repo/scripts/setup-codex-toolkit-plugin.cjs', extra);
}

function runCodexNativePluginSetup(args) {
  const verify = runCommand(
    'node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json',
    process.execPath,
    setupCodexArgs(args, '--verify'),
    { cwd: args.repoRoot, capture: true, timeout: 120000, allowFailure: true }
  );
  if (verify.status === 0) {
    process.stdout.write(verify.stdout || '');
    return;
  }
  process.stderr.write(verify.stderr || '');

  runCommand(
    'node repo/scripts/setup-codex-toolkit-plugin.cjs --write --json',
    process.execPath,
    setupCodexArgs(args, '--write'),
    { cwd: args.repoRoot, timeout: 180000 }
  );
  runCommand(
    'node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json',
    process.execPath,
    setupCodexArgs(args, '--verify'),
    { cwd: args.repoRoot, timeout: 120000 }
  );
}

function bridgeArgs(args, extraArgs = []) {
  const result = nodeScriptArgs('repo/scripts/toolkit-local-bridge.cjs', extraArgs);
  if (args.hub) result.push('--hub', args.hub);
  return result;
}

function runLiteValidation(args) {
  runCommand('node repo/scripts/validate-toolkit.cjs', process.execPath, nodeScriptArgs('repo/scripts/validate-toolkit.cjs'), {
    cwd: args.repoRoot,
    timeout: 120000
  });
  runCommand(
    'node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs',
    process.execPath,
    ['--test', path.join('repo', 'tests', 'toolkit-local-bridge-hook-light.test.cjs')],
    { cwd: args.repoRoot, timeout: 60000 }
  );
}

function runRepoAutoUpdateWrite(args) {
  runCommand(
    'node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path "<repo>" --repo-branch main --enable-auto-sync --write',
    process.execPath,
    bridgeArgs(args, [
      '--enable-repo-auto-update',
      '--repo-path',
      args.repoRoot,
      '--repo-branch',
      args.repoBranch,
      '--enable-auto-sync',
      '--write'
    ]),
    { cwd: args.repoRoot, timeout: 120000 }
  );
}

function runBridgeAudit(args) {
  runCommand('node repo/scripts/toolkit-local-bridge.cjs --audit', process.execPath, bridgeArgs(args, ['--audit']), {
    cwd: args.repoRoot,
    timeout: 120000
  });
}

function runApprovedTargetSync(args) {
  if (!args.enableTargets.length) return;
  const enableArgs = [];
  for (const target of args.enableTargets) enableArgs.push('--enable-target', target);
  enableArgs.push('--write');
  runCommand(
    `node repo/scripts/toolkit-local-bridge.cjs ${enableArgs.join(' ')}`,
    process.execPath,
    bridgeArgs(args, enableArgs),
    { cwd: args.repoRoot, timeout: 120000 }
  );
  runCommand(
    'node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write',
    process.execPath,
    bridgeArgs(args, ['--sync-enabled', '--write']),
    { cwd: args.repoRoot, timeout: 120000 }
  );
  runBridgeAudit(args);
}

function printApprovalPause(plan) {
  const repoStep = plan.steps.find((step) => step.id === 'repo_backed_auto_update');
  console.log('');
  console.log('SETUP PAUSED: repo-backed auto-update is approval-gated.');
  console.log(repoStep.approval_question);
  console.log(`After approval, rerun: node repo/scripts/setup-toolkit.cjs --execute --write-repo-auto-update`);
  console.log('Do not report setup toolkit complete until this gate is resolved or the user declines it.');
}

function printTargetApproval(plan) {
  const targetStep = plan.steps.find((step) => step.id === 'non_native_target_approval');
  console.log('');
  console.log(targetStep.approval_question);
  console.log('If approved, rerun with one or both explicit target flags, for example:');
  console.log('node repo/scripts/setup-toolkit.cjs --execute --write-repo-auto-update --enable-target opencode --enable-target ag2');
}

function printPlan(plan, asJson) {
  if (asJson) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log('# setup toolkit plan');
  for (const step of plan.steps) {
    console.log('');
    console.log(`${step.id}: ${step.title}`);
    if (step.approval_required) console.log(`approval required: ${step.approval_question || step.write_flag}`);
    for (const command of step.commands || []) console.log(`  ${command}`);
  }
}

function execute(args) {
  const plan = setupPlan(args);
  verifyAndUpdateTrustedRepo(args);
  runCodexNativePluginSetup(args);
  runLiteValidation(args);

  if (!args.writeRepoAutoUpdate) {
    runBridgeAudit(args);
    printApprovalPause(plan);
    return SETUP_PAUSED_FOR_REPO_AUTO_UPDATE_APPROVAL;
  }

  runRepoAutoUpdateWrite(args);
  runBridgeAudit(args);
  runApprovedTargetSync(args);
  if (!args.enableTargets.length) printTargetApproval(plan);
  console.log('');
  console.log('setup toolkit journey completed through repo-backed auto-update and bridge audit.');
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const plan = setupPlan(args);
  if (args.plan) {
    printPlan(plan, args.json);
    return 0;
  }
  return execute(args);
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_REPO_BRANCH,
  DEFAULT_REPO_REMOTE,
  SETUP_PAUSED_FOR_REPO_AUTO_UPDATE_APPROVAL,
  parseArgs,
  setupPlan,
  normalizeRemote,
  main
};
