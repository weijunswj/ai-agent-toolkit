'use strict';

const { emitFinding } = require('../emit-finding');
const { getSubjectForIssue } = require('../subject-map');
const { parseChecklistFromBody, parseTimestamps, isAcceptanceCriteriaMet, timestampToStr, parseParentTrackerFromBody, parseReplacementReasonFromBody, parseSupersedesPRFromBody, checklistMultisetMatch, parentChildrenMatch } = require('./shared/body-parsers');
const { hasSection } = require('./shared/section-handlers');
const { getCanonicalParents, isChildCategory } = require('./shared/relationship-index');

function detectGOV027(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;

  for (const parent of getCanonicalParents(issues)) {
    const bodyCL = parseChecklistFromBody(parent.body);
    if (parent.checklist_items && parent.checklist_items.length > 0) {
      const matchErrors = checklistMultisetMatch(bodyCL, parent.checklist_items);
      for (const err of matchErrors) {
        emitFinding(findings, 'GOV027', getSubjectForIssue(subjects, parent.id), 'checklist_contradiction', {});
      }
    } else if (parent.checklist_items && parent.checklist_items.length === 0 && bodyCL.length > 0) {
      emitFinding(findings, 'GOV027', getSubjectForIssue(subjects, parent.id), 'checklist_contradiction', {});
    }
    if (parent.children) {
      const childrenErrors = parentChildrenMatch(bodyCL, parent.children);
      for (const err of childrenErrors) {
        emitFinding(findings, 'GOV027', getSubjectForIssue(subjects, parent.id), 'children_contradiction', {});
      }
    }
  }

  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;

    if (issue.reconciliation_timestamp !== undefined && issue.reconciliation_timestamp !== null) {
      const bodyTs = parseTimestamps(issue.body);
      const bodyTsStr = bodyTs.length > 0 ? timestampToStr(bodyTs[0]) : null;
      if (bodyTsStr && issue.reconciliation_timestamp !== bodyTsStr) {
        emitFinding(findings, 'GOV027', getSubjectForIssue(subjects, issue.id), 'reconciliation_contradiction', {});
      }
    }

    if (issue.acceptance_criteria_met !== undefined && issue.acceptance_criteria_met !== null && hasSection(issue.body, 'acceptance_criteria')) {
      const bodyMet = isAcceptanceCriteriaMet(issue.body);
      if (bodyMet !== null && issue.acceptance_criteria_met !== bodyMet) {
        emitFinding(findings, 'GOV027', getSubjectForIssue(subjects, issue.id), 'acceptance_contradiction', {});
      }
    }

    const bodyParent = parseParentTrackerFromBody(issue.body);
    if (bodyParent !== null && issue.parent !== undefined && String(issue.parent) !== String(bodyParent)) {
      emitFinding(findings, 'GOV027', getSubjectForIssue(subjects, issue.id), 'parent_contradiction', {});
    }

    const bodyReplacement = parseReplacementReasonFromBody(issue.body);
    const bodySupersedes = parseSupersedesPRFromBody(issue.body);
    const implPrs = issue.implementation_prs || [];
    const hasStructuredReplacement = implPrs.some(pr => pr.is_replacement);

    if (hasStructuredReplacement && !bodyReplacement) {
      emitFinding(findings, 'GOV027', getSubjectForIssue(subjects, issue.id), 'replacement_contradiction', {});
    }
    if (bodyReplacement && !hasStructuredReplacement) {
      emitFinding(findings, 'GOV027', getSubjectForIssue(subjects, issue.id), 'replacement_contradiction', {});
    }
    if (bodySupersedes !== null && bodyReplacement === null && hasStructuredReplacement) {
      emitFinding(findings, 'GOV027', getSubjectForIssue(subjects, issue.id), 'replacement_contradiction', {});
    }

    for (const pr of implPrs) {
      if (pr.is_replacement && pr.supersedes_pr !== undefined && pr.supersedes_pr !== null) {
        if (String(pr.supersedes_pr) === String(pr.number)) {
          emitFinding(findings, 'GOV027', getSubjectForIssue(subjects, issue.id), 'replacement_contradiction', {});
        }
      }
    }
  }
}

module.exports = detectGOV027;
