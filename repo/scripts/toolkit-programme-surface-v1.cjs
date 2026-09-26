'use strict';

const { canonicalSerialize, digestValue } = require('./toolkit-execution-loop.cjs');
const { types: utilTypes } = require('node:util');

const GRAPH_SCHEMA = 'toolkit.controller.programme-graph.v1';
const METADATA_SCHEMA = 'toolkit.github-program.programme-graph-metadata.v1';
const CURRENT_421_OUTCOMES = Object.freeze([
  'C1', 'W2-A', 'S1-A', 'C2', 'C3', 'S1', 'S2', 'H1', 'H2', 'H3', 'H4', 'W1', 'W2', 'D1', 'A1',
  'N1', 'N2', 'N3', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'V1', 'V2', 'A4', 'A5', 'Q',
]);
const FORBIDDEN_421_OUTCOMES = new Set(['A2', 'A3']);
const PRIORITIES = new Set(['URGENT', 'HIGH', 'NORMAL', 'LOW']);
const PLANNING_CLASSES = new Set(['INVESTIGATION', 'PLANNING', 'DELIVERY', 'REFERENCE']);
const PLANNING_ADMISSIONS = new Set(['G1_READ_ONLY_AUTHORIZED', 'DEFERRED', 'NOT_APPLICABLE']);
const IMPLEMENTATION_ADMISSIONS = new Set(['AUTHORIZED', 'DEFERRED', 'NOT_APPLICABLE']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function trustedDataCopy(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail('PROGRAMME_GRAPH_STATE_INVALID');
    return value;
  }
  if (typeof value === 'object' || typeof value === 'function') {
    try { if (utilTypes.isProxy(value)) fail('PROGRAMME_GRAPH_STATE_INVALID'); }
    catch (_) { fail('PROGRAMME_GRAPH_STATE_INVALID'); }
  }
  if (typeof value !== 'object' || seen.has(value)) fail('PROGRAMME_GRAPH_STATE_INVALID');
  seen.add(value);
  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    const names = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols(value).length) fail('PROGRAMME_GRAPH_STATE_INVALID');
    if (isArray) {
      if (prototype !== Array.prototype && prototype !== null) fail('PROGRAMME_GRAPH_STATE_INVALID');
      const length = Object.getOwnPropertyDescriptor(value, 'length');
      if (!length || !Object.hasOwn(length, 'value') || length.enumerable || !Number.isSafeInteger(length.value)) fail('PROGRAMME_GRAPH_STATE_INVALID');
      const result = new Array(length.value);
      for (const name of names) {
        if (name === 'length') continue;
        if (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= length.value) fail('PROGRAMME_GRAPH_STATE_INVALID');
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('PROGRAMME_GRAPH_STATE_INVALID');
      }
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('PROGRAMME_GRAPH_STATE_INVALID');
        Object.defineProperty(result, String(index), {
          value: trustedDataCopy(descriptor.value, seen), enumerable: true, writable: true, configurable: true,
        });
      }
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) fail('PROGRAMME_GRAPH_STATE_INVALID');
    const result = {};
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('PROGRAMME_GRAPH_STATE_INVALID');
      Object.defineProperty(result, name, {
        value: trustedDataCopy(descriptor.value, seen), enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  } finally { seen.delete(value); }
}

function isPlain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, required, optional = []) {
  if (!isPlain(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function issueNumber(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function deepFreezeGraph(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreezeGraph(item);
  return Object.freeze(value);
}

function normalizeOptionalCollections(value) {
  const state = trustedDataCopy(value);
  const omitEmpty = (record, key, code) => {
    if (!Object.hasOwn(record, key)) return;
    if (!Array.isArray(record[key])) fail(code);
    if (record[key].length === 0) delete record[key];
  };
  for (const key of ['dependencies', 'extensions']) omitEmpty(state, key, 'PROGRAMME_GRAPH_STATE_INVALID');
  if (Array.isArray(state.children)) {
    for (const child of state.children) {
      if (!isPlain(child)) fail('PROGRAMME_GRAPH_STATE_INVALID');
      for (const key of ['dependencies', 'holds', 'deliverables']) omitEmpty(child, key, 'PROGRAMME_GRAPH_STATE_INVALID');
      if (Object.hasOwn(child, 'dependencies') && (!child.dependencies.every(issueNumber)
        || new Set(child.dependencies).size !== child.dependencies.length)) fail('PROGRAMME_GRAPH_DEPENDENCY_INVALID');
    }
  }
  if (Array.isArray(state.active_lanes)) {
    for (const lane of state.active_lanes) {
      if (!isPlain(lane)) fail('PROGRAMME_GRAPH_STATE_INVALID');
      omitEmpty(lane, 'work_claims', 'PROGRAMME_GRAPH_STATE_INVALID');
    }
  }
  for (const extension of state.extensions || []) {
    if (!isPlain(extension) || !Array.isArray(extension.outcomes)) continue;
    for (const outcome of extension.outcomes) {
      if (!isPlain(outcome)) continue;
      omitEmpty(outcome, 'reference_issue_pointers', 'PROGRAMME_GRAPH_METADATA_INVALID');
    }
  }
  return state;
}

function safeText(value, max = 4096) {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f\r\n]/.test(value)
    && !/[\u202a-\u202e\u2066-\u2069\ufeff]/.test(value)
    && !/\b(?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]/i.test(value)
    && !/-----BEGIN [^-]*PRIVATE KEY-----/i.test(value);
}

function findGraphMetadata(state) {
  state = trustedDataCopy(state);
  if (!isPlain(state) || !Array.isArray(state.extensions)) return null;
  const selected = state.extensions.filter((item) => isPlain(item) && item.schema === METADATA_SCHEMA);
  if (selected.length === 0) {
    if (state.extensions.length > 0) fail('PROGRAMME_GRAPH_EXTENSION_UNSUPPORTED');
    return null;
  }
  if (selected.length !== 1 || state.extensions.length !== 1) fail('PROGRAMME_GRAPH_EXTENSION_DUPLICATE');
  const extension = selected[0];
  if (!exactKeys(extension, ['schema', 'outcomes']) || extension.schema !== METADATA_SCHEMA
    || !Array.isArray(extension.outcomes)) fail('PROGRAMME_GRAPH_METADATA_INVALID');
  const childByIssue = new Map(state.children.map((child) => [child.issue, child]));
  const issueIds = new Set();
  const outcomeIds = new Set();
  const metadataByIssue = new Map();
  for (const item of extension.outcomes) {
    const optional = ['priority', 'planning_class', 'planning_admission', 'implementation_admission', 'reference_issue_pointers', 'current_gate', 'current_work'];
    if (!exactKeys(item, ['child_issue', 'outcome_id'], optional)
      || !issueNumber(item.child_issue) || !safeText(item.outcome_id, 64)
      || !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?$/.test(item.outcome_id)
      || issueIds.has(item.child_issue) || outcomeIds.has(item.outcome_id)
      || !childByIssue.has(item.child_issue)) fail('PROGRAMME_GRAPH_METADATA_INVALID');
    if (FORBIDDEN_421_OUTCOMES.has(item.outcome_id)) fail('PROGRAMME_GRAPH_OUTCOME_FORBIDDEN');
    if (Object.hasOwn(item, 'priority') && !PRIORITIES.has(item.priority)) fail('PROGRAMME_GRAPH_METADATA_INVALID');
    if (Object.hasOwn(item, 'planning_class') && !PLANNING_CLASSES.has(item.planning_class)) fail('PROGRAMME_GRAPH_METADATA_INVALID');
    if (Object.hasOwn(item, 'planning_admission') && !PLANNING_ADMISSIONS.has(item.planning_admission)) fail('PROGRAMME_GRAPH_METADATA_INVALID');
    if (Object.hasOwn(item, 'implementation_admission') && !IMPLEMENTATION_ADMISSIONS.has(item.implementation_admission)) fail('PROGRAMME_GRAPH_METADATA_INVALID');
    if (Object.hasOwn(item, 'current_gate') && !safeText(item.current_gate, 512)) fail('PROGRAMME_GRAPH_METADATA_INVALID');
    if (Object.hasOwn(item, 'current_work') && !safeText(item.current_work)) fail('PROGRAMME_GRAPH_METADATA_INVALID');
    if (Object.hasOwn(item, 'reference_issue_pointers')) {
      const refs = item.reference_issue_pointers;
      if (!Array.isArray(refs) || refs.some((ref) => !exactKeys(ref, ['repository', 'issue'])
        || !safeText(ref.repository, 512) || !/^[^/\s]+\/[^/\s]+$/.test(ref.repository) || !issueNumber(ref.issue))) {
        fail('PROGRAMME_GRAPH_METADATA_INVALID');
      }
      const refKeys = refs.map((ref) => `${ref.repository}#${ref.issue}`);
      if (new Set(refKeys).size !== refKeys.length) fail('PROGRAMME_GRAPH_METADATA_INVALID');
    }
    issueIds.add(item.child_issue);
    outcomeIds.add(item.outcome_id);
    metadataByIssue.set(item.child_issue, item);
  }
  if (metadataByIssue.size !== state.children.length || state.children.some((child) => !metadataByIssue.has(child.issue))) {
    fail('PROGRAMME_GRAPH_CHILD_MAPPING_MISSING');
  }
  if (state.parent?.issue === 421) {
    if (childByIssue.has(467)) fail('PROGRAMME_GRAPH_REFERENCE_ONLY_ISSUE_IN_MEMBERSHIP');
    const actual = [...outcomeIds].sort();
    const expected = [...CURRENT_421_OUTCOMES].sort();
    if (canonicalSerialize(actual) !== canonicalSerialize(expected)) fail('PROGRAMME_GRAPH_OUTCOME_SET_INVALID');
    const byId = new Map([...metadataByIssue.values()].map((item) => [item.outcome_id, item]));
    const c1 = byId.get('C1');
    const w2a = byId.get('W2-A');
    if (!c1 || c1.child_issue !== 435 || !w2a || w2a.child_issue !== 455) fail('PROGRAMME_GRAPH_SOURCE_MAPPING_INVALID');
    const c1Child = childByIssue.get(435);
    const w2aChild = childByIssue.get(455);
    if (c1Child.lifecycle !== 'CURRENT' || w2aChild.lifecycle !== 'QUEUED'
      || w2a.priority !== 'URGENT' || w2a.planning_admission !== 'G1_READ_ONLY_AUTHORIZED'
      || w2a.implementation_admission !== 'DEFERRED') fail('PROGRAMME_GRAPH_CANONICAL_CONTRADICTION');
  }
  return { schema: METADATA_SCHEMA, byIssue: metadataByIssue };
}

function selectDeliveryPr(state, history, child) {
  const candidates = [];
  for (const entry of child.pr_registry || []) {
    if (entry && issueNumber(entry.pr) && ['ACTIVE', 'ACCEPTED', 'RETAINED'].includes(entry.status)) {
      candidates.push(entry.pr);
    }
  }
  for (const descriptor of state.prs || []) {
    if (descriptor && descriptor.child_issue === child.issue && issueNumber(descriptor.number)) candidates.push(descriptor.number);
  }
  for (const entry of history?.pr_history || []) {
    if (entry && entry.descriptor?.child_issue === child.issue && issueNumber(entry.authority?.pr_number)) {
      candidates.push(entry.authority.pr_number);
    }
  }
  const unique = [...new Set(candidates)].sort((left, right) => left - right);
  return unique.length ? { repository: state.repository, number: unique[unique.length - 1] } : null;
}

function deriveProgrammeGraph(state, history = { pr_history: [] }) {
  state = normalizeOptionalCollections(state);
  history = trustedDataCopy(history);
  const metadata = findGraphMetadata(state);
  if (!metadata) fail('PROGRAMME_GRAPH_METADATA_REQUIRED');
  if (!safeText(state.repository, 512) || !/^[^/\s]+\/[^/\s]+$/.test(state.repository)
    || !issueNumber(state.parent?.issue) || !Array.isArray(state.children)) fail('PROGRAMME_GRAPH_STATE_INVALID');
  const childByIssue = new Map(state.children.map((child) => [child.issue, child]));
  const outcomeByIssue = new Map([...metadata.byIssue.entries()].map(([issue, item]) => [issue, item.outcome_id]));
  const nodes = state.children.slice().sort((a, b) => a.order - b.order).map((child) => {
    if (!Number.isSafeInteger(child.order) || child.order < 1 || !Array.isArray(child.done_when)
      || !child.done_when.every((item) => safeText(item))) fail('PROGRAMME_GRAPH_STATE_INVALID');
    const meta = metadata.byIssue.get(child.issue);
    const dependencies = child.dependencies || [];
    if (!Array.isArray(dependencies) || dependencies.some((issue) => !issueNumber(issue))
      || new Set(dependencies).size !== dependencies.length) fail('PROGRAMME_GRAPH_DEPENDENCY_INVALID');
    const translated = dependencies.map((issue) => {
      if (issue === child.issue || !childByIssue.has(issue) || !outcomeByIssue.has(issue)) fail('PROGRAMME_GRAPH_DEPENDENCY_INVALID');
      return outcomeByIssue.get(issue);
    });
    const lanes = (state.active_lanes || []).filter((lane) => (lane.child_issue ?? lane.child) === child.issue);
    const gateValues = lanes.map((lane) => lane.gate ?? lane.gate_id ?? lane.epoch_id ?? lane.epoch ?? null).filter((item) => item !== null);
    const workValues = lanes.flatMap((lane) => {
      if (typeof lane.current_work === 'string') return [lane.current_work];
      if (typeof lane.work === 'string') return [lane.work];
      if (Array.isArray(lane.work_claims)) return lane.work_claims;
      return [];
    });
    if (gateValues.some((item) => !safeText(item, 512)) || workValues.some((item) => !safeText(item))) {
      fail('PROGRAMME_GRAPH_EXECUTION_FACT_INVALID');
    }
    const result = {
      outcome_id: meta.outcome_id,
      order: child.order,
      status: child.lifecycle,
      dependencies: translated,
      native_issue: { repository: state.repository, number: child.issue },
      delivery_pr: selectDeliveryPr(state, history, child),
      current_gate: gateValues.length ? [...new Set(gateValues)].sort().join(', ')
        : Object.hasOwn(meta, 'current_gate') ? meta.current_gate : null,
      current_work: workValues.length ? [...new Set(workValues)].sort().join('; ')
        : Object.hasOwn(meta, 'current_work') ? meta.current_work : null,
      complete_when: child.done_when.slice(),
    };
    for (const key of ['priority', 'planning_class', 'planning_admission', 'implementation_admission', 'reference_issue_pointers']) {
      if (Object.hasOwn(meta, key)) result[key] = structuredClone(meta[key]);
    }
    return result;
  });
  const byOutcome = new Map(nodes.map((node) => [node.outcome_id, node]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) fail('PROGRAMME_GRAPH_DEPENDENCY_CYCLE');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byOutcome.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of nodes) visit(node.outcome_id);
  const graph = { schema: GRAPH_SCHEMA, repository: state.repository, parent_issue: state.parent.issue, outcomes: nodes };
  const canonical = canonicalSerialize(graph);
  const digest = digestValue(graph);
  if (digest !== require('node:crypto').createHash('sha256').update(canonical, 'utf8').digest('hex')) {
    fail('PROGRAMME_GRAPH_DIGEST_INVALID');
  }
  return deepFreezeGraph({ ...graph, digest });
}

function programmeGraphIdentity(graph) {
  graph = trustedDataCopy(graph);
  if (!isPlain(graph) || graph.schema !== GRAPH_SCHEMA || !/^[a-f0-9]{64}$/.test(graph.digest)) {
    fail('PROGRAMME_GRAPH_IDENTITY_INVALID');
  }
  const keys = Object.keys(graph).sort().join('\u0000');
  if (keys === ['digest', 'schema'].sort().join('\u0000')) return { schema: GRAPH_SCHEMA, digest: graph.digest };
  if (keys !== ['digest', 'outcomes', 'parent_issue', 'repository', 'schema'].sort().join('\u0000')
    || digestValue({ schema: graph.schema, repository: graph.repository, parent_issue: graph.parent_issue, outcomes: graph.outcomes }) !== graph.digest) {
    fail('PROGRAMME_GRAPH_IDENTITY_INVALID');
  }
  return { schema: GRAPH_SCHEMA, digest: graph.digest };
}

function renderProgrammeGraph(canonicalState) {
  if (arguments.length !== 1) fail('PROGRAMME_GRAPH_RENDERER_INVALID');
  const state = trustedDataCopy(canonicalState);
  const humanSurface = require('./toolkit-github-program-state-v5.cjs').humanSurfaceV2;
  const rendered = humanSurface.render({ source: { type: 'CANONICAL_STATE', state }, target: { kind: 'parent' } });
  if (!rendered.ok) fail(rendered.code);
  if (!rendered.programme_graph || rendered.programme_graph.schema !== GRAPH_SCHEMA) fail('PROGRAMME_GRAPH_METADATA_REQUIRED');
  const lines = rendered.body.split('\n');
  const start = lines.indexOf('## Programme Graph');
  const end = lines.indexOf('## Current action');
  if (start < 0 || end <= start) fail('PROGRAMME_GRAPH_RENDERER_INVALID');
  const result = lines.slice(start, end - 1);
  if (result[2] !== '| Outcome | Status | Current gate | Current work | Complete when |'
    || result[3] !== '| --- | --- | --- | --- | --- |'
    || result.some((line) => !line.startsWith('|') && line !== '' && line !== '## Programme Graph')) {
    fail('PROGRAMME_GRAPH_RENDERER_INVALID');
  }
  return result;
}

module.exports = Object.freeze({
  GRAPH_SCHEMA,
  METADATA_SCHEMA,
  CURRENT_421_OUTCOMES,
  findGraphMetadata,
  deriveProgrammeGraph,
  programmeGraphIdentity,
  renderProgrammeGraph,
});
