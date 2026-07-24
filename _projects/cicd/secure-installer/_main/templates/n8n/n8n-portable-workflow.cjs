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
    result[credentialType] = { name: logicalName };
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

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label} must be a plain object.`);
  }
}

function assertOnlyKeys(value, allowedKeys, label) {
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label} contains unsupported fields.`);
  }
}

function assertOptionalString(value, label) {
  if (value !== undefined && (typeof value !== 'string' || (value.length > 0 && !value.trim()))) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label} must be a string and cannot contain only whitespace.`);
  }
}

function validateNodeSelector(selector, label) {
  assertPlainObject(selector, label);
  assertOptionalString(selector.nodeId, `${label}.nodeId`);
  assertOptionalString(selector.nodeName, `${label}.nodeName`);
  assertOptionalString(selector.nodeType, `${label}.nodeType`);
  if (!selector.nodeId?.trim() && !selector.nodeName?.trim()) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label} requires nodeId or nodeName.`);
  }
  if (!selector.nodeType?.trim()) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label}.nodeType is required.`);
  }
}

function validateWorkflowSelector(entry, label) {
  for (const field of ['workflowFile', 'workflowId', 'workflowName']) {
    assertOptionalString(entry[field], `${label}.${field}`);
  }
  if (!entry.workflowFile?.trim() && !entry.workflowId?.trim() && !entry.workflowName?.trim()) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label} requires a workflow selector.`);
  }
}

function validateCredentialRequirement(requirement, label) {
  validateNodeSelector(requirement, label);
  assertOnlyKeys(
    requirement,
    new Set(['nodeId', 'nodeName', 'nodeType', 'credentialType', 'logicalName', 'required']),
    label
  );
  assertOptionalString(requirement.credentialType, `${label}.credentialType`);
  assertOptionalString(requirement.logicalName, `${label}.logicalName`);
  if (!requirement.credentialType?.trim() || !requirement.logicalName?.trim() || typeof requirement.required !== 'boolean') {
    throw new N8nPortableWorkflowError(
      'N8N_POLICY_VALIDATION_FAILED',
      `${label} requires credentialType, logicalName, and a boolean required state.`
    );
  }
}

function validatePathRule(rule, label, kind) {
  validateNodeSelector(rule, label);
  assertOnlyKeys(
    rule,
    new Set(['nodeId', 'nodeName', 'nodeType', 'path', 'environmentSpecific', 'required']),
    label
  );
  parseExactPath(rule.path, { requireParameters: true });
  if (kind === 'resource' && typeof rule.environmentSpecific !== 'boolean') {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label}.environmentSpecific must be boolean.`);
  }
  if (rule.required !== undefined && typeof rule.required !== 'boolean') {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label}.required must be boolean when supplied.`);
  }
}

function validateResourceBindingNode(binding, label) {
  validateNodeSelector(binding, label);
  assertOnlyKeys(binding, new Set(['nodeId', 'nodeName', 'nodeType', 'values']), label);
  assertPlainObject(binding.values, `${label}.values`);
  for (const [resourcePath, value] of Object.entries(binding.values)) {
    parseExactPath(resourcePath, { requireParameters: true });
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label}.values must contain scalar leaves.`);
    }
  }
}

function validateWorkflowDocumentEntry(entry, kind, label, options = {}) {
  assertPlainObject(entry, label);
  validateWorkflowSelector(entry, label);
  if (Object.prototype.hasOwnProperty.call(entry, 'schemaVersion') && entry.schemaVersion !== SCHEMA_VERSION) {
    throw new N8nPortableWorkflowError(
      'N8N_POLICY_VALIDATION_FAILED',
      `${label}.schemaVersion must be ${SCHEMA_VERSION} when supplied for legacy migration.`
    );
  }
  const versionFields = options.allowLegacySchemaVersion === true ? ['schemaVersion'] : [];
  if (kind === 'credential-declarations') {
    assertOnlyKeys(
      entry,
      new Set([...versionFields, 'workflowFile', 'workflowId', 'workflowName', 'nodes']),
      label
    );
    if (!Array.isArray(entry.nodes)) {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label}.nodes must be an array.`);
    }
    entry.nodes.forEach((requirement, index) => validateCredentialRequirement(requirement, `${label}.nodes[${index}]`));
    return;
  }
  if (kind === 'deployment-policy') {
    assertOnlyKeys(
      entry,
      new Set([...versionFields, 'workflowFile', 'workflowId', 'workflowName', 'protectedPaths', 'resourcePaths']),
      label
    );
    for (const [field, ruleKind] of [['protectedPaths', 'protected'], ['resourcePaths', 'resource']]) {
      if (entry[field] !== undefined && !Array.isArray(entry[field])) {
        throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label}.${field} must be an array.`);
      }
      (entry[field] || []).forEach((rule, index) => validatePathRule(rule, `${label}.${field}[${index}]`, ruleKind));
    }
    return;
  }
  if (kind === 'resource-bindings') {
    assertOnlyKeys(
      entry,
      new Set([...versionFields, 'workflowFile', 'workflowId', 'workflowName', 'nodes']),
      label
    );
    if (!Array.isArray(entry.nodes)) {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${label}.nodes must be an array.`);
    }
    entry.nodes.forEach((binding, index) => validateResourceBindingNode(binding, `${label}.nodes[${index}]`));
    return;
  }
  throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `Unsupported portable document type: ${kind}.`);
}

function validatePortableDocument(document, kind, options = {}) {
  if (document === undefined && options.allowAbsent !== false) return null;
  assertPlainObject(document, `${kind} document`);
  if (document.schemaVersion !== SCHEMA_VERSION) {
    throw new N8nPortableWorkflowError(
      'N8N_POLICY_VALIDATION_FAILED',
      `${kind} document requires schemaVersion ${SCHEMA_VERSION}.`
    );
  }

  const hasWorkflows = Object.prototype.hasOwnProperty.call(document, 'workflows');
  const directFields = ['nodes', 'protectedPaths', 'resourcePaths'].filter((field) =>
    Object.prototype.hasOwnProperty.call(document, field)
  );
  const permittedRootKeys = hasWorkflows
    ? new Set(['schemaVersion', 'workflows'])
    : new Set(['schemaVersion', 'workflowFile', 'workflowId', 'workflowName', ...directFields]);
  const unknownRootKeys = Object.keys(document).filter((key) => !permittedRootKeys.has(key));
  if (unknownRootKeys.length > 0) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${kind} document has unsupported top-level fields.`);
  }
  if (hasWorkflows && directFields.length > 0) {
    throw new N8nPortableWorkflowError(
      'N8N_POLICY_VALIDATION_FAILED',
      `${kind} document cannot combine workflows with a direct document form.`
    );
  }
  if (hasWorkflows) {
    if (!Array.isArray(document.workflows)) {
      throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${kind} document.workflows must be an array.`);
    }
    const foldedWorkflowFiles = new Map();
    document.workflows.forEach((entry, index) => {
      validateWorkflowDocumentEntry(
        entry,
        kind,
        `${kind} document.workflows[${index}]`,
        { allowLegacySchemaVersion: true }
      );
      if (!entry.workflowFile) return;
      const normalized = entry.workflowFile.replace(/\\/g, '/');
      const folded = normalized.toLowerCase();
      const previous = foldedWorkflowFiles.get(folded);
      if (previous && previous !== normalized) {
        throw new N8nPortableWorkflowError(
          'N8N_WORKFLOW_MATCH_AMBIGUOUS',
          `${kind} document contains case-folded workflow filename collisions.`
        );
      }
      foldedWorkflowFiles.set(folded, normalized);
    });
    return document;
  }

  const allowedDirectFields = kind === 'credential-declarations'
    ? ['nodes']
    : kind === 'deployment-policy'
      ? ['protectedPaths', 'resourcePaths']
      : kind === 'resource-bindings'
        ? ['nodes']
        : [];
  if (directFields.length === 0 || directFields.some((field) => !allowedDirectFields.includes(field))) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', `${kind} document has an unsupported container form.`);
  }
  validateWorkflowDocumentEntry(
    document,
    kind,
    `${kind} direct document`,
    { allowLegacySchemaVersion: true }
  );
  return document;
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
  if (!parent.found || !parent.value || typeof parent.value !== 'object') return false;
  const leaf = parts.at(-1);
  if (Array.isArray(parent.value) && /^(0|[1-9][0-9]*)$/.test(leaf)) {
    throw new N8nPortableWorkflowError(
      'N8N_POLICY_VALIDATION_FAILED',
      'Canonical protected-path absence cannot be restored by deleting an array element.'
    );
  }
  if (!Object.prototype.hasOwnProperty.call(parent.value, leaf)) return false;
  delete parent.value[leaf];
  return true;
}

function assessSelector(entry, workflow, workflowFile) {
  const selector = workflowSelector(workflow, workflowFile);
  const normalise = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();
  const comparisons = [];
  for (const [key, normaliser] of [['workflowFile', normalise], ['workflowId', String], ['workflowName', String]]) {
    if (!entry[key]) continue;
    comparisons.push(Boolean(selector[key]) && normaliser(entry[key]) === normaliser(selector[key]));
  }
  return {
    compared: comparisons.length > 0,
    matches: comparisons.length > 0 && comparisons.every(Boolean),
    disagrees: comparisons.some(Boolean) && comparisons.some((matches) => !matches),
  };
}

function selectWorkflowEntry(document, workflow, workflowFile, label, kind) {
  if (document === undefined) return null;
  validatePortableDocument(document, kind);
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
  const assessment = assessSelector(document, workflow, workflowFile);
  if (!assessment.compared || !assessment.matches) {
    throw new N8nPortableWorkflowError(
      'N8N_POLICY_VALIDATION_FAILED',
      `Direct ${label} workflow selectors must all match the canonical workflow.`
    );
  }
  return document;
}

function selectNode(workflow, selector, options = {}) {
  const nodes = workflow.nodes || [];
  if (selector.nodeId) {
    const idMatches = nodes.filter((node) => node.id === selector.nodeId);
    if (idMatches.length > 1) {
      throw new N8nPortableWorkflowError('N8N_NODE_MATCH_AMBIGUOUS', `Multiple nodes match stable node ID for "${selector.nodeName || selector.nodeId}".`);
    }
    if (idMatches.length === 1) {
      const [node] = idMatches;
      if (selector.nodeType && node.type !== selector.nodeType) {
        throw new N8nPortableWorkflowError(
          'N8N_POLICY_VALIDATION_FAILED',
          `Stable node ID resolves to a conflicting node type for "${selector.nodeName || selector.nodeId}".`
        );
      }
      if (options.requireNameMatchForId === true && selector.nodeName && node.name !== selector.nodeName) {
        throw new N8nPortableWorkflowError(
          'N8N_POLICY_VALIDATION_FAILED',
          `Stable node ID resolves to a conflicting node name for "${selector.nodeName}".`
        );
      }
      return node;
    }
    if (options.allowStaleIdFallback !== true) return null;
  }
  const matches = nodes.filter((node) => node.name === selector.nodeName && node.type === selector.nodeType);
  if (matches.length > 1) {
    throw new N8nPortableWorkflowError('N8N_NODE_MATCH_AMBIGUOUS', `Multiple nodes match name and type for "${selector.nodeName || '(unknown node)'}".`);
  }
  return matches[0] || null;
}

function resolvedCredentialKey(node, credentialType) {
  const identity = node.id
    ? `node-id\u0000${node.id}`
    : `node-name-type\u0000${node.name || ''}\u0000${node.type || ''}`;
  return `${identity}\u0000${node.type || ''}\u0000${credentialType || ''}`;
}

function resolveCredentialRequirementSet(workflow, requirements) {
  if (!Array.isArray(requirements)) {
    throw new N8nPortableWorkflowError('N8N_POLICY_VALIDATION_FAILED', 'Credential requirements must be an array.');
  }
  const seen = new Set();
  return requirements.map((requirement) => {
    validateCredentialRequirement(requirement, 'credential requirement');
    const node = selectNode(workflow, requirement, { allowStaleIdFallback: true });
    if (!node) {
      throw new N8nPortableWorkflowError(
        'N8N_POLICY_VALIDATION_FAILED',
        `Credential declaration does not match a canonical node: ${requirement.nodeName || requirement.nodeId || '(unknown node)'}.`
      );
    }
    const key = resolvedCredentialKey(node, requirement.credentialType);
    if (seen.has(key)) {
      throw new N8nPortableWorkflowError(
        'N8N_POLICY_VALIDATION_FAILED',
        'Multiple credential declarations resolve to the same canonical node and credential type.'
      );
    }
    seen.add(key);
    return { requirement, node, key };
  });
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
  const resolvedRequirements = resolveCredentialRequirementSet(workflow, requirements || []);
  if (!Array.isArray(credentialMetadata)) {
    throw new N8nPortableWorkflowError(
      'N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE',
      'Target credential metadata is unavailable.',
      { credentials: (requirements || []).map((entry) => sanitisedCredentialDetail(entry, 0)) }
    );
  }

  const issues = [];
  const actions = [];
  const allowUnresolvedImport = options.allowUnresolvedImport === true && !options.liveWorkflow;
  for (const { requirement, node } of resolvedRequirements) {
    const sameName = credentialMetadata.filter((entry) => entry && entry.name === requirement.logicalName);
    const exact = sameName.filter((entry) => entry.type === requirement.credentialType);
    if (exact.length === 1) {
      actions.push({ kind: 'bind', node, requirement, credential: exact[0] });
      continue;
    }

    let code = 'N8N_CREDENTIAL_MISSING';
    if (exact.length > 1) code = 'N8N_CREDENTIAL_AMBIGUOUS';
    else if (sameName.length > 0) code = 'N8N_CREDENTIAL_TYPE_MISMATCH';
    const issue = { code, ...sanitisedCredentialDetail(requirement, exact.length) };
    issues.push(issue);
    if (requirement.required === false && code === 'N8N_CREDENTIAL_MISSING') {
      const liveNode = options.liveWorkflow
        ? selectNode(options.liveWorkflow, requirement, { allowStaleIdFallback: true })
        : null;
      const liveBinding = liveNode?.credentials?.[requirement.credentialType];
      if (liveBinding && typeof liveBinding === 'object' && typeof liveBinding.id === 'string' && liveBinding.id) {
        actions.push({ kind: 'preserve', node, requirement, liveBinding });
      } else {
        actions.push({ kind: 'remove', node, requirement });
      }
    } else if (allowUnresolvedImport && code === 'N8N_CREDENTIAL_MISSING') {
      actions.push({ kind: 'unresolved', node, requirement });
    }
  }

  const blocking = issues.filter((issue) => {
    if (issue.required === false && issue.code === 'N8N_CREDENTIAL_MISSING') return false;
    return !(allowUnresolvedImport && issue.code === 'N8N_CREDENTIAL_MISSING');
  });
  const requiredMissing = issues.filter((issue) =>
    issue.required !== false && issue.code === 'N8N_CREDENTIAL_MISSING'
  );
  const optionalMissing = issues.filter((issue) =>
    issue.required === false && issue.code === 'N8N_CREDENTIAL_MISSING'
  );
  const unsafe = issues.filter((issue) => issue.code !== 'N8N_CREDENTIAL_MISSING');
  if (blocking.length === 0) {
    for (const action of actions) {
      const { node, requirement } = action;
      if (action.kind === 'remove') {
        if (node.credentials && typeof node.credentials === 'object') {
          delete node.credentials[requirement.credentialType];
          if (Object.keys(node.credentials).length === 0) delete node.credentials;
        }
        continue;
      }
      node.credentials = node.credentials && typeof node.credentials === 'object' ? node.credentials : {};
      if (action.kind === 'bind') {
        node.credentials[requirement.credentialType] = {
          id: action.credential.id,
          name: requirement.logicalName,
        };
      } else if (action.kind === 'unresolved') {
        node.credentials[requirement.credentialType] = { id: null, name: requirement.logicalName };
      } else {
        node.credentials[requirement.credentialType] = clone(action.liveBinding);
      }
    }
  }
  return {
    resolvedCount: actions.filter((action) => action.kind === 'bind').length,
    issues,
    blocking,
    requiredMissing,
    optionalMissing,
    unsafe,
    unresolvedImport: allowUnresolvedImport && requiredMissing.length > 0,
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
    const node = selectNode(workflow, rule, { allowStaleIdFallback: true });
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
    const liveNode = selectNode(
      liveWorkflow,
      { nodeId: node.id, nodeName: node.name, nodeType: node.type },
      { allowStaleIdFallback: true }
    );
    if (liveNode?.webhookId) {
      node.webhookId = liveNode.webhookId;
      allowedPaths.add(`nodes.${workflow.nodes.indexOf(node)}.webhookId`);
      restored += 1;
    }
  }
  return restored;
}

function stripDedicatedWebhookMetadata(workflow, allowedPaths) {
  let stripped = 0;
  for (let index = 0; index < (workflow.nodes || []).length; index += 1) {
    const node = workflow.nodes[index];
    if (!Object.prototype.hasOwnProperty.call(node, 'webhookId')) continue;
    delete node.webhookId;
    allowedPaths.add(`nodes.${index}.webhookId`);
    stripped += 1;
  }
  return stripped;
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
  const resolvedRequirements = resolveCredentialRequirementSet(canonicalWorkflow, requirements);
  const canonicalReferences = new Map();
  for (const node of canonicalWorkflow.nodes || []) {
    for (const [credentialType, value] of Object.entries(node.credentials || {})) {
      const logicalName = logicalCredentialName(value);
      if (!logicalName) {
        throw new N8nPortableWorkflowError(
          'N8N_POLICY_VALIDATION_FAILED',
          `Canonical credential reference is missing a logical name for node "${node.name || node.id}" and type "${credentialType}".`
        );
      }
      canonicalReferences.set(resolvedCredentialKey(node, credentialType), { node, credentialType, logicalName });
    }
  }
  const declared = new Set();
  for (const { requirement, key } of resolvedRequirements) {
    const canonicalReference = canonicalReferences.get(key);
    if (!canonicalReference) {
      throw new N8nPortableWorkflowError(
        'N8N_POLICY_VALIDATION_FAILED',
        'Portable credential declaration does not cover a canonical credential reference.'
      );
    }
    if (requirement.logicalName !== canonicalReference.logicalName) {
      throw new N8nPortableWorkflowError(
        'N8N_POLICY_VALIDATION_FAILED',
        'Portable credential declaration logical name does not match canonical Git.'
      );
    }
    declared.add(key);
  }
  for (const [key, reference] of canonicalReferences) {
    if (!declared.has(key)) {
      throw new N8nPortableWorkflowError(
        'N8N_POLICY_VALIDATION_FAILED',
        `Canonical credential reference is missing a portable declaration for node "${reference.node.name || reference.node.id}" and type "${reference.credentialType}".`
      );
    }
  }
  if (!liveWorkflow) return;
  for (const liveNode of liveWorkflow.nodes || []) {
    const canonicalNode = selectNode(
      canonicalWorkflow,
      { nodeId: liveNode.id, nodeName: liveNode.name, nodeType: liveNode.type },
      { allowStaleIdFallback: true }
    );
    if (!canonicalNode) continue;
    for (const credentialType of Object.keys(liveNode.credentials || {})) {
      const key = resolvedCredentialKey(canonicalNode, credentialType);
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
  validatePortableDocument(options.credentialDeclarations, 'credential-declarations');
  validatePortableDocument(options.deploymentPolicy, 'deployment-policy');
  validatePortableDocument(options.resourceBindings, 'resource-bindings');
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

  const strippedWebhookIds = stripDedicatedWebhookMetadata(prepared, allowedPaths);
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
  const declarationEntry = selectWorkflowEntry(
    options.credentialDeclarations,
    selectorWorkflow,
    options.workflowFile,
    'credential declaration',
    'credential-declarations'
  );
  const policyEntry = selectWorkflowEntry(
    options.deploymentPolicy,
    selectorWorkflow,
    options.workflowFile,
    'deployment policy',
    'deployment-policy'
  );
  const bindingEntry = selectWorkflowEntry(
    options.resourceBindings,
    selectorWorkflow,
    options.workflowFile,
    'resource binding',
    'resource-bindings'
  );
  const requirements = declarationEntry?.nodes || [];
  assertCredentialDeclarationCoverage(prepared, options.liveWorkflow, requirements);

  const credentialResult = resolveCredentialRequirements(prepared, requirements, options.credentialMetadata, {
    allowUnresolvedImport: options.allowUnresolvedImport === true,
    liveWorkflow: options.liveWorkflow,
  });
  for (const requirement of requirements) {
    const node = selectNode(prepared, requirement, { allowStaleIdFallback: true });
    const nodeIndex = prepared.nodes.indexOf(node);
    allowedPaths.add(`nodes.${nodeIndex}.credentials.${requirement.credentialType}`);
    if (!node.credentials) allowedPaths.add(`nodes.${nodeIndex}.credentials`);
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
    strippedWebhookIds,
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
    const portableNode = selectNode(
      portable,
      {
        nodeId: previousNode.id,
        nodeName: previousNode.name,
        nodeType: previousNode.type,
      },
      { allowStaleIdFallback: true }
    );
    if (!portableNode || !portableNode.parameters || typeof portableNode.parameters !== 'object') continue;
    const previousParameters = previousNode.parameters && typeof previousNode.parameters === 'object'
      ? previousNode.parameters
      : {};

    for (const key of PROTECTED_MAPPING_PARAMETER_KEYS) {
      const canonicalHasKey = Object.prototype.hasOwnProperty.call(previousParameters, key);
      const portableHasKey = Object.prototype.hasOwnProperty.call(portableNode.parameters, key);
      if (!canonicalHasKey) {
        if (portableHasKey) {
          delete portableNode.parameters[key];
          protectedChanges.push({ nodeName: portableNode.name || '', nodeType: portableNode.type || '', path: `parameters.${key}` });
        }
        continue;
      }
      const before = previousParameters[key];
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
    preserveChangedExpressions(previousParameters, portableNode.parameters, []);
  }
}

function canonicaliseExport(options) {
  validatePortableDocument(options.deploymentPolicy, 'deployment-policy');
  if (options.previousDeclaration !== undefined && options.previousDeclaration !== null) {
    validateWorkflowDocumentEntry(
      options.previousDeclaration,
      'credential-declarations',
      'selected credential declaration',
      { allowLegacySchemaVersion: true }
    );
  }
  const portable = canonicalWorkflowForGit(options.liveWorkflow, { preserveTags: options.preserveTags });
  const previous = options.canonicalWorkflow ? clone(options.canonicalWorkflow) : null;
  const policyEntry = selectWorkflowEntry(
    options.deploymentPolicy,
    options.liveWorkflow,
    options.workflowFile,
    'deployment policy',
    'deployment-policy'
  );
  const protectedPaths = policyPathsForExport(policyEntry);
  const protectedChanges = [];

  if (options.reviewedSourceUpdate !== true) protectCanonicalMappingDomains(portable, previous, protectedChanges);

  for (const rule of protectedPaths) {
    const portableNode = selectNode(portable, rule, { allowStaleIdFallback: true });
    const previousNode = previous ? selectNode(previous, rule, { allowStaleIdFallback: true }) : null;
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
    if (!previousValue.found && nextValue.found) {
      deleteAtPath(portableNode, rule.parts);
      protectedChanges.push({ nodeName: portableNode.name || '', nodeType: portableNode.type || '', path: rule.path });
      continue;
    }
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

function aggregateEntryFromDirectDocument(document) {
  const entry = clone(document);
  delete entry.schemaVersion;
  return entry;
}

function declarationEntryForAggregate(declaration, selectorSource = null) {
  const entry = aggregateEntryFromDirectDocument(declaration);
  if (selectorSource) {
    for (const field of ['workflowFile', 'workflowId', 'workflowName']) {
      if (Object.prototype.hasOwnProperty.call(selectorSource, field)) entry[field] = selectorSource[field];
      else delete entry[field];
    }
  }
  return entry;
}

function mergeCredentialDeclarationDocument(document, declaration) {
  validatePortableDocument(document, 'credential-declarations');
  validatePortableDocument(declaration, 'credential-declarations');
  const directSource = document && !Array.isArray(document.workflows) ? document : null;
  const next = {
    schemaVersion: SCHEMA_VERSION,
    workflows: document === undefined
      ? []
      : Array.isArray(document.workflows)
        ? document.workflows.map(aggregateEntryFromDirectDocument)
        : [aggregateEntryFromDirectDocument(document)],
  };
  const rawDeclarationEntry = declarationEntryForAggregate(declaration);
  const exactFileIndex = next.workflows.findIndex((entry) => entry.workflowFile && entry.workflowFile === rawDeclarationEntry.workflowFile);
  const foldedFileMatches = next.workflows.filter((entry) =>
    entry.workflowFile &&
    rawDeclarationEntry.workflowFile &&
    entry.workflowFile.toLowerCase() === rawDeclarationEntry.workflowFile.toLowerCase()
  );
  if (exactFileIndex < 0 && foldedFileMatches.length > 0) {
    throw new N8nPortableWorkflowError(
      'N8N_WORKFLOW_MATCH_AMBIGUOUS',
      'Portable credential declarations contain case-folded workflow filename collisions.'
    );
  }
  const idIndex = next.workflows.findIndex((entry) =>
    entry.workflowId && rawDeclarationEntry.workflowId && entry.workflowId === rawDeclarationEntry.workflowId
  );
  const selectorMatches = next.workflows
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => ['workflowFile', 'workflowId', 'workflowName']
      .filter((field) => entry[field])
      .every((field) => {
        if (!rawDeclarationEntry[field]) return false;
        if (field === 'workflowFile') {
          return entry[field].replace(/\\/g, '/') === rawDeclarationEntry[field].replace(/\\/g, '/');
        }
        return entry[field] === rawDeclarationEntry[field];
      }));
  if (exactFileIndex < 0 && idIndex < 0 && selectorMatches.length > 1) {
    throw new N8nPortableWorkflowError(
      'N8N_WORKFLOW_MATCH_AMBIGUOUS',
      'Multiple portable credential declaration entries match the updated workflow.'
    );
  }
  const index = directSource
    ? 0
    : exactFileIndex >= 0
      ? exactFileIndex
      : idIndex >= 0
        ? idIndex
        : selectorMatches[0]?.index ?? -1;
  const selectorSource = directSource || (index >= 0 ? next.workflows[index] : null);
  const declarationEntry = declarationEntryForAggregate(declaration, selectorSource);
  if (index >= 0) next.workflows[index] = declarationEntry;
  else next.workflows.push(declarationEntry);
  next.workflows.sort((left, right) => String(left.workflowFile || left.workflowName).localeCompare(String(right.workflowFile || right.workflowName)));
  validatePortableDocument(next, 'credential-declarations', { allowAbsent: false });
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
  validatePortableDocument,
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
