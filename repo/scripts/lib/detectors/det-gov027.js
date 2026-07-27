'use strict';

const { getSubjectForIssue } = require('../subject-map');
const {
  parseChecklistFromBody, parseTimestamps, isAcceptanceCriteriaMet, timestampToStr,
  parseParentTrackerFromBody, parseReplacementReasonFromBody, parseSupersedesPRFromBody,
  checklistMultisetMatch, parentChildrenMatch
} = require('./shared/body-parsers');
const { hasSection } = require('./shared/section-handlers');
const { getCanonicalParents, isChildCategory } = require('./shared/relationship-index');

function canonicalPr(value) {
  return String(value).normalize('NFC');
}

function graphContradictions(issue) {
  const records = (issue.implementation_prs || []).slice().sort((a, b) => canonicalPr(a.number).localeCompare(canonicalPr(b.number)));
  const nodes = new Map(records.map((record) => [canonicalPr(record.number), record]));
  const edges = [];
  for (const record of records) {
    if (!record.is_replacement || record.supersedes_pr === undefined || record.supersedes_pr === null) continue;
    edges.push({ replacement: canonicalPr(record.number), predecessor: canonicalPr(record.supersedes_pr) });
  }
  edges.sort((a, b) => (a.replacement + '\0' + a.predecessor).localeCompare(b.replacement + '\0' + b.predecessor));

  const result = [];
  for (const edge of edges) {
    if (!nodes.has(edge.predecessor)) result.push('unknown_predecessor');
    if (edge.replacement === edge.predecessor) result.push('self_edge');
  }

  const successorSets = new Map();
  for (const edge of edges) {
    if (!successorSets.has(edge.predecessor)) successorSets.set(edge.predecessor, new Set());
    successorSets.get(edge.predecessor).add(edge.replacement);
  }
  for (const predecessor of [...successorSets.keys()].sort()) {
    if (successorSets.get(predecessor).size > 1) result.push('multiple_successors');
  }

  const adjacency = new Map([...nodes.keys()].map((node) => [node, []]));
  for (const edge of edges) if (nodes.has(edge.predecessor)) adjacency.get(edge.replacement).push(edge.predecessor);
  let index = 0;
  const indices = new Map();
  const low = new Map();
  const stack = [];
  const active = new Set();
  const components = [];
  function connect(node) {
    indices.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    active.add(node);
    for (const next of adjacency.get(node).slice().sort()) {
      if (!indices.has(next)) {
        connect(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (active.has(next)) low.set(node, Math.min(low.get(node), indices.get(next)));
    }
    if (low.get(node) === indices.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        active.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component.sort());
    }
  }
  for (const node of [...nodes.keys()].sort()) if (!indices.has(node)) connect(node);
  for (const component of components) {
    if (component.length > 1) result.push('cycle');
  }

  const activeRecords = records.filter((record) => record.state === 'open' && record.merged === false);
  const hasGOV022 = activeRecords.length > 1;
  if (!hasGOV022 && nodes.size > 1) {
    const undirected = new Map([...nodes.keys()].map((node) => [node, new Set()]));
    for (const edge of edges) {
      if (!nodes.has(edge.predecessor) || edge.replacement === edge.predecessor) continue;
      undirected.get(edge.replacement).add(edge.predecessor);
      undirected.get(edge.predecessor).add(edge.replacement);
    }
    let componentCount = 0;
    const seen = new Set();
    for (const start of [...nodes.keys()].sort()) {
      if (seen.has(start)) continue;
      componentCount += 1;
      const queue = [start];
      seen.add(start);
      while (queue.length) {
        const current = queue.shift();
        for (const next of undirected.get(current)) if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    if (componentCount > 1) result.push('disconnected_graph');
    for (const record of activeRecords) {
      if (successorSets.has(canonicalPr(record.number))) result.push('reactivation');
    }
  }
  return result;
}

function detectGOV027(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;

  for (const parent of getCanonicalParents(issues)) {
    const subject = getSubjectForIssue(subjects, parent.id);
    const bodyChecklist = parseChecklistFromBody(parent.body);
    if (parent.checklist_items && (
      checklistMultisetMatch(bodyChecklist, parent.checklist_items).length > 0 ||
      (parent.checklist_items.length === 0 && bodyChecklist.length > 0)
    )) emit(findings, 'GOV027', subject, 'checklist_contradiction', {});
    if (parent.children && parentChildrenMatch(bodyChecklist, parent.children).length > 0) {
      emit(findings, 'GOV027', subject, 'children_contradiction', {});
    }
  }

  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    const subject = getSubjectForIssue(subjects, issue.id);

    if (issue.reconciliation_timestamp !== undefined && issue.reconciliation_timestamp !== null) {
      const bodyTimestamps = parseTimestamps(issue.body);
      const bodyValue = bodyTimestamps.length === 1 ? timestampToStr(bodyTimestamps[0]) : null;
      if (bodyValue && issue.reconciliation_timestamp.normalize('NFC') !== bodyValue.normalize('NFC')) {
        emit(findings, 'GOV027', subject, 'reconciliation_contradiction', {});
      }
    }
    if (issue.acceptance_criteria_met !== undefined && issue.acceptance_criteria_met !== null && hasSection(issue.body, 'acceptance_criteria')) {
      const bodyMet = isAcceptanceCriteriaMet(issue.body);
      if (bodyMet !== null && issue.acceptance_criteria_met !== bodyMet) emit(findings, 'GOV027', subject, 'acceptance_contradiction', {});
    }
    const bodyParent = parseParentTrackerFromBody(issue.body);
    if (bodyParent !== null && issue.parent !== undefined && canonicalPr(issue.parent) !== canonicalPr(bodyParent)) {
      emit(findings, 'GOV027', subject, 'parent_contradiction', {});
    }

    const bodyReason = parseReplacementReasonFromBody(issue.body);
    const bodyPredecessor = parseSupersedesPRFromBody(issue.body);
    const replacements = (issue.implementation_prs || []).filter((record) => record.is_replacement);
    const structuredReasons = [...new Set(replacements.map((record) => record.replacement_reason).filter(Boolean))];
    const structuredPredecessors = [...new Set(replacements.map((record) => record.supersedes_pr).filter((value) => value !== null && value !== undefined).map(canonicalPr))];
    if ((bodyReason === null) !== (structuredReasons.length === 0) ||
        (bodyReason !== null && (structuredReasons.length !== 1 || bodyReason.normalize('NFC') !== structuredReasons[0].normalize('NFC')))) {
      emit(findings, 'GOV027', subject, 'replacement_reason_contradiction', {});
    }
    if ((bodyPredecessor === null) !== (structuredPredecessors.length === 0) ||
        (bodyPredecessor !== null && (structuredPredecessors.length !== 1 || canonicalPr(bodyPredecessor) !== structuredPredecessors[0]))) {
      emit(findings, 'GOV027', subject, 'supersedes_pr_contradiction', {});
    }

    for (const messageKey of graphContradictions(issue)) emit(findings, 'GOV027', subject, messageKey, {});
  }
}

module.exports = detectGOV027;
module.exports.graphContradictions = graphContradictions;
