'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('repo/contracts/agent-rules/ai-coding-agent-execution.md');
const n8nSource = read('repo/contracts/agent-rules/n8n-safety-rules.md').replace(/\r\n/g, '\n').trimEnd() + '\n';

test('default rules require readable human-facing work and retain valid gate names', () => {
  const law = source.split('## Human-readable Deliverables\n')[1]?.split('\n## ')[0] || '';
  assert.match(law, /Mandatory for new or materially changed human-facing work/);
  for (const item of ['forms', 'dashboards', 'errors', 'n8n', 'G1 validation', 'G2 review', 'historical receipts', 'V3', 'N5']) assert.ok(law.includes(item), item);
  assert.match(law, /G0.*G1.*G2.*legitimate/);
  for (const file of [
    'AGENTS.md',
    'repo/contracts/agent-rules/AGENTS.template.md',
    'repo/contracts/agent-rules/CLAUDE.template.md',
    'repo/contracts/agent-rules/GEMINI.template.md',
    'repo/contracts/agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/repository-agent-rules/repo-local/AGENTS.managed.template.md'
  ]) {
    assert.equal(read(file).split('## Human-readable Deliverables\n').length, 2, file);
    assert.ok(read(file).includes(law), file);
  }
});

test('controller and skill standard carry the same prospective quality floor', () => {
  const controller = read('repo/CONTROLLER.md');
  const active = controller.split('## Current V3 operating procedure')[1]?.split('## Historical compatibility reference')[0] || '';
  assert.match(active, /### Human-readable product and operational text/);
  assert.match(active, /n8n include a meaningful workflow name/);
  assert.match(active, /G0.*G1.*G2.*remain valid/);
  const standard = read('repo/docs/PROJECT-MODULE-STANDARD.md');
  assert.match(standard, /Human-facing quality standard/);
  assert.match(standard, /human-readable-deliverables/);
});

test('n8n workflow clarity covers trigger, outputs, recovery and technical references', () => {
  for (const item of ['Human-readable workflow presentation is mandatory', 'business-purpose name', 'major nodes', 'when the workflow starts', 'input/source', 'results are sent or written', 'duplicates, retries and errors', 'manual recovery/owner', 'expression and connection references', 'G0, G1 and G2']) assert.ok(n8nSource.includes(item), item);
  const direct = read('skills/n8n-safety-router/n8n-safety-rules.md');
  assert.equal(direct, n8nSource);
  for (const file of [
    'skills/n8n-environment-setup/references/n8n-safety-rules.md',
    'skills/n8n-workflow-transport/references/n8n-safety-rules.md'
  ]) {
    const derivative = read(file);
    assert.ok(derivative.endsWith(direct), file);
    assert.match(derivative.slice(0, -direct.length), /n8n Safety Rules Cross-Product Reference/);
  }
});
