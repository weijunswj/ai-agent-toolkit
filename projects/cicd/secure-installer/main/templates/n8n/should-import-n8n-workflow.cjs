const fs = require('node:fs');

function usage() {
  console.error('Usage: node scripts/should-import-n8n-workflow.cjs <prepared-import.json> <live-export.json>');
  process.exit(2);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readWorkflow(filePath) {
  const raw = readJson(filePath);
  return Array.isArray(raw) ? raw[0] : raw.workflow || raw;
}

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== 'object') return value;

  const volatileKeys = new Set([
    'cachedResultName',
    'cachedResultUrl',
    'cachedResultId',
  ]);

  return Object.keys(value).reduce((result, key) => {
    if (volatileKeys.has(key)) return result;
    const nextValue = stripVolatile(value[key]);
    if (nextValue === undefined) return result;
    result[key] = nextValue;
    return result;
  }, {});
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

function sortNodes(nodes) {
  return [...(nodes || [])].sort((a, b) => {
    const left = `${a.name || ''}\u0000${a.id || ''}\u0000${a.type || ''}`;
    const right = `${b.name || ''}\u0000${b.id || ''}\u0000${b.type || ''}`;
    return left.localeCompare(right);
  });
}

function comparableWorkflow(workflow) {
  const clean = stripVolatile(JSON.parse(JSON.stringify(workflow)));
  const ignoredTopLevelFields = [
    'id',
    'active',
    'createdAt',
    'updatedAt',
    'isArchived',
    'shared',
    'staticData',
    'pinData',
    'versionId',
    'activeVersionId',
    'versionCounter',
    'triggerCount',
    'versionMetadata',
    'tags',
    'tagIds',
    'meta',
  ];

  for (const field of ignoredTopLevelFields) {
    delete clean[field];
  }

  delete clean.credentials;

  if (clean.description == null) delete clean.description;

  for (const node of clean.nodes || []) {
    delete node.credentials;
    delete node.webhookId;
  }

  clean.nodes = sortNodes(clean.nodes);

  return stable(clean);
}

function compareWorkflowFiles(preparedPath, livePath) {
  const prepared = comparableWorkflow(readWorkflow(preparedPath));
  const live = comparableWorkflow(readWorkflow(livePath));

  return JSON.stringify(prepared) === JSON.stringify(live) ? 'UNCHANGED' : 'CHANGED';
}

module.exports = {
  comparableWorkflow,
  compareWorkflowFiles,
};

if (require.main === module) {
  const preparedPath = process.argv[2];
  const livePath = process.argv[3];
  if (!preparedPath || !livePath) usage();
  console.log(compareWorkflowFiles(preparedPath, livePath));
}
