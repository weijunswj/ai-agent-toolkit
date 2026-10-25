'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

// Every text input is normalised (BOM and CRLF/CR) before extraction or comparison,
// so Windows checkouts with core.autocrlf=true read the same content as LF checkouts.
const normalise = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const rawRead = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const lfRead = (relative) => rawRead(relative).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); // independent of normalise()
const windowsRead = (relative) => `\uFEFF${lfRead(relative).replace(/\n/g, '\r\n')}`;
const readers = { checkout: rawRead, lf: lfRead, windows: windowsRead };

// The governed block (and its projections) carries the gate-specific half of the rule.
const GOVERNED_COPIES = Object.freeze([
  'repo/contracts/agent-rules/toolkit-governed-rules.md',
  'AGENTS.md',
  'repo/contracts/agent-rules/repo-local/AGENTS.managed.template.md',
  'skills/repository-agent-rules/repo-local/AGENTS.managed.template.md'
]);
const N8N_PREFIXED_DERIVATIVES = Object.freeze([
  'skills/n8n-environment-setup/references/n8n-safety-rules.md',
  'skills/n8n-workflow-transport/references/n8n-safety-rules.md'
]);
const N8N_FIXTURES = Object.freeze([
  'repo/tests/fixtures/n8n-workflows/customer-support-agent.workflow.template.json',
  'repo/tests/fixtures/n8n-workflows/global-error-handler.template.json',
  'repo/tests/fixtures/n8n-workflows/rag-ingestion.workflow.template.json'
]);
const EXCEPTION_FIELDS = Object.freeze(['consumer', 'owner', 'necessity', 'removal']);

// Retained exceptions follow the shared rule: current consumer, owner, present necessity and
// removal condition. A stale entry fails the suite so it is removed with its last use.
const LABEL_EXCEPTIONS = Object.freeze([
  {
    file: 'skills/controller-bootstrap/SKILL.md',
    field: 'description',
    token: 'N5',
    consumer: 'Host skill discovery reads this description; its negative clause steers N5 programme reconciliation away from Controller Bootstrap.',
    owner: 'Issue #499 whole-tree product-language cleanup (queued next Core).',
    necessity: 'Rewording installed discovery text changes host routing and belongs to the #499 retrofit, not to this policy change.',
    removal: 'Delete this entry in the #499 change that rewrites the description; the stale-exception test fails once N5 is gone.'
  }
]);

// Internal programme/version codes such as N5 or V3 are unexplained unless a parenthetical of
// at least two words follows them. Toolkit gate names G0/G1/G2 are deliberately not matched.
const PRODUCT_LABEL = /\b([NV]\d+)\b(?!\s*\([^()\s]+(?:\s+[^()\s]+)+\))/g;
const unexplainedLabels = (text) => [...normalise(String(text || '')).matchAll(PRODUCT_LABEL)].map((match) => match[1]);

// n8n's own default labels for action/condition nodes, optionally numbered ("HTTP Request 1"),
// and its glued duplicate suffix ("If2", "Gmail1"). Native trigger labels that state the start
// condition (for example manualTrigger's 'When clicking "Execute workflow"') are not defaults
// of this kind and are accepted.
const GENERIC_NODE_NAME = /^(?:HTTP Request|If|Switch|Merge|Code|Function|Function Item|Set|Edit Fields(?: \(Set\))?|Filter|Wait|No Operation, do nothing|Execute Workflow|Node)(?:\s*\d+)?$/i;
const DUPLICATE_SUFFIX = /[a-z]{2}\d+$/;
const STICKY_NOTE = 'n8n-nodes-base.stickyNote';
const MIN_EXPLANATION_WORDS = 12;

function frontmatterFields(text) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(normalise(text));
  const fields = {};
  for (const line of block ? block[1].split('\n') : []) {
    const match = /^(name|description):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}

function skillFindings(file, text, exceptions = LABEL_EXCEPTIONS) {
  const findings = [];
  const fields = frontmatterFields(text);
  for (const field of ['name', 'description']) {
    if (!fields[field]) findings.push(`${file}: missing ${field}`);
    for (const token of unexplainedLabels(fields[field])) {
      const excepted = exceptions.some((entry) => entry.file === file && entry.field === field && entry.token === token);
      if (!excepted) findings.push(`${file}: unexplained ${token} in ${field}`);
    }
  }
  return findings;
}

function stringValues(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) stringValues(item, out);
  return out;
}

function referencedNodeNames(node) {
  const names = [];
  const pattern = /\$\(\s*(['"])(.+?)\1\s*\)|\$node\[\s*(['"])(.+?)\3\s*\]/g;
  for (const value of stringValues(node.parameters)) {
    for (const match of value.matchAll(pattern)) names.push(match[2] || match[4]);
  }
  return names;
}

function explanationWords(content) {
  const text = String(content || '')
    .replace(/__[A-Z0-9_]+__/g, ' ')
    .replace(/[#*`>_\-|[\]()]/g, ' ');
  return text.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length;
}

function workflowFindings(workflow) {
  const findings = [];
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const names = new Set(nodes.map((node) => node.name));
  for (const token of unexplainedLabels(workflow.name)) findings.push(`workflow name: unexplained ${token}`);
  if (!String(workflow.name || '').trim()) findings.push('workflow name: missing');

  for (const node of nodes.filter((item) => item.type !== STICKY_NOTE)) {
    if (GENERIC_NODE_NAME.test(node.name) || DUPLICATE_SUFFIX.test(node.name)) findings.push(`node "${node.name}": generic default name`);
    for (const token of unexplainedLabels(node.name)) findings.push(`node "${node.name}": unexplained ${token}`);
    for (const target of referencedNodeNames(node)) {
      if (!names.has(target)) findings.push(`node "${node.name}": expression references missing node "${target}"`);
    }
  }
  for (const [source, outputs] of Object.entries(workflow.connections || {})) {
    if (!names.has(source)) findings.push(`connection from missing node "${source}"`);
    for (const branch of Object.values(outputs || {}).flat(2)) {
      if (branch && !names.has(branch.node)) findings.push(`connection to missing node "${branch.node}"`);
    }
  }

  const explained = nodes.some((node) => node.type === STICKY_NOTE && explanationWords(node.parameters?.content) >= MIN_EXPLANATION_WORDS);
  if (!explained) findings.push('workflow: no operator-facing sticky-note explanation');
  return findings;
}

// Synthetic rename for negative tests; `skip` leaves expressions or connections stale on purpose.
function renameNode(workflow, from, to, skip = '') {
  const swap = (value) => value.split(`$('${from}')`).join(`$('${to}')`).split(`$("${from}")`).join(`$("${to}")`)
    .split(`$node["${from}"]`).join(`$node["${to}"]`);
  const deep = (value) => {
    if (typeof value === 'string') return swap(value);
    if (Array.isArray(value)) return value.map(deep);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deep(item)]));
    return value;
  };
  for (const node of workflow.nodes) {
    if (node.name === from) node.name = to;
    if (skip !== 'expressions') node.parameters = deep(node.parameters);
  }
  if (skip === 'connections') return workflow;
  workflow.connections = Object.fromEntries(Object.entries(workflow.connections).map(([source, outputs]) => [
    source === from ? to : source,
    JSON.parse(JSON.stringify(outputs), (key, value) => (key === 'node' && value === from ? to : value))
  ]));
  return workflow;
}

const loadWorkflow = (load, file) => JSON.parse(normalise(load(file)));
const publishedSkills = () => fs.readdirSync(path.join(root, 'skills'))
  .map((name) => `skills/${name}/SKILL.md`)
  .filter((file) => fs.existsSync(path.join(root, file)));
const executableNodes = (workflow) => workflow.nodes.filter((node) => node.type !== STICKY_NOTE && !/trigger/i.test(node.type));

function checkDefaultRules(load) {
  const source = normalise(load('repo/contracts/agent-rules/global-rules.md'));
  const law = source.split('## Human-readable Work\n')[1]?.split('\n## ')[0] || '';
  assert.match(law, /New or changed human-facing work/);
  for (const item of ['labels', 'errors', 'documents', 'n8n', 'historical receipts', 'not internal programme, release or run labels', 'misleading text is a real defect']) assert.ok(law.includes(item), item);
  assert.match(law, /retained unclear label names its consumer, owner, need and removal condition/);
  // The gate review duties are gate mechanics, so they sit in the gate rules every gate session reads.
  const gate = normalise(load('repo/contracts/agent-rules/gate-rules.md'));
  assert.match(gate, /G1 checks the actual user or operator surface for clarity during validation and UAT, and G2 treats unsafe or misleading text as a real finding/);
  assert.match(gate, /Gate names `G0`, `G1` and `G2` are fine where the reader needs them/);
}

function checkController(load) {
  const controller = normalise(load('repo/CONTROLLER.md'));
  assert.equal(controller.includes('## Historical compatibility reference'), false);
  const active = controller;
  assert.match(active, /### Human-readable product and operational text/);
  assert.match(active, /n8n include a meaningful workflow name/);
  assert.match(active, /G0.*G1.*G2.*remain valid/);
  assert.match(active, /retained exception .* current consumer, accountable owner, present behavioural necessity and removal condition/);
  const standard = normalise(load('repo/docs/PROJECT-MODULE-STANDARD.md'));
  assert.match(standard, /Human-facing quality standard/);
  assert.match(standard, /human-readable-deliverables/);
}

function checkN8nRules(load) {
  const n8nSource = `${normalise(load('repo/contracts/agent-rules/n8n-safety-rules.md')).trimEnd()}\n`;
  for (const item of ['Human-readable workflow presentation is mandatory', 'business-purpose name', 'major nodes', 'when the workflow starts', 'input/source', 'results are sent or written', 'duplicates, retries and errors', 'manual recovery/owner', 'expression and connection references', 'G0, G1 and G2', 'current consumer', 'removal condition']) assert.ok(n8nSource.includes(item), item);
  const direct = normalise(load('skills/n8n-safety-router/n8n-safety-rules.md'));
  assert.equal(direct, n8nSource);
  for (const file of N8N_PREFIXED_DERIVATIVES) {
    const derivative = normalise(load(file));
    assert.ok(derivative.endsWith(direct), file);
    assert.match(derivative.slice(0, -direct.length), /n8n Safety Rules Cross-Product Reference/);
  }
}

for (const [label, load] of Object.entries(readers)) {
  test(`${label} input: default rules require readable work, valid gate names and exception records`, () => checkDefaultRules(load));
  test(`${label} input: controller and skill standard carry the same quality floor`, () => checkController(load));
  test(`${label} input: n8n rules and every derivative match the canonical source`, () => checkN8nRules(load));
  test(`${label} input: published skill frontmatter and controlled n8n fixtures pass`, () => {
    for (const file of publishedSkills()) assert.deepEqual(skillFindings(file, load(file)), [], file);
    for (const file of N8N_FIXTURES) assert.deepEqual(workflowFindings(loadWorkflow(load, file)), [], file);
  });
}

test('raw Windows input breaks unnormalised extraction, which the shared normaliser repairs', () => {
  const windows = windowsRead('repo/contracts/agent-rules/global-rules.md');
  assert.equal(windows.split('## Human-readable Work\n').length, 1);
  assert.notEqual(windowsRead('skills/n8n-safety-router/n8n-safety-rules.md'), lfRead('skills/n8n-safety-router/n8n-safety-rules.md'));
  assert.throws(() => JSON.parse(windowsRead(N8N_FIXTURES[0])));
  assert.equal(normalise(windows), lfRead('repo/contracts/agent-rules/global-rules.md'));
});

test('skill frontmatter rejects unexplained programme labels and keeps gate names and explained codes', () => {
  const skill = (description) => `---\nname: example-skill\ndescription: ${description}\n---\n# Example\n`;
  assert.deepEqual(skillFindings('skills/example/SKILL.md', skill('Run the V3 intake helper.')), ['skills/example/SKILL.md: unexplained V3 in description']);
  assert.deepEqual(skillFindings('skills/example/SKILL.md', skill('Prepare N5 reconciliation.')), ['skills/example/SKILL.md: unexplained N5 in description']);
  assert.deepEqual(skillFindings('skills/example/SKILL.md', '---\nname: v3-helper\n---\n'), ['skills/example/SKILL.md: missing description']);
  assert.deepEqual(skillFindings('skills/example/SKILL.md', skill('Use during G0 discovery, G1 build and G2 review.')), []);
  assert.deepEqual(skillFindings('skills/example/SKILL.md', skill('Migrate V3 (the third contract generation) records.')), []);
  assert.deepEqual(skillFindings('skills/example/SKILL.md', `\uFEFF${skill('Plain description.').replace(/\n/g, '\r\n')}`), []);
});

test('label exceptions are complete, narrow and not stale', () => {
  for (const entry of LABEL_EXCEPTIONS) {
    for (const field of EXCEPTION_FIELDS) assert.ok(String(entry[field] || '').trim().length > 20, `${entry.file} ${field}`);
    const fields = frontmatterFields(rawRead(entry.file));
    assert.ok(unexplainedLabels(fields[entry.field]).includes(entry.token), `stale exception: ${entry.file} ${entry.token}`);
    assert.deepEqual(skillFindings(entry.file, rawRead(entry.file), []), [`${entry.file}: unexplained ${entry.token} in ${entry.field}`]);
  }
  const elsewhere = `---\nname: other-skill\ndescription: Do not route N5 programme reconciliation.\n---\n`;
  assert.deepEqual(skillFindings('skills/other-skill/SKILL.md', elsewhere), ['skills/other-skill/SKILL.md: unexplained N5 in description']);
});

test('each controlled n8n fixture rejects synthetic naming, label and explanation regressions', () => {
  for (const file of N8N_FIXTURES) {
    const fresh = () => loadWorkflow(rawRead, file);
    const target = executableNodes(fresh())[0].name;

    for (const generic of ['HTTP Request 1', 'If2', 'Code', 'Gmail1']) {
      assert.deepEqual(workflowFindings(renameNode(fresh(), target, generic)), [`node "${generic}": generic default name`], `${file} ${generic}`);
    }
    assert.deepEqual(workflowFindings(renameNode(fresh(), target, 'N5 Router')), ['node "N5 Router": unexplained N5'], file);
    assert.deepEqual(workflowFindings(renameNode(fresh(), target, 'Route Approved Requests')), [], file);

    const labelled = fresh();
    labelled.name = 'V3 intake';
    assert.deepEqual(workflowFindings(labelled), ['workflow name: unexplained V3'], file);

    const staleConnections = workflowFindings(renameNode(fresh(), target, 'Renamed Node', 'connections'));
    assert.ok(staleConnections.includes(`connection to missing node "${target}"`), file);
    assert.ok(staleConnections.includes(`connection from missing node "${target}"`), file);
    assert.ok(staleConnections.every((finding) => finding.startsWith('connection ') && finding.includes(`"${target}"`)), file);

    const referenced = fresh().nodes.flatMap(referencedNodeNames);
    for (const name of new Set(referenced)) {
      const staleExpressions = workflowFindings(renameNode(fresh(), name, 'Renamed Node', 'expressions'));
      assert.ok(staleExpressions.length > 0, `${file} ${name}`);
      assert.ok(staleExpressions.every((finding) => finding.endsWith(`expression references missing node "${name}"`)), `${file} ${name}`);
    }

    const noNotes = fresh();
    noNotes.nodes = noNotes.nodes.filter((node) => node.type !== STICKY_NOTE);
    assert.deepEqual(workflowFindings(noNotes), ['workflow: no operator-facing sticky-note explanation'], file);

    for (const content of ['', '# Overview', '## Notes\n\n- __SET_VALUE__']) {
      const emptyNotes = fresh();
      for (const node of emptyNotes.nodes.filter((item) => item.type === STICKY_NOTE)) node.parameters.content = content;
      assert.deepEqual(workflowFindings(emptyNotes), ['workflow: no operator-facing sticky-note explanation'], `${file} ${JSON.stringify(content)}`);
    }
  }
});

test('native trigger wording and generic sticky-note titles are judged by meaning, not name alone', () => {
  const workflow = loadWorkflow(rawRead, 'repo/tests/fixtures/n8n-workflows/global-error-handler.template.json');
  assert.ok(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.manualTrigger' && node.name === 'When clicking "Execute workflow"'));
  assert.ok(workflow.nodes.some((node) => node.type === STICKY_NOTE && node.name === 'Sticky Note'));
  assert.deepEqual(workflowFindings(workflow), []);
});
