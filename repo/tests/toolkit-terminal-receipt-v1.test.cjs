'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const kernel = require('../scripts/toolkit-controller-kernel.cjs');

const repository = 'weijunswj/ai-agent-toolkit';
const createdAt = '2026-09-18T00:00:00.000Z';

function authority(kind) {
  return {
    reference: `https://github.com/${repository}/${kind === 'issue' ? 'issues' : 'pull'}/422#issuecomment-5729731423`,
    digest: '1'.repeat(64),
  };
}

function evidence(kind) {
  return { reference: `github:${kind}:422:5729731423`, digest: '2'.repeat(64) };
}

function readback(kind, number) {
  return { verified: true, reference: `observed:${kind}:${number}`, digest: '3'.repeat(64) };
}

function observedReceipt(receipt) {
  return { ...receipt.object, ...receipt.readback };
}

test('issue-close receipts remain typed, digest-bound, and readback verified', () => {
  const created = kernel.createTerminalReceipt({
    object: { kind: 'issue', repository, number: 422, terminal_state: 'CLOSED' },
    terminal_disposition: { kind: 'ISSUE_COMPLETED', summary: 'Issue closed with the controlling receipt.' },
    authority: authority('issue'),
    evidence: evidence('issue'),
    readback: readback('issue', 422),
    receipt_id: 'receipt-issue-422',
    created_at: createdAt,
  });
  assert.equal(created.ok, true, created.code);
  assert.equal(kernel.validateTerminalReceipt(created.receipt).ok, true);
  assert.equal(created.identity.id, 'receipt-issue-422');
  assert.equal(created.identity.reference, created.receipt.readback.reference);
  const reconciled = kernel.reconcileTerminalReceipt({
    object: { kind: 'issue', repository, number: 422, terminal_state: 'CLOSED' },
    receipt: created.receipt,
    observed_readback: observedReceipt(created.receipt),
  });
  assert.equal(reconciled.ok, true, reconciled.code);
  assert.equal(reconciled.reopen_allowed, false);
});

test('receipt proof never manufactures authority, evidence, or independent readback', () => {
  const object = { kind: 'issue', repository, number: 424, terminal_state: 'CLOSED' };
  const complete = {
    object,
    authority: authority('issue'),
    evidence: evidence('issue'),
    readback: readback('issue', 424),
  };
  assert.equal(kernel.createTerminalReceipt({ ...complete, evidence: undefined }).code, 'TERMINAL_RECEIPT_INCOMPLETE');
  assert.equal(kernel.createTerminalReceipt({ ...complete, authority: undefined }).code, 'TERMINAL_RECEIPT_INCOMPLETE');
  assert.equal(kernel.createTerminalReceipt({ object }).code, 'TERMINAL_RECEIPT_INCOMPLETE');
  assert.equal(kernel.createTerminalReceipt({ ...complete, readback: { ...complete.readback, verified: false } }).code, 'TERMINAL_RECEIPT_INCOMPLETE');

  const created = kernel.createTerminalReceipt({ ...complete, receipt_id: 'receipt-issue-424', created_at: createdAt });
  assert.equal(created.ok, true, created.code);
  const missingObservation = kernel.reconcileTerminalReceipt({ object, receipt: created.receipt });
  assert.equal(missingObservation.ok, false);
  assert.equal(missingObservation.code, 'TERMINAL_RECEIPT_READBACK_UNVERIFIED');
  const positive = kernel.reconcileTerminalReceipt({ object, receipt: created.receipt, observed_readback: observedReceipt(created.receipt) });
  assert.equal(positive.ok, true, positive.code);
  assert.equal(positive.code, 'TERMINAL_RECEIPT_READBACK_VERIFIED');
});

test('PR merge and close-without-merge receipts preserve candidate identity', () => {
  const mergeCandidate = {
    head: '3'.repeat(40),
    base: '4'.repeat(40),
    tree: '5'.repeat(40),
    merge_commit: '6'.repeat(40),
  };
  const merged = kernel.createTerminalReceipt({
    object: { kind: 'pull_request', repository, number: 422, terminal_state: 'MERGED' },
    terminal_disposition: { kind: 'PR_MERGED', summary: 'PR merged with exact candidate identity.' },
    authority: authority('pr'),
    evidence: evidence('pr'),
    readback: readback('pr', 422),
    candidate: mergeCandidate,
    receipt_id: 'receipt-pr-merged-422',
    created_at: createdAt,
  });
  assert.equal(merged.ok, true, merged.code);
  assert.equal(merged.receipt.candidate.merge_commit, mergeCandidate.merge_commit);

  const closed = kernel.createTerminalReceipt({
    object: { kind: 'pull_request', repository, number: 423, terminal_state: 'CLOSED_UNMERGED' },
    terminal_disposition: { kind: 'PR_CLOSED_UNMERGED', summary: 'PR closed without merge.' },
    authority: authority('pr'),
    evidence: evidence('pr'),
    readback: readback('pr', 423),
    candidate: { ...mergeCandidate, merge_commit: null },
    receipt_id: 'receipt-pr-closed-423',
    created_at: createdAt,
  });
  assert.equal(closed.ok, true, closed.code);
  assert.equal(closed.receipt.candidate.merge_commit, null);
});

test('missing terminal receipts and invalid readbacks fail closed without replay or reopen', () => {
  const missing = kernel.reconcileTerminalReceipt({
    object: { kind: 'pull_request', repository, number: 422, terminal_state: 'MERGED' },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'TERMINAL_RECEIPT_INCOMPLETE');
  assert.equal(missing.replay_allowed, false);
  assert.equal(missing.reopen_allowed, false);

  const created = kernel.createTerminalReceipt({
    object: { kind: 'pull_request', repository, number: 422, terminal_state: 'MERGED' },
    candidate: { head: '3'.repeat(40), base: '4'.repeat(40), tree: '5'.repeat(40), merge_commit: '6'.repeat(40) },
    authority: authority('pr'),
    evidence: evidence('pr'),
    readback: readback('pr', 422),
    receipt_id: 'receipt-pr-ambiguous-422',
    created_at: createdAt,
  });
  assert.equal(created.ok, true, created.code);
  const ambiguous = kernel.reconcileTerminalReceipt({
    object: { kind: 'pull_request', repository, number: 422, terminal_state: 'MERGED' },
    receipt: created.receipt,
    observed_readback: observedReceipt(created.receipt),
    transport_ambiguous: true,
  });
  assert.equal(ambiguous.ok, true, ambiguous.code);
  assert.equal(ambiguous.code, 'TERMINAL_RECEIPT_AMBIGUOUS_OUTCOME_RECONCILED');
  assert.equal(ambiguous.replay_allowed, false);
  assert.equal(ambiguous.reopen_allowed, false);

  const tampered = structuredClone(created.receipt);
  tampered.terminal_disposition.summary = 'tampered';
  assert.equal(kernel.validateTerminalReceipt(tampered).code, 'TERMINAL_RECEIPT_DIGEST_MISMATCH');
});
