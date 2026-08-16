'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const kernel = require('../scripts/toolkit-control-plane/control-plane-kernel.cjs');

const ROOT = 'C:\\fixture\\workspace\\repo';
const base = (operation) => ({
  enabled: true,
  activation: { mode: 'explicit-local', consented: true },
  now: '2026-08-16T14:00:00.000Z',
  repository: { root: ROOT, worktree: `${ROOT}\\worktree`, remote: 'https://github.com/weijunswj/ai-agent-toolkit.git', resolution: { status: 'resolved', link_type: 'none' } },
  authority: { role: 'executor', provider: 'OpenAI', model: 'GPT-5.6 Luna / Max', assignment: 'run-110-a1-control-plane-kernel-g3-110', finality_claim: false, allowed_operation_types: [operation.type] },
  operation,
});

test('dynamic typed paths fail closed instead of relying on a shell parser', () => {
  const result = kernel.evaluate(base({
    type: 'filesystem.read',
    target: { path: `${ROOT}\\src\\*.txt`, target_class: 'canonical-repository', resolution: { status: 'resolved', canonical_path: `${ROOT}\\src\\*.txt`, link_type: 'none' } },
  }));
  assert.equal(result.decision, 'unsupported');
  assert.equal(result.reason_code, 'DYNAMIC_TARGET_UNSUPPORTED');
  assert.equal(result.secret_classification, 'possible');
});

test('caller-supplied target classes cannot grant repository authority', () => {
  const sibling = 'C:\\fixture\\workspace\\sibling\\file.txt';
  const result = kernel.evaluate(base({
    type: 'filesystem.read',
    target: { path: sibling, target_class: 'canonical-repository', resolved_inside: true, resolution: { status: 'resolved', canonical_path: sibling, link_type: 'none' } },
  }));
  assert.notEqual(result.decision, 'allow');
  assert.equal(result.reason_code, 'TARGET_AUTHORITY_REQUIRED');
  assert.equal(result.target_class, 'outside-repository');
});

test('compound local filesystem targets cannot be masked by an in-repository component', () => {
  const inside = 'C:\\fixture\\workspace\\repo\\src\\file.txt';
  const outside = 'C:\\fixture\\workspace\\sibling\\file.txt';
  const input = base({
    type: 'compound',
    components: [
      { type: 'filesystem.read', target: { path: inside, resolution: { status: 'resolved', canonical_path: inside, link_type: 'none' } } },
      { type: 'filesystem.write', target: { path: outside, resolution: { status: 'resolved', canonical_path: outside, link_type: 'none' } } },
    ],
  });
  input.authority.allowed_operation_types = ['filesystem.read', 'filesystem.write'];
  const result = kernel.evaluate(input);
  assert.equal(result.decision, 'ask');
  assert.equal(result.reason_code, 'TARGET_AUTHORITY_REQUIRED');
  assert.equal(result.target_class, 'outside-repository');
});
