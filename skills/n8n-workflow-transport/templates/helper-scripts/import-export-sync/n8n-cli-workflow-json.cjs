#!/usr/bin/env node
'use strict';

// Reads workflow JSON for the PowerShell helpers so PowerShell never parses or rewrites workflow content.
// PowerShell 6 and later turn date-like strings into dates (rewritten in the machine's time zone on the way
// back out), and every PowerShell edition refuses JSON keys that differ only by case, so a workflow that
// round-trips through ConvertFrom-Json/ConvertTo-Json can change or fail depending on the machine.
// The PowerShell helpers read only the small summaries this file writes; workflow files are written here
// with the exact values n8n exported.
//
// Usage:
//   node n8n-cli-workflow-json.cjs list --input <n8n CLI output file> --store <workflows.json> --summary <summary.json>
//   node n8n-cli-workflow-json.cjs file-summary --input <workflow.json> --summary <summary.json>
//   node n8n-cli-workflow-json.cjs write --store <workflows.json> --id <workflow id> --output <file>
//   node n8n-cli-workflow-json.cjs set-id --file <workflow.json> --id <workflow id>

const fs = require('node:fs');
const path = require('node:path');

class N8nCliOutputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MAX_SPAN_ATTEMPTS = 64;

function tryParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

// n8n prints `export:workflow` output through its logger, so the JSON can share stdout with warnings,
// log lines, or (with N8N_LOG_FORMAT=json) arrive wrapped in a log record. Find the one JSON document.
function extractCliJson(rawText) {
  const text = String(rawText || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) {
    throw new N8nCliOutputError(
      'N8N_CLI_OUTPUT_EMPTY',
      'n8n printed no workflow list. Check that the container log settings do not hide console output (N8N_LOG_LEVEL, N8N_LOG_OUTPUT).'
    );
  }

  const whole = tryParse(text.trim());
  if (whole.ok) return unwrapLogRecord(whole.value);

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{"')) continue;
    const record = tryParse(trimmed);
    if (!record.ok) continue;
    const inner = unwrapLogRecord(record.value);
    if (Array.isArray(inner)) return inner;
  }

  const starts = [];
  const ends = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === '[' || trimmed === '{' || trimmed.startsWith('[{') || trimmed.startsWith('[]') || trimmed.startsWith('{"')) starts.push(index);
    if (trimmed.endsWith(']') || trimmed.endsWith('}')) ends.push(index);
  }

  let attempts = 0;
  for (const start of starts) {
    for (let endIndex = ends.length - 1; endIndex >= 0; endIndex -= 1) {
      const end = ends[endIndex];
      if (end < start) break;
      attempts += 1;
      if (attempts > MAX_SPAN_ATTEMPTS) break;
      const parsed = tryParse(lines.slice(start, end + 1).join('\n'));
      if (parsed.ok) return unwrapLogRecord(parsed.value);
    }
    if (attempts > MAX_SPAN_ATTEMPTS) break;
  }

  throw new N8nCliOutputError(
    'N8N_CLI_OUTPUT_UNREADABLE',
    'n8n output did not contain one readable JSON document. Rerun and read the n8n output above for warnings or errors.'
  );
}

function unwrapLogRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.message === 'string' && 'level' in value) {
    const inner = tryParse(value.message);
    if (inner.ok) return inner.value;
  }
  return value;
}

function parseWorkflowList(rawText) {
  const value = extractCliJson(rawText);
  const workflows = Array.isArray(value) ? value : [value];
  workflows.forEach((workflow, index) => {
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
      throw new N8nCliOutputError('N8N_CLI_OUTPUT_UNREADABLE', `n8n workflow list entry ${index + 1} is not a workflow object.`);
    }
    if (typeof workflow.id !== 'string' || !workflow.id || typeof workflow.name !== 'string') {
      throw new N8nCliOutputError('N8N_CLI_OUTPUT_UNREADABLE', `n8n workflow list entry ${index + 1} has no workflow id or name.`);
    }
  });
  const ids = new Set();
  for (const workflow of workflows) {
    if (ids.has(workflow.id)) throw new N8nCliOutputError('N8N_CLI_OUTPUT_UNREADABLE', 'n8n workflow list repeats a workflow id.');
    ids.add(workflow.id);
  }
  return workflows;
}

// n8n 2.x replaced activate/deactivate with publish/unpublish. `active` is deprecated in favour of
// `activeVersionId` being set, so a workflow counts as live when either says so. Both checks fail
// closed: only `active: false` with no published version counts as unpublished, the same rule the
// validator applies, so a missing or unexpected state never passes the not-live checks.
function isPublished(workflow) {
  return workflow?.activeVersionId !== undefined && workflow?.activeVersionId !== null;
}

function isLive(workflow) {
  return workflow?.active !== false || isPublished(workflow);
}

function nodeSummary(node) {
  const summary = {
    name: typeof node?.name === 'string' ? node.name : '',
    type: typeof node?.type === 'string' ? node.type : '',
  };
  if (node && node.credentials && typeof node.credentials === 'object' && Object.keys(node.credentials).length > 0) {
    summary.credentials = true;
  }
  return summary;
}

function workflowSummary(workflow) {
  return {
    id: typeof workflow.id === 'string' ? workflow.id : '',
    name: typeof workflow.name === 'string' ? workflow.name : '',
    isArchived: workflow.isArchived === true,
    active: isLive(workflow),
    published: isPublished(workflow),
    nodes: Array.isArray(workflow.nodes) ? workflow.nodes.map(nodeSummary) : [],
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJsonFile(filePath, label) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new N8nCliOutputError('N8N_CLI_OUTPUT_UNREADABLE', `${label} could not be read.`);
  }
  const parsed = tryParse(text.replace(/^﻿/, ''));
  if (!parsed.ok) throw new N8nCliOutputError('N8N_CLI_OUTPUT_UNREADABLE', `${label} is not valid JSON.`);
  return parsed.value;
}

function listCommand(options) {
  const workflows = parseWorkflowList(fs.readFileSync(required(options, 'input'), 'utf8'));
  writeJson(required(options, 'store'), workflows);
  writeJson(required(options, 'summary'), workflows.map(workflowSummary));
}

function fileSummaryCommand(options) {
  const workflow = readJsonFile(required(options, 'input'), 'Workflow file');
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new N8nCliOutputError('N8N_CLI_OUTPUT_UNREADABLE', 'Workflow file must contain one workflow object.');
  }
  writeJson(required(options, 'summary'), workflowSummary(workflow));
}

function writeCommand(options) {
  const workflows = readJsonFile(required(options, 'store'), 'Live workflow store');
  const id = required(options, 'id');
  const matches = Array.isArray(workflows) ? workflows.filter((workflow) => workflow && workflow.id === id) : [];
  if (matches.length !== 1) {
    throw new N8nCliOutputError('N8N_CLI_OUTPUT_UNREADABLE', 'The selected live workflow is not uniquely present in the live workflow store.');
  }
  writeJson(required(options, 'output'), matches[0]);
}

function setIdCommand(options) {
  const file = required(options, 'file');
  const workflow = readJsonFile(file, 'Prepared workflow');
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new N8nCliOutputError('N8N_CLI_OUTPUT_UNREADABLE', 'Prepared workflow must contain one workflow object.');
  }
  workflow.id = required(options, 'id');
  writeJson(file, workflow);
}

function required(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || !value) throw new N8nCliOutputError('N8N_CLI_USAGE', `Missing --${key}.`);
  return value;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new N8nCliOutputError('N8N_CLI_USAGE', `Unknown argument: ${arg}`);
    if (match[2] !== undefined) options[match[1]] = match[2];
    else {
      options[match[1]] = rest[index + 1];
      index += 1;
    }
  }
  return { command, options };
}

const COMMANDS = {
  list: listCommand,
  'file-summary': fileSummaryCommand,
  write: writeCommand,
  'set-id': setIdCommand,
};

function main(argv = process.argv.slice(2)) {
  try {
    const { command, options } = parseArgs(argv);
    const run = COMMANDS[command];
    if (!run) throw new N8nCliOutputError('N8N_CLI_USAGE', `Unknown command: ${command || '(none)'}. Use list, file-summary, write or set-id.`);
    run(options);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.code || 'N8N_CLI_OUTPUT_UNREADABLE'}: ${error.message}\n`);
    return error.code === 'N8N_CLI_USAGE' ? 2 : 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  N8nCliOutputError,
  extractCliJson,
  isLive,
  isPublished,
  main,
  parseWorkflowList,
  workflowSummary,
};
