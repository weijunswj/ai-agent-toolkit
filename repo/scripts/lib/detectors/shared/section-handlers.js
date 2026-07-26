'use strict';

const HANDLER_REGISTRY = {
  current_status: {
    pattern: /^#\s+Current\s+status/im,
    label: 'Current status',
    semantic: function(body) { return this.pattern.test(body); }
  },
  reconciliation_timestamp: {
    pattern: /^Last\s+reconciled:\s+/im,
    label: 'Reconciliation timestamp',
    semantic: function(body) { return this.pattern.test(body); }
  },
  parent_tracker: {
    pattern: /^Parent\s+tracker:\s*#/im,
    label: 'Parent tracker line',
    semantic: function(body) { return this.pattern.test(body); }
  },
  implementation_branch: {
    pattern: /^Implementation\s+branch:\s+/im,
    label: 'Implementation branch line',
    semantic: function(body) { return this.pattern.test(body); }
  },
  implementation_pr: {
    pattern: /^Implementation\s+PR:\s+/im,
    label: 'Implementation PR line',
    semantic: function(body) { return this.pattern.test(body); }
  },
  dependencies: {
    pattern: /^Dep(?:endencies|ends)\s+on:/im,
    label: 'Dependencies',
    semantic: function(body) { return this.pattern.test(body); }
  },
  blockers: {
    pattern: /^#\s+(?:Current\s+)?[Bb]lockers(?:\s+and\s+findings)?/im,
    label: 'Blockers',
    semantic: function(body) { return this.pattern.test(body); }
  },
  related_work: {
    pattern: /^Related:/im,
    label: 'Related work',
    semantic: function(body) { return this.pattern.test(body); }
  },
  why_this_issue_exists: {
    pattern: /^#\s+Why\s+this\s+issue\s+exists/im,
    label: 'Why this issue exists',
    semantic: function(body) { return this.pattern.test(body); }
  },
  goal_and_scope: {
    pattern: /^#\s+Goal\s+and\s+scope/im,
    label: 'Goal and scope',
    semantic: function(body) { return this.pattern.test(body); }
  },
  completed_work: {
    pattern: /^#\s+Completed\s+work/im,
    label: 'Completed work',
    semantic: function(body) { return this.pattern.test(body); }
  },
  current_blockers_and_findings: {
    pattern: /^#\s+(?:Current\s+)?[Bb]lockers(?:\s+and\s+findings)?/im,
    label: 'Current blockers and findings',
    semantic: function(body) { return this.pattern.test(body); }
  },
  remaining_steps: {
    pattern: /^#\s+Remaining\s+(?:steps|work)/im,
    label: 'Remaining steps',
    semantic: function(body) { return this.pattern.test(body); }
  },
  acceptance_criteria: {
    pattern: /^#\s+Acceptance\s+criteria/im,
    label: 'Acceptance criteria',
    semantic: function(body) { return this.pattern.test(body); }
  },
  linked_prs_and_followups: {
    pattern: /^#\s+Linked\s+PRs(?:\s+and\s+follow-ups)?/im,
    label: 'Linked PRs and follow-ups',
    semantic: function(body) { return this.pattern.test(body); }
  },
  linked_prs_or_followups: {
    pattern: /^#\s+Linked\s+PRs(?:\s+or\s+follow-ups)?/im,
    label: 'Linked PRs or follow-ups',
    semantic: function(body) { return this.pattern.test(body); }
  },
  decisions_and_durable_evidence: {
    pattern: /^#\s+Decisions\s+and\s+durable\s+evidence/im,
    label: 'Decisions and durable evidence',
    semantic: function(body) { return this.pattern.test(body); }
  },
  safety_and_authority: {
    pattern: /^#\s+Safety\s+and\s+authority/im,
    label: 'Safety and authority',
    semantic: function(body) { return this.pattern.test(body); }
  },
  parent_link: {
    pattern: /^Parent\s+tracker:\s*#/im,
    label: 'Parent link',
    semantic: function(body) { return this.pattern.test(body); }
  },
  remaining_work: {
    pattern: /^#\s+Remaining\s+(?:steps|work)/im,
    label: 'Remaining work',
    semantic: function(body) { return this.pattern.test(body); }
  }
};

function hasSection(body, key) {
  const handler = HANDLER_REGISTRY[key];
  return handler ? handler.semantic(body) : false;
}

module.exports = { HANDLER_REGISTRY, hasSection };
