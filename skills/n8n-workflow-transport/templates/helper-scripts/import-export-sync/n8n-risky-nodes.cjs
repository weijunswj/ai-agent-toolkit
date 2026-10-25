'use strict';

// Offline list of the nodes the n8n safety rules say to inspect before any test or run: Code, Execute
// Command, file read/write, HTTP Request and credentialed nodes. Read-only: it reports, it never decides.

const RISK_CATEGORIES = Object.freeze([
  {
    label: 'Code',
    types: [
      'n8n-nodes-base.code',
      'n8n-nodes-base.function',
      'n8n-nodes-base.functionItem',
      '@n8n/n8n-nodes-langchain.code',
      '@n8n/n8n-nodes-langchain.toolCode',
    ],
  },
  {
    label: 'Execute Command',
    types: ['n8n-nodes-base.executeCommand', 'n8n-nodes-base.ssh'],
  },
  {
    label: 'Read/Write Files',
    types: [
      'n8n-nodes-base.readWriteFile',
      'n8n-nodes-base.readBinaryFile',
      'n8n-nodes-base.readBinaryFiles',
      'n8n-nodes-base.writeBinaryFile',
      'n8n-nodes-base.localFileTrigger',
    ],
  },
  {
    label: 'HTTP Request',
    types: ['n8n-nodes-base.httpRequest', '@n8n/n8n-nodes-langchain.toolHttpRequest'],
  },
]);

const CATEGORY_BY_TYPE = new Map(RISK_CATEGORIES.flatMap((category) => category.types.map((type) => [type, category.label])));

function hasCredentials(node) {
  return Boolean(node && node.credentials && typeof node.credentials === 'object' && Object.keys(node.credentials).length > 0);
}

// Returns one entry per risky node: { name, type, reasons: [...], disabled }.
function riskyNodes(workflow) {
  const result = [];
  for (const node of Array.isArray(workflow?.nodes) ? workflow.nodes : []) {
    const reasons = [];
    const category = CATEGORY_BY_TYPE.get(node?.type);
    if (category) reasons.push(category);
    if (hasCredentials(node)) reasons.push('Credentialed');
    if (reasons.length === 0) continue;
    result.push({
      name: typeof node.name === 'string' ? node.name : '',
      type: typeof node.type === 'string' ? node.type : '',
      reasons,
      disabled: node.disabled === true,
    });
  }
  return result;
}

function riskyNodeLines(workflowLabel, nodes) {
  if (nodes.length === 0) return [];
  return [
    `Review before any test or run: ${workflowLabel} has ${nodes.length} node(s) to inspect.`,
    ...nodes.map((node) => `  - ${node.reasons.join(', ')}: "${node.name}" (${node.type})${node.disabled ? ' [disabled]' : ''}`),
  ];
}

module.exports = { RISK_CATEGORIES, riskyNodeLines, riskyNodes };
