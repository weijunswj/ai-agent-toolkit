'use strict';

const VALID_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function markdownLines(body) {
  const lines = String(body || '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const visible = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (!fenced) visible.push(line);
  }
  return visible;
}

function extractCanonicalTemplate(body) {
  const match = String(body || '').normalize('NFC').replace(/\r\n?/g, '\n').match(/(?:^|\n)## Template\s*\n+```md\n([\s\S]*?)\n```(?:\n|$)/);
  if (!match) throw new Error('BODY_TEMPLATE_BLOCK_MISSING');
  return match[1];
}

function parseInlineValue(raw, allowed, field) {
  const value = raw.trim();
  const forms = [];
  if (!/[`*_[\]\\]/.test(value)) forms.push({ kind: 'plain', value });
  let match = value.match(/^`([^`\r\n]+)`$/);
  if (match) forms.push({ kind: 'code', value: match[1] });
  match = value.match(/^\*\*([^*\r\n]+)\*\*$/);
  if (match) forms.push({ kind: 'strong', value: match[1] });
  match = value.match(/^\[([^\]\r\n]+)\]\(([^()\s\r\n]+)\)$/);
  if (match) forms.push({ kind: 'link', value: match[1], target: match[2] });
  const accepted = forms.filter((form) => allowed.includes(form.kind));
  if (accepted.length !== 1 || accepted[0].value.trim() === '' || /[`*_[\]\\]/.test(accepted[0].value)) {
    throw new Error('BODY_AUTHORITY_INLINE_INVALID:' + field);
  }
  return accepted[0];
}

function parseAuthorityField(body, label, allowed) {
  const matches = [];
  const plainPrefix = label + ':';
  const boldPrefix = '**' + label + ':**';
  for (const original of markdownLines(body)) {
    const line = original.trim();
    if (line.startsWith(plainPrefix)) matches.push(line.slice(plainPrefix.length));
    else if (line.startsWith(boldPrefix)) matches.push(line.slice(boldPrefix.length));
  }
  if (matches.length > 1) throw new Error('BODY_AUTHORITY_DUPLICATE:' + label);
  return matches.length === 0 ? null : parseInlineValue(matches[0], allowed, label);
}

function parseChecklistFromBody(body) {
  const items = [];
  if (!body) return items;
  for (const line of markdownLines(body)) {
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
  if (!body) return 0;
  let count = 0;
  for (const line of markdownLines(body)) {
    if (line.trim().startsWith('Last reconciled:')) count += 1;
  }
  return count;
}

function parseTimestamps(body) {
  const results = [];
  if (!body) return results;
  for (const line of markdownLines(body)) {
    const trimmed = line.trim();
    const m = trimmed.match(/^Last reconciled:\s+\*\*(\d{2}) ([A-Z][a-z]+) (\d{4}), (\d{2}):(\d{2}) SGT\*\*$/);
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
  if (!body) return null;
  let inSection = false, hasCriteria = false, allChecked = true;
  for (const line of markdownLines(body)) {
    if (/^#\s+Acceptance\s+criteria/im.test(line.trim())) { inSection = true; continue; }
    if (inSection && /^#\s+/.test(line.trim())) break;
    if (inSection) {
      const m = line.match(/^- \[([ xX])\]\s+/);
      if (m) { hasCriteria = true; if (m[1] !== 'x' && m[1] !== 'X') allChecked = false; }
    }
  }
  if (!hasCriteria) return false;
  return allChecked;
}

function parseImplBranchFromBody(body) {
  const parsed = parseAuthorityField(body, 'Implementation branch', ['plain', 'code', 'link']);
  return parsed ? parsed.value : null;
}

function parseImplPRFromBody(body) {
  const parsed = parseAuthorityField(body, 'Implementation PR', ['plain']);
  return parsed ? parsed.value : null;
}

function parseParentTrackerFromBody(body) {
  const parsed = parseAuthorityField(body, 'Parent tracker', ['plain']);
  if (!parsed) return null;
  const match = parsed.value.match(/^#([1-9][0-9]*)$/);
  return match ? +match[1] : null;
}

function parseReplacementReasonFromBody(body) {
  const parsed = parseAuthorityField(body, 'Replacement reason', ['plain']);
  return parsed ? parsed.value : null;
}

function parseSupersedesPRFromBody(body) {
  const parsed = parseAuthorityField(body, 'Supersedes PR', ['plain']);
  if (!parsed) return null;
  const match = parsed.value.match(/^#([1-9][0-9]*)$/);
  return match ? +match[1] : null;
}

function timestampToStr(ts) {
  return `${String(ts.day).padStart(2,'0')} ${ts.month} ${ts.year}, ${String(ts.hour).padStart(2,'0')}:${String(ts.minute).padStart(2,'0')} SGT`;
}

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

  const bodyCounts = {};
  for (const id of bodyChildIds) {
    bodyCounts[id] = (bodyCounts[id] || 0) + 1;
  }
  for (const [id, count] of Object.entries(bodyCounts)) {
    if (count > 1) errors.push(`Duplicate child identity #${id} in body checklist (${count} occurrences).`);
  }

  return errors;
}

module.exports = {
  parseChecklistFromBody, countTimestamps, parseTimestamps, isRealTimestamp,
  isAcceptanceCriteriaMet, parseImplBranchFromBody, parseImplPRFromBody,
  parseParentTrackerFromBody, parseReplacementReasonFromBody, parseSupersedesPRFromBody,
  timestampToStr, normalizeChecklistItem, checklistMultisetMatch, parentChildrenMatch,
  parseInlineValue, parseAuthorityField, markdownLines, extractCanonicalTemplate, VALID_MONTHS
};
