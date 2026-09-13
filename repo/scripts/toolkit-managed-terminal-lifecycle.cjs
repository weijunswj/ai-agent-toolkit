#!/usr/bin/env node
'use strict';

const STATES = Object.freeze([
  'TERMINAL_DECISION',
  'DURABLE_DISPOSITION_OR_SUCCESSOR_RECEIPT',
  'CLOSE',
  'CLOSURE_READBACK',
  'DELETE_ELIGIBILITY_CHECK',
  'EXPECTED_REF_SHA_RECHECK',
  'SAFE_MANAGED_BRANCH_DELETE',
  'ABSENCE_READBACK',
  'TERMINAL_RECEIPT'
]);
const RETAINED_ISSUES = new Set([385, 387, 388, 389, 390, 391, 392, 393, 394, 395, 396, 397]);

class TerminalLifecycleError extends Error {
  constructor(code, evidence = {}) {
    super(code);
    this.name = 'TerminalLifecycleError';
    this.code = code;
    this.evidence = evidence;
  }
}

function fail(code, evidence = {}) {
  throw new TerminalLifecycleError(code, evidence);
}

function safeBranch(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('..') && /^[A-Za-z0-9._:/-]+$/.test(value);
}

function bool(value) {
  return value === true;
}

function invoke(options, name, fallback) {
  if (typeof options[name] !== 'function') return fallback;
  let result;
  try { result = options[name](); } catch (_error) { fail(`${name.toUpperCase()}_FAILED`); }
  if (result && typeof result.then === 'function') fail('ASYNC_LIFECYCLE_UNSUPPORTED');
  return result === undefined ? true : result;
}

function createInitialState(options = {}) {
  return {
    contract_version: 'toolkit.github-program-reconciler.managed-terminal-lifecycle.v1',
    state: 'TERMINAL_DECISION',
    terminal_decision: bool(options.terminal_decision),
    durable_disposition: bool(options.durable_disposition),
    closed: bool(options.closed),
    closure_readback: bool(options.closure_readback),
    delete_eligible: false,
    absence_readback: false,
    terminal_receipt: false,
    branch: safeBranch(options.branch) ? options.branch : null,
    reason_code: null
  };
}

function validateState(state) {
  if (!state || state.contract_version !== 'toolkit.github-program-reconciler.managed-terminal-lifecycle.v1' || !STATES.includes(state.state)) fail('LIFECYCLE_STATE_INVALID');
  return state;
}

function runManagedTerminalLifecycle(options = {}) {
  if (options.branch !== undefined && !safeBranch(options.branch)) fail('LIFECYCLE_BRANCH_INVALID');
  const state = { ...createInitialState(options), ...(options.state || {}) };
  validateState(state);
  const issueNumber = Number.isInteger(options.issue_number) ? options.issue_number : null;
  const retained = options.retained === true || (issueNumber !== null && RETAINED_ISSUES.has(issueNumber));
  if (state.state === 'TERMINAL_RECEIPT' && state.terminal_receipt === true) {
    return Object.freeze({ ...state, retained, issue_number: issueNumber });
  }
  if (!state.terminal_decision) {
    const result = invoke(options, 'recordTerminalDecision', options.terminal_decision === true);
    if (result !== true) fail('TERMINAL_DECISION_REQUIRED');
    state.terminal_decision = true;
  }
  state.state = 'DURABLE_DISPOSITION_OR_SUCCESSOR_RECEIPT';
  if (!state.durable_disposition) {
    const result = invoke(options, 'recordDurableDisposition', options.durable_disposition === true);
    if (result !== true) fail('DURABLE_DISPOSITION_REQUIRED');
    state.durable_disposition = true;
  }
  state.state = 'CLOSE';
  if (!state.closed) {
    const result = invoke(options, 'close', options.closed === true);
    if (result !== true) fail('CLOSE_FAILED');
    state.closed = true;
  }
  state.state = 'CLOSURE_READBACK';
  if (!state.closure_readback) {
    const result = invoke(options, 'readClosure', options.closure_readback === true);
    if (result !== true) fail('CLOSURE_READBACK_FAILED');
    state.closure_readback = true;
  }
  state.state = 'DELETE_ELIGIBILITY_CHECK';
  const managed = options.managed_branch === true;
  state.delete_eligible = managed && !retained && options.delete_eligible !== false;
  if (!state.delete_eligible) state.reason_code = retained ? 'RETAINED_BRANCH' : (managed ? 'DELETE_NOT_ELIGIBLE' : 'NOT_MANAGED_BRANCH');
  state.state = 'EXPECTED_REF_SHA_RECHECK';
  if (state.delete_eligible) {
    const result = invoke(options, 'recheckExpectedRefSha', options.expected_ref_sha_verified === true);
    if (result !== true) {
      state.delete_eligible = false;
      state.reason_code = 'EXPECTED_REF_SHA_CHANGED_OR_UNVERIFIED';
    }
  }
  state.state = 'SAFE_MANAGED_BRANCH_DELETE';
  if (state.delete_eligible) {
    const result = invoke(options, 'deleteBranch', false);
    if (result !== true) fail('SAFE_BRANCH_DELETE_FAILED');
  }
  state.state = 'ABSENCE_READBACK';
  if (!state.absence_readback) {
    const result = invoke(options, 'readAbsence', state.delete_eligible ? false : true);
    if (result !== true) fail('ABSENCE_READBACK_FAILED');
    state.absence_readback = true;
  }
  state.state = 'TERMINAL_RECEIPT';
  state.terminal_receipt = true;
  return Object.freeze({ ...state, retained, issue_number: issueNumber });
}

function recoverManagedTerminalLifecycle(options = {}) {
  return runManagedTerminalLifecycle(options);
}

module.exports = Object.freeze({
  STATES,
  RETAINED_ISSUES,
  TerminalLifecycleError,
  runManagedTerminalLifecycle,
  recoverManagedTerminalLifecycle,
  validateState
});
