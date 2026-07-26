'use strict';

const { emitFinding } = require('../emit-finding');
const { getSubjectForIssue } = require('../subject-map');

function detectGOV017(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (issue.category === 'superseded_duplicate_not_planned' && !issue.reason && !issue.successor) {
      emitFinding(findings, 'GOV017', getSubjectForIssue(subjects, issue.id), 'no_reason_or_successor', {});
    }
  }
}

module.exports = detectGOV017;
