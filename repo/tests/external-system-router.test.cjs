'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const router = require('../../skills/external-system-router/scripts/external-system-router.cjs');

function semanticsFor(operation, overrides = {}) {
  const readOnly = operation.startsWith('read-');
  const destructive = operation.startsWith('delete-');
  const value = {
    schemaVersion: router.OPERATION_SEMANTICS_SCHEMA_VERSION,
    operation,
    mutationClass: readOnly ? 'read-only' : 'mutation',
    destructive,
    irreversible: destructive,
    crossTarget: false,
    highBlastRadius: false,
    minimumRiskByEnvironment: {
      default: readOnly ? 0 : destructive ? 3 : 1,
      production: readOnly ? 0 : destructive ? 3 : 2
    },
    requiredPreconditions: readOnly ? [] : ['Exact target and authority are current.'],
    requiredPostconditions: readOnly ? [] : ['Verify the exact bounded result.'],
    rollbackOrSafeDisable: readOnly ? [] : ['Use the approved rollback or safe-disable path.'],
    receiptClass: readOnly ? 'inspection' : destructive ? 'destructive' : 'mutation',
    ...overrides
  };
  value.semanticsDigest = router.operationSemanticsDigest(value);
  return value;
}

function envelope(overrides = {}) {
  const value = {
    schemaVersion: router.ENVELOPE_SCHEMA_VERSION,
    provider: 'coolify',
    targetAlias: 'coolify-swooshz-production',
    accountOrOrganisation: 'swooshz',
    resource: 'spacekonceptrental',
    environment: 'production',
    objective: 'Deploy one exact reviewed revision.',
    allowedOperations: ['read-revision', 'deploy-revision', 'delete-application'],
    operationRiskTiers: { 'read-revision': 0, 'deploy-revision': 2, 'delete-application': 3 },
    operationSemanticsDigests: Object.fromEntries(
      ['read-revision', 'deploy-revision', 'delete-application'].map((operation) =>
        [operation, semanticsFor(operation).semanticsDigest])
    ),
    authorisedTier2Operations: ['deploy-revision'],
    forbiddenOperations: ['rotate-root-token'],
    expectedResult: 'The exact reviewed revision is healthy.',
    verification: ['Verify health and exact revision.'],
    rollbackOrSafeDisable: ['Redeploy the verified previous revision.'],
    lifetime: { kind: 'task' },
    ownerApprovalReference: 'issue-286-owner-approval',
    sensitiveDataClasses: ['deployment-metadata'],
    interfaceRestrictions: ['no-browser'],
    ...overrides
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'operationSemanticsDigests')) {
    value.operationSemanticsDigests = Object.fromEntries(value.allowedOperations.map((operation) =>
      [operation, semanticsFor(operation).semanticsDigest]));
  }
  if (value.lifetime.kind === 'task') {
    value.lifetime = {
      taskId: 'task-286',
      sessionFingerprint: router.sha256('session-286'),
      objectiveDigest: router.objectiveAuthorityDigest(value.objective),
      ...value.lifetime
    };
  }
  return value;
}

function operation(name, overrides = {}) {
  const semantics = semanticsFor(name);
  const value = {
    provider: 'coolify',
    targetAlias: 'coolify-swooshz-production',
    accountOrOrganisation: 'swooshz',
    resource: 'spacekonceptrental',
    environment: 'production',
    operation: name,
    operationSemanticsVersion: semantics.schemaVersion,
    operationSemanticsDigest: semantics.semanticsDigest,
    readOnly: semantics.mutationClass === 'read-only',
    sensitiveDataClasses: ['deployment-metadata'],
    ...overrides
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'taskId')) value.taskId = 'task-286';
  if (!Object.prototype.hasOwnProperty.call(overrides, 'sessionFingerprint')) value.sessionFingerprint = router.sha256('session-286');
  if (!Object.prototype.hasOwnProperty.call(overrides, 'objectiveDigest')) {
    value.objectiveDigest = router.objectiveAuthorityDigest('Deploy one exact reviewed revision.');
  }
  return value;
}

function audit(interfaceId, interfaceKind, assuranceScore, overrides = {}) {
  const operationName = overrides.operation || 'deploy-revision';
  const semantics = overrides.semantics || semanticsFor(operationName);
  const value = {
    schemaVersion: router.AUDIT_SCHEMA_VERSION,
    provider: 'coolify',
    targetAlias: 'coolify-swooshz-production',
    accountOrOrganisation: 'swooshz',
    environment: 'production',
    operation: operationName,
    interfaceId,
    interfaceKind,
    identity: `${interfaceId} reviewed identity`,
    version: '2026-07-23',
    availableOperations: [operationName],
    targetFingerprint: `sha256:${'f'.repeat(64)}`,
    inputSchemaDigest: `sha256:${'1'.repeat(64)}`,
    authScopeStatus: 'configured scope status; no values recorded',
    redaction: ['Allowlisted response fields only.'],
    retryIdempotency: 'No uncertain retry of non-idempotent writes.',
    preconditions: ['Exact reviewed revision is bound.'],
    postconditions: ['Exact revision and health are verified.'],
    rollback: ['Verified previous revision is retained.'],
    failureSemantics: ['Stable failure code; no guessed continuation.'],
    operationSemanticsVersion: semantics.schemaVersion,
    operationSemanticsDigest: semantics.semanticsDigest,
    capabilityDigest: `sha256:${'0'.repeat(64)}`,
    assuranceScore,
    readOnly: semantics.mutationClass === 'read-only',
    auditedAt: '2026-07-23T00:00:00.000Z',
    evidenceReferences: ['public-doc:coolify-api'],
    ...overrides
  };
  delete value.semantics;
  if (!Object.prototype.hasOwnProperty.call(overrides, 'targetBinding')) value.targetBinding = router.targetBindingDigest(value);
  value.capabilityDigest = router.capabilityAuditDigest(value);
  return value;
}

function currentTargetFor(audits, overrides = {}) {
  const entries = Array.isArray(audits) ? audits : [audits];
  const value = {
    provider: 'coolify',
    targetAlias: 'coolify-swooshz-production',
    accountOrOrganisation: 'swooshz',
    environment: 'production',
    sanitizedFingerprint: `sha256:${'f'.repeat(64)}`,
    inventoryGeneration: `sha256:${'9'.repeat(64)}`,
    privateOriginReference: 'local-registry://origins/coolify-swooshz-production',
    resourceReferences: ['one-application', 'spacekonceptrental'],
    credentialReferences: ['credential-store://coolify/swooshz-production'],
    installedInterfaces: [...new Set(entries.map((entry) => entry.interfaceId))],
    capabilityDigests: [...new Set(entries.map((entry) => entry.capabilityDigest))],
    operationSemantics: [...new Map(entries.map((entry) => [
      entry.operation,
      semanticsFor(entry.operation)
    ])).values()],
    routeSelections: Object.fromEntries(entries.map((entry) => [entry.operation, entry.interfaceId])),
    lastAuditState: 'current',
    receiptReferences: [],
    ...overrides
  };
  return value;
}

function inventorySource(audits, targetOverrides = {}, registryOverrides = {}) {
  const entries = Array.isArray(audits) ? audits : [audits];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'external-inventory-authority-'));
  const sourcePath = path.join(root, 'provider-target-registry.json');
  fs.writeFileSync(sourcePath, '{}\n');
  const identity = router.testInventoryAuthorityExpectations(sourcePath);
  const inventoryGeneration = targetOverrides.inventoryGeneration || `sha256:${'9'.repeat(64)}`;
  const target = currentTargetFor(entries, { inventoryGeneration, ...targetOverrides });
  const registry = {
    schemaVersion: router.REGISTRY_SCHEMA_VERSION,
    ...identity,
    inventoryGeneration,
    generationSequence: 1,
    generatedAt: '2026-07-24T00:00:00.000Z',
    targets: [target],
    ...registryOverrides
  };
  fs.writeFileSync(sourcePath, `${JSON.stringify(registry, null, 2)}\n`);
  return { root, sourcePath, registry, target };
}

function inventoryFixture(audits, targetOverrides = {}, registryOverrides = {}) {
  const source = inventorySource(audits, targetOverrides, registryOverrides);
  const authority = router.loadTrustedInventorySnapshot({
    testOnly: true,
    sourcePath: source.sourcePath
  });
  return { ...source, authority };
}

function bindCurrentInventory(context, target) {
  return {
    ...context,
    inventoryGeneration: target.inventoryGeneration,
    inventoryDigest: router.targetInventoryDigest(target)
  };
}

function authorize(authorisationEnvelope, operationContext, options = {}) {
  return router.assertOperationAuthorized(authorisationEnvelope, operationContext, {
    operationSemantics: semanticsFor(operationContext.operation),
    ...options
  });
}

test('risk tiers and one established envelope govern exact operations without per-call prompting', () => {
  assert.equal(router.classifyRisk(operation('read-revision'), semanticsFor('read-revision')), 0);
  assert.equal(router.classifyRisk(operation('update-setting', { environment: 'local' }), semanticsFor('update-setting')), 1);
  assert.equal(router.classifyRisk(operation('update-setting'), semanticsFor('update-setting')), 2);
  assert.equal(router.classifyRisk(operation('update-setting', { environment: 'uat' }), semanticsFor('update-setting')), 1);
  assert.equal(router.classifyRisk(operation('delete-setting'), semanticsFor('delete-setting')), 3);

  const read = authorize(envelope(), operation('read-revision'), { establishedTier: 2 });
  assert.deepEqual(read, { authorised: true, riskTier: 0, reuseWithoutPerCallPrompt: true });
  const deploy = authorize(envelope(), operation('deploy-revision'), { establishedTier: 2 });
  assert.equal(deploy.reuseWithoutPerCallPrompt, true);
  assert.equal(deploy.riskTier, 2);
  assert.throws(
    () => authorize(envelope(), operation('read-revision', { environment: 'staging' })),
    (error) => error.code === 'EXTERNAL_REAUTHORISATION_REQUIRED' && /environment/.test(error.message)
  );
  assert.throws(
    () => authorize(envelope(), operation('deploy-revision'), { establishedTier: 1 }),
    (error) => error.code === 'EXTERNAL_REAUTHORISATION_REQUIRED'
  );
  assert.throws(
    () => authorize(envelope(), operation('delete-application')),
    (error) => error.code === 'EXTERNAL_TIER3_APPROVAL_REQUIRED'
  );
  assert.throws(
    () => authorize(envelope(), operation('delete-application', { destructive: true, riskTier: 0 })),
    (error) => error.code === 'EXTERNAL_TIER3_APPROVAL_REQUIRED'
  );
  const destructiveEnvelope = envelope();
  const destructiveOperation = operation('delete-application', { destructive: true });
  const destructiveBinding = router.operationApprovalBinding(destructiveEnvelope, destructiveOperation);
  const immediateApproval = {
    ownerApproved: true,
    provider: destructiveOperation.provider,
    targetAlias: destructiveOperation.targetAlias,
    accountOrOrganisation: destructiveOperation.accountOrOrganisation,
    resource: destructiveOperation.resource,
    environment: destructiveOperation.environment,
    operation: destructiveOperation.operation,
    operationSemanticsVersion: destructiveOperation.operationSemanticsVersion,
    operationSemanticsDigest: destructiveOperation.operationSemanticsDigest,
    taskId: destructiveOperation.taskId,
    sessionFingerprint: destructiveOperation.sessionFingerprint,
    objectiveDigest: destructiveOperation.objectiveDigest,
    envelopeDigest: destructiveBinding.envelopeDigest,
    operationDigest: destructiveBinding.operationDigest,
    authorisationReference: 'immediate-owner-approval'
  };
  const destructive = authorize(
    destructiveEnvelope,
    destructiveOperation,
    { immediateApproval }
  );
  assert.equal(destructive.riskTier, 3);
  assert.equal(destructive.reuseWithoutPerCallPrompt, false);
  assert.throws(() => authorize(
    destructiveEnvelope,
    { ...destructiveOperation, resource: 'another-application' },
    { immediateApproval }
  ), (error) => error.code === 'EXTERNAL_REAUTHORISATION_REQUIRED');
  assert.throws(() => authorize(
    destructiveEnvelope,
    destructiveOperation,
    { immediateApproval: { ...immediateApproval, targetAlias: 'another-target' } }
  ), (error) => error.code === 'EXTERNAL_TIER3_APPROVAL_REQUIRED');

  const unfamiliarEnvelope = envelope({
    allowedOperations: ['update-setting'],
    operationRiskTiers: { 'update-setting': 2 },
    authorisedTier2Operations: ['update-setting'],
    forbiddenOperations: []
  });
  const unfamiliarProductionWrite = operation('update-setting', { riskTier: 0 });
  assert.equal(authorize(
    unfamiliarEnvelope,
    unfamiliarProductionWrite,
    { establishedTier: 2 }
  ).riskTier, 2);
  assert.throws(() => authorize(
    unfamiliarEnvelope,
    unfamiliarProductionWrite,
    { establishedTier: 1 }
  ), (error) => error.code === 'EXTERNAL_REAUTHORISATION_REQUIRED');
});

test('task lifetime authority rejects cross-task and changed-objective replay', () => {
  const approvedEnvelope = envelope();
  const approvedOperation = operation('read-revision', { readOnly: true });
  assert.equal(authorize(approvedEnvelope, approvedOperation).authorised, true);
  assert.throws(
    () => authorize(approvedEnvelope, { ...approvedOperation, taskId: 'task-later' }),
    (error) => error.code === 'EXTERNAL_TASK_AUTHORITY_MISMATCH'
  );
  assert.throws(
    () => authorize(approvedEnvelope, {
      ...approvedOperation,
      objectiveDigest: router.objectiveAuthorityDigest('A changed later objective.')
    }),
    (error) => error.code === 'EXTERNAL_TASK_AUTHORITY_MISMATCH'
  );
  assert.throws(
    () => router.validateAuthorizationEnvelope(envelope({
      objective: 'A changed later objective.',
      lifetime: {
        kind: 'task',
        taskId: 'task-286',
        sessionFingerprint: router.sha256('session-286'),
        objectiveDigest: router.objectiveAuthorityDigest('Deploy one exact reviewed revision.')
      }
    })),
    (error) => error.code === 'EXTERNAL_TASK_AUTHORITY_MISMATCH'
  );
});

function disclosure(overrides = {}) {
  return {
    goal: 'Configure one unsupported provider control.',
    capability: 'computer-use',
    provider: 'coolify',
    targetAlias: 'coolify-swooshz-production',
    operation: 'deploy-revision',
    browserProfileOrApplication: 'Dedicated provider browser profile',
    origin: 'https://console.example.com',
    accountOrOrganisation: 'swooshz',
    project: 'spacekonceptrental',
    environment: 'production',
    resource: 'one-application',
    structuredInterfacesInsufficientReason: 'The reviewed structured interfaces do not expose this exact control.',
    mayRead: ['The named application settings page.'],
    mayClick: ['The one named setting.'],
    mayType: ['One non-secret reviewed value.'],
    mayUpload: ['none'],
    mayDownload: ['none'],
    mayChange: ['One named setting.'],
    mayEncounter: {
      credentials: true,
      cookies: true,
      browserHistory: false,
      downloads: false,
      clipboard: false,
      customerOrPrivateData: true,
      unrelatedWindows: false
    },
    exposureRisks: ['Authentication state and private project metadata may be visible.'],
    forbiddenScope: ['No account, credential, unrelated project, history, or customer-payload access.'],
    expectedResult: 'The one named setting is configured.',
    verification: ['Re-read only the named setting.'],
    rollbackOrSafeDisable: ['Restore the recorded prior setting.'],
    ...overrides
  };
}

test('all graphical capabilities require complete informed disclosure and owner approval distinct from popups', () => {
  const value = disclosure();
  router.validateGraphicalDisclosure(value);
  const question = router.renderGraphicalApprovalQuestion(value);
  assert.match(question, /^\*\*Do you approve/);
  assert.match(question, /\?\*\*$/);
  assert.throws(
    () => router.validateGraphicalDisclosure(disclosure({ mayEncounter: { credentials: true } })),
    /must explicitly be true or false/
  );
  assert.throws(
    () => router.validateGraphicalDisclosure(disclosure({ origin: 'https://service.internal/' })),
    (error) => error.code === 'EXTERNAL_PRIVATE_ORIGIN_REJECTED'
  );
  assert.throws(
    () => router.bindGraphicalApproval(value, { ownerApproved: true, source: 'operating-system-popup', authorisationReference: 'popup', disclosureDigest: router.sha256(value) }),
    (error) => error.code === 'EXTERNAL_GRAPHICAL_POPUP_NOT_APPROVAL'
  );
  assert.equal(router.bindGraphicalApproval(value, {
    ownerApproved: true,
    source: 'owner',
    authorisationReference: 'owner-approved-disclosure',
    disclosureDigest: router.sha256(value)
  }).oneDeclaredEnvelopeOnly, true);
});

test('authorization envelopes reject secret, protected identifier, and private-path material before CLI echo', () => {
  for (const unsafe of [
    { objective: `Use Bearer ${'x'.repeat(20)} for the deployment.` },
    { verification: ['Read C:\\Users\\private-user\\secrets.txt.'] },
    { expectedResult: 'project_id=customer-1234 is active.' }
  ]) {
    assert.throws(() => router.validateAuthorizationEnvelope(envelope(unsafe)), (error) =>
      ['EXTERNAL_SECRET_REJECTED', 'EXTERNAL_PRIVATE_DATA_REJECTED'].includes(error.code));
  }
});

test('authorization schema and runtime use the exact same alias contract including colons', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(
    __dirname, '..', '..', '_projects', 'development', 'external-system-router', '_main', 'skill',
    'references', 'schemas', 'authorization-envelope.schema.json'
  ), 'utf8'));
  assert.equal(schema.$defs.alias.pattern, router.ALIAS_PATTERN_SOURCE);
  assert.equal(schema.$defs.operations.items.$ref, '#/$defs/alias');
  assert.equal(schema.properties.interfaceRestrictions.items.pattern, router.INTERFACE_RESTRICTION_PATTERN_SOURCE);
  const auditSchema = JSON.parse(fs.readFileSync(path.join(
    __dirname, '..', '..', '_projects', 'development', 'external-system-router', '_main', 'skill',
    'references', 'schemas', 'capability-audit.schema.json'
  ), 'utf8'));
  assert.ok(auditSchema.required.includes('accountOrOrganisation'));
  const registrySchema = JSON.parse(fs.readFileSync(path.join(
    __dirname, '..', '..', '_projects', 'development', 'external-system-router', '_main', 'skill',
    'references', 'schemas', 'provider-target-registry.schema.json'
  ), 'utf8'));
  assert.ok(registrySchema.properties.targets.items.required.includes('accountOrOrganisation'));
  const semanticsSchema = JSON.parse(fs.readFileSync(path.join(
    __dirname, '..', '..', '_projects', 'development', 'external-system-router', '_main', 'skill',
    'references', 'schemas', 'operation-semantics.schema.json'
  ), 'utf8'));
  const mutationRule = semanticsSchema.allOf.find((rule) =>
    rule.if?.properties?.mutationClass?.const === 'mutation');
  assert.equal(mutationRule.then.properties.requiredPreconditions.minItems, 1);
  assert.equal(mutationRule.then.properties.requiredPostconditions.minItems, 1);
  assert.equal(mutationRule.then.properties.rollbackOrSafeDisable.minItems, 1);
  assert.throws(() => router.validateOperationSemantics(semanticsFor('invalid-destructive-receipt', {
    receiptClass: 'destructive'
  })), (error) => error.code === 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
  assert.doesNotThrow(() => router.validateAuthorizationEnvelope(envelope({
    targetAlias: 'team:production',
    allowedOperations: ['read:revision'],
    operationRiskTiers: { 'read:revision': 0 },
    authorisedTier2Operations: [],
    forbiddenOperations: ['write:revision']
  })));
  assert.throws(() => router.validateAuthorizationEnvelope(envelope({
    interfaceRestrictions: ['browser-if-possible']
  })), /interfaceRestrictions/);
});

test('standalone AI coding rules explicitly declare the external-system-router runtime dependency', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'ai-coding-agent-rules', 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'ai-coding-agent-rules', 'README.md'), 'utf8');
  for (const text of [skill, readme]) {
    assert.match(text, /external-system-router/);
    assert.match(text, /standalone/i);
    assert.match(text, /fail closed/i);
  }
  const dependencies = JSON.parse(fs.readFileSync(path.join(
    __dirname, '..', '..', 'skills', 'ai-coding-agent-rules', 'runtime-dependencies.json'
  ), 'utf8'));
  assert.equal(dependencies.schemaVersion, 'ai-agent-toolkit.skill-runtime-dependencies.v1');
  const externalRouter = dependencies.dependencies.find((entry) => entry.id === 'external-system-router');
  assert.equal(externalRouter.compatibleVersion, '1.0.8');
  assert.equal(externalRouter.installUnit, 'complete-skill-folder');
  assert.equal(externalRouter.unavailableBehavior, 'fail-closed');
  for (const required of [
    'SKILL.md',
    'scripts/external-system-router.cjs',
    'scripts/n8n-domain-router.cjs',
    'references/schemas/authorization-envelope.schema.json',
    'references/schemas/operation-receipt.schema.json'
  ]) assert.ok(externalRouter.requiredFiles.includes(required), required);
});

function historyRequest() {
  const saferPaths = Object.fromEntries(router.HISTORY_SAFER_PATHS.map((name) => [name, {
    attempted: true,
    failedReason: `${name} did not identify the approved origin.`
  }]));
  const base = {
    reason: 'The owner cannot provide the URL and every safer discovery source failed.',
    browser: 'Chrome',
    profile: 'dedicated-provider-profile',
    domains: ['example.com'],
    startTime: '2026-07-22T00:00:00.000Z',
    endTime: '2026-07-23T00:00:00.000Z',
    unrelatedExposure: ['Unrelated example.com page titles may appear.'],
    stopCondition: 'Stop immediately when the exact target URL is found.',
    saferPaths
  };
  return {
    ...base,
    ownerApproval: {
      ownerApproved: true,
      source: 'owner',
      authorisationReference: 'owner-history-approval',
      requestDigest: router.sha256({ ...base, ownerApproval: undefined, targetFound: undefined })
    }
  };
}

test('browser history is bounded, last-resort, explicitly approved, and stops when found', () => {
  const request = historyRequest();
  assert.equal(router.validateHistoryDiscovery(request).authorised, true);
  const missingAttempt = historyRequest();
  missingAttempt.saferPaths['ask-owner-for-url'].attempted = false;
  assert.throws(() => router.validateHistoryDiscovery(missingAttempt), (error) => error.code === 'EXTERNAL_HISTORY_NOT_LAST_RESORT');
  const found = historyRequest();
  found.targetFound = true;
  found.ownerApproval.requestDigest = router.sha256({ ...found, ownerApproval: undefined, targetFound: undefined });
  const result = router.validateHistoryDiscovery(found);
  assert.equal(result.authorised, false);
  assert.equal(result.stopImmediately, true);
  const broad = historyRequest();
  broad.startTime = '2026-05-01T00:00:00.000Z';
  broad.ownerApproval.requestDigest = router.sha256({ ...broad, ownerApproval: undefined, targetFound: undefined });
  assert.throws(() => router.validateHistoryDiscovery(broad), /at most 31 days/);
});

test('operation-specific assurance selects structured routes without a global MCP priority', () => {
  const api = audit('coolify-api', 'api', 80);
  const readOnlyMcp = audit('coolify-mcp', 'mcp', 99, { readOnly: true });
  const browser = audit('coolify-browser', 'browser', 100);
  const typedMcp = audit('typed-coolify-mcp', 'mcp', 95);
  const wrongOperation = audit('wrong-operation-mcp', 'mcp', 100, { operation: 'read-revision', availableOperations: ['read-revision'] });
  const fixture = inventoryFixture([api, browser, typedMcp, wrongOperation]);
  const currentTarget = fixture.target;
  const context = bindCurrentInventory({
    ...operation('deploy-revision'),
    resource: 'one-application', targetFingerprint: `sha256:${'f'.repeat(64)}`,
  }, currentTarget);
  const routeEnvelope = envelope({
    resource: 'one-application',
    interfaceRestrictions: [],
    ownerApprovalReference: 'owner-approved-disclosure'
  });
  const graphicalDisclosure = disclosure();
  const graphicalApproval = router.bindGraphicalApproval(disclosure(), {
    ownerApproved: true,
    source: 'owner',
    authorisationReference: 'owner-approved-disclosure',
    disclosureDigest: router.sha256(disclosure())
  });
  const options = {
    authorizationEnvelope: routeEnvelope,
    graphicalApproval,
    graphicalDisclosure,
    inventoryAuthority: fixture.authority
  };
  const apiSelected = router.selectStrongestAdmissibleInterface(context, [browser, api], options);
  assert.equal(apiSelected.selectedInterface, 'coolify-api');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [readOnlyMcp, api], options),
    (error) => error.code === 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');

  assert.equal(router.selectStrongestAdmissibleInterface(context, [api, typedMcp], options).selectedInterface, 'typed-coolify-mcp');
  assert.equal(router.selectStrongestAdmissibleInterface(context, [browser, api], options).selectedInterface, 'coolify-api');
  const operationScoped = router.selectStrongestAdmissibleInterface(context, [wrongOperation, api], options);
  assert.equal(operationScoped.selectedInterface, 'coolify-api');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [wrongOperation], options), (error) => error.code === 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [
    audit('wrong-target', 'api', 100, { targetBinding: router.sha256({ provider: 'coolify', targetAlias: 'staging', environment: 'production', targetFingerprint: `sha256:${'f'.repeat(64)}` }) })
  ], options), (error) => error.code === 'EXTERNAL_AUDIT_TARGET_MISMATCH');
  assert.throws(() => router.selectStrongestAdmissibleInterface(
    { ...context, targetFingerprint: `sha256:${'e'.repeat(64)}` }, [api], options
  ), (error) => error.code === 'EXTERNAL_STALE_TARGET_INVENTORY');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [browser], {
    authorizationEnvelope: routeEnvelope,
    inventoryAuthority: fixture.authority,
    graphicalApprovalValid: true
  }),
    (error) => error.code === 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [browser], {
    ...options,
    graphicalApproval: { ...graphicalApproval, resource: 'different-resource' }
  }), (error) => error.code === 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [browser], {
    ...options,
    authorizationEnvelope: envelope({
      resource: 'one-application',
      interfaceRestrictions: ['forbid-browser'],
      ownerApprovalReference: 'owner-approved-disclosure'
    })
  }), (error) => error.code === 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
  assert.throws(() => router.selectStrongestAdmissibleInterface(
    { ...context, accountOrOrganisation: 'different-account' }, [api], options
  ), (error) => error.code === 'EXTERNAL_STALE_TARGET_INVENTORY');
  const wrongAccountAudit = audit('wrong-account-api', 'api', 81, { accountOrOrganisation: 'different-account' });
  assert.throws(() => router.selectStrongestAdmissibleInterface(
    context, [wrongAccountAudit], options
  ), (error) => error.code === 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [api], {
    ...options,
    now: Date.parse('2026-07-23T01:00:00.000Z'),
    authorizationEnvelope: envelope({
      resource: 'one-application',
      lifetime: { kind: 'time-bounded', expiresAt: '2026-07-23T00:00:00.000Z' },
      interfaceRestrictions: []
    })
  }), (error) => error.code === 'EXTERNAL_REAUTHORISATION_REQUIRED');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [api], {
    ...options,
    authorizationEnvelope: envelope({
      resource: 'one-application',
      operationRiskTiers: { 'read-revision': 0, 'deploy-revision': 0, 'delete-application': 3 },
      authorisedTier2Operations: [],
      interfaceRestrictions: []
    })
  }), (error) => error.code === 'EXTERNAL_TIER2_APPROVAL_REQUIRED');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [browser], {
    ...options,
    graphicalDisclosure: disclosure({ mayClick: ['A different control.'] })
  }), (error) => error.code === 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [browser], {
    ...options,
    authorizationEnvelope: envelope({
      resource: 'one-application',
      interfaceRestrictions: ['no-browser'],
      ownerApprovalReference: 'owner-approved-disclosure'
    })
  }), (error) => error.code === 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
  assert.equal(router.selectStrongestAdmissibleInterface(context, [api, typedMcp], {
    ...options,
    authorizationEnvelope: envelope({
      resource: 'one-application',
      interfaceRestrictions: ['require:api'],
      ownerApprovalReference: 'owner-approved-disclosure'
    })
  }).selectedInterface, 'coolify-api');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [api]), /authorisation envelope/i);
});

test('final route selection requires the exact current target inventory generation', () => {
  const api = audit('coolify-api', 'api', 80);
  const browser = audit('coolify-browser', 'browser', 90);
  const fixture = inventoryFixture([api, browser]);
  const currentTarget = fixture.target;
  const context = bindCurrentInventory({
    ...operation('deploy-revision'),
    resource: 'one-application',
    targetFingerprint: api.targetFingerprint
  }, currentTarget);
  const routeEnvelope = envelope({ resource: 'one-application', interfaceRestrictions: [] });
  const selected = router.selectStrongestAdmissibleInterface(context, [api], {
    authorizationEnvelope: routeEnvelope,
    inventoryAuthority: fixture.authority
  });
  assert.equal(selected.selectedInterface, api.interfaceId);

  for (const targetOverrides of [
    { installedInterfaces: [browser.interfaceId] },
    { capabilityDigests: [browser.capabilityDigest] }
  ]) {
    const staleFixture = inventoryFixture([api, browser], targetOverrides);
    const staleContext = bindCurrentInventory(context, staleFixture.target);
    assert.throws(() => router.selectStrongestAdmissibleInterface(staleContext, [api], {
      authorizationEnvelope: routeEnvelope,
      inventoryAuthority: staleFixture.authority
    }), (error) => error.code === 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
  }

  const selector = {
    provider: 'coolify',
    targetAlias: currentTarget.targetAlias,
    environment: currentTarget.environment
  };
  const plan = router.buildHostAdapterPlan(fixture.authority, selector, 'codex', [api, browser]);
  assert.equal(router.selectStrongestAdmissibleInterface(context, [api], {
    authorizationEnvelope: routeEnvelope,
    hostAdapterPlan: plan
  }).selectedInterface, api.interfaceId);
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [api], {
    authorizationEnvelope: routeEnvelope,
    hostAdapterPlan: {
      ...plan,
      credentialReferences: ['credential-store://coolify/another-target']
    }
  }), (error) => error.code === 'EXTERNAL_CURRENT_INVENTORY_REQUIRED');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [api], {
    authorizationEnvelope: routeEnvelope,
    hostAdapterPlan: {
      ...plan,
      inventoryGeneration: `sha256:${'7'.repeat(64)}`,
      planDigest: router.hostAdapterPlanDigest({
        ...plan,
        inventoryGeneration: `sha256:${'7'.repeat(64)}`
      })
    }
  }), (error) => error.code === 'EXTERNAL_CURRENT_INVENTORY_REQUIRED');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [api], {
    authorizationEnvelope: routeEnvelope,
    targetRegistryRecord: currentTarget
  }), (error) => error.code === 'EXTERNAL_INVENTORY_AUTHORITY_REQUIRED');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [browser], {
    authorizationEnvelope: routeEnvelope,
    graphicalDisclosure: disclosure(),
    graphicalApproval: router.bindGraphicalApproval(disclosure(), {
      ownerApproved: true,
      source: 'owner',
      authorisationReference: routeEnvelope.ownerApprovalReference,
      disclosureDigest: router.sha256(disclosure())
    })
  }), (error) => error.code === 'EXTERNAL_CURRENT_INVENTORY_REQUIRED');
});

test('canonical mutability rejects every context, audit, inventory, and semantics disagreement', () => {
  const writeAudit = audit('provider-api', 'api', 90);
  const fixture = inventoryFixture(writeAudit);
  const context = bindCurrentInventory({
    ...operation('deploy-revision'),
    resource: 'one-application',
    targetFingerprint: writeAudit.targetFingerprint
  }, fixture.target);
  const routeEnvelope = envelope({ resource: 'one-application', interfaceRestrictions: [] });
  const options = { authorizationEnvelope: routeEnvelope, inventoryAuthority: fixture.authority };

  assert.throws(() => router.selectStrongestAdmissibleInterface(
    { ...context, readOnly: true }, [writeAudit], options
  ), (error) => error.code === 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');

  const auditClaimsReadOnly = {
    ...writeAudit,
    readOnly: true,
    capabilityDigest: `sha256:${'0'.repeat(64)}`
  };
  auditClaimsReadOnly.capabilityDigest = router.capabilityAuditDigest(auditClaimsReadOnly);
  assert.throws(() => router.selectStrongestAdmissibleInterface(
    context, [auditClaimsReadOnly], options
  ), (error) => error.code === 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');

  const readAuditClaimsWrite = audit('provider-read-api', 'api', 80, {
    operation: 'read-revision',
    readOnly: false
  });
  const readFixture = inventoryFixture(readAuditClaimsWrite, {
    operationSemantics: [semanticsFor('read-revision')]
  });
  const readContext = bindCurrentInventory({
    ...operation('read-revision', { readOnly: false }),
    resource: 'one-application',
    targetFingerprint: readAuditClaimsWrite.targetFingerprint
  }, readFixture.target);
  assert.throws(() => router.selectStrongestAdmissibleInterface(
    readContext,
    [readAuditClaimsWrite],
    {
      authorizationEnvelope: envelope({
        resource: 'one-application',
        allowedOperations: ['read-revision'],
        operationRiskTiers: { 'read-revision': 0 },
        authorisedTier2Operations: [],
        forbiddenOperations: []
      }),
      inventoryAuthority: readFixture.authority
    }
  ), (error) => error.code === 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');

  assert.throws(() => router.selectStrongestAdmissibleInterface(
    {
      ...context,
      operation: 'unregistered-operation',
      operationSemanticsVersion: router.OPERATION_SEMANTICS_SCHEMA_VERSION,
      operationSemanticsDigest: semanticsFor('unregistered-operation').semanticsDigest
    },
    [writeAudit],
    options
  ), (error) => error.code === 'EXTERNAL_UNKNOWN_OPERATION');
  assert.throws(() => router.selectStrongestAdmissibleInterface(
    { ...context, operationSemanticsVersion: 'ai-agent-toolkit.operation-semantics.v0' },
    [writeAudit],
    options
  ), (error) => error.code === 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');

  const forgedRouteShape = {
    ...router.selectStrongestAdmissibleInterface(context, [writeAudit], options),
    selectedAuditReadOnly: true,
    mutationClass: 'read-only',
    receiptClass: 'inspection'
  };
  assert.throws(() => router.createOperationReceipt({
    operationId: 'forged-read-only-receipt',
    ...context,
    adapter: 'provider-api',
    authorisationReference: routeEnvelope.ownerApprovalReference,
    authorisationEnvelope: routeEnvelope,
    selectedRoute: forgedRouteShape,
    precondition: 'passed',
    preconditionEvidence: ['test:precondition'],
    mutationAttempted: false,
    mutationPerformed: false,
    postcondition: 'not-applicable',
    postconditionEvidence: ['test:postcondition'],
    rollbackAttempted: false,
    rollbackPerformed: false,
    rollbackEvidence: ['test:rollback'],
    stableCode: 'EXTERNAL_FORGED_RECEIPT',
    safeEvidenceReferences: ['test:forged'],
    supportedNextAction: 'Stop.',
    unchangedScope: ['No mutation occurred.']
  }), (error) => error.code === 'EXTERNAL_ROUTE_AUTHORITY_REQUIRED');
});

test('canonical mutability is identical across structured route kinds', () => {
  for (const interfaceKind of ['api', 'cli', 'plugin', 'direct-protocol', 'mcp']) {
    const interfaceAudit = audit(`provider-${interfaceKind}`, interfaceKind, 80);
    const fixture = inventoryFixture(interfaceAudit);
    const context = bindCurrentInventory({
      ...operation('deploy-revision'),
      resource: 'one-application',
      targetFingerprint: interfaceAudit.targetFingerprint
    }, fixture.target);
    const selected = router.selectStrongestAdmissibleInterface(context, [interfaceAudit], {
      authorizationEnvelope: envelope({ resource: 'one-application', interfaceRestrictions: [] }),
      inventoryAuthority: fixture.authority
    });
    assert.equal(selected.interfaceKind, interfaceKind);
    assert.equal(selected.mutationClass, 'mutation');
    assert.equal(selected.finalRiskTier, 2);
    assert.equal(selected.selectedAuditReadOnly, false);
  }
  const browserAudit = audit('provider-browser', 'browser', 80);
  const browserFixture = inventoryFixture(browserAudit);
  const browserContext = bindCurrentInventory({
    ...operation('deploy-revision'),
    resource: 'one-application',
    targetFingerprint: browserAudit.targetFingerprint
  }, browserFixture.target);
  const browserEnvelope = envelope({
    resource: 'one-application',
    interfaceRestrictions: [],
    ownerApprovalReference: 'owner-approved-disclosure'
  });
  const browserDisclosure = disclosure();
  const browserApproval = router.bindGraphicalApproval(browserDisclosure, {
    ownerApproved: true,
    source: 'owner',
    authorisationReference: browserEnvelope.ownerApprovalReference,
    disclosureDigest: router.sha256(browserDisclosure)
  });
  assert.equal(router.selectStrongestAdmissibleInterface(browserContext, [browserAudit], {
    authorizationEnvelope: browserEnvelope,
    inventoryAuthority: browserFixture.authority,
    graphicalDisclosure: browserDisclosure,
    graphicalApproval: browserApproval
  }).interfaceKind, 'browser');
});

test('read-only production inspection remains Tier 0 and cannot record mutation activity', () => {
  const readAudit = audit('provider-read-api', 'api', 80, { operation: 'read-revision' });
  const fixture = inventoryFixture(readAudit);
  const context = bindCurrentInventory({
    ...operation('read-revision'),
    resource: 'one-application',
    targetFingerprint: readAudit.targetFingerprint
  }, fixture.target);
  const routeEnvelope = envelope({
    resource: 'one-application',
    allowedOperations: ['read-revision'],
    operationRiskTiers: { 'read-revision': 0 },
    authorisedTier2Operations: [],
    forbiddenOperations: [],
    interfaceRestrictions: []
  });
  const route = router.selectStrongestAdmissibleInterface(context, [readAudit], {
    authorizationEnvelope: routeEnvelope,
    inventoryAuthority: fixture.authority
  });
  assert.equal(route.finalRiskTier, 0);
  assert.equal(route.mutationClass, 'read-only');
  const receiptInput = {
    operationId: 'read-production',
    ...context,
    adapter: 'provider-read-api',
    authorisationReference: routeEnvelope.ownerApprovalReference,
    authorisationEnvelope: routeEnvelope,
    selectedRoute: route,
    precondition: 'passed',
    preconditionEvidence: ['test:precondition'],
    mutationAttempted: false,
    mutationPerformed: false,
    postcondition: 'passed',
    postconditionEvidence: ['test:postcondition'],
    rollbackAttempted: false,
    rollbackPerformed: false,
    rollbackEvidence: ['test:rollback-not-applicable'],
    stableCode: 'EXTERNAL_READ_COMPLETE',
    safeEvidenceReferences: ['test:read'],
    supportedNextAction: 'Continue only within the same task authority.',
    unchangedScope: ['No mutation occurred.']
  };
  const receipt = router.createOperationReceipt(receiptInput);
  assert.equal(receipt.receiptClass, 'inspection');
  assert.equal(receipt.riskTier, 0);
  assert.throws(() => router.createOperationReceipt({
    ...receiptInput,
    mutationAttempted: true
  }), (error) => error.code === 'EXTERNAL_OPERATION_SEMANTICS_MISMATCH');
});

test('trusted inventory loader rejects forged, copied, stale, replaced, and cross-installation authority', (t) => {
  const api = audit('provider-api', 'api', 90);
  const valid = inventoryFixture(api);
  const context = bindCurrentInventory({
    ...operation('deploy-revision'),
    resource: 'one-application',
    targetFingerprint: api.targetFingerprint
  }, valid.target);
  const routeEnvelope = envelope({ resource: 'one-application', interfaceRestrictions: [] });

  const forgedRecord = structuredClone(valid.target);
  forgedRecord.installedInterfaces = ['forged-api'];
  forgedRecord.capabilityDigests = [api.capabilityDigest];
  const forgedContext = bindCurrentInventory(context, forgedRecord);
  assert.throws(() => router.selectStrongestAdmissibleInterface(forgedContext, [api], {
    authorizationEnvelope: routeEnvelope,
    targetRegistryRecord: forgedRecord
  }), (error) => error.code === 'EXTERNAL_INVENTORY_AUTHORITY_REQUIRED');

  const plan = router.buildHostAdapterPlan(valid.authority, {
    provider: 'coolify',
    targetAlias: valid.target.targetAlias,
    environment: valid.target.environment
  }, 'codex', [api]);
  const forgedPlan = { ...plan };
  forgedPlan.planDigest = router.hostAdapterPlanDigest(forgedPlan);
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [api], {
    authorizationEnvelope: routeEnvelope,
    hostAdapterPlan: forgedPlan
  }), (error) => error.code === 'EXTERNAL_CURRENT_INVENTORY_REQUIRED');

  const copiedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'external-inventory-copy-'));
  const copiedPath = path.join(copiedRoot, 'provider-target-registry.json');
  fs.copyFileSync(valid.sourcePath, copiedPath);
  assert.throws(() => router.loadTrustedInventorySnapshot({ testOnly: true, sourcePath: copiedPath }),
    (error) => error.code === 'EXTERNAL_INVENTORY_AUTHORITY_MISMATCH');

  for (const field of ['routerVersion', 'routerSourceDigest', 'installationIdentity', 'repositoryIdentity', 'hostIdentity']) {
    const source = inventorySource(api, {}, {
      [field]: field === 'routerVersion' ? '0.0.0' : `sha256:${'e'.repeat(64)}`
    });
    assert.throws(() => router.loadTrustedInventorySnapshot({
      testOnly: true,
      sourcePath: source.sourcePath
    }), (error) => error.code === 'EXTERNAL_INVENTORY_AUTHORITY_MISMATCH');
  }

  fs.writeFileSync(valid.sourcePath, `${JSON.stringify({
    ...valid.registry,
    generationSequence: valid.registry.generationSequence + 1
  }, null, 2)}\n`);
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [api], {
    authorizationEnvelope: routeEnvelope,
    inventoryAuthority: valid.authority
  }), (error) => error.code === 'EXTERNAL_INVENTORY_SOURCE_CHANGED');

  const replaced = inventoryFixture(api);
  const identicalBytes = fs.readFileSync(replaced.sourcePath);
  fs.unlinkSync(replaced.sourcePath);
  fs.writeFileSync(replaced.sourcePath, identicalBytes);
  assert.throws(() => router.selectStrongestAdmissibleInterface(
    bindCurrentInventory(context, replaced.target),
    [api],
    { authorizationEnvelope: routeEnvelope, inventoryAuthority: replaced.authority }
  ), (error) => error.code === 'EXTERNAL_INVENTORY_SOURCE_CHANGED');

  const rollback = inventorySource(api, {}, { generationSequence: 2 });
  router.loadTrustedInventorySnapshot({ testOnly: true, sourcePath: rollback.sourcePath });
  fs.writeFileSync(rollback.sourcePath, `${JSON.stringify({
    ...rollback.registry,
    generationSequence: 1
  }, null, 2)}\n`);
  assert.throws(() => router.loadTrustedInventorySnapshot({
    testOnly: true,
    sourcePath: rollback.sourcePath
  }), (error) => error.code === 'EXTERNAL_INVENTORY_GENERATION_ROLLBACK');

  const sameGeneration = inventorySource(api);
  router.loadTrustedInventorySnapshot({ testOnly: true, sourcePath: sameGeneration.sourcePath });
  fs.writeFileSync(sameGeneration.sourcePath, `${JSON.stringify({
    ...sameGeneration.registry,
    generatedAt: '2026-07-24T00:00:01.000Z'
  }, null, 2)}\n`);
  assert.throws(() => router.loadTrustedInventorySnapshot({
    testOnly: true,
    sourcePath: sameGeneration.sourcePath
  }), (error) => error.code === 'EXTERNAL_INVENTORY_GENERATION_ROLLBACK');

  const staleAuditState = inventoryFixture(api, { lastAuditState: 'stale' });
  assert.throws(() => router.selectStrongestAdmissibleInterface(
    bindCurrentInventory(context, staleAuditState.target),
    [api],
    { authorizationEnvelope: routeEnvelope, inventoryAuthority: staleAuditState.authority }
  ), (error) => error.code === 'EXTERNAL_STALE_TARGET_INVENTORY');

  if (process.platform !== 'win32') {
    const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'external-inventory-link-'));
    const linkedPath = path.join(linkRoot, 'provider-target-registry.json');
    fs.symlinkSync(rollback.sourcePath, linkedPath);
    assert.throws(() => router.loadTrustedInventorySnapshot({
      testOnly: true,
      sourcePath: linkedPath
    }), (error) => error.code === 'EXTERNAL_INVENTORY_TOPOLOGY_MISMATCH');
  } else {
    t.diagnostic('link substitution is covered on hosts that permit unprivileged symlink fixtures');
  }
});

function target(alias, environment, credentials = ['credential-store://coolify/swooshz-production'], extra = {}) {
  return {
    provider: 'coolify',
    targetAlias: alias,
    accountOrOrganisation: 'swooshz',
    environment,
    sanitizedFingerprint: `sha256:${alias === 'coolify-swooshz-production' ? 'a' : 'b'.repeat(1)}${'0'.repeat(63)}`,
    inventoryGeneration: `sha256:${alias === 'coolify-swooshz-production' ? '8' : '7'}${'0'.repeat(63)}`,
    privateOriginReference: `local-registry://origins/${alias}`,
    resourceReferences: ['spacekonceptrental'],
    credentialReferences: credentials,
    installedInterfaces: ['coolify-api'],
    capabilityDigests: [`sha256:${'c'.repeat(64)}`],
    operationSemantics: [semanticsFor('deploy-revision')],
    routeSelections: { 'deploy-revision': 'coolify-api' },
    lastAuditState: 'current',
    receiptReferences: [],
    ...extra
  };
}

test('provider target registry defaults to one credential, never guesses, and survives host switching', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'external-registry-validation-'));
  const sourcePath = path.join(root, 'provider-target-registry.json');
  fs.writeFileSync(sourcePath, '{}\n');
  const identity = router.testInventoryAuthorityExpectations(sourcePath);
  const inventoryGeneration = `sha256:${'8'.repeat(64)}`;
  const registryBase = {
    schemaVersion: router.REGISTRY_SCHEMA_VERSION,
    ...identity,
    inventoryGeneration,
    generationSequence: 1,
    generatedAt: '2026-07-24T00:00:00.000Z'
  };
  const registry = {
    ...registryBase,
    targets: [
      target('coolify-swooshz-production', 'production', undefined, { inventoryGeneration }),
      target('coolify-xboundaries-production', 'production', undefined, { inventoryGeneration })
    ]
  };
  router.validateProviderTargetRegistry(registry);
  assert.throws(() => router.resolveProviderTarget(registry, { provider: 'coolify' }), (error) => error.code === 'EXTERNAL_TARGET_AMBIGUOUS');
  const selected = router.resolveProviderTarget(registry, { provider: 'coolify', targetAlias: 'coolify-swooshz-production', environment: 'production' });
  assert.equal(selected.credentialReferences.length, 1);
  assert.throws(
    () => router.validateProviderTargetRegistry({
      ...registryBase,
      targets: [target('coolify-swooshz-production', 'production', [
        'credential-store://coolify/read', 'credential-store://coolify/write'
      ], { inventoryGeneration })]
    }),
    /multipleCredentialJustification/
  );
  const exactAudit = audit('coolify-api', 'api', 80, {
    targetFingerprint: selected.sanitizedFingerprint
  });
  exactAudit.targetBinding = router.targetBindingDigest(exactAudit);
  exactAudit.capabilityDigest = router.capabilityAuditDigest(exactAudit);
  const planFixture = inventoryFixture(exactAudit, {
    sanitizedFingerprint: selected.sanitizedFingerprint,
    resourceReferences: ['spacekonceptrental']
  });
  const selector = {
    provider: 'coolify',
    targetAlias: 'coolify-swooshz-production',
    environment: 'production'
  };
  const codex = router.buildHostAdapterPlan(planFixture.authority, selector, 'codex', [exactAudit]);
  const claude = router.buildHostAdapterPlan(planFixture.authority, selector, 'claude-code', [exactAudit]);
  assert.deepEqual(codex.logicalTarget, claude.logicalTarget);
  assert.equal(codex.requiresProviderRediscoveryOnHostSwitch, false);
  assert.equal(claude.preserveOtherHostConfiguration, true);
  assert.equal(claude.copySecretsIntoRepository, false);
  const wrongTarget = router.buildHostAdapterPlan(planFixture.authority, selector, 'codex', [audit('wrong-target', 'api', 80)]);
  assert.equal(wrongTarget.capabilityAuditPassed, false);
  assert.deepEqual(wrongTarget.supportedOperations, []);
  const uninstalledFixture = inventoryFixture(exactAudit, {
    sanitizedFingerprint: selected.sanitizedFingerprint,
    resourceReferences: ['spacekonceptrental'],
    installedInterfaces: []
  });
  const uninstalled = router.buildHostAdapterPlan(uninstalledFixture.authority, selector, 'codex', [exactAudit]);
  assert.equal(uninstalled.capabilityAuditPassed, false);
  assert.deepEqual(uninstalled.supportedOperations, []);
  const staleFixture = inventoryFixture(exactAudit, {
    sanitizedFingerprint: selected.sanitizedFingerprint,
    resourceReferences: ['spacekonceptrental'],
    capabilityDigests: []
  });
  const staleDigest = router.buildHostAdapterPlan(staleFixture.authority, selector, 'codex', [exactAudit]);
  assert.equal(staleDigest.capabilityAuditPassed, false);
  assert.deepEqual(staleDigest.supportedOperations, []);
});

test('receipts redact unsafe material and route lifecycle never auto-revokes', () => {
  const receiptEnvelope = envelope();
  const receiptAudit = audit('coolify-api', 'api', 80, {
    targetFingerprint: `sha256:${'d'.repeat(64)}`
  });
  receiptAudit.targetBinding = router.targetBindingDigest(receiptAudit);
  const receiptFixture = inventoryFixture(receiptAudit, {
    sanitizedFingerprint: receiptAudit.targetFingerprint,
    resourceReferences: ['spacekonceptrental']
  });
  const receiptTarget = receiptFixture.target;
  const receiptContext = bindCurrentInventory({
    ...operation('deploy-revision', { deploys: true }),
    targetFingerprint: receiptAudit.targetFingerprint
  }, receiptTarget);
  const selectedRoute = router.selectStrongestAdmissibleInterface(receiptContext, [receiptAudit], {
    authorizationEnvelope: receiptEnvelope,
    inventoryAuthority: receiptFixture.authority
  });
  const receipt = router.createOperationReceipt({
    operationId: 'deploy-286',
    operation: 'deploy-revision',
    provider: 'coolify',
    adapter: 'coolify-api',
    targetAlias: 'coolify-swooshz-production',
    accountOrOrganisation: 'swooshz',
    resource: 'spacekonceptrental',
    targetFingerprint: `sha256:${'d'.repeat(64)}`,
    environment: 'production',
    riskTier: 2,
    authorisationReference: 'issue-286-owner-approval',
    authorisationEnvelope: receiptEnvelope,
    selectedRoute,
    precondition: 'passed',
    preconditionEvidence: ['test:precondition'],
    mutationAttempted: true,
    mutationPerformed: true,
    postcondition: 'passed',
    postconditionEvidence: ['test:postcondition'],
    rollbackAttempted: false,
    rollbackPerformed: false,
    rollbackEvidence: ['test:rollback-not-required'],
    stableCode: 'COOLIFY_DEPLOYED',
    safeEvidenceReferences: ['digest:revision-checked'],
    supportedNextAction: 'Observe the named application health.',
    unchangedScope: ['No credentials, DNS, database, or unrelated application changed.']
  });
  const repeatedReceipt = router.createOperationReceipt({
    ...receipt,
    authorisationEnvelope: receiptEnvelope,
    selectedRoute
  });
  assert.deepEqual(repeatedReceipt, receipt);
  assert.equal(receipt.mutationPerformed, true);
  assert.equal(receipt.operation, 'deploy-revision');
  assert.equal(receipt.selectedRouteDigest, router.operationReceiptRouteDigest(receipt));
  const receiptSchema = JSON.parse(fs.readFileSync(path.join(
    __dirname, '..', '..', '_projects', 'development', 'external-system-router', '_main', 'skill',
    'references', 'schemas', 'operation-receipt.schema.json'
  ), 'utf8'));
  for (const field of [
    'operation', 'accountOrOrganisation', 'resource', 'authorisationEnvelopeDigest',
    'authorisationLifetimeKind', 'capabilityDigest', 'inventoryGeneration', 'inventoryDigest',
    'selectedRouteDigest'
  ]) {
    assert.ok(receiptSchema.required.includes(field), field);
  }
  assert.doesNotThrow(() => router.validateOperationReceipt(receipt, {
    authorisationEnvelope: receiptEnvelope,
    operationContext: receiptContext,
    selectedRoute
  }));
  assert.throws(
    () => router.validateOperationReceipt({ ...receipt, operation: 'delete-application' }),
    (error) => error.code === 'EXTERNAL_RECEIPT_BINDING_MISMATCH'
  );
  assert.throws(
    () => router.validateOperationReceipt(receipt, {
      authorisationEnvelope: envelope({
        lifetime: {
          kind: 'task',
          taskId: 'task-later',
          sessionFingerprint: router.sha256('session-later'),
          objectiveDigest: router.objectiveAuthorityDigest('Deploy one exact reviewed revision.')
        }
      }),
      operationContext: receiptContext,
      selectedRoute
    }),
    (error) => error.code === 'EXTERNAL_RECEIPT_BINDING_MISMATCH'
  );
  assert.throws(
    () => router.validateOperationReceipt({ ...receipt, supportedNextAction: `Retry with Bearer ${'x'.repeat(20)}` }),
    (error) => error.code === 'EXTERNAL_SECRET_REJECTED'
  );
  assert.throws(() => router.evaluateRouteLifecycle({
    schemaVersion: router.ROUTE_LIFECYCLE_SCHEMA_VERSION,
    provider: 'coolify', targetAlias: 'coolify-swooshz-production', environment: 'production', operation: 'deploy-revision',
    previousRoute: 'coolify-api', candidateRoute: 'typed-coolify-mcp', driftDetected: true,
    semanticReview: 'passed', syntheticTests: 'passed', nativeUat: 'passed', ownerApprovedMigration: true,
    observation: 'passed', previousRouteRetained: false, automaticCredentialRevocation: true,
    laterRemovalApprovalReference: 'owner-removal-approval'
  }), (error) => error.code === 'EXTERNAL_AUTOMATIC_REVOCATION_FORBIDDEN');

  const staged = {
    schemaVersion: router.ROUTE_LIFECYCLE_SCHEMA_VERSION,
    provider: 'coolify', targetAlias: 'coolify-swooshz-production', environment: 'production', operation: 'deploy-revision',
    previousRoute: 'coolify-api', candidateRoute: 'typed-coolify-mcp', driftDetected: true,
    semanticReview: 'passed', syntheticTests: 'passed', nativeUat: 'pending', ownerApprovedMigration: false,
    observation: 'pending', previousRouteRetained: true, automaticCredentialRevocation: false
  };
  assert.equal(router.evaluateRouteLifecycle(staged).migrationMayProceed, false);
  assert.throws(() => router.evaluateRouteLifecycle({ ...staged, previousRouteRetained: false }), /Previous route must remain/);
  const migrated = router.evaluateRouteLifecycle({
    ...staged, nativeUat: 'passed', ownerApprovedMigration: true, observation: 'passed',
    previousRouteRetained: false, laterRemovalApprovalReference: 'owner-approved-later-removal'
  });
  assert.equal(migrated.previousRouteMayBeRemoved, true);
  assert.equal(migrated.automaticCredentialRevocation, false);
});

test('optional Scheduled Task handoff is advisory, sanitized, bounded, and unnecessary for Toolkit operation', () => {
  const handoff = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'skills', 'external-system-router', 'references', 'scheduled-task-handoff.md'), 'utf8');
  assert.match(handoff, /does not require a separately billed OpenAI API key/i);
  assert.match(handoff, /NO_ACTION/);
  assert.match(handoff, /one bounded migration, UAT, or update recommendation/i);
  assert.match(handoff, /Do not access private local state/i);
  assert.match(handoff, /Do not install integrations, modify configuration/i);
  assert.match(handoff, /Toolkit remains fully usable and deterministic without it/i);
});
