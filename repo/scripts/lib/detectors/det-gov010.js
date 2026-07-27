'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { hasSection } = require('./shared/section-handlers');
const { isChildCategory } = require('./shared/relationship-index');

function detectGOV010(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    if (!hasSection(issue.body, 'current_status')) {
      emit(findings, 'GOV010', getSubjectForIssue(subjects, issue.id), 'missing_current_status', {});
    }
  }
}

module.exports = detectGOV010;
