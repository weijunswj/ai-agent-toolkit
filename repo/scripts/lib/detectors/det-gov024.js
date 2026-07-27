'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { loadPolicy } = require('../emit-finding');

function detectGOV024(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const policy = loadPolicy();
  for (const issue of issues) {
    const catDef = policy.issue_categories[issue.category];
    if (!catDef || !catDef.is_implementation_work) continue;
    const implPrs = issue.implementation_prs || [];
    for (const rep of implPrs.filter(pr => pr.is_replacement)) {
      if (!rep.replacement_reason) {
        emit(findings, 'GOV024', getSubjectForIssue(subjects, issue.id), 'no_replacement_reason', {});
      }
      if (rep.supersedes_pr === undefined || rep.supersedes_pr === null) {
        emit(findings, 'GOV024', getSubjectForIssue(subjects, issue.id), 'no_supersedes_pr', {});
      }
    }
  }
}

module.exports = detectGOV024;
