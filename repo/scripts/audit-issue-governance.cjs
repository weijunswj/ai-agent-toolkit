#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { DETECTOR_REGISTRY } = require('./lib/detectors/index');
const { buildSubjectMap } = require('./lib/subject-map');
const { validateAgainstSchema } = require('./lib/schema-validate');
const { formatHuman, formatJson } = require('./lib/format-output');
const { loadPolicy } = require('./lib/emit-finding');

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function auditSnapshot(snapshot) {
  const schemaResult = validateAgainstSchema(snapshot);
  if (!schemaResult.ok) return { findings: [], schemaErrors: schemaResult.errors };

  const repo = snapshot.repository;
  const issues = deepClone(snapshot.issues);
  const findings = [];
  const subjects = buildSubjectMap(issues);

  const orderedCodes = Object.keys(DETECTOR_REGISTRY).sort();
  for (const code of orderedCodes) {
    DETECTOR_REGISTRY[code](repo, issues, findings, subjects);
  }

  findings.sort((a, b) => {
    if (a.code < b.code) return -1; if (a.code > b.code) return 1;
    const aId = a.subject === null ? '' : String(a.subject);
    const bId = b.subject === null ? '' : String(b.subject);
    if (aId < bId) return -1; if (aId > bId) return 1;
    if (a.message < b.message) return -1; if (a.message > b.message) return 1;
    return 0;
  });

  return { findings, schemaErrors: [] };
}

function parseArgs(argv) {
  const args = { input: null, format: 'human' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--input' && argv[i + 1]) { args.input = argv[i + 1]; i += 1; }
    else if (argv[i] === '--format' && argv[i + 1]) { args.format = argv[i + 1]; i += 1; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) { console.error('Usage: audit-issue-governance.cjs --input <snapshot.json> [--format human|json]'); process.exit(2); }

  let raw;
  try { raw = fs.readFileSync(path.resolve(args.input), 'utf8'); }
  catch { console.error('Input error: Cannot read input file.'); process.exit(2); }

  let data;
  try { data = JSON.parse(raw); }
  catch { console.error('Input error: Invalid JSON.'); process.exit(2); }

  let result;
  try { result = auditSnapshot(data); }
  catch { console.error('Execution error.'); process.exit(2); }

  const repo = data.repository || { governance_mode: 'unknown' };
  const output = args.format === 'json' ? formatJson(result, repo) : formatHuman(result, repo);
  process.stdout.write(output + '\n');

  if (result.schemaErrors && result.schemaErrors.length > 0) process.exit(2);
  if (result.findings.length > 0) process.exit(1);
  process.exit(0);
}

if (require.main === module) { main(); }

module.exports = { auditSnapshot, formatHuman, formatJson };
