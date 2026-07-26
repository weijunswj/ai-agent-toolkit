'use strict';

const { emitFinding } = require('../emit-finding');
const { getSubjectForIssue } = require('../subject-map');
const { parseChecklistFromBody } = require('./shared/body-parsers');
const { getIssueById, isChildCategory } = require('./shared/relationship-index');

function detectGOV009(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    if (issue.state !== 'closed') continue;
    if (!issue.parent && issue.parent !== 0) continue;
    const parentIssue = getIssueById(issues, issue.parent);
    if (!parentIssue) continue;
    const bodyCL = parseChecklistFromBody(parentIssue.body);
    const item = bodyCL.find(ci => ci.linked_issue && String(ci.linked_issue) === String(issue.id));
    if (item && !item.checked) {
      emitFinding(findings, 'GOV009', getSubjectForIssue(subjects, issue.id), 'closed_unchecked_parent', {});
    }
  }
}

module.exports = detectGOV009;
