#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INVENTORY_SCHEMA = 'tk.security.required-check-producer-inventory/v1';
const TERMINAL_SCHEMA = 'tk.security.required-check-terminal-receipt/v1';
const DISPATCH_SCHEMA = 'tk.security.required-check-dispatch/v1';
const TERMINAL_FAILURE = Object.freeze({
  CONFIG: 'TK023_TERMINAL_CONFIG_INVALID',
  NEEDS_SET: 'TK023_TERMINAL_PREREQUISITE_SET_MISMATCH',
  NEEDS_RESULT: 'TK023_TERMINAL_PREREQUISITE_NOT_SUCCESS',
  IDENTITY: 'TK023_TERMINAL_IDENTITY_INVALID',
  INVENTORY: 'TK023_TERMINAL_INVENTORY_INVALID',
  OIDC: 'TK023_TERMINAL_OIDC_ATTESTATION_MISSING',
  REPORT: 'TK023_TERMINAL_REPORT_NOT_PASS'
});
const RESULT_VALUES = new Set([
  'success',
  'failure',
  'cancelled',
  'skipped',
  'neutral',
  'timed_out',
  'action_required',
  'unknown'
]);
const REPORT_VALUES = new Set([
  'SECURITY_PASS',
  'SECURITY_FINDINGS',
  'SECURITY_GATE_UNVERIFIED',
  'SECURITY_GATE_INFRA_BLOCKED',
  'SECURITY_PROFILE_EXEMPT',
  'VALIDATION_PASS',
  'VALIDATION_FINDINGS',
  'VALIDATION_UNVERIFIED',
  'VALIDATION_INFRA_BLOCKED',
  'EVIDENCE_MISSING'
]);
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SAFE_JOB = /^[a-z0-9-]{1,80}$/;

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite canonical JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Canonical JSON requires plain objects');
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function gitBlobSha(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}

function ambiguityKey(value) {
  return String(value).normalize('NFKC').trim().replace(/[ \t\r\n]+/g, ' ').toLocaleLowerCase('en-US');
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      result._.push(value);
      continue;
    }
    const equals = value.indexOf('=');
    if (equals > 2) {
      result[value.slice(2, equals)] = value.slice(equals + 1);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function readJson(filePath, label = filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`${label} is missing or malformed`);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function containedRegular(root, relative, label = relative) {
  const normalized = slash(relative).replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`${label} must be repository-relative`);
  }
  const full = path.resolve(root, ...normalized.split('/'));
  const rel = path.relative(path.resolve(root), full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${label} escapes repository root`);
  const stat = fs.lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-link file`);
  return full;
}

function git(root, args, allowFailure = false) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  if (!allowFailure && result.status !== 0) throw new Error('Git identity command failed');
  return result.status === 0 ? result.stdout.trim() : '';
}

function exactCommit(root, revision, label) {
  const value = git(root, ['rev-parse', '--verify', `${revision}^{commit}`]);
  if (!SHA40.test(value)) throw new Error(`${label} did not resolve to an exact commit`);
  return value;
}

function exactTree(root, revision) {
  const value = git(root, ['rev-parse', '--verify', `${revision}^{tree}`]);
  if (!SHA40.test(value)) throw new Error('Tree identity is invalid');
  return value;
}

function inventoryFile(root, relative, kind, revision = 'HEAD') {
  const full = containedRegular(root, relative, relative);
  const bytes = fs.readFileSync(full);
  let blob = git(root, ['rev-parse', `${revision}:${slash(relative)}`], true);
  if (!SHA40.test(blob)) blob = gitBlobSha(bytes);
  return {
    path: slash(relative),
    blob,
    sha256: sha256(bytes),
    kind
  };
}

function stripYamlComment(text) {
  let single = false;
  let double = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" && !double) single = !single;
    if (char === '"' && !single && text[index - 1] !== '\\') double = !double;
    if (char === '#' && !single && !double && (index === 0 || /\s/.test(text[index - 1]))) return text.slice(0, index).trimEnd();
  }
  return text.trimEnd();
}

function unquote(value) {
  const text = stripYamlComment(String(value).trim());
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function yamlKey(text) {
  const match = text.match(/^([^:#][^:]*?):(?:\s|$)/);
  if (!match) return null;
  return unquote(match[1]);
}

function validateYamlSource(text, relative) {
  if (Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error(`${relative}: workflow exceeds 1 MiB`);
  if (text.includes('\t')) throw new Error(`${relative}: YAML tabs are unsupported`);
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const scopes = [{ indent: -1, keys: new Set(), label: '<root>' }];
  let blockIndent = null;
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const raw = lines[lineNumber];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (blockIndent !== null && indent > blockIndent) continue;
    blockIndent = null;
    const content = stripYamlComment(raw.trim());
    if (/(^|\s)![A-Za-z0-9_-]+(?:\s|$)/.test(content)) throw new Error(`${relative}:${lineNumber + 1}: unsupported YAML tag`);
    if (/(^|\s)[&*][A-Za-z0-9_-]+(?:\s|$)/.test(content)) throw new Error(`${relative}:${lineNumber + 1}: YAML anchors and aliases are unsupported`);
    while (scopes.length > 1 && indent <= scopes[scopes.length - 1].indent) scopes.pop();
    const listItem = content.startsWith('- ');
    if (listItem) scopes.push({ indent, keys: new Set(), label: `<item-${lineNumber + 1}>` });
    const normalizedContent = listItem ? content.slice(2).trimStart() : content;
    const key = yamlKey(normalizedContent);
    if (key !== null) {
      const parent = scopes[scopes.length - 1];
      if (parent.keys.has(key)) throw new Error(`${relative}:${lineNumber + 1}: duplicate YAML key ${key}`);
      parent.keys.add(key);
      const after = normalizedContent.slice(normalizedContent.indexOf(':') + 1).trim();
      scopes.push({ indent, keys: new Set(), label: key });
      if (after === '|' || after === '>' || after === '|-' || after === '>-') blockIndent = indent;
    }
  }
  return lines;
}

function inlineArray(value) {
  const text = unquote(value);
  if (!text.startsWith('[') || !text.endsWith(']')) return null;
  if (text.slice(1, -1).trim() === '') return [];
  return text.slice(1, -1).split(',').map((item) => unquote(item.trim()));
}

function scalarAt(block, indent, key) {
  const prefix = `${' '.repeat(indent)}${key}:`;
  const line = block.find((item) => item.startsWith(prefix));
  if (!line) return null;
  return line.slice(prefix.length).trim();
}

function listAt(block, indent, key) {
  const scalar = scalarAt(block, indent, key);
  if (scalar === null) return [];
  const array = inlineArray(scalar);
  if (array) return array;
  if (scalar) return [unquote(scalar)];
  const prefix = `${' '.repeat(indent + 2)}- `;
  const start = block.findIndex((item) => item.startsWith(`${' '.repeat(indent)}${key}:`));
  const values = [];
  for (let index = start + 1; index < block.length; index += 1) {
    const line = block[index];
    const currentIndent = line.length - line.trimStart().length;
    if (line.trim() && currentIndent <= indent) break;
    if (line.startsWith(prefix)) values.push(unquote(line.slice(prefix.length)));
  }
  return values;
}

function literalMatrix(block) {
  const strategyIndex = block.findIndex((line) => line.startsWith('    strategy:'));
  if (strategyIndex < 0) return { axes: {}, include: [], exclude: [], count: 1 };
  const matrixIndex = block.findIndex((line, index) => index > strategyIndex && line.startsWith('      matrix:'));
  if (matrixIndex < 0) return { axes: {}, include: [], exclude: [], count: 1 };
  const axes = {};
  const include = [];
  const exclude = [];
  let section = null;
  for (let index = matrixIndex + 1; index < block.length; index += 1) {
    const line = block[index];
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= 6) break;
    const axis = line.match(/^        ([A-Za-z0-9_-]+):\s*(.+)$/);
    if (axis && !['include', 'exclude'].includes(axis[1])) {
      const values = inlineArray(axis[2]);
      if (!values) throw new Error(`Matrix axis ${axis[1]} must be a literal inline array`);
      axes[axis[1]] = values;
      section = null;
      continue;
    }
    if (/^        include:\s*$/.test(line)) {
      section = include;
      continue;
    }
    if (/^        exclude:\s*$/.test(line)) {
      section = exclude;
      continue;
    }
    if (section && /^          -\s+/.test(line)) section.push(stripYamlComment(line.trim().slice(2)));
  }
  let count = Object.values(axes).reduce((total, values) => total * Math.max(values.length, 1), 1);
  count += include.length;
  count = Math.max(0, count - exclude.length);
  return { axes, include, exclude, count };
}

function expandJobName(name, matrix, relative, jobId, bounds) {
  if (!name.includes('${{')) return [name];
  const expressions = [...name.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map((match) => match[1].trim());
  if (expressions.length === 0) throw new Error(`${relative}:${jobId}: unresolved job-name expression`);
  const axes = new Set();
  for (const expression of expressions) {
    const match = expression.match(/^matrix\.([A-Za-z0-9_-]+)$/);
    if (!match || !Object.hasOwn(matrix.axes, match[1])) throw new Error(`${relative}:${jobId}: unsupported dynamic job-name expression`);
    axes.add(match[1]);
  }
  let variants = [{ name }];
  for (const axis of axes) {
    variants = variants.flatMap((variant) => matrix.axes[axis].map((value) => ({
      name: variant.name.replaceAll(new RegExp(`\\$\\{\\{\\s*matrix\\.${axis}\\s*\\}\\}`, 'g'), value)
    })));
  }
  if (variants.length > bounds.matrix_expansions_per_job) throw new Error(`${relative}:${jobId}: matrix expansion bound exceeded`);
  return variants.map((item) => item.name);
}

function parseWorkflow(root, relative, config, graph, stack = []) {
  if (graph.workflows.has(relative)) return graph.workflows.get(relative);
  if (stack.includes(relative)) throw new Error(`Reusable-workflow cycle: ${[...stack, relative].join(' -> ')}`);
  if (stack.length > config.producer_inventory.bounds.reusable_depth) throw new Error('Reusable-workflow depth bound exceeded');
  const full = containedRegular(root, relative, relative);
  const text = fs.readFileSync(full, 'utf8');
  const lines = validateYamlSource(text, relative);
  if (
    /^\s*(?:checks|statuses):\s*write\s*$/m.test(text) ||
    /\/check-runs\b|\/statuses\/|createCommitStatus|createCheckRun/i.test(text)
  ) throw new Error(`${relative}: candidate workflow may not publish required-check or commit-status evidence`);
  const jobsLine = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/.test(line));
  const workflow = { path: relative, events: [], jobs: [] };
  const onLine = lines.findIndex((line) => /^on:\s*/.test(line));
  if (onLine >= 0) {
    const scalar = stripYamlComment(lines[onLine].slice(3).trim());
    const array = inlineArray(scalar);
    if (array) workflow.events.push(...array);
    else if (scalar) workflow.events.push(unquote(scalar));
    else {
      for (let index = onLine + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.trim()) continue;
        const indent = line.length - line.trimStart().length;
        if (indent === 0) break;
        const match = line.match(/^  ([A-Za-z0-9_-]+):/);
        if (match) workflow.events.push(match[1]);
      }
    }
  }
  if (jobsLine < 0) throw new Error(`${relative}: jobs mapping is missing`);
  const jobStarts = [];
  for (let index = jobsLine + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[^\s#]/.test(line)) break;
    const match = line.match(/^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (match) jobStarts.push({ index, id: match[1] });
  }
  for (let position = 0; position < jobStarts.length; position += 1) {
    const current = jobStarts[position];
    const end = position + 1 < jobStarts.length ? jobStarts[position + 1].index : lines.length;
    const block = lines.slice(current.index + 1, end);
    const rawName = scalarAt(block, 4, 'name');
    const name = rawName === null ? current.id : unquote(rawName);
    if (!name || name === '|' || name === '>') throw new Error(`${relative}:${current.id}: unsupported job name`);
    const matrix = literalMatrix(block);
    if (matrix.count > config.producer_inventory.bounds.matrix_expansions_per_job) {
      throw new Error(`${relative}:${current.id}: matrix expansion bound exceeded`);
    }
    const producedNames = expandJobName(name, matrix, relative, current.id, config.producer_inventory.bounds);
    const jobUsesRaw = scalarAt(block, 4, 'uses');
    const jobUses = jobUsesRaw ? unquote(jobUsesRaw) : null;
    const stepUses = block
      .map((line) => line.match(/^\s{6,10}uses:\s*(.+)$/))
      .filter(Boolean)
      .map((match) => unquote(match[1]));
    const stepConditions = block
      .map((line) => line.match(/^\s{8,}if:\s*(.+)$/))
      .filter(Boolean)
      .map((match) => unquote(match[1]));
    const stepContinueOnError = block.some((line) =>
      /^\s{8,}continue-on-error:\s*(?:true|yes)\s*$/i.test(stripYamlComment(line))
    );
    const job = {
      id: current.id,
      name,
      produced_names: producedNames,
      ambiguity_keys: producedNames.map(ambiguityKey),
      needs: listAt(block, 4, 'needs'),
      if: scalarAt(block, 4, 'if') === null ? null : unquote(scalarAt(block, 4, 'if')),
      continue_on_error: ['true', 'yes'].includes(unquote(scalarAt(block, 4, 'continue-on-error') || '').toLowerCase()),
      timeout_minutes: Number(unquote(scalarAt(block, 4, 'timeout-minutes') || '0')) || null,
      matrix,
      uses: jobUses,
      step_uses: stepUses
      ,
      step_conditions: stepConditions,
      step_continue_on_error: stepContinueOnError
    };
    workflow.jobs.push(job);
    graph.jobs += 1;
    graph.producedNames += producedNames.length;
    graph.edges += job.needs.length;
    if (graph.jobs > config.producer_inventory.bounds.jobs) throw new Error('Job bound exceeded');
    if (graph.producedNames > config.producer_inventory.bounds.produced_job_names) throw new Error('Produced job-name bound exceeded');
    if (graph.edges > config.producer_inventory.bounds.edges) throw new Error('Workflow edge bound exceeded');
    if (jobUses) inspectUse(root, relative, jobUses, config, graph, [...stack, relative], true);
    for (const use of stepUses) inspectUse(root, relative, use, config, graph, [...stack, relative], false);
  }
  graph.workflows.set(relative, workflow);
  return workflow;
}

function inspectUse(root, from, use, config, graph, stack, jobLevel) {
  graph.edges += 1;
  if (graph.edges > config.producer_inventory.bounds.edges) throw new Error('Reusable/composite edge bound exceeded');
  if (use.startsWith('./')) {
    const target = slash(path.posix.normalize(use.slice(2)));
    if (target.startsWith('../') || target.includes('/../')) throw new Error(`${from}: local use escapes repository`);
    if (jobLevel) {
      if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(target)) throw new Error(`${from}: unsupported local reusable workflow target`);
      parseWorkflow(root, target, config, graph, stack);
      return;
    }
    inspectCompositeAction(root, target, config, graph, stack);
    return;
  }
  const match = use.match(/^([^@\s]+)@([0-9a-f]{40})$/);
  if (!match) throw new Error(`${from}: external action or reusable workflow must use a full immutable SHA`);
  if (jobLevel && !config.producer_inventory.external_reusable_workflows.some((item) => item.target === use)) {
    throw new Error(`${from}: external reusable workflow is not in the trusted lock`);
  }
}

function inspectCompositeAction(root, target, config, graph, stack) {
  const actionPath = fs.existsSync(path.join(root, target, 'action.yml'))
    ? slash(path.posix.join(target, 'action.yml'))
    : slash(path.posix.join(target, 'action.yaml'));
  if (!fs.existsSync(path.join(root, actionPath))) throw new Error(`${target}: local action target is missing`);
  if (stack.includes(actionPath)) throw new Error(`Local-action cycle: ${[...stack, actionPath].join(' -> ')}`);
  const full = containedRegular(root, actionPath, actionPath);
  const text = fs.readFileSync(full, 'utf8');
  const lines = validateYamlSource(text, actionPath);
  graph.localActions.add(actionPath);
  for (const line of lines) {
    const match = line.match(/^\s{4,10}uses:\s*(.+)$/);
    if (match) inspectUse(root, actionPath, unquote(match[1]), config, graph, [...stack, actionPath], false);
  }
}

function workflowFiles(root) {
  const directory = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => slash(path.posix.join('.github/workflows', entry.name)))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function verifyTerminals(authorityWorkflow, config) {
  for (const context of config.contexts) {
    const matches = authorityWorkflow.jobs.filter((job) => job.id === context.terminal_job_id);
    if (matches.length !== 1) throw new Error(`${context.id}: expected exactly one protected terminal job`);
    const job = matches[0];
    if (job.name !== context.terminal_job_name) throw new Error(`${context.id}: terminal internal name drift`);
    if (job.if !== '${{ always() }}') throw new Error(`${context.id}: terminal must use exactly if: \${{ always() }}`);
    if (job.continue_on_error) throw new Error(`${context.id}: terminal must not continue on error`);
    if (job.uses) throw new Error(`${context.id}: terminal must execute protected local verifier directly`);
    if (Object.keys(job.matrix.axes).length > 0 || job.matrix.include.length > 0) throw new Error(`${context.id}: terminal must not use a matrix`);
    const actual = [...job.needs].sort();
    const expected = [...context.mandatory_prerequisites].sort();
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${context.id}: terminal prerequisite set drift`);
    for (const dependency of expected) {
      const producer = authorityWorkflow.jobs.find((candidate) => candidate.id === dependency);
      if (!producer) throw new Error(`${context.id}: mandatory prerequisite ${dependency} is missing`);
      if (producer.continue_on_error) throw new Error(`${context.id}: mandatory prerequisite ${dependency} may not continue on error`);
    }
  }
}

function buildProducerInventory(options) {
  const authorityRoot = path.resolve(options.authorityRoot);
  const candidateRoot = path.resolve(options.candidateRoot);
  const config = options.config || readJson(path.join(authorityRoot, '_projects', 'cicd', 'repository-security-gate', '_main', 'config', 'required-check-producers.json'));
  const authorityCommit = exactCommit(authorityRoot, options.authorityCommit || 'HEAD', 'authority');
  const candidateHead = exactCommit(candidateRoot, options.candidateHead || 'HEAD', 'candidate');
  const graph = { workflows: new Map(), localActions: new Set(), jobs: 0, edges: 0, producedNames: 0 };
  const authorityGraph = { workflows: new Map(), localActions: new Set(), jobs: 0, edges: 0, producedNames: 0 };
  const candidateFiles = workflowFiles(candidateRoot);
  if (candidateFiles.length > config.producer_inventory.bounds.workflow_files) throw new Error('Workflow file bound exceeded');
  for (const relative of candidateFiles) parseWorkflow(candidateRoot, relative, config, graph);
  const authorityWorkflow = parseWorkflow(authorityRoot, config.workflow.path, config, authorityGraph);
  verifyTerminals(authorityWorkflow, config);
  if (
    !Array.isArray(config.app.source_files) ||
    config.app.source_files.length < 1 ||
    config.app.source_files.length > 64 ||
    new Set(config.app.source_files).size !== config.app.source_files.length ||
    !config.app.source_files.includes(config.app.publisher_module)
  ) {
    throw new Error('App authority source manifest is invalid');
  }
  const appSources = config.app.source_files.map((relative) => {
    const joined = slash(path.posix.join(config.app.source_root, relative));
    const full = containedRegular(authorityRoot, joined, `App authority ${relative}`);
    return { relative, joined, text: fs.readFileSync(full, 'utf8') };
  });
  const checkApiSources = appSources.filter((item) => /\/check-runs(?:[/?'"`]|$)/.test(item.text));
  const statusApiSources = appSources.filter((item) => /\/statuses(?:[/?'"`]|$)/.test(item.text));
  const publisher = appSources.find((item) => item.relative === config.app.publisher_module);
  if (
    checkApiSources.length !== 1 ||
    checkApiSources[0].relative !== config.app.publisher_module ||
    statusApiSources.length !== 0 ||
    !publisher?.text.includes('export async function publishRequiredCheck') ||
    !publisher.text.includes('CHECK_CONTEXTS')
  ) {
    throw new Error('Typed App publisher authority is ambiguous');
  }
  const produced = [...graph.workflows.values()].flatMap((workflow) => workflow.jobs.flatMap((job) =>
    job.produced_names.map((name) => ({ name, key: ambiguityKey(name), workflow: workflow.path, job: job.id }))
  ));
  const ambiguities = new Map();
  for (const item of produced) {
    const names = ambiguities.get(item.key) || new Set();
    names.add(item.name);
    ambiguities.set(item.key, names);
  }
  const caseAmbiguities = [...ambiguities.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([key, names]) => ({ ambiguity_key: key, exact_names: [...names].sort() }))
    .slice(0, 256);
  const requiredContexts = config.contexts.map((context) => {
    const key = ambiguityKey(context.name);
    return {
      id: context.id,
      name: context.name,
      publisher_declarations: publisher ? 1 : 0,
      terminal_jobs: authorityWorkflow.jobs.filter((job) => job.id === context.terminal_job_id).length,
      github_actions_name_collisions: produced.filter((item) => item.name === context.name || item.key === key).length
    };
  });
  if (requiredContexts.some((item) => item.publisher_declarations !== 1 || item.terminal_jobs !== 1 || item.github_actions_name_collisions !== 0)) {
    throw new Error('Required-check producer uniqueness failed');
  }
  const producerRecords = [
    ...[...graph.workflows.values()].flatMap((workflow) => workflow.jobs.map((job) => ({
      role: 'candidate',
      workflow: workflow.path,
      events: workflow.events,
      job_id: job.id,
      exact_names: job.produced_names,
      ambiguity_keys: job.ambiguity_keys,
      needs: job.needs,
      job_if: job.if,
      continue_on_error: job.continue_on_error,
      timeout_minutes: job.timeout_minutes,
      matrix_expansions: job.matrix.count,
      reusable_workflow: job.uses,
      step_uses: job.step_uses
      ,
      step_conditions: job.step_conditions,
      step_continue_on_error: job.step_continue_on_error
    }))),
    ...[...authorityGraph.workflows.values()].flatMap((workflow) => workflow.jobs.map((job) => ({
      role: 'authority',
      workflow: workflow.path,
      events: workflow.events,
      job_id: job.id,
      exact_names: job.produced_names,
      ambiguity_keys: job.ambiguity_keys,
      needs: job.needs,
      job_if: job.if,
      continue_on_error: job.continue_on_error,
      timeout_minutes: job.timeout_minutes,
      matrix_expansions: job.matrix.count,
      reusable_workflow: job.uses,
      step_uses: job.step_uses
      ,
      step_conditions: job.step_conditions,
      step_continue_on_error: job.step_continue_on_error
    })))
  ].sort((left, right) => `${left.role}/${left.workflow}/${left.job_id}`.localeCompare(`${right.role}/${right.workflow}/${right.job_id}`));
  const files = [
    ...candidateFiles.map((relative) => inventoryFile(candidateRoot, relative, 'workflow', candidateHead)),
    ...[...graph.localActions].sort().map((relative) => inventoryFile(candidateRoot, relative, 'local-action', candidateHead)),
    inventoryFile(authorityRoot, config.workflow.path, 'workflow', authorityCommit),
    ...appSources.map((item) => inventoryFile(authorityRoot, item.joined, 'app-authority', authorityCommit))
  ];
  const unsigned = {
    schema: INVENTORY_SCHEMA,
    repository: options.repository,
    candidate_head: candidateHead,
    candidate_tree: exactTree(candidateRoot, candidateHead),
    authority_commit: authorityCommit,
    authority_tree: exactTree(authorityRoot, authorityCommit),
    workflow_files: candidateFiles.length + 1,
    jobs: graph.jobs + authorityGraph.jobs,
    edges: graph.edges + authorityGraph.edges,
    produced_names: graph.producedNames + authorityGraph.producedNames,
    required_contexts: requiredContexts,
    case_ambiguities: caseAmbiguities,
    producer_records: producerRecords,
    files,
    status: 'PASS'
  };
  return { ...unsigned, inventory_digest: sha256(canonicalJson(unsigned)) };
}

function parseNeeds(value) {
  const document = typeof value === 'string' ? JSON.parse(value) : value;
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('needs JSON must be an object');
  return Object.keys(document).sort().map((jobId) => {
    if (!SAFE_JOB.test(jobId)) throw new Error('needs JSON contains an invalid job id');
    const result = document[jobId]?.result || 'unknown';
    return { job_id: jobId, result: RESULT_VALUES.has(result) ? result : 'unknown' };
  });
}

function buildTerminalReceipt(options) {
  const config = options.config;
  const context = config.contexts.find((item) => item.id === options.contextId);
  if (!context) throw new Error('Unknown required-check context');
  const failures = [];
  let prerequisites = [];
  try {
    prerequisites = parseNeeds(options.needs);
  } catch {
    failures.push(TERMINAL_FAILURE.NEEDS_SET);
  }
  const actualIds = prerequisites.map((item) => item.job_id).sort();
  const expectedIds = [...context.mandatory_prerequisites].sort();
  if (canonicalJson(actualIds) !== canonicalJson(expectedIds)) failures.push(TERMINAL_FAILURE.NEEDS_SET);
  if (prerequisites.some((item) => item.result !== 'success')) failures.push(TERMINAL_FAILURE.NEEDS_RESULT);
  for (const [value, pattern] of [
    [options.headSha, SHA40],
    [options.headTree, SHA40],
    [options.baseSha, SHA40],
    [options.authorityCommit, SHA40],
    [options.authorityTree, SHA40],
    [options.workflowDigest, SHA256],
    [options.producerInventoryDigest, SHA256]
  ]) {
    if (!pattern.test(String(value || ''))) failures.push(TERMINAL_FAILURE.IDENTITY);
  }
  if (!SHA256.test(String(options.oidcAttestationId || ''))) failures.push(TERMINAL_FAILURE.OIDC);
  const passState = context.id === 'repository-security-gate' ? 'SECURITY_PASS' : 'VALIDATION_PASS';
  const reportState = REPORT_VALUES.has(options.reportState) ? options.reportState : 'EVIDENCE_MISSING';
  if (reportState !== passState) failures.push(TERMINAL_FAILURE.REPORT);
  const unsigned = {
    schema: TERMINAL_SCHEMA,
    context_id: context.id,
    context_name: context.name,
    repository: options.repository,
    repository_id: Number(options.repositoryId),
    pr_number: Number(options.prNumber),
    head_sha: options.headSha,
    head_tree: options.headTree,
    base_sha: options.baseSha,
    base_generation: Number(options.baseGeneration),
    authority_commit: options.authorityCommit,
    authority_tree: options.authorityTree,
    workflow_path: config.workflow.path,
    workflow_digest: options.workflowDigest,
    run_id: Number(options.runId),
    run_attempt: Number(options.runAttempt),
    attempt_generation: Number(options.attemptGeneration),
    job_id: context.terminal_job_id,
    github_job_id: Number(options.githubJobId),
    correlation_id: options.correlationId,
    nonce: options.nonce,
    producer_inventory_digest: options.producerInventoryDigest,
    mandatory_prerequisites: prerequisites,
    oidc_attestation_id: options.oidcAttestationId,
    report_state: reportState,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    failure_codes: [...new Set(failures)].sort()
  };
  return { ...unsigned, receipt_digest: sha256(canonicalJson(unsigned)) };
}

function manifestForPaths(root, paths) {
  const records = [];
  for (const relative of [...new Set(paths)].sort()) {
    const full = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(full)) {
      records.push({ path: relative, state: 'missing', sha256: null });
      continue;
    }
    const stat = fs.lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Generated output is not a regular non-link file: ${relative}`);
    records.push({ path: relative, state: 'present', sha256: sha256(fs.readFileSync(full)) });
  }
  return records;
}

function generatedRecipeFiles(root, manifestPath, manifest, output) {
  if (output?.kind !== 'copy' || typeof output.source !== 'string') return null;
  const manifestRelative = slash(path.relative(root, manifestPath));
  const modulePath = slash(manifest.module_path || path.posix.dirname(manifestRelative));
  const source = slash(output.source);
  if (!source.startsWith('_main/') && !source.startsWith('curated_output_for_ai/')) {
    throw new Error(`Declared copy source is outside the project source roots: ${source}`);
  }
  const sourceRelative = slash(path.posix.join(modulePath, source));
  const sourceFull = path.resolve(root, ...sourceRelative.split('/'));
  const sourceFromRoot = path.relative(path.resolve(root), sourceFull);
  if (sourceFromRoot.startsWith('..') || path.isAbsolute(sourceFromRoot)) {
    throw new Error(`Declared copy source escapes repository root: ${source}`);
  }
  const sourceStat = fs.lstatSync(sourceFull);
  if (sourceStat.isSymbolicLink()) throw new Error(`Declared copy source must not be a link: ${source}`);
  if (sourceStat.isFile()) return null;
  if (!sourceStat.isDirectory()) throw new Error(`Declared copy source must be a regular file or directory: ${source}`);

  const outputRoot = slash(output.output || '').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!outputRoot || path.posix.isAbsolute(outputRoot) || path.win32.isAbsolute(outputRoot) || outputRoot.split('/').includes('..')) {
    throw new Error('Declared generated output must be repository-relative');
  }
  const files = [];
  const stack = [{ full: sourceFull, relative: '' }];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current.full, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : (left.name > right.name ? 1 : 0));
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const full = path.join(current.full, entry.name);
      const stat = fs.lstatSync(full);
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (stat.isSymbolicLink()) throw new Error(`Declared copy directory contains a link: ${source}`);
      if (stat.isDirectory()) {
        stack.push({ full, relative });
        continue;
      }
      if (!stat.isFile()) throw new Error(`Declared copy directory contains a non-regular entry: ${source}`);
      files.push(`${outputRoot}/${slash(relative)}`);
      if (files.length > 20000) throw new Error('Declared generated output bound exceeded');
    }
  }
  return files.sort();
}

function declaredOutputs(root) {
  const projectsRoot = path.join(root, '_projects');
  const outputs = [];
  const stack = [projectsRoot];
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === 'toolkit.project.json') {
        const manifest = readJson(full);
        for (const output of manifest.outputs || []) {
          if (typeof output.output !== 'string') continue;
          const expanded = generatedRecipeFiles(root, full, manifest, output);
          if (expanded) outputs.push(...expanded);
          else outputs.push(slash(output.output));
          if (outputs.length > 20000) throw new Error('Declared generated output bound exceeded');
        }
      }
    }
  }
  return [...new Set(outputs)].sort();
}

function copyTrackedTree(candidateRoot, operationRoot, head) {
  if (fs.existsSync(operationRoot) && fs.readdirSync(operationRoot).length > 0) throw new Error('Generated operation directory must start empty');
  fs.mkdirSync(operationRoot, { recursive: true });
  const tracked = git(candidateRoot, ['ls-tree', '-r', '-z', '--name-only', head]).split('\0').filter(Boolean);
  if (tracked.length > 20000) throw new Error('Tracked-file copy bound exceeded');
  for (const relative of tracked) {
    const source = containedRegular(candidateRoot, relative, relative);
    const destination = path.join(operationRoot, ...slash(relative).split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function runGeneratedSurfaceVerification(options) {
  const authorityRoot = path.resolve(options.authorityRoot);
  const candidateRoot = path.resolve(options.candidateRoot);
  const operationRoot = path.resolve(options.operationRoot);
  const candidateHead = exactCommit(candidateRoot, options.candidateHead || 'HEAD', 'candidate');
  const authorityCommit = exactCommit(authorityRoot, options.authorityCommit || 'HEAD', 'authority');
  const config = options.config || readJson(path.join(authorityRoot, '_projects', 'cicd', 'repository-security-gate', '_main', 'config', 'required-check-producers.json'));
  const lockPath = containedRegular(authorityRoot, config.generated_surface.generator_lock, 'protected generator lock');
  const lock = readJson(lockPath);
  if (lock.network !== false || lock.candidate_writeback !== false || lock.runtime.external_packages.length !== 0) {
    throw new Error('Protected generator lock permits unsupported authority');
  }
  copyTrackedTree(candidateRoot, operationRoot, candidateHead);
  const authorityOutputs = declaredOutputs(authorityRoot);
  const candidateOutputs = declaredOutputs(operationRoot);
  const removedAuthorityOutputs = authorityOutputs.filter((relative) => !candidateOutputs.includes(relative));
  const outputs = [...new Set([...authorityOutputs, ...candidateOutputs])].sort();
  const candidateManifest = manifestForPaths(candidateRoot, outputs);
  for (const generator of lock.generators) {
    const script = containedRegular(authorityRoot, generator.path, generator.path);
    if (!SHA256.test(String(generator.sha256 || '')) || sha256(fs.readFileSync(script)) !== generator.sha256) {
      throw new Error(`Protected generator digest mismatch: ${generator.path}`);
    }
    const result = spawnSync(process.execPath, [script, '--workspace', operationRoot, ...generator.arguments], {
      cwd: authorityRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env.PATH || '',
        SystemRoot: process.env.SystemRoot || '',
        WINDIR: process.env.WINDIR || ''
      }
    });
    if (result.error || result.status !== 0) throw new Error(`Protected generator failed: ${generator.path}`);
  }
  const expectedManifest = manifestForPaths(operationRoot, outputs);
  const contentMismatches = expectedManifest
    .map((expected, index) => ({ expected, actual: candidateManifest[index] }))
    .filter(({ expected, actual }) => expected.state !== actual.state || expected.sha256 !== actual.sha256)
    .map(({ expected }) => expected.path);
  const mismatches = [...new Set([...removedAuthorityOutputs, ...contentMismatches])].sort().slice(0, 500);
  const sourceManifests = [];
  const stack = [path.join(candidateRoot, '_projects')];
  while (stack.length) {
    const current = stack.pop();
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === 'toolkit.project.json') {
        sourceManifests.push({
          path: slash(path.relative(candidateRoot, full)),
          sha256: sha256(fs.readFileSync(full))
        });
      }
    }
  }
  const unsigned = {
    schema: 'tk.security.generated-surface-fidelity/v1',
    status: mismatches.length === 0 ? 'PASS' : 'FINDINGS',
    candidate_head: candidateHead,
    candidate_tree: exactTree(candidateRoot, candidateHead),
    authority_commit: authorityCommit,
    authority_tree: exactTree(authorityRoot, authorityCommit),
    source_manifest_digest: sha256(canonicalJson(sourceManifests.sort((a, b) => a.path.localeCompare(b.path)))),
    generator_lock_digest: sha256(fs.readFileSync(lockPath)),
    dependency_lock_digest: (() => {
      const digest = sha256(fs.readFileSync(containedRegular(authorityRoot, lock.dependency_lock.path, 'dependency lock')));
      if (!SHA256.test(String(lock.dependency_lock.sha256 || '')) || digest !== lock.dependency_lock.sha256) {
        throw new Error('Protected dependency lock digest mismatch');
      }
      return digest;
    })(),
    expected_output_manifest_digest: sha256(canonicalJson(expectedManifest)),
    candidate_output_manifest_digest: sha256(canonicalJson(candidateManifest)),
    output_count: outputs.length,
    mismatch_count: mismatches.length,
    mismatched_paths: mismatches,
    writeback: false
  };
  return { ...unsigned, result_digest: sha256(canonicalJson(unsigned)) };
}

function base64urlDecode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(value || ''))) throw new Error('Invalid base64url value');
  return Buffer.from(value, 'base64url');
}

function verifyDispatchEnvelope(options) {
  const bytes = base64urlDecode(options.envelope);
  if (bytes.length > 16384) throw new Error('Dispatch envelope bound exceeded');
  const document = JSON.parse(bytes.toString('utf8'));
  if (canonicalJson(document) !== bytes.toString('utf8')) throw new Error('Dispatch envelope is not canonical JSON');
  const publicKey = crypto.createPublicKey(fs.readFileSync(options.publicKeyPath));
  if (!crypto.verify(null, bytes, publicKey, base64urlDecode(options.signature))) throw new Error('Dispatch signature is invalid');
  const keys = [
    'schema', 'repository', 'repository_id', 'candidate_repository', 'candidate_repository_id',
    'installation_id', 'pr_number', 'base_ref', 'base_sha',
    'base_generation', 'head_sha', 'authority_sha', 'delivery_id', 'nonce', 'correlation_id',
    'attempt_generation', 'issued_at', 'expires_at', 'app_name', 'integration_id'
  ];
  if (canonicalJson(Object.keys(document).sort()) !== canonicalJson(keys.sort())) throw new Error('Dispatch envelope fields are invalid');
  if (document.schema !== DISPATCH_SCHEMA) throw new Error('Dispatch schema is invalid');
  if (
    document.repository !== options.repository ||
    String(document.repository_id) !== String(options.repositoryId) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(document.candidate_repository) ||
    !Number.isInteger(document.candidate_repository_id) ||
    document.candidate_repository_id < 1 ||
    !Number.isInteger(document.installation_id) ||
    document.installation_id < 1 ||
    !Number.isInteger(document.pr_number) ||
    document.pr_number < 1 ||
    !Number.isInteger(document.base_generation) ||
    document.base_generation < 1 ||
    !Number.isInteger(document.attempt_generation) ||
    document.attempt_generation < 1 ||
    typeof document.base_ref !== 'string' ||
    !/^[A-Za-z0-9._/-]{1,255}$/.test(document.base_ref) ||
    document.base_ref.split('/').includes('..') ||
    document.app_name !== 'weijunswj-toolkit-security-gate' ||
    !Number.isInteger(document.integration_id) ||
    document.integration_id < 1 ||
    !/^[A-Za-z0-9_-]{22,128}$/.test(document.nonce || '') ||
    !/^[A-Za-z0-9-]{8,100}$/.test(document.delivery_id || '') ||
    document.correlation_id !== `tk023:${document.repository_id}:${document.pr_number}:${document.head_sha}:${String(document.correlation_id || '').split(':').at(-1)}` ||
    !/^tk023:[0-9]+:[0-9]+:[0-9a-f]{40}:[a-f0-9]{24}$/.test(document.correlation_id || '')
  ) throw new Error('Dispatch repository identity mismatch');
  if (
    document.authority_sha !== options.authoritySha ||
    !SHA40.test(document.head_sha) ||
    !SHA40.test(document.base_sha) ||
    !SHA40.test(document.authority_sha)
  ) throw new Error('Dispatch revision identity mismatch');
  const now = Number(options.now || Date.now());
  const issued = Date.parse(document.issued_at);
  const expires = Date.parse(document.expires_at);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || now < issued - 60000 || now > expires || expires - issued > 10 * 60 * 1000) {
    throw new Error('Dispatch envelope is expired or outside the allowed window');
  }
  return document;
}

async function requestOidcAttestation(options) {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken || !options.appUrl) throw new Error('OIDC attestation infrastructure is unavailable');
  const oidcResponse = await fetch(`${requestUrl}&audience=${encodeURIComponent('weijunswj-toolkit-security-gate')}`, {
    headers: { Authorization: `Bearer ${requestToken}` }
  });
  if (!oidcResponse.ok) throw new Error('OIDC token request failed');
  const tokenDocument = await oidcResponse.json();
  if (typeof tokenDocument.value !== 'string' || tokenDocument.value.length > 20000) throw new Error('OIDC token response is malformed');
  const response = await fetch(`${options.appUrl.replace(/\/$/, '')}/workflow/oidc-attest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenDocument.value}`,
      'Content-Type': 'application/json'
    },
    body: canonicalJson(options.binding)
  });
  if (!response.ok) throw new Error('OIDC attestation was rejected');
  const document = await response.json();
  if (!SHA256.test(String(document.attestation_id || ''))) throw new Error('OIDC attestation identity is malformed');
  return document.attestation_id;
}

function generateRulesetPlan(template, integrationId) {
  if (!Number.isInteger(Number(integrationId)) || Number(integrationId) < 1) {
    throw new Error('Promotion integration ID is required and must be a positive GitHub-assigned integer');
  }
  const id = Number(integrationId);
  const plan = structuredClone(template);
  if (!Array.isArray(plan.atomic_additions) || plan.atomic_additions.length !== 3) throw new Error('Ruleset plan must contain all three required contexts');
  const names = plan.atomic_additions.map((item) => item.context).sort();
  if (canonicalJson(names) !== canonicalJson(['Repository security gate', 'Validate', 'Validate Toolkit'].sort())) {
    throw new Error('Ruleset plan context set is incomplete');
  }
  if (!plan.preserve?.code_scanning || !plan.preserve?.code_quality || !plan.preserve?.deletion_protection || !plan.preserve?.non_fast_forward_protection) {
    throw new Error('Ruleset plan removes an existing required control');
  }
  plan.required_integration_id = id;
  plan.atomic_additions = plan.atomic_additions.map((item) => ({ ...item, integration_id: id }));
  plan.state = 'PROMOTION_READY_FOR_SEPARATE_APPROVAL';
  return { ...plan, plan_digest: sha256(canonicalJson(plan)) };
}

function usage() {
  return [
    'required-check-terminal.cjs inventory --authority-root <path> --candidate-root <path> --repository <owner/repo> --output <json>',
    'required-check-terminal.cjs generated --authority-root <path> --candidate-root <path> --operation-root <path> --output <json>',
    'required-check-terminal.cjs verify-dispatch --envelope <base64url> --signature <base64url> --public-key <pem> --output <json>',
    'required-check-terminal.cjs attest --app-url <url> --binding <json-file>',
    'required-check-terminal.cjs terminal --context <id> --config <json> --needs <json> --output <json> ...',
    'required-check-terminal.cjs promotion-plan --template <json> --integration-id <integer> --output <json>'
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (command === 'inventory') {
    const report = buildProducerInventory({
      authorityRoot: args['authority-root'],
      candidateRoot: args['candidate-root'],
      authorityCommit: args['authority-commit'],
      candidateHead: args['candidate-head'],
      repository: args.repository
    });
    writeJson(args.output, report);
    process.stdout.write(`${report.status} ${report.inventory_digest}\n`);
    return 0;
  }
  if (command === 'generated') {
    const report = runGeneratedSurfaceVerification({
      authorityRoot: args['authority-root'],
      candidateRoot: args['candidate-root'],
      operationRoot: args['operation-root'],
      authorityCommit: args['authority-commit'],
      candidateHead: args['candidate-head']
    });
    writeJson(args.output, report);
    process.stdout.write(`${report.status} ${report.result_digest}\n`);
    return report.status === 'PASS' ? 0 : 2;
  }
  if (command === 'verify-dispatch') {
    const document = verifyDispatchEnvelope({
      envelope: args.envelope,
      signature: args.signature,
      publicKeyPath: args['public-key'],
      repository: args.repository,
      repositoryId: args['repository-id'],
      authoritySha: args['authority-sha']
    });
    writeJson(args.output, document);
    process.stdout.write('PASS\n');
    return 0;
  }
  if (command === 'attest') {
    const binding = readJson(args.binding, 'OIDC attestation binding');
    const attestationId = await requestOidcAttestation({ appUrl: args['app-url'], binding });
    process.stdout.write(`${attestationId}\n`);
    return 0;
  }
  if (command === 'terminal') {
    const config = readJson(args.config, 'required-check producer config');
    const needs = args['needs-file'] ? readJson(args['needs-file'], 'needs evidence') : args.needs;
    const receipt = buildTerminalReceipt({
      config,
      contextId: args.context,
      needs,
      repository: args.repository,
      repositoryId: args['repository-id'],
      prNumber: args['pr-number'],
      headSha: args['head-sha'],
      headTree: args['head-tree'],
      baseSha: args['base-sha'],
      baseGeneration: args['base-generation'],
      authorityCommit: args['authority-commit'],
      authorityTree: args['authority-tree'],
      workflowDigest: args['workflow-digest'],
      runId: args['run-id'],
      runAttempt: args['run-attempt'],
      attemptGeneration: args['attempt-generation'],
      githubJobId: args['github-job-id'],
      correlationId: args['correlation-id'],
      nonce: args.nonce,
      producerInventoryDigest: args['producer-inventory-digest'],
      oidcAttestationId: args['oidc-attestation-id'],
      reportState: args['report-state']
    });
    writeJson(args.output, receipt);
    process.stdout.write(`${receipt.status} ${receipt.receipt_digest}\n`);
    return receipt.status === 'PASS' ? 0 : 2;
  }
  if (command === 'promotion-plan') {
    const plan = generateRulesetPlan(readJson(args.template, 'ruleset plan template'), Number(args['integration-id']));
    writeJson(args.output, plan);
    process.stdout.write(`PASS ${plan.plan_digest}\n`);
    return 0;
  }
  process.stderr.write(`${usage()}\n`);
  return 2;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.stderr.write('TK023_REQUIRED_CHECK_AUTHORITY_FAILED\n');
    process.exitCode = 2;
  });
}

module.exports = {
  INVENTORY_SCHEMA,
  TERMINAL_SCHEMA,
  ambiguityKey,
  buildProducerInventory,
  buildTerminalReceipt,
  canonicalJson,
  generateRulesetPlan,
  parseWorkflow,
  runGeneratedSurfaceVerification,
  sha256,
  validateYamlSource,
  verifyDispatchEnvelope
};
