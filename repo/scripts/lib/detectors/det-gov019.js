'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { isNegatedContext } = require('./shared/negation-context');

function detectGOV019(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const implPat = /(?:implementer|coding\s*agent|codex|claude|copilot)\s+(?:has\s+)?independently\s+(?:verified|confirmed|accepted|certified|approved)(?:\s+(?:independent\s+)?(?:review|acceptance|completion))?/gi;
  for (const issue of issues) {
    let m;
    while ((m = implPat.exec(issue.body)) !== null) {
      if (!isNegatedContext(issue.body, m.index, m[0].length)) {
        emit(findings, 'GOV019', getSubjectForIssue(subjects, issue.id), 'implementer_self_acceptance', {});
        break;
      }
    }
  }
}

module.exports = detectGOV019;
