#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_INPUT_BYTES = 2 * 1024 * 1024;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function containedFile(root, relative) {
  const normalized = String(relative || '').replace(/\\/g, '/');
  if (!normalized || path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error('candidate input path is invalid');
  }
  const full = path.resolve(root, normalized);
  const relation = path.relative(path.resolve(root), full);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error('candidate input path escapes the repository');
  }
  if (!fs.existsSync(full)) throw new Error('candidate input is missing');
  const status = fs.lstatSync(full);
  if (!status.isFile() || status.isSymbolicLink() || status.size > MAX_INPUT_BYTES) {
    throw new Error('candidate input is redirected or exceeds the bound');
  }
  const real = fs.realpathSync.native(full);
  const realRelation = path.relative(path.resolve(root), real);
  if (!realRelation || realRelation === '..' || realRelation.startsWith(`..${path.sep}`) || path.isAbsolute(realRelation)) {
    throw new Error('candidate input real path escapes the repository');
  }
  return { full, normalized };
}

function readInput(root, contract, expectedPath) {
  const record = contract.find((item) => item.path === expectedPath);
  if (!record || !/^[0-9a-f]{64}$/.test(record.sha256 || '')) {
    throw new Error('candidate input contract is missing');
  }
  const { full, normalized } = containedFile(root, expectedPath);
  const bytes = fs.readFileSync(full);
  const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
  if (sha256(text) !== record.sha256) throw new Error('candidate input digest drift');
  return { normalized, text };
}

function pass(id, inspected) {
  return {
    status: 'PASS',
    invariant_id: id,
    diagnostic_id: `sha256:${sha256(`${id}\nPASS`)}`,
    inspected_paths: inspected
  };
}

function finding(id, reason, inspected) {
  return {
    status: 'FINDINGS',
    invariant_id: id,
    diagnostic_id: `sha256:${sha256(`${id}\n${reason}`)}`,
    inspected_paths: inspected
  };
}

function guardedAutoSync(candidateRoot, contract) {
  const relative = '.github/workflows/auto-sync-generated-surfaces.yml';
  const input = readInput(candidateRoot, contract, relative);
  const required = [
    /^  pull_request_target:/m,
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
    /- name: Checkout trusted base revision/,
    /- name: Checkout PR head commit/,
    /node "\$TRUSTED_ROOT\/repo\/scripts\/sync-toolkit-projects\.cjs" --workspace "\$PR_ROOT" --write/,
    /current_head_sha[\s\S]*if \[\[ "\$current_head_sha" != "\$HEAD_SHA" \]\]/,
    /remote_head_sha[\s\S]*if \[\[ "\$remote_head_sha" != "\$HEAD_SHA" \]\]/,
    /persist-credentials: false/
  ];
  if (required.some((pattern) => !pattern.test(input.text))) {
    return finding('guarded-auto-sync-trust-boundary-v1', 'protected-writeback-contract-missing', [relative]);
  }
  return pass('guarded-auto-sync-trust-boundary-v1', [relative]);
}

function syntheticPrompt(candidateRoot, contract) {
  const fixturePath = 'repo/tests/fixtures/security-gate/synthetic-private-prompt.txt';
  const controllerPath = 'repo/scripts/toolkit-agent-control.cjs';
  const fixture = readInput(candidateRoot, contract, fixturePath);
  const controller = readInput(candidateRoot, contract, controllerPath);
  const fixtureSafe = /^UNIQUE_PRIVATE_PROMPT_[0-9a-f]{8} repository customer fixture\r?\n$/.test(fixture.text);
  const controllerSafe = (
    /const args = claudeInvocationArgs\(checked\)/.test(controller.text) &&
    /stdin:\s*promptBytes/.test(controller.text) &&
    /input:\s*invocation\.stdin/.test(controller.text)
  );
  if (!fixtureSafe || !controllerSafe) {
    return finding(
      'synthetic-private-prompt-transport-v1',
      'private-prompt-transport-contract-missing',
      [fixturePath, controllerPath]
    );
  }
  return pass('synthetic-private-prompt-transport-v1', [fixturePath, controllerPath]);
}

function evaluate(invariantId, options = {}) {
  const root = path.resolve(options.candidateRoot || '');
  const contract = Array.isArray(options.candidateInputs) ? options.candidateInputs : [];
  if (invariantId === 'guarded-auto-sync-trust-boundary-v1') return guardedAutoSync(root, contract);
  if (invariantId === 'synthetic-private-prompt-transport-v1') return syntheticPrompt(root, contract);
  throw new Error('trusted invariant id is not implemented');
}

module.exports = { evaluate };
