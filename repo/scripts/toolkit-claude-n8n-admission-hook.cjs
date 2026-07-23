#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadRouter() {
  const candidates = [
    path.join(__dirname, '..', '..', 'skills', 'external-system-router', 'scripts', 'n8n-domain-router.cjs'),
    path.join(__dirname, '..', '..', '_projects', 'development', 'external-system-router', 'curated_output_for_ai', 'skills', 'external-system-router', 'scripts', 'n8n-domain-router.cjs')
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return require(candidate);
  throw new Error('Toolkit n8n domain router is missing.');
}

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch { return {}; }
}

function preToolDeny(audit) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `${audit.stableCode}: ${audit.missingCapability}. ${audit.supportedNextAction}`
    }
  };
}

function context(eventName, message) {
  return { hookSpecificOutput: { hookEventName: eventName, additionalContext: message } };
}

function commandFailure(reason) {
  return { toolkitCommandFailure: true, exitCode: 2, stderr: reason };
}

function emitHookResult(result) {
  if (result?.toolkitCommandFailure === true) {
    process.stderr.write(`${result.stderr}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(result || {})}\n`);
}

function exactOfficialInvocation(router, input, skillName, options = {}) {
  const sourceAttestation = router.attestClaudeOfficialSkillInvocation({ skillName }, options.skillSourceOptions || options);
  return {
    invocationId: String(input.tool_use_id || input.toolUseId || `event-${Date.now()}`),
    skillName,
    result: 'success',
    sourceAttestation,
    host: 'claude-toolkit-direct',
    event: 'PostToolUse:Skill',
    invokedAt: input.timestamp || new Date().toISOString()
  };
}

function skillNameFromInput(input) {
  const toolInput = input && typeof input.tool_input === 'object' ? input.tool_input : {};
  return toolInput.skill || toolInput.skill_name || toolInput.name || toolInput.command_name || '';
}

function inferredMutationOperation(input, router) {
  const serialized = JSON.stringify(input.tool_input || {}).toLowerCase();
  const exact = router?.inferN8nOperation?.(serialized);
  if (exact && (router.HELPER_OPERATIONS.has(exact) || router.LIVE_OPERATIONS.has(exact) || exact === 'credential-or-oauth-setup')) return exact;
  if (/expression|\{\{/.test(serialized)) return 'expression-authoring';
  if (/node/.test(serialized) && /parameter|configuration|resource|operation/.test(serialized)) return 'node-configuration';
  if (/sdk/.test(serialized)) return 'workflow-sdk-structure';
  return 'workflow-material-edit';
}

function isContinuationPrompt(prompt) {
  return /^\s*(?:continue|resume|keep|also|then|next)\b/i.test(prompt);
}

function startsNewObjective(router, ledger, prompt, classification) {
  if (ledger.objectiveDigest === router.sha256(prompt)) return false;
  if (isContinuationPrompt(prompt)) {
    const target = router.objectiveTargetBinding(prompt);
    return target.specific && target.digest !== ledger.objectiveTargetDigest;
  }
  if (classification.operation && classification.operation !== ledger.operation) return true;
  if (ledger.status === 'complete') return true;
  return true;
}

function startLedger(router, input, seed, options) {
  const ledger = router.createN8nCapabilityLedger({
    sessionId: input.session_id || input.sessionId,
    repositoryIdentity: input.cwd || 'unbound-workspace',
    objective: seed.objective,
    prompt: seed.objective,
    operation: seed.operation,
    facets: seed.facets || [],
    evidenceText: seed.evidenceText || '',
    paths: seed.paths || [],
    ownsWorkflowJson: seed.ownsWorkflowJson === true,
    n8nWorkflowStructure: seed.n8nWorkflowStructure === true,
    createdAt: input.timestamp || new Date().toISOString()
  });
  router.writeTaskLedger(input, ledger, options);
  return ledger;
}

function handle(input, options = {}) {
  const router = options.router || loadRouter();
  const eventName = String(input.hook_event_name || input.hookEventName || '');
  if (eventName === 'UserPromptSubmit') {
    const prompt = String(input.prompt || '');
    const classification = router.classifyN8nOperation({ prompt, objective: prompt });
    if (!classification.detected) {
      const ledger = router.readTaskLedger(input, options);
      if (ledger && !isContinuationPrompt(prompt)) router.retireTaskLedger(input, options);
      return {};
    }
    let ledger = router.readTaskLedger(input, options);
    if (ledger) {
      if (startsNewObjective(router, ledger, prompt, classification)) {
        ledger = startLedger(router, input, { objective: prompt, operation: classification.operation }, options);
      } else {
      const reconciliation = router.updateTaskLedger(input, (current) => router.reconcileN8nCapabilityLedger(current, {
        operation: isContinuationPrompt(prompt) ? current.operation : classification.operation || current.operation,
        evidenceText: prompt,
        recordedAt: input.timestamp || new Date().toISOString()
      }), options);
      ledger = reconciliation.mismatch
        ? startLedger(router, input, { objective: prompt, operation: classification.operation }, options)
        : reconciliation.ledger;
      }
    } else {
      ledger = startLedger(router, input, { objective: prompt, operation: classification.operation }, options);
    }
    const audit = router.auditN8nCompletion(ledger);
    return context('UserPromptSubmit', `Toolkit n8n admission ${ledger.taskId}: operation ${ledger.operation || 'classification-required'}; missing ${audit.missingCapability}. ${audit.supportedNextAction}`);
  }

  if (eventName === 'PostToolUse' && String(input.tool_name || input.toolName) === 'Skill') {
    const ledger = router.readTaskLedger(input, options);
    if (!ledger) return {};
    const skillName = skillNameFromInput(input);
    const invocation = exactOfficialInvocation(router, input, skillName, options);
    const result = router.updateTaskLedger(input, (current) => router.recordSkillInvocation(current, invocation), options);
    const audit = router.auditN8nCompletion(result.ledger);
    return context('PostToolUse', result.accepted
      ? `Recorded successful official n8n Skill ${result.evidence.skillName} for ${result.ledger.taskId}. ${audit.complete ? 'Required n8n capabilities are satisfied.' : `Next missing capability: ${audit.missingCapability}. ${audit.supportedNextAction}`}`
      : `The Skill event did not satisfy the n8n ledger because its name/source/version/compatibility evidence was missing, unsupported, ambiguous, or not required. Missing ${audit.missingCapability}. ${audit.supportedNextAction}`);
  }

  if (eventName === 'PostToolUse' && ['Bash', 'PowerShell'].includes(String(input.tool_name || input.toolName))) {
    const ledger = router.readTaskLedger(input, options);
    if (!ledger) return {};
    if (router.isCapabilityProducerToolUse(input, ledger, options)) {
      const receipt = router.capabilityReceiptFromProducerToolUse(input, ledger, options);
      const updated = router.updateTaskLedger(input, (current) =>
        router.recordCapabilityReceipt(current, receipt, { input, options }), options);
      const audit = router.auditN8nCompletion(updated);
      return context('PostToolUse', `Recorded ${receipt.capabilityId} from the exact installed Toolkit helper bytes for ${updated.taskId}. ${audit.complete ? 'Required n8n capabilities are satisfied.' : `Next missing capability: ${audit.missingCapability}. ${audit.supportedNextAction}`}`);
    }
    if (!router.isCapabilityReceiptIngestionToolUse(input)) return {};
    const receipt = router.parseCapabilityReceiptOutput(input);
    if (!receipt) return context('PostToolUse', 'The bounded capability-receipt command returned no receipt; no n8n capability evidence was recorded.');
    const updated = router.updateTaskLedger(input, (current) => router.recordCapabilityReceipt(current, receipt, { input, options }), options);
    const audit = router.auditN8nCompletion(updated);
    return context('PostToolUse', `Recorded ${receipt.capabilityId} for ${updated.taskId}. ${audit.complete ? 'Required n8n capabilities are satisfied.' : `Next missing capability: ${audit.missingCapability}. ${audit.supportedNextAction}`}`);
  }

  if (eventName === 'UserPromptExpansion') {
    const ledger = router.readTaskLedger(input, options);
    if (!ledger) return {};
    const commandName = router.normalizeSkillName(input.command_name || '');
    const required = ledger.requiredCapabilities.some((entry) => entry.kind === 'official-skill' && entry.name === commandName);
    if (!required) return {};
    return context('UserPromptExpansion', `Direct /${commandName} expansion is not accepted as successful task-ledger evidence because this pre-expansion event cannot prove completion. Invoke the same official Skill through Claude's Skill tool so PostToolUse can record success.`);
  }

  if (eventName === 'PreToolUse') {
    const toolName = String(input.tool_name || input.toolName || '');
    if (!router.GOVERNED_MUTATION_TOOLS.has(toolName)) return {};
    let ledger = router.readTaskLedger(input, options);
    if (ledger && router.isCapabilityReceiptIngestionToolUse(input)) return {};
    if (ledger && router.isCapabilityProducerToolUse(input, ledger, options)) return {};
    const detectedMutation = router.looksLikeN8nWorkflowMutation(input);
    if (!ledger && detectedMutation) {
      ledger = startLedger(router, input, {
        objective: 'Material n8n workflow mutation detected from bounded tool input.',
        operation: inferredMutationOperation(input, router),
        evidenceText: JSON.stringify(input.tool_input || {}),
        n8nWorkflowStructure: true
      }, options);
    }
    if (!ledger) return {};
    const governedByActiveLedger = !router.isProvenReadOnlyToolUse(input);
    if (detectedMutation) {
      const reconciliation = router.updateTaskLedger(input, (current) => router.reconcileN8nCapabilityLedger(current, {
          operation: inferredMutationOperation(input, router),
          evidenceText: JSON.stringify(input.tool_input || {}),
          recordedAt: input.timestamp || new Date().toISOString()
        }), options);
      if (reconciliation.mismatch) return preToolDeny(reconciliation.mismatch);
      ledger = reconciliation.ledger;
    }
    if (!detectedMutation && !governedByActiveLedger) return {};
    const audit = router.auditN8nCompletion(ledger);
    if (!audit.complete) return preToolDeny(audit);
    router.assertN8nMutationAdmitted(ledger, { toolName });
    return {};
  }

  if (eventName === 'TaskCompleted' || eventName === 'Stop') {
    const ledger = router.readTaskLedger(input, options);
    if (!ledger) return {};
    const audit = router.auditN8nCompletion(ledger);
    if (audit.complete) return {};
    const lastMessage = String(input.last_assistant_message || '');
    const honestBlockedReport = audit.blocked
      && lastMessage.includes(audit.stableCode)
      && lastMessage.includes(audit.missingCapability)
      && lastMessage.includes(audit.supportedNextAction);
    if (eventName === 'Stop' && honestBlockedReport) return {};
    const reason = `${audit.stableCode}: n8n task ${ledger.taskId} cannot be declared complete; missing ${audit.missingCapability}. ${audit.supportedNextAction}`;
    return eventName === 'TaskCompleted' ? commandFailure(reason) : { decision: 'block', reason };
  }
  return {};
}

function fallbackDecision(input, error, options = {}) {
  const eventName = String(input.hook_event_name || input.hookEventName || '');
  const serialized = JSON.stringify(input || {}).toLowerCase().replace(/\\\\/g, '/');
  const looksN8n = /\bn8n\b|n8n-workflows?|workflows?\/[^"\s]+\.json|"nodes"\s*:.*"connections"\s*:/.test(serialized);
  let activeLedger = false;
  try {
    const router = options.router || loadRouter();
    activeLedger = fs.existsSync(router.stateFileFor(input, options));
  } catch {
    activeLedger = false;
  }
  const governedTool = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'].includes(String(input.tool_name || input.toolName || ''));
  if (eventName === 'PreToolUse' && (looksN8n || (activeLedger && governedTool))) {
    return preToolDeny({
      stableCode: 'N8N_ADMISSION_UNAVAILABLE',
      missingCapability: 'toolkit:n8n-domain-router',
      supportedNextAction: 'Restore the verified current Toolkit n8n domain router, then retry the exact operation.'
    });
  }
  if ((eventName === 'TaskCompleted' || eventName === 'Stop') && (looksN8n || activeLedger)) {
    const reason = 'N8N_ADMISSION_UNAVAILABLE: missing toolkit:n8n-domain-router. Restore the verified current Toolkit n8n domain router, then retry completion.';
    return eventName === 'TaskCompleted' ? commandFailure(reason) : { decision: 'block', reason };
  }
  return context(eventName || 'PreToolUse', 'Toolkit n8n admission check could not complete safely; no capability evidence was recorded.');
}

if (require.main === module) {
  const input = readInput();
  try { emitHookResult(handle(input)); }
  catch (error) { emitHookResult(fallbackDecision(input, error)); }
}

module.exports = { loadRouter, readInput, preToolDeny, commandFailure, emitHookResult, skillNameFromInput, inferredMutationOperation, isContinuationPrompt, startsNewObjective, handle, fallbackDecision };
