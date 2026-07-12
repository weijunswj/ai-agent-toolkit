#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const readline = require('node:readline/promises');

const core = require('./setup-toolkit-core.cjs');
const delegation = require('./codex-delegation-config.cjs');

function delegationChoiceFromArgv(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--codex-delegation-control') return String(argv[index + 1] || '').trim().toLowerCase();
    if (arg.startsWith('--codex-delegation-control=')) return arg.slice('--codex-delegation-control='.length).trim().toLowerCase();
  }
  return '';
}

function withoutDelegationChoice(argv) {
  const next = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--codex-delegation-control') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--codex-delegation-control=')) continue;
    next.push(arg);
  }
  return next;
}

function validateDelegationChoice(choice) {
  if (!['keep', 'limit', 'skip'].includes(choice)) {
    throw new Error('Codex delegation control must be one of: keep, limit, skip');
  }
  return choice;
}

function selectedBeforeDelegation(parsed) {
  const choices = parsed.setupChoices || {};
  return [
    choices.managedCheckout,
    choices.repoAutoUpdate,
    choices.updateReports,
    choices.updateReportOpen,
    choices.updateReportRetention,
    choices.codexPluginAutoRefresh,
  ];
}

function takeDelegationAnswerFromInput(parsed, input) {
  const lines = String(input || '').split(/\r?\n/);
  const position = selectedBeforeDelegation(parsed).filter((value) => !value).length;
  if (position >= lines.length) throw new Error('Setup question bank requires an answer for Codex delegation control');
  const raw = String(lines.splice(position, 1)[0] || '').trim().toLowerCase();
  return { choice: validateDelegationChoice(raw || 'keep'), remainingInput: lines.join('\n') };
}

async function promptDelegationChoice(current) {
  console.log('# Codex delegation control approval');
  console.log('');
  console.log(`- config path: ${current.config_path}`);
  console.log(`- current: ${current.status}; ${current.detail}`);
  console.log('- recommended: keep');
  console.log('- empty input: keep (native Codex and Codex Security UAT is still pending)');
  console.log('- choices: keep / limit / skip');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Codex delegation control choice [keep/limit/skip], Enter=keep: ')).trim().toLowerCase();
    return validateDelegationChoice(answer || 'keep');
  } finally {
    rl.close();
  }
}

function transformedCoreArgv(argv) {
  return [...withoutDelegationChoice(argv), '--codex-delegation-control', 'keep'];
}

function secureSetupPlan(options = {}) {
  const plan = core.setupPlan(options);
  if (plan.host !== 'codex') return plan;
  const selected = options.setupChoices?.codexDelegationControl || 'keep';
  if (plan.preferences) plan.preferences.delegation_control = selected;
  const upfront = (plan.steps || []).find((step) => step.id === 'upfront_setup_checklist');
  if (upfront?.preferences) upfront.preferences.delegation_control = selected;
  const delegationStep = (plan.steps || []).find((step) => step.id === 'host_delegation_control');
  if (delegationStep) {
    delegationStep.title = selected === 'limit'
      ? 'Apply the explicitly approved one-direct-specialist Codex limits after all other setup work succeeds'
      : 'Keep Codex delegation configuration unchanged pending native UAT';
    delegationStep.recommendation = 'keep';
    delegationStep.write_requires = 'explicit interactive limit or --codex-delegation-control limit';
    delegationStep.native_uat = 'Codex native host and Codex Security ordinary/deep compatibility remain pending';
  }
  return plan;
}

function filterCoreOutput(choice, current, invoke) {
  const originalLog = console.log;
  let suppressDelegationSummary = false;
  let delegationQuestion = false;
  console.log = (...args) => {
    let line = args.length ? String(args[0]) : '';
    if (line === '## Delegation control') {
      suppressDelegationSummary = true;
      return;
    }
    if (suppressDelegationSummary) {
      if (line === '## Codex native plugin') {
        suppressDelegationSummary = false;
        originalLog(...args);
      }
      return;
    }
    if (line === 'Codex delegation control:') delegationQuestion = true;
    if (delegationQuestion) {
      if (line.startsWith('- current:')) line = `- current: ${current.status}; ${current.detail}`;
      else if (line.startsWith('- recommended:')) line = '- recommended: keep';
      else if (line.startsWith('- empty input:')) line = '- empty input: keep (recommended; native UAT pending)';
      else if (line.startsWith('- selected:')) line = `- selected: ${choice}`;
      if (line === '') delegationQuestion = false;
      args[0] = line;
    }
    originalLog(...args);
  };
  return Promise.resolve()
    .then(invoke)
    .finally(() => { console.log = originalLog; });
}

function printVerifiedDelegationSummary(result) {
  console.log('');
  console.log('## Delegation control (TOML-verified)');
  console.log(`Delegation enforcement status: ${result.status}`);
  console.log(`Delegation config path: ${result.config_path || delegation.codexConfigPath()}`);
  console.log(`Direct specialist limit: ${result.status === 'configured' ? delegation.CODEX_AGENT_MAX_THREADS : 'not enforced'}`);
  console.log(`Subagent depth limit: ${result.status === 'configured' ? delegation.CODEX_AGENT_MAX_DEPTH : 'not enforced'}`);
  console.log(`Delegation config changed this run: ${result.changed === true ? 'yes' : 'no'}`);
  console.log(`Delegation TOML parser: ${result.parser || 'not required'}`);
  console.log('Delegation native UAT: pending for Codex native host behavior and Codex Security ordinary/deep workflows');
  console.log('Delegation intent: preserve one general direct-specialist slot by documented thread semantics; official specialist compatibility is not yet claimed');
  console.log(`Delegation detail: ${result.detail || 'none'}`);
  if (result.backup_metadata_path) console.log(`Delegation backup metadata: ${result.backup_metadata_path}`);
  if (result.restore_command) console.log(`Delegation exact restore command: ${result.restore_command}`);
}

function printDelegationPreview(preview) {
  console.log('');
  console.log('# Codex delegation config preview');
  console.log(`Codex config path: ${preview.config_path}`);
  console.log('Proposed Toolkit-managed TOML block:');
  console.log('```toml');
  console.log(preview.proposed_block);
  console.log('```');
  console.log(`Proposed edit: ${preview.proposed_action}`);
}

function secureApplyHostDelegationControl(args, current, options = {}) {
  if (args.host !== 'codex') {
    return {
      status: 'unsupported',
      detail: 'Host-level delegation enforcement is unsupported; portable single-agent policy still applies.',
      client_scope: 'not applicable',
      changed: false,
    };
  }
  const choice = args.setupChoices?.codexDelegationControl || 'keep';
  const configPath = current?.delegation?.config_path || delegation.codexConfigPath();
  if (choice === 'limit') {
    const preview = delegation.previewCodexDelegation(configPath);
    if (preview.status === 'preview' && options.printPreview !== false) printDelegationPreview(preview);
    return delegation.delegationResultForChoice(choice, configPath, options);
  }
  return delegation.delegationResultForChoice(choice, configPath, options);
}

async function main(argv = process.argv.slice(2)) {
  const restoreIndex = argv.indexOf(delegation.RESTORE_FLAG);
  const restoreInline = argv.find((arg) => arg.startsWith(`${delegation.RESTORE_FLAG}=`));
  if (restoreIndex >= 0 || restoreInline) {
    const metadataPath = restoreInline
      ? restoreInline.slice(`${delegation.RESTORE_FLAG}=`.length)
      : String(argv[restoreIndex + 1] || '');
    if (!metadataPath) throw new Error(`${delegation.RESTORE_FLAG} requires a backup metadata path`);
    const restored = delegation.restoreCodexDelegationBackup(metadataPath);
    console.log(JSON.stringify(restored, null, 2));
    return 0;
  }

  const parsed = core.parseArgs(argv);
  if (parsed.plan && parsed.json) {
    console.log(JSON.stringify(secureSetupPlan(parsed), null, 2));
    return 0;
  }
  if (parsed.help) {
    const code = await core.main(argv);
    console.log('');
    console.log('Codex delegation control remains explicit opt-in pending native UAT.');
    console.log('The recommendation, empty input, and --yes-recommended all keep CODEX_HOME/config.toml unchanged.');
    console.log('Only explicit --codex-delegation-control limit may preview, back up, validate, and write max_threads = 1 / max_depth = 1.');
    console.log('Codex Security ordinary/deep compatibility remains unverified pending native UAT.');
    return code;
  }
  if (parsed.host !== 'codex' || !parsed.execute) return core.main(argv);

  const current = delegation.inspectCodexDelegationConfig();
  let choice = delegationChoiceFromArgv(argv);
  let patchedInput = null;
  let restoreReadFile = null;

  if (choice) {
    choice = validateDelegationChoice(choice);
  } else if (parsed.yesRecommended) {
    choice = 'keep';
  } else if (process.stdin.isTTY) {
    choice = await promptDelegationChoice(current);
  } else {
    const input = fs.readFileSync(0, 'utf8');
    const extracted = takeDelegationAnswerFromInput(parsed, input);
    choice = extracted.choice;
    patchedInput = extracted.remainingInput;
  }

  if (patchedInput !== null) {
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = function patchedReadFileSync(target, ...rest) {
      if (target === 0) return patchedInput;
      return originalReadFileSync.call(fs, target, ...rest);
    };
    restoreReadFile = () => { fs.readFileSync = originalReadFileSync; };
  }

  let code;
  try {
    code = await filterCoreOutput(choice, current, () => core.main(transformedCoreArgv(argv)));
  } finally {
    if (restoreReadFile) restoreReadFile();
  }
  if (code !== 0) return code;

  let result;
  if (choice === 'limit') {
    const preview = delegation.previewCodexDelegation(current.config_path);
    if (preview.status === 'preview') printDelegationPreview(preview);
    result = delegation.delegationResultForChoice('limit', current.config_path);
  } else {
    result = delegation.delegationResultForChoice(choice, current.config_path);
  }
  printVerifiedDelegationSummary(result);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      if (/Setup question bank requires|must be one of|requires a path answer/.test(error.message)) {
        process.exitCode = core.SETUP_PAUSED_FOR_QUESTION_BANK;
        console.error(`SETUP PAUSED: ${error.message}`);
        console.error('Question bank pause is intentional. Ask the user for the missing setup answers; do not rerun with --yes-recommended unless the user explicitly requested recommended defaults.');
      } else {
        process.exitCode = 1;
        console.error(`FAIL: ${error.message}`);
      }
    });
}

module.exports = {
  ...core,
  ...delegation,
  applyHostDelegationControl: secureApplyHostDelegationControl,
  setupPlan: secureSetupPlan,
  main,
  delegationChoiceFromArgv,
  takeDelegationAnswerFromInput,
};
