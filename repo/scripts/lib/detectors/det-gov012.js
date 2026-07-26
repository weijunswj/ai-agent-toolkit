'use strict';

const { emitFinding } = require('../emit-finding');
const { getSubjectForIssue } = require('../subject-map');
const { countTimestamps } = require('./shared/body-parsers');
const { isChildCategory } = require('./shared/relationship-index');

function detectGOV012(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    const cnt = countTimestamps(issue.body);
    if (cnt > 1) {
      emitFinding(findings, 'GOV012', getSubjectForIssue(subjects, issue.id), 'multiple_timestamps', { count: cnt });
    }
  }
}

module.exports = detectGOV012;
