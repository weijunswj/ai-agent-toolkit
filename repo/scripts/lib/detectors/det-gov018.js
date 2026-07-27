'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { isNegatedContext } = require('./shared/negation-context');

function detectGOV018(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const prPat = /(?:pr|pull\s*request)\s*(?:#?\d+\s*)?(?:is\s*)?(?:merged|merge)\s+(?:=|equals|is|means|sufficient|enough|complete)/gi;
  for (const issue of issues) {
    let m;
    while ((m = prPat.exec(issue.body)) !== null) {
      if (!isNegatedContext(issue.body, m.index, m[0].length)) {
        emit(findings, 'GOV018', getSubjectForIssue(subjects, issue.id), 'pr_merge_as_completion', {});
        break;
      }
    }
  }
}

module.exports = detectGOV018;
