'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const contractPath = path.join(root, 'repo', 'contracts', 'github-program-predecessor-coverage.json');
const reconciler = require('../scripts/toolkit-github-program-reconciler.cjs');

function exactContract() {
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function issue(contract, number) {
  return contract.predecessors.find((entry) => entry.issue === number);
}

function criterion(contract, number, id) {
  return issue(contract, number).criteria.find((entry) => entry.id === id);
}

function expectUnmapped(contract) {
  assert.equal(typeof reconciler.validatePredecessorCoverage, 'function');
  const result = reconciler.validatePredecessorCoverage(contract);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNMAPPED_PREDECESSOR_OBLIGATION');
}

test('exact complete Web predecessor matrix passes', () => {
  const result = reconciler.validatePredecessorCoverage(exactContract());
  assert.equal(result.ok, true);
  assert.equal(result.issue_count, 45);
  assert.equal(result.criterion_count, 84);
  assert.equal(result.unmapped_predecessor_obligations, 0);
});

test('missing one of the 45 issues fails closed', () => {
  const contract = exactContract();
  contract.predecessors = contract.predecessors.filter((entry) => entry.issue !== 348);
  expectUnmapped(contract);
});

test('duplicate predecessor identity fails closed', () => {
  const contract = exactContract();
  contract.predecessors.push(clone(contract.predecessors[0]));
  expectUnmapped(contract);
});

test('invalid disposition fails closed', () => {
  const contract = exactContract();
  contract.predecessors[0].criteria[0].disposition = 'DONE';
  expectUnmapped(contract);
});

test('UNMAPPED is never accepted', () => {
  const contract = exactContract();
  contract.predecessors[0].criteria[0].disposition = 'UNMAPPED';
  expectUnmapped(contract);
});

test('TRANSFERRED without an explicit current owner fails closed', () => {
  const contract = exactContract();
  delete contract.predecessors[0].criteria[0].current_owner;
  expectUnmapped(contract);
});

test('dropped split criterion fails closed', () => {
  const contract = exactContract();
  issue(contract, 243).criteria = issue(contract, 243).criteria.filter((entry) => entry.id !== '243-native-proof');
  expectUnmapped(contract);
});

test('altered controlling authority reference fails closed', () => {
  const contract = exactContract();
  contract.authority.comment_id = 5437827031;
  expectUnmapped(contract);
});

test('#246 cannot become programme-blocking without reactivation', () => {
  const contract = exactContract();
  criterion(contract, 246, '246-optional-queue-mode').programme_blocking = true;
  expectUnmapped(contract);
});

test('#250 cannot become programme-blocking without reactivation', () => {
  const contract = exactContract();
  criterion(contract, 250, '250-three-parked-investigations').programme_blocking = true;
  expectUnmapped(contract);
});

test('#324 host-harness obligation cannot be terminalised', () => {
  const contract = exactContract();
  const hostHarness = criterion(contract, 324, '324-host-harness-capability');
  hostHarness.disposition = 'SATISFIED';
  delete hostHarness.current_owner;
  hostHarness.evidence_refs = ['github:issue-comment:359:5437827030'];
  expectUnmapped(contract);
});

test('terminal historical criterion requires evidence', () => {
  const contract = exactContract();
  criterion(contract, 299, '299-historical-n5-implementation').evidence_refs = [];
  expectUnmapped(contract);
});
