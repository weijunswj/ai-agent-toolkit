'use strict';

const { emitFinding } = require('../emit-finding');
const { getSubjectForIssue } = require('../subject-map');
const { getChildren } = require('./shared/relationship-index');

function detectGOV004(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  const children = getChildren(issues);
  for (const child of children) {
    if (!child.parent && child.parent !== 0) {
      emitFinding(findings, 'GOV004', getSubjectForIssue(subjects, child.id), 'no_parent_link', {});
    }
  }
}

module.exports = detectGOV004;
