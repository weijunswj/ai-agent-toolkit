'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');
const path = require('node:path');
const kernel = require(path.join(__dirname, '..', 'scripts', 'toolkit-control-plane', 'control-plane-kernel.cjs'));

const ROOT = 'C:\\fixture\\workspace\\repo';

function baseInput(operation, overrides = {}) {
  return {
    enabled: true,
    activation: { mode: 'explicit-local', consented: true },
    now: '2026-08-16T14:00:00.000Z',
    repository: {
      root: ROOT,
      worktree: `${ROOT}\\worktree`,
      remote: 'https://github.com/weijunswj/ai-agent-toolkit.git',
      resolution: { status: 'resolved', link_type: 'none' },
    },
    authority: {
      role: 'executor',
      identity: 'executor-boundary',
      provider: 'OpenAI',
      model: 'GPT-5.6 Luna / Max',
      assignment: 'run-127-a1-soir-r1-g3-127',
      finality_claim: false,
      allowed_operation_types: [operation.type],
    },
    operation,
    ...overrides,
  };
}

function target(relativePath) {
  const full = `${ROOT}\\${relativePath}`;
  return { path: full, resolution: { status: 'resolved', canonical_path: full, link_type: 'none' } };
}

test('dynamic typed paths fail closed instead of falling back to a shell parser', () => {
  for (const targetValue of [
    { path: `${ROOT}\\*.txt`, resolution: { status: 'resolved', canonical_path: `${ROOT}\\*.txt`, link_type: 'none' } },
    { path: `${ROOT}\\${String.raw`$env:SECRET`}`, resolution: { status: 'resolved', canonical_path: `${ROOT}\\${String.raw`$env:SECRET`}`, link_type: 'none' } },
  ]) {
    const result = kernel.evaluate(baseInput({ type: 'filesystem.read', target: targetValue }));
    assert.notEqual(result.decision, 'allow');
    assert.notEqual(result.secret_classification, 'none');
  }
});

test('caller-supplied target classes cannot grant repository authority', () => {
  const outside = {
    path: 'C:\\fixture\\outside.txt',
    target_class: 'repository-safe',
    resolved_inside: true,
    resolution: { status: 'resolved', canonical_path: 'C:\\fixture\\outside.txt', link_type: 'none' },
  };
  const result = kernel.evaluate(baseInput({ type: 'filesystem.read', target: outside }));
  assert.notEqual(result.decision, 'allow');
  assert.notEqual(result.target_class, 'repository-safe');
});

test('compound local filesystem targets cannot be masked by an in-repository component', () => {
  const protectedTarget = { path: ROOT, resolution: { status: 'resolved', canonical_path: ROOT, link_type: 'none' } };
  const result = kernel.evaluate(baseInput({
    type: 'compound',
    components: [
      { type: 'filesystem.read', target: target('src\\safe.txt') },
      { type: 'filesystem.delete', target: protectedTarget },
    ],
  }, { authority: { ...baseInput({ type: 'git.read' }).authority, allowed_operation_types: ['filesystem.read', 'filesystem.delete'] } }));
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason_code, 'CATASTROPHIC_TARGET_DENIED');
});
