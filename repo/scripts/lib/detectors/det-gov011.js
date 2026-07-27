'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { countTimestamps } = require('./shared/body-parsers');
const { isChildCategory } = require('./shared/relationship-index');

function detectGOV011(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    if (countTimestamps(issue.body) === 0) {
      emit(findings, 'GOV011', getSubjectForIssue(subjects, issue.id), 'missing_timestamp', {});
    }
  }
}

module.exports = detectGOV011;
