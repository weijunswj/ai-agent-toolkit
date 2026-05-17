const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.error('Usage: node scripts/prepare-n8n-live-import.cjs <repo-workflow.json> [bindings.json] [output.json] [live-workflow.json]');
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readWorkflow(filePath) {
  const raw = readJson(filePath);
  return Array.isArray(raw) ? raw[0] : raw.workflow || raw;
}

function readOptionalBindings(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Credential bindings file not found; preparing without restored credentials: ${filePath}`);
    return { nodes: [] };
  }

  return readJson(filePath);
}

function readMigrationMap() {
  const migrationPath = path.join(process.cwd(), '.n8n-local', 'n8n-credential-migration-map.json');
  if (!fs.existsSync(migrationPath)) {
    return {
      nodeNameMap: {},
      blockedCredentialTypes: [],
    };
  }

  const config = readJson(migrationPath);
  return {
    nodeNameMap: config.nodeNameMap && typeof config.nodeNameMap === 'object' ? config.nodeNameMap : {},
    blockedCredentialTypes: Array.isArray(config.blockedCredentialTypes) ? config.blockedCredentialTypes : [],
    credentialTypeCompatibility: config.credentialTypeCompatibility && typeof config.credentialTypeCompatibility === 'object' ? config.credentialTypeCompatibility : {},
  };
}

function workflowFileName(workflowPath) {
  return path.basename(workflowPath, path.extname(workflowPath));
}

function normalisePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function normalisedWorkflowPaths(workflowPath) {
  const absolutePath = path.resolve(workflowPath);
  return new Set([
    normalisePath(absolutePath),
    normalisePath(path.relative(process.cwd(), absolutePath)),
  ]);
}

function noWorkflowBinding(reason) {
  return {
    workflowBindings: { nodes: [] },
    matchFound: false,
    blocked: false,
    reason,
  };
}

function blockedWorkflowBinding(reason) {
  return {
    workflowBindings: { nodes: [] },
    matchFound: false,
    blocked: true,
    reason,
  };
}

function uniqueSelection(matches, label) {
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    return blockedWorkflowBinding(`Ambiguous ${label} credential binding match (${matches.length} entries).`);
  }
  return {
    workflowBindings: matches[0],
    matchFound: true,
    blocked: false,
    matchKind: label,
  };
}

function selectBindings(bindings, workflow, workflowPath) {
  const selection = selectBindingsWithMeta(bindings, workflow, workflowPath);
  if (selection.blocked) {
    throw new Error(selection.reason);
  }
  return selection.workflowBindings;
}

function selectBindingsWithMeta(bindings, workflow, workflowPath) {
  if (Array.isArray(bindings.workflows)) {
    const expectedPaths = normalisedWorkflowPaths(workflowPath);
    const workflowBaseName = path.basename(workflowPath).toLowerCase();

    const pathMatches = bindings.workflows.filter((entry) =>
      entry.workflowFile && expectedPaths.has(normalisePath(entry.workflowFile))
    );
    const pathSelection = uniqueSelection(pathMatches, 'workflowFile');
    if (pathSelection) return pathSelection;

    const idMatches = bindings.workflows.filter((entry) =>
      entry.workflowId && workflow.id && entry.workflowId === workflow.id
    );
    const idSelection = uniqueSelection(idMatches, 'workflowId');
    if (idSelection) return idSelection;

    const basenameMatches = bindings.workflows.filter((entry) =>
      entry.workflowFile && path.basename(entry.workflowFile).toLowerCase() === workflowBaseName
    );
    const basenameSelection = uniqueSelection(basenameMatches, 'workflow file basename');
    if (basenameSelection) return basenameSelection;

    const nameMatches = bindings.workflows.filter((entry) =>
      entry.workflowName && workflow.name && entry.workflowName === workflow.name
    );
    const nameSelection = uniqueSelection(nameMatches, 'workflowName');
    if (nameSelection) return nameSelection;

    console.warn(`No workflow-specific credential binding found for ${workflow.name || workflowPath}.`);
    return noWorkflowBinding('No workflow-specific credential binding found.');
  }

  if (
    bindings.sourceWorkflowId &&
    workflow.id &&
    bindings.sourceWorkflowId !== workflow.id
  ) {
    console.warn(`Legacy credential binding file is for ${bindings.sourceWorkflowName || bindings.sourceWorkflowId}; no credentials restored for ${workflow.name || workflowPath}.`);
    return noWorkflowBinding('Legacy credential binding file targets a different workflow.');
  }

  return {
    workflowBindings: bindings,
    matchFound: true,
    blocked: false,
    matchKind: 'legacy',
  };
}

function credentialTypes(credentials) {
  return Object.keys(credentials || {});
}

function credentialTypesCompatible(binding, node, migrationMap) {
  const sourceTypes = credentialTypes(binding.credentials);
  if (sourceTypes.length === 0) return true;

  const sourceNodeTypeMap = migrationMap.credentialTypeCompatibility?.[binding.nodeType];
  const compatibleTypes = sourceNodeTypeMap?.[node.type];
  if (!Array.isArray(compatibleTypes)) return false;

  return sourceTypes.every((credentialType) => compatibleTypes.includes(credentialType));
}

function assertCredentialTypesAllowed(binding, migrationMap, nodeName) {
  const blockedTypes = new Set(migrationMap.blockedCredentialTypes || []);
  const blocked = credentialTypes(binding.credentials).filter((credentialType) => blockedTypes.has(credentialType));
  if (blocked.length > 0) {
    throw new Error(`Credential restore blocked for node "${nodeName}". Credential type(s) require manual binding: ${blocked.join(', ')}.`);
  }
}

function migrationAllowsBinding(binding, node, migrationMap) {
  return Boolean(
    binding.nodeName &&
    node.name &&
    migrationMap.nodeNameMap &&
    migrationMap.nodeNameMap[binding.nodeName] === node.name
  );
}

function assertBindingCompatible(binding, node, migrationMap, allowTypeMigration) {
  assertCredentialTypesAllowed(binding, migrationMap, node.name || binding.nodeName || binding.nodeId || '(unknown node)');

  if (allowTypeMigration && (!binding.nodeType || !node.type)) {
    throw new Error(`Credential restore blocked for node "${node.name}". Credential type compatibility cannot be verified because node type metadata is missing. Manual credential binding is required.`);
  }

  if (binding.nodeType && node.type && binding.nodeType !== node.type) {
    if (
      !allowTypeMigration ||
      !migrationAllowsBinding(binding, node, migrationMap) ||
      !credentialTypesCompatible(binding, node, migrationMap)
    ) {
      throw new Error(`Credential restore blocked for node "${node.name}". Live binding node type "${binding.nodeType}" does not match repo node type "${node.type}", or credential type compatibility is not explicitly allowed. Manual credential binding is required.`);
    }
  }
}

function addBinding(index, key, binding) {
  if (!key) return;
  const entries = index.get(key) || [];
  entries.push(binding);
  index.set(key, entries);
}

function singleMatch(entries, label, nodeName) {
  if (!entries || entries.length === 0) return null;
  if (entries.length > 1) {
    throw new Error(`Credential restore blocked for node "${nodeName}". Matching by ${label} is ambiguous (${entries.length} bindings).`);
  }
  return entries[0];
}

function findMigrationBinding(bindings, node, migrationMap) {
  const matches = bindings.filter((binding) => migrationAllowsBinding(binding, node, migrationMap));
  return singleMatch(matches, 'migration map', node.name || node.id || '(unknown node)');
}

function restoreCredentials(workflow, workflowBindings, migrationMap) {
  const bindings = workflowBindings.nodes || [];
  const bindingsById = new Map();
  const bindingsByNameType = new Map();

  for (const binding of bindings) {
    addBinding(bindingsById, binding.nodeId, binding);
    if (binding.nodeName && binding.nodeType) {
      addBinding(bindingsByNameType, `${binding.nodeName}\u0000${binding.nodeType}`, binding);
    }
  }

  let restored = 0;
  const missed = [];

  for (const node of workflow.nodes || []) {
    delete node.credentials;

    let binding = singleMatch(bindingsById.get(node.id), 'node ID', node.name || node.id || '(unknown node)');
    let allowTypeMigration = false;

    if (!binding) {
      binding = singleMatch(
        bindingsByNameType.get(`${node.name}\u0000${node.type}`),
        'node name and type',
        node.name || node.id || '(unknown node)'
      );
    }

    if (!binding) {
      binding = findMigrationBinding(bindings, node, migrationMap);
      allowTypeMigration = Boolean(binding);
    }

    if (binding && binding.credentials) {
      assertBindingCompatible(binding, node, migrationMap, allowTypeMigration);
      node.credentials = binding.credentials;
      restored += 1;
    }
  }

  for (const binding of bindings) {
    const exists = (workflow.nodes || []).some((node) => {
      if (node.id === binding.nodeId) return true;
      if (node.name === binding.nodeName && node.type === binding.nodeType) return true;
      return migrationAllowsBinding(binding, node, migrationMap);
    });
    if (!exists) missed.push(binding.nodeName || binding.nodeId || '(unknown node)');
  }

  return { restored, missed };
}

function nodeKey(node) {
  return `${node.name || ''}\u0000${node.type || ''}`;
}

function buildUniqueNodeIndex(nodes) {
  const byId = new Map();
  const byNameType = new Map();

  for (const node of nodes || []) {
    if (node.id) byId.set(node.id, node);

    const key = nodeKey(node);
    const entries = byNameType.get(key) || [];
    entries.push(node);
    byNameType.set(key, entries);
  }

  return { byId, byNameType };
}

function restoreLiveWebhookIds(workflow, liveWorkflow) {
  if (!liveWorkflow || !Array.isArray(liveWorkflow.nodes)) {
    return 0;
  }

  const { byId, byNameType } = buildUniqueNodeIndex(liveWorkflow.nodes);
  let restored = 0;

  for (const node of workflow.nodes || []) {
    let liveNode = node.id ? byId.get(node.id) : null;

    if (!liveNode) {
      const matches = byNameType.get(nodeKey(node)) || [];
      if (matches.length === 1) {
        liveNode = matches[0];
      } else if (matches.length > 1) {
        console.warn(`Skipped webhookId restore for node "${node.name || node.id || '(unknown)'}": live node name/type match is ambiguous.`);
      }
    }

    if (liveNode && liveNode.webhookId) {
      node.webhookId = liveNode.webhookId;
      restored += 1;
    }
  }

  return restored;
}

function main() {
  const workflowPath = process.argv[2];
  const bindingsPath = process.argv[3] || path.join('.n8n-local', 'n8n-credential-bindings.json');
  const outputPath = process.argv[4] || path.join('.tmp', `${workflowFileName(workflowPath || 'workflow')}.live-import.json`);
  const liveWorkflowPath = process.argv[5];

  if (!workflowPath) usage();

  const workflow = readJson(workflowPath);
  const bindings = readOptionalBindings(bindingsPath);
  const workflowBindings = selectBindings(bindings, workflow, workflowPath);
  const migrationMap = readMigrationMap();
  const { restored, missed } = restoreCredentials(workflow, workflowBindings, migrationMap);
  const liveWorkflow = liveWorkflowPath && fs.existsSync(liveWorkflowPath) ? readWorkflow(liveWorkflowPath) : null;
  const restoredWebhookIds = restoreLiveWebhookIds(workflow, liveWorkflow);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2) + '\n');

  console.log(`Prepared ${outputPath} with ${restored} credential binding(s) and ${restoredWebhookIds} live webhookId(s) restored.`);
  if (missed.length) {
    console.warn(`Skipped ${missed.length} binding(s) with no matching node: ${missed.join(', ')}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  selectBindings,
  selectBindingsWithMeta,
  restoreCredentials,
  restoreLiveWebhookIds,
  prepareLiveImport: main,
};
