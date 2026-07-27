'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { parseChecklistFromBody } = require('./shared/body-parsers');
const { getChildren, getIssueById } = require('./shared/relationship-index');

function detectGOV005(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const children = getChildren(issues);
  for (const child of children) {
    if (!child.parent && child.parent !== 0) continue;
    const parentIssue = getIssueById(issues, child.parent);
    if (!parentIssue) {
      emit(findings, 'GOV005', getSubjectForIssue(subjects, child.id), 'parent_not_found', {});
      continue;
    }
    const bodyCL = parseChecklistFromBody(parentIssue.body);
    const inBody = bodyCL.some(item => item.linked_issue && String(item.linked_issue) === String(child.id));
    if (!inBody) {
      emit(findings, 'GOV005', getSubjectForIssue(subjects, child.id), 'child_absent_from_parent_checklist', {});
    }
  }
}

module.exports = detectGOV005;
