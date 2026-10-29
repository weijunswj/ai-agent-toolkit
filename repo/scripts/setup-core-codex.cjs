'use strict';

// Codex lane of setup: helper capacity proposal and apply, the native plugin setup run and the
// Codex global rules step.
// setup-toolkit-core.cjs composes it and passes in the core helpers it uses, so this file
// never requires the core back.

const path = require('node:path');
const readline = require('node:readline/promises');
const delegation = require('./codex-delegation-config.cjs');
const { describeResult: describeGlobalRules } = require('./toolkit-global-rules.cjs');
const { CodexToolkitInstall, describeHookStates } = require('./toolkit-codex-install-state.cjs');

// The helper answers that change config.toml, so setup checks the runtime with Codex first.
const HELPER_CHANGES = Object.freeze(['one-helper', 'root-only', 'custom', 'migrate', 'remove']);

function defineCodexSetup({ RUNTIMES, defaultCodexPluginCachePath, expectedToolkitVersion, nodeScriptArgs, printDelegationPreview, printDelegationRemovalPreview, runNativePluginJsonPhase, setupGlobalRules }) {
  function selectedHelperCount(args, current) {
    const choice = args.setupChoices.codexHelperCapacity;
    if (choice === 'one-helper') return 1;
    if (choice === 'root-only') return 0;
    if (choice === 'custom') return args.codexHelperCount;
    if (choice === 'migrate') return current.delegation.helper_count;
    return null;
  }

  function needsPipedCodexProposalApproval(args, current) {
    if (args.host !== 'codex' || args.approveCodexConfigProposal) return false;
    const choice = args.setupChoices.codexHelperCapacity;
    if (!['one-helper', 'root-only', 'custom', 'migrate', 'remove'].includes(choice)) return false;
    const helperCount = selectedHelperCount(args, current);
    if (choice === 'custom' && !Number.isSafeInteger(helperCount)) return false;
    // Before the answers the runtime may be read from the file only; when it is unknown, either
    // form needing a confirmation means the piped answer may hold one.
    const runtimes = current.runtime.runtime === RUNTIMES.UNKNOWN && current.runtime.from_config ? [RUNTIMES.V1, RUNTIMES.V2] : [current.runtime.runtime];
    return runtimes.some((runtime) => {
      const previewOptions = { runtime, setupScriptPath: path.resolve(__dirname, 'setup-toolkit.cjs') };
      let preview;
      try {
        preview = choice === 'remove'
          ? delegation.previewCodexDelegationRemoval(current.delegation.config_path || delegation.codexConfigPath(), previewOptions)
          : delegation.previewCodexDelegation(current.delegation.config_path || delegation.codexConfigPath(), {
              ...previewOptions,
              helperCount,
              allowUserOwnedReplacement: true,
            });
      } catch { return false; }
      return preview.selected_outcome_matches !== true
        && ['preview', 'removal-preview'].includes(preview.status)
        && preview.requires_user_confirmation === true;
    });
  }

  async function confirmSelectedDelegationProposal(args, current, questionBank) {
    const assertQuestionBankConsumed = () => {
      if (questionBank.remaining_input.length) throw new Error('Setup question bank received unexpected extra non-empty input.');
    };
    if (args.host !== 'codex') {
      assertQuestionBankConsumed();
      return null;
    }
    const choice = args.setupChoices.codexHelperCapacity;
    if (!['one-helper', 'root-only', 'custom', 'migrate', 'remove'].includes(choice)) {
      assertQuestionBankConsumed();
      return null;
    }
    if (current.delegation.status === 'migration-required' && choice !== 'migrate') {
      throw new Error('Selected helper setting remains unapplied. The exact old Toolkit helper block can only change through the explicit `migrate` choice; choose `migrate` or `keep`.');
    }
    if (choice === 'migrate' && (current.runtime.runtime !== RUNTIMES.V2 || current.delegation.status !== 'migration-required')) {
      throw new Error('Selected helper setting remains unapplied. No exact old Toolkit helper block is available to migrate; choose an ordinary helper setting or `keep`.');
    }
    const helperCount = selectedHelperCount(args, current);
    const previewOptions = {
      runtime: current.runtime.runtime,
      setupScriptPath: path.resolve(__dirname, 'setup-toolkit.cjs'),
    };
    const preview = choice === 'remove'
      ? delegation.previewCodexDelegationRemoval(current.delegation.config_path || delegation.codexConfigPath(), previewOptions)
      : delegation.previewCodexDelegation(current.delegation.config_path || delegation.codexConfigPath(), {
          ...previewOptions,
          helperCount,
          allowUserOwnedReplacement: true,
        });
    if (preview.selected_outcome_matches === true) {
      assertQuestionBankConsumed();
      args.codexDelegationPreview = preview;
      return preview;
    }
    if (!['preview', 'removal-preview'].includes(preview.status)) {
      throw new Error(`Selected helper setting remains unapplied. Required action: resolve the reported Codex configuration or runtime detection problem, then rerun setup. ${preview.detail || preview.status}`);
    }
    preview.before_semantics = current.delegation.detail;
    if (choice === 'remove') printDelegationRemovalPreview(preview);
    else printDelegationPreview(preview);
    if (preview.requires_user_confirmation && !args.approveCodexConfigProposal) {
      let answer = '';
      if (questionBank.remaining_input.length) answer = String(questionBank.remaining_input.shift()).trim().toLowerCase();
      else if (process.stdin.isTTY) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try { answer = (await rl.question('Type apply to approve this exact Codex configuration proposal: ')).trim().toLowerCase(); }
        finally { rl.close(); }
      }
      if (answer !== 'apply') {
        throw new Error('Selected helper setting remains unapplied. Required action: review the exact technical proposal and answer `apply`, or pass --approve-codex-config-proposal.');
      }
      args.approveCodexConfigProposal = true;
    }
    assertQuestionBankConsumed();
    args.codexDelegationPreview = preview;
    return preview;
  }

  // The Codex half of applyHostDelegationControl: the approved helper-capacity proposal.
  async function applyCodexDelegationControl(args, current) {
    const choice = args.setupChoices.codexHelperCapacity;
    const configPath = current.delegation.config_path || delegation.codexConfigPath();
    const options = {
      runtime: current.runtime.runtime,
      helperCount: selectedHelperCount(args, current),
      codexCommand: args.codexCli,
      codexHome: delegation.defaultCodexHome(),
      setupScriptPath: path.resolve(__dirname, 'setup-toolkit.cjs'),
      allowUserOwnedReplacement: args.approveCodexConfigProposal,
    };
    if (!['migrate', 'one-helper', 'root-only', 'custom', 'remove'].includes(choice)) return delegation.delegationResultForChoice(choice, configPath, options);
    if (choice === 'migrate') options.helperCount = current.delegation.helper_count;
    const preview = args.codexDelegationPreview;
    if (preview?.selected_outcome_matches === true) {
      const verifiedNoop = delegation.previewCodexDelegation(configPath, {
        runtime: current.runtime.runtime,
        helperCount: options.helperCount,
        setupScriptPath: path.resolve(__dirname, 'setup-toolkit.cjs'),
        allowUserOwnedReplacement: true,
      });
      if (verifiedNoop.selected_outcome_matches !== true) {
        throw new Error('Selected helper setting remains unapplied. The previously matching user-owned Codex configuration changed before final verification; rerun setup.');
      }
      return verifiedNoop;
    }
    if (!preview || !['preview', 'removal-preview'].includes(preview.status) || !preview.approval_binding) {
      throw new Error('Selected helper setting remains unapplied. Toolkit could not verify the approved Codex proposal. Rerun setup to receive a fresh proposal.');
    }
    options.backupGenerationId = preview.backup_generation_id;
    options.approvedProposal = preview.approval_binding;
    const effectiveChoice = ['one-helper', 'root-only', 'custom'].includes(choice) ? 'custom' : choice;
    const result = await delegation.delegationResultForChoice(effectiveChoice, configPath, options);
    if (result.status === 'approval-stale' || result.status === 'approval-invalid') throw new Error(result.detail);
    if (choice === 'remove') {
      if (result.status !== 'removed' || result.changed !== true) {
        throw new Error(`Selected helper setting remains unapplied. Required action: resolve the reported Codex configuration problem and rerun setup. ${result.detail || result.status}`);
      }
      return result;
    }
    if (result.status !== 'configured' || result.helper_count !== options.helperCount) {
      throw new Error(`Selected helper setting remains unapplied. Required action: resolve the reported Codex configuration problem and rerun setup. ${result.detail || result.status}`);
    }
    return result;
  }

  // The effective Codex runtime, checked with Codex itself only after the owner answered and only
  // when the helper answer changes config.toml. The question bank used the form of Toolkit's own
  // block instead, so the plan never starts Codex.
  async function detectCodexRuntimeAfterApproval(args, current) {
    if (!HELPER_CHANGES.includes(args.setupChoices.codexHelperCapacity)) return current;
    const runtime = await delegation.inspectCodexMultiAgentRuntime({
      codexCommand: args.codexCli,
      codexHome: delegation.defaultCodexHome(),
      cwd: path.resolve(__dirname, '..', '..'),
    });
    const configPath = current.delegation.config_path || delegation.codexConfigPath();
    const state = delegation.inspectCodexDelegationConfig(configPath, runtime.runtime);
    if (runtime.runtime === RUNTIMES.V1 && (args.setupChoices.codexHelperCapacity === 'root-only'
        || (args.setupChoices.codexHelperCapacity === 'custom' && args.codexHelperCount !== null && args.codexHelperCount < 1))) {
      throw new Error('Codex cannot limit helpers to zero; choose one helper or a custom number of at least 1. Setup wrote nothing.');
    }
    args.codexRuntime = runtime.runtime;
    return { ...current, runtime, delegation: state };
  }

  // Keep current and Show instructions only make no plugin change and start no Codex command: they
  // report what the Codex files say. Install or refresh runs the verify, write, verify sequence.
  function codexPluginFromFiles(args, status) {
    const install = new CodexToolkitInstall({ managedRoot: args.repoRoot }).read();
    const hooks = describeHookStates(install.hooks || { status: 'unreadable', entries: [] });
    return {
      status,
      installed: (install.versions || []).length > 0,
      enabled: install.plugin === 'on',
      current: (install.versions || []).length === 1 && Boolean(install.version) && install.version === install.sourceVersion,
      cache_path: defaultCodexPluginCachePath(install.version || expectedToolkitVersion(args.repoRoot, 'codex')),
      expected_version: expectedToolkitVersion(args.repoRoot, 'codex'),
      installed_version: install.version || 'none',
      updated_this_run: false,
      restart_required: false,
      hook_trust_status: hooks.status,
      hook_execution_status: hooks.execution,
      hook_trust_action: hooks.message,
    };
  }

  function setupCodexArgs(args, mode) {
    const extra = [mode, '--json', '--repo-root', args.repoRoot];
    if (args.codexCli) extra.push('--codex-cli', args.codexCli);
    return nodeScriptArgs('repo/scripts/setup-codex-toolkit-plugin.cjs', extra);
  }

  function runCodexNativePluginSetup(args) {
    const verifySummary = runNativePluginJsonPhase({
      platform: 'Codex',
      phase: 'verification',
      label: 'node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json',
      args: setupCodexArgs(args, '--verify'),
      cwd: args.repoRoot,
      timeout: 120000,
      allowRefreshRequired: true
    });
    const expectedVersion = expectedToolkitVersion(args.repoRoot, 'codex');
    if (verifySummary) {
      const summary = verifySummary;
      return {
        status: 'already fresh',
        installed: summary.installed === true,
        enabled: summary.enabled === true,
        current: summary.current === true,
        cache_path: summary.cache_root || defaultCodexPluginCachePath(summary.version || expectedVersion),
        expected_version: expectedVersion,
        installed_version: summary.version || expectedVersion,
        updated_this_run: false,
        restart_required: false,
        hook_trust_status: summary.hook_trust_status || 'unknown',
        hook_execution_status: summary.hook_execution_status || 'unknown',
        hook_trust_action: summary.hook_trust_message || 'Open `/hooks` in Codex and check that the Toolkit hooks are on'
      };
    }
    runNativePluginJsonPhase({
      platform: 'Codex',
      phase: 'mutation',
      label: 'node repo/scripts/setup-codex-toolkit-plugin.cjs --write --json',
      args: setupCodexArgs(args, '--write'),
      cwd: args.repoRoot,
      timeout: 180000
    });
    const summary = runNativePluginJsonPhase({
      platform: 'Codex post-mutation',
      phase: 'verification',
      label: 'node repo/scripts/setup-codex-toolkit-plugin.cjs --verify --json',
      args: setupCodexArgs(args, '--verify'),
      cwd: args.repoRoot,
      timeout: 120000
    });
    return {
      status: 'refreshed',
      installed: summary.installed === true,
      enabled: summary.enabled === true,
      current: summary.current === true,
      cache_path: summary.cache_root || defaultCodexPluginCachePath(summary.version || expectedVersion),
      expected_version: expectedVersion,
      installed_version: summary.version || expectedVersion,
      updated_this_run: true,
      restart_required: true,
      hook_trust_status: 'pending-review',
      hook_execution_status: 'skipped until the current hook is reviewed and trusted',
      hook_trust_action: 'Codex may ask you to review the Toolkit hooks again after the refresh: open `/hooks` in Codex and turn them on'
    };
  }

  // Codex setup has no install check, so it installs and reports the global rules directly.
  function runCodexGlobalRules(args) {
    let result;
    try { result = setupGlobalRules(args).refresh(); }
    catch (error) { result = { status: 'held', files: [], covered: [], backup_dir: null, detail: error.message }; }
    console.log('');
    console.log('## Global rules');
    const lines = describeGlobalRules(result);
    for (const line of lines.length ? lines : [`held: ${result.detail}`]) console.log(line);
    return result;
  }
  return { selectedHelperCount, needsPipedCodexProposalApproval, confirmSelectedDelegationProposal, applyCodexDelegationControl, detectCodexRuntimeAfterApproval, codexPluginFromFiles, runCodexNativePluginSetup, runCodexGlobalRules };
}

module.exports = { defineCodexSetup };
