'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../../skills/external-system-router/scripts/external-system-router.cjs');

function envelope(overrides = {}) {
  return {
    schemaVersion: router.ENVELOPE_SCHEMA_VERSION,
    provider: 'coolify',
    targetAlias: 'coolify-swooshz-production',
    accountOrOrganisation: 'swooshz',
    resource: 'spacekonceptrental',
    environment: 'production',
    objective: 'Deploy one exact reviewed revision.',
    allowedOperations: ['read-revision', 'deploy-revision', 'delete-application'],
    operationRiskTiers: { 'read-revision': 0, 'deploy-revision': 2, 'delete-application': 3 },
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
}

function operation(name, overrides = {}) {
  return {
    provider: 'coolify',
    targetAlias: 'coolify-swooshz-production',
    accountOrOrganisation: 'swooshz',
    resource: 'spacekonceptrental',
    environment: 'production',
    operation: name,
    sensitiveDataClasses: ['deployment-metadata'],
    ...overrides
  };
}

function audit(interfaceId, interfaceKind, assuranceScore, overrides = {}) {
  return {
    schemaVersion: router.AUDIT_SCHEMA_VERSION,
    provider: 'coolify',
    targetAlias: 'coolify-swooshz-production',
    environment: 'production',
    operation: 'deploy-revision',
    interfaceId,
    interfaceKind,
    identity: `${interfaceId} reviewed identity`,
    version: '2026-07-23',
    availableOperations: ['deploy-revision'],
    targetBinding: 'coolify-swooshz-production',
    inputSchemaDigest: `sha256:${'1'.repeat(64)}`,
    authScopeStatus: 'configured scope status; no values recorded',
    redaction: ['Allowlisted response fields only.'],
    retryIdempotency: 'No uncertain retry of non-idempotent writes.',
    preconditions: ['Exact reviewed revision is bound.'],
    postconditions: ['Exact revision and health are verified.'],
    rollback: ['Verified previous revision is retained.'],
    failureSemantics: ['Stable failure code; no guessed continuation.'],
    capabilityDigest: `sha256:${String(assuranceScore).padStart(64, '0')}`,
    assuranceScore,
    readOnly: false,
    auditedAt: '2026-07-23T00:00:00.000Z',
    evidenceReferences: ['public-doc:coolify-api'],
    ...overrides
  };
}

test('risk tiers and one established envelope govern exact operations without per-call prompting', () => {
  assert.equal(router.classifyRisk({ readOnly: true }), 0);
  assert.equal(router.classifyRisk({ readOnly: false }), 1);
  assert.equal(router.classifyRisk({ deploys: true }), 2);
  assert.equal(router.classifyRisk({ destructive: true }), 3);

  const read = router.assertOperationAuthorized(envelope(), operation('read-revision', { readOnly: true }), { establishedTier: 2 });
  assert.deepEqual(read, { authorised: true, riskTier: 0, reuseWithoutPerCallPrompt: true });
  const deploy = router.assertOperationAuthorized(envelope(), operation('deploy-revision', { deploys: true }), { establishedTier: 2 });
  assert.equal(deploy.reuseWithoutPerCallPrompt, true);
  assert.equal(deploy.riskTier, 2);
  assert.throws(
    () => router.assertOperationAuthorized(envelope(), operation('read-revision', { environment: 'staging', readOnly: true })),
    (error) => error.code === 'EXTERNAL_REAUTHORISATION_REQUIRED' && /environment/.test(error.message)
  );
  assert.throws(
    () => router.assertOperationAuthorized(envelope(), operation('deploy-revision', { deploys: true }), { establishedTier: 1 }),
    (error) => error.code === 'EXTERNAL_REAUTHORISATION_REQUIRED'
  );
  assert.throws(
    () => router.assertOperationAuthorized(envelope(), operation('delete-application')),
    (error) => error.code === 'EXTERNAL_TIER3_APPROVAL_REQUIRED'
  );
  assert.throws(
    () => router.assertOperationAuthorized(envelope(), operation('delete-application', { destructive: true, riskTier: 0 })),
    (error) => error.code === 'EXTERNAL_TIER3_APPROVAL_REQUIRED'
  );
  const destructive = router.assertOperationAuthorized(
    envelope(),
    operation('delete-application', { destructive: true }),
    { immediateApproval: { ownerApproved: true, operation: 'delete-application', authorisationReference: 'immediate-owner-approval' } }
  );
  assert.equal(destructive.riskTier, 3);
  assert.equal(destructive.reuseWithoutPerCallPrompt, false);
});

function disclosure(overrides = {}) {
  return {
    goal: 'Configure one unsupported provider control.',
    capability: 'computer-use',
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
  const context = { provider: 'coolify', targetAlias: 'coolify-swooshz-production', environment: 'production', operation: 'deploy-revision', readOnly: false };
  const apiSelected = router.selectStrongestAdmissibleInterface(context, [readOnlyMcp, browser, api], { graphicalApprovalValid: true });
  assert.equal(apiSelected.selectedInterface, 'coolify-api');
  assert.match(apiSelected.rejected.find((item) => item.interfaceId === 'coolify-mcp').reason, /read-only/);

  const typedMcp = audit('typed-coolify-mcp', 'mcp', 95);
  assert.equal(router.selectStrongestAdmissibleInterface(context, [api, typedMcp]).selectedInterface, 'typed-coolify-mcp');
  assert.equal(router.selectStrongestAdmissibleInterface(context, [browser, api], { graphicalApprovalValid: true }).selectedInterface, 'coolify-api');
  const wrongOperation = audit('wrong-operation-mcp', 'mcp', 100, { operation: 'read-revision', availableOperations: ['read-revision'] });
  const operationScoped = router.selectStrongestAdmissibleInterface(context, [wrongOperation, api]);
  assert.equal(operationScoped.selectedInterface, 'coolify-api');
  assert.throws(() => router.selectStrongestAdmissibleInterface(context, [wrongOperation]), (error) => error.code === 'EXTERNAL_NO_ADMISSIBLE_ROUTE');
});

function target(alias, environment, credentials = ['credential-store://coolify/swooshz-production'], extra = {}) {
  return {
    provider: 'coolify',
    targetAlias: alias,
    environment,
    sanitizedFingerprint: `sha256:${alias === 'coolify-swooshz-production' ? 'a' : 'b'.repeat(1)}${'0'.repeat(63)}`,
    privateOriginReference: `local-registry://origins/${alias}`,
    resourceReferences: ['spacekonceptrental'],
    credentialReferences: credentials,
    installedInterfaces: ['coolify-api'],
    capabilityDigests: [`sha256:${'c'.repeat(64)}`],
    routeSelections: { 'deploy-revision': 'coolify-api' },
    lastAuditState: 'current',
    receiptReferences: [],
    ...extra
  };
}

test('provider target registry defaults to one credential, never guesses, and survives host switching', () => {
  const registry = {
    schemaVersion: router.REGISTRY_SCHEMA_VERSION,
    targets: [target('coolify-swooshz-production', 'production'), target('coolify-xboundaries-production', 'production')]
  };
  router.validateProviderTargetRegistry(registry);
  assert.throws(() => router.resolveProviderTarget(registry, { provider: 'coolify' }), (error) => error.code === 'EXTERNAL_TARGET_AMBIGUOUS');
  const selected = router.resolveProviderTarget(registry, { provider: 'coolify', targetAlias: 'coolify-swooshz-production', environment: 'production' });
  assert.equal(selected.credentialReferences.length, 1);
  assert.throws(
    () => router.validateProviderTargetRegistry({ schemaVersion: router.REGISTRY_SCHEMA_VERSION, targets: [target('coolify-swooshz-production', 'production', ['credential-store://coolify/read', 'credential-store://coolify/write'])] }),
    /multipleCredentialJustification/
  );
  const codex = router.buildHostAdapterPlan(selected, 'codex', [audit('coolify-api', 'api', 80)]);
  const claude = router.buildHostAdapterPlan(selected, 'claude-code', [audit('coolify-api', 'api', 80)]);
  assert.deepEqual(codex.logicalTarget, claude.logicalTarget);
  assert.equal(codex.requiresProviderRediscoveryOnHostSwitch, false);
  assert.equal(claude.preserveOtherHostConfiguration, true);
  assert.equal(claude.copySecretsIntoRepository, false);
});

test('receipts redact unsafe material and route lifecycle never auto-revokes', () => {
  const receipt = router.createOperationReceipt({
    operationId: 'deploy-286',
    provider: 'coolify',
    adapter: 'coolify-api',
    targetAlias: 'coolify-swooshz-production',
    targetFingerprint: `sha256:${'d'.repeat(64)}`,
    environment: 'production',
    riskTier: 2,
    authorisationReference: 'issue-286-owner-approval',
    selectedInterface: 'coolify-api',
    precondition: 'passed',
    mutationAttempted: true,
    mutationPerformed: true,
    postcondition: 'passed',
    rollbackAttempted: false,
    rollbackPerformed: false,
    stableCode: 'COOLIFY_DEPLOYED',
    safeEvidenceReferences: ['digest:revision-checked'],
    supportedNextAction: 'Observe the named application health.',
    unchangedScope: ['No credentials, DNS, database, or unrelated application changed.']
  });
  assert.equal(receipt.mutationPerformed, true);
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
