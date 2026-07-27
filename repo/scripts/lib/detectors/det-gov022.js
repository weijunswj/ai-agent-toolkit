'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { loadPolicy } = require('../emit-finding');

function detectGOV022(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const policy = loadPolicy();
  for (const issue of issues) {
    const catDef = policy.issue_categories[issue.category];
    if (!catDef || !catDef.is_implementation_work) continue;
    const implPrs = issue.implementation_prs || [];
    const activePrs = implPrs.filter(pr => pr.state === 'open' && pr.merged === false);
    if (activePrs.length > 1) {
      emit(findings, 'GOV022', getSubjectForIssue(subjects, issue.id), 'multiple_active_prs', { count: activePrs.length });
    }
  }
}

module.exports = detectGOV022;
