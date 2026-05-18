const fs = require('node:fs');
const path = require('node:path');
const { selectBindingsWithMeta } = require('./prepare-n8n-live-import.cjs');

function usage() {
  console.error('Usage: node templates/n8n/sync-helpers/compare-n8n-workflow-credentials.cjs <repo-workflow.json> <live-workflow.json> [bindings.json]');
  process.exit(2);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readWorkflow(filePath) {
  const raw = readJson(filePath);
  return Array.isArray(raw) ? raw[0] : raw.workflow || raw;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
}

function normaliseCredentials(value) {
  if (!value || typeof value !== 'object') return null;
  return stable(value);
}

function credentialsEqual(left, right) {
  return JSON.stringify(normaliseCredentials(left)) === JSON.stringify(normaliseCredentials(right));
}

function nodeKey(node) {
  return `${node.name || ''}\u0000${node.type || ''}`;
}

function statusForCredentialDrift(repoWorkflow, liveWorkflow, bindingsPath, repoWorkflowPath) {
  if (!fs.existsSync(bindingsPath)) {
    return 'UNKNOWN';
  }

  const bindings = readJson(bindingsPath);
  const selection = selectBindingsWithMeta(bindings, repoWorkflow, repoWorkflowPath);
  if (selection.blocked) {
    console.warn(selection.reason);
    return 'UNKNOWN';
  }
  if (!selection.matchFound) {
    return 'UNKNOWN';
  }

  const workflowBindings = selection.workflowBindings || { nodes: [] };
  const bindingById = new Map();
  const bindingByNameType = new Map();
  for (const binding of workflowBindings.nodes || []) {
    if (binding.nodeId) bindingById.set(binding.nodeId, binding);
    if (binding.nodeName && binding.nodeType) {
      bindingByNameType.set(`${binding.nodeName}\u0000${binding.nodeType}`, binding);
    }
  }

  const liveById = new Map();
  const liveByNameType = new Map();
  for (const node of liveWorkflow.nodes || []) {
    if (node.id) liveById.set(node.id, node);
    liveByNameType.set(nodeKey(node), node);
  }

  for (const repoNode of repoWorkflow.nodes || []) {
    const expectedBinding = bindingById.get(repoNode.id) || bindingByNameType.get(nodeKey(repoNode));
    const liveNode = liveById.get(repoNode.id) || liveByNameType.get(nodeKey(repoNode));
    const expectedCredentials = expectedBinding ? expectedBinding.credentials : undefined;
    const liveCredentials = liveNode ? liveNode.credentials : undefined;

    if (!credentialsEqual(expectedCredentials, liveCredentials)) {
      return 'DIFF';
    }
  }

  return 'MATCH';
}

if (require.main === module) {
  const repoWorkflowPath = process.argv[2];
  const liveWorkflowPath = process.argv[3];
  const bindingsPath = process.argv[4] || path.join('.n8n-local', 'n8n-credential-bindings.json');

  if (!repoWorkflowPath || !liveWorkflowPath) usage();

  const repoWorkflow = readWorkflow(repoWorkflowPath);
  const liveWorkflow = readWorkflow(liveWorkflowPath);
  const result = statusForCredentialDrift(repoWorkflow, liveWorkflow, bindingsPath, repoWorkflowPath);
  console.log(result);
}

module.exports = { statusForCredentialDrift };
