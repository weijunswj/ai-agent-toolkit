#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, '_projects', 'development', 'issue-governance', '_main', 'policy', 'issue-governance-policy.json');
const SCHEMA_PATH = path.join(REPO_ROOT, '_projects', 'development', 'issue-governance', '_main', 'schema', 'issue-snapshot.schema.json');

// --- Canonical source loaders ---

let _policy = null;
let _schema = null;
let _ajvValidate = null;

function loadPolicy() {
  if (!_policy) _policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  return _policy;
}

function loadSchema() {
  if (!_schema) _schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return _schema;
}

function getValidator() {
  if (!_ajvValidate) {
    const schema = loadSchema();
    const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
    _ajvValidate = ajv.compile(schema);
  }
  return _ajvValidate;
}

function getPolicyVersion() { return loadPolicy().policy_version; }
function getSnapshotVersion() { return loadSchema().properties.snapshot_version.const; }
function getFindingCodes() { return loadPolicy().finding_codes; }

// --- Policy-derived requirement handler registry ---
// Single source: each handler keyed by canonical policy dimension name.
// Pattern and label are runtime implementation; required sections come from policy.

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
  }
};

// --- Finding emission boundary ---

function emitFinding(findings, code, severity, issueId, message) {
  const policy = loadPolicy();
  if (!policy.finding_codes[code]) {
    throw new Error(`Undeclared finding code: ${code}`);
  }
  findings.push({ code, severity, issue_id: issueId, message: sanitize(message) });
}

// --- Schema validation via Ajv ---

function validateAgainstSchema(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['Input must be a JSON object.'] };
  }
  const validate = getValidator();
  const valid = validate(data);
  if (valid) return { ok: true, data };
  const errors = validate.errors.map(e => {
    const ptr = e.instancePath || '/';
    const kw = e.keyword;
    if (kw === 'additionalProperties') {
      return `Schema violation at ${ptr}: unknown property ${JSON.stringify(e.params.additionalProperty)}.`;
    }
    if (kw === 'required') {
      return `Schema violation at ${ptr}: missing required property ${JSON.stringify(e.params.missingProperty)}.`;
    }
    if (kw === 'type') {
      return `Schema violation at ${ptr}: expected ${e.params.type}.`;
    }
    if (kw === 'enum') {
      return `Schema violation at ${ptr}: value must be one of ${JSON.stringify(e.params.allowedValues)}.`;
    }
    if (kw === 'const') {
      return `Schema violation at ${ptr}: expected ${JSON.stringify(e.params.allowedValue)}.`;
    }
    if (kw === 'minLength') {
      return `Schema violation at ${ptr}: minimum length ${e.params.limit}.`;
    }
    if (kw === 'pattern') {
      return `Schema violation at ${ptr}: does not match pattern.`;
    }
    return `Schema violation at ${ptr}: ${kw}.`;
  });
  return { ok: false, errors };
}

// --- Body parsing ---

const VALID_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function parseChecklistFromBody(body) {
  const items = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^- \[([ xX])\]\s+(.*)/);
    if (m) {
      const checked = m[1] === 'x' || m[1] === 'X';
      const text = line.trimEnd();
      const linkMatch = m[2].match(/#(\d+)/);
      items.push({ checked, text, linked_issue: linkMatch ? +linkMatch[1] : null });
    }
  }
  return items;
}

function countTimestamps(body) {
  let count = 0;
  for (const line of body.split('\n')) {
    if (/^Last\s+reconciled:\s+/.test(line.trim())) count += 1;
  }
  return count;
}

function parseTimestamps(body) {
  const results = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const m = trimmed.match(/^Last\s+reconciled:\s+\*\*(\d{2})\s+([A-Z][a-z]+)\s+(\d{4}),\s+(\d{2}):(\d{2})\s+SGT\*\*$/);
    if (m) {
      results.push({ day: +m[1], month: m[2], year: +m[3], hour: +m[4], minute: +m[5], raw: trimmed });
    }
  }
  return results;
}

function isRealTimestamp(ts) {
  if (!VALID_MONTHS.includes(ts.month)) return false;
  if (ts.day < 1 || ts.day > 31) return false;
  if (ts.hour < 0 || ts.hour > 23) return false;
  if (ts.minute < 0 || ts.minute > 59) return false;
  if (ts.year < 2020 || ts.year > 2099) return false;
  const dim = [31,28,31,30,31,30,31,31,30,31,30,31];
  const mi = VALID_MONTHS.indexOf(ts.month);
  const max = mi === 1 && ts.year % 4 === 0 && (ts.year % 100 !== 0 || ts.year % 400 === 0) ? 29 : dim[mi];
  return ts.day <= max;
}

function isAcceptanceCriteriaMet(body) {
  let inSection = false, hasCriteria = false, allChecked = true;
  for (const line of body.split('\n')) {
    if (/^#\s+Acceptance\s+criteria/im.test(line.trim())) { inSection = true; continue; }
    if (inSection && /^#\s+/.test(line.trim())) break;
    if (inSection) {
      const m = line.match(/^- \[([ xX])\]\s+/);
      if (m) { hasCriteria = true; if (m[1] !== 'x' && m[1] !== 'X') allChecked = false; }
    }
  }
  return hasCriteria ? allChecked : null;
}

function parseImplBranchFromBody(body) {
  const m = body.match(/^Implementation\s+branch:\s+(.+)$/im);
  return m ? m[1].trim() : null;
}

function parseImplPRFromBody(body) {
  const m = body.match(/^Implementation\s+PR:\s+(.+)$/im);
  return m ? m[1].trim() : null;
}

function getIssueById(issues, id) {
  return issues.find(i => String(i.id) === String(id)) || null;
}

function isChildCategory(cat) { return ['active_multi_step_child', 'small_atomic_child'].includes(cat); }
function isImplementationCat(cat) {
  const policy = loadPolicy();
  const catDef = policy.issue_categories[cat];
  return catDef && catDef.is_implementation_work === true;
}

function hasSection(body, key) {
  const handler = HANDLER_REGISTRY[key];
  return handler ? handler.semantic(body) : false;
}

function isNegatedContext(body, matchIndex, matchLength) {
  const before = body.substring(Math.max(0, matchIndex - 150), matchIndex).toLowerCase();
  const after = body.substring(matchIndex + (matchLength || 0), matchIndex + (matchLength || 0) + 80).toLowerCase();
  const negations = ['not','never','must not','does not','do not','isn\'t','doesn\'t','don\'t','shall not'];
  for (const neg of negations) {
    const idx = before.lastIndexOf(neg);
    if (idx >= 0) {
      const between = before.substring(idx + neg.length).trim();
      if (between.length < 30) return true;
    }
    const afterIdx = after.indexOf(neg);
    if (afterIdx >= 0 && afterIdx < 30) return true;
  }
  return false;
}

// --- Checklist exact multiset match ---

function normalizeChecklistItem(item) {
  return {
    checked: item.checked,
    text: item.text.trimEnd(),
    linked_issue: item.linked_issue !== undefined && item.linked_issue !== null ? +item.linked_issue : null
  };
}

function checklistMultisetMatch(bodyItems, suppliedItems) {
  const errors = [];
  const bNorm = bodyItems.map(normalizeChecklistItem);
  const sNorm = suppliedItems.map(normalizeChecklistItem);

  if (bNorm.length !== sNorm.length) {
    errors.push(`Checklist cardinality mismatch: body has ${bNorm.length}, supplied has ${sNorm.length}.`);
    return errors;
  }

  const bKey = bNorm.map(i => `${i.checked}|${i.text}|${i.linked_issue}`);
  const sKey = sNorm.map(i => `${i.checked}|${i.text}|${i.linked_issue}`);

  const bSorted = [...bKey].sort();
  const sSorted = [...sKey].sort();

  for (let i = 0; i < bSorted.length; i++) {
    if (bSorted[i] !== sSorted[i]) {
      const bParts = bSorted[i].split('|');
      const sParts = sSorted[i].split('|');
      if (bParts[0] !== sParts[0]) {
        errors.push(`Checklist item checked-state mismatch: body has checked=${bParts[0]}, supplied has checked=${sParts[0]}.`);
      } else if (bParts[2] !== sParts[2]) {
        errors.push(`Checklist item linked_issue mismatch: body has #${bParts[2]}, supplied has #${sParts[2]}.`);
      } else {
        errors.push(`Checklist item text mismatch.`);
      }
    }
  }
  return errors;
}

// --- Parent children exact match ---

function parentChildrenMatch(bodyChecklist, suppliedChildren) {
  const errors = [];
  const bodyChildIds = bodyChecklist
    .filter(i => i.linked_issue !== null)
    .map(i => String(i.linked_issue));
  const suppliedIds = (suppliedChildren || []).map(String);

  const bodySet = new Set(bodyChildIds);
  const suppliedSet = new Set(suppliedIds);

  for (const id of bodySet) {
    if (!suppliedSet.has(id)) {
      errors.push(`Child #${id} in body checklist but absent from structured children.`);
    }
  }
  for (const id of suppliedSet) {
    if (!bodySet.has(id)) {
      errors.push(`Child #${id} in structured children but absent from body checklist.`);
    }
  }

  // Check for duplicates
  const bodyCounts = {};
  for (const id of bodyChildIds) {
    bodyCounts[id] = (bodyCounts[id] || 0) + 1;
  }
  for (const [id, count] of Object.entries(bodyCounts)) {
    if (count > 1) errors.push(`Duplicate child identity #${id} in body checklist (${count} occurrences).`);
  }

  return errors;
}

// --- Audit checks ---

function checkGovernanceMode(repo, issues, findings) {
  const policy = loadPolicy();
  if (repo.governance_mode === 'unknown') {
    emitFinding(findings, 'GOV021', 'warning', null, 'Governance mode is "unknown". Repository must select a governance mode.');
    return;
  }
  if (repo.governance_mode !== 'toolkit_governed') return;

  const parents = issues.filter(i => i.category === 'canonical_parent_tracker');
  if (parents.length === 0) {
    emitFinding(findings, 'GOV001', 'error', null, 'Toolkit-governed repository has no declared canonical parent tracker.');
  } else if (parents.length > 1) {
    emitFinding(findings, 'GOV002', 'error', null, `Toolkit-governed repository has ${parents.length} canonical parent trackers.`);
  }

  if (repo.canonical_parent_tracker !== undefined) {
    const declared = getIssueById(issues, repo.canonical_parent_tracker);
    if (!declared) {
      emitFinding(findings, 'GOV026', 'error', null, `Declared canonical_parent_tracker #${repo.canonical_parent_tracker} not found.`);
    } else if (declared.category !== 'canonical_parent_tracker') {
      emitFinding(findings, 'GOV026', 'error', null, `Declared canonical_parent_tracker #${repo.canonical_parent_tracker} is not categorised as canonical_parent_tracker.`);
    }
  }
}

function checkParentChildLinks(repo, issues, findings) {
  const parents = issues.filter(i => i.category === 'canonical_parent_tracker');
  const children = issues.filter(i => isChildCategory(i.category) && i.category !== 'recurring_evidence_log');

  for (const parent of parents) {
    const bodyCL = parseChecklistFromBody(parent.body);
    for (const item of bodyCL) {
      if (!item.linked_issue) {
        emitFinding(findings, 'GOV003', 'warning', parent.id, `Parent #${parent.id} checklist entry has no linked child.`);
      }
    }

    // Exact multiset match if structured checklist_items supplied
    if (parent.checklist_items && parent.checklist_items.length > 0) {
      const matchErrors = checklistMultisetMatch(bodyCL, parent.checklist_items);
      for (const err of matchErrors) {
        emitFinding(findings, 'GOV027', 'error', parent.id, `Parent #${parent.id}: ${err}`);
      }
    }

    // Parent children exact match
    if (parent.children) {
      const childrenErrors = parentChildrenMatch(bodyCL, parent.children);
      for (const err of childrenErrors) {
        emitFinding(findings, 'GOV027', 'error', parent.id, `Parent #${parent.id}: ${err}`);
      }
    }
  }

  for (const child of children) {
    if (!child.parent && child.parent !== 0) {
      emitFinding(findings, 'GOV004', 'error', child.id, `Child #${child.id} has no parent link.`);
      continue;
    }
    const parentIssue = getIssueById(issues, child.parent);
    if (!parentIssue) {
      emitFinding(findings, 'GOV005', 'error', child.id, `Child #${child.id} parent #${child.parent} not found.`);
      continue;
    }
    if (parentIssue.category !== 'canonical_parent_tracker') {
      emitFinding(findings, 'GOV026', 'error', child.id, `Child #${child.id} parent #${child.parent} is not a canonical_parent_tracker.`);
      continue;
    }
    const bodyCL = parseChecklistFromBody(parentIssue.body);
    const inBody = bodyCL.some(item => item.linked_issue && String(item.linked_issue) === String(child.id));
    if (!inBody) {
      emitFinding(findings, 'GOV005', 'error', child.id, `Child #${child.id} absent from parent #${child.parent} body checklist.`);
    }
    const parentChildren = parentIssue.children || [];
    if (!parentChildren.some(c => String(c) === String(child.id))) {
      emitFinding(findings, 'GOV006', 'error', child.id, `Parent #${child.parent} children array does not list child #${child.id}.`);
    }
  }
}

function checkCompletionConsistency(issues, findings) {
  const parents = issues.filter(i => i.category === 'canonical_parent_tracker');
  for (const parent of parents) {
    const bodyCL = parseChecklistFromBody(parent.body);
    for (const item of bodyCL) {
      if (!item.linked_issue) continue;
      const child = getIssueById(issues, item.linked_issue);
      if (!child) continue;
      if (item.checked) {
        if (child.state === 'open') {
          emitFinding(findings, 'GOV007', 'error', parent.id, `Parent #${parent.id} item checked but child #${child.id} is still open.`);
        }
        if (isChildCategory(child.category)) {
          const met = isAcceptanceCriteriaMet(child.body);
          if (met === false) {
            emitFinding(findings, 'GOV007', 'error', parent.id, `Parent #${parent.id} item checked but child #${child.id} has incomplete acceptance.`);
          }
        }
      }
    }
  }

  // GOV008: closed children with unchecked acceptance criteria
  const closedChildren = issues.filter(i => i.state === 'closed' && isChildCategory(i.category));
  for (const child of closedChildren) {
    if (!hasSection(child.body, 'acceptance_criteria')) continue;
    const met = isAcceptanceCriteriaMet(child.body);
    if (met === false) {
      emitFinding(findings, 'GOV008', 'error', child.id, `Closed child #${child.id} has unchecked acceptance criteria.`);
    }
  }

  // GOV009: closed children with unchecked parent item
  for (const child of issues.filter(i => isChildCategory(i.category) && i.state === 'closed')) {
    if (!child.parent && child.parent !== 0) continue;
    const parentIssue = getIssueById(issues, child.parent);
    if (!parentIssue) continue;
    const bodyCL = parseChecklistFromBody(parentIssue.body);
    const item = bodyCL.find(ci => ci.linked_issue && String(ci.linked_issue) === String(child.id));
    if (item && !item.checked) {
      emitFinding(findings, 'GOV009', 'warning', child.id, `Closed child #${child.id} has unchecked parent item in #${parentIssue.id}.`);
    }
  }
}

function checkRequiredSections(issue, findings) {
  const body = issue.body;
  const cat = issue.category;
  const policy = loadPolicy();
  const catDef = policy.issue_categories[cat];
  if (!catDef || !catDef.required_sections) return;

  // Specific semantic checks with dedicated finding codes
  if (!hasSection(body, 'current_status')) {
    emitFinding(findings, 'GOV010', 'error', issue.id, `Issue #${issue.id}: missing Current status section.`);
  }

  // Reconciliation timestamp count and validity
  const tsCount = countTimestamps(body);
  if (tsCount === 0) {
    emitFinding(findings, 'GOV011', 'error', issue.id, `Issue #${issue.id}: missing reconciliation timestamp.`);
  } else if (tsCount > 1) {
    emitFinding(findings, 'GOV012', 'error', issue.id, `Issue #${issue.id}: multiple reconciliation timestamps (${tsCount}).`);
  }

  if (tsCount > 0) {
    const timestamps = parseTimestamps(body);
    if (timestamps.length === 0) {
      emitFinding(findings, 'GOV013', 'warning', issue.id, `Issue #${issue.id}: timestamp present but malformed. Expected: Last reconciled: **DD Month YYYY, HH:mm SGT**`);
    }
    for (const ts of timestamps) {
      if (!isRealTimestamp(ts)) {
        emitFinding(findings, 'GOV013', 'warning', issue.id, `Issue #${issue.id}: invalid date/time in timestamp.`);
      }
    }
  }

  if (!hasSection(body, 'why_this_issue_exists')) {
    emitFinding(findings, 'GOV014', 'error', issue.id, `Issue #${issue.id}: missing "Why this issue exists" section.`);
  }

  // Acceptance criteria section check
  if (!hasSection(body, 'acceptance_criteria')) {
    emitFinding(findings, 'GOV016', 'error', issue.id, `Issue #${issue.id}: missing Acceptance criteria section.`);
  }

  // GOV015: check all policy-required dimensions except those with dedicated codes
  const dedicatedKeys = new Set(['current_status', 'reconciliation_timestamp', 'why_this_issue_exists', 'acceptance_criteria']);
  for (const secKey of catDef.required_sections) {
    if (dedicatedKeys.has(secKey)) continue;
    const handler = HANDLER_REGISTRY[secKey];
    if (!handler) continue;
    if (!handler.semantic(body)) {
      emitFinding(findings, 'GOV015', 'error', issue.id, `Issue #${issue.id}: missing required dimension "${handler.label}".`);
    }
  }

  // Structured field consistency
  if (issue.reconciliation_timestamp !== undefined && issue.reconciliation_timestamp !== null) {
    const bodyTs = parseTimestamps(body);
    const bodyTsStr = bodyTs.length > 0 ? `${String(bodyTs[0].day).padStart(2,'0')} ${bodyTs[0].month} ${bodyTs[0].year}, ${String(bodyTs[0].hour).padStart(2,'0')}:${String(bodyTs[0].minute).padStart(2,'0')} SGT` : null;
    if (bodyTsStr && issue.reconciliation_timestamp !== bodyTsStr) {
      emitFinding(findings, 'GOV027', 'error', issue.id, `Issue #${issue.id}: structured reconciliation_timestamp contradicts body.`);
    }
  }

  if (issue.acceptance_criteria_met !== undefined && issue.acceptance_criteria_met !== null && hasSection(body, 'acceptance_criteria')) {
    const bodyMet = isAcceptanceCriteriaMet(body);
    if (bodyMet !== null && issue.acceptance_criteria_met !== bodyMet) {
      emitFinding(findings, 'GOV027', 'error', issue.id, `Issue #${issue.id}: structured acceptance_criteria_met contradicts body.`);
    }
  }
}

function checkSupersededIssues(issues, findings) {
  for (const issue of issues) {
    if (issue.category === 'superseded_duplicate_not_planned' && !issue.reason && !issue.successor) {
      emitFinding(findings, 'GOV017', 'warning', issue.id, `Issue #${issue.id} is superseded/duplicate/not-planned but has no reason or successor.`);
    }
  }
}

function checkAntiPatterns(issues, findings) {
  for (const issue of issues) {
    const body = issue.body;
    // GOV018: PR merge treated as completion
    // Matches: "PR merged = task complete", "PR merge is sufficient", "pull request merged means done"
    // Does NOT match negations: "PR merge is not task completion"
    const prPat = /(?:pr|pull\s*request)\s*(?:#?\d+\s*)?(?:is\s*)?(?:merged|merge)\s+(?:=|equals|is|means|sufficient|enough|complete)/gi;
    let m;
    while ((m = prPat.exec(body)) !== null) {
      if (!isNegatedContext(body, m.index, m[0].length)) {
        emitFinding(findings, 'GOV018', 'error', issue.id, `Issue #${issue.id} body treats PR merge as sufficient completion.`);
        break;
      }
    }
    // GOV019: implementer self-acceptance claim
    // Matches: "implementer has independently verified acceptance", "codex independently confirmed"
    // The "independently" keyword is key; noun after verb is optional
    const implPat = /(?:implementer|coding\s*agent|codex|claude|copilot)\s+(?:has\s+)?independently\s+(?:verified|confirmed|accepted|certified|approved)(?:\s+(?:independent\s+)?(?:review|acceptance|completion))?/gi;
    while ((m = implPat.exec(body)) !== null) {
      if (!isNegatedContext(body, m.index, m[0].length)) {
        emitFinding(findings, 'GOV019', 'error', issue.id, `Issue #${issue.id} body contains implementer self-acceptance claim.`);
        break;
      }
    }
  }
}

function checkImplementationPR(issues, findings) {
  for (const issue of issues) {
    if (!isImplementationCat(issue.category)) continue;
    const implPrs = issue.implementation_prs || [];
    const activePrs = implPrs.filter(pr => pr.state === 'open');

    // GOV022: multiple active PRs
    if (activePrs.length > 1) {
      emitFinding(findings, 'GOV022', 'error', issue.id, `Issue #${issue.id} has ${activePrs.length} active implementation PRs.`);
    }

    // GOV023: branch/body PR metadata agreement
    const bodyBranch = parseImplBranchFromBody(issue.body);
    const bodyPR = parseImplPRFromBody(issue.body);

    if (issue.implementation_branch !== undefined && issue.implementation_branch !== null) {
      if (bodyBranch && issue.implementation_branch !== bodyBranch) {
        emitFinding(findings, 'GOV023', 'error', issue.id, `Issue #${issue.id}: structured implementation_branch "${issue.implementation_branch}" disagrees with body "${bodyBranch}".`);
      }
    }

    if (activePrs.length === 1) {
      const soleOpenPR = activePrs[0];
      if (bodyPR && bodyPR !== 'Not opened') {
        const bodyPRNum = bodyPR.replace(/[^0-9]/g, '');
        if (bodyPRNum && String(soleOpenPR.number) !== bodyPRNum) {
          emitFinding(findings, 'GOV023', 'error', issue.id, `Issue #${issue.id}: sole open PR #${soleOpenPR.number} disagrees with body PR ${bodyPR}.`);
        }
      }
      if (bodyPR === 'Not opened') {
        emitFinding(findings, 'GOV023', 'error', issue.id, `Issue #${issue.id}: body says "Not opened" but open PR #${soleOpenPR.number} exists.`);
      }
    }

    if (bodyPR && bodyPR !== 'Not opened' && activePrs.length === 0) {
      const bodyPRNum = bodyPR.replace(/[^0-9]/g, '');
      const hasMatchingClosed = implPrs.some(pr => String(pr.number) === bodyPRNum && pr.state !== 'open');
      if (!hasMatchingClosed) {
        emitFinding(findings, 'GOV023', 'error', issue.id, `Issue #${issue.id}: body identifies PR ${bodyPR} but no matching structured PR exists.`);
      }
    }

    // GOV024: replacement PR requirements
    for (const rep of implPrs.filter(pr => pr.is_replacement)) {
      if (!rep.replacement_reason) {
        emitFinding(findings, 'GOV024', 'error', issue.id, `Issue #${issue.id} replacement PR #${rep.number} has no recorded reason.`);
      }
      if (rep.supersedes_pr === undefined || rep.supersedes_pr === null) {
        emitFinding(findings, 'GOV024', 'error', issue.id, `Issue #${issue.id} replacement PR #${rep.number} has no supersedes_pr.`);
      }
    }
  }
}

function checkDuplicateIds(issues, findings) {
  const seen = new Map();
  for (const issue of issues) {
    const norm = String(issue.id);
    if (seen.has(norm)) {
      emitFinding(findings, 'GOV025', 'error', issue.id, `Duplicate issue identity: ${JSON.stringify(issue.id)} and ${JSON.stringify(seen.get(norm))} resolve to the same identity.`);
    }
    seen.set(norm, issue.id);
  }
}

function checkPolicyDrift(repo, findings) {
  const pv = getPolicyVersion();
  if (repo.policy_version && repo.policy_version !== pv) {
    emitFinding(findings, 'GOV020', 'warning', null, `Policy version drift: snapshot declares ${repo.policy_version}, canonical is ${pv}.`);
  }
}

// --- Output formatting ---

function sanitize(text) {
  if (!text) return '';
  return text
    .replace(/[A-Za-z]:\\[^\s"'`]{5,}/g, '<path>')
    .replace(/\/(?:home|Users|var|etc|root|tmp)\/[^\s"'`]{5,}/g, '<path>')
    .replace(/(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,})/g, '<redacted>')
    .replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function auditSnapshot(snapshot) {
  const schemaResult = validateAgainstSchema(snapshot);
  if (!schemaResult.ok) return { findings: [], schemaErrors: schemaResult.errors };

  const repo = snapshot.repository;
  const issues = deepClone(snapshot.issues);
  const findings = [];

  checkGovernanceMode(repo, issues, findings);

  if (repo.governance_mode === 'toolkit_governed') {
    // GOV025: duplicate IDs (semantic, not schema-level)
    checkDuplicateIds(issues, findings);

    checkParentChildLinks(repo, issues, findings);
    checkCompletionConsistency(issues, findings);

    // Required sections for ALL child categories (including closed children)
    for (const issue of issues) {
      if (isChildCategory(issue.category)) {
        checkRequiredSections(issue, findings);
      }
    }

    checkSupersededIssues(issues, findings);
    checkAntiPatterns(issues, findings);
    checkImplementationPR(issues, findings);
  }

  checkPolicyDrift(repo, findings);

  findings.sort((a, b) => {
    if (a.code < b.code) return -1; if (a.code > b.code) return 1;
    const aId = a.issue_id === null ? '' : String(a.issue_id);
    const bId = b.issue_id === null ? '' : String(b.issue_id);
    if (aId < bId) return -1; if (aId > bId) return 1;
    if (a.message < b.message) return -1; if (a.message > b.message) return 1;
    return 0;
  });

  return { findings, schemaErrors: [] };
}

function formatHuman(findings, repo, schemaErrors) {
  const lines = [];
  lines.push('Issue Governance Advisory Audit');
  lines.push('================================');
  lines.push(`Policy version: ${getPolicyVersion()}`);
  lines.push(`Governance mode: ${repo.governance_mode}`);
  if (repo.fixture_id) lines.push(`Repository fixture: ${repo.fixture_id}`);
  if (repo.policy_version) lines.push(`Snapshot policy version: ${repo.policy_version}`);
  lines.push('');

  if (schemaErrors && schemaErrors.length > 0) {
    lines.push(`${schemaErrors.length} schema error(s):`);
    lines.push('');
    for (const err of schemaErrors) lines.push(`  SCHEMA: ${sanitize(err)}`);
    return lines.join('\n');
  }
  if (findings.length === 0) { lines.push('No violations found.'); return lines.join('\n'); }
  lines.push(`${findings.length} finding(s):`);
  lines.push('');
  for (const f of findings) {
    const ref = f.issue_id !== null ? ` [#${f.issue_id}]` : '';
    lines.push(`  ${f.code} (${f.severity})${ref}: ${f.message}`);
  }
  return lines.join('\n');
}

function formatJson(findings, repo, schemaErrors) {
  return JSON.stringify({
    audit_version: getPolicyVersion(),
    governance_mode: repo.governance_mode,
    policy_version: repo.policy_version || null,
    schema_errors: (schemaErrors || []).map(e => sanitize(e)),
    finding_count: findings.length,
    findings: findings.map(f => ({ code: f.code, severity: f.severity, issue_id: f.issue_id, message: f.message }))
  }, null, 2);
}

function parseArgs(argv) {
  const args = { input: null, format: 'human' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--input' && argv[i + 1]) { args.input = argv[i + 1]; i += 1; }
    else if (argv[i] === '--format' && argv[i + 1]) { args.format = argv[i + 1]; i += 1; }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) { console.error('Usage: audit-issue-governance.cjs --input <snapshot.json> [--format human|json]'); process.exit(2); }

  let raw;
  try { raw = fs.readFileSync(path.resolve(args.input), 'utf8'); }
  catch { console.error('Input error: Cannot read input file.'); process.exit(2); }

  let data;
  try { data = JSON.parse(raw); }
  catch { console.error('Input error: Invalid JSON.'); process.exit(2); }

  let result;
  try { result = auditSnapshot(data); }
  catch { console.error('Execution error.'); process.exit(2); }

  const repo = data.repository || { governance_mode: 'unknown' };
  const output = args.format === 'json' ? formatJson(result.findings, repo, result.schemaErrors) : formatHuman(result.findings, repo, result.schemaErrors);
  process.stdout.write(output + '\n');

  if (result.schemaErrors && result.schemaErrors.length > 0) process.exit(2);
  if (result.findings.length > 0) process.exit(1);
  process.exit(0);
}

if (require.main === module) { main(); }

module.exports = {
  auditSnapshot, validateAgainstSchema, formatHuman, formatJson,
  getFindingCodes, getPolicyVersion, getSnapshotVersion, loadPolicy, loadSchema,
  isNegatedContext, isRealTimestamp, parseTimestamps, parseChecklistFromBody,
  parseImplBranchFromBody, parseImplPRFromBody,
  sanitize, emitFinding, HANDLER_REGISTRY, POLICY_PATH, SCHEMA_PATH,
  normalizeChecklistItem, checklistMultisetMatch, parentChildrenMatch
};
