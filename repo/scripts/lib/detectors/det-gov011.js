'use strict';

const { emitFinding } = require('../emit-finding');
const { getSubjectForIssue } = require('../subject-map');
const { countTimestamps } = require('./shared/body-parsers');
const { isChildCategory } = require('./shared/relationship-index');

function detectGOV011(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    if (countTimestamps(issue.body) === 0) {
      emitFinding(findings, 'GOV011', getSubjectForIssue(subjects, issue.id), 'missing_timestamp', {});
    }
  }
}

module.exports = detectGOV011;
