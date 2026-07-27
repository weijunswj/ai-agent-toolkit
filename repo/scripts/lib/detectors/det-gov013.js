'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { countTimestamps, parseTimestamps, isRealTimestamp } = require('./shared/body-parsers');
const { isChildCategory } = require('./shared/relationship-index');

function detectGOV013(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    const cnt = countTimestamps(issue.body);
    if (cnt === 0) continue;
    const timestamps = parseTimestamps(issue.body);
    if (timestamps.length === 0) {
      emit(findings, 'GOV013', getSubjectForIssue(subjects, issue.id), 'malformed_timestamp', {});
      continue;
    }
    for (const ts of timestamps) {
      if (!isRealTimestamp(ts)) {
        emit(findings, 'GOV013', getSubjectForIssue(subjects, issue.id), 'impossible_date', {});
        break;
      }
    }
  }
}

module.exports = detectGOV013;
