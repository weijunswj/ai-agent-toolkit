'use strict';

const { emitFinding } = require('../emit-finding');
const { getSubjectForIssue } = require('../subject-map');
const { hasSection } = require('./shared/section-handlers');
const { isChildCategory } = require('./shared/relationship-index');

function detectGOV014(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    if (!hasSection(issue.body, 'why_this_issue_exists')) {
      emitFinding(findings, 'GOV014', getSubjectForIssue(subjects, issue.id), 'missing_why_section', {});
    }
  }
}

module.exports = detectGOV014;
