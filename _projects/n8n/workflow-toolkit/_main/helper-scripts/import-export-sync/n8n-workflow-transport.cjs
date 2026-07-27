const REQUIRED_OPERATIONS = Object.freeze([
  'listWorkflows',
  'readWorkflow',
  'importWorkflow',
  'inspectInactiveState',
  'listCredentialMetadata',
  'verifyPostcondition',
]);

function dockerServerCliTransport() {
  return {
    id: 'docker-server-cli',
    capabilities: {
      workflowList: true,
      workflowRead: true,
      workflowImport: true,
      inactiveInspection: true,
      credentialMetadata: 'encrypted-server-cli-export',
      unresolvedCredentialImport: true,
      browser: false,
      execution: false,
      activation: false,
    },
    listWorkflows(container) {
      return { command: 'docker', args: ['exec', container, 'n8n', 'export:workflow', '--all', '--pretty'] };
    },
    readWorkflow(container) {
      return this.listWorkflows(container);
    },
    importWorkflow(container, inputPath, target = {}) {
      const args = ['exec', container, 'n8n', 'import:workflow', `--input=${inputPath}`, '--activeState=false'];
      if (target.projectId) args.push(`--projectId=${target.projectId}`);
      else if (target.userId) args.push(`--userId=${target.userId}`);
      return { command: 'docker', args };
    },
    inspectInactiveState(container) {
      return this.listWorkflows(container);
    },
    listCredentialMetadata(container, outputPath) {
      return { command: 'docker', args: ['exec', container, 'n8n', 'export:credentials', '--all', `--output=${outputPath}`] };
    },
    verifyPostcondition(container) {
      return this.inspectInactiveState(container);
    },
  };
}

function validateTransport(transport) {
  if (!transport || typeof transport !== 'object' || typeof transport.id !== 'string') {
    throw new Error('Transport must be an object with a stable id.');
  }
  for (const operation of REQUIRED_OPERATIONS) {
    if (typeof transport[operation] !== 'function') {
      throw new Error(`Transport "${transport.id}" is missing required operation "${operation}".`);
    }
  }
  if (transport.capabilities?.browser !== false || transport.capabilities?.execution !== false || transport.capabilities?.activation !== false) {
    throw new Error(`Transport "${transport.id}" must not expose browser, execution, or activation capabilities.`);
  }
  return transport;
}

function getTransport(id = 'docker-server-cli') {
  if (id === 'docker-server-cli') return validateTransport(dockerServerCliTransport());
  throw new Error(`Unsupported n8n workflow transport: ${id}`);
}

function verifyInactivePostcondition(workflows, targetWorkflowId) {
  const matches = (workflows || []).filter((workflow) => workflow && workflow.id === targetWorkflowId);
  if (matches.length !== 1 || matches[0].active !== false) {
    const error = new Error('Imported workflow was not uniquely observable as inactive.');
    error.code = 'N8N_POSTCONDITION_FAILED';
    throw error;
  }
  return { inactive: true, executionState: 'not_executed' };
}

if (require.main === module) {
  const command = process.argv[2];
  const id = process.argv[3] || 'docker-server-cli';
  if (command !== 'capabilities') {
    console.error('Usage: node n8n-workflow-transport.cjs capabilities [docker-server-cli]');
    process.exit(2);
  }
  try {
    const transport = getTransport(id);
    console.log(JSON.stringify({ id: transport.id, capabilities: transport.capabilities }));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  REQUIRED_OPERATIONS,
  dockerServerCliTransport,
  validateTransport,
  getTransport,
  verifyInactivePostcondition,
};
