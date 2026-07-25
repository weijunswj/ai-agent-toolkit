#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, '_projects', 'development', 'issue-governance', '_main', 'policy', 'issue-governance-policy.json');
const SCHEMA_PATH = path.join(REPO_ROOT, '_projects', 'development', 'issue-governance', '_main', 'schema', 'issue-snapshot.schema.json');

const VALID_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const SECTION_HEADINGS = {
  current_status: /^#\s+Current\s+status/im,
  parent_tracker: /^Parent\s+tracker:\s*#/im,
  implementation_pr: /^Implementation\s+PR:/im,
  dependencies: /^Dep(?:endencies|ends)\s+on:/im,
  related_work: /^Related:/im,
  why_this_issue_exists: /^#\s+Why\s+this\s+issue\s+exists/im,
  goal_and_scope: /^#\s+Goal\s+and\s+scope/im,
  completed_work: /^#\s+Completed\s+work/im,
  current_blockers_and_findings: /^#\s+(?:Current\s+)?[Bb]lockers(?:\s+and\s+findings)?/im,
  remaining_steps: /^#\s+Remaining\s+(?:steps|work)/im,
  acceptance_criteria: /^#\s+Acceptance\s+criteria/im,
  linked_prs_and_followups: /^#\s+Linked\s+PRs(?:\s+and\s+follow-ups)?/im,
  linked_prs_or_followups: /^#\s+Linked\s+PRs(?:\s+or\s+follow-ups)?/im,
  decisions_and_durable_evidence: /^#\s+Decisions\s+and\s+durable\s+evidence/im,
  safety_and_authority: /^#\s+Safety\s+and\s+authority/im,
  blockers: /^#\s+[Bb]lockers/im,
  parent_link: /^Parent\s+tracker:\s*#/im
};

const SECTION_LABELS = {
  current_status: 'Current status',
  parent_tracker: 'Parent tracker line (Parent tracker: #...)',
  implementation_pr: 'Implementation PR line (Implementation PR: #...)',
  dependencies: 'Dependencies line (Depends on: ...)',
  related_work: 'Related work line (Related: ...)',
  why_this_issue_exists: 'Why this issue exists',
  goal_and_scope: 'Goal and scope',
  completed_work: 'Completed work',
  current_blockers_and_findings: 'Current blockers and findings',
  remaining_steps: 'Remaining steps',
  acceptance_criteria: 'Acceptance criteria',
  linked_prs_and_followups: 'Linked PRs and follow-ups',
  linked_prs_or_followups: 'Linked PRs or follow-ups',
  decisions_and_durable_evidence: 'Decisions and durable evidence',
  safety_and_authority: 'Safety and authority',
  blockers: 'Blockers',
  parent_link: 'Parent link (Parent tracker: #...)'
};

let _policy = null;
let _schema = null;
function loadPolicy() {
  if (!_policy) _policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  return _policy;
}
function loadSchema() {
  if (!_schema) _schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return _schema;
}
function getPolicyVersion() { return loadPolicy().policy_version; }
function getSnapshotVersion() { return loadSchema().properties.snapshot_version.const; }
function getFindingCodes() { return loadPolicy().finding_codes; }

// --- Full schema validation ---

function validateAgainstSchema(data) {
  const errors = [];
  const schema = loadSchema();

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['Input must be a JSON object.'] };
  }

  const allowedTop = new Set(Object.keys(schema.properties));
  for (const key of Object.keys(data)) {
    if (!allowedTop.has(key)) errors.push(`Unknown top-level property: ${JSON.stringify(key)}.`);
  }
  for (const req of schema.required) {
    if (!(req in data)) errors.push(`Missing required top-level property: ${JSON.stringify(req)}.`);
  }
  if (errors.length) return { ok: false, errors };

  if (data.snapshot_version !== schema.properties.snapshot_version.const) {
    return { ok: false, errors: [`Unsupported snapshot version: ${JSON.stringify(data.snapshot_version)}. Expected ${schema.properties.snapshot_version.const}.`] };
  }

  const repo = data.repository;
  if (!repo || typeof repo !== 'object' || Array.isArray(repo)) {
    return { ok: false, errors: ['repository must be a JSON object.'] };
  }
  const repoSchema = schema.$defs.repository_metadata;
  const allowedRepo = new Set(Object.keys(repoSchema.properties));
  for (const key of Object.keys(repo)) {
    if (!allowedRepo.has(key)) errors.push(`Unknown repository property: ${JSON.stringify(key)}.`);
  }
  for (const req of repoSchema.required) {
    if (!(req in repo)) errors.push(`Missing required repository property: ${JSON.stringify(req)}.`);
  }
  if (!repoSchema.properties.governance_mode.enum.includes(repo.governance_mode)) {
    errors.push(`Invalid governance_mode: ${JSON.stringify(repo.governance_mode)}.`);
  }
  if (repo.policy_version !== undefined && typeof repo.policy_version !== 'string') {
    errors.push('repository.policy_version must be a string.');
  }
  if (repo.canonical_parent_tracker !== undefined) {
    const cpt = repo.canonical_parent_tracker;
    if (typeof cpt !== 'number' && typeof cpt !== 'string') {
      errors.push('repository.canonical_parent_tracker must be an integer or string.');
    }
  }
  if (errors.length) return { ok: false, errors };

  if (!Array.isArray(data.issues)) {
    return { ok: false, errors: ['issues must be an array.'] };
  }

  const issueSchema = schema.$defs.issue_record;
  const allowedIssue = new Set(Object.keys(issueSchema.properties));
  const validCategories = issueSchema.properties.category.enum;
  const validStates = issueSchema.properties.state.enum;
  const seenIds = new Set();

  for (let i = 0; i < data.issues.length; i++) {
    const issue = data.issues[i];
    const pfx = `issues[${i}]`;
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
      errors.push(`${pfx} must be an object.`); continue;
    }
    for (const key of Object.keys(issue)) {
      if (!allowedIssue.has(key)) errors.push(`${pfx} has unknown property: ${JSON.stringify(key)}.`);
    }
    for (const req of issueSchema.required) {
      if (!(req in issue)) errors.push(`${pfx} missing required property: ${JSON.stringify(req)}.`);
    }
    if (issue.id === undefined || issue.id === null) {
      errors.push(`${pfx} must have an id.`);
    } else {
      const idStr = String(issue.id);
      if (seenIds.has(idStr)) errors.push(`Duplicate issue id: ${JSON.stringify(issue.id)}.`);
      seenIds.add(idStr);
    }
    if (issue.state !== undefined && !validStates.includes(issue.state)) {
      errors.push(`${pfx} (id=${issue.id}) invalid state: ${JSON.stringify(issue.state)}.`);
    }
    if (issue.category !== undefined && !validCategories.includes(issue.category)) {
      errors.push(`${pfx} (id=${issue.id}) invalid category: ${JSON.stringify(issue.category)}.`);
    }
    if (issue.body !== undefined) {
      if (typeof issue.body !== 'string') errors.push(`${pfx} (id=${issue.id}) body must be a string.`);
      else if (issue.body.length === 0) errors.push(`${pfx} (id=${issue.id}) body must not be empty.`);
    }
    if (issue.parent !== undefined && issue.parent !== null) {
      if (typeof issue.parent !== 'number' && typeof issue.parent !== 'string') {
        errors.push(`${pfx} (id=${issue.id}) parent must be integer, string, or null.`);
      }
    }
    if (issue.children !== undefined) {
      if (!Array.isArray(issue.children)) {
        errors.push(`${pfx} (id=${issue.id}) children must be an array.`);
      } else {
        const cSeen = new Set();
        for (const c of issue.children) {
          const cs = String(c);
          if (cSeen.has(cs)) errors.push(`${pfx} (id=${issue.id}) duplicate child: ${JSON.stringify(c)}.`);
          cSeen.add(cs);
        }
      }
    }
    if (issue.checklist_items !== undefined) {
      if (!Array.isArray(issue.checklist_items)) {
        errors.push(`${pfx} (id=${issue.id}) checklist_items must be an array.`);
      } else {
        const ciSchema = schema.$defs.checklist_item;
        const allowedCI = new Set(Object.keys(ciSchema.properties));
        for (let j = 0; j < issue.checklist_items.length; j++) {
          const ci = issue.checklist_items[j];
          if (!ci || typeof ci !== 'object' || Array.isArray(ci)) {
            errors.push(`${pfx}.checklist_items[${j}] must be an object.`); continue;
          }
          for (const key of Object.keys(ci)) {
            if (!allowedCI.has(key)) errors.push(`${pfx}.checklist_items[${j}] unknown property: ${JSON.stringify(key)}.`);
          }
          if (typeof ci.checked !== 'boolean') errors.push(`${pfx}.checklist_items[${j}] checked must be boolean.`);
          if (typeof ci.text !== 'string') errors.push(`${pfx}.checklist_items[${j}] text must be string.`);
        }
      }
    }
    if (issue.linked_prs !== undefined && !Array.isArray(issue.linked_prs)) {
      errors.push(`${pfx} (id=${issue.id}) linked_prs must be an array.`);
    }
    if (issue.implementation_prs !== undefined) {
      if (!Array.isArray(issue.implementation_prs)) {
        errors.push(`${pfx} (id=${issue.id}) implementation_prs must be an array.`);
      } else {
        for (let j = 0; j < issue.implementation_prs.length; j++) {
          const ipr = issue.implementation_prs[j];
          const ipPfx = `${pfx}.implementation_prs[${j}]`;
          if (!ipr || typeof ipr !== 'object' || Array.isArray(ipr)) {
            errors.push(`${ipPfx} must be an object.`); continue;
          }
          if (ipr.number === undefined) errors.push(`${ipPfx} must have number.`);
          if (ipr.state !== undefined && !['open','closed','merged'].includes(ipr.state)) {
            errors.push(`${ipPfx} invalid state: ${JSON.stringify(ipr.state)}.`);
          }
        }
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, data };
}

// --- Body parsing helpers ---

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
    const m = trimmed.match(/^Last\s+reconciled:\s+\*\*(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4}),\s+(\d{2}):(\d{2})\s+SGT\*\*$/);
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

function hasSection(body, key) {
  const pat = SECTION_HEADINGS[key];
  return pat ? pat.test(body) : false;
}

function parseChecklistFromBody(body) {
  const items = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^- \[([ xX])\]\s+(.*)/);
    if (m) {
      const checked = m[1] === 'x' || m[1] === 'X';
      const linkMatch = m[2].match(/#(\d+)/);
      items.push({ checked, text: line, linked_issue: linkMatch ? +linkMatch[1] : null });
    }
  }
  return items;
}

function getIssueById(issues, id) {
  return issues.find(i => String(i.id) === String(id)) || null;
}

function isChildCategory(cat) { return ['active_multi_step_child','small_atomic_child'].includes(cat); }
function isChildLike(issue) { return isChildCategory(issue.category) || issue.category === 'complete'; }
function isImplementationCat(cat) { return isChildCategory(cat); }

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

// --- Audit checks ---

function checkGovernanceMode(repo, issues, findings) {
  if (repo.governance_mode === 'unknown') {
    findings.push({ code: 'GOV021', severity: 'warning', issue_id: null,
      message: 'Governance mode is "unknown". Repository must select a governance mode.' });
    return;
  }
  if (repo.governance_mode !== 'toolkit_governed') return;

  const parents = issues.filter(i => i.category === 'canonical_parent_tracker');
  if (parents.length === 0) {
    findings.push({ code: 'GOV001', severity: 'error', issue_id: null, message: 'Toolkit-governed repository has no declared canonical parent tracker.' });
  } else if (parents.length > 1) {
    findings.push({ code: 'GOV002', severity: 'error', issue_id: null, message: `Toolkit-governed repository has ${parents.length} canonical parent trackers.` });
  }

  if (repo.canonical_parent_tracker !== undefined) {
    const declared = getIssueById(issues, repo.canonical_parent_tracker);
    if (!declared) {
      findings.push({ code: 'GOV026', severity: 'error', issue_id: null, message: `Declared canonical_parent_tracker #${repo.canonical_parent_tracker} not found.` });
    } else if (declared.category !== 'canonical_parent_tracker') {
      findings.push({ code: 'GOV026', severity: 'error', issue_id: null, message: `Declared canonical_parent_tracker #${repo.canonical_parent_tracker} is not categorised as canonical_parent_tracker.` });
    }
  }
}

function checkParentChildLinks(repo, issues, findings) {
  const parents = issues.filter(i => i.category === 'canonical_parent_tracker');
  const children = issues.filter(i => isChildLike(i) && i.category !== 'recurring_evidence_log');

  for (const parent of parents) {
    const bodyCL = parseChecklistFromBody(parent.body);
    for (const item of bodyCL) {
      if (!item.linked_issue) {
        findings.push({ code: 'GOV003', severity: 'warning', issue_id: parent.id, message: `Parent #${parent.id} checklist entry has no linked child.` });
      }
    }
    if (parent.checklist_items) {
      for (const item of parent.checklist_items) {
        if (!item.linked_issue) continue;
        const bodyHas = bodyCL.some(bc => bc.linked_issue === item.linked_issue || bc.text.trim() === item.text.trim());
        if (!bodyHas) {
          findings.push({ code: 'GOV027', severity: 'error', issue_id: parent.id,
            message: `Parent #${parent.id} structured checklist_item references child #${item.linked_issue} not found in body.` });
        }
      }
    }
  }

  for (const child of children) {
    if (!child.parent && child.parent !== 0) {
      findings.push({ code: 'GOV004', severity: 'error', issue_id: child.id, message: `Child #${child.id} has no parent link.` });
      continue;
    }
    const parentIssue = getIssueById(issues, child.parent);
    if (!parentIssue) {
      findings.push({ code: 'GOV005', severity: 'error', issue_id: child.id, message: `Child #${child.id} parent #${child.parent} not found.` });
      continue;
    }
    if (parentIssue.category !== 'canonical_parent_tracker') {
      findings.push({ code: 'GOV026', severity: 'error', issue_id: child.id, message: `Child #${child.id} parent #${child.parent} is not a canonical_parent_tracker.` });
      continue;
    }
    const bodyCL = parseChecklistFromBody(parentIssue.body);
    const inBody = bodyCL.some(item => item.linked_issue && String(item.linked_issue) === String(child.id));
    if (!inBody) {
      findings.push({ code: 'GOV005', severity: 'error', issue_id: child.id, message: `Child #${child.id} absent from parent #${child.parent} body checklist.` });
    }
    const parentChildren = parentIssue.children || [];
    if (!parentChildren.some(c => String(c) === String(child.id))) {
      findings.push({ code: 'GOV006', severity: 'error', issue_id: child.id, message: `Parent #${child.parent} children array does not list child #${child.id}.` });
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
          findings.push({ code: 'GOV007', severity: 'error', issue_id: parent.id, message: `Parent #${parent.id} item checked but child #${child.id} is still open.` });
        }
        if (isChildLike(child)) {
          const met = isAcceptanceCriteriaMet(child.body);
          if (met === false) {
            findings.push({ code: 'GOV007', severity: 'error', issue_id: parent.id, message: `Parent #${parent.id} item checked but child #${child.id} has incomplete acceptance.` });
          }
        }
      }
    }
  }

  const completeChildren = issues.filter(i => (i.category === 'complete' || i.state === 'closed') && isChildLike(i));
  for (const child of completeChildren) {
    if (!hasSection(child.body, 'acceptance_criteria')) continue;
    const met = isAcceptanceCriteriaMet(child.body);
    if (met === false) {
      findings.push({ code: 'GOV008', severity: 'error', issue_id: child.id, message: `Closed/complete child #${child.id} has unchecked acceptance criteria.` });
    }
  }

  for (const child of issues.filter(i => isChildLike(i))) {
    if (!child.parent && child.parent !== 0) continue;
    if (child.category !== 'complete' && child.state !== 'closed') continue;
    const parentIssue = getIssueById(issues, child.parent);
    if (!parentIssue) continue;
    const bodyCL = parseChecklistFromBody(parentIssue.body);
    const item = bodyCL.find(ci => ci.linked_issue && String(ci.linked_issue) === String(child.id));
    if (item && !item.checked) {
      findings.push({ code: 'GOV009', severity: 'warning', issue_id: child.id, message: `Complete child #${child.id} has unchecked parent item in #${parentIssue.id}.` });
    }
  }
}

function checkRequiredSections(issue, findings) {
  const body = issue.body;
  const cat = issue.category;

  if (!hasSection(body, 'current_status')) {
    findings.push({ code: 'GOV010', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id}: missing Current status section.` });
  }

  const tsCount = countTimestamps(body);
  if (tsCount === 0) {
    findings.push({ code: 'GOV011', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id}: missing reconciliation timestamp.` });
  } else if (tsCount > 1) {
    findings.push({ code: 'GOV012', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id}: multiple reconciliation timestamps (${tsCount}).` });
  }

  if (tsCount > 0) {
    const timestamps = parseTimestamps(body);
    if (timestamps.length === 0) {
      findings.push({ code: 'GOV013', severity: 'warning', issue_id: issue.id, message: `Issue #${issue.id}: timestamp present but malformed. Expected: Last reconciled: **DD Month YYYY, HH:mm SGT**` });
    }
    for (const ts of timestamps) {
      if (!isRealTimestamp(ts)) {
        findings.push({ code: 'GOV013', severity: 'warning', issue_id: issue.id, message: `Issue #${issue.id}: invalid date/time in timestamp.` });
      }
    }
  }

  if (!hasSection(body, 'why_this_issue_exists')) {
    findings.push({ code: 'GOV014', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id}: missing "Why this issue exists" section.` });
  }

  if (cat === 'active_multi_step_child') {
    const required = ['parent_tracker','implementation_pr','goal_and_scope','completed_work','current_blockers_and_findings','remaining_steps','linked_prs_and_followups','decisions_and_durable_evidence','safety_and_authority'];
    for (const sec of required) {
      if (!hasSection(body, sec)) {
        findings.push({ code: 'GOV015', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id}: missing required dimension "${SECTION_LABELS[sec] || sec}".` });
      }
    }
  }

  if (cat === 'small_atomic_child') {
    const required = ['parent_link','completed_work','remaining_steps','linked_prs_or_followups','safety_and_authority'];
    for (const sec of required) {
      if (!hasSection(body, sec)) {
        findings.push({ code: 'GOV015', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id}: missing required dimension "${SECTION_LABELS[sec] || sec}".` });
      }
    }
    if (!hasSection(body, 'blockers')) {
      findings.push({ code: 'GOV015', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id}: missing required dimension "Blockers".` });
    }
  }

  if (isChildCategory(cat) && !hasSection(body, 'acceptance_criteria')) {
    findings.push({ code: 'GOV016', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id}: missing Acceptance criteria section.` });
  }

  if (issue.reconciliation_timestamp !== undefined && issue.reconciliation_timestamp !== null) {
    const bodyTs = parseTimestamps(body);
    const bodyTsStr = bodyTs.length > 0 ? `${bodyTs[0].day} ${bodyTs[0].month} ${bodyTs[0].year}, ${String(bodyTs[0].hour).padStart(2,'0')}:${String(bodyTs[0].minute).padStart(2,'0')} SGT` : null;
    if (bodyTsStr && issue.reconciliation_timestamp !== bodyTsStr) {
      findings.push({ code: 'GOV027', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id}: structured reconciliation_timestamp contradicts body.` });
    }
  }

  if (issue.acceptance_criteria_met !== undefined && issue.acceptance_criteria_met !== null && hasSection(body, 'acceptance_criteria')) {
    const bodyMet = isAcceptanceCriteriaMet(body);
    if (bodyMet !== null && issue.acceptance_criteria_met !== bodyMet) {
      findings.push({ code: 'GOV027', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id}: structured acceptance_criteria_met contradicts body.` });
    }
  }
}

function checkSupersededIssues(issues, findings) {
  for (const issue of issues) {
    if (issue.category === 'superseded_duplicate_not_planned' && !issue.reason && !issue.successor) {
      findings.push({ code: 'GOV017', severity: 'warning', issue_id: issue.id, message: `Issue #${issue.id} is superseded/duplicate/not-planned but has no reason or successor.` });
    }
  }
}

function checkAntiPatterns(issues, findings) {
  for (const issue of issues) {
    const body = issue.body;
    const prPat = /(?:pr|pull\s*request)\s*(?:#?\d+\s*)?(?:is\s*)?(?:merged|merge)\s*(?:=|equals|is|means|sufficient|enough|complete)/gi;
    let m;
    while ((m = prPat.exec(body)) !== null) {
      if (!isNegatedContext(body, m.index, m[0].length)) {
        findings.push({ code: 'GOV018', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id} body treats PR merge as sufficient completion.` });
        break;
      }
    }
    const implPat = /(?:implementer|coding\s*agent|codex|claude|copilot)\s+(?:has\s+)?(?:independently\s+)?(?:verified|confirmed|accepted|certified|approved)\s+(?:independent\s+)?(?:review|acceptance|completion)/gi;
    while ((m = implPat.exec(body)) !== null) {
      if (!isNegatedContext(body, m.index, m[0].length)) {
        findings.push({ code: 'GOV019', severity: 'error', issue_id: issue.id, message: `Issue #${issue.id} body contains implementer self-acceptance claim.` });
        break;
      }
    }
  }
}

function checkImplementationPR(issues, findings) {
  for (const issue of issues) {
    if (!isImplementationCat(issue.category)) continue;
    if (!issue.implementation_prs || issue.implementation_prs.length === 0) continue;

    const active = issue.implementation_prs.filter(pr => pr.state === 'open');
    if (active.length > 1) {
      findings.push({ code: 'GOV022', severity: 'error', issue_id: issue.id,
        message: `Issue #${issue.id} has ${active.length} active implementation PRs.` });
    }

    for (const rep of issue.implementation_prs.filter(pr => pr.is_replacement)) {
      if (!rep.replacement_reason) {
        findings.push({ code: 'GOV024', severity: 'error', issue_id: issue.id,
          message: `Issue #${issue.id} replacement PR #${rep.number} has no recorded reason.` });
      }
    }
  }
}

function checkPolicyDrift(repo, findings) {
  const pv = getPolicyVersion();
  if (repo.policy_version && repo.policy_version !== pv) {
    findings.push({ code: 'GOV020', severity: 'warning', issue_id: null,
      message: `Policy version drift: snapshot declares ${repo.policy_version}, canonical is ${pv}.` });
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

  for (const issue of issues) {
    if (issue.checklist_items === undefined) {
      issue.checklist_items = parseChecklistFromBody(issue.body);
    }
  }

  checkGovernanceMode(repo, issues, findings);

  if (repo.governance_mode === 'toolkit_governed') {
    checkParentChildLinks(repo, issues, findings);
    checkCompletionConsistency(issues, findings);
    for (const issue of issues) {
      if (isChildCategory(issue.category)) checkRequiredSections(issue, findings);
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
    lines.push(`  ${f.code} (${f.severity})${ref}: ${sanitize(f.message)}`);
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
    findings: findings.map(f => ({ code: f.code, severity: f.severity, issue_id: f.issue_id, message: sanitize(f.message) }))
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
  sanitize, POLICY_PATH, SCHEMA_PATH
};
