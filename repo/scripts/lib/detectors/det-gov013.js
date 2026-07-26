'use strict';

const { emitFinding } = require('../emit-finding');
const { getSubjectForIssue } = require('../subject-map');
const { countTimestamps, parseTimestamps, isRealTimestamp } = require('./shared/body-parsers');
const { isChildCategory } = require('./shared/relationship-index');

function detectGOV013(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    const cnt = countTimestamps(issue.body);
    if (cnt === 0) continue;
    const timestamps = parseTimestamps(issue.body);
    if (timestamps.length === 0) {
      emitFinding(findings, 'GOV013', getSubjectForIssue(subjects, issue.id), 'malformed_timestamp', {});
      continue;
    }
    for (const ts of timestamps) {
      if (!isRealTimestamp(ts)) {
        emitFinding(findings, 'GOV013', getSubjectForIssue(subjects, issue.id), 'impossible_date', {});
        break;
      }
    }
  }
}

module.exports = detectGOV013;
