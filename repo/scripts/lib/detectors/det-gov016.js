'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { hasSection } = require('./shared/section-handlers');
const { isChildCategory } = require('./shared/relationship-index');

function detectGOV016(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    if (!hasSection(issue.body, 'acceptance_criteria')) {
      emit(findings, 'GOV016', getSubjectForIssue(subjects, issue.id), 'missing_acceptance_criteria', {});
    }
  }
}

module.exports = detectGOV016;
