'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const n8n = require('../../skills/external-system-router/scripts/n8n-domain-router.cjs');
const external = require('../../skills/external-system-router/scripts/external-system-router.cjs');
const hook = require('../scripts/toolkit-claude-n8n-admission-hook.cjs');

function sourceAttestation(skillName, overrides = {}) {
  const contract = n8n.OFFICIAL_N8N_SKILLS_CONTRACT;
  return {
    verified: true,
    stableCode: 'N8N_SKILL_SOURCE_VERIFIED',
    skillName,
    invokedName: `${contract.pluginNamespace}:${skillName}`,
    packageId: contract.packageId,
    packageVersion: contract.packageVersion,
    sourceRepository: contract.sourceRepository,
    sourceCommit: contract.sourceCommit,
    compatibilityBaselineCommit: contract.compatibilityBaselineCommit,
    compatibilityReference: contract.compatibilityOwner,
    contentCompatibility: contract.contentCompatibility,
    manifestBlob: contract.claudePluginManifestBlob,
    skillBlob: n8n.OFFICIAL_N8N_SKILL_BLOBS[skillName],
    sourceFingerprint: `sha256:${'a'.repeat(64)}`,
    normalization: 'utf8-bom-stripped-crlf-to-lf-git-blob',
    ...overrides
  };
}

function record(ledger, skillName, overrides = {}) {
  return n8n.recordSkillInvocation(ledger, {
    invocationId: `invoke-${skillName}-${ledger.invocationEvidence.length}`,
    skillName,
    result: 'success',
    sourceAttestation: sourceAttestation(skillName, overrides),
    host: 'claude-toolkit-direct',
    event: 'PostToolUse:Skill',
    invokedAt: '2026-07-23T00:00:00.000Z'
  });
}

function materialLedger(overrides = {}) {
  return n8n.createN8nCapabilityLedger({
    sessionId: 'session-286',
    repositoryIdentity: 'repository-286',
    objective: 'Edit the n8n workflow JSON and configure its nodes.',
    operation: 'workflow-material-edit',
    createdAt: '2026-07-23T00:00:00.000Z',
    ...overrides
  });
}

test('material n8n work detects intent, classifies the exact operation, and builds required official Skill ledger entries', () => {
  const detected = n8n.detectN8nTask({ objective: 'Repair this n8n workflow JSON.' });
  assert.equal(detected.detected, true);
  const setupIntent = n8n.classifyN8nOperation({ objective: 'Set up n8n.' });
  assert.equal(setupIntent.detected, false);
  assert.equal(n8n.classifyN8nOperation({ objective: 'Install the official n8n Skills.' }).detected, false);
  const classification = n8n.classifyN8nOperation({ objective: 'Edit this n8n workflow JSON.' });
  assert.equal(classification.operation, 'workflow-material-edit');
  const ledger = materialLedger();
  const required = ledger.requiredCapabilities.map((entry) => entry.name);
  assert.ok(required.includes('using-n8n-skills-official'));
  assert.ok(required.includes('n8n-workflow-lifecycle-official'));
  assert.ok(required.includes('n8n-node-configuration-official'));
  assert.equal(n8n.auditN8nCompletion(ledger).complete, false);
  assert.equal(n8n.detectN8nTask({ objective: 'What is n8n?' }).detected, false);
  const ledgerSchema = JSON.parse(fs.readFileSync(path.join(
    __dirname, '..', '..', 'skills', 'external-system-router', 'references', 'schemas',
    'n8n-capability-ledger.schema.json'
  ), 'utf8'));
  assert.ok(ledgerSchema.required.includes('objectiveTargetDigest'));
  assert.deepEqual(ledgerSchema.properties.objectiveTargetDigest, { $ref: '#/$defs/digest' });
});

test('failed, stale, malformed, unqualified, or ambiguous Skill attempts never satisfy the ledger', () => {
  const ledger = materialLedger();
  const skill = 'using-n8n-skills-official';
  const failed = n8n.recordSkillInvocation(ledger, {
    invocationId: 'failed-entry', skillName: skill, result: 'failed', sourceAttestation: sourceAttestation(skill)
  });
  assert.equal(failed.accepted, false);
  const stale = record(ledger, skill, { packageVersion: '1.0.1' });
  assert.equal(stale.accepted, false);
  const malformed = n8n.recordSkillInvocation(ledger, {
    invocationId: 'missing-source', skillName: skill, result: 'success', sourceAttestation: { verified: true, skillName: skill }
  });
  assert.equal(malformed.accepted, false);

  const unqualified = n8n.attestClaudeOfficialSkillInvocation({ skillName: skill }, { pluginRecords: [] });
  assert.equal(unqualified.verified, false);
  assert.equal(unqualified.stableCode, 'N8N_SKILL_SOURCE_AMBIGUOUS');
  const missing = n8n.attestClaudeOfficialSkillInvocation({ skillName: `n8n-skills:${skill}` }, { pluginRecords: [] });
  assert.equal(missing.verified, false);
  assert.equal(missing.stableCode, 'N8N_SKILL_SOURCE_AMBIGUOUS');
  const competing = n8n.attestClaudeOfficialSkillInvocation({ skillName: `n8n-skills:${skill}` }, {
    pluginRecords: [
      { version: n8n.OFFICIAL_N8N_SKILLS_CONTRACT.packageVersion, installPath: 'C:/cache/current' },
      { version: '1.0.1', installPath: 'C:/workspace/competing' }
    ]
  });
  assert.equal(competing.verified, false);
  assert.equal(competing.stableCode, 'N8N_SKILL_SOURCE_AMBIGUOUS');
  assert.match(competing.reason, /competing scope or version/);
});

test('both exact reviewed 1.0.2 source commits satisfy evidence, while any other commit fails closed', () => {
  const skill = 'using-n8n-skills-official';
  for (const sourceCommit of n8n.OFFICIAL_N8N_SKILLS_CONTRACT.supportedSourceCommits) {
    const result = record(materialLedger(), skill, { sourceCommit });
    assert.equal(result.accepted, true, sourceCommit);
  }
  const unsupported = record(materialLedger(), skill, { sourceCommit: 'f'.repeat(40) });
  assert.equal(unsupported.accepted, false);
});

test('official Skill attestation rejects a symlinked source path before reading content', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-skill-source-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-skill-source-outside-'));
  fs.mkdirSync(path.join(outside, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(outside, '.claude-plugin', 'plugin.json'), '{}');
  try {
    fs.symlinkSync(path.join(outside, '.claude-plugin'), path.join(root, '.claude-plugin'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(`symlink creation is unavailable: ${error.code}`);
    throw error;
  }
  const contract = n8n.OFFICIAL_N8N_SKILLS_CONTRACT;
  const attestation = n8n.attestClaudeOfficialSkillInvocation(
    { skillName: `${contract.pluginNamespace}:${contract.entryPoint}` },
    { pluginRecords: [{ version: contract.packageVersion, gitCommitSha: contract.sourceCommit, installPath: root }] }
  );
  assert.equal(attestation.verified, false);
  assert.equal(attestation.stableCode, 'N8N_SKILL_SOURCE_UNVERIFIED');
});

test('generic validator or mirrored workflow evidence cannot substitute for official Skills', () => {
  const ledger = materialLedger();
  const entry = ledger.requiredCapabilities.find((item) => item.kind === 'official-skill');
  assert.throws(
    () => n8n.recordCapabilityEvidence(ledger, { capabilityId: entry.capabilityId, result: 'verified', reference: 'test:generic-json-validator' }),
    (error) => error.code === 'N8N_OFFICIAL_SKILL_INVOCATION_REQUIRED'
  );
  assert.equal(n8n.looksLikeN8nWorkflowMutation({
    tool_name: 'Write',
    tool_input: {
      file_path: 'n8n-workflows/mirrored.json',
      content: '{"nodes":[],"connections":{}}'
    }
  }), true);
  assert.throws(
    () => n8n.assertN8nMutationAdmitted(ledger, { toolName: 'Write' }),
    (error) => error.code === 'N8N_CAPABILITY_MISSING' && /official-skill/.test(error.message)
  );
  assert.equal(n8n.looksLikeN8nWorkflowMutation({
    tool_name: 'Write',
    tool_input: { file_path: 'automation/workflow.json', content: '{"steps":[]}' }
  }), false);
  assert.equal(n8n.looksLikeN8nWorkflowMutation({
    tool_name: 'PowerShell',
    tool_input: { command: 'Get-Content n8n-workflows/example.json' }
  }), false);
  assert.equal(n8n.looksLikeN8nWorkflowMutation({
    tool_name: 'mcp__n8n__update_workflow',
    tool_input: { workflowId: 'workflow-alias', nodes: [] }
  }), true);
  assert.equal(n8n.isGovernedN8nMutationTool('mcp__n8n__get_workflow'), false);
  assert.equal(n8n.isGovernedN8nMutationTool('mcp__n8n__rename_workflow'), true);
  assert.equal(n8n.inferGovernedMutationOperation('mcp__n8n__update_workflow'), 'live-workflow-update');
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-generic-workflow-target-'));
  fs.mkdirSync(path.join(repository, 'workflows'));
  fs.writeFileSync(path.join(repository, 'workflows', 'orders.json'), '{"name":"Orders","nodes":[],"connections":{}}\n');
  assert.equal(n8n.looksLikeN8nWorkflowMutation({
    cwd: repository,
    tool_name: 'Edit',
    tool_input: { file_path: 'workflows/orders.json', old_string: '"Orders"', new_string: '"Orders v2"' }
  }), true);
  fs.writeFileSync(path.join(repository, 'workflows', 'generic.json'), '{"steps":[]}\n');
  assert.equal(n8n.looksLikeN8nWorkflowMutation({
    cwd: repository,
    tool_name: 'Edit',
    tool_input: { file_path: 'workflows/generic.json', old_string: 'steps', new_string: 'tasks' }
  }), false);
  assert.equal(n8n.looksLikeN8nWorkflowMutation({
    cwd: repository,
    tool_name: 'Bash',
    tool_input: { command: 'node scripts/change-workflow.cjs workflows/orders.json' }
  }), true);
  assert.equal(n8n.looksLikeN8nWorkflowMutation({
    cwd: repository,
    tool_name: 'Bash',
    tool_input: { command: 'node scripts/change-workflow.cjs --file=workflows/orders.json' }
  }), true);
  assert.equal(n8n.looksLikeN8nWorkflowMutation({
    cwd: repository,
    tool_name: 'PowerShell',
    tool_input: { command: 'node scripts/change-workflow.cjs workflows/generic.json' }
  }), false);
  for (const command of [
    'git show HEAD:n8n-workflows/example.json --output=n8n-workflows/live.json',
    'git diff --output result.patch',
    'git log -oresult.txt',
    'git show --ext-diff HEAD'
  ]) {
    assert.equal(n8n.isProvenReadOnlyToolUse({ tool_name: 'Bash', tool_input: { command } }), false, command);
  }
  assert.equal(n8n.isProvenReadOnlyToolUse({
    tool_name: 'Bash',
    tool_input: {
      command: 'git --no-pager --no-optional-locks -c core.fsmonitor=false -c core.hooksPath= -c diff.external= show --no-ext-diff --no-textconv HEAD:n8n-workflows/example.json'
    }
  }), true);
  assert.equal(n8n.isProvenReadOnlyToolUse({
    tool_name: 'Bash',
    tool_input: {
      command: 'git --no-pager --no-optional-locks -c core.fsmonitor=false -c core.hooksPath= -c diff.external= log --no-ext-diff HEAD'
    }
  }), false);
});

test('isolated Git inspection cannot execute configured textconv or external diff helpers', () => {
  function git(repository, args) {
    const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result;
  }

  for (const helperKind of ['textconv', 'external']) {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), `n8n-git-${helperKind}-`));
    const sentinel = path.join(repository, 'sentinel.txt');
    const helper = path.join(repository, 'helper.cjs');
    fs.writeFileSync(helper, `'use strict';\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'mutated');\n`);
    fs.writeFileSync(path.join(repository, 'workflow.txt'), 'before\n');
    git(repository, ['init']);
    git(repository, ['config', 'user.email', 'synthetic@example.invalid']);
    git(repository, ['config', 'user.name', 'Synthetic Fixture']);
    if (helperKind === 'textconv') {
      fs.writeFileSync(path.join(repository, '.gitattributes'), '*.txt diff=fixture\n');
      git(repository, ['config', 'diff.fixture.textconv', `node "${helper.replace(/\\/g, '/')}"`]);
    } else {
      git(repository, ['config', 'diff.external', `node "${helper.replace(/\\/g, '/')}"`]);
    }
    const fixtureFiles = ['workflow.txt', '.gitattributes'].filter((entry) =>
      fs.existsSync(path.join(repository, entry)));
    git(repository, ['add', ...fixtureFiles]);
    git(repository, ['commit', '-m', 'fixture']);
    fs.writeFileSync(path.join(repository, 'workflow.txt'), 'after\n');

    const unsafeCommand = 'git diff';
    assert.equal(n8n.isProvenReadOnlyToolUse({
      tool_name: 'Bash',
      tool_input: { command: unsafeCommand }
    }), false);
    assert.equal(fs.existsSync(sentinel), false);
    git(repository, ['diff']);
    assert.equal(fs.existsSync(sentinel), true, `${helperKind} fixture proves the configured helper is executable`);
    fs.unlinkSync(sentinel);

    const safeArgs = [
      '--no-pager', '--no-optional-locks',
      '-c', 'core.fsmonitor=false',
      '-c', 'core.hooksPath=',
      '-c', 'diff.external=',
      'diff', '--no-ext-diff', '--no-textconv'
    ];
    const safeCommand = `git ${safeArgs.map((value) => value.includes('=') && value.endsWith('=')
      ? `"${value}"`
      : value).join(' ')}`;
    assert.equal(n8n.isProvenReadOnlyToolUse({
      tool_name: 'Bash',
      tool_input: { command: safeCommand }
    }), true);
    git(repository, safeArgs);
    assert.equal(fs.existsSync(sentinel), false);
  }
});

test('task-ledger capability and source-contract tampering fails closed', () => {
  const missing = materialLedger();
  missing.requiredCapabilities.pop();
  assert.throws(() => n8n.validateN8nCapabilityLedger(missing), (error) => error.code === 'N8N_LEDGER_CAPABILITY_MISMATCH');

  const stale = materialLedger();
  stale.sourceContract = { ...stale.sourceContract, packageVersion: '1.0.1' };
  assert.throws(() => n8n.validateN8nCapabilityLedger(stale), (error) => error.code === 'N8N_LEDGER_SOURCE_CONTRACT_MISMATCH');
});

test('workflow mutation is admitted only after every exact required official Skill invocation succeeds', () => {
  let ledger = materialLedger();
  for (const capability of ledger.requiredCapabilities.filter((entry) => entry.kind === 'official-skill')) {
    const result = record(ledger, capability.name);
    assert.equal(result.accepted, true, capability.name);
    ledger = result.ledger;
  }
  assert.equal(n8n.auditN8nCompletion(ledger).complete, true);
  assert.equal(n8n.assertN8nMutationAdmitted(ledger, { toolName: 'Write' }).admitted, true);

  const reconciled = n8n.reconcileN8nCapabilityLedger(ledger, {
    operation: 'workflow-material-edit',
    evidenceText: '{"value":"={{ $json.body }}"}',
    recordedAt: '2026-07-23T00:01:00.000Z'
  });
  assert.equal(reconciled.changed, true);
  assert.equal(n8n.auditN8nCompletion(reconciled.ledger).missingCapability, 'official-skill:n8n-expressions-official');
  assert.throws(() => n8n.assertN8nMutationAdmitted(reconciled.ledger, { toolName: 'Edit' }), (error) => error.code === 'N8N_CAPABILITY_MISSING');
});

test('helper/compiler and live operations require their own evidence and do not imply MCP', () => {
  let helperLedger = n8n.createN8nCapabilityLedger({
    sessionId: 'helper-session', repositoryIdentity: 'repo', objective: 'Compile this n8n workflow JSON.',
    operation: 'workflow-compile', createdAt: '2026-07-23T00:00:00.000Z'
  });
  for (const capability of helperLedger.requiredCapabilities.filter((entry) => entry.kind === 'official-skill')) {
    helperLedger = record(helperLedger, capability.name).ledger;
  }
  let audit = n8n.auditN8nCompletion(helperLedger);
  assert.equal(audit.missingCapability, 'toolkit-helper:workflow-compile');
  helperLedger = n8n.recordCapabilityEvidence(helperLedger, {
    capabilityId: 'toolkit-helper:workflow-compile', result: 'verified', reference: 'receipt:compiler-synthetic'
  });
  assert.equal(n8n.auditN8nCompletion(helperLedger).complete, true);

  const live = n8n.createN8nCapabilityLedger({
    sessionId: 'live-session', repositoryIdentity: 'repo', objective: 'Update the live n8n workflow.',
    operation: 'live-workflow-update', createdAt: '2026-07-23T00:00:00.000Z'
  });
  assert.ok(live.requiredCapabilities.some((entry) => entry.capabilityId === 'live-route:live-workflow-update'));
  assert.ok(live.requiredCapabilities.some((entry) => entry.capabilityId === 'official-skill:using-n8n-skills-official'));
  assert.equal(live.requiredCapabilities.some((entry) => /mcp/i.test(entry.capabilityId)), false);
  assert.throws(() => n8n.recordCapabilityEvidence(live, {
    capabilityId: 'live-route:live-workflow-update', result: 'verified', reference: 'test:generic-live-validator'
  }), (error) => error.code === 'N8N_STRUCTURED_RECEIPT_REQUIRED');
});

test('Claude Toolkit-direct hook blocks writes, permits generic validation without credit, and unlocks only after attested Skill events', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-admission-'));
  const base = {
    session_id: 'claude-session-286',
    cwd: 'C:/synthetic/repository',
    timestamp: '2026-07-23T00:00:00.000Z'
  };
  const fakeRouter = {
    ...n8n,
    attestClaudeOfficialSkillInvocation({ skillName }) {
      const normalized = n8n.normalizeSkillName(skillName);
      return sourceAttestation(normalized, { invokedName: skillName });
    }
  };

  const prompt = hook.handle({
    ...base,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Edit this n8n workflow JSON.'
  }, { router: fakeRouter, stateRoot });
  assert.match(prompt.hookSpecificOutput.additionalContext, /missing official-skill:using-n8n-skills-official/);

  const validator = hook.handle({
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'node scripts/validate-json.cjs n8n-workflows/example.json' }
  }, { router: fakeRouter, stateRoot });
  assert.equal(validator.hookSpecificOutput.permissionDecision, 'deny');
  for (const command of [
    'node --test repo/tests/n8n-domain-admission.test.cjs',
    'npm test',
    'npm run validate'
  ]) {
    assert.equal(n8n.isProvenReadOnlyToolUse({
      tool_name: 'Bash', tool_input: { command }
    }), false, command);
  }

  const writeInput = {
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: 'n8n-workflows/example.json', content: '{"nodes":[],"connections":{}}' }
  };
  const blocked = hook.handle(writeInput, { router: fakeRouter, stateRoot });
  assert.equal(blocked.hookSpecificOutput.permissionDecision, 'deny');

  const mcpBase = {
    ...base,
    session_id: 'claude-mcp-session-286',
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__n8n__update_workflow',
    tool_input: { workflowId: 'workflow-alias', nodes: [] }
  };
  const blockedMcp = hook.handle(mcpBase, { router: fakeRouter, stateRoot });
  assert.equal(blockedMcp.hookSpecificOutput.permissionDecision, 'deny');
  const mcpLedger = n8n.readTaskLedger(mcpBase, { stateRoot });
  assert.equal(mcpLedger.operation, 'live-workflow-update');
  assert.ok(mcpLedger.requiredCapabilities.some((entry) => entry.capabilityId === 'live-route:live-workflow-update'));

  const genericWrite = hook.handle({
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: 'automation/workflow.json', old_string: 'disabled', new_string: 'enabled' }
  }, { router: fakeRouter, stateRoot });
  assert.equal(genericWrite.hookSpecificOutput.permissionDecision, 'deny');

  const opaqueShellWrite = hook.handle({
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: 'PowerShell',
    tool_input: { command: 'node scripts/change-file.cjs automation/workflow.json test', description: 'validate safely' }
  }, { router: fakeRouter, stateRoot });
  assert.equal(opaqueShellWrite.hookSpecificOutput.permissionDecision, 'deny');

  let ledger = n8n.readTaskLedger(base, { stateRoot });
  const entryPoint = ledger.requiredCapabilities.find((entry) => entry.name === 'using-n8n-skills-official');
  hook.handle({
    ...base,
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    tool_use_id: 'tool-initial-entry-point',
    tool_input: { skill: `n8n-skills:${entryPoint.name}` }
  }, { router: fakeRouter, stateRoot });
  hook.handle({
    ...base,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Continue editing this n8n workflow and add error handling.'
  }, { router: fakeRouter, stateRoot });
  ledger = n8n.readTaskLedger(base, { stateRoot });
  assert.equal(ledger.invocationEvidence.some((entry) => entry.invocationId === 'tool-initial-entry-point' && entry.accepted), true);
  assert.equal(ledger.requiredCapabilities.some((entry) => entry.name === 'n8n-error-handling-official' && entry.status === 'pending'), true);

  for (const capability of ledger.requiredCapabilities.filter((entry) => entry.kind === 'official-skill' && entry.status === 'pending')) {
    hook.handle({
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Skill',
      tool_use_id: `tool-${capability.name}`,
      tool_input: { skill: `n8n-skills:${capability.name}` }
    }, { router: fakeRouter, stateRoot });
  }
  ledger = n8n.readTaskLedger(base, { stateRoot });
  assert.equal(n8n.auditN8nCompletion(ledger).complete, true);
  assert.deepEqual(hook.handle(writeInput, { router: fakeRouter, stateRoot }), {});
});

test('live and Toolkit-helper commands classify before workflow-edit fallback', () => {
  assert.equal(hook.inferredMutationOperation({
    tool_input: { command: 'n8n publish workflow 123' }
  }, n8n), 'live-workflow-publish');
  assert.equal(hook.inferredMutationOperation({
    tool_input: { command: 'node n8n-workflows/scripts/prepare-import.cjs workflow.json' }
  }, n8n), 'prepare-import');
});

test('changed material operations mismatch and new objectives receive fresh ledgers without prior evidence', () => {
  const repair = n8n.createN8nCapabilityLedger({
    sessionId: 'operation-change', repositoryIdentity: 'repo',
    objective: 'Repair this n8n workflow.', operation: 'workflow-repair',
    createdAt: '2026-07-23T00:00:00.000Z'
  });
  const mismatch = n8n.reconcileN8nCapabilityLedger(repair, { operation: 'workflow-material-edit' });
  assert.equal(mismatch.mismatch.stableCode, 'N8N_OPERATION_MISMATCH');

  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-new-objective-'));
  const base = { session_id: 'new-objective', cwd: 'C:/synthetic/repo', timestamp: '2026-07-23T00:00:00.000Z' };
  hook.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Edit workflow A in n8n JSON.' }, { router: n8n, stateRoot });
  const first = n8n.readTaskLedger(base, { stateRoot });
  hook.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Edit workflow B in n8n JSON.' }, { router: n8n, stateRoot });
  const second = n8n.readTaskLedger(base, { stateRoot });
  assert.notEqual(second.taskId, first.taskId);
  assert.equal(second.invocationEvidence.length, 0);
  hook.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Also edit workflow C in n8n JSON.' }, { router: n8n, stateRoot });
  const continuedNewObjective = n8n.readTaskLedger(base, { stateRoot });
  assert.notEqual(continuedNewObjective.taskId, second.taskId);
  assert.equal(continuedNewObjective.invocationEvidence.length, 0);
  hook.handle({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Explain git rebase.' }, { router: n8n, stateRoot });
  assert.equal(n8n.readTaskLedger(base, { stateRoot }), null);
});

test('bounded PostToolUse receipt ingestion records required non-Skill capability evidence', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-capability-receipt-'));
  const base = { session_id: 'receipt-session', cwd: 'C:/synthetic/repo', timestamp: '2026-07-23T00:00:00.000Z' };
  let ledger = n8n.createN8nCapabilityLedger({
    sessionId: base.session_id, repositoryIdentity: base.cwd,
    objective: 'Compile this n8n workflow JSON.', operation: 'workflow-compile',
    createdAt: base.timestamp
  });
  for (const capability of ledger.requiredCapabilities.filter((entry) => entry.kind === 'official-skill')) {
    ledger = record(ledger, capability.name).ledger;
  }
  n8n.writeTaskLedger(base, ledger, { stateRoot });
  const routerPath = require.resolve('../../skills/external-system-router/scripts/n8n-domain-router.cjs');
  const command = `node "${routerPath}" ingest-capability-receipt receipt.json`;
  const receipt = {
    schemaVersion: n8n.N8N_CAPABILITY_RECEIPT_SCHEMA_VERSION,
    taskId: ledger.taskId,
    operation: ledger.operation,
    capabilityId: 'toolkit-helper:workflow-compile',
    issuer: 'toolkit-helper',
    result: 'verified',
    reference: 'receipt:compiler-synthetic',
    commandDigest: n8n.sha256(command),
    sourceDigest: n8n.sha256('synthetic-helper-source'),
    recordedAt: '2026-07-23T00:01:00.000Z'
  };
  receipt.receiptDigest = n8n.sha256(receipt);
  const toolInput = {
    ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command }, tool_response: JSON.stringify(receipt)
  };
  const result = hook.handle(toolInput, { router: n8n, stateRoot });
  assert.match(result.hookSpecificOutput.additionalContext, /Required n8n capabilities are satisfied/);
  assert.equal(n8n.auditN8nCompletion(n8n.readTaskLedger(base, { stateRoot })).complete, true);
  const forged = { ...receipt, commandDigest: n8n.sha256(`${command} --different`) };
  forged.receiptDigest = n8n.sha256({ ...forged, receiptDigest: undefined });
  assert.throws(() => n8n.recordCapabilityReceipt(ledger, forged, { input: toolInput }),
    (error) => error.code === 'N8N_CAPABILITY_RECEIPT_INVALID' || error.code === 'N8N_CAPABILITY_RECEIPT_MISMATCH');

  const lookalikeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-receipt-lookalike-'));
  const lookalike = path.join(lookalikeRoot, 'n8n-domain-router.cjs');
  fs.writeFileSync(lookalike, "'use strict';\n");
  const lookalikeInput = {
    ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: `node "${lookalike}" ingest-capability-receipt receipt.json` }
  };
  assert.equal(n8n.isCapabilityReceiptIngestionToolUse(lookalikeInput), false);
  assert.equal(hook.handle(lookalikeInput, { router: n8n, stateRoot }).hookSpecificOutput.permissionDecision, 'deny');
});

test('external capability receipts require installed-router, envelope, target, operation, and operation-receipt authority', () => {
  const objective = 'Update the live n8n workflow.';
  const ledger = n8n.createN8nCapabilityLedger({
    sessionId: 'external-receipt',
    repositoryIdentity: 'repo',
    objective,
    operation: 'live-workflow-update',
    createdAt: '2026-07-23T00:00:00.000Z'
  });
  const routerPath = require.resolve('../../skills/external-system-router/scripts/n8n-domain-router.cjs');
  const externalPath = require.resolve('../../skills/external-system-router/scripts/external-system-router.cjs');
  const command = `node "${routerPath}" ingest-capability-receipt receipt.json`;
  const authorisationEnvelope = {
    schemaVersion: external.ENVELOPE_SCHEMA_VERSION,
    provider: 'n8n',
    targetAlias: 'n8n-production',
    accountOrOrganisation: 'owner',
    resource: 'workflow-orders',
    environment: 'production',
    objective,
    allowedOperations: ['live-workflow-update'],
    operationRiskTiers: { 'live-workflow-update': 2 },
    authorisedTier2Operations: ['live-workflow-update'],
    forbiddenOperations: [],
    expectedResult: 'The exact route is ready for the governed operation.',
    verification: ['Verify the target fingerprint and selected route.'],
    rollbackOrSafeDisable: ['Do not attempt a mutation when preconditions fail.'],
    lifetime: {
      kind: 'task',
      taskId: ledger.taskId,
      sessionFingerprint: ledger.sessionFingerprint,
      objectiveDigest: ledger.objectiveDigest
    },
    ownerApprovalReference: 'owner-approved-live-route',
    sensitiveDataClasses: ['workflow-metadata'],
    interfaceRestrictions: ['no-browser']
  };
  const operationContext = {
    provider: 'n8n',
    targetAlias: 'n8n-production',
    accountOrOrganisation: 'owner',
    resource: 'workflow-orders',
    environment: 'production',
    operation: 'live-workflow-update',
    targetFingerprint: `sha256:${'a'.repeat(64)}`,
    taskId: ledger.taskId,
    sessionFingerprint: ledger.sessionFingerprint,
    objectiveDigest: ledger.objectiveDigest,
    inventoryGeneration: `sha256:${'b'.repeat(64)}`,
    inventoryDigest: `sha256:${'c'.repeat(64)}`,
    readOnly: false
  };
  const selectedRoute = {
    selectedInterface: 'n8n-api',
    capabilityDigest: `sha256:${'d'.repeat(64)}`,
    inventoryGeneration: operationContext.inventoryGeneration,
    inventoryDigest: operationContext.inventoryDigest,
    hostAdapterPlanDigest: null
  };
  const operationReceipt = external.createOperationReceipt({
    schemaVersion: external.RECEIPT_SCHEMA_VERSION,
    operationId: 'route-live-workflow-update',
    operation: operationContext.operation,
    provider: operationContext.provider,
    adapter: 'n8n-api',
    targetAlias: operationContext.targetAlias,
    accountOrOrganisation: operationContext.accountOrOrganisation,
    resource: operationContext.resource,
    targetFingerprint: operationContext.targetFingerprint,
    environment: operationContext.environment,
    riskTier: 2,
    authorisationReference: authorisationEnvelope.ownerApprovalReference,
    authorisationEnvelope,
    selectedRoute,
    precondition: 'passed',
    mutationAttempted: false,
    mutationPerformed: false,
    postcondition: 'not-applicable',
    rollbackAttempted: false,
    rollbackPerformed: false,
    stableCode: 'EXTERNAL_ROUTE_AUTHORISED',
    safeEvidenceReferences: ['test:exact-route-authority'],
    supportedNextAction: 'Continue only through the selected exact route.',
    unchangedScope: ['No live mutation was attempted.']
  });
  const receipt = {
    schemaVersion: n8n.N8N_CAPABILITY_RECEIPT_SCHEMA_VERSION,
    taskId: ledger.taskId,
    operation: ledger.operation,
    capabilityId: 'live-route:live-workflow-update',
    issuer: 'external-system-router',
    result: 'verified',
    reference: `receipt:${operationReceipt.operationId}`,
    commandDigest: n8n.sha256(command),
    operationAuthority: {
      routerSourceDigest: n8n.sha256(fs.readFileSync(externalPath)),
      authorisationEnvelope,
      operationContext,
      operationReceipt
    },
    recordedAt: '2026-07-23T00:01:00.000Z'
  };
  receipt.receiptDigest = n8n.sha256(receipt);
  const input = {
    cwd: path.dirname(routerPath),
    tool_name: 'Bash',
    tool_input: { command }
  };
  const recorded = n8n.recordCapabilityReceipt(ledger, receipt, { input });
  assert.equal(recorded.requiredCapabilities.find((entry) =>
    entry.capabilityId === receipt.capabilityId).status, 'verified');

  const issuerOnly = { ...receipt };
  delete issuerOnly.operationAuthority;
  issuerOnly.receiptDigest = n8n.sha256(issuerOnly);
  assert.throws(() => n8n.recordCapabilityReceipt(ledger, issuerOnly, { input }),
    (error) => error.code === 'N8N_CAPABILITY_RECEIPT_INVALID');

  const wrongTarget = structuredClone(receipt);
  wrongTarget.operationAuthority.operationContext.targetFingerprint = `sha256:${'b'.repeat(64)}`;
  delete wrongTarget.receiptDigest;
  wrongTarget.receiptDigest = n8n.sha256(wrongTarget);
  assert.throws(() => n8n.recordCapabilityReceipt(ledger, wrongTarget, { input }),
    (error) => error.code === 'EXTERNAL_RECEIPT_BINDING_MISMATCH');
});

test('the exact installed workflow compiler command is admitted and produces bound receipt evidence', () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-helper-producer-'));
  const helperRoot = path.join(repository, 'installed-skills', 'n8n-workflow-helper-scripts', 'templates', 'helper-scripts');
  const helperScript = path.join(helperRoot, 'sanitizer', 'prepare-n8n-template.js');
  fs.mkdirSync(path.dirname(helperScript), { recursive: true });
  fs.writeFileSync(helperScript, "'use strict';\n");
  fs.writeFileSync(path.join(repository, 'source.json'), '{"nodes":[],"connections":{}}\n');
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-helper-producer-state-'));
  const base = {
    session_id: 'helper-producer-session',
    cwd: repository,
    timestamp: '2026-07-23T00:00:00.000Z'
  };
  let ledger = n8n.createN8nCapabilityLedger({
    sessionId: base.session_id,
    repositoryIdentity: base.cwd,
    objective: 'Compile this n8n workflow JSON.',
    operation: 'workflow-compile',
    createdAt: base.timestamp
  });
  for (const capability of ledger.requiredCapabilities.filter((entry) => entry.kind === 'official-skill')) {
    ledger = record(ledger, capability.name).ledger;
  }
  n8n.writeTaskLedger(base, ledger, { stateRoot });
  const command = `node "${helperScript}" source.json output.json`;
  const toolUse = {
    ...base,
    tool_name: 'Bash',
    tool_input: { command }
  };
  const options = { router: n8n, stateRoot, toolkitHelperRoots: [helperRoot] };
  assert.deepEqual(hook.handle({ ...toolUse, hook_event_name: 'PreToolUse' }, options), {});
  const result = hook.handle({ ...toolUse, hook_event_name: 'PostToolUse' }, options);
  assert.match(result.hookSpecificOutput.additionalContext, /exact installed Toolkit helper bytes/);
  const completed = n8n.readTaskLedger(base, { stateRoot });
  assert.equal(n8n.auditN8nCompletion(completed).complete, true);
  assert.match(completed.requiredCapabilities.find((entry) =>
    entry.capabilityId === 'toolkit-helper:workflow-compile').evidence[0], /^receipt:toolkit-helper-workflow-compile-/);
  const arbitrary = {
    ...toolUse,
    tool_input: { command: 'node scripts/arbitrary-compiler.cjs source.json output.json' }
  };
  assert.equal(n8n.isCapabilityProducerToolUse(arbitrary, ledger, options), false);
});

test('Claude completion audit blocks an incomplete n8n task and reports one supported next action', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-completion-'));
  const input = { session_id: 'completion-session', cwd: 'C:/synthetic/repo', timestamp: '2026-07-23T00:00:00.000Z' };
  hook.handle({ ...input, hook_event_name: 'UserPromptSubmit', prompt: 'Review this n8n workflow.' }, { router: n8n, stateRoot });
  const completed = hook.handle({ ...input, hook_event_name: 'TaskCompleted' }, { router: n8n, stateRoot });
  assert.equal(completed.exitCode, 2);
  assert.equal(completed.toolkitCommandFailure, true);
  assert.match(completed.stderr, /cannot be declared complete/);
  assert.match(completed.stderr, /Invoke the official/);

  const hookPath = path.join(__dirname, '..', 'scripts', 'toolkit-claude-n8n-admission-hook.cjs');
  const emitted = require('node:child_process').spawnSync(process.execPath, ['-e', `require(${JSON.stringify(hookPath)}).emitHookResult({toolkitCommandFailure:true,exitCode:2,stderr:'synthetic completion denial'})`], { encoding: 'utf8' });
  assert.equal(emitted.status, 2);
  assert.match(emitted.stderr, /synthetic completion denial/);
  assert.equal(emitted.stdout, '');
});

test('Claude fallback blocks n8n Stop/completion when the admission router cannot be verified', () => {
  const decision = hook.fallbackDecision({
    hook_event_name: 'Stop',
    last_assistant_message: 'The n8n workflow JSON task is complete.'
  }, new Error('synthetic missing router'));
  assert.equal(decision.decision, 'block');
  assert.match(decision.reason, /missing toolkit:n8n-domain-router/);
  assert.match(decision.reason, /Restore the verified current Toolkit n8n domain router/);
  const completion = hook.fallbackDecision({ hook_event_name: 'TaskCompleted', task_subject: 'Complete n8n workflow JSON work.' }, new Error('private path must not appear'));
  assert.equal(completion.exitCode, 2);
  assert.match(completion.stderr, /missing toolkit:n8n-domain-router/);
  assert.doesNotMatch(JSON.stringify(completion), /private path/);
});

test('fallback denies governed events when an active ledger exists even without repeated n8n text', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-fallback-active-'));
  const input = { session_id: 'active-fallback', cwd: 'C:/synthetic/repo' };
  const ledgerFile = n8n.stateFileFor(input, { stateRoot });
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.writeFileSync(ledgerFile, '{invalid');
  const edit = hook.fallbackDecision({
    ...input, hook_event_name: 'PreToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'automation/config.json', old_string: 'a', new_string: 'b' }
  }, new Error('synthetic ledger error'), { router: n8n, stateRoot });
  assert.equal(edit.hookSpecificOutput.permissionDecision, 'deny');
  const mcp = hook.fallbackDecision({
    ...input, hook_event_name: 'PreToolUse', tool_name: 'mcp__n8n__update_workflow',
    tool_input: { workflowId: 'workflow-alias' }
  }, new Error('synthetic ledger error'), { router: n8n, stateRoot });
  assert.equal(mcp.hookSpecificOutput.permissionDecision, 'deny');
  const stop = hook.fallbackDecision({ ...input, hook_event_name: 'Stop', last_assistant_message: 'Done.' },
    new Error('synthetic ledger error'), { router: n8n, stateRoot });
  assert.equal(stop.decision, 'block');
});

test('task-local ledger is bound to one session and repository and records no private absolute source path', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-state-'));
  const binding = { session_id: 'bound-session', cwd: 'C:/synthetic/repo' };
  let ledger = materialLedger({ sessionId: binding.session_id, repositoryIdentity: binding.cwd });
  ledger = record(ledger, 'using-n8n-skills-official').ledger;
  n8n.writeTaskLedger(binding, ledger, { stateRoot });
  const stored = fs.readFileSync(n8n.stateFileFor(binding, { stateRoot }), 'utf8');
  assert.doesNotMatch(stored, /Users|\\synthetic\\repo|C:\\/i);
  const different = { session_id: 'different-session', cwd: binding.cwd };
  fs.copyFileSync(n8n.stateFileFor(binding, { stateRoot }), n8n.stateFileFor(different, { stateRoot }));
  assert.throws(() => n8n.readTaskLedger(different, { stateRoot }), (error) => error.code === 'N8N_LEDGER_BINDING_MISMATCH');
});

test('ledger locks preserve live owners, reclaim only proven-dead owners, and release by exact token', () => {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-lock-owner-'));
  const input = { session_id: 'lock-owner', cwd: 'C:/synthetic/repo' };
  const lockPath = `${n8n.stateFileFor(input, { stateRoot })}.lock`;
  const ownerPath = path.join(lockPath, 'owner.json');
  const firstRelease = n8n.acquireTaskLedgerLock(input, {
    stateRoot,
    lockOwnerToken: 'a'.repeat(32),
    now: Date.parse('2026-07-23T00:00:00.000Z')
  });
  fs.writeFileSync(ownerPath, JSON.stringify({
    schemaVersion: 1,
    token: 'b'.repeat(32),
    pid: process.pid,
    createdAt: '2026-07-23T00:00:00.000Z'
  }));
  firstRelease();
  assert.equal(fs.existsSync(lockPath), true);
  fs.unlinkSync(ownerPath);
  fs.rmdirSync(lockPath);

  fs.mkdirSync(lockPath);
  fs.writeFileSync(ownerPath, JSON.stringify({
    schemaVersion: 1,
    token: 'c'.repeat(32),
    pid: 424242,
    createdAt: '2026-07-23T00:00:00.000Z'
  }));
  assert.throws(() => n8n.acquireTaskLedgerLock(input, {
    stateRoot,
    now: Date.parse('2026-07-23T00:01:00.000Z'),
    isProcessAlive: () => true
  }), (error) => error.code === 'N8N_LEDGER_BUSY');
  const reclaimedRelease = n8n.acquireTaskLedgerLock(input, {
    stateRoot,
    lockOwnerToken: 'd'.repeat(32),
    now: Date.parse('2026-07-23T00:01:00.000Z'),
    isProcessAlive: () => false
  });
  const reclaimed = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  assert.equal(reclaimed.token, 'd'.repeat(32));
  reclaimedRelease();
  assert.equal(fs.existsSync(lockPath), false);

  fs.mkdirSync(lockPath);
  assert.throws(() => n8n.acquireTaskLedgerLock(input, {
    stateRoot,
    now: Date.now()
  }), (error) => error.code === 'N8N_LEDGER_BUSY');
  const staleTime = new Date(Date.now() - 60000);
  fs.utimesSync(lockPath, staleTime, staleTime);
  const ownerlessRelease = n8n.acquireTaskLedgerLock(input, {
    stateRoot,
    lockOwnerToken: 'e'.repeat(32),
    now: Date.now()
  });
  assert.equal(JSON.parse(fs.readFileSync(ownerPath, 'utf8')).token, 'e'.repeat(32));
  ownerlessRelease();

  fs.mkdirSync(lockPath);
  fs.writeFileSync(ownerPath, '{malformed');
  assert.throws(() => n8n.acquireTaskLedgerLock(input, {
    stateRoot,
    now: Date.now()
  }), (error) => error.code === 'N8N_LEDGER_BUSY');
  fs.utimesSync(ownerPath, staleTime, staleTime);
  fs.utimesSync(lockPath, staleTime, staleTime);
  const malformedRelease = n8n.acquireTaskLedgerLock(input, {
    stateRoot,
    lockOwnerToken: 'f'.repeat(32),
    now: Date.now()
  });
  assert.equal(JSON.parse(fs.readFileSync(ownerPath, 'utf8')).token, 'f'.repeat(32));
  malformedRelease();

  fs.mkdirSync(lockPath);
  fs.writeFileSync(ownerPath, JSON.stringify({ schemaVersion: 1, token: 'invalid' }));
  fs.utimesSync(ownerPath, staleTime, staleTime);
  fs.utimesSync(lockPath, staleTime, staleTime);
  const invalidOwnerRelease = n8n.acquireTaskLedgerLock(input, {
    stateRoot,
    lockOwnerToken: '1'.repeat(32),
    now: Date.now()
  });
  assert.equal(JSON.parse(fs.readFileSync(ownerPath, 'utf8')).token, '1'.repeat(32));
  invalidOwnerRelease();
});
