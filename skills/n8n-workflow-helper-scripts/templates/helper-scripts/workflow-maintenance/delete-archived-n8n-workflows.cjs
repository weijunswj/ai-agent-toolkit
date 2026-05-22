#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIRM_TEXT = 'DELETE ARCHIVED WORKFLOWS';
const BACKUP_DIR = '.n8n-workflow-backups';
const PAGE_LIMIT = 250;
const ARCHIVE_FIELDS = ['isArchived', 'archived', 'archive'];
const PUBLISHED_FIELDS = ['published', 'isPublished'];
const SELF_CLEANUP_NAME_PATTERN =
  /delete archived workflows|archived workflow cleanup|delete-archived-n8n-workflows|workflow maintenance cleanup/i;

function normalizeApiRoot(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const url = new URL(raw);
  if (url.username || url.password) {
    throw new Error('N8N_BASE_URL must not include username or password data.');
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname === '/api/v1' || pathname.endsWith('/api/v1')) {
    return `${url.origin}${pathname}`;
  }
  return `${url.origin}${pathname}/api/v1`;
}

function parseArgs(argv) {
  const options = {
    deleteMode: false,
    confirm: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--delete') {
      options.deleteMode = true;
    } else if (arg === '--confirm') {
      options.confirm = argv[index + 1] || '';
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseClearBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'archived'].includes(normalized)) return true;
  if (['false', '0', 'no', 'not_archived', 'not-archived', 'active', ''].includes(normalized)) return false;
  return null;
}

function fieldState(object, fields) {
  const present = fields
    .filter((field) => Object.prototype.hasOwnProperty.call(object, field))
    .map((field) => ({
      field,
      value: object[field],
      parsed: parseClearBoolean(object[field]),
    }));

  if (!present.length) {
    return { state: 'missing', field: '', value: undefined };
  }

  if (present.some((entry) => entry.parsed === null)) {
    const entry = present.find((item) => item.parsed === null);
    return { state: 'unknown', field: entry.field, value: entry.value };
  }

  const unique = new Set(present.map((entry) => entry.parsed));
  if (unique.size !== 1) {
    return {
      state: 'unknown',
      field: present.map((entry) => entry.field).join('/'),
      value: present.map((entry) => `${entry.field}=${String(entry.value)}`).join(', '),
    };
  }

  return {
    state: present[0].parsed,
    field: present.map((entry) => entry.field).join('/'),
    value: present.map((entry) => entry.value).join('/'),
  };
}

function archiveState(workflow) {
  return fieldState(workflow, ARCHIVE_FIELDS);
}

function publishedState(workflow) {
  return fieldState(workflow, PUBLISHED_FIELDS);
}

function hasClearArchiveDetection(workflows) {
  for (const workflow of workflows) {
    const state = archiveState(workflow);
    if (state.state === 'missing' || state.state === 'unknown') {
      return { clear: false, workflow, state };
    }
  }
  return { clear: true, workflow: null, state: null };
}

function workflowId(workflow) {
  return workflow.id || workflow.workflowId || workflow.uuid || '';
}

function workflowName(workflow) {
  return workflow.name || workflowId(workflow) || 'unnamed-workflow';
}

function projectDisplay(workflow) {
  if (workflow.project && typeof workflow.project === 'object') {
    return workflow.project.name || workflow.project.id || workflow.project.slug || JSON.stringify(workflow.project);
  }
  return workflow.projectName || workflow.projectId || workflow.homeProjectName || workflow.homeProjectId || 'n/a';
}

function statusDisplay(workflow, state) {
  const published = publishedState(workflow);
  return [
    `id=${workflowId(workflow) || 'n/a'}`,
    `name=${workflowName(workflow)}`,
    `active=${Object.prototype.hasOwnProperty.call(workflow, 'active') ? String(workflow.active) : 'unclear'}`,
    `published=${published.state === 'missing' ? 'unclear' : String(published.value)}`,
    `project=${projectDisplay(workflow)}`,
    `archive=${state.field || 'unclear'}:${String(state.value)}`,
  ].join(' | ');
}

function isSelfCleanupWorkflow(workflow) {
  return SELF_CLEANUP_NAME_PATTERN.test(String(workflowName(workflow)).toLowerCase());
}

function evaluateWorkflow(workflow) {
  const archive = archiveState(workflow);
  if (archive.state !== true) {
    return { eligible: false, reason: 'not archived', archive };
  }

  if (isSelfCleanupWorkflow(workflow)) {
    return { eligible: false, reason: 'maintenance cleanup guard', archive };
  }

  const active = parseClearBoolean(workflow.active);
  if (active !== false) {
    return { eligible: false, reason: active === true ? 'active' : 'active status unclear', archive };
  }

  const published = publishedState(workflow);
  if (published.state !== false) {
    return { eligible: false, reason: published.state === true ? 'published' : 'published status unclear', archive };
  }

  return { eligible: true, reason: 'archived, inactive, unpublished', archive };
}

function sanitizeFileName(value) {
  const sanitized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || 'workflow';
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    '-',
    pad(date.getUTCMonth() + 1),
    '-',
    pad(date.getUTCDate()),
    '_',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
  ].join('');
}

function apiUrl(apiRoot, route, query = {}) {
  const url = new URL(`${apiRoot}${route}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchJson(fetchImpl, apiRoot, apiKey, route, options = {}) {
  const method = options.method || 'GET';
  const response = await fetchImpl(apiUrl(apiRoot, route, options.query), {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': apiKey,
    },
  });

  const body = await responseBody(response);
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${method} ${route} failed with ${response.status} ${response.statusText || ''}: ${detail || 'empty response'}`);
  }
  return body;
}

function workflowListFromResponse(body) {
  if (Array.isArray(body)) return { workflows: body, nextCursor: '' };
  if (!body || typeof body !== 'object') {
    throw new Error('Unexpected workflow list response shape.');
  }

  const workflows = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.workflows)
      ? body.workflows
      : null;
  if (!workflows) throw new Error('Unexpected workflow list response shape: missing data array.');

  return {
    workflows,
    nextCursor: body.nextCursor || body.cursor?.nextCursor || body.pagination?.nextCursor || '',
  };
}

async function fetchAllWorkflows(fetchImpl, apiRoot, apiKey) {
  const all = [];
  let cursor = '';

  do {
    const body = await fetchJson(fetchImpl, apiRoot, apiKey, '/workflows', {
      query: {
        limit: PAGE_LIMIT,
        cursor,
      },
    });
    const page = workflowListFromResponse(body);
    all.push(...page.workflows);
    cursor = page.nextCursor || '';
  } while (cursor);

  return all;
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

async function backupAndDeleteWorkflow(context, workflow, timestamp) {
  const id = workflowId(workflow);
  const name = workflowName(workflow);

  if (!id) {
    return { backedUp: false, deleted: false, failed: true, failure: { id: 'n/a', name, reason: 'missing workflow ID' } };
  }

  let fullWorkflow;
  try {
    fullWorkflow = await fetchJson(context.fetchImpl, context.apiRoot, context.apiKey, `/workflows/${encodeURIComponent(id)}`);
  } catch (error) {
    return { backedUp: false, deleted: false, failed: true, failure: { id, name, reason: `backup fetch failed: ${error.message}` } };
  }

  const fullEvaluation = evaluateWorkflow(fullWorkflow);
  if (!fullEvaluation.eligible) {
    return { backedUp: false, deleted: false, failed: true, failure: { id, name, reason: `full workflow no longer safe to delete: ${fullEvaluation.reason}` } };
  }

  const backupPath = path.join(
    context.cwd,
    BACKUP_DIR,
    `${timestamp}_${sanitizeFileName(name || id)}_before-delete.json`
  );

  try {
    writeJsonFile(backupPath, fullWorkflow);
    context.stdout(`[BACKUP ] ${id} ${name} -> ${path.relative(context.cwd, backupPath).split(path.sep).join('/')}`);
  } catch (error) {
    return { backedUp: false, deleted: false, failed: true, failure: { id, name, reason: `backup write failed: ${error.message}` } };
  }

  try {
    await fetchJson(context.fetchImpl, context.apiRoot, context.apiKey, `/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
    context.stdout(`[DELETE ] ${id} ${name}`);
    return { backedUp: true, deleted: true, failed: false, failure: null };
  } catch (error) {
    return { backedUp: true, deleted: false, failed: true, failure: { id, name, reason: `delete failed: ${error.message}` } };
  }
}

function printSummary(stdout, summary, failures) {
  stdout('');
  stdout('== Summary ==');
  stdout(`Found     : ${summary.found}`);
  stdout(`Backed up : ${summary.backedUp}`);
  stdout(`Deleted   : ${summary.deleted}`);
  stdout(`Failed    : ${summary.failed}`);
  if (failures.length) {
    stdout('Failed workflows:');
    for (const failure of failures) {
      stdout(`- ${failure.id} ${failure.name}: ${failure.reason}`);
    }
  }
}

async function run(options = {}) {
  const argv = options.argv || [];
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const stdout = options.stdout || console.log;
  const stderr = options.stderr || console.error;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || new Date();

  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    stderr(error.message);
    return { exitCode: 1 };
  }

  if (args.deleteMode && args.confirm !== CONFIRM_TEXT) {
    stderr(`Destructive mode requires --delete and --confirm "${CONFIRM_TEXT}".`);
    return { exitCode: 1 };
  }
  if (!args.deleteMode && args.confirm === CONFIRM_TEXT) {
    stderr(`Exact destructive confirmation requires --delete. Dry-run remains the default.`);
    return { exitCode: 1 };
  }

  const missing = [];
  if (!env.N8N_BASE_URL) missing.push('N8N_BASE_URL');
  if (!env.N8N_API_KEY) missing.push('N8N_API_KEY');
  if (missing.length) {
    stderr(`Missing required environment variable(s): ${missing.join(', ')}`);
    return { exitCode: 1 };
  }
  if (typeof fetchImpl !== 'function') {
    stderr('Node 18+ built-in fetch is required.');
    return { exitCode: 1 };
  }

  let apiRoot;
  try {
    apiRoot = normalizeApiRoot(env.N8N_BASE_URL);
  } catch (error) {
    stderr(error.message);
    return { exitCode: 1 };
  }

  stdout('');
  stdout('== Delete archived n8n workflows ==');
  stdout(`API root : ${apiRoot}`);
  stdout(`Mode     : ${args.deleteMode ? 'delete' : 'dry-run'}`);

  let workflows;
  try {
    workflows = await fetchAllWorkflows(fetchImpl, apiRoot, env.N8N_API_KEY);
  } catch (error) {
    stderr(`Failed to fetch workflows: ${error.message}`);
    return { exitCode: 1 };
  }

  stdout(`Total workflows fetched : ${workflows.length}`);

  if (workflows.length) {
    const archiveDetection = hasClearArchiveDetection(workflows);
    if (!archiveDetection.clear) {
      stdout('');
      stdout('Sample workflow object:');
      stdout(JSON.stringify(archiveDetection.workflow, null, 2));
      stderr('Archive detection is unclear. Expected a clear isArchived, archived, or archive field in the workflow list response. Stopping safely.');
      return { exitCode: 1 };
    }
  }

  const candidates = [];
  const skipped = [];
  for (const workflow of workflows) {
    const evaluation = evaluateWorkflow(workflow);
    if (evaluation.eligible) {
      candidates.push({ workflow, evaluation });
    } else {
      skipped.push({ workflow, evaluation });
    }
  }

  stdout(`Archived candidates     : ${candidates.length}`);
  if (skipped.length) stdout(`Skipped safely          : ${skipped.length}`);

  if (candidates.length) {
    stdout('');
    stdout('Archived candidates:');
    for (const candidate of candidates) {
      stdout(`- ${statusDisplay(candidate.workflow, candidate.evaluation.archive)}`);
    }
  }

  const summary = {
    found: candidates.length,
    backedUp: 0,
    deleted: 0,
    failed: 0,
  };
  const failures = [];

  if (!args.deleteMode) {
    stdout('');
    stdout('DRY RUN: no workflows deleted. No backups created.');
    printSummary(stdout, summary, failures);
    return { exitCode: 0 };
  }

  stdout('');
  stdout('Destructive delete confirmed. Backing up each target before delete.');
  const timestamp = formatTimestamp(now);
  const context = {
    cwd,
    fetchImpl,
    apiRoot,
    apiKey: env.N8N_API_KEY,
    stdout,
  };

  for (const candidate of candidates) {
    const result = await backupAndDeleteWorkflow(context, candidate.workflow, timestamp);
    if (result.backedUp) summary.backedUp += 1;
    if (result.deleted) summary.deleted += 1;
    if (result.failed) {
      summary.failed += 1;
      failures.push(result.failure);
      stdout(`[FAIL   ] ${result.failure.id} ${result.failure.name}: ${result.failure.reason}`);
    }
  }

  printSummary(stdout, summary, failures);
  return { exitCode: failures.length ? 1 : 0 };
}

if (require.main === module) {
  run({ argv: process.argv.slice(2) }).then((result) => {
    process.exitCode = result.exitCode;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  run,
  normalizeApiRoot,
  sanitizeFileName,
  parseClearBoolean,
  evaluateWorkflow,
};
