const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const FORBIDDEN_WHOLE_PARAMETER_OBJECTS = new Set(['columns', 'mapping', 'assignments', 'filters', 'options', 'schema']);

class N8nPortableWorkflowError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'N8nPortableWorkflowError';
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function normaliseWorkflow(raw) {
  if (Array.isArray(raw)) return raw[0];
  return raw && raw.workflow ? raw.workflow : raw;
}

function workflowSelector(workflow, workflowFile) {
  return {
    workflowFile: workflowFile ? path.relative(process.cwd(), path.resolve(workflowFile)).split(path.sep).join('/') : '',
    workflowId: typeof workflow?.id === 'string' ? workflow.id : '',
    workflowName: typeof workflow?.name === 'string' ? workflow.name : '',
  };
}

function logicalCredentialName(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.name === 'string') return value.name.trim();
  return '';
}

function requirementKey(requirement) {
  if (requirement.nodeId) {
    return ['node-id', requirement.nodeId, requirement.nodeType || '', requirement.credentialType || ''].join('\u0000');
  }
  return ['node-name-type', requirement.nodeName || '', requirement.nodeType || '', requirement.credentialType || ''].join('\u0000');
}

function buildPortableCredentialDeclaration(workflow, workflowFile, previousDeclaration = null) {
  const previousRequired = new Map();
  for (const entry of previousDeclaration?.nodes || []) {
    previousRequired.set(requirementKey(entry), entry.required !== false);
  }

  const nodes = [];
  for (const node of workflow.nodes || []) {
    for (const [credentialType, credentialValue] of Object.entries(node.credentials || {})) {
      const logicalName = logicalCredentialName(credentialValue);
      if (!logicalName) {
        throw new N8nPortableWorkflowError(
          'N8N_POLICY_VALIDATION_FAILED',
          `Credential-bound node "${node.name || node.id || '(unknown)'}" is missing a logical credential name for type "${credentialType}".`
        );
      }
      const requirement = {
        nodeId: typeof node.id === 'string' ? node.id : '',
        nodeName: typeof node.name === 'string' ? node.name : '',
        nodeType: typeof node.type === 'string' ? node.type : '',
        credentialType,
        logicalName,
        required: true,
      };
      if (previousRequired.has(requirementKey(requirement))) {
        requirement.required = previousRequired.get(requirementKey(requirement));
      }
      nodes.push(requirement);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    ...workflowSelector(workflow, workflowFile),
    nodes,
  };
}

function portableCredentials(credentials) {
  const result = {};
  for (const [credentialType, credentialValue] of Object.entries(credentials || {})) {
    const logicalName = logicalCredentialName(credentialValue);
    if (!logicalName) {
      throw new N8nPortableWorkflowError(
        'N8N_POLICY_VALIDATION_FAILED',
        `Credential type "${credentialType}" is missing a logical credential name.`
      );
    }
    result[credentialType] = { id: null, name: logicalName };
  }
  return result;
}

function canonicalWorkflowForGit(workflow, options = {}) {
  const clean = clone(workflow);
  const liveOnlyFields = [
    'id',
    'createdAt',
    'updatedAt',
    'isArchived',
    'shared',
    'staticData',
    'pinData',
    'activeVersionId',
    'versionId',
    'versionCounter',
    'triggerCount',
    'versionMetadata',
  ];

  for (const field of liveOnlyFields) delete clean[field];
  if (!options.preserveTags) {
    delete clean.tags;
    delete clean.tagIds;
  }
  delete clean.credentials;
  clean.active = false;
  if (clean.description == null) delete clean.description;
  if (clean.meta == null) delete clean.meta;

  for (const node of clean.nodes || []) {
    if (node.credentials && Object.keys(node.credentials).length > 0) {
      node.credentials = portableCredentials(node.credentials);
    } else {
      delete node.credentials;
    }
    delete node.webhookId;
  }

  return clean;
}

function parseExactPath(value, { requireParameters = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', 'Overlay paths must be non-empty strings.');
  }
  const raw = value.trim();
  if (raw.includes('*') || raw.includes('..') || raw.startsWith('.') || raw.endsWith('.')) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Unsafe or wildcard overlay path is not allowed: ${raw}`);
  }
  const parts = raw.split('.');
  if (parts.some((part) => !SAFE_SEGMENT.test(part) || FORBIDDEN_SEGMENTS.has(part))) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Unsafe overlay path is not allowed: ${raw}`);
  }
  if (requireParameters && (parts.length < 2 || parts[0] !== 'parameters')) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Resource binding path must target an exact leaf below parameters: ${raw}`);
  }
  if (requireParameters && parts.length === 2 && FORBIDDEN_WHOLE_PARAMETER_OBJECTS.has(parts[1])) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Whole mapping/parameters object overlays are not allowed: ${raw}`);
  }
  return parts;
}

function getAtPath(root, parts) {
  let value = root;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) {
      return { found: false, value: undefined };
    }
    value = value[part];
  }
  return { found: true, value };
}

function setAtPath(root, parts, value) {
  let target = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!target || typeof target !== 'object') {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Overlay parent is not an object at ${parts.slice(0, index + 1).join('.')}.`);
    }
    if (Array.isArray(target) && !/^(0|[1-9][0-9]*)$/.test(part)) {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Overlay array path requires a numeric index at ${parts.slice(0, index + 1).join('.')}.`);
    }
    if (!Object.prototype.hasOwnProperty.call(target, part)) {
      target[part] = /^(0|[1-9][0-9]*)$/.test(parts[index + 1]) ? [] : {};
    }
    target = target[part];
  }
  const leaf = parts.at(-1);
  if (!target || typeof target !== 'object') {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Overlay parent is not an object at ${parts.slice(0, -1).join('.')}.`);
  }
  if (Array.isArray(target) && !/^(0|[1-9][0-9]*)$/.test(leaf)) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Overlay array path requires a numeric index at ${parts.join('.')}.`);
  }
  target[leaf] = clone(value);
}

function deleteAtPath(root, parts) {
  const parent = getAtPath(root, parts.slice(0, -1));
  if (parent.found && parent.value && typeof parent.value === 'object') delete parent.value[parts.at(-1)];
}

function assessSelector(entry, workflow, workflowFile) {
  const selector = workflowSelector(workflow, workflowFile);
  const normalise = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();
  const comparisons = [];
  for (const [key, normaliser] of [['workflowFile', normalise], ['workflowId', String], ['workflowName', String]]) {
    if (!entry[key] || !selector[key]) continue;
    comparisons.push(normaliser(entry[key]) === normaliser(selector[key]));
  }
  return {
    compared: comparisons.length > 0,
    matches: comparisons.length > 0 && comparisons.every(Boolean),
    disagrees: comparisons.some(Boolean) && comparisons.some((matches) => !matches),
  };
}

function selectWorkflowEntry(document, workflow, workflowFile, label) {
  if (!document) return null;
  if (Array.isArray(document.workflows)) {
    const assessed = document.workflows.map((entry) => ({ entry, assessment: assessSelector(entry, workflow, workflowFile) }));
    if (assessed.some(({ assessment }) => assessment.disagrees)) {
      throw new N8nPortableWorkflowError(
        'N8N_POLICY_VALIDATION_FAILED',
        `Conflicting ${label} workflow selector metadata must be corrected before continuing.`
      );
    }
    const matches = assessed.filter(({ assessment }) => assessment.matches).map(({ entry }) => entry);
    if (matches.length > 1) {
      throw new N8nPortableWorkflowError('N8N_WORKFLOW_MATCH_AMBIGUOUS', `Multiple ${label} entries match the canonical workflow.`);
    }
    return matches[0] || null;
  }
  if (Array.isArray(document.nodes) || Array.isArray(document.resourcePaths)) return document;
  return null;
}

function isStaleNodeIdMatch(selector, node) {
  return Boolean(
    selector.nodeId &&
    node.id &&
    selector.nodeId === node.id &&
    selector.nodeType &&
    node.type &&
    selector.nodeType !== node.type
  );
}

function selectNode(workflow, selector) {
  const nodes = workflow.nodes || [];
  if (selector.nodeId) {
    const idMatches = nodes.filter((node) => node.id === selector.nodeId && !isStaleNodeIdMatch(selector, node));
    if (idMatches.length > 1) {
      throw new N8nPortableWorkflowError('N8N_NODE_MATCH_AMBIGUOUS', `Multiple nodes match stable node ID for "${selector.nodeName || selector.nodeId}".`);
    }
    if (idMatches.length === 1) return idMatches[0];
  }
  const matches = nodes.filter((node) => node.name === selector.nodeName && node.type === selector.nodeType);
  if (matches.length > 1) {
    throw new N8nPortableWorkflowError('N8N_NODE_MATCH_AMBIGUOUS', `Multiple nodes match name and type for "${selector.nodeName || '(unknown node)'}".`);
  }
  return matches[0] || null;
}

function sanitisedCredentialDetail(requirement, matchCount) {
  return {
    nodeId: requirement.nodeId || '',
    nodeName: requirement.nodeName || '',
    nodeType: requirement.nodeType || '',
    credentialType: requirement.credentialType,
    logicalName: requirement.logicalName,
    required: requirement.required !== false,
    matchCount,
  };
}

function resolveCredentialRequirements(workflow, requirements, credentialMetadata, options = {}) {
  if (!Array.isArray(credentialMetadata)) {
    throw new N8nPortableWorkflowError(
      'N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE',
      'Target credential metadata is unavailable.',
      { credentials: (requirements || []).map((entry) => sanitisedCredentialDetail(entry, 0)) }
    );
  }

  const issues = [];
  let resolvedCount = 0;
  const allowUnresolvedImport = options.allowUnresolvedImport === true && !options.liveWorkflow;
  for (const requirement of requirements || []) {
    if (!requirement.credentialType || !requirement.logicalName) {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', 'Credential declarations require credentialType and logicalName.');
    }
    const node = selectNode(workflow, requirement);
    if (!node) {
      throw new N8nPortableWorkflowError(
        'N8N_POLICY_VALIDATION_FAILED',
        `Credential declaration does not match a canonical node: ${requirement.nodeName || requirement.nodeId || '(unknown node)'}.`
      );
    }

    const sameName = credentialMetadata.filter((entry) => entry && entry.name === requirement.logicalName);
    const exact = sameName.filter((entry) => entry.type === requirement.credentialType);
    if (exact.length === 1) {
      node.credentials = node.credentials && typeof node.credentials === 'object' ? node.credentials : {};
      node.credentials[requirement.credentialType] = {
        id: exact[0].id,
        name: requirement.logicalName,
      };
      resolvedCount += 1;
      continue;
    }

    let code = 'N8N_CREDENTIAL_MISSING';
    if (exact.length > 1) code = 'N8N_CREDENTIAL_AMBIGUOUS';
    else if (sameName.length > 0) code = 'N8N_CREDENTIAL_TYPE_MISMATCH';
    const issue = { code, ...sanitisedCredentialDetail(requirement, exact.length) };
    issues.push(issue);
    if (allowUnresolvedImport && code === 'N8N_CREDENTIAL_MISSING') {
      node.credentials = node.credentials && typeof node.credentials === 'object' ? node.credentials : {};
      node.credentials[requirement.credentialType] = { id: null, name: requirement.logicalName };
    } else if (requirement.required === false && code === 'N8N_CREDENTIAL_MISSING') {
      const liveNode = options.liveWorkflow ? selectNode(options.liveWorkflow, requirement) : null;
      const liveBinding = liveNode?.credentials?.[requirement.credentialType];
      if (liveBinding && typeof liveBinding === 'object' && typeof liveBinding.id === 'string' && liveBinding.id) {
        node.credentials = node.credentials && typeof node.credentials === 'object' ? node.credentials : {};
        node.credentials[requirement.credentialType] = clone(liveBinding);
      } else if (node.credentials && typeof node.credentials === 'object') {
        delete node.credentials[requirement.credentialType];
        if (Object.keys(node.credentials).length === 0) delete node.credentials;
      }
    }
  }

  const blocking = issues.filter((issue) => {
    if (issue.required === false && issue.code === 'N8N_CREDENTIAL_MISSING') return false;
    return !(allowUnresolvedImport && issue.code === 'N8N_CREDENTIAL_MISSING');
  });
  return {
    resolvedCount,
    issues,
    blocking,
    unresolvedImport: allowUnresolvedImport && issues.some((issue) => issue.code === 'N8N_CREDENTIAL_MISSING'),
  };
}

function uniqueResourceBinding(bindingEntry, node, resourcePath) {
  const entries = bindingEntry?.nodes || [];
  const idMatches = node.id ? entries.filter((entry) => entry.nodeId && entry.nodeId === node.id) : [];
  if (idMatches.length > 1) {
    throw new N8nPortableWorkflowError('N8N_NODE_MATCH_AMBIGUOUS', `Multiple resource-binding nodes match "${node.name || node.id}".`);
  }
  if (idMatches.length === 1) {
    const [binding] = idMatches;
    if (!binding.nodeType || binding.nodeType !== node.type || (binding.nodeName && binding.nodeName !== node.name)) {
      throw new N8nPortableWorkflowError(
        'N8N_POLICY_VALIDATION_FAILED',
        `Resource binding for stable node ID is stale for "${node.name || node.id}".`
      );
    }
  }
  const staleIdFallbacks = idMatches.length === 0
    ? entries.filter((entry) =>
      entry.nodeId &&
      entry.nodeId !== node.id &&
      entry.nodeName === node.name &&
      entry.nodeType === node.type
    )
    : [];
  if (staleIdFallbacks.length > 0) {
    throw new N8nPortableWorkflowError(
      'N8N_POLICY_VALIDATION_FAILED',
      `Resource binding stable node ID is stale for "${node.name || node.id}".`
    );
  }
  const matchingNodes = idMatches.length > 0
    ? idMatches
    : entries.filter((entry) => !entry.nodeId && entry.nodeName === node.name && entry.nodeType === node.type);
  if (matchingNodes.length > 1) {
    throw new N8nPortableWorkflowError('N8N_NODE_MATCH_AMBIGUOUS', `Multiple resource-binding nodes match "${node.name || node.id}".`);
  }
  const value = matchingNodes[0]?.values?.[resourcePath];
  return { found: value !== undefined, value };
}

function applyExactResourceBindings(workflow, policyEntry, bindingEntry, allowedPaths) {
  let appliedCount = 0;
  const missing = [];
  for (const rule of policyEntry?.resourcePaths || []) {
    const parts = parseExactPath(rule.path, { requireParameters: true });
    const node = selectNode(workflow, rule);
    if (!node) {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Resource policy does not match node "${rule.nodeName || rule.nodeId}".`);
    }
    const current = getAtPath(node, parts);
    if (current.found && current.value && typeof current.value === 'object') {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Whole-object resource overlay is not allowed: ${rule.path}`);
    }
    if (rule.environmentSpecific !== true) continue;
    const binding = uniqueResourceBinding(bindingEntry, node, rule.path);
    if (!binding.found) {
      if (rule.required !== false) {
        missing.push({ nodeId: node.id || '', nodeName: node.name || '', nodeType: node.type || '', path: rule.path });
      }
      continue;
    }
    if (binding.value && typeof binding.value === 'object') {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Resource binding values must be scalar at ${rule.path}.`);
    }
    setAtPath(node, parts, binding.value);
    allowedPaths.add(`nodes.${workflow.nodes.indexOf(node)}.${rule.path}`);
    appliedCount += 1;
  }
  if (missing.length > 0) {
    throw new N8nPortableWorkflowError('N8N_RESOURCE_BINDING_MISSING', 'Required exact resource binding is missing.', { resources: missing });
  }
  return appliedCount;
}

function restoreDedicatedWebhookMetadata(workflow, liveWorkflow, allowedPaths) {
  if (!liveWorkflow || !Array.isArray(liveWorkflow.nodes)) return 0;
  let restored = 0;
  for (const node of workflow.nodes || []) {
    const liveNode = selectNode(liveWorkflow, { nodeId: node.id, nodeName: node.name, nodeType: node.type });
    if (liveNode?.webhookId) {
      node.webhookId = liveNode.webhookId;
      allowedPaths.add(`nodes.${workflow.nodes.indexOf(node)}.webhookId`);
      restored += 1;
    }
  }
  return restored;
}

function collectDiffPaths(left, right, prefix = '', output = []) {
  if (JSON.stringify(left) === JSON.stringify(right)) return output;
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      collectDiffPaths(left[index], right[index], prefix ? `${prefix}.${index}` : String(index), output);
    }
    return output;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].sort()) {
      collectDiffPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  output.push(prefix || '(root)');
  return output;
}

function isAllowedDiff(diffPath, allowedPaths) {
  for (const allowed of allowedPaths) {
    if (diffPath === allowed || diffPath.startsWith(`${allowed}.`)) return true;
  }
  return false;
}

function assertCanonicalInvariant(canonical, prepared, allowedPaths) {
  const differences = collectDiffPaths(canonical, prepared);
  const unexpected = differences.filter((diffPath) => !isAllowedDiff(diffPath, allowedPaths));
  if (unexpected.length > 0) {
    throw new N8nPortableWorkflowError(
      'N8N_CANONICAL_INVARIANT_FAILED',
      'Prepared workflow differs from canonical Git outside authorised overlay paths.',
      { unexpectedPaths: unexpected.slice(0, 25) }
    );
  }
  return { differenceCount: differences.length, allowedPaths: [...allowedPaths].sort() };
}

function validatePreparedWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.nodes) || !workflow.connections || typeof workflow.connections !== 'object') {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', 'Prepared workflow must contain nodes and connections.');
  }
  if (workflow.active !== false) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', 'Prepared workflow must remain inactive.');
  }
}

function assertCredentialDeclarationCoverage(canonicalWorkflow, liveWorkflow, requirements) {
  const declared = new Set();
  for (const requirement of requirements) {
    const node = selectNode(canonicalWorkflow, requirement);
    if (!node) continue;
    declared.add(`${node.id || `${node.name}\u0000${node.type}`}\u0000${requirement.credentialType}`);
  }
  for (const node of canonicalWorkflow.nodes || []) {
    for (const credentialType of Object.keys(node.credentials || {})) {
      const key = `${node.id || `${node.name}\u0000${node.type}`}\u0000${credentialType}`;
      if (!declared.has(key)) {
        throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Canonical credential reference is missing a portable declaration for node "${node.name || node.id}" and type "${credentialType}".`);
      }
    }
  }
  if (!liveWorkflow) return;
  for (const liveNode of liveWorkflow.nodes || []) {
    const canonicalNode = selectNode(canonicalWorkflow, { nodeId: liveNode.id, nodeName: liveNode.name, nodeType: liveNode.type });
    if (!canonicalNode) continue;
    for (const credentialType of Object.keys(liveNode.credentials || {})) {
      const key = `${canonicalNode.id || `${canonicalNode.name}\u0000${canonicalNode.type}`}\u0000${credentialType}`;
      if (!declared.has(key)) {
        throw new N8nPortableWorkflowError(
          'N8N_POLICY_VALIDATION_FAILED',
          `Target node "${canonicalNode.name || canonicalNode.id}" has an undeclared credential type "${credentialType}". Run canonical export before import; no credential ID was copied.`
        );
      }
    }
  }
}

function preparePortableWorkflow(options) {
  const canonical = clone(options.canonicalWorkflow);
  const prepared = clone(options.canonicalWorkflow);
  const allowedPaths = new Set();
  const phases = [
    'load-canonical-workflow',
    'load-portable-credential-declarations',
    'load-deployment-resource-policy',
    'resolve-target-workflow-and-node',
    'discover-target-credential-metadata',
  ];

  prepared.active = false;
  const liveWorkflowId = typeof options.liveWorkflow?.id === 'string' ? options.liveWorkflow.id : '';
  const requestedWorkflowId = typeof options.targetWorkflowId === 'string' ? options.targetWorkflowId : '';
  if (liveWorkflowId && requestedWorkflowId && liveWorkflowId !== requestedWorkflowId) {
    throw new N8nPortableWorkflowError(
      'N8N_POLICY_VALIDATION_FAILED',
      'Resolved live workflow identity conflicts with the requested target workflow ID.'
    );
  }
  const selectorWorkflow = {
    ...prepared,
    id: liveWorkflowId || requestedWorkflowId || prepared.id || '',
  };
  const declarationEntry = selectWorkflowEntry(options.credentialDeclarations, selectorWorkflow, options.workflowFile, 'credential declaration');
  const policyEntry = selectWorkflowEntry(options.deploymentPolicy, selectorWorkflow, options.workflowFile, 'deployment policy');
  const bindingEntry = selectWorkflowEntry(options.resourceBindings, selectorWorkflow, options.workflowFile, 'resource binding');
  const requirements = declarationEntry?.nodes || [];
  assertCredentialDeclarationCoverage(prepared, options.liveWorkflow, requirements);

  const credentialResult = resolveCredentialRequirements(prepared, requirements, options.credentialMetadata, {
    allowUnresolvedImport: options.allowUnresolvedImport === true,
    liveWorkflow: options.liveWorkflow,
  });
  for (const requirement of requirements) {
    const node = selectNode(prepared, requirement);
    const nodeIndex = prepared.nodes.indexOf(node);
    allowedPaths.add(`nodes.${nodeIndex}.credentials.${requirement.credentialType}`);
  }
  phases.push('apply-credential-bindings');

  if (credentialResult.blocking.length > 0) {
    const first = credentialResult.blocking[0];
    throw new N8nPortableWorkflowError(first.code, 'Credential requirement could not be resolved safely.', { credentials: credentialResult.issues });
  }

  const restoredWebhookIds = restoreDedicatedWebhookMetadata(prepared, options.liveWorkflow, allowedPaths);
  phases.push('restore-dedicated-identity-webhook-metadata');

  if (options.targetWorkflowId) {
    prepared.id = options.targetWorkflowId;
    allowedPaths.add('id');
  }
  const resourceBindingCount = applyExactResourceBindings(prepared, policyEntry, bindingEntry, allowedPaths);
  phases.push('apply-exact-resource-bindings');

  validatePreparedWorkflow(prepared);
  phases.push('validate-prepared-workflow');
  const invariant = assertCanonicalInvariant(canonical, prepared, allowedPaths);
  phases.push('validate-canonical-invariant');

  return {
    preparedWorkflow: prepared,
    phases,
    credentialResult,
    resourceBindingCount,
    restoredWebhookIds,
    invariant,
  };
}

function policyPathsForExport(policyEntry) {
  const protectedPaths = [];
  for (const rule of policyEntry?.protectedPaths || []) {
    protectedPaths.push({ ...rule, parts: parseExactPath(rule.path, { requireParameters: true }) });
  }
  for (const rule of policyEntry?.resourcePaths || []) {
    if (rule.environmentSpecific === true) {
      protectedPaths.push({ ...rule, parts: parseExactPath(rule.path, { requireParameters: true }), privateResource: true });
    }
  }
  return protectedPaths;
}

const PROTECTED_MAPPING_PARAMETER_KEYS = new Set([
  'columns',
  'mapping',
  'assignments',
  'filters',
  'options',
  'matchingColumns',
  'valueInputMode',
  'valueInputOption',
  'rawData',
]);

function protectCanonicalMappingDomains(portable, previous, protectedChanges) {
  if (!previous) return;
  for (const previousNode of previous.nodes || []) {
    const portableNode = selectNode(portable, {
      nodeId: previousNode.id,
      nodeName: previousNode.name,
      nodeType: previousNode.type,
    });
    if (!portableNode || !previousNode.parameters || !portableNode.parameters) continue;

    for (const key of PROTECTED_MAPPING_PARAMETER_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(previousNode.parameters, key)) continue;
      const before = previousNode.parameters[key];
      const after = portableNode.parameters[key];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        portableNode.parameters[key] = clone(before);
        protectedChanges.push({ nodeName: portableNode.name || '', nodeType: portableNode.type || '', path: `parameters.${key}` });
      }
    }

    const preserveChangedExpressions = (previousValue, portableValue, parts) => {
      if (typeof previousValue === 'string' && previousValue.startsWith('=')) {
        if (previousValue !== portableValue) {
          setAtPath(portableNode, ['parameters', ...parts], previousValue);
          protectedChanges.push({ nodeName: portableNode.name || '', nodeType: portableNode.type || '', path: ['parameters', ...parts].join('.') });
        }
        return;
      }
      if (!previousValue || typeof previousValue !== 'object') return;
      for (const [key, entry] of Object.entries(previousValue)) {
        preserveChangedExpressions(entry, portableValue && typeof portableValue === 'object' ? portableValue[key] : undefined, [...parts, key]);
      }
    };
    preserveChangedExpressions(previousNode.parameters, portableNode.parameters, []);
  }
}

function canonicaliseExport(options) {
  const portable = canonicalWorkflowForGit(options.liveWorkflow, { preserveTags: options.preserveTags });
  const previous = options.canonicalWorkflow ? clone(options.canonicalWorkflow) : null;
  const policyEntry = selectWorkflowEntry(options.deploymentPolicy, options.liveWorkflow, options.workflowFile, 'deployment policy');
  const protectedPaths = policyPathsForExport(policyEntry);
  const protectedChanges = [];

  if (options.reviewedSourceUpdate !== true) protectCanonicalMappingDomains(portable, previous, protectedChanges);

  for (const rule of protectedPaths) {
    const portableNode = selectNode(portable, rule);
    const previousNode = previous ? selectNode(previous, rule) : null;
    if (!portableNode) {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Export policy does not match live node "${rule.nodeName || rule.nodeId}".`);
    }
    const nextValue = getAtPath(portableNode, rule.parts);
    const previousValue = previousNode ? getAtPath(previousNode, rule.parts) : { found: false };
    if (rule.privateResource && !previousValue.found) {
      deleteAtPath(portableNode, rule.parts);
      throw new N8nPortableWorkflowError(
        'N8N_RESOURCE_BINDING_MISSING',
        `Private environment-specific resource path cannot be written to Git without an existing approved canonical value: ${rule.path}`
      );
    }
    if (options.reviewedSourceUpdate === true && !rule.privateResource) continue;
    if (previousValue.found && JSON.stringify(previousValue.value) !== JSON.stringify(nextValue.value)) {
      setAtPath(portableNode, rule.parts, previousValue.value);
      protectedChanges.push({ nodeName: portableNode.name || '', nodeType: portableNode.type || '', path: rule.path });
    }
  }

  return {
    workflow: portable,
    protectedChanges,
    declaration: buildPortableCredentialDeclaration(portable, options.workflowFile, options.previousDeclaration),
  };
}

function mergeCredentialDeclarationDocument(document, declaration) {
  const next = document && typeof document === 'object' ? clone(document) : { schemaVersion: SCHEMA_VERSION, workflows: [] };
  next.schemaVersion = SCHEMA_VERSION;
  next.workflows = Array.isArray(next.workflows) ? next.workflows : [];
  const exactFileIndex = next.workflows.findIndex((entry) => entry.workflowFile && entry.workflowFile === declaration.workflowFile);
  const foldedFileMatches = next.workflows.filter((entry) =>
    entry.workflowFile &&
    declaration.workflowFile &&
    entry.workflowFile.toLowerCase() === declaration.workflowFile.toLowerCase()
  );
  if (exactFileIndex < 0 && foldedFileMatches.length > 0) {
    throw new N8nPortableWorkflowError(
      'N8N_WORKFLOW_MATCH_AMBIGUOUS',
      'Portable credential declarations contain case-folded workflow filename collisions.'
    );
  }
  const idIndex = next.workflows.findIndex((entry) =>
    entry.workflowId && declaration.workflowId && entry.workflowId === declaration.workflowId
  );
  const index = exactFileIndex >= 0 ? exactFileIndex : idIndex;
  if (index >= 0) next.workflows[index] = declaration;
  else next.workflows.push(declaration);
  next.workflows.sort((left, right) => String(left.workflowFile || left.workflowName).localeCompare(String(right.workflowFile || right.workflowName)));
  return next;
}

module.exports = {
  SCHEMA_VERSION,
  N8nPortableWorkflowError,
  readJson,
  normaliseWorkflow,
  workflowSelector,
  buildPortableCredentialDeclaration,
  canonicalWorkflowForGit,
  canonicaliseExport,
  mergeCredentialDeclarationDocument,
  parseExactPath,
  getAtPath,
  setAtPath,
  selectWorkflowEntry,
  selectNode,
  resolveCredentialRequirements,
  applyExactResourceBindings,
  restoreDedicatedWebhookMetadata,
  collectDiffPaths,
  assertCanonicalInvariant,
  validatePreparedWorkflow,
  assertCredentialDeclarationCoverage,
  preparePortableWorkflow,
};
