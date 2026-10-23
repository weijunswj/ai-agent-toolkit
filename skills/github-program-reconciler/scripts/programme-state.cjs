'use strict';

// Programme state documents and the GitHub reconciler.
//
// One private JSON document per programme child (`issue-<n>.json`) plus one for the parent
// (`parent-<n>.json`) live in a private store repository and are written through the GitHub
// Contents API with compare-and-swap on the blob sha. The reconciler reads those documents and the
// live GitHub state (issues, native parent/sub-issue links, dependency edges, PR heads and checks),
// reports typed findings, plans effects and, only when asked to apply, runs each effect as
// intent -> mutation -> readback -> resolution. It never closes, deletes or merges anything.
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
const { DEFAULT_THRESHOLD, auditDecisionTraces } = require('./decision-trace-audit.cjs');
const { ProgrammeError, resolveExecutable } = require('./resolve-executable.cjs');

const SCHEMA = Object.freeze({
  binding: 'toolkit.programme-binding.v1',
  parent: 'toolkit.programme-state.parent.v1',
  child: 'toolkit.programme-state.child.v1',
});
const BINDING_FILE = path.join('.github', 'toolkit-programme.json');
const SHA40 = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PREFIX = /^[A-Za-z0-9._-]{1,40}$/;
const CLASSES = ['CORE', 'HARDENING', 'LATER', 'OPTIONAL', 'COMPLETED', 'RETIRED'];
const LIFECYCLES = ['PLANNED', 'ACTIVE', 'WAITING_OWNER', 'HOLD', 'DONE', 'RETIRED'];
const GATE_ROLES = ['G0', 'G1', 'G2'];
const GATE_STATES = ['ACTIVE', 'WAITING_OWNER', 'INTERRUPTED', 'SUBMITTED', 'RETIRED'];
const VERDICTS = ['ACCEPT', 'REOPEN'];
const PR_STATES = ['OPEN', 'DRAFT', 'MERGED', 'CLOSED'];
const CHECK_STATES = ['GREEN', 'PENDING', 'RED', 'UNKNOWN'];
const UAT_STATES = ['NOT_REQUIRED', 'PENDING', 'PASSED', 'UAT_RETAINED', 'UAT_PARTIAL_REQUIRED', 'UAT_FULL_REQUIRED'];
const REVIEW_STATES = ['NOT_STARTED', 'IN_REVIEW', 'PASSED', 'NOT_PASSED'];
const REVIEW_VERDICTS = ['PASSED', 'NOT_PASSED'];
const EFFECT_KINDS = ['attach', 'reparent', 'reorder', 'replace_block'];
const EFFECT_STATES = ['IN_FLIGHT', 'DONE', 'UNKNOWN'];
// Fields that never count towards a document's content digest or revision: the revision itself,
// observation timestamps, and pending effects (an intent write must not make the rendered state stale).
const UNHASHED = ['revision', 'volatile', 'pending_effects'];
// Child fields `update` may change. UAT, review and a terminal lifecycle (DONE, RETIRED) are
// acceptance records: only the parent's holder (the controller) writes them.
const PATCHABLE_CHILD_FIELDS = ['lifecycle', 'release', 'candidate', 'uat', 'review', 'blockers', 'next_action', 'private'];
const CONTROLLER_CHILD_FIELDS = ['uat', 'review'];
const TERMINAL_LIFECYCLES = ['DONE', 'RETIRED'];
// UAT states that speak for one head, and review states that need verdicts at a head.
const HEAD_BOUND_UAT = ['PASSED', 'UAT_RETAINED', 'UAT_PARTIAL_REQUIRED'];
const DECIDED_REVIEW = ['PASSED', 'NOT_PASSED'];
const PATCHABLE_PARENT_FIELDS = ['outcomes', 'release_plan', 'private'];
const BLOCK_SOURCE = 'programme-state';
const BLOCK_NAME = 'STATE';
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

// The same state: equal content and equal pending effects. Volatile timestamps never matter.
function sameState(previous, next) {
  return contentDigest(previous) === contentDigest(next)
    && JSON.stringify(canonical(previous.pending_effects || [])) === JSON.stringify(canonical(next.pending_effects || []));
}

function check(errors, condition, message) { if (!condition) errors.push(message); }

// Fields each object may and must hold, as the schemas' additionalProperties: false and required.
const SHAPES = {
  child: { all: ['schema', 'repository', 'issue', 'revision', 'fence', 'lifecycle', 'release', 'gate', 'candidate', 'pr', 'uat', 'review', 'blockers', 'next_action', 'pending_effects', 'private', 'volatile'], optional: ['volatile'] },
  parent: { all: ['schema', 'repository', 'parent_issue', 'revision', 'fence', 'release_plan', 'outcomes', 'pending_effects', 'private', 'volatile'], optional: ['volatile'] },
  fence: { all: ['epoch', 'holder_prefix', 'holder_session'] },
  effect: { all: ['intent_id', 'kind', 'target', 'state'] },
  outcome: { all: ['issue', 'label', 'class', 'parent', 'order', 'lane', 'owner_prefix', 'complete_when'], optional: ['label', 'lane', 'owner_prefix', 'complete_when'] },
  release_plan: { all: ['record', 'comment_id'], optional: ['record', 'comment_id'] },
  gate: { all: ['role', 'state', 'session_id', 'route', 'returns'] },
  route: { all: ['model', 'effort', 'read_back'], optional: ['model', 'effort', 'read_back'] },
  return: { all: ['return_id', 'verdict', 'consumed', 'epoch'] },
  candidate: { all: ['branch', 'head', 'tree', 'base'] },
  pr: { all: ['number', 'state', 'head', 'checks'] },
  checks: { all: ['state', 'required_total', 'required_passed', 'at_head'] },
  uat: { all: ['state', 'at_head'] },
  review: { all: ['state', 'verdicts'] },
  verdict: { all: ['reviewer', 'head', 'verdict'] },
};

function checkShape(errors, value, shape, at) {
  if (!isObject(value)) return;
  const { all, optional: notRequired = [] } = SHAPES[shape];
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
      check(errors, CLASSES.includes(outcome.class), `${at}.class must be one of ${CLASSES.join(', ')}`);
      check(errors, optional(outcome.parent, value => isInt(value, 1)), `${at}.parent must be an issue number or null`);
      check(errors, outcome.parent !== outcome.issue, `${at}.parent cannot be the outcome itself`);
      check(errors, isInt(outcome.order), `${at}.order must be a whole number`);
      check(errors, optional(outcome.label, isText), `${at}.label must be text`);
      check(errors, optional(outcome.lane, isText), `${at}.lane must be text`);
      check(errors, optional(outcome.owner_prefix, value => PREFIX.test(value)), `${at}.owner_prefix must be a record prefix`);
      check(errors, optional(outcome.complete_when, isText), `${at}.complete_when must be text`);
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
  }
  return errors;
}

function validateChild(doc) {
  const errors = [];
  if (validateCommon(errors, doc, SCHEMA.child)) {
    check(errors, isInt(doc.issue, 1), 'issue must be an issue number');
    check(errors, LIFECYCLES.includes(doc.lifecycle), `lifecycle must be one of ${LIFECYCLES.join(', ')}`);
    check(errors, optional(doc.release, isText), 'release must be text or null');
    const gate = doc.gate;
    check(errors, isObject(gate), 'gate must be an object');
    if (isObject(gate)) {
      checkShape(errors, gate, 'gate', 'gate');
      checkShape(errors, gate.route, 'route', 'gate.route');
      check(errors, optional(gate.role, value => GATE_ROLES.includes(value)), 'gate.role must be G0, G1, G2 or null');
      check(errors, optional(gate.state, value => GATE_STATES.includes(value)), `gate.state must be one of ${GATE_STATES.join(', ')} or null`);
      check(errors, optional(gate.session_id, isText), 'gate.session_id must be text or null');
      check(errors, optional(gate.route, value => isObject(value) && optional(value.model, isText) && optional(value.effort, isText)
        && optional(value.read_back, v => typeof v === 'boolean')), 'gate.route must hold model, effort and read_back');
      check(errors, Array.isArray(gate.returns), 'gate.returns must be a list');
      const ids = new Set();
      for (const [index, entry] of (Array.isArray(gate.returns) ? gate.returns : []).entries()) {
        check(errors, isObject(entry) && isText(entry.return_id), `gate.returns[${index}].return_id is required`);
        checkShape(errors, entry, 'return', `gate.returns[${index}]`);
        check(errors, !ids.has(entry?.return_id), `gate.returns[${index}].return_id is repeated`);
        ids.add(entry?.return_id);
        check(errors, optional(entry?.verdict, value => VERDICTS.includes(value)), `gate.returns[${index}].verdict must be ACCEPT, REOPEN or null`);
        check(errors, typeof entry?.consumed === 'boolean', `gate.returns[${index}].consumed must be true or false`);
        check(errors, isInt(entry?.epoch), `gate.returns[${index}].epoch must be a whole number`);
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
  }
  return errors;
}

function assertValid(kind, doc) {
  const errors = kind === 'parent' ? validateParent(doc) : validateChild(doc);
  if (errors.length) throw new ProgrammeError('STATE_INVALID', `The ${kind} state document is invalid: ${errors[0]}`, { errors });
  return doc;
}

function validateBinding(binding) {
  const errors = [];
  check(errors, isObject(binding), 'binding must be an object');
  if (isObject(binding)) {
    check(errors, binding.schema === SCHEMA.binding, `schema must be ${SCHEMA.binding}`);
    check(errors, REPO.test(String(binding.repository || '')), 'repository must be owner/name');
    check(errors, isInt(binding.parent_issue, 1), 'parent_issue must be an issue number');
    check(errors, PREFIX.test(String(binding.record_prefix || '')), 'record_prefix must be a record prefix');
    check(errors, PREFIX.test(String(binding.writer_prefix || '')), 'writer_prefix must be a record prefix');
    const store = binding.store;
    check(errors, isObject(store) && Object.hasOwn(STORE_BACKENDS, store.kind), `store.kind ${JSON.stringify(store?.kind)} is not supported by this Toolkit version (supported: ${Object.keys(STORE_BACKENDS).join(', ')})`);
    check(errors, isObject(store) && REPO.test(String(store.repository || '')), 'store.repository must be owner/name');
    check(errors, isObject(store) && isText(store.branch) && !/\s|\.\./.test(store.branch), 'store.branch must be a branch name');
    check(errors, isObject(store) && /^(?:[A-Za-z0-9_.-]+\/)+$/.test(String(store.path || '')) && !String(store.path).split('/').includes('..'), 'store.path must be a relative folder ending in /');
    check(errors, isObject(store) && String(store.repository || '').toLowerCase() !== String(binding.repository || '').toLowerCase(), 'store.repository must be a separate repository');
    check(errors, Array.isArray(binding.required_checks) && binding.required_checks.every(isText), 'required_checks must be a list of check names');
    const projection = binding.projection;
    if (projection !== undefined) {
      check(errors, isObject(projection) && Object.keys(projection).every(key => ['after_section', 'replace_section'].includes(key)), 'projection may hold only after_section and replace_section');
      check(errors, isObject(projection) && optional(projection.after_section, isText) && optional(projection.replace_section, isText), 'projection.after_section and projection.replace_section must be heading text');
    }
    screenSecrets(errors, binding, 'binding');
  }
  if (errors.length) throw new ProgrammeError('BINDING_INVALID', `${BINDING_FILE} is invalid: ${errors[0]}`, { errors });
  return binding;
}

function loadBinding(repoRoot) {
  const file = path.join(repoRoot, BINDING_FILE);
  if (!fs.existsSync(file)) {
    throw new ProgrammeError('BINDING_MISSING', `This repository has no reconciler binding (${BINDING_FILE.replace(/\\/g, '/')}); every programme.cjs command refuses without it. Only the owner adds the binding, on purpose. Toolkit-governed rules and their issue records are unchanged.`);
  }
  let binding;
  try { binding = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new ProgrammeError('BINDING_INVALID', `${BINDING_FILE} is not valid JSON: ${error.message}`); }
  return validateBinding(binding);
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
function isHolder(doc, writer) {
  return Boolean(doc?.fence?.holder_session) && doc.fence.holder_session === writer.session && doc.fence.holder_prefix === writer.prefix;
}

function holderDescription(doc, kind = doc?.schema === SCHEMA.parent ? 'parent' : 'child', parentDoc = null) {
  const prefix = doc?.fence?.holder_prefix || 'nobody';
  const epoch = doc?.fence?.epoch ?? 0;
  if (kind === 'parent') return `parent holder (${prefix}, epoch ${epoch})`;
  const gate = doc?.gate?.role || 'unassigned';
  if (doc?.fence?.holder_session && isHolder(parentDoc, { session: doc.fence.holder_session, prefix })) {
    return `parent holder (${prefix}, gate ${gate}, epoch ${epoch})`;
  }
  return `holder ${prefix} for gate ${gate} (epoch ${epoch})`;
}

function parentRefusal(doc) {
  return `The parent document is held by the ${holderDescription(doc)}. Only that holder writes programme state; other sessions dry-run and report to the controller. A controller stopped by a takeover stops and reports to the owner.`;
}

function authoriseWrite(kind, doc, parentDoc, writer) {
  if (!writer || !isText(writer.session) || !PREFIX.test(String(writer.prefix || ''))) {
    throw new ProgrammeError('WRITER_UNKNOWN', 'Controller writes need --session <the controller session id> and a record prefix.');
  }
  if (kind === 'parent') {
    if (doc && !isHolder(doc, writer)) throw new ProgrammeError('STALE_WRITER', parentRefusal(doc));
    return;
  }
  if (doc && isHolder(doc, writer)) return;
  if (parentDoc && isHolder(parentDoc, writer)) return;
  throw new ProgrammeError('STALE_WRITER', `Issue ${doc?.issue ?? ''} is held by the ${holderDescription(doc, 'child', parentDoc)}; the parent document is held by the ${holderDescription(parentDoc, 'parent')}. This session holds neither document; report to the controller.`);
}

// Claim or take over a document: one compare-and-swap that increments the epoch and records the holder.
function claimDocument(doc, writer, { takeover = false, role = null, route = null, parentDoc = null } = {}) {
  const next = clone(doc);
  const held = Boolean(next.fence.holder_session);
  if (isHolder(next, writer) && !role) return null;
  if (held && !isHolder(next, writer) && !takeover) {
    throw new ProgrammeError('CLAIM_HELD', next.schema === SCHEMA.parent
      ? parentRefusal(next)
      : `Issue ${next.issue} is held by the ${holderDescription(next, 'child', parentDoc)}; take over with --takeover only if the controller assigned this gate to you, otherwise report to the controller.`);
  }
  if (!isHolder(next, writer)) next.fence = { epoch: next.fence.epoch + 1, holder_prefix: writer.prefix, holder_session: writer.session };
  if (next.schema === SCHEMA.child && role) {
    if (!GATE_ROLES.includes(role)) throw new ProgrammeError('USAGE', '--role must be G0, G1 or G2');
    const sameSession = next.gate.role === role && next.gate.session_id === writer.session;
    next.gate.role = role;
    // Claiming a gate again starts a new activation of an accepted (RETIRED) gate, which only removes
    // that acceptance; an unfinished gate keeps its state.
    next.gate.state = sameSession && next.gate.state && next.gate.state !== 'RETIRED' ? next.gate.state : 'ACTIVE';
    next.gate.session_id = writer.session;
    if (route) next.gate.route = route;
    if (next.lifecycle === 'PLANNED') next.lifecycle = 'ACTIVE';
    next.private = { ...next.private, host_session: writer.session };
  }
  return next;
}

function currentGateAccepted(child) {
  const latest = child.gate.returns.at(-1);
  return child.gate.state === 'RETIRED' && Boolean(latest?.consumed && latest.verdict === 'ACCEPT');
}

function completionAccepted(child) {
  return ['G1', 'G2'].includes(child.gate.role) && currentGateAccepted(child);
}

// LIFE-1 successor: returns are consumed by return ID, never by session. REOPEN keeps the session
// active, a new submission gets a new return ID, so ACCEPT after REOPEN works in the same session.
function submitReturn(doc, { returnId, writer, parentDoc = null }) {
  if (!isText(returnId)) throw new ProgrammeError('USAGE', 'A return needs a return ID.');
  const next = clone(doc);
  const existing = next.gate.returns.find(entry => entry.return_id === returnId);
  if (existing) {
    if (existing.consumed) throw new ProgrammeError('RETURN_CONFLICT', `Return ${returnId} was already consumed as ${existing.verdict}; a new submission needs a new return ID.`);
    return null;
  }
  if (!['ACTIVE', 'WAITING_OWNER', 'INTERRUPTED'].includes(next.gate.state)) {
    throw new ProgrammeError('GATE_NOT_ACTIVE', `The gate is ${next.gate.state || 'not started'}; only an active gate can submit a return. Report to the controller.`);
  }
  if (next.gate.session_id && writer && next.gate.session_id !== writer.session && !isHolder(next, writer)) {
    throw new ProgrammeError('STALE_WRITER', `Only the gate session or the ${holderDescription(next, 'child', parentDoc)} can submit its return.`);
  }
  next.gate.returns.push({ return_id: returnId, verdict: null, consumed: false, epoch: next.fence.epoch });
  next.gate.state = 'SUBMITTED';
  return next;
}

// Only the parent's holder (the controller) consumes a return; an executor cannot accept its own.
function consumeReturn(doc, { returnId, verdict, writer = null, parentDoc = null }) {
  if (!VERDICTS.includes(verdict)) throw new ProgrammeError('USAGE', '--verdict must be ACCEPT or REOPEN');
  if (!isHolder(parentDoc, writer)) throw new ProgrammeError('ROLE_REFUSED', 'Only the holder of the parent document (the controller) consumes a gate return.');
  const next = clone(doc);
  const entry = next.gate.returns.find(item => item.return_id === returnId);
  if (!entry) throw new ProgrammeError('RETURN_UNKNOWN', `No return ${returnId} on issue ${next.issue}.`);
  if (entry.consumed) {
    if (entry.verdict === verdict) return null;
    throw new ProgrammeError('RETURN_CONFLICT', `Return ${returnId} was already consumed as ${entry.verdict}, not ${verdict}.`);
  }
  if (entry.epoch !== next.fence.epoch) throw new ProgrammeError('STALE_RETURN', `Return ${returnId} was submitted at epoch ${entry.epoch}; the document is at epoch ${next.fence.epoch}.`);
  const latest = next.gate.returns.filter(item => !item.consumed).at(-1);
  if (latest.return_id !== returnId) throw new ProgrammeError('STALE_RETURN', `Return ${returnId} is not the latest submission (${latest.return_id}).`);
  entry.consumed = true;
  entry.verdict = verdict;
  next.gate.state = verdict === 'REOPEN' ? 'ACTIVE' : 'RETIRED';
  return next;
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
  if (kind === 'child' && !isHolder(parentDoc, writer)) {
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
  return next;
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

function compareOutcomes(a, b) {
  return CLASSES.indexOf(a.class) - CLASSES.indexOf(b.class) || a.order - b.order || a.issue - b.issue;
}

// Status is the lifecycle in the words of the programme page; class stays priority only.
const STATUS_TEXT = Object.freeze({ PLANNED: 'PLANNED', ACTIVE: 'CURRENT', WAITING_OWNER: 'WAITING ON OWNER', HOLD: 'HELD', DONE: 'COMPLETED', RETIRED: 'RETIRED' });
const CLASS_GROUPS = Object.freeze([['CORE', 'Core'], ['HARDENING', 'Hardening'], ['LATER', 'Later'], ['OPTIONAL', 'Optional']]);
const GRAPH_HEADER = ['| Outcome | Status | Current gate | Current work | Complete when |', '|---|---|---|---|---|'];

const statusText = child => (child ? STATUS_TEXT[child.lifecycle] : 'NO STATE YET');

// Finished outcomes (class COMPLETED or RETIRED, or a DONE or RETIRED lifecycle) leave the class groups.
function isFinished(outcome, child) {
  return outcome.class === 'COMPLETED' || outcome.class === 'RETIRED' || Boolean(child && TERMINAL_LIFECYCLES.includes(child.lifecycle));
}

function currentGateText(child) {
  if (!child || (!child.gate.role && !child.gate.state)) return '-';
  return [child.gate.role, child.gate.state].filter(Boolean).join(' ');
}

// One cell: PR and head, CI at the head, UAT, review, release, blockers and the next action.
function currentWorkText(child, repository) {
  if (!child) return '-';
  const parts = [];
  if (child.pr.number) {
    parts.push(`PR #${child.pr.number}${child.pr.state ? ` ${child.pr.state}` : ''}${child.pr.head ? ` at ${shaLink(repository, child.pr.head)}` : ''}`);
    parts.push(`CI ${checksText(child)}`);
  }
  if (child.uat.state) parts.push(`UAT ${uatText(child)}`);
  if (child.review.state) parts.push(`review ${reviewText(child)}`);
  if (child.release) parts.push(`release ${publicText(child.release)}`);
  if (child.blockers.length) parts.push(`blocked: ${child.blockers.map(publicText).join('; ')}`);
  if (child.next_action) parts.push(`next: ${publicText(child.next_action)}`);
  return parts.join('; ') || '-';
}

// Outcomes of one group in tree order: roots under a native parent first, then roots with none,
// each by class, order and issue, and each followed by its own children in the same group. A row
// whose expected parent is not the programme parent names it.
function groupRows(parent, members, children) {
  const inGroup = new Set(members.map(outcome => outcome.issue));
  const parentless = outcome => (outcome.parent === null || outcome.parent === undefined ? 1 : 0);
  const sort = list => [...list].sort((a, b) => parentless(a) - parentless(b) || compareOutcomes(a, b));
  const rows = [];
  const visit = outcome => {
    const child = children.get(outcome.issue);
    const nested = outcome.parent && outcome.parent !== parent.parent_issue ? ` (under #${outcome.parent})` : '';
    const label = `${outcome.label ? `${publicText(outcome.label)} ` : ''}#${outcome.issue}${nested}`;
    rows.push(`| ${label} | ${statusText(child)} | ${currentGateText(child)} | ${currentWorkText(child, parent.repository)} | ${publicText(outcome.complete_when || '-')} |`);
    for (const next of sort(members.filter(entry => entry.parent === outcome.issue))) visit(next);
  };
  for (const root of sort(members.filter(entry => !inGroup.has(entry.parent)))) visit(root);
  return rows;
}

function renderParentBlockBody(parent, children) {
  const finished = parent.outcomes.filter(outcome => isFinished(outcome, children.get(outcome.issue)));
  const active = parent.outcomes.filter(outcome => !finished.includes(outcome));
  const lines = [
    revisionLine(parent, children),
    '## Programme Graph',
    '',
    `Generated from the programme state documents (state revision ${parent.revision}), so edit those rather than this table. Groups follow priority: Core, then Hardening, Later and Optional; finished work is collapsed at the end.`,
  ];
  for (const [cls, heading] of CLASS_GROUPS) {
    const members = active.filter(outcome => outcome.class === cls);
    if (members.length) lines.push('', `### ${heading}`, '', ...GRAPH_HEADER, ...groupRows(parent, members, children));
  }
  if (finished.length) {
    lines.push('', `<details><summary>Completed and retired (${finished.length})</summary>`, '', ...GRAPH_HEADER, ...groupRows(parent, finished, children), '', '</details>');
  }
  return lines.join('\n');
}

function renderChildBlockBody(child, outcome) {
  const lines = [
    `<!-- programme-state child=${child.issue}@${child.revision} -->`,
    `**Programme state** (issue-${child.issue}.json revision ${child.revision}; generated, so edit the state document rather than this block)`,
    '',
    `- Status: ${statusText(child)}; class: ${outcome?.class || '-'}; lane: ${publicText(outcome?.lane || '-')}; release: ${publicText(child.release || '-')}`,
    `- Current gate: ${currentGateText(child)}`,
    `- PR: ${prText(child)}; head ${shaLink(child.repository, child.pr.head)}; CI at head: ${checksText(child)}`,
    `- UAT: ${uatText(child)}; review: ${reviewText(child)}`,
    `- Complete when: ${publicText(outcome?.complete_when || '-')}`,
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

function renderBlock(body, version) {
  return [
    `<!-- AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:BEGIN ${BLOCK_NAME} v2 toolkit=${version} sha256=${blockDigest(body)} -->`,
    normalizeBlockBody(body),
    `<!-- AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:END ${BLOCK_NAME} -->`,
  ].join('\n');
}

const BLOCK_BEGIN = new RegExp(`^<!-- AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:BEGIN ${BLOCK_NAME} v2 toolkit=(\\d+\\.\\d+\\.\\d+) sha256=([0-9a-f]{12}) -->$`);
const BLOCK_END = new RegExp(`^<!-- AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:END ${BLOCK_NAME} -->$`);
// Only a line that starts as an HTML comment is a marker; rendered free text has `<` escaped.
const BLOCK_ANY = new RegExp(`^\\s*<!--\\s*AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:`);

// The one state block in a body, with offsets; `error` for broken or duplicated markers.
function findStateBlock(text) {
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
    if (begin) {
      if (open || found) return { error: `duplicate or nested state block at line ${index + 1}` };
      open = { index, start: line.start, version: begin[1], digest: begin[2] };
      continue;
    }
    if (BLOCK_END.test(line.content) && open) {
      const body = lines.slice(open.index + 1, index).map(entry => entry.content).join('\n');
      found = { start: open.start, end: line.end, version: open.version, digest: open.digest, body, tampered: open.digest !== blockDigest(body) };
      open = null;
      continue;
    }
    return { error: `malformed state block marker at line ${index + 1}` };
  }
  if (open) return { error: 'state block BEGIN without END' };
  return { block: found };
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

// Where the block belongs in a body that has no block: in place of the `replace_section`
// section; else right after the `after_section` section; else after the first title and a marked
// note directly under it (`<!-- NAME:BEGIN -->` ... `<!-- NAME:END -->`); else at the top.
function blockTarget(text, placement = {}) {
  const all = headings(text);
  const sectionEnd = heading => {
    const next = all.find(entry => entry.start > heading.start && entry.level <= heading.level);
    return next ? next.start : text.length;
  };
  const named = name => name && all.find(entry => entry.text.toLowerCase() === String(name).trim().toLowerCase());
  const replaced = named(placement.replace_section);
  if (replaced) return { start: replaced.start, end: sectionEnd(replaced), replaces: true };
  const after = named(placement.after_section);
  if (after) return { start: sectionEnd(after), end: sectionEnd(after), replaces: false };
  const title = all.find(entry => entry.level === 1);
  if (!title) return { start: 0, end: 0, replaces: false };
  let at = title.end;
  const rest = text.slice(at);
  const lead = /^\s*/.exec(rest)[0].length;
  const note = /^<!--\s*([A-Za-z0-9_.:-]+):BEGIN\b[^\n]*-->[^\n]*\n/.exec(rest.slice(lead));
  if (note) {
    const close = rest.indexOf(`<!-- ${note[1]}:END`, lead);
    if (close !== -1) {
      const lineEnd = rest.indexOf('\n', close);
      at += lineEnd === -1 ? rest.length : lineEnd + 1;
    }
  }
  return { start: at, end: at, replaces: false };
}

const trimEnd = text => text.replace(/\s+$/, '');
const trimStart = text => text.replace(/^\s+/, '');

// The body with the state block written. An existing block is replaced in place, byte for byte
// around it, unless it sits above its place (for example at the very top) or the binding's
// `replace_section` is still in the body: then it moves, once. A new block goes to its place.
// Uses the body's own line ending; `moved` says whether the block changed position.
function upsertStateBlock(text, rendered, placement = {}) {
  const source = String(text || '');
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  const block = rendered.split('\n').join(eol);
  const { block: found, error } = findStateBlock(source);
  if (error) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', error);
  let rest = source;
  if (found) {
    const before = trimEnd(source.slice(0, found.start));
    const after = trimStart(source.slice(found.end));
    rest = before && after ? `${before}${eol}${eol}${after}` : before || after;
    const target = blockTarget(rest, placement);
    const goal = trimEnd(rest.slice(0, target.start));
    const above = goal.length > before.length && goal.startsWith(before);
    if (!target.replaces && !above) {
      return { body: source.slice(0, found.start) + block + source.slice(found.end), start: found.start, end: found.start + block.length, moved: false };
    }
  }
  const target = blockTarget(rest, placement);
  const before = trimEnd(rest.slice(0, target.start));
  const after = trimStart(rest.slice(target.end));
  const head = before ? `${before}${eol}${eol}` : '';
  const body = `${head}${block}${after ? `${eol}${eol}${after}` : eol}`;
  return { body, start: head.length, end: head.length + block.length, moved: Boolean(found) };
}

// ---------------------------------------------------------------------------------------------
// Owners with effects

// The only place that runs `gh api`. Returns status and parsed JSON; never retries.
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
    return `repos/${this.store.repository}/contents/${this.docPath(kind, number).split('/').map(encodeURIComponent).join('/')}`;
  }

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

  // Reads the branch, or a fixed commit when `ref` is given. A branch read that still shows the
  // version this process's own write replaced returns the written version instead.
  read(kind, number, ref = null) {
    const response = this.transport.request('GET', `${this.contentsPath(kind, number)}?ref=${encodeURIComponent(ref || this.store.branch)}`);
    const own = ref ? null : this.ownWrites.get(this.docPath(kind, number));
    if (own && (response.status === 404 ? own.replaced === null : response.status === 200 && response.json.sha === own.replaced)) {
      return { doc: clone(own.doc), sha: own.sha };
    }
    if (response.status === 404) return { doc: null, sha: null };
    if (response.status !== 200) throw ghFailure(response, `Reading ${this.docPath(kind, number)}`);
    if (response.json.encoding !== 'base64') throw new ProgrammeError('STATE_INVALID', `${this.docPath(kind, number)} is too large to read through the Contents API.`);
    let doc;
    try { doc = JSON.parse(Buffer.from(response.json.content, 'base64').toString('utf8')); }
    catch { throw new ProgrammeError('STATE_INVALID', `${this.docPath(kind, number)} is not valid JSON.`); }
    return { doc: assertValid(kind, doc), sha: response.json.sha };
  }

  // Writes `next` only when its state differs from `previous`. Bumps the revision only when the
  // content changes. Rejected compare-and-swap surfaces as STATE_CONFLICT; every write is read back.
  write(kind, number, next, { sha, previous }) {
    if (previous && sameState(previous, next)) return { outcome: 'NOOP', doc: previous, sha };
    const doc = clone(next);
    doc.revision = previous ? previous.revision + (contentDigest(previous) === contentDigest(doc) ? 0 : 1) : Math.max(1, doc.revision || 0);
    doc.volatile = { written_at: this.now(), ...(this.toolkitVersion ? { toolkit: this.toolkitVersion } : {}) };
    assertValid(kind, doc);
    const text = canonicalText(doc);
    const response = this.transport.request('PUT', this.contentsPath(kind, number), {
      message: `programme state: ${kind === 'parent' ? 'parent' : 'issue'}-${number} revision ${doc.revision}`,
      content: Buffer.from(text, 'utf8').toString('base64'),
      branch: this.store.branch,
      ...(sha ? { sha } : {}),
    });
    if (response.status === 409 || (response.status === 422 && !sha)) {
      this.ownWrites.delete(this.docPath(kind, number));
      throw new ProgrammeError('STATE_CONFLICT', `${this.docPath(kind, number)} moved since it was read.`, { status: response.status });
    }
    if (!okStatus(response.status)) throw ghFailure(response, `Writing ${this.docPath(kind, number)}`);
    this.writes += 1;
    // Read back at the commit the write created: a branch read can still serve the old version.
    const commit = response.json?.commit?.sha;
    const blob = response.json?.content?.sha;
    if (!commit || !blob) throw new ProgrammeError('STATE_READBACK_MISMATCH', `${this.docPath(kind, number)} was written but GitHub returned no commit to read it back from.`);
    const readback = this.read(kind, number, commit);
    if (!readback.doc || canonicalText(readback.doc) !== text || readback.sha !== blob) {
      throw new ProgrammeError('STATE_READBACK_MISMATCH', `${this.docPath(kind, number)} did not read back as written.`);
    }
    this.ownWrites.set(this.docPath(kind, number), { replaced: sha || null, doc: clone(readback.doc), sha: blob });
    return { outcome: 'WRITTEN', doc: readback.doc, sha: blob };
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

const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
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
      title: issue.title, body: issue.body || '', updated_at: issue.updated_at,
      is_pull_request: Boolean(issue.pull_request),
      parent: parentFromUrl(issue.parent_issue_url, this.repository),
      blocked_by_total: issue.issue_dependencies_summary?.total_blocked_by ?? 0,
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

  // Every comment on an issue, for the decision-trace audit.
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
    const pr = this.transport.graphql(PR_QUERY, { owner, name, number })?.repository?.pullRequest;
    if (!pr) return null;
    const commit = pr.commits?.nodes?.[0]?.commit;
    const rollup = commit?.statusCheckRollup;
    return {
      number: pr.number,
      state: pr.merged ? 'MERGED' : pr.state === 'CLOSED' ? 'CLOSED' : pr.isDraft ? 'DRAFT' : 'OPEN',
      head: pr.headRefOid, base: pr.baseRefName, mergeable: pr.mergeable,
      rollupOid: commit?.oid || null,
      complete: !rollup?.contexts?.pageInfo?.hasNextPage,
      contexts: (rollup?.contexts?.nodes || []).map(node => ({
        kind: node.__typename, name: node.name || node.context, status: node.status || null,
        conclusion: node.conclusion || null, state: node.state || null, required: node.isRequired === true,
      })),
    };
  }

  pullRequestForBranch(branch) {
    const owner = this.repository.split('/')[0];
    const response = this.transport.request('GET', `repos/${this.repository}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=10`);
    if (response.status !== 200) throw ghFailure(response, `Finding the PR for ${branch}`);
    const open = response.json.find(pr => pr.state === 'open');
    return (open || response.json[0])?.number || null;
  }
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

// Findings the reconciler reports but never fixes itself; each needs a controller decision.
const ATTENTION = new Set(['ISSUE_MISSING', 'NATIVE_PARENT_UNEXPECTED', 'NATIVE_CHILD_UNKNOWN', 'DEPENDENCY_IMPLIES_PARENT',
  'PR_HEAD_MOVED', 'CHECKS_RED', 'READY_TO_CLOSE', 'CHILD_STATE_CONFLICT', 'MANAGED_BLOCK_BROKEN', 'TRACE_UNLINKED', 'TRACE_SUPERSEDED_UNMARKED']);

const EFFECT_TEXT = {
  create_state: effect => `Create the state document for #${effect.target.issue}`,
  update_state: effect => `Update the state document for #${effect.target.issue} (${effect.fields.join(', ')})`,
  attach: effect => `Attach #${effect.target.issue} under #${effect.target.parent}`,
  reparent: effect => `Move #${effect.target.issue} from under ${typeof effect.from === 'number' ? `#${effect.from}` : effect.from} to under #${effect.target.parent}`,
  reorder: effect => `Move #${effect.target.issue} ${effect.target.before !== undefined ? `before #${effect.target.before}` : `after #${effect.target.after}`} under #${effect.target.parent}`,
  replace_block: effect => `${effect.insert ? 'Add' : effect.move ? 'Move' : 'Update'} the state block in #${effect.target.issue}'s body`,
};

function describeEffect(effect) { return EFFECT_TEXT[effect.kind](effect); }

// What a hold on an issue stops for the rest of a pass: its body, its links, or everything.
function holdScope(kind) {
  if (kind === 'replace_block') return 'body';
  if (kind === 'attach' || kind === 'reparent' || kind === 'reorder') return 'links';
  return 'all';
}

// One reconcile pass: bind, observe, recover, diff, plan and (with apply) run each effect.
class Reconciler {
  constructor({ store, reader, mutator, binding, writer = null, toolkitVersion = null, threshold = DEFAULT_THRESHOLD }) {
    this.store = store;
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
    return { issues, subIssues, blockedBy, prs, outcomes };
  }

  // The child document with observed PR facts applied (pure apart from reading `observed`).
  desiredChild(outcome, existing, observed) {
    const child = existing ? clone(existing) : newChild({ repository: this.binding.repository, outcome });
    const pr = observed.prs.get(outcome.issue);
    if (pr) {
      const checks = evaluateChecks({ head: pr.head, rollupOid: pr.rollupOid, contexts: pr.contexts, complete: pr.complete, configured: this.binding.required_checks });
      child.pr = { number: pr.number, state: pr.state, head: pr.head,
        checks: { state: checks.state, required_total: checks.required_total, required_passed: checks.required_passed, at_head: checks.at_head } };
      return { doc: child, checks };
    }
    return { doc: child, checks: null };
  }

  diffChild(outcome, existing, desired, checks, observed, findings, effects) {
    const issueNumber = outcome.issue;
    const issue = observed.issues.get(issueNumber);
    if (!issue || issue.is_pull_request) {
      findings.push({ code: 'ISSUE_MISSING', issue: issueNumber, detail: issue ? 'the number is a pull request' : 'the issue could not be read' });
      return;
    }
    if (!existing) effects.push({ kind: 'create_state', target: { issue: issueNumber }, doc: desired });
    else {
      const fields = Object.keys(desired).filter(key => !UNHASHED.includes(key) && JSON.stringify(canonical(existing[key])) !== JSON.stringify(canonical(desired[key])));
      if (fields.length) effects.push({ kind: 'update_state', target: { issue: issueNumber }, fields, doc: desired });
    }
    // Native parent.
    if (outcome.parent) {
      if (issue.parent === null) {
        findings.push({ code: 'NATIVE_PARENT_MISSING', issue: issueNumber, detail: `expected under #${outcome.parent}` });
        effects.push({ kind: 'attach', target: { issue: issueNumber, parent: outcome.parent }, childId: issue.id });
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
        findings.push({ code: 'READY_TO_CLOSE', issue: issueNumber, pr: pr.number, head: pr.head, gate, gate_accepted: gateAccepted, accepted, uat: desired.uat.state ? uatText(desired) : null, review: desired.review.state ? reviewText(desired) : null,
          detail: `PR #${pr.number} merged, checks GREEN at ${shortSha(pr.head)}; ${gate || 'unassigned gate'} ${gateAccepted ? 'acceptance recorded' : 'not accepted'}` });
      }
      if (desired.candidate.head && pr.state !== 'MERGED' && pr.state !== 'CLOSED' && desired.candidate.head !== pr.head) {
        findings.push({ code: 'PR_HEAD_MOVED', issue: issueNumber, detail: `candidate ${shortSha(desired.candidate.head)}, PR #${pr.number} head ${shortSha(pr.head)}; review and UAT evidence at the old head is STALE_HEAD` });
      }
      if (pr.state === 'OPEN' || pr.state === 'DRAFT') {
        const code = { GREEN: 'CHECKS_GREEN_AT_HEAD', PENDING: 'CHECKS_PENDING', RED: 'CHECKS_RED', UNKNOWN: 'CHECKS_UNKNOWN' }[checks.state];
        const detail = checks.reason || [checks.failing.length ? `failing: ${checks.failing.join(', ')}` : '', checks.missing.length ? `missing: ${checks.missing.join(', ')}` : '', `${checks.required_passed}/${checks.required_total} required passed at ${shortSha(checks.at_head)}`].filter(Boolean).join('; ');
        findings.push({ code, issue: issueNumber, detail });
      }
    }
    // Document versus issue.
    if (desired.lifecycle === 'DONE' && issue.state === 'open') findings.push({ code: 'CHILD_STATE_CONFLICT', issue: issueNumber, detail: 'the state document says DONE but the issue is open' });
    if (!['DONE', 'RETIRED'].includes(desired.lifecycle) && issue.state === 'closed') findings.push({ code: 'CHILD_STATE_CONFLICT', issue: issueNumber, detail: `the issue is closed but the state document says ${desired.lifecycle}` });
    if (pr?.state === 'MERGED' && desired.lifecycle !== 'DONE' && !completionAccepted(desired)) {
      findings.push({ code: 'CHILD_STATE_CONFLICT', issue: issueNumber, detail: `PR #${pr.number} is merged but no accepted completion is recorded` });
    }
  }

  diffOrder(parent, observed, effects, findings, plannedParents) {
    const outcomes = observed.outcomes;
    const catalogued = new Set(parent.outcomes.map(outcome => outcome.issue));
    for (const [parentNumber, list] of observed.subIssues) {
      for (const sub of list) {
        if (!catalogued.has(sub.number) && sub.number !== parent.parent_issue) {
          findings.push({ code: 'NATIVE_CHILD_UNKNOWN', issue: sub.number, detail: `natively under #${parentNumber} but not in the outcome catalogue; not changed` });
        }
      }
      const desired = outcomes.filter(outcome => outcome.parent === parentNumber).sort(compareOutcomes).map(outcome => outcome.issue);
      // Simulate the planned attaches (appended at the end) and moves away.
      const current = list.map(sub => sub.number).filter(number => plannedParents.get(number) === undefined || plannedParents.get(number) === parentNumber);
      for (const [number, target] of plannedParents) if (target === parentNumber && !current.includes(number)) current.push(number);
      const moves = orderMoves(current, desired);
      if (moves.length) findings.push({ code: 'NATIVE_ORDER_DRIFT', issue: parentNumber, detail: `${moves.length} move(s) to match the catalogue order` });
      for (const move of moves) effects.push({ kind: 'reorder', target: { parent: parentNumber, ...move } });
    }
  }

  renderAll(parent, children) {
    const outcomes = new Map(parent.outcomes.map(outcome => [outcome.issue, outcome]));
    const blocks = new Map([[parent.parent_issue, renderParentBlockBody(parent, children)]]);
    for (const child of children.values()) blocks.set(child.issue, renderChildBlockBody(child, outcomes.get(child.issue)));
    return blocks;
  }

  // The decision-trace audit on the parent and each catalogued issue. Report only: the controller
  // writes index lines with decision-trace-audit --repair, which never runs from here.
  auditTraces(parent, observed, only, findings) {
    const numbers = only ? [only, parent.parent_issue] : [parent.parent_issue, ...parent.outcomes.map(outcome => outcome.issue)];
    for (const number of numbers) {
      const issue = observed.issues.get(number);
      if (!issue) continue;
      const result = auditDecisionTraces({ body: issue.body, comments: this.reader.comments(number), recordPrefix: this.binding.record_prefix, threshold: this.threshold });
      if (result.unlinked.length) findings.push({ code: 'TRACE_UNLINKED', issue: number, detail: `${result.unlinked.length} comment(s) are not linked from the body or an index comment it links; write the lines from decision-trace-audit --repair` });
      for (const entry of result.superseded_unmarked) findings.push({ code: 'TRACE_SUPERSEDED_UNMARKED', issue: number, detail: `${entry.record} is superseded by ${entry.superseded_by} but not marked "superseded by"` });
    }
  }

  // The parent page follows the binding's projection; child pages put the block under the title.
  placementFor(number) {
    return number === this.binding.parent_issue ? (this.binding.projection || {}) : {};
  }

  diffBlocks(parent, children, observed, only, effects, findings, holds) {
    const blocks = this.renderAll(parent, children);
    const targets = only ? [only, parent.parent_issue] : [...blocks.keys()];
    for (const number of targets) {
      const issue = observed.issues.get(number);
      const body = blocks.get(number);
      if (!issue || body === undefined) continue;
      const { block, error } = findStateBlock(issue.body);
      if (error) { findings.push({ code: 'MANAGED_BLOCK_BROKEN', issue: number, detail: error }); continue; }
      const placement = this.placementFor(number);
      const current = block && normalizeBlockBody(block.body) === normalizeBlockBody(body) && !block.tampered;
      const move = Boolean(block) && upsertStateBlock(issue.body, renderBlock(block.body, block.version), placement).moved;
      if (current && !move) continue;
      findings.push({ code: 'PROJECTION_STALE', issue: number, detail: !block ? 'no state block yet' : block.tampered ? 'the block was edited by hand' : current ? 'the block is not in its place on the page' : 'the block differs from the state documents' });
      const length = upsertStateBlock(issue.body, renderBlock(body, this.toolkitVersion || '0.0.0'), placement).body.length;
      if (length >= this.threshold) {
        holds.push({ code: 'BODY_TOO_LARGE', target: `#${number}`, detail: `Controller: the body would reach ${length} characters (threshold ${this.threshold}); shorten it first`, scope: 'body' });
        continue;
      }
      effects.push({ kind: 'replace_block', target: { issue: number, digest: blockDigest(body) }, insert: !block, move: current && move, body, updated_at: issue.updated_at });
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
          done = issue ? Boolean(found && blockDigest(found.body) === target.digest && !found.tampered) : null;
        }
        if (done === null) holds.push({ code: 'EFFECT_UNKNOWN', target: `#${target.issue}`, detail: `${effect.kind} from an earlier pass could not be checked; held`, scope: holdScope(effect.kind) });
        resolutions.push({ kind, number, intent_id: effect.intent_id, outcome: done === null ? 'UNKNOWN' : done ? 'DONE' : 'NOT_DONE' });
      }
    }
    return resolutions;
  }

  plan({ issue: only = null, parentOverride = null } = {}) {
    const holds = [];
    const parentRead = this.loadParent(parentOverride);
    if (!parentRead.doc) {
      return { parent: null, findings: [], effects: [], holds: [{ code: 'PARENT_STATE_MISSING', target: `#${this.binding.parent_issue}`, detail: `No parent state document for #${this.binding.parent_issue} yet. The appointed controller creates and holds it with init-parent --apply; other sessions report this to the controller.` }], resolutions: [] };
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
      const { doc: desired, checks } = this.desiredChild(outcome, existing, observed);
      this.diffChild(outcome, existing, desired, checks, observed, findings, effects);
      desiredDocs.set(outcome.issue, desired);
    }
    const plannedParents = new Map(effects.filter(effect => effect.kind === 'attach' || effect.kind === 'reparent').map(effect => [effect.target.issue, effect.target.parent]));
    if (!only) this.diffOrder(parent, observed, effects, findings, plannedParents);
    // Blocks are rendered from the revisions the documents will have after this pass.
    const projected = new Map([...desiredDocs].map(([number, doc]) => {
      const existing = children.get(number)?.doc;
      const copy = clone(doc);
      copy.revision = existing ? existing.revision + (contentDigest(existing) === contentDigest(doc) ? 0 : 1) : 1;
      return [number, copy];
    }));
    this.diffBlocks(parent, projected, observed, only, effects, findings, holds);
    this.auditTraces(parent, observed, only, findings);
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
        if (error.code === 'STALE_WRITER') throw error;
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

    // 1. State documents.
    for (const effect of plan.effects.filter(entry => entry.kind === 'create_state' || entry.kind === 'update_state')) {
      try {
        const desired = effect.doc;
        // A first claim may have created the child after planning. Only PR observations belong
        // to this pass; keep the gate, lifecycle and fence from the document read at apply time.
        const fields = effect.kind === 'create_state' ? ['pr'] : effect.fields;
        const result = mutateDoc('child', effect.target.issue, {
          create: () => newChild({ repository: this.binding.repository, outcome: outcomes.get(effect.target.issue) }),
          change: doc => {
            for (const key of fields) doc[key] = clone(desired[key]);
            return doc;
          },
        });
        record(effect, result.outcome === 'NOOP' ? 'NOOP' : 'DONE');
      } catch (error) {
        if (error.code === 'STALE_WRITER') throw error;
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
    for (const parentIssue of reorderParents) {
      const desired = plan.parent.outcomes.filter(outcome => outcome.parent === parentIssue).sort(compareOutcomes).map(outcome => outcome.issue);
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
      const blocks = this.renderAll(parentDoc, docs);
      const version = this.toolkitVersion;
      const ordered = [...blockEffects.filter(effect => effect.target.issue !== parentNumber), ...blockEffects.filter(effect => effect.target.issue === parentNumber)];
      for (const planned of ordered) {
        const number = planned.target.issue;
        const body = blocks.get(number);
        const effect = { ...planned, target: { issue: number, digest: blockDigest(body) } };
        if (isHeld(`#${number}`, 'body')) { record(effect, 'SKIPPED', 'held earlier in this pass'); continue; }
        if (!version) { record(effect, 'HELD', 'the Toolkit version could not be read'); hold(effect, 'TOOLKIT_VERSION_UNKNOWN', 'the Toolkit version could not be read, so no block was written'); continue; }
        const owner = docOwner(number);
        if (owner === 'child' && !docs.has(number)) { record(effect, 'SKIPPED', 'no state document yet'); continue; }
        // The new body is built from a fresh read, so earlier edits by people are kept. Refuse before
        // writing an intent when the block is broken or the body would grow past the threshold.
        const before = this.reader.issue(number);
        if (!before) { record(effect, 'HELD', 'the issue could not be read'); hold(effect, 'ISSUE_MISSING', 'the issue could not be read'); continue; }
        let next;
        try { next = upsertStateBlock(before.body, renderBlock(body, version), this.placementFor(number)); }
        catch (error) { record(effect, 'HELD', error.message); hold(effect, error.code, error.message); continue; }
        if (next.body.length >= this.threshold) {
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
    return { results, holds };
  }

  run({ apply = false, issue = null, parentOverride = null } = {}) {
    const plan = this.plan({ issue, parentOverride });
    const report = {
      repository: this.binding.repository,
      parent_issue: this.binding.parent_issue,
      store: { ...this.binding.store },
      mode: apply ? 'apply' : 'dry-run',
      parent_revision: plan.parent?.revision ?? null,
      findings: plan.findings,
      close_list: plan.findings.filter(finding => finding.code === 'READY_TO_CLOSE').map(({ issue, pr, head, gate, gate_accepted, accepted, uat, review }) => ({ issue, pr, head, gate, gate_accepted, accepted, uat, review })),
      effects: plan.effects.map(effect => ({ kind: effect.kind, target: effect.target, text: effect.text })),
      recovered: plan.resolutions,
      holds: plan.holds,
      results: [],
      writes: { state: 0, github: 0 },
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
    const attention = report.findings.filter(finding => ATTENTION.has(finding.code));
    report.next_action = report.holds.length ? `Controller: resolve ${report.holds[0].code} on ${report.holds[0].target}: ${report.holds[0].detail}`
      : !apply && report.effects.length ? 'Controller: run reconcile --apply for this plan; other sessions report it'
        : !apply && plan.resolutions.some(entry => entry.outcome !== 'UNKNOWN') ? `Controller: run reconcile --apply to clear ${plan.resolutions.filter(entry => entry.outcome !== 'UNKNOWN').length} settled intent(s)`
        : attention.length ? `Controller: decide on ${attention.length} finding(s) the reconciler does not change, starting with ${attention[0].code} on #${attention[0].issue}`
          : 'None: the state documents and GitHub agree';
    return report;
  }
}

// ---------------------------------------------------------------------------------------------
// Repository identity

function originSlug(url) {
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(String(url || '').trim());
  return match ? `${match[1]}/${match[2]}` : null;
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
  SCHEMA, BINDING_FILE, CLASSES, LIFECYCLES, PATCHABLE_CHILD_FIELDS, PATCHABLE_PARENT_FIELDS, BLOCK_SOURCE, BLOCK_NAME,
  ProgrammeError, GitHubTransport, StateStore, STORE_BACKENDS, ProgrammeGraphReader, GitHubMutator, Reconciler,
  canonical, canonicalText, contentDigest, sameState, validateParent, validateChild, validateBinding, assertValid, loadBinding,
  newParent, newChild, isHolder, parentRefusal, authoriseWrite, claimDocument, submitReturn, consumeReturn, applyPatch,
  evaluateChecks, renderParentBlockBody, renderChildBlockBody, renderBlock, blockDigest, findStateBlock, upsertStateBlock,
  orderMoves, intentId, describeEffect, resolveExecutable, originSlug, bindRepository,
});
