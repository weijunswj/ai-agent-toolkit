#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const externalRouter = require('./external-system-router.cjs');
const { sha256, assertNoSecretMaterial } = externalRouter;

const N8N_LEDGER_SCHEMA_VERSION = 'ai-agent-toolkit.n8n-capability-ledger.v1';
const N8N_CAPABILITY_RECEIPT_SCHEMA_VERSION = 'ai-agent-toolkit.n8n-capability-receipt.v1';
const OFFICIAL_N8N_SKILLS_CONTRACT = Object.freeze({
  packageId: 'n8n-skills@n8n-io',
  pluginNamespace: 'n8n-skills',
  packageVersion: '1.0.2',
  sourceRepository: 'https://github.com/n8n-io/skills',
  sourceCommit: 'eb18fc3ab3e2820c748c2d84386fb5496efc1516',
  compatibilityBaselineCommit: '2c26822deb522ea2862d864b0c808b767a13aa9a',
  supportedSourceCommits: Object.freeze([
    '2c26822deb522ea2862d864b0c808b767a13aa9a',
    'eb18fc3ab3e2820c748c2d84386fb5496efc1516'
  ]),
  claudePluginManifestBlob: 'f8075e42c536cce8c8495e2a1a6310273e186119',
  codexPluginManifestBlob: '57dfb8d5354c8cf92fbe4035519521c523793a72',
  entryPoint: 'using-n8n-skills-official',
  compatibilityOwner: '#244',
  contentCompatibility: '1.0.2-skill-blobs-unchanged-from-244-baseline',
  windowsHookRepairStatus: 'remediation-required-and-owned-by-244'
});
const OFFICIAL_N8N_SKILL_BLOBS = Object.freeze({
  'n8n-agents-official': 'e0e7dafcd71311df4dbbb70ef1107a168e651fd0',
  'n8n-binary-and-data-official': '44452e39fb179aac07cd2bfa9c685ea263881fe0',
  'n8n-code-nodes-official': '2a5b08a00b5f47a2e89d5876f5ddae74625e41d2',
  'n8n-credentials-and-security-official': 'ab550731df56ce82b94b493b1427ae8fed9d8e88',
  'n8n-data-tables-official': 'a60ec281b3949a7d3130d750a1d232c74a539623',
  'n8n-debugging-official': 'aa31939e7abcf04f78c522cd95fccdce95e1349c',
  'n8n-error-handling-official': 'a8eaa5db28f4ccdfefffaf175a01916ffcccf761',
  'n8n-expressions-official': '76de420cb9b0be4782869598d791b5c2523ef74b',
  'n8n-extending-mcp-official': '12b64b64ebf441304bc128c1f7f629ef710b2909',
  'n8n-loops-official': 'd740065da5f837dfdd816ff83539ff06ff20baab',
  'n8n-node-configuration-official': 'c1cec04b5233ddd6b63aacfeb118f2607f94d11a',
  'n8n-subworkflows-official': 'b40e11ff62537c1f3d8b15f2750f1069bff5cd8b',
  'n8n-workflow-lifecycle-official': '7a657e8de6cce5877e666d495eabf18f85d57b6b',
  'using-n8n-skills-official': 'ffd83822b88e032f7bb9863f3fdc92ab8ab83e35'
});

const MATERIAL_SKILL_OPERATIONS = new Set([
  'workflow-design', 'workflow-create', 'workflow-material-edit', 'workflow-repair', 'workflow-review',
  'node-configuration', 'expression-authoring', 'workflow-json-structure', 'workflow-sdk-structure'
]);
const HELPER_OPERATIONS = new Set(['canonical-import', 'canonical-export', 'workflow-compile', 'prepare-import', 'effective-payload-compare']);
const LIVE_OPERATIONS = new Set(['live-workflow-read', 'live-workflow-import', 'live-workflow-update', 'live-workflow-publish', 'live-workflow-execute']);
const ALL_OPERATIONS = new Set([...MATERIAL_SKILL_OPERATIONS, ...HELPER_OPERATIONS, ...LIVE_OPERATIONS, 'credential-or-oauth-setup', 'webhook-contract-only']);
const OPERATION_SKILLS = Object.freeze({
  'workflow-design': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'workflow-create': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'workflow-material-edit': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'workflow-repair': ['n8n-debugging-official', 'n8n-node-configuration-official'],
  'workflow-review': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'node-configuration': ['n8n-node-configuration-official'],
  'expression-authoring': ['n8n-expressions-official'],
  'workflow-json-structure': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'workflow-sdk-structure': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'canonical-import': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'canonical-export': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'workflow-compile': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'prepare-import': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'effective-payload-compare': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'live-workflow-read': ['n8n-workflow-lifecycle-official'],
  'live-workflow-import': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'live-workflow-update': ['n8n-workflow-lifecycle-official', 'n8n-node-configuration-official'],
  'live-workflow-publish': ['n8n-workflow-lifecycle-official'],
  'live-workflow-execute': ['n8n-workflow-lifecycle-official'],
  'credential-or-oauth-setup': ['n8n-credentials-and-security-official']
});
const FACET_SKILLS = Object.freeze({
  agents: 'n8n-agents-official',
  binary: 'n8n-binary-and-data-official',
  'code-node': 'n8n-code-nodes-official',
  'data-tables': 'n8n-data-tables-official',
  debugging: 'n8n-debugging-official',
  'error-handling': 'n8n-error-handling-official',
  expressions: 'n8n-expressions-official',
  loops: 'n8n-loops-official',
  'node-configuration': 'n8n-node-configuration-official',
  subworkflows: 'n8n-subworkflows-official',
  'workflow-lifecycle': 'n8n-workflow-lifecycle-official',
  'extending-mcp': 'n8n-extending-mcp-official'
});
const GOVERNED_MUTATION_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']);
const N8N_MCP_TOOL_PATTERN_SOURCE = '^mcp__[^\\s]*n8n[^\\s]*__[^\\s]+$';
const N8N_MCP_TOOL_PATTERN = new RegExp(N8N_MCP_TOOL_PATTERN_SOURCE, 'i');
const N8N_MCP_PROVEN_READ_ONLY_ACTION_PATTERN = /^(?:n8n_)?(?:get|list|search|describe|inspect|validate|health|status|schema|documentation|read)(?:_|$)/i;
const CAPABILITY_RECEIPT_MAX_BYTES = 32768;
const N8N_WORKFLOW_MAX_BYTES = 2 * 1024 * 1024;
const LEDGER_LOCK_OWNER_FILE = 'owner.json';
const LEDGER_LOCK_STALE_MS = 30000;

function fail(message, code = 'N8N_DOMAIN_ROUTER_INVALID', details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function string(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label} must be a non-empty string no longer than ${max}.`);
  return value.trim();
}

function normalizeSkillName(value) {
  let name = String(value || '').trim().replace(/^\//, '');
  if (name.includes(':')) name = name.slice(name.lastIndexOf(':') + 1);
  return name;
}

function isGovernedN8nMutationTool(toolName) {
  const normalized = String(toolName || '');
  if (GOVERNED_MUTATION_TOOLS.has(normalized)) return true;
  if (!N8N_MCP_TOOL_PATTERN.test(normalized)) return false;
  return !N8N_MCP_PROVEN_READ_ONLY_ACTION_PATTERN.test(normalized.slice(normalized.lastIndexOf('__') + 2));
}

function inferGovernedMutationOperation(toolName) {
  const normalized = String(toolName || '').toLowerCase();
  if (!isGovernedN8nMutationTool(normalized) || !N8N_MCP_TOOL_PATTERN.test(normalized)) return null;
  if (/credential|oauth/.test(normalized)) return 'credential-or-oauth-setup';
  if (/(?:publish|unpublish|activate|deactivate)/.test(normalized)) return 'live-workflow-publish';
  if (/(?:execute|run)/.test(normalized)) return 'live-workflow-execute';
  if (/(?:import|create)/.test(normalized)) return 'live-workflow-import';
  return 'live-workflow-update';
}

function normalizeOfficialText(bytes) {
  return Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function gitBlobSha1(bytes, options = {}) {
  const content = options.normalizeText === true ? Buffer.from(normalizeOfficialText(bytes), 'utf8') : Buffer.from(bytes);
  const header = Buffer.from(`blob ${content.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(content).digest('hex');
}

function readRegularFile(filePath, label) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || !sameResolvedPath(fs.realpathSync(resolved), resolved)) {
    fail(`${label} is not one exact regular non-symlink file.`, 'N8N_SKILL_SOURCE_UNVERIFIED');
  }
  return fs.readFileSync(resolved);
}

function readClaudePluginRecords(options = {}) {
  if (Array.isArray(options.pluginRecords)) return options.pluginRecords;
  const registryPath = path.resolve(options.claudePluginRegistryPath || path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'));
  if (!fs.existsSync(registryPath)) return [];
  const registry = JSON.parse(readRegularFile(registryPath, 'Claude installed-plugin registry').toString('utf8'));
  const records = registry?.plugins?.[OFFICIAL_N8N_SKILLS_CONTRACT.packageId]
    ?? registry?.[OFFICIAL_N8N_SKILLS_CONTRACT.packageId]
    ?? [];
  return Array.isArray(records) ? records : [records];
}

function attestClaudeOfficialSkillInvocation(invocation, options = {}) {
  if (!isObject(invocation)) fail('Claude Skill attestation input must be an object.');
  const invokedName = String(invocation.skillName || invocation.skill || invocation.name || '').trim().replace(/^\//, '');
  const separator = invokedName.indexOf(':');
  const namespace = separator > 0 ? invokedName.slice(0, separator) : '';
  const skillName = normalizeSkillName(invokedName);
  const reject = (stableCode, reason) => ({
    verified: false,
    stableCode,
    reason,
    skillName: skillName || 'missing',
    packageId: OFFICIAL_N8N_SKILLS_CONTRACT.packageId,
    packageVersion: OFFICIAL_N8N_SKILLS_CONTRACT.packageVersion
  });
  if (namespace !== OFFICIAL_N8N_SKILLS_CONTRACT.pluginNamespace) {
    return reject('N8N_SKILL_SOURCE_AMBIGUOUS', `Use the namespaced official Skill ${OFFICIAL_N8N_SKILLS_CONTRACT.pluginNamespace}:${skillName || '<skill>'}; an unqualified or different namespace cannot prove package origin.`);
  }
  const expectedSkillBlob = OFFICIAL_N8N_SKILL_BLOBS[skillName];
  if (!expectedSkillBlob) return reject('N8N_SKILL_NOT_IN_SUPPORTED_SOURCE', 'The invoked Skill is not part of the pinned official n8n Skills source contract.');
  let records;
  try {
    records = readClaudePluginRecords(options).filter((record) => record && record.installPath);
  } catch (error) {
    return reject('N8N_SKILL_SOURCE_UNVERIFIED', `Claude plugin registry could not be verified: ${error.message}`);
  }
  if (records.length !== 1) {
    return reject('N8N_SKILL_SOURCE_AMBIGUOUS', `Expected exactly one installed ${OFFICIAL_N8N_SKILLS_CONTRACT.packageId} source with no competing scope or version, found ${records.length}.`);
  }
  const record = records[0];
  if (record.version !== OFFICIAL_N8N_SKILLS_CONTRACT.packageVersion) {
    return reject('N8N_SKILL_SOURCE_UNVERIFIED', `Installed official n8n Skills version ${record.version || 'missing'} is not the reviewed ${OFFICIAL_N8N_SKILLS_CONTRACT.packageVersion}.`);
  }
  const installedSourceCommit = String(record.gitCommitSha || '').toLowerCase();
  if (!OFFICIAL_N8N_SKILLS_CONTRACT.supportedSourceCommits.includes(installedSourceCommit)) {
    return reject('N8N_SKILL_SOURCE_UNVERIFIED', 'Installed official n8n Skills source commit does not match either reviewed 1.0.2 source identity.');
  }
  try {
    const installRoot = path.resolve(record.installPath);
    const rootStat = fs.lstatSync(installRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !sameResolvedPath(fs.realpathSync(installRoot), installRoot)) {
      return reject('N8N_SKILL_SOURCE_UNVERIFIED', 'Installed official n8n Skills root is not one exact regular cache directory.');
    }
    const manifestPath = path.join(installRoot, '.claude-plugin', 'plugin.json');
    const manifestBytes = readRegularFile(manifestPath, 'Official n8n Claude plugin manifest');
    if (gitBlobSha1(manifestBytes, { normalizeText: true }) !== OFFICIAL_N8N_SKILLS_CONTRACT.claudePluginManifestBlob) {
      return reject('N8N_SKILL_SOURCE_UNVERIFIED', 'Installed official n8n Claude plugin manifest does not match the reviewed blob.');
    }
    const manifest = JSON.parse(normalizeOfficialText(manifestBytes));
    if (manifest.name !== OFFICIAL_N8N_SKILLS_CONTRACT.pluginNamespace || manifest.version !== OFFICIAL_N8N_SKILLS_CONTRACT.packageVersion) {
      return reject('N8N_SKILL_SOURCE_UNVERIFIED', 'Installed official n8n Claude plugin identity/version is not current.');
    }
    const skillBytes = readRegularFile(path.join(installRoot, 'skills', skillName, 'SKILL.md'), `Official n8n Skill ${skillName}`);
    const skillBlob = gitBlobSha1(skillBytes, { normalizeText: true });
    if (skillBlob !== expectedSkillBlob) {
      return reject('N8N_SKILL_SOURCE_UNVERIFIED', `Official n8n Skill ${skillName} does not match the reviewed blob.`);
    }
    return {
      verified: true,
      stableCode: 'N8N_SKILL_SOURCE_VERIFIED',
      skillName,
      invokedName,
      packageId: OFFICIAL_N8N_SKILLS_CONTRACT.packageId,
      packageVersion: OFFICIAL_N8N_SKILLS_CONTRACT.packageVersion,
      sourceRepository: OFFICIAL_N8N_SKILLS_CONTRACT.sourceRepository,
      sourceCommit: installedSourceCommit,
      compatibilityBaselineCommit: OFFICIAL_N8N_SKILLS_CONTRACT.compatibilityBaselineCommit,
      compatibilityReference: OFFICIAL_N8N_SKILLS_CONTRACT.compatibilityOwner,
      contentCompatibility: OFFICIAL_N8N_SKILLS_CONTRACT.contentCompatibility,
      manifestBlob: OFFICIAL_N8N_SKILLS_CONTRACT.claudePluginManifestBlob,
      skillBlob,
      sourceFingerprint: sha256(installRoot),
      normalization: 'utf8-bom-stripped-crlf-to-lf-git-blob'
    };
  } catch (error) {
    return reject('N8N_SKILL_SOURCE_UNVERIFIED', `Installed official n8n Skill source could not be verified: ${error.message}`);
  }
}

function detectN8nTask(input) {
  if (!isObject(input)) fail('n8n detection input must be an object.');
  const objective = String(input.objective || input.prompt || '').toLowerCase();
  const paths = Array.isArray(input.paths) ? input.paths.map((entry) => String(entry).replace(/\\/g, '/').toLowerCase()) : [];
  const materialIntent = /\b(?:workflow|node|expression|sdk|json|helper|compiler|import|export|live|production|publish|activate|execute|run|credential|oauth|webhook|mcp|create|edit|repair|review|design|configure|update|deploy|sync)\b/.test(objective);
  const activeIntent = /\bn8n\b/.test(objective) && materialIntent && input.historicalMentionOnly !== true;
  const workflowPath = paths.some((entry) => /(^|\/)n8n-workflows?\/.*\.json$/.test(entry) || /(^|\/)workflows?\/.*n8n.*\.json$/.test(entry));
  const boundedEvidence = input.ownsWorkflowJson === true || input.n8nWorkflowStructure === true || workflowPath;
  const historicalOnly = input.historicalMentionOnly === true && !activeIntent && !boundedEvidence;
  return {
    detected: !historicalOnly && (activeIntent || boundedEvidence),
    activeIntent,
    boundedRepositoryEvidence: boundedEvidence,
    historicalOnly,
    evidenceDigest: sha256({ activeIntent, boundedEvidence, paths: paths.filter((entry) => /n8n|workflow/.test(entry)).slice(0, 50) })
  };
}

function objectiveTargetBinding(value) {
  const text = String(value || '').toLowerCase().replace(/\\/g, '/');
  const references = new Set();
  for (const match of text.matchAll(/(?:^|[\s"'(])([a-z0-9._/-]+\.json)\b/g)) references.add(match[1]);
  for (const match of text.matchAll(/\bworkflow\s+(?:named\s+)?["']?([a-z0-9._-]+)["']?/g)) {
    const reference = match[1].replace(/[._-]+$/, '');
    if (!['and', 'in', 'json', 'that', 'the', 'this', 'to', 'with'].includes(reference)) references.add(`workflow:${reference}`);
  }
  const bounded = [...references].sort().slice(0, 20);
  return { specific: bounded.length > 0, digest: sha256(bounded) };
}

function inferN8nOperation(objective) {
  const text = String(objective || '').toLowerCase();
  const matches = [];
  const add = (operation, pattern) => { if (pattern.test(text)) matches.push(operation); };
  add('expression-authoring', /\bexpression(?:s)?\b|\{\{.*\}\}/);
  add('node-configuration', /\b(?:configure|configuration|parameter|resource|operation)\b.*\bnode\b|\bnode\b.*\b(?:configure|configuration|parameter)\b/);
  add('workflow-repair', /\b(?:repair|debug|fix|broken|error|failing)\b.*\bworkflow\b|\bworkflow\b.*\b(?:repair|debug|fix|broken|error|failing)\b/);
  add('workflow-review', /\b(?:review|audit|inspect)\b.*\bworkflow\b|\bworkflow\b.*\b(?:review|audit)\b/);
  add('workflow-create', /\b(?:create|build|new)\b.*\bworkflow\b|\bworkflow\b.*\b(?:create|build)\b/);
  add('workflow-design', /\b(?:design|architect|plan)\b.*\bworkflow\b|\bworkflow\b.*\b(?:design|architect)\b/);
  add('workflow-material-edit', /\b(?:edit|modify|change|update|rewrite|mirror|copy)\b.*\bworkflow\b|\bworkflow\b.*\b(?:edit|modify|change|update|rewrite)\b/);
  add('workflow-json-structure', /\bworkflow\s+json\b|\bn8n\b.*\.json\b|\bjson\b.*\bn8n\b/);
  add('workflow-sdk-structure', /\bworkflow\s+sdk\b|\bn8n\b.*\bsdk\b/);
  add('canonical-import', /\b(?:canonical\s+)?import\b/);
  add('canonical-export', /\b(?:canonical\s+)?export\b/);
  add('workflow-compile', /\bcompile|compiler\b/);
  add('prepare-import', /\bprepare[- ]import\b/);
  add('effective-payload-compare', /\beffective\s+(?:prepared\s+)?payload|compare\s+(?:prepared\s+)?payload/);
  add('live-workflow-read', /\blive\b.*\b(?:read|inspect|status)\b|\b(?:read|inspect)\b.*\blive\b/);
  add('live-workflow-import', /\blive\b.*\bimport\b|\bimport\b.*\blive\b/);
  add('live-workflow-update', /\blive\b.*\b(?:edit|update|change)\b|\b(?:edit|update)\b.*\blive\b/);
  add('live-workflow-publish', /\b(?:publish|activate|unpublish|deactivate)\b/);
  add('live-workflow-execute', /\b(?:execute|run)\b.*\bworkflow\b|\bworkflow\b.*\b(?:execute|run)\b/);
  add('credential-or-oauth-setup', /\bcredential|oauth\b/);
  add('webhook-contract-only', /\bwebhook[- ]only|consume\s+(?:an?\s+)?n8n\s+webhook/);
  const unique = [...new Set(matches)];
  if (unique.length === 1) return unique[0];
  const liveMatches = unique.filter((operation) => LIVE_OPERATIONS.has(operation));
  if (liveMatches.length === 1) return liveMatches[0];
  if (liveMatches.length > 1) return null;
  for (const specific of ['prepare-import', 'effective-payload-compare', 'workflow-compile']) {
    if (unique.includes(specific)) return specific;
  }
  const helperMatches = unique.filter((operation) => HELPER_OPERATIONS.has(operation));
  if (helperMatches.length === 1) return helperMatches[0];
  if (unique.includes('credential-or-oauth-setup')) return 'credential-or-oauth-setup';
  if (unique.includes('workflow-material-edit') && unique.includes('workflow-json-structure') && unique.length === 2) return 'workflow-material-edit';
  return null;
}

function inferN8nFacets(value) {
  const text = String(value || '').toLowerCase();
  const facets = [];
  const add = (facet, pattern) => { if (pattern.test(text)) facets.push(facet); };
  add('agents', /ai agent|chat agent|language model|memory node|tool node/);
  add('binary', /binary|attachment|upload|download|file data|image data/);
  add('code-node', /code node|n8n-nodes-base\.code|nodes-base\.code|java(?:script)? in n8n|python in n8n/);
  add('data-tables', /data table|n8n-nodes-base\.datatable|data-table/);
  add('debugging', /debug|repair|broken|failing|validation error/);
  add('error-handling', /error handling|error workflow|error trigger|continue on fail|onerror|retry on fail/);
  add('expressions', /expression|\{\{|\$json|\$node|\$input/);
  add('loops', /loop over items|split in batches|pagination|batching/);
  add('node-configuration', /node configuration|node parameter|"parameters"\s*:/);
  add('subworkflows', /sub-?workflow|execute workflow trigger|call workflow/);
  add('workflow-lifecycle', /workflow (?:design|create|edit|repair|review|json|sdk)|"nodes"\s*:|"connections"\s*:/);
  add('extending-mcp', /expose.*mcp|mcp server trigger|n8n.*mcp tool/);
  return [...new Set(facets)];
}

function classifyN8nOperation(input) {
  if (!isObject(input)) fail('n8n operation input must be an object.');
  const detection = detectN8nTask(input);
  if (!detection.detected) return { detected: false, operation: null, facets: [], detection };
  const operation = input.operation ? string(input.operation, 'operation', 100) : inferN8nOperation(input.objective || input.prompt);
  if (!operation || !ALL_OPERATIONS.has(operation)) {
    return { detected: true, operation: null, facets: [], detection, classificationRequired: true };
  }
  const explicitFacets = Array.isArray(input.facets) ? input.facets.map((facet) => string(facet, 'facet', 80)) : [];
  const facets = [...new Set([...explicitFacets, ...inferN8nFacets(`${input.objective || input.prompt || ''}\n${input.evidenceText || ''}`)])];
  for (const facet of facets) if (!FACET_SKILLS[facet]) fail(`Unsupported n8n facet ${facet}.`, 'N8N_FACET_UNSUPPORTED');
  return { detected: true, operation, facets, detection, classificationRequired: false };
}

function requiredSkillsForOperation(operation, facets = []) {
  const required = [];
  if (MATERIAL_SKILL_OPERATIONS.has(operation) || OPERATION_SKILLS[operation]) required.push(OFFICIAL_N8N_SKILLS_CONTRACT.entryPoint);
  required.push(...(OPERATION_SKILLS[operation] || []));
  for (const facet of facets) required.push(FACET_SKILLS[facet]);
  return [...new Set(required)];
}

function requiredCapabilities(classification) {
  if (classification.classificationRequired) {
    return [{ capabilityId: 'classify:exact-operation', kind: 'classification', name: 'exact-n8n-operation', status: 'pending', evidence: [] }];
  }
  if (classification.operation === 'webhook-contract-only') {
    return [{
      capabilityId: 'classification:webhook-contract-only',
      kind: 'classification',
      name: 'webhook-contract-only',
      status: 'verified',
      evidence: [`digest:${classification.detection.evidenceDigest.slice(7, 23)}`]
    }];
  }
  const capabilities = requiredSkillsForOperation(classification.operation, classification.facets).map((skillName) => ({
    capabilityId: `official-skill:${skillName}`,
    kind: 'official-skill',
    name: skillName,
    status: 'pending',
    evidence: []
  }));
  if (HELPER_OPERATIONS.has(classification.operation)) {
    capabilities.push({ capabilityId: `toolkit-helper:${classification.operation}`, kind: 'toolkit-helper', name: classification.operation, ownerIssue: '#265', status: 'pending', evidence: [] });
  }
  if (LIVE_OPERATIONS.has(classification.operation)) {
    capabilities.push({ capabilityId: `live-route:${classification.operation}`, kind: 'live-route', name: classification.operation, ownerIssue: '#286', status: 'pending', evidence: [] });
  }
  if (classification.operation === 'credential-or-oauth-setup') {
    capabilities.push({ capabilityId: 'external-route:credential-or-oauth-setup', kind: 'external-route', name: 'credential-or-oauth-setup', ownerIssue: '#286', status: 'pending', evidence: [] });
  }
  return capabilities;
}

function reconcileN8nCapabilityLedger(ledger, input = {}) {
  validateN8nCapabilityLedger(ledger);
  const next = clone(ledger);
  const requestedOperation = input.operation && ALL_OPERATIONS.has(input.operation) ? input.operation : null;
  if (requestedOperation && requestedOperation !== next.operation) {
    return {
      ledger: next,
      changed: false,
      mismatch: {
        stableCode: 'N8N_OPERATION_MISMATCH',
        missingCapability: `classify:${requestedOperation}`,
        supportedNextAction: `State and approve ${requestedOperation} as the exact n8n operation so the task ledger can be rebuilt before mutation.`
      }
    };
  }
  const inferredFacets = inferN8nFacets(input.evidenceText || '');
  const newFacets = inferredFacets.filter((facet) => !next.facets.includes(facet));
  const requiredSkillNames = requiredSkillsForOperation(next.operation, [...next.facets, ...newFacets]);
  let changed = false;
  for (const skillName of requiredSkillNames) {
    if (next.requiredCapabilities.some((entry) => entry.capabilityId === `official-skill:${skillName}`)) continue;
    next.requiredCapabilities.push({
      capabilityId: `official-skill:${skillName}`,
      kind: 'official-skill',
      name: skillName,
      status: 'pending',
      evidence: []
    });
    changed = true;
  }
  if (newFacets.length > 0) {
    next.facets.push(...newFacets);
    changed = true;
  }
  if (changed) {
    next.status = 'pending';
    next.updatedAt = input.recordedAt || new Date(0).toISOString();
  }
  validateN8nCapabilityLedger(next);
  return { ledger: next, changed, mismatch: null };
}

function createN8nCapabilityLedger(input) {
  if (!isObject(input)) fail('n8n ledger input must be an object.');
  const classification = classifyN8nOperation(input);
  if (!classification.detected) fail('No active n8n task was proven.', 'N8N_TASK_NOT_DETECTED');
  const sessionId = string(input.sessionId, 'sessionId', 300);
  const repositoryIdentity = string(input.repositoryIdentity || input.cwd || 'unbound-workspace', 'repositoryIdentity', 1000);
  const taskFingerprint = sha256({ sessionId, repositoryIdentity, objective: input.objective || input.prompt || '', evidence: classification.detection.evidenceDigest });
  const ledger = {
    schemaVersion: N8N_LEDGER_SCHEMA_VERSION,
    taskId: `n8n-${taskFingerprint.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    sessionFingerprint: sha256(sessionId),
    repositoryFingerprint: sha256(repositoryIdentity),
    objectiveDigest: externalRouter.objectiveAuthorityDigest(input.objective || input.prompt || ''),
    objectiveTargetDigest: objectiveTargetBinding(input.objective || input.prompt || '').digest,
    detection: classification.detection,
    operation: classification.operation,
    facets: classification.facets,
    sourceContract: OFFICIAL_N8N_SKILLS_CONTRACT,
    requiredCapabilities: requiredCapabilities(classification),
    invocationEvidence: [],
    status: 'pending',
    createdAt: input.createdAt || new Date(0).toISOString(),
    updatedAt: input.createdAt || new Date(0).toISOString()
  };
  validateN8nCapabilityLedger(ledger);
  return ledger;
}

function validateN8nCapabilityLedger(ledger) {
  if (!isObject(ledger) || ledger.schemaVersion !== N8N_LEDGER_SCHEMA_VERSION) fail('Unsupported n8n capability ledger schema.');
  string(ledger.taskId, 'taskId', 128);
  for (const field of ['sessionFingerprint', 'repositoryFingerprint', 'objectiveDigest', 'objectiveTargetDigest']) {
    if (!/^sha256:[0-9a-f]{64}$/.test(ledger[field] || '')) fail(`${field} is invalid.`);
  }
  if (!isObject(ledger.detection) || !/^sha256:[0-9a-f]{64}$/.test(ledger.detection.evidenceDigest || '')) fail('Ledger detection evidence is invalid.');
  if (ledger.operation !== null && !ALL_OPERATIONS.has(ledger.operation)) fail('Ledger operation is invalid.');
  if (!Array.isArray(ledger.facets) || new Set(ledger.facets).size !== ledger.facets.length) fail('Ledger facets must be a unique array.');
  for (const facet of ledger.facets) if (!FACET_SKILLS[facet]) fail(`Ledger facet ${facet} is invalid.`);
  if (!isObject(ledger.sourceContract) || sha256(ledger.sourceContract) !== sha256(OFFICIAL_N8N_SKILLS_CONTRACT)) {
    fail('Ledger official n8n Skills source contract is stale or malformed.', 'N8N_LEDGER_SOURCE_CONTRACT_MISMATCH');
  }
  if (!Array.isArray(ledger.requiredCapabilities) || ledger.requiredCapabilities.length === 0) fail('Ledger requires at least one capability.');
  const expectedCapabilities = requiredCapabilities({
    operation: ledger.operation,
    facets: ledger.facets,
    detection: ledger.detection,
    classificationRequired: ledger.operation === null
  });
  if (ledger.requiredCapabilities.length !== expectedCapabilities.length) fail('Ledger required-capability set is incomplete or contains unsupported entries.', 'N8N_LEDGER_CAPABILITY_MISMATCH');
  const expectedById = new Map(expectedCapabilities.map((entry) => [entry.capabilityId, entry]));
  const capabilityIds = new Set();
  for (const capability of ledger.requiredCapabilities) {
    if (!isObject(capability)) fail('Capability entries must be objects.');
    string(capability.capabilityId, 'capabilityId', 200);
    string(capability.kind, 'capability kind', 80);
    string(capability.name, 'capability name', 160);
    if (capabilityIds.has(capability.capabilityId)) fail(`Duplicate capability ${capability.capabilityId}.`, 'N8N_LEDGER_CAPABILITY_MISMATCH');
    capabilityIds.add(capability.capabilityId);
    const expected = expectedById.get(capability.capabilityId);
    if (!expected || capability.kind !== expected.kind || capability.name !== expected.name || (capability.ownerIssue || null) !== (expected.ownerIssue || null)) {
      fail(`Capability ${capability.capabilityId} does not match the classified operation.`, 'N8N_LEDGER_CAPABILITY_MISMATCH');
    }
    if (!['pending', 'verified', 'blocked'].includes(capability.status)) fail(`Unsupported capability status ${capability.status}.`);
    if (!Array.isArray(capability.evidence)) fail('Capability evidence must be an array.');
    if (capability.status === 'pending' && (capability.evidence.length !== 0 || capability.blocker !== undefined)) fail(`Pending capability ${capability.capabilityId} contains unsupported evidence.`);
    if (capability.status === 'blocked') {
      string(capability.blocker, 'capability blocker', 500);
      if (capability.evidence.length !== 1 || !/^blocked:[0-9a-f]{16}$/.test(capability.evidence[0])) fail(`Blocked capability ${capability.capabilityId} lacks bounded blocker evidence.`);
    }
    if (capability.status === 'verified' && capability.evidence.length !== 1) fail(`Verified capability ${capability.capabilityId} requires exactly one evidence reference.`);
  }
  if (!Array.isArray(ledger.invocationEvidence)) fail('invocationEvidence must be an array.');
  const invocationIds = new Set();
  for (const evidence of ledger.invocationEvidence) {
    if (!isObject(evidence)) fail('Skill invocation evidence entries must be objects.');
    const invocationId = string(evidence.invocationId, 'invocationId', 160);
    if (invocationIds.has(invocationId)) fail(`Duplicate Skill invocation ${invocationId}.`, 'N8N_LEDGER_INVOCATION_MISMATCH');
    invocationIds.add(invocationId);
    string(evidence.skillName, 'skillName', 160);
    if (!['success', 'failed'].includes(evidence.result) || typeof evidence.accepted !== 'boolean') fail(`Skill invocation ${invocationId} has an invalid result.`);
    if (!Number.isFinite(Date.parse(evidence.invokedAt))) fail(`Skill invocation ${invocationId} has an invalid timestamp.`);
    if (evidence.accepted) {
      const exact = evidence.result === 'success'
        && evidence.packageId === OFFICIAL_N8N_SKILLS_CONTRACT.packageId
        && evidence.packageVersion === OFFICIAL_N8N_SKILLS_CONTRACT.packageVersion
        && evidence.sourceRepository === OFFICIAL_N8N_SKILLS_CONTRACT.sourceRepository
        && OFFICIAL_N8N_SKILLS_CONTRACT.supportedSourceCommits.includes(evidence.sourceCommit)
        && evidence.compatibilityBaselineCommit === OFFICIAL_N8N_SKILLS_CONTRACT.compatibilityBaselineCommit
        && evidence.compatibilityReference === OFFICIAL_N8N_SKILLS_CONTRACT.compatibilityOwner
        && evidence.contentCompatibility === OFFICIAL_N8N_SKILLS_CONTRACT.contentCompatibility
        && evidence.manifestBlob === OFFICIAL_N8N_SKILLS_CONTRACT.claudePluginManifestBlob
        && evidence.skillBlob === OFFICIAL_N8N_SKILL_BLOBS[evidence.skillName]
        && /^sha256:[0-9a-f]{64}$/.test(evidence.sourceFingerprint || '');
      if (!exact) fail(`Accepted Skill invocation ${invocationId} is not bound to the reviewed source contract.`, 'N8N_LEDGER_INVOCATION_MISMATCH');
    }
  }
  for (const capability of ledger.requiredCapabilities.filter((entry) => entry.kind === 'official-skill' && entry.status === 'verified')) {
    const match = /^skill-invocation:(.+)$/.exec(capability.evidence[0] || '');
    const invocation = match && ledger.invocationEvidence.find((entry) => entry.invocationId === match[1]);
    if (!invocation || invocation.accepted !== true || invocation.skillName !== capability.name) {
      fail(`Verified official Skill ${capability.name} lacks one matching accepted invocation.`, 'N8N_LEDGER_INVOCATION_MISMATCH');
    }
  }
  assertNoSecretMaterial(ledger, 'n8n capability ledger');
  return ledger;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function recordSkillInvocation(ledger, invocation) {
  validateN8nCapabilityLedger(ledger);
  if (!isObject(invocation)) fail('Skill invocation evidence must be an object.');
  const next = clone(ledger);
  const skillName = normalizeSkillName(invocation.skillName || invocation.skill || invocation.name);
  const result = invocation.result === 'success' ? 'success' : 'failed';
  const attestation = isObject(invocation.sourceAttestation) ? invocation.sourceAttestation : {};
  const sourceMatches = attestation.verified === true
    && attestation.skillName === skillName
    && attestation.packageId === OFFICIAL_N8N_SKILLS_CONTRACT.packageId
    && attestation.packageVersion === OFFICIAL_N8N_SKILLS_CONTRACT.packageVersion
    && attestation.sourceRepository === OFFICIAL_N8N_SKILLS_CONTRACT.sourceRepository
    && OFFICIAL_N8N_SKILLS_CONTRACT.supportedSourceCommits.includes(attestation.sourceCommit)
    && attestation.compatibilityBaselineCommit === OFFICIAL_N8N_SKILLS_CONTRACT.compatibilityBaselineCommit
    && attestation.compatibilityReference === OFFICIAL_N8N_SKILLS_CONTRACT.compatibilityOwner
    && attestation.contentCompatibility === OFFICIAL_N8N_SKILLS_CONTRACT.contentCompatibility
    && attestation.manifestBlob === OFFICIAL_N8N_SKILLS_CONTRACT.claudePluginManifestBlob
    && attestation.skillBlob === OFFICIAL_N8N_SKILL_BLOBS[skillName]
    && /^sha256:[0-9a-f]{64}$/.test(attestation.sourceFingerprint || '');
  const unambiguous = /^[a-z0-9][a-z0-9-]{1,127}$/.test(skillName);
  const required = next.requiredCapabilities.find((entry) => entry.kind === 'official-skill' && entry.name === skillName);
  const accepted = result === 'success' && sourceMatches && unambiguous && Boolean(required);
  const evidence = {
    invocationId: string(invocation.invocationId, 'invocationId', 160),
    skillName: skillName || 'missing',
    result,
    accepted,
    sourceStatus: attestation.stableCode || 'N8N_SKILL_SOURCE_MISSING',
    packageId: attestation.packageId || 'missing',
    packageVersion: attestation.packageVersion || 'missing',
    sourceRepository: attestation.sourceRepository || 'missing',
    sourceCommit: attestation.sourceCommit || 'missing',
    compatibilityBaselineCommit: attestation.compatibilityBaselineCommit || 'missing',
    compatibilityReference: attestation.compatibilityReference || 'missing',
    contentCompatibility: attestation.contentCompatibility || 'missing',
    manifestBlob: attestation.manifestBlob || 'missing',
    skillBlob: attestation.skillBlob || 'missing',
    sourceFingerprint: attestation.sourceFingerprint || 'missing',
    normalization: attestation.normalization || 'missing',
    host: invocation.host || 'unknown',
    event: invocation.event || 'unknown',
    invokedAt: invocation.invokedAt || new Date(0).toISOString()
  };
  next.invocationEvidence.push(evidence);
  if (accepted) {
    required.status = 'verified';
    required.evidence = [`skill-invocation:${evidence.invocationId}`];
  }
  next.updatedAt = evidence.invokedAt;
  const audit = auditN8nCompletion(next);
  next.status = audit.complete ? 'complete' : 'pending';
  validateN8nCapabilityLedger(next);
  return { ledger: next, accepted, evidence };
}

function recordCapabilityEvidence(ledger, evidence) {
  validateN8nCapabilityLedger(ledger);
  if (!isObject(evidence)) fail('Capability evidence must be an object.');
  const next = clone(ledger);
  const capability = next.requiredCapabilities.find((entry) => entry.capabilityId === evidence.capabilityId);
  if (!capability) fail(`Capability ${evidence.capabilityId} is not required by this task.`, 'N8N_CAPABILITY_NOT_REQUIRED');
  if (capability.kind === 'official-skill') {
    fail(`Official Skill capability ${capability.name} can be satisfied only by one successfully attested Skill invocation.`, 'N8N_OFFICIAL_SKILL_INVOCATION_REQUIRED');
  }
  if (capability.kind === 'classification') {
    fail('Exact operation classification requires rebuilding the bound n8n task ledger.', 'N8N_EXACT_CLASSIFICATION_REQUIRED');
  }
  if (evidence.result === 'blocked') {
    capability.status = 'blocked';
    capability.blocker = string(evidence.blocker, 'blocker', 500);
    capability.evidence = [`blocked:${sha256(capability.blocker).slice(7, 23)}`];
  } else if (evidence.result === 'verified') {
    if (!/^(receipt|test|digest):[a-zA-Z0-9._/-]+$/.test(evidence.reference || '')) fail('Verified capability evidence requires one safe receipt/test/digest reference.');
    if (['live-route', 'external-route'].includes(capability.kind) && !/^receipt:[a-zA-Z0-9._/-]+$/.test(evidence.reference)) {
      fail(`${capability.kind} requires one structured operation receipt reference.`, 'N8N_STRUCTURED_RECEIPT_REQUIRED');
    }
    capability.status = 'verified';
    capability.evidence = [evidence.reference];
  } else {
    fail('Capability evidence result must be verified or blocked.');
  }
  next.updatedAt = evidence.recordedAt || new Date(0).toISOString();
  const audit = auditN8nCompletion(next);
  next.status = audit.complete ? 'complete' : audit.blocked ? 'blocked' : 'pending';
  validateN8nCapabilityLedger(next);
  return next;
}

function validateCapabilityReceiptShape(receipt) {
  if (!isObject(receipt)) fail('Capability receipt must be an object.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  const allowed = new Set([
    'schemaVersion', 'taskId', 'operation', 'capabilityId', 'issuer', 'result', 'reference',
    'blocker', 'commandDigest', 'sourceDigest', 'operationAuthority', 'recordedAt', 'receiptDigest'
  ]);
  for (const key of Object.keys(receipt)) if (!allowed.has(key)) fail(`Capability receipt contains unsupported field ${key}.`, 'N8N_CAPABILITY_RECEIPT_INVALID');
  if (receipt.schemaVersion !== N8N_CAPABILITY_RECEIPT_SCHEMA_VERSION) fail('Unsupported n8n capability receipt schema.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  string(receipt.taskId, 'receipt.taskId', 128);
  const operation = string(receipt.operation, 'receipt.operation', 100);
  if (!ALL_OPERATIONS.has(operation)) fail('Capability receipt operation is invalid.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  string(receipt.capabilityId, 'receipt.capabilityId', 200);
  if (!['toolkit-helper', 'external-system-router'].includes(receipt.issuer)) fail('Capability receipt issuer is unsupported.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  if (!['verified', 'blocked'].includes(receipt.result)) fail('Capability receipt result must be verified or blocked.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  if (receipt.result === 'verified') {
    if (!/^receipt:[a-zA-Z0-9._/-]+$/.test(receipt.reference || '')) fail('Verified capability receipt requires one safe receipt reference.', 'N8N_CAPABILITY_RECEIPT_INVALID');
    if (receipt.blocker !== undefined) fail('Verified capability receipt must not include a blocker.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  } else {
    string(receipt.blocker, 'receipt.blocker', 500);
    if (receipt.reference !== undefined) fail('Blocked capability receipt must not include a verified reference.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(receipt.commandDigest || '')) fail('Capability receipt command digest is invalid.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  if (receipt.issuer === 'toolkit-helper' && !/^sha256:[0-9a-f]{64}$/.test(receipt.sourceDigest || '')) {
    fail('Toolkit-helper capability receipt source digest is invalid.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  }
  if (receipt.issuer === 'toolkit-helper' && receipt.operationAuthority !== undefined) {
    fail('Toolkit-helper capability receipt must not carry external operation authority.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  }
  if (receipt.issuer === 'external-system-router' && receipt.result === 'verified' && !isObject(receipt.operationAuthority)) {
    fail('Verified external capability receipt requires validated operation authority.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  }
  if (!Number.isFinite(Date.parse(receipt.recordedAt || ''))) fail('Capability receipt recordedAt is invalid.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  if (!/^sha256:[0-9a-f]{64}$/.test(receipt.receiptDigest || '')) fail('Capability receipt digest is invalid.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  const digestInput = { ...receipt };
  delete digestInput.receiptDigest;
  if (receipt.receiptDigest !== sha256(digestInput)) fail('Capability receipt digest does not match its bounded payload.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  assertNoSecretMaterial(receipt, 'n8n capability receipt');
  return receipt;
}

function isCapabilityReceiptIngestionToolUse(input) {
  if (!isObject(input)) return false;
  const toolName = String(input.tool_name || input.toolName || '');
  if (toolName !== 'Bash' && toolName !== 'PowerShell') return false;
  const toolInput = isObject(input.tool_input) ? input.tool_input : isObject(input.toolInput) ? input.toolInput : {};
  const command = String(toolInput.command || '').trim();
  if (!command || command.length > 4096 || /[\r\n;&|><`]|\$\(/.test(command)) return false;
  const match = command.match(/^node(?:\.exe)?\s+(?:"([^"]+)"|'([^']+)'|([^\s"']+))\s+ingest-capability-receipt\s+(?:"([^"]+\.json)"|'([^']+\.json)'|([^\s"']+\.json))$/i);
  if (!match) return false;
  const scriptArgument = match[1] || match[2] || match[3];
  const cwd = typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd : process.cwd();
  const candidate = path.resolve(cwd, scriptArgument);
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const actual = fs.realpathSync(candidate);
    const expected = fs.realpathSync(__filename);
    return process.platform === 'win32'
      ? actual.toLowerCase() === expected.toLowerCase()
      : actual === expected;
  } catch {
    return false;
  }
}

function tokenizeBoundedCommand(command) {
  if (!command || command.length > 4096 || /[\r\n;&|><`]|\$\(/.test(command)) return null;
  const tokens = [];
  let token = '';
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = '';
      }
      continue;
    }
    token += character;
  }
  if (quote) return null;
  if (token) tokens.push(token);
  return tokens;
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveToolkitHelperProducer(input, ledger, options = {}) {
  if (!isObject(input) || !isObject(ledger) || ledger.operation !== 'workflow-compile') return null;
  const toolName = String(input.tool_name || input.toolName || '');
  if (toolName !== 'Bash' && toolName !== 'PowerShell') return null;
  const toolInput = isObject(input.tool_input) ? input.tool_input : isObject(input.toolInput) ? input.toolInput : {};
  const command = String(toolInput.command || '').trim();
  const tokens = tokenizeBoundedCommand(command);
  if (!tokens || tokens.length < 4 || !/^node(?:\.exe)?$/i.test(tokens[0])) return null;
  const cwd = path.resolve(typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd : process.cwd());
  const scriptCandidate = path.resolve(cwd, tokens[1]);
  const defaultHelperRoot = path.resolve(__dirname, '..', '..', 'n8n-workflow-helper-scripts', 'templates', 'helper-scripts');
  const helperRoots = (options.toolkitHelperRoots || [defaultHelperRoot]).map((entry) => path.resolve(entry));
  let scriptReal;
  try {
    const stat = fs.lstatSync(scriptCandidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    scriptReal = fs.realpathSync(scriptCandidate);
  } catch {
    return null;
  }
  let matchedRoot = null;
  for (const helperRoot of helperRoots) {
    try {
      const rootReal = fs.realpathSync(helperRoot);
      if (pathWithin(rootReal, scriptReal)) {
        matchedRoot = rootReal;
        break;
      }
    } catch {
      // An unavailable candidate root cannot prove current installed helper identity.
    }
  }
  if (!matchedRoot) return null;
  const relativeScript = path.relative(matchedRoot, scriptReal).replace(/\\/g, '/');
  if (relativeScript !== 'sanitizer/prepare-n8n-template.js') return null;
  const args = tokens.slice(2);
  if (args.length < 2 || args.length > 4) return null;
  const [inputPath, outputPath, ...flags] = args;
  if (!/\.json$/i.test(inputPath) || !/\.json$/i.test(outputPath)) return null;
  if (flags.some((flag) => !['--preserve-unicode', '--allow-empty'].includes(flag))) return null;
  const resolvedInput = path.resolve(cwd, inputPath);
  const resolvedOutput = path.resolve(cwd, outputPath);
  if (!pathWithin(cwd, resolvedInput) || !pathWithin(cwd, resolvedOutput) || sameResolvedPath(resolvedInput, resolvedOutput)) return null;
  try {
    const inputStat = fs.lstatSync(resolvedInput);
    if (!inputStat.isFile() || inputStat.isSymbolicLink() || !sameResolvedPath(fs.realpathSync(resolvedInput), resolvedInput)) return null;
  } catch {
    return null;
  }
  const capabilityId = 'toolkit-helper:workflow-compile';
  const capability = ledger.requiredCapabilities.find((entry) => entry.capabilityId === capabilityId);
  if (!capability || capability.status !== 'pending') return null;
  if (ledger.requiredCapabilities.some((entry) => entry.capabilityId !== capabilityId && entry.status !== 'verified')) return null;
  return {
    operation: 'workflow-compile',
    capabilityId,
    command,
    commandDigest: sha256(command),
    sourceDigest: sha256(fs.readFileSync(scriptReal))
  };
}

function isCapabilityProducerToolUse(input, ledger, options = {}) {
  return Boolean(resolveToolkitHelperProducer(input, ledger, options));
}

function capabilityReceiptFromProducerToolUse(input, ledger, options = {}) {
  const producer = resolveToolkitHelperProducer(input, ledger, options);
  if (!producer) fail('Tool use is not one supported installed Toolkit helper producer.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  const receipt = {
    schemaVersion: N8N_CAPABILITY_RECEIPT_SCHEMA_VERSION,
    taskId: ledger.taskId,
    operation: ledger.operation,
    capabilityId: producer.capabilityId,
    issuer: 'toolkit-helper',
    result: 'verified',
    reference: `receipt:toolkit-helper-${producer.operation}-${producer.sourceDigest.slice(7, 23)}`,
    commandDigest: producer.commandDigest,
    sourceDigest: producer.sourceDigest,
    recordedAt: input.timestamp || new Date(0).toISOString()
  };
  receipt.receiptDigest = sha256(receipt);
  return validateCapabilityReceiptShape(receipt);
}

function validateExternalCapabilityReceiptAuthority(receipt, ledger) {
  const authority = receipt.operationAuthority;
  if (!isObject(authority)) fail('External capability receipt lacks operation authority.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  const allowed = new Set(['routerSourceDigest', 'authorisationEnvelope', 'operationContext', 'operationReceipt']);
  for (const key of Object.keys(authority)) {
    if (!allowed.has(key)) fail(`External capability authority contains unsupported field ${key}.`, 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  }
  const installedDigest = sha256(readRegularFile(require.resolve('./external-system-router.cjs'), 'installed external-system router'));
  if (authority.routerSourceDigest !== installedDigest) {
    fail('External capability receipt is not bound to the exact installed router bytes.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  }
  externalRouter.validateAuthorizationEnvelope(authority.authorisationEnvelope);
  if (!isObject(authority.operationContext)) fail('External capability operation context is missing.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  const operationContext = authority.operationContext;
  const contextAllowed = new Set([
    'provider', 'targetAlias', 'accountOrOrganisation', 'resource', 'environment',
    'operation', 'targetFingerprint', 'readOnly', 'taskId', 'sessionFingerprint', 'objectiveDigest',
    'inventoryGeneration', 'inventoryDigest'
  ]);
  for (const key of Object.keys(operationContext)) {
    if (!contextAllowed.has(key)) fail(`External capability operation context contains unsupported field ${key}.`, 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  }
  for (const field of ['provider', 'targetAlias', 'accountOrOrganisation', 'resource', 'environment']) {
    if (operationContext[field] !== authority.authorisationEnvelope[field]) {
      fail(`External capability ${field} does not match the authorisation envelope.`, 'N8N_CAPABILITY_RECEIPT_MISMATCH');
    }
  }
  if (operationContext.operation !== ledger.operation || !authority.authorisationEnvelope.allowedOperations.includes(ledger.operation)) {
    fail('External capability operation does not match the active ledger and envelope.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  }
  if (authority.authorisationEnvelope.lifetime.kind !== 'task'
    || operationContext.taskId !== ledger.taskId
    || operationContext.sessionFingerprint !== ledger.sessionFingerprint
    || operationContext.objectiveDigest !== ledger.objectiveDigest
    || authority.authorisationEnvelope.lifetime.taskId !== ledger.taskId
    || authority.authorisationEnvelope.lifetime.sessionFingerprint !== ledger.sessionFingerprint
    || authority.authorisationEnvelope.lifetime.objectiveDigest !== ledger.objectiveDigest) {
    fail('External capability authority does not match the active task, session, and objective.',
      'N8N_CAPABILITY_RECEIPT_MISMATCH');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(operationContext.targetFingerprint || '')) {
    fail('External capability target fingerprint is invalid.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  }
  externalRouter.validateOperationReceipt(authority.operationReceipt, {
    authorisationEnvelope: authority.authorisationEnvelope,
    operationContext
  });
  if (authority.operationReceipt.authorisationReference !== authority.authorisationEnvelope.ownerApprovalReference
    || authority.operationReceipt.precondition !== 'passed'
    || (authority.operationReceipt.mutationPerformed && authority.operationReceipt.postcondition !== 'passed')
    || receipt.reference !== `receipt:${authority.operationReceipt.operationId}`) {
    fail('External capability operation receipt lacks exact owner, precondition, result, or reference binding.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  }
  return authority;
}

function recordCapabilityReceipt(ledger, receipt, binding = {}) {
  validateN8nCapabilityLedger(ledger);
  validateCapabilityReceiptShape(receipt);
  if (receipt.taskId !== ledger.taskId || receipt.operation !== ledger.operation) {
    fail('Capability receipt is not bound to the active task and exact operation.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  }
  const capability = ledger.requiredCapabilities.find((entry) => entry.capabilityId === receipt.capabilityId);
  if (!capability || !['toolkit-helper', 'live-route', 'external-route'].includes(capability.kind)) {
    fail('Capability receipt does not name one required non-Skill capability.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  }
  const expectedIssuer = capability.kind === 'toolkit-helper' ? 'toolkit-helper' : 'external-system-router';
  if (receipt.issuer !== expectedIssuer) fail('Capability receipt issuer does not own the required capability.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  const ingestion = isCapabilityReceiptIngestionToolUse(binding.input || {});
  const producer = resolveToolkitHelperProducer(binding.input || {}, ledger, binding.options || {});
  if (!ingestion && !producer) fail('Capability receipt was not delivered through a supported bounded ingestion or installed-helper producer path.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  const toolInput = binding.input.tool_input || binding.input.toolInput || {};
  if (receipt.commandDigest !== sha256(String(toolInput.command || '').trim())) fail('Capability receipt command binding does not match the completed tool use.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  if (producer && (receipt.capabilityId !== producer.capabilityId || receipt.sourceDigest !== producer.sourceDigest)) {
    fail('Capability receipt does not match the exact installed Toolkit helper bytes.', 'N8N_CAPABILITY_RECEIPT_MISMATCH');
  }
  if (receipt.issuer === 'external-system-router' && receipt.result === 'verified') {
    validateExternalCapabilityReceiptAuthority(receipt, ledger);
  }
  return recordCapabilityEvidence(ledger, receipt.result === 'verified'
    ? { capabilityId: receipt.capabilityId, result: 'verified', reference: receipt.reference, recordedAt: receipt.recordedAt }
    : { capabilityId: receipt.capabilityId, result: 'blocked', blocker: receipt.blocker, recordedAt: receipt.recordedAt });
}

function parseCapabilityReceiptOutput(input) {
  const raw = input.tool_response ?? input.toolResponse ?? input.tool_output ?? input.toolOutput ?? input.tool_result ?? input.toolResult;
  if (raw === undefined || raw === null) return null;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (Buffer.byteLength(text, 'utf8') > CAPABILITY_RECEIPT_MAX_BYTES) fail('Capability receipt output exceeds the bounded ingestion limit.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  try {
    return validateCapabilityReceiptShape(typeof raw === 'string' ? JSON.parse(raw.trim()) : raw);
  } catch (error) {
    if (error.code) throw error;
    fail('Capability receipt output is not one exact JSON object.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  }
}

function nextActionFor(capability) {
  if (capability.kind === 'classification') return 'State one exact n8n operation so the domain router can rebuild the task ledger.';
  if (capability.kind === 'official-skill') return `Invoke the official ${capability.name} Skill successfully through the host Skill tool, then retry the governed operation.`;
  if (capability.kind === 'toolkit-helper') return `Run the supported Toolkit ${capability.name} helper/compiler path and record its verified receipt.`;
  if (capability.kind === 'live-route') return `Complete the external-system target envelope and operation-specific structured-interface audit for ${capability.name}.`;
  if (capability.kind === 'external-route') return 'Complete the external-system credential/OAuth route and its required informed approval evidence.';
  return `Satisfy ${capability.capabilityId} through its supported owner.`;
}

function auditN8nCompletion(ledger) {
  validateN8nCapabilityLedger(ledger);
  const missing = ledger.requiredCapabilities.find((entry) => entry.status === 'pending');
  if (missing) {
    return {
      complete: false,
      blocked: false,
      stableCode: 'N8N_CAPABILITY_MISSING',
      missingCapability: missing.capabilityId,
      supportedNextAction: nextActionFor(missing)
    };
  }
  const blocked = ledger.requiredCapabilities.find((entry) => entry.status === 'blocked');
  if (blocked) {
    return {
      complete: false,
      blocked: true,
      stableCode: 'N8N_CAPABILITY_BLOCKED',
      missingCapability: blocked.capabilityId,
      blocker: blocked.blocker,
      supportedNextAction: nextActionFor(blocked)
    };
  }
  return { complete: true, blocked: false, stableCode: 'N8N_CAPABILITIES_VERIFIED', supportedNextAction: 'Continue only with the exact classified n8n operation.' };
}

function assertN8nMutationAdmitted(ledger, mutation = {}) {
  validateN8nCapabilityLedger(ledger);
  const toolName = string(mutation.toolName || 'unknown', 'toolName', 80);
  if (!isGovernedN8nMutationTool(toolName)) return { admitted: true, governed: false };
  const audit = auditN8nCompletion(ledger);
  if (!audit.complete) {
    fail(`${audit.stableCode}: ${audit.missingCapability}. ${audit.supportedNextAction}`, audit.stableCode, audit);
  }
  return {
    admitted: true,
    governed: true,
    operation: ledger.operation,
    taskId: ledger.taskId,
    sourceVersion: `${OFFICIAL_N8N_SKILLS_CONTRACT.packageId}@${OFFICIAL_N8N_SKILLS_CONTRACT.packageVersion}`
  };
}

function looksLikeN8nWorkflowMutation(input) {
  if (!isObject(input)) return false;
  const toolName = String(input.tool_name || input.toolName || '');
  if (!isGovernedN8nMutationTool(toolName)) return false;
  if (N8N_MCP_TOOL_PATTERN.test(toolName)) return true;
  const toolInput = isObject(input.tool_input) ? input.tool_input : isObject(input.toolInput) ? input.toolInput : {};
  const combined = JSON.stringify(toolInput).toLowerCase().replace(/\\\\/g, '/');
  const targetPath = String(toolInput.file_path || toolInput.filePath || toolInput.path || toolInput.notebook_path || '').toLowerCase().replace(/\\/g, '/');
  const workflowPath = /(^|\/)n8n-workflows?\/.*\.json$/.test(targetPath) || /(^|\/)workflows?\/.*n8n.*\.json$/.test(targetPath);
  const workflowStructure = /"nodes"\s*:/.test(combined) && /"connections"\s*:/.test(combined);
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const relevant = /n8n-workflows?|\bn8n\b.*\b(?:workflow|node|expression|sdk|json)\b/.test(combined)
      || workflowStructure
      || inspectExistingN8nWorkflowTarget(input);
    if (!relevant) return false;
    return !isProvenReadOnlyToolUse(input);
  }
  return workflowPath || workflowStructure || inspectExistingN8nWorkflowTarget(input);
}

function isProvenReadOnlyToolUse(input) {
  if (!isObject(input)) return false;
  const toolName = String(input.tool_name || input.toolName || '');
  if (toolName !== 'Bash' && toolName !== 'PowerShell') return false;
  const toolInput = isObject(input.tool_input) ? input.tool_input : isObject(input.toolInput) ? input.toolInput : {};
  const command = String(toolInput.command || '').trim();
  if (!command || command.length > 10000 || /[\r\n;&|><`]|\$\(/.test(command)) return false;
  const normalized = command.toLowerCase().replace(/\\/g, '/');
  if (/^(?:get-content|select-string|get-childitem|type|cat)\b/.test(normalized)) return true;
  const tokens = tokenizeBoundedCommand(command);
  if (!tokens) return false;
  if (!/^git$/i.test(tokens[0] || '')) return false;
  return isIsolatedGitInspection(tokens)
    && !tokens.some((token) => /^--output(?:=|$)/i.test(token)
    || /^-o/i.test(token)
    || /^--(?:ext-diff|textconv|exec-path|show-signature|verify-signatures|config-env)(?:=|$)/i.test(token));
}

function isIsolatedGitInspection(tokens) {
  if (!Array.isArray(tokens) || !/^git$/i.test(tokens[0] || '')) return false;
  let noPager = false;
  let noOptionalLocks = false;
  const configs = new Map();
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--no-pager') {
      noPager = true;
      index += 1;
      continue;
    }
    if (token === '--no-optional-locks') {
      noOptionalLocks = true;
      index += 1;
      continue;
    }
    let config = null;
    if (token === '-c') {
      config = tokens[index + 1];
      index += 2;
    } else if (/^-c.+/i.test(token)) {
      config = token.slice(2);
      index += 1;
    } else {
      break;
    }
    if (typeof config !== 'string' || !config.includes('=')) return false;
    const separator = config.indexOf('=');
    const key = config.slice(0, separator).toLowerCase();
    const value = config.slice(separator + 1).toLowerCase();
    if (!['core.fsmonitor', 'core.hookspath', 'diff.external'].includes(key) || configs.has(key)) return false;
    configs.set(key, value);
  }
  const subcommand = String(tokens[index] || '').toLowerCase();
  const args = tokens.slice(index + 1).map((token) => token.toLowerCase());
  if (!noPager || !noOptionalLocks
    || configs.get('core.fsmonitor') !== 'false'
    || configs.get('core.hookspath') !== ''
    || configs.get('diff.external') !== ''
    || !['diff', 'log', 'show', 'status'].includes(subcommand)) return false;
  if (args.some((token) => /^--(?:paginate|show-signature|verify-signatures|config-env)(?:=|$)/.test(token))) return false;
  if (subcommand === 'status') return true;
  return args.includes('--no-ext-diff') && args.includes('--no-textconv');
}

function inspectExistingN8nWorkflowTarget(input) {
  if (!isObject(input)) return false;
  const toolName = String(input.tool_name || input.toolName || '');
  const toolInput = isObject(input.tool_input) ? input.tool_input : isObject(input.toolInput) ? input.toolInput : {};
  const cwd = path.resolve(typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd : process.cwd());
  let targets;
  if (['Bash', 'PowerShell'].includes(toolName)) {
    const tokens = tokenizeBoundedCommand(String(toolInput.command || '').trim());
    if (!tokens) return false;
    targets = tokens.map((token) => {
      const equalsOption = /^--?[a-z][a-z0-9-]*=(.+\.json)$/i.exec(token);
      return equalsOption ? equalsOption[1] : token;
    }).filter((token) => /\.json$/i.test(token));
  } else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
    targets = [String(toolInput.file_path || toolInput.filePath || toolInput.path || toolInput.notebook_path || '')];
  } else {
    return false;
  }
  return targets.some((target) => {
    if (!/\.json$/i.test(target)) return false;
    const candidate = path.resolve(cwd, target);
    if (!pathWithin(cwd, candidate)) return false;
    const fullContent = typeof toolInput.content === 'string' ? toolInput.content : null;
    if (fullContent && Buffer.byteLength(fullContent, 'utf8') <= N8N_WORKFLOW_MAX_BYTES) {
      try {
        const document = JSON.parse(fullContent);
        if (isObject(document) && Array.isArray(document.nodes) && isObject(document.connections)) return true;
      } catch {
        // Existing target inspection below remains authoritative for partial edits.
      }
    }
    try {
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > N8N_WORKFLOW_MAX_BYTES || !sameResolvedPath(fs.realpathSync(candidate), candidate)) return false;
      const document = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      return isObject(document) && Array.isArray(document.nodes) && isObject(document.connections);
    } catch {
      return !['Bash', 'PowerShell'].includes(toolName)
        && /(^|\/)workflows?\/.*\.json$/i.test(target.replace(/\\/g, '/'));
    }
  });
}

function readCapabilityReceiptFile(filePath) {
  const bytes = readRegularFile(path.resolve(filePath), 'n8n capability receipt');
  if (bytes.length > CAPABILITY_RECEIPT_MAX_BYTES) fail('Capability receipt file exceeds the bounded ingestion limit.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  return validateCapabilityReceiptShape(JSON.parse(bytes.toString('utf8')));
}

function runCli(argv) {
  const [command, file] = argv;
  if (command !== 'ingest-capability-receipt' || !file) fail('Usage: n8n-domain-router.cjs ingest-capability-receipt <receipt.json>.', 'N8N_CAPABILITY_RECEIPT_INVALID');
  process.stdout.write(`${JSON.stringify(readCapabilityReceiptFile(file))}\n`);
  return 0;
}

function defaultStateRoot() {
  return path.join(os.homedir(), '.ai-agent-toolkit', 'task-state', 'n8n');
}

function sameResolvedPath(left, right) {
  const normalize = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function validateStateRoot(stateRoot, options = {}) {
  const resolved = path.resolve(stateRoot);
  if (!fs.existsSync(resolved) && options.create === true) fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(resolved)) return resolved;
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameResolvedPath(fs.realpathSync(resolved), resolved)) {
    fail('n8n task-state root must be one exact non-symlink directory.', 'N8N_LEDGER_PATH_UNSAFE');
  }
  return resolved;
}

function stateFileFor(input, options = {}) {
  const sessionId = string(input.session_id || input.sessionId, 'session_id', 300);
  const cwd = string(input.cwd || 'unbound-workspace', 'cwd', 2000);
  const stateRoot = path.resolve(options.stateRoot || defaultStateRoot());
  const fileName = `${sha256({ sessionId, cwd }).slice(7, 39)}.json`;
  return path.join(stateRoot, fileName);
}

function readTaskLedger(input, options = {}) {
  const file = stateFileFor(input, options);
  if (!fs.existsSync(file)) return null;
  validateStateRoot(path.dirname(file));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !sameResolvedPath(fs.realpathSync(file), file)) fail('n8n task ledger path is not one exact regular file.', 'N8N_LEDGER_PATH_UNSAFE');
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateN8nCapabilityLedger(ledger);
  if (ledger.sessionFingerprint !== sha256(input.session_id || input.sessionId)) fail('n8n task ledger session binding does not match.', 'N8N_LEDGER_BINDING_MISMATCH');
  if (ledger.repositoryFingerprint !== sha256(input.cwd || 'unbound-workspace')) fail('n8n task ledger repository binding does not match.', 'N8N_LEDGER_BINDING_MISMATCH');
  return ledger;
}

function acquireTaskLedgerLock(input, options = {}) {
  const lockPath = `${stateFileFor(input, options)}.lock`;
  const ownerPath = path.join(lockPath, LEDGER_LOCK_OWNER_FILE);
  validateStateRoot(path.dirname(lockPath), { create: true });
  const ownerToken = options.lockOwnerToken || crypto.randomBytes(16).toString('hex');
  const now = typeof options.now === 'function' ? options.now() : options.now || Date.now();
  const owner = {
    schemaVersion: 1,
    token: ownerToken,
    pid: process.pid,
    createdAt: new Date(now).toISOString()
  };
  const create = () => {
    fs.mkdirSync(lockPath, { mode: 0o700 });
    try {
      fs.writeFileSync(ownerPath, JSON.stringify(owner), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (error) {
      try { fs.rmdirSync(lockPath); } catch {}
      throw error;
    }
  };
  const reclaimStaleUnowned = (lockStat, observedOwnerBytes) => {
    let ownerMtime = 0;
    try { ownerMtime = fs.lstatSync(ownerPath).mtimeMs; } catch {}
    const observedMtime = Math.max(lockStat.mtimeMs, ownerMtime);
    if (!Number.isFinite(observedMtime) || now - observedMtime <= LEDGER_LOCK_STALE_MS) {
      fail('n8n task ledger lock owner is unavailable; capability evidence was not recorded.', 'N8N_LEDGER_BUSY');
    }
    let currentLock;
    let currentOwnerBytes = null;
    let currentOwnerMtime = 0;
    try {
      currentLock = fs.lstatSync(lockPath);
      currentOwnerBytes = fs.existsSync(ownerPath) ? fs.readFileSync(ownerPath, 'utf8') : null;
      if (currentOwnerBytes !== null) currentOwnerMtime = fs.lstatSync(ownerPath).mtimeMs;
    } catch {
      fail('n8n task ledger lock changed during reclamation.', 'N8N_LEDGER_BUSY');
    }
    if (currentLock.mtimeMs !== lockStat.mtimeMs
      || currentOwnerMtime !== ownerMtime
      || currentOwnerBytes !== observedOwnerBytes) {
      fail('n8n task ledger lock changed during reclamation.', 'N8N_LEDGER_BUSY');
    }
    try {
      if (currentOwnerBytes !== null) fs.unlinkSync(ownerPath);
      fs.rmdirSync(lockPath);
      create();
    } catch {
      fail('n8n task ledger lock changed during reclamation.', 'N8N_LEDGER_BUSY');
    }
  };
  try {
    create();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = fs.lstatSync(lockPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail('n8n task ledger is busy; capability evidence was not recorded.', 'N8N_LEDGER_BUSY');
    }
    let previous;
    let previousOwnerBytes = null;
    try {
      previousOwnerBytes = fs.readFileSync(ownerPath, 'utf8');
      previous = JSON.parse(previousOwnerBytes);
    } catch {
      reclaimStaleUnowned(stat, previousOwnerBytes);
      previous = null;
    }
    if (previous) {
      const previousCreatedAt = Date.parse(previous.createdAt || '');
      const structurallyValid = previous.schemaVersion === 1
        && /^[0-9a-f]{32}$/.test(previous.token || '')
        && Number.isInteger(previous.pid)
        && Number.isFinite(previousCreatedAt);
      if (!structurallyValid) {
        reclaimStaleUnowned(stat, previousOwnerBytes);
      } else {
        const isProcessAlive = options.isProcessAlive || ((pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (probeError) {
            return probeError.code === 'EPERM';
          }
        });
        if (now - previousCreatedAt <= LEDGER_LOCK_STALE_MS || isProcessAlive(previous.pid)) {
          fail('n8n task ledger is busy; capability evidence was not recorded.', 'N8N_LEDGER_BUSY');
        }
        const currentOwnerBytes = fs.readFileSync(ownerPath, 'utf8');
        const current = JSON.parse(currentOwnerBytes);
        if (current.token !== previous.token || currentOwnerBytes !== previousOwnerBytes) {
          fail('n8n task ledger lock owner changed during reclamation.', 'N8N_LEDGER_BUSY');
        }
        fs.unlinkSync(ownerPath);
        fs.rmdirSync(lockPath);
        create();
      }
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    let current;
    try {
      current = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    } catch {
      return;
    }
    if (current.token !== ownerToken) return;
    fs.unlinkSync(ownerPath);
    fs.rmdirSync(lockPath);
  };
}

function persistTaskLedger(input, ledger, options = {}, lockHeld = false) {
  validateN8nCapabilityLedger(ledger);
  const file = stateFileFor(input, options);
  const release = lockHeld ? null : acquireTaskLedgerLock(input, options);
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    validateStateRoot(path.dirname(file), { create: true });
    if (fs.existsSync(file)) {
      const existing = fs.lstatSync(file);
      if (!existing.isFile() || existing.isSymbolicLink() || !sameResolvedPath(fs.realpathSync(file), file)) fail('n8n task ledger path is not one exact regular file.', 'N8N_LEDGER_PATH_UNSAFE');
    }
    fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (process.platform === 'win32' && fs.existsSync(file)) {
      fs.copyFileSync(temporary, file);
      fs.unlinkSync(temporary);
    } else {
      fs.renameSync(temporary, file);
    }
    return file;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (release) release();
  }
}

function writeTaskLedger(input, ledger, options = {}) {
  return persistTaskLedger(input, ledger, options, false);
}

function retireTaskLedger(input, options = {}) {
  const release = acquireTaskLedgerLock(input, options);
  try {
    const file = stateFileFor(input, options);
    if (!fs.existsSync(file)) return false;
    readTaskLedger(input, options);
    fs.unlinkSync(file);
    return true;
  } finally {
    release();
  }
}

function updateTaskLedger(input, updater, options = {}) {
  if (typeof updater !== 'function') fail('n8n task ledger updater must be a function.');
  const release = acquireTaskLedgerLock(input, options);
  try {
    const current = readTaskLedger(input, options);
    if (!current) fail('n8n task ledger is missing.', 'N8N_LEDGER_MISSING');
    const result = updater(current);
    const next = isObject(result) && isObject(result.ledger) ? result.ledger : result;
    validateN8nCapabilityLedger(next);
    persistTaskLedger(input, next, options, true);
    return result;
  } finally {
    release();
  }
}

module.exports = {
  N8N_LEDGER_SCHEMA_VERSION,
  N8N_CAPABILITY_RECEIPT_SCHEMA_VERSION,
  sha256,
  OFFICIAL_N8N_SKILLS_CONTRACT,
  OFFICIAL_N8N_SKILL_BLOBS,
  MATERIAL_SKILL_OPERATIONS,
  HELPER_OPERATIONS,
  LIVE_OPERATIONS,
  GOVERNED_MUTATION_TOOLS,
  N8N_MCP_TOOL_PATTERN_SOURCE,
  isGovernedN8nMutationTool,
  inferGovernedMutationOperation,
  normalizeSkillName,
  normalizeOfficialText,
  gitBlobSha1,
  readClaudePluginRecords,
  attestClaudeOfficialSkillInvocation,
  detectN8nTask,
  objectiveTargetBinding,
  inferN8nOperation,
  inferN8nFacets,
  classifyN8nOperation,
  requiredSkillsForOperation,
  reconcileN8nCapabilityLedger,
  createN8nCapabilityLedger,
  validateN8nCapabilityLedger,
  recordSkillInvocation,
  recordCapabilityEvidence,
  validateCapabilityReceiptShape,
  validateExternalCapabilityReceiptAuthority,
  isCapabilityReceiptIngestionToolUse,
  resolveToolkitHelperProducer,
  isCapabilityProducerToolUse,
  capabilityReceiptFromProducerToolUse,
  recordCapabilityReceipt,
  parseCapabilityReceiptOutput,
  auditN8nCompletion,
  assertN8nMutationAdmitted,
  looksLikeN8nWorkflowMutation,
  inspectExistingN8nWorkflowTarget,
  isProvenReadOnlyToolUse,
  defaultStateRoot,
  stateFileFor,
  readTaskLedger,
  writeTaskLedger,
  retireTaskLedger,
  acquireTaskLedgerLock,
  updateTaskLedger
};

if (require.main === module) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.code || 'N8N_DOMAIN_ROUTER_INVALID'}: ${error.message}\n`);
    process.exitCode = 2;
  }
}
