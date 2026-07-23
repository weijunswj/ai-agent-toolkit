const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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

function writeFixture(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

test('unresolved required credentials are limited to genuinely new workflows and existing bindings are preserved', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const requiredDeclaration = declaration(canonical);
  const newWorkflow = portable.preparePortableWorkflow({
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: requiredDeclaration,
    credentialMetadata: [],
    deploymentPolicy: { schemaVersion: 1, workflows: [] },
    resourceBindings: { schemaVersion: 1, workflows: [] },
    allowUnresolvedImport: true,
  });
  assert.equal(newWorkflow.preparedWorkflow.nodes[0].credentials.googleSheetsOAuth2Api.id, null);
  assert.equal(newWorkflow.credentialResult.unresolvedImport, true);

  const existing = structuredClone(canonical);
  existing.nodes[0].credentials.googleSheetsOAuth2Api = { id: 'existing-target-binding', name: 'Finance Sheets' };
  expectCode(() => portable.preparePortableWorkflow({
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: requiredDeclaration,
    credentialMetadata: [],
    deploymentPolicy: { schemaVersion: 1, workflows: [] },
    resourceBindings: { schemaVersion: 1, workflows: [] },
    liveWorkflow: existing,
    allowUnresolvedImport: true,
  }), 'N8N_CREDENTIAL_MISSING');

  const optionalDeclaration = structuredClone(requiredDeclaration);
  optionalDeclaration.workflows[0].nodes[0].required = false;
  const optionalExisting = portable.preparePortableWorkflow({
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: optionalDeclaration,
    credentialMetadata: [],
    deploymentPolicy: { schemaVersion: 1, workflows: [] },
    resourceBindings: { schemaVersion: 1, workflows: [] },
    liveWorkflow: existing,
    allowUnresolvedImport: true,
  });
  assert.equal(optionalExisting.credentialResult.blocking.length, 0);
  assert.equal(optionalExisting.preparedWorkflow.nodes[0].credentials.googleSheetsOAuth2Api.id, 'existing-target-binding');
  assert.equal(optionalExisting.credentialResult.unresolvedImport, false);
});

test('optional credential declarations survive node renames when stable node identity remains', () => {
  const previousWorkflow = portable.canonicalWorkflowForGit(workflow());
  const previousDeclaration = portable.buildPortableCredentialDeclaration(previousWorkflow, 'n8n-workflows/portable.json');
  previousDeclaration.nodes[0].required = false;
  const renamed = structuredClone(previousWorkflow);
  renamed.nodes[0].name = 'Append approved order';
  const next = portable.buildPortableCredentialDeclaration(renamed, 'n8n-workflows/portable.json', previousDeclaration);
  assert.equal(next.nodes[0].nodeId, 'sheet-node');
  assert.equal(next.nodes[0].nodeName, 'Append approved order');
  assert.equal(next.nodes[0].required, false);

  const noIdPrevious = structuredClone(previousDeclaration);
  noIdPrevious.nodes[0].nodeId = '';
  const noIdRenamed = structuredClone(renamed);
  noIdRenamed.nodes[0].id = '';
  assert.equal(
    portable.buildPortableCredentialDeclaration(noIdRenamed, 'n8n-workflows/portable.json', noIdPrevious).nodes[0].required,
    true
  );
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

test('normal export protects expressions nested in arrays with deterministic numeric paths', () => {
  const previous = portable.canonicalWorkflowForGit(workflow());
  previous.nodes[0].parameters.routingRules = [{
    conditions: [{
      leftValue: '={{ $json.route }}',
      rightValue: 'approved',
    }],
  }];
  const damaged = structuredClone(previous);
  damaged.nodes[0].parameters.routingRules[0].conditions[0].leftValue = '={{ $json.attacker_controlled }}';
  const safe = portable.canonicaliseExport({
    liveWorkflow: damaged,
    canonicalWorkflow: previous,
    workflowFile: 'n8n-workflows/portable.json',
  });
  assert.equal(safe.workflow.nodes[0].parameters.routingRules[0].conditions[0].leftValue, '={{ $json.route }}');
  assert.deepEqual(
    safe.protectedChanges.filter((entry) => entry.path.includes('routingRules')).map((entry) => entry.path),
    ['parameters.routingRules.0.conditions.0.leftValue']
  );
  const reviewed = portable.canonicaliseExport({
    liveWorkflow: damaged,
    canonicalWorkflow: previous,
    workflowFile: 'n8n-workflows/portable.json',
    reviewedSourceUpdate: true,
  });
  assert.equal(reviewed.workflow.nodes[0].parameters.routingRules[0].conditions[0].leftValue, '={{ $json.attacker_controlled }}');
});

test('normal export preserves approved canonical locator and blocks a new private environment-specific locator', () => {
  const previous = portable.canonicalWorkflowForGit(workflow());
  const live = structuredClone(previous);
  live.nodes[0].parameters.documentId.value = 'private-target-sheet';
  const deploymentPolicy = {
    schemaVersion: 1,
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
  expectCode(() => portable.selectWorkflowEntry({ schemaVersion: 1, workflows: [{
    workflowFile: 'n8n-workflows/other.json',
    workflowName: canonical.name,
    nodes: [],
  }] }, canonical, 'n8n-workflows/portable.json', 'test', 'credential-declarations'), 'N8N_POLICY_VALIDATION_FAILED');
  assert.equal(portable.selectWorkflowEntry({ schemaVersion: 1, workflows: [{
    workflowFile: 'n8n-workflows/other.json',
    workflowName: 'Other workflow',
    nodes: [],
  }] }, canonical, 'n8n-workflows/portable.json', 'test', 'credential-declarations'), null);
  const live = workflow();
  expectCode(() => portable.canonicaliseExport({
    liveWorkflow: live,
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    deploymentPolicy: {
      schemaVersion: 1,
      workflows: [{
        workflowFile: 'n8n-workflows/portable.json',
        workflowId: 'stale-workflow-id',
        workflowName: live.name,
        resourcePaths: [],
      }],
    },
  }), 'N8N_POLICY_VALIDATION_FAILED');
  expectCode(() => portable.preparePortableWorkflow({
    canonicalWorkflow: canonical,
    liveWorkflow: live,
    targetWorkflowId: live.id,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: declaration(canonical),
    credentialMetadata: [{ id: 'bound', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }],
    deploymentPolicy: {
      schemaVersion: 1,
      workflows: [{
        workflowFile: 'n8n-workflows/portable.json',
        workflowId: 'stale-workflow-id',
        workflowName: live.name,
        resourcePaths: [],
      }],
    },
  }), 'N8N_POLICY_VALIDATION_FAILED');
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

test('present malformed portable documents fail schema validation before preparation or export mutation', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const liveTarget = workflow();
  const validOptions = {
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: declaration(canonical),
    credentialMetadata: [{ id: 'target-private-id', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }],
    deploymentPolicy: { schemaVersion: 1, workflows: [] },
    resourceBindings: { schemaVersion: 1, workflows: [] },
    liveWorkflow: liveTarget,
  };
  const malformedCases = [
    ['credentialDeclarations', 'credential-declarations', { schemaVersion: 1, workflows: {} }],
    ['credentialDeclarations', 'credential-declarations', { schemaVersion: 2, workflows: [] }],
    ['credentialDeclarations', 'credential-declarations', { workflows: [] }],
    ['credentialDeclarations', 'credential-declarations', null],
    ['credentialDeclarations', 'credential-declarations', []],
    ['credentialDeclarations', 'credential-declarations', { schemaVersion: 1, workflows: [null] }],
    ['credentialDeclarations', 'credential-declarations', {
      schemaVersion: 1,
      workflows: [{ workflowName: canonical.name, nodes: [{ nodeName: 'Append order' }] }],
    }],
    ['credentialDeclarations', 'credential-declarations', {
      schemaVersion: 1,
      workflows: [],
      nodes: [],
    }],
    ['credentialDeclarations', 'credential-declarations', {
      schemaVersion: 1,
      workflows: [{ workflowName: canonical.name, nodes: [], resourcePaths: [] }],
    }],
    ['deploymentPolicy', 'deployment-policy', {
      schemaVersion: 1,
      workflows: [{ workflowName: canonical.name, protectedPaths: {} }],
    }],
    ['deploymentPolicy', 'deployment-policy', {
      schemaVersion: 1,
      workflows: [{
        workflowName: canonical.name,
        resourcePaths: [{ nodeName: 'Append order', nodeType: 'n8n-nodes-base.googleSheets', path: 'parameters.*', environmentSpecific: true }],
      }],
    }],
    ['deploymentPolicy', 'deployment-policy', { schemaVersion: 1, unknownPolicyEntries: [] }],
    ['resourceBindings', 'resource-bindings', {
      schemaVersion: 1,
      workflows: [{ workflowName: canonical.name, nodes: [{ nodeName: 'Append order', nodeType: 'n8n-nodes-base.googleSheets', values: [] }] }],
    }],
    ['resourceBindings', 'resource-bindings', {
      schemaVersion: 1,
      workflows: [{
        workflowName: canonical.name,
        nodes: [{
          nodeName: 'Append order',
          nodeType: 'n8n-nodes-base.googleSheets',
          values: { 'parameters.documentId.value': { private: true } },
        }],
      }],
    }],
  ];

  const canonicalBytes = JSON.stringify(canonical);
  const liveTargetBytes = JSON.stringify(liveTarget);
  for (const [optionName, kind, malformed] of malformedCases) {
    const malformedBytes = JSON.stringify(malformed);
    expectCode(() => portable.validatePortableDocument(malformed, kind), 'N8N_POLICY_VALIDATION_FAILED');
    expectCode(
      () => portable.preparePortableWorkflow({ ...validOptions, [optionName]: malformed }),
      'N8N_POLICY_VALIDATION_FAILED'
    );
    assert.equal(JSON.stringify(canonical), canonicalBytes);
    assert.equal(JSON.stringify(liveTarget), liveTargetBytes);
    assert.equal(JSON.stringify(malformed), malformedBytes);
  }

  const live = workflow();
  const liveBytes = JSON.stringify(live);
  expectCode(() => portable.canonicaliseExport({
    liveWorkflow: live,
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    deploymentPolicy: { schemaVersion: 1, workflows: {} },
  }), 'N8N_POLICY_VALIDATION_FAILED');
  assert.equal(JSON.stringify(live), liveBytes);
  assert.equal(JSON.stringify(canonical), canonicalBytes);
});

test('malformed policy files create no prepared payload and leave canonical and declarations byte-identical', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-malformed-policy-'));
  const canonicalPath = path.join(fixtureRoot, 'n8n-workflows', 'portable.json');
  const declarationsPath = path.join(fixtureRoot, 'n8n-workflows', 'toolkit', 'portable-credentials.json');
  const policyPath = path.join(fixtureRoot, 'n8n-workflows', 'toolkit', 'deployment-policy.json');
  const metadataPath = path.join(fixtureRoot, '.n8n-local', 'credential-metadata.json');
  const outputPath = path.join(fixtureRoot, '.tmp', 'prepared.json');
  const resultPath = path.join(fixtureRoot, '.n8n-local', 'result.json');
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const declarations = declaration(canonical);
  writeFixture(canonicalPath, canonical);
  writeFixture(declarationsPath, declarations);
  writeFixture(policyPath, { schemaVersion: 1, workflows: {} });
  writeFixture(metadataPath, []);
  const canonicalBytes = fs.readFileSync(canonicalPath, 'utf8');
  const declarationBytes = fs.readFileSync(declarationsPath, 'utf8');

  expectCode(() => preparation.preparePortableImport({
    workflow: canonicalPath,
    output: outputPath,
    result: resultPath,
    'portable-credentials': declarationsPath,
    'deployment-policy': policyPath,
    'credential-metadata': metadataPath,
  }), 'N8N_POLICY_VALIDATION_FAILED');

  assert.equal(fs.existsSync(outputPath), false);
  assert.equal(fs.readFileSync(canonicalPath, 'utf8'), canonicalBytes);
  assert.equal(fs.readFileSync(declarationsPath, 'utf8'), declarationBytes);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(result.code, 'N8N_POLICY_VALIDATION_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /target-private-id/);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('conflicting stable node IDs fail before name fallback or any credential, resource, or webhook overlay', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const replacement = structuredClone(canonical.nodes[0]);
  replacement.type = 'n8n-nodes-base.httpRequest';
  replacement.name = 'Replacement node';
  delete replacement.credentials;
  const oldIdentity = structuredClone(canonical.nodes[0]);
  oldIdentity.id = 'different-node-id';
  canonical.nodes = [replacement, oldIdentity, canonical.nodes[1]];
  const canonicalBytes = JSON.stringify(canonical);
  const staleRequirement = {
    nodeId: 'sheet-node',
    nodeName: 'Append order',
    nodeType: 'n8n-nodes-base.googleSheets',
    credentialType: 'googleSheetsOAuth2Api',
    logicalName: 'Finance Sheets',
    required: true,
  };
  expectCode(() => portable.resolveCredentialRequirements(
    canonical,
    [staleRequirement],
    [{ id: 'target-private-id', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }]
  ), 'N8N_POLICY_VALIDATION_FAILED');
  assert.equal(JSON.stringify(canonical), canonicalBytes);
  assert.equal(canonical.nodes[1].parameters.documentId.value, 'approved-shared-sheet');

  const resourceWorkflow = structuredClone(canonical);
  const resourceBytes = JSON.stringify(resourceWorkflow);
  expectCode(() => portable.applyExactResourceBindings(
    resourceWorkflow,
    {
      resourcePaths: [{
        nodeId: 'sheet-node',
        nodeName: 'Append order',
        nodeType: 'n8n-nodes-base.googleSheets',
        path: 'parameters.documentId.value',
        environmentSpecific: true,
        required: true,
      }],
    },
    {
      nodes: [{
        nodeId: 'sheet-node',
        nodeName: 'Append order',
        nodeType: 'n8n-nodes-base.googleSheets',
        values: { 'parameters.documentId.value': 'private-resource' },
      }],
    },
    new Set()
  ), 'N8N_POLICY_VALIDATION_FAILED');
  assert.equal(JSON.stringify(resourceWorkflow), resourceBytes);

  const webhookPrepared = portable.canonicalWorkflowForGit(workflow());
  const live = workflow();
  live.nodes[1].type = 'n8n-nodes-base.httpRequest';
  live.nodes.push({
    id: 'fallback-webhook-node',
    name: 'Intake',
    type: 'n8n-nodes-base.webhook',
    webhookId: 'fallback-webhook-id',
    parameters: { path: 'portable-intake' },
  });
  const webhookBytes = JSON.stringify(webhookPrepared);
  expectCode(
    () => portable.restoreDedicatedWebhookMetadata(webhookPrepared, live, new Set()),
    'N8N_POLICY_VALIDATION_FAILED'
  );
  assert.equal(JSON.stringify(webhookPrepared), webhookBytes);
});

test('duplicate credential requirements fail as a complete plan before any binding is applied', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const baseRequirement = declaration(canonical).workflows[0].nodes[0];
  const variants = [
    [structuredClone(baseRequirement), structuredClone(baseRequirement)],
    [structuredClone(baseRequirement), { ...baseRequirement, logicalName: 'Different logical name' }],
    [structuredClone(baseRequirement), { ...baseRequirement, required: false }],
    [structuredClone(baseRequirement), { ...baseRequirement, nodeId: '' }],
  ];
  for (const requirements of variants) {
    const candidate = structuredClone(canonical);
    const before = JSON.stringify(candidate);
    expectCode(() => portable.resolveCredentialRequirements(
      candidate,
      requirements,
      [{ id: 'target-private-id', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }]
    ), 'N8N_POLICY_VALIDATION_FAILED');
    assert.equal(JSON.stringify(candidate), before);
  }

  const duplicateDocument = declaration(canonical);
  duplicateDocument.workflows[0].nodes.push({
    ...duplicateDocument.workflows[0].nodes[0],
    nodeId: '',
  });
  const canonicalBytes = JSON.stringify(canonical);
  expectCode(() => portable.preparePortableWorkflow({
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: duplicateDocument,
    credentialMetadata: [{ id: 'target-private-id', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }],
    deploymentPolicy: { schemaVersion: 1, workflows: [] },
    resourceBindings: { schemaVersion: 1, workflows: [] },
  }), 'N8N_POLICY_VALIDATION_FAILED');
  assert.equal(JSON.stringify(canonical), canonicalBytes);
});

test('credential declaration coverage is one-to-one with canonical logical names before metadata discovery', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const stale = declaration(canonical);
  stale.workflows[0].nodes[0].logicalName = 'Old Sheets Name';
  let staleError;
  try {
    portable.preparePortableWorkflow({
      canonicalWorkflow: canonical,
      workflowFile: 'n8n-workflows/portable.json',
      credentialDeclarations: stale,
      credentialMetadata: null,
      deploymentPolicy: { schemaVersion: 1, workflows: [] },
      resourceBindings: { schemaVersion: 1, workflows: [] },
    });
  } catch (error) {
    staleError = error;
  }
  assert.equal(staleError.code, 'N8N_POLICY_VALIDATION_FAILED');
  assert.doesNotMatch(JSON.stringify(staleError), /target-private-id/);

  const extra = declaration(canonical);
  extra.workflows[0].nodes.push({
    ...extra.workflows[0].nodes[0],
    credentialType: 'unreferencedCredentialType',
    logicalName: 'Unused logical name',
  });
  expectCode(() => portable.assertCredentialDeclarationCoverage(
    canonical,
    null,
    extra.workflows[0].nodes
  ), 'N8N_POLICY_VALIDATION_FAILED');

  const renamedCanonical = structuredClone(canonical);
  renamedCanonical.nodes[0].credentials.googleSheetsOAuth2Api.name = 'Finance Sheets v2';
  const updated = declaration(renamedCanonical);
  const prepared = portable.preparePortableWorkflow({
    canonicalWorkflow: renamedCanonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: updated,
    credentialMetadata: [{ id: 'target-private-id', name: 'Finance Sheets v2', type: 'googleSheetsOAuth2Api' }],
    deploymentPolicy: { schemaVersion: 1, workflows: [] },
    resourceBindings: { schemaVersion: 1, workflows: [] },
  });
  assert.equal(prepared.credentialResult.resolvedCount, 1);

  let ambiguousError;
  try {
    portable.preparePortableWorkflow({
      canonicalWorkflow: renamedCanonical,
      workflowFile: 'n8n-workflows/portable.json',
      credentialDeclarations: updated,
      credentialMetadata: [
        { id: 'target-private-id-one', name: 'Finance Sheets v2', type: 'googleSheetsOAuth2Api' },
        { id: 'target-private-id-two', name: 'Finance Sheets v2', type: 'googleSheetsOAuth2Api' },
      ],
      deploymentPolicy: { schemaVersion: 1, workflows: [] },
      resourceBindings: { schemaVersion: 1, workflows: [] },
    });
  } catch (error) {
    ambiguousError = error;
  }
  assert.equal(ambiguousError.code, 'N8N_CREDENTIAL_AMBIGUOUS');
  assert.doesNotMatch(JSON.stringify(ambiguousError), /target-private-id/);
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
    workflows: [{
      workflowName: canonical.name,
      nodes: [{
        nodeId: 'sheet-node',
        nodeName: 'Append order',
        nodeType: 'n8n-nodes-base.googleSheets',
        values: { 'parameters.documentId.value': 'target-private-sheet' },
      }],
    }],
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

test('resource bindings reject stale node type and name metadata even when the stable node ID matches', () => {
  const canonical = portable.canonicalWorkflowForGit(workflow());
  const policy = {
    schemaVersion: 1,
    workflows: [{
      workflowName: canonical.name,
      resourcePaths: [{
        nodeId: 'sheet-node',
        nodeName: 'Append order',
        nodeType: 'n8n-nodes-base.googleSheets',
        path: 'parameters.documentId.value',
        environmentSpecific: true,
        required: true,
      }],
    }],
  };
  const baseOptions = {
    canonicalWorkflow: canonical,
    workflowFile: 'n8n-workflows/portable.json',
    credentialDeclarations: declaration(canonical),
    credentialMetadata: [{ id: 'bound', name: 'Finance Sheets', type: 'googleSheetsOAuth2Api' }],
    deploymentPolicy: policy,
  };
  expectCode(() => portable.preparePortableWorkflow({
    ...baseOptions,
    resourceBindings: {
      workflows: [{
        workflowName: canonical.name,
        nodes: [{
          nodeId: 'sheet-node',
          nodeName: 'Append order',
          nodeType: 'n8n-nodes-base.postgres',
          values: { 'parameters.documentId.value': 'stale-private-resource' },
        }],
      }],
    },
  }), 'N8N_POLICY_VALIDATION_FAILED');
  expectCode(() => portable.preparePortableWorkflow({
    ...baseOptions,
    resourceBindings: {
      workflows: [{
        workflowName: canonical.name,
        nodes: [{
          nodeId: 'sheet-node',
          nodeName: 'Replacement node',
          nodeType: 'n8n-nodes-base.googleSheets',
          values: { 'parameters.documentId.value': 'stale-private-resource' },
        }],
      }],
    },
  }), 'N8N_POLICY_VALIDATION_FAILED');
  const replacementCanonical = structuredClone(canonical);
  replacementCanonical.nodes[0].id = 'replacement-sheet-node';
  const replacementPolicy = structuredClone(policy);
  replacementPolicy.workflows[0].resourcePaths[0].nodeId = 'replacement-sheet-node';
  expectCode(() => portable.preparePortableWorkflow({
    ...baseOptions,
    canonicalWorkflow: replacementCanonical,
    credentialDeclarations: declaration(replacementCanonical),
    deploymentPolicy: replacementPolicy,
    resourceBindings: {
      workflows: [{
        workflowName: replacementCanonical.name,
        nodes: [{
          nodeId: 'sheet-node',
          nodeName: 'Append order',
          nodeType: 'n8n-nodes-base.googleSheets',
          values: { 'parameters.documentId.value': 'stale-private-resource' },
        }],
      }],
    },
  }), 'N8N_POLICY_VALIDATION_FAILED');
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

test('workflow identity rejects case-folded file collisions and verifies exact file and workflow identity', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-identity-case-'));
  const statePath = path.join(fixtureRoot, '.n8n-local', 'n8n-workflow-identities.json');
  identities.recordIdentity(statePath, {
    workflowFile: 'A.json',
    workflowName: 'Workflow A',
    targetWorkflowId: 'target-a',
  }, fixtureRoot);
  expectCode(() => identities.recordIdentity(statePath, {
    workflowFile: 'a.json',
    workflowName: 'Workflow B',
    targetWorkflowId: 'target-b',
  }, fixtureRoot), 'N8N_WORKFLOW_MATCH_AMBIGUOUS');
  expectCode(
    () => identities.selectIdentity(identities.readState(statePath, fixtureRoot), 'a.json', 'Workflow B'),
    'N8N_WORKFLOW_MATCH_AMBIGUOUS'
  );
  expectCode(
    () => identities.selectIdentity(identities.readState(statePath, fixtureRoot), 'A.json', 'Renamed workflow'),
    'N8N_POLICY_VALIDATION_FAILED'
  );
  expectCode(
    () => identities.assertNoCaseFoldedWorkflowFileCollisions(['Folder/Portable.json', 'folder/portable.json']),
    'N8N_WORKFLOW_MATCH_AMBIGUOUS'
  );
  const stateText = fs.readFileSync(statePath, 'utf8');
  assert.match(stateText, /target-a/);
  assert.doesNotMatch(stateText, /target-b/);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('multi-workflow canonical replacement rolls back every byte after a late failure and reruns idempotently', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-export-transaction-'));
  const first = path.join(fixtureRoot, 'first.json');
  const second = path.join(fixtureRoot, 'second.json');
  const declarations = path.join(fixtureRoot, 'portable-credentials.json');
  const originals = new Map([
    [first, '{"original":1}\n'],
    [second, '{"original":2}\n'],
    [declarations, '{"schemaVersion":1,"workflows":[]}\n'],
  ]);
  for (const [filePath, content] of originals) fs.writeFileSync(filePath, content);
  const changes = [
    { targetPath: first, content: '{"next":1}\n', validate: (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')) },
    { targetPath: second, content: '{"next":2}\n', validate: (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')) },
    { targetPath: declarations, content: '{"schemaVersion":1,"workflows":[{"workflowFile":"first.json"}]}\n', validate: (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')) },
  ];
  const assertOriginals = () => {
    for (const [filePath, content] of originals) assert.equal(fs.readFileSync(filePath, 'utf8'), content);
    assert.deepEqual(fs.readdirSync(fixtureRoot).sort(), ['first.json', 'portable-credentials.json', 'second.json']);
  };
  assert.throws(
    () => exportSync.replaceFilesTransactionally(changes.map((change, index) => ({
      ...change,
      validate: index === 2 ? () => { throw new Error('synthetic staging validation failure'); } : change.validate,
    }))),
    /synthetic staging validation failure/
  );
  assertOriginals();
  assert.throws(
    () => exportSync.replaceFilesTransactionally(changes, {
      afterReplace(_record, index) {
        if (index === 1) throw new Error('synthetic late replacement failure');
      },
    }),
    /synthetic late replacement failure/
  );
  assertOriginals();
  assert.throws(
    () => exportSync.replaceFilesTransactionally(changes, {
      beforeVerify(record, index) {
        if (index === 0) fs.writeFileSync(record.target, 'synthetic corruption');
      },
    }),
    /replacement verification failed/
  );
  assertOriginals();
  assert.throws(
    () => exportSync.replaceFilesTransactionally(changes, {
      beforeBackupCleanup(_record, index) {
        if (index === 1) throw new Error('synthetic backup cleanup failure');
      },
    }),
    /synthetic backup cleanup failure/
  );
  assertOriginals();

  exportSync.replaceFilesTransactionally(changes);
  const once = new Map(changes.map((change) => [change.targetPath, fs.readFileSync(change.targetPath)]));
  exportSync.replaceFilesTransactionally(changes);
  for (const change of changes) assert.equal(fs.readFileSync(change.targetPath).equals(once.get(change.targetPath)), true);
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('multi-workflow export performs no canonical or declaration writes when a later target fails policy', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-export-late-policy-'));
  const workflowDir = path.join(fixtureRoot, 'n8n-workflows');
  const exportsDir = path.join(fixtureRoot, 'exports');
  const toolkitDir = path.join(workflowDir, 'toolkit');
  const bindingsPath = path.join(fixtureRoot, '.n8n-local', 'bindings.json');
  const declarationPath = path.join(toolkitDir, 'portable-credentials.json');
  const policyPath = path.join(toolkitDir, 'deployment-policy.json');
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(toolkitDir, { recursive: true });

  const canonicalA = portable.canonicalWorkflowForGit({ ...workflow(), name: 'Workflow A' });
  const canonicalB = portable.canonicalWorkflowForGit({ ...workflow(), name: 'Workflow B' });
  const liveA = { ...workflow(), id: 'live-a', name: 'Workflow A' };
  const liveB = { ...workflow(), id: 'live-b', name: 'Workflow B' };
  liveA.nodes = structuredClone(liveA.nodes);
  liveA.nodes[0].parameters.options.valueInputMode = 'USER_ENTERED';
  const workflowAPath = path.join(workflowDir, 'a.json');
  const workflowBPath = path.join(workflowDir, 'b.json');
  writeFixture(workflowAPath, canonicalA);
  writeFixture(workflowBPath, canonicalB);
  writeFixture(path.join(exportsDir, 'a.live-export.json'), liveA);
  writeFixture(path.join(exportsDir, 'b.live-export.json'), liveB);
  const originalDeclaration = '{"schemaVersion":1,"workflows":[]}\n';
  fs.writeFileSync(declarationPath, originalDeclaration);
  writeFixture(policyPath, {
    schemaVersion: 1,
    workflows: [{
      workflowFile: 'n8n-workflows/b.json',
      workflowId: 'stale-live-id',
      workflowName: 'Workflow B',
      resourcePaths: [],
    }],
  });
  const originals = new Map([
    [workflowAPath, fs.readFileSync(workflowAPath)],
    [workflowBPath, fs.readFileSync(workflowBPath)],
    [declarationPath, fs.readFileSync(declarationPath)],
  ]);
  const result = spawnSync(process.execPath, [
    path.join(helperRoot, 'sync-n8n-live-exports.cjs'),
    exportsDir,
    workflowDir,
    bindingsPath,
    `--portable-credentials=${declarationPath}`,
    `--deployment-policy=${policyPath}`,
  ], { cwd: fixtureRoot, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Conflicting deployment policy workflow selector metadata/);
  for (const [filePath, content] of originals) assert.equal(fs.readFileSync(filePath).equals(content), true);
  assert.equal(fs.existsSync(bindingsPath), false);
  assert.deepEqual(
    fs.readdirSync(workflowDir).filter((name) => /\.(stage|backup|rollback)$/.test(name)),
    []
  );
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
  assert.match(importScript, /Assert-NoCaseFoldedWorkflowFileCollisions \$workflowFiles/);
  assert.match(importScript, /if \(\$null -eq \$targetWorkflow\) \{\s+\$prepareArgs \+= "--allow-unresolved-import"/);
  assert.match(importScript, /N8N_CREDENTIAL_CLEANUP_FAILED/);
  const targetResolution = importScript.match(/function Test-PortableTargetResolution[\s\S]*?function Get-RootWorkflowFiles/);
  assert.ok(targetResolution);
  assert.match(targetResolution[0], /Resolve-LiveWorkflowByName/);
  assert.doesNotMatch(targetResolution[0], /\$nameMatches\.Count -gt 1/);
  const portablePreflight = importScript.match(/function Invoke-PortableWorkflowPreflight[\s\S]*?function Write-BlockedSummary/);
  assert.ok(portablePreflight);
  assert.match(portablePreflight[0], /Resolve-LiveWorkflowByName/);
  assert.doesNotMatch(portablePreflight[0], /\$nameMatches\.Count -gt 1/);
  assert.match(menuScript, /\[switch\]\$RequireConfirmation/);
  assert.match(menuScript, /if \(\$Record\.commandKind -eq "import"\) \{ return \[bool\]\$RequireConfirmation \}/);
  assert.match(menuScript, /Explain Last n8n Failure/);
  assert.match(menuScript, /MainModule\.FileName/);
  assert.match(menuScript, /if \(\$WindowsHost\) \{ "pwsh\.exe" \} else \{ "pwsh" \}/);
  assert.doesNotMatch(menuScript, /Press Enter to return after reviewing the error/);
  assert.doesNotMatch(importScript, /\?\?=|\?\.|ForEach-Object -Parallel/);
});
