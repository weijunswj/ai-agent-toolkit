'use strict';

const { getSubjectForIssue } = require('../subject-map');

function detectGOV017(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (issue.category === 'superseded_duplicate_not_planned' && !issue.reason && !issue.successor) {
      emit(findings, 'GOV017', getSubjectForIssue(subjects, issue.id), 'no_reason_or_successor', {});
    }
  }
}

module.exports = detectGOV017;
