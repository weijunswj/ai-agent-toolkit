'use strict';

const crypto = require('node:crypto');
const SURFACE_CONTRACT = require('../contracts/github-program-reconciler/programme-surface-contract.json');

const STATE_SCHEMA = 'toolkit.github-program.state.v4';
const PROJECTION_SCHEMA = 'toolkit.github-program.projection.v1';
const EXTENSIONS_SCHEMA = 'toolkit.github-program.extensions.v1';
const SCOPE_SCHEMA = 'toolkit.github-program.scope-grant.v1';
const PR_INSPECTION_SCHEMA = 'toolkit.github-program.trusted-pr-inspection.v1';
const RELATIONSHIP_INSPECTION_SCHEMA = 'toolkit.github-program.trusted-relationship-inspection.v1';
const MIGRATION_SCHEMA = 'toolkit.github-program.migration.v1';
const MANAGED_EVENT_SCHEMA = 'toolkit.github-program.managed-event.v2';
const DESIGN_LOCK = 'DL-S2-GITHUB-PROGRAM-CONVERGENCE-002';
const BODY_BUDGET_BYTES = 56 * 1024;
const CANONICAL_STATE_BUDGET_BYTES = 32 * 1024;
const TOTAL_PROJECTION_BUDGET_BYTES = 512 * 1024;
const LIFECYCLES = Object.freeze(['QUEUED', 'CURRENT', 'COMPLETED', 'RETIRED']);
const REGISTRY_STATUSES = Object.freeze(['ACTIVE', 'ACCEPTED', 'RETIRED']);
const LIVE_PR_LIFECYCLES = Object.freeze(['OPEN_DRAFT', 'OPEN_READY', 'MERGED', 'CLOSED_UNMERGED']);
const EXTENSION_CLASSES = Object.freeze(['INFORMATION', 'EVIDENCE', 'POLICY', 'DOMAIN_HEALTH', 'TABLE', 'PROVENANCE']);
const RESERVED_EXTENSION_KEYS = new Set([
  'status', 'lifecycle', 'current', 'current_status', 'current_gate', 'current_epoch', 'cursor', 'gate', 'epoch',
  'candidate', 'candidate_lock', 'lock', 'role', 'completes_child', 'finality', 'holds', 'blocked', 'next_action',
  'progress', 'outcome', 'remaining', 'achieved', 'pr_status', 'pr_state', 'version', 'head', 'tree', 'base',
  'base_ref', 'base_sha', 'epoch_id',
]);
const MARKERS = Object.freeze({
  parent: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:BEGIN v2 -->', end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:END -->' }),
  child: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:BEGIN v2 -->', end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:END -->' }),
  pr: Object.freeze({ begin: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:BEGIN v2 -->', end: '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:END -->' }),
});
const STATE_LINE_PREFIX = '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CANONICAL v4 ';
const PROJECTION_LINE_PREFIX = '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PROJECTION v1 ';
const LEGACY_STATE_LINE_PREFIX = '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-STATE v1 ';
const LINE_SUFFIX = ' -->';
const scopeGrants = new WeakSet();
const prInspections = new WeakSet();
const relationshipInspections = new WeakSet();

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
function canonicalJson(value) { return JSON.stringify(sortValue(value)); }
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value), 'utf8').digest('hex'); }
function bytes(value) { return Buffer.byteLength(typeof value === 'string' ? value : canonicalJson(value), 'utf8'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function ok(code, extra = {}) { return { ok: true, code, ...extra }; }
function fail(reason, extra = {}) { return { ok: false, code: 'PARENT_RECONCILIATION_INCOMPLETE', reason, ...extra }; }
function issue(value) { return Number.isSafeInteger(value) && value > 0; }
function safeLine(value, limit = 512) { return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\r\n]/.test(value); }
function safeText(value, limit = 4096) { return typeof value === 'string' && value.length > 0 && value.length <= limit && !/```|(?:^|[\\/])(?:Users|home|private|secrets?)(?:[\\/]|$)|(?:token|password|secret|api[_-]?key)\s*[:=]/i.test(value); }
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function sha(value) { return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value); }
function sha256(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function arrayOf(value, predicate, max = 100) { return Array.isArray(value) && value.length <= max && value.every(predicate); }
function same(a, b) { return canonicalJson(a) === canonicalJson(b); }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function exactKeys(value, required, optional = []) {
  if (!isRecord(value) || required.some((key) => !hasOwn(value, key))) return false;
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key));
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}
function encode(value) { return Buffer.from(canonicalJson(value), 'utf8').toString('base64url'); }
function decode(value) { try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch (_error) { return null; } }
function markdownCell(value) { return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '); }
function table(headers, rows) {
  return ['| ' + headers.map(markdownCell).join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |', ...rows.map((row) => '| ' + row.map(markdownCell).join(' | ') + ' |')].join('\n');
}
function list(values) { return values.length ? values.map((value) => '- ' + value).join('\n') : '- None'; }
function normalizedKey(key) { return String(key).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function forbiddenExtensionKey(key) {
  const normalized = normalizedKey(key);
  return RESERVED_EXTENSION_KEYS.has(normalized)
    || normalized.startsWith('current_')
    || normalized.endsWith('_status')
    || normalized.endsWith('_lifecycle')
    || normalized.includes('candidate_lock')
    || normalized.includes('next_action');
}

function extensionPayloadValid(extension) {
  const payload = extension.payload;
  if (!isRecord(payload)) return false;
  if (extension.class === 'TABLE') {
    return exactKeys(payload, ['columns', 'rows'])
      && arrayOf(payload.columns, (entry) => safeLine(entry, 80), 12)
      && payload.columns.length > 0
      && payload.columns.every((entry) => !forbiddenExtensionKey(entry))
      && Array.isArray(payload.rows)
      && payload.rows.length <= 100
      && payload.rows.every((row) => Array.isArray(row) && row.length === payload.columns.length && row.every((cell) => safeLine(String(cell), 256)));
  }
  const allowed = {
    INFORMATION: ['text'], EVIDENCE: ['summary', 'references'], POLICY: ['summary', 'references'],
    DOMAIN_HEALTH: ['domain', 'status', 'summary'], PROVENANCE: ['summary', 'references'],
  }[extension.class];
  if (!allowed) return false;
  const required = extension.class === 'INFORMATION' ? ['text'] : extension.class === 'DOMAIN_HEALTH' ? ['domain', 'status', 'summary'] : ['summary'];
  const optional = extension.class === 'INFORMATION' || extension.class === 'DOMAIN_HEALTH' ? [] : ['references'];
  if (!exactKeys(payload, required, optional)) return false;
  if (payload.text !== undefined && !safeText(payload.text)) return false;
  if (payload.summary !== undefined && !safeText(payload.summary)) return false;
  if (payload.domain !== undefined && !safeLine(payload.domain, 128)) return false;
  if (payload.status !== undefined && !['PASS', 'WARN', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE'].includes(payload.status)) return false;
  return payload.references === undefined || arrayOf(payload.references, (entry) => safeLine(entry, 256), 20);
}

function validateExtensionsV1(extensions, state) {
  if (extensions === undefined) return ok('PROGRAMME_EXTENSIONS_VALID', { extensions: [] });
  if (!Array.isArray(extensions) || extensions.length > 50) return fail('extensions-invalid');
  const children = new Set(state.children.map((child) => child.issue));
  const prs = new Set(state.prs.map((pr) => pr.number));
  const seen = new Set();
  for (const extension of extensions) {
    if (!exactKeys(extension, ['schema', 'namespace', 'target', 'class', 'title', 'payload'])
      || extension.schema !== EXTENSIONS_SCHEMA || !safeId(extension.namespace)
      || !EXTENSION_CLASSES.includes(extension.class) || !safeLine(extension.title, 160)
      || forbiddenExtensionKey(extension.title)
      || !exactKeys(extension.target, ['kind', 'number']) || !['parent', 'child', 'pr'].includes(extension.target.kind)
      || !issue(extension.target.number) || forbiddenExtensionKey(extension.namespace)
      || ['programme', 'portable', 'canonical', 'github_program'].includes(extension.namespace.split('.')[0])
      || !extensionPayloadValid(extension)) return fail('extensions-invalid');
    if (extension.target.kind === 'parent' && extension.target.number !== state.parent.issue) return fail('extension-target-outside-scope');
    if (extension.target.kind === 'child' && !children.has(extension.target.number)) return fail('extension-target-outside-scope');
    if (extension.target.kind === 'pr' && !prs.has(extension.target.number)) return fail('extension-target-outside-scope');
    const key = canonicalJson([extension.namespace, extension.target, extension.class, extension.title]);
    if (seen.has(key)) return fail('duplicate-extension');
    seen.add(key);
  }
  if (bytes(extensions) > 24 * 1024) return fail('extension-byte-budget-exceeded');
  return ok('PROGRAMME_EXTENSIONS_VALID', { extensions: clone(extensions) });
}

function validateEvidenceRefs(refs) {
  return arrayOf(refs, (entry) => isRecord(entry)
    && safeId(entry.id) && ['WEB', 'COMMIT', 'PR', 'CHECK', 'REVIEW', 'ISSUE', 'MIGRATION'].includes(entry.kind)
    && safeLine(entry.reference, 256) && safeLine(entry.summary, 512), 200)
    && new Set(refs.map((entry) => entry.id)).size === refs.length;
}

function validateCanonicalStateV4(state) {
  if (!exactKeys(state, ['schema', 'design_lock', 'repository', 'parent', 'children', 'prs', 'cursor', 'candidate', 'predecessor_contract_digest', 'evidence_refs', 'historical_transitions', 'extensions'])
    || state.schema !== STATE_SCHEMA || state.design_lock !== DESIGN_LOCK
    || !safeLine(state.repository, 200) || !exactKeys(state.parent, ['issue', 'title', 'goal']) || !issue(state.parent.issue)
    || !safeLine(state.parent.title, 256) || !safeText(state.parent.goal)
    || !Array.isArray(state.children) || state.children.length === 0 || state.children.length > 50
    || !Array.isArray(state.prs) || state.prs.length > 100
    || !validateEvidenceRefs(state.evidence_refs) || !sha256(state.predecessor_contract_digest)
    || !Array.isArray(state.historical_transitions) || state.historical_transitions.length > 200) return fail('canonical-state-shape');
  if (bytes(state) > CANONICAL_STATE_BUDGET_BYTES) return fail('canonical-state-byte-budget-exceeded', { limit: CANONICAL_STATE_BUDGET_BYTES, actual: bytes(state) });
  const evidenceIds = new Set(state.evidence_refs.map((entry) => entry.id));
  const evidenceById = new Map(state.evidence_refs.map((entry) => [entry.id, entry]));
  const childIssues = new Set();
  const prNumbers = new Set();
  const activeRegistryPrs = new Set();
  const current = [];
  for (const child of state.children) {
    if (!exactKeys(child, ['issue', 'order', 'title', 'objective', 'lifecycle', 'dependencies', 'scope', 'out_of_scope', 'boundaries', 'eli5', 'epochs', 'holds', 'pr_registry', 'finality'])
      || !issue(child.issue) || childIssues.has(child.issue) || !Number.isSafeInteger(child.order) || child.order < 1
      || !safeLine(child.title, 256) || !safeText(child.objective) || !LIFECYCLES.includes(child.lifecycle)
      || !arrayOf(child.dependencies, issue, 50) || new Set(child.dependencies).size !== child.dependencies.length
      || !arrayOf(child.scope, (entry) => safeText(entry), 50) || !arrayOf(child.out_of_scope, (entry) => safeText(entry), 50)
      || !arrayOf(child.boundaries, (entry) => safeText(entry), 50) || !safeText(child.eli5)
      || !Array.isArray(child.epochs) || child.epochs.length === 0 || child.epochs.length > 30
      || !Array.isArray(child.holds) || child.holds.length > 30 || !Array.isArray(child.pr_registry) || child.pr_registry.length > 50
      || !exactKeys(child.finality, ['state', 'authority_ref']) || !['HELD', 'READY_AUTHORIZED', 'MERGED', 'RETIRED'].includes(child.finality.state)
      || child.finality.authority_ref !== null && !evidenceIds.has(child.finality.authority_ref)) return fail('canonical-child-shape', { child: child?.issue });
    if (child.finality.authority_ref !== null && evidenceById.get(child.finality.authority_ref)?.kind !== 'WEB') return fail('finality-web-authority-required', { child: child.issue });
    const epochIds = new Set();
    for (const epoch of child.epochs) {
      if (!exactKeys(epoch, ['id', 'name', 'lock', 'purpose', 'gates', 'terminal_disposition', 'evidence_ref'])
        || !safeId(epoch.id) || epochIds.has(epoch.id) || !safeLine(epoch.name, 160)
        || !safeId(epoch.lock) || !safeText(epoch.purpose) || !arrayOf(epoch.gates, (gate) => safeId(gate), 30)
        || epoch.gates.length === 0 || new Set(epoch.gates).size !== epoch.gates.length
        || ![null, 'ACCEPTED', 'RETIRED'].includes(epoch.terminal_disposition)
        || epoch.evidence_ref !== null && !evidenceIds.has(epoch.evidence_ref)) return fail('canonical-epoch-shape', { child: child.issue });
      if (epoch.terminal_disposition !== null && epoch.evidence_ref === null) return fail('terminal-epoch-evidence-required', { child: child.issue, epoch: epoch.id });
      if (epoch.terminal_disposition !== null && evidenceById.get(epoch.evidence_ref)?.kind !== 'WEB') return fail('terminal-epoch-web-disposition-required', { child: child.issue, epoch: epoch.id });
      epochIds.add(epoch.id);
    }
    const holdIds = new Set();
    for (const hold of child.holds) {
      if (!exactKeys(hold, ['id', 'kind', 'summary', 'evidence_ref', 'active'])
        || !safeId(hold.id) || holdIds.has(hold.id) || !['BLOCKING', 'INFORMATIONAL'].includes(hold.kind)
        || !safeText(hold.summary) || !evidenceIds.has(hold.evidence_ref) || typeof hold.active !== 'boolean') return fail('canonical-hold-shape', { child: child.issue });
      holdIds.add(hold.id);
    }
    for (const entry of child.pr_registry) {
      if (!exactKeys(entry, ['pr', 'status', 'role', 'completes_child', 'epoch_id', 'accepted_evidence_ref', 'retirement_evidence_ref'])
        || !issue(entry.pr) || !REGISTRY_STATUSES.includes(entry.status)
        || !['INTERMEDIATE', 'TERMINAL'].includes(entry.role) || typeof entry.completes_child !== 'boolean'
        || !epochIds.has(entry.epoch_id) || entry.role === 'INTERMEDIATE' && entry.completes_child
        || entry.accepted_evidence_ref !== null && !evidenceIds.has(entry.accepted_evidence_ref)
        || entry.retirement_evidence_ref !== null && !evidenceIds.has(entry.retirement_evidence_ref)) return fail('canonical-registry-shape', { child: child.issue });
      if (entry.status === 'ACTIVE') activeRegistryPrs.add(entry.pr);
      if (entry.status === 'ACCEPTED' && entry.accepted_evidence_ref === null) return fail('accepted-pr-evidence-required', { pr: entry.pr });
      if (entry.status === 'RETIRED' && entry.retirement_evidence_ref === null) return fail('retired-pr-evidence-required', { pr: entry.pr });
    }
    if (new Set(child.pr_registry.map((entry) => entry.pr)).size !== child.pr_registry.length) return fail('duplicate-child-registry-pr', { child: child.issue });
    if (child.lifecycle === 'CURRENT') current.push(child);
    childIssues.add(child.issue);
  }
  if (new Set(state.children.map((child) => child.order)).size !== state.children.length) return fail('duplicate-child-order');
  for (const child of state.children) {
    if (child.dependencies.some((dependency) => !childIssues.has(dependency) || dependency === child.issue)) return fail('dependency-outside-scope', { child: child.issue });
  }
  for (const pr of state.prs) {
    if (!exactKeys(pr, ['number', 'child_issue', 'purpose', 'scope', 'out_of_scope', 'design_constraints', 'changed_surfaces', 'eli5'])
      || !issue(pr.number) || prNumbers.has(pr.number) || !childIssues.has(pr.child_issue)
      || !safeText(pr.purpose) || !arrayOf(pr.scope, (entry) => safeText(entry), 50)
      || !arrayOf(pr.out_of_scope, (entry) => safeText(entry), 50) || !arrayOf(pr.design_constraints, (entry) => safeText(entry), 50)
      || !arrayOf(pr.changed_surfaces, (entry) => safeLine(entry, 256), 100) || !safeText(pr.eli5)) return fail('canonical-pr-shape', { pr: pr?.number });
    prNumbers.add(pr.number);
  }
  const registry = state.children.flatMap((child) => child.pr_registry.map((entry) => ({ ...entry, child_issue: child.issue })));
  if (new Set(registry.map((entry) => entry.pr)).size !== registry.length || registry.length !== state.prs.length
    || state.prs.some((pr) => !registry.some((entry) => entry.pr === pr.number && entry.child_issue === pr.child_issue))) return fail('canonical-pr-registry-drift');
  if (activeRegistryPrs.size > 1) return fail('multiple-active-candidates');
  if (state.candidate === null) {
    if (activeRegistryPrs.size !== 0) return fail('active-candidate-missing');
  } else if (!exactKeys(state.candidate, ['pr', 'branch', 'base_ref', 'base_sha', 'head', 'tree', 'version', 'epoch_id'])
    || !issue(state.candidate.pr) || !safeLine(state.candidate.branch, 256)
    || !safeLine(state.candidate.base_ref, 256) || !sha(state.candidate.base_sha) || !sha(state.candidate.head)
    || !sha(state.candidate.tree) || !safeLine(state.candidate.version, 80) || !safeId(state.candidate.epoch_id)
    || !activeRegistryPrs.has(state.candidate.pr)) return fail('canonical-candidate-shape');
  else {
    const candidateBinding = registry.find((entry) => entry.pr === state.candidate.pr && entry.status === 'ACTIVE');
    if (!candidateBinding || candidateBinding.epoch_id !== state.candidate.epoch_id) return fail('canonical-candidate-shape');
  }
  if (current.length > 1) return fail('multiple-current-children');
  if (state.cursor === null) {
    if (current.length !== 0 && !current.every((child) => child.epochs.every((epoch) => epoch.terminal_disposition !== null))) return fail('current-cursor-required');
  } else {
    if (!exactKeys(state.cursor, ['child_issue', 'epoch_id', 'gate', 'status', 'result'])
      || current.length !== 1 || state.cursor.child_issue !== current[0].issue || !safeId(state.cursor.epoch_id)
      || !safeId(state.cursor.gate) || !['ACTIVE', 'RESULT_RECORDED'].includes(state.cursor.status)
      || state.cursor.result !== null && !['AMEND', 'PASS'].includes(state.cursor.result)) return fail('canonical-cursor-shape');
    const epoch = current[0].epochs.find((entry) => entry.id === state.cursor.epoch_id);
    if (!epoch || epoch.terminal_disposition !== null || !epoch.gates.includes(state.cursor.gate)
      || state.cursor.status === 'ACTIVE' && state.cursor.result !== null
      || state.cursor.status === 'RESULT_RECORDED' && state.cursor.result === null) return fail('canonical-cursor-binding');
  }
  for (const evidence of state.evidence_refs) {
    if (!exactKeys(evidence, ['id', 'kind', 'reference', 'summary'])) return fail('canonical-evidence-shape');
  }
  for (const transition of state.historical_transitions) {
    if (!exactKeys(transition, ['id', 'child_issue', 'epoch_id', 'gate', 'disposition', 'evidence_ref'])
      || !safeId(transition.id) || !childIssues.has(transition.child_issue) || !safeId(transition.epoch_id)
      || !safeId(transition.gate) || !['ACCEPTED', 'AMEND', 'PASS', 'RETIRED'].includes(transition.disposition)
      || !evidenceIds.has(transition.evidence_ref)) return fail('historical-transition-invalid');
    if (evidenceById.get(transition.evidence_ref)?.kind !== 'WEB') return fail('historical-transition-web-disposition-required');
  }
  if (new Set(state.historical_transitions.map((entry) => entry.id)).size !== state.historical_transitions.length) return fail('duplicate-historical-transition');
  const extensions = validateExtensionsV1(state.extensions, state);
  if (!extensions.ok) return extensions;
  return ok('PROGRAMME_STATE_VALID', { canonical_digest: digest(state), canonical_bytes: bytes(state) });
}

function blockingHolds(child) { return child.holds.filter((hold) => hold.kind === 'BLOCKING' && hold.active); }
function effectiveLifecycle(child) { return child.lifecycle === 'CURRENT' && blockingHolds(child).length ? 'BLOCKED' : child.lifecycle; }
function childProgress(state, child) {
  const values = child.epochs.map((epoch) => `${epoch.id}: ${epoch.terminal_disposition || (state.cursor?.child_issue === child.issue && state.cursor.epoch_id === epoch.id ? `${state.cursor.gate} ${state.cursor.status}` : 'PENDING')}`);
  if (blockingHolds(child).length) values.push(`Blocking holds: ${blockingHolds(child).length}`);
  return values;
}
function childAchieved(state, child) {
  return [
    ...child.epochs.filter((epoch) => epoch.terminal_disposition !== null).map((epoch) => `${epoch.id} ${epoch.terminal_disposition}`),
    ...state.historical_transitions.filter((entry) => entry.child_issue === child.issue).map((entry) => `${entry.epoch_id} ${entry.gate} ${entry.disposition}`),
  ];
}
function childRemaining(state, child) {
  if (['COMPLETED', 'RETIRED'].includes(child.lifecycle)) return [];
  const values = [];
  for (const epoch of child.epochs.filter((entry) => entry.terminal_disposition === null)) {
    const cursorIndex = state.cursor?.child_issue === child.issue && state.cursor.epoch_id === epoch.id ? epoch.gates.indexOf(state.cursor.gate) : -1;
    const gates = cursorIndex >= 0 ? epoch.gates.slice(cursorIndex) : epoch.gates;
    values.push(...gates.map((gate) => `${epoch.id} ${gate}`));
  }
  values.push(child.finality.state === 'READY_AUTHORIZED' ? 'Separately authorised finality action' : 'Web finality disposition');
  return values;
}
function registryFor(state, prNumber) {
  for (const child of state.children) {
    const registry = child.pr_registry.find((entry) => entry.pr === prNumber);
    if (registry) return { child, registry, epoch: child.epochs.find((entry) => entry.id === registry.epoch_id) };
  }
  return null;
}
function currentOutcome(state, child) {
  const lifecycle = effectiveLifecycle(child);
  if (lifecycle === 'BLOCKED') return `${child.title} is blocked by ${blockingHolds(child).length} authoritative hold(s).`;
  if (child.lifecycle === 'QUEUED') return `${child.title} is queued behind its declared dependencies.`;
  if (child.lifecycle === 'COMPLETED') return `${child.title} is completed with retained evidence.`;
  if (child.lifecycle === 'RETIRED') return `${child.title} is retired with retained evidence.`;
  if (state.cursor?.child_issue === child.issue) return `${child.title} is current in ${state.cursor.epoch_id} at ${state.cursor.gate}${state.cursor.status === 'RESULT_RECORDED' ? ` with ${state.cursor.result} recorded` : ''}.`;
  return `${child.title} has completed its declared epochs and awaits authorised finality.`;
}
function nextAction(state, child) {
  if (blockingHolds(child).length) return `Resolve authoritative hold ${blockingHolds(child)[0].id}.`;
  if (child.lifecycle === 'QUEUED') return 'Wait until dependencies are completed or retired.';
  if (child.lifecycle === 'COMPLETED' || child.lifecycle === 'RETIRED') return 'No delivery action remains.';
  if (state.cursor?.child_issue === child.issue) return state.cursor.status === 'RESULT_RECORDED'
    ? `Obtain Web disposition for ${state.cursor.epoch_id} ${state.cursor.gate}.`
    : `Complete ${state.cursor.epoch_id} ${state.cursor.gate} without advancing finality.`;
  return child.finality.state === 'READY_AUTHORIZED' ? 'Await the separately authorised finality action.' : 'Obtain explicit Web finality authority.';
}

function deriveProjectionV1(state) {
  const validated = validateCanonicalStateV4(state);
  if (!validated.ok) return validated;
  const children = state.children.slice().sort((a, b) => a.order - b.order).map((child) => ({
    issue: child.issue,
    parent_issue: state.parent.issue,
    title: child.title,
    lifecycle: effectiveLifecycle(child),
    outcome: currentOutcome(state, child),
    objective: child.objective,
    scope: clone(child.scope),
    out_of_scope: clone(child.out_of_scope),
    boundaries: clone(child.boundaries),
    dependencies: clone(child.dependencies),
    current_epoch: state.cursor?.child_issue === child.issue ? state.cursor.epoch_id : null,
    current_gate: state.cursor?.child_issue === child.issue ? state.cursor.gate : null,
    gate_status: state.cursor?.child_issue === child.issue ? state.cursor.status : null,
    progress: childProgress(state, child),
    achieved: childAchieved(state, child),
    remaining: childRemaining(state, child),
    epochs: child.epochs.map((epoch) => ({ id: epoch.id, name: epoch.name, lock: epoch.lock, purpose: epoch.purpose, state: epoch.terminal_disposition || (state.cursor?.child_issue === child.issue && state.cursor.epoch_id === epoch.id ? state.cursor.status : 'PENDING') })),
    holds: clone(child.holds),
    pr_registry: clone(child.pr_registry),
    finality: clone(child.finality),
    next_action: nextAction(state, child),
    eli5: child.eli5,
  }));
  const prs = state.prs.map((pr) => {
    const binding = registryFor(state, pr.number);
    const candidate = state.candidate?.pr === pr.number ? state.candidate : null;
    return {
      number: pr.number,
      parent_issue: state.parent.issue,
      child_issue: pr.child_issue,
      purpose: pr.purpose,
      scope: clone(pr.scope),
      out_of_scope: clone(pr.out_of_scope),
      design_constraints: clone(pr.design_constraints),
      changed_surfaces: clone(pr.changed_surfaces),
      eli5: pr.eli5,
      registry_status: binding.registry.status,
      role: binding.registry.role,
      completes_child: binding.registry.completes_child,
      epoch: binding.epoch.id,
      lock: binding.epoch.lock,
      candidate: candidate ? clone(candidate) : null,
      progress: childProgress(state, binding.child),
      achieved: childAchieved(state, binding.child),
      remaining: childRemaining(state, binding.child),
      outcome: binding.registry.status === 'ACTIVE'
        ? `${binding.registry.role === 'INTERMEDIATE' ? 'Intermediate' : 'Terminal'} candidate #${pr.number} is active for ${binding.epoch.id}; ${currentOutcome(state, binding.child)}`
        : `PR #${pr.number} is ${binding.registry.status.toLowerCase()} with retained evidence.`,
      finality: binding.child.finality.state,
      next_action: nextAction(state, binding.child),
    };
  });
  const current = children.find((child) => ['CURRENT', 'BLOCKED'].includes(child.lifecycle)) || null;
  const parent = {
    issue: state.parent.issue,
    title: state.parent.title,
    goal: state.parent.goal,
    status: current ? `${current.lifecycle}${current.current_gate ? ` / ${current.current_epoch} ${current.current_gate}` : ''}` : 'NO CURRENT CHILD',
    outcome: current ? current.outcome : 'No child is currently executing.',
    current_child: current?.issue || null,
    child_graph: children.map((child) => ({ issue: child.issue, title: child.title, lifecycle: child.lifecycle, outcome: child.outcome })),
    progress: children.map((child) => `#${child.issue}: ${child.outcome}`),
    major_holds: children.flatMap((child) => blockingHolds(state.children.find((entry) => entry.issue === child.issue)).map((hold) => `#${child.issue} ${hold.id}: ${hold.summary}`)),
    next_action: current ? current.next_action : 'Await an authorised lifecycle transition.',
  };
  const extensionDigest = digest(state.extensions || []);
  return ok('PROGRAMME_PROJECTION_DERIVED', {
    projection: { schema: PROJECTION_SCHEMA, repository: state.repository, canonical_digest: validated.canonical_digest, extension_digest: extensionDigest, parent, children, prs, extensions: clone(state.extensions || []) },
  });
}

function renderExtensions(extensions, target) {
  const selected = extensions.filter((entry) => same(entry.target, target));
  if (!selected.length) return '- None';
  return selected.map((entry) => {
    if (entry.class === 'TABLE') return `### ${entry.title}\n${table(entry.payload.columns, entry.payload.rows)}`;
    const value = entry.payload.text || entry.payload.summary || `${entry.payload.domain}: ${entry.payload.status} - ${entry.payload.summary}`;
    return `### ${entry.title}\n${value}${entry.payload.references?.length ? `\n${list(entry.payload.references)}` : ''}`;
  }).join('\n\n');
}
function projectionEnvelope(state, projection, kind, number, data) {
  return {
    schema: PROJECTION_SCHEMA,
    repository: state.repository,
    parent_issue: state.parent.issue,
    kind,
    number,
    canonical_digest: projection.canonical_digest,
    projection_digest: digest(data),
    extension_digest: projection.extension_digest,
  };
}
function wrap(kind, lines, envelope, state = null) {
  const hidden = state ? STATE_LINE_PREFIX + encode({ state, envelope }) + LINE_SUFFIX : PROJECTION_LINE_PREFIX + encode(envelope) + LINE_SUFFIX;
  return [MARKERS[kind].begin, ...lines, '', hidden, MARKERS[kind].end].join('\n');
}
function renderProgrammeV4(state) {
  const derived = deriveProjectionV1(state);
  if (!derived.ok) return derived;
  const projection = derived.projection;
  const parentEnvelope = projectionEnvelope(state, projection, 'parent', state.parent.issue, projection.parent);
  const bodies = { parent: wrap('parent', [
    '# Programme dashboard', '', '## Goal', projection.parent.goal, '', '## Current status',
    table(['Item', 'State'], [['Programme', projection.parent.status], ['Current Child', projection.parent.current_child ? `#${projection.parent.current_child}` : 'None'], ['Outcome', projection.parent.outcome]]),
    '', '## Children', table(['Child', 'Lifecycle', 'Outcome'], projection.parent.child_graph.map((entry) => [`#${entry.issue} - ${entry.title}`, entry.lifecycle, entry.outcome])),
    '', '## Progress', list(projection.parent.progress),
    '', '## Major holds', list(projection.parent.major_holds), '', '## Next action', projection.parent.next_action,
    '', '## Extensions', renderExtensions(projection.extensions, { kind: 'parent', number: state.parent.issue }),
  ], parentEnvelope, state), children: {}, prs: {} };
  for (const child of projection.children) {
    const envelope = projectionEnvelope(state, projection, 'child', child.issue, child);
    bodies.children[String(child.issue)] = wrap('child', [
      `# ${child.title}`, '', child.outcome, '', '## Operating contract',
      table(['Field', 'Value'], [['Parent', `#${child.parent_issue}`], ['Lifecycle', child.lifecycle], ['Current epoch', child.current_epoch || 'None'], ['Current gate', child.current_gate || 'None'], ['Finality', child.finality.state]]),
      '', '## Objective', child.objective, '', '## Scope', list(child.scope), '', '## Out of scope', list(child.out_of_scope),
      '', '## Progress', list(child.progress), '', '## Achieved', list(child.achieved), '', '## Remaining', list(child.remaining),
      '', '## Epochs and locks', table(['Epoch', 'Lock', 'State', 'Purpose'], child.epochs.map((epoch) => [epoch.id, epoch.lock, epoch.state, epoch.purpose])),
      '', '## PR registry', table(['PR', 'Status', 'Role', 'Completes Child'], child.pr_registry.map((entry) => [`#${entry.pr}`, entry.status, entry.role, entry.completes_child ? 'Yes' : 'No'])),
      '', '## Holds', list(child.holds.filter((hold) => hold.active).map((hold) => `${hold.kind} ${hold.id}: ${hold.summary}`)),
      '', '## Boundaries', list(child.boundaries), '', '## Next action', child.next_action, '', '## ELI5', child.eli5,
      '', '## Extensions', renderExtensions(projection.extensions, { kind: 'child', number: child.issue }),
    ], envelope);
  }
  for (const pr of projection.prs) {
    const envelope = projectionEnvelope(state, projection, 'pr', pr.number, pr);
    bodies.prs[String(pr.number)] = wrap('pr', [
      `# Programme lane for PR #${pr.number}`, '', pr.outcome, '', '## Binding',
      table(['Field', 'Value'], [['Parent', `#${pr.parent_issue}`], ['Child', `#${pr.child_issue}`], ['Registry', pr.registry_status], ['Role', pr.role], ['Completes Child', pr.completes_child ? 'Yes' : 'No'], ['Epoch / Lock', `${pr.epoch} / ${pr.lock}`], ['Finality', pr.finality]]),
      '', '## Exact candidate', pr.candidate ? table(['Branch', 'Base ref', 'Base SHA', 'Head', 'Tree', 'Version'], [[pr.candidate.branch, pr.candidate.base_ref, pr.candidate.base_sha, pr.candidate.head, pr.candidate.tree, pr.candidate.version]]) : '- Not active',
      '', '## Purpose', pr.purpose, '', '## Scope', list(pr.scope), '', '## Out of scope', list(pr.out_of_scope),
      '', '## Progress', list(pr.progress), '', '## Achieved', list(pr.achieved), '', '## Remaining', list(pr.remaining),
      '', '## Design constraints', list(pr.design_constraints), '', '## Changed surfaces', list(pr.changed_surfaces),
      '', '## Next action', pr.next_action, '', '## ELI5', pr.eli5,
      '', '## Extensions', renderExtensions(projection.extensions, { kind: 'pr', number: pr.number }),
    ], envelope);
  }
  let total = 0;
  for (const [kind, group] of [['parent', { [state.parent.issue]: bodies.parent }], ['child', bodies.children], ['pr', bodies.prs]]) {
    for (const [number, body] of Object.entries(group)) {
      const actual = bytes(body);
      total += actual;
      if (actual > BODY_BUDGET_BYTES) return fail('projection-body-byte-budget-exceeded', { kind, number: Number(number), limit: BODY_BUDGET_BYTES, actual });
    }
  }
  if (total > TOTAL_PROJECTION_BUDGET_BYTES) return fail('projection-total-byte-budget-exceeded', { limit: TOTAL_PROJECTION_BUDGET_BYTES, actual: total });
  return ok('PROGRAMME_RENDERED', { projection, bodies, body_digests: { parent: digest(bodies.parent), children: Object.fromEntries(Object.entries(bodies.children).map(([key, value]) => [key, digest(value)])), prs: Object.fromEntries(Object.entries(bodies.prs).map(([key, value]) => [key, digest(value)])) }, total_projection_bytes: total });
}

function extractManaged(body, kind) {
  if (typeof body !== 'string' || bytes(body) > BODY_BUDGET_BYTES || !MARKERS[kind]) return fail('managed-body-invalid');
  const begin = MARKERS[kind].begin;
  const end = MARKERS[kind].end;
  if (body.split(begin).length !== 2 || body.split(end).length !== 2) return fail('managed-marker-count-invalid');
  const start = body.indexOf(begin);
  const finish = body.indexOf(end, start + begin.length);
  if (finish < start) return fail('managed-marker-order-invalid');
  const prefix = body.slice(0, start);
  const suffix = body.slice(finish + end.length);
  const fresh = validateOutsideFreshness(prefix + suffix);
  if (!fresh.ok) return fresh;
  return ok('MANAGED_BODY_EXTRACTED', { prefix, managed: body.slice(start, finish + end.length), suffix });
}
function validateOutsideFreshness(text) {
  let historical = false;
  for (const line of String(text).split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      historical = /\b(?:history|historical|chronology|archive|archived|prior|previous)\b/i.test(heading[1]);
      if (!historical && /\b(?:current status|current gate|current candidate|next action|programme status|finality|remaining work)\b/i.test(heading[1])) return fail('competing-unmanaged-projection');
      continue;
    }
    if (historical || !line.trim()) continue;
    if (/^(?:\s*(?:[-+*>]|\d+\.)\s*)?(?:\*\*|`)?(?:current status|current gate|current candidate|next action|programme status|finality|remaining work)(?:\*\*|`)?\s*[:|]/i.test(line)
      || /^\s*\|[^\r\n|]*(?:status|gate|candidate|finality)[^\r\n|]*\|[^\r\n|]*(?:CURRENT|BLOCKED|QUEUED|READY|MERGED)[^\r\n|]*\|/i.test(line)) return fail('competing-unmanaged-projection');
  }
  return ok('OUTSIDE_BODY_FRESH');
}
function parseProgrammeV4Body(body, expected = {}) {
  const extracted = extractManaged(body, expected.kind);
  if (!extracted.ok) return extracted;
  const prefix = expected.kind === 'parent' ? STATE_LINE_PREFIX : PROJECTION_LINE_PREFIX;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...extracted.managed.matchAll(new RegExp(escaped + '([A-Za-z0-9_-]+)' + LINE_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
  if (matches.length !== 1) return fail('projection-envelope-count-invalid');
  const decoded = decode(matches[0][1]);
  const envelope = expected.kind === 'parent' ? decoded?.envelope : decoded;
  const state = expected.kind === 'parent' ? decoded?.state : null;
  if (!isRecord(envelope) || envelope.schema !== PROJECTION_SCHEMA || envelope.kind !== expected.kind
    || expected.repository !== undefined && envelope.repository !== expected.repository
    || expected.parent_issue !== undefined && envelope.parent_issue !== expected.parent_issue
    || expected.number !== undefined && envelope.number !== expected.number
    || !sha256(envelope.canonical_digest) || !sha256(envelope.projection_digest) || !sha256(envelope.extension_digest)) return fail('projection-envelope-invalid');
  if (state) {
    const valid = validateCanonicalStateV4(state);
    if (!valid.ok || valid.canonical_digest !== envelope.canonical_digest) return fail('canonical-envelope-binding-invalid');
  }
  return ok('PROGRAMME_BODY_PARSED', { envelope, state, prefix: extracted.prefix, suffix: extracted.suffix, body_digest: digest(body) });
}

function normalizeScope(raw) {
  if (!exactKeys(raw, ['schema', 'repository', 'parent_issue', 'children', 'dependencies', 'associated_prs', 'api_version', 'complete', 'pagination', 'revision', 'source_digests', 'version_resolver'], ['scope_digest'])
    || raw.schema !== SCOPE_SCHEMA || raw.complete !== true || !safeLine(raw.repository, 200)
    || !issue(raw.parent_issue) || !arrayOf(raw.children, issue, 50) || new Set(raw.children).size !== raw.children.length
    || !isRecord(raw.dependencies) || !arrayOf(raw.associated_prs, issue, 100) || new Set(raw.associated_prs).size !== raw.associated_prs.length
    || !safeLine(raw.api_version, 80) || !safeLine(raw.revision, 256) || !exactKeys(raw.pagination, ['complete'])
    || raw.pagination.complete !== true || !arrayOf(raw.source_digests, sha256, 50)
    || !exactKeys(raw.version_resolver, ['identity', 'kind', 'agreement', 'sources']) || !safeId(raw.version_resolver.identity)
    || raw.version_resolver.kind !== 'json-pointer-agreement' || raw.version_resolver.agreement !== 'all'
    || !arrayOf(raw.version_resolver.sources, (entry) => exactKeys(entry, ['path', 'pointer']) && safeLine(entry.path, 512) && safeLine(entry.pointer, 256), 20)
    || raw.version_resolver.sources.length === 0) return fail('trusted-scope-invalid');
  const childSet = new Set(raw.children);
  if (Object.keys(raw.dependencies).some((key) => !childSet.has(Number(key)))
    || Object.values(raw.dependencies).some((listValue) => !arrayOf(listValue, (entry) => childSet.has(entry), 50))) return fail('trusted-scope-dependency-invalid');
  const payload = { ...clone(raw) };
  delete payload.scope_digest;
  const scopeDigest = digest(payload);
  if (raw.scope_digest !== undefined && raw.scope_digest !== scopeDigest) return fail('trusted-scope-digest-invalid');
  return ok('TRUSTED_SCOPE_VALID', { scope: deepFreeze({ ...payload, scope_digest: scopeDigest }) });
}
function desiredScope(state) {
  return {
    repository: state.repository,
    parent_issue: state.parent.issue,
    children: state.children.slice().sort((a, b) => a.order - b.order).map((child) => child.issue),
    dependencies: Object.fromEntries(state.children.map((child) => [String(child.issue), child.dependencies])),
    associated_prs: state.prs.map((pr) => pr.number).sort((a, b) => a - b),
  };
}
function assertScopeEquality(state, grant) {
  if (!scopeGrants.has(grant)) return fail('trusted-scope-grant-required');
  const payload = clone(grant);
  delete payload.scope_digest;
  if (digest(payload) !== grant.scope_digest) return fail('trusted-scope-digest-invalid');
  const expected = desiredScope(state);
  const actual = { repository: grant.repository, parent_issue: grant.parent_issue, children: grant.children, dependencies: grant.dependencies, associated_prs: grant.associated_prs.slice().sort((a, b) => a - b) };
  return same(expected, actual) ? ok('PROGRAMME_SCOPE_MATCHED') : fail('desired-programme-scope-mismatch', { expected_digest: digest(expected), actual_digest: digest(actual) });
}

function createProgrammeTrustBroker(adapters = {}) {
  function issueScope() {
    if (typeof adapters.inspect_scope !== 'function') return fail('trusted-scope-adapter-required');
    let raw;
    try { raw = adapters.inspect_scope({ operation: 'inspect-programme-scope' }); } catch (_error) { return fail('trusted-scope-inspection-failed'); }
    const normalized = normalizeScope(raw);
    if (!normalized.ok) return normalized;
    scopeGrants.add(normalized.scope);
    return ok('TRUSTED_SCOPE_GRANTED', { grant: normalized.scope });
  }
  function inspectRelationships(state, grant) {
    const matched = assertScopeEquality(state, grant);
    if (!matched.ok) return matched;
    if (typeof adapters.inspect_relationships !== 'function') return fail('trusted-relationship-adapter-required');
    let raw;
    try { raw = adapters.inspect_relationships({ repository: grant.repository, parent_issue: grant.parent_issue, children: clone(grant.children), dependencies: clone(grant.dependencies), scope_digest: grant.scope_digest, api_version: grant.api_version }); } catch (_error) { return fail('trusted-relationship-inspection-failed'); }
    if (!exactKeys(raw, ['schema', 'repository', 'parent_issue', 'children', 'dependencies', 'api_version', 'scope_digest', 'complete'])
      || raw.schema !== RELATIONSHIP_INSPECTION_SCHEMA || raw.complete !== true || raw.scope_digest !== grant.scope_digest
      || raw.repository !== grant.repository || raw.parent_issue !== grant.parent_issue || raw.api_version !== grant.api_version
      || !same(raw.children, grant.children) || !same(raw.dependencies, grant.dependencies)) return fail('trusted-relationship-inspection-invalid');
    const inspection = deepFreeze(clone(raw));
    relationshipInspections.add(inspection);
    return ok('TRUSTED_RELATIONSHIPS_INSPECTED', { inspection });
  }
  function inspectPrs(state, grant) {
    const matched = assertScopeEquality(state, grant);
    if (!matched.ok) return matched;
    if (typeof adapters.inspect_prs !== 'function') return fail('trusted-pr-adapter-required');
    let raw;
    try { raw = adapters.inspect_prs({ repository: grant.repository, prs: clone(grant.associated_prs), scope_digest: grant.scope_digest, version_resolver: clone(grant.version_resolver) }); } catch (_error) { return fail('trusted-pr-inspection-failed'); }
    if (!exactKeys(raw, ['schema', 'repository', 'scope_digest', 'resolver_identity', 'complete', 'facts'])
      || raw.schema !== PR_INSPECTION_SCHEMA || raw.complete !== true || raw.scope_digest !== grant.scope_digest
      || raw.repository !== grant.repository || raw.resolver_identity !== grant.version_resolver.identity
      || !arrayOf(raw.facts, (fact) => exactKeys(fact, ['number', 'parent_issue', 'child_issue', 'branch', 'base_ref', 'base_sha', 'head', 'tree', 'version', 'lifecycle', 'version_source_digests'])
        && issue(fact.number) && issue(fact.parent_issue) && issue(fact.child_issue)
        && safeLine(fact.branch, 256) && safeLine(fact.base_ref, 256) && sha(fact.base_sha) && sha(fact.head) && sha(fact.tree) && safeLine(fact.version, 80)
        && LIVE_PR_LIFECYCLES.includes(fact.lifecycle) && arrayOf(fact.version_source_digests, sha256, 20)
        && fact.version_source_digests.length === grant.version_resolver.sources.length, 100)
      || !same(raw.facts.map((fact) => fact.number).sort((a, b) => a - b), grant.associated_prs.slice().sort((a, b) => a - b))) return fail('trusted-pr-inspection-invalid');
    const inspection = deepFreeze(clone(raw));
    prInspections.add(inspection);
    return ok('TRUSTED_PRS_INSPECTED', { inspection });
  }
  return Object.freeze({ issueScope, inspectRelationships, inspectPrs });
}

function validatePrBindings(state, grant, inspection) {
  if (!scopeGrants.has(grant) || !prInspections.has(inspection) || inspection.scope_digest !== grant.scope_digest) return fail('trusted-pr-inspection-required');
  for (const fact of inspection.facts) {
    const binding = registryFor(state, fact.number);
    if (!binding || fact.parent_issue !== state.parent.issue || fact.child_issue !== binding.child.issue) return fail('trusted-pr-association-mismatch', { pr: fact.number });
    const entry = binding.registry;
    if (entry.status === 'ACTIVE') {
      const candidate = state.candidate;
      if (!candidate || candidate.pr !== fact.number || candidate.epoch_id !== entry.epoch_id
        || candidate.branch !== fact.branch || candidate.base_ref !== fact.base_ref || candidate.base_sha !== fact.base_sha
        || candidate.head !== fact.head || candidate.tree !== fact.tree || candidate.version !== fact.version) return fail('trusted-candidate-binding-mismatch', { pr: fact.number });
      if (fact.lifecycle === 'OPEN_DRAFT') {
        if (entry.role !== 'INTERMEDIATE' && !(entry.role === 'TERMINAL' && !entry.completes_child)) return fail('active-draft-role-invalid', { pr: fact.number });
      } else if (fact.lifecycle === 'OPEN_READY') {
        const allEpochsAccepted = binding.child.epochs.every((epoch) => epoch.terminal_disposition === 'ACCEPTED');
        if (entry.role !== 'TERMINAL' || !entry.completes_child || !allEpochsAccepted || blockingHolds(binding.child).length
          || binding.child.finality.state !== 'READY_AUTHORIZED' || binding.child.finality.authority_ref === null) return fail('ready-finality-authority-required', { pr: fact.number });
      } else return fail('active-pr-live-lifecycle-invalid', { pr: fact.number, lifecycle: fact.lifecycle });
    }
    if (entry.status === 'ACCEPTED' && (fact.lifecycle !== 'MERGED' || entry.accepted_evidence_ref === null)) return fail('accepted-pr-live-lifecycle-invalid', { pr: fact.number });
    if (entry.status === 'RETIRED' && (fact.lifecycle !== 'CLOSED_UNMERGED' || entry.retirement_evidence_ref === null)) return fail('retired-pr-live-lifecycle-invalid', { pr: fact.number });
  }
  return ok('TRUSTED_PR_BINDINGS_VALID');
}

function inspectTrustBindings(state, grant, broker) {
  if (!broker || typeof broker.inspectRelationships !== 'function' || typeof broker.inspectPrs !== 'function') return fail('programme-trust-broker-required');
  const scopeMatch = assertScopeEquality(state, grant);
  if (!scopeMatch.ok) return scopeMatch;
  const relationships = broker.inspectRelationships(state, grant);
  if (!relationships.ok) return relationships;
  const prs = broker.inspectPrs(state, grant);
  if (!prs.ok) return prs;
  const bound = validatePrBindings(state, grant, prs.inspection);
  if (!bound.ok) return bound;
  if (!relationshipInspections.has(relationships.inspection)) return fail('trusted-relationship-inspection-required');
  return ok('TRUSTED_PROGRAMME_FACTS_INSPECTED', {
    relationships: relationships.inspection,
    prs: prs.inspection,
    trusted_pr_inspection_digest: digest(prs.inspection),
    trusted_relationship_inspection_digest: digest(relationships.inspection),
  });
}

function expectedLabels(state, currentLabels = {}) {
  const managed = new Set(['completed', 'current', 'queued', 'blocked', 'retired']);
  return Object.fromEntries(state.children.map((child) => {
    const unrelated = (currentLabels[String(child.issue)] || []).filter((label) => !managed.has(label));
    const lifecycle = effectiveLifecycle(child);
    const managedLabel = lifecycle === 'RETIRED' ? 'completed' : lifecycle.toLowerCase();
    return [String(child.issue), [...new Set([...unrelated, managedLabel])].sort()];
  }));
}
function derivePrAssociationsV4(state) {
  const valid = validateCanonicalStateV4(state);
  if (!valid.ok) return valid;
  const associations = {};
  for (const pr of state.prs) {
    const binding = registryFor(state, pr.number);
    const terminal = binding.registry.role === 'TERMINAL' && binding.registry.completes_child;
    const lifecycleAllowsClosing = binding.registry.status === 'ACTIVE' && binding.child.finality.state === 'READY_AUTHORIZED'
      || binding.registry.status === 'ACCEPTED' && binding.child.finality.state === 'MERGED';
    const finalityAllowsClosing = lifecycleAllowsClosing && binding.child.finality.authority_ref !== null;
    associations[String(pr.number)] = {
      parent_issue: state.parent.issue,
      child_issue: binding.child.issue,
      kind: terminal && finalityAllowsClosing ? 'CLOSING' : 'CROSS_REFERENCE',
    };
  }
  return ok('PROGRAMME_PR_ASSOCIATIONS_DERIVED', { associations });
}

function candidateBinding(state) {
  if (!state.candidate) return null;
  const binding = registryFor(state, state.candidate.pr);
  if (!binding) return null;
  return {
    repository: state.repository,
    parent_issue: state.parent.issue,
    child_issue: binding.child.issue,
    pr: state.candidate.pr,
    branch: state.candidate.branch,
    base_ref: state.candidate.base_ref,
    base_sha: state.candidate.base_sha,
    head: state.candidate.head,
    tree: state.candidate.tree,
    version: state.candidate.version,
    epoch_id: state.candidate.epoch_id,
    lock: binding.epoch.lock,
    role: binding.registry.role,
    completes_child: binding.registry.completes_child,
    registry_status: binding.registry.status,
  };
}

function currentAuthorityRef(state) {
  const current = state.cursor;
  const web = state.evidence_refs.filter((entry) => entry.kind === 'WEB');
  const gate = current?.gate?.toLowerCase();
  const epoch = current?.epoch_id?.toLowerCase();
  const matched = web.find((entry) => gate && (entry.id.toLowerCase().includes(gate) || entry.summary.toLowerCase().includes(gate))
    && (!epoch || entry.id.toLowerCase().includes(epoch) || entry.summary.toLowerCase().includes(epoch)));
  return (matched || web[0])?.reference || null;
}

function normalizeLegacyManagedEvent(input) {
  const types = ['lifecycle_transition', 'lock_accepted', 'candidate_bound', 'validation', 'g4_or_finality', 'blocker', 'dependency', 'owner_decision', 'reconciliation_receipt'];
  const required = ['schema', 'event_type', 'repository', 'entity', 'exact_revision', 'resulting_state', 'authority_ref', 'event_id'];
  const optional = ['child_issue', 'pr_number', 'prior_event', 'epoch'];
  if (!exactKeys(input, required, optional) || input.schema !== 'toolkit.github-program.managed-event.v1' || !types.includes(input.event_type)
    || !safeLine(input.repository, 200) || !exactKeys(input.entity, ['kind', 'number'])
    || !['parent', 'child', 'pr'].includes(input.entity.kind) || !issue(input.entity.number)
    || !sha(input.exact_revision) || !safeLine(input.resulting_state, 512) || !safeLine(input.authority_ref, 256)
    || !sha256(input.event_id)
    || hasOwn(input, 'child_issue') && !issue(input.child_issue)
    || hasOwn(input, 'pr_number') && !issue(input.pr_number)
    || hasOwn(input, 'prior_event') && !safeLine(input.prior_event, 256)
    || hasOwn(input, 'epoch') && !safeLine(input.epoch, 128)) return fail('managed-event-inventory-invalid');
  const event = {
    schema: input.schema,
    event_type: input.event_type,
    repository: input.repository,
    entity: clone(input.entity),
    ...(issue(input.child_issue) ? { child_issue: input.child_issue } : {}),
    ...(issue(input.pr_number) ? { pr_number: input.pr_number } : {}),
    exact_revision: input.exact_revision,
    resulting_state: input.resulting_state,
    authority_ref: input.authority_ref,
    ...(safeLine(input.prior_event || '', 256) ? { prior_event: input.prior_event } : {}),
    ...(safeLine(input.epoch || '', 128) ? { epoch: input.epoch } : {}),
  };
  event.event_id = digest(event);
  return input.event_id === event.event_id ? ok('MANAGED_EVENT_VALID', { event }) : fail('managed-event-inventory-invalid');
}

function normalizeManagedEventV2(input) {
  const required = ['schema', 'event_type', 'repository', 'parent_issue', 'entity', 'source_state_schema', 'from_state_digest', 'to_canonical_digest', 'authority_ref', 'candidate_binding_digest', 'prior_event_id', 'migration_binding_digest', 'event_id'];
  if (!exactKeys(input, required) || input.schema !== MANAGED_EVENT_SCHEMA || !['canonical_initialisation', 'canonical_transition', 'migration'].includes(input.event_type)
    || !safeLine(input.repository, 200) || !issue(input.parent_issue) || !exactKeys(input.entity, ['kind', 'number'])
    || !['parent', 'child', 'pr'].includes(input.entity.kind) || !issue(input.entity.number)
    || ![null, STATE_SCHEMA, 'toolkit.github-program.legacy-state.v1'].includes(input.source_state_schema)
    || !sha256(input.from_state_digest) || !sha256(input.to_canonical_digest) || !safeLine(input.authority_ref, 256)
    || input.candidate_binding_digest !== null && !sha256(input.candidate_binding_digest)
    || input.prior_event_id !== null && !sha256(input.prior_event_id)
    || input.migration_binding_digest !== null && !sha256(input.migration_binding_digest)) return fail('managed-event-inventory-invalid');
  if ((input.event_type === 'migration') !== (input.migration_binding_digest !== null)
    || input.event_type === 'canonical_initialisation' !== (input.source_state_schema === null)
    || input.event_type === 'canonical_transition' !== (input.source_state_schema === STATE_SCHEMA)
    || input.event_type === 'migration' !== (input.source_state_schema === 'toolkit.github-program.legacy-state.v1')) return fail('managed-event-inventory-invalid');
  const event = clone(input);
  delete event.event_id;
  event.event_id = digest(event);
  return input.event_id === event.event_id ? ok('MANAGED_EVENT_VALID', { event }) : fail('managed-event-inventory-invalid');
}

function validateManagedEventInventoryV4(events, repository) {
  if (!Array.isArray(events) || events.length > 500) return fail('managed-event-inventory-invalid');
  const normalized = [];
  const ids = new Set();
  let canonicalEventsStarted = false;
  for (const supplied of events) {
    const result = supplied?.schema === MANAGED_EVENT_SCHEMA ? normalizeManagedEventV2(supplied) : normalizeLegacyManagedEvent(supplied);
    if (!result.ok || result.event.repository !== repository || ids.has(result.event.event_id)) return fail('managed-event-inventory-invalid');
    const priorEventId = normalized.at(-1)?.event_id || null;
    if (result.event.schema === MANAGED_EVENT_SCHEMA) {
      canonicalEventsStarted = true;
      if (result.event.prior_event_id !== priorEventId) return fail('managed-event-inventory-invalid');
    } else if (canonicalEventsStarted) return fail('managed-event-inventory-invalid');
    ids.add(result.event.event_id);
    normalized.push(result.event);
  }
  return ok('MANAGED_EVENT_INVENTORY_VALID', { events: normalized, ids, inventory_digest: digest(normalized) });
}

function eventPayload(input) {
  const payload = {
    schema: MANAGED_EVENT_SCHEMA,
    event_type: input.event_type,
    repository: input.state.repository,
    parent_issue: input.state.parent.issue,
    entity: clone(input.entity),
    source_state_schema: input.source_state_schema,
    from_state_digest: input.from_state_digest,
    to_canonical_digest: input.to_canonical_digest,
    authority_ref: input.authority_ref,
    candidate_binding_digest: input.candidate_binding_digest,
    prior_event_id: input.prior_event_id,
    migration_binding_digest: input.migration_binding_digest,
  };
  payload.event_id = digest(payload);
  return payload;
}

function expectedManagedEventsV4(state, currentInventory, canonicalDigest, migration = null, sourceCanonicalState = undefined) {
  const events = currentInventory.events.map(clone);
  const binding = candidateBinding(state);
  const candidateDigest = binding ? digest(binding) : null;
  const authorityRef = migration?.authority_ref || currentAuthorityRef(state);
  if (!authorityRef) return fail('managed-event-authority-missing');
  const retainedAuthorities = new Set(state.evidence_refs.map((entry) => entry.reference));
  if (events.some((event) => event.schema === MANAGED_EVENT_SCHEMA && event.to_canonical_digest === canonicalDigest
    && (event.parent_issue !== state.parent.issue || event.candidate_binding_digest !== candidateDigest || !retainedAuthorities.has(event.authority_ref)))) {
    return fail('managed-event-transition-binding-invalid');
  }
  const targetEvents = events.filter((event) => event.schema === MANAGED_EVENT_SCHEMA && event.to_canonical_digest === canonicalDigest);
  if (targetEvents.length > 1) return fail('managed-event-transition-binding-invalid');
  const alreadyRepresentsTarget = targetEvents[0] || null;
  let event;
  if (migration) {
    const migrationBinding = digest({
      source_snapshot_digest: migration.source_snapshot_digest,
      source_model_digest: migration.source_model_digest,
      target_canonical_digest: canonicalDigest,
      authority_ref: authorityRef,
      candidate_binding_digest: candidateDigest,
    });
    event = eventPayload({
      event_type: 'migration', state, entity: { kind: 'parent', number: state.parent.issue },
      source_state_schema: 'toolkit.github-program.legacy-state.v1', from_state_digest: migration.source_model_digest,
      to_canonical_digest: canonicalDigest, authority_ref: authorityRef, candidate_binding_digest: candidateDigest,
      prior_event_id: events.at(-1)?.event_id || null, migration_binding_digest: migrationBinding,
    });
  } else {
    if (sourceCanonicalState !== null && sourceCanonicalState !== undefined) {
      const sourceValidation = validateCanonicalStateV4(sourceCanonicalState);
      if (!sourceValidation.ok) return fail('source-canonical-state-invalid');
      if (sourceValidation.canonical_digest === canonicalDigest) {
        if (!alreadyRepresentsTarget) return fail('expected-managed-event-missing');
        return ok('EXPECTED_MANAGED_EVENTS_DERIVED', { events, new_events: [], inventory_digest: digest(events), candidate_binding_digest: candidateDigest });
      }
      event = eventPayload({
        event_type: 'canonical_transition', state, entity: { kind: 'parent', number: state.parent.issue },
        source_state_schema: STATE_SCHEMA, from_state_digest: sourceValidation.canonical_digest,
        to_canonical_digest: canonicalDigest, authority_ref: authorityRef, candidate_binding_digest: candidateDigest,
        prior_event_id: events.at(-1)?.event_id || null, migration_binding_digest: null,
      });
    } else {
      event = eventPayload({
        event_type: 'canonical_initialisation', state, entity: { kind: 'parent', number: state.parent.issue },
        source_state_schema: null, from_state_digest: digest(null), to_canonical_digest: canonicalDigest,
        authority_ref: authorityRef, candidate_binding_digest: candidateDigest,
        prior_event_id: events.at(-1)?.event_id || null, migration_binding_digest: null,
      });
    }
  }
  if (alreadyRepresentsTarget && alreadyRepresentsTarget.event_id !== event.event_id) return fail('managed-event-transition-binding-invalid');
  if (!currentInventory.ids.has(event.event_id)) events.push(event);
  return ok('EXPECTED_MANAGED_EVENTS_DERIVED', { events, new_events: currentInventory.ids.has(event.event_id) ? [] : [event], inventory_digest: digest(events), candidate_binding_digest: candidateDigest });
}

function snapshotDigest(snapshot) {
  return digest({ repository: snapshot.repository, revision: snapshot.revision, complete: snapshot.complete, canonical_state: snapshot.canonical_state, bodies: snapshot.bodies, labels: snapshot.labels, managed_events: snapshot.managed_events, native: snapshot.native });
}
function addOperation(operations, kind, target, before, after) {
  if (same(before, after)) return;
  const operation = { kind, target, before_digest: digest(before), after: clone(after), after_digest: digest(after) };
  operation.operation_id = digest(operation);
  operations.push(operation);
}
function materializeManagedBody(currentBody, kind, renderedBody) {
  if (currentBody === null || currentBody === undefined) return ok('MANAGED_BODY_INITIALISED', { body: renderedBody });
  const current = extractManaged(currentBody, kind);
  if (!current.ok) return fail('current-body-requires-explicit-migration', { detail: current.reason });
  return ok('MANAGED_BODY_MATERIALISED', { body: current.prefix + renderedBody + current.suffix });
}
function buildConvergencePreview(input = {}) {
  const valid = validateCanonicalStateV4(input.desired);
  if (!valid.ok) return valid;
  if (!isRecord(input.snapshot) || input.snapshot.complete !== true || input.snapshot.repository !== input.desired.repository
    || !safeLine(input.snapshot.revision, 256) || !isRecord(input.snapshot.bodies) || !isRecord(input.snapshot.labels)
    || !Array.isArray(input.snapshot.managed_events) || !isRecord(input.snapshot.native)) return fail('current-snapshot-incomplete');
  const currentEvents = validateManagedEventInventoryV4(input.snapshot.managed_events, input.snapshot.repository);
  if (!currentEvents.ok) return currentEvents;
  const trusted = inspectTrustBindings(input.desired, input.scope_grant, input.broker);
  if (!trusted.ok) return trusted;
  const rendered = renderProgrammeV4(input.desired);
  if (!rendered.ok) return rendered;
  const associations = derivePrAssociationsV4(input.desired);
  if (!associations.ok) return associations;
  const expectedChildKeys = Object.keys(rendered.bodies.children).sort();
  const expectedPrKeys = Object.keys(rendered.bodies.prs).sort();
  const currentChildKeys = Object.keys(input.snapshot.bodies?.children || {}).sort();
  const currentPrKeys = Object.keys(input.snapshot.bodies?.prs || {}).sort();
  if (currentChildKeys.some((key) => !expectedChildKeys.includes(key)) || currentPrKeys.some((key) => !expectedPrKeys.includes(key))) return fail('snapshot-body-scope-mismatch');
  const parentBody = materializeManagedBody(input.snapshot.bodies?.parent, 'parent', rendered.bodies.parent);
  if (!parentBody.ok) return parentBody;
  const childBodies = {};
  const prBodies = {};
  for (const [number, body] of Object.entries(rendered.bodies.children)) {
    const materialized = materializeManagedBody(input.snapshot.bodies?.children?.[number], 'child', body);
    if (!materialized.ok) return materialized;
    childBodies[number] = materialized.body;
  }
  for (const [number, body] of Object.entries(rendered.bodies.prs)) {
    const materialized = materializeManagedBody(input.snapshot.bodies?.prs?.[number], 'pr', body);
    if (!materialized.ok) return materialized;
    prBodies[number] = materialized.body;
  }
  const expectedEvents = expectedManagedEventsV4(input.desired, currentEvents, valid.canonical_digest, null, input.snapshot.canonical_state);
  if (!expectedEvents.ok) return expectedEvents;
  const expected = {
    repository: input.desired.repository,
    revision: input.snapshot.revision,
    complete: true,
    canonical_state: clone(input.desired),
    bodies: { parent: parentBody.body, children: childBodies, prs: prBodies },
    labels: expectedLabels(input.desired, input.snapshot.labels),
    managed_events: expectedEvents.events,
    native: { children: clone(input.scope_grant.children), dependencies: clone(input.scope_grant.dependencies), associated_prs: clone(input.scope_grant.associated_prs), pr_associations: associations.associations, api_version: input.scope_grant.api_version },
  };
  const operations = [];
  addOperation(operations, 'parent-body', input.desired.parent.issue, input.snapshot.bodies?.parent ?? null, expected.bodies.parent);
  for (const [number, body] of Object.entries(expected.bodies.children)) addOperation(operations, 'child-body', Number(number), input.snapshot.bodies?.children?.[number] ?? null, body);
  for (const [number, body] of Object.entries(expected.bodies.prs)) addOperation(operations, 'pr-body', Number(number), input.snapshot.bodies?.prs?.[number] ?? null, body);
  for (const event of expectedEvents.new_events) addOperation(operations, 'managed-event', event.entity.number, null, event);
  addOperation(operations, 'labels', input.desired.parent.issue, input.snapshot.labels ?? {}, expected.labels);
  addOperation(operations, 'relationships', input.desired.parent.issue, input.snapshot.native ?? {}, expected.native);
  const preview = {
    schema: 'toolkit.github-program.preview.v4', preview_kind: 'CONVERGENCE', repository: input.desired.repository, parent_issue: input.desired.parent.issue,
    current_revision: input.snapshot.revision, current_snapshot_digest: snapshotDigest(input.snapshot), canonical_digest: valid.canonical_digest,
    scope_digest: input.scope_grant.scope_digest, trusted_pr_inspection_digest: trusted.trusted_pr_inspection_digest,
    trusted_relationship_inspection_digest: trusted.trusted_relationship_inspection_digest,
    candidate_binding_digest: expectedEvents.candidate_binding_digest, expected_event_inventory_digest: expectedEvents.inventory_digest,
    operations, operations_digest: digest(operations), expected_snapshot: expected,
    mutation_authority: 'NOT_GRANTED', ready_authority: 'NOT_GRANTED', merge_authority: 'NOT_GRANTED', finality_authority: 'NOT_GRANTED',
  };
  preview.preview_id = digest({ ...preview, expected_snapshot: snapshotDigest(expected) });
  return ok(operations.length ? 'PROGRAMME_PREVIEW_READY' : 'PROGRAMME_ZERO_DELTA', { ...preview });
}

function verifyConvergenceReadback(readback, preview) {
  if (!isRecord(preview) || preview.ok !== true || !isRecord(readback) || readback.complete !== true
    || readback.repository !== preview.repository || !safeLine(readback.revision, 256)) return fail('readback-incomplete');
  const expected = preview.expected_snapshot;
  const canonicalDigest = preview.canonical_digest || preview.target_canonical_digest;
  for (const key of ['canonical_state', 'bodies', 'labels', 'managed_events', 'native']) {
    if (!same(readback[key], expected[key])) return fail('readback-drift', { field: key });
  }
  const events = validateManagedEventInventoryV4(readback.managed_events, readback.repository);
  if (!events.ok || events.inventory_digest !== preview.expected_event_inventory_digest) return fail('readback-event-inventory-drift');
  const rendered = renderProgrammeV4(readback.canonical_state);
  if (!rendered.ok || !same(expectedLabels(readback.canonical_state, readback.labels), readback.labels)) return fail('readback-projection-not-derived');
  for (const [kind, group] of [['parent', { [readback.canonical_state.parent.issue]: readback.bodies.parent }], ['child', readback.bodies.children], ['pr', readback.bodies.prs]]) {
    for (const [number, body] of Object.entries(group)) {
      const parsed = parseProgrammeV4Body(body, { kind, repository: readback.repository, parent_issue: readback.canonical_state.parent.issue, number: Number(number) });
      if (!parsed.ok || parsed.envelope.canonical_digest !== canonicalDigest) return fail('readback-envelope-drift', { kind, number: Number(number) });
      const extracted = extractManaged(body, kind);
      const expectedManaged = kind === 'parent' ? rendered.bodies.parent : kind === 'child' ? rendered.bodies.children[number] : rendered.bodies.prs[number];
      if (!extracted.ok || extracted.managed !== expectedManaged) return fail('readback-projection-not-derived', { kind, number: Number(number) });
    }
  }
  return ok('PROGRAMME_READBACK_VERIFIED', { zero_delta: true, mutation_count: 0, canonical_digest: canonicalDigest });
}

function replaceExactManagedBody(currentBody, kind, nextManaged) {
  const current = extractManaged(currentBody, kind);
  if (current.ok) return ok('MANAGED_BODY_REPLACED', { body: current.prefix + nextManaged + current.suffix });
  const legacy = {
    parent: ['<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:BEGIN v1 -->', '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:END -->'],
    child: ['<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:BEGIN v1 -->', '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:END -->'],
    pr: ['<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:BEGIN v1 -->', '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:END -->'],
  }[kind];
  if (typeof currentBody !== 'string' || currentBody.split(legacy[0]).length !== 2 || currentBody.split(legacy[1]).length !== 2) return fail('legacy-managed-body-not-exact');
  const start = currentBody.indexOf(legacy[0]);
  const finish = currentBody.indexOf(legacy[1], start + legacy[0].length);
  if (finish < start) return fail('legacy-managed-body-not-exact');
  return ok('MANAGED_BODY_REPLACED', { body: currentBody.slice(0, start) + nextManaged + currentBody.slice(finish + legacy[1].length) });
}

function parseLegacyV1Body(body, kind, expected) {
  const markers = {
    parent: ['<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:BEGIN v1 -->', '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PARENT:END -->'],
    child: ['<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:BEGIN v1 -->', '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-CHILD:END -->'],
    pr: ['<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:BEGIN v1 -->', '<!-- AI-AGENT-TOOLKIT:GITHUB-PROGRAM-PR:END -->'],
  }[kind];
  if (typeof body !== 'string' || bytes(body) > BODY_BUDGET_BYTES || !markers
    || body.split(markers[0]).length !== 2 || body.split(markers[1]).length !== 2) return fail('legacy-managed-body-not-exact');
  const start = body.indexOf(markers[0]);
  const finish = body.indexOf(markers[1], start + markers[0].length);
  if (finish < start) return fail('legacy-managed-body-not-exact');
  const outsideFresh = validateOutsideFreshness(body.slice(0, start) + body.slice(finish + markers[1].length));
  if (!outsideFresh.ok) return outsideFresh;
  const managed = body.slice(start, finish + markers[1].length);
  const escaped = LEGACY_STATE_LINE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffix = LINE_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...managed.matchAll(new RegExp(escaped + '([A-Za-z0-9_-]+)' + suffix, 'g'))];
  if (matches.length !== 1) return fail('legacy-managed-state-count-invalid');
  const state = decode(matches[0][1]);
  const number = kind === 'parent' ? state?.data?.issue : kind === 'child' ? state?.data?.issue : state?.data?.number;
  if (!isRecord(state) || state.kind !== kind || state.repository !== expected.repository || number !== expected.number || !isRecord(state.data)) return fail('legacy-managed-state-binding-invalid');
  return ok('LEGACY_PROGRAMME_BODY_PARSED', { state, state_digest: digest(state), body_digest: digest(body) });
}

function parseLegacyV1Snapshot(snapshot, desired) {
  const desiredChildren = desired.children.map((child) => String(child.issue)).sort();
  const desiredPrs = desired.prs.map((pr) => String(pr.number)).sort();
  if (!same(Object.keys(snapshot.bodies.children || {}).sort(), desiredChildren)
    || !same(Object.keys(snapshot.bodies.prs || {}).sort(), desiredPrs)) return fail('legacy-snapshot-scope-mismatch');
  const parent = parseLegacyV1Body(snapshot.bodies.parent, 'parent', { repository: desired.repository, number: desired.parent.issue });
  if (!parent.ok) return parent;
  const children = {};
  const prs = {};
  for (const child of desired.children) {
    const parsed = parseLegacyV1Body(snapshot.bodies.children[String(child.issue)], 'child', { repository: desired.repository, number: child.issue });
    if (!parsed.ok) return parsed;
    if (parsed.state.data.parent_issue !== desired.parent.issue) return fail('legacy-managed-state-binding-invalid');
    children[String(child.issue)] = parsed;
  }
  for (const pr of desired.prs) {
    const parsed = parseLegacyV1Body(snapshot.bodies.prs[String(pr.number)], 'pr', { repository: desired.repository, number: pr.number });
    if (!parsed.ok) return parsed;
    if (parsed.state.data.parent_issue !== desired.parent.issue || parsed.state.data.child_issue !== pr.child_issue) return fail('legacy-managed-state-binding-invalid');
    prs[String(pr.number)] = parsed;
  }
  const parentData = parent.state.data;
  const childData = Object.values(children).map((entry) => entry.state.data);
  const prData = Object.values(prs).map((entry) => entry.state.data);
  const required = SURFACE_CONTRACT.legacy_v1_portable_minimum;
  if (!required.parent.every((key) => hasOwn(parentData, key))
    || childData.some((child) => !required.child.every((key) => hasOwn(child, key)))
    || prData.some((pr) => !required.pr.every((key) => hasOwn(pr, key)))) return fail('legacy-portable-state-incomplete');
  if ((parentData.current_child || null) !== (childData.find((child) => child.status === 'CURRENT')?.issue || null)) return fail('legacy-current-child-contradiction');
  const contradictions = [];
  if (/\bG4\b/i.test(parentData.status || '') && /\bno\b[^\r\n]{0,40}\bG4\b[^\r\n]{0,40}\blaunch/i.test(canonicalJson(parentData.extensions || {}))) contradictions.push('parent-g4-launch');
  for (const child of childData) {
    const candidate = child.candidate;
    if (candidate) {
      const pr = prData.find((entry) => entry.number === candidate.pr);
      if (!pr || candidate.branch !== pr.branch || candidate.base !== pr.base || candidate.head !== pr.head
        || candidate.tree !== pr.tree || candidate.version !== pr.version) return fail('legacy-candidate-binding-contradiction');
    }
    if (/\bG4\b/i.test(child.current_gate || '')
      && (child.epochs || []).some((epoch) => /(?:await(?:ing|s)?|before)[^\r\n]{0,80}(?:fresh[^\r\n]{0,20})?\bG4\b/i.test(epoch.state || ''))) contradictions.push(`child-${child.issue}-g4-state`);
    if (/\bG4\b/i.test(child.current_gate || '')
      && prData.filter((pr) => pr.child_issue === child.issue).some((pr) => /(?:await(?:ing|s)?|before)[^\r\n]{0,100}(?:fresh[^\r\n]{0,20})?\bG4\b/i.test(pr.outcome || ''))) contradictions.push(`child-${child.issue}-pr-g4-state`);
  }
  const sourceModel = { repository: desired.repository, parent: parentData, children: childData, prs: prData };
  return ok('LEGACY_PROGRAMME_SNAPSHOT_PARSED', {
    state_digests: { parent: parent.state_digest, children: Object.fromEntries(Object.entries(children).map(([key, entry]) => [key, entry.state_digest])), prs: Object.fromEntries(Object.entries(prs).map(([key, entry]) => [key, entry.state_digest])) },
    source_model_digest: digest(sourceModel),
    contradictions,
  });
}

function buildMigrationPreviewV1(input = {}) {
  if (!isRecord(input.legacy_snapshot) || input.legacy_snapshot.complete !== true || !safeLine(input.legacy_snapshot.revision, 256)
    || !isRecord(input.legacy_snapshot.bodies) || !isRecord(input.legacy_snapshot.labels)
    || !Array.isArray(input.legacy_snapshot.managed_events) || !isRecord(input.legacy_snapshot.native)
    || !safeLine(input.authority_ref, 256)) return fail('migration-input-incomplete');
  const valid = validateCanonicalStateV4(input.desired);
  if (!valid.ok) return valid;
  if (input.legacy_snapshot.repository !== input.desired.repository) return fail('migration-repository-mismatch');
  const currentEvents = validateManagedEventInventoryV4(input.legacy_snapshot.managed_events, input.legacy_snapshot.repository);
  if (!currentEvents.ok) return currentEvents;
  const parsedLegacy = parseLegacyV1Snapshot(input.legacy_snapshot, input.desired);
  if (!parsedLegacy.ok) return parsedLegacy;
  const correctionEvidence = input.desired.evidence_refs.find((entry) => entry.kind === 'WEB' && entry.reference === input.authority_ref);
  if (!correctionEvidence) return fail('migration-authority-not-retained-in-target');
  const trusted = inspectTrustBindings(input.desired, input.scope_grant, input.broker);
  if (!trusted.ok) return trusted;
  const rendered = renderProgrammeV4(input.desired);
  if (!rendered.ok) return rendered;
  const associations = derivePrAssociationsV4(input.desired);
  if (!associations.ok) return associations;
  const replacements = { parent: null, children: {}, prs: {} };
  const parent = replaceExactManagedBody(input.legacy_snapshot.bodies.parent, 'parent', rendered.bodies.parent);
  if (!parent.ok) return parent;
  replacements.parent = parent.body;
  for (const [number, body] of Object.entries(rendered.bodies.children)) {
    const replacement = replaceExactManagedBody(input.legacy_snapshot.bodies.children?.[number], 'child', body);
    if (!replacement.ok) return replacement;
    replacements.children[number] = replacement.body;
  }
  for (const [number, body] of Object.entries(rendered.bodies.prs)) {
    const replacement = replaceExactManagedBody(input.legacy_snapshot.bodies.prs?.[number], 'pr', body);
    if (!replacement.ok) return replacement;
    replacements.prs[number] = replacement.body;
  }
  const sourceSnapshotDigest = snapshotDigest(input.legacy_snapshot);
  const expectedEvents = expectedManagedEventsV4(input.desired, currentEvents, valid.canonical_digest, {
    authority_ref: input.authority_ref,
    source_snapshot_digest: sourceSnapshotDigest,
    source_model_digest: parsedLegacy.source_model_digest,
  });
  if (!expectedEvents.ok) return expectedEvents;
  const expectedSnapshot = {
    repository: input.desired.repository,
    revision: input.legacy_snapshot.revision,
    complete: true,
    canonical_state: clone(input.desired),
    bodies: replacements,
    labels: expectedLabels(input.desired, input.legacy_snapshot.labels),
    managed_events: expectedEvents.events,
    native: { children: clone(input.scope_grant.children), dependencies: clone(input.scope_grant.dependencies), associated_prs: clone(input.scope_grant.associated_prs), pr_associations: associations.associations, api_version: input.scope_grant.api_version },
  };
  const operations = [];
  addOperation(operations, 'migrate-parent-body', input.desired.parent.issue, input.legacy_snapshot.bodies.parent, replacements.parent);
  for (const [number, body] of Object.entries(replacements.children)) addOperation(operations, 'migrate-child-body', Number(number), input.legacy_snapshot.bodies.children[number], body);
  for (const [number, body] of Object.entries(replacements.prs)) addOperation(operations, 'migrate-pr-body', Number(number), input.legacy_snapshot.bodies.prs[number], body);
  for (const event of expectedEvents.new_events) addOperation(operations, 'managed-event', event.entity.number, null, event);
  addOperation(operations, 'labels', input.desired.parent.issue, input.legacy_snapshot.labels, expectedSnapshot.labels);
  addOperation(operations, 'relationships', input.desired.parent.issue, input.legacy_snapshot.native, expectedSnapshot.native);
  const semanticMapping = {
    schema: 'toolkit.github-program.migration-mapping.v1',
    identity_scope: desiredScope(input.desired),
    source_model_digest: parsedLegacy.source_model_digest,
    target_canonical_digest: valid.canonical_digest,
    correction_authority_ref: input.authority_ref,
    correction_evidence_id: correctionEvidence.id,
    admitted_source_contradictions: parsedLegacy.contradictions,
  };
  const preview = {
    schema: MIGRATION_SCHEMA, preview_kind: 'MIGRATION', repository: input.desired.repository, parent_issue: input.desired.parent.issue, authority_ref: input.authority_ref,
    expected_revision: input.legacy_snapshot.revision, source_snapshot_digest: sourceSnapshotDigest, source_body_digests: {
      parent: digest(input.legacy_snapshot.bodies.parent),
      children: Object.fromEntries(Object.entries(input.legacy_snapshot.bodies.children || {}).map(([key, value]) => [key, digest(value)])),
      prs: Object.fromEntries(Object.entries(input.legacy_snapshot.bodies.prs || {}).map(([key, value]) => [key, digest(value)])),
    },
    source_state_digests: parsedLegacy.state_digests,
    semantic_mapping: semanticMapping,
    semantic_mapping_digest: digest(semanticMapping),
    target_canonical_digest: valid.canonical_digest,
    target_managed_body_digests: rendered.body_digests,
    target_body_digests: {
      parent: digest(replacements.parent),
      children: Object.fromEntries(Object.entries(replacements.children).map(([key, value]) => [key, digest(value)])),
      prs: Object.fromEntries(Object.entries(replacements.prs).map(([key, value]) => [key, digest(value)])),
    },
    scope_digest: input.scope_grant.scope_digest,
    trusted_pr_inspection_digest: trusted.trusted_pr_inspection_digest,
    trusted_relationship_inspection_digest: trusted.trusted_relationship_inspection_digest,
    candidate_binding_digest: expectedEvents.candidate_binding_digest,
    expected_event_inventory_digest: expectedEvents.inventory_digest,
    target_projection_digests: rendered.body_digests,
    expected_snapshot_digest: snapshotDigest(expectedSnapshot),
    operations, operations_digest: digest(operations), ordered_operation_ids: operations.map((operation) => operation.operation_id),
    mutation_authority: 'NOT_GRANTED', finality_authority: 'NOT_GRANTED',
  };
  preview.preview_id = digest(preview);
  return ok('PROGRAMME_MIGRATION_PREVIEW_READY', { ...preview, expected_snapshot: expectedSnapshot });
}

function createConvergenceRuntime(options = {}) {
  const accepted = new Map();
  function register(result, desired, scopeGrant) {
    if (result.ok) accepted.set(result.preview_id, { preview_digest: digest(result), preview_kind: result.preview_kind, desired: clone(desired), scope_grant: scopeGrant });
    return result;
  }
  function preview(input = {}) {
    if (typeof options.inspect_snapshot !== 'function') return fail('snapshot-adapter-required');
    let snapshot;
    try { snapshot = options.inspect_snapshot(); } catch (_error) { return fail('snapshot-inspection-failed'); }
    const result = buildConvergencePreview({ snapshot, desired: input.desired, scope_grant: input.scope_grant, broker: options.broker });
    return register(result, input.desired, input.scope_grant);
  }
  function migrationPreview(input = {}) {
    if (typeof options.inspect_snapshot !== 'function') return fail('snapshot-adapter-required');
    let snapshot;
    try { snapshot = options.inspect_snapshot(); } catch (_error) { return fail('snapshot-inspection-failed'); }
    const result = buildMigrationPreviewV1({ legacy_snapshot: snapshot, desired: input.desired, scope_grant: input.scope_grant, broker: options.broker, authority_ref: input.authority_ref });
    return register(result, input.desired, input.scope_grant);
  }
  function authorityBinding(previewResult) {
    const binding = {
      preview_schema: previewResult.schema,
      preview_kind: previewResult.preview_kind,
      repository: previewResult.repository,
      parent_issue: previewResult.parent_issue,
      preview_id: previewResult.preview_id,
      expected_revision: previewResult.preview_kind === 'MIGRATION' ? previewResult.expected_revision : previewResult.current_revision,
      source_snapshot_digest: previewResult.preview_kind === 'MIGRATION' ? previewResult.source_snapshot_digest : previewResult.current_snapshot_digest,
      target_canonical_digest: previewResult.preview_kind === 'MIGRATION' ? previewResult.target_canonical_digest : previewResult.canonical_digest,
      scope_digest: previewResult.scope_digest,
      trusted_pr_inspection_digest: previewResult.trusted_pr_inspection_digest,
      trusted_relationship_inspection_digest: previewResult.trusted_relationship_inspection_digest,
      candidate_binding_digest: previewResult.candidate_binding_digest,
      expected_event_inventory_digest: previewResult.expected_event_inventory_digest,
      operations_digest: previewResult.operations_digest,
      operation_ids: previewResult.operations.map((operation) => operation.operation_id),
    };
    if (previewResult.preview_kind === 'MIGRATION') Object.assign(binding, {
      authority_ref: previewResult.authority_ref,
      source_body_digests: clone(previewResult.source_body_digests),
      source_state_digests: clone(previewResult.source_state_digests),
      semantic_mapping_digest: previewResult.semantic_mapping_digest,
      target_managed_body_digests: clone(previewResult.target_managed_body_digests),
      target_body_digests: clone(previewResult.target_body_digests),
      target_projection_digests: clone(previewResult.target_projection_digests),
      expected_snapshot_digest: previewResult.expected_snapshot_digest,
      ordered_operation_ids: clone(previewResult.ordered_operation_ids),
    });
    return binding;
  }
  function verifyStillTrusted(acceptedEntry, previewResult) {
    const trusted = inspectTrustBindings(acceptedEntry.desired, acceptedEntry.scope_grant, options.broker);
    if (!trusted.ok) return fail(String(trusted.reason).includes('relationship') ? 'stale-trusted-relationship-inspection' : 'stale-trusted-pr-inspection', { detail: trusted.reason });
    if (trusted.trusted_pr_inspection_digest !== previewResult.trusted_pr_inspection_digest) return fail('stale-trusted-pr-inspection');
    if (trusted.trusted_relationship_inspection_digest !== previewResult.trusted_relationship_inspection_digest) return fail('stale-trusted-relationship-inspection');
    return ok('TRUSTED_PROGRAMME_FACTS_UNCHANGED');
  }
  function apply(input = {}) {
    const previewResult = input.preview;
    const acceptedEntry = isRecord(previewResult) ? accepted.get(previewResult.preview_id) : null;
    if (!isRecord(previewResult) || previewResult.ok !== true || !acceptedEntry || acceptedEntry.preview_digest !== digest(previewResult)) return fail('accepted-preview-required');
    const expectedSourceDigest = previewResult.preview_kind === 'MIGRATION' ? previewResult.source_snapshot_digest : previewResult.current_snapshot_digest;
    const stillTrusted = verifyStillTrusted(acceptedEntry, previewResult);
    if (!stillTrusted.ok) return stillTrusted;
    if (previewResult.operations.length === 0) {
      let current;
      try { current = options.inspect_snapshot(); } catch (_error) { return fail('snapshot-inspection-failed'); }
      if (snapshotDigest(current) !== expectedSourceDigest) return fail('stale-preview');
      const rerun = buildConvergencePreview({ snapshot: current, desired: acceptedEntry.desired, scope_grant: acceptedEntry.scope_grant, broker: options.broker });
      if (!rerun.ok || rerun.operations.length !== 0 || rerun.code !== 'PROGRAMME_ZERO_DELTA') return fail('immediate-rerun-not-zero-delta');
      accepted.delete(previewResult.preview_id);
      return ok('PROGRAMME_ZERO_DELTA', { mutation_count: 0, readback_verified: true, immediate_rerun: 'ZERO_DELTA' });
    }
    if (typeof options.verify_authority !== 'function') return fail('trusted-authority-verifier-required');
    const binding = authorityBinding(previewResult);
    let verified;
    try { verified = options.verify_authority({ assertion: clone(input.authority), binding: clone(binding) }); } catch (_error) { return fail('trusted-authority-verification-failed'); }
    if (!isRecord(verified) || verified.ok !== true || !isRecord(verified.grant) || !same(verified.grant.binding, binding)
      || !safeLine(verified.grant.reference, 256)) return fail('preview-bound-authority-required');
    let current;
    try { current = options.inspect_snapshot(); } catch (_error) { return fail('snapshot-inspection-failed'); }
    if (snapshotDigest(current) !== expectedSourceDigest) return fail('stale-preview');
    if (typeof options.apply_operations !== 'function') return fail('apply-adapter-required');
    let applied;
    try { applied = options.apply_operations({ repository: previewResult.repository, parent_issue: previewResult.parent_issue, expected_revision: binding.expected_revision, authority_ref: verified.grant.reference, operations: clone(previewResult.operations) }); } catch (_error) { return fail('apply-failed'); }
    if (!isRecord(applied) || applied.ok !== true || applied.applied_count !== undefined && applied.applied_count !== previewResult.operations.length) return fail('apply-failed');
    let readback;
    try { readback = options.inspect_snapshot(); } catch (_error) { return fail('snapshot-inspection-failed'); }
    const verifiedReadback = verifyConvergenceReadback(readback, previewResult);
    if (!verifiedReadback.ok) return verifiedReadback;
    const rerun = buildConvergencePreview({ snapshot: readback, desired: acceptedEntry.desired, scope_grant: acceptedEntry.scope_grant, broker: options.broker });
    if (!rerun.ok || rerun.operations.length !== 0 || rerun.code !== 'PROGRAMME_ZERO_DELTA') return fail('immediate-rerun-not-zero-delta');
    accepted.delete(previewResult.preview_id);
    return ok(previewResult.preview_kind === 'MIGRATION' ? 'PROGRAMME_MIGRATED' : 'PROGRAMME_RECONCILED', { applied_count: applied.applied_count ?? previewResult.operations.length, readback_verified: true, immediate_rerun: 'ZERO_DELTA' });
  }
  return Object.freeze({ preview, migrationPreview, apply });
}

module.exports = Object.freeze({
  STATE_SCHEMA, PROJECTION_SCHEMA, EXTENSIONS_SCHEMA, SCOPE_SCHEMA, PR_INSPECTION_SCHEMA, RELATIONSHIP_INSPECTION_SCHEMA,
  MIGRATION_SCHEMA, MANAGED_EVENT_SCHEMA, DESIGN_LOCK, BODY_BUDGET_BYTES, CANONICAL_STATE_BUDGET_BYTES, TOTAL_PROJECTION_BUDGET_BYTES,
  LIFECYCLES, REGISTRY_STATUSES, LIVE_PR_LIFECYCLES, EXTENSION_CLASSES, MARKERS,
  canonicalJson, digest, validateExtensionsV1, validateCanonicalStateV4, deriveProjectionV1, renderProgrammeV4,
  parseProgrammeV4Body, createProgrammeTrustBroker, assertScopeEquality, validatePrBindings, derivePrAssociationsV4,
  validateManagedEventInventoryV4, expectedManagedEventsV4, buildConvergencePreview, verifyConvergenceReadback,
  parseLegacyV1Body, parseLegacyV1Snapshot, buildMigrationPreviewV1, createConvergenceRuntime,
});
