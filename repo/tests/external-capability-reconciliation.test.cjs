'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const router = require('../../skills/external-system-router/scripts/external-system-router.cjs');

function completeAnswers(bank, markerChange = 'add') {
  const answers = Object.fromEntries(bank.questions.map((question) => [question.id, `answer:${question.id}`]));
  answers.markerChange = markerChange;
  answers.browserFallbackAllowed = false;
  answers.targetRegistration = false;
  answers.credentialReference = 'credential-store://coolify/swooshz-production';
  return {
    schemaVersion: 'ai-agent-toolkit.external-reconciliation-answers.v1',
    questionBankDigest: bank.questionBankDigest,
    ownerApproved: true,
    ownerApprovalReference: 'issue-286-owner-approval',
    answers
  };
}

test('repository and intent reconciliation is progressive and does not install integrations generically', () => {
  const objective = [
    'Set up Hostinger VPS.',
    'Deploy through Coolify.',
    'Add Google login.',
    'Move this n8n workflow to production.',
    'Configure Cloudflare R2.',
    'Switch this work from Codex to Claude Code.'
  ].join(' ');
  const result = router.reconcileCapabilities({
    trigger: 'explicit-provider-intent',
    objective,
    repositoryEvidence: {
      files: [{ path: 'n8n-workflows/order.json', kind: 'workflow-json-structure', current: true }],
      n8nDesignIntent: true
    }
  });
  const keys = result.requirements.map((entry) => `${entry.provider}/${entry.capability}`);
  for (const expected of [
    'hostinger/vps-setup', 'coolify/application-deployment', 'google/oauth-login-setup',
    'n8n/live-workflow-transport', 'n8n/mandatory-domain-admission', 'n8n/official-skill-ledger',
    'cloudflare/r2-configuration', 'toolkit-host/host-switch-reconciliation',
    'n8n/canonical-n8n-workflows-folder-rules', 'n8n/n8n-workflow-helper-scripts', 'n8n/official-n8n-skills'
  ]) assert.ok(keys.includes(expected), expected);
  assert.equal(result.n8n.installMcp, false);
  assert.equal(result.genericSetupInstallsNothing, true);

  for (const trigger of router.RECONCILIATION_TRIGGERS) {
    const generic = router.reconcileCapabilities({ trigger, objective: 'Inspect repository requirements.', repositoryEvidence: { files: [] } });
    assert.equal(generic.genericSetupInstallsNothing, true, trigger);
    assert.deepEqual(generic.requirements, [], trigger);
  }
});

test('repository evidence does not invent provider ownership from generic deployment or storage compatibility files', () => {
  const result = router.reconcileCapabilities({
    trigger: 'repository-change',
    objective: 'Inspect repository requirements.',
    repositoryEvidence: {
      files: [
        { path: 'docker-compose.yml', kind: 'path-only' },
        { path: 'docs/s3-r2-compatible-storage.md', kind: 'sanitized-metadata', sanitizedText: 'S3-compatible storage provider is selected outside the repository.' }
      ]
    }
  });
  assert.equal(result.requirements.some((entry) => entry.provider === 'coolify'), false);
  assert.equal(result.requirements.some((entry) => entry.provider === 'cloudflare'), false);
  assert.equal(result.genericSetupInstallsNothing, true);
});

test('component-based n8n recommendations keep Skills, helpers, live transport, OAuth, and MCP separate', () => {
  const owner = router.recommendN8nComponents({ ownsWorkflowJson: true });
  assert.deepEqual(owner.recommendations, ['canonical-n8n-workflows-folder-rules', 'n8n-workflow-helper-scripts']);
  assert.equal(owner.installOfficialSkills, false);
  assert.equal(owner.installMcp, false);

  const design = router.recommendN8nComponents({ designsNodesOrExpressions: true });
  assert.ok(design.recommendations.includes('official-n8n-skills'));
  assert.equal(design.installOfficialSkills, true);
  assert.equal(design.installMcp, false);

  const live = router.recommendN8nComponents({ requiresLiveWorkflowOperations: true });
  assert.deepEqual(live.recommendations, ['operation-scoped-live-transport-audit']);
  assert.equal(live.liveTransportMustBeAuditedSeparately, true);
  assert.equal(live.installMcp, false);

  const oauth = router.recommendN8nComponents({ requiresCredentialOrOauthSetup: true });
  assert.deepEqual(oauth.recommendations, ['informed-browser-fallback-when-structured-setup-is-unsupported']);

  const webhook = router.recommendN8nComponents({ webhookOnlyConsumer: true });
  assert.deepEqual(webhook.recommendations, ['webhook-contract-only']);
  assert.equal(webhook.helpersSuppressedForWebhookOnly, true);
  assert.equal(webhook.addDynamicMarker, true);

  const historical = router.recommendN8nComponents({ historicalMentionOnly: true, markerPresent: true });
  assert.equal(historical.detected, false);
  assert.equal(historical.recommendOwnerApprovedMarkerRemoval, true);
  assert.deepEqual(historical.recommendations, []);
});

test('capability completion ledger requires every capability to be verified, deferred, or proven unnecessary', () => {
  const reconciliation = router.reconcileCapabilities({
    trigger: 'substantive-task',
    objective: 'Deploy through Coolify.',
    repositoryEvidence: { files: [] }
  });
  const pending = router.buildCapabilityLedger(reconciliation);
  assert.equal(pending.complete, false);
  const ledgerSchema = JSON.parse(require('node:fs').readFileSync(path.join(
    __dirname, '..', '..', '_projects', 'development', 'external-system-router', '_main', 'skill',
    'references', 'schemas', 'capability-ledger.schema.json'
  ), 'utf8'));
  assert.ok(ledgerSchema.required.includes('repositoryDigest'));
  assert.ok(ledgerSchema.required.includes('intentDigest'));
  assert.throws(() => router.assertObjectiveComplete(pending), (error) => error.code === 'EXTERNAL_CAPABILITY_LEDGER_INCOMPLETE');

  const [requirement] = reconciliation.requirements;
  const deferred = router.buildCapabilityLedger(reconciliation, {
    reconciliationDigest: reconciliation.reconciliationDigest,
    repositoryDigest: reconciliation.repositoryDigest,
    intentDigest: reconciliation.intentDigest,
    deferred: [{ provider: requirement.provider, capability: requirement.capability, blocker: 'Native UAT requires a separately approved live target.' }]
  });
  assert.equal(router.assertObjectiveComplete(deferred).complete, true);
  const changedIntent = router.reconcileCapabilities({
    trigger: 'substantive-task',
    objective: 'Deploy through Coolify to a different environment.',
    repositoryEvidence: { files: [] }
  });
  assert.throws(() => router.buildCapabilityLedger(changedIntent, {
    reconciliationDigest: reconciliation.reconciliationDigest,
    repositoryDigest: reconciliation.repositoryDigest,
    intentDigest: reconciliation.intentDigest,
    verified: [{
      provider: requirement.provider,
      capability: requirement.capability,
      verificationEvidence: 'receipt:prior-objective'
    }]
  }), (error) => error.code === 'EXTERNAL_RECONCILIATION_STATE_MISMATCH');

  const forged = structuredClone(pending);
  forged.capabilities[0].status = 'configured-and-verified';
  forged.complete = true;
  assert.throws(() => router.assertObjectiveComplete(forged), /verificationEvidence/);
});

test('dynamic n8n markers preserve unmarked content and require the complete owner-approved question bank', () => {
  const context = { repository: 'consumer', proposedChange: 'n8n-marker' };
  const bank = router.buildReconciliationQuestionBank(context);
  assert.equal(bank.questions.length, 20);
  const incomplete = completeAnswers(bank);
  delete incomplete.answers.verification;
  assert.throws(() => router.validateReconciliationAnswers(bank, incomplete), (error) => error.code === 'EXTERNAL_QUESTION_BANK_INCOMPLETE');

  const forgedBank = structuredClone(bank);
  forgedBank.questions = forgedBank.questions.slice(0, 1);
  forgedBank.questionBankDigest = router.sha256({
    schemaVersion: forgedBank.schemaVersion,
    contextDigest: forgedBank.contextDigest,
    questions: forgedBank.questions
  });
  assert.throws(
    () => router.validateReconciliationAnswers(forgedBank, completeAnswers(forgedBank)),
    (error) => error.code === 'EXTERNAL_QUESTION_BANK_MISMATCH'
  );

  const writeContext = { proposedWrite: { kind: 'target-registration', target: 'coolify-production' } };
  const writeBank = router.buildReconciliationQuestionBank(writeContext);
  assert.throws(() => router.assertWriteGate(writeBank, completeAnswers(writeBank), {
    ...writeContext.proposedWrite,
    context: writeContext
  }), (error) => error.code === 'EXTERNAL_WRITE_APPROVAL_REQUIRED');
  const approved = completeAnswers(writeBank);
  approved.answers.targetRegistration = true;
  assert.equal(router.assertWriteGate(writeBank, approved, {
    ...writeContext.proposedWrite,
    context: writeContext
  }).approved, true);
  assert.throws(() => router.assertWriteGate(writeBank, completeAnswers(writeBank), {
    kind: 'target-registration',
    target: 'another-target',
    context: writeContext
  }), (error) => error.code === 'EXTERNAL_WRITE_CONTEXT_MISMATCH');

  const unsafeCredentialContext = {
    proposedWrite: { kind: 'credential-reference', target: 'plain-text-credential-value' }
  };
  const unsafeCredentialBank = router.buildReconciliationQuestionBank(unsafeCredentialContext);
  const unsafeCredentialAnswers = completeAnswers(unsafeCredentialBank);
  unsafeCredentialAnswers.answers.credentialReference = unsafeCredentialContext.proposedWrite.target;
  assert.throws(() => router.assertWriteGate(unsafeCredentialBank, unsafeCredentialAnswers, {
    ...unsafeCredentialContext.proposedWrite,
    context: unsafeCredentialContext
  }), (error) => error.code === 'EXTERNAL_WRITE_APPROVAL_REQUIRED');
  const safeCredentialContext = {
    proposedWrite: { kind: 'credential-reference', target: 'os-keychain://coolify/production/operator' }
  };
  const safeCredentialBank = router.buildReconciliationQuestionBank(safeCredentialContext);
  const safeCredentialAnswers = completeAnswers(safeCredentialBank);
  safeCredentialAnswers.answers.credentialReference = safeCredentialContext.proposedWrite.target;
  assert.equal(router.assertWriteGate(safeCredentialBank, safeCredentialAnswers, {
    ...safeCredentialContext.proposedWrite,
    context: safeCredentialContext
  }).approved, true);

  const original = '# Project rules\n\nOwner content stays here.\n';
  const added = router.applyN8nMarkerChange(original, 'add', bank, completeAnswers(bank, 'add'));
  assert.match(added.content, /AI-AGENT-TOOLKIT:N8N:BEGIN/);
  assert.match(added.content, /fail-closed n8n domain router/);
  assert.match(added.content, /Owner content stays here/);
  assert.equal(router.inspectN8nMarker(added.content).state, 'dynamic-present');

  const removeBank = router.buildReconciliationQuestionBank({ repository: 'consumer', proposedChange: 'remove-n8n-marker' });
  const removed = router.applyN8nMarkerChange(added.content, 'remove', removeBank, completeAnswers(removeBank, 'remove'));
  assert.equal(removed.content, original);
});

test('unrecognized substantive external-system intent remains pending instead of completing with zero capabilities', () => {
  const reconciliation = router.reconcileCapabilities({
    trigger: 'explicit-provider-intent',
    objective: 'Deploy the application to AWS production.',
    repositoryEvidence: { files: [] }
  });
  assert.deepEqual(reconciliation.requirements.map((entry) => `${entry.provider}/${entry.capability}`), [
    'external-system/exact-provider-operation-classification'
  ]);
  const ledger = router.buildCapabilityLedger(reconciliation);
  assert.equal(ledger.complete, false);
  assert.throws(() => router.assertObjectiveComplete(ledger), (error) => error.code === 'EXTERNAL_CAPABILITY_LEDGER_INCOMPLETE');
});

test('mixed legacy and dynamic n8n marker families fail closed', () => {
  const mixed = `${router.N8N_DOMAIN_MARKERS.begin}\ncurrent\n${router.N8N_DOMAIN_MARKERS.end}\n`
    + '<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md:BEGIN N8N-AGENT-RULES-ADAPTER v1 -->\n'
    + 'legacy\n'
    + '<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md:END N8N-AGENT-RULES-ADAPTER -->\n';
  assert.throws(() => router.inspectN8nMarker(mixed), (error) => error.code === 'EXTERNAL_MARKER_MALFORMED');
});

function manifest(overrides = {}) {
  return {
    schemaVersion: router.CONSUMER_SCHEMA_VERSION,
    providers: [{
      provider: 'coolify',
      requiredCapabilities: ['application-deployment'],
      environmentAliases: ['production'],
      publicOrigins: ['https://www.example.com/'],
      contextualRiskOverrides: { 'deploy-revision': 2 },
      verification: ['Verify public health and exact revision.'],
      rollbackExpectations: ['Redeploy a verified previous revision.'],
      forbiddenOperations: ['delete-application'],
      browserFallbackAllowed: false,
      ...overrides
    }]
  };
}

test('consumer requirements accept public capabilities and reject private or secret material', () => {
  assert.equal(router.validateConsumerRequirements(manifest()).providers.length, 1);
  for (const [label, providerChange] of [
    ['token', { api_token: 'not-allowed' }],
    ['private origin', { publicOrigins: ['https://localhost/'] }],
    ['account id', { account_id: 'private-account' }],
    ['cookie', { cookie: 'session-value' }],
    ['connection string', { verification: ['postgresql://user:password@example.com/db'] }],
    ['embedded project id', { verification: ['Verify project_id: private-project-1234.'] }],
    ['embedded token', { verification: ['Verify token=private-token-value.'] }],
    ['private verification origin', { verification: ['Verify https://service.internal/.'] }],
    ['private customer data', { verification: ['Customer email is private.person@example.com and must be retained.'] }]
  ]) {
    assert.throws(() => router.validateConsumerRequirements(manifest(providerChange)), undefined, label);
  }
});

test('user-local state paths stay outside repositories and expose no secret values', () => {
  const paths = router.defaultLocalStatePaths();
  for (const value of Object.values(paths)) {
    assert.equal(path.isAbsolute(value), true);
    assert.equal(value.startsWith(process.cwd()), false);
  }
  assert.match(paths.n8nTaskLedgers.replace(/\\/g, '/'), /\.ai-agent-toolkit\/task-state\/n8n$/);
});
