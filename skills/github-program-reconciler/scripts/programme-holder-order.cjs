'use strict';

// Holder orders: how a controller that cannot run commands itself (a Projects controller has no
// shell) still makes its own programme writes. The controller writes the order: the exact writes,
// for the parent it holds now, until a near expiry. A session it hands the order to runs it with
// `programme.cjs run-order`, and only those writes run, each as the holder, one at a time. The
// parent's private part logs every order: its id, digest, the running session's hash and what each
// write did, so a re-run continues where the last run stopped and never repeats a finished write.
//
// An order carries no authority of its own beyond the controller's word, as the holder session
// string does today; it narrows that word to named writes, a time limit and a trail. It never
// claims, takes over, creates the parent or moves the state.
const crypto = require('node:crypto');
const { ProgrammeError, ATTENTION_NOTE_LIMIT, DUE_TIME } = require('./programme-state.cjs');

const SCHEMA = 'toolkit.programme-holder-order.v1';
const MAX_OPS = 60;
const MAX_HOURS = 24;
const LOG_LIMIT = 50;
const PREFIX_FLAG = 'prefix';
// The writes an order may carry, each with its required and optional fields. Never: claim, a
// takeover, init-parent, migrate-state; refresh needs no order, anyone runs it.
const OPS = Object.freeze({
  ack: { required: ['finding', 'next'], optional: ['due'] },
  dispose: { required: ['finding', 'reason'], optional: [] },
  update: { required: ['issue', 'patch'], optional: [] },
  'update-parent': { required: ['patch'], optional: [] },
  reopen: { required: ['issue', 'reason'], optional: ['assignment'] },
  interrupt: { required: ['issue', 'reason'], optional: [] },
  assign: { required: ['issue', 'role', 'assignment'], optional: ['supersede', 'reason'] },
  return: { required: ['issue'], optional: ['record', 'assignment', 'at-head', 'consume', 'verdict'] },
});
const KEYS = ['schema', 'order_id', 'parent_issue', 'holder_session', 'epoch', 'expires_at', 'record', 'ops'];

const refuse = message => new ProgrammeError('ORDER_INVALID', `The holder order is invalid: ${message}. Nothing was written; ask the controller for a corrected order.`);
const text = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function orderDigest(order) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(order))).digest('hex');
}

// Checks one write: a known command, exactly its fields, and values the command line would accept.
function checkOp(op, at) {
  if (!op || typeof op !== 'object' || Array.isArray(op)) throw refuse(`write ${at + 1} is not an object`);
  const shape = OPS[op.command];
  if (!shape) throw refuse(`write ${at + 1} is ${JSON.stringify(op.command)}; an order carries only ${Object.keys(OPS).join(', ')}`);
  const fields = Object.keys(op).filter(key => key !== 'command');
  const unknown = fields.filter(key => !shape.required.includes(key) && !shape.optional.includes(key));
  if (unknown.length) throw refuse(`write ${at + 1} (${op.command}) has unknown field ${unknown[0]}`);
  const missing = shape.required.filter(key => op[key] === undefined);
  if (missing.length) throw refuse(`write ${at + 1} (${op.command}) needs ${missing.join(', ')}`);
  if (op.issue !== undefined && !(Number.isSafeInteger(op.issue) && op.issue > 0)) throw refuse(`write ${at + 1} needs a whole issue number`);
  if (op.finding !== undefined && !/^[0-9a-f]{12}$/.test(String(op.finding))) throw refuse(`write ${at + 1} needs the 12-character finding id`);
  if (op.patch !== undefined && (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch))) throw refuse(`write ${at + 1} needs its patch as a JSON object`);
  if (op.supersede !== undefined && typeof op.supersede !== 'boolean') throw refuse(`write ${at + 1} needs supersede as true or false`);
  for (const key of ['reason', 'assignment', 'role', 'record', 'consume', 'verdict', 'at-head', 'next', 'due']) {
    if (op[key] !== undefined && !text(op[key], 500)) throw refuse(`write ${at + 1} needs ${key} as non-empty text`);
  }
  // The finding's own limits, so an order is refused whole before a run stops on one write.
  for (const key of ['next', 'reason']) {
    if (['ack', 'dispose'].includes(op.command) && op[key] !== undefined && op[key].length > ATTENTION_NOTE_LIMIT) throw refuse(`write ${at + 1} (${op.command}) needs ${key} of at most ${ATTENTION_NOTE_LIMIT} characters`);
  }
  if (op.due !== undefined && !DUE_TIME.test(op.due)) throw refuse(`write ${at + 1} (ack) needs due as an ISO 8601 date and time with Z or an offset`);
  if (op.command === 'return' && Boolean(op.record) === Boolean(op.consume)) throw refuse(`write ${at + 1} (return) needs exactly one of record or consume`);
  if (op.command === 'return' && op.consume && !op.verdict) throw refuse(`write ${at + 1} (return consume) needs a verdict`);
  return op;
}

// The order itself, against the clock. Fence checks against the parent come later, at run time.
function validateOrder(order, { nowMs = Date.now } = {}) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) throw refuse('it must be a JSON object');
  const keys = Object.keys(order);
  const unknown = keys.filter(key => !KEYS.includes(key));
  if (unknown.length) throw refuse(`unknown field ${unknown[0]}`);
  const missing = KEYS.filter(key => order[key] === undefined);
  if (missing.length) throw refuse(`it needs ${missing.join(', ')}`);
  if (order.schema !== SCHEMA) throw refuse(`its schema must be ${SCHEMA}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(String(order.order_id))) throw refuse('order_id must be 3 to 80 letters, digits, dots, dashes or underscores');
  if (!(Number.isSafeInteger(order.parent_issue) && order.parent_issue > 0)) throw refuse('parent_issue must be the parent issue number');
  if (!text(order.holder_session, 200)) throw refuse('holder_session must name the session that holds the parent');
  if (!(Number.isSafeInteger(order.epoch) && order.epoch > 0)) throw refuse('epoch must be the parent\'s current epoch');
  if (!text(order.record, 300)) throw refuse('record must name the brief or decision record that issued it');
  const expires = Date.parse(order.expires_at);
  if (!Number.isFinite(expires)) throw refuse('expires_at must be a date and time');
  if (expires <= nowMs()) throw new ProgrammeError('ORDER_EXPIRED', `The holder order ${order.order_id} expired at ${order.expires_at}. Nothing was written; ask the controller for a fresh one.`);
  if (expires > nowMs() + MAX_HOURS * 3600 * 1000) throw refuse(`expires_at must be within ${MAX_HOURS} hours`);
  if (!Array.isArray(order.ops) || order.ops.length === 0 || order.ops.length > MAX_OPS) throw refuse(`ops must list 1 to ${MAX_OPS} writes`);
  order.ops.forEach(checkOp);
  return order;
}

// The order must be for this parent and its holder now: an order written before a takeover or for
// another programme runs nothing.
function checkFence(order, parentDoc, writerPrefix) {
  if (order.parent_issue !== parentDoc.parent_issue) throw new ProgrammeError('ORDER_INVALID', `The holder order is for #${order.parent_issue}, but this programme's parent is #${parentDoc.parent_issue}. Nothing was written.`);
  const fence = parentDoc.fence || {};
  if (fence.holder_prefix !== writerPrefix || fence.holder_session !== order.holder_session || fence.epoch !== order.epoch) {
    throw new ProgrammeError('ORDER_STALE', `The holder order ${order.order_id} names the holder at epoch ${order.epoch}, but the parent is at epoch ${fence.epoch ?? 'none'}${fence.holder_session === order.holder_session ? '' : ' under another holder'}. Nothing was written; ask the controller for a fresh order.`);
  }
}

// The order's log entry in the parent's private part, or null.
function logEntry(parentDoc, orderId) {
  const log = Array.isArray(parentDoc?.private?.holder_orders) ? parentDoc.private.holder_orders : [];
  return log.find(entry => entry?.order_id === orderId) || null;
}

// The parent document with this order's entry replaced, keeping the newest LOG_LIMIT orders.
function withLog(doc, entry) {
  const log = (Array.isArray(doc.private?.holder_orders) ? doc.private.holder_orders : []).filter(item => item?.order_id !== entry.order_id);
  return { ...doc, private: { ...doc.private, holder_orders: [...log, entry].slice(-LOG_LIMIT) } };
}

// The command line arguments one write runs with, as the holder.
function opArgs(op, holderSession, prefix) {
  const args = { command: op.command, controller: true, session: holderSession, json: true, [PREFIX_FLAG]: prefix };
  for (const [key, value] of Object.entries(op)) {
    if (key === 'command') continue;
    if (key === 'patch') args.patchValue = value;
    else args[key] = value;
  }
  return args;
}

module.exports = { SCHEMA, OPS, MAX_OPS, MAX_HOURS, LOG_LIMIT, orderDigest, validateOrder, checkFence, logEntry, withLog, opArgs };
