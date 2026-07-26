'use strict';

const { emitFinding } = require('../emit-finding');
const { getSubjectForIssue } = require('../subject-map');
const { parseChecklistFromBody, isAcceptanceCriteriaMet } = require('./shared/body-parsers');
const { getCanonicalParents, getIssueById, isChildCategory } = require('./shared/relationship-index');

function detectGOV007(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  const parents = getCanonicalParents(issues);
  for (const parent of parents) {
    const bodyCL = parseChecklistFromBody(parent.body);
    for (const item of bodyCL) {
      if (!item.linked_issue) continue;
      if (!item.checked) continue;
      const child = getIssueById(issues, item.linked_issue);
      if (!child) continue;
      if (child.state === 'open') {
        emitFinding(findings, 'GOV007', getSubjectForIssue(subjects, parent.id), 'checked_parent_open_child', {});
      }
      if (isChildCategory(child.category)) {
        const met = isAcceptanceCriteriaMet(child.body);
        if (met === false) {
          emitFinding(findings, 'GOV007', getSubjectForIssue(subjects, parent.id), 'checked_parent_incomplete_acceptance', {});
        }
      }
    }
  }
}

module.exports = detectGOV007;
