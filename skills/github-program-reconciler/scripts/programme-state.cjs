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
const { DEFAULT_THRESHOLD, INDEX_COMMENT_MARKER, DIRECTORY_COMMENT_MARKER, MAX_INDEX_COMMENTS, auditDecisionTraces, traceEntries, indexErrorText, indexRecoveryText, commentLink, issueUrl } = require('./decision-trace-audit.cjs');
const { OTHER_COMMENTS } = require('./decision-tags.cjs');
const { ProgrammeError, resolveExecutable } = require('./resolve-executable.cjs');
const SAFE_LIMIT = 55000;

// Graph archive formatting is needed only by page operations, never by hook binding reads.
function pageLayout() {
  return require('./programme-page-layout.cjs');
}
function archiveTools() {
  return require('./programme-page-archive.cjs');
}

const SCHEMA = Object.freeze({
  binding: 'toolkit.programme-binding.v1',
  bindingV2: 'toolkit.programme-binding.v2',
  parent: 'toolkit.programme-state.parent.v1',
  child: 'toolkit.programme-state.child.v1',
  childV2: 'toolkit.programme-state.child.v2',
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
// A queued pass reads a task whose number matches the pass count in this cycle, so every task is
// read again at least once in this many passes even when nothing about it changed.
const ROTATION_PASSES = 12;
// The freshness time is redrawn when it is this old.
const BOARD_REDRAW_MS = 60 * 60 * 1000;
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
const EFFECT_KINDS = ['attach', 'reparent', 'reorder', 'replace_block', 'post_index_comment', 'post_archive_comment', 'edit_archive_comment', 'replace_pr_nav', 'set_parent_state', 'post_parent_repair', 'post_closing_backstop'];
const EFFECT_STATES = ['IN_FLIGHT', 'DONE', 'UNKNOWN'];
// Fields that never count towards a document's content digest or revision: the revision itself,
// observation timestamps, pending effects (an intent write must not make the rendered state stale),
// the journal blobs the controller has read and the parent's attention findings. sameState still
// compares the last two, so a real change is written without a revision bump.
const UNHASHED = ['revision', 'volatile', 'pending_effects', 'journals_seen', 'attention', 'page_archive', 'sweep'];
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
const CONTEXT_BLOCK_NAME = 'CONTEXT';
// Index comments are cut below this size (GitHub's comment limit is 65,536 characters).
const INDEX_COMMENT_LIMIT = 60000;
// Cap notifying topic comments across the pass; larger traces use directory pages directly.
const MAX_TOPIC_COMMENTS_PER_PASS = 5;
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
  if (isObject(copy.private)) {
    copy.private = {...copy.private};
    for (const key of ['graph_pr_watermark','graph_issue_watermark','closing_scan']) delete copy.private[key];
  }
  for (const key of UNHASHED) delete copy[key];
  return sha256(JSON.stringify(canonical(copy)));
}

// The same state: equal content, equal pending effects and equal journals read. Volatile timestamps
// never matter.
function sameState(previous, next) {
  return contentDigest(previous) === contentDigest(next)
    && JSON.stringify(canonical(previous.pending_effects || [])) === JSON.stringify(canonical(next.pending_effects || []))
    && JSON.stringify(canonical(previous.journals_seen || {})) === JSON.stringify(canonical(next.journals_seen || {}))
    && JSON.stringify(canonical(previous.attention || [])) === JSON.stringify(canonical(next.attention || []))
    && JSON.stringify(canonical(previous.page_archive || [])) === JSON.stringify(canonical(next.page_archive || []))
    && JSON.stringify(canonical(previous.sweep || null)) === JSON.stringify(canonical(next.sweep || null))
    && previous.private?.graph_pr_watermark === next.private?.graph_pr_watermark
    && previous.private?.graph_issue_watermark === next.private?.graph_issue_watermark
    && JSON.stringify(canonical(previous.private?.closing_scan || [])) === JSON.stringify(canonical(next.private?.closing_scan || []));
}

function check(errors, condition, message) { if (!condition) errors.push(message); }

// Fields each object may and must hold, as the schemas' additionalProperties: false and required.
const SHAPES = {
  child: { all: ['schema', 'repository', 'issue', 'revision', 'fence', 'lifecycle', 'completed_at', 'release', 'gate', 'candidate', 'pr', 'uat', 'review', 'blockers', 'next_action', 'pending_effects', 'journals_seen', 'private', 'volatile', 'prs', 'before_close', 'closed_by_sweep', 'added_by_sweep'], optional: ['volatile', 'journals_seen', 'completed_at', 'prs', 'before_close', 'closed_by_sweep', 'added_by_sweep'] },
  parent: { all: ['schema', 'repository', 'parent_issue', 'revision', 'fence', 'release_plan', 'outcomes', 'pending_effects', 'attention', 'page_archive', 'private', 'volatile', 'sweep'], optional: ['volatile', 'attention', 'page_archive', 'sweep'] },
  finding: { all: ['id', 'source', 'code', 'issue', 'head', 'state', 'first_seen', 'changed_at', 'diagnostics', 'kind'], optional: ['diagnostics', 'kind'] },
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
const secretShaped = text => SECRET_SHAPES.some(([, pattern]) => pattern.test(String(text || '')));
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
    if (['post_archive_comment', 'edit_archive_comment'].includes(effect?.kind)) {
      const target = effect.target;
      checkShape(errors, target, { all: ['issue', 'key', 'comment_id', 'login', 'before', 'digest'] }, `pending_effects[${index}].target`);
      check(errors, isObject(target) && isInt(target.issue, 1) && (/^graph-(?:retired|completed|optional|later|now)-[1-9][0-9]*$/.test(target.key) || effect.kind === 'post_archive_comment' && archiveTools().NOTE_KEY.test(target.key))
        && isText(target.login) && /^[0-9a-f]{64}$/.test(target.digest)
        && (effect.kind === 'post_archive_comment' ? target.comment_id === null && target.before === null
          : isInt(target.comment_id, 1) && /^[0-9a-f]{64}$/.test(target.before)), `pending_effects[${index}].target must name a bounded archive intent`);
    }
  }
}

function validatePageArchive(errors, archive) {
  if (archive === undefined) return;
  check(errors, Array.isArray(archive), 'page_archive must be a list');
  const keys = new Set(), ids = new Set();
  for (const entry of Array.isArray(archive) ? archive : []) {
    check(errors, isObject(entry), 'page_archive entry must be an object');
    if (!isObject(entry)) continue;
    const note = entry.kind === 'note';
    checkShape(errors, entry, { all: ['key', 'kind', 'group', 'title', 'comment_id', 'login', 'digest', 'state', 'untrusted_ids', 'untrusted_before', ...(note ? ['copy'] : [])], optional: ['untrusted_ids', 'untrusted_before'] }, 'page_archive entry');
    check(errors, typeof entry.key === 'string' && (note ? archiveTools().NOTE_KEY : /^graph-(?:retired|completed|optional|later|now)-[1-9][0-9]*$/).test(entry.key) && !keys.has(entry.key), 'page_archive key must be unique and fixed');
    keys.add(entry.key);
    // A note part is one verified, never-edited comment holding marked hand-written text; `copy`
    // is the SHA-256 of the whole page saved to the private store before that text could move.
    if (note) check(errors, entry.group === null && typeof entry.copy === 'string' && /^[0-9a-f]{64}$/.test(entry.copy), 'page_archive note must have no group and name its saved page copy');
    else check(errors, entry.kind === 'graph' && archiveTools().GROUPS.includes(entry.group) && entry.key.startsWith(`graph-${String(entry.group).toLowerCase()}-`), 'page_archive kind and group must match its key');
    check(errors, isText(entry.title) && entry.title.length <= 200, 'page_archive title must be bounded text');
    check(errors, ['pending', 'moved', ...(note ? ['withdrawn'] : [])].includes(entry.state), 'page_archive state must be pending or moved, or withdrawn for a note');
    check(errors, entry.comment_id === null ? entry.login === null && entry.state === 'pending' : isInt(entry.comment_id, 1) && isText(entry.login) && !ids.has(entry.comment_id), 'page_archive id must be unique with verified login');
    if (entry.comment_id !== null) ids.add(entry.comment_id);
    if (entry.untrusted_before !== undefined) check(errors, isInt(entry.untrusted_before, 1), 'page_archive untrusted floor must be a positive integer');
    if (entry.untrusted_ids !== undefined) check(errors, Array.isArray(entry.untrusted_ids) && entry.untrusted_ids.length > 0 && entry.untrusted_ids.every(id => isInt(id, 1)) && new Set(entry.untrusted_ids).size === entry.untrusted_ids.length, 'page_archive untrusted ids must be unique positive integers');
    check(errors, typeof entry.digest === 'string' && /^[0-9a-f]{64}$/.test(entry.digest), 'page_archive digest must be SHA-256');
  }
}

function validateCommon(errors, doc, schema) {
  check(errors, isObject(doc), 'document must be an object');
  if (!isObject(doc)) return false;
  checkShape(errors, doc, schema === SCHEMA.parent ? 'parent' : 'child', 'document');
  screenSecrets(errors, doc, 'document');
  check(errors, doc.schema === schema || (schema === SCHEMA.child && doc.schema === SCHEMA.childV2), `schema must be ${schema}${schema === SCHEMA.child ? ` or ${SCHEMA.childV2}; update Toolkit before reading a newer child schema` : ''}`);
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
    if (doc.sweep !== undefined) validateSweep(errors, doc.sweep);
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
    validatePageArchive(errors, doc.page_archive);
  }
  return errors;
}

// The sweep's saved queue: tasks still to read, in order, and how often each failed in a row.
function validateSweep(errors, value) {
  checkShape(errors, value, { all: ['queue', 'failures'] }, 'sweep');
  if (!isObject(value)) return;
  check(errors, Array.isArray(value.queue) && value.queue.every(number => isInt(number, 1)) && new Set(value.queue).size === value.queue.length, 'sweep.queue must contain unique issue numbers');
  check(errors, isObject(value.failures) && Object.entries(value.failures).every(([number, count]) => /^[1-9]\d*$/.test(number) && isInt(count, 1)), 'sweep.failures must map issue numbers to failure counts');
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
  CLOSED_WITHOUT_ACCEPTANCE: { source: 'reconcile', next_action: 'Controller: record G2 and UAT, or confirm the close' },
  CHILD_REOPENED: { source: 'reconcile', next_action: 'Controller: confirm the restored task lifecycle' },
  CHILD_ADDED: { source: 'reconcile', next_action: 'Controller: confirm the new task or move it in the catalogue' },
  PR_WITHOUT_TASK: { source: 'reconcile', next_action: 'Controller: link the PR to a task or dispose with a reason' },
  CLOSING_COMMENT_MISSING: { source: 'reconcile', next_action: 'The closing agent posts the story with closing-comment; facts alone leave it waiting' },
  MANAGED_BLOCK_BROKEN: { source: 'reconcile', next_action: 'Controller: repair the broken managed block in the issue body' },
  BODY_TOO_LARGE: { source: 'reconcile', next_action: 'Controller: arrange an approved reduction of the largest page sections, then refresh' },
  PAGE_LAYOUT_HELD: { source: 'reconcile', next_action: 'Controller: fix what the finding names on the task page (an unclosed code block, a section that appears twice, an unknown marker or a secret-shaped value); until then its blocks are updated where they are and its text is not moved' },
  BODY_NEAR_LIMIT: { source: 'reconcile', next_action: 'Controller: arrange an approved reduction of retained page text to restore headroom, then refresh' },
  ARCHIVE_COMMENT_UNTRUSTED: { source: 'reconcile', next_action: 'Controller: inspect the archive comments on the page this finding names; redraw can publish a fresh verified graph part; archived notes are in the saved page copies in the private store under page-copies/issue-<n>/ and are restored by putting them back on the page under `## Archive` for a fresh comment; the finding stays open until disposed' },
  ARCHIVE_SECTION_UNSAFE: { source: 'reconcile', next_action: 'Controller: fix the text under the `## Archive` line as the reason says, or remove that line; nothing was moved' },
  PASS_STOPPED: { source: 'reconcile', next_action: 'Run refresh again to finish the remaining work' },
  SWEEP_TASK_UNREADABLE: { source: 'reconcile', next_action: 'Controller: check why the sweep could not read this task three passes in a row; it keeps trying after the other tasks' },
  STATE_BRANCH_BUSY: { source: 'reconcile', next_action: 'Controller: something else kept moving the state branch during three sweeps in a row; find the other writer' },
  GRAPHQL_REFUSED: { source: 'reconcile', next_action: 'Controller: GitHub refused GraphQL to three sweeps in a row; check the sign-in and GitHub status, the sweep reads one document at a time meanwhile' },
  TRACE_UNLINKED: { source: 'reconcile', next_action: 'Controller: link the decision comments with decision-trace-audit --repair' },
  TRACE_SUPERSEDED_UNMARKED: { source: 'reconcile', next_action: 'Controller: mark the superseded decision record' },
  TASK_IDLE: { source: 'reconcile', queue: true, next_action: 'Controller: hand the task to a lane, or set it back to planned (queued), put its decision on record or retire it' },
  TASK_MERGED_OPEN: { source: 'reconcile', queue: true, next_action: 'Controller: judge its done-when, then close it as completed, or plan and hand out its next slice, or set it back to planned (queued)' },
  PR_UNTRACKED: { source: 'reconcile', next_action: 'Controller: confirm the PR and record it with update --patch' },
  COMPLETED_PR_MISSING: { source: 'reconcile', next_action: 'Controller: check the completed task references; no matching merged PR was found' },
  PR_DISCOVERY_INCOMPLETE: { source: 'reconcile', next_action: 'Controller: retry reconciliation; merged PR discovery could not finish within its read limits' },
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
// Work-queue findings: a task on the programme graph that needs the controller's next step. They are
// answered by acting (a lane, a state change, a close) or disposed with a reason, never acknowledged;
// they list first, and a disposed one resolves when its condition clears so a later stall is new.
// A code joins it with `queue: true` in its FINDING_CODES row.
const WORK_QUEUE_CODES = new Set(Object.keys(FINDING_CODES).filter(code => FINDING_CODES[code].queue === true));
// Findings with no issue of their own.
const ISSUELESS_CODES = new Set(['INVENTORY_INCOMPLETE', 'ATTENTION_FULL']);
const ATTENTION_NOTE_LIMIT = 200;
const BODY_SECTION_KINDS = ['CURRENT', 'STATE', 'CONTEXT', 'TRACE', 'NAV', 'hand_written'];
const SIZE_CODES = ['BODY_TOO_LARGE', 'BODY_NEAR_LIMIT'];
const PAGE_CODES = SIZE_CODES;
const BODY_SECTION_LIMIT = 5;
// One pass budget per mode. A scheduled pass (the hourly sweep, on GitHub or on a computer) has
// about an hour: it is killed KILL_SLACK_MS after its budget and its job stopped JOB_SLACK_MS later,
// still before the next hourly start. The refresh a session starts after its own GitHub write keeps
// ten minutes, so it never holds the programme lock for long.
const KILL_SLACK_MS = 5 * 60 * 1000;
const JOB_SLACK_MS = 3 * 60 * 1000;
const PASS_BUDGETS = Object.freeze(Object.fromEntries(Object.entries({ scheduled: 50, 'after-write': 10 }).map(([mode, minutes]) => {
  const budgetMs = minutes * 60 * 1000;
  return [mode, Object.freeze({ budgetMs, killMs: budgetMs + KILL_SLACK_MS, jobTimeoutMs: budgetMs + KILL_SLACK_MS + JOB_SLACK_MS })];
})));
const REFRESH_BUDGET_MS = PASS_BUDGETS['after-write'].budgetMs;
const PAGE_RESERVE_MS = 3 * 60 * 1000;
const END_RESERVE_MS = 60 * 1000;
// Stop the queue two minutes before the budget ends: one minute to settle intents and record the
// stop, then one for CURRENT. The kill five minutes after the budget leaves slack for requests
// already in flight; checks cannot cancel such a request.
const QUEUE_RESERVE_MS = 2 * END_RESERVE_MS;
const AGAIN_RESERVE_MS = 6 * 60 * 1000;
// Task pages re-laid (hand-written text moved, with a saved copy each) in one pass.
const MAX_RELAYS_PER_PASS = 10;
// A task shown IN PROGRESS with no open PR, no live gate and no holder counts as idle once its
// state document and its comments have been still for this long.
const TASK_IDLE_HOURS = 6;
// A task whose PRs have all merged or closed needs its next step sooner: this long after the last change.
const TASK_MERGED_OPEN_HOURS = 1;
// An open PR with no update (push, comment, review or edit) for this long no longer counts as moving its task.
const PR_STALE_HOURS = 24;
const PASS_PHASES = ['planning', 'state', 'page', 'links', 'order', 'pr_links', 'task_pages', 'lifecycle', 'closing', 'unknown'];

function validatePassDiagnostics(errors, value, at) {
  check(errors, isObject(value), `${at} must be an object`);
  if (!isObject(value)) return;
  checkShape(errors, value, { all: ['cause', 'phase', 'done', 'total', 'started_at'] }, at);
  check(errors, ['time_limit', 'interrupted'].includes(value.cause), `${at}.cause must be time_limit or interrupted`);
  check(errors, PASS_PHASES.includes(value.phase), `${at}.phase must be a known pass phase`);
  check(errors, Number.isSafeInteger(value.done) && value.done >= 0, `${at}.done must be a bounded whole number`);
  check(errors, Number.isSafeInteger(value.total) && value.total >= value.done, `${at}.total must be a bounded whole number at least done`);
  check(errors, typeof value.started_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value.started_at)
    && Number.isFinite(Date.parse(value.started_at)), `${at}.started_at must be a UTC date and time`);
}

// One clock and deadline for all passes in a refresh process. Progress is supplied by the lock
// owner; direct callers can inject the same clock without writing a local progress file. `endsBy`
// is when the process is killed at the latest: the sweep lease never outlasts it.
class RefreshBudget {
  constructor({ nowMs = Date.now, budgetMs = REFRESH_BUDGET_MS, progress = null } = {}) {
    this.nowMs = nowMs;
    this.start = nowMs();
    this.started_at = new Date(this.start).toISOString();
    this.deadline = this.start + budgetMs;
    this.endsBy = this.deadline + KILL_SLACK_MS;
    this.progress = progress;
    this.phase = 'planning'; this.done = 0; this.total = 0;
    this.stopped = null;
  }
  left() { return this.deadline - this.nowMs(); }
  phaseAt(phase, total = 0) {
    this.phase = phase; this.done = 0; this.total = total;
    this.metrics?.phaseAt(phase);
    this.progress?.write(this.snapshot());
  }
  tick() {
    this.done++; this.total = Math.max(this.total, this.done);
    if (this.done % 10 === 0) this.progress?.write(this.snapshot());
  }
  snapshot(cause = 'interrupted') {
    return { cause, phase: this.phase, done: this.done, total: this.total, started_at: this.started_at };
  }
  stop(reserve = QUEUE_RESERVE_MS) {
    if (!this.stopped && this.left() < reserve) this.stopped = this.snapshot('time_limit');
    return Boolean(this.stopped);
  }
  planning() {
    if (this.stop(0)) throw new ProgrammeError('PASS_STOPPED', 'The planning time budget was reached.');
    this.tick();
  }
}

// Disjoint UTF-16 spans, including managed markers and all formatting, in the same units as
// projectBody's length check. Headings only delimit hand-written spans; no heading text is kept.
function bodySizeDiagnostics(body, threshold) {
  const managed = BODY_SECTION_KINDS.filter(kind => kind !== 'hand_written')
    .map(kind => ({ kind, block: findStateBlock(body, kind).block })).filter(part => part.block)
    .sort((a, b) => a.block.start - b.block.start);
  const sections = [];
  let section = 0;
  const handwritten = (start, end) => {
    const cuts = [start, ...[...body.slice(start, end).matchAll(/^#{1,6}[ \t]+/gm)].map(match => start + match.index).filter(at => at > start), end];
    for (let i = 1; i < cuts.length; i += 1) if (cuts[i] > cuts[i - 1]) sections.push({ kind: 'hand_written', section: ++section, size: cuts[i] - cuts[i - 1] });
  };
  let offset = 0;
  for (const { kind, block } of managed) {
    handwritten(offset, block.start);
    sections.push({ kind, section: 0, size: block.end - block.start });
    offset = block.end;
  }
  handwritten(offset, body.length);
  const largest = sections.sort((a, b) => b.size - a.size).slice(0, BODY_SECTION_LIMIT);
  return { projected_total: body.length, threshold, required_reduction: Math.max(0, body.length - threshold + 1),
    largest_sections: largest, remainder: body.length - largest.reduce((sum, part) => sum + part.size, 0) };
}

function validateBodyDiagnostics(errors, value, at) {
  check(errors, isObject(value), `${at} must be an object`);
  if (!isObject(value)) return;
  checkShape(errors, value, { all: ['projected_total', 'threshold', 'required_reduction', 'largest_sections', 'remainder'] }, at);
  const numeric = number => Number.isSafeInteger(number) && number >= 0;
  for (const key of ['projected_total', 'threshold', 'required_reduction', 'remainder']) check(errors, numeric(value[key]), `${at}.${key} must be a bounded whole number`);
  check(errors, value.threshold > 0, `${at}.threshold must be positive`);
  check(errors, value.required_reduction === Math.max(0, value.projected_total - value.threshold + 1), `${at}.required_reduction must match the strict threshold`);
  const parts = Array.isArray(value.largest_sections) ? value.largest_sections : [];
  check(errors, Array.isArray(value.largest_sections) && parts.length > 0 && parts.length <= BODY_SECTION_LIMIT, `${at}.largest_sections must have 1 to ${BODY_SECTION_LIMIT} spans`);
  const identities = new Set();
  for (const part of parts) {
    check(errors, isObject(part), `${at} section must be an object`);
    if (!isObject(part)) continue;
    checkShape(errors, part, { all: ['kind', 'section', 'size'] }, at);
    check(errors, BODY_SECTION_KINDS.includes(part.kind), `${at} section kind must be fixed`);
    check(errors, numeric(part.section) && (part.kind === 'hand_written' ? part.section > 0 : part.section === 0), `${at} section number must match its kind`);
    check(errors, numeric(part.size) && part.size > 0, `${at} section size must be positive and bounded`);
    const id = `${part.kind}:${part.section}`;
    check(errors, !identities.has(id), `${at} spans must be disjoint`);
    identities.add(id);
  }
  check(errors, parts.reduce((sum, part) => sum + (part?.size || 0), value.remainder) === value.projected_total, `${at} section sizes and remainder must sum exactly`);
}

function findingId(source, code, issue, head = '', kind = null) {
  return sha256(`${source}|${code}|${issue ?? ''}|${head || ''}${kind ? `|${kind}` : ''}`).slice(0, 12);
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
    if (SIZE_CODES.includes(entry.code)) validateBodyDiagnostics(errors, entry.diagnostics, `${at}.diagnostics`);
    else if (entry.code === 'ARCHIVE_COMMENT_UNTRUSTED') {
      checkShape(errors, entry.diagnostics, { all: ['reason', 'copy'], optional: ['copy'] }, `${at}.diagnostics`);
      check(errors, isObject(entry.diagnostics) && ['changed', 'foreign', 'missing', 'duplicate'].includes(entry.diagnostics.reason), `${at}.diagnostics must name a fixed archive trust failure`);
      if (isObject(entry.diagnostics) && entry.diagnostics.copy !== undefined) check(errors, /^[0-9a-f]{64}$/.test(String(entry.diagnostics.copy)), `${at}.diagnostics.copy must be the SHA-256 of a saved page copy`);
    }
    else if (entry.code === 'ARCHIVE_SECTION_UNSAFE') {
      checkShape(errors, entry.diagnostics, { all: ['reason'] }, `${at}.diagnostics`);
      check(errors, isObject(entry.diagnostics) && archiveTools().NOTE_REASONS.includes(entry.diagnostics.reason), `${at}.diagnostics must name a fixed Archive section reason`);
    }
    else if (entry.code === 'PASS_STOPPED') validatePassDiagnostics(errors, entry.diagnostics, `${at}.diagnostics`);
    else check(errors, entry.diagnostics === undefined, `${at}.diagnostics belongs only to page findings or PASS_STOPPED`);
    check(errors, Boolean(known) && entry.source === known.source, `${at}.source must be the code's source`);
    check(errors, ISSUELESS_CODES.has(entry.code) ? entry.issue === null : isInt(entry.issue, 1), `${at}.issue must be an issue number${ISSUELESS_CODES.has(entry.code) ? ' or null' : ''}`);
    check(errors, HEAD_BOUND_CODES.has(entry.code) ? optional(entry.head, isSha) : entry.head === null, `${at}.head must be a full 40-character SHA for a head-bound code, otherwise null`);
    check(errors, FINDING_STATES.includes(entry.state), `${at}.state must be ${FINDING_STATES.join(', ')}`);
    for (const field of ['first_seen', 'changed_at']) check(errors, isText(entry[field]) && !Number.isNaN(Date.parse(entry[field])), `${at}.${field} must be a date and time`);
    check(errors, entry.code === 'CLOSING_COMMENT_MISSING' ? ['pr','issue'].includes(entry.kind) : entry.kind === undefined, `${at}.kind belongs to a closing finding and must be pr or issue`);
    check(errors, FINDING_ID.test(String(entry.id)) && entry.id === findingId(entry.source, entry.code, entry.issue, entry.head, entry.kind), `${at}.id must be the finding's own id`);
    check(errors, !ids.has(entry.id), `${at}.id is repeated`);
    ids.add(entry.id);
  }
}

// Codes the reconciler reports once, on the pass that first reads a journal; the next pass no longer
// sees them although nobody acted. The reconcile pass keeps such a finding open (`hold`) until it is
// answered or its condition is really gone (see Reconciler.oneTimeHolds).
const ONE_TIME_CODES = new Set(['RETURN_CAPTURED', 'JOURNAL_ERROR', 'JOURNAL_INVALID', 'STALE_ASSIGNMENT', 'CHILD_REOPENED', 'CHILD_ADDED', 'ARCHIVE_COMMENT_UNTRUSTED']);

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
  const add = (code, issue, head, since = null, diagnostics = null, kind = null) => {
    const id = findingId(FINDING_CODES[code].source, code, issue, head, kind);
    seenIds.add(id);
    const existing = byId.get(id);
    if (existing) {
      // A resolved finding that comes back is new again. A one-time code is a fresh event each time it
      // is reported, so it also reopens an answered entry. A report that carries the time of what it
      // reports (a journal's error) reopens nothing when that is no later than the entry's last change:
      // a journal that still shows an old error is not a new one, whether the entry was answered or
      // has resolved since.
      const fresh = !since || Number.isNaN(Date.parse(since)) || Date.parse(since) > Date.parse(existing.changed_at);
      const diagnosticsChanged = diagnostics && JSON.stringify(canonical(existing.diagnostics)) !== JSON.stringify(canonical(diagnostics));
      // Stop diagnostics identify the event. A different stop needs its own answer, while
      // re-reporting the same stop must not reopen an acknowledged or disposed entry.
      const newEvent = ONE_TIME_CODES.has(code) || (code === 'PASS_STOPPED' && diagnosticsChanged);
      const reopens = fresh && (existing.state === 'resolved' || (newEvent && ['acknowledged', 'disposed'].includes(existing.state)));
      if (reopens) {
        existing.state = 'new'; existing.changed_at = now;
        if (code === 'CLOSING_COMMENT_MISSING') existing.first_seen = now;
        changed = true;
      }
      if (diagnosticsChanged) {
        existing.diagnostics = clone(diagnostics);
        changed = true;
      }
      return;
    }
    if (code !== 'ATTENTION_FULL' && open() >= ATTENTION_LIMIT) { add('ATTENTION_FULL', null, null); return; }
    const entry = { id, source: FINDING_CODES[code].source, code, issue, head, state: 'new', first_seen: now, changed_at: now, ...(diagnostics ? { diagnostics: clone(diagnostics) } : {}), ...(kind ? {kind} : {}) };
    list.push(entry);
    byId.set(id, entry);
    changed = true;
  };
  for (const finding of seen) {
    if (!Object.hasOwn(FINDING_CODES, finding.code) || FINDING_CODES[finding.code].source !== source) continue;
    const issue = ISSUELESS_CODES.has(finding.code) ? null : finding.issue;
    if (!ISSUELESS_CODES.has(finding.code) && !isInt(issue, 1)) continue;
    add(finding.code, issue, HEAD_BOUND_CODES.has(finding.code) && isSha(finding.head) ? finding.head : null, typeof finding.since === 'string' ? finding.since : null,
      [...PAGE_CODES, 'ARCHIVE_COMMENT_UNTRUSTED', 'ARCHIVE_SECTION_UNSAFE', 'PASS_STOPPED'].includes(finding.code) ? finding.diagnostics : null,
      finding.code === 'CLOSING_COMMENT_MISSING' ? finding.kind : null);
  }
  for (const entry of complete ? list : []) {
    // Only the reconciler's complete successful redraw/readback settles a size finding. This also
    // protects an affected page first reported by another writer after the planning snapshot.
    if (PAGE_CODES.includes(entry.code) || entry.code === 'ARCHIVE_COMMENT_UNTRUSTED') continue;
    // ATTENTION_FULL resolves on any complete run back under the bound.
    const own = entry.source === source || entry.code === 'ATTENTION_FULL';
    const settles = OPEN_FINDING_STATES.includes(entry.state) || (entry.state === 'disposed' && WORK_QUEUE_CODES.has(entry.code));
    if (!own || seenIds.has(entry.id) || hold.includes(entry.id) || !settles) continue;
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
  if (state === 'acknowledged' && WORK_QUEUE_CODES.has(entry.code)) {
    throw new ProgrammeError('QUEUE_FINDING_NEEDS_ACTION', `Finding ${id} (${entry.code}) is on the work queue: act on it (${FINDING_CODES[entry.code].next_action}), or dispose --finding ${id} --reason <text>. It clears by itself once the task moves.`);
  }
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
function waitingFindings(attention, now) {
  const time = Date.parse(now);
  return openFindings(attention).filter(entry => entry.state === 'new' && time - Date.parse(entry.changed_at) >= 24 * 60 * 60 * 1000);
}

function attentionLine(attention, now = new Date().toISOString()) {
  const counts = attentionCounts(attention);
  const waiting = waitingFindings(attention, now).filter(entry => !WORK_QUEUE_CODES.has(entry.code)).length;
  const queue = workQueue(attention).length;
  return counts.new || counts.acknowledged ? `Attention: ${counts.new} new, ${counts.acknowledged} acknowledged${queue ? `, ${queue} in the work queue` : ''}${waiting ? `, ${waiting} waiting on you` : ''}` : 'Attention: clear';
}

// Open work-queue findings, oldest first: the longest-stalled task leads.
function workQueue(attention) {
  return openFindings(attention).filter(entry => WORK_QUEUE_CODES.has(entry.code)).reverse();
}

// Open findings, newest first.
function openFindings(attention) {
  return (Array.isArray(attention) ? attention : []).filter(entry => OPEN_FINDING_STATES.includes(entry.state))
    .sort((a, b) => Date.parse(b.changed_at) - Date.parse(a.changed_at) || a.id.localeCompare(b.id));
}

// Why marked notes stayed on the page, in the owner's words. The keys are the reader's closed list.
const NOTE_REASON_TEXT = Object.freeze({
  two_markers: 'there is more than one `## Archive` line',
  marker_nested: 'the `## Archive` line sits inside a code block, a comment, a folded section or a generated block',
  open_fence: 'a code block under it is not closed',
  open_comment: 'an HTML comment under it is not closed',
  open_html: 'a folded section or raw HTML block under it is not closed, or is closed without being opened',
  ambiguous_markup: 'a line above the end of the marked area is outside the plain Markdown the sweep reads: HTML other than a folded section or a one-line comment on its own line at the start of the line, a code block or comment that does not start at the start of a line, a level one or two heading behind indentation, a quote, a list marker or a footnote, a Toolkit marker line outside a real generated block, or a generated block holding HTML or a code block',
  underlined_heading: 'a heading under it is written by underlining; write it with `#` marks, or put a blank line above the rule',
  control_character: 'the page holds a character GitHub reads differently (a lone carriage return, a leading byte-order mark, a null or a line separator)',
  link_definition_split: 'a link definition under it is still used by text that stays on the page',
  part_too_large: 'a stretch with no `###` heading or blank line is too long for one comment',
  secret_like: 'the page holds text shaped like a secret, so no copy was saved',
  comment_not_exact: 'the comment posted for this exact text did not stay as written, so it was set aside; change the notes',
});

function findingText(entry) {
  if (entry.code === 'PASS_STOPPED' && entry.diagnostics) {
    const d = entry.diagnostics;
    return `PASS_STOPPED #${entry.issue}: the last refresh stopped at ${d.phase.replace(/_/g, ' ')} (${d.done} of ${d.total} done); the next refresh picks up the rest`;
  }
  if (entry.code === 'ARCHIVE_SECTION_UNSAFE' && entry.diagnostics) {
    return `ARCHIVE_SECTION_UNSAFE #${entry.issue}: the notes under \`## Archive\` were not moved (${NOTE_REASON_TEXT[entry.diagnostics.reason] || entry.diagnostics.reason}); fix that or remove the line`;
  }
  if (entry.code === 'ARCHIVE_COMMENT_UNTRUSTED' && entry.diagnostics?.copy) {
    return `ARCHIVE_COMMENT_UNTRUSTED #${entry.issue}: a comment holding archived notes is ${entry.diagnostics.reason === 'missing' ? 'missing' : 'no longer as written'}; the notes are in the private store at page-copies/issue-${entry.issue}/${entry.diagnostics.copy}.md. Put them back on the page under \`## Archive\` for a fresh comment, or dispose of this finding`;
  }
  const next = FINDING_CODES[entry.code]?.next_action || '';
  return `${entry.code}${entry.kind ? ` ${entry.kind === 'pr' ? 'PR' : 'issue'}` : ''}${entry.issue ? ` #${entry.issue}` : ''}${entry.head ? ` at ${shortSha(entry.head)}` : ''}: ${entry.issue ? next.replace('issue-<n>', `issue-${entry.issue}`) : next}`;
}

// A digest of the open findings and their states, to tell when the set changed.
function attentionDigest(attention) {
  return sha256(openFindings(attention).map(entry => `${entry.id}:${entry.state}`).sort().join('\n')).slice(0, 16);
}

function validateChild(doc) {
  const errors = [];
  if (validateCommon(errors, doc, SCHEMA.child)) {
    const v2Fields = ['prs', 'before_close', 'closed_by_sweep', 'added_by_sweep'];
    if (doc.schema === SCHEMA.child) check(errors, v2Fields.every(key => !Object.hasOwn(doc, key)), 'sweep fields require the v2 child schema; update Toolkit');
    if (doc.prs !== undefined) {
      check(errors, Array.isArray(doc.prs), 'prs must be a list');
      const numbers = new Set();
      for (const pr of Array.isArray(doc.prs) ? doc.prs : []) {
        checkShape(errors, pr, {all:['number','state','merge_sha']}, 'prs entry');
        check(errors, isObject(pr) && isInt(pr.number, 1) && !numbers.has(pr.number) && ['OPEN','MERGED','CLOSED'].includes(pr.state)
          && optional(pr.merge_sha, isSha) && (pr.state === 'MERGED' || pr.merge_sha === null), 'prs entries must have unique numbers, fixed states and a merge SHA or null');
        numbers.add(pr?.number);
      }
    }
    check(errors, doc.before_close === undefined || LIFECYCLES.includes(doc.before_close), 'before_close must be a lifecycle');
    for (const key of ['closed_by_sweep','added_by_sweep']) check(errors, doc[key] === undefined || typeof doc[key] === 'boolean', `${key} must be boolean`);
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
      if (binding.parent_lifecycle !== undefined) {
        const policy = binding.parent_lifecycle;
        check(errors, isObject(policy) && Object.keys(policy).length === 2 && ['reopen_incomplete', 'complete_when_children_closed'].every(key => typeof policy[key] === 'boolean'), 'parent_lifecycle must explicitly name reopen_incomplete and complete_when_children_closed booleans');
      }
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
      check(errors, binding.parent_lifecycle === undefined, 'parent_lifecycle belongs to v2');
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
const BINDING_V2_KEYS = Object.freeze(['schema', 'repository', 'governance', 'parents', 'store', 'required_checks', 'paid_security', 'dependency_updates', 'projection', 'schedule_folder', 'state', 'parent_lifecycle']);

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
    schema: SCHEMA.childV2, repository, issue: outcome.issue, revision: 0,
    fence: { epoch: 0, holder_prefix: null, holder_session: null },
    lifecycle, release: null,
    gate: { role: null, state: null, session_id: null, route: null, returns: [] },
    candidate: { branch: null, head: null, tree: null, base: null },
    pr: { number: null, state: null, head: null, checks: { state: 'UNKNOWN', required_total: 0, required_passed: 0, at_head: null } },
    prs: [],
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

// On a task still open, a shown PR that already merged or closed says so, so it never reads as in progress.
function prCellState(outcome, child, number) {
  if (isFinished(outcome, child)) return '';
  const state = [child?.pr, ...(child?.prs || [])].find(pr => pr?.number === number)?.state;
  return state === 'MERGED' ? ' merged' : state === 'CLOSED' ? ' closed' : '';
}

// The task's most recently opened PR, whatever its state, or null. GitHub numbers PRs in the order
// they are opened, so the highest number among the tracked PR and the discovered history is it.
function latestPr(child) {
  const numbers = [child?.pr?.number, ...(child?.prs || []).map(pr => pr.number)].filter(number => isInt(number, 1));
  return numbers.length ? Math.max(...numbers) : null;
}

// Every PR found for a task, open first, one line each: the discovered history, and the tracked
// PR when the history does not hold it yet.
function prHistoryLines(child) {
  const listed = child.prs || [];
  const tracked = child.pr?.number && !listed.some(pr => pr.number === child.pr.number)
    ? [{ number: child.pr.number, state: child.pr.state === 'DRAFT' ? 'OPEN' : child.pr.state || 'OPEN', merge_sha: null }] : [];
  const rank = { OPEN: 0, MERGED: 1, CLOSED: 2 };
  const all = [...tracked, ...listed].sort((a, b) => (rank[a.state] ?? 3) - (rank[b.state] ?? 3));
  return all.length ? all.map(pr => `- #${pr.number} ${pr.state}${pr.state === 'MERGED' && isSha(pr.merge_sha) ? ` ${shaLink(child.repository, pr.merge_sha)}` : ''}`) : ['- None found.'];
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
const GRAPH_HEADER = ['| Task | Task Description | Child # | PR # | Class | Status | Last updated (SGT) |', '|---|---|---|---|---|---|---|'];

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

function lastUpdated(outcome, child, issue, comments) {
  const times = isFinished(outcome, child) ? [completedAt(child, issue)]
    : graphClass(outcome, child) === 'NOW' ? [child?.volatile?.written_at, ...comments.filter(comment => !String(comment.body || '').includes('programme-trace intent=')).map(comment => comment.created_at)] : [];
  const newest = Math.max(...times.filter(Boolean).map(value => Date.parse(value)).filter(Number.isFinite));
  return Number.isFinite(newest) ? new Date(newest + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ') : '-';
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
function renderParentBlockBody(parent, children, issues = new Map(), comments = new Map()) {
  const rows = graphOrder(parent, children, issues).map(outcome => {
    const child = children.get(outcome.issue);
    const cls = graphClass(outcome, child);
    // One PR per row; the full history is on the task page.
    // A retired task shows none: its PRs are no longer the way to the work.
    const latest = isRetired(outcome, child) ? null : latestPr(child);
    const pr = latest ? `#${latest}${prCellState(outcome, child, latest)}` : '-';
    const issue = issues.get(outcome.issue);
    // Optional cell padding would cost fourteen characters per row, more than the PR count.
    return `|${taskName(outcome, issue)}|${descriptionText(outcome)}|#${outcome.issue}|${pr}|${cls}|${statusText(outcome, child)}|${lastUpdated(outcome, child, issue, comments.get(outcome.issue) || [])}|`;
  });
  return [
    revisionLine(parent, children),
    '# PROGRAMME GRAPH',
    '',
    `State revision ${parent.revision}; edit state documents and task comments. Order: NOW, LATER by priority, OPTIONAL, COMPLETED (latest last), RETIRED. Updated: completion, latest active state/comment (excluding generated indexes), or dash if queued. PR: the latest opened, whatever its state (merged or closed said on an open task; none for a retired task); history on the task page.`,
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
function renderTraceBlockBody(number, trace, repository = '', topic = null, parentPage = false) {
  const base = issueUrl(repository, number);
  const lines = [
    '# COMMENT TRACE',
    `<!-- programme-trace issue=${number} -->`,
    '**Comment trace** (generated from every comment on this issue). One line per topic; each number is a comment and opens it. Read the body first; within a topic, where comments disagree, the latest one wins. To put a comment under a topic, make its first line the topic (the task\'s name, or a short subject for a programme-wide comment) and its second line `---`.',
    '',
  ];
  const groups = traceGroups(trace, topic);
  for (const [at, directory] of (trace.directories || []).entries()) lines.push(`- [topic directory ${at + 1}](${commentLink(base, directory.id)})`);
  for (const group of groups) lines.push(`- **${groupLabel(group, topic)}:** ${traceTokens(group, base).join(' · ')}`);
  if (!groups.length && !trace.directories?.length) lines.push('- No comments yet.');
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
function renderCurrentBlockBody(parent, children, issues = new Map(), now = new Date().toISOString(), board = null) {
  const rows = graphOrder(parent, children, issues).map(outcome => ({ outcome, child: children.get(outcome.issue) }));
  const working = rows.filter(row => statusText(row.outcome, row.child) === 'IN PROGRESS').map(row => {
    const parts = [row.child.gate.role, row.child.pr.number ? `PR #${row.child.pr.number}` : null].filter(Boolean).join(', ');
    const wait = ownerWait(row.child);
    return `- ${taskName(row.outcome, issues.get(row.outcome.issue))} (#${row.outcome.issue})${parts ? `: ${parts}` : ''}${wait ? `; waiting on you: ${wait}` : ''}${row.child.next_action ? `; next: ${publicText(row.child.next_action)}` : ''}`;
  });
  // A task whose PR merged or whose issue closed is not picked, even before its state catches up.
  const next = rows.find(row => graphClass(row.outcome, row.child) === 'LATER' && row.child?.pr.state !== 'MERGED' && !issues.get(row.outcome.issue)?.closed_at);
  return [
    '# CURRENT',
    '<!-- programme-current -->',
    ...(board ? [board] : []),
    `_Generated from the programme state (revision ${parent.revision}). PROGRAMME GRAPH, AGENT CONTEXT and COMMENT TRACE follow._`,
    '',
    '**In progress**',
    ...(working.length ? working : ['- None.']),
    '',
    `**Start next:** ${next ? `${taskName(next.outcome, issues.get(next.outcome.issue))} (#${next.outcome.issue})` : 'None.'}`,
    '',
    ...attentionBlockLines(parent.attention, now),
  ].join('\n');
}

// The freshness line a page shows in its CURRENT block, or null.
function boardLineOf(body) {
  const current = findStateBlock(String(body || ''), CURRENT_BLOCK_NAME).block;
  return current?.body.split('\n').find(line => /^(?:Board updated: |⚠️ Board out of date |⚠️ Sweep stuck)/.test(line)) || null;
}

// The parent preview shows recent/acknowledged findings and a separate short waiting list.
// Waiting findings appear only once; the command keeps every finding and its full next action.
const ATTENTION_SHOWN = 10;
const WAITING_SHOWN = 5;
const WORK_QUEUE_SHOWN = 10;
function attentionBlockLines(attention, now) {
  const queue = workQueue(attention);
  const waiting = waitingFindings(attention, now).filter(entry => !WORK_QUEUE_CODES.has(entry.code));
  const waitingIds = new Set(waiting.map(entry => entry.id));
  const open = openFindings(attention).filter(entry => !waitingIds.has(entry.id) && !WORK_QUEUE_CODES.has(entry.code))
    .sort((a, b) => Number(b.code === 'PASS_STOPPED') - Number(a.code === 'PASS_STOPPED'));
  return [
    `**${attentionLine(attention, now)}**`,
    // Work-queue tasks come ahead of the newest-first window, longest stalled first, so stalled work is never pushed out by bookkeeping.
    ...(queue.length ? ['', '**Work queue** (the controller acts on each now)', ...queue.slice(0, WORK_QUEUE_SHOWN).map(entry => `- ${findingText(entry)}`),
      ...(queue.length > WORK_QUEUE_SHOWN ? [`- and ${queue.length - WORK_QUEUE_SHOWN} more: run programme.cjs attention`] : []), ''] : []),
    ...open.slice(0, ATTENTION_SHOWN).map(entry => `- ${entry.state === 'acknowledged' ? '(acknowledged) ' : ''}${findingText(entry)}`),
    ...(open.length > ATTENTION_SHOWN ? [`- and ${open.length - ATTENTION_SHOWN} more: run programme.cjs attention`] : []),
    ...(waiting.length ? ['', '**Waiting on you**', ...waiting.slice(0, WAITING_SHOWN).map(entry => `- ${entry.code}${entry.kind ? ` ${entry.kind === 'pr' ? 'PR' : 'issue'}` : ''}${entry.issue ? ` #${entry.issue}` : ''}${entry.head ? ` at ${shortSha(entry.head)}` : ''}`),
      ...(waiting.length > WAITING_SHOWN ? [`- and ${waiting.length - WAITING_SHOWN} more: run programme.cjs attention`] : [])] : []),
  ];
}

// The links that open a task page or PR: the programme parent, any expected parents in between,
// the task, then its PR. GitHub turns each #n into a link.
function renderNavBlockBody(chain, pr) {
  return ['# PATH', '<!-- programme-nav -->', `${chain.map(number => `#${number}`).join(' > ')}${pr ? ` > PR #${pr}` : ''}`].join('\n');
}

// The links block of a PR page: one path line per task the PR works on.
function renderPrNavBlockBody(chains, pr) {
  return ['# PATH', '<!-- programme-nav -->', ...chains.map(chain => `${chains.length > 1 ? '- ' : ''}${chain.map(number => `#${number}`).join(' > ')} > PR #${pr}`)].join('\n');
}

// The status block of a task page. Section headings generated or required by Toolkit are in
// capitals; a heading people add themselves keeps its own case.
function renderChildBlockBody(child, outcome) {
  const lines = [
    `<!-- programme-state child=${child.issue}@${child.revision} -->`,
    '# STATUS',
    '',
    `State revision ${child.revision} (issue-${child.issue}.json). Generated: edit the state document, not this block.`,
    '',
    `- Status: ${outcome ? statusText(outcome, child) : '-'}; class: ${graphClass(outcome, child)}; lane: ${outcome ? laneText(outcome, child) : '-'}; release: ${publicText(child.release || '-')}`,
    `- Task: ${outcome ? descriptionText(outcome) : '-'}`,
    `- Tracked PR: ${child.pr.number ? `#${child.pr.number} ${child.pr.state || ''}`.trim() : '-'}; head ${shaLink(child.repository, child.pr.head)}; CI at head: ${checksText(child)}`,
    `- UAT: ${uatText(child)}; review: ${reviewText(child)}`,
    `- Next action: ${publicText(child.next_action)}`,
  ];
  if (child.blockers.length) lines.push(`- Blockers: ${child.blockers.map(publicText).join('; ')}`);
  lines.push('', '**Pull requests** (every PR found for this task, open first)', ...prHistoryLines(child));
  return lines.join('\n');
}

// The status block of an open PR page: one line per task the PR works on, from that task's state.
// A review verdict counts only at the PR's present head.
function renderPrStatusBlockBody(pr, head, tasks) {
  const lines = [`<!-- programme-pr-status pr=${pr} -->`, '# STATUS', '', 'Generated from the programme state of each task this PR names.', ''];
  for (const { issue, child } of tasks) {
    if (!child) { lines.push(`- Task #${issue}: no state yet.`); continue; }
    const gate = [child.gate?.role, child.gate?.state].filter(Boolean).join(' ') || '-';
    const verdicts = child.review?.verdicts || [];
    const atHead = isSha(head) ? verdicts.filter(verdict => verdict.head === head) : [];
    const review = atHead.length ? `${atHead.map(verdict => publicText(verdict.verdict)).join(', ')} at ${shortSha(head)}`
      : verdicts.length ? 'none at this head (an earlier head was reviewed)' : child.review?.state ? publicText(child.review.state) : 'none yet';
    lines.push(`- Task #${issue}: gate ${publicText(gate)}; review ${review}; UAT ${publicText(child.uat?.state || '-')}; release ${publicText(child.release || '-')}`);
  }
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

// A body with every marker line that is only shown, not meant, blanked out: one inside a code
// fence, indented code, a quote, a list item or a literal HTML block. Offsets and line endings are
// unchanged, so a block found in the result sits at the same place in the body. Where a code block,
// HTML block or details section is never closed, the lines from its start on are left as they
// are: a real block down there would look quoted, and treating it as absent would add a second.
const shownMarkerCache = new Map();
function withoutShownMarkers(source) {
  if (!source.includes('AI-AGENT-TOOLKIT:')) return source;
  const known = shownMarkerCache.get(source);
  if (known !== undefined) return known;
  const { lines, unfinishedFrom } = pageLayout().markdownLines(source);
  const shown = line => !line.top && (unfinishedFrom === null || line.start < unfinishedFrom);
  let masked = source;
  if (lines.some(line => shown(line) && BLOCK_ANY.test(line.text))) {
    // A block is shown when its BEGIN line is: its END line goes with it wherever that sits.
    let closing = null;
    masked = lines.map(line => {
      const text = source.slice(line.start, line.end);
      if (!BLOCK_ANY.test(line.text)) return text;
      const marker = /:(BEGIN|END) ([A-Z]+)\b/.exec(line.text);
      const ends = closing && marker?.[1] === 'END' && marker[2] === closing;
      // A real BEGIN line means the example before it never showed its END: nothing is owed.
      if (!shown(line) && !ends) { if (marker?.[1] === 'BEGIN') closing = null; return text; }
      if (ends) closing = null;
      else if (marker?.[1] === 'BEGIN') closing = marker[2];
      return text.replace(/[^\r\n]/g, ' ');
    }).join('');
  }
  if (shownMarkerCache.size >= 32) shownMarkerCache.delete(shownMarkerCache.keys().next().value);
  shownMarkerCache.set(source, masked);
  return masked;
}

// The one block with this name in a body, with offsets; `error` for broken, nested or duplicated
// markers. Blocks with other names are skipped, and so is a block that is only shown as an example
// (see withoutShownMarkers). `literal` searches the text exactly as given.
function findStateBlock(text, name = BLOCK_NAME, { literal = false } = {}) {
  const source = literal ? String(text || '') : withoutShownMarkers(String(text || ''));
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

// The last check before a page is written: every block this pass writes must be found again, once
// and with the content just written, by the same search that reads the page on the next pass. A
// block that would not be found would be written again on every pass, so the page is held and
// nothing is written to it. `blocks` lists [name, block body] pairs; a pair without a body is
// skipped.
function assertBlocksReadBack(body, blocks, page) {
  for (const [name, expected] of blocks) {
    if (expected === null || expected === undefined) continue;
    const { block, error } = findStateBlock(body, name);
    if (error || !block || normalizeBlockBody(block.body) !== normalizeBlockBody(expected)) {
      throw new ProgrammeError('MANAGED_BLOCK_BROKEN', `${page}: the ${name} block cannot be written where the next pass would read it back`
        + `${error ? ` (${error})` : ''}, so nothing was written to this page. Look for a code block, comment, details section or other HTML block that is not closed, or a broken Toolkit marker line, fix it by hand, and the next pass writes the page`);
    }
  }
  return body;
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
  for (const name of [BLOCK_NAME, CURRENT_BLOCK_NAME, CONTEXT_BLOCK_NAME, NAV_BLOCK_NAME, TRACE_BLOCK_NAME]) {
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
  return `${source}${source ? source.endsWith(eol) ? eol : `${eol}${eol}` : ''}${block}${eol}`;
}

// The body with the CURRENT summary written: replaced in place, else added right under the heading
// of the named status section (else under the first title, else at the top).
function upsertCurrentBlock(text, rendered, sectionName) {
  const source = String(text || '');
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  const block = rendered.split('\n').join(eol);
  const { block: found, error } = findStateBlock(source, CURRENT_BLOCK_NAME);
  if (error) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', error);
  const all = headings(source);
  if (found) {
    // The only hand-written migration: one exact adjacent heading, with blank lines only.
    let before = source.slice(0, found.start);
    const adjacent = /^## CURRENT\r?\n(?=(?:[ \t]*\r?\n)*(?![\s\S]))/m.exec(before);
    if (adjacent && all.some(heading => heading.start === adjacent.index)) before = before.slice(0, adjacent.index) + before.slice(adjacent.index + adjacent[0].length);
    return before + block + source.slice(found.end);
  }
  const heading = (sectionName && all.find(entry => entry.text.toLowerCase() === String(sectionName).trim().toLowerCase())) || all.find(entry => entry.level === 1);
  const migrate = heading?.text === 'CURRENT' && heading.level === 2;
  const at = heading ? heading.end : 0;
  const before = migrate && /^## CURRENT\r?\n?$/.test(source.slice(heading.start, at)) ? source.slice(0, heading.start) : source.slice(0, at);
  return `${before}${eol}${block}${eol}${source.slice(at)}`;
}

// Bound rejection history without restoring adoption trust. Keep the registered id if
// rejected, plus the newest other ids, at most 32. A monotonic floor excludes dropped
// candidates. It cannot revoke an independently verified registered id, which was never
// rejected; once rejected that id is pinned in the explicit list until unregistered.
function rejectArchiveIds(entry, ids) {
  const rejected = [...new Set([...(entry.untrusted_ids || []), ...ids])].sort((a, b) => a - b);
  const kept = rejected.slice(-32);
  if (rejected.includes(entry.comment_id) && !kept.includes(entry.comment_id)) kept[0] = entry.comment_id;
  const dropped = rejected.filter(id => !kept.includes(id));
  if (dropped.length) entry.untrusted_before = Math.max(entry.untrusted_before || 0, dropped.at(-1));
  entry.untrusted_ids = kept.sort((a, b) => a - b);
}

function archiveUntrusted(entry, id) {
  return Boolean(entry.untrusted_ids?.includes(id)) || id !== entry.comment_id && id <= (entry.untrusted_before || 0);
}

function detachArchive(entry) {
  rejectArchiveIds(entry, [entry.comment_id]);
  entry.comment_id = null; entry.login = null; entry.state = 'pending';
}

// The parent's Agent context comments: every comment a person wrote whose first line is the topic
// "Agent context" (then `---`). Generated index and archive comments never count. A record ID in
// the text does not rule a comment out: background notes link to the records they explain.
const CONTEXT_TAG = 'AGENT CONTEXT';
function contextCommentIds(comments) {
  // Both modules are already loaded above; the extra names stay out of the pinned top-level requires.
  const { isBot } = require('./decision-trace-audit.cjs');
  const { commentTag, isArchiveComment } = require('./decision-tags.cjs');
  return (comments || []).filter(comment => !isBot(comment) && commentTag(comment.body) === CONTEXT_TAG && !isArchiveComment(comment.body)
    && ![INDEX_COMMENT_MARKER, DIRECTORY_COMMENT_MARKER].some(marker => String(comment.body).includes(marker))).map(comment => String(comment.id));
}

// The comment AGENT CONTEXT lists and COMMENT TRACE leaves out: the only match, else none.
function contextCommentId(comments) {
  const ids = contextCommentIds(comments);
  return ids.length === 1 ? ids[0] : null;
}

// A trace without the comment AGENT CONTEXT lists. A comment an index page already lists is not in
// `entries`, so that page keeps its line.
function withoutContextComment(trace, id) {
  return id ? { ...trace, entries: trace.entries.filter(entry => entry.id !== id) } : trace;
}

// The AGENT CONTEXT block. With one Agent context comment it links that comment; with more than one
// it holds, names them (the first five) and leaves them in COMMENT TRACE; with none it is the two
// fixed lines alone. `notes` are the archived note comments to list after it: [{ title, link }],
// oldest first.
const CONTEXT_NAMED = 5;
function renderContextBlockBody(number = null, comments = [], repository = '', notes = []) {
  const ids = contextCommentIds(comments);
  const link = id => `[${id}](${commentLink(issueUrl(repository, number), id)})`;
  return ['# AGENT CONTEXT', '<!-- programme-context -->',
    'Background for agents that pick up a task.',
    // The same length as the line it replaced, so size-tuned pages keep their headroom.
    'Toolkit moves only notes under one `## Archive` heading: unchanged, to linked comments shown here.',
    ...(ids.length === 1 ? ['', `- [Agent context](${commentLink(issueUrl(repository, number), ids[0])})`] : []),
    ...(ids.length > 1 ? ['', `- Held: ${ids.length} comments have "Agent context" as their topic, so none is listed here: ${ids.slice(0, CONTEXT_NAMED).map(link).join(' · ')}${ids.length > CONTEXT_NAMED ? ` and ${ids.length - CONTEXT_NAMED} more` : ''}. They stay in COMMENT TRACE. Keep that topic on one comment and the next redraw lists it here.`] : []),
    ...(notes.length ? ['', ...notes.map(note => `- [${note.title}](${note.link})`)] : []),
  ].join('\n');
}

// The calendar date in Singapore time (UTC+8), as the graph shows times.
function sgtDate(iso) { return new Date(Date.parse(iso) + 8 * 3600 * 1000).toISOString().slice(0, 10); }

function upsertContextBlock(source, rendered) {
  const found = findStateBlock(source, CONTEXT_BLOCK_NAME);
  if (found.error) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', found.error);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const block = rendered.replace(/\n/g, eol);
  const state = findStateBlock(source).block;
  if (found.block && state && found.block.start >= state.end && !source.slice(state.end, found.block.start).trim()) return source.slice(0, found.block.start) + block + source.slice(found.block.end);
  if (found.block) source = source.slice(0, found.block.start) + source.slice(found.block.end);
  const at = findStateBlock(source).block?.end || 0;
  return source.slice(0, at) + `${eol}${eol}${block}` + source.slice(at);
}

function upsertParentStateBlock(source, rendered, placement) {
  // Preserve the binding's explicit old-index migration while that section still exists.
  if (placement.replace_section && headings(source).some(entry => entry.text.toLowerCase() === placement.replace_section.toLowerCase())) return upsertStateBlock(source, rendered, placement);
  const found = findStateBlock(source);
  if (found.error) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', found.error);
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const block = rendered.replace(/\n/g, eol);
  const current = findStateBlock(source, CURRENT_BLOCK_NAME).block;
  if (found.block && current && found.block.start >= current.end && !source.slice(current.end, found.block.start).trim()) {
    return { body: source.slice(0, found.block.start) + block + source.slice(found.block.end), moved: false };
  }
  const rest = found.block ? source.slice(0, found.block.start) + source.slice(found.block.end) : source;
  const anchor = findStateBlock(rest, CURRENT_BLOCK_NAME).block;
  const at = anchor?.end ?? blockTarget(rest, placement).start;
  return { body: rest.slice(0, at) + `${eol}${eol}${block}` + (rest.slice(at).startsWith(eol) ? '' : eol) + rest.slice(at), moved: Boolean(found.block) };
}

// The body with the links block first: replaced in place, else added at the very top.
function upsertNavBlock(text, rendered) {
  const source = String(text || '');
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  const block = rendered.split('\n').join(eol);
  const { block: found, error } = findStateBlock(source, NAV_BLOCK_NAME);
  if (error) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', error);
  if (found) return source.slice(0, found.start) + block + source.slice(found.end);
  // Only blank lines are dropped at the join: the first line's own indent (an indented code line)
  // stays, so the text below reads the same as before.
  const after = trimStart(source);
  return `${block}${eol}${after ? `${eol}${after}` : ''}`;
}

// A PR description with its two generated blocks first: the links block at the very top and the
// status block right under it. Everything the author wrote stays below, byte for byte.
function upsertPrBlocks(text, nav, status) {
  let body = upsertNavBlock(text, nav);
  const eol = /\r\n/.test(body) ? '\r\n' : '\n';
  const block = status.split('\n').join(eol);
  const links = findStateBlock(body, NAV_BLOCK_NAME).block;
  const found = findStateBlock(body);
  if (found.error) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', found.error);
  if (found.block && found.block.start >= links.end && !body.slice(links.end, found.block.start).trim()) return body.slice(0, found.block.start) + block + body.slice(found.block.end);
  if (found.block) {
    const before = trimEnd(body.slice(0, found.block.start));
    const after = trimStart(body.slice(found.block.end));
    body = before && after ? `${before}${eol}${eol}${after}` : before || after;
  }
  const at = findStateBlock(body, NAV_BLOCK_NAME).block.end;
  const rest = trimStart(body.slice(at));
  return `${body.slice(0, at)}${eol}${eol}${block}${rest ? `${eol}${eol}${rest}` : eol}`;
}

// Index comment bodies for a topic's comment links, each under the comment size limit. The links
// sit on one line, separated by " · ", as in the body's trace. A topic's index comment carries the
// topic on its first line, so it stays in that topic's list; `label` is the topic as written (for
// an untopiced list, the task page's own name, which names the comment without tagging it).
function indexCommentBodies(number, links, intent, tag = null, label = null, directory = false) {
  const name = label || tag;
  const head = (part, total) => [...(tag ? [name, '---'] : []), INDEX_COMMENT_MARKER, ...(directory ? [DIRECTORY_COMMENT_MARKER] : []), `<!-- programme-trace intent=${intent} part=${part}/${total} -->`,
    directory ? '## Comment topics' : `## Comment trace for #${number}: ${publicText(name || OTHER_COMMENTS)}`, ''];
  const chunks = [[]];
  // Reserve the complete header, separators, final newline and generous part-number space.
  const overhead = head('9'.repeat(19), '9'.repeat(19)).join('\n').length + 2;
  const separator = directory ? '\n' : ' · ';
  // A topic with many older index pages may itself need several directory pages. Repeat its
  // label on each continuation, cutting only between complete comment links.
  const entries = directory ? links.flatMap(line => {
    if (overhead + line.length < INDEX_COMMENT_LIMIT) return [line];
    const match = /^(- \*\*.*?:\*\* )(.*)$/.exec(line);
    if (!match) throw new ProgrammeError('BODY_TOO_LARGE', 'A comment topic cannot fit in an index page.');
    const parts = [];
    let part = match[1];
    for (const token of match[2].split(' · ')) {
      const join = part === match[1] ? '' : ' · ';
      if (overhead + part.length + join.length + token.length >= INDEX_COMMENT_LIMIT) {
        parts.push(part);
        part = match[1];
      }
      part += `${part === match[1] ? '' : ' · '}${token}`;
    }
    parts.push(part);
    return parts;
  }) : links;
  let size = overhead;
  for (const link of entries) {
    if (overhead + link.length >= INDEX_COMMENT_LIMIT) throw new ProgrammeError('BODY_TOO_LARGE', 'A comment topic cannot fit in an index page.');
    if (size + link.length + separator.length >= INDEX_COMMENT_LIMIT && chunks.at(-1).length) { chunks.push([]); size = overhead; }
    chunks.at(-1).push(link);
    size += link.length + separator.length;
  }
  return chunks.map((chunk, at) => [...head(at + 1, chunks.length), chunk.join(separator), ''].join('\n'));
}

// Intents bind the exact page bytes, ignoring only their own derived intent ID. Old intents keep
// their part metadata support. A partial verified set is NOT_DONE, so the next plan pages only
// the uncovered links; a mismatched or duplicate page is UNKNOWN and holds instead of reposting.
function indexPageDigest(body) { return sha256(body.replace(/programme-trace intent=[a-f0-9]* /, 'programme-trace intent= ')); }
function indexReadback(comments, intent, parts = null) {
  const found = comments.filter(comment => String(comment.body || '').includes(`programme-trace intent=${intent} `));
  if (!parts) {
    if (!found.length) return false;
    const metadata = found.map(comment => /part=(\d+)\/(\d+)/.exec(comment.body));
    if (metadata.some(match => !match)) return null;
    const total = Number(metadata[0][2]);
    if (total < 1 || total > MAX_INDEX_COMMENTS || metadata.some(match => Number(match[2]) !== total || Number(match[1]) < 1 || Number(match[1]) > total)
      || new Set(metadata.map(match => Number(match[1]))).size !== found.length) return null;
    return found.length === total;
  }
  if (!Array.isArray(parts) || !parts.length || parts.some(part => !/^[a-f0-9]{64}$/.test(part))) return null;
  const remaining = [...parts];
  for (const comment of found) {
    const at = remaining.indexOf(indexPageDigest(String(comment.body)));
    if (at === -1) return null;
    remaining.splice(at, 1);
  }
  return remaining.length === 0;
}

function indexEffect(number, part, after) {
  const bodies = indexCommentBodies(number, part.lines, '0'.repeat(16), part.tag, part.label, part.directory);
  const target = { issue: number, tag: part.tag, after, ...(part.directory ? { directory: true } : {}), parts: bodies.map(indexPageDigest) };
  return { kind: 'post_index_comment', target, label: part.label, lines: part.lines };
}

// Top-level headings with original line offsets: the same reading of the page the block search
// uses (see withoutShownMarkers), so a block placed at a heading is always found again. A `#` line
// inside a code block, an HTML comment, a details section or another HTML block is no heading.
function headings(text) {
  const found = [];
  for (const line of pageLayout().markdownLines(text).lines) {
    const heading = line.top && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line.text);
    if (heading) found.push({ level: heading[1].length, text: heading[2].trim(), start: line.start, end: line.end });
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
  // A heading a generated block prints (PATH, STATUS, COMMENT TRACE) is not a page title.
  const real = withoutShownMarkers(text);
  const spans = [...real.matchAll(new RegExp(`^<!-- AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:BEGIN ([A-Z]+) [^\\n]*-->\\r?\\n[\\s\\S]*?^<!-- AI-AGENT-TOOLKIT:${BLOCK_SOURCE}:END \\1 -->`, 'gm'))]
    .map(match => [match.index, match.index + match[0].length]);
  const all = headings(text).filter(entry => !spans.some(([from, to]) => entry.start > from && entry.start < to));
  // A section ends at the next heading of its level or higher, or at the next managed block, so a
  // last section never runs into the comment trace or the text after it.
  const markers = [...real.matchAll(/^<!-- AI-AGENT-TOOLKIT:/gm)].map(match => match.index);
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
const STOPS_PASS = new Set(['STALE_WRITER', 'PASS_LOCK_LOST', 'PASS_STOPPED', 'SWEEP_STOP']);
// Requests per pass for the changed-issues list; a longer list carries on next pass from its cursor.
const CHANGED_PAGES = 10;
// A runaway guard on one PR list (100 PRs a page), far above any real repository; the pass's own
// request budget is what normally bounds it.
const LIST_PAGE_GUARD = 1000;
// PR discovery's own budget: a fixed part for the PR lists' detail reads and the parent, plus one
// request for each batch of twenty task links and two for each task read this pass (an older PR to
// reconfirm and a merge to confirm). It grows with the board, so a large board never fails discovery
// on a fixed number; the list pages themselves count only against the pass's request budget.
const DISCOVERY_BASE = 60;
const discoveryBudget = (tasks, scoped = tasks) => DISCOVERY_BASE + Math.ceil(Math.max(0, tasks) / 20) + 2 * Math.max(0, scoped);

class GitHubTransport {
  // `env`, when given, is the whole environment of every gh call (the cloud sweep's own token).
  constructor({ ghPath, run = spawnSync, timeoutMs = 120000, env = null }) {
    if (!ghPath) throw new ProgrammeError('EXECUTABLE_NOT_FOUND', 'GitHubTransport needs the full path to gh.');
    this.ghPath = ghPath;
    this.run = run;
    this.timeoutMs = timeoutMs;
    this.env = env;
  }

  request(method, apiPath, body, { timeoutMs = this.timeoutMs } = {}) {
    const args = ['api', '-i', '-X', method, apiPath, '-H', 'Accept: application/vnd.github+json'];
    if (body !== undefined) args.push('--input', '-');
    const result = this.run(this.ghPath, args, {
      encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body),
      maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: Math.max(1, Math.floor(Math.min(this.timeoutMs, timeoutMs))),
      ...(this.env ? { env: this.env } : {}),
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
    const headers = Object.fromEntries(rest.slice(0, split === -1 ? rest.length : split).split(/\r?\n/).slice(1)
      .map(line => /^([^:]+):\s*(.*)$/.exec(line)).filter(Boolean).map(match => [match[1].toLowerCase(), match[2].trim()]));
    // The rate-limit headers ride along for the sweep's request budget without changing the answer
    // every other caller compares, prints or stores.
    return Object.defineProperty({ status: Number(last[1]), json }, 'headers', { value: headers, enumerable: false });
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
const PAGE_COPY_SCHEMA = 'toolkit.programme-page-copy.v1';
function assertPageCopy(doc) {
  if (!isObject(doc) || doc.schema !== PAGE_COPY_SCHEMA || !isInt(doc.issue, 1) || typeof doc.body !== 'string' || doc.sha256 !== sha256(doc.body)) {
    throw new ProgrammeError('STATE_INVALID', 'A saved page copy is not readable as written.');
  }
  return doc;
}

// An existing document is replaced only against the exact version that was read. A read that
// came back without a usable blob id cannot prove that version, so nothing is requested.
const DOCUMENT_FILE = /^(parent|issue)-([1-9][0-9]*)\.json$/;
const SWEEP_RECORD_FILE = 'sweep-lease.json';
const SWEEP_RECORD_SCHEMA = 'toolkit.programme-sweep-lease.v1';
// The sweep's recent passes, beside the lease: when each ended, how many tasks it read, how many it
// left and whether it finished. Only the board's stuck note reads it.
const SWEEP_HISTORY_FILE = 'sweep-history.json';
const SWEEP_HISTORY_SCHEMA = 'toolkit.programme-sweep-history.v1';
const SWEEP_STOP_REASONS = ['time limit', 'request cap', 'GitHub rate limit', 'state branch busy', 'GitHub GraphQL unavailable', 'tasks still to check', 'an incomplete read',
  'another pass took over', 'a GitHub request failed', 'an error'];

// The record both sweep routes share in the private store: who holds the sweep now (with its
// progress, so a killed run is reported), the pass count the rotation runs on, when a pass last
// started and last finished, and a stop the state could not hold.
function validateSweepRecord(doc) {
  const errors = [];
  const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const diagnostics = (value, at) => { if (value !== null) validatePassDiagnostics(errors, value, at); };
  check(errors, isObject(doc), 'the sweep record must be an object');
  if (isObject(doc)) {
    checkShape(errors, doc, { all: ['schema', 'repository', 'holder', 'pass', 'changed_since', 'last_complete_at', 'stopped_passes', 'reason', 'unreported', 'streaks'] }, 'sweep record');
    check(errors, doc.schema === SWEEP_RECORD_SCHEMA && REPO.test(doc.repository || ''), 'the sweep record names its schema and repository');
    check(errors, doc.holder === null || isObject(doc.holder) && /^[0-9a-f]{32}$/.test(doc.holder.nonce || '') && ['computer', 'cloud'].includes(doc.holder.host)
      && time(doc.holder.expires_at) && Object.keys(doc.holder).sort().join(',') === 'expires_at,host,nonce,progress', 'the sweep record holder is invalid');
    if (isObject(doc.holder)) diagnostics({ cause: 'interrupted', ...doc.holder.progress }, 'sweep record progress');
    check(errors, isInt(doc.pass) && isInt(doc.stopped_passes), 'the sweep record counts must be whole numbers');
    check(errors, [doc.changed_since, doc.last_complete_at].every(value => value === null || time(value)), 'the sweep record times must be dates or null');
    check(errors, doc.reason === null || SWEEP_STOP_REASONS.includes(doc.reason), 'the sweep record reason must be a known stop reason');
    if (doc.unreported !== null) diagnostics(doc.unreported, 'sweep record stop');
    check(errors, isObject(doc.streaks) && Object.keys(doc.streaks).sort().join(',') === 'busy,graphql' && isInt(doc.streaks.busy) && isInt(doc.streaks.graphql), 'the sweep record streaks are invalid');
  }
  if (errors.length) throw new ProgrammeError('STATE_INVALID', `The sweep record is invalid: ${errors[0]}.`);
  return doc;
}

function validateSweepHistory(doc) {
  const errors = [];
  const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  check(errors, isObject(doc), 'the sweep history must be an object');
  if (isObject(doc)) {
    checkShape(errors, doc, { all: ['schema', 'repository', 'started_at', 'passes'] }, 'sweep history');
    check(errors, doc.schema === SWEEP_HISTORY_SCHEMA && REPO.test(doc.repository || '') && time(doc.started_at), 'the sweep history names its schema, repository and start');
    check(errors, Array.isArray(doc.passes) && doc.passes.length <= 200 && doc.passes.every(entry => isObject(entry)
      && Object.keys(entry).sort().join(',') === 'at,complete,left,read' && time(entry.at) && isInt(entry.read)
      && (entry.left === null || isInt(entry.left)) && typeof entry.complete === 'boolean'), 'the sweep history passes are invalid');
  }
  if (errors.length) throw new ProgrammeError('STATE_INVALID', `The sweep history is invalid: ${errors[0]}.`);
  return doc;
}

function requireVersionToken(sha, docPath) {
  if (typeof sha === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) return;
  throw new ProgrammeError('STATE_TOKEN_MISSING', `${docPath} was read without its version id, so it was not replaced. Nothing was written; run refresh again.`);
}

class StateStore {
  // `installationWrite` is true only for the cloud sweep, whose store token is a GitHub App
  // installation token the workflow minted with Contents write for this one store.
  constructor({ transport, store, now = () => new Date().toISOString(), toolkitVersion = null, installationWrite = false }) {
    this.transport = transport;
    this.store = store;
    this.installationWrite = installationWrite === true;
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
  // A signed-in account's read shows its push access. An App installation token's read does not
  // reliably show the token's own access (it may omit `permissions` or report every value false), so
  // the cloud sweep skips that one check: its workflow minted the token with Contents write for this
  // one store, and the sweep lease's write, which comes before any state is saved, proves it.
  verify() {
    const repo = this.transport.request('GET', `repos/${this.store.repository}`);
    const writable = this.installationWrite || repo.json?.permissions?.push === true;
    const reason = repo.status !== 200 ? `it could not be read (${repo.status})`
      : repo.json.private !== true ? 'it is not private'
        : !writable ? 'this account cannot write to it' : null;
    if (reason) throw new ProgrammeError('STATE_STORE_UNVERIFIED', `The state store ${this.store.repository} was not used because ${reason}. Choose a private repository you can write to in .github/toolkit-programme.json.`);
    const branch = this.transport.request('GET', `repos/${this.store.repository}/branches/${encodeURIComponent(this.store.branch)}`);
    if (branch.status !== 200) throw new ProgrammeError('STATE_STORE_UNVERIFIED', `The state store branch ${this.store.branch} could not be read (${branch.status}).`);
    return true;
  }

  read(kind, number) {
    return this.readPath(this.docPath(kind, number), kind);
  }

  // The state directory at one commit: every file's text and blob id. GraphQL reads it in one
  // request. When GitHub refuses GraphQL, one REST listing plus one blob read per document is used
  // instead, inside the same request budget; the caller learns which route ran (`mode`).
  readTree(ref) {
    const dir = this.store.path.replace(/\/$/, '');
    const [owner, name] = this.store.repository.split('/');
    const response = this.transport.request('POST', 'graphql', {
      query: 'query stateSnapshot($owner:String!,$name:String!,$directory:String!){repository(owner:$owner,name:$name){snapshot:object(expression:$directory){... on Tree{entries{name oid type object{... on Blob{text isTruncated}}}}}}}',
      variables: { owner, name, directory: `${ref}:${dir}` },
    });
    if (response.status === 401) throw new ProgrammeError('GH_AUTH', 'GitHub rejected the sign-in.');
    const repo = response.json?.data?.repository;
    if (response.status === 200 && !response.json?.errors?.length && repo) {
      this.graphqlRefused = false;
      const files = new Map();
      for (const entry of repo.snapshot?.entries || []) {
        if (entry.type !== 'blob') continue;
        const truncated = entry.object?.isTruncated || typeof entry.object?.text !== 'string';
        files.set(entry.name, { text: truncated ? null : entry.object.text, sha: entry.oid || null });
      }
      return { files, mode: 'graphql' };
    }
    this.graphqlRefused = true;
    const listing = this.transport.request('GET', `${this.encodedContents(dir)}?ref=${encodeURIComponent(ref)}`);
    if (listing.status === 404) return { files: new Map(), mode: 'rest' };
    if (listing.status !== 200 || !Array.isArray(listing.json)) throw ghFailure(listing, `Listing ${dir}`);
    const wanted = listing.json.filter(entry => entry?.type === 'file' && DOCUMENT_FILE.test(String(entry.name)));
    const others = listing.json.filter(entry => entry?.type === 'file' && !DOCUMENT_FILE.test(String(entry.name)));
    // Reading every blob must still leave the settlement reserve; otherwise stop before any write.
    if (typeof this.transport.left === 'function' && this.transport.left() < wanted.length + (this.transport.reserve || 0)) {
      throw Object.assign(new ProgrammeError('PASS_STOPPED', 'GitHub refused GraphQL and the state documents cannot be read one by one within this pass.'), { reason: 'GitHub GraphQL unavailable', noWrite: true });
    }
    const files = new Map(others.map(entry => [entry.name, { text: null, sha: isSha(entry.sha) ? entry.sha : null }]));
    for (const entry of wanted) {
      if (!isSha(entry.sha)) { files.set(entry.name, { text: null, sha: null }); continue; }
      const blob = this.transport.request('GET', `repos/${this.store.repository}/git/blobs/${entry.sha}`);
      if (blob.status !== 200 || blob.json?.encoding !== 'base64') throw ghFailure(blob, `Reading ${dir}/${entry.name}`);
      files.set(entry.name, { text: Buffer.from(blob.json.content, 'base64').toString('utf8'), sha: entry.sha });
    }
    return { files, mode: 'rest' };
  }

  // Every parent and child document at the branch head, each with its own blob id: the version its
  // compare-and-swap checks. A document that cannot be used holds only when it is read.
  readSnapshot() {
    const branch = this.transport.request('GET', `repos/${this.store.repository}/branches/${encodeURIComponent(this.store.branch)}`);
    if (branch.status !== 200) throw ghFailure(branch, `Reading the state branch ${this.store.branch}`);
    const head = branch.json?.commit?.sha;
    const tree = branch.json?.commit?.commit?.tree?.sha;
    if (!isSha(head) || !isSha(tree)) throw new ProgrammeError('STATE_STORE_UNVERIFIED', `The state branch ${this.store.branch} head could not be read.`);
    const { files, mode } = this.readTree(head);
    const documents = new Map();
    for (const [file, entry] of files) {
      const match = DOCUMENT_FILE.exec(file);
      if (!match) continue;
      const kind = match[1] === 'parent' ? 'parent' : 'child';
      const docPath = this.docPath(kind, Number(match[2]));
      let value;
      try {
        if (entry.text === null) throw new ProgrammeError('STATE_INVALID', `${docPath} could not be read in full.`);
        let doc;
        try { doc = JSON.parse(entry.text); } catch { throw new ProgrammeError('STATE_INVALID', `${docPath} is not valid JSON.`); }
        value = { doc: this.validateRead(kind, doc), sha: entry.sha, text: entry.text };
      } catch (error) {
        if (!error.code) throw error;
        value = { error };
      }
      documents.set(`${kind}:${Number(match[2])}`, value);
    }
    return { head, tree, mode, documents, files };
  }

  // Where the sweep's shared record (its lease) lives.
  sweepRecordPath() { return `${this.store.path}${SWEEP_RECORD_FILE}`; }
  sweepHistoryPath() { return `${this.store.path}${SWEEP_HISTORY_FILE}`; }
  // The documents as they stand now: the earlier snapshot when the branch has not moved since.
  currentSnapshot(earlier) {
    const branch = this.transport.request('GET', `repos/${this.store.repository}/branches/${encodeURIComponent(this.store.branch)}`);
    if (branch.status === 200 && earlier?.head && branch.json?.commit?.sha === earlier.head) return earlier;
    return this.readSnapshot();
  }

  // A document of a snapshot, as read() returns it: { doc, sha }, or the error that holds it.
  snapshotDoc(snapshot, kind, number) {
    const entry = snapshot.documents.get(`${kind}:${number}`);
    if (!entry) return { doc: null, sha: null };
    if (entry.error) throw entry.error;
    return { doc: clone(entry.doc), sha: entry.sha };
  }

  // The bytes a document is stored as (a public view on a public state branch).
  storedText(kind, doc) { return canonicalText(doc); }
  beforeBatch() {}
  afterBatch() {}

  // The state phase of a pass in one commit: every changed document, each built on the version it
  // was read at, published by one non-forced ref update from the snapshot head. A ref race re-runs
  // the staged changes on a fresh snapshot once (`rerun`); a second race stops the pass. A reply
  // lost after the ref update is settled by reading the branch head before anything else runs.
  commitBatch(batch, { message = 'programme state: pass' } = {}) {
    // The sweep lease's commit window: it closes when this returns or throws, with the lease entry
    // that landed, or unsure when a write request went out and its outcome was not confirmed.
    let committed = null;
    let unsure = false;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const documents = batch.prepare(this);
        if (!documents.length) return { written: [], head: batch.snapshot.head };
        // The sweep's progress and renewed expiry ride the commit (or are written beside it), rebuilt
        // on every attempt from the version the lease holds.
        const lease = batch.lease ? batch.lease.entry(batch.snapshot) : null;
        const written = [...documents, ...(lease ? [{ ...lease, kind: 'lease' }] : [])];
        this.beforeBatch(written);
        const tree = this.transport.request('POST', `repos/${this.store.repository}/git/trees`, { base_tree: batch.snapshot.tree,
          tree: written.map(entry => ({ path: entry.path, mode: '100644', type: 'blob', content: entry.text })) });
        if (!okStatus(tree.status) || !isSha(tree.json?.sha)) throw ghFailure(tree, 'Writing the state tree');
        const lines = documents.map(entry => `${documentName(entry.kind, entry.number)} r${entry.doc.revision}`);
        const commit = this.transport.request('POST', `repos/${this.store.repository}/git/commits`, { message: `${message}: ${lines.join(', ')} [skip ci]`, tree: tree.json.sha, parents: [batch.snapshot.head] });
        if (!okStatus(commit.status) || !isSha(commit.json?.sha)) throw ghFailure(commit, 'Writing the state commit');
        // Only the ref update can land this commit: until it is confirmed, the outcome is unsure.
        unsure = true;
        const outcome = this.moveBranch(batch.snapshot.head, commit.json.sha);
        if (outcome === 'MOVED') {
          this.readBack(commit.json.sha, written, tree.json);
          unsure = false;
          committed = written.find(entry => entry.kind === 'lease')?.blob || null;
          this.writes += documents.length;
          this.lastCommit = commit.json.sha;
          for (const entry of documents) this.ownWrites.set(entry.path, { replaced: entry.sha, doc: clone(entry.stored), sha: entry.blob });
          this.afterBatch(documents, commit.json.sha);
          batch.committed(documents, commit.json.sha);
          return { written: documents, head: commit.json.sha };
        }
        // RACED: another writer moved the branch, so this attempt changed nothing. Re-read and
        // re-run every staged change once.
        unsure = false;
        if (attempt === 0) batch.rerun(this.readSnapshot(), this);
      }
      throw Object.assign(new ProgrammeError('STATE_BRANCH_BUSY', 'The state branch moved twice while this pass was saving; nothing was written and the queue is unchanged.'), { reason: 'state branch busy' });
    } finally {
      batch.lease?.close({ committed, unsure });
    }
  }

  // MOVED or RACED. A lost reply is decided from the branch head: ours is accepted, the old head is
  // retried once, anything else is compared; if none of that can be read, GH_FAILED and no effect runs.
  moveBranch(from, to) {
    const ref = `repos/${this.store.repository}/git/refs/heads/${encodeURIComponent(this.store.branch)}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const moved = this.transport.request('PATCH', ref, { sha: to, force: false });
      if (okStatus(moved.status)) return 'MOVED';
      if ([409, 422].includes(moved.status)) return 'RACED';
      const head = this.transport.request('GET', `repos/${this.store.repository}/branches/${encodeURIComponent(this.store.branch)}`);
      const sha = head.status === 200 ? head.json?.commit?.sha : null;
      if (!isSha(sha)) throw new ProgrammeError('GH_FAILED', 'The state branch update got no reply and the branch head could not be read, so nothing else ran. Run refresh again.', { status: moved.status });
      if (sha === to) return 'MOVED';
      if (sha === from) continue;
      const compare = this.transport.request('GET', `repos/${this.store.repository}/compare/${to}...${sha}`);
      if (compare.status !== 200 || !['ahead', 'identical', 'behind', 'diverged'].includes(compare.json?.status)) {
        throw new ProgrammeError('GH_FAILED', 'The state branch update got no reply and its outcome could not be read, so nothing else ran. Run refresh again.', { status: moved.status });
      }
      return ['ahead', 'identical'].includes(compare.json.status) ? 'MOVED' : 'RACED';
    }
    throw new ProgrammeError('GH_FAILED', 'The state branch update got no reply twice, so nothing else ran. Run refresh again.');
  }

  // The new commit must hold exactly what was written: every text by GraphQL, or, when GraphQL is
  // refused, every blob id GitHub returned for the created tree (no local hash is computed).
  readBack(commitSha, written, tree) {
    const { files, mode } = this.readTree(commitSha);
    for (const entry of written) {
      const name = entry.path.slice(this.store.path.length);
      const found = files.get(name);
      const expected = mode === 'rest' ? (tree.tree || []).find(item => item.path === entry.path)?.sha : null;
      if (!found || (mode === 'graphql' ? found.text !== entry.text : !isSha(expected) || found.sha !== expected)) {
        throw new ProgrammeError('STATE_READBACK_MISMATCH', `${entry.path} did not read back as written in the state commit.`);
      }
      entry.blob = found.sha;
    }
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
    let content = response.json.content;
    if (response.json.encoding !== 'base64') {
      // The Contents API leaves out the text of a file over 1 MB (encoding "none"); it is then read
      // whole by its blob id, which the Git Data API serves up to 100 MB.
      if (!isSha(response.json.sha)) throw new ProgrammeError('STATE_INVALID', `${docPath} is too large to read through the Contents API.`);
      const blob = this.transport.request('GET', `repos/${this.store.repository}/git/blobs/${response.json.sha}`);
      if (blob.status !== 200 || blob.json?.encoding !== 'base64') throw ghFailure(blob, `Reading ${docPath}`);
      content = blob.json.content;
    }
    let doc;
    try { doc = JSON.parse(Buffer.from(content, 'base64').toString('utf8')); }
    catch { throw new ProgrammeError('STATE_INVALID', `${docPath} is not valid JSON.`); }
    return { doc: this.validateRead(kind, doc), sha: response.json.sha };
  }

  // State documents and journals, or a public state branch's sidecars and checkpoint.
  validateRead(kind, doc) {
    if (kind === 'sweep_record') return validateSweepRecord(doc);
    if (kind === 'sweep_history') return validateSweepHistory(doc);
    if (kind === 'sidecar') return assertSidecar(doc);
    if (kind === 'checkpoint') return assertCheckpoint(doc);
    if (kind === 'page_copy') return assertPageCopy(doc);
    return assertValid(kind, doc);
  }

  // The whole page as it stood, kept in the private store before marked notes can leave it. The
  // file is named by its content, so a retry finds the same file. It is read back before use, and a
  // store that is not private, or text shaped like a secret, saves nothing.
  noteCopyPath(issue, digest) { return `${this.store.path}page-copies/issue-${issue}/${digest}.md`; }

  saveNoteCopy(issue, text) {
    if (secretShaped(text)) throw new ProgrammeError('PAGE_COPY_REFUSED', 'The page holds text shaped like a secret, so no copy was saved and nothing was moved.');
    const repo = this.transport.request('GET', `repos/${this.store.repository}`);
    if (repo.status !== 200) throw ghFailure(repo, 'Reading the private store');
    if (repo.json?.private !== true) throw new ProgrammeError('STORE_NOT_PRIVATE', `The store ${this.store.repository} is not private, so no page copy was saved and nothing was moved.`);
    const digest = sha256(text);
    const docPath = this.noteCopyPath(issue, digest);
    const decoded = response => (response.json?.encoding === 'base64' ? Buffer.from(response.json.content, 'base64').toString('utf8') : null);
    const existing = this.transport.request('GET', `${this.encodedContents(docPath)}?ref=${encodeURIComponent(this.store.branch)}`);
    if (existing.status === 200) {
      if (decoded(existing) !== text) throw new ProgrammeError('STATE_READBACK_MISMATCH', `${docPath} exists with other content.`);
      return { digest, path: docPath, outcome: 'EXISTS' };
    }
    if (existing.status !== 404) throw ghFailure(existing, `Reading ${docPath}`);
    const response = this.transport.request('PUT', this.encodedContents(docPath), {
      message: `programme page copy: issue-${issue} ${digest.slice(0, 12)}`, content: Buffer.from(text, 'utf8').toString('base64'), branch: this.store.branch,
    });
    if (!okStatus(response.status)) throw ghFailure(response, `Writing ${docPath}`);
    this.writes += 1;
    const commit = response.json?.commit?.sha;
    const readback = commit ? this.transport.request('GET', `${this.encodedContents(docPath)}?ref=${encodeURIComponent(commit)}`) : null;
    if (!readback || readback.status !== 200 || decoded(readback) !== text) throw new ProgrammeError('STATE_READBACK_MISMATCH', `${docPath} did not read back as written.`);
    return { digest, path: docPath, outcome: 'WRITTEN' };
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

  // A copy of a page as it was before a write that moves hand-written text, kept in the private
  // store under the page's own digest and read back. Saving the same page twice writes once.
  pageCopyPath(number, digest) { return `${this.store.path}page-copies/issue-${number}-${digest.slice(0, 16)}.json`; }

  savePageCopy(number, page) {
    const digest = sha256(page.body);
    const file = this.pageCopyPath(number, digest);
    const existing = this.readPath(file, 'page_copy');
    if (existing.doc) {
      if (existing.doc.issue !== number || existing.doc.body !== page.body) throw new ProgrammeError('STATE_CONFLICT', `${file} holds a different page.`);
      return { outcome: 'NOOP', path: file };
    }
    const doc = { schema: PAGE_COPY_SCHEMA, issue: number, sha256: digest, updated_at: page.updated_at || null, saved_at: this.now(), body: page.body };
    this.putVerified(file, 'page_copy', canonicalText(doc), null, `programme page copy: issue-${number}`);
    return { outcome: 'WRITTEN', path: file };
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
    if (previous) requireVersionToken(sha, this.docPath(kind, number));
    const doc = clone(next);
    if (kind === 'child' && doc.schema === SCHEMA.child) { doc.schema = SCHEMA.childV2; if (doc.prs === undefined) doc.prs = []; }
    doc.revision = previous ? previous.revision + (contentDigest(previous) === contentDigest(doc) ? 0 : 1) : Math.max(1, doc.revision || 0);
    doc.volatile = { written_at: this.now(), ...(this.toolkitVersion ? { toolkit: this.toolkitVersion } : {}) };
    assertValid(kind, doc);
    return this.putVerified(this.docPath(kind, number), kind, canonicalText(doc), sha,
      `programme state: ${kind === 'parent' ? 'parent' : 'issue'}-${number} revision ${doc.revision}`);
  }

  // Read, authorise, change and write with compare-and-swap. On a conflict the change is re-applied
  // to the new version only when the other writer touched different top-level fields and the fence
  // did not move; otherwise STATE_CONFLICT or STALE_WRITER. Each change sees the exact write input
  // and whether it came from create defaults. onConflict may classify a refusal using the conflict
  // read, but returning from it never permits a refused CAS to write.
  mutate(kind, number, { writer, parentDoc = null, change, create = null, authorise = true, onConflict = null }) {
    let { doc: base, sha } = this.read(kind, number);
    if (!base && create) base = null;
    else if (!base) throw new ProgrammeError('STATE_MISSING', `${this.docPath(kind, number)} does not exist yet.`);
    const origin = base;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (authorise) authoriseWrite(kind, base, kind === 'parent' ? null : parentDoc, writer);
      const start = base || create();
      const next = change(clone(start), { created: base === null });
      if (!next) return { outcome: 'NOOP', doc: base, sha };
      try {
        return this.write(kind, number, next, { sha, previous: base });
      } catch (error) {
        if (error.code !== 'STATE_CONFLICT') throw error;
        const fresh = this.read(kind, number);
        if (!fresh.doc) {
          if (onConflict) onConflict(null, { created: false });
          throw error;
        }
        if (origin && (fresh.doc.fence.epoch !== origin.fence.epoch || fresh.doc.fence.holder_session !== origin.fence.holder_session)) {
          throw new ProgrammeError('STALE_WRITER', `${this.docPath(kind, number)} is now held by the ${holderDescription(fresh.doc, kind, parentDoc)}; this write was refused.`);
        }
        const touched = Object.keys({ ...start, ...next }).filter(key => key !== 'revision' && key !== 'volatile'
          && JSON.stringify(canonical(start[key])) !== JSON.stringify(canonical(next[key])));
        const theirs = Object.keys({ ...(origin || {}), ...fresh.doc }).filter(key => key !== 'revision' && key !== 'volatile'
          && JSON.stringify(canonical(origin?.[key])) !== JSON.stringify(canonical(fresh.doc[key])));
        const overlap = touched.filter(key => theirs.includes(key));
        if (!origin || overlap.length) {
          if (onConflict) onConflict(clone(fresh.doc), { created: false });
          throw new ProgrammeError('STATE_CONFLICT', `${this.docPath(kind, number)} was changed by another writer in ${overlap.join(', ') || 'the same fields'}; held for the controller.`);
        }
        base = fresh.doc;
        sha = fresh.sha;
      }
    }
    if (onConflict) onConflict(clone(base), { created: false });
    throw new ProgrammeError('STATE_CONFLICT', `${this.docPath(kind, number)} kept moving; held for the controller.`);
  }
}

// The documents of one pass at one snapshot. read() returns staged versions; mutate() stages a change
// with the same authorisation and callbacks StateStore.mutate uses, and nothing reaches GitHub until
// StateStore.commitBatch publishes every staged document in one commit. On a ref race the staged
// changes are run again on the fresh documents, with the same conflict rule as the per-document
// compare-and-swap: a document whose own fields another writer changed is dropped and held alone.
class StateBatch {
  constructor(store, snapshot, parentNumber) {
    this.store = store;
    this.snapshot = snapshot;
    this.parentNumber = parentNumber;
    this.entries = new Map();
    this.dropped = new Map();
    this.written = [];
    this.head = null;
    // The sweep lease's commit window, when a sweep holds one: { entry(snapshot), close(outcome) }.
    this.lease = null;
  }

  read(kind, number) {
    const key = `${kind}:${number}`;
    if (this.dropped.has(key)) throw this.dropped.get(key);
    const entry = this.entries.get(key);
    if (entry) return { doc: entry.doc ? clone(entry.doc) : null, sha: entry.sha };
    return this.store.snapshotDoc(this.snapshot, kind, number);
  }

  parent() { return this.read('parent', this.parentNumber).doc; }

  run(entry, current, op) {
    if (op.authorise) authoriseWrite(entry.kind, current, entry.kind === 'parent' ? null : this.parent(), op.writer);
    const start = current || op.create();
    const next = op.change(clone(start), { created: current === null });
    return next ? clone(next) : null;
  }

  mutate(kind, number, { writer, change, create = null, authorise = true, onConflict = null }) {
    const key = `${kind}:${number}`;
    if (this.dropped.has(key)) throw this.dropped.get(key);
    let entry = this.entries.get(key);
    if (!entry) {
      const { doc, sha } = this.store.snapshotDoc(this.snapshot, kind, number);
      if (!doc && !create) throw new ProgrammeError('STATE_MISSING', `${this.store.docPath(kind, number)} does not exist yet.`);
      // Before staging: a document read without its version id is never replaced.
      if (doc) requireVersionToken(sha, this.store.docPath(kind, number));
      entry = { kind, number, base: doc, sha, doc, ops: [] };
    }
    const op = { writer, change, create, authorise, onConflict };
    const next = this.run(entry, entry.doc, op);
    if (!next) return { outcome: 'NOOP', doc: entry.doc ? clone(entry.doc) : null, sha: entry.sha };
    entry.doc = next;
    entry.ops.push(op);
    this.entries.set(key, entry);
    return { outcome: 'STAGED', doc: clone(next), sha: entry.sha };
  }

  drop(entry, error) {
    this.dropped.set(`${entry.kind}:${entry.number}`, error);
    this.entries.delete(`${entry.kind}:${entry.number}`);
  }

  // The documents to write, each built on the version it was staged from.
  prepare(store) {
    const written = [];
    for (const entry of this.entries.values()) {
      if (!entry.doc || (entry.base && sameState(entry.base, entry.doc))) continue;
      const doc = clone(entry.doc);
      if (entry.kind === 'child' && doc.schema === SCHEMA.child) { doc.schema = SCHEMA.childV2; if (doc.prs === undefined) doc.prs = []; }
      doc.revision = entry.base ? entry.base.revision + (contentDigest(entry.base) === contentDigest(doc) ? 0 : 1) : Math.max(1, doc.revision || 0);
      doc.volatile = { written_at: store.now(), ...(store.toolkitVersion ? { toolkit: store.toolkitVersion } : {}) };
      assertValid(entry.kind, doc);
      const text = store.storedText(entry.kind, doc);
      written.push({ kind: entry.kind, number: entry.number, path: store.docPath(entry.kind, entry.number), sha: entry.sha, previous: entry.base, doc, text, stored: JSON.parse(text) });
    }
    return written;
  }

  // A ref race: run every staged change again on the fresh snapshot. The parent goes first, so each
  // child is authorised against the parent as it now stands.
  rerun(fresh, store) {
    const before = [...this.entries.values()].sort((a, b) => (a.kind === 'parent' ? 0 : 1) - (b.kind === 'parent' ? 0 : 1));
    this.snapshot = fresh;
    this.entries = new Map();
    for (const entry of before) {
      let base, sha;
      try { ({ doc: base, sha } = store.snapshotDoc(fresh, entry.kind, entry.number)); } catch (error) { if (!error.code) throw error; this.drop(entry, error); continue; }
      if (entry.base && base && (base.fence.epoch !== entry.base.fence.epoch || base.fence.holder_session !== entry.base.fence.holder_session)) {
        throw new ProgrammeError('STALE_WRITER', `${store.docPath(entry.kind, entry.number)} is now held by another session; this pass was stopped before it wrote anything.`);
      }
      const changed = (a, b) => Object.keys({ ...(a || {}), ...(b || {}) }).filter(key => !['revision', 'volatile'].includes(key)
        && JSON.stringify(canonical(a?.[key])) !== JSON.stringify(canonical(b?.[key])));
      const ours = changed(entry.base || entry.ops[0]?.create?.(), entry.doc);
      const theirs = entry.base || base ? changed(entry.base, base) : [];
      const overlap = ours.filter(key => theirs.includes(key));
      // Created documents and the parent's catalogue additions only stand while their owner commits.
      if ((!entry.base && base) || (entry.base && !base) || overlap.length || (!entry.base && this.dropped.has(`parent:${this.parentNumber}`))) {
        let error = new ProgrammeError('STATE_CONFLICT', `${store.docPath(entry.kind, entry.number)} was changed by another writer in ${overlap.join(', ') || 'the same document'}; held for the controller.`);
        try { for (const op of entry.ops) op.onConflict?.(base ? clone(base) : null, { created: false }); } catch (thrown) { if (!thrown.code) throw thrown; error = thrown; }
        this.drop(entry, error);
        continue;
      }
      try {
        let doc = base;
        for (const op of entry.ops) doc = this.run({ ...entry, base }, doc, op) || doc;
        this.entries.set(`${entry.kind}:${entry.number}`, { ...entry, base, sha, doc });
        if (base) requireVersionToken(sha, store.docPath(entry.kind, entry.number));
      } catch (error) {
        if (!error.code || STOPS_PASS.has(error.code)) throw error;
        this.drop(entry, error);
      }
    }
  }

  committed(written, head) {
    this.written = written;
    this.head = head;
  }

  // Every document as committed: the snapshot with this batch's documents laid over it.
  documents(kind) {
    const docs = new Map();
    for (const [key, entry] of this.snapshot.documents) if (key.startsWith(`${kind}:`) && entry.doc) docs.set(Number(key.slice(kind.length + 1)), clone(entry.doc));
    for (const entry of this.written) if (entry.kind === kind) docs.set(entry.number, clone(entry.doc));
    return docs;
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
      ...(Array.isArray(doc.outcomes) ? doc.outcomes : []).flatMap((outcome, index) => ['label', 'name', 'description', 'lane'].map(field => [`outcomes[${index}].${field}`, outcome?.[field]])),
      ...(Array.isArray(doc.page_archive) ? doc.page_archive : []).map((entry, index) => [`page_archive[${index}].title`, entry.title])];
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
  // The public files at the branch head, each joined to its private sidecar as read() joins it.
  // A branch never created has no documents.
  readSnapshot() {
    const branch = this.ensureBranch();
    if (!branch.exists) return { head: null, tree: null, mode: 'graphql', documents: new Map(), files: new Map() };
    const snapshot = super.readSnapshot();
    for (const [key, entry] of snapshot.documents) {
      if (entry.error) continue;
      const kind = key.startsWith('parent:') ? 'parent' : 'child';
      const number = Number(key.slice(kind.length + 1));
      const recorded = this.checkpoint?.doc?.files?.[documentName(kind, number)];
      if (recorded && entry.doc.revision < recorded.revision) {
        this.hold('STATE_ROLLED_BACK', `${STATE_PATH}${documentName(kind, number)}.json on ${STATE_BRANCH} is at revision ${entry.doc.revision}, below the checkpoint's revision ${recorded.revision} (a force-push back, a deleted file or a hand edit). Nothing was written. Controller: report to the owner.`);
      }
      snapshot.documents.set(key, { doc: this.join(kind, number, entry.doc), sha: entry.sha, text: entry.text });
    }
    return snapshot;
  }

  storedText(kind, doc) { return canonicalText(publicView(kind, doc, [...this.sessions])); }

  // The sweep record lives in the private store beside the sidecars.
  sweepRecordPath() { return this.private.sweepRecordPath(); }
  sweepHistoryPath() { return this.private.sweepHistoryPath(); }

  // The sidecars before the branch commit, as write() puts the sidecar before the public file.
  beforeBatch(written) {
    if (!this.ensureBranch().exists) {
      throw new ProgrammeError('STATE_BRANCH_MISSING', `The state branch ${STATE_BRANCH} was never created, so nothing was written. Only programme.cjs migrate-state --apply creates it.`);
    }
    this.requirePrivateStore();
    for (const entry of written) {
      entry.publicDigest = sha256(entry.text);
      entry.sidecarSha = this.putSidecar(documentName(entry.kind, entry.number), entry.doc, entry.publicDigest);
    }
  }

  // The checkpoint after the branch commit. A stop before it is recomputed from the branch next run.
  afterBatch(written, head) {
    this.branch = { exists: true, head };
    const files = Object.fromEntries(written.map(entry => [documentName(entry.kind, entry.number), { revision: entry.doc.revision, sha256: entry.publicDigest }]));
    try { this.recordCheckpoint(files, head); }
    catch (error) {
      if (!error.code || STOPS_PASS.has(error.code)) throw error;
      this.checkpoint = null;
      this.branch = null;
      this.note('STATE_CHECKPOINT_STALE', `The state was written but its checkpoint was not (${error.code}); the next run sets it from the branch.`);
      return;
    }
    for (const entry of written) {
      const name = documentName(entry.kind, entry.number);
      const replaced = this.joined.get(name);
      this.joined.set(name, { file: this.sidecarPath(name, entry.doc.revision, entry.publicDigest), sha: entry.sidecarSha, revision: entry.doc.revision });
      this.pruneSidecars(name, entry.doc.revision, replaced);
    }
  }

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

  // Page copies hold whole pages, so they stay in the private store.
  savePageCopy(number, page) { return this.private.savePageCopy(number, page); }

  // The public file holds only what validatePublic allows.
  validateRead(kind, doc) { return validatePublic(kind, doc); }

  // The private store must be private, readable and writable. The bound repository is checked by
  // bindRepository; the branch itself by the read path.
  verify() { return this.private.verify(); }

  // Page copies hold hand-written text, so they go to the private store, never the public branch.
  saveNoteCopy(issue, text) { this.requirePrivateStore(); return this.private.saveNoteCopy(issue, text); }

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
    // Before the sidecar: a sidecar is never written for a public write that cannot be conditional.
    if (previous) requireVersionToken(sha, this.docPath(kind, number));
    const branch = this.ensureBranch();
    if (!branch.exists) {
      throw new ProgrammeError('STATE_BRANCH_MISSING', `The state branch ${STATE_BRANCH} was never created, so nothing was written. Only programme.cjs migrate-state --apply creates it.`);
    }
    const doc = clone(next);
    if (kind === 'child' && doc.schema === SCHEMA.child) { doc.schema = SCHEMA.childV2; if (doc.prs === undefined) doc.prs = []; }
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
function openStore({ transport, binding, now, toolkitVersion = null, localCheckpoint = null, installationWrite = false }) {
  if (binding.state) return new STATE_BACKENDS[binding.state.kind]({ transport, binding, now, toolkitVersion, localCheckpoint });
  return new STORE_BACKENDS[binding.store.kind]({ transport, store: binding.store, now, toolkitVersion, installationWrite });
}

const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    pullRequest(number: $number) {
      number state isDraft merged mergedAt mergeCommit { oid } headRefOid baseRefName mergeable
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
  // At most twenty tracked/history PRs per serial request. Refusal alone uses the same REST
  // facts; a pass stop, expired sign-in or a lost writer never becomes a compatibility fallback.
  pullRequests(numbers) {
    const result = new Map();
    const unique = [...new Set(numbers)];
    const [owner, name] = this.repository.split('/');
    for (let start = 0; start < unique.length; start += 20) {
      const batch = unique.slice(start, start + 20);
      if (!batch.every(number => Number.isSafeInteger(number) && number > 0)) throw new ProgrammeError('USAGE', 'Pull request numbers must be positive integers.');
      const selection = batch.map(number => `p${number}: pullRequest(number:${number}) { number title state isDraft merged mergedAt mergeCommit { oid } headRefOid baseRefName mergeable commits(last:1) { nodes { commit { oid statusCheckRollup { contexts(first:100) { pageInfo { hasNextPage } nodes { __typename ... on CheckRun { name status conclusion isRequired(pullRequestNumber:${number}) } ... on StatusContext { context state isRequired(pullRequestNumber:${number}) } } } } } } } }`).join('\n');
      const response = this.transport.request('POST', 'graphql', { query: `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){defaultBranchRef{name} ${selection}}}`, variables: { owner, name } });
      if (response.status === 401) throw new ProgrammeError('GH_AUTH', 'GitHub rejected the sign-in.');
      const repo = response.json?.data?.repository;
      if (response.status !== 200 || response.json?.errors?.length || !repo) {
        for (const number of batch) result.set(number, this.restPullRequest(number));
        continue;
      }
      for (const number of batch) {
        const pr = repo[`p${number}`];
        if (!pr || pr.number !== number) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'A batched pull request was not returned.');
        const commit = pr.commits?.nodes?.[0]?.commit;
        const rollup = commit?.statusCheckRollup;
        result.set(number, { number, title: pr.title, state: pr.merged ? 'MERGED' : pr.state === 'CLOSED' ? 'CLOSED' : pr.isDraft ? 'DRAFT' : 'OPEN',
          merged_at: pr.mergedAt || null, merge_sha: pr.mergeCommit?.oid || null, head: pr.headRefOid, base: pr.baseRefName,
          default_branch: repo.defaultBranchRef?.name || null, mergeable: pr.mergeable, rollupOid: commit?.oid || null,
          complete: !rollup?.contexts?.pageInfo?.hasNextPage,
          contexts: (rollup?.contexts?.nodes || []).map(node => ({ kind: node.__typename, name: node.name || node.context,
            status: node.status || null, conclusion: node.conclusion || null, state: node.state || null, required: node.isRequired === true })) });
      }
    }
    return result;
  }

  restPullRequest(number) {
    const request = endpoint => {
      const response = this.transport.request('GET', `repos/${this.repository}/${endpoint}`);
      if (response.status !== 200) throw ghFailure(response, 'Reading pull request facts');
      return response.json;
    };
    const pr = request(`pulls/${number}`);
    if (!isSha(pr.head?.sha)) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'The pull request head is unreadable.');
    const checks = request(`commits/${pr.head.sha}/check-runs?per_page=100`);
    const status = request(`commits/${pr.head.sha}/status`);
    return { number: pr.number, title: pr.title, state: pr.merged ? 'MERGED' : pr.state === 'closed' ? 'CLOSED' : pr.draft ? 'DRAFT' : 'OPEN',
      head: pr.head.sha, base: pr.base?.ref, default_branch: pr.base?.repo?.default_branch || null, mergeable: pr.mergeable,
      merged_at: pr.merged_at || null, merge_sha: pr.merge_commit_sha || null, rollupOid: pr.head.sha,
      complete: Array.isArray(checks.check_runs) && checks.total_count === checks.check_runs.length && Array.isArray(status.statuses) && status.total_count === status.statuses.length,
      contexts: [...(checks.check_runs || []).map(check => ({ kind: 'CheckRun', name: check.name, status: check.status, conclusion: check.conclusion, required: false })),
        ...(status.statuses || []).map(context => ({ kind: 'StatusContext', name: context.context, state: context.state, required: false }))] };
  }

  // The login archive comments are written under. The cloud sweep is given its App's login and
  // never asks GitHub for the signed-in user.
  viewer() {
    if (this.login) return this.login;
    const response = this.transport.request('GET', 'user');
    if (response.status !== 200 || !isText(response.json?.login)) throw ghFailure(response, 'Reading the authenticated login');
    return response.json.login;
  }

  archiveComment(id) {
    const response = this.transport.request('GET', `repos/${this.repository}/issues/comments/${id}`);
    if (response.status === 404) return null;
    if (response.status !== 200) throw ghFailure(response, 'Reading an archive comment');
    return response.json;
  }
  nativeChildState(number) {
    return new (require('./issue-closure.cjs').IssueClosureGuard)({ transport: this.transport, repository: this.repository }).tree(this.repository, number);
  }

  issueEvents(number) {
    const guard = new (require('./issue-closure.cjs').IssueClosureGuard)({ transport: this.transport, repository: this.repository });
    const events = guard.pages(`repos/${this.repository}/issues/${number}/events`, guard.budget());
    if (events.some(event => !Number.isSafeInteger(event?.id) || typeof event.event !== 'string' || typeof event.created_at !== 'string')) throw new ProgrammeError('GH_FAILED', 'Issue events were malformed.');
    return events;
  }

  constructor({ transport, repository, login = null }) {
    this.transport = transport;
    this.repository = repository;
    this.login = login;
  }

  issue(number) {
    const response = this.transport.request('GET', `repos/${this.repository}/issues/${number}`);
    if (response.status === 404 || response.status === 410) return null;
    if (response.status !== 200) throw ghFailure(response, `Reading issue ${number}`);
    return this.issueFacts(response.json, number);
  }

  // The facts the reconciler uses from one issue object, whether it came from a single read or as a
  // row of its parent's sub-issue list (GitHub sends the same object in both).
  issueFacts(issue, number) {
    const complete = isObject(issue) && issue.number === number && isInt(issue.id, 1) && ['open','closed'].includes(issue.state)
      && (typeof issue.title === 'string') && (typeof issue.body === 'string' || issue.body === null)
      && (issue.state !== 'closed' || Boolean(issue.closed_at && !Number.isNaN(Date.parse(issue.closed_at))));
    /* A partial response remains displayable to the existing read-only reconciler. Refresh alone
       requires complete lifecycle evidence, before it plans any copying effects. */
    if (!isObject(issue)) throw new ProgrammeError('GH_FAILED',`Issue ${number} was unreadable.`);
    return {
      complete,
      number: issue.number, id: issue.id, state: issue.state, state_reason: issue.state_reason || null,
      title: issue.title, body: issue.body || '', updated_at: issue.updated_at, closed_at: issue.closed_at || null,
      is_pull_request: Boolean(issue.pull_request),
      parent: parentFromUrl(issue.parent_issue_url, this.repository),
      blocked_by_total: issue.issue_dependencies_summary?.total_blocked_by ?? 0,
      open_sub_issues: Math.max(0, (issue.sub_issues_summary?.total ?? 0) - (issue.sub_issues_summary?.completed ?? 0)),
      // Counts GitHub reports on the issue itself; null when it sent none, so the lists are read.
      comments: isInt(issue.comments, 0) ? issue.comments : null,
      sub_issues_total: isInt(issue.sub_issues_summary?.total, 0) ? issue.sub_issues_summary.total : null,
    };
  }

  subIssues(number) { return this.subIssueRows(number).map(row => ({ number: row.number, id: row.id })); }

  // The sub-issue list with each row's own issue facts: one request per hundred children in place
  // of one request per child. `facts` is null when a row is not a usable issue object.
  subIssueRows(number) {
    const all = [];
    for (let page = 1; page < 50; page += 1) {
      const response = this.transport.request('GET', `repos/${this.repository}/issues/${number}/sub_issues?per_page=100&page=${page}`);
      if (response.status !== 200) throw ghFailure(response, `Reading sub-issues of ${number}`);
      all.push(...response.json.map(issue => ({ number: issue.number, id: issue.id, facts: isObject(issue) && isInt(issue.number, 1) ? this.issueFacts(issue, issue.number) : null })));
      if (response.json.length < 100) return all;
    }
    throw new ProgrammeError('GH_FAILED', `Issue ${number} has more sub-issues than this reader pages through.`);
  }

  // Every comment on an issue, for the comment trace and its audit.
  comments(number) { return this.commentsChanged(number).comments; }

  // The comments last changed at or after `since` (all of them without it), oldest first, with the
  // newest change time GitHub reported: the bookmark for the next read.
  commentsChanged(number, since = null) {
    const all = [];
    let newest = null;
    const filter = since ? `&since=${encodeURIComponent(since)}` : '';
    for (let page = 1; page < 100; page += 1) {
      const response = this.transport.request('GET', `repos/${this.repository}/issues/${number}/comments?per_page=100&page=${page}${filter}`);
      if (response.status !== 200) throw ghFailure(response, `Reading comments of ${number}`);
      for (const comment of response.json) {
        const changed = comment.updated_at || comment.created_at;
        if (Number.isFinite(Date.parse(changed)) && (!newest || Date.parse(changed) > Date.parse(newest))) newest = changed;
        all.push({ id: comment.id, user: comment.user, body: comment.body || '', created_at: comment.created_at });
      }
      if (response.json.length < 100) return { comments: all, newest };
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
      merged_at: pr.mergedAt || null, merge_sha: pr.mergeCommit?.oid || null,
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
      all.push(...response.json.map(pr => ({ number: pr.number, body: pr.body || '', head_sha: pr.head?.sha || null, updated_at: pr.updated_at || null })));
      if (response.json.length < 100) return all;
    }
    throw new ProgrammeError('GH_FAILED', 'The repository has more open pull requests than this reader pages through.');
  }

  // One shared scan per pass. A full final page is incomplete, even if it might be the last.
  mergedPullRequests(spend) {
    const all = [];
    for (let page = 1; page <= 10; page += 1) {
      spend();
      const response = this.transport.request('GET', `repos/${this.repository}/pulls?state=closed&per_page=100&sort=created&direction=desc&page=${page}`);
      if (response.status !== 200) throw ghFailure(response, 'Listing merged pull requests');
      if (!Array.isArray(response.json)) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'The closed PR list was not readable.');
      for (const pr of response.json) {
        if (!pr.merged_at) continue;
        const match = mergedCandidate({ number: pr.number, merged: true, mergedAt: pr.merged_at,
          repository: pr.base?.repo ? { nameWithOwner: pr.base.repo.full_name } : { nameWithOwner: this.repository } }, this.repository);
        if (match) all.push({ ...match, body: pr.body || '' });
      }
      if (response.json.length < 100) return all;
    }
    throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'The closed PR scan reached ten full pages.');
  }

  // The refresh graph shares the discovery budget across lists, reference batches and detail reads.
  // Closed PRs are sorted by update time so a newly closed old PR cannot fall behind a watermark.
  graphPullRequests(status, spend, watermark = null) {
    const all = [];
    const cutoff = status === 'closed' && watermark ? Date.parse(watermark) - 5 * 60000 : null;
    for (let page = 1; page <= LIST_PAGE_GUARD; page += 1) {
      spend();
      const response = this.transport.request('GET', `repos/${this.repository}/pulls?state=${status}&per_page=100&sort=updated&direction=desc&page=${page}`);
      if (response.status !== 200) throw ghFailure(response, 'Reading programme PR history');
      if (!Array.isArray(response.json)) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'The PR list was not readable.');
      for (const pr of response.json) {
        const item = graphPr(pr, this.repository);
        if (!item) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'A PR history entry was incomplete.');
        if (cutoff !== null && !Number.isFinite(Date.parse(pr.updated_at))) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'The closed PR update time was not readable.');
        // Keep a five-minute overlap for boundary updates and timestamp precision. The REST list
        // is descending by updated_at, so nothing after this row can be newer than the cutoff.
        if (cutoff !== null && Date.parse(pr.updated_at) < cutoff) return all;
        all.push({...item, body:[pr.title,pr.body].filter(Boolean).join('\n'), author:pr.user?.login || '', branch:pr.head?.ref || '', head_sha:pr.head?.sha || null, updated_at:pr.updated_at || null, closed_at:pr.closed_at || pr.merged_at || null});
      }
      if (response.json.length < 100) return all;
    }
    throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', `The programme PR scan reached ${LIST_PAGE_GUARD} full pages.`);
  }

  // At most twenty aliases, each with two bounded issue connections. No partial GraphQL data is used.
  issuePullRequestLinks(numbers, spend) {
    const [owner, name] = this.repository.split('/');
    const fields = numbers.map(number => `i${number}: issue(number: ${number}) {
      closedByPullRequestsReferences(first: 100, includeClosedPrs: true) {
        pageInfo { hasNextPage } nodes { number state merged mergedAt mergeCommit { oid } repository { nameWithOwner } }
      }
      timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT]) {
        pageInfo { hasNextPage } nodes { ... on CrossReferencedEvent {
          source { __typename ... on PullRequest { number state merged mergedAt mergeCommit { oid } repository { nameWithOwner } } }
        } }
      }
    }`).join('\n');
    spend();
    const response = this.transport.request('POST', 'graphql', {
      query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
      variables: { owner, name },
    });
    if (response.status !== 200) throw ghFailure(response, 'Reading issue PR references');
    const repository = response.json?.data?.repository;
    if (response.json?.errors?.length || !repository) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'The issue PR references were not fully readable.');
    return new Map(numbers.map(number => {
      const issue = repository[`i${number}`];
      const closing = issue?.closedByPullRequestsReferences;
      const timeline = issue?.timelineItems;
      const complete = [closing, timeline].every(connection => connection?.pageInfo?.hasNextPage === false && Array.isArray(connection.nodes));
      const nodes = complete ? [...closing.nodes, ...timeline.nodes.map(node => node?.source).filter(node => node?.__typename === 'PullRequest')] : [];
      const history = nodes.map(node => graphPr(node, this.repository)).filter(Boolean);
      return [number, { complete: complete && nodes.every(node => node.repository?.nameWithOwner?.toLowerCase() !== this.repository.toLowerCase() || graphPr(node, this.repository)),
        candidates: nodes.map(node => mergedCandidate(node, this.repository)).filter(Boolean), history }];
    }));
  }

  // The issues and pull requests GitHub changed at or after `since`, oldest change first. Each
  // request asks again from the update time the last one ended on (keyset paging), so an item that
  // changes during the read moves to the end and is read then, never skipped. The read stops after
  // CHANGED_PAGES requests: it is then incomplete, and `cursor` is the update time read up to, so
  // the next pass carries on from there instead of starting over. Rows that share that time are
  // read again next pass, through the pass's own overlap.
  changedSince(since) {
    const issues = new Set(); const prs = []; const seen = new Set(); const order = [];
    let from = since; let page = 1; let cursor = null;
    for (let request = 0; request < CHANGED_PAGES; request += 1) {
      const response = this.transport.request('GET', `repos/${this.repository}/issues?state=all&sort=updated&direction=asc&since=${encodeURIComponent(from)}&per_page=100&page=${page}`);
      if (response.status === 401) throw new ProgrammeError('GH_AUTH', 'GitHub rejected the sign-in.');
      if (response.status !== 200 || !Array.isArray(response.json)) return { issues, prs, order, complete: false, cursor };
      let last = null;
      for (const row of response.json) {
        if (!isObject(row) || !isInt(row.number, 1) || !Number.isFinite(Date.parse(row.updated_at))) return { issues, prs, order, complete: false, cursor };
        last = row.updated_at;
        if (seen.has(row.number)) continue;
        seen.add(row.number);
        if (row.pull_request) prs.push({ number: row.number, title: row.title || '', body: [row.title, row.body].filter(Boolean).join('\n') });
        else { issues.add(row.number); order.push(row.number); }
      }
      if (response.json.length < 100) return { issues, prs, order, complete: true, cursor: null };
      // Everything changed before `last` has been read; rows at `last` itself may continue.
      cursor = last;
      // A full page of one update time cannot move the keyset forward: page through it instead.
      if (Date.parse(last) <= Date.parse(from)) page += 1;
      else { from = last; page = 1; }
    }
    return { issues, prs, order, complete: false, cursor };
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

function backfillEligible(outcome, child) {
  return Boolean(outcome && isFinished(outcome, child) && !isRetired(outcome, child) && !child?.pr?.number);
}

function mergedCandidate(node, repository) {
  if (!isObject(node) || typeof node.merged !== 'boolean' || !isText(node.repository?.nameWithOwner)) {
    throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'A PR reference was not fully readable.');
  }
  if (!node.merged || node.repository.nameWithOwner.toLowerCase() !== repository.toLowerCase()) return null;
  if (!isInt(node.number, 1) || !isText(node.mergedAt) || !Number.isFinite(Date.parse(node.mergedAt))) {
    throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'A merged PR reference had no usable number or merge time.');
  }
  return { number: node.number, merged_at: node.mergedAt };
}

function mergedSelection(candidates) {
  return [...new Map(candidates.map(pr => [pr.number, { number: pr.number, merged_at: pr.merged_at }])).values()]
    .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at) || b.number - a.number);
}

// Native hierarchy and body mutations; each returns the raw status. Readback decides the outcome.
function lifecycleSnapshot(tree) {
  // Projection writes update the parent's timestamp in this same pass. The lifecycle
  // snapshot binds only the native state and membership that authorise this effect.
  return JSON.stringify([tree.issue.state, tree.descendants.map(child => [child.repository, child.number, child.state]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

class GitHubMutator {
  setIssueState(number, state, { binding, expected, fence }) {
    const policy = binding.parent_lifecycle;
    if (binding.governance !== 'enabled' || binding.schema !== SCHEMA.bindingV2 || number !== binding.parent_issue || binding.repository.toLowerCase() !== this.repository.toLowerCase()
      || !(state === 'open' ? policy?.reopen_incomplete : state === 'closed' && policy?.complete_when_children_closed)) throw new ProgrammeError('LIFECYCLE_REFUSED', 'No bound permission for this parent lifecycle write.');
    const closure = new (require('./issue-closure.cjs').IssueClosureGuard)({ transport: this.transport, repository: this.repository, deadlineMs: state === 'closed' ? 120000 : 30000 });
    const fresh = closure.tree(this.repository, number, closure.budget(), new Set(), { full: state === 'closed' });
    if (lifecycleSnapshot(fresh) !== expected) throw new ProgrammeError('LIFECYCLE_MOVED', 'Native parent or child state changed; re-plan before writing.');
    if (state === 'closed' && (!fresh.descendants.length || fresh.descendants.some(child => child.state !== 'closed'))
      || state === 'open' && !fresh.descendants.some(child => child.state === 'open')) throw new ProgrammeError('LIFECYCLE_REFUSED', 'Native child state does not permit this lifecycle write.');
    fence();
    this.mutations += 1;
    return this.transport.request('PATCH', `repos/${this.repository}/issues/${number}`, { state, ...(state === 'closed' ? { state_reason: 'completed' } : {}) });
  }

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
    this.mutations += 1;
    return this.transport.request('POST', `repos/${this.repository}/issues/${number}/comments`, { body });
  }

  editComment(id, body) {
    this.mutations += 1;
    return this.transport.request('PATCH', `repos/${this.repository}/issues/comments/${id}`, { body });
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
const CLOSE_FIELDS = ['lifecycle', 'completed_at', 'before_close', 'closed_by_sweep'];
// Source-watch uses the workflow token: plan-source-watch-pr-lifecycle.cjs records both spellings.
const GRAPH_BOTS = new Set(['dependabot[bot]', 'github-actions[bot]', 'app/github-actions']);
// The weekly timing refresh may use the owner's gh sign-in rather than an Actions token.
const GRAPH_GENERATED_BRANCH_PREFIX = 'toolkit/shard-timings-';
const excludedGraphPr = pr => Boolean(pr && (GRAPH_BOTS.has(pr.author) || pr.branch?.startsWith(GRAPH_GENERATED_BRANCH_PREFIX)));

function graphPr(pr, repository) {
  const repo = pr.repository?.nameWithOwner || pr.base?.repo?.full_name;
  if (!isInt(pr.number,1) || repo?.toLowerCase() !== repository.toLowerCase()) return null;
  const merged = pr.merged === true || Boolean(pr.merged_at);
  const state = merged ? 'MERGED' : String(pr.state || '').toUpperCase();
  if (!['OPEN','CLOSED','DRAFT'].includes(state) && !merged) return null;
  const mergeSha = pr.mergeCommit?.oid || pr.merge_commit_sha || null;
  if (mergeSha !== null && !isSha(mergeSha)) return null;
  if (merged && !Number.isFinite(Date.parse(pr.mergedAt || pr.merged_at))) return null;
  return {number:pr.number, state:state === 'DRAFT' ? 'OPEN' : state, merge_sha:merged ? mergeSha : null,
    merged_at:pr.mergedAt || pr.merged_at || null};
}

function prHistory(entries) {
  const unique = new Map(entries.map(pr => [pr.number,pr]));
  const rank = {OPEN:0,MERGED:1,CLOSED:2};
  return [...unique.values()].sort((a,b) => rank[a.state]-rank[b.state]
    || (a.state === 'MERGED' ? Date.parse(b.merged_at)-Date.parse(a.merged_at) : 0) || b.number-a.number)
    .map(({number,state,merge_sha}) => ({number,state,merge_sha}));
}

// Only refresh uses this transformation, from a complete issue observation in its own pass.
function copyIssueLifecycle(doc, issue) {
  const next = clone(doc);
  const closedLifecycle = String(issue.state_reason || '').toUpperCase() === 'COMPLETED' ? 'DONE' : 'RETIRED';
  if (issue.state === 'closed' && (doc.closed_by_sweep || !TERMINAL_LIFECYCLES.includes(doc.lifecycle))) {
    if (!doc.closed_by_sweep) next.before_close = doc.lifecycle;
    next.lifecycle = closedLifecycle;
    next.completed_at = issue.closed_at;
    next.closed_by_sweep = true;
  } else if (issue.state === 'open' && doc.closed_by_sweep === true) {
    next.lifecycle = doc.before_close || 'ACTIVE';
    delete next.before_close;
    delete next.closed_by_sweep;
    delete next.completed_at;
  }
  if (!next.completed_at && issue.state === 'closed' && TERMINAL_LIFECYCLES.includes(next.lifecycle)) next.completed_at = issue.closed_at;
  return next;
}

function checkLifecycleObservation(observed, fresh) {
  if (observed?.complete !== true || fresh?.complete !== true || observed.id !== fresh.id || fresh.is_pull_request
    || observed.state !== fresh.state || observed.closed_at !== fresh.closed_at || observed.state_reason !== fresh.state_reason) {
    throw new ProgrammeError('GRAPH_FACT_STALE', 'Issue lifecycle changed after observation; refresh again.');
  }
}

const EFFECT_TEXT = {
  set_parent_state: effect => `${effect.target.state === 'open' ? 'Reopen' : 'Complete'} the programme parent #${effect.target.issue} from every native descendant's state`,
  post_parent_repair: effect => `Report the repaired parent closure on #${effect.target.issue}`,
  create_state: effect => `Create the state document for #${effect.target.issue}`,
  update_state: effect => `Update the state document for #${effect.target.issue} (${effect.fields.join(', ')})`,
  copy_child_lifecycle: effect => `Copy the observed issue lifecycle for #${effect.target.issue}`,
  add_native_children: effect => `Add ${effect.outcomes.length} observed native task(s) to #${effect.target.issue}'s catalogue`,
  advance_pr_watermark: effect => `Record the complete PR scan on #${effect.target.issue}`,
  advance_closing_scan: effect => `Record closing scan progress on #${effect.target.issue}`,
  post_closing_backstop: effect => `Append closing facts to ${effect.target.kind} #${effect.target.issue}`,
  attach: effect => `Attach #${effect.target.issue} under #${effect.target.parent}`,
  reparent: effect => `Move #${effect.target.issue} from under ${typeof effect.from === 'number' ? `#${effect.from}` : effect.from} to under #${effect.target.parent}`,
  reorder: effect => `Move #${effect.target.issue} ${effect.target.before !== undefined ? `before #${effect.target.before}` : `after #${effect.target.after}`} under #${effect.target.parent}`,
  replace_block: effect => (effect.relay ? `Lay out #${effect.target.issue}'s page in the fixed order (PATH, STATUS, COMMENT TRACE, the capital sections, then More); its hand-written text moves, and a copy of the page is saved first`
    : effect.state === false ? `Update the ${staleParts(effect)} in #${effect.target.issue}'s body` : `${effect.insert ? 'Add' : effect.move ? 'Move' : 'Update'} the state block in #${effect.target.issue}'s body`),
  replace_pr_nav: effect => `Write the PATH and STATUS blocks at the top of PR #${effect.target.pr}`,
  update_attention: effect => `Update the attention findings on #${effect.target.issue} (${effect.line} after this pass)`,
  post_index_comment: effect => effect.target.directory ? `Move #${effect.target.issue}'s comment topics into index pages` : `Move #${effect.target.issue}'s "${effect.label || effect.target.tag || OTHER_COMMENTS}" comment trace (${effect.lines.length} link(s)) into a new index comment`,
  post_archive_comment: effect => (/^note-/.test(String(effect.target.key)) ? `Move the notes marked under \`## Archive\` off #${effect.target.issue}'s page into a verified comment` : `Archive programme content from #${effect.target.issue} in a verified comment`),
  edit_archive_comment: effect => `Update a registered programme archive comment on #${effect.target.issue}`,
};

// The parts of a body a block effect rewrites when its state block is already current.
function staleParts(effect) {
  const names = [['trace', 'comment trace'], ['nav', 'parent and task links'], ['current', 'CURRENT summary']].filter(([key]) => effect.stale?.[key]).map(([, name]) => name);
  if (!names.length) return 'comment trace';
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function describeEffect(effect) {
  const text = EFFECT_TEXT[effect.kind](effect);
  return effect.backfill ? `${text}; select merged PR #${effect.backfill.selected} from ${effect.backfill.candidates.map(pr => `#${pr.number} (${pr.merged_at})`).join(', ')}. ${effect.backfill.reason}` : text;
}

// What a hold on an issue stops for the rest of a pass: its body, its links, or everything.
function holdScope(kind) {
  if (kind === 'post_closing_backstop') return 'closing';
  if (kind === 'set_parent_state' || kind === 'post_parent_repair') return 'lifecycle';
  if (['replace_block', 'post_index_comment', 'post_archive_comment', 'edit_archive_comment'].includes(kind)) return 'body';
  if (kind === 'replace_pr_nav') return 'pr';
  if (kind === 'attach' || kind === 'reparent' || kind === 'reorder') return 'links';
  return 'all';
}

// One reconcile pass: bind, observe, recover, diff, plan and (with apply) run each effect.
class Reconciler {
  diffParentLifecycle(parent, observed, effects, findings, holds) {
    const policy = this.binding.parent_lifecycle;
    if (!policy || this.binding.schema !== SCHEMA.bindingV2 || this.binding.governance !== 'enabled') return;
    const number = parent.parent_issue;
    try {
      const tree = this.reader.nativeChildState(number);
      observed.lifecycle = tree;
      const open = tree.descendants.some(child => child.state === 'open');
      if (tree.issue.state === 'closed' && open && policy.reopen_incomplete) {
        const events = this.reader.issueEvents(number);
        let closed = null;
        for (const event of events) { if (event.event === 'closed') closed = event; else if (event.event === 'reopened') closed = null; }
        if (!closed) throw new Error('The latest unmatched closure event is unavailable.');
        const marker = `<!-- toolkit-parent-repair:${number}:${closed.id} -->`;
        const source = closed.commit_id ? `Closing commit: ${closed.commit_id}.` : 'Closing source unavailable.';
        const body = `${marker}\nReopened the programme parent because native descendants remain open. Closure event ${closed.id}, actor ${closed.actor?.login || 'unavailable'}, time ${closed.created_at}. ${source}`;
        const repair = { issue: number, marker, body };
        effects.push({ kind: 'set_parent_state', target: { issue: number, state: 'open', expected: lifecycleSnapshot(tree), repair } });
        effects.push({ kind: 'post_parent_repair', target: repair });
        findings.push({ code: 'PARENT_CLOSED_INCOMPLETE', issue: number, detail: 'The parent closed while native descendants remain open; lifecycle permission permits repair.' });
      } else if (tree.issue.state === 'open' && tree.descendants.length && !open && policy.complete_when_children_closed) {
        const closure = new (require('./issue-closure.cjs').IssueClosureGuard)({ transport: this.reader.transport, repository: this.binding.repository, deadlineMs: 120000 });
        const full = closure.tree(this.binding.repository, number, closure.budget(), new Set(), { full: true });
        observed.lifecycle = full;
        if (full.issue.state !== 'open' || !full.descendants.length || full.descendants.some(child => child.state !== 'closed')) throw new Error('Full native child walk changed the completion decision.');
        effects.push({ kind: 'set_parent_state', target: { issue: number, state: 'closed', expected: lifecycleSnapshot(full) } });
      }
      // A flag intent is recorded before reopening, so interrupted repair never loses its notice.
      for (const pending of parent.pending_effects.filter(effect => policy.reopen_incomplete && effect.kind === 'post_parent_repair')) {
        if (!effects.some(effect => effect.kind === pending.kind && effect.target.marker === pending.target.marker)
          && !this.reader.comments(number).some(comment => comment.body.includes(pending.target.marker))) effects.push({ kind: pending.kind, target: pending.target });
      }
    } catch {
      holds.push({ code: 'PARENT_LIFECYCLE_UNKNOWN', target: `#${number}`, scope: 'lifecycle', detail: 'Native child state or closure events could not be read completely; no parent lifecycle change.' });
    }
  }

  constructor({ store, reader, mutator, binding, writer = null, toolkitVersion = null, threshold = DEFAULT_THRESHOLD, now = null, refreshFacts = false, pass = null, readCache = null }) {
    this.store = store;
    // The clock attention findings are dated by (the store's clock dates only its own commits).
    this.now = now || (() => new Date().toISOString());
    this.pass = pass || new RefreshBudget();
    this.planning = false;
    // A reconciler built only for its settings has no reader to wrap.
    this.reader = reader === null || typeof reader !== 'object' ? reader : new Proxy(reader, { get: (target, key) => {
      const member = target[key];
      return typeof member !== 'function' ? member : (...args) => {
        if (this.planning) this.pass.planning();
        return member.apply(target, args);
      };
    } });
    this.mutator = mutator;
    this.binding = binding;
    this.writer = writer;
    this.toolkitVersion = toolkitVersion;
    this.threshold = Math.min(threshold, DEFAULT_THRESHOLD);
    this.refreshFacts = refreshFacts;
    // Only a refresh that owns the pass lock brings one. Without it every read goes to GitHub.
    this.readCache = readCache;
    this.closing = reader?.transport ? new (require('./closing-comments.cjs').ClosingComments)({
      transport:reader.transport, repository:binding.repository, pass:this.pass, screenSecrets }) : null;
  }

  loadParent(parentOverride) {
    if (parentOverride) return { doc: assertValid('parent', parentOverride), sha: null, override: true };
    return this.store.read('parent', this.binding.parent_issue);
  }

  // What a pass reads from GitHub. A full pass reads every task and an issue-scoped pass one task.
  // A queued pass (refresh with `queued`) first reads the whole graph: the parent's lists, every
  // sub-issue list, the issues changed since its predecessor started, the open tracked PRs, the
  // parent's comments, the PR lists and links, and the closing scan. Then it reads the tasks in its
  // scope one at a time in queue order while `queued.canRead()` allows. A task outside the scope
  // keeps its stored document, as every other task does on an issue-scoped pass.
  observe(parent, children, only, queued = null) {
    let outcomes = parent.outcomes.filter(outcome => !only || outcome.issue === only);
    const issues = new Map();
    // On a full pass the parent's own sub-issue list carries the issue facts of every native direct
    // child, so those children need no read of their own. Anything the list does not show
    // completely, as an issue under this parent, is read singly as before.
    const rows = new Map();
    let parentRows = null;
    const read = number => {
      if (!issues.has(number)) issues.set(number, rows.get(number) || this.reader.issue(number));
      const issue=issues.get(number);
      if (this.refreshFacts && issue && issue.complete !== true) throw new ProgrammeError('GH_FAILED',`Issue ${number} was not read completely; no lifecycle observation is usable.`);
      return issue;
    };
    if (read(parent.parent_issue) && !only && typeof this.reader.subIssueRows === 'function') {
      parentRows = this.reader.subIssueRows(parent.parent_issue);
      for (const row of parentRows) {
        if (row.facts?.complete === true && !row.facts.is_pull_request && row.facts.parent === parent.parent_issue) rows.set(row.number, row.facts);
      }
    }
    const cache = this.refreshFacts && !only ? this.readCache : null;
    cache?.beginPass();
    const listedRows = rows.size;
    const sweep = queued ? this.queuedReads(parent, children, outcomes, rows, issues, queued, cache) : null;
    const all = outcomes;
    // A queued pass observes only the tasks it read; the graph reads above cover the rest.
    if (sweep) outcomes = sweep.read.map(number => all.find(outcome => outcome.issue === number));
    if (sweep) this.sweepRead = sweep.read.length;
    // Every task the lists showed keeps its current facts on the parent page, read or not.
    if (sweep) for (const [number, facts] of rows) if (!issues.has(number)) issues.set(number, facts);
    for (const outcome of outcomes) read(outcome.issue);
    const parents = new Set([parent.parent_issue, ...all.map(outcome => outcome.parent).filter(Boolean),
      ...(this.refreshFacts && !only ? (sweep ? [...sweep.lists.keys()] : all.map(outcome => outcome.issue)) : [])]);
    for (const number of parents) if (!sweep?.lists.has(number)) read(number);
    // An issue that reports no sub-issues has no list to read.
    const subIssues = new Map([...parents].filter(number => sweep?.lists.has(number) || issues.get(number)).map(number => [number,
      sweep?.lists.has(number) ? sweep.lists.get(number)
        : number === parent.parent_issue && parentRows ? parentRows.map(row => ({ number: row.number, id: row.id }))
          : issues.get(number).sub_issues_total === 0 ? [] : this.reader.subIssues(number)]));
    const additions = [];
    if (this.refreshFacts && !only) {
      const known = new Set([parent.parent_issue,...parent.outcomes.map(outcome => outcome.issue)]);
      let order = Math.max(0,...parent.outcomes.map(outcome => outcome.order));
      for (const [nativeParent, subs] of subIssues) for (const sub of subs) {
        if (nativeParent !== parent.parent_issue && registeredParents(this.binding).includes(nativeParent)) continue;
        if (known.has(sub.number) || registeredParents(this.binding).includes(sub.number)) continue;
        if (nativeParent !== parent.parent_issue && !parent.outcomes.some(outcome => outcome.issue === nativeParent)) continue;
        const issue = read(sub.number);
        if (!issue || issue.is_pull_request || issue.parent !== nativeParent) continue;
        known.add(sub.number);
        const outcome = {issue:sub.number,label:issue.title,class:'COMMITTED',parent:nativeParent,order:++order};
        additions.push(outcome); outcomes.push(outcome);
      }
    }
    const blockedBy = new Map(sweep ? sweep.blockedBy : []);
    const prs = new Map();
    const prCache = sweep ? sweep.prCache : new Map();
    const readPr = number => {
      if (!prCache.has(number)) prCache.set(number, this.reader.pullRequest(number));
      return prCache.get(number);
    };
    for (const outcome of outcomes) {
      const issue = issues.get(outcome.issue);
      if (issue?.blocked_by_total > 0 && !blockedBy.has(outcome.issue)) blockedBy.set(outcome.issue, this.reader.blockedBy(outcome.issue));
      const doc = children.get(outcome.issue)?.doc;
      const number = sweep?.tracked.has(outcome.issue) ? sweep.tracked.get(outcome.issue)
        : doc?.pr?.number || (!isFinished(outcome, doc) && doc?.candidate?.branch ? this.reader.pullRequestForBranch(doc.candidate.branch) : null);
      if (number) prs.set(outcome.issue, readPr(number));
    }
    const scoped = sweep ? new Set(outcomes.map(outcome => outcome.issue)) : null;
    const prGraph = this.refreshFacts ? this.discoverGraph(parent, sweep ? [...all, ...additions] : outcomes, children, prs, prCache, readPr, scoped, sweep?.graph) : null;
    const discovery = prGraph ? prGraph.discovery : this.discoverMerged(outcomes.filter(outcome => backfillEligible(outcome, children.get(outcome.issue)?.doc)), prs, prCache, readPr);
    const journals = new Map(sweep ? sweep.journals : []);
    for (const outcome of outcomes) {
      const doc = children.get(outcome.issue)?.doc;
      if (!journals.has(outcome.issue) && doc && (doc.gate.assignment || Object.keys(doc.journals_seen || {}).length)) journals.set(outcome.issue, this.readJournals(doc));
    }
    // Every open PR that names a catalogued task gets the links and status blocks, so the open
    // list is read on every pass that plans page writes.
    const openList = prGraph ? prGraph.openListed : this.reader.openPullRequests();
    const references = prGraph ? prGraph.openReferences : referencedIssues(openList);
    const prHeads = new Map(openList.map(pr => [pr.number, pr.head_sha || null]));
    // When each open PR last changed; a row from an older cache has none and counts as moving.
    const prUpdated = new Map(openList.map(pr => [pr.number, pr.updated_at || null]));
    const comments = new Map([parent.parent_issue, ...outcomes.map(outcome => outcome.issue)].filter(number => issues.get(number)).map(number => [number,
      sweep?.comments.has(number) ? sweep.comments.get(number)
        : number === parent.parent_issue ? this.discussion(number, issues.get(number), cache)
          // An issue that reports no comments has no list to read.
          : issues.get(number).comments === 0 ? [] : this.reader.comments(number)]));
    if (cache) {
      cache.counts.rows = listedRows;
      if (sweep) Object.assign(cache.counts, sweep.counts);
    }
    // Even an issue-scoped pass renders the whole parent, including every NOW task's comment time.
    for (const outcome of parent.outcomes) {
      if (!comments.has(outcome.issue) && graphClass(outcome, children.get(outcome.issue)?.doc) === 'NOW') comments.set(outcome.issue, this.reader.comments(outcome.issue));
    }
    const prPages = new Map(sweep ? sweep.prPages : []);
    for (const pr of prs.values()) if (pr && ['OPEN', 'DRAFT'].includes(pr.state) && !prPages.has(pr.number)) prPages.set(pr.number, this.reader.issue(pr.number));
    for (const outcome of outcomes) for (const number of references.get(outcome.issue) || []) {
      if (!prPages.has(number)) prPages.set(number, this.reader.issue(number));
    }
    const closing = sweep ? sweep.closing : this.refreshFacts && !only ? this.closing.scan(parent,prGraph,this.now,excludedGraphPr) : null;
    if (closing && !sweep) this.pass.planning();
    this.pass.phaseAt('planning');
    return { issues, subIssues, blockedBy, prs, outcomes, journals, references, comments, prPages, prHeads, prUpdated, discovery, additions, prGraph, closing,
      ...(sweep ? { sweep: { ...sweep.result, scoped } } : {}) };
  }

  // The reads of a queued pass. Every graph read comes first and is bounded; the tasks follow one
  // at a time, each read in full or not at all, so a stop never leaves half a task observed.
  queuedReads(parent, children, outcomes, rows, issues, queued, cache) {
    const stored = number => children.get(number)?.doc || null;
    const tasks = new Set(outcomes.map(outcome => outcome.issue));
    // Every native list under the parent, breadth first, so nested tasks get their facts free.
    const lists = new Map();
    const walk = [...new Set(outcomes.map(outcome => outcome.parent).filter(number => number && number !== parent.parent_issue))];
    for (const outcome of outcomes) if (rows.get(outcome.issue)?.sub_issues_total) walk.push(outcome.issue);
    for (let at = 0; at < walk.length; at += 1) {
      const number = walk[at];
      if (lists.has(number)) continue;
      const list = this.reader.subIssueRows(number);
      lists.set(number, list.map(row => ({ number: row.number, id: row.id })));
      for (const row of list) {
        if (row.facts?.complete !== true || row.facts.is_pull_request || row.facts.parent !== number) continue;
        rows.set(row.number, row.facts);
        if (tasks.has(row.number) && row.facts.sub_issues_total && !walk.includes(row.number)) walk.push(row.number);
      }
    }
    // The issues and PRs GitHub changed since the predecessor started (none to compare on a first pass).
    const changed = queued.since ? this.reader.changedSince(queued.since) : { issues: new Set(), prs: [], complete: true };
    const prChanged = new Set(changed.prs.map(pr => pr.number));
    const named = referencedIssues(changed.prs);
    const touched = number => {
      const doc = stored(number);
      return changed.issues.has(number) || (named.get(number) || []).length > 0
        || [doc?.pr?.number, ...(doc?.prs || []).map(pr => pr.number)].some(pr => pr && prChanged.has(pr));
    };
    // A page drawn from another revision than the stored one: a controller write leaves no trace
    // on GitHub, so the revision drawn on the page is the evidence.
    const drifted = number => {
      if (!rows.has(number) || !stored(number)) return false;
      const match = /State revision (\d+) \(issue-\d+\.json\)/.exec(rows.get(number).body || '');
      return !match || Number(match[1]) !== stored(number).revision;
    };
    // Open tracked PRs, twenty to a request: a task whose PR state, head or checks moved is read.
    const open = outcomes.filter(outcome => ['OPEN', 'DRAFT'].includes(stored(outcome.issue)?.pr?.state) && stored(outcome.issue).pr.number);
    const prCache = open.length ? this.reader.pullRequests(open.map(outcome => stored(outcome.issue).pr.number)) : new Map();
    const checksMoved = number => {
      const doc = stored(number);
      const pr = prCache.get(doc?.pr?.number);
      if (!pr) return false;
      const checks = evaluateChecks({ head: pr.head, rollupOid: pr.rollupOid, contexts: pr.contexts, complete: pr.complete, configured: this.binding.required_checks });
      return pr.state !== doc.pr.state || pr.head !== doc.pr.head || checks.state !== doc.pr.checks?.state;
    };
    const all = outcomes.map(outcome => outcome.issue);
    const share = new Set(all.filter(number => number % ROTATION_PASSES === queued.pass % ROTATION_PASSES));
    const reasons = [
      all.filter(number => stored(number)?.pending_effects?.length),
      all.filter(number => LIVE_GATE_STATES.includes(stored(number)?.gate?.state)),
      // No document yet, or no complete facts from a list: nothing shows whether it changed.
      all.filter(number => !stored(number) || !rows.has(number)),
      // Changed tasks newest change first (the list is read oldest first), then those changed through a PR.
      [...new Set([...[...(changed.order || changed.issues)].reverse().filter(number => tasks.has(number)), ...all.filter(touched)])], all.filter(drifted), all.filter(checksMoved),
      (queued.queue || []).filter(number => tasks.has(number)),
    ];
    // Without a saved queue (a first pass) every task is in scope; otherwise this pass's rotation share.
    const order = [...new Set([...reasons.flat(), ...(queued.since ? all.filter(number => share.has(number)) : all)])];
    const urgent = new Set(reasons.flat());
    this.sweepOrder = order;
    const discussion = this.discussion(parent.parent_issue, issues.get(parent.parent_issue), cache);
    const graph = this.listGraph(parent, outcomes);
    const closing = this.closing.scan(parent, graph, this.now, excludedGraphPr);
    this.pass.planning();
    this.pass.phaseAt('planning');
    const read = [], failed = [];
    const primed = { blockedBy: new Map(), tracked: new Map(), journals: new Map(), comments: new Map([[parent.parent_issue, discussion]]), prPages: new Map() };
    // A task with a reason to read (a change, an intent, a gate, no facts yet, a queued one), or any
    // task on a first pass, is likely to need its page drawn this pass, so its page is budgeted; a
    // rotation-only read rarely is.
    let pages = 0;
    this.pausedBy = null;
    for (const number of order) {
      const needsPage = !queued.since || urgent.has(number);
      if (!queued.canRead(pages, needsPage)) { this.pausedBy = queued.pausedBy?.() || null; break; }
      const doc = stored(number);
      const outcome = outcomes.find(entry => entry.issue === number);
      try {
        const issue = rows.get(number) || this.reader.issue(number);
        if (this.refreshFacts && issue && issue.complete !== true) throw new ProgrammeError('GH_FAILED', `Issue ${number} was not read completely.`);
        const blockers = issue?.blocked_by_total > 0 ? this.reader.blockedBy(number) : null;
        const tracked = doc?.pr?.number || (!isFinished(outcome, doc) && doc?.candidate?.branch ? this.reader.pullRequestForBranch(doc.candidate.branch) : null);
        const pr = tracked ? (prCache.has(tracked) ? prCache.get(tracked) : this.reader.pullRequest(tracked)) : null;
        const journals = doc && (doc.gate.assignment || Object.keys(doc.journals_seen || {}).length) ? this.readJournals(doc) : null;
        const list = !issue ? null : issue.comments === 0 ? [] : this.reader.comments(number);
        const prPages = new Map();
        for (const page of [pr && ['OPEN', 'DRAFT'].includes(pr.state) ? pr.number : null, ...(graph.openReferences.get(number) || [])]) {
          if (page && !prPages.has(page)) prPages.set(page, this.reader.issue(page));
        }
        // The task is observed only once every read of it has succeeded.
        if (issue) { rows.set(number, issue); issues.set(number, issue); }
        if (blockers) primed.blockedBy.set(number, blockers);
        primed.tracked.set(number, tracked || null);
        if (tracked) prCache.set(tracked, pr);
        if (journals) primed.journals.set(number, journals);
        if (list) primed.comments.set(number, list);
        for (const [page, facts] of prPages) primed.prPages.set(page, facts);
        read.push(number);
        if (needsPage) pages += 1;
      } catch (error) {
        if (!error.code || STOPS_PASS.has(error.code) || ['GH_AUTH', 'PASS_STOPPED'].includes(error.code)) throw error;
        failed.push(number);
      }
    }
    const left = order.filter(number => !read.includes(number) && !failed.includes(number));
    return { lists, graph, closing, read, prCache, ...primed,
      counts: { reused: all.length - read.length, reread: read.filter(number => !urgent.has(number)).length },
      result: { order, read, failed, left, changedComplete: changed.complete, changedCursor: changed.complete ? null : changed.cursor || null,
        why: Object.fromEntries(['intents', 'gates', 'unverified', 'changed', 'drifted', 'checks', 'queued'].map((name, at) => [name, reasons[at].length])) } };
  }

  // The PR lists and every task's links, for the queued pass's discovery. The per-task reads of the
  // graph (a confirmed merge, an older PR) happen later, only for the tasks read.
  listGraph(parent, outcomes) {
    let requests = 0;
    let pages = 0;
    const budget = DISCOVERY_BASE + Math.ceil(outcomes.length / 20);
    const spend = () => { if (requests >= budget) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', `PR discovery reached its ${budget}-request budget.`); requests++; };
    // List pages are counted apart: only the pass's own request budget stops them.
    const page = () => { pages++; };
    const watermark = parent.private?.graph_pr_watermark || null;
    const scanStarted = this.now();
    const list = status => {
      try { return { list: this.reader.graphPullRequests(status, page, status === 'closed' ? watermark : null), complete: true }; }
      catch (error) { if (error.code === 'GH_AUTH' || STOPS_PASS.has(error.code)) throw error; return { list: [], complete: false }; }
    };
    const open = list('open');
    const closed = list('closed');
    const all = outcomes.map(outcome => outcome.issue);
    const links = new Map();
    for (let start = 0; start < all.length; start += 20) {
      const batch = all.slice(start, start + 20);
      try { for (const [number, link] of this.reader.issuePullRequestLinks(batch, spend)) links.set(number, link); }
      catch (error) { if (error.code === 'GH_AUTH' || STOPS_PASS.has(error.code)) throw error; }
    }
    return { openListed: open.list, openComplete: open.complete, closedListed: closed.list, closedComplete: closed.complete,
      openReferences: referencedIssues(open.list), links, requests, pages, watermark, scanStarted };
  }

  // The parent's comments. With a copy from an earlier pass only the comments changed since its
  // bookmark are requested and laid over it. The result is used only when it accounts for exactly
  // the number of comments the issue itself reports, leaving out any posted after that issue read;
  // otherwise, and without a copy, every page is read.
  discussion(number, issue, cache) {
    if (!cache || typeof this.reader.commentsChanged !== 'function') return this.reader.comments(number);
    const since = cache.since();
    if (since && isInt(issue.comments) && Number.isFinite(Date.parse(issue.updated_at))) {
      const changed = this.reader.commentsChanged(number, since);
      const merged = require('./programme-read-cache.cjs').mergeComments(cache.discussion.comments, changed.comments);
      const later = merged.filter(comment => Date.parse(comment.created_at) > Date.parse(issue.updated_at)).length;
      if (merged.length - later === issue.comments) {
        const bookmark = changed.newest && Date.parse(changed.newest) > Date.parse(cache.discussion.bookmark) ? changed.newest : cache.discussion.bookmark;
        cache.setDiscussion(merged, bookmark);
        cache.counts.bookmark = 'used';
        return merged;
      }
    }
    const full = this.reader.commentsChanged(number);
    cache.setDiscussion(full.comments, full.newest);
    cache.counts.bookmark = 'full';
    return full.comments;
  }

  // A queued pass brings its lists and links already read (`pre`) and reads per task only for the
  // tasks in `scoped`; a task outside it adds its known PRs to the linked set and nothing else.
  discoverGraph(parent, outcomes, children, prs, prCache, readPr, scoped = null, pre = null) {
    const discovery = new Map(); const histories = new Map();
    const selectedPrs = new Map();
    // Take the boundary before any PR list read, never at planning completion: a close during
    // this scan must remain eligible on the next one.
    const scanStarted = pre ? pre.scanStarted : this.now();
    let requests = pre ? pre.requests : 0; let listsComplete = true; let listed = [];
    let pages = pre ? pre.pages : 0;
    const watermark = parent.private?.graph_pr_watermark || null;
    // The task links and the per-task reads share this budget, which grows with the board and the
    // tasks read; the list pages are counted apart and only the pass's request budget stops them.
    const budget = discoveryBudget(outcomes.length, scoped ? scoped.size : outcomes.length);
    const spend = () => { if (requests >= budget) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', `PR discovery reached its ${budget}-request budget.`); requests++; };
    const page = () => { pages++; };
    const incomplete = (numbers, error) => {
      if (error.code === 'GH_AUTH' || STOPS_PASS.has(error.code)) throw error;
      for (const number of numbers) discovery.set(number,{complete:false,detail:'PR discovery was incomplete; existing PR history is retained.'});
    };
    let openListed = []; let openComplete = true;
    let closedListed=[], closedComplete=true;
    if (pre) {
      ({ openListed, openComplete, closedListed, closedComplete } = pre);
      listed.push(...openListed, ...closedListed);
      if (!openComplete || !closedComplete) { incomplete(outcomes.map(outcome=>outcome.issue),{}); listsComplete=false; }
    } else {
      try { openListed = this.reader.graphPullRequests('open',page); listed.push(...openListed); }
      catch(error) { incomplete(outcomes.map(outcome=>outcome.issue),error); listsComplete=false; openComplete=false; }
      try { closedListed=this.reader.graphPullRequests('closed',page,watermark); listed.push(...closedListed); }
      catch(error) { incomplete(outcomes.map(outcome=>outcome.issue),error); listsComplete=false; closedComplete=false; }
    }
    const references = referencedIssues(listed);
    const openReferences = referencedIssues(openListed);
    const linked = new Set();
    // The parent's timeline can be arbitrarily long and is not task-discovery evidence.
    // Parent and task links in a PR's own title/body already identify it from the list reads.
    for (const number of [parent.parent_issue,...outcomes.map(outcome=>outcome.issue)]) {
      for (const pr of references.get(number) || []) linked.add(pr);
    }
    const all = outcomes.map(outcome=>outcome.issue);
    for (let start=0; start<all.length; start+=20) {
      const batch=all.slice(start,start+20);
      try {
        // Tasks added in this pass were not in the early read: their links are read now.
        const missing=pre ? batch.filter(number=>!pre.links.has(number)) : [];
        if (missing.length) for (const [number,link] of this.reader.issuePullRequestLinks(missing,spend)) pre.links.set(number,link);
        const links=pre ? pre.links : this.reader.issuePullRequestLinks(batch,spend);
        for (const number of batch) {
          const link=links.get(number);
          if (!link?.complete || !listsComplete) { incomplete([number],{}); continue; }
          const prior = children.get(number)?.doc?.prs || [];
          const history=[...link.history,...listed.filter(pr=>(references.get(number)||[]).includes(pr.number))];
          if (scoped && !scoped.has(number)) {
            for (const pr of [...history, ...prior, ...(children.get(number)?.doc?.pr?.number ? [children.get(number).doc.pr] : [])]) linked.add(pr.number);
            discovery.set(number, { complete: true, candidates: mergedSelection(history.filter(pr=>pr.state==='MERGED').map(pr=>({number:pr.number,merged_at:pr.merged_at}))) });
            continue;
          }
          const current=prs.get(number);
          if(current) {
            const listedCurrent=listed.find(pr=>pr.number===current.number);
            if(listedCurrent) history.push(listedCurrent);
          }
          // Incremental list reads omit old closes. Reconfirm a saved terminal PR not covered by
          // task links or the list, including its merge time so the saved order stays meaningful.
          try {
            for (const previous of prior.filter(pr=>pr.state !== 'OPEN')) {
              if (history.some(pr=>pr.number===previous.number)) continue;
              let item=listed.find(pr=>pr.number===previous.number);
              if (!item) {
                if (!prCache.has(previous.number)) spend();
                const pr=readPr(previous.number);
                item=pr && graphPr({...pr,merged:pr.state==='MERGED',mergedAt:pr.merged_at,mergeCommit:{oid:pr.merge_sha},repository:{nameWithOwner:this.binding.repository}},this.binding.repository);
              }
              if (!item) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE','A saved PR history entry could not be confirmed.');
              history.push(item);
            }
          } catch(error) { incomplete([number],error); continue; }
          history.forEach(pr=>linked.add(pr.number));
          histories.set(number,prHistory(history));
          const candidates=mergedSelection(history.filter(pr=>pr.state==='MERGED').map(pr=>({number:pr.number,merged_at:pr.merged_at})));
          const result={complete:true,candidates}; discovery.set(number,result);
          const outcome=outcomes.find(outcome=>outcome.issue===number);
          if(backfillEligible(outcome,children.get(number)?.doc) && !children.get(number)?.doc?.closed_by_sweep && candidates.length) {
            const selected=candidates[0].number;
            try {
              if(!prCache.has(selected)) spend();
              const pr=readPr(selected);
              if(pr?.state !== 'MERGED') throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE','Selected merged PR was not confirmed.');
              selectedPrs.set(number,pr);
              result.backfill={expected_pr:null,expected_completed:true,expected_retired:false,selected,candidates,reason:'Greatest merge time, then higher PR number on an exact timestamp tie.'};
            } catch(error) { incomplete([number],error); }
          }
        }
      } catch(error) { incomplete(batch,error); }
    }
    const complete = listsComplete && [...discovery.values()].every(entry=>entry.complete);
    for(const [number,pr] of selectedPrs) if(discovery.get(number)?.complete) prs.set(number,pr);
    const withoutTask = complete ? listed.filter(pr=> !excludedGraphPr(pr) && !linked.has(pr.number)
      && (pr.state==='OPEN' || watermark && Date.parse(pr.closed_at) > Date.parse(watermark))) : [];
    const holdWithoutTask = (parent.attention || []).filter(entry=>entry.code==='PR_WITHOUT_TASK' && !linked.has(entry.issue)
      && (!complete || !excludedGraphPr(listed.find(pr=>pr.number===entry.issue)))).map(entry=>entry.id);
    const advance = complete && (!watermark || listed.some(pr=>pr.closed_at && Date.parse(pr.closed_at)>Date.parse(watermark)));
    return {discovery,histories,openReferences,openListed,withoutTask,holdWithoutTask,complete,openComplete,advance,requests:requests+pages,pages,watermark,scanStarted,closedListed,closedComplete};
  }

  // Additional discovery reads share one hard budget. Ordinary tracking is outside this budget.
  // Caches and results belong to this observation only; unresolved tasks are retried next pass.
  discoverMerged(outcomes, prs, prCache, readPr) {
    const results = new Map();
    if (!outcomes.length) return results;
    let requests = 0;
    const spend = () => {
      if (requests >= 60) throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'Merged PR discovery reached its sixty-request budget.');
      requests += 1;
    };
    const incomplete = (numbers, error) => {
      if (error.code === 'GH_AUTH' || STOPS_PASS.has(error.code)) throw error;
      for (const number of numbers) results.set(number, { complete: false, detail: 'Merged PR discovery failed, was truncated or reached its read budget; retry reconciliation.' });
    };
    let merged;
    try { merged = this.reader.mergedPullRequests(spend); }
    catch (error) { incomplete(outcomes.map(outcome => outcome.issue), error); return results; }
    const references = referencedIssues(merged);
    const byNumber = new Map(merged.map(pr => [pr.number, pr]));
    // Finish every evidence batch before detail reads, so no winner is chosen from a partial set.
    for (let start = 0; start < outcomes.length; start += 20) {
      const numbers = outcomes.slice(start, start + 20).map(outcome => outcome.issue);
      try {
        for (const [number, links] of this.reader.issuePullRequestLinks(numbers, spend)) {
          if (!links.complete) { incomplete([number], {}); continue; }
          const candidates = mergedSelection([...links.candidates, ...(references.get(number) || []).map(pr => byNumber.get(pr))]);
          results.set(number, { complete: true, candidates });
        }
      } catch (error) { incomplete(numbers, error); }
    }
    for (const [number, discovery] of results) {
      if (!discovery.complete || !discovery.candidates.length) continue;
      const selected = discovery.candidates[0].number;
      try {
        if (!prCache.has(selected)) spend();
        const pr = readPr(selected);
        if (pr?.state !== 'MERGED') throw new ProgrammeError('PR_DISCOVERY_INCOMPLETE', 'The selected PR could not be confirmed as merged.');
        prs.set(number, pr);
        discovery.backfill = { expected_pr: null, expected_completed: true, expected_retired: false,
          selected, candidates: discovery.candidates,
          reason: 'Greatest merge time, then higher PR number on an exact timestamp tie.' };
      } catch (error) { incomplete([number], error); }
    }
    return results;
  }

  // Report-only: an open PR that says "Refs #n" (or Completes, Closes, Fixes, Resolves) for an open
  // outcome whose state tracks no PR and no branch. The controller confirms before recording it.
  diffUntracked(parent, docs, observed, only, findings) {
    for (const outcome of parent.outcomes) {
      if ((only && outcome.issue !== only) || (this.scope && !this.scope.has(outcome.issue))) continue;
      const doc = docs.get(outcome.issue);
      if (isFinished(outcome, doc) || doc?.pr?.number || doc?.candidate?.branch) continue;
      const numbers = observed.references.get(outcome.issue) || [];
      if (numbers.length) findings.push({ code: 'PR_UNTRACKED', issue: outcome.issue, detail: `open PR ${numbers.map(number => `#${number}`).join(', ')} references this outcome, but its state records no PR or branch; the controller confirms and records it with update --patch` });
    }
  }

  // Work queue: a task the graph shows IN PROGRESS that nothing is moving. Nothing moves it when it has
  // no live gate assignment, no holder on its state document, and no open or draft PR (tracked, in its
  // history, or naming it) updated in the last PR_STALE_HOURS. A stale open PR does not hide it, so work
  // parked behind a stalled PR surfaces. A task whose PRs have all merged or closed is TASK_MERGED_OPEN
  // after TASK_MERGED_OPEN_HOURS of quiet; any other idle task is TASK_IDLE after TASK_IDLE_HOURS. A task
  // waiting on the owner is left out: the owner already has it.
  diffIdle(parent, docs, observed, only, findings) {
    const now = Date.parse(this.now());
    const hour = 60 * 60 * 1000;
    for (const outcome of parent.outcomes) {
      if ((only && outcome.issue !== only) || (this.scope && !this.scope.has(outcome.issue))) continue;
      const doc = docs.get(outcome.issue);
      if (!doc || statusText(outcome, doc) !== 'IN PROGRESS' || doc.lifecycle === 'WAITING_OWNER') continue;
      if (LIVE_GATE_STATES.includes(doc.gate?.state) || doc.fence?.holder_prefix) continue;
      const open = [...new Set([
        ...(['OPEN', 'DRAFT'].includes(doc.pr?.state) ? [doc.pr.number] : []),
        ...(doc.prs || []).filter(pr => pr.state === 'OPEN').map(pr => pr.number),
        ...(observed.references.get(outcome.issue) || []),
      ])].filter(number => isInt(number, 1));
      // An open PR whose last update cannot be read counts as moving.
      const updated = number => Date.parse(observed.prUpdated?.get(number) || '');
      if (open.some(number => !Number.isFinite(updated(number)) || now - updated(number) < PR_STALE_HOURS * hour)) continue;
      const written = Date.parse(doc.volatile?.written_at || '');
      // A document with no write time is new in this pass or cannot be dated; neither is idle.
      if (!Number.isFinite(written)) continue;
      const comments = (observed.comments.get(outcome.issue) || []).filter(comment => !String(comment.body || '').includes('programme-trace intent='))
        .map(comment => Date.parse(comment.created_at)).filter(Number.isFinite);
      const latest = Math.max(written, ...comments);
      const closedPrs = [doc.pr, ...(doc.prs || [])].filter(pr => isInt(pr?.number, 1));
      const merged = !open.length && closedPrs.length > 0 && closedPrs.every(pr => ['MERGED', 'CLOSED'].includes(pr.state));
      const hours = merged ? TASK_MERGED_OPEN_HOURS : TASK_IDLE_HOURS;
      if (now - latest < hours * hour) continue;
      const since = new Date(latest).toISOString().slice(0, 16);
      const stale = open.length ? `; open PR ${open.map(number => `#${number}`).join(', ')} has not changed for over ${PR_STALE_HOURS} hours` : '';
      findings.push(merged
        ? { code: 'TASK_MERGED_OPEN', issue: outcome.issue, detail: `shown IN PROGRESS (${doc.lifecycle}) with every PR merged or closed and nothing working it since ${since}Z (over ${hours} hour${hours === 1 ? '' : 's'})` }
        : { code: 'TASK_IDLE', issue: outcome.issue, detail: `shown IN PROGRESS (${doc.lifecycle}) with no moving PR, no live gate assignment and no holder, and nothing on it has changed since ${since}Z (over ${hours} hours)${stale}` });
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
    const issue = observed.issues.get(outcome.issue);
    if (this.refreshFacts && issue && !issue.is_pull_request) child = copyIssueLifecycle(child, issue);
    if (observed.additions?.some(entry=>entry.issue === outcome.issue)) child.added_by_sweep = true;
    if (observed.prGraph?.discovery.get(outcome.issue)?.complete && observed.prGraph.histories.has(outcome.issue)) child.prs = observed.prGraph.histories.get(outcome.issue);
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
    const discovery = observed.discovery.get(issueNumber);
    const backfill = discovery?.backfill;
    if (discovery && !discovery.complete) findings.push({ code: 'PR_DISCOVERY_INCOMPLETE', issue: issueNumber, detail: discovery.detail });
    else if (discovery && !backfill && backfillEligible(outcome,existing) && !existing?.closed_by_sweep && !discovery.candidates?.length) findings.push({ code: 'COMPLETED_PR_MISSING', issue: issueNumber, detail: 'Complete discovery found no matching merged PR. Controller: check the completed task references.' });
    if (!issue || issue.is_pull_request) {
      findings.push({ code: 'ISSUE_MISSING', issue: issueNumber, detail: issue ? 'the number is a pull request' : 'the issue could not be read' });
      return;
    }
    if (!existing) effects.push({ kind: 'create_state', target: { issue: issueNumber }, doc: desired, ...(backfill ? { backfill } : {}) });
    else {
      const fields = Object.keys({ ...existing, ...desired }).filter(key => !['revision', 'volatile', 'pending_effects', ...(this.refreshFacts ? CLOSE_FIELDS : [])].includes(key)
        && JSON.stringify(canonical(existing[key])) !== JSON.stringify(canonical(desired[key])));
      if (fields.length) effects.push({ kind: 'update_state', target: { issue: issueNumber }, fields, doc: desired, ...(journals ? { journals } : {}), ...(backfill ? { backfill } : {}) });
    }
    const start = existing || newChild({repository:this.binding.repository,outcome});
    if (this.refreshFacts && CLOSE_FIELDS.some(key=>JSON.stringify(start[key]) !== JSON.stringify(desired[key]))) {
      effects.push({kind:'copy_child_lifecycle',target:{issue:issueNumber}});
      if (issue.state === 'open' && start.closed_by_sweep) findings.push({code:'CHILD_REOPENED',issue:issueNumber});
    }
    if (this.refreshFacts && desired.closed_by_sweep && desired.lifecycle === 'DONE' && !completionAccepted(desired)) findings.push({code:'CLOSED_WITHOUT_ACCEPTANCE',issue:issueNumber});
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
    if (this.refreshFacts && !desired.closed_by_sweep && TERMINAL_LIFECYCLES.includes(desired.lifecycle) && issue.state === 'closed'
      && desired.lifecycle !== (String(issue.state_reason || '').toUpperCase() === 'COMPLETED' ? 'DONE' : 'RETIRED')) {
      findings.push({code:'CHILD_STATE_CONFLICT',issue:issueNumber,detail:`controller state ${desired.lifecycle} disagrees with the issue close reason; the controller lifecycle is kept`});
    }
    if ((desired.lifecycle === 'DONE' || this.refreshFacts && desired.lifecycle === 'RETIRED') && issue.state === 'open') findings.push({ code: 'CHILD_STATE_CONFLICT', issue: issueNumber, detail: `the state document says ${desired.lifecycle} but the issue is open` });
    if (!['DONE', 'RETIRED'].includes(desired.lifecycle) && issue.state === 'closed') findings.push({ code: 'CHILD_STATE_CONFLICT', issue: issueNumber, detail: `the issue is closed but the state document says ${desired.lifecycle}` });
    if (pr?.state === 'MERGED' && !TERMINAL_LIFECYCLES.includes(desired.lifecycle) && !completionAccepted(desired)) {
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
    return renderNavBlockBody(this.chainFor(parent, number), docs.get(number)?.pr?.number || null);
  }

  // The programme parent, any catalogued parents in between, then the task.
  chainFor(parent, number) {
    const outcomes = new Map(parent.outcomes.map(outcome => [outcome.issue, outcome]));
    const chain = [number];
    const seen = new Set(chain);
    for (let at = outcomes.get(number)?.parent; at && at !== parent.parent_issue && outcomes.has(at) && !seen.has(at); at = outcomes.get(at).parent) {
      chain.unshift(at);
      seen.add(at);
    }
    chain.unshift(parent.parent_issue);
    return chain;
  }

  renderAll(parent, children, issues, comments) {
    const outcomes = new Map(parent.outcomes.map(outcome => [outcome.issue, outcome]));
    const blocks = new Map([[parent.parent_issue, renderParentBlockBody(parent, children, issues, comments)]]);
    for (const child of children.values()) blocks.set(child.issue, renderChildBlockBody(child, outcomes.get(child.issue)));
    return blocks;
  }

  // The decision-trace audit on the parent and each catalogued issue whose body this pass does not
  // rewrite with a fresh comment trace. Report only.
  auditTraces(parent, observed, only, findings, effects) {
    const numbers = (only ? [only, parent.parent_issue] : [parent.parent_issue, ...parent.outcomes.map(outcome => outcome.issue)]).filter(number => !this.scope || number === parent.parent_issue || this.scope.has(number));
    const traced = new Set(effects.filter(effect => effect.kind === 'replace_block').map(effect => effect.target.issue));
    for (const number of numbers) {
      const issue = observed.issues.get(number);
      if (!issue || traced.has(number)) continue;
      const result = auditDecisionTraces({ body: issue.body, comments: observed.comments.get(number) || [], recordPrefix: this.binding.record_prefix, threshold: this.threshold, repository: this.binding.repository, issue: number });
      if (result.index_errors.length) findings.push({ code: 'TRACE_UNLINKED', issue: number, detail: indexErrorText(result.index_errors) });
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
  projectBody(number, source, stateBody, comments, version, navBody = null, currentBody = null, topic = null, topicCommentBudget = MAX_TOPIC_COMMENTS_PER_PASS, page = null) {
    if (number === this.binding.parent_issue) return this.projectParentPage(number, source, stateBody, comments, version, navBody, currentBody, topic, topicCommentBudget, page);
    return this.projectTrace(number, source, stateBody, comments, version, navBody, currentBody, topic, topicCommentBudget, { relay: page?.relay === true });
  }

  // Whether a task page may be re-laid into the fixed order: only an open task, and never a page
  // holding a secret-shaped value (its copy could not be saved). `reason` is set for a refusal the
  // controller should hear about.
  taskRelay(number, page) {
    if (number === this.binding.parent_issue || !page || page.is_pull_request) return { relay: false, reason: null };
    if (page.state !== 'open') {
      // A closed task keeps its text where it is; one already in the fixed order stays in it.
      try { return { relay: pageLayout().inOrder(page.body), reason: null }; }
      catch (error) { if (error.code !== 'PAGE_LAYOUT_HELD') throw error; return { relay: false, reason: null }; }
    }
    const errors = [];
    screenSecrets(errors, page.body, 'page');
    return errors.length ? { relay: false, reason: 'the page holds a secret-shaped value, so no copy of it can be saved' } : { relay: true, reason: null };
  }

  // Marked notes (`## Archive`) leave the page only on a full pass, and only when the whole move fits
  // this pass: otherwise the page is projected with the notes still on it. `noteKeys` names the
  // current area's parts either way, so their pending comments are kept for the next pass.
  projectParentPage(number, source, stateBody, comments, version, navBody, currentBody, topic, postBudget, page) {
    let scan = page?.only ? { kind: 'none' } : archiveTools().noteArea(source);
    if (scan.kind === 'area' && secretShaped(source)) scan = { kind: 'unsafe', reason: 'secret_like' };
    // The saved copy must be the page byte for byte, so a page that UTF-8 cannot carry moves nothing.
    if (scan.kind === 'area' && Buffer.from(source, 'utf8').toString('utf8') !== source) scan = { kind: 'unsafe', reason: 'control_character' };
    // A comment set aside for this exact text is used again only while it still reads as written.
    // Otherwise nothing is posted for the same text again: a host that alters it would alter it each pass.
    if (scan.kind === 'area' && (page?.parent?.page_archive || []).some(entry => entry.kind === 'note' && entry.state === 'withdrawn' && entry.comment_id
      && scan.parts.some(part => part.key === entry.key) && !(comments || []).some(comment => comment.id === entry.comment_id && archiveTools().digest(comment.body) === entry.digest))) scan = { kind: 'unsafe', reason: 'comment_not_exact' };
    const noteKeys = scan.kind === 'area' ? scan.parts.map(part => part.key) : [];
    // A pass that stopped for time finishes its redraw but moves no notes: they wait for a full pass.
    if (scan.kind === 'area' && !page?.keepNotes) {
      const cut = this.projectParentLayout(number, source, stateBody, comments, version, navBody, currentBody, topic, postBudget, page, scan);
      if (!cut.refused && cut.budgetFits && cut.body.length < this.threshold) return { ...cut, noteKeys, noteCut: true };
    }
    const kept = this.projectParentLayout(number, source, stateBody, comments, version, navBody, currentBody, topic, postBudget, page, null);
    return { ...kept, noteKeys, ...(scan.kind === 'unsafe' ? { noteUnsafe: scan.reason } : {}) };
  }

  projectParentLayout(number, fullSource, stateBody, comments, version, navBody, currentBody, topic, postBudget, page, notes) {
    const archive = page?.parent?.page_archive || [];
    const source = notes ? fullSource.slice(0, notes.start) + fullSource.slice(notes.end) : fullSource;
    const date = sgtDate(this.now());
    const noteParts = (notes?.parts || []).map(part => ({ ...part, title: archive.find(entry => entry.key === part.key)?.title
      || `Notes archived ${date} (part ${part.key.split('-').at(-1)} of ${notes.parts.length})` }));
    const rowLines = stateBody.split('\n').filter(line => /^\|[^\n]*\|#\d+\|/.test(line));
    const rows = rowLines.map(text => { const cells = text.split('|'); return { text, issue: Number(cells[3].slice(1)), group: ['RETIRED', 'COMPLETED'].includes(cells[6]) ? cells[6] : cells[5] }; });
    const candidates = archiveTools().GROUPS.flatMap(group => {
      const list = rows.filter(row => row.group === group);
      return ['RETIRED', 'COMPLETED'].includes(group) ? list : list.sort((a, b) => a.issue - b.issue);
    });
    const moved = [];
    let tracePaging = false;
    const safe = Math.min(SAFE_LIMIT, this.threshold);
    const build = () => {
      const selected = new Set(moved.map(row => row.issue));
      const graphs = archiveTools().graphComments(rows.filter(row => selected.has(row.issue)));
      // Empty parts remain registered and are updated in place, never deleted or linked as rows.
      for (const entry of archive.filter(entry => entry.kind === 'graph' && !graphs.some(part => part.key === entry.key))) {
        graphs.push({ key: entry.key, kind: 'graph', group: entry.group, title: entry.group,
          body: `${archiveTools().marker(entry.key)}\n# Programme graph: ${entry.group}\n\nNo rows are archived in this part.\n`, count: 0 });
      }
      const parts = [...graphs, ...noteParts];
      const posts = parts.filter(part => !archive.some(entry => entry.key === part.key && entry.comment_id)).length;
      const entryFor = part => archive.find(entry => entry.key === part.key);
      const commentId = part => entryFor(part)?.comment_id || '9'.repeat(19);
      const link = part => commentLink(issueUrl(this.binding.repository, number), commentId(part));
      const summary = archiveTools().GROUPS.map(group => {
        const parts = graphs.filter(part => part.group === group && part.count);
        const count = parts.reduce((sum, part) => sum + part.count, 0);
        const label = ['RETIRED', 'COMPLETED'].includes(group) ? group.toLowerCase() : group;
        return count ? `[${count} ${label}](${link(parts[0])})${parts.slice(1).map((part, i) => ` [part ${i + 2}](${link(part)})`).join('')}` : null;
      }).filter(Boolean);
      const hidden = new Set(moved.map(row => row.issue));
      let graph = stateBody.split('\n').filter(line => !/^\|[^\n]*\|#\d+\|/.test(line) || !hidden.has(Number(line.split('|')[3].slice(1)))).join('\n');
      if (summary.length) graph = graph.replace('\n| Task |', `\nArchived: ${summary.join(', ')}\n\n| Task |`);
      // Moved notes stay listed from the registry; the current area's parts follow them.
      const listed = [...archive.filter(entry => entry.kind === 'note' && entry.state === 'moved' && entry.comment_id && !noteParts.some(part => part.key === entry.key))
        .map(entry => ({ title: entry.title, link: commentLink(issueUrl(this.binding.repository, number), entry.comment_id) })),
      ...noteParts.map(part => ({ title: part.title, link: link(part) }))];
      const context = renderContextBlockBody(number, comments, this.binding.repository, listed);
      const remainingBudget = Math.min(Math.max(0, postBudget - posts), page?.traceTopicBudget ?? MAX_TOPIC_COMMENTS_PER_PASS);
      // Include future archive links in size selection, before spending their post slots. Otherwise
      // their own trace growth could require another graph group after the budget was spent.
      const future = parts.filter(part => !entryFor(part)?.comment_id).map((part, index) => ({ id: `${'9'.repeat(15)}${String(index).padStart(4, '0')}`, body: archiveTools().marker(part.key), user: { login: 'archive-preview' } }));
      const projected = this.projectTrace(number, source, graph, [...comments, ...future], version, navBody, currentBody, topic, remainingBudget,
        { context, contextId: contextCommentId(comments), threshold: tracePaging ? safe : Infinity });
      const tracePosts = projected.overflow.reduce((sum, part) => sum + indexCommentBodies(number, part.lines, '0'.repeat(16), part.tag, part.label, part.directory).length, 0);
      return { ...projected, archive: parts, graphRows: moved.map(row => row.issue), posts: posts + tracePosts,
        budgetFits: posts + tracePosts <= postBudget };
    };
    let projected = build();
    let feasible = projected.budgetFits ? projected : null;
    const rememberFeasible = () => {
      if (projected.budgetFits && (!feasible || projected.body.length < feasible.body.length)) feasible = projected;
    };
    // Single-issue passes may only use archives already recorded and verified by a full pass.
    if (page?.only) {
      for (const row of candidates) {
        const registered = archive.filter(entry => entry.kind === 'graph' && entry.group === row.group && entry.state === 'moved');
        if (registered.some(entry => comments.some(comment => comment.id === entry.comment_id && comment.user?.login === entry.login && archiveTools().digest(comment.body) === entry.digest && comment.body.split('\n').includes(row.text)))) moved.push(row);
      }
      projected = build();
      return { ...projected, overflow: [], archive: [] };
    }
    let hard = projected.body.length < this.threshold && projected.budgetFits ? projected : null;
    if (projected.body.length < safe && projected.budgetFits) return projected;
    for (const group of archiveTools().GROUPS) {
      if (group === 'OPTIONAL') {
        tracePaging = true; projected = build();
        rememberFeasible();
        if (!hard && projected.body.length < this.threshold && projected.budgetFits) hard = projected;
        if (projected.body.length < safe && projected.budgetFits) return projected;
      }
      for (const row of candidates.filter(row => row.group === group)) {
        moved.push(row); projected = build();
        rememberFeasible();
        if (!hard && projected.body.length < this.threshold && projected.budgetFits) hard = projected;
        if (projected.body.length < safe && projected.budgetFits) return projected;
      }
    }
    if (hard) return { ...hard, nearLimit: hard.body.length >= safe };
    // Diagnostics describe the smallest body that this pass could actually publish, rather than
    // a hypothetical body requiring more than five new comments.
    return { ...(feasible || projected), refused: true };
  }

  projectTrace(number, source, stateBody, comments, version, navBody = null, currentBody = null, topic = null, topicCommentBudget = MAX_TOPIC_COMMENTS_PER_PASS, layout = {}) {
    const threshold = layout.threshold ?? this.threshold;
    const trace = withoutContextComment(traceEntries(comments, this.binding.record_prefix, this.binding.repository, number), layout.contextId);
    const build = entries => {
      const traceBody = renderTraceBlockBody(number, entries, this.binding.repository, topic, number === this.binding.parent_issue);
      let layoutHold = null;
      if (layout.relay) {
        // A task page: generated blocks first, then the spec sections, then everything else.
        try {
          const laid = pageLayout().layoutTaskPage(source, [[NAV_BLOCK_NAME, navBody], [BLOCK_NAME, stateBody], [TRACE_BLOCK_NAME, traceBody]].filter(([, body]) => body), version);
          assertBlocksReadBack(laid.body, [[NAV_BLOCK_NAME, navBody], [BLOCK_NAME, stateBody], [TRACE_BLOCK_NAME, traceBody]], `#${number}`);
          return { body: laid.body, traceBody, moved: false, relaid: true, moves: laid.moves };
        } catch (error) {
          if (error.code !== 'PAGE_LAYOUT_HELD') throw error;
          layoutHold = error.reason;
        }
      }
      const withCurrent = currentBody ? upsertCurrentBlock(source, renderBlock(currentBody, version, CURRENT_BLOCK_NAME), this.placementFor(number).after_section) : source;
      const withState = layout.context ? upsertParentStateBlock(withCurrent, renderBlock(stateBody, version), this.placementFor(number))
        : upsertStateBlock(withCurrent, renderBlock(stateBody, version), this.placementFor(number));
      const withNav = navBody ? upsertNavBlock(withState.body, renderBlock(navBody, version, NAV_BLOCK_NAME)) : withState.body;
      const withContext = layout.context ? upsertContextBlock(withNav, renderBlock(layout.context, version, CONTEXT_BLOCK_NAME)) : withNav;
      const body = assertBlocksReadBack(upsertTraceBlock(withContext, renderBlock(traceBody, version, TRACE_BLOCK_NAME)),
        [[CURRENT_BLOCK_NAME, currentBody], [BLOCK_NAME, stateBody], [NAV_BLOCK_NAME, navBody], [CONTEXT_BLOCK_NAME, layout.context], [TRACE_BLOCK_NAME, traceBody]], `#${number}`);
      return { body, traceBody, moved: withState.moved, ...(layoutHold ? { layoutHold } : {}) };
    };
    const full = build(trace);
    if (full.body.length < threshold) return { ...full, overflow: [] };
    // Try the largest topic lists first within the notification budget. If that cannot fit, discard
    // all speculative topic moves and page the original topic lines together, one line per topic.
    const base = issueUrl(this.binding.repository, number);
    const links = group => traceTokens({ ...group, indexes: [] }, base);
    const size = group => links(group).join(' · ').length;
    const movable = traceGroups(trace, topic).filter(group => group.entries.length || group.marks.length).sort((a, b) => size(b) - size(a));
    let current = trace;
    let projected = full;
    const overflow = [];
    let topicComments = 0;
    for (const group of movable) {
      const part = { tag: group.tag, label: group.tag ? group.label : topic, lines: links(group) };
      const pages = indexCommentBodies(number, part.lines, '0'.repeat(16), part.tag, part.label);
      if (topicComments + pages.length > topicCommentBudget) break;
      topicComments += pages.length;
      current = {
        directories: current.directories,
        indexes: [...current.indexes, ...pages.map(() => ({ id: '9'.repeat(19), tag: group.tag, tag_label: group.label, date: '0000-00-00' }))],
        entries: current.entries.filter(entry => topicKey(entry, topic) !== group.tag),
        marks: current.marks.filter(mark => topicKey(mark, topic) !== group.tag),
      };
      overflow.push(part);
      projected = build(current);
      if (projected.body.length < threshold) break;
    }
    if (projected.body.length >= threshold) {
      // Topic links can themselves fill the page. Page that directory, preserving every topic
      // line and leaving only root links. Existing directories are never nested in new ones.
      overflow.length = 0;
      const lines = traceGroups(trace, topic).map(group => `- **${groupLabel(group, topic)}:** ${traceTokens(group, base).join(' · ')}`);
      if (lines.length) {
        const pages = indexCommentBodies(number, lines, '9'.repeat(16), null, null, true);
        projected = build({ directories: [...(trace.directories || []), ...pages.map(() => ({ id: '9'.repeat(19) }))], indexes: [], entries: [], marks: [] });
        const nested = trace.indexes.find(index => index.nested);
        if (projected.body.length < threshold && nested) throw new ProgrammeError('TRACE_INDEX_INVALID', `Paging this comment directory would exceed two index hops (index ${nested.id}). ${indexRecoveryText(['INDEX_DEPTH'])}`);
        overflow.push({ directory: true, tag: null, lines });
      }
    }
    const pageCount = trace.strict_count
      + overflow.reduce((count, part) => count + indexCommentBodies(number, part.lines, '0'.repeat(16), part.tag, part.label, part.directory).length, 0);
    if (overflow.reduce((count, part) => count + indexCommentBodies(number, part.lines, '0'.repeat(16), part.tag, part.label, part.directory).length, 0) > MAX_TOPIC_COMMENTS_PER_PASS) {
      return { ...full, overflow: [], refused: full.body.length >= this.threshold };
    }
    if (projected.body.length < threshold && pageCount > MAX_INDEX_COMMENTS) throw new ProgrammeError('TRACE_INDEX_INVALID', `The comment trace would exceed ${MAX_INDEX_COMMENTS} index pages. ${indexRecoveryText(['INDEX_LIMIT'])}`);
    return { ...projected, overflow };
  }

  // Every open or draft PR that names a catalogued task (the task's tracked PR, or a PR whose text
  // says Refs or Closes for it) starts with a PATH block and a STATUS block. The PR's own
  // description is left as written below them, and a merged or closed PR is never edited.
  prPageBodies(parent, docs, pr, issues, head) {
    const chains = issues.map(issue => this.chainFor(parent, issue));
    return { nav: renderPrNavBlockBody(chains, pr), status: renderPrStatusBlockBody(pr, head, issues.map(issue => ({ issue, child: docs.get(issue) || null }))) };
  }

  prTasks(parent, docs, observed, only = null) {
    const tasks = new Map();
    const add = (pr, issue) => { if (!tasks.has(pr)) tasks.set(pr, []); if (!tasks.get(pr).includes(issue)) tasks.get(pr).push(issue); };
    for (const outcome of parent.outcomes) {
      const doc = docs.get(outcome.issue);
      if (doc?.pr?.number && ['OPEN', 'DRAFT'].includes(doc.pr.state)) add(doc.pr.number, outcome.issue);
      for (const pr of observed.references?.get(outcome.issue) || []) add(pr, outcome.issue);
    }
    if (only) for (const [pr, issues] of tasks) if (!issues.includes(only)) tasks.delete(pr);
    return tasks;
  }

  prHead(docs, observed, pr, issues) {
    const tracked = issues.map(issue => docs.get(issue)?.pr).find(entry => entry?.number === pr && isSha(entry.head));
    return tracked?.head || observed.prHeads?.get(pr) || null;
  }

  diffPrPages(parent, docs, observed, only, effects) {
    for (const [pr, issues] of this.prTasks(parent, docs, observed, only)) {
      const page = observed.prPages?.get(pr);
      if (!page || !page.is_pull_request || page.state !== 'open') continue;
      const nav = findStateBlock(page.body, NAV_BLOCK_NAME);
      const status = findStateBlock(page.body, BLOCK_NAME);
      if (nav.error || status.error) continue;
      const bodies = this.prPageBodies(parent, docs, pr, issues, this.prHead(docs, observed, pr, issues));
      const same = (found, body) => Boolean(found.block) && normalizeBlockBody(found.block.body) === normalizeBlockBody(body) && !found.block.tampered;
      if (same(nav, bodies.nav) && same(status, bodies.status)) continue;
      effects.push({ kind: 'replace_pr_nav', target: { issue: issues[0], pr, digest: blockDigest(bodies.nav), status: blockDigest(bodies.status) }, body: bodies.nav, status_body: bodies.status });
    }
  }

  diffBlocks(parent, children, observed, only, effects, findings, holds, targetsOverride = null, resolutions = []) {
    const blocks = this.renderAll(parent, children, observed.issues, observed.comments);
    const version = this.toolkitVersion || '0.0.0';
    const requested = targetsOverride || (only ? [only, parent.parent_issue] : this.scope ? [...blocks.keys()].filter(number => number === parent.parent_issue || this.scope.has(number)) : [...blocks.keys()]);
    const targets = [...requested.filter(number => number !== parent.parent_issue), ...requested.filter(number => number === parent.parent_issue)];
    if (!targetsOverride) this.diffPrPages(parent, children, observed, only, effects);
    for (const number of targets) {
      const issue = observed.issues.get(number);
      const body = blocks.get(number);
      if (!issue || body === undefined) continue;
      const { block, error } = findStateBlock(issue.body);
      const traced = findStateBlock(issue.body, TRACE_BLOCK_NAME);
      const nav = findStateBlock(issue.body, NAV_BLOCK_NAME);
      if (error || traced.error || nav.error) { findings.push({ code: 'MANAGED_BLOCK_BROKEN', issue: number, detail: error || traced.error || nav.error }); continue; }
      const navBody = this.navFor(parent, number, children);
      const currentBody = number === parent.parent_issue ? renderCurrentBlockBody(parent, children, observed.issues, this.now(), this.boardLine(parent)) : null;
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
      const comments = observed.comments.get(number) || [];
      const placement = this.placementFor(number);
      const current = block && normalizeBlockBody(block.body) === normalizeBlockBody(body) && !block.tampered;
      // A page that is re-laid has no separate place for its state block.
      const relay = this.taskRelay(number, issue);
      const move = !relay.relay && Boolean(block) && upsertStateBlock(issue.body, renderBlock(block.body, block.version), placement).moved;
      const topic = this.topicFor(parent, number, observed.issues);
      let traceBody;
      try {
        const trace = traceEntries(comments, this.binding.record_prefix, this.binding.repository, number);
        traceBody = renderTraceBlockBody(number, number === this.binding.parent_issue ? withoutContextComment(trace, contextCommentId(comments)) : trace, this.binding.repository, topic, number === this.binding.parent_issue);
      }
      catch (error) { if (!error.code) throw error; holds.push({ code: error.code, target: `#${number}`, detail: error.message, scope: 'body' }); continue; }
      const traceCurrent = Boolean(traced.block) && normalizeBlockBody(traced.block.body) === normalizeBlockBody(traceBody) && !traced.block.tampered;
      // Dry runs include the time change on the document that holds each effect's intent.
      const timeWillChange = number === parent.parent_issue && parent.outcomes.some(outcome => graphClass(outcome, children.get(outcome.issue)) === 'NOW'
        && resolutions.some(entry => entry.kind === 'child' && entry.number === outcome.issue && entry.outcome !== 'UNKNOWN'));
      // A current body at or over the threshold still moves its largest tag lists out.
      // An open task page is re-laid into the fixed order; a closed one keeps its text where it is.
      // The plan asks the layout itself, with this pass's blocks, so it never plans a lay-out the
      // write would then refuse: a page the layout holds keeps its order and raises its finding.
      let ordered = true;
      let reason = relay.reason;
      if (relay.relay) {
        try {
          pageLayout().layoutTaskPage(issue.body, [[NAV_BLOCK_NAME, navBody], [BLOCK_NAME, body], [TRACE_BLOCK_NAME, traceBody]].filter(([, text]) => text), version);
          ordered = pageLayout().inOrder(issue.body);
        } catch (error) { if (error.code !== 'PAGE_LAYOUT_HELD') throw error; reason = error.reason; }
      }
      if (reason && number !== parent.parent_issue && issue.state === 'open' && !issue.is_pull_request) findings.push({ code: 'PAGE_LAYOUT_HELD', issue: number, detail: `the page was not re-laid: ${reason}` });
      if (number !== parent.parent_issue && current && !move && ordered && traceCurrent && navCurrent && currentCurrent && !timeWillChange && issue.body.length < this.threshold) continue;
      if (!ordered) findings.push({ code: 'PROJECTION_STALE', issue: number, detail: 'the page is not in the fixed section order' });
      if (!current || move) findings.push({ code: 'PROJECTION_STALE', issue: number, detail: !block ? 'no state block yet' : block.tampered ? 'the block was edited by hand' : current ? 'the block is not in its place on the page' : 'the block differs from the state documents' });
      if (!traceCurrent) findings.push({ code: 'TRACE_STALE', issue: number, detail: !traced.block ? 'no comment trace yet' : traced.block.tampered ? 'the comment trace was edited by hand' : 'the comment trace differs from the comments' });
      if (!navCurrent) findings.push({ code: 'PROJECTION_STALE', issue: number, detail: nav.block ? 'the parent and task links differ from the state' : 'no parent and task links yet' });
      if (!currentCurrent) findings.push({ code: 'PROJECTION_STALE', issue: number, detail: summary.block ? 'the CURRENT summary differs from the state documents' : 'no CURRENT summary yet' });
      let projected;
      const topicBudget = Math.max(0, MAX_TOPIC_COMMENTS_PER_PASS - effects.filter(effect => effect.kind === 'post_index_comment' && !effect.target.directory).reduce((count, effect) => count + effect.target.parts.length, 0));
      try { projected = this.projectBody(number, issue.body, body, comments, version, navBody, currentBody, topic, number === parent.parent_issue ? MAX_TOPIC_COMMENTS_PER_PASS : topicBudget, { parent, only, traceTopicBudget: topicBudget, relay: relay.relay }); }
      catch (error) {
        if (!error.code) throw error;
        holds.push({ code: error.code, target: `#${number}`, detail: error.message, scope: 'body', ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }); continue;
      }
      if (projected.refused || projected.body.length >= this.threshold) {
        const diagnostics = bodySizeDiagnostics(projected.body, this.threshold);
        const finding = { code: 'BODY_TOO_LARGE', issue: number, diagnostics, detail: 'The projected page reaches the redraw threshold' };
        const previous = findings.find(entry => entry.code === finding.code && entry.issue === number);
        if (previous) Object.assign(previous, finding); else findings.push(finding);
        holds.push({ code: 'BODY_TOO_LARGE', target: `#${number}`, detail: `Controller: the body would reach ${projected.body.length} characters (threshold ${this.threshold}) even with its comment trace in an index comment; shorten it first`, scope: 'body', diagnostics });
        continue;
      }
      if (projected.nearLimit) findings.push({ code: 'BODY_NEAR_LIMIT', issue: number, diagnostics: bodySizeDiagnostics(projected.body, Math.min(SAFE_LIMIT, this.threshold)), detail: 'The projected page fits the hard limit but has lost its safe headroom' });
      const archiveEffects = (projected.archive || []).filter(part => !parent.page_archive?.some(entry => entry.key === part.key && entry.digest === archiveTools().digest(part.body) && entry.comment_id));
      if (projected.noteUnsafe) findings.push({ code: 'ARCHIVE_SECTION_UNSAFE', issue: number, diagnostics: { reason: projected.noteUnsafe }, detail: 'The marked Archive section cannot be moved safely' });
      const activeArchives = number === parent.parent_issue ? (parent.page_archive || []).filter(entry => entry.comment_id && entry.state !== 'withdrawn') : [];
      const archiveNeedsRecovery = activeArchives.some(entry => {
        const comment = comments.find(comment => comment.id === entry.comment_id);
        const damaged = !comment || comment.user?.login !== entry.login || archiveTools().digest(comment.body) !== entry.digest;
        // A moved note's damaged comment is reported once and then left alone, unless the same
        // notes are back under the marker: then a full pass posts a fresh comment for them.
        if (entry.kind === 'note' && entry.state === 'moved') {
          const reported = archiveUntrusted(entry, entry.comment_id);
          return reported ? (projected.noteKeys || []).includes(entry.key) : damaged;
        }
        if (archiveUntrusted(entry, entry.comment_id)) return true;
        return damaged;
      });
      if (number === parent.parent_issue && projected.body === issue.body && !archiveEffects.length && !timeWillChange && !archiveNeedsRecovery) continue;
      for (const part of archiveEffects) effects.push({ kind: parent.page_archive?.some(entry => entry.key === part.key && entry.comment_id) ? 'edit_archive_comment' : 'post_archive_comment', target: { issue: number, key: part.key } });
      for (const part of projected.overflow) effects.push(indexEffect(number, part, String(comments.at(-1)?.id || '')));
      effects.push({ kind: 'replace_block', target: { issue: number, digest: blockDigest(body), trace: blockDigest(projected.traceBody), ...(navBody ? { nav: blockDigest(navBody) } : {}), ...(currentBody ? { current: blockDigest(currentBody) } : {}) },
        insert: !block, move: current && move && ordered, state: !current || move, relay: Boolean(projected.relaid && projected.moves), stale: { trace: !traceCurrent, nav: !navCurrent, current: !currentCurrent }, body, updated_at: issue.updated_at });
    }
  }

  archiveTrust(entry) {
    const comment = this.reader.archiveComment(entry.comment_id);
    if (!comment) return { reason: 'missing' };
    if (comment.id !== entry.comment_id || comment.user?.login !== entry.login
      || String(comment.issue_url).toLowerCase() !== `https://api.github.com/repos/${this.binding.repository}/issues/${this.binding.parent_issue}`.toLowerCase()) return { comment, reason: 'foreign' };
    return { comment, reason: archiveTools().digest(comment.body) === entry.digest ? null : 'changed' };
  }

  // Resolve pending effects left by an earlier pass by reading their targets. Nothing is replayed
  // without that read; an unreadable target stays UNKNOWN and holds.
  recover(docs, observed, holds) {
    const resolutions = [];
    for (const { kind, number, doc } of docs) {
      for (const effect of doc.pending_effects) {
        let done = null;
        let recoveredId = null, untrusted = null, rejectedArchive = null;
        const target = effect.target;
        if (effect.kind === 'post_closing_backstop') {
          try {
            const item=this.closing.item(target.kind,target.issue);
            const result=this.closing.comments(item);
            done=result.complete ? Boolean(result.facts || result.story) : null;
          } catch(error) { if (STOPS_PASS.has(error.code)) throw error; done=null; }
        } else if (effect.kind === 'set_parent_state') {
          try { const issue = this.reader.issue(target.issue); done = issue ? issue.state === target.state : null; } catch { done = null; }
        } else if (effect.kind === 'post_parent_repair') {
          try { done = this.reader.comments(target.issue).some(comment => comment.body.includes(target.marker)); } catch { done = null; }
        } else if (effect.kind === 'attach' || effect.kind === 'reparent') {
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
            && (!target.body_digest || sha256(issue.body) === target.body_digest)
            && (!target.nav || (nav && blockDigest(nav.body) === target.nav))
            && (!target.context || Boolean(findStateBlock(issue.body, CONTEXT_BLOCK_NAME).block && blockDigest(findStateBlock(issue.body, CONTEXT_BLOCK_NAME).block.body) === target.context))
            && (!target.current || Boolean(findStateBlock(issue.body, CURRENT_BLOCK_NAME).block && blockDigest(findStateBlock(issue.body, CURRENT_BLOCK_NAME).block.body) === target.current))) : null;
        } else if (effect.kind === 'replace_pr_nav') {
          const page = this.reader.issue(target.pr);
          const nav = page ? findStateBlock(page.body, NAV_BLOCK_NAME).block : undefined;
          const status = page && target.status ? findStateBlock(page.body).block : undefined;
          done = page ? Boolean(nav && blockDigest(nav.body) === target.digest && (!target.status || (status && blockDigest(status.body) === target.status))) : null;
        } else if (effect.kind === 'post_index_comment') {
          const comments = observed.comments.get(target.issue) || this.reader.comments(target.issue);
          done = indexReadback(comments, effect.intent_id, target.parts);
        } else if (['post_archive_comment', 'edit_archive_comment'].includes(effect.kind)) {
          try {
            const registered = doc.page_archive?.find(entry => entry.key === target.key);
            if (!registered || target.issue !== doc.parent_issue) done = null;
            else if (effect.kind === 'post_archive_comment') {
              const candidates = this.reader.comments(target.issue).filter(comment => comment.body.startsWith(`${archiveTools().marker(target.key)}\n`) && (comment.id !== registered.comment_id || registered.login === target.login) && !archiveUntrusted(registered, comment.id));
              const matches = candidates.filter(comment => comment.user?.login === target.login && archiveTools().digest(comment.body) === target.digest).sort((a, b) => a.id - b.id);
              done = matches.length ? true : false;
              if (done) {
                const verified = this.reader.archiveComment(matches[0].id);
                done = Boolean(verified && verified.user?.login === target.login && verified.body === matches[0].body && String(verified.issue_url).toLowerCase() === `https://api.github.com/repos/${this.binding.repository}/issues/${target.issue}`.toLowerCase());
                if (done) recoveredId = matches[0].id;
              }
              const rejected = candidates.filter(comment => comment.id !== recoveredId).map(comment => comment.id);
              if (rejected.length) rejectedArchive = { key: target.key, ids: rejected, reason: candidates.length > 1 ? 'duplicate' : candidates[0].user?.login === target.login ? 'changed' : 'foreign' };
            } else if (registered.comment_id !== target.comment_id || registered.login !== target.login) done = null;
            else {
              const result = this.archiveTrust(registered);
              const digest = result.comment && archiveTools().digest(result.comment.body);
              if (!result.reason || digest === target.digest && result.reason === 'changed') done = digest === target.digest;
              else { done = false; untrusted = result.reason; }
            }
          } catch { done = null; }
        }
        if (done === null) holds.push({ code: 'EFFECT_UNKNOWN', target: `#${target.issue}`, detail: `${effect.kind} from an earlier pass could not be checked; held`, scope: holdScope(effect.kind) });
        resolutions.push({ kind, number, intent_id: effect.intent_id, outcome: done === null ? 'UNKNOWN' : done ? 'DONE' : 'NOT_DONE',
          ...(untrusted ? { untrusted: { key: target.key, reason: untrusted } } : {}),
          ...(rejectedArchive ? { rejectedArchive } : {}),
          ...(['post_archive_comment', 'edit_archive_comment'].includes(effect.kind) && done ? { archive: { key: target.key, comment_id: recoveredId || target.comment_id, login: target.login, digest: target.digest } } : {}) });
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
      if (['CHILD_REOPENED','CHILD_ADDED'].includes(entry.code)) return true;
      return entry.code === 'STALE_ASSIGNMENT' || LIVE_GATE_STATES.includes(gate?.state);
    }).map(entry => entry.id);
  }

  // Record reconcile findings from a full pass (only size refusals from a single-issue pass),
  // and inventory findings when the pass carries an inventory.
  // When they change, the parent's CURRENT block is planned again with the new list, so the page
  // shows them after this pass.
  planAttention(parent, projected, observed, only, override, inventory, effects, findings, holds, resolutions = [], blockHolds = new Set()) {
    const folds = [];
    // Hold by issue, even when another pass adds the finding after this snapshot was read.
    const incompletePrHolds = [...observed.discovery].filter(([, discovery]) => discovery.complete === false)
      .map(([issue]) => findingId(FINDING_CODES.COMPLETED_PR_MISSING.source, 'COMPLETED_PR_MISSING', issue));
    const seen = () => findings.filter(finding => ATTENTION.has(finding.code) && (!only || PAGE_CODES.includes(finding.code)));
    const refreshHolds = !this.refreshFacts ? (parent.attention || []).filter(entry => {
      if (['CLOSED_WITHOUT_ACCEPTANCE','PR_WITHOUT_TASK','CLOSING_COMMENT_MISSING'].includes(entry.code)) return true;
      if (entry.code !== 'CHILD_STATE_CONFLICT') return false;
      const doc=projected.get(entry.issue); const issue=observed.issues.get(entry.issue);
      return doc?.lifecycle === 'RETIRED' && issue?.state === 'open'
        || !doc?.closed_by_sweep && TERMINAL_LIFECYCLES.includes(doc?.lifecycle) && issue?.state === 'closed'
        && doc.lifecycle !== (String(issue.state_reason || '').toUpperCase() === 'COMPLETED' ? 'DONE' : 'RETIRED');
    }).map(entry=>entry.id) : [];
    const unreadOpenPrHolds = observed.prGraph?.openComplete === false ? (parent.attention || []).filter(entry=>entry.code==='PR_UNTRACKED').map(entry=>entry.id) : [];
    const adoptionHolds = (observed.additions || []).map(outcome=>findingId('reconcile','CHILD_ADDED',outcome.issue));
    const stoppedHolds = openFindings(parent.attention).filter(entry => entry.code === 'PASS_STOPPED').map(entry => entry.id);
    const sweep = observed.sweep;
    const tasks = new Set(parent.outcomes.map(outcome => outcome.issue));
    const unread = !this.scope ? [] : (parent.attention || []).filter(entry => tasks.has(entry.issue) ? !this.scope.has(entry.issue)
      : sweep && (!sweep.changedComplete || sweep.left.length || sweep.failed.length)).map(entry => entry.id);
    if (!override) folds.push({ source: 'reconcile', complete: !only, seen: seen(),
      hold: [...this.oneTimeHolds(parent.attention, projected), ...incompletePrHolds,
        ...refreshHolds, ...unreadOpenPrHolds, ...adoptionHolds, ...stoppedHolds, ...unread, ...(observed.prGraph?.holdWithoutTask || []),
        ...(parent.attention || []).filter(entry=>entry.code==='CLOSING_COMMENT_MISSING' && !observed.closing?.checked.has(`${entry.kind}:${entry.issue}`)).map(entry=>entry.id)] });
    if (inventory) folds.push({ source: 'inventory', complete: inventory.complete, seen: inventory.findings });
    if (!folds.length) return;
    const now = this.now();
    const stored = parent.attention || [];
    let next = folds.reduce((list, fold) => foldAttention(list, { ...fold, now }), stored);
    const settlingSize = !only && openFindings(stored).some(entry => PAGE_CODES.includes(entry.code));
    if (JSON.stringify(canonical(next)) === JSON.stringify(canonical(stored)) && !settlingSize && !(stoppedHolds.length && !only)) return;
    const effect = { kind: 'update_attention', target: { issue: parent.parent_issue }, folds, now, line: attentionLine(next, now) };
    effects.push(effect);
    const number = parent.parent_issue;
    const blockFindings = new Set(['PROJECTION_STALE', 'TRACE_STALE', 'MANAGED_BLOCK_BROKEN', ...PAGE_CODES]);
    const keep = (list, test) => { const kept = list.filter(item => !test(item)); list.splice(0, list.length, ...kept); };
    const redraw = attention => {
      keep(effects, effect => ['replace_block', 'post_index_comment', 'post_archive_comment', 'edit_archive_comment'].includes(effect.kind) && effect.target.issue === number);
      keep(findings, finding => finding.issue === number && blockFindings.has(finding.code));
      // Replace only block diff holds, preserving recovery holds raised earlier.
      keep(holds, hold => blockHolds.has(hold) && hold.target === `#${number}` && hold.scope === 'body');
      const start = holds.length;
      this.diffBlocks({ ...parent, attention }, projected, observed, only, effects, findings, holds, [number], resolutions);
      for (const hold of holds.slice(start)) blockHolds.add(hold);
    };
    redraw(next);
    const reconcile = folds.find(fold => fold.source === 'reconcile');
    if (reconcile) {
      reconcile.seen = seen();
      const final = folds.reduce((list, fold) => foldAttention(list, { ...fold, now }), stored);
      // Adding attention can itself overflow CURRENT. Include that finding once before measuring
      // again; the numeric diagnostics are not rendered in CURRENT, so no size feedback loop.
      if (attentionLine(final, now) !== attentionLine(next, now)) { next = final; redraw(next); reconcile.seen = seen(); }
      effect.line = attentionLine(next, now);
    }
  }

  plan({ issue: only = null, parentOverride = null, inventory = null, queued = null } = {}) {
    this.closing?.beginPass();
    this.pass.phaseAt('planning');
    this.planning = true;
    this.queued = only || parentOverride ? null : queued;
    this.scope = null; this.sweepOrder = null; this.sweepChange = null; this.board = null;
    try { return this.planWithinBudget({ issue: only, parentOverride, inventory }); }
    catch (error) {
      if (error.code !== 'PASS_STOPPED') throw error;
      if (!this.pass.stopped) this.pass.stopped = this.pass.snapshot('time_limit');
      const parentRead = parentOverride ? this.loadParent(parentOverride) : this.snapshot ? this.store.snapshotDoc(this.snapshot, 'parent', this.binding.parent_issue) : { doc: null, sha: null };
      const finding = { code: 'PASS_STOPPED', issue: this.binding.parent_issue, diagnostics: this.pass.stopped };
      // A queued pass cut in planning keeps its queue: every task it put in order stays to be read.
      if (this.queued && this.sweepOrder && parentRead.doc) this.sweepChange = this.queueChange(parentRead.doc, this.sweepOrder, []);
      return { parent: parentRead.doc, override: Boolean(parentOverride), children: new Map(), findings: [finding], effects: [], resolutions: [], snapshot: this.snapshot,
        holds: [{ code: 'PASS_STOPPED', target: `#${this.binding.parent_issue}`, detail: findingText(finding) }], complete: false, stopped: true, reason: error.reason || null, noWrite: Boolean(error.noWrite) };
    } finally {
      this.planning = false;
      // Kept even when planning was cut, so a slow first pass makes the next one cheaper.
      if (this.refreshFacts && !only) this.readCache?.save();
    }
  }

  planWithinBudget({ issue: only = null, parentOverride = null, inventory = null } = {}) {
    const holds = [];
    // Every document comes from one read of the state directory, each with its own version id.
    this.snapshot = null;
    const snapshot = this.store.readSnapshot();
    this.snapshot = snapshot;
    const parentRead = parentOverride ? this.loadParent(parentOverride) : this.store.snapshotDoc(snapshot, 'parent', this.binding.parent_issue);
    if (!parentRead.doc) {
      return { parent: null, findings: [], effects: [], holds: [{ code: 'PARENT_STATE_MISSING', target: `#${this.binding.parent_issue}`, detail: `No parent state document for #${this.binding.parent_issue} yet. The appointed controller creates and holds it with init-parent --apply --controller; other sessions report this to the controller.` }], resolutions: [] };
    }
    let parent = parentRead.doc;
    if (parent.repository.toLowerCase() !== this.binding.repository.toLowerCase() || parent.parent_issue !== this.binding.parent_issue) {
      throw new ProgrammeError('STATE_INVALID', 'The parent state document belongs to a different repository or parent issue.');
    }
    if (only && !parent.outcomes.some(outcome => outcome.issue === only)) throw new ProgrammeError('USAGE', `#${only} is not in the outcome catalogue.`);
    const children = new Map(parent.outcomes.map(outcome => { this.pass.planning(); return [outcome.issue, this.store.snapshotDoc(snapshot, 'child', outcome.issue)]; }));
    const observed = this.observe(parent, children, only, this.queued);
    const sweep = observed.sweep || null;
    if (sweep) this.scope = new Set([...sweep.scoped, ...observed.additions.map(outcome => outcome.issue)]);
    const queueFindings = [];
    if (sweep) {
      this.sweepChange = this.queueChange(parent, sweep.left, sweep.failed);
      for (const number of sweep.failed) if ((parent.sweep?.failures?.[number] || 0) + 1 >= 3) queueFindings.push({ code: 'SWEEP_TASK_UNREADABLE', issue: number });
      for (const code of this.queued.findings || []) queueFindings.push({ code, issue: parent.parent_issue });
    }
    // CURRENT's first line, once the parent has a saved queue: this pass's time when it is set to
    // finish, otherwise how long the board has been out of date.
    const record = this.queued?.record ?? null;
    // Within an hour of the last finished pass the line keeps that pass's time, so a pass that changes
    // nothing else does not rewrite the page; the sweep runs hourly, so the time moves every pass.
    const now = this.now();
    const shown = record?.last_complete_at && Date.parse(now) >= Date.parse(record.last_complete_at) && Date.parse(now) - Date.parse(record.last_complete_at) < BOARD_REDRAW_MS ? record.last_complete_at : now;
    this.board = sweep ? { record, time: shown, complete: Boolean(sweep.changedComplete && !sweep.left.length && !sweep.failed.length), left: sweep.left.length + sweep.failed.length }
      : { keep: boardLineOf(observed.issues.get(parent.parent_issue)?.body) };
    const resolutions = this.recover([
      { kind: 'parent', number: parent.parent_issue, doc: parent },
      ...[...children.values()].filter(entry => entry.doc).map(entry => ({ kind: 'child', number: entry.doc.issue, doc: entry.doc })),
    ], observed, holds);
    const findings = [...queueFindings];
    if (this.pass.progress?.interrupted) findings.push({ code: 'PASS_STOPPED', issue: parent.parent_issue, diagnostics: this.pass.progress.interrupted });
    const effects = [];
    if (observed.additions.length) {
      effects.push({kind:'add_native_children',target:{issue:parent.parent_issue},outcomes:observed.additions});
      parent = {...parent,outcomes:[...parent.outcomes,...observed.additions]};
    }
    if (observed.prGraph?.advance) effects.push({kind:'advance_pr_watermark',target:{issue:parent.parent_issue},watermark:observed.prGraph.scanStarted});
    if (observed.closing) {
      const closing=observed.closing;
      findings.push(...closing.seen);
      if (JSON.stringify(canonical(closing.incomplete)) !== JSON.stringify(canonical(parent.private?.closing_scan || []))
        || closing.issueWatermark !== parent.private?.graph_issue_watermark) effects.push({kind:'advance_closing_scan',target:{issue:parent.parent_issue},pending:closing.incomplete,watermark:closing.issueWatermark || null});
      let prepared=0;
      for (const item of closing.due) {
        if (prepared>=require('./closing-comments.cjs').POST_CAP) break;
        try {
          const body=this.closing.facts(item,children);
          effects.push({kind:'post_closing_backstop',target:{issue:item.number,kind:item.kind,closed_at:item.closed_at,body}});
          prepared++;
        } catch(error) {
          if (STOPS_PASS.has(error.code)) throw error;
          closing.errors.push(`Facts for ${item.kind} #${item.number} could not be prepared; retry next pass.`);
        }
      }
    }
    findings.push(...(observed.prGraph?.withoutTask || []).map(pr=>({code:'PR_WITHOUT_TASK',issue:pr.number})));
    this.diffParentLifecycle(parent, observed, effects, findings, holds);
    const desiredDocs = new Map();
    for (const outcome of parent.outcomes) {
      const existing = children.get(outcome.issue)?.doc || null;
      if ((only && outcome.issue !== only) || (this.scope && !this.scope.has(outcome.issue))) { if (existing) desiredDocs.set(outcome.issue, existing); continue; }
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
    const blockHoldStart = holds.length;
    this.diffBlocks(parent, projected, observed, only, effects, findings, holds, null, resolutions);
    const blockHolds = new Set(holds.slice(blockHoldStart));
    this.auditTraces(parent, observed, only, findings, effects);
    this.diffUntracked(parent, desiredDocs, observed, only, findings);
    this.diffIdle(parent, desiredDocs, observed, only, findings);
    const legacy = parent.outcomes.filter(outcome => LEGACY_CLASSES.includes(outcome.class) && (!only || outcome.issue === only));
    if (legacy.length) findings.push({ code: 'CLASS_LEGACY', issue: parent.parent_issue, patch: legacyMigrationPatch(parent),
      detail: `${legacy.map(outcome => `#${outcome.issue} ${outcome.class}`).join(', ')} read as COMMITTED and sort like any other task, by group, priority (order) and child number; to migrate, save this finding's patch (reconcile --json) and apply it whole with update-parent, which sets COMMITTED and renumbers order in the old CORE, HARDENING, LATER sequence` });
    if (!only) for (const tie of orderTies(parent, desiredDocs)) findings.push({ code: 'ORDER_TIE', issue: parent.parent_issue, detail: `${tie.map(outcome => `#${outcome.issue}`).join(', ')} share priority order ${tie[0].order}, so child number decides. Controller: set a distinct order with update-parent; if CLASS_LEGACY is reported too, migrate first, or set COMMITTED and the priority in one update-parent patch` });
    this.planAttention(parent, projected, observed, only, Boolean(parentOverride), inventory, effects, findings, holds, resolutions, blockHolds);
    this.pass.planning();
    for (const effect of effects) effect.text = describeEffect(effect);
    return { parent, parentSha: parentRead.sha, override: Boolean(parentRead.override), issueScoped: Boolean(only), children, observed, findings, effects, holds, resolutions, snapshot,
      complete: !only && !parentOverride && (!inventory || inventory.complete) && (!observed.prGraph || observed.prGraph.complete) && [...observed.discovery.values()].every(entry => entry.complete !== false)
        && [parent.parent_issue, ...parent.outcomes.map(outcome => outcome.issue)].filter(number => !this.scope || number === parent.parent_issue || this.scope.has(number)).every(number => Boolean(observed.issues.get(number)))
        // A queued pass is complete only when its changed list was whole and its queue ends empty.
        && (!sweep || (sweep.changedComplete && !sweep.left.length && !sweep.failed.length))
        && !findings.some(entry => entry.code === 'MANAGED_BLOCK_BROKEN') };
  }

  // The queue a queued pass leaves: the tasks it did not reach, in order, then the ones that failed
  // (each counted, so three in a row raise a finding). Unchanged, it writes nothing.
  queueChange(stored, left, failed) {
    const failures = { ...(stored.sweep?.failures || {}) };
    for (const number of this.scope || []) delete failures[number];
    for (const number of failed) failures[number] = (stored.sweep?.failures?.[number] || 0) + 1;
    const queue = [...new Set([...left, ...failed])];
    return doc => {
      const live = new Set(doc.outcomes.map(outcome => outcome.issue));
      const next = { queue: queue.filter(number => live.has(number)),
        failures: Object.fromEntries(Object.entries(failures).filter(([number]) => live.has(Number(number))).sort(([a], [b]) => a - b)) };
      if (JSON.stringify(canonical(doc.sweep || null)) === JSON.stringify(canonical(next))) return null;
      doc.sweep = next;
      return doc;
    };
  }

  // CURRENT's freshness line. An issue-scoped pass repeats what the last finished pass recorded.
  // A finished pass says when the board was updated. A pass that stops early says so in a short,
  // calm note beside its own time (it did update what it read), and the next run carries on. Only a
  // sweep that is truly stuck gets a warning: no pass finished for six hours, and the passes in
  // those hours read fewer than ten tasks in all.
  boardLine(parent) {
    const board = this.board;
    if (!board) return null;
    if ('keep' in board) return board.keep;
    const record = board.record || {};
    const sgt = time => `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(time))} SGT`;
    if (board.complete && !this.pass.stopped) return `Board updated: ${sgt(board.time)} (state revision ${parent.revision})`;
    const reason = this.stopReason || this.pass.stopReason || this.pausedBy || (this.pass.stopped ? 'time limit' : board.left ? 'tasks still to check' : record.reason || 'an incomplete read');
    const tasks = `${board.left} task${board.left === 1 ? '' : 's'}`;
    const stuck = this.queued?.stuck?.(this.sweepRead || 0);
    if (stuck?.stuck) {
      const since = record.last_complete_at ? `since ${sgt(record.last_complete_at)}` : 'yet';
      return `⚠️ Sweep stuck: no pass has finished ${since}, and the passes in the last 6 hours read ${stuck.read} task${stuck.read === 1 ? '' : 's'}. ${tasks} still to check (${reason}).`;
    }
    const app = this.queued?.host === 'cloud' ? ' App' : '';
    const next = board.left ? `the next run picks up the ${tasks} left` : 'the next run reads it again';
    const note = reason === 'GitHub rate limit' ? `Paused at GitHub's hourly${app} limit; ${next}.`
      : reason === 'request cap' ? `Paused at this pass's request limit; ${next}.`
        : reason === 'time limit' ? `Paused at this pass's time limit; ${next}.`
          : reason === 'tasks still to check' ? `${next[0].toUpperCase()}${next.slice(1)}.`
            : `Not every read finished (${reason}); ${next}.`;
    return `Board updated: ${sgt(this.now())} (state revision ${parent.revision}). ${note}`;
  }

  // Only verified stored state proves the predecessor was reported. Its controller answer and
  // whether this pass planned an attention write do not change that persistence fact.
  reportStoredProgress(parent) {
    const interrupted = this.pass.progress?.interrupted;
    if (interrupted && parent.attention?.some(entry => entry.code === 'PASS_STOPPED'
      && JSON.stringify(canonical(entry.diagnostics)) === JSON.stringify(canonical(interrupted)))) this.pass.progress.reported();
  }

  // A state batch on the documents as they stand now. A sweep's lease opens its commit window
  // first, so no separate lease write lands between this snapshot and the end of the commit.
  openBatch(earlier, parentNumber) {
    const lease = this.queued?.lease || null;
    lease?.open();
    try {
      const batch = new StateBatch(this.store, this.store.currentSnapshot(earlier), parentNumber);
      batch.lease = lease;
      return batch;
    } catch (error) { lease?.close({}); throw error; }
  }

  // Saved states, parent page, queue, then completion. Every group shares the process deadline.
  apply(plan) {
    if (plan.override) throw new ProgrammeError('USAGE', 'A parent document read from a file can only be used for a dry run.');
    const writer = this.writer;
    const results = [];
    const holds = [...plan.holds];
    const parentNumber = plan.parent.parent_issue;
    let parentDoc = null;
    let docs = null;
    // The state phase is staged on the plan's snapshot and published in one commit before any page
    // or GitHub effect runs. Effect bookkeeping after it keeps the per-document compare-and-swap.
    let batch = plan.snapshot?.head ? this.openBatch(plan.snapshot, parentNumber) : null;
    const staged = [];
    const settledChildren = new Map([...plan.children].filter(([,entry])=>entry.doc).map(([number,entry])=>[number,entry.doc]));
    const writtenChildren = new Set();
    const verifiedBodies = new Set();
    const sizeIds = new Set([...(plan.parent.attention || []), ...plan.findings]
      .filter(entry => PAGE_CODES.includes(entry.code)).map(entry => findingId('reconcile', entry.code, entry.issue)));
    const canResolveSize = (entry, includeParent = false) => PAGE_CODES.includes(entry.code) && sizeIds.has(entry.id)
      && !plan.findings.some(finding => finding.code === entry.code && finding.issue === entry.issue)
      && (verifiedBodies.has(entry.issue) || (includeParent && entry.issue === parentNumber)) && OPEN_FINDING_STATES.includes(entry.state);
    // The parent fence is read again immediately before every state write and every GitHub change,
    // so a takeover stops this pass at its next effect (STALE_WRITER). An intent it leaves IN_FLIGHT
    // is settled by readback in the successor's next pass, never replayed.
    const guard = () => {
      // While the state phase is staged, the fence is the snapshot's; the commit re-checks it.
      const fresh = batch ? batch.parent() : this.store.read('parent', parentNumber).doc;
      authoriseWrite('parent', fresh, null, writer);
      parentDoc = fresh;
      if (!batch) this.reportStoredProgress(parentDoc);
    };
    guard();
    const mutateDoc = (kind, number, options) => {
      guard();
      const result = batch ? batch.mutate(kind, number, { writer, ...options }) : this.store.mutate(kind, number, { writer, parentDoc, ...options });
      if (kind === 'parent') {
        parentDoc = result.doc;
        if (!batch) this.reportStoredProgress(parentDoc);
      } else {
        if (result.outcome === 'WRITTEN' || result.outcome === 'STAGED') writtenChildren.add(number);
        if (result.doc) settledChildren.set(number,result.doc);
        if (docs && result.doc) docs.set(number, result.doc);
      }
      return result;
    };
    // A hold stops later effects of the same scope on that issue: a body hold never blocks its links.
    const held = new Map();
    const markHeld = (target, scope) => { if (!held.has(target)) held.set(target, new Set()); held.get(target).add(scope); };
    const isHeld = (target, scope) => Boolean(held.get(target) && (held.get(target).has('all') || held.get(target).has(scope)));
    for (const entry of holds) markHeld(entry.target, entry.scope || 'all');
    const outcomes = new Map(plan.parent.outcomes.map(outcome => [outcome.issue, outcome]));
    const record = (effect, outcome, detail = null) => {
      results.push({ kind: effect.kind, target: effect.target, text: effect.text, outcome, ...(detail ? { detail } : {}) });
      if (batch) staged.push({ effect, result: results.at(-1), key: ['add_native_children', 'update_attention'].includes(effect.kind) ? `parent:${parentNumber}` : `child:${effect.target.issue}` });
      if (this.pass.phase === 'state') this.pass.tick();
    };
    let stoppedRecorded = false;
    const recordStopped = () => {
      if (!this.pass.stopped || stoppedRecorded) return;
      const finding = { code: 'PASS_STOPPED', issue: parentNumber, diagnostics: this.pass.stopped };
      mutateDoc('parent', parentNumber, { change: doc => {
        doc.attention = foldAttention(doc.attention, { source: 'reconcile', complete: false, seen: [finding], now: this.now() });
        return doc;
      } });
      plan.findings.push(finding);
      holds.push({ code: 'PASS_STOPPED', target: `#${parentNumber}`, detail: findingText(finding) });
      stoppedRecorded = true;
    };
    const hold = (effect, code, detail, diagnostics = null) => {
      const scope = holdScope(effect.kind);
      holds.push({ code, target: `#${effect.target.issue}`, detail, scope, ...(diagnostics ? { diagnostics } : {}) });
      markHeld(`#${effect.target.issue}`, scope);
      if (PAGE_CODES.includes(code) && diagnostics) {
        const finding = { code, issue: effect.target.issue, diagnostics, detail: 'The projected page reaches the redraw threshold' };
        const previous = plan.findings.find(entry => entry.code === code && entry.issue === finding.issue);
        if (previous) Object.assign(previous, finding); else plan.findings.push(finding);
        mutateDoc('parent', parentNumber, { change: doc => {
          const next = foldAttention(doc.attention, { source: 'reconcile', complete: false, seen: [finding], now: this.now() });
          if (next === doc.attention) return null;
          doc.attention = next;
          return doc;
        } });
      }
    };

    // Resolve recovered effects once per document. Readback still decides each intent separately.
    const recoveredDocs = new Map();
    for (const resolution of plan.resolutions.filter(entry => entry.outcome !== 'UNKNOWN'
      // A missing repair comment is still owed. Keep its intent until the re-planned
      // effect runs, even if an unrelated hold or the budget skips lifecycle this pass.
      && !(entry.outcome === 'NOT_DONE' && plan.parent.pending_effects.some(effect =>
        effect.intent_id === entry.intent_id && effect.kind === 'post_parent_repair')))) {
      const key = `${resolution.kind}:${resolution.number}`;
      if (!recoveredDocs.has(key)) recoveredDocs.set(key, []);
      recoveredDocs.get(key).push(resolution);
    }
    for (const resolutions of recoveredDocs.values()) {
      const { kind, number } = resolutions[0];
      mutateDoc(kind, number, {
        change: doc => {
          for (const resolution of resolutions.filter(entry => entry.archive)) {
            const registered = doc.page_archive?.find(entry => entry.key === resolution.archive.key);
            if (registered) {
              if (registered.comment_id && registered.comment_id !== resolution.archive.comment_id && registered.login !== resolution.archive.login) rejectArchiveIds(registered, [registered.comment_id]);
              Object.assign(registered, resolution.archive);
            }
          }
          for (const resolution of resolutions.filter(entry => entry.untrusted)) {
            const entry = doc.page_archive?.find(entry => entry.key === resolution.untrusted.key);
            if (entry) detachArchive(entry);
            doc.attention = foldAttention(doc.attention, { source: 'reconcile', complete: false, seen: [{ code: 'ARCHIVE_COMMENT_UNTRUSTED', issue: number, diagnostics: { reason: resolution.untrusted.reason } }], now: this.now() });
          }
          for (const resolution of resolutions.filter(entry => entry.rejectedArchive)) {
            const entry = doc.page_archive?.find(entry => entry.key === resolution.rejectedArchive.key);
            if (entry) rejectArchiveIds(entry, resolution.rejectedArchive.ids);
            doc.attention = foldAttention(doc.attention, { source: 'reconcile', complete: false, seen: [{ code: 'ARCHIVE_COMMENT_UNTRUSTED', issue: number, diagnostics: { reason: resolution.rejectedArchive.reason } }], now: this.now() });
          }
          const kept = doc.pending_effects.filter(effect => !resolutions.some(entry => entry.intent_id === effect.intent_id));
          if (kept.length === doc.pending_effects.length) return null;
          doc.pending_effects = kept;
          return doc;
        },
      });
    }

    // Each group's intents live on the parent. Each callback keeps its fence and independent
    // readback. A crash leaves the whole uncommitted group for recover(), including unrun effects.
    const withIntents = jobs => {
      if (!jobs.length || (redrawing ? this.pass.left() < END_RESERVE_MS : this.pass.stop())) return;
      const intents = jobs.map(({ effect }) => ({ intent_id: intentId(effect.kind, effect.target), kind: effect.kind, target: effect.target, state: 'IN_FLIGHT' }));
      mutateDoc('parent', parentNumber, { change: doc => {
        for (const intent of intents) if (!doc.pending_effects.some(entry => entry.intent_id === intent.intent_id)) doc.pending_effects.push(intent);
        return doc;
      } });
      const settled = new Map();
      for (const [index, { effect, run }] of jobs.entries()) {
        if (redrawing ? this.pass.left() < END_RESERVE_MS : this.pass.stop()) break;
        if (isHeld(`#${effect.target.issue}`, holdScope(effect.kind))) continue;
        let outcome, detail = null, code = null;
        try { ({ outcome, detail = null, code = null } = run()); }
        catch (error) {
          if (STOPS_PASS.has(error.code)) throw error;
          outcome = 'UNKNOWN'; detail = error.message;
        }
        settled.set(intents[index].intent_id, outcome);
        if (outcome === 'UNKNOWN') hold(effect, 'EFFECT_UNKNOWN', detail || 'the readback did not settle the outcome');
        else if (outcome === 'NOT_DONE') hold(effect, code || 'EFFECT_NOT_DONE', detail || 'GitHub did not make the change');
        record(effect, outcome, detail);
        if (outcome !== 'UNKNOWN') this.pass.tick();
      }
      mutateDoc('parent', parentNumber, { change: doc => {
        doc.pending_effects = doc.pending_effects.filter(entry => {
          const outcome = settled.get(entry.intent_id);
          if (outcome === 'UNKNOWN') entry.state = 'UNKNOWN';
          return !outcome || outcome === 'UNKNOWN' || outcome === 'NOT_DONE' && entry.kind === 'post_parent_repair';
        });
        return doc;
      } });
    };
    let group = [];
    const withIntent = (effect, run) => { group.push({ effect, run }); };
    const flush = () => { const jobs = group; group = []; withIntents(jobs); };
    const phase = (name, total) => { flush(); if (this.pass.stop()) return false; this.pass.phaseAt(name, total); return true; };
    this.pass.phaseAt('state', plan.effects.filter(entry => ['add_native_children', 'update_attention', 'create_state', 'update_state', 'copy_child_lifecycle'].includes(entry.kind)).length);

    // These effects have no caller-supplied patch. Only the refresh observation owner may use them;
    // the lock and parent fence stay in force, and each source issue is checked again before CAS.
    const requireRefresh = () => {
      if (!this.refreshFacts || writer?.by_hash !== true) throw new ProgrammeError('ROLE_REFUSED','Only the locked refresh may copy observed graph facts.');
    };
    const copyLifecycle = (doc, effect) => {
      requireRefresh();
      const observed = plan.observed.issues.get(effect.target.issue);
      const fresh = this.reader.issue(effect.target.issue);
      checkLifecycleObservation(observed, fresh);
      const expected = plan.children.get(effect.target.issue)?.doc;
      if (expected && CLOSE_FIELDS.some(key => JSON.stringify(doc[key]) !== JSON.stringify(expected[key]))) throw new ProgrammeError('GRAPH_FACT_STALE', 'Controller lifecycle changed after observation; refresh again.');
      return copyIssueLifecycle(doc, fresh);
    };
    const copiedChildren = new Set();
    for (const effect of plan.effects.filter(entry=>entry.kind === 'add_native_children')) {
      if (this.pass.stop(PAGE_RESERVE_MS)) break;
      requireRefresh();
      try {
        let added=[];
        const result=mutateDoc('parent',parentNumber,{change:doc=>{
          const next=clone(doc);
          added=[];
          for (const outcome of effect.outcomes) {
            if (doc.outcomes.some(entry=>entry.issue===outcome.issue)) continue;
            const observed=plan.observed.issues.get(outcome.issue);
            const fresh=this.reader.issue(outcome.issue);
            const parentAllowed=outcome.parent===parentNumber || doc.outcomes.some(entry=>entry.issue===outcome.parent);
            if(!parentAllowed || observed?.complete !== true || fresh?.complete !== true || fresh.is_pull_request || observed.parent !== outcome.parent || fresh.parent !== outcome.parent
              || registeredParents(this.binding).includes(outcome.issue)
              || outcome.parent !== parentNumber && registeredParents(this.binding).includes(outcome.parent)) {
              throw new ProgrammeError('GRAPH_FACT_STALE','Native membership changed after observation; refresh again.');
            }
            next.outcomes.push({...outcome,label:fresh.title,order:Math.max(0,...next.outcomes.map(entry=>entry.order))+1});
            added.push({code:'CHILD_ADDED',issue:outcome.issue});
          }
          // The catalogue entry and its notice commit together. A stale or failed add can never
          // leave a notice for a task the refresh did not add.
          next.attention=foldAttention(next.attention,{source:'reconcile',complete:false,seen:added,now:this.now()});
          return next;
        }});
        if(result.outcome !== 'NOOP') plan.findings.push(...added);
        record(effect,result.outcome==='NOOP'?'NOOP':'DONE');
      } catch(error) {
        if(STOPS_PASS.has(error.code)) throw error;
        hold(effect,error.code || 'STATE_WRITE_FAILED',error.message); record(effect,'HELD',error.message);
        // No child document may be created without its successfully recorded catalogue owner.
        for(const outcome of effect.outcomes) markHeld(`#${outcome.issue}`,'all');
      }
    }

    // 1. State documents: the parent's attention findings first, re-folded on the document read now so
    // an acknowledgement made since planning is kept.
    for (const effect of plan.effects.filter(entry => entry.kind === 'update_attention')) {
      if (this.pass.stop(PAGE_RESERVE_MS)) break;
      try {
        const result = mutateDoc('parent', parentNumber, { change: doc => {
          const stored = doc.attention || [];
          const plannedIds = new Set((plan.parent.attention || []).map(entry => entry.id));
          const concurrent = stored.filter(entry => !plannedIds.has(entry.id)).map(entry => entry.id);
          const stoppedIds = stored.filter(entry => entry.code === 'PASS_STOPPED').map(entry => entry.id);
          const next = effect.folds.reduce((list, fold) => foldAttention(list, { ...fold, hold: [...(fold.hold || []), ...concurrent, ...stoppedIds], now: effect.now }), stored);
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
      if (this.pass.stop(PAGE_RESERVE_MS)) break;
      if(isHeld(`#${effect.target.issue}`,'all')) { record(effect,'SKIPPED','catalogue adoption held'); continue; }
      const checkFreshState = (doc, { created }) => {
        guard();
        const outcome = parentDoc.outcomes.find(entry => entry.issue === effect.target.issue);
        // Keep an absent child absent: defaults from the planned outcome are not completion proof.
        const child = created ? null : doc;
        const freshPr = child?.pr?.number ?? null;
        const expectedPr = plan.children.get(effect.target.issue)?.doc?.pr?.number ?? null;
        // Even a plan with no discovered PR must keep one recorded since planning.
        if (freshPr !== null && freshPr !== (effect.doc.pr?.number ?? null) && freshPr !== expectedPr) {
          throw new ProgrammeError('PR_BACKFILL_STALE', 'The task PR changed after planning; run reconciliation again.');
        }
        if (effect.backfill && (freshPr !== effect.backfill.expected_pr || !backfillEligible(outcome, child))) {
          throw new ProgrammeError('PR_BACKFILL_STALE', 'The task PR or completion eligibility changed after planning; run reconciliation again.');
        }
      };
      try {
        const desired = effect.doc;
        // The controller may have written the child after planning. Only PR observations, a
        // completion time taken from the issue and the journals read in this pass belong to it: the
        // gate is re-folded from those journals on the document read at apply time, so an
        // assignment issued since planning is never overwritten.
        const fields = effect.kind === 'create_state' ? ['pr', ...(desired.prs ? ['prs'] : []), ...(desired.added_by_sweep ? ['added_by_sweep'] : []), ...(!this.refreshFacts && desired.completed_at ? ['completed_at'] : [])] : effect.fields.filter(key => !effect.journals || !FOLD_FIELDS.includes(key));
        const result = mutateDoc('child', effect.target.issue, {
          create: () => newChild({ repository: this.binding.repository, outcome: outcomes.get(effect.target.issue) }),
          onConflict: checkFreshState,
          change: (doc, context) => {
            // Recheck on every CAS retry as well as on the initial mutation read.
            checkFreshState(doc, context);
            const copy = plan.effects.find(entry => entry.kind === 'copy_child_lifecycle' && entry.target.issue === effect.target.issue);
            if (copy) doc = copyLifecycle(doc, copy);
            for (const key of fields) {
              if (desired[key] === undefined) delete doc[key];
              else doc[key] = clone(desired[key]);
            }
            return effect.journals ? foldJournals(doc, effect.journals).doc : doc;
          },
        });
        record(effect, result.outcome === 'NOOP' ? 'NOOP' : 'DONE');
        copiedChildren.add(effect.target.issue);
      } catch (error) {
        if (STOPS_PASS.has(error.code)) throw error;
        record(effect, 'HELD', error.message);
        hold(effect, error.code || 'STATE_WRITE_FAILED', error.message);
      }
    }

    for (const effect of plan.effects.filter(entry=>entry.kind==='copy_child_lifecycle')) {
      if (copiedChildren.has(effect.target.issue)) { record(effect, 'DONE'); continue; }
      if (this.pass.stop(PAGE_RESERVE_MS)) break;
      requireRefresh();
      if(isHeld(`#${effect.target.issue}`,'all')) {record(effect,'SKIPPED','child state held');continue;}
      try {
        const result=mutateDoc('child',effect.target.issue,{change:doc=>copyLifecycle(doc,effect)});
        record(effect,result.outcome==='NOOP'?'NOOP':'DONE');
      } catch(error) {
        if(STOPS_PASS.has(error.code)) throw error;
        hold(effect,error.code || 'STATE_WRITE_FAILED',error.message); record(effect,'HELD',error.message);
      }
    }

    if (batch) {
      recordStopped();
      // The queue this pass leaves rides the same commit, and so does the sweep's lease (its progress
      // and renewed expiry) when it lives in the same store; otherwise its progress is written once.
      if (this.sweepChange) mutateDoc('parent', parentNumber, { change: this.sweepChange });
      try { this.store.commitBatch(batch); }
      catch (error) {
        if (error.code === 'STATE_READBACK_MISMATCH') {
          // The commit may stand but cannot be trusted: no state effect counts and nothing else runs.
          for (const entry of staged) if (entry.result.outcome !== 'NOOP') Object.assign(entry.result, { outcome: 'HELD', detail: error.message });
          holds.push({ code: error.code, target: `#${parentNumber}`, detail: error.message });
          return { results, holds, attention: attentionLine(plan.parent.attention, this.now()) };
        }
        if (error.code !== 'STATE_BRANCH_BUSY') throw error;
        // Nothing was written and no effect runs. The stop is kept outside the state (lease, note).
        this.pass.stopped = { cause: 'time_limit', phase: 'state', done: this.pass.done, total: this.pass.total, started_at: this.pass.started_at };
        this.stopReason = error.reason;
        for (const entry of staged) if (entry.result.outcome !== 'NOOP') Object.assign(entry.result, { outcome: 'SKIPPED', detail: 'the state branch was busy; nothing was written' });
        const finding = { code: 'PASS_STOPPED', issue: parentNumber, diagnostics: this.pass.stopped };
        holds.push({ code: 'PASS_STOPPED', target: `#${parentNumber}`, detail: `${findingText(finding)} (the state branch was busy)` });
        return { results, holds, attention: attentionLine(plan.parent.attention, this.now()), noWrite: true };
      }
      // A document another writer changed during the commit is held alone; the rest stand.
      for (const entry of staged) {
        const error = batch.dropped.get(entry.key);
        if (!error || entry.result.outcome === 'NOOP') continue;
        Object.assign(entry.result, { outcome: 'HELD', detail: error.message });
        hold(entry.effect, error.code || 'STATE_WRITE_FAILED', error.message);
      }
      const committed = batch;
      batch = null;
      parentDoc = committed.documents('parent').get(parentNumber);
      this.reportStoredProgress(parentDoc);
      const childDocs = committed.documents('child');
      docs = new Map(plan.parent.outcomes.map(outcome => [outcome.issue, childDocs.get(outcome.issue)]).filter(([, doc]) => doc));
      for (const [number, doc] of docs) settledChildren.set(number, doc);
      for (const number of [...writtenChildren]) if (!committed.written.some(entry => entry.kind === 'child' && entry.number === number)) writtenChildren.delete(number);
    }

    let finalRedraw = false;
    let relays = 0;
    let finalAttention = null;
    let redrawing = false;
    const postsByIssue = new Map();
    const postsLeft = number => MAX_TOPIC_COMMENTS_PER_PASS - (postsByIssue.get(number) || 0);
    const posted = number => postsByIssue.set(number, (postsByIssue.get(number) || 0) + 1);
    const notePageFinding = (number, code, diagnostics) => {
      const finding = { code, issue: number, diagnostics, detail: FINDING_CODES[code].next_action };
      const previous = plan.findings.find(entry => entry.code === code && entry.issue === number);
      if (previous) Object.assign(previous, finding); else plan.findings.push(finding);
      mutateDoc('parent', parentNumber, { change: doc => {
        const next = foldAttention(doc.attention, { source: 'reconcile', complete: false, seen: [finding], now: this.now() });
        if (next === doc.attention) return null;
        doc.attention = next; return doc;
      } });
    };
    const parentPage = (effect, body, version, currentBody) => {
      let login = null;
      const trust = entry => {
        if (!entry.comment_id || archiveUntrusted(entry, entry.comment_id)) return null;
        const result = this.archiveTrust(entry);
        return result.reason ? null : result.comment;
      };
      const detach = (entry, reason) => {
        if (reason) notePageFinding(parentNumber, 'ARCHIVE_COMMENT_UNTRUSTED', { reason });
        mutateDoc('parent', parentNumber, { change: doc => {
          const target = doc.page_archive.find(part => part.key === entry.key);
          detachArchive(target);
          return doc;
        } });
      };
      const preview = () => {
        guard();
        const before = this.reader.issue(parentNumber);
        if (!before) throw new ProgrammeError('ISSUE_MISSING', 'The parent issue could not be read.');
        const newest = newestBlockVersion(before.body);
        if (newest && versionNewer(newest, version)) throw new ProgrammeError('BLOCK_NEWER_TOOLKIT', 'Update Toolkit before redrawing this newer page.');
        const comments = this.discussion(parentNumber, before, this.readCache);
        const next = this.projectBody(parentNumber, before.body, body, comments, version, null, currentBody, null, postsLeft(parentNumber), { parent: parentDoc, only: plan.issueScoped, keepNotes: Boolean(this.pass.stopped) });
        if (next.refused || next.body.length >= this.threshold) {
          const error = new ProgrammeError('BODY_TOO_LARGE', 'The programme page cannot fit below the hard body limit; no archive comments were changed.');
          error.diagnostics = bodySizeDiagnostics(next.body, this.threshold); throw error;
        }
        return { before, comments, next };
      };
      let snapshot = preview();
      // A cut that landed before its bookkeeping: the page already links the note comment in the
      // generated context block and no longer holds that text, so the entry is moved, not set aside.
      const landed = entry => entry.kind === 'note' && entry.state === 'pending' && entry.comment_id && !snapshot.next.noteKeys.includes(entry.key)
        && (findStateBlock(snapshot.before.body, CONTEXT_BLOCK_NAME).block?.body || '').includes(`/issues/${parentNumber}#issuecomment-${entry.comment_id})`);
      if (parentDoc.page_archive?.some(landed)) {
        mutateDoc('parent', parentNumber, { change: doc => { for (const entry of doc.page_archive) if (landed(entry)) entry.state = 'moved'; return doc; } });
        snapshot = preview();
      }
      // Reconcile the registry even on issue-scoped redraws; these writes never edit comments.
      let registryChanged = false;
      // One open finding covers every damaged archive comment on the page. It names a saved page
      // copy only while every damaged note it covers came from that same copy; otherwise it points
      // to the page-copies folder, so no note's copy goes unnamed.
      const reportedCopies = new Set(openFindings(parentDoc.attention).filter(entry => entry.code === 'ARCHIVE_COMMENT_UNTRUSTED' && entry.issue === parentNumber)
        .map(entry => entry.diagnostics?.copy || ''));
      for (const entry of parentDoc.page_archive || []) {
        if (!entry.comment_id || entry.state === 'withdrawn') continue;
        if (entry.kind === 'note' && entry.state === 'moved') {
          // The page no longer holds this text, so its link and id stay. A changed or missing
          // comment is reported; the saved page copy in the private store restores it by hand.
          // It is reported once: the comment id is then pinned as untrusted, so later passes stay
          // quiet and the owner's answer to the finding stands.
          const reported = archiveUntrusted(entry, entry.comment_id);
          const listed = snapshot.comments.find(comment => comment.id === entry.comment_id);
          if (!reported && listed && listed.user?.login === entry.login && archiveTools().digest(listed.body) === entry.digest) continue;
          const reason = reported ? null : this.archiveTrust(entry).reason;
          if (!reported && !reason) continue;
          if (reason) reportedCopies.add(entry.copy);
          const diagnostics = reason ? { reason, ...(reportedCopies.size === 1 ? { copy: entry.copy } : {}) } : null;
          if (snapshot.next.noteKeys.includes(entry.key)) {
            // The owner put the same notes back under the marker (as the saved copy holds them):
            // the damaged comment is let go and a fresh one is posted for them on this full pass.
            if (diagnostics) notePageFinding(parentNumber, 'ARCHIVE_COMMENT_UNTRUSTED', diagnostics);
            detach(entry); registryChanged = true;
          } else if (diagnostics) {
            notePageFinding(parentNumber, 'ARCHIVE_COMMENT_UNTRUSTED', diagnostics);
            mutateDoc('parent', parentNumber, { change: doc => { rejectArchiveIds(doc.page_archive.find(part => part.key === entry.key), [entry.comment_id]); return doc; } });
          }
          continue;
        }
        if (archiveUntrusted(entry, entry.comment_id)) { detach(entry); registryChanged = true; continue; }
        const result = this.archiveTrust(entry);
        if (result.reason) { detach(entry, result.reason); registryChanged = true; }
      }
      if (registryChanged) snapshot = preview();
      // A posted part whose marked text changed before the cut is set aside: never linked, never
      // edited, never reused for other text. The same text coming back finds it again by key.
      if (!plan.issueScoped && parentDoc.page_archive?.some(entry => entry.kind === 'note' && entry.state === 'pending' && entry.comment_id && !snapshot.next.noteKeys.includes(entry.key))) {
        const current = snapshot.next.noteKeys;
        mutateDoc('parent', parentNumber, { change: doc => {
          for (const entry of doc.page_archive) if (entry.kind === 'note' && entry.state === 'pending' && entry.comment_id && !current.includes(entry.key)) entry.state = 'withdrawn';
          return doc;
        } });
      }
      if (!plan.issueScoped) {
        // Comment links can alter the shortest prefix. Re-plan after verified publication, bounded
        // by the shared notification budget; never hide an unverified row.
        for (let round = 0; round < 8; round++) {
          const { next, comments } = snapshot;
          const changes = (next.archive || []).filter(part => !parentDoc.page_archive?.some(entry => entry.key === part.key && entry.comment_id && entry.digest === archiveTools().digest(part.body)));
          if (!changes.length) break;
          login ||= this.reader.viewer();
          for (const part of changes) {
            if (redrawing ? this.pass.left() < END_RESERVE_MS : this.pass.stop()) return;
            const digest = archiveTools().digest(part.body);
            let entry = parentDoc.page_archive?.find(entry => entry.key === part.key);
            // Other recorded authors remain verified read-only; changed content gets a new post.
            // A note comment is never edited: its key is bound to its exact text.
            const prior = part.kind !== 'note' && entry?.comment_id && entry.login === login ? trust(entry) : null;
            // Saved copy first: the whole page as it stands, before any marked text is posted.
            const copy = part.kind === 'note' ? this.store.saveNoteCopy(parentNumber, snapshot.before.body).digest : null;
            if (!entry) {
              entry = { key: part.key, kind: part.kind, group: part.group, title: part.title.slice(0, 200), comment_id: null, login: null,
                digest, state: 'pending', ...(copy ? { copy } : {}) };
              mutateDoc('parent', parentNumber, { change: doc => { (doc.page_archive ||= []).push(entry); return doc; } });
            }
            const kind = prior ? 'edit_archive_comment' : 'post_archive_comment';
            const target = { issue: parentNumber, key: part.key, comment_id: prior?.id || null, login, before: prior ? archiveTools().digest(prior.body) : null, digest };
            const archiveEffect = { kind, target }; archiveEffect.text = describeEffect(archiveEffect);
            withIntent(archiveEffect, () => {
              const registered = parentDoc.page_archive?.find(entry => entry.key === part.key);
              if (!registered) return { outcome: 'UNKNOWN', detail: 'The archive registry entry disappeared.' };
              const page = this.reader.issue(parentNumber);
              if (!page || page.body !== snapshot.before.body || page.updated_at !== snapshot.before.updated_at) return { outcome: 'NOT_DONE', code: 'BODY_MOVED', detail: 'The owner changed the page; the next pass updates the pending archive comment.' };
              let id = prior?.id;
              if (prior) {
                const fresh = trust(registered);
                if (!fresh || archiveTools().digest(fresh.body) !== target.before) return { outcome: 'UNKNOWN' };
                guard(); this.mutator.editComment(id, part.body);
              } else {
                // A lost successful response is found under the pending key, never posted twice.
                const candidates = this.reader.comments(parentNumber).filter(comment => comment.body.startsWith(`${archiveTools().marker(part.key)}\n`)
                  && (comment.id !== registered.comment_id || registered.login === login) && !archiveUntrusted(registered, comment.id));
                const existing = candidates.filter(comment => comment.user?.login === login && archiveTools().digest(comment.body) === digest).sort((a, b) => a.id - b.id);
                const rejected = candidates.filter(comment => comment.id !== existing[0]?.id).map(comment => comment.id);
                if (rejected.length) {
                  notePageFinding(parentNumber, 'ARCHIVE_COMMENT_UNTRUSTED', { reason: candidates.length > 1 ? 'duplicate' : candidates[0].user?.login === login ? 'changed' : 'foreign' });
                  mutateDoc('parent', parentNumber, { change: doc => {
                    const target = doc.page_archive.find(entry => entry.key === part.key);
                    rejectArchiveIds(target, rejected); return doc;
                  } });
                }
                if (existing.length) id = existing[0].id;
                else {
                  if (postsLeft(parentNumber) <= 0) return { outcome: 'NOT_DONE', detail: 'The five-comment budget is spent.' };
                  guard(); posted(parentNumber);
                  const response = this.mutator.postComment(parentNumber, part.body); id = response.json?.id;
                  if (!id) return { outcome: 'UNKNOWN' };
                }
              }
              const readback = this.reader.archiveComment(id);
              // A fresh note comment that the host did not keep byte for byte is set aside at once,
              // so the same text is never posted again pass after pass.
              if (part.kind === 'note' && readback?.id === id && readback.user?.login === login && readback.body !== part.body) {
                mutateDoc('parent', parentNumber, { change: doc => {
                  Object.assign(doc.page_archive.find(entry => entry.key === part.key), { comment_id: id, login, digest, state: 'withdrawn' }); return doc;
                } });
                return { outcome: 'NOT_DONE', detail: 'The note comment did not read back as written; it was set aside and the notes stay on the page.' };
              }
              if (!readback || readback.id !== id || readback.user?.login !== login || readback.body !== part.body
                || String(readback.issue_url).toLowerCase() !== `https://api.github.com/repos/${this.binding.repository}/issues/${parentNumber}`.toLowerCase()) return { outcome: 'UNKNOWN', detail: 'The archive did not read back exactly under the authenticated login.' };
              mutateDoc('parent', parentNumber, { change: doc => {
                const registered = doc.page_archive.find(entry => entry.key === part.key);
                // Superseded parts from another login are expected history, not trust failures.
                if (registered.comment_id && registered.comment_id !== id && registered.login !== login) rejectArchiveIds(registered, [registered.comment_id]);
                Object.assign(registered, { comment_id: id, login, digest, title: part.title.slice(0, 200), state: 'pending', ...(copy ? { copy } : {}) }); return doc;
              } });
              return { outcome: 'DONE' };
            });
            flush();
            if (isHeld(`#${parentNumber}`, 'body')) return;
          }
          snapshot = preview();
          if (round === 7 && snapshot.next.archive.some(part => !parentDoc.page_archive?.some(entry => entry.key === part.key && entry.digest === archiveTools().digest(part.body)))) throw new ProgrammeError('EFFECT_UNKNOWN', 'Archive layout did not settle; retry the refresh.');
        }
      }
      // Trace publication uses the same budget, after graph archives.
      const traceOverflow = snapshot.next.overflow;
      for (const part of traceOverflow) {
        const post = indexEffect(parentNumber, part, String(snapshot.comments.at(-1)?.id || ''));
        post.text = describeEffect(post);
        withIntent(post, () => {
          const intent = intentId(post.kind, post.target);
          for (const text of indexCommentBodies(parentNumber, post.lines, intent, post.target.tag, post.label, post.target.directory)) {
            if (this.reader.comments(parentNumber).some(comment => comment.body === text)) continue;
            if (postsLeft(parentNumber) <= 0) return { outcome: 'NOT_DONE' };
            const latest = this.reader.issue(parentNumber);
            if (!latest || latest.body !== snapshot.before.body || latest.updated_at !== snapshot.before.updated_at) return { outcome: 'NOT_DONE', code: 'BODY_MOVED' };
            guard(); posted(parentNumber); this.mutator.postComment(parentNumber, text);
            if (!this.reader.comments(parentNumber).some(comment => comment.body === text)) return { outcome: 'UNKNOWN' };
          }
          return { outcome: indexReadback(this.reader.comments(parentNumber), intent, post.target.parts) === true ? 'DONE' : 'UNKNOWN' };
        });
        flush();
        if (isHeld(`#${parentNumber}`, 'body')) return;
      }
      if (traceOverflow.length) snapshot = preview();
      const { before, next } = snapshot;
      if (next.overflow.length) throw new ProgrammeError('EFFECT_UNKNOWN', 'The comment trace changed while archiving; retry the refresh.');
      if (!plan.issueScoped) for (const part of next.archive) {
        const entry = parentDoc.page_archive?.find(entry => entry.key === part.key);
        if (!entry || !trust(entry) || entry.digest !== archiveTools().digest(part.body)) throw new ProgrammeError('EFFECT_UNKNOWN', 'An archive is not verified; the body was kept.');
      }
      if (next.nearLimit) notePageFinding(parentNumber, 'BODY_NEAR_LIMIT', bodySizeDiagnostics(next.body, Math.min(SAFE_LIMIT, this.threshold)));
      let cutCopy = null;
      const finish = () => {
        verifiedBodies.add(parentNumber);
        // A note comment posted earlier in this pass for text the owner then changed is set aside here.
        const stale = entry => entry.kind === 'note' && entry.state === 'pending' && entry.comment_id && !next.noteKeys.includes(entry.key);
        if (!plan.issueScoped && parentDoc.page_archive?.some(entry => stale(entry) || entry.state !== 'moved' && next.archive.some(part => part.key === entry.key))) {
          mutateDoc('parent', parentNumber, { change: doc => {
            for (const entry of doc.page_archive) {
              if (stale(entry)) entry.state = 'withdrawn';
              else if (entry.comment_id && next.archive.some(part => part.key === entry.key)) {
                entry.state = 'moved';
                if (entry.kind === 'note' && cutCopy) entry.copy = cutCopy;
              }
            }
            return doc;
          } });
        }
      };
      if (next.body === before.body) { finish(); record(effect, 'NOOP'); return; }
      // Every block was read back when the body was projected; a missing one holds the page here
      // instead of failing on a digest that is not there.
      const state = findStateBlock(next.body).block, trace = findStateBlock(next.body, TRACE_BLOCK_NAME).block, context = findStateBlock(next.body, CONTEXT_BLOCK_NAME).block;
      if (!state || !trace || !context) throw new ProgrammeError('MANAGED_BLOCK_BROKEN', `#${parentNumber}: a block of the programme page cannot be read back, so nothing was written to this page`);
      // Saved copy first (again): the exact page this write replaces, before marked text leaves it.
      if (next.noteCut) cutCopy = this.store.saveNoteCopy(parentNumber, before.body).digest;
      effect.target = { issue: parentNumber, digest: state.digest, trace: trace.digest, current: blockDigest(currentBody), context: context.digest, body_digest: sha256(next.body) };
      withIntent(effect, () => {
        // Recording the body intent can take time. Recheck custody after that write as well, so a
        // comment edited during bookkeeping cannot authorise hiding its graph rows.
        for (const entry of parentDoc.page_archive || []) {
          // Notes already moved or set aside play no part in this write; the current area's do.
          if (entry.kind === 'note' && !next.archive.some(part => part.key === entry.key)) continue;
          if (entry.comment_id && !archiveUntrusted(entry, entry.comment_id) && !trust(entry)) return { outcome: 'UNKNOWN', detail: 'An archive disappeared before the body write.' };
        }
        const latest = this.reader.issue(parentNumber);
        if (!latest || latest.body !== before.body || latest.updated_at !== before.updated_at) return { outcome: 'NOT_DONE', code: 'BODY_MOVED', detail: 'The issue changed immediately before the write.' };
        guard(); const response = this.mutator.writeBody(parentNumber, next.body);
        const after = this.reader.issue(parentNumber);
        if (after?.body === next.body) { finish(); return { outcome: 'DONE' }; }
        return { outcome: !okStatus(response.status) && after?.body === before.body ? 'NOT_DONE' : 'UNKNOWN' };
      });
    };
    // Render only saved documents, never projected child revisions from an unfinished state loop.
    const renderPages = parentOnly => {
      const blockEffects = plan.effects.filter(entry => entry.kind === 'replace_block');
      // A previously refused page may already match after a partial pass. Recheck it on the complete
      // pass too, so lack of another planned write never counts as proof of a successful redraw.
      if (plan.complete) for (const entry of openFindings(parentDoc.attention).filter(entry => PAGE_CODES.includes(entry.code))) {
        if (!blockEffects.some(effect => effect.target.issue === entry.issue) && plan.observed.issues.has(entry.issue)) {
          blockEffects.push({ kind: 'replace_block', target: { issue: entry.issue }, state: true });
        }
      }
      if (blockEffects.length || writtenChildren.size || this.pass.stopped || finalRedraw) {
        guard();
        // Queue bookkeeping now touches only the parent. Reuse this saved child snapshot for task
        // pages and any final redraw; reading every child again adds no state written by this pass.
        if (!docs) docs = new Map(plan.parent.outcomes.map(outcome => [outcome.issue, this.store.read('child', outcome.issue).doc]).filter(([, doc]) => doc));
        const comments = new Map(plan.observed.comments);
        const blocks = this.renderAll(parentDoc, docs, plan.observed.issues, comments);
        const version = this.toolkitVersion;
        // The final parent check follows actual child writes, even when planning found no body change.
        const ordered = parentOnly ? [blockEffects.find(effect => effect.target.issue === parentNumber) || null] : blockEffects.filter(effect => effect.target.issue !== parentNumber);
        for (const planned of ordered) {
          if (!planned && !writtenChildren.size && !this.pass.stopped && !finalRedraw) continue;
          if (parentOnly ? this.pass.left() < END_RESERVE_MS : this.pass.stop()) break;
          const number = planned?.target.issue ?? parentNumber;
          const body = number === parentNumber ? renderParentBlockBody(parentDoc, docs, plan.observed.issues, comments) : blocks.get(number);
          const candidate = planned || { kind: 'replace_block', target: { issue: number }, state: true };
          let effect = { ...candidate, target: { ...candidate.target, digest: blockDigest(body) } };
          if (!effect.text) effect.text = describeEffect(effect);
          if (isHeld(`#${number}`, 'body')) { record(effect, 'SKIPPED', 'held earlier in this pass'); continue; }
          if (!version) { record(effect, 'HELD', 'the Toolkit version could not be read'); hold(effect, 'TOOLKIT_VERSION_UNKNOWN', 'the Toolkit version could not be read, so no block was written'); continue; }
          if (number !== parentNumber && !docs.has(number)) { record(effect, 'SKIPPED', 'no state document yet'); continue; }
          const navBody = this.navFor(parentDoc, number, docs);
          // A final redraw can display settled size findings only after the queue completed.
          // Persist those resolutions only after this exact body also reads back.
          const displayParent = finalAttention ? { ...parentDoc, attention: finalAttention } : number === parentNumber && finalRedraw && plan.complete && !holds.length && !this.pass.stopped
            ? { ...parentDoc, attention: (parentDoc.attention || []).map(entry => canResolveSize(entry, true) ? { ...entry, state: 'resolved' } : entry) } : parentDoc;
          const currentBody = number === parentNumber ? renderCurrentBlockBody(displayParent, docs, plan.observed.issues, this.now(), this.boardLine(displayParent)) : null;
          const topic = this.topicFor(parentDoc, number, plan.observed.issues);
          if (number === parentNumber) {
            try { parentPage(effect, body, version, currentBody); }
            catch (error) {
              if (!error.code || STOPS_PASS.has(error.code)) throw error;
              record(effect, 'HELD', error.message); hold(effect, error.code, error.message, error.diagnostics);
            }
            continue;
          }
          // Recheck minimum size and version before posting any pages as well as before the body
          // write. A newly oversized hand-written section must not produce orphan index comments.
          const plannedPosts = plan.effects.filter(entry => entry.kind === 'post_index_comment' && !entry.target.directory && entry.target.issue === number);
          const topicBudget = plannedPosts.reduce((count, entry) => count + entry.target.parts.length, 0);
          // The latest unchanged read, reused by the body write when nothing was posted after it.
          let fresh = null;
          const preview = (budget = topicBudget) => {
            const page = this.reader.issue(number);
            if (!page) throw new ProgrammeError('ISSUE_MISSING', 'The issue could not be read.');
            const newest = newestBlockVersion(page.body);
            if (newest && versionNewer(newest, version)) throw new ProgrammeError('BLOCK_NEWER_TOOLKIT', `#${number} was written by Toolkit ${newest}, newer than this copy (${version}); update Toolkit on this computer, then run again`);
            comments.set(number, this.reader.comments(number));
            const next = this.projectBody(number, page.body, body, comments.get(number), version, navBody, currentBody, topic, budget, { relay: this.taskRelay(number, page).relay });
            if (next.refused || next.body.length >= this.threshold) {
              const error = new ProgrammeError('BODY_TOO_LARGE', `Controller: the body would reach ${next.body.length} characters (threshold ${this.threshold}); shorten it first`);
              error.diagnostics = bodySizeDiagnostics(next.body, this.threshold);
              throw error;
            }
            fresh = { page, comments: comments.get(number) };
            return next;
          };
          // Planned topic pages are checked against a fresh read before any is posted.
          if (plannedPosts.length) {
            try { preview(); }
            catch (error) { if (!error.code || STOPS_PASS.has(error.code)) throw error; record(effect, 'HELD', error.message); hold(effect, error.code, error.message, error.diagnostics); continue; }
          }
          // An overflowing tag's list first moves into its own new index comment, checked by reading it back.
          const publishIndexes = posts => {
            flush();
            for (const post of posts) withIntent(post, () => {
              const intent = intentId(post.kind, post.target);
              const bodies = indexCommentBodies(number, post.lines, intent, post.target.tag, post.label, post.target.directory);
              const existing = this.reader.comments(number);
              if (indexReadback(existing, intent, post.target.parts) === null) return { outcome: 'UNKNOWN', detail: 'the index pages differ from their intent' };
              for (const text of bodies) {
                if (existing.some(comment => comment.body === text)) continue;
                if (redrawing ? this.pass.left() < END_RESERVE_MS : this.pass.stop()) { this.pass.stop(); return { outcome: 'UNKNOWN', detail: 'The time budget stopped index paging.' }; }
                if (postsLeft(number) <= 0) return { outcome: 'NOT_DONE', detail: 'The five-comment budget is spent.' };
                guard();
                posted(number);
                this.mutator.postComment(number, text);
                // Stop on the first uncertain response, including a lost successful response.
                // The next pass reads it back before choosing the remaining pages.
                if (!this.reader.comments(number).some(comment => comment.body === text)) return { outcome: 'UNKNOWN', detail: 'an index page did not read back exactly as written' };
              }
              return indexReadback(this.reader.comments(number), intent, post.target.parts) === true ? { outcome: 'DONE' } : { outcome: 'UNKNOWN', detail: 'the index pages did not read back exactly as written' };
            });
            flush();
          };
          if (plannedPosts.length) { fresh = null; publishIndexes(plannedPosts); }
          // Page remaining full topic lines directly, reusing any older verified topic indexes.
          if (!isHeld(`#${number}`, 'body')) {
            try {
              const next = preview(0);
              if (next.overflow.some(part => !part.directory)) {
                const error = new ProgrammeError('BODY_TOO_LARGE', 'The comment trace changed while paging; the next pass re-plans it.');
                error.diagnostics = bodySizeDiagnostics(next.body, this.threshold);
                throw error;
              }
              const posts = next.overflow.map(part => {
                const post = indexEffect(number, part, String(comments.get(number).at(-1)?.id || ''));
                post.text = describeEffect(post);
                return post;
              });
              if (posts.length) { fresh = null; publishIndexes(posts); }
            } catch (error) { if (!error.code || STOPS_PASS.has(error.code)) throw error; record(effect, 'HELD', error.message); hold(effect, error.code, error.message, error.diagnostics); }
          }
          if (isHeld(`#${number}`, 'body')) { record(effect, 'SKIPPED', 'the comment trace could not move to an index comment'); continue; }
          // The new body is built from a fresh read, so earlier edits by people are kept. Refuse before
          // writing an intent when the block is broken or the body would grow past the threshold.
          // Nothing was posted since the last preview, so its read is still the one to build on; the
          // write itself re-reads and refuses on any change.
          const before = fresh ? fresh.page : this.reader.issue(number);
          if (!before) { record(effect, 'HELD', 'the issue could not be read'); hold(effect, 'ISSUE_MISSING', 'the issue could not be read'); continue; }
          const newest = newestBlockVersion(before.body);
          if (newest && versionNewer(newest, version)) { record(effect, 'HELD', `written by Toolkit ${newest}`); hold(effect, 'BLOCK_NEWER_TOOLKIT', `#${number} was written by Toolkit ${newest}, newer than this copy (${version}); update Toolkit on this computer, then run again`); continue; }
          let next;
          let waits = false;
          comments.set(number, fresh ? fresh.comments : this.reader.comments(number));
          try {
            next = this.projectBody(number, before.body, body, comments.get(number), version, navBody, currentBody, topic, 0, { relay: this.taskRelay(number, before).relay });
            // Past the per-pass limit a page that would have its text moved keeps its old layout
            // for now; its blocks are still updated where they are.
            if (next.relaid && next.moves && relays >= MAX_RELAYS_PER_PASS) { next = this.projectBody(number, before.body, body, comments.get(number), version, navBody, currentBody, topic, 0, { relay: false }); waits = true; }
          } catch (error) { if (!error.code) throw error; record(effect, 'HELD', error.message); hold(effect, error.code, error.message); continue; }
          effect = { ...effect, target: { ...effect.target, trace: blockDigest(next.traceBody), ...(navBody ? { nav: blockDigest(navBody) } : {}), ...(currentBody ? { current: blockDigest(currentBody) } : {}) } };
          // The result says what was done to this page: a re-lay names its saved copy, and a page
          // that keeps its old order for now says so.
          const laidOut = Boolean(next.relaid && next.moves);
          if (Boolean(effect.relay) !== laidOut) { effect = { ...effect, relay: laidOut }; effect.text = describeEffect(effect); }
          let done = waits ? `the blocks were updated where they are; the page is laid out in a later pass (at most ${MAX_RELAYS_PER_PASS} pages are laid out per pass)` : null;
          if (next.overflow.length || next.body.length >= this.threshold) {
            record(effect, 'HELD', `the body would be ${next.body.length} characters`);
            hold(effect, 'BODY_TOO_LARGE', `Controller: the body would reach ${next.body.length} characters (threshold ${this.threshold}); shorten it first`, bodySizeDiagnostics(next.body, this.threshold));
            continue;
          }
          if (next.body === before.body) { verifiedBodies.add(number); record(effect, 'NOOP'); continue; }
          if (next.relaid && next.moves) {
            // Hand-written text is about to move: the page as it is now is saved and read back
            // first. Without that copy nothing is written.
            try { guard(); const copy = this.store.savePageCopy(number, before); relays += 1; done = `the page was laid out in the fixed order; the page as it was is saved at ${copy.path} in the state store`; }
            catch (error) {
              if (!error.code || STOPS_PASS.has(error.code)) throw error;
              record(effect, 'HELD', 'the copy of the page could not be saved');
              hold(effect, 'PAGE_COPY_FAILED', `#${number} was not re-laid because the copy of its present page could not be saved (${error.code}); the next pass tries again`);
              continue;
            }
          }
          withIntent(effect, () => {
            // Issue PATCH has no compare-and-swap: re-read immediately before writing and refuse on change.
            const latest = this.reader.issue(number);
            if (!latest || latest.body !== before.body || latest.updated_at !== before.updated_at) {
              return { outcome: 'NOT_DONE', code: 'BODY_MOVED', detail: 'the issue changed between the read and the write; the next pass re-plans it' };
            }
            guard();
            const response = this.mutator.writeBody(number, next.body);
            const after = this.reader.issue(number);
            if (after && after.body === next.body) { verifiedBodies.add(number); return { outcome: 'DONE', ...(done ? { detail: done } : {}) }; }
            if (!okStatus(response.status) && after && after.body === before.body) return { outcome: 'NOT_DONE', detail: `GitHub answered ${response.status}` };
            return { outcome: 'UNKNOWN', detail: 'the body did not read back exactly as written' };
          });
        }
      }

      flush();
    };
    recordStopped();
    if (!this.pass.stopped) this.pass.phaseAt('page', 1);
    redrawing = true;
    renderPages(true);
    redrawing = false;

    phase('links', plan.effects.filter(entry => ['attach', 'reparent'].includes(entry.kind)).length);
    // 2. Native parent links, read back on both sides.
    for (const effect of plan.effects.filter(entry => entry.kind === 'attach' || entry.kind === 'reparent')) {
      if (this.pass.stop()) break;
      if (isHeld(`#${effect.target.issue}`, 'links')) { record(effect, 'SKIPPED', 'held earlier in this pass'); continue; }
      withIntent(effect, () => {
        guard();
        const response = this.mutator.attach(effect.target.parent, effect.childId, effect.kind === 'reparent');
        const issue = this.reader.issue(effect.target.issue);
        const listed = this.reader.subIssues(effect.target.parent).some(sub => sub.number === effect.target.issue);
        if (issue?.parent === effect.target.parent && listed) return { outcome: 'DONE' };
        if (issue && issue.parent !== effect.target.parent && !listed) return { outcome: 'NOT_DONE', detail: `GitHub answered ${response.status}: ${response.json?.message || ''}`.trim() };
        return { outcome: 'UNKNOWN', detail: 'the child and parent disagree after the change' };
      });
    }

    phase('order', plan.effects.filter(entry => entry.kind === 'reorder').length);
    // 3. Order, recomputed from a fresh list for each parent just before moving.
    const reorderParents = [...new Set(plan.effects.filter(entry => entry.kind === 'reorder').map(entry => entry.target.parent))];
    const graph = graphOrder(parentDoc, settledChildren, plan.observed.issues);
    for (const parentIssue of reorderParents) {
      if (this.pass.stop()) break;
      const desired = graph.filter(outcome => outcome.parent === parentIssue).map(outcome => outcome.issue);
      const fresh = this.reader.subIssues(parentIssue);
      const ids = new Map(fresh.map(sub => [sub.number, sub.id]));
      for (const move of orderMoves(fresh.map(sub => sub.number), desired)) {
        if (this.pass.stop()) break;
        const effect = { kind: 'reorder', target: { parent: parentIssue, ...move } };
        effect.text = describeEffect(effect);
        withIntent(effect, () => {
          const anchor = move.before !== undefined ? { before_id: ids.get(move.before) } : { after_id: ids.get(move.after) };
          guard();
          const response = this.mutator.reorder(parentIssue, ids.get(move.issue), anchor);
          if (moveDone(this.reader.subIssues(parentIssue), move)) return { outcome: 'DONE' };
          return { outcome: okStatus(response.status) ? 'UNKNOWN' : 'NOT_DONE', detail: `GitHub answered ${response.status}` };
        });
      }
    }

    flush();
    phase('pr_links', plan.effects.filter(entry => entry.kind === 'replace_pr_nav').length);
    // 4. The parent and task links at the top of each open or draft PR, built from a fresh read.
    for (const effect of plan.effects.filter(entry => entry.kind === 'replace_pr_nav')) {
      if (this.pass.stop()) break;
      const number = effect.target.issue;
      const pr = effect.target.pr;
      if (isHeld(`#${number}`, 'pr')) { record(effect, 'SKIPPED', 'held earlier in this pass'); continue; }
      if (!this.toolkitVersion) { record(effect, 'HELD', 'the Toolkit version could not be read'); hold(effect, 'TOOLKIT_VERSION_UNKNOWN', 'the Toolkit version could not be read, so no links were written'); continue; }
      const before = this.reader.issue(pr);
      if (!before) { record(effect, 'HELD', 'the PR could not be read'); hold(effect, 'ISSUE_MISSING', `PR #${pr} could not be read`); continue; }
      // A PR merged or closed since planning is never edited.
      if (!before.is_pull_request || before.state !== 'open') { record(effect, 'SKIPPED', 'the PR is no longer open'); continue; }
      const newest = newestBlockVersion(before.body);
      if (newest && versionNewer(newest, this.toolkitVersion)) { record(effect, 'HELD', `written by Toolkit ${newest}`); hold(effect, 'BLOCK_NEWER_TOOLKIT', `PR #${pr} was written by Toolkit ${newest}, newer than this copy (${this.toolkitVersion}); update Toolkit on this computer, then run again`); continue; }
      let next;
      try {
        next = effect.status_body ? upsertPrBlocks(before.body, renderBlock(effect.body, this.toolkitVersion, NAV_BLOCK_NAME), renderBlock(effect.status_body, this.toolkitVersion))
          : upsertNavBlock(before.body, renderBlock(effect.body, this.toolkitVersion, NAV_BLOCK_NAME));
        assertBlocksReadBack(next, [[NAV_BLOCK_NAME, effect.body], [BLOCK_NAME, effect.status_body]], `PR #${pr}`);
      } catch (error) { record(effect, 'HELD', error.message); hold(effect, error.code, error.message); continue; }
      if (next === before.body) { record(effect, 'NOOP'); continue; }
      withIntent(effect, () => {
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

    flush();
    phase('task_pages', plan.effects.filter(entry => entry.kind === 'replace_block' && entry.target.issue !== parentNumber).length);
    renderPages(false);

    phase('lifecycle', plan.effects.filter(entry => ['set_parent_state', 'post_parent_repair'].includes(entry.kind)).length);
    // Lifecycle changes run after native links and page writes, using the same fence and intents.
    for (const effect of plan.effects.filter(entry => ['set_parent_state', 'post_parent_repair'].includes(entry.kind))) {
      if (!plan.complete || holds.length || this.pass.stop()) break;
      if (isHeld(`#${parentNumber}`, 'lifecycle')) { record(effect, 'SKIPPED', 'parent lifecycle held earlier'); continue; }
      if (effect.kind === 'post_parent_repair' && this.binding.parent_lifecycle?.reopen_incomplete !== true) { record(effect, 'SKIPPED', 'repair permission is absent'); continue; }
      if (effect.kind === 'set_parent_state' && effect.target.state === 'closed' && (!plan.complete || holds.length)) { record(effect, 'SKIPPED', 'the pass is incomplete'); continue; }
      withIntent(effect, () => {
        guard();
        if (effect.kind === 'set_parent_state') {
          const response = this.mutator.setIssueState(parentNumber, effect.target.state, { binding: this.binding, expected: effect.target.expected, fence: guard });
          const after = this.reader.issue(parentNumber);
          if (after?.state === effect.target.state && (effect.target.state !== 'closed' || after.state_reason === 'completed')) return { outcome: 'DONE' };
          return { outcome: okStatus(response.status) ? 'UNKNOWN' : 'NOT_DONE', detail: 'Parent lifecycle did not read back as requested.' };
        }
        const before = this.reader.issue(parentNumber);
        if (before?.state !== 'open') return { outcome: 'NOT_DONE', detail: 'The repaired parent is not open.' };
        if (!this.reader.comments(parentNumber).some(comment => comment.body.includes(effect.target.marker))) {
          if (postsLeft(parentNumber) <= 0) return { outcome: 'NOT_DONE', detail: 'The five-comment budget is spent; the repair notice remains owed.' };
          guard();
          posted(parentNumber);
          this.mutator.postComment(parentNumber, effect.target.body);
        }
        return { outcome: this.reader.comments(parentNumber).some(comment => comment.body.includes(effect.target.marker)) ? 'DONE' : 'UNKNOWN' };
      });
    }

    flush();
    phase('closing', plan.effects.filter(entry=>entry.kind==='post_closing_backstop').length);
    for (const effect of plan.effects.filter(entry=>entry.kind==='post_closing_backstop')) {
      if (this.pass.stop(QUEUE_RESERVE_MS)) break;
      requireRefresh();
      withIntent(effect,()=>{
        const item=this.closing.item(effect.target.kind,effect.target.issue);
        if (item.raw.state!=='closed' || item.closed_at!==effect.target.closed_at) return {outcome:'NOT_DONE',detail:'The closing item changed; refresh again.'};
        if (item.kind==='pr' && excludedGraphPr({author:item.raw.user?.login,branch:item.raw.head?.ref})) return {outcome:'DONE'};
        const before=this.closing.comments(item);
        if (!before.complete) return {outcome:'UNKNOWN',detail:'The closing comment request cap was reached; retry next pass.'};
        if (before.story || before.facts) return {outcome:'DONE'};
        const body=this.closing.guard(effect.target.body);
        const fresh=this.closing.item(effect.target.kind,effect.target.issue);
        if (fresh.raw.state!=='closed' || fresh.closed_at!==item.closed_at) return {outcome:'NOT_DONE',detail:'The item reopened or closed again; refresh before posting.'};
        if (this.pass.stop(QUEUE_RESERVE_MS)) return {outcome:'NOT_DONE',detail:'The closing post waits for the next pass.'};
        guard();
        this.mutator.postComment(effect.target.issue,body);
        const after=this.closing.comments(item);
        return {outcome:after.complete && (after.facts || after.story) ? 'DONE':'UNKNOWN'};
      });
    }
    flush();
    if (plan.complete && !holds.length && !this.pass.stop() && verifiedBodies.size) {
      if ((parentDoc.attention || []).some(entry => canResolveSize(entry))) {
        finalRedraw = true; redrawing = true; renderPages(true); redrawing = false;
      }
      if (!holds.length && !this.pass.stop()) {
        mutateDoc('parent', parentNumber, { change: doc => {
          let changed = false;
          doc.attention = (doc.attention || []).map(entry => {
            if (!canResolveSize(entry)) return entry;
            changed = true;
            return { ...entry, state: 'resolved', changed_at: this.now() };
          });
          return changed ? doc : null;
        } });
      }
    }
    let closingSaved=true;
    for (const effect of plan.effects.filter(entry=>entry.kind==='advance_closing_scan')) {
      if (this.pass.stop()) { closingSaved=false; break; }
      requireRefresh();
      try {
        const result=mutateDoc('parent',parentNumber,{change:doc=>{
          doc.private={...doc.private,closing_scan:effect.pending,...(effect.watermark ? {graph_issue_watermark:effect.watermark}:{})}; return doc;
        }});
        record(effect,result.outcome==='NOOP'?'NOOP':'DONE');
      } catch(error) {
        if(STOPS_PASS.has(error.code)) throw error;
        closingSaved=false; hold(effect,error.code || 'STATE_WRITE_FAILED',error.message); record(effect,'HELD',error.message);
      }
    }
    for(const effect of plan.effects.filter(entry=>entry.kind==='advance_pr_watermark')) {
      if (!closingSaved) break;
      requireRefresh();
      if(!plan.complete || holds.length || this.pass.stop()) {record(effect,'SKIPPED','incomplete pass keeps the prior watermark');continue;}
      try {
        const result=mutateDoc('parent',parentNumber,{change:doc=>{
          if(doc.private?.graph_pr_watermark && Date.parse(doc.private.graph_pr_watermark)>=Date.parse(effect.watermark)) return null;
          doc.private={...doc.private,graph_pr_watermark:effect.watermark}; return doc;
        }});
        record(effect,result.outcome==='NOOP'?'NOOP':'DONE');
      } catch(error) {
        if(STOPS_PASS.has(error.code)) throw error;
        hold(effect,error.code || 'STATE_WRITE_FAILED',error.message); record(effect,'HELD',error.message);
      }
    }
    recordStopped();
    if (this.pass.stopped && this.pass.left() >= END_RESERVE_MS) {
      redrawing = true;
      renderPages(true);
      redrawing = false;
    } else if (plan.complete && !holds.length && !this.pass.stopped
      && !parentDoc.pending_effects.some(entry => entry.kind === 'post_parent_repair')) {
      // Only a complete, unheld pass may resolve an earlier stopped-pass finding. Use the existing
      // fold rule and keep every unrelated finding unchanged.
      const next = foldAttention(parentDoc.attention, { source: 'reconcile', complete: true, now: this.now(),
        seen: plan.findings.filter(entry => entry.code === 'PASS_STOPPED'),
        hold: (parentDoc.attention || []).filter(entry => entry.code !== 'PASS_STOPPED').map(entry => entry.id) });
      if (JSON.stringify(next) !== JSON.stringify(parentDoc.attention)) {
        finalAttention = next;
        finalRedraw = true; redrawing = true; renderPages(true); redrawing = false;
        if (!holds.length && !this.pass.stop()) {
          mutateDoc('parent', parentNumber, { change: doc => {
            doc.attention = foldAttention(doc.attention, { source: 'reconcile', complete: true, now: this.now(),
              seen: plan.findings.filter(entry => entry.code === 'PASS_STOPPED'),
              hold: (doc.attention || []).filter(entry => entry.code !== 'PASS_STOPPED').map(entry => entry.id) });
            return doc;
          } });
        }
        finalAttention = null;
      }
    }
    recordStopped();
    return { results, holds, attention: attentionLine(parentDoc.attention, this.now()) };
  }

  run({ apply = false, issue = null, parentOverride = null, inventory = null, queued = null } = {}) {
    const plan = this.plan({ issue, parentOverride, inventory, queued });
    // A queued pass stops reading here; what follows saves, settles and draws within its reserve.
    this.queued?.settle?.();
    const report = {
      repository: this.binding.repository,
      parent_issue: this.binding.parent_issue,
      store: { ...this.binding.store },
      mode: apply ? 'apply' : 'dry-run',
      parent_revision: plan.parent?.revision ?? null,
      findings: plan.findings,
      close_list: plan.findings.filter(finding => finding.code === 'READY_TO_CLOSE').map(({ issue, pr, head, gate, gate_accepted, accepted, closable, uat, review }) => ({ issue, pr, head, gate, gate_accepted, accepted, closable, uat, review })),
      effects: plan.effects.map(effect => ({ kind: effect.kind, target: effect.target, text: effect.text, ...(effect.backfill ? { backfill: effect.backfill } : {}) })),
      recovered: plan.resolutions,
      holds: plan.holds,
      results: [],
      writes: { state: 0, github: 0 },
      ...(plan.observed?.closing ? {closing:{complete:plan.observed.closing.complete && !plan.observed.closing.incomplete.length && !plan.observed.closing.errors.length,
        incomplete:plan.observed.closing.incomplete.map(item=>({kind:item.kind,number:item.number})),planning_requests:plan.observed.closing.requests,requests:plan.observed.closing.requests,errors:plan.observed.closing.errors}} : {}),
      ...(inventory ? { inventory: { complete: inventory.complete, reason: inventory.reason, counts: inventoryCounts(inventory) } } : {}),
      // What the read copy saved this pass: counts only.
      ...(this.readCache && this.refreshFacts && !issue ? { reads: { ...this.readCache.counts } } : {}),
    };
    if (apply && plan.stopped && plan.parent && plan.snapshot?.head && !plan.noWrite) {
      const finding = plan.findings[0];
      const writes = this.store.writes;
      // Planning expiry commits only the finding and the queue. No recovered intent or planned effect is applied.
      const batch = this.openBatch(plan.snapshot, plan.parent.parent_issue);
      batch.mutate('parent', plan.parent.parent_issue, { writer: this.writer, change: doc => {
        doc.attention = foldAttention(doc.attention, { source: 'reconcile', complete: false, seen: [finding], now: this.now() });
        return this.sweepChange ? this.sweepChange(doc) || doc : doc;
      } });
      try {
        this.store.commitBatch(batch);
        report.writes.state = this.store.writes - writes;
        // The newer stop is recorded, so a predecessor's note is reported by it.
        this.pass.progress?.reported();
      } catch (error) {
        if (error.code !== 'STATE_BRANCH_BUSY') throw error;
        this.stopReason = error.reason;
      }
    } else if (apply && plan.parent && (this.pass.progress?.interrupted || plan.effects.length || this.sweepChange || plan.resolutions.some(entry => entry.outcome !== 'UNKNOWN'))) {
      const storeWrites = this.store.writes;
      const githubWrites = this.mutator.mutations;
      let applied;
      // A state phase that ends before its commit still closes the lease's commit window.
      try { applied = this.apply(plan); } finally { this.queued?.lease?.close({}); }
      const { results, holds, attention, noWrite } = applied;
      if (noWrite) plan.noWrite = true;
      report.results = results;
      report.holds = holds;
      report.attention = attention;
      report.writes = { state: this.store.writes - storeWrites, github: this.mutator.mutations - githubWrites };
    }
    if (report.closing) report.closing.requests=this.closing.requests;
    report.summary = !plan.parent ? 'No parent state document'
      : !report.effects.length && !report.holds.length && !plan.resolutions.length ? 'No changes'
        : apply ? `${report.results.filter(entry => entry.outcome === 'DONE').length} of ${report.results.length} effect(s) done, ${report.holds.length} hold(s)`
          : `${report.effects.length} planned effect(s), ${report.holds.length} hold(s)`;
    const planned = plan.effects.find(effect => effect.kind === 'update_attention');
    report.attention = report.attention ?? (planned ? planned.line : plan.parent ? attentionLine(plan.parent.attention) : null);
    const attention = report.findings.filter(finding => ATTENTION.has(finding.code));
    report.next_action = report.holds.length ? `Controller: resolve ${report.holds[0].code} on ${report.holds[0].target}: ${report.holds[0].detail}`
      : !apply && report.effects.length ? 'Controller: run reconcile --apply --controller for this plan; other sessions report it'
        : !apply && plan.resolutions.some(entry => entry.outcome !== 'UNKNOWN') ? `Controller: run reconcile --apply --controller to clear ${plan.resolutions.filter(entry => entry.outcome !== 'UNKNOWN').length} settled intent(s)`
        : attention.length ? `Controller: decide on ${attention.length} finding(s) the reconciler does not change, starting with ${attention[0].code} on #${attention[0].issue}`
          : 'None: the state documents and GitHub agree';
    if (typeof this.store.stateBranch === 'function') report.state_branch = this.store.stateBranch();
    // What a queued pass leaves for the next one.
    if (this.queued) {
      const sweep = plan.observed?.sweep;
      report.sweep = { complete: Boolean(plan.complete && !plan.stopped && !this.pass.stopped), changedComplete: Boolean(sweep?.changedComplete),
        board_time: this.board?.time || null,
        read: sweep?.read.length ?? 0, tasks: sweep?.read || [], why: sweep?.why || {}, left: sweep ? sweep.left.length + sweep.failed.length : (this.sweepOrder?.length ?? plan.parent?.sweep?.queue.length ?? 0),
        changedCursor: sweep?.changedCursor || null,
        noWrite: Boolean(plan.noWrite), reason: this.stopReason || plan.reason || this.pass.stopReason || this.pausedBy || (this.pass.stopped ? 'time limit' : sweep?.left.length ? 'tasks still to check' : null) };
    }
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
  get IssueClosureGuard() { return require('./issue-closure.cjs').IssueClosureGuard; },
  SCHEMA, BINDING_FILE, CLASSES, LIFECYCLES, PATCHABLE_CHILD_FIELDS, PATCHABLE_PARENT_FIELDS, BLOCK_SOURCE, BLOCK_NAME, TRACE_BLOCK_NAME,
  ProgrammeError, GitHubTransport, StateStore, STORE_BACKENDS, ProgrammeGraphReader, GitHubMutator, Reconciler,
  canonical, canonicalText, contentDigest, sameState, validateParent, validateChild, validateBinding, bindingEnabled, assertValid, loadBinding,
  newParent, newChild, isHolder, isLaneHolder, parentRefusal, authoriseWrite, claimDocument, claimLane, assignGate, reopenGate, interruptGate,
  recordReturn, consumeReturn, foldJournals, validateJournal, currentGateAccepted, completionAccepted, applyPatch, refuseNewLegacy, legacyMigrationPatch, orderTies,
  evaluateChecks, renderParentBlockBody, renderChildBlockBody, renderTraceBlockBody, renderCurrentBlockBody, renderBlock, blockDigest, findStateBlock, upsertStateBlock, upsertTraceBlock,
  orderMoves, intentId, describeEffect, resolveExecutable, isGitHubHost, originSlug, bindRepository,
  SECRET_SHAPES, screenSecrets, referencedIssues, FINDING_CODES, ATTENTION_KEEP, ATTENTION_LIMIT, findingId, foldAttention, answerFinding, attentionCounts, attentionLine, openFindings, findingText, attentionDigest, bodySizeDiagnostics,
  RefreshBudget, REFRESH_BUDGET_MS, PASS_BUDGETS, PAGE_RESERVE_MS, END_RESERVE_MS, AGAIN_RESERVE_MS, validatePassDiagnostics,
  ProgrammeInventory, INVENTORY_CLASSES, INVENTORY_DEADLINE_MS, registeredParents,
  STATE_BRANCH, STATE_PATH, STATE_SCHEMA, SIDECAR_KEEP, BranchStateStore, STATE_BACKENDS, openStore, publicView, validatePublic, documentName,
  refreshWriter, isDecisionHolder, sha256, sessionsOf,
  SAFE_LIMIT, renderContextBlockBody, renderNavBlockBody, renderPrNavBlockBody, renderPrStatusBlockBody, upsertPrBlocks, upsertNavBlock, assertBlocksReadBack, NAV_BLOCK_NAME, latestPr, MAX_RELAYS_PER_PASS, TASK_IDLE_HOURS, TASK_MERGED_OPEN_HOURS, PR_STALE_HOURS, WORK_QUEUE_CODES, workQueue,
  contextCommentIds, excludedGraphPr, StateBatch, validateSweepRecord, validateSweepHistory, SWEEP_HISTORY_SCHEMA, ROTATION_PASSES, PASS_PHASES, STOPS_PASS,
  DISCOVERY_BASE, discoveryBudget, CHANGED_PAGES, LIST_PAGE_GUARD,
});
