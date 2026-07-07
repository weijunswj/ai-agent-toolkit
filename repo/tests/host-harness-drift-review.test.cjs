'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function readJson(relPath) {
  return JSON.parse(readRepoFile(relPath).replace(/^\uFEFF/, ''));
}

test('host harness drift advisory target declares evidence, scope, cadence, and classifications', () => {
  const advisory = readJson('repo/source-watch/advisory-targets.json');
  const target = advisory.targets.find((item) => item.id === 'host-harness-capability-drift-review');
  assert.ok(target, 'host harness drift review target exists');
  assert.equal(target.name, 'Host Harness Capability Drift Review');
  assert.equal(target.kind, 'manual');
  assert.equal(target.state, 'watching');
  assert.equal(target.review_cadence_days, 90);
  assert.equal(target.last_reviewed_at, null);
  assert.equal(target.review_template, 'repo/source-watch/templates/host-harness-capability-drift-review.md');
  assert.ok(target.evidence_sources.some((item) => /OpenAI Codex changelog/.test(item)));
  assert.ok(target.evidence_sources.some((item) => /OpenAI Codex AGENTS\.md docs/.test(item)));
  assert.ok(target.evidence_sources.some((item) => /OpenAI Codex memories docs/.test(item)));
  assert.ok(target.evidence_sources.some((item) => /OpenAI Codex hooks docs/.test(item)));
  assert.ok(target.evidence_sources.some((item) => /Claude Code overview docs/.test(item)));
  assert.ok(target.evidence_sources.some((item) => /Claude Code memory and rules docs/.test(item)));
  assert.ok(target.evidence_sources.some((item) => /Claude Code hooks docs/.test(item)));
  assert.ok(target.evidence_sources.some((item) => /Claude Code changelog/.test(item)));
  assert.ok(target.toolkit_scope.some((item) => /skills/.test(item)));
  assert.ok(target.toolkit_scope.some((item) => /AGENTS\.md/.test(item)));
  assert.ok(target.toolkit_scope.some((item) => /hook guidance/.test(item)));
  assert.ok(target.toolkit_scope.some((item) => /repo-map/.test(item)));
  assert.ok(target.toolkit_scope.some((item) => /MEMORY\.md/.test(item)));
  assert.ok(target.toolkit_scope.some((item) => /documentation cleanup/.test(item)));
  assert.deepEqual(target.classification_options, [
    'Keep',
    'Shrink',
    'Move to hook',
    'Move to host-native feature',
    'Delete',
    'Needs benchmark/eval before decision'
  ]);
});

test('host harness drift review template contains required checklist fields and no auto-change rule', () => {
  const template = readRepoFile('repo/source-watch/templates/host-harness-capability-drift-review.md');
  for (const label of [
    'Native host capability observed',
    'Source/evidence',
    'Toolkit component affected',
    'Duplication/conflict risk',
    'Recommendation',
    'Validation needed'
  ]) {
    assert.match(template, new RegExp(label.replace('/', '\\/')));
  }
  for (const classification of [
    'Keep',
    'Shrink',
    'Move to hook',
    'Move to host-native feature',
    'Delete',
    'Needs benchmark/eval before decision'
  ]) {
    assert.match(template, new RegExp(classification.replace('/', '\\/')));
  }
  assert.match(template, /Codex \/ OpenAI Codex docs or changelog/);
  assert.match(template, /Claude Code docs or changelog/);
  assert.match(template, /Do not auto-delete or auto-modify toolkit components from the source-watch PR/);
  assert.match(template, /separate PR with evidence, rationale, exact proposed modifications, and validation/);
});
