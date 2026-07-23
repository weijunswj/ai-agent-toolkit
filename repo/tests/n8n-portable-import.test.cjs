const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const helperRoot = path.join(
  process.cwd(),
  '_projects/n8n/workflow-toolkit/_main/helper-scripts/import-export-sync'
);
const portable = require(path.join(helperRoot, 'n8n-portable-workflow.cjs'));
const metadata = require(path.join(helperRoot, 'n8n-credential-metadata.cjs'));
const comparison = require(path.join(helperRoot, 'should-import-n8n-workflow.cjs'));
const reports = require(path.join(helperRoot, 'n8n-workflow-operation-report.cjs'));
const transports = require(path.join(helperRoot, 'n8n-workflow-transport.cjs'));
const identities = require(path.join(helperRoot, 'n8n-workflow-identity.cjs'));
const preparation = require(path.join(helperRoot, 'prepare-n8n-live-import.cjs'));
const exportSync = require(path.join(helperRoot, 'sync-n8n-live-exports.cjs'));

function workflow() {
  return {
    id: 'canonical-workflow-id',
    name: 'Portable Sheets Intake',
    active: false,
    nodes: [
      {
        id: 'sheet-node',
        name: 'Append order',
        type: 'n8n-nodes-base.googleSheets',
        credentials: {
          googleSheetsOAuth2Api: { id: 'target-only-credential-id', name: 'Finance Sheets' },
        },
        parameters: {
          documentId: { mode: 'id', value: 'approved-shared-sheet' },
          sheetName: { mode: 'name', value: 'Orders - RAW' },
          columns: {
            mappingMode: 'defineBelow',
            value: {
              order_id: '={{ $json.order_id }}',
              amount: '={{ $json.amount }}',
            },
            matchingColumns: ['order_id'],
            schema: [{ id: 'order_id' }, { id: 'amount' }],
          },
          filters: { conditions: [{ leftValue: '={{ $json.status }}', operator: 'equals', rightValue: 'ready' }] },
          options: { valueInputMode: 'RAW' },
        },
      },
      {
        id: 'webhook-node',
        name: 'Intake',
        type: 'n8n-nodes-base.webhook',
        webhookId: 'target-webhook-id',
        parameters: { path: 'portable-intake' },
      },
    ],
    connections: { Intake: { main: [[{ node: 'Append order', type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1' },
  };
}

function declaration(canonical) {
  return {
    schemaVersion: 1,
    workflows: [portable.buildPortableCredentialDeclaration(canonical, 'n8n-workflows/portable.json')],
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

test('canonical export retains portable logic and emits name/type credential declarations without target IDs', () => {
  const live = workflow();
  live.active = true;
  live.createdAt = '2026-01-01T00:00:00.000Z';
  const canonical = portable.canonicalWorkflowForGit(live);
  const requirement = portable.buildPortableCredentialDeclaration(canonical, 'n8n-workflows/portable.json');

  assert.equal(canonical.active, false);
  assert.equal(canonical.id, undefined);
  assert.equal(canonical.nodes[0].parameters.sheetName.value, 'Orders - RAW');
  assert.equal(canonical.nodes[0].parameters.documentId.value, 'approved-shared-sheet');
  assert.equal(canonical.nodes[0].parameters.columns.mappingMode, 'defineBelow');
  assert.equal(canonical.nodes[0].parameters.columns.value.amount, '={{ $json.amount }}');
  assert.deepEqual(canonical.nodes[0].parameters.columns.matchingColumns, ['order_id']);
  assert.equal(canonical.nodes[0].parameters.options.valueInputMode, 'RAW');
  assert.deepEqual(canonical.nodes[0].credentials.googleSheetsOAuth2Api, { id: null, name: 'Finance Sheets' });
  assert.equal(canonical.nodes[1].webhookId, undefined);
  assert.equal(requirement.nodes[0].credentialType, 'googleSheetsOAuth2Api');
  assert.equal(requirement.nodes[0].logicalName, 'Finance Sheets');
  assert.equal(requirement.nodes[0].required, true);
  assert.doesNotMatch(JSON.stringify({ canonical, requirement }), /target-only-credential-id/);
});

test('credential resolution is exact by logical name and type and never guesses', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const requirements = declaration(canonical).workflows[0].nodes;

  const unique = structuredClone(canonical);
  const result = portable.resolveCredentialRequirements(unique, requirements, [
    { id: 'internal-id', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' },
  ]);
  assert.equal(result.resolvedCount, 1);
  assert.equal(unique.nodes[0].credentials.googleSheetsOAuth2Api.id, 'internal-id');
  assert.doesNotMatch(JSON.stringify(result), /internal-id/);

  const missing = structuredClone(canonical);
  const missingResult = portable.resolveCredentialRequirements(missing, requirements, [], { allowUnresolvedImport: true });
  assert.equal(missingResult.issues[0].code, 'N8N_CREDENTIAL_MISSING');
  assert.equal(missing.nodes[0].credentials.googleSheetsOAuth2Api.id, null);

  const duplicate = structuredClone(canonical);
  const duplicateResult = portable.resolveCredentialRequirements(duplicate, requirements, [
    { id: 'one', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' },
    { id: 'two', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' },
  ]);
  assert.equal(duplicateResult.blocking[0].code, 'N8N_CREDENTIAL_AMBIGUOUS');

  const wrongType = structuredClone(canonical);
  const wrongResult = portable.resolveCredentialRequirements(wrongType, requirements, [
    { id: 'wrong', name: 'Finance Sheets', type: 'googleDriveOAuth2Api' },
  ]);
  assert.equal(wrongResult.blocking[0].code, 'N8N_CREDENTIAL_TYPE_MISMATCH');
  expectCode(() => portable.resolveCredentialRequirements(structuredClone(canonical), requirements, null), 'N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE');
});

test('unsupported unresolved import stops before mutation while supported CLI flow keeps name/type unresolved', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const options = {
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: declaration(canonical),
    credentialMetadata: [],
    deploymentPolicy: { schemaVersion: 1, workflows: [] },
    resourceBindings: { schemaVersion: 1, workflows: [] },
  };
  expectCode(() => portable.preparePortableWorkflow(options), 'N8N_CREDENTIAL_MISSING');
  const supported = portable.preparePortableWorkflow({ ...options, allowUnresolvedImport: true });
  assert.equal(supported.credentialResult.unresolvedImport, true);
  assert.deepEqual(supported.preparedWorkflow.nodes[0].credentials.googleSheetsOAuth2Api, { id: null, name: 'Finance Sheets' });
});

test('import blocks legacy live credential references that have no portable declaration', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  delete canonical.nodes[0].credentials;
  const live = workflow();
  expectCode(() => portable.preparePortableWorkflow({
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: { schemaVersion: 1, workflows: [] },
    credentialMetadata: [],
    deploymentPolicy: { schemaVersion: 1, workflows: [] },
    resourceBindings: { schemaVersion: 1, workflows: [] },
    liveWorkflow: live,
    allowUnresolvedImport: true,
  }), 'N8N_POLICY_VALIDATION_FAILED');
});

test('rerunning the unchanged preparation command binds a newly created unique target credential', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const options = {
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: declaration(canonical),
    deploymentPolicy: { schemaVersion: 1, workflows: [] },
    resourceBindings: { schemaVersion: 1, workflows: [] },
    allowUnresolvedImport: true,
  };
  const first = portable.preparePortableWorkflow({ ...options, credentialMetadata: [] });
  const second = portable.preparePortableWorkflow({
    ...options,
    credentialMetadata: [{ id: 'resolved-internally', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }],
  });
  assert.equal(first.preparedWorkflow.nodes[0].credentials.googleSheetsOAuth2Api.id, null);
  assert.equal(second.preparedWorkflow.nodes[0].credentials.googleSheetsOAuth2Api.id, 'resolved-internally');
  assert.deepEqual(options.canonicalWorkflow, canonical);
});

test('canonical preparation repairs damaged live mapping, expressions, filters, options, and intake fields', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const damaged = structuredClone(canonical);
  damaged.nodes[0].parameters.columns.value.extra_column = 'damaged';
  damaged.nodes[0].parameters.columns.value.amount = '';
  damaged.nodes[0].parameters.columns.matchingColumns = ['amount'];
  damaged.nodes[0].parameters.filters.conditions[0].rightValue = 'wrong';
  damaged.nodes[0].parameters.options = {};
  damaged.nodes[0].parameters.columns.value.reintroduced_intake_field = 'bad';
  damaged.nodes[1].webhookId = 'live-webhook';

  const result = portable.preparePortableWorkflow({
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: declaration(canonical),
    credentialMetadata: [{ id: 'bound', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }],
    deploymentPolicy: { schemaVersion: 1, workflows: [] },
    resourceBindings: { schemaVersion: 1, workflows: [] },
    liveWorkflow: damaged,
  });
  const prepared = result.preparedWorkflow.nodes[0].parameters;
  assert.deepEqual(prepared.columns.value, canonical.nodes[0].parameters.columns.value);
  assert.deepEqual(prepared.columns.matchingColumns, ['order_id']);
  assert.equal(prepared.filters.conditions[0].rightValue, 'ready');
  assert.equal(prepared.options.valueInputMode, 'RAW');
  assert.equal(result.preparedWorkflow.nodes[1].webhookId, 'live-webhook');
  assert.deepEqual(result.phases, [
    'load-canonical-workflow',
    'load-portable-credential-declarations',
    'load-deployment-resource-policy',
    'resolve-target-workflow-and-node',
    'discover-target-credential-metadata',
    'apply-credential-bindings',
    'restore-dedicated-identity-webhook-metadata',
    'apply-exact-resource-bindings',
    'validate-prepared-workflow',
    'validate-canonical-invariant',
  ]);
});

test('normal export protects schema mappings and expressions unless reviewed source-update mode is explicit', () => {
  const previous = portable.canonicalWorkflowForGit(workflow());
  const damaged = structuredClone(previous);
  damaged.nodes[0].parameters.columns.value.extra = 'bad';
  damaged.nodes[0].parameters.columns.value.amount = '';
  damaged.nodes[0].parameters.filters.conditions[0].leftValue = '';
  damaged.nodes[0].parameters.options = {};
  const safe = portable.canonicaliseExport({ liveWorkflow: damaged, canonicalWorkflow: previous, workflowFile: 'n8n-workflows/portable.json' });
  assert.deepEqual(safe.workflow.nodes[0].parameters.columns, previous.nodes[0].parameters.columns);
  assert.deepEqual(safe.workflow.nodes[0].parameters.filters, previous.nodes[0].parameters.filters);
  assert.deepEqual(safe.workflow.nodes[0].parameters.options, previous.nodes[0].parameters.options);
  assert.ok(safe.protectedChanges.length >= 3);
  const reviewed = portable.canonicaliseExport({ liveWorkflow: damaged, canonicalWorkflow: previous, workflowFile: 'n8n-workflows/portable.json', reviewedSourceUpdate: true });
  assert.equal(reviewed.workflow.nodes[0].parameters.columns.value.extra, 'bad');
});

test('normal export preserves approved canonical locator and blocks a new private environment-specific locator', () => {
  const previous = portable.canonicalWorkflowForGit(workflow());
  const live = structuredClone(previous);
  live.nodes[0].parameters.documentId.value = 'private-target-sheet';
  const deploymentPolicy = {
    workflows: [{
      workflowName: previous.name,
      resourcePaths: [{ nodeId: 'sheet-node', nodeName: 'Append order', nodeType: 'n8n-nodes-base.googleSheets', path: 'parameters.documentId.value', environmentSpecific: true, required: true }],
    }],
  };
  const safe = portable.canonicaliseExport({
    liveWorkflow: live,
    canonicalWorkflow: previous,
    workflowFile: 'n8n-workflows/portable.json',
    deploymentPolicy,
  });
  assert.equal(safe.workflow.nodes[0].parameters.documentId.value, 'approved-shared-sheet');
  const reviewed = portable.canonicaliseExport({
    liveWorkflow: live,
    canonicalWorkflow: previous,
    workflowFile: 'n8n-workflows/portable.json',
    deploymentPolicy,
    reviewedSourceUpdate: true,
  });
  assert.equal(reviewed.workflow.nodes[0].parameters.documentId.value, 'approved-shared-sheet');
  expectCode(() => portable.canonicaliseExport({
    liveWorkflow: live,
    canonicalWorkflow: null,
    workflowFile: 'n8n-workflows/portable.json',
    deploymentPolicy,
  }), 'N8N_RESOURCE_BINDING_MISSING');
});

test('conflicting workflow and node selectors fail closed', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  assert.equal(portable.selectWorkflowEntry({ workflows: [{
    workflowFile: 'n8n-workflows/other.json',
    workflowName: canonical.name,
    nodes: [],
  }] }, canonical, 'n8n-workflows/portable.json', 'test'), null);
  expectCode(() => portable.resolveCredentialRequirements(canonical, [{
    nodeId: 'sheet-node',
    nodeName: 'Append order',
    nodeType: 'n8n-nodes-base.httpRequest',
    credentialType: 'googleSheetsOAuth2Api',
    logicalName: 'Finance Sheets',
    required: true,
  }], [{ id: 'bound', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }]), 'N8N_POLICY_VALIDATION_FAILED');
  const legacy = preparation.selectBindingsWithMeta({ workflows: [{
    workflowFile: 'portable.json',
    workflowId: 'different-workflow',
    workflowName: canonical.name,
    nodes: [],
  }] }, { ...canonical, id: 'canonical-workflow' }, 'n8n-workflows/portable.json');
  assert.equal(legacy.blocked, true);
});

test('portable declaration output cannot escape the workflow directory', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-portable-path-'));
  const workflowDir = path.join(fixtureRoot, 'n8n-workflows');
  fs.mkdirSync(workflowDir);
  assert.throws(() => exportSync.assertStrictChild(workflowDir, path.join(fixtureRoot, 'outside.json'), 'Portable credential declaration'), /strict child/);
  assert.equal(exportSync.assertStrictChild(workflowDir, path.join(workflowDir, 'toolkit', 'portable-credentials.json'), 'Portable credential declaration'), path.join(workflowDir, 'toolkit', 'portable-credentials.json'));
  const externalDir = path.join(fixtureRoot, 'external');
  const linkedDir = path.join(workflowDir, 'linked');
  fs.mkdirSync(externalDir);
  try {
    fs.symlinkSync(externalDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => exportSync.assertStrictChild(workflowDir, path.join(linkedDir, 'portable-credentials.json'), 'Portable credential declaration'), /symlink, junction, or reparse/);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    t.diagnostic(`Link fixture unavailable on this platform: ${error.code}`);
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('resource bindings are optional, exact, scalar, and restricted to declared environment-specific paths', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const policy = {
    schemaVersion: 1,
    workflows: [{
      workflowName: canonical.name,
      resourcePaths: [{ nodeId: 'sheet-node', nodeName: 'Append order', nodeType: 'n8n-nodes-base.googleSheets', path: 'parameters.documentId.value', environmentSpecific: true, required: true }],
    }],
  };
  const bindings = {
    schemaVersion: 1,
    workflows: [{ workflowName: canonical.name, nodes: [{ nodeId: 'sheet-node', values: { 'parameters.documentId.value': 'target-private-sheet' } }] }],
  };
  const result = portable.preparePortableWorkflow({
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: declaration(canonical),
    credentialMetadata: [{ id: 'bound', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }],
    deploymentPolicy: policy,
    resourceBindings: bindings,
  });
  assert.equal(result.preparedWorkflow.nodes[0].parameters.documentId.value, 'target-private-sheet');
  expectCode(() => portable.preparePortableWorkflow({
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: declaration(canonical),
    credentialMetadata: [{ id: 'bound', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }],
    deploymentPolicy: policy,
    resourceBindings: { schemaVersion: 1, workflows: [] },
  }), 'N8N_RESOURCE_BINDING_MISSING');
  expectCode(() => portable.parseExactPath('parameters.*.value', { requireParameters: true }), 'N8N_POLICY_VALIDATION_FAILED');
  expectCode(() => portable.parseExactPath('parameters', { requireParameters: true }), 'N8N_POLICY_VALIDATION_FAILED');
  expectCode(() => portable.parseExactPath('parameters.columns', { requireParameters: true }), 'N8N_POLICY_VALIDATION_FAILED');
  expectCode(() => portable.parseExactPath('parameters.options', { requireParameters: true }), 'N8N_POLICY_VALIDATION_FAILED');
  expectCode(() => portable.parseExactPath('parameters.__proto__.value', { requireParameters: true }), 'N8N_POLICY_VALIDATION_FAILED');
});

test('effective comparison detects credential, resource, and active-state changes', () => {
  const base = portable.canonicalWorkflowForGit(workflow());
  const same = structuredClone(base);
  assert.deepEqual(comparison.comparableWorkflow(base), comparison.comparableWorkflow(same));
  same.nodes[0].credentials.googleSheetsOAuth2Api.id = 'different';
  assert.notDeepEqual(comparison.comparableWorkflow(base), comparison.comparableWorkflow(same));
  same.nodes[0].credentials.googleSheetsOAuth2Api.id = null;
  same.nodes[0].parameters.documentId.value = 'different-resource';
  assert.notDeepEqual(comparison.comparableWorkflow(base), comparison.comparableWorkflow(same));
  same.nodes[0].parameters.documentId.value = base.nodes[0].parameters.documentId.value;
  same.active = true;
  assert.notDeepEqual(comparison.comparableWorkflow(base), comparison.comparableWorkflow(same));
});

test('encrypted credential export is reduced to metadata and temporary storage cleans up', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n metadata with spaces '));
  const managedRoot = path.join(fixtureRoot, 'managed');
  fs.mkdirSync(managedRoot, { mode: 0o700 });
  const operation = path.join(managedRoot, 'operation');
  metadata.initialiseManagedDirectory(operation, managedRoot);
  const encrypted = path.join(operation, 'credentials.encrypted.json');
  const output = path.join(operation, 'credential-metadata.json');
  fs.writeFileSync(encrypted, JSON.stringify([{ id: 'internal-id', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api', data: 'encrypted-secret-material', oauthToken: 'never-copy' }]));
  const result = metadata.extractCredentialMetadata(encrypted, output, operation);
  assert.equal(result.count, 1);
  const text = fs.readFileSync(output, 'utf8');
  assert.deepEqual(JSON.parse(text), [{ id: 'internal-id', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }]);
  assert.doesNotMatch(text, /encrypted-secret-material|never-copy|data|oauthToken/);
  expectCode(() => metadata.initialiseManagedDirectory(path.join(fixtureRoot, 'escape'), managedRoot), 'N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE');
  metadata.cleanupManagedDirectory(operation, managedRoot);
  assert.equal(fs.existsSync(operation), false);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('credential metadata blocks symlink or junction escapes when the platform permits creating one', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-metadata-link-'));
  const managedRoot = path.join(fixtureRoot, 'managed');
  const outside = path.join(fixtureRoot, 'outside');
  fs.mkdirSync(managedRoot);
  fs.mkdirSync(outside);
  const link = path.join(managedRoot, 'linked');
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    t.skip(`symlink/junction creation unavailable: ${error.code}`);
    return;
  }
  expectCode(() => metadata.initialiseManagedDirectory(path.join(link, 'operation'), managedRoot), 'N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE');
  expectCode(() => metadata.initialiseManagedDirectory(path.join(link, 'new-managed', 'operation'), path.join(link, 'new-managed')), 'N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE');
  assert.equal(fs.existsSync(path.join(outside, 'new-managed')), false);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('transport contract exposes only supported inactive workflow operations', () => {
  const transport = transports.getTransport('docker-server-cli');
  assert.equal(transport.capabilities.unresolvedCredentialImport, true);
  assert.equal(transport.capabilities.credentialMetadata, 'encrypted-server-cli-export');
  assert.equal(transport.capabilities.browser, false);
  assert.equal(transport.capabilities.execution, false);
  assert.equal(transport.capabilities.activation, false);
  assert.ok(transport.importWorkflow('n8n', '/tmp/workflow.json').args.includes('--activeState=false'));
  assert.throws(() => transports.validateTransport({ id: 'bypass' }), /missing required operation/);
  assert.deepEqual(transports.verifyInactivePostcondition([{ id: 'target', active: false }], 'target'), { inactive: true, executionState: 'not_executed' });
  assert.throws(
    () => transports.verifyInactivePostcondition([{ id: 'target', active: true }], 'target'),
    (error) => error.code === 'N8N_POSTCONDITION_FAILED'
  );
});

test('dedicated local workflow identity makes unchanged reruns deterministic without exposing IDs in canonical Git', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-identity-'));
  const statePath = path.join(fixtureRoot, '.n8n-local', 'n8n-workflow-identities.json');
  identities.recordIdentity(statePath, {
    workflowFile: 'portable.json',
    workflowName: 'Portable Sheets Intake',
    targetWorkflowId: 'target-workflow-id',
  }, fixtureRoot);
  const selected = identities.selectIdentity(identities.readState(statePath, fixtureRoot), 'portable.json', 'Portable Sheets Intake');
  assert.equal(selected.targetWorkflowId, 'target-workflow-id');
  identities.recordIdentity(statePath, {
    workflowFile: 'portable.json',
    workflowName: 'Portable Sheets Intake',
    targetWorkflowId: 'replacement-target-workflow-id',
  }, fixtureRoot);
  const replaced = identities.selectIdentity(identities.readState(statePath, fixtureRoot), 'portable.json', 'Portable Sheets Intake');
  assert.equal(replaced.targetWorkflowId, 'replacement-target-workflow-id');
  assert.equal(portable.canonicalWorkflowForGit(workflow()).id, undefined);
  assert.throws(() => identities.recordIdentity(path.join(fixtureRoot, 'unsafe.json'), {
    workflowFile: 'portable.json', workflowName: 'Portable Sheets Intake', targetWorkflowId: 'id',
  }, fixtureRoot), /\.n8n-local/);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-identity-external-'));
  assert.throws(() => identities.recordIdentity(path.join(externalRoot, '.n8n-local', 'n8n-workflow-identities.json'), {
    workflowFile: 'portable.json', workflowName: 'Portable Sheets Intake', targetWorkflowId: 'id',
  }, fixtureRoot), /inside the repository/);
  fs.rmSync(externalRoot, { recursive: true, force: true });
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('reports are sanitized, retained locally, validated, and explained without mutation', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-report-'));
  const reportRoot = path.join(fixtureRoot, '.n8n-local', 'reports');
  const report = reports.writeReport(reportRoot, {
    operationType: 'import',
    result: 'ACTION_REQUIRED',
    code: 'N8N_CREDENTIAL_MISSING',
    phase: 'credential-resolution',
    workflows: [{ workflowFile: 'portable.json', workflowName: 'Portable Sheets Intake' }],
    credentials: [{ logicalName: 'Finance Sheets', credentialType: 'googleSheetsOAuth2Api', required: true, matchCount: 0, nodeName: 'Append order', nodeType: 'n8n-nodes-base.googleSheets' }],
    mutation: { attempted: true, performed: true },
    activeState: 'inactive',
    executionState: 'not_executed',
    nextAction: { code: 'CREATE_CREDENTIALS_AND_RERUN', message: 'Create the reported name and type, then rerun the unchanged official command.' },
    unchangedScope: ['activation', 'execution'],
  });
  assert.equal(report.code, 'N8N_CREDENTIAL_MISSING');
  assert.ok(fs.existsSync(path.join(reportRoot, 'latest-n8n-workflow-operation.json')));
  assert.ok(fs.existsSync(path.join(reportRoot, 'latest-n8n-workflow-operation.txt')));
  const serialized = fs.readFileSync(path.join(reportRoot, 'latest-n8n-workflow-operation.json'), 'utf8');
  assert.doesNotMatch(serialized, /credentialId|credentialValue|rawWorkflow|encryptedData/);
  assert.match(reports.explainLatestFailure(reportRoot), /rerun the unchanged official command/);
  assert.throws(() => reports.createReport({ code: 'N8N_INTERNAL_ERROR', workflows: [{ workflowFile: 'C:\\private\\workflow.json' }] }), /safe relative path/);
  assert.throws(() => reports.createReport({ code: 'N8N_INTERNAL_ERROR', operationId: '..\\..\\outside' }), /safe bounded file-name token/);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('PowerShell surfaces are PS 5.1-compatible, do not restart, and make valid import confirmation optional', () => {
  const importScript = fs.readFileSync(path.join(helperRoot, 'import-n8n-workflows-live.ps1'), 'utf8');
  const menuScript = fs.readFileSync(path.join(helperRoot, 'n8n-workflow-sync-menu.ps1'), 'utf8');
  assert.match(importScript, /--activeState=false/);
  assert.match(importScript, /N8N_POSTCONDITION_FAILED/);
  assert.match(importScript, /Get-SafeCredentialMetadata/);
  assert.doesNotMatch(importScript, /docker" @\("restart"/);
  assert.match(importScript, /PreparedHash\s*=\s*\(Get-FileHash/);
  assert.match(importScript, /N8N_CANONICAL_INVARIANT_FAILED: before-live-import hook changed/);
  assert.match(importScript, /required = if \(\$null -eq \$_\.Required\)/);
  assert.match(importScript, /function ConvertTo-NativeArgument/);
  assert.match(importScript, /Assert-StrictRepoChildPath \$WorkflowIdentityFilePath/);
  assert.match(menuScript, /\[switch\]\$RequireConfirmation/);
  assert.match(menuScript, /if \(\$Record\.commandKind -eq "import"\) \{ return \[bool\]\$RequireConfirmation \}/);
  assert.match(menuScript, /Explain Last n8n Failure/);
  assert.doesNotMatch(menuScript, /Press Enter to return after reviewing the error/);
  assert.doesNotMatch(importScript, /\?\?=|\?\.|ForEach-Object -Parallel/);
});
