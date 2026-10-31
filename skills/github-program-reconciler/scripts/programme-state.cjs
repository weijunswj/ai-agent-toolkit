'use strict';

// Programme state documents and the GitHub reconciler.
//
// One private JSON document per programme child (`issue-<n>.json`) plus one for the parent
// (`parent-<n>.json`) live in a private store repository and are written through the GitHub
// Contents API with compare-and-swap on the blob sha. The reconciler reads those documents and the
// live GitHub state (issues, native parent/sub-issue links, dependency edges, PR heads and checks),
// reports typed findings, plans effects and, only when asked to apply, runs each effect as
// intent -> mutation -> readback -> resolution. It never closes, deletes or merges anything; the controller closes.
//
// GitHub facts these owners rely on, checked against the REST docs and a private sandbox on
// 2026-10-23:
// - `sub_issue_id` is the issue's database `id`; sending its number returns 404.
// - Adding a sub-issue that already has a parent returns 422 unless `replace_parent` is true; adding
//   it twice to the same parent also returns 422. The issue object carries `parent_issue_url`.
// - Reordering needs exactly one of `after_id`/`before_id` (422 otherwise).
// - Contents PUT with a stale `sha` returns 409; a create over an existing file without `sha` returns
//   422. A PUT of identical content still makes a new commit, so unchanged state must not be written.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DEFAULT_THRESHOLD, INDEX_COMMENT_MARKER, auditDecisionTraces, traceEntries, commentLink, issueUrl } = require('./decision-trace-audit.cjs');
const { OTHER_COMMENTS } = require('./decision-tags.cjs');
const { ProgrammeError, resolveExecutable } = require('./resolve-executable.cjs');

const SCHEMA = Object.freeze({
  binding: 'toolkit.programme-binding.v1',
  bindingV2: 'toolkit.programme-binding.v2',
  parent: 'toolkit.programme-state.parent.v1',
  child: 'toolkit.programme-state.child.v1',
  journal: 'toolkit.programme-journal.v1',
});
const BINDING_FILE = path.join('.github', 'toolkit-programme.json');
const SHA40 = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PREFIX = /^[A-Za-z0-9._-]{1,40}$/;
const CLASSES = ['COMMITTED', 'OPTIONAL', 'COMPLETED', 'RETIRED'];
// Classes from before Now and Later, read as COMMITTED and sorted like any other task (the graph
// sorts by group, then `order`, the priority, then child number). Each pass reports CLASS_LEGACY
// with a patch that migrates them in one step, renumbering `order` in the old CORE, HARDENING,
// LATER sequence; a write never adds one. Remove these once no parent document carries them.
const LEGACY_CLASSES = ['CORE', 'HARDENING', 'LATER'];
const LEGACY_RANK = Object.freeze({ CORE: 0, HARDENING: 1 });
const legacyRank = outcome => LEGACY_RANK[outcome.class] ?? 2;
const LIFECYCLES = ['PLANNED', 'ACTIVE', 'WAITING_OWNER', 'HOLD', 'DONE', 'RETIRED'];
const GATE_ROLES = ['G0', 'G1', 'G2'];
const GATE_STATES = ['ASSIGNED', 'ACTIVE', 'WAITING_OWNER', 'INTERRUPTED', 'SUBMITTED', 'RETIRED'];
// A live assignment: its bound session may journal and the controller reads that journal.
const LIVE_GATE_STATES = ['ASSIGNED', 'ACTIVE', 'SUBMITTED', 'WAITING_OWNER'];
const VERDICTS = ['ACCEPT', 'REOPEN', 'WAITING_OWNER'];
const RETURN_MODES = ['native', 'toolkit_assisted'];
const REQUESTED_VERDICTS = ['ACCEPT', 'WAITING_OWNER'];
const ASSIGNMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
const RETURN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SESSION_HASH = /^[0-9a-f]{16}$/;
const JOURNAL_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,59})--([0-9a-f]{16})\.json$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const JOURNAL_TEXT_LIMIT = 500;
const JOURNAL_RETURNS_LIMIT = 20;
const PR_STATES = ['OPEN', 'DRAFT', 'MERGED', 'CLOSED'];
const CHECK_STATES = ['GREEN', 'PENDING', 'RED', 'UNKNOWN'];
const UAT_STATES = ['NOT_REQUIRED', 'PENDING', 'PASSED', 'UAT_RETAINED', 'UAT_PARTIAL_REQUIRED', 'UAT_FULL_REQUIRED'];
const REVIEW_STATES = ['NOT_STARTED', 'IN_REVIEW', 'PASSED', 'NOT_PASSED'];
const REVIEW_VERDICTS = ['PASSED', 'NOT_PASSED'];
const EFFECT_KINDS = ['attach', 'reparent', 'reorder', 'replace_block', 'post_index_comment', 'replace_pr_nav'];
const EFFECT_STATES = ['IN_FLIGHT', 'DONE', 'UNKNOWN'];
// Fields that never count towards a document's content digest or revision: the revision itself,
// observation timestamps, pending effects (an intent write must not make the rendered state stale),
// the journal blobs the controller has read and the parent's attention findings. sameState still
// compares the last two, so a real change is written without a revision bump.
const UNHASHED = ['revision', 'volatile', 'pending_effects', 'journals_seen', 'attention'];
// Child fields `update` may change. UAT, review and a terminal lifecycle (DONE, RETIRED) are
// acceptance records: only the parent's holder (the controller) writes them.
const PATCHABLE_CHILD_FIELDS = ['lifecycle', 'completed_at', 'release', 'candidate', 'uat', 'review', 'blockers', 'next_action', 'private'];
const CONTROLLER_CHILD_FIELDS = ['uat', 'review'];
const TERMINAL_LIFECYCLES = ['DONE', 'RETIRED'];
// UAT states that speak for one head, and review states that need verdicts at a head.
const HEAD_BOUND_UAT = ['PASSED', 'UAT_RETAINED', 'UAT_PARTIAL_REQUIRED'];
const DECIDED_REVIEW = ['PASSED', 'NOT_PASSED'];
// UAT must be settled on record: an unrecorded UAT never counts as not required.
const CLOSABLE_UAT = ['NOT_REQUIRED', 'PASSED', 'UAT_RETAINED'];
const PATCHABLE_PARENT_FIELDS = ['outcomes', 'release_plan', 'private'];
const BLOCK_SOURCE = 'programme-state';
const BLOCK_NAME = 'STATE';
const TRACE_BLOCK_NAME = 'TRACE';
const NAV_BLOCK_NAME = 'NAV';
const CURRENT_BLOCK_NAME = 'CURRENT';
// Index comments are cut below this size (GitHub's comment limit is 65,536 characters).
const INDEX_COMMENT_LIMIT = 60000;
const TEXT_LIMIT = 200;

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------
// Canonical JSON, digests and validation (pure)

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function canonicalText(doc) {
  return `${JSON.stringify(canonical(doc), null, 2)}\n`;
}

function contentDigest(doc) {
  const copy = { ...doc };
  for (const key of UNHASHED) delete copy[key];
  return sha256(JSON.stringify(canonical(copy)));
}

// The same state: equal content, equal pending effects and equal journals read. Volatile timestamps
// never matter.
function sameState(previous, next) {
  return contentDigest(previous) === contentDigest(next)
    && JSON.stringify(canonical(previous.pending_effects || [])) === JSON.stringify(canonical(next.pending_effects || []))
    && JSON.stringify(canonical(previous.journals_seen || {})) === JSON.stringify(canonical(next.journals_seen || {}))
    && JSON.stringify(canonical(previous.attention || [])) === JSON.stringify(canonical(next.attention || []));
}

function check(errors, condition, message) { if (!condition) errors.push(message); }

// Fields each object may and must hold, as the schemas' additionalProperties: false and required.
const SHAPES = {
  child: { all: ['schema', 'repository', 'issue', 'revision', 'fence', 'lifecycle', 'completed_at', 'release', 'gate', 'candidate', 'pr', 'uat', 'review', 'blockers', 'next_action', 'pending_effects', 'journals_seen', 'private', 'volatile'], optional: ['volatile', 'journals_seen', 'completed_at'] },
  parent: { all: ['schema', 'repository', 'parent_issue', 'revision', 'fence', 'release_plan', 'outcomes', 'pending_effects', 'attention', 'private', 'volatile'], optional: ['volatile', 'attention'] },
  finding: { all: ['id', 'source', 'code', 'issue', 'head', 'state', 'first_seen', 'changed_at'] },
  fence: { all: ['epoch', 'holder_prefix', 'holder_session'] },
  effect: { all: ['intent_id', 'kind', 'target', 'state'] },
  outcome: { all: ['issue', 'label', 'name', 'description', 'class', 'parent', 'order', 'lane', 'owner_prefix'], optional: ['label', 'name', 'description', 'lane', 'owner_prefix'] },
  release_plan: { all: ['record', 'comment_id'], optional: ['record', 'comment_id'] },
  gate: { all: ['role', 'state', 'session_id', 'assignment', 'route', 'returns'], optional: ['assignment'] },
  assignment: { all: ['id', 'role'] },
  route: { all: ['model', 'effort', 'read_back'], optional: ['model', 'effort', 'read_back'] },
  return: { all: ['return_id', 'verdict', 'consumed', 'epoch', 'assignment', 'at_head', 'mode'], optional: ['assignment', 'at_head', 'mode'] },
  journal: { all: ['schema', 'repository', 'issue', 'assignment', 'session_hash', 'completion_mode', 'route', 'seq', 'checkpoint', 'returns', 'last_error', 'volatile'], optional: ['volatile'] },
  journal_route: { all: ['model', 'effort', 'read_back'] },
  checkpoint: { all: ['branch', 'head', 'tree', 'dirty', 'ahead', 'behind'] },
  journal_return: { all: ['return_id', 'verdict_requested', 'at_head', 'next_action', 'blockers'] },
  journal_error: { all: ['code', 'at'] },
  candidate: { all: ['branch', 'head', 'tree', 'base'] },
  pr: { all: ['number', 'state', 'head', 'checks'] },
  checks: { all: ['state', 'required_total', 'required_passed', 'at_head'] },
  uat: { all: ['state', 'at_head'] },
  review: { all: ['state', 'verdicts'] },
  verdict: { all: ['reviewer', 'head', 'verdict'] },
};

function checkShape(errors, value, shape, at) {
  if (!isObject(value)) return;
  const { all, optional: notRequired = [] } = typeof shape === 'string' ? SHAPES[shape] : shape;
  const unknown = Object.keys(value).filter(key => !all.includes(key));
  if (unknown.length) errors.push(`${at} has unknown field(s): ${unknown.join(', ')}`);
  const missing = all.filter(key => !notRequired.includes(key) && !Object.hasOwn(value, key));
  if (missing.length) errors.push(`${at} is missing ${missing.join(', ')}`);
}

// Secret-shaped values are refused anywhere in a state document or binding: `private` lives in git
// history in the store, and public fields render into issue bodies. The message never repeats a value.
const SECRET_SHAPES = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['API key', /\b(?:sk|rk)-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i],
];

function screenSecrets(errors, value, at) {
  if (typeof value === 'string') {
    const found = SECRET_SHAPES.find(([, pattern]) => pattern.test(value));
    if (found) errors.push(`${at} looks like a ${found[0]}; state documents and bindings never hold secrets`);
  } else if (Array.isArray(value)) value.forEach((entry, index) => screenSecrets(errors, entry, `${at}[${index}]`));
  else if (isObject(value)) for (const [key, entry] of Object.entries(value)) { screenSecrets(errors, key, `${at} key`); screenSecrets(errors, entry, `${at}.${key}`); }
}
const optional = (value, test) => value === null || value === undefined || test(value);
const isInt = (value, min = 0) => Number.isInteger(value) && value >= min;
const isText = value => typeof value === 'string' && value.length > 0;
const isSha = value => typeof value === 'string' && SHA40.test(value);

function validateFence(errors, fence) {
  check(errors, isObject(fence), 'fence must be an object');
  if (!isObject(fence)) return;
  checkShape(errors, fence, 'fence', 'fence');
  check(errors, isInt(fence.epoch), 'fence.epoch must be a whole number');
  check(errors, optional(fence.holder_prefix, value => PREFIX.test(value)), 'fence.holder_prefix must be a record prefix or null');
  check(errors, optional(fence.holder_session, isText), 'fence.holder_session must be text or null');
}

function validateEffects(errors, effects) {
  check(errors, Array.isArray(effects), 'pending_effects must be a list');
  for (const [index, effect] of (Array.isArray(effects) ? effects : []).entries()) {
    check(errors, isObject(effect) && isText(effect.intent_id), `pending_effects[${index}].intent_id is required`);
    checkShape(errors, effect, 'effect', `pending_effects[${index}]`);
    check(errors, EFFECT_KINDS.includes(effect?.kind), `pending_effects[${index}].kind is not a known effect`);
    check(errors, isObject(effect?.target), `pending_effects[${index}].target must be an object`);
    check(errors, EFFECT_STATES.includes(effect?.state), `pending_effects[${index}].state must be IN_FLIGHT, DONE or UNKNOWN`);
  }
}

function validateCommon(errors, doc, schema) {
  check(errors, isObject(doc), 'document must be an object');
  if (!isObject(doc)) return false;
  checkShape(errors, doc, schema === SCHEMA.parent ? 'parent' : 'child', 'document');
  screenSecrets(errors, doc, 'document');
  check(errors, doc.schema === schema, `schema must be ${schema}`);
  check(errors, REPO.test(String(doc.repository || '')), 'repository must be owner/name');
  check(errors, isInt(doc.revision), 'revision must be a whole number');
  validateFence(errors, doc.fence);
  validateEffects(errors, doc.pending_effects);
  check(errors, isObject(doc.private), 'private must be an object');
  check(errors, optional(doc.volatile, isObject), 'volatile must be an object');
  return true;
}

function validateParent(doc) {
  const errors = [];
  if (validateCommon(errors, doc, SCHEMA.parent)) {
    check(errors, isInt(doc.parent_issue, 1), 'parent_issue must be an issue number');
    check(errors, optional(doc.release_plan, value => isObject(value)
      && optional(value.record, isText) && optional(value.comment_id, v => isInt(v, 1))), 'release_plan must hold record and comment_id');
    checkShape(errors, doc.release_plan, 'release_plan', 'release_plan');
    check(errors, Array.isArray(doc.outcomes), 'outcomes must be a list');
    const seen = new Set();
    for (const [index, outcome] of (Array.isArray(doc.outcomes) ? doc.outcomes : []).entries()) {
      const at = `outcomes[${index}]`;
      check(errors, isObject(outcome) && isInt(outcome.issue, 1), `${at}.issue must be an issue number`);
      if (!isObject(outcome)) continue;
      checkShape(errors, outcome, 'outcome', at);
      check(errors, !seen.has(outcome.issue), `${at}.issue ${outcome.issue} is listed twice`);
      seen.add(outcome.issue);
      check(errors, outcome.issue !== doc.parent_issue, `${at}.issue cannot be the parent itself`);
      check(errors, CLASSES.includes(outcome.class) || LEGACY_CLASSES.includes(outcome.class), `${at}.class must be one of ${CLASSES.join(', ')}`);
      check(errors, optional(outcome.parent, value => isInt(value, 1)), `${at}.parent must be an issue number or null`);
      check(errors, outcome.parent !== outcome.issue, `${at}.parent cannot be the outcome itself`);
      check(errors, isInt(outcome.order), `${at}.order must be a whole number`);
      check(errors, optional(outcome.label, isText), `${at}.label must be text`);
      check(errors, optional(outcome.lane, isText), `${at}.lane must be text`);
      check(errors, optional(outcome.owner_prefix, value => PREFIX.test(value)), `${at}.owner_prefix must be a record prefix`);
      check(errors, optional(outcome.name, isText), `${at}.name must be text`);
      check(errors, optional(outcome.description, isText), `${at}.description must be text`);
    }
    // Expected parents must be the programme parent or another outcome, and the tree must have no loop.
    const outcomes = new Map((Array.isArray(doc.outcomes) ? doc.outcomes : []).filter(isObject).map(entry => [entry.issue, entry]));
    for (const outcome of outcomes.values()) {
      if (outcome.parent === null || outcome.parent === undefined) continue;
      check(errors, outcome.parent === doc.parent_issue || outcomes.has(outcome.parent), `outcome ${outcome.issue}: parent ${outcome.parent} is not the programme parent or a catalogued outcome`);
      const visited = new Set([outcome.issue]);
      for (let at = outcomes.get(outcome.parent); at; at = outcomes.get(at.parent)) {
        if (visited.has(at.issue)) { errors.push(`outcome ${outcome.issue}: expected parents form a loop`); break; }
        visited.add(at.issue);
      }
    }
    validateAttention(errors, doc.attention);
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Attention findings (pure)
//
// A finding is a condition the controller must answer, kept on the primary parent document so it
// lasts beyond the run that saw it. Each code belongs to one source: a complete run of that source
// adds what it saw and resolves only its own findings that are gone. The fixed table gives each
// code its next action, so no free text is stored in a finding.

const FINDING_STATES = ['new', 'acknowledged', 'resolved', 'disposed'];
const OPEN_FINDING_STATES = ['new', 'acknowledged'];
const FINDING_ID = /^[0-9a-f]{12}$/;
// Kept: at most ATTENTION_KEEP entries, dropping the oldest resolved or disposed first. New and
// acknowledged entries are never dropped; past ATTENTION_LIMIT of them, nothing more is added and
// ATTENTION_FULL is set.
const ATTENTION_KEEP = 200;
const ATTENTION_LIMIT = 500;
// Codes whose finding speaks for one PR head; a new head is a new finding.
const HEAD_BOUND_CODES = new Set(['PR_HEAD_MOVED', 'CHECKS_RED']);
const FINDING_CODES = Object.freeze({
  // reconcile source: what the reconciler reports but never changes itself.
  ISSUE_MISSING: { source: 'reconcile', next_action: 'Controller: fix or remove the catalogue entry; the issue cannot be read or is a pull request' },
  NATIVE_PARENT_UNEXPECTED: { source: 'reconcile', next_action: 'Controller: set the expected parent in the catalogue, or move the issue natively' },
  NATIVE_CHILD_UNKNOWN: { source: 'reconcile', next_action: 'Controller: add the issue to the catalogue, or move it out from under the parent' },
  DEPENDENCY_IMPLIES_PARENT: { source: 'reconcile', next_action: 'Controller: set the native parent on purpose; a dependency never sets one' },
  PR_HEAD_MOVED: { source: 'reconcile', next_action: 'Controller: re-check review and UAT at the new head before accepting' },
  CHECKS_RED: { source: 'reconcile', next_action: 'Controller: have the builder fix the failing checks' },
  READY_TO_CLOSE: { source: 'reconcile', next_action: 'Controller: close the issue as completed if every criterion is met' },
  CHILD_STATE_CONFLICT: { source: 'reconcile', next_action: 'Controller: bring the state document and the issue in line' },
  MANAGED_BLOCK_BROKEN: { source: 'reconcile', next_action: 'Controller: repair the broken managed block in the issue body' },
  TRACE_UNLINKED: { source: 'reconcile', next_action: 'Controller: link the decision comments with decision-trace-audit --repair' },
  TRACE_SUPERSEDED_UNMARKED: { source: 'reconcile', next_action: 'Controller: mark the superseded decision record' },
  PR_UNTRACKED: { source: 'reconcile', next_action: 'Controller: confirm the PR and record it with update --patch' },
  RETURN_CAPTURED: { source: 'reconcile', next_action: 'Controller: give the waiting return its verdict' },
  STALE_ASSIGNMENT: { source: 'reconcile', next_action: 'Controller: check the late checkpoint from an ended assignment' },
  JOURNAL_ERROR: { source: 'reconcile', next_action: "Controller: check the executor's checkpoint failure" },
  JOURNAL_INVALID: { source: 'reconcile', next_action: 'Controller: check the unusable checkpoint journal' },
  CLASS_LEGACY: { source: 'reconcile', next_action: 'Controller: migrate the old classes with the patch from reconcile --json' },
  ORDER_TIE: { source: 'reconcile', next_action: 'Controller: give the tied tasks distinct priorities' },
  DUPLICATE_HIERARCHY: { source: 'reconcile', next_action: 'Controller: decide which registered parent owns the issue; nothing was moved' },
  // inventory source: open issues and registered parents.
  NEEDS_PLACEMENT: { source: 'inventory', next_action: 'Controller: place the issue under a registered parent, or mark it programme:outside' },
  CLOSED_PARENT_OPEN_CHILD: { source: 'inventory', next_action: 'Controller: reopen the parent, or move or close its open descendants' },
  INVENTORY_INCOMPLETE: { source: 'inventory', next_action: 'Controller: run programme.cjs attention --refresh again; this run could not read every open issue' },
  ATTENTION_FULL: { source: 'inventory', next_action: 'Controller: answer or dispose open findings; no new finding is recorded until there are fewer than 500' },
});
// Findings with no issue of their own.
const ISSUELESS_CODES = new Set(['INVENTORY_INCOMPLETE', 'ATTENTION_FULL']);
const ATTENTION_NOTE_LIMIT = 200;

function findingId(source, code, issue, head = '') {
  return sha256(`${source}|${code}|${issue ?? ''}|${head || ''}`).slice(0, 12);
}

function validateAttention(errors, attention) {
  if (attention === undefined) return;
  check(errors, Array.isArray(attention) && attention.length <= ATTENTION_LIMIT + ATTENTION_KEEP, `attention must be a list of at most ${ATTENTION_LIMIT + ATTENTION_KEEP}`);
  const ids = new Set();
  for (const [index, entry] of (Array.isArray(attention) ? attention : []).entries()) {
    const at = `attention[${index}]`;
    check(errors, isObject(entry), `${at} must be an object`);
    if (!isObject(entry)) continue;
    checkShape(errors, entry, 'finding', at);
    const known = Object.hasOwn(FINDING_CODES, entry.code) ? FINDING_CODES[entry.code] : null;
    check(errors, Boolean(known), `${at}.code is not a known finding code`);
    check(errors, Boolean(known) && entry.source === known.source, `${at}.source must be the code's source`);
    check(errors, ISSUELESS_CODES.has(entry.code) ? entry.issue === null : isInt(entry.issue, 1), `${at}.issue must be an issue number${ISSUELESS_CODES.has(entry.code) ? ' or null' : ''}`);
    check(errors, HEAD_BOUND_CODES.has(entry.code) ? optional(entry.head, isSha) : entry.head === null, `${at}.head must be a full 40-character SHA for a head-bound code, otherwise null`);
    check(errors, FINDING_STATES.includes(entry.state), `${at}.state must be ${FINDING_STATES.join(', ')}`);
    for (const field of ['first_seen', 'changed_at']) check(errors, isText(entry[field]) && !Number.isNaN(Date.parse(entry[field])), `${at}.${field} must be a date and time`);
    check(errors, FINDING_ID.test(String(entry.id)) && entry.id === findingId(entry.source, entry.code, entry.issue, entry.head), `${at}.id must be the finding's own id`);
    check(errors, !ids.has(entry.id), `${at}.id is repeated`);
    ids.add(entry.id);
  }
}

// Codes the reconciler reports once, on the pass that first reads a journal; the next pass no longer
// sees them although nobody acted. The reconcile pass keeps such a finding open (`hold`) until it is
// answered or its condition is really gone (see Reconciler.oneTimeHolds).
const ONE_TIME_CODES = new Set(['RETURN_CAPTURED', 'JOURNAL_ERROR', 'JOURNAL_INVALID', 'STALE_ASSIGNMENT']);

// What a run saw, as findings: [{ code, issue, head? }]. Returns the next attention list, or the same
// list (===) when nothing changes, so an unchanged run writes nothing. A run that was not complete
// adds what it saw (an incomplete inventory sees only INVENTORY_INCOMPLETE) and resolves nothing.
// `hold` lists ids that stay open on this run although it did not see them.
function foldAttention(current, { source, seen = [], complete, now, hold = [] }) {
  const list = Array.isArray(current) ? current.map(entry => ({ ...entry })) : [];
  const byId = new Map(list.map(entry => [entry.id, entry]));
  const seenIds = new Set();
  let changed = false;
  const open = () => list.filter(entry => OPEN_FINDING_STATES.includes(entry.state)).length;
  const add = (code, issue, head, since = null) => {
    const id = findingId(FINDING_CODES[code].source, code, issue, head);
    seenIds.add(id);
    const existing = byId.get(id);
    if (existing) {
      // A resolved finding that comes back is new again. A one-time code is a fresh event each time it
      // is reported, so it also reopens an answered entry. A report that carries the time of what it
      // reports (a journal's error) reopens nothing when that is no later than the entry's last change:
      // a journal that still shows an old error is not a new one, whether the entry was answered or
      // has resolved since.
      const fresh = !since || Number.isNaN(Date.parse(since)) || Date.parse(since) > Date.parse(existing.changed_at);
      const reopens = fresh && (existing.state === 'resolved' || (ONE_TIME_CODES.has(code) && ['acknowledged', 'disposed'].includes(existing.state)));
      if (reopens) { existing.state = 'new'; existing.changed_at = now; changed = true; }
      return;
    }
    if (code !== 'ATTENTION_FULL' && open() >= ATTENTION_LIMIT) { add('ATTENTION_FULL', null, null); return; }
    const entry = { id, source: FINDING_CODES[code].source, code, issue, head, state: 'new', first_seen: now, changed_at: now };
    list.push(entry);
    byId.set(id, entry);
    changed = true;
  };
  for (const finding of seen) {
    if (!Object.hasOwn(FINDING_CODES, finding.code) || FINDING_CODES[finding.code].source !== source) continue;
    const issue = ISSUELESS_CODES.has(finding.code) ? null : finding.issue;
    if (!ISSUELESS_CODES.has(finding.code) && !isInt(issue, 1)) continue;
    add(finding.code, issue, HEAD_BOUND_CODES.has(finding.code) && isSha(finding.head) ? finding.head : null, typeof finding.since === 'string' ? finding.since : null);
  }
  for (const entry of complete ? list : []) {
    // ATTENTION_FULL resolves on any complete run back under the bound.
    const own = entry.source === source || entry.code === 'ATTENTION_FULL';
    if (!own || seenIds.has(entry.id) || hold.includes(entry.id) || !OPEN_FINDING_STATES.includes(entry.state)) continue;
    if (entry.code === 'ATTENTION_FULL' && open() - 1 >= ATTENTION_LIMIT) continue;
    entry.state = 'resolved';
    entry.changed_at = now;
    changed = true;
  }
  if (!changed) return current || [];
  return boundAttention(list);
}

// Keeps at most ATTENTION_KEEP entries by dropping the oldest resolved or disposed ones first.
function boundAttention(list) {
  const closed = list.filter(entry => !OPEN_FINDING_STATES.includes(entry.state))
    .sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at) || a.id.localeCompare(b.id));
  const drop = new Set(closed.slice(0, Math.max(0, list.length - ATTENTION_KEEP)).map(entry => entry.id));
  return list.filter(entry => !drop.has(entry.id));
}

// The holder's answer to one finding: acknowledged (still listed) or disposed, with its reason kept
// only in `private.attention_notes`.
function answerFinding(doc, { id, state, reason = null, now }) {
  if (!['acknowledged', 'disposed'].includes(state)) throw new ProgrammeError('USAGE', 'A finding is acknowledged or disposed.');
  const entry = (doc.attention || []).find(item => item.id === id);
  if (!entry) throw new ProgrammeError('FINDING_UNKNOWN', `No finding ${id} on the parent document. Run programme.cjs attention to list them.`);
  if (state === 'disposed' && (!isText(reason) || reason.length > ATTENTION_NOTE_LIMIT)) {
    throw new ProgrammeError('USAGE', `dispose needs --reason <text> of at most ${ATTENTION_NOTE_LIMIT} characters.`);
  }
  if (entry.state === state || (state === 'acknowledged' && entry.state !== 'new')) {
    if (entry.state === state) return null;
    throw new ProgrammeError('FINDING_STATE', `Finding ${id} is ${entry.state}; only a new finding is acknowledged.`);
  }
  const next = clone(doc);
  const target = next.attention.find(item => item.id === id);
  target.state = state;
  target.changed_at = now;
  if (state === 'disposed') next.private = { ...next.private, attention_notes: { ...(next.private.attention_notes || {}), [id]: reason } };
  return next;
}

function attentionCounts(attention) {
  const list = Array.isArray(attention) ? attention : [];
  return { new: list.filter(entry => entry.state === 'new').length, acknowledged: list.filter(entry => entry.state === 'acknowledged').length };
}

// `Attention: <n> new, <m> acknowledged` or `Attention: clear`.
function attentionLine(attention) {
  const counts = attentionCounts(attention);
  return counts.new || counts.acknowledged ? `Attention: ${counts.new} new, ${counts.acknowledged} acknowledged` : 'Attention: clear';
}

// Open findings, newest first.
function openFindings(attention) {
  return (Array.isArray(attention) ? attention : []).filter(entry => OPEN_FINDING_STATES.includes(entry.state))
    .sort((a, b) => Date.parse(b.changed_at) - Date.parse(a.changed_at) || a.id.localeCompare(b.id));
}

function findingText(entry) {
  return `${entry.code}${entry.issue ? ` #${entry.issue}` : ''}${entry.head ? ` at ${shortSha(entry.head)}` : ''}: ${FINDING_CODES[entry.code]?.next_action || ''}`;
}

// A digest of the open findings and their states, to tell when the set changed.
function attentionDigest(attention) {
  return sha256(openFindings(attention).map(entry => `${entry.id}:${entry.state}`).sort().join('\n')).slice(0, 16);
}

function validateChild(doc) {
  const errors = [];
  if (validateCommon(errors, doc, SCHEMA.child)) {
    check(errors, isInt(doc.issue, 1), 'issue must be an issue number');
    check(errors, LIFECYCLES.includes(doc.lifecycle), `lifecycle must be one of ${LIFECYCLES.join(', ')}`);
    check(errors, optional(doc.release, isText), 'release must be text or null');
    check(errors, optional(doc.completed_at, value => isText(value) && !Number.isNaN(Date.parse(value))), 'completed_at must be a date and time or null');
    const gate = doc.gate;
    check(errors, isObject(gate), 'gate must be an object');
    if (isObject(gate)) {
      checkShape(errors, gate, 'gate', 'gate');
      checkShape(errors, gate.route, 'route', 'gate.route');
      check(errors, optional(gate.role, value => GATE_ROLES.includes(value)), 'gate.role must be G0, G1, G2 or null');
      check(errors, optional(gate.state, value => GATE_STATES.includes(value)), `gate.state must be one of ${GATE_STATES.join(', ')} or null`);
      check(errors, optional(gate.session_id, isText), 'gate.session_id must be text or null');
      check(errors, optional(gate.assignment, value => isObject(value) && ASSIGNMENT_ID.test(String(value.id)) && GATE_ROLES.includes(value.role)),
        'gate.assignment must hold an assignment id and its role (G0, G1 or G2), or be null');
      checkShape(errors, gate.assignment, 'assignment', 'gate.assignment');
      check(errors, gate.state !== 'ASSIGNED' || isObject(gate.assignment), 'gate.state ASSIGNED needs gate.assignment');
      check(errors, optional(gate.route, value => isObject(value) && optional(value.model, isText) && optional(value.effort, isText)
        && optional(value.read_back, v => typeof v === 'boolean')), 'gate.route must hold model, effort and read_back');
      check(errors, Array.isArray(gate.returns), 'gate.returns must be a list');
      const ids = new Set();
      for (const [index, entry] of (Array.isArray(gate.returns) ? gate.returns : []).entries()) {
        check(errors, isObject(entry) && isText(entry.return_id), `gate.returns[${index}].return_id is required`);
        checkShape(errors, entry, 'return', `gate.returns[${index}]`);
        check(errors, !ids.has(entry?.return_id), `gate.returns[${index}].return_id is repeated`);
        ids.add(entry?.return_id);
        check(errors, optional(entry?.verdict, value => VERDICTS.includes(value)), `gate.returns[${index}].verdict must be ACCEPT, REOPEN, WAITING_OWNER or null`);
        check(errors, typeof entry?.consumed === 'boolean', `gate.returns[${index}].consumed must be true or false`);
        check(errors, isInt(entry?.epoch), `gate.returns[${index}].epoch must be a whole number`);
        check(errors, entry?.assignment === undefined || ASSIGNMENT_ID.test(String(entry.assignment)), `gate.returns[${index}].assignment must be an assignment id`);
        check(errors, entry?.at_head === undefined || optional(entry.at_head, isSha), `gate.returns[${index}].at_head must be a full 40-character SHA or null`);
        check(errors, entry?.mode === undefined || RETURN_MODES.includes(entry.mode), `gate.returns[${index}].mode must be native or toolkit_assisted`);
      }
    }
    const candidate = doc.candidate;
    check(errors, isObject(candidate), 'candidate must be an object');
    if (isObject(candidate)) {
      checkShape(errors, candidate, 'candidate', 'candidate');
      check(errors, optional(candidate.branch, isText), 'candidate.branch must be text or null');
      for (const field of ['head', 'tree', 'base']) check(errors, optional(candidate[field], isSha), `candidate.${field} must be a full 40-character SHA or null`);
    }
    const pr = doc.pr;
    check(errors, isObject(pr), 'pr must be an object');
    if (isObject(pr)) {
      checkShape(errors, pr, 'pr', 'pr');
      checkShape(errors, pr.checks, 'checks', 'pr.checks');
      check(errors, optional(pr.number, value => isInt(value, 1)), 'pr.number must be a PR number or null');
      check(errors, optional(pr.state, value => PR_STATES.includes(value)), 'pr.state must be OPEN, DRAFT, MERGED, CLOSED or null');
      check(errors, optional(pr.head, isSha), 'pr.head must be a full 40-character SHA or null');
      const checks = pr.checks;
      check(errors, isObject(checks) && CHECK_STATES.includes(checks.state), 'pr.checks.state must be GREEN, PENDING, RED or UNKNOWN');
      if (isObject(checks)) {
        check(errors, isInt(checks.required_total) && isInt(checks.required_passed) && checks.required_passed <= checks.required_total, 'pr.checks counts must be whole numbers, passed no more than total');
        check(errors, optional(checks.at_head, isSha), 'pr.checks.at_head must be a full 40-character SHA or null');
        check(errors, checks.state !== 'GREEN' || (checks.required_total > 0 && checks.required_passed === checks.required_total && isSha(checks.at_head)), 'pr.checks.state GREEN needs every required check passed at a known head');
      }
    }
    check(errors, isObject(doc.uat) && optional(doc.uat.state, value => UAT_STATES.includes(value)) && optional(doc.uat.at_head, isSha), `uat must hold state (${UAT_STATES.join(', ')} or null) and at_head`);
    checkShape(errors, doc.uat, 'uat', 'uat');
    check(errors, !isObject(doc.uat) || !HEAD_BOUND_UAT.includes(doc.uat.state) || isSha(doc.uat.at_head), `uat.state ${doc.uat?.state} needs at_head, the full head SHA it applies to`);
    const review = doc.review;
    check(errors, isObject(review) && optional(review.state, value => REVIEW_STATES.includes(value)) && Array.isArray(review.verdicts), 'review must hold state and verdicts');
    checkShape(errors, review, 'review', 'review');
    check(errors, !isObject(review) || !DECIDED_REVIEW.includes(review.state) || (Array.isArray(review.verdicts) && review.verdicts.length > 0), `review.state ${review?.state} needs at least one verdict with its head`);
    for (const [index, verdict] of (Array.isArray(review?.verdicts) ? review.verdicts : []).entries()) {
      checkShape(errors, verdict, 'verdict', `review.verdicts[${index}]`);
      check(errors, isObject(verdict) && isText(verdict.reviewer) && isSha(verdict.head) && REVIEW_VERDICTS.includes(verdict.verdict), `review.verdicts[${index}] needs reviewer, full head SHA and PASSED or NOT_PASSED`);
    }
    check(errors, Array.isArray(doc.blockers) && doc.blockers.every(isText), 'blockers must be a list of text');
    check(errors, isText(doc.next_action), 'next_action must be exactly one non-empty action');
    check(errors, doc.journals_seen === undefined || (isObject(doc.journals_seen)
      && Object.entries(doc.journals_seen).every(([name, blob]) => JOURNAL_FILE.test(name) && isSha(blob))), 'journals_seen must map journal file names to blob SHAs');
  }
  return errors;
}

const isOptionalText = (value, limit = JOURNAL_TEXT_LIMIT) => value === null || (isText(value) && value.length <= limit);

function validateJournal(doc) {
  const errors = [];
  check(errors, isObject(doc), 'journal must be an object');
  if (!isObject(doc)) return errors;
  checkShape(errors, doc, 'journal', 'journal');
  screenSecrets(errors, doc, 'journal');
  check(errors, doc.schema === SCHEMA.journal, `schema must be ${SCHEMA.journal}`);
  check(errors, REPO.test(String(doc.repository || '')), 'repository must be owner/name');
  check(errors, isInt(doc.issue, 1), 'issue must be an issue number');
  check(errors, ASSIGNMENT_ID.test(String(doc.assignment || '')), 'assignment must be an assignment id');
  check(errors, SESSION_HASH.test(String(doc.session_hash || '')), 'session_hash must be 16 hex characters');
  check(errors, doc.completion_mode === 'native', 'completion_mode must be native');
  check(errors, optional(doc.route, value => isObject(value) && optional(value.model, isText) && optional(value.effort, isText) && typeof value.read_back === 'boolean'), 'route must hold model, effort and read_back, or be null');
  checkShape(errors, doc.route, 'journal_route', 'route');
  check(errors, isInt(doc.seq, 1), 'seq must be a whole number from 1');
  const point = doc.checkpoint;
  check(errors, optional(point, value => isObject(value) && optional(value.branch, isText) && optional(value.head, isSha) && optional(value.tree, isSha)
    && optional(value.dirty, v => typeof v === 'boolean') && optional(value.ahead, v => isInt(v)) && optional(value.behind, v => isInt(v))), 'checkpoint must hold branch, head, tree, dirty, ahead and behind, or be null');
  checkShape(errors, point, 'checkpoint', 'checkpoint');
  check(errors, Array.isArray(doc.returns) && doc.returns.length <= JOURNAL_RETURNS_LIMIT, `returns must be a list of at most ${JOURNAL_RETURNS_LIMIT}`);
  const ids = new Set();
  for (const [index, entry] of (Array.isArray(doc.returns) ? doc.returns : []).entries()) {
    checkShape(errors, entry, 'journal_return', `returns[${index}]`);
    check(errors, isObject(entry) && RETURN_ID.test(String(entry.return_id)), `returns[${index}].return_id must be a return id`);
    check(errors, !ids.has(entry?.return_id), `returns[${index}].return_id is repeated`);
    ids.add(entry?.return_id);
    check(errors, optional(entry?.verdict_requested, value => REQUESTED_VERDICTS.includes(value)), `returns[${index}].verdict_requested must be ACCEPT, WAITING_OWNER or null`);
    check(errors, optional(entry?.at_head, isSha), `returns[${index}].at_head must be a full 40-character SHA or null`);
    check(errors, isOptionalText(entry?.next_action), `returns[${index}].next_action must be text of at most ${JOURNAL_TEXT_LIMIT} characters or null`);
    check(errors, Array.isArray(entry?.blockers) && entry.blockers.every(value => isText(value) && value.length <= JOURNAL_TEXT_LIMIT), `returns[${index}].blockers must be a list of text`);
  }
  check(errors, optional(doc.last_error, value => isObject(value) && ERROR_CODE.test(String(value.code)) && isText(value.at)), 'last_error must hold code and at, or be null');
  checkShape(errors, doc.last_error, 'journal_error', 'last_error');
  check(errors, optional(doc.volatile, isObject), 'volatile must be an object');
  return errors;
}

function assertValid(kind, doc) {
  const errors = kind === 'parent' ? validateParent(doc) : kind === 'journal' ? validateJournal(doc) : validateChild(doc);
  if (errors.length) throw new ProgrammeError('STATE_INVALID', `The ${kind} state document is invalid: ${errors[0]}`, { errors });
  return doc;
}

// A binding is v1 (one parent, always enabled) or v2 (`governance` enabled or disabled, and
// `parents` as [{ issue, record_prefix, writer_prefix? }]; children come from native sub-issues, never
// the binding). A valid enabled v2 binding is returned with the v1 fields the reconciler reads
// (parent_issue, record_prefix, writer_prefix) taken from its first parent; a disabled one carries
// only its identity and is never used for programme records.
function validateBinding(binding) {
  const errors = [];
  check(errors, isObject(binding), 'binding must be an object');
  let normalized = binding;
  if (isObject(binding)) {
    const v2 = binding.schema === SCHEMA.bindingV2;
    check(errors, binding.schema === SCHEMA.binding || v2, `schema must be ${SCHEMA.binding} or ${SCHEMA.bindingV2}`);
    check(errors, REPO.test(String(binding.repository || '')), 'repository must be owner/name');
    let enabled = true;
    if (v2) {
      const unknown = Object.keys(binding).filter(key => !BINDING_V2_KEYS.includes(key));
      check(errors, unknown.length === 0, `${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a version 2 binding key`);
      if (binding.state !== undefined) validateStateBlock(errors, binding);
      check(errors, ['enabled', 'disabled'].includes(binding.governance), 'governance must be enabled or disabled');
      enabled = binding.governance === 'enabled';
      for (const key of ['parent_issue', 'record_prefix', 'writer_prefix']) check(errors, binding[key] === undefined, `${key} belongs to v1; v2 lists parents`);
      const parents = binding.parents;
      check(errors, enabled ? Array.isArray(parents) && parents.length > 0 : parents === undefined || Array.isArray(parents), enabled ? 'parents must list at least one parent issue' : 'parents must be a list');
      if (Array.isArray(parents)) {
        parents.forEach((entry, index) => {
          check(errors, isObject(entry) && Object.keys(entry).every(key => ['issue', 'record_prefix', 'writer_prefix'].includes(key)), `parents[${index}] may hold only issue, record_prefix and writer_prefix`);
          check(errors, isObject(entry) && isInt(entry.issue, 1), `parents[${index}].issue must be an issue number`);
          check(errors, isObject(entry) && PREFIX.test(String(entry.record_prefix || '')), `parents[${index}].record_prefix must be a record prefix`);
          check(errors, isObject(entry) && (entry.writer_prefix === undefined || (typeof entry.writer_prefix === 'string' && PREFIX.test(entry.writer_prefix))), `parents[${index}].writer_prefix must be a record prefix`);
        });
        check(errors, new Set(parents.map(entry => (isObject(entry) ? entry.issue : null))).size === parents.length, 'parents must not repeat an issue');
      }
    } else {
      check(errors, binding.governance === undefined && binding.parents === undefined, 'governance and parents belong to v2');
      check(errors, isInt(binding.parent_issue, 1), 'parent_issue must be an issue number');
      check(errors, PREFIX.test(String(binding.record_prefix || '')), 'record_prefix must be a record prefix');
      check(errors, PREFIX.test(String(binding.writer_prefix || '')), 'writer_prefix must be a record prefix');
    }
    const store = binding.store;
    if (enabled || store !== undefined) {
      check(errors, isObject(store) && Object.hasOwn(STORE_BACKENDS, store.kind), `store.kind ${JSON.stringify(store?.kind)} is not supported (supported: ${Object.keys(STORE_BACKENDS).join(', ')})`);
      check(errors, isObject(store) && REPO.test(String(store.repository || '')), 'store.repository must be owner/name');
      check(errors, isObject(store) && isText(store.branch) && !/\s|\.\./.test(store.branch), 'store.branch must be a branch name');
      check(errors, isObject(store) && /^(?:[A-Za-z0-9_.-]+\/)+$/.test(String(store.path || '')) && !String(store.path).split('/').includes('..'), 'store.path must be a relative folder ending in /');
      check(errors, isObject(store) && String(store.repository || '').toLowerCase() !== String(binding.repository || '').toLowerCase(), 'store.repository must be a separate repository');
    }
    if (enabled || binding.required_checks !== undefined) check(errors, Array.isArray(binding.required_checks) && binding.required_checks.every(isText), 'required_checks must be a list of check names');
    // Deprecated and ignored: older bindings that carry it must still validate.
    check(errors, optional(binding.paid_security, value => ['off', 'on'].includes(value)), 'paid_security must be off or on');
    const updates = binding.dependency_updates;
    if (updates !== undefined) {
      check(errors, isObject(updates) && Object.keys(updates).every(key => ['auto_merge', 'github_actions'].includes(key)), 'dependency_updates may hold only auto_merge and github_actions');
      check(errors, isObject(updates) && optional(updates.auto_merge, value => ['off', 'patch-minor'].includes(value)) && optional(updates.github_actions, value => ['auto-merge', 'owner'].includes(value)), 'dependency_updates.auto_merge must be off or patch-minor, and github_actions auto-merge or owner');
    }
    // The Windows Task Scheduler folder for this repository's no-AI tasks (toolkit-windows-tasks.cjs).
    check(errors, optional(binding.schedule_folder, value => typeof value === 'string' && /^[A-Z0-9][A-Z0-9-]{0,31}$/.test(value)), 'schedule_folder must be 1 to 32 capital letters, digits or hyphens, starting with a letter or digit');
    const projection = binding.projection;
    if (projection !== undefined) {
      check(errors, isObject(projection) && Object.keys(projection).every(key => ['after_section', 'replace_section'].includes(key)), 'projection may hold only after_section and replace_section');
      check(errors, isObject(projection) && optional(projection.after_section, isText) && optional(projection.replace_section, isText), 'projection.after_section and projection.replace_section must be heading text');
    }
    screenSecrets(errors, binding, 'binding');
    if (!errors.length && v2 && enabled) {
      const first = binding.parents[0];
      normalized = { ...binding, parent_issue: first.issue, record_prefix: first.record_prefix, writer_prefix: first.writer_prefix || first.record_prefix };
    }
  }
  if (errors.length) throw new ProgrammeError('BINDING_INVALID', `${BINDING_FILE} is invalid: ${errors[0]}`, { errors });
  return normalized;
}

// The keys a version 2 binding may carry (binding-v2.schema.json); anything else makes it invalid.
const BINDING_V2_KEYS = Object.freeze(['schema', 'repository', 'governance', 'parents', 'store', 'required_checks', 'paid_security', 'dependency_updates', 'projection', 'schedule_folder', 'state']);

// The public state branch of a version 2 binding: always this branch and folder on the bound
// repository itself, and only beside a private store, which keeps the journals, the private sidecars
// and the checkpoint. A version 1 binding never reads it.
const STATE_BRANCH = 'DO-NOT-DELETE-IF-TOOLKIT-GOVERNANCE-IS-ENABLED';
const STATE_PATH = 'state/';
function validateStateBlock(errors, binding) {
  const block = binding.state;
  check(errors, isObject(block) && Object.keys(block).every(key => ['kind', 'branch', 'path'].includes(key)), 'state may hold only kind, branch and path');
  check(errors, isObject(block) && Object.hasOwn(STATE_BACKENDS, block.kind), `state.kind must be ${Object.keys(STATE_BACKENDS).join(' or ')}`);
  check(errors, isObject(block) && block.branch === STATE_BRANCH, `state.branch must be ${STATE_BRANCH}`);
  check(errors, isObject(block) && block.path === STATE_PATH, `state.path must be ${STATE_PATH}`);
  check(errors, isObject(binding.store), 'state needs store: the private store keeps the journals, the private sidecars and the checkpoint');
}

// Whether a valid binding turns governance on: v1 always, v2 when `governance` is enabled.
function bindingEnabled(binding) {
  return binding.schema === SCHEMA.binding || binding.governance === 'enabled';
}

function loadBinding(repoRoot) {
  const file = path.join(repoRoot, BINDING_FILE);
  if (!fs.existsSync(file)) {
    throw new ProgrammeError('BINDING_MISSING', `This repository has no reconciler binding (${BINDING_FILE.replace(/\\/g, '/')}); every programme.cjs command refuses without it. Only the owner adds the binding, on purpose. Toolkit-governed rules and their issue records are unchanged.`);
  }
  let binding;
  try { binding = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new ProgrammeError('BINDING_INVALID', `${BINDING_FILE} is not valid JSON: ${error.message}`); }
  const valid = validateBinding(binding);
  if (!bindingEnabled(valid)) throw new ProgrammeError('BINDING_DISABLED', `${BINDING_FILE.replace(/\\/g, '/')} sets governance to disabled, so every programme.cjs command refuses. Only an owner-merged pull request turns it back on.`);
  return valid;
}

// ---------------------------------------------------------------------------------------------
// New documents and holder operations (pure)

function newParent({ repository, parentIssue, outcomes = [], releasePlan = null }) {
  return {
    schema: SCHEMA.parent, repository, parent_issue: parentIssue, revision: 0,
    fence: { epoch: 0, holder_prefix: null, holder_session: null },
    release_plan: releasePlan, outcomes, pending_effects: [], private: {},
  };
}

function lifecycleForClass(cls) {
  if (cls === 'COMPLETED') return 'DONE';
  if (cls === 'RETIRED') return 'RETIRED';
  return 'PLANNED';
}

function newChild({ repository, outcome }) {
  const lifecycle = lifecycleForClass(outcome.class);
  return {
    schema: SCHEMA.child, repository, issue: outcome.issue, revision: 0,
    fence: { epoch: 0, holder_prefix: null, holder_session: null },
    lifecycle, release: null,
    gate: { role: null, state: null, session_id: null, route: null, returns: [] },
    candidate: { branch: null, head: null, tree: null, base: null },
    pr: { number: null, state: null, head: null, checks: { state: 'UNKNOWN', required_total: 0, required_passed: 0, at_head: null } },
    uat: { state: null, at_head: null },
    review: { state: null, verdicts: [] },
    blockers: [],
    next_action: lifecycle === 'DONE' ? 'None: completed' : lifecycle === 'RETIRED' ? 'None: retired' : 'Controller: admit and plan this outcome',
    pending_effects: [],
    private: {},
  };
}

// The writer may change this document: its own holder, or (for a child) the parent's holder.
// The fence orders cooperating Toolkit writers that act as the same GitHub account; it does not
// authenticate anyone.
// A refresh writer (refreshWriter) acts by the stored hash of the holder's session; nothing else may.
function isHolder(doc, writer) {
  if (!writer || !doc?.fence?.holder_session || doc.fence.holder_prefix !== writer.prefix) return false;
  if (writer.by_hash === true) return SESSION_HASH.test(String(writer.session_hash || '')) && sessionHashOf(doc.fence.holder_session) === writer.session_hash;
  return doc.fence.holder_session === writer.session;
}

// Decisions (claims, verdicts, acceptance records, answers to findings) need the holder's own session.
const isDecisionHolder = (doc, writer) => writer?.by_hash !== true && isHolder(doc, writer);

// The hash journal names and public state use for a session ID. programme-checkpoint.cjs owns it; it
// is loaded on first use, so this module adds nothing to what a hook loads.
function sessionHashOf(sessionId) {
  return require('./programme-checkpoint.cjs').sessionHash(sessionId);
}

// The writer `refresh` uses: the parent's current holder, named only by the hash of its session. It
// may bring documents in line with what is recorded and observed, never decide.
function refreshWriter(parentDoc) {
  const { holder_session: session, holder_prefix: prefix } = parentDoc?.fence || {};
  if (!session || !prefix) return null;
  return { by_hash: true, session_hash: sessionHashOf(session), prefix };
}

function holderDescription(doc, kind = doc?.schema === SCHEMA.parent ? 'parent' : 'child', parentDoc = null) {
  const prefix = doc?.fence?.holder_prefix || 'nobody';
  const epoch = doc?.fence?.epoch ?? 0;
  if (kind === 'parent') return `parent holder (${prefix}, epoch ${epoch})`;
  if (doc?.fence?.holder_session && isHolder(parentDoc, { session: doc.fence.holder_session, prefix })) {
    return `parent holder (${prefix}, epoch ${epoch})`;
  }
  return doc?.fence?.holder_session ? `lane controller ${prefix} (epoch ${epoch})` : `controller (epoch ${epoch})`;
}

function parentRefusal(doc) {
  return `The parent document is held by the ${holderDescription(doc)}. Only that holder writes programme state; other sessions dry-run and report to the controller. A controller stopped by a takeover stops and reports to the owner.`;
}

function authoriseWrite(kind, doc, parentDoc, writer) {
  if (!writer || !(writer.by_hash === true ? SESSION_HASH.test(String(writer.session_hash || '')) : isText(writer.session)) || !PREFIX.test(String(writer.prefix || ''))) {
    throw new ProgrammeError('WRITER_UNKNOWN', 'This write needs --session <this session\'s own id> and a record prefix.');
  }
  if (kind === 'parent') {
    if (doc && !isHolder(doc, writer)) throw new ProgrammeError('STALE_WRITER', parentRefusal(doc));
    return;
  }
  if (doc && isHolder(doc, writer)) return;
  if (parentDoc && isHolder(parentDoc, writer)) return;
  throw new ProgrammeError('STALE_WRITER', `Issue ${doc?.issue ?? ''} is held by the ${holderDescription(doc, 'child', parentDoc)}, and the parent document by the ${holderDescription(parentDoc, 'parent')}. This session holds neither, so the write was refused. ${parentRefusal(parentDoc).split('. ').slice(1).join('. ')}`);
}

// Claim or take over a document's fence: one compare-and-swap that increments the epoch and records
// the holder. Gates are not claimed; the controller assigns them (assignGate).
function claimDocument(doc, writer, { takeover = false, parentDoc = null } = {}) {
  if (writer?.by_hash === true) throw new ProgrammeError('ROLE_REFUSED', 'A refresh acts by the stored holder hash and never claims a document.');
  const next = clone(doc);
  const held = Boolean(next.fence.holder_session);
  if (isHolder(next, writer)) return null;
  if (held && !takeover) {
    throw new ProgrammeError('CLAIM_HELD', next.schema === SCHEMA.parent
      ? parentRefusal(next)
      : `Issue ${next.issue} is held by the ${holderDescription(next, 'child', parentDoc)}. ${parentRefusal(parentDoc).split('. ').slice(1).join('. ')}`);
  }
  next.fence = { epoch: next.fence.epoch + 1, holder_prefix: writer.prefix, holder_session: writer.session };
  return next;
}

// A lane controller takes the fence of a child the catalogue delegates to its record prefix.
function claimLane(doc, writer, outcome, { takeover = false } = {}) {
  if (writer?.by_hash === true) throw new ProgrammeError('ROLE_REFUSED', 'A refresh acts by the stored holder hash and never claims a document.');
  if (!outcome?.owner_prefix || outcome.owner_prefix !== writer.prefix) {
    throw new ProgrammeError('NOT_DELEGATED', `#${doc.issue} is not delegated to ${writer.prefix}; the catalogue names ${outcome?.owner_prefix || 'no lane'} for it. Report to the controller.`);
  }
  if (isHolder(doc, writer)) return null;
  if (doc.fence.holder_session && doc.fence.holder_prefix === writer.prefix && !takeover) {
    throw new ProgrammeError('CLAIM_HELD', `Issue ${doc.issue} is held by another ${writer.prefix} session (epoch ${doc.fence.epoch}). The lane controller that replaces it uses --takeover after that session stopped.`);
  }
  const next = clone(doc);
  next.fence = { epoch: next.fence.epoch + 1, holder_prefix: writer.prefix, holder_session: writer.session };
  return next;
}

// The holder of the parent may write any child; a lane controller only the child it holds, and only
// when the catalogue delegates that child to its prefix.
function isLaneHolder(child, writer, outcome) {
  return Boolean(child && outcome?.owner_prefix && outcome.owner_prefix === writer?.prefix && isHolder(child, writer));
}

function currentGateAccepted(child) {
  const latest = child.gate.returns.at(-1);
  return child.gate.state === 'RETIRED' && Boolean(latest?.consumed && latest.verdict === 'ACCEPT');
}

function completionAccepted(child) {
  return ['G1', 'G2'].includes(child.gate.role) && currentGateAccepted(child);
}

const GATE_HISTORY_LIMIT = 20;
const needsReason = (reason, command) => {
  if (!isText(String(reason ?? '').trim())) throw new ProgrammeError('USAGE', `${command} needs --reason <why>.`);
  return String(reason).trim();
};

// How an assignment ended, kept in `private` (bounded) so the controller can see the handover trail.
function endAssignment(next, ended, reason = null) {
  const assignment = next.gate.assignment;
  if (!assignment) return;
  const history = Array.isArray(next.private.gate_history) ? next.private.gate_history : [];
  next.private = { ...next.private, gate_history: [...history, { assignment: assignment.id, role: assignment.role, ended, ...(reason ? { reason } : {}) }].slice(-GATE_HISTORY_LIMIT) };
}

function assignmentUsed(doc, id) {
  return doc.gate.returns.some(entry => entry.assignment === id)
    || (Array.isArray(doc.private?.gate_history) && doc.private.gate_history.some(entry => entry?.assignment === id));
}

// The controller (or the lane holding this child) issues an assignment. Only the session bound to the
// current assignment may journal; nothing else can make a gate live.
function assignGate(doc, { assignment, role, supersede = false, reason = null }) {
  if (!ASSIGNMENT_ID.test(String(assignment || ''))) throw new ProgrammeError('USAGE', 'assign needs --assignment <id> (letters, digits, dot, dash or underscore; up to 60).');
  if (!GATE_ROLES.includes(role)) throw new ProgrammeError('USAGE', '--role must be G0, G1 or G2.');
  const next = clone(doc);
  const gate = next.gate;
  if (gate.assignment?.id === assignment) {
    if (gate.assignment.role === role && gate.state === 'ASSIGNED' && !supersede) return null;
    throw new ProgrammeError('USAGE', `Assignment ${assignment} is already issued; every assignment needs a new id.`);
  }
  if (assignmentUsed(next, assignment)) throw new ProgrammeError('USAGE', `Assignment ${assignment} was used before; every assignment needs a new id.`);
  if (next.lifecycle === 'RETIRED') throw new ProgrammeError('GATE_STATE', `#${next.issue} is retired. Controller: change its lifecycle before assigning a gate.`);
  const live = LIVE_GATE_STATES.includes(gate.state);
  if (supersede) {
    if (!live) throw new ProgrammeError('GATE_STATE', `--supersede replaces a live assignment, and #${next.issue} has none (${gate.state || 'no gate'}).`);
    endAssignment(next, 'SUPERSEDED', needsReason(reason, 'assign --supersede'));
  } else if (live) {
    throw new ProgrammeError('ASSIGNMENT_LIVE', `#${next.issue} has a live ${gate.role} assignment ${gate.assignment?.id || '(none recorded)'} (${gate.state}). Controller: interrupt it first, or assign with --supersede --reason.`);
  } else if (gate.state === 'RETIRED' && gate.role === role) {
    throw new ProgrammeError('GATE_STATE', `The ${role} gate of #${next.issue} was accepted. Controller: reopen it for a correction instead of assigning it again.`);
  } else if (gate.state === 'RETIRED') {
    endAssignment(next, 'ACCEPTED');
  }
  gate.assignment = { id: assignment, role };
  gate.role = role;
  gate.state = 'ASSIGNED';
  gate.session_id = null;
  gate.route = null;
  if (['PLANNED', 'DONE'].includes(next.lifecycle)) next.lifecycle = 'ACTIVE';
  next.next_action = `Executor: bind to assignment ${assignment} and start ${role}`;
  return next;
}

// The controller reopens a gate. An accepted (RETIRED) gate gets a new assignment for its correction,
// which removes the acceptance; a submitted return is sent back (REOPEN); a gate waiting on the owner
// continues once the controller has recorded the answer.
function reopenGate(doc, { reason, assignment = null }) {
  const why = needsReason(reason, 'reopen');
  const next = clone(doc);
  const gate = next.gate;
  if (gate.state === 'RETIRED') {
    if (!ASSIGNMENT_ID.test(String(assignment || ''))) throw new ProgrammeError('USAGE', 'Reopening an accepted gate needs --assignment <new id> for the correction.');
    if (gate.assignment?.id === assignment || assignmentUsed(next, assignment)) throw new ProgrammeError('USAGE', `Assignment ${assignment} was used before; every assignment needs a new id.`);
    endAssignment(next, 'REOPENED', why);
    gate.assignment = { id: assignment, role: gate.role };
    gate.state = 'ASSIGNED';
    gate.session_id = null;
    gate.route = null;
    if (['PLANNED', 'DONE'].includes(next.lifecycle)) next.lifecycle = 'ACTIVE';
    next.next_action = `Executor: bind to assignment ${assignment} and correct ${gate.role}`;
    return next;
  }
  if (assignment) throw new ProgrammeError('GATE_STATE', `--assignment is only for reopening an accepted gate; #${next.issue} is ${gate.state || 'not assigned'}.`);
  if (gate.state === 'SUBMITTED') {
    const pending = gate.returns.filter(entry => !entry.consumed).at(-1);
    if (pending) { pending.consumed = true; pending.verdict = 'REOPEN'; }
    gate.state = 'ACTIVE';
    next.next_action = `Executor: continue ${gate.role}; the next return needs a new return ID`;
    return next;
  }
  if (gate.state === 'WAITING_OWNER') {
    gate.state = 'ACTIVE';
    next.next_action = `Executor: continue ${gate.role} with the owner's answer`;
    return next;
  }
  throw new ProgrammeError('GATE_STATE', `reopen works on an accepted, submitted or waiting gate; #${next.issue} is ${gate.state || 'not assigned'}.`);
}

// The controller (or the lane holding this child) stops a live assignment, for example after a lost
// session. Journals for it are stale from then on.
function interruptGate(doc, { reason }) {
  const why = needsReason(reason, 'interrupt');
  const next = clone(doc);
  if (!LIVE_GATE_STATES.includes(next.gate.state)) {
    throw new ProgrammeError('GATE_STATE', `interrupt stops a live assignment; #${next.issue} is ${next.gate.state || 'not assigned'}.`);
  }
  endAssignment(next, 'INTERRUPTED', why);
  next.gate.state = 'INTERRUPTED';
  next.next_action = `Controller: assign a successor for ${next.gate.role}, or reopen the outcome later`;
  return next;
}

// The controller records an executor's return from its report, for a session without the turn-end
// hook (cloud and Projects threads): completion mode toolkit_assisted. Returns are kept by return ID.
function recordReturn(doc, { returnId, assignment, atHead = null, mode = 'toolkit_assisted' }) {
  if (!RETURN_ID.test(String(returnId || ''))) throw new ProgrammeError('USAGE', 'return --record needs a return ID (letters, digits, dot, dash or underscore; up to 80).');
  if (!ASSIGNMENT_ID.test(String(assignment || ''))) throw new ProgrammeError('USAGE', 'return --record needs --assignment <id>.');
  if (!optional(atHead, isSha)) throw new ProgrammeError('USAGE', '--at-head must be a full 40-character SHA.');
  const next = clone(doc);
  const gate = next.gate;
  if (gate.assignment?.id !== assignment || !LIVE_GATE_STATES.includes(gate.state)) {
    throw new ProgrammeError('STALE_ASSIGNMENT', `Assignment ${assignment} is not the live assignment of #${next.issue} (current: ${gate.assignment?.id || 'none'}, ${gate.state || 'no gate'}); its return is not recorded.`);
  }
  const existing = gate.returns.find(entry => entry.return_id === returnId);
  if (existing) {
    if (existing.consumed) throw new ProgrammeError('RETURN_CONFLICT', `Return ${returnId} was already consumed as ${existing.verdict}; a new submission needs a new return ID.`);
    return null;
  }
  if (!['ASSIGNED', 'ACTIVE'].includes(gate.state)) {
    throw new ProgrammeError('GATE_STATE', `#${next.issue} is ${gate.state}; a new return is recorded only while the gate is assigned or active.`);
  }
  gate.returns.push({ return_id: returnId, verdict: null, consumed: false, epoch: next.fence.epoch, assignment, at_head: atHead, mode });
  gate.state = 'SUBMITTED';
  next.next_action = `Controller: consume return ${returnId}`;
  return next;
}

// LIFE-1: returns are consumed by return ID, never by session. REOPEN keeps the assignment and its
// session; the next submission needs a new return ID. Only the parent's holder consumes a return, and a
// G1 acceptance needs a G2 review PASSED at the live PR head (`liveHead`, else the recorded PR head).
function consumeReturn(doc, { returnId, verdict, writer = null, parentDoc = null, liveHead = undefined }) {
  if (!VERDICTS.includes(verdict)) throw new ProgrammeError('USAGE', '--verdict must be ACCEPT, REOPEN or WAITING_OWNER.');
  if (!isDecisionHolder(parentDoc, writer)) throw new ProgrammeError('ROLE_REFUSED', 'Only the holder of the parent document (the controller) consumes a gate return.');
  const next = clone(doc);
  const entry = next.gate.returns.find(item => item.return_id === returnId);
  if (!entry) throw new ProgrammeError('RETURN_UNKNOWN', `No return ${returnId} on issue ${next.issue}.`);
  if (entry.consumed) {
    if (entry.verdict === verdict) return null;
    throw new ProgrammeError('RETURN_CONFLICT', `Return ${returnId} was already consumed as ${entry.verdict}, not ${verdict}.`);
  }
  if (entry.epoch !== next.fence.epoch) throw new ProgrammeError('STALE_RETURN', `Return ${returnId} was submitted at epoch ${entry.epoch}; the document is at epoch ${next.fence.epoch}.`);
  if (entry.assignment && entry.assignment !== next.gate.assignment?.id) {
    throw new ProgrammeError('STALE_ASSIGNMENT', `Return ${returnId} belongs to assignment ${entry.assignment}; the current assignment is ${next.gate.assignment?.id || 'none'}.`);
  }
  const latest = next.gate.returns.filter(item => !item.consumed).at(-1);
  if (latest.return_id !== returnId) throw new ProgrammeError('STALE_RETURN', `Return ${returnId} is not the latest submission (${latest.return_id}).`);
  if (next.gate.state !== 'SUBMITTED') throw new ProgrammeError('GATE_STATE', `#${next.issue} is ${next.gate.state || 'not assigned'}; only a submitted return is consumed.`);
  if (verdict === 'ACCEPT' && next.gate.role === 'G1') {
    // The command line passes the live PR head; without it the last observed head is used.
    const head = liveHead === undefined ? next.pr.head : liveHead;
    const passed = isSha(head) && next.review.state === 'PASSED'
      && next.review.verdicts.some(item => item.verdict === 'PASSED' && item.head === head);
    if (!passed) {
      throw new ProgrammeError('EVIDENCE_STALE', `G1 is accepted only after a G2 review PASSED at the live PR head (${isSha(head) ? shortSha(head) : 'no PR head found'}). Controller: record the G2 verdict at that head first, or consume this return as REOPEN.`);
    }
  }
  entry.consumed = true;
  entry.verdict = verdict;
  next.gate.state = verdict === 'REOPEN' ? 'ACTIVE' : verdict === 'WAITING_OWNER' ? 'WAITING_OWNER' : 'RETIRED';
  next.next_action = verdict === 'ACCEPT' ? `Controller: ${next.gate.role} accepted; assign the next gate or record completion`
    : verdict === 'REOPEN' ? `Executor: continue ${next.gate.role}; the next return needs a new return ID`
      : 'Owner: answer the question, then Controller: reopen the gate';
  return next;
}

// Reads checkpoint journals into a child document (pure). `observation.files` lists every journal
// file for the issue ({ name, assignment, session_hash, sha, doc, error }). Only the one session
// journaling the live assignment moves the gate: ASSIGNED becomes ACTIVE, and a new return in its
// journal is captured (ACTIVE becomes SUBMITTED). A journal for any other assignment, or for an
// interrupted, retired or unassigned gate, is reported once as STALE_ASSIGNMENT and never consumed.
// Two sessions on one live assignment hold the gate (DUPLICATE_SESSION).
function foldJournals(doc, observation) {
  const next = clone(doc);
  const findings = [];
  const holds = [];
  const gate = next.gate;
  const issue = next.issue;
  const files = observation?.files || [];
  const seen = { ...(next.journals_seen || {}) };
  const liveId = LIVE_GATE_STATES.includes(gate.state) ? gate.assignment?.id || null : null;
  const fresh = file => seen[file.name] !== file.sha;
  const current = files.filter(file => file.assignment === liveId);
  for (const file of files.filter(entry => entry.assignment !== liveId)) {
    if (fresh(file)) {
      findings.push({ code: 'STALE_ASSIGNMENT', issue, detail: `a checkpoint from assignment ${file.assignment} (session ${file.session_hash.slice(0, 8)}) arrived after that assignment stopped being live; current: ${gate.assignment?.id || 'none'} ${gate.state || ''}`.trim() + '; not consumed' });
    }
    seen[file.name] = file.sha;
  }
  // The session the controller already saw on this assignment counts even when its journal is gone.
  const sessions = new Set(current.map(file => file.session_hash));
  if (current.length && SESSION_HASH.test(String(gate.session_id || ''))) sessions.add(gate.session_id);
  if (sessions.size > 1) {
    holds.push({ code: 'DUPLICATE_SESSION', target: `#${issue}`, scope: 'gate',
      detail: `${sessions.size} sessions are working on assignment ${liveId}; interrupt it and assign one successor` });
    for (const file of current) seen[file.name] = file.sha;
  } else if (current.length === 1) {
    const file = current[0];
    const journal = file.doc;
    if (!journal || journal.issue !== issue || journal.assignment !== liveId || journal.session_hash !== file.session_hash) {
      if (fresh(file)) findings.push({ code: 'JOURNAL_INVALID', issue, detail: `the checkpoint journal for assignment ${liveId} could not be used (${file.error || 'it names another issue, assignment or session'})` });
    } else {
      if (journal.last_error && fresh(file)) findings.push({ code: 'JOURNAL_ERROR', issue, since: journal.last_error.at, detail: `the executor's checkpoint hook reported ${journal.last_error.code} at ${journal.last_error.at}` });
      if (gate.state === 'ASSIGNED') {
        gate.state = 'ACTIVE';
        gate.session_id = file.session_hash;
        gate.route = journal.route ? clone(journal.route) : null;
        next.next_action = `Executor: working on ${gate.role} (assignment ${liveId})`;
        findings.push({ code: 'GATE_ACTIVE', issue, detail: `assignment ${liveId} is bound (session ${file.session_hash.slice(0, 8)})` });
      }
      const known = new Set(gate.returns.map(entry => entry.return_id));
      const latest = journal.returns.at(-1);
      if (gate.state === 'ACTIVE' && latest && !known.has(latest.return_id)) {
        gate.returns.push({ return_id: latest.return_id, verdict: null, consumed: false, epoch: next.fence.epoch, assignment: liveId, at_head: latest.at_head, mode: 'native' });
        gate.state = 'SUBMITTED';
        next.next_action = `Controller: consume return ${latest.return_id}`;
        findings.push({ code: 'RETURN_CAPTURED', issue, detail: `return ${latest.return_id} (requested ${latest.verdict_requested || 'no verdict'}${latest.at_head ? ` at ${shortSha(latest.at_head)}` : ''}) waits for the controller's verdict` });
      }
    }
    seen[file.name] = file.sha;
  }
  for (const name of Object.keys(seen)) if (!files.some(file => file.name === name)) delete seen[name];
  if (Object.keys(seen).length || next.journals_seen) next.journals_seen = seen;
  return { doc: next, findings, holds };
}

// RFC 7386 merge patch, limited to the named top-level fields.
function mergePatch(target, patch) {
  if (!isObject(patch)) return clone(patch);
  const result = isObject(target) ? clone(target) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

// `writer` and `parentDoc` decide whether a child patch may touch the acceptance records.
function applyPatch(kind, doc, patch, { writer = null, parentDoc = null } = {}) {
  if (!isObject(patch)) throw new ProgrammeError('USAGE', 'The patch must be a JSON object.');
  const allowed = kind === 'parent' ? PATCHABLE_PARENT_FIELDS : PATCHABLE_CHILD_FIELDS;
  const refused = Object.keys(patch).filter(key => !allowed.includes(key));
  if (refused.length) throw new ProgrammeError('PATCH_REFUSED', `These fields cannot be patched: ${refused.join(', ')}. Allowed: ${allowed.join(', ')}.`);
  if (kind === 'child' && !isDecisionHolder(parentDoc, writer)) {
    const records = Object.keys(patch).filter(key => CONTROLLER_CHILD_FIELDS.includes(key));
    const terminal = Object.hasOwn(patch, 'lifecycle') && (TERMINAL_LIFECYCLES.includes(patch.lifecycle) || TERMINAL_LIFECYCLES.includes(doc.lifecycle));
    if (records.length || terminal) {
      throw new ProgrammeError('ROLE_REFUSED', `Only the holder of the parent document (the controller) records ${[...records, ...(terminal ? ['a DONE or RETIRED lifecycle'] : [])].join(', ')}.`);
    }
  }
  const next = clone(doc);
  for (const [key, value] of Object.entries(patch)) {
    // Lists and plain values are replaced whole; objects are merge-patched.
    if (Array.isArray(value) || !isObject(value)) next[key] = clone(value);
    else next[key] = mergePatch(next[key], value);
  }
  if (kind === 'parent') refuseNewLegacy(doc, next);
  return next;
}

// A write never adds an older class: an entry may keep one it already had until it is migrated.
function refuseNewLegacy(previous, next) {
  const had = new Map((previous?.outcomes || []).map(outcome => [outcome.issue, outcome.class]));
  const added = (Array.isArray(next?.outcomes) ? next.outcomes : []).filter(outcome => LEGACY_CLASSES.includes(outcome?.class) && had.get(outcome.issue) !== outcome.class);
  if (added.length) throw new ProgrammeError('PATCH_REFUSED', `${added.map(outcome => `#${outcome.issue} ${outcome.class}`).join(', ')}: ${LEGACY_CLASSES.join(', ')} are older class names kept only for migration; use ${CLASSES.join(', ')}.`);
}

// The update-parent patch that migrates older classes in one step: each becomes COMMITTED and every
// open entry's order is renumbered in its current sequence (old class, then order, then issue), so
// CORE, then HARDENING, then LATER work keeps its place. Finished entries are unchanged.
function legacyMigrationPatch(parent) {
  const open = parent.outcomes.filter(outcome => !['COMPLETED', 'RETIRED'].includes(outcome.class))
    .sort((a, b) => legacyRank(a) - legacyRank(b) || a.order - b.order || a.issue - b.issue);
  const order = new Map(open.map((outcome, at) => [outcome.issue, at]));
  return { outcomes: parent.outcomes.map(outcome => (order.has(outcome.issue)
    ? { ...outcome, class: LEGACY_CLASSES.includes(outcome.class) ? 'COMMITTED' : outcome.class, order: order.get(outcome.issue) }
    : clone(outcome))) };
}

// ---------------------------------------------------------------------------------------------
// Check evaluation (pure)

const FAILED_CONCLUSIONS = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);

function contextName(context) { return context.name || context.context || ''; }

function contextResult(context) {
  if (context.kind === 'StatusContext' || context.__typename === 'StatusContext') {
    if (context.state === 'SUCCESS') return 'passed';
    if (context.state === 'PENDING' || context.state === 'EXPECTED') return 'pending';
    return FAILED_CONCLUSIONS.has(context.state) ? 'failed' : 'unknown';
  }
  if (context.status !== 'COMPLETED') return 'pending';
  if (context.conclusion === 'SUCCESS') return 'passed';
  return FAILED_CONCLUSIONS.has(context.conclusion) ? 'failed' : 'unknown';
}

// Required checks at the exact head. Required = GitHub's isRequired flags plus the binding's list.
// Missing, pending, skipped, neutral, paginated or off-head results are never GREEN.
function evaluateChecks({ head, rollupOid, contexts = [], complete = true, configured = [] }) {
  const empty = { state: 'UNKNOWN', required_total: 0, required_passed: 0, at_head: isSha(head) ? head : null, missing: [], failing: [], reason: null };
  if (!isSha(head)) return { ...empty, reason: 'NO_HEAD' };
  if (rollupOid !== head) return { ...empty, reason: 'ROLLUP_NOT_AT_HEAD' };
  if (!complete) return { ...empty, reason: 'CHECKS_INCOMPLETE' };
  const required = [...new Set([...contexts.filter(context => context.required).map(contextName), ...configured])].sort();
  if (!required.length) return { ...empty, reason: 'NO_REQUIRED_CHECKS' };
  const results = required.map(name => {
    const found = contexts.filter(context => contextName(context) === name).map(contextResult);
    if (!found.length) return { name, result: 'missing' };
    if (found.includes('failed')) return { name, result: 'failed' };
    if (found.includes('pending')) return { name, result: 'pending' };
    if (found.includes('unknown')) return { name, result: 'unknown' };
    return { name, result: 'passed' };
  });
  const passed = results.filter(entry => entry.result === 'passed').length;
  const failing = results.filter(entry => entry.result === 'failed').map(entry => entry.name);
  const missing = results.filter(entry => entry.result === 'missing').map(entry => entry.name);
  let state = 'GREEN';
  if (failing.length) state = 'RED';
  else if (missing.length || results.some(entry => entry.result === 'pending')) state = 'PENDING';
  else if (results.some(entry => entry.result === 'unknown')) state = 'UNKNOWN';
  return { state, required_total: required.length, required_passed: passed, at_head: head, missing, failing, reason: null };
}

// ---------------------------------------------------------------------------------------------
// Rendering (pure). Reads an allow-list of public fields only; never `private`, sessions or routes.

const shortSha = sha => (isSha(sha) ? sha.slice(0, 7) : '');

// Free text as one Markdown table-safe line: shortened first, then `&`, `<` and `>` become entities
// (so no comment, marker or tag can be opened) and backslash and `|` are escaped.
function publicText(value) {
  const line = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  const short = line.length > TEXT_LIMIT ? `${line.slice(0, TEXT_LIMIT - 3)}...` : line;
  return short.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function shaLink(repository, sha) {
  return isSha(sha) ? `[${shortSha(sha)}](https://github.com/${repository}/commit/${sha}) \`${sha}\`` : '-';
}

function checksText(child) {
  const checks = child.pr.checks;
  if (!child.pr.number) return '-';
  return checks.required_total ? `${checks.state} ${checks.required_passed}/${checks.required_total}` : checks.state;
}

// Evidence recorded at an older head than the live PR head is shown as STALE_HEAD; the controller
// records the UAT decision.
function uatText(child) {
  const state = child.uat.state || '-';
  if (!HEAD_BOUND_UAT.includes(child.uat.state)) return state;
  if (!child.uat.at_head) return `${state} (STALE_HEAD, head not recorded)`;
  if (child.pr.head && child.uat.at_head !== child.pr.head) return `${state} (STALE_HEAD, was ${shortSha(child.uat.at_head)})`;
  return state;
}

// A decided review is current only when a verdict was given at the live PR head.
function reviewText(child) {
  const state = child.review.state || '-';
  if (!DECIDED_REVIEW.includes(child.review.state)) return state;
  if (!child.review.verdicts.length) return `${state} (STALE_HEAD, no verdict recorded)`;
  const stale = child.pr.head && !child.review.verdicts.some(verdict => verdict.head === child.pr.head);
  return stale ? `${state} (STALE_HEAD)` : state;
}

function prText(child) {
  if (!child.pr.number) return '-';
  return `#${child.pr.number} ${child.pr.state || ''}`.trim();
}

function revisionLine(parent, children) {
  const revs = [...children.values()].sort((a, b) => a.issue - b.issue).map(child => `${child.issue}:${child.revision}`).join(',');
  return `<!-- programme-state parent=${parent.parent_issue}@${parent.revision} children=${revs} -->`;
}

// The Programme Graph's Class column is worked out, never stored: NOW when the task is in progress
// (an open or draft PR, or active, waiting on the owner or held), else LATER (OPTIONAL for an
// optional task). A planned release names where the work merges; it does not change the group.
// A finished outcome (class COMPLETED or RETIRED, or a DONE or RETIRED lifecycle) shows as COMPLETED,
// and a retired one says so in its status. The gate a task is in shows on its own page, not here.
const GRAPH_GROUPS = Object.freeze(['NOW', 'LATER', 'OPTIONAL']);
const GRAPH_HEADER = ['| Task | Task Description | Child # | PR # | Class | Status |', '|---|---|---|---|---|---|'];

function graphClass(outcome, child) {
  if (!outcome || isFinished(outcome, child)) return '-';
  if (statusText(outcome, child) === 'IN PROGRESS') return 'NOW';
  return outcome.class === 'OPTIONAL' ? 'OPTIONAL' : 'LATER';
}

function isFinished(outcome, child) {
  return outcome.class === 'COMPLETED' || outcome.class === 'RETIRED' || Boolean(child && TERMINAL_LIFECYCLES.includes(child.lifecycle));
}

function isRetired(outcome, child) {
  return outcome.class === 'RETIRED' || child?.lifecycle === 'RETIRED';
}

// A planned outcome with an open or draft PR is already in progress.
function statusText(outcome, child) {
  if (isRetired(outcome, child)) return 'RETIRED';
  if (isFinished(outcome, child)) return 'COMPLETED';
  if (!child) return 'QUEUED';
  return child.lifecycle === 'PLANNED' && !['OPEN', 'DRAFT'].includes(child.pr.state) ? 'QUEUED' : 'IN PROGRESS';
}

function laneText(outcome, child) {
  return statusText(outcome, child) === 'IN PROGRESS' && child.gate.role ? child.gate.role : '-';
}

// The task's name: the catalogue name, else the issue title without a leading short code and dash
// or a leading "Toolkit <version>:".
// The task's name as written (not escaped); taskName is the same name escaped for a table cell.
function taskTitle(outcome, issue) {
  if (outcome.name) return String(outcome.name);
  const title = String(issue?.title || '').replace(/^Toolkit \d+\.\d+(?:\.\d+)?\s*[:—–-]\s*/, '').replace(/^[A-Z][A-Za-z0-9]*(?:-[A-Z0-9]+)?\s+[—–-]\s+/, '');
  return title || outcome.label || `#${outcome.issue}`;
}

function taskName(outcome, issue) {
  return publicText(taskTitle(outcome, issue));
}

function descriptionText(outcome) {
  return publicText(outcome.description || '') || '-';
}

// When an outcome finished: the state's completion time, else the issue's close time.
function completedAt(child, issue) {
  return child?.completed_at || issue?.closed_at || null;
}

// Active rows by class (NOW, LATER, OPTIONAL), each by priority (`order`, lowest first) and then
// child issue number, so the top LATER row starts next; then every finished row, oldest completion
// first and the most recent last (unknown times last). Nested children sort like any other row.
function graphOrder(parent, children, issues) {
  const finished = parent.outcomes.filter(outcome => isFinished(outcome, children.get(outcome.issue)));
  const active = parent.outcomes.filter(outcome => !finished.includes(outcome));
  const byPriority = (a, b) => a.order - b.order || a.issue - b.issue;
  const groups = GRAPH_GROUPS.map(cls => active.filter(outcome => graphClass(outcome, children.get(outcome.issue)) === cls).sort(byPriority));
  const when = outcome => completedAt(children.get(outcome.issue), issues.get(outcome.issue));
  const byCompletion = (a, b) => {
    const left = when(a);
    const right = when(b);
    if (left && right && left !== right) return left < right ? -1 : 1;
    if (Boolean(left) !== Boolean(right)) return left ? -1 : 1;
    return a.issue - b.issue;
  };
  const retired = finished.filter(outcome => isRetired(outcome, children.get(outcome.issue)));
  const completed = finished.filter(outcome => !retired.includes(outcome));
  return [...groups.flat(), ...completed.sort(byCompletion), ...retired.sort(byCompletion)];
}

// Queued rows (LATER or OPTIONAL) in the same group that share an `order`, the priority: each list
// is one tie, lowest order first. Work in progress is left out, since NOW is not picked by priority.
function orderTies(parent, children) {
  const ties = new Map();
  for (const outcome of parent.outcomes) {
    const cls = graphClass(outcome, children.get(outcome.issue));
    if (cls !== 'LATER' && cls !== 'OPTIONAL') continue;
    const key = `${cls} ${outcome.order}`;
    ties.set(key, [...(ties.get(key) || []), outcome]);
  }
  return [...ties.values()].filter(list => list.length > 1).map(list => list.sort((a, b) => a.issue - b.issue))
    .sort((a, b) => a[0].order - b[0].order || a[0].issue - b[0].issue);
}

// `issues` maps an issue number to what GitHub shows for it (title, close time).
function renderParentBlockBody(parent, children, issues = new Map()) {
  const rows = graphOrder(parent, children, issues).map(outcome => {
    const child = children.get(outcome.issue);
    const cls = graphClass(outcome, child);
    const pr = child?.pr.number ? `#${child.pr.number}` : '-';
    return `| ${taskName(outcome, issues.get(outcome.issue))} | ${descriptionText(outcome)} | #${outcome.issue} | ${pr} | ${cls} | ${statusText(outcome, child)} |`;
  });
  return [
    revisionLine(parent, children),
    '## Programme Graph',
    '',
    `Generated from the programme state documents (state revision ${parent.revision}), so edit those rather than this table. Sorted NOW (in progress), then LATER in priority order (the top one starts next), then OPTIONAL, then COMPLETED with the most recent last.`,
    '',
    ...GRAPH_HEADER,
    ...rows,
  ].join('\n');
}

// The group a trace item belongs to: its topic, except that on a task page the task's own name and
// no topic are one group (null). `topic` is the task's name as written, not escaped.
function topicKey(item, topic) {
  const key = item.tag || null;
  return key && topic && key === String(topic).replace(/\s+/g, ' ').trim().toUpperCase() ? null : key;
}

// A trace's groups, one per topic in first-seen order and the untopiced group last. Topics never mix.
function traceGroups(trace, topic = null) {
  const groups = new Map();
  const add = (item, kind) => {
    const key = topicKey(item, topic);
    if (!groups.has(key)) groups.set(key, { tag: key, label: null, indexes: [], entries: [], marks: [] });
    const group = groups.get(key);
    if (!group.label && key) group.label = item.tag_label || item.tag;
    group[kind].push(item);
  };
  for (const index of trace.indexes) add(index, 'indexes');
  for (const entry of trace.entries) add(entry, 'entries');
  for (const mark of trace.marks) add(mark, 'marks');
  const other = groups.get(null);
  groups.delete(null);
  return [...groups.values(), ...(other ? [other] : [])];
}

// A line's label, escaped once: its topic as written; for the untopiced line, a task page's own
// task name, else "Other comments".
function groupLabel(group, topic) {
  return publicText(group.tag ? group.label || group.tag : topic || OTHER_COMMENTS);
}

// One link per comment with its comment ID as the text, followed by "(replaced by <ID>)" when a
// later comment replaced its record. Index comments come first, as "list 1", "list 2" and so on.
function traceTokens(group, base) {
  const replaced = item => (item.superseded_by_id ? ` (replaced by [${item.superseded_by_id}](${commentLink(base, item.superseded_by_id)}))`
    : item.superseded_by ? ` (replaced by ${publicText(item.superseded_by)})` : '');
  return [
    ...group.indexes.map((index, at) => `[list ${at + 1}](${commentLink(base, index.id)})`),
    ...group.entries.map(entry => `[${entry.id}](${commentLink(base, entry.id)})${replaced(entry)}`),
    ...group.marks.map(mark => `[${mark.id}](${commentLink(base, mark.id)})${replaced(mark)}`),
  ];
}

// The comment trace an issue body carries: one line per topic, listing that topic's index comments
// and then every comment none of them lists, each as a link that opens the comment. With
// `repository`, every link is a full URL; `topic` is a task page's own task name, as written.
function renderTraceBlockBody(number, trace, repository = '', topic = null) {
  const base = issueUrl(repository, number);
  const lines = [
    `<!-- programme-trace issue=${number} -->`,
    '**Comment trace** (generated from every comment on this issue). One line per topic; each number is a comment and opens it. Read the body first; within a topic, where comments disagree, the latest one wins. To put a comment under a topic, make its first line the topic (the task\'s name, or a short subject for a programme-wide comment) and its second line `---`.',
    '',
  ];
  const groups = traceGroups(trace, topic);
  for (const group of groups) lines.push(`- **${groupLabel(group, topic)}:** ${traceTokens(group, base).join(' · ')}`);
  if (!groups.length) lines.push('- No comments yet.');
  return lines.join('\n');
}

// What waits on the owner for one task, or null: an owner decision, a UAT, or a blocker.
function ownerWait(child) {
  if (!child) return null;
  if (child.lifecycle === 'WAITING_OWNER' || child.gate?.state === 'WAITING_OWNER') return 'your decision';
  if (['PENDING', 'UAT_PARTIAL_REQUIRED', 'UAT_FULL_REQUIRED'].includes(child.uat.state)) return `your UAT${child.pr.number ? ` on PR #${child.pr.number}` : ''}`;
  if (child.blockers.length) return `blocked: ${child.blockers.map(publicText).join('; ')}`;
  return null;
}

// The generated CURRENT summary: the tasks in progress, in Programme Graph order, each with its gate,
// PR, next step and anything waiting on the owner, then the top LATER task to start next. Queued
// work shows in the graph below it.
function renderCurrentBlockBody(parent, children, issues = new Map()) {
  const rows = graphOrder(parent, children, issues).map(outcome => ({ outcome, child: children.get(outcome.issue) }));
  const working = rows.filter(row => statusText(row.outcome, row.child) === 'IN PROGRESS').map(row => {
    const parts = [row.child.gate.role, row.child.pr.number ? `PR #${row.child.pr.number}` : null].filter(Boolean).join(', ');
    const wait = ownerWait(row.child);
    return `- ${taskName(row.outcome, issues.get(row.outcome.issue))} (#${row.outcome.issue})${parts ? `: ${parts}` : ''}${wait ? `; waiting on you: ${wait}` : ''}${row.child.next_action ? `; next: ${publicText(row.child.next_action)}` : ''}`;
  });
  // A task whose PR merged or whose issue closed is not picked, even before its state catches up.
  const next = rows.find(row => graphClass(row.outcome, row.child) === 'LATER' && row.child?.pr.state !== 'MERGED' && !issues.get(row.outcome.issue)?.closed_at);
  return [
    '<!-- programme-current -->',
    `_Generated from the programme state (revision ${parent.revision}). The Programme Graph follows; hand-written notes come after it._`,
    '',
    '**In progress**',
    ...(working.length ? working : ['- None.']),
    '',
    `**Start next:** ${next ? `${taskName(next.outcome, issues.get(next.outcome.issue))} (#${next.outcome.issue})` : 'None.'}`,
    '',
    ...attentionBlockLines(parent.attention),
  ].join('\n');
}

// The attention summary on the parent page, so a surface without `gh` can read it: the line, then up
// to ATTENTION_SHOWN open findings, newest first.
const ATTENTION_SHOWN = 10;
function attentionBlockLines(attention) {
  const open = openFindings(attention);
  return [
    `**${attentionLine(attention)}**`,
    ...open.slice(0, ATTENTION_SHOWN).map(entry => `- ${entry.state === 'acknowledged' ? '(acknowledged) ' : ''}${findingText(entry)}`),
    ...(open.length > ATTENTION_SHOWN ? [`- and ${open.length - ATTENTION_SHOWN} more: run programme.cjs attention`] : []),
  ];
}

// The links that open a task page or PR: the programme parent, any expected parents in between,
// the task, then its PR. GitHub turns each #n into a link.
function renderNavBlockBody(chain, pr) {
  return ['<!-- programme-nav -->', `**Path:** ${chain.map(number => `#${number}`).join(' > ')}${pr ? ` > PR #${pr}` : ''}`].join('\n');
}

function renderChildBlockBody(child, outcome) {
  const lines = [
    `<!-- programme-state child=${child.issue}@${child.revision} -->`,
    `**Status** (issue-${child.issue}.json revision ${child.revision}; generated, so edit the state document rather than this block)`,
    '',
    `- Status: ${outcome ? statusText(outcome, child) : '-'}; class: ${graphClass(outcome, child)}; lane: ${outcome ? laneText(outcome, child) : '-'}; release: ${publicText(child.release || '-')}`,
    `- Task: ${outcome ? descriptionText(outcome) : '-'}`,
    `- PR: ${prText(child)}; head ${shaLink(child.repository, child.pr.head)}; CI at head: ${checksText(child)}`,
    `- UAT: ${uatText(child)}; review: ${reviewText(child)}`,
    `- Next action: ${publicText(child.next_action)}`,
  ];
  if (child.blockers.length) lines.push(`- Blockers: ${child.blockers.map(publicText).join('; ')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Managed block in an issue body: the Toolkit versioned, hashed marker format
// (repo/scripts/toolkit-managed-block.cjs, format v2), implemented here so the skill folder stays
// self-contained. Bytes outside the markers are never changed.

function normalizeBlockBody(body) {
  return String(body).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

function blockDigest(body) { return sha256(normalizeBlockBody(body)).slice(0, 12); }

function renderBlock(body, version, name = BLOCK_NAME) {
  return [
    `<!-- AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:BEGIN ${name} v2 toolkit=${version} sha256=${blockDigest(body)} -->`,
    normalizeBlockBody(body),
    `<!-- AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:END ${name} -->`,
  ].join('\n');
}

const BLOCK_BEGIN = new RegExp(`^<!-- AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:BEGIN ([A-Z]+) v2 toolkit=(\\d+\\.\\d+\\.\\d+) sha256=([0-9a-f]{12}) -->$`);
const BLOCK_END = new RegExp(`^<!-- AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:END ([A-Z]+) -->$`);
// Only a line that starts as an HTML comment is a marker; rendered free text has `<` escaped.
const BLOCK_ANY = new RegExp(`^\\s*<!--\\s*AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:`);

// The one block with this name in a body, with offsets; `error` for broken, nested or duplicated
// markers. Blocks with other names are skipped.
function findStateBlock(text, name = BLOCK_NAME) {
  const source = String(text || '');
  const lines = [];
  for (let offset = 0; offset <= source.length;) {
    const next = source.indexOf('\n', offset);
    const stop = next === -1 ? source.length : next;
    const content = source.slice(offset, stop).replace(/\r$/, '');
    lines.push({ start: offset, end: offset + content.length, content });
    if (next === -1) break;
    offset = next + 1;
  }
  let found = null;
  let open = null;
  for (const [index, line] of lines.entries()) {
    if (!BLOCK_ANY.test(line.content)) continue;
    const begin = BLOCK_BEGIN.exec(line.content);
    const end = BLOCK_END.exec(line.content);
    if ((begin || end) && open && (begin || end[1] !== name)) return { error: `a block marker inside the ${name} block at line ${index + 1}` };
    if ((begin && begin[1] !== name) || (end && end[1] !== name)) continue;
    if (begin) {
      if (found) return { error: `duplicate ${name} block at line ${index + 1}` };
      open = { index, start: line.start, version: begin[2], digest: begin[3] };
      continue;
    }
    if (end && open) {
      const body = lines.slice(open.index + 1, index).map(entry => entry.content).join('\n');
      found = { start: open.start, end: line.end, version: open.version, digest: open.digest, body, tampered: open.digest !== blockDigest(body) };
      open = null;
      continue;
    }
    return { error: `malformed state block marker at line ${index + 1}` };
  }
  if (open) return { error: `${name} block BEGIN without END` };
  return { block: found };
}

// True when Toolkit version `a` (x.y.z) is newer than `b`.
function versionNewer(a, b) {
  const parts = value => String(value || '').split('.').map(part => Number(part) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let at = 0; at < 3; at += 1) if (left[at] !== right[at]) return left[at] > right[at];
  return false;
}

// The newest Toolkit version among a body's managed blocks, or null when it has none.
function newestBlockVersion(text) {
  let newest = null;
  for (const name of [BLOCK_NAME, CURRENT_BLOCK_NAME, NAV_BLOCK_NAME, TRACE_BLOCK_NAME]) {
    const version = findStateBlock(text, name).block?.version;
    if (version && (!newest || versionNewer(version, newest))) newest = version;
  }
  return newest;
}

// The body with the trace block written: replaced in place, else added at the end of the body.
function upsertTraceBlock(text, rendered) {
  const source = String(text || '');
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  const block = rendered.split('\n').join(eol);
  const { block: found, error } = findStateBlock(source, TRACE_BLOCK_NAME);
  if (error) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', error);
  if (found) return source.slice(0, found.start) + block + source.slice(found.end);
  const before = source.replace(/\s+$/, '');
  return `${before ? `${before}${eol}${eol}` : ''}${block}${eol}`;
}

// The body with the CURRENT summary written: replaced in place, else added right under the heading
// of the named status section (else under the first title, else at the top).
function upsertCurrentBlock(text, rendered, sectionName) {
  const source = String(text || '');
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  const block = rendered.split('\n').join(eol);
  const { block: found, error } = findStateBlock(source, CURRENT_BLOCK_NAME);
  if (error) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', error);
  if (found) return source.slice(0, found.start) + block + source.slice(found.end);
  const all = headings(source);
  const heading = (sectionName && all.find(entry => entry.text.toLowerCase() === String(sectionName).trim().toLowerCase())) || all.find(entry => entry.level === 1);
  const at = heading ? heading.end : 0;
  const before = source.slice(0, at).replace(/\s+$/, '');
  const after = source.slice(at).replace(/^\s+/, '');
  return `${before ? `${before}${eol}${eol}` : ''}${block}${after ? `${eol}${eol}${after}` : eol}`;
}

// The body with the links block first: replaced in place, else added at the very top.
function upsertNavBlock(text, rendered) {
  const source = String(text || '');
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  const block = rendered.split('\n').join(eol);
  const { block: found, error } = findStateBlock(source, NAV_BLOCK_NAME);
  if (error) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', error);
  if (found) return source.slice(0, found.start) + block + source.slice(found.end);
  const after = source.replace(/^\s+/, '');
  return `${block}${eol}${after ? `${eol}${after}` : ''}`;
}

// Index comment bodies for a topic's comment links, each under the comment size limit. The links
// sit on one line, separated by " · ", as in the body's trace. A topic's index comment carries the
// topic on its first line, so it stays in that topic's list; `label` is the topic as written (for
// an untopiced list, the task page's own name, which names the comment without tagging it).
function indexCommentBodies(number, links, intent, tag = null, label = null) {
  const name = label || tag;
  const head = (part, total) => [...(tag ? [name, '---'] : []), INDEX_COMMENT_MARKER, `<!-- programme-trace intent=${intent} part=${part}/${total} -->`,
    `## Comment trace for #${number}: ${publicText(name || OTHER_COMMENTS)}`, ''];
  const chunks = [[]];
  let size = 0;
  for (const link of links) {
    if (size + link.length + 3 > INDEX_COMMENT_LIMIT && chunks.at(-1).length) { chunks.push([]); size = 0; }
    chunks.at(-1).push(link);
    size += link.length + 3;
  }
  return chunks.map((chunk, at) => [...head(at + 1, chunks.length), chunk.join(' · '), ''].join('\n'));
}

// Headings outside fenced code, with their level, text and line offsets.
function headings(text) {
  const found = [];
  let fenced = false;
  for (let offset = 0; offset < text.length;) {
    const next = text.indexOf('\n', offset);
    const stop = next === -1 ? text.length : next;
    const line = text.slice(offset, stop).replace(/\r$/, '');
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) found.push({ level: heading[1].length, text: heading[2].trim(), start: offset, end: next === -1 ? stop : next + 1 });
    offset = next === -1 ? text.length : next + 1;
  }
  return found;
}

// Where the block belongs. Generated parts lead and hand-written text follows: directly after the
// `after_block` managed block (the parent's CURRENT summary, so the Programme Graph sits right under
// it); else in place of the `replace_section` section; else right after the `after_section`
// section; else directly under the first title, above any hand-written note; else under the links
// block at the top; else at the top.
function blockTarget(text, placement = {}) {
  const anchor = placement.after_block ? findStateBlock(text, placement.after_block).block : null;
  if (anchor) return { start: anchor.end, end: anchor.end, replaces: false };
  const all = headings(text);
  // A section ends at the next heading of its level or higher, or at the next managed block, so a
  // last section never runs into the comment trace or the text after it.
  const markers = [...text.matchAll(/^<!-- AI-AGENT-TOOLKIT:/gm)].map(match => match.index);
  const sectionEnd = heading => {
    const next = all.find(entry => entry.start > heading.start && entry.level <= heading.level);
    const marker = markers.find(at => at > heading.start);
    return Math.min(next ? next.start : text.length, marker ?? text.length);
  };
  const named = name => name && all.find(entry => entry.text.toLowerCase() === String(name).trim().toLowerCase());
  const replaced = named(placement.replace_section);
  if (replaced) return { start: replaced.start, end: sectionEnd(replaced), replaces: true };
  const after = named(placement.after_section);
  if (after) return { start: sectionEnd(after), end: sectionEnd(after), replaces: false };
  const title = all.find(entry => entry.level === 1);
  if (title) return { start: title.end, end: title.end, replaces: false };
  const nav = findStateBlock(text, NAV_BLOCK_NAME).block;
  return nav ? { start: nav.end, end: nav.end, replaces: false } : { start: 0, end: 0, replaces: false };
}

// The text without the `replace_section` section, when the block goes after `after_block` instead:
// the section it replaces is removed once, wherever the block lands.
function withoutReplacedSection(text, placement = {}) {
  if (!placement.after_block || !placement.replace_section || !findStateBlock(text, placement.after_block).block) return { text, dropped: false };
  const target = blockTarget(text, { replace_section: placement.replace_section });
  if (!target.replaces) return { text, dropped: false };
  const before = trimEnd(text.slice(0, target.start));
  const after = trimStart(text.slice(target.end));
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  return { text: before && after ? `${before}${eol}${eol}${after}` : before || after, dropped: true };
}

// Only blank lines are trimmed at a join: a line's own trailing spaces (a Markdown line break) and
// the indent of the next line (an indented code line) are kept.
const blankOnly = text => (/\S/.test(text) ? text : '');
const trimEnd = text => blankOnly(text.replace(/(?:\r?\n[ \t]*)+$/, ''));
const trimStart = text => blankOnly(text.replace(/^(?:[ \t]*\r?\n)+/, ''));

// The body with the state block written. An existing block in its place is replaced in place, byte
// for byte around it; one anywhere else (higher or lower) moves to its place, as does one whose
// `replace_section` is still in the body. A new block goes to its place. Hand-written text is
// never changed, only moved past. Uses the body's own line ending; `moved` says whether the block
// changed position.
function upsertStateBlock(text, rendered, placement = {}) {
  const source = String(text || '');
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  const block = rendered.split('\n').join(eol);
  const { block: found, error } = findStateBlock(source);
  if (error) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', error);
  let rest = source;
  let before = '';
  if (found) {
    before = trimEnd(source.slice(0, found.start));
    const after = trimStart(source.slice(found.end));
    rest = before && after ? `${before}${eol}${eol}${after}` : before || after;
  }
  const cut = withoutReplacedSection(rest, placement);
  const target = blockTarget(cut.text, placement);
  if (found && !cut.dropped && !target.replaces && trimEnd(cut.text.slice(0, target.start)) === before) {
    return { body: source.slice(0, found.start) + block + source.slice(found.end), start: found.start, end: found.start + block.length, moved: false };
  }
  const head = trimEnd(cut.text.slice(0, target.start));
  const rawTail = trimStart(cut.text.slice(target.end));
  // A block moved up from the very end leaves the body's final line ending behind it; keep one.
  const tail = rawTail && /\n$/.test(source) && !/\n$/.test(rawTail) ? `${rawTail}${eol}` : rawTail;
  const lead = head ? `${head}${eol}${eol}` : '';
  const body = `${lead}${block}${tail ? `${eol}${eol}${tail}` : eol}`;
  return { body, start: lead.length, end: lead.length + block.length, moved: Boolean(found) };
}

// ---------------------------------------------------------------------------------------------
// Owners with effects

// The only place that runs `gh api`. Returns status and parsed JSON; never retries.
// A takeover (STALE_WRITER) or the loss of the pass lock (PASS_LOCK_LOST) stops the whole pass at
// once; an intent it leaves IN_FLIGHT is recovered by the next pass.
const STOPS_PASS = new Set(['STALE_WRITER', 'PASS_LOCK_LOST']);

class GitHubTransport {
  constructor({ ghPath, run = spawnSync, timeoutMs = 120000 }) {
    if (!ghPath) throw new ProgrammeError('EXECUTABLE_NOT_FOUND', 'GitHubTransport needs the full path to gh.');
    this.ghPath = ghPath;
    this.run = run;
    this.timeoutMs = timeoutMs;
  }

  request(method, apiPath, body) {
    const args = ['api', '-i', '-X', method, apiPath, '-H', 'Accept: application/vnd.github+json'];
    if (body !== undefined) args.push('--input', '-');
    const result = this.run(this.ghPath, args, {
      encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body),
      maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: this.timeoutMs,
    });
    if (result.error) throw new ProgrammeError('GH_FAILED', `gh could not run: ${result.error.message}`);
    // gh exits 4 when it is not signed in, before any request: a refusal, never "unreachable".
    if (result.status === 4 && !/^HTTP\/[\d.]+ \d{3}/m.test(String(result.stdout || ''))) {
      throw new ProgrammeError('GH_AUTH', 'gh is not signed in on this computer (gh auth login), so GitHub was not read.');
    }
    return GitHubTransport.parse(String(result.stdout || ''), String(result.stderr || ''));
  }

  // `gh api -i` prints one or more status/header blocks, a blank line, then the body.
  static parse(stdout, stderr = '') {
    const statuses = [...stdout.matchAll(/^HTTP\/[\d.]+ (\d{3})[^\n]*$/gm)];
    if (!statuses.length) throw new ProgrammeError('GH_FAILED', `gh returned no HTTP status: ${stderr.trim().slice(0, 300)}`);
    const last = statuses.at(-1);
    const rest = stdout.slice(last.index);
    const split = rest.search(/\r?\n\r?\n/);
    const text = split === -1 ? '' : rest.slice(split).replace(/^\r?\n\r?\n/, '');
    let json = null;
    if (text.trim()) {
      try { json = JSON.parse(text); }
      catch { json = { message: text.trim().slice(0, 300) }; }
    }
    return { status: Number(last[1]), json };
  }

  graphql(query, variables) {
    const response = this.request('POST', 'graphql', { query, variables });
    if (response.status !== 200 || response.json?.errors?.length) {
      throw new ProgrammeError('GH_GRAPHQL_FAILED', `GraphQL query failed (${response.status}): ${response.json?.errors?.[0]?.message || response.json?.message || ''}`);
    }
    return response.json.data;
  }
}

function okStatus(status) { return status >= 200 && status < 300; }

function ghFailure(response, what) {
  return new ProgrammeError('GH_FAILED', `${what} failed (${response.status}): ${response.json?.message || 'no message'}`, { status: response.status });
}

// Reads and compare-and-swap writes of state documents in a private GitHub repository (store kind
// `github`), through the Contents API.
class StateStore {
  constructor({ transport, store, now = () => new Date().toISOString(), toolkitVersion = null }) {
    this.transport = transport;
    this.store = store;
    this.now = now;
    this.toolkitVersion = toolkitVersion;
    this.writes = 0;
    // Per document this process wrote: the blob its write replaced and the version it wrote.
    // GitHub can serve the replaced version on a branch read made right after the write.
    this.ownWrites = new Map();
  }

  docPath(kind, number) {
    return `${this.store.path}${kind === 'parent' ? 'parent' : 'issue'}-${number}.json`;
  }

  contentsPath(kind, number) {
    return this.encodedContents(this.docPath(kind, number));
  }

  encodedContents(docPath) {
    return `repos/${this.store.repository}/contents/${docPath.split('/').map(encodeURIComponent).join('/')}`;
  }

  // Checkpoint journals: one file per executor session and assignment, written only by that session.
  journalDir(issue) { return `${this.store.path}journal/issue-${issue}`; }

  journalPath(issue, name) { return `${this.journalDir(issue)}/${name}`; }

  // The store must exist, be private and be writable, and the branch must exist. No fallback store.
  verify() {
    const repo = this.transport.request('GET', `repos/${this.store.repository}`);
    const reason = repo.status !== 200 ? `it could not be read (${repo.status})`
      : repo.json.private !== true ? 'it is not private'
        : repo.json.permissions?.push !== true ? 'this account cannot write to it' : null;
    if (reason) throw new ProgrammeError('STATE_STORE_UNVERIFIED', `The state store ${this.store.repository} was not used because ${reason}. Choose a private repository you can write to in .github/toolkit-programme.json.`);
    const branch = this.transport.request('GET', `repos/${this.store.repository}/branches/${encodeURIComponent(this.store.branch)}`);
    if (branch.status !== 200) throw new ProgrammeError('STATE_STORE_UNVERIFIED', `The state store branch ${this.store.branch} could not be read (${branch.status}).`);
    return true;
  }

  read(kind, number) {
    return this.readPath(this.docPath(kind, number), kind);
  }

  // Reads the branch, or a fixed commit when `ref` is given. A branch read that still shows the
  // version this process's own write replaced returns the written version instead.
  readPath(docPath, kind, ref = null) {
    const response = this.transport.request('GET', `${this.encodedContents(docPath)}?ref=${encodeURIComponent(ref || this.store.branch)}`);
    const own = ref ? null : this.ownWrites.get(docPath);
    if (own && (response.status === 404 ? own.replaced === null : response.status === 200 && response.json.sha === own.replaced)) {
      return { doc: clone(own.doc), sha: own.sha };
    }
    if (response.status === 404) return { doc: null, sha: null };
    if (response.status !== 200) throw ghFailure(response, `Reading ${docPath}`);
    if (response.json.encoding !== 'base64') throw new ProgrammeError('STATE_INVALID', `${docPath} is too large to read through the Contents API.`);
    let doc;
    try { doc = JSON.parse(Buffer.from(response.json.content, 'base64').toString('utf8')); }
    catch { throw new ProgrammeError('STATE_INVALID', `${docPath} is not valid JSON.`); }
    return { doc: this.validateRead(kind, doc), sha: response.json.sha };
  }

  // State documents and journals, or a public state branch's sidecars and checkpoint.
  validateRead(kind, doc) {
    if (kind === 'sidecar') return assertSidecar(doc);
    if (kind === 'checkpoint') return assertCheckpoint(doc);
    return assertValid(kind, doc);
  }

  // PUT with compare-and-swap, then read back. A stale sha (409) or a create over an existing file
  // (422) is STATE_CONFLICT.
  putVerified(docPath, kind, text, sha, message) {
    const response = this.transport.request('PUT', this.encodedContents(docPath), {
      message, content: Buffer.from(text, 'utf8').toString('base64'), branch: this.store.branch, ...(sha ? { sha } : {}),
    });
    if (response.status === 409 || (response.status === 422 && !sha)) {
      this.ownWrites.delete(docPath);
      throw new ProgrammeError('STATE_CONFLICT', `${docPath} moved since it was read.`, { status: response.status });
    }
    if (!okStatus(response.status)) throw ghFailure(response, `Writing ${docPath}`);
    this.writes += 1;
    // Read back at the commit the write created: a branch read can still serve the old version.
    const commit = response.json?.commit?.sha;
    const blob = response.json?.content?.sha;
    if (!commit || !blob) throw new ProgrammeError('STATE_READBACK_MISMATCH', `${docPath} was written but GitHub returned no commit to read it back from.`);
    const readback = this.readPath(docPath, kind, commit);
    if (!readback.doc || canonicalText(readback.doc) !== text || readback.sha !== blob) {
      throw new ProgrammeError('STATE_READBACK_MISMATCH', `${docPath} did not read back as written.`);
    }
    this.ownWrites.set(docPath, { replaced: sha || null, doc: clone(readback.doc), sha: blob });
    this.lastCommit = commit;
    return { outcome: 'WRITTEN', doc: readback.doc, sha: blob };
  }

  listJournals(issue) {
    const dir = this.journalDir(issue);
    const response = this.transport.request('GET', `${this.encodedContents(dir)}?ref=${encodeURIComponent(this.store.branch)}`);
    if (response.status === 404) return [];
    if (response.status !== 200 || !Array.isArray(response.json)) throw ghFailure(response, `Listing ${dir}`);
    return response.json.filter(entry => entry?.type === 'file').map(entry => {
      const match = JOURNAL_FILE.exec(String(entry.name));
      return match ? { name: entry.name, assignment: match[1], session_hash: match[2], sha: entry.sha } : null;
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  readJournal(issue, name) {
    return this.readPath(this.journalPath(issue, name), 'journal');
  }

  // Writes a journal only when something besides its timestamp changed.
  writeJournal(issue, name, next, { sha, previous }) {
    const strip = doc => { const copy = clone(doc); delete copy.volatile; return JSON.stringify(canonical(copy)); };
    if (previous && strip(previous) === strip(next)) return { outcome: 'NOOP', doc: previous, sha };
    const doc = { ...clone(next), volatile: { written_at: this.now() } };
    assertValid('journal', doc);
    return this.putVerified(this.journalPath(issue, name), 'journal', canonicalText(doc), sha, `programme journal: issue-${issue} ${name} seq ${doc.seq}`);
  }

  // When the store last committed a document, by GitHub's clock.
  lastCommitDate(kind, number) {
    const docPath = this.docPath(kind, number);
    const response = this.transport.request('GET', `repos/${this.store.repository}/commits?path=${encodeURIComponent(docPath)}&sha=${encodeURIComponent(this.store.branch)}&per_page=1`);
    if (response.status !== 200 || !Array.isArray(response.json)) throw ghFailure(response, `Reading the history of ${docPath}`);
    return response.json[0]?.commit?.committer?.date || null;
  }

  // Writes `next` only when its state differs from `previous`. Bumps the revision only when the
  // content changes. Rejected compare-and-swap surfaces as STATE_CONFLICT; every write is read back.
  write(kind, number, next, { sha, previous }) {
    if (previous && sameState(previous, next)) return { outcome: 'NOOP', doc: previous, sha };
    const doc = clone(next);
    doc.revision = previous ? previous.revision + (contentDigest(previous) === contentDigest(doc) ? 0 : 1) : Math.max(1, doc.revision || 0);
    doc.volatile = { written_at: this.now(), ...(this.toolkitVersion ? { toolkit: this.toolkitVersion } : {}) };
    assertValid(kind, doc);
    return this.putVerified(this.docPath(kind, number), kind, canonicalText(doc), sha,
      `programme state: ${kind === 'parent' ? 'parent' : 'issue'}-${number} revision ${doc.revision}`);
  }

  // Read, authorise, change and write with compare-and-swap. On a conflict the change is re-applied
  // to the new version only when the other writer touched different top-level fields and the fence
  // did not move; otherwise STATE_CONFLICT or STALE_WRITER.
  mutate(kind, number, { writer, parentDoc = null, change, create = null, authorise = true }) {
    let { doc: base, sha } = this.read(kind, number);
    if (!base && create) base = null;
    else if (!base) throw new ProgrammeError('STATE_MISSING', `${this.docPath(kind, number)} does not exist yet.`);
    const origin = base;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (authorise) authoriseWrite(kind, base, kind === 'parent' ? null : parentDoc, writer);
      const start = base || create();
      const next = change(clone(start));
      if (!next) return { outcome: 'NOOP', doc: base, sha };
      try {
        return this.write(kind, number, next, { sha, previous: base });
      } catch (error) {
        if (error.code !== 'STATE_CONFLICT') throw error;
        const fresh = this.read(kind, number);
        if (!fresh.doc) throw error;
        if (origin && (fresh.doc.fence.epoch !== origin.fence.epoch || fresh.doc.fence.holder_session !== origin.fence.holder_session)) {
          throw new ProgrammeError('STALE_WRITER', `${this.docPath(kind, number)} is now held by the ${holderDescription(fresh.doc, kind, parentDoc)}; this write was refused.`);
        }
        const touched = Object.keys({ ...start, ...next }).filter(key => key !== 'revision' && key !== 'volatile'
          && JSON.stringify(canonical(start[key])) !== JSON.stringify(canonical(next[key])));
        const theirs = Object.keys({ ...(origin || {}), ...fresh.doc }).filter(key => key !== 'revision' && key !== 'volatile'
          && JSON.stringify(canonical(origin?.[key])) !== JSON.stringify(canonical(fresh.doc[key])));
        const overlap = touched.filter(key => theirs.includes(key));
        if (!origin || overlap.length) {
          throw new ProgrammeError('STATE_CONFLICT', `${this.docPath(kind, number)} was changed by another writer in ${overlap.join(', ') || 'the same fields'}; held for the controller.`);
        }
        base = fresh.doc;
        sha = fresh.sha;
      }
    }
    throw new ProgrammeError('STATE_CONFLICT', `${this.docPath(kind, number)} kept moving; held for the controller.`);
  }
}

// State store backends by binding `store.kind`. Another backend joins here with the same read,
// write and mutate contract (compare-and-swap, readback, no write for unchanged state).
const STORE_BACKENDS = Object.freeze({ github: StateStore });

// ---------------------------------------------------------------------------------------------
// The public state branch (binding `state`)
//
// With `state` in the merged binding, parent and child documents live on the bound repository itself,
// on STATE_BRANCH under STATE_PATH, as public views: no `private` part, no gate route, and sessions
// only as hashes. Everything else stays in the private store: the journals (unchanged), one private
// sidecar per written revision (the whole document, joined to the public bytes by revision and
// digest) and the checkpoint (the branch head and each file's digest), which tells a deleted branch
// from one never created and drives its restore. A local copy of the checkpoint is kept too, so a
// missing store checkpoint holds instead of reading as "never created". Nothing here runs from a hook:
// detection and restore run inside the store's read path, from a command or `refresh`.

const STATE_SCHEMA = Object.freeze({ sidecar: 'toolkit.programme-state-sidecar.v1', checkpoint: 'toolkit.programme-state-checkpoint.v1' });
const SHA256 = /^[0-9a-f]{64}$/;
const DOC_NAME = /^(?:parent|issue)-[1-9][0-9]*$/;
// Sidecars of this many revisions back per document are kept.
const SIDECAR_KEEP = 20;
// A session ID shape (the hosts' UUIDs); never public, whatever field carries it.
const SESSION_ID_SHAPE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
// Something that reads as a host name: three dotted labels ending in letters.
const HOST_LIKE = /\b[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/;
const PUBLIC_SHAPES = Object.freeze({
  parent: { all: SHAPES.parent.all.filter(key => key !== 'private'), optional: SHAPES.parent.optional },
  child: { all: SHAPES.child.all.filter(key => key !== 'private'), optional: SHAPES.child.optional },
  fence: { all: ['epoch', 'holder_prefix', 'holder_session_hash'] },
  gate: { all: ['role', 'state', 'session_hash', 'assignment', 'returns'], optional: ['assignment'] },
  volatile: { all: ['written_at', 'toolkit'], optional: ['written_at', 'toolkit'] },
});

const documentName = (kind, number) => `${kind === 'parent' ? 'parent' : 'issue'}-${number}`;
const kindOfName = name => (name.startsWith('parent-') ? 'parent' : 'child');
const commitLine = text => `${text} [skip ci]`;

function stateInvalid(what, errors) {
  return new ProgrammeError('STATE_INVALID', `${what} is not public-safe: ${errors[0]}`, { errors });
}

// Free text a person or the controller writes. It may not carry a path, address, host, mention or
// session ID; the render limits and the secret screen still apply.
function freeTextFields(kind, doc) {
  if (kind === 'parent') {
    return [['release_plan.record', doc.release_plan?.record],
      ...(Array.isArray(doc.outcomes) ? doc.outcomes : []).flatMap((outcome, index) => ['label', 'name', 'description', 'lane'].map(field => [`outcomes[${index}].${field}`, outcome?.[field]]))];
  }
  return [['release', doc.release], ['next_action', doc.next_action],
    ...(Array.isArray(doc.blockers) ? doc.blockers : []).map((value, index) => [`blockers[${index}]`, value]),
    ...(Array.isArray(doc.review?.verdicts) ? doc.review.verdicts : []).map((verdict, index) => [`review.verdicts[${index}].reviewer`, verdict?.reviewer])];
}

function everyString(value, at, visit) {
  if (typeof value === 'string') visit(value, at);
  else if (Array.isArray(value)) value.forEach((entry, index) => everyString(entry, `${at}[${index}]`, visit));
  else if (isObject(value)) for (const [key, entry] of Object.entries(value)) { visit(key, `${at} key`); everyString(entry, `${at}.${key}`, visit); }
}

// The public view of a document as the branch holds it: closed keys, hashes for sessions, and only
// public-safe text. Returns the error list; every read and write of the branch runs it.
function publicErrors(kind, doc) {
  const errors = [];
  if (!isObject(doc)) return ['the document must be an object'];
  checkShape(errors, doc, PUBLIC_SHAPES[kind], 'document');
  checkShape(errors, doc.fence, PUBLIC_SHAPES.fence, 'fence');
  check(errors, isObject(doc.fence) && optional(doc.fence.holder_session_hash, value => SESSION_HASH.test(String(value))), 'fence.holder_session_hash must be a session hash or null');
  if (kind === 'child') {
    checkShape(errors, doc.gate, PUBLIC_SHAPES.gate, 'gate');
    check(errors, isObject(doc.gate) && optional(doc.gate.session_hash, value => SESSION_HASH.test(String(value))), 'gate.session_hash must be a session hash or null');
  }
  if (doc.volatile !== undefined) {
    checkShape(errors, doc.volatile, PUBLIC_SHAPES.volatile, 'volatile');
    check(errors, isObject(doc.volatile) && Object.values(doc.volatile).every(isText), 'volatile must hold text');
  }
  // Everything else is checked as the full document it stands for.
  if (!errors.length) {
    const full = { ...clone(doc), private: {}, fence: { epoch: doc.fence.epoch, holder_prefix: doc.fence.holder_prefix, holder_session: doc.fence.holder_session_hash } };
    if (kind === 'child') {
      const { session_hash: hash, ...gate } = full.gate;
      full.gate = { ...gate, session_id: hash, route: null };
    }
    errors.push(...(kind === 'parent' ? validateParent(full) : validateChild(full)));
  }
  everyString(doc, 'document', (value, at) => {
    if (value.includes('://')) errors.push(`${at} holds an address`);
    if (SESSION_ID_SHAPE.test(value)) errors.push(`${at} holds a session ID`);
  });
  for (const [at, value] of freeTextFields(kind, doc)) {
    if (typeof value !== 'string') continue;
    if (value.includes('\\')) errors.push(`${at} holds a path`);
    if (value.includes('@')) errors.push(`${at} holds an @ (an address or a mention)`);
    if (HOST_LIKE.test(value)) errors.push(`${at} holds something that reads as a host name`);
  }
  return errors;
}

function validatePublic(kind, doc) {
  const errors = publicErrors(kind, doc);
  if (errors.length) throw stateInvalid(`The public ${kind} document`, errors);
  return doc;
}

// The session IDs a document names: its holder, its gate's session and retired parent holders.
function sessionsOf(doc) {
  return [doc?.fence?.holder_session, doc?.gate?.session_id, ...(Array.isArray(doc?.private?.retired_holders) ? doc.private.retired_holders : [])];
}

// The public view of a full document. Raw session IDs become hashes; a raw session ID of this
// document, or one of `sessions` (those of the documents read with it), anywhere else refuses it.
function publicView(kind, doc, sessions = []) {
  const view = clone(doc);
  delete view.private;
  const { epoch, holder_prefix: prefix, holder_session: session } = doc.fence;
  view.fence = { epoch, holder_prefix: prefix, holder_session_hash: session ? sessionHashOf(session) : null };
  const raw = [...sessionsOf(doc), ...sessions];
  if (kind === 'child') {
    const { route, session_id: id, ...gate } = view.gate;
    view.gate = { ...gate, session_hash: id ? (SESSION_HASH.test(id) ? id : sessionHashOf(id)) : null };
  }
  const text = JSON.stringify(view);
  const leaked = raw.filter(value => isText(value) && value.length >= 8 && !SESSION_HASH.test(value)).some(value => text.includes(value));
  if (leaked) throw stateInvalid(`The public ${kind} document`, ['a raw session ID is in the public part']);
  return validatePublic(kind, view);
}

function assertSidecar(doc) {
  const errors = [];
  check(errors, isObject(doc), 'sidecar must be an object');
  if (isObject(doc)) {
    checkShape(errors, doc, { all: ['schema', 'repository', 'document', 'revision', 'public_sha256', 'doc'] }, 'sidecar');
    check(errors, doc.schema === STATE_SCHEMA.sidecar, `schema must be ${STATE_SCHEMA.sidecar}`);
    check(errors, REPO.test(String(doc.repository || '')), 'repository must be owner/name');
    check(errors, DOC_NAME.test(String(doc.document || '')), 'document must be parent-<n> or issue-<n>');
    check(errors, isInt(doc.revision), 'revision must be a whole number');
    check(errors, SHA256.test(String(doc.public_sha256 || '')), 'public_sha256 must be a sha256');
    if (!errors.length) {
      assertValid(kindOfName(doc.document), doc.doc);
      check(errors, doc.doc.revision === doc.revision, 'the document revision must be the sidecar revision');
    }
  }
  if (errors.length) throw new ProgrammeError('STATE_INVALID', `A state sidecar is invalid: ${errors[0]}`, { errors });
  return doc;
}

function assertCheckpoint(doc) {
  const errors = [];
  check(errors, isObject(doc), 'checkpoint must be an object');
  if (isObject(doc)) {
    checkShape(errors, doc, { all: ['schema', 'repository', 'branch', 'head_sha', 'files', 'written_at', 'migrated'], optional: ['migrated'] }, 'checkpoint');
    check(errors, doc.schema === STATE_SCHEMA.checkpoint, `schema must be ${STATE_SCHEMA.checkpoint}`);
    check(errors, REPO.test(String(doc.repository || '')), 'repository must be owner/name');
    check(errors, doc.branch === STATE_BRANCH, `branch must be ${STATE_BRANCH}`);
    check(errors, isSha(doc.head_sha), 'head_sha must be a full commit SHA');
    check(errors, isText(doc.written_at), 'written_at must be a date and time');
    check(errors, isObject(doc.files) && Object.entries(doc.files).every(([name, entry]) => DOC_NAME.test(name) && isObject(entry)
      && Object.keys(entry).length === 2 && isInt(entry.revision) && SHA256.test(String(entry.sha256))), 'files must map documents to their revision and sha256');
    check(errors, doc.migrated === undefined || (isObject(doc.migrated) && Object.keys(doc.migrated).length === 2 && isSha(doc.migrated.head)
      && isObject(doc.migrated.files) && Object.entries(doc.migrated.files).every(([name, blob]) => DOC_NAME.test(name) && isSha(blob))), 'migrated must hold the move commit and each private document blob');
  }
  if (errors.length) throw new ProgrammeError('STATE_INVALID', `The state checkpoint is invalid: ${errors[0]}`, { errors });
  return doc;
}

// Parent and child documents on the public state branch, with their private parts in the private
// store. It keeps StateStore's per-file compare-and-swap PUT, read-back and conflict handling (mutate)
// unchanged; reads join each public file to its sidecar, and writes put the sidecar first, then the
// public file, then the checkpoint.
class BranchStateStore extends StateStore {
  constructor({ transport, binding, now = () => new Date().toISOString(), toolkitVersion = null, localCheckpoint = null }) {
    const block = binding?.state;
    if (!isObject(block) || block.kind !== 'branch' || block.branch !== STATE_BRANCH || block.path !== STATE_PATH) {
      throw new ProgrammeError('BINDING_INVALID', `The public state branch is always ${STATE_BRANCH}, folder ${STATE_PATH}, on the bound repository.`);
    }
    if (!isObject(binding.store) || !Object.hasOwn(STORE_BACKENDS, binding.store.kind)) {
      throw new ProgrammeError('BINDING_INVALID', 'The public state branch needs the private store beside it.');
    }
    super({ transport, store: { kind: 'branch', repository: binding.repository, branch: STATE_BRANCH, path: STATE_PATH }, now, toolkitVersion });
    this.binding = binding;
    this.private = new STORE_BACKENDS[binding.store.kind]({ transport, store: binding.store, now, toolkitVersion });
    this.localCheckpoint = localCheckpoint;
    this.branch = null;
    this.checkpoint = null;
    this.held = null;
    this.events = [];
    this.joined = new Map();
    this.sessions = new Set();
  }

  // The public file holds only what validatePublic allows.
  validateRead(kind, doc) { return validatePublic(kind, doc); }

  // The private store must be private, readable and writable. The bound repository is checked by
  // bindRepository; the branch itself by the read path.
  verify() { return this.private.verify(); }

  // Journals stay in the private store, unchanged.
  journalDir(issue) { return this.private.journalDir(issue); }
  journalPath(issue, name) { return this.private.journalPath(issue, name); }
  listJournals(issue) { return this.private.listJournals(issue); }
  readJournal(issue, name) { return this.private.readJournal(issue, name); }
  writeJournal(issue, name, next, options) { return this.private.writeJournal(issue, name, next, options); }

  sidecarDir(name) { return `${this.binding.store.path}private/${name}`; }
  sidecarPath(name, revision, digest) { return `${this.sidecarDir(name)}/r${revision}-${digest.slice(0, 16)}.json`; }
  checkpointPath() { return `${this.binding.store.path}checkpoint.json`; }

  note(code, text) {
    this.events.push({ code, text });
  }

  // What this store did to the branch, for command output: restored, rebuilt, recomputed, held.
  stateBranch() {
    return { repository: this.binding.repository, branch: STATE_BRANCH, path: STATE_PATH, events: this.events.map(event => ({ ...event })) };
  }

  branchHead() {
    const response = this.transport.request('GET', `repos/${this.binding.repository}/branches/${encodeURIComponent(STATE_BRANCH)}`);
    if (response.status === 404) return null;
    if (response.status !== 200 || !isSha(response.json?.commit?.sha)) throw ghFailure(response, `Reading the state branch ${STATE_BRANCH}`);
    return response.json.commit.sha;
  }

  readCheckpoint() {
    return this.private.readPath(this.checkpointPath(), 'checkpoint');
  }

  hold(code, text) {
    this.held = new ProgrammeError(code, text);
    this.note(code, text);
    throw this.held;
  }

  // Once per store: is the branch there, deleted (restore it) or never created? A branch missing with
  // a checkpoint anywhere was deleted, never new; it is restored only by a digest-verified path.
  ensureBranch() {
    if (this.held) throw this.held;
    if (this.branch) return this.branch;
    const head = this.branchHead();
    const stored = this.readCheckpoint();
    this.checkpoint = stored.doc ? { doc: stored.doc, sha: stored.sha } : { doc: null, sha: stored.sha };
    if (head) {
      // A branch read can lag a write made elsewhere: read the head once more before recomputing.
      const settled = stored.doc && stored.doc.head_sha !== head ? this.branchHead() : head;
      this.branch = { exists: true, head: settled };
      if (!stored.doc || stored.doc.head_sha !== settled) this.recomputeCheckpoint(settled);
      this.checkMigration();
      return this.branch;
    }
    if (!stored.doc) {
      const local = this.localCheckpoint?.read() || null;
      if (local) {
        this.hold('STATE_RESTORE_HELD', `The state branch ${STATE_BRANCH} is missing, and only this computer's copy of its checkpoint is left (the private store has none). It is not restored from a local copy and never started empty. Controller: check the private store's checkpoint.json, then run again.`);
      }
      this.branch = { exists: false };
      return this.branch;
    }
    this.branch = this.restore(stored.doc);
    return this.branch;
  }

  // The private store's own parent and child documents must be exactly as migrate-state moved them.
  // One that changed or appeared since was written through a binding without `state` (before the
  // binding pull request merged, or on a computer whose merged binding was not read again yet), and
  // the branch does not hold it: hold, never read past it.
  checkMigration() {
    const moved = this.checkpoint?.doc?.migrated;
    if (!moved) return;
    const dir = this.binding.store.path.replace(/\/$/, '');
    const listing = this.transport.request('GET', `${this.private.encodedContents(dir)}?ref=${encodeURIComponent(this.binding.store.branch)}`);
    if (listing.status !== 200 && listing.status !== 404) throw ghFailure(listing, `Listing ${dir} in the private store`);
    const now = Object.fromEntries((listing.status === 200 && Array.isArray(listing.json) ? listing.json : [])
      .filter(entry => entry?.type === 'file' && DOC_NAME.test(String(entry.name).replace(/\.json$/, '')) && /\.json$/.test(String(entry.name)))
      .map(entry => [String(entry.name).replace(/\.json$/, ''), entry.sha]));
    const changed = [...new Set([...Object.keys(now), ...Object.keys(moved.files)])].filter(name => now[name] !== moved.files[name]).sort();
    if (changed.length) {
      this.hold('STATE_MIGRATION_STALE', `${changed.join(', ')} changed in the private store after migrate-state --apply (a write made before the binding pull request merged), so the state branch is behind it. Nothing was read or written. Controller: stop the programme sweep, then run migrate-state --dry-run and --apply again; it moves the newer documents onto the branch while nothing has been written there since the move.`);
    }
  }

  // { head, files } of the move when nothing has been written to the branch since migrate-state moved
  // the documents (so a second move may replace them), else null.
  headSinceMove() {
    const stored = this.readCheckpoint().doc;
    const head = this.branchHead();
    return stored?.migrated && head && stored.migrated.head === head && stored.head_sha === head ? { head, files: stored.migrated.files } : null;
  }

  // A file's public text at a commit, or null.
  textAt(file, ref) {
    const response = this.transport.request('GET', `${this.encodedContents(file)}?ref=${encodeURIComponent(ref)}`);
    if (response.status === 404) return null;
    if (response.status !== 200 || response.json?.encoding !== 'base64') throw ghFailure(response, `Reading ${file} at ${ref}`);
    return Buffer.from(response.json.content, 'base64').toString('utf8');
  }

  // Restore, in order: the ref at the checkpoint head if GitHub still serves it with every file's
  // digest matching; else a commit rebuilt from the sidecars' public bytes if every digest matches;
  // else hold. Intents must be settled first. Nothing is ever started empty.
  restore(checkpoint) {
    const names = Object.keys(checkpoint.files).sort();
    const settle = docs => {
      const open = docs.flatMap(([name, doc]) => doc.pending_effects.map(effect => `${name} ${effect.kind} ${effect.intent_id} (${effect.state})`));
      if (open.length) this.hold('STATE_RESTORE_HELD', `The state branch ${STATE_BRANCH} is missing and the checkpoint matches, but ${open.length} earlier intent(s) are not settled: ${open.join('; ')}. Nothing was restored. Controller: settle them from the private store's sidecars by readback first.`);
    };
    const commit = this.transport.request('GET', `repos/${this.binding.repository}/git/commits/${checkpoint.head_sha}`);
    if (commit.status === 200) {
      const texts = names.map(name => [name, this.textAt(`${STATE_PATH}${name}.json`, checkpoint.head_sha)]);
      if (texts.every(([name, text]) => text !== null && sha256(text) === checkpoint.files[name].sha256)) {
        settle(texts.map(([name, text]) => [name, JSON.parse(text)]));
        const created = this.transport.request('POST', `repos/${this.binding.repository}/git/refs`, { ref: `refs/heads/${STATE_BRANCH}`, sha: checkpoint.head_sha });
        if (!okStatus(created.status)) throw ghFailure(created, `Recreating the state branch ${STATE_BRANCH}`);
        this.note('STATE_RESTORED', `The state branch was missing; it was restored at the checkpoint commit ${shortSha(checkpoint.head_sha)} (${names.length} document(s), digests matched).`);
        return { exists: true, head: checkpoint.head_sha };
      }
    }
    const rebuilt = [];
    for (const name of names) {
      const entry = checkpoint.files[name];
      const { doc: sidecar } = this.private.readPath(this.sidecarPath(name, entry.revision, entry.sha256), 'sidecar');
      const text = sidecar && sidecar.document === name ? canonicalText(publicView(kindOfName(name), sidecar.doc)) : null;
      if (!text || sha256(text) !== entry.sha256) {
        this.hold('STATE_RESTORE_HELD', `The state branch ${STATE_BRANCH} is missing. Its checkpoint commit is gone or no longer matches, and ${name} r${entry.revision} has no matching sidecar, so it cannot be rebuilt. Nothing was restored and it is never started empty. Controller: report to the owner.`);
      }
      rebuilt.push([name, text, sidecar.doc]);
    }
    settle(rebuilt.map(([name, , doc]) => [name, doc]));
    const head = this.createCommit(rebuilt.map(([name, text]) => [`${STATE_PATH}${name}.json`, text]), commitLine(`programme-state: rebuilt ${rebuilt.length} document(s) from sidecars`), []);
    this.recordCheckpoint(Object.fromEntries(rebuilt.map(([name]) => [name, checkpoint.files[name]])), head, { replace: true });
    this.note('STATE_REBUILT', `The state branch was missing and its checkpoint commit could not be used; it was rebuilt from the private sidecars at the checkpoint revisions (${rebuilt.length} document(s), digests matched), as commit ${shortSha(head)}.`);
    return { exists: true, head };
  }

  // One commit holding exactly `files` ([[path, text]]); every file read back. Without parents the
  // branch is created (never over one that exists); with the branch head as its parent the branch is
  // moved forward to it, never forced.
  createCommit(files, message, parents) {
    const repo = this.binding.repository;
    const tree = this.transport.request('POST', `repos/${repo}/git/trees`, { tree: files.map(([file, text]) => ({ path: file, mode: '100644', type: 'blob', content: text })) });
    if (!okStatus(tree.status) || !isText(tree.json?.sha)) throw ghFailure(tree, 'Writing the state tree');
    const commit = this.transport.request('POST', `repos/${repo}/git/commits`, { message, tree: tree.json.sha, parents });
    if (!okStatus(commit.status) || !isSha(commit.json?.sha)) throw ghFailure(commit, 'Writing the state commit');
    for (const [file, text] of files) {
      if (this.textAt(file, commit.json.sha) !== text) throw new ProgrammeError('STATE_READBACK_MISMATCH', `${file} did not read back as written in the new state commit.`);
    }
    if (parents.length) {
      const moved = this.transport.request('PATCH', `repos/${repo}/git/refs/heads/${encodeURIComponent(STATE_BRANCH)}`, { sha: commit.json.sha, force: false });
      if (moved.status === 422) throw new ProgrammeError('STATE_CONFLICT', `The state branch ${STATE_BRANCH} moved while the documents were being moved again; nothing was replaced. Run migrate-state again.`);
      if (!okStatus(moved.status)) throw ghFailure(moved, `Moving the state branch ${STATE_BRANCH} forward`);
      return commit.json.sha;
    }
    const ref = this.transport.request('POST', `repos/${repo}/git/refs`, { ref: `refs/heads/${STATE_BRANCH}`, sha: commit.json.sha });
    if (ref.status === 422) throw new ProgrammeError('STATE_BRANCH_EXISTS', `The state branch ${STATE_BRANCH} already exists; nothing was replaced.`);
    if (!okStatus(ref.status)) throw ghFailure(ref, `Creating the state branch ${STATE_BRANCH}`);
    return commit.json.sha;
  }

  // The checkpoint after a write, with compare-and-swap: the newer revision of each document wins.
  // `replace` writes exactly `files` (a rebuild or a recompute). The move record (`migrated`) is
  // kept unless `migrated` gives a new one.
  recordCheckpoint(files, head, { replace = false, migrated = undefined } = {}) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = attempt === 0 && this.checkpoint ? this.checkpoint : this.readCheckpoint();
      const merged = replace ? { ...files } : { ...(current.doc?.files || {}) };
      if (!replace) {
        for (const [name, entry] of Object.entries(files)) {
          if (!merged[name] || merged[name].revision <= entry.revision) merged[name] = entry;
        }
      }
      const move = migrated !== undefined ? migrated : current.doc?.migrated;
      const doc = { schema: STATE_SCHEMA.checkpoint, repository: this.binding.repository, branch: STATE_BRANCH, head_sha: head, files: merged, written_at: this.now(), ...(move ? { migrated: move } : {}) };
      try {
        const written = this.private.putVerified(this.checkpointPath(), 'checkpoint', canonicalText(doc), current.sha, 'programme state: checkpoint');
        this.checkpoint = { doc: written.doc, sha: written.sha };
        this.localCheckpoint?.write(written.doc);
        return;
      } catch (error) {
        if (error.code !== 'STATE_CONFLICT') throw error;
        this.checkpoint = null;
      }
    }
    throw new ProgrammeError('STATE_CONFLICT', 'The state checkpoint kept moving; it is recomputed from the branch on the next run.');
  }

  // The checkpoint lags the branch (a write that stopped before its checkpoint, or two writers at
  // once): it is set again from the branch head, counting only files whose sidecar joins.
  recomputeCheckpoint(head) {
    const listing = this.transport.request('GET', `${this.encodedContents(STATE_PATH.replace(/\/$/, ''))}?ref=${encodeURIComponent(head)}`);
    if (listing.status !== 200 || !Array.isArray(listing.json)) throw ghFailure(listing, `Listing ${STATE_PATH} on ${STATE_BRANCH}`);
    const files = {};
    for (const entry of listing.json.filter(item => item?.type === 'file' && /\.json$/.test(String(item.name)))) {
      const name = String(entry.name).replace(/\.json$/, '');
      if (!DOC_NAME.test(name)) continue;
      const text = this.textAt(`${STATE_PATH}${entry.name}`, head);
      let doc;
      try { doc = validatePublic(kindOfName(name), JSON.parse(text)); } catch (error) {
        this.hold('STATE_INVALID', `${STATE_PATH}${entry.name} on ${STATE_BRANCH} is not a valid public document (${error.code === 'STATE_INVALID' ? error.message : 'not JSON'}). Nothing was written. Controller: report to the owner.`);
      }
      const digest = sha256(canonicalText(doc));
      const { doc: sidecar } = this.private.readPath(this.sidecarPath(name, doc.revision, digest), 'sidecar');
      if (!sidecar || sidecar.public_sha256 !== digest) {
        this.hold('STATE_SIDECAR_MISSING', `${STATE_PATH}${entry.name} on ${STATE_BRANCH} has no private sidecar for revision ${doc.revision} with its digest (a hand edit, or a sidecar that was removed). Nothing was written. Controller: report to the owner.`);
      }
      files[name] = { revision: doc.revision, sha256: digest };
    }
    const previous = this.checkpoint.doc?.files || {};
    const lower = Object.entries(previous).filter(([name, entry]) => !files[name] || files[name].revision < entry.revision).map(([name]) => name);
    if (lower.length) {
      this.hold('STATE_ROLLED_BACK', `The state branch ${STATE_BRANCH} no longer holds ${lower.join(', ')} at the checkpoint's revision (a force-push back, a deleted file or a hand edit). Nothing was written. Controller: report to the owner; the private store's checkpoint and sidecars hold the last good state.`);
    }
    this.recordCheckpoint(files, head, { replace: true });
    this.note('STATE_CHECKPOINT_RECOMPUTED', `The checkpoint lagged the branch; it was set again from ${shortSha(head)} (${Object.keys(files).length} document(s)).`);
  }

  // A public file joined to the sidecar of the same revision and public digest, as the full document.
  join(kind, number, publicDoc) {
    const name = documentName(kind, number);
    const text = canonicalText(publicDoc);
    const digest = sha256(text);
    const file = this.sidecarPath(name, publicDoc.revision, digest);
    const { doc: sidecar, sha } = this.private.readPath(file, 'sidecar');
    if (!sidecar || sidecar.public_sha256 !== digest || sidecar.document !== name || canonicalText(publicView(kind, sidecar.doc)) !== text) {
      this.hold('STATE_SIDECAR_MISSING', `${STATE_PATH}${name}.json on ${STATE_BRANCH} has no private sidecar for revision ${publicDoc.revision} with its digest (a hand edit, or a sidecar that was removed). Nothing was written. Controller: report to the owner.`);
    }
    this.joined.set(name, { file, sha, revision: publicDoc.revision });
    for (const session of sessionsOf(sidecar.doc)) if (isText(session)) this.sessions.add(session);
    return sidecar.doc;
  }

  read(kind, number) {
    const branch = this.ensureBranch();
    if (!branch.exists) return { doc: null, sha: null };
    const name = documentName(kind, number);
    let found = this.readPath(this.docPath(kind, number), kind);
    const recorded = this.checkpoint?.doc?.files?.[name];
    if (recorded && (!found.doc || found.doc.revision < recorded.revision)) {
      // A branch read can lag a write made elsewhere: read the head commit before calling it a rollback.
      const head = this.branchHead();
      found = head ? this.readPath(this.docPath(kind, number), kind, head) : { doc: null, sha: null };
      if (!found.doc || found.doc.revision < recorded.revision) {
        this.hold('STATE_ROLLED_BACK', `${STATE_PATH}${name}.json on ${STATE_BRANCH} is ${found.doc ? `at revision ${found.doc.revision}` : 'missing'}, below the checkpoint's revision ${recorded.revision} (a force-push back, a deleted file or a hand edit). Nothing was written. Controller: report to the owner.`);
      }
    }
    if (!found.doc) return found;
    return { doc: this.join(kind, number, found.doc), sha: found.sha };
  }

  // The private store must still be private before any sidecar is written.
  requirePrivateStore() {
    const repo = this.transport.request('GET', `repos/${this.binding.store.repository}`);
    if (repo.status !== 200) throw new ProgrammeError('STATE_STORE_UNVERIFIED', `The private store ${this.binding.store.repository} could not be read (${repo.status}); no public state was written.`);
    if (repo.json.private !== true) throw new ProgrammeError('STORE_NOT_PRIVATE', `The private store ${this.binding.store.repository} is no longer private, so no sidecar and no public state was written. Controller: make it private again.`);
  }

  // Writes `next` only when its state differs from `previous`, as StateStore does: the sidecar first,
  // then the public file (compare-and-swap, read back), then the checkpoint.
  write(kind, number, next, { sha, previous }) {
    if (previous && sameState(previous, next)) return { outcome: 'NOOP', doc: previous, sha };
    const branch = this.ensureBranch();
    if (!branch.exists) {
      throw new ProgrammeError('STATE_BRANCH_MISSING', `The state branch ${STATE_BRANCH} was never created, so nothing was written. Only programme.cjs migrate-state --apply creates it.`);
    }
    const doc = clone(next);
    doc.revision = previous ? previous.revision + (contentDigest(previous) === contentDigest(doc) ? 0 : 1) : Math.max(1, doc.revision || 0);
    doc.volatile = { written_at: this.now(), ...(this.toolkitVersion ? { toolkit: this.toolkitVersion } : {}) };
    assertValid(kind, doc);
    const name = documentName(kind, number);
    const text = canonicalText(publicView(kind, doc, [...this.sessions]));
    const digest = sha256(text);
    this.requirePrivateStore();
    const sidecarSha = this.putSidecar(name, doc, digest);
    const result = this.putVerified(this.docPath(kind, number), kind, text, sha, commitLine(`programme-state: ${name} r${doc.revision}`));
    const replaced = this.joined.get(name);
    this.joined.set(name, { file: this.sidecarPath(name, doc.revision, digest), sha: sidecarSha, revision: doc.revision });
    try {
      this.recordCheckpoint({ [name]: { revision: doc.revision, sha256: digest } }, this.lastCommit);
      this.pruneSidecars(name, doc.revision, replaced);
    } catch (error) {
      // The public write stands; the next run sets the checkpoint again from the branch. The sidecar
      // the old checkpoint names is kept until then, so a rebuild from sidecars still works.
      this.checkpoint = null;
      this.branch = null;
      this.note('STATE_CHECKPOINT_STALE', `${name} r${doc.revision} was written, but its checkpoint was not (${error.code || 'error'}); the next run sets it again from the branch.`);
    }
    return { outcome: 'WRITTEN', doc, sha: result.sha };
  }

  putSidecar(name, doc, digest) {
    const sidecar = { schema: STATE_SCHEMA.sidecar, repository: this.binding.repository, document: name, revision: doc.revision, public_sha256: digest, doc };
    const file = this.sidecarPath(name, doc.revision, digest);
    const text = canonicalText(sidecar);
    try {
      return this.private.putVerified(file, 'sidecar', text, null, `programme state: ${name} r${doc.revision} sidecar`).sha;
    } catch (error) {
      // The same revision and digest from an earlier try that stopped: keep it if it is the same.
      if (error.code !== 'STATE_CONFLICT') throw error;
      const existing = this.private.readPath(file, 'sidecar');
      if (canonicalText(existing.doc || {}) !== text) throw error;
      return existing.sha;
    }
  }

  // Sidecars of SIDECAR_KEEP revisions are kept. The sidecar a same-revision write replaced is
  // removed at once (the public file no longer points at it). A failed removal leaves a harmless
  // file for the next pass.
  pruneSidecars(name, revision, replaced) {
    const remove = (file, sha) => {
      const response = this.transport.request('DELETE', this.private.encodedContents(file), { message: `programme state: prune ${name} sidecar`, sha, branch: this.binding.store.branch });
      if (!okStatus(response.status)) this.note('STATE_SIDECAR_KEPT', `An old sidecar of ${name} could not be removed (${response.status}); the next write tries again.`);
    };
    if (replaced && replaced.revision === revision) {
      if (replaced.sha && replaced.file !== this.joined.get(name)?.file) remove(replaced.file, replaced.sha);
      return;
    }
    if (revision <= SIDECAR_KEEP) return;
    const dir = this.sidecarDir(name);
    const listing = this.transport.request('GET', `${this.private.encodedContents(dir)}?ref=${encodeURIComponent(this.binding.store.branch)}`);
    if (listing.status !== 200 || !Array.isArray(listing.json)) return;
    for (const entry of listing.json) {
      const match = /^r(\d+)-[0-9a-f]{16}\.json$/.exec(String(entry?.name || ''));
      if (match && Number(match[1]) <= revision - SIDECAR_KEEP) remove(`${dir}/${entry.name}`, entry.sha);
    }
  }
}

// Public state backends by binding `state.kind`.
const STATE_BACKENDS = Object.freeze({ branch: BranchStateStore });

// The store a merged binding names: the public state branch with the private store beside it when
// the binding has `state`, else the private store alone. A disabled binding never reaches here.
function openStore({ transport, binding, now, toolkitVersion = null, localCheckpoint = null }) {
  if (binding.state) return new STATE_BACKENDS[binding.state.kind]({ transport, binding, now, toolkitVersion, localCheckpoint });
  return new STORE_BACKENDS[binding.store.kind]({ transport, store: binding.store, now, toolkitVersion });
}

const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    pullRequest(number: $number) {
      number state isDraft merged headRefOid baseRefName mergeable
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          __typename
          ... on CheckRun { name status conclusion isRequired(pullRequestNumber: $number) }
          ... on StatusContext { context state isRequired(pullRequestNumber: $number) }
        } } } } } }
    }
  }
}`;

function parentFromUrl(url, repository) {
  const match = /\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(String(url || ''));
  if (!match) return null;
  return match[1].toLowerCase() === repository.toLowerCase() ? Number(match[2]) : `${match[1]}#${match[2]}`;
}

// Read-only view of the programme on GitHub.
class ProgrammeGraphReader {
  constructor({ transport, repository }) {
    this.transport = transport;
    this.repository = repository;
  }

  issue(number) {
    const response = this.transport.request('GET', `repos/${this.repository}/issues/${number}`);
    if (response.status === 404 || response.status === 410) return null;
    if (response.status !== 200) throw ghFailure(response, `Reading issue ${number}`);
    const issue = response.json;
    return {
      number: issue.number, id: issue.id, state: issue.state, state_reason: issue.state_reason || null,
      title: issue.title, body: issue.body || '', updated_at: issue.updated_at, closed_at: issue.closed_at || null,
      is_pull_request: Boolean(issue.pull_request),
      parent: parentFromUrl(issue.parent_issue_url, this.repository),
      blocked_by_total: issue.issue_dependencies_summary?.total_blocked_by ?? 0,
      open_sub_issues: Math.max(0, (issue.sub_issues_summary?.total ?? 0) - (issue.sub_issues_summary?.completed ?? 0)),
    };
  }

  subIssues(number) {
    const all = [];
    for (let page = 1; page < 50; page += 1) {
      const response = this.transport.request('GET', `repos/${this.repository}/issues/${number}/sub_issues?per_page=100&page=${page}`);
      if (response.status !== 200) throw ghFailure(response, `Reading sub-issues of ${number}`);
      all.push(...response.json.map(issue => ({ number: issue.number, id: issue.id })));
      if (response.json.length < 100) return all;
    }
    throw new ProgrammeError('GH_FAILED', `Issue ${number} has more sub-issues than this reader pages through.`);
  }

  // Every comment on an issue, for the comment trace and its audit.
  comments(number) {
    const all = [];
    for (let page = 1; page < 100; page += 1) {
      const response = this.transport.request('GET', `repos/${this.repository}/issues/${number}/comments?per_page=100&page=${page}`);
      if (response.status !== 200) throw ghFailure(response, `Reading comments of ${number}`);
      all.push(...response.json.map(comment => ({ id: comment.id, user: comment.user, body: comment.body || '', created_at: comment.created_at })));
      if (response.json.length < 100) return all;
    }
    throw new ProgrammeError('GH_FAILED', `Issue ${number} has more comments than this reader pages through.`);
  }

  blockedBy(number) {
    const response = this.transport.request('GET', `repos/${this.repository}/issues/${number}/dependencies/blocked_by?per_page=100`);
    if (response.status !== 200) throw ghFailure(response, `Reading dependencies of ${number}`);
    return response.json.map(issue => issue.number).sort((a, b) => a - b);
  }

  pullRequest(number) {
    const [owner, name] = this.repository.split('/');
    const repo = this.transport.graphql(PR_QUERY, { owner, name, number })?.repository;
    const pr = repo?.pullRequest;
    if (!pr) return null;
    const commit = pr.commits?.nodes?.[0]?.commit;
    const rollup = commit?.statusCheckRollup;
    return {
      number: pr.number,
      state: pr.merged ? 'MERGED' : pr.state === 'CLOSED' ? 'CLOSED' : pr.isDraft ? 'DRAFT' : 'OPEN',
      head: pr.headRefOid, base: pr.baseRefName, default_branch: repo.defaultBranchRef?.name || null, mergeable: pr.mergeable,
      rollupOid: commit?.oid || null,
      complete: !rollup?.contexts?.pageInfo?.hasNextPage,
      contexts: (rollup?.contexts?.nodes || []).map(node => ({
        kind: node.__typename, name: node.name || node.context, status: node.status || null,
        conclusion: node.conclusion || null, state: node.state || null, required: node.isRequired === true,
      })),
    };
  }

  // Open pull requests with their bodies, for PRs that reference an outcome the state does not track.
  openPullRequests() {
    const all = [];
    for (let page = 1; page < 50; page += 1) {
      const response = this.transport.request('GET', `repos/${this.repository}/pulls?state=open&per_page=100&page=${page}`);
      if (response.status !== 200) throw ghFailure(response, 'Listing open pull requests');
      all.push(...response.json.map(pr => ({ number: pr.number, body: pr.body || '' })));
      if (response.json.length < 100) return all;
    }
    throw new ProgrammeError('GH_FAILED', 'The repository has more open pull requests than this reader pages through.');
  }

  pullRequestForBranch(branch) {
    const owner = this.repository.split('/')[0];
    const response = this.transport.request('GET', `repos/${this.repository}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=10`);
    if (response.status !== 200) throw ghFailure(response, `Finding the PR for ${branch}`);
    const open = response.json.find(pr => pr.state === 'open');
    return (open || response.json[0])?.number || null;
  }
}

const INVENTORY_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { __typename number state parent { number state repository { nameWithOwner } } labels(first: 50) { nodes { name } } }
    }
  }
}`;
const OUTSIDE_LABEL = 'programme:outside';
const OUTSIDE_MARKER = 'OUTSIDE-PROGRAMME';
// Authors whose OUTSIDE-PROGRAMME comment counts: people with a say in the repository.
const OUTSIDE_AUTHORS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
// GitHub allows sub-issues eight levels deep.
const PARENT_CHAIN_LIMIT = 8;
const INVENTORY_DEADLINE_MS = 120000;
const INVENTORY_CLASSES = ['PARENT', 'CHILD', 'OUTSIDE', 'NEEDS_PLACEMENT'];

// Read-only: every open issue of the repository in exactly one class, with the inventory source's
// findings. It never links, labels, comments, closes or catalogues anything. A missed deadline, a
// failed read or an unwalkable parent chain makes the run incomplete: it then reports only
// INVENTORY_INCOMPLETE, so nothing is resolved from a partial view.
class ProgrammeInventory {
  constructor({ transport, repository, parents, catalogue = [], deadlineMs = INVENTORY_DEADLINE_MS, nowMs = () => Date.now() }) {
    this.transport = transport;
    this.repository = repository;
    this.parents = new Set(parents);
    this.catalogue = new Set(catalogue);
    this.nowMs = nowMs;
    this.deadline = nowMs() + deadlineMs;
  }

  // Every request goes through here, so a run that passes its deadline stops before the next one.
  request(method, apiPath, body) {
    if (this.nowMs() > this.deadline) throw new ProgrammeError('INVENTORY_DEADLINE', 'the inventory passed its deadline');
    return this.transport.request(method, apiPath, body);
  }

  openIssues() {
    const [owner, name] = this.repository.split('/');
    const issues = new Map();
    let after = null;
    for (let page = 0; page < 1000; page += 1) {
      const response = this.request('POST', 'graphql', { query: INVENTORY_QUERY, variables: { owner, name, after } });
      if (response.status !== 200 || response.json?.errors?.length || !response.json?.data?.repository?.issues) {
        throw new ProgrammeError('GH_GRAPHQL_FAILED', `the open issues could not be read (${response.status})`);
      }
      const connection = response.json.data.repository.issues;
      for (const node of connection.nodes || []) {
        // The issues connection holds no pull request; anything else is never listed.
        if (!node || node.__typename !== 'Issue' || !isInt(node.number, 1)) continue;
        issues.set(node.number, {
          number: node.number, state: 'open',
          parent: node.parent && node.parent.repository?.nameWithOwner?.toLowerCase() === this.repository.toLowerCase() ? node.parent.number : node.parent ? 'outside' : null,
          labels: (node.labels?.nodes || []).map(label => String(label?.name || '')),
        });
      }
      if (!connection.pageInfo?.hasNextPage) return issues;
      after = connection.pageInfo.endCursor;
    }
    throw new ProgrammeError('GH_FAILED', 'the open issues did not end within the page limit');
  }

  // A closed ancestor, read once by number: { number, state, parent }.
  ancestor(number, known) {
    if (known.has(number)) return known.get(number);
    const response = this.request('GET', `repos/${this.repository}/issues/${number}`);
    if (response.status !== 200 || !response.json) throw ghFailure(response, `Reading issue ${number}`);
    const parent = parentFromUrl(response.json.parent_issue_url, this.repository);
    const entry = { number, state: response.json.state === 'closed' ? 'closed' : 'open', parent: typeof parent === 'number' ? parent : parent ? 'outside' : null };
    known.set(number, entry);
    return entry;
  }

  // The registered parent above `number`, null when there is none, or throws when the chain cannot be
  // walked (a cycle or deeper than GitHub allows).
  registeredRoot(number, known) {
    const visited = new Set([number]);
    let at = known.get(number);
    for (let depth = 0; depth <= PARENT_CHAIN_LIMIT; depth += 1) {
      const parent = at.parent;
      if (parent === null || parent === 'outside') return null;
      if (this.parents.has(parent)) return parent;
      if (visited.has(parent)) throw new ProgrammeError('INVENTORY_CHAIN', `the parent chain of #${number} loops`);
      visited.add(parent);
      at = this.ancestor(parent, known);
    }
    throw new ProgrammeError('INVENTORY_CHAIN', `the parent chain of #${number} is deeper than ${PARENT_CHAIN_LIMIT}`);
  }

  // The OUTSIDE-PROGRAMME comment that counts, as its reason, or null.
  outsideComment(number) {
    for (let page = 1; page < 100; page += 1) {
      const response = this.request('GET', `repos/${this.repository}/issues/${number}/comments?per_page=100&page=${page}`);
      if (response.status !== 200 || !Array.isArray(response.json)) throw ghFailure(response, `Reading comments of ${number}`);
      for (const comment of response.json) {
        const [first, ...rest] = String(comment?.body || '').split(/\r?\n/);
        if (first.trim() === OUTSIDE_MARKER && OUTSIDE_AUTHORS.has(String(comment.author_association || '').toUpperCase())) {
          return rest.join(' ').trim().slice(0, TEXT_LIMIT) || 'marked OUTSIDE-PROGRAMME';
        }
      }
      if (response.json.length < 100) return null;
    }
    return null;
  }

  run() {
    let issues;
    try {
      issues = this.openIssues();
      const known = new Map(issues);
      const classified = [];
      const findings = [];
      const closedParents = new Set();
      for (const issue of [...issues.values()].sort((a, b) => a.number - b.number)) {
        if (this.parents.has(issue.number)) { classified.push({ number: issue.number, class: 'PARENT' }); continue; }
        const root = this.registeredRoot(issue.number, known);
        if (root !== null) {
          classified.push({ number: issue.number, class: 'CHILD', parent: root });
          if (known.get(root)?.state === 'closed' || (!issues.has(root) && this.ancestor(root, known).state === 'closed')) closedParents.add(root);
          continue;
        }
        if (issue.parent === null && this.catalogue.has(issue.number)) { classified.push({ number: issue.number, class: 'CHILD', parent: null, catalogued: true }); continue; }
        if (issue.labels.includes(OUTSIDE_LABEL)) { classified.push({ number: issue.number, class: 'OUTSIDE', reason: `label ${OUTSIDE_LABEL}` }); continue; }
        const reason = this.outsideComment(issue.number);
        if (reason) { classified.push({ number: issue.number, class: 'OUTSIDE', reason }); continue; }
        classified.push({ number: issue.number, class: 'NEEDS_PLACEMENT' });
        findings.push({ code: 'NEEDS_PLACEMENT', issue: issue.number });
      }
      for (const number of [...closedParents].sort((a, b) => a - b)) findings.push({ code: 'CLOSED_PARENT_OPEN_CHILD', issue: number });
      return { complete: true, reason: null, issues: classified, findings };
    } catch (error) {
      if (error.code === 'GH_AUTH' || STOPS_PASS.has(error.code)) throw error;
      return { complete: false, reason: error.code === 'INVENTORY_DEADLINE' ? 'the deadline passed' : error.message, issues: [], findings: [{ code: 'INVENTORY_INCOMPLETE', issue: null }] };
    }
  }
}

// Issue numbers each PR body references with Refs, Completes, Closes, Fixes or Resolves, including
// lists such as "Refs #421, #423": issue -> sorted PR numbers.
function referencedIssues(prs) {
  const references = new Map();
  for (const pr of prs) {
    for (const match of String(pr.body || '').matchAll(/\b(?:refs|completes|closes|fixes|resolves)\b:?\s+((?:#\d+(?:\s*(?:,|and)\s*)?)+)/gi)) {
      for (const [, number] of match[1].matchAll(/#(\d+)/g)) {
        const list = references.get(Number(number)) || [];
        if (!list.includes(pr.number)) references.set(Number(number), [...list, pr.number].sort((a, b) => a - b));
      }
    }
  }
  return references;
}

// Native hierarchy and body mutations; each returns the raw status. Readback decides the outcome.
class GitHubMutator {
  constructor({ transport, repository }) {
    this.transport = transport;
    this.repository = repository;
    this.mutations = 0;
  }

  attach(parent, childId, replaceParent) {
    this.mutations += 1;
    return this.transport.request('POST', `repos/${this.repository}/issues/${parent}/sub_issues`, { sub_issue_id: childId, ...(replaceParent ? { replace_parent: true } : {}) });
  }

  // Exactly one anchor: { before_id } or { after_id } (GitHub answers 422 otherwise).
  reorder(parent, childId, anchor) {
    this.mutations += 1;
    return this.transport.request('PATCH', `repos/${this.repository}/issues/${parent}/sub_issues/priority`, { sub_issue_id: childId, ...anchor });
  }

  postComment(number, body) {
    return this.transport.request('POST', `repos/${this.repository}/issues/${number}/comments`, { body });
  }

  writeBody(number, body) {
    this.mutations += 1;
    return this.transport.request('PATCH', `repos/${this.repository}/issues/${number}`, { body });
  }
}

// The moves that turn `current` (issue numbers in order) into `desired` for the members of `desired`.
// The longest run already in order stays put; every other member moves next to a neighbour, so a
// first attach (which appends) needs only a few moves. Issues outside `desired` keep their place.
function longestIncreasing(sequence) {
  const tails = [];
  const previous = new Array(sequence.length).fill(-1);
  for (let index = 0; index < sequence.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sequence[tails[middle]] < sequence[index]) low = middle + 1; else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  }
  const result = [];
  for (let at = tails.length ? tails[tails.length - 1] : -1; at !== -1; at = previous[at]) result.unshift(sequence[at]);
  return result;
}

function orderMoves(current, desired) {
  const present = new Set(current);
  const target = desired.filter(number => present.has(number));
  const rank = new Map(target.map((number, index) => [number, index]));
  const kept = new Set(longestIncreasing(current.filter(number => rank.has(number)).map(number => rank.get(number))).map(index => target[index]));
  let lastKept = -1;
  target.forEach((number, index) => { if (kept.has(number)) lastKept = index; });
  const moves = [];
  for (let index = lastKept + 1; index < target.length; index += 1) moves.push({ issue: target[index], after: target[index - 1] });
  for (let index = lastKept - 1; index >= 0; index -= 1) if (!kept.has(target[index])) moves.push({ issue: target[index], before: target[index + 1] });
  return moves;
}

// True when `issue` sits directly before or after its anchor in `list` ({ number } entries).
function moveDone(list, move) {
  const at = list.findIndex(sub => sub.number === move.issue);
  if (at === -1) return false;
  return move.before !== undefined ? list[at + 1]?.number === move.before : list[at - 1]?.number === move.after;
}

function intentId(kind, target) {
  return sha256(JSON.stringify(canonical({ kind, target }))).slice(0, 16);
}

// Findings the reconciler reports but never fixes itself; each needs a controller decision. These are
// the reconcile source's attention findings (FINDING_CODES).
const ATTENTION = new Set(Object.keys(FINDING_CODES).filter(code => FINDING_CODES[code].source === 'reconcile'));

function inventoryCounts(inventory) {
  return Object.fromEntries(INVENTORY_CLASSES.map(name => [name, inventory.issues.filter(entry => entry.class === name).length]));
}

// The issue numbers the binding registers as programme parents; the first is the primary parent.
function registeredParents(binding) {
  return Array.isArray(binding.parents) && binding.parents.length ? binding.parents.map(entry => entry.issue) : [binding.parent_issue];
}
// Child fields the journal fold owns; apply re-folds them on the document it reads, never copies them.
const FOLD_FIELDS = ['gate', 'journals_seen', 'next_action'];

const EFFECT_TEXT = {
  create_state: effect => `Create the state document for #${effect.target.issue}`,
  update_state: effect => `Update the state document for #${effect.target.issue} (${effect.fields.join(', ')})`,
  attach: effect => `Attach #${effect.target.issue} under #${effect.target.parent}`,
  reparent: effect => `Move #${effect.target.issue} from under ${typeof effect.from === 'number' ? `#${effect.from}` : effect.from} to under #${effect.target.parent}`,
  reorder: effect => `Move #${effect.target.issue} ${effect.target.before !== undefined ? `before #${effect.target.before}` : `after #${effect.target.after}`} under #${effect.target.parent}`,
  replace_block: effect => (effect.state === false ? `Update the ${staleParts(effect)} in #${effect.target.issue}'s body` : `${effect.insert ? 'Add' : effect.move ? 'Move' : 'Update'} the state block in #${effect.target.issue}'s body`),
  replace_pr_nav: effect => `Add the parent and task links at the top of PR #${effect.target.pr}`,
  update_attention: effect => `Update the attention findings on #${effect.target.issue} (${effect.line} after this pass)`,
  post_index_comment: effect => `Move #${effect.target.issue}'s "${effect.label || effect.target.tag || OTHER_COMMENTS}" comment trace (${effect.lines.length} link(s)) into a new index comment`,
};

// The parts of a body a block effect rewrites when its state block is already current.
function staleParts(effect) {
  const names = [['trace', 'comment trace'], ['nav', 'parent and task links'], ['current', 'CURRENT summary']].filter(([key]) => effect.stale?.[key]).map(([, name]) => name);
  if (!names.length) return 'comment trace';
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function describeEffect(effect) { return EFFECT_TEXT[effect.kind](effect); }

// What a hold on an issue stops for the rest of a pass: its body, its links, or everything.
function holdScope(kind) {
  if (kind === 'replace_block' || kind === 'post_index_comment') return 'body';
  if (kind === 'replace_pr_nav') return 'pr';
  if (kind === 'attach' || kind === 'reparent' || kind === 'reorder') return 'links';
  return 'all';
}

// One reconcile pass: bind, observe, recover, diff, plan and (with apply) run each effect.
class Reconciler {
  constructor({ store, reader, mutator, binding, writer = null, toolkitVersion = null, threshold = DEFAULT_THRESHOLD, now = null }) {
    this.store = store;
    // The clock attention findings are dated by (the store's clock dates only its own commits).
    this.now = now || (() => new Date().toISOString());
    this.reader = reader;
    this.mutator = mutator;
    this.binding = binding;
    this.writer = writer;
    this.toolkitVersion = toolkitVersion;
    this.threshold = threshold;
  }

  loadParent(parentOverride) {
    if (parentOverride) return { doc: assertValid('parent', parentOverride), sha: null, override: true };
    return this.store.read('parent', this.binding.parent_issue);
  }

  observe(parent, children, only) {
    const outcomes = parent.outcomes.filter(outcome => !only || outcome.issue === only);
    const issues = new Map();
    const read = number => { if (!issues.has(number)) issues.set(number, this.reader.issue(number)); return issues.get(number); };
    read(parent.parent_issue);
    for (const outcome of outcomes) read(outcome.issue);
    const parents = new Set([parent.parent_issue, ...outcomes.map(outcome => outcome.parent).filter(Boolean)]);
    for (const number of parents) read(number);
    const subIssues = new Map([...parents].filter(number => issues.get(number)).map(number => [number, this.reader.subIssues(number)]));
    const blockedBy = new Map();
    const prs = new Map();
    for (const outcome of outcomes) {
      const issue = issues.get(outcome.issue);
      if (issue?.blocked_by_total > 0) blockedBy.set(outcome.issue, this.reader.blockedBy(outcome.issue));
      const doc = children.get(outcome.issue)?.doc;
      const number = doc?.pr?.number || (doc?.candidate?.branch ? this.reader.pullRequestForBranch(doc.candidate.branch) : null);
      if (number) prs.set(outcome.issue, this.reader.pullRequest(number));
    }
    const journals = new Map();
    for (const outcome of outcomes) {
      const doc = children.get(outcome.issue)?.doc;
      if (doc && (doc.gate.assignment || Object.keys(doc.journals_seen || {}).length)) journals.set(outcome.issue, this.readJournals(doc));
    }
    // Open PRs are listed only when some open outcome tracks no PR and no branch.
    const untracked = outcomes.some(outcome => {
      const doc = children.get(outcome.issue)?.doc;
      return !isFinished(outcome, doc) && !doc?.pr?.number && !doc?.candidate?.branch;
    });
    const references = untracked ? referencedIssues(this.reader.openPullRequests()) : new Map();
    const comments = new Map([parent.parent_issue, ...outcomes.map(outcome => outcome.issue)].filter(number => issues.get(number)).map(number => [number, this.reader.comments(number)]));
    const prPages = new Map();
    for (const pr of prs.values()) if (pr && ['OPEN', 'DRAFT'].includes(pr.state)) prPages.set(pr.number, this.reader.issue(pr.number));
    return { issues, subIssues, blockedBy, prs, outcomes, journals, references, comments, prPages };
  }

  // Report-only: an open PR that says "Refs #n" (or Completes, Closes, Fixes, Resolves) for an open
  // outcome whose state tracks no PR and no branch. The controller confirms before recording it.
  diffUntracked(parent, docs, observed, only, findings) {
    for (const outcome of parent.outcomes) {
      if (only && outcome.issue !== only) continue;
      const doc = docs.get(outcome.issue);
      if (isFinished(outcome, doc) || doc?.pr?.number || doc?.candidate?.branch) continue;
      const numbers = observed.references.get(outcome.issue) || [];
      if (numbers.length) findings.push({ code: 'PR_UNTRACKED', issue: outcome.issue, detail: `open PR ${numbers.map(number => `#${number}`).join(', ')} references this outcome, but its state records no PR or branch; the controller confirms and records it with update --patch` });
    }
  }

  // Every journal file for a child; only the live assignment's journals are read in full.
  readJournals(doc) {
    const live = LIVE_GATE_STATES.includes(doc.gate.state) ? doc.gate.assignment?.id : null;
    const files = this.store.listJournals(doc.issue).map(file => {
      if (file.assignment !== live) return { ...file, doc: null };
      try { return { ...file, doc: this.store.readJournal(doc.issue, file.name).doc }; }
      catch (error) { return { ...file, doc: null, error: error.code || 'UNREADABLE' }; }
    });
    return { files };
  }

  // The child document with observed PR facts and checkpoint journals applied (pure apart from
  // reading `observed`).
  desiredChild(outcome, existing, observed) {
    let child = existing ? clone(existing) : newChild({ repository: this.binding.repository, outcome });
    let checks = null;
    // A finished outcome with no completion time takes the issue's close time, once.
    const closedAt = observed.issues.get(outcome.issue)?.closed_at;
    if (!child.completed_at && closedAt && (TERMINAL_LIFECYCLES.includes(child.lifecycle) || ['COMPLETED', 'RETIRED'].includes(outcome.class))) child.completed_at = closedAt;
    const pr = observed.prs.get(outcome.issue);
    if (pr) {
      checks = evaluateChecks({ head: pr.head, rollupOid: pr.rollupOid, contexts: pr.contexts, complete: pr.complete, configured: this.binding.required_checks });
      child.pr = { number: pr.number, state: pr.state, head: pr.head,
        checks: { state: checks.state, required_total: checks.required_total, required_passed: checks.required_passed, at_head: checks.at_head } };
    }
    const journals = observed.journals?.get(outcome.issue) || null;
    if (!journals) return { doc: child, checks, journals, findings: [], holds: [] };
    const folded = foldJournals(child, journals);
    return { doc: folded.doc, checks, journals, findings: folded.findings, holds: folded.holds };
  }

  diffChild(outcome, existing, desired, checks, observed, findings, effects, journals = null) {
    const issueNumber = outcome.issue;
    const issue = observed.issues.get(issueNumber);
    if (!issue || issue.is_pull_request) {
      findings.push({ code: 'ISSUE_MISSING', issue: issueNumber, detail: issue ? 'the number is a pull request' : 'the issue could not be read' });
      return;
    }
    if (!existing) effects.push({ kind: 'create_state', target: { issue: issueNumber }, doc: desired });
    else {
      const fields = Object.keys({ ...existing, ...desired }).filter(key => !['revision', 'volatile', 'pending_effects'].includes(key)
        && JSON.stringify(canonical(existing[key])) !== JSON.stringify(canonical(desired[key])));
      if (fields.length) effects.push({ kind: 'update_state', target: { issue: issueNumber }, fields, doc: desired, ...(journals ? { journals } : {}) });
    }
    // Native parent.
    if (outcome.parent) {
      if (issue.parent === null) {
        findings.push({ code: 'NATIVE_PARENT_MISSING', issue: issueNumber, detail: `expected under #${outcome.parent}` });
        effects.push({ kind: 'attach', target: { issue: issueNumber, parent: outcome.parent }, childId: issue.id });
      } else if (issue.parent !== outcome.parent && typeof issue.parent === 'number' && issue.parent !== this.binding.parent_issue && registeredParents(this.binding).includes(issue.parent)) {
        // Another registered parent owns it natively: never move it across programmes.
        findings.push({ code: 'DUPLICATE_HIERARCHY', issue: issueNumber, detail: `catalogued under #${this.binding.parent_issue} but natively under the registered parent #${issue.parent}; not moved, the controller decides` });
      } else if (issue.parent !== outcome.parent) {
        findings.push({ code: 'NATIVE_PARENT_WRONG', issue: issueNumber, detail: `under ${typeof issue.parent === 'number' ? `#${issue.parent}` : issue.parent}, expected #${outcome.parent}` });
        effects.push({ kind: 'reparent', target: { issue: issueNumber, parent: outcome.parent }, childId: issue.id, from: issue.parent });
      }
    } else if (issue.parent !== null) {
      findings.push({ code: 'NATIVE_PARENT_UNEXPECTED', issue: issueNumber, detail: `natively under #${issue.parent} but the catalogue names no parent; not changed` });
    }
    // Dependencies are read and shown; they never imply parentage.
    const blockers = observed.blockedBy.get(issueNumber) || [];
    if (blockers.length && !outcome.parent) {
      findings.push({ code: 'DEPENDENCY_IMPLIES_PARENT', issue: issueNumber, detail: `blocked by ${blockers.map(n => `#${n}`).join(', ')}; a dependency never sets a parent (refused)` });
    }
    // PR head and checks.
    const pr = observed.prs.get(issueNumber);
    if (pr) {
      if (pr.state === 'MERGED' && checks.state === 'GREEN' && checks.at_head === pr.head && issue.state === 'open') {
        const gate = desired.gate.role;
        const gateAccepted = currentGateAccepted(desired);
        const accepted = completionAccepted(desired);
        const uat = desired.uat.state ? uatText(desired) : null;
        const review = desired.review.state ? reviewText(desired) : null;
        // Closable as completed: G1-or-later acceptance, UAT settled at the head, every review verdict at the
        // head passed, merged into the default branch (a staged PR uses Refs) and no open sub-issue.
        const headVerdicts = (desired.review.verdicts || []).filter(verdict => verdict.head === pr.head);
        const reviewSettled = review === 'PASSED' ? headVerdicts.every(verdict => verdict.verdict === 'PASSED') : review === null && !(desired.review.verdicts || []).length;
        const openSubs = issue.open_sub_issues > 0 || (observed.subIssues.get(issueNumber) || []).some(sub => observed.issues.get(sub.number)?.state !== 'closed');
        const closable = accepted && CLOSABLE_UAT.includes(uat) && reviewSettled && Boolean(pr.base) && pr.base === pr.default_branch && !openSubs;
        findings.push({ code: 'READY_TO_CLOSE', issue: issueNumber, pr: pr.number, head: pr.head, gate, gate_accepted: gateAccepted, accepted, closable, uat, review,
          detail: `PR #${pr.number} merged, checks GREEN at ${shortSha(pr.head)}; ${gate || 'unassigned gate'} ${gateAccepted ? 'acceptance recorded' : 'not accepted'}` });
      }
      if (desired.candidate.head && pr.state !== 'MERGED' && pr.state !== 'CLOSED' && desired.candidate.head !== pr.head) {
        findings.push({ code: 'PR_HEAD_MOVED', issue: issueNumber, head: pr.head, detail: `candidate ${shortSha(desired.candidate.head)}, PR #${pr.number} head ${shortSha(pr.head)}; review and UAT evidence at the old head is STALE_HEAD` });
      }
      if (pr.state === 'OPEN' || pr.state === 'DRAFT') {
        const code = { GREEN: 'CHECKS_GREEN_AT_HEAD', PENDING: 'CHECKS_PENDING', RED: 'CHECKS_RED', UNKNOWN: 'CHECKS_UNKNOWN' }[checks.state];
        const detail = checks.reason || [checks.failing.length ? `failing: ${checks.failing.join(', ')}` : '', checks.missing.length ? `missing: ${checks.missing.join(', ')}` : '', `${checks.required_passed}/${checks.required_total} required passed at ${shortSha(checks.at_head)}`].filter(Boolean).join('; ');
        findings.push({ code, issue: issueNumber, ...(code === 'CHECKS_RED' ? { head: checks.at_head || pr.head } : {}), detail });
      }
    }
    // Document versus issue.
    if (desired.lifecycle === 'DONE' && issue.state === 'open') findings.push({ code: 'CHILD_STATE_CONFLICT', issue: issueNumber, detail: 'the state document says DONE but the issue is open' });
    if (!['DONE', 'RETIRED'].includes(desired.lifecycle) && issue.state === 'closed') findings.push({ code: 'CHILD_STATE_CONFLICT', issue: issueNumber, detail: `the issue is closed but the state document says ${desired.lifecycle}` });
    if (pr?.state === 'MERGED' && desired.lifecycle !== 'DONE' && !completionAccepted(desired)) {
      findings.push({ code: 'CHILD_STATE_CONFLICT', issue: issueNumber, detail: `PR #${pr.number} is merged but no accepted completion is recorded` });
    }
  }

  // Native siblings follow the Programme Graph order.
  diffOrder(parent, observed, effects, findings, plannedParents, docs) {
    const graph = graphOrder(parent, docs, observed.issues);
    const catalogued = new Set(parent.outcomes.map(outcome => outcome.issue));
    for (const [parentNumber, list] of observed.subIssues) {
      for (const sub of list) {
        if (!catalogued.has(sub.number) && sub.number !== parent.parent_issue) {
          findings.push({ code: 'NATIVE_CHILD_UNKNOWN', issue: sub.number, detail: `natively under #${parentNumber} but not in the outcome catalogue; not changed` });
        }
      }
      const desired = graph.filter(outcome => outcome.parent === parentNumber).map(outcome => outcome.issue);
      // Simulate the planned attaches (appended at the end) and moves away.
      const current = list.map(sub => sub.number).filter(number => plannedParents.get(number) === undefined || plannedParents.get(number) === parentNumber);
      for (const [number, target] of plannedParents) if (target === parentNumber && !current.includes(number)) current.push(number);
      const moves = orderMoves(current, desired);
      if (moves.length) findings.push({ code: 'NATIVE_ORDER_DRIFT', issue: parentNumber, detail: `${moves.length} move(s) to match the catalogue order` });
      for (const move of moves) effects.push({ kind: 'reorder', target: { parent: parentNumber, ...move } });
    }
  }

  // A task page's own task name, the topic its untopiced comments fall under (null for the parent).
  topicFor(parent, number, issues = new Map()) {
    if (number === parent.parent_issue) return null;
    const outcome = parent.outcomes.find(entry => entry.issue === number);
    return outcome ? taskTitle(outcome, issues.get(number)) : null;
  }

  // The links block for a task page (null for the parent page).
  navFor(parent, number, docs) {
    if (number === parent.parent_issue) return null;
    const outcomes = new Map(parent.outcomes.map(outcome => [outcome.issue, outcome]));
    const chain = [number];
    const seen = new Set(chain);
    for (let at = outcomes.get(number)?.parent; at && at !== parent.parent_issue && outcomes.has(at) && !seen.has(at); at = outcomes.get(at).parent) {
      chain.unshift(at);
      seen.add(at);
    }
    chain.unshift(parent.parent_issue);
    return renderNavBlockBody(chain, docs.get(number)?.pr?.number || null);
  }

  renderAll(parent, children, issues) {
    const outcomes = new Map(parent.outcomes.map(outcome => [outcome.issue, outcome]));
    const blocks = new Map([[parent.parent_issue, renderParentBlockBody(parent, children, issues)]]);
    for (const child of children.values()) blocks.set(child.issue, renderChildBlockBody(child, outcomes.get(child.issue)));
    return blocks;
  }

  // The decision-trace audit on the parent and each catalogued issue whose body this pass does not
  // rewrite with a fresh comment trace. Report only.
  auditTraces(parent, observed, only, findings, effects) {
    const numbers = only ? [only, parent.parent_issue] : [parent.parent_issue, ...parent.outcomes.map(outcome => outcome.issue)];
    const traced = new Set(effects.filter(effect => effect.kind === 'replace_block').map(effect => effect.target.issue));
    for (const number of numbers) {
      const issue = observed.issues.get(number);
      if (!issue || traced.has(number)) continue;
      const result = auditDecisionTraces({ body: issue.body, comments: observed.comments.get(number) || [], recordPrefix: this.binding.record_prefix, threshold: this.threshold });
      if (result.unlinked_decisions.length) findings.push({ code: 'TRACE_UNLINKED', issue: number, detail: `${result.unlinked_decisions.length} decision comment(s) are not linked from the body or an index comment it links; write the lines from decision-trace-audit --repair` });
      for (const entry of result.superseded_unmarked) findings.push({ code: 'TRACE_SUPERSEDED_UNMARKED', issue: number, detail: `${entry.record} is superseded by ${entry.superseded_by} but not marked "superseded by"` });
    }
  }

  // The parent page puts the Programme Graph right under the CURRENT summary (the binding's
  // projection places the summary); task pages put their status block right under the title.
  placementFor(number) {
    return number === this.binding.parent_issue ? { ...(this.binding.projection || {}), after_block: CURRENT_BLOCK_NAME } : {};
  }

  // The body with the state block and the comment trace written. When it would reach the threshold,
  // the trace's own lines move to a new index comment: `overflow` lists them, and the body is
  // measured with a link to that comment in their place.
  projectBody(number, source, stateBody, comments, version, navBody = null, currentBody = null, topic = null) {
    const trace = traceEntries(comments, this.binding.record_prefix);
    const build = entries => {
      const traceBody = renderTraceBlockBody(number, entries, this.binding.repository, topic);
      const withCurrent = currentBody ? upsertCurrentBlock(source, renderBlock(currentBody, version, CURRENT_BLOCK_NAME), this.placementFor(number).after_section) : source;
      const withState = upsertStateBlock(withCurrent, renderBlock(stateBody, version), this.placementFor(number));
      const withNav = navBody ? upsertNavBlock(withState.body, renderBlock(navBody, version, NAV_BLOCK_NAME)) : withState.body;
      return { body: upsertTraceBlock(withNav, renderBlock(traceBody, version, TRACE_BLOCK_NAME)), traceBody, moved: withState.moved };
    };
    const full = build(trace);
    if (full.body.length < this.threshold) return { ...full, overflow: [] };
    // Tag by tag, largest list first, the whole list moves into its own new index comment until the
    // body fits; the body keeps a link in that tag's list. Tags are never combined.
    const base = issueUrl(this.binding.repository, number);
    const links = group => traceTokens({ ...group, indexes: [] }, base);
    const size = group => links(group).join(' · ').length;
    const movable = traceGroups(trace, topic).filter(group => group.entries.length || group.marks.length).sort((a, b) => size(b) - size(a));
    let current = trace;
    let projected = full;
    const overflow = [];
    for (const group of movable) {
      current = {
        indexes: [...current.indexes, { id: '9'.repeat(19), tag: group.tag, date: '0000-00-00' }],
        entries: current.entries.filter(entry => topicKey(entry, topic) !== group.tag),
        marks: current.marks.filter(mark => topicKey(mark, topic) !== group.tag),
      };
      overflow.push({ tag: group.tag, label: group.tag ? group.label : topic, lines: links(group) });
      projected = build(current);
      if (projected.body.length < this.threshold) break;
    }
    return { ...projected, overflow };
  }

  // An open or draft PR for a task starts with the same links as the task page, plus the PR itself.
  diffPrNav(number, doc, navBody, observed, effects) {
    const pr = doc?.pr;
    if (!navBody || !pr?.number || !['OPEN', 'DRAFT'].includes(pr.state)) return;
    const page = observed.prPages?.get(pr.number);
    if (!page) return;
    const found = findStateBlock(page.body, NAV_BLOCK_NAME);
    if (found.error) return;
    if (found.block && normalizeBlockBody(found.block.body) === normalizeBlockBody(navBody) && !found.block.tampered) return;
    effects.push({ kind: 'replace_pr_nav', target: { issue: number, pr: pr.number, digest: blockDigest(navBody) }, body: navBody });
  }

  diffBlocks(parent, children, observed, only, effects, findings, holds, targetsOverride = null) {
    const blocks = this.renderAll(parent, children, observed.issues);
    const version = this.toolkitVersion || '0.0.0';
    const targets = targetsOverride || (only ? [only, parent.parent_issue] : [...blocks.keys()]);
    for (const number of targets) {
      const issue = observed.issues.get(number);
      const body = blocks.get(number);
      if (!issue || body === undefined) continue;
      const { block, error } = findStateBlock(issue.body);
      const traced = findStateBlock(issue.body, TRACE_BLOCK_NAME);
      const nav = findStateBlock(issue.body, NAV_BLOCK_NAME);
      if (error || traced.error || nav.error) { findings.push({ code: 'MANAGED_BLOCK_BROKEN', issue: number, detail: error || traced.error || nav.error }); continue; }
      const navBody = this.navFor(parent, number, children);
      const currentBody = number === parent.parent_issue ? renderCurrentBlockBody(parent, children, observed.issues) : null;
      const summary = currentBody ? findStateBlock(issue.body, CURRENT_BLOCK_NAME) : { block: null, error: null };
      if (summary.error) { findings.push({ code: 'MANAGED_BLOCK_BROKEN', issue: number, detail: summary.error }); continue; }
      // A page written by a newer Toolkit is left alone, so computers on different versions never
      // flip it between two layouts.
      const newest = newestBlockVersion(issue.body);
      if (this.toolkitVersion && newest && versionNewer(newest, this.toolkitVersion)) {
        holds.push({ code: 'BLOCK_NEWER_TOOLKIT', target: `#${number}`, detail: `#${number} was written by Toolkit ${newest}, newer than this copy (${this.toolkitVersion}); update Toolkit on this computer, then run again`, scope: 'body' });
        continue;
      }
      const currentCurrent = !currentBody || (Boolean(summary.block) && normalizeBlockBody(summary.block.body) === normalizeBlockBody(currentBody) && !summary.block.tampered);
      const navCurrent = !navBody || (Boolean(nav.block) && normalizeBlockBody(nav.block.body) === normalizeBlockBody(navBody) && !nav.block.tampered);
      this.diffPrNav(number, children.get(number), navBody, observed, effects, version);
      const comments = observed.comments.get(number) || [];
      const placement = this.placementFor(number);
      const current = block && normalizeBlockBody(block.body) === normalizeBlockBody(body) && !block.tampered;
      const move = Boolean(block) && upsertStateBlock(issue.body, renderBlock(block.body, block.version), placement).moved;
      const topic = this.topicFor(parent, number, observed.issues);
      const traceBody = renderTraceBlockBody(number, traceEntries(comments, this.binding.record_prefix), this.binding.repository, topic);
      const traceCurrent = Boolean(traced.block) && normalizeBlockBody(traced.block.body) === normalizeBlockBody(traceBody) && !traced.block.tampered;
      // A current body at or over the threshold still moves its largest tag lists out.
      if (current && !move && traceCurrent && navCurrent && currentCurrent && issue.body.length < this.threshold) continue;
      if (!current || move) findings.push({ code: 'PROJECTION_STALE', issue: number, detail: !block ? 'no state block yet' : block.tampered ? 'the block was edited by hand' : current ? 'the block is not in its place on the page' : 'the block differs from the state documents' });
      if (!traceCurrent) findings.push({ code: 'TRACE_STALE', issue: number, detail: !traced.block ? 'no comment trace yet' : traced.block.tampered ? 'the comment trace was edited by hand' : 'the comment trace differs from the comments' });
      if (!navCurrent) findings.push({ code: 'PROJECTION_STALE', issue: number, detail: nav.block ? 'the parent and task links differ from the state' : 'no parent and task links yet' });
      if (!currentCurrent) findings.push({ code: 'PROJECTION_STALE', issue: number, detail: summary.block ? 'the CURRENT summary differs from the state documents' : 'no CURRENT summary yet' });
      const projected = this.projectBody(number, issue.body, body, comments, version, navBody, currentBody, topic);
      if (projected.body.length >= this.threshold) {
        holds.push({ code: 'BODY_TOO_LARGE', target: `#${number}`, detail: `Controller: the body would reach ${projected.body.length} characters (threshold ${this.threshold}) even with its comment trace in an index comment; shorten it first`, scope: 'body' });
        continue;
      }
      for (const part of projected.overflow) effects.push({ kind: 'post_index_comment', target: { issue: number, tag: part.tag, after: String(comments.at(-1)?.id || '') }, label: part.label, lines: part.lines });
      effects.push({ kind: 'replace_block', target: { issue: number, digest: blockDigest(body), trace: blockDigest(projected.traceBody), ...(navBody ? { nav: blockDigest(navBody) } : {}), ...(currentBody ? { current: blockDigest(currentBody) } : {}) },
        insert: !block, move: current && move, state: !current || move, stale: { trace: !traceCurrent, nav: !navCurrent, current: !currentCurrent }, body, updated_at: issue.updated_at });
    }
  }

  // Resolve pending effects left by an earlier pass by reading their targets. Nothing is replayed
  // without that read; an unreadable target stays UNKNOWN and holds.
  recover(docs, observed, holds) {
    const resolutions = [];
    for (const { kind, number, doc } of docs) {
      for (const effect of doc.pending_effects) {
        let done = null;
        const target = effect.target;
        if (effect.kind === 'attach' || effect.kind === 'reparent') {
          const issue = observed.issues.has(target.issue) ? observed.issues.get(target.issue) : this.reader.issue(target.issue);
          done = issue ? issue.parent === target.parent : null;
        } else if (effect.kind === 'reorder') {
          const list = observed.subIssues.get(target.parent) || null;
          if (list) done = moveDone(list, target);
        } else if (effect.kind === 'replace_block') {
          const issue = observed.issues.has(target.issue) ? observed.issues.get(target.issue) : this.reader.issue(target.issue);
          const found = issue ? findStateBlock(issue.body).block : undefined;
          const trace = issue && target.trace ? findStateBlock(issue.body, TRACE_BLOCK_NAME).block : undefined;
          const nav = issue && target.nav ? findStateBlock(issue.body, NAV_BLOCK_NAME).block : undefined;
          done = issue ? Boolean(found && blockDigest(found.body) === target.digest && !found.tampered && (!target.trace || (trace && blockDigest(trace.body) === target.trace))
            && (!target.nav || (nav && blockDigest(nav.body) === target.nav))
            && (!target.current || Boolean(findStateBlock(issue.body, CURRENT_BLOCK_NAME).block && blockDigest(findStateBlock(issue.body, CURRENT_BLOCK_NAME).block.body) === target.current))) : null;
        } else if (effect.kind === 'replace_pr_nav') {
          const page = this.reader.issue(target.pr);
          const nav = page ? findStateBlock(page.body, NAV_BLOCK_NAME).block : undefined;
          done = page ? Boolean(nav && blockDigest(nav.body) === target.digest) : null;
        } else if (effect.kind === 'post_index_comment') {
          const comments = observed.comments.get(target.issue) || this.reader.comments(target.issue);
          done = comments.some(comment => String(comment.body || '').includes(`programme-trace intent=${effect.intent_id} `));
        }
        if (done === null) holds.push({ code: 'EFFECT_UNKNOWN', target: `#${target.issue}`, detail: `${effect.kind} from an earlier pass could not be checked; held`, scope: holdScope(effect.kind) });
        resolutions.push({ kind, number, intent_id: effect.intent_id, outcome: done === null ? 'UNKNOWN' : done ? 'DONE' : 'NOT_DONE' });
      }
    }
    return resolutions;
  }

  // One-time findings that stay open although this pass did not report them again:
  // - RETURN_CAPTURED while the live assignment holds a return no verdict has consumed (a return left
  //   by an interrupted or superseded assignment can no longer be consumed, so it does not hold);
  // - JOURNAL_ERROR and JOURNAL_INVALID while still new and the task has a live gate;
  // - STALE_ASSIGNMENT while still new.
  // An acknowledged one (RETURN_CAPTURED apart) resolves on the next complete pass; a disposed one is
  // closed already.
  oneTimeHolds(attention, children) {
    return (attention || []).filter(entry => ONE_TIME_CODES.has(entry.code) && OPEN_FINDING_STATES.includes(entry.state)).filter(entry => {
      const gate = children.get(entry.issue)?.gate;
      if (entry.code === 'RETURN_CAPTURED') {
        const live = LIVE_GATE_STATES.includes(gate?.state) ? gate.assignment?.id : null;
        return Boolean(live && gate.returns?.some(item => !item.consumed && item.assignment === live));
      }
      if (entry.state !== 'new') return false;
      return entry.code === 'STALE_ASSIGNMENT' || LIVE_GATE_STATES.includes(gate?.state);
    }).map(entry => entry.id);
  }

  // The attention findings this pass records on the parent: the reconcile source from a full pass
  // (a pass for one issue records none), and the inventory source when the pass carries an inventory.
  // When they change, the parent's CURRENT block is planned again with the new list, so the page
  // shows them after this pass.
  planAttention(parent, projected, observed, only, override, inventory, effects, findings, holds) {
    const folds = [];
    if (!only && !override) folds.push({ source: 'reconcile', complete: true, seen: findings.filter(finding => ATTENTION.has(finding.code)).map(({ code, issue, head = null, since = null }) => ({ code, issue, head, ...(since ? { since } : {}) })), hold: this.oneTimeHolds(parent.attention, projected) });
    if (inventory) folds.push({ source: 'inventory', complete: inventory.complete, seen: inventory.findings });
    if (!folds.length) return;
    const now = this.now();
    const stored = parent.attention || [];
    const next = folds.reduce((list, fold) => foldAttention(list, { ...fold, now }), stored);
    if (JSON.stringify(canonical(next)) === JSON.stringify(canonical(stored))) return;
    effects.push({ kind: 'update_attention', target: { issue: parent.parent_issue }, folds, now, line: attentionLine(next) });
    const number = parent.parent_issue;
    const blockFindings = new Set(['PROJECTION_STALE', 'TRACE_STALE', 'MANAGED_BLOCK_BROKEN']);
    const keep = (list, test) => { const kept = list.filter(item => !test(item)); list.splice(0, list.length, ...kept); };
    keep(effects, effect => ['replace_block', 'post_index_comment'].includes(effect.kind) && effect.target.issue === number);
    keep(findings, finding => finding.issue === number && blockFindings.has(finding.code));
    keep(holds, hold => hold.target === `#${number}` && ['BLOCK_NEWER_TOOLKIT', 'BODY_TOO_LARGE'].includes(hold.code));
    this.diffBlocks({ ...parent, attention: next }, projected, observed, only, effects, findings, holds, [number]);
  }

  plan({ issue: only = null, parentOverride = null, inventory = null } = {}) {
    const holds = [];
    const parentRead = this.loadParent(parentOverride);
    if (!parentRead.doc) {
      return { parent: null, findings: [], effects: [], holds: [{ code: 'PARENT_STATE_MISSING', target: `#${this.binding.parent_issue}`, detail: `No parent state document for #${this.binding.parent_issue} yet. The appointed controller creates and holds it with init-parent --apply --controller; other sessions report this to the controller.` }], resolutions: [] };
    }
    const parent = parentRead.doc;
    if (parent.repository.toLowerCase() !== this.binding.repository.toLowerCase() || parent.parent_issue !== this.binding.parent_issue) {
      throw new ProgrammeError('STATE_INVALID', 'The parent state document belongs to a different repository or parent issue.');
    }
    if (only && !parent.outcomes.some(outcome => outcome.issue === only)) throw new ProgrammeError('USAGE', `#${only} is not in the outcome catalogue.`);
    const children = new Map(parent.outcomes.map(outcome => [outcome.issue, this.store.read('child', outcome.issue)]));
    const observed = this.observe(parent, children, only);
    const resolutions = this.recover([
      { kind: 'parent', number: parent.parent_issue, doc: parent },
      ...[...children.values()].filter(entry => entry.doc).map(entry => ({ kind: 'child', number: entry.doc.issue, doc: entry.doc })),
    ], observed, holds);
    const findings = [];
    const effects = [];
    const desiredDocs = new Map();
    for (const outcome of parent.outcomes) {
      const existing = children.get(outcome.issue)?.doc || null;
      if (only && outcome.issue !== only) { if (existing) desiredDocs.set(outcome.issue, existing); continue; }
      const { doc: desired, checks, journals, findings: journalFindings, holds: journalHolds } = this.desiredChild(outcome, existing, observed);
      findings.push(...journalFindings);
      holds.push(...journalHolds);
      this.diffChild(outcome, existing, desired, checks, observed, findings, effects, journals);
      desiredDocs.set(outcome.issue, desired);
    }
    const plannedParents = new Map(effects.filter(effect => effect.kind === 'attach' || effect.kind === 'reparent').map(effect => [effect.target.issue, effect.target.parent]));
    if (!only) this.diffOrder(parent, observed, effects, findings, plannedParents, desiredDocs);
    // Blocks are rendered from the revisions the documents will have after this pass.
    const projected = new Map([...desiredDocs].map(([number, doc]) => {
      const existing = children.get(number)?.doc;
      const copy = clone(doc);
      copy.revision = existing ? existing.revision + (contentDigest(existing) === contentDigest(doc) ? 0 : 1) : 1;
      return [number, copy];
    }));
    this.diffBlocks(parent, projected, observed, only, effects, findings, holds);
    this.auditTraces(parent, observed, only, findings, effects);
    this.diffUntracked(parent, desiredDocs, observed, only, findings);
    const legacy = parent.outcomes.filter(outcome => LEGACY_CLASSES.includes(outcome.class) && (!only || outcome.issue === only));
    if (legacy.length) findings.push({ code: 'CLASS_LEGACY', issue: parent.parent_issue, patch: legacyMigrationPatch(parent),
      detail: `${legacy.map(outcome => `#${outcome.issue} ${outcome.class}`).join(', ')} read as COMMITTED and sort like any other task, by group, priority (order) and child number; to migrate, save this finding's patch (reconcile --json) and apply it whole with update-parent, which sets COMMITTED and renumbers order in the old CORE, HARDENING, LATER sequence` });
    if (!only) for (const tie of orderTies(parent, desiredDocs)) findings.push({ code: 'ORDER_TIE', issue: parent.parent_issue, detail: `${tie.map(outcome => `#${outcome.issue}`).join(', ')} share priority order ${tie[0].order}, so child number decides. Controller: set a distinct order with update-parent; if CLASS_LEGACY is reported too, migrate first, or set COMMITTED and the priority in one update-parent patch` });
    this.planAttention(parent, projected, observed, only, Boolean(parentOverride), inventory, effects, findings, holds);
    for (const effect of effects) effect.text = describeEffect(effect);
    return { parent, parentSha: parentRead.sha, override: Boolean(parentRead.override), children, observed, findings, effects, holds, resolutions };
  }

  // Runs the planned effects in order: state documents, native links, order, then bodies.
  apply(plan) {
    if (plan.override) throw new ProgrammeError('USAGE', 'A parent document read from a file can only be used for a dry run.');
    const writer = this.writer;
    const results = [];
    const holds = [...plan.holds];
    const parentNumber = plan.parent.parent_issue;
    let parentDoc = null;
    // The parent fence is read again immediately before every state write and every GitHub change,
    // so a takeover stops this pass at its next effect (STALE_WRITER). An intent it leaves IN_FLIGHT
    // is settled by readback in the successor's next pass, never replayed.
    const guard = () => {
      const fresh = this.store.read('parent', parentNumber).doc;
      authoriseWrite('parent', fresh, null, writer);
      parentDoc = fresh;
    };
    guard();
    const mutateDoc = (kind, number, options) => {
      guard();
      const result = this.store.mutate(kind, number, { writer, parentDoc, ...options });
      if (kind === 'parent') parentDoc = result.doc;
      return result;
    };
    const docOwner = number => (number === parentNumber ? 'parent' : 'child');
    // A hold stops later effects of the same scope on that issue: a body hold never blocks its links.
    const held = new Map();
    const markHeld = (target, scope) => { if (!held.has(target)) held.set(target, new Set()); held.get(target).add(scope); };
    const isHeld = (target, scope) => Boolean(held.get(target) && (held.get(target).has('all') || held.get(target).has(scope)));
    for (const entry of holds) markHeld(entry.target, entry.scope || 'all');
    const outcomes = new Map(plan.parent.outcomes.map(outcome => [outcome.issue, outcome]));
    const record = (effect, outcome, detail = null) => { results.push({ kind: effect.kind, target: effect.target, text: effect.text, outcome, ...(detail ? { detail } : {}) }); };
    const hold = (effect, code, detail) => {
      const scope = holdScope(effect.kind);
      holds.push({ code, target: `#${effect.target.issue}`, detail, scope });
      markHeld(`#${effect.target.issue}`, scope);
    };

    // Resolve recovered effects first: DONE and NOT_DONE leave the document; UNKNOWN stays.
    for (const resolution of plan.resolutions.filter(entry => entry.outcome !== 'UNKNOWN')) {
      mutateDoc(resolution.kind, resolution.number, {
        change: doc => {
          const kept = doc.pending_effects.filter(effect => effect.intent_id !== resolution.intent_id);
          if (kept.length === doc.pending_effects.length) return null;
          doc.pending_effects = kept;
          return doc;
        },
      });
    }

    // `run` calls `guard` right before its GitHub change and returns the readback outcome.
    const withIntent = (effect, ownerKind, ownerNumber, run) => {
      const intent = { intent_id: intentId(effect.kind, effect.target), kind: effect.kind, target: effect.target, state: 'IN_FLIGHT' };
      const addIntent = doc => (doc.pending_effects.some(entry => entry.intent_id === intent.intent_id) ? null : (doc.pending_effects.push(intent), doc));
      mutateDoc(ownerKind, ownerNumber, { change: addIntent });
      let outcome;
      let detail = null;
      let code = null;
      try { ({ outcome, detail = null, code = null } = run()); }
      catch (error) {
        if (STOPS_PASS.has(error.code)) throw error;
        outcome = 'UNKNOWN';
        detail = error.message;
      }
      if (outcome === 'UNKNOWN') {
        mutateDoc(ownerKind, ownerNumber, { change: doc => {
          const entry = doc.pending_effects.find(item => item.intent_id === intent.intent_id);
          if (!entry || entry.state === 'UNKNOWN') return null;
          entry.state = 'UNKNOWN';
          return doc;
        } });
        hold(effect, 'EFFECT_UNKNOWN', detail || 'the readback did not settle the outcome');
      } else {
        mutateDoc(ownerKind, ownerNumber, { change: doc => {
          const kept = doc.pending_effects.filter(item => item.intent_id !== intent.intent_id);
          if (kept.length === doc.pending_effects.length) return null;
          doc.pending_effects = kept;
          return doc;
        } });
        if (outcome === 'NOT_DONE') hold(effect, code || 'EFFECT_NOT_DONE', detail || 'GitHub did not make the change');
      }
      record(effect, outcome, detail);
    };

    // 1. State documents: the parent's attention findings first, re-folded on the document read now so
    // an acknowledgement made since planning is kept.
    for (const effect of plan.effects.filter(entry => entry.kind === 'update_attention')) {
      try {
        const result = mutateDoc('parent', parentNumber, { change: doc => {
          const stored = doc.attention || [];
          const next = effect.folds.reduce((list, fold) => foldAttention(list, { ...fold, now: effect.now }), stored);
          if (JSON.stringify(canonical(next)) === JSON.stringify(canonical(stored))) return null;
          doc.attention = next;
          // A dispose reason goes when its finding drops off the list.
          const notes = doc.private?.attention_notes;
          if (isObject(notes)) {
            const kept = Object.fromEntries(Object.entries(notes).filter(([id]) => next.some(entry => entry.id === id)));
            if (Object.keys(kept).length !== Object.keys(notes).length) doc.private = { ...doc.private, attention_notes: kept };
          }
          return doc;
        } });
        record(effect, result.outcome === 'NOOP' ? 'NOOP' : 'DONE');
      } catch (error) {
        if (STOPS_PASS.has(error.code)) throw error;
        record(effect, 'HELD', error.message);
        hold(effect, error.code || 'STATE_WRITE_FAILED', error.message);
      }
    }
    for (const effect of plan.effects.filter(entry => entry.kind === 'create_state' || entry.kind === 'update_state')) {
      try {
        const desired = effect.doc;
        // The controller may have written the child after planning. Only PR observations, a
        // completion time taken from the issue and the journals read in this pass belong to it: the
        // gate is re-folded from those journals on the document read at apply time, so an
        // assignment issued since planning is never overwritten.
        const fields = effect.kind === 'create_state' ? ['pr', ...(desired.completed_at ? ['completed_at'] : [])] : effect.fields.filter(key => !effect.journals || !FOLD_FIELDS.includes(key));
        const result = mutateDoc('child', effect.target.issue, {
          create: () => newChild({ repository: this.binding.repository, outcome: outcomes.get(effect.target.issue) }),
          change: doc => {
            for (const key of fields) {
              if (desired[key] === undefined) delete doc[key];
              else doc[key] = clone(desired[key]);
            }
            return effect.journals ? foldJournals(doc, effect.journals).doc : doc;
          },
        });
        record(effect, result.outcome === 'NOOP' ? 'NOOP' : 'DONE');
      } catch (error) {
        if (STOPS_PASS.has(error.code)) throw error;
        record(effect, 'HELD', error.message);
        hold(effect, error.code || 'STATE_WRITE_FAILED', error.message);
      }
    }

    // 2. Native parent links, read back on both sides.
    for (const effect of plan.effects.filter(entry => entry.kind === 'attach' || entry.kind === 'reparent')) {
      if (isHeld(`#${effect.target.issue}`, 'links')) { record(effect, 'SKIPPED', 'held earlier in this pass'); continue; }
      withIntent(effect, 'child', effect.target.issue, () => {
        guard();
        const response = this.mutator.attach(effect.target.parent, effect.childId, effect.kind === 'reparent');
        const issue = this.reader.issue(effect.target.issue);
        const listed = this.reader.subIssues(effect.target.parent).some(sub => sub.number === effect.target.issue);
        if (issue?.parent === effect.target.parent && listed) return { outcome: 'DONE' };
        if (issue && issue.parent !== effect.target.parent && !listed) return { outcome: 'NOT_DONE', detail: `GitHub answered ${response.status}: ${response.json?.message || ''}`.trim() };
        return { outcome: 'UNKNOWN', detail: 'the child and parent disagree after the change' };
      });
    }

    // 3. Order, recomputed from a fresh list for each parent just before moving.
    const reorderParents = [...new Set(plan.effects.filter(entry => entry.kind === 'reorder').map(entry => entry.target.parent))];
    const graph = graphOrder(plan.parent, new Map([...plan.children].filter(([, entry]) => entry.doc).map(([number, entry]) => [number, entry.doc])), plan.observed.issues);
    for (const parentIssue of reorderParents) {
      const desired = graph.filter(outcome => outcome.parent === parentIssue).map(outcome => outcome.issue);
      const fresh = this.reader.subIssues(parentIssue);
      const ids = new Map(fresh.map(sub => [sub.number, sub.id]));
      for (const move of orderMoves(fresh.map(sub => sub.number), desired)) {
        const effect = { kind: 'reorder', target: { parent: parentIssue, ...move } };
        effect.text = describeEffect(effect);
        const owner = docOwner(parentIssue);
        if (owner === 'child' && !plan.children.get(parentIssue)?.doc && !results.some(entry => entry.kind === 'create_state' && entry.target.issue === parentIssue && entry.outcome === 'DONE')) {
          record(effect, 'SKIPPED', `#${parentIssue} has no state document to hold the intent`);
          continue;
        }
        withIntent(effect, owner, parentIssue, () => {
          const anchor = move.before !== undefined ? { before_id: ids.get(move.before) } : { after_id: ids.get(move.after) };
          guard();
          const response = this.mutator.reorder(parentIssue, ids.get(move.issue), anchor);
          if (moveDone(this.reader.subIssues(parentIssue), move)) return { outcome: 'DONE' };
          return { outcome: okStatus(response.status) ? 'UNKNOWN' : 'NOT_DONE', detail: `GitHub answered ${response.status}` };
        });
      }
    }

    // 4. Bodies, re-rendered from freshly read documents so the blocks show the final revisions.
    const blockEffects = plan.effects.filter(entry => entry.kind === 'replace_block');
    if (blockEffects.length) {
      guard();
      const docs = new Map(plan.parent.outcomes.map(outcome => [outcome.issue, this.store.read('child', outcome.issue).doc]).filter(([, doc]) => doc));
      const blocks = this.renderAll(parentDoc, docs, plan.observed.issues);
      const version = this.toolkitVersion;
      const ordered = [...blockEffects.filter(effect => effect.target.issue !== parentNumber), ...blockEffects.filter(effect => effect.target.issue === parentNumber)];
      for (const planned of ordered) {
        const number = planned.target.issue;
        const body = blocks.get(number);
        let effect = { ...planned, target: { ...planned.target, digest: blockDigest(body) } };
        if (isHeld(`#${number}`, 'body')) { record(effect, 'SKIPPED', 'held earlier in this pass'); continue; }
        if (!version) { record(effect, 'HELD', 'the Toolkit version could not be read'); hold(effect, 'TOOLKIT_VERSION_UNKNOWN', 'the Toolkit version could not be read, so no block was written'); continue; }
        const owner = docOwner(number);
        if (owner === 'child' && !docs.has(number)) { record(effect, 'SKIPPED', 'no state document yet'); continue; }
        // An overflowing tag's list first moves into its own new index comment, checked by reading it back.
        for (const post of plan.effects.filter(entry => entry.kind === 'post_index_comment' && entry.target.issue === number)) {
          if (isHeld(`#${number}`, 'body')) break;
          withIntent(post, owner, number, () => {
            const intent = intentId(post.kind, post.target);
            const bodies = indexCommentBodies(number, post.lines, intent, post.target.tag, post.label);
            guard();
            for (const text of bodies) this.mutator.postComment(number, text);
            const kept = this.reader.comments(number).filter(comment => String(comment.body || '').includes(`programme-trace intent=${intent} `)).length;
            if (kept === bodies.length) return { outcome: 'DONE' };
            return kept ? { outcome: 'UNKNOWN', detail: `${kept} of ${bodies.length} index comment part(s) read back` } : { outcome: 'NOT_DONE', detail: 'the index comment did not read back' };
          });
        }
        if (isHeld(`#${number}`, 'body')) { record(effect, 'SKIPPED', 'the comment trace could not move to an index comment'); continue; }
        // The new body is built from a fresh read, so earlier edits by people are kept. Refuse before
        // writing an intent when the block is broken or the body would grow past the threshold.
        const before = this.reader.issue(number);
        if (!before) { record(effect, 'HELD', 'the issue could not be read'); hold(effect, 'ISSUE_MISSING', 'the issue could not be read'); continue; }
        const newest = newestBlockVersion(before.body);
        if (newest && versionNewer(newest, version)) { record(effect, 'HELD', `written by Toolkit ${newest}`); hold(effect, 'BLOCK_NEWER_TOOLKIT', `#${number} was written by Toolkit ${newest}, newer than this copy (${version}); update Toolkit on this computer, then run again`); continue; }
        let next;
        const navBody = this.navFor(parentDoc, number, docs);
        const currentBody = number === parentNumber ? renderCurrentBlockBody(parentDoc, docs, plan.observed.issues) : null;
        try { next = this.projectBody(number, before.body, body, this.reader.comments(number), version, navBody, currentBody, this.topicFor(parentDoc, number, plan.observed.issues)); }
        catch (error) { record(effect, 'HELD', error.message); hold(effect, error.code, error.message); continue; }
        effect = { ...effect, target: { ...effect.target, trace: blockDigest(next.traceBody), ...(navBody ? { nav: blockDigest(navBody) } : {}), ...(currentBody ? { current: blockDigest(currentBody) } : {}) } };
        if (next.overflow.length || next.body.length >= this.threshold) {
          record(effect, 'HELD', `the body would be ${next.body.length} characters`);
          hold(effect, 'BODY_TOO_LARGE', `Controller: the body would reach ${next.body.length} characters (threshold ${this.threshold}); shorten it first`);
          continue;
        }
        withIntent(effect, owner, number, () => {
          // Issue PATCH has no compare-and-swap: re-read immediately before writing and refuse on change.
          const latest = this.reader.issue(number);
          if (!latest || latest.body !== before.body || latest.updated_at !== before.updated_at) {
            return { outcome: 'NOT_DONE', code: 'BODY_MOVED', detail: 'the issue changed between the read and the write; the next pass re-plans it' };
          }
          guard();
          const response = this.mutator.writeBody(number, next.body);
          const after = this.reader.issue(number);
          if (after && after.body === next.body) return { outcome: 'DONE' };
          if (!okStatus(response.status) && after && after.body === before.body) return { outcome: 'NOT_DONE', detail: `GitHub answered ${response.status}` };
          return { outcome: 'UNKNOWN', detail: 'the body did not read back exactly as written' };
        });
      }
    }

    // 5. The parent and task links at the top of each open or draft PR, built from a fresh read.
    for (const effect of plan.effects.filter(entry => entry.kind === 'replace_pr_nav')) {
      const number = effect.target.issue;
      const pr = effect.target.pr;
      if (isHeld(`#${number}`, 'pr')) { record(effect, 'SKIPPED', 'held earlier in this pass'); continue; }
      if (!this.toolkitVersion) { record(effect, 'HELD', 'the Toolkit version could not be read'); hold(effect, 'TOOLKIT_VERSION_UNKNOWN', 'the Toolkit version could not be read, so no links were written'); continue; }
      if (!plan.children.get(number)?.doc && !results.some(entry => entry.kind === 'create_state' && entry.target.issue === number && entry.outcome === 'DONE')) {
        record(effect, 'SKIPPED', `#${number} has no state document to hold the intent`);
        continue;
      }
      const before = this.reader.issue(pr);
      if (!before) { record(effect, 'HELD', 'the PR could not be read'); hold(effect, 'ISSUE_MISSING', `PR #${pr} could not be read`); continue; }
      let next;
      try { next = upsertNavBlock(before.body, renderBlock(effect.body, this.toolkitVersion, NAV_BLOCK_NAME)); }
      catch (error) { record(effect, 'HELD', error.message); hold(effect, error.code, error.message); continue; }
      withIntent(effect, 'child', number, () => {
        const latest = this.reader.issue(pr);
        if (!latest || latest.body !== before.body || latest.updated_at !== before.updated_at) {
          return { outcome: 'NOT_DONE', code: 'BODY_MOVED', detail: 'the PR changed between the read and the write; the next pass re-plans it' };
        }
        guard();
        const response = this.mutator.writeBody(pr, next);
        const after = this.reader.issue(pr);
        if (after && after.body === next) return { outcome: 'DONE' };
        if (!okStatus(response.status) && after && after.body === before.body) return { outcome: 'NOT_DONE', detail: `GitHub answered ${response.status}` };
        return { outcome: 'UNKNOWN', detail: 'the PR description did not read back exactly as written' };
      });
    }
    return { results, holds };
  }

  run({ apply = false, issue = null, parentOverride = null, inventory = null } = {}) {
    const plan = this.plan({ issue, parentOverride, inventory });
    const report = {
      repository: this.binding.repository,
      parent_issue: this.binding.parent_issue,
      store: { ...this.binding.store },
      mode: apply ? 'apply' : 'dry-run',
      parent_revision: plan.parent?.revision ?? null,
      findings: plan.findings,
      close_list: plan.findings.filter(finding => finding.code === 'READY_TO_CLOSE').map(({ issue, pr, head, gate, gate_accepted, accepted, closable, uat, review }) => ({ issue, pr, head, gate, gate_accepted, accepted, closable, uat, review })),
      effects: plan.effects.map(effect => ({ kind: effect.kind, target: effect.target, text: effect.text })),
      recovered: plan.resolutions,
      holds: plan.holds,
      results: [],
      writes: { state: 0, github: 0 },
      ...(inventory ? { inventory: { complete: inventory.complete, reason: inventory.reason, counts: inventoryCounts(inventory) } } : {}),
    };
    if (apply && plan.parent && (plan.effects.length || plan.resolutions.some(entry => entry.outcome !== 'UNKNOWN'))) {
      const storeWrites = this.store.writes;
      const githubWrites = this.mutator.mutations;
      const { results, holds } = this.apply(plan);
      report.results = results;
      report.holds = holds;
      report.writes = { state: this.store.writes - storeWrites, github: this.mutator.mutations - githubWrites };
    }
    report.summary = !plan.parent ? 'No parent state document'
      : !report.effects.length && !report.holds.length && !plan.resolutions.length ? 'No changes'
        : apply ? `${report.results.filter(entry => entry.outcome === 'DONE').length} of ${report.results.length} effect(s) done, ${report.holds.length} hold(s)`
          : `${report.effects.length} planned effect(s), ${report.holds.length} hold(s)`;
    const planned = plan.effects.find(effect => effect.kind === 'update_attention');
    report.attention = planned ? planned.line : plan.parent ? attentionLine(plan.parent.attention) : null;
    const attention = report.findings.filter(finding => ATTENTION.has(finding.code));
    report.next_action = report.holds.length ? `Controller: resolve ${report.holds[0].code} on ${report.holds[0].target}: ${report.holds[0].detail}`
      : !apply && report.effects.length ? 'Controller: run reconcile --apply --controller for this plan; other sessions report it'
        : !apply && plan.resolutions.some(entry => entry.outcome !== 'UNKNOWN') ? `Controller: run reconcile --apply --controller to clear ${plan.resolutions.filter(entry => entry.outcome !== 'UNKNOWN').length} settled intent(s)`
        : attention.length ? `Controller: decide on ${attention.length} finding(s) the reconciler does not change, starting with ${attention[0].code} on #${attention[0].issue}`
          : 'None: the state documents and GitHub agree';
    if (typeof this.store.stateBranch === 'function') report.state_branch = this.store.stateBranch();
    return report;
  }
}

// ---------------------------------------------------------------------------------------------
// Repository identity

// github.com, its subdomains (ssh.github.com), or an SSH alias with no dot that mentions github
// (github-work). Any other dotted host, a GitHub Enterprise server included, is not github.com.
function isGitHubHost(host) {
  const name = String(host || '').toLowerCase();
  return name === 'github.com' || name.endsWith('.github.com') || (!name.includes('.') && name.includes('github'));
}

function originSlug(url) {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?|[^@/\s]+@)?([^/:@\s]+)(?::\d+)?[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(url || '').trim());
  return match && isGitHubHost(match[1]) ? `${match[2]}/${match[3]}` : null;
}

// The repository is the `origin` remote, confirmed by GitHub's own name for it. The binding file
// must name the same repository and cannot override it.
function bindRepository({ transport, originUrl, binding }) {
  const origin = originSlug(originUrl);
  if (!origin) throw new ProgrammeError('REPO_IDENTITY_MISMATCH', 'The origin remote is not a GitHub repository.');
  const response = transport.request('GET', `repos/${origin}`);
  if (response.status !== 200) throw ghFailure(response, `Reading ${origin}`);
  const live = response.json.full_name;
  if (live.toLowerCase() !== origin.toLowerCase() || live.toLowerCase() !== binding.repository.toLowerCase()) {
    throw new ProgrammeError('REPO_IDENTITY_MISMATCH', `origin is ${origin}, GitHub calls it ${live}, and the binding names ${binding.repository}; they must all match.`);
  }
  return live;
}

module.exports = Object.freeze({
  SCHEMA, BINDING_FILE, CLASSES, LIFECYCLES, PATCHABLE_CHILD_FIELDS, PATCHABLE_PARENT_FIELDS, BLOCK_SOURCE, BLOCK_NAME, TRACE_BLOCK_NAME,
  ProgrammeError, GitHubTransport, StateStore, STORE_BACKENDS, ProgrammeGraphReader, GitHubMutator, Reconciler,
  canonical, canonicalText, contentDigest, sameState, validateParent, validateChild, validateBinding, bindingEnabled, assertValid, loadBinding,
  newParent, newChild, isHolder, isLaneHolder, parentRefusal, authoriseWrite, claimDocument, claimLane, assignGate, reopenGate, interruptGate,
  recordReturn, consumeReturn, foldJournals, validateJournal, currentGateAccepted, completionAccepted, applyPatch, refuseNewLegacy, legacyMigrationPatch, orderTies,
  evaluateChecks, renderParentBlockBody, renderChildBlockBody, renderTraceBlockBody, renderCurrentBlockBody, renderBlock, blockDigest, findStateBlock, upsertStateBlock, upsertTraceBlock,
  orderMoves, intentId, describeEffect, resolveExecutable, isGitHubHost, originSlug, bindRepository,
  SECRET_SHAPES, FINDING_CODES, ATTENTION_KEEP, ATTENTION_LIMIT, findingId, foldAttention, answerFinding, attentionCounts, attentionLine, openFindings, findingText, attentionDigest,
  ProgrammeInventory, INVENTORY_CLASSES, INVENTORY_DEADLINE_MS, registeredParents,
  STATE_BRANCH, STATE_PATH, STATE_SCHEMA, SIDECAR_KEEP, BranchStateStore, STATE_BACKENDS, openStore, publicView, validatePublic, documentName,
  refreshWriter, isDecisionHolder, sha256, sessionsOf,
});
