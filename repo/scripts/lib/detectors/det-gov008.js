'use strict';

const { emitFinding } = require('../emit-finding');
const { getSubjectForIssue } = require('../subject-map');
const { isAcceptanceCriteriaMet } = require('./shared/body-parsers');
const { hasSection } = require('./shared/section-handlers');
const { isChildCategory } = require('./shared/relationship-index');

function detectGOV008(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (issue.state !== 'closed') continue;
    if (!isChildCategory(issue.category)) continue;
    if (!hasSection(issue.body, 'acceptance_criteria')) continue;
    const met = isAcceptanceCriteriaMet(issue.body);
    if (met === false) {
      emitFinding(findings, 'GOV008', getSubjectForIssue(subjects, issue.id), 'closed_incomplete_acceptance', {});
    }
  }
}

module.exports = detectGOV008;
