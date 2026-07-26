'use strict';

function canonicalKey(id) {
  const str = String(id);
  const intPattern = /^(0|[1-9]\d*)$/;

  if (typeof id === 'number' && Number.isInteger(id) && id >= 0 && id <= Number.MAX_SAFE_INTEGER) {
    return `n:${str}`;
  }
  if (typeof id === 'string' && intPattern.test(str)) {
    const num = Number(str);
    if (num <= Number.MAX_SAFE_INTEGER) {
      return `n:${str}`;
    }
  }
  return `s:${str}`;
}

function buildSubjectMap(issues) {
  const entries = issues.map((issue) => ({
    raw: issue.id,
    key: canonicalKey(issue.id)
  }));

  const duplicates = [];
  const keyFirstIdx = new Map();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (keyFirstIdx.has(entry.key)) {
      duplicates.push({ key: entry.key, first: keyFirstIdx.get(entry.key), second: i });
    } else {
      keyFirstIdx.set(entry.key, i);
    }
  }

  const uniqueKeys = new Map();
  for (const entry of entries) {
    if (!uniqueKeys.has(entry.key)) {
      uniqueKeys.set(entry.key, entry.raw);
    }
  }

  const sorted = [...uniqueKeys.keys()].sort((a, b) => {
    const aNum = a.startsWith('n:');
    const bNum = b.startsWith('n:');
    if (aNum && bNum) return Number(a.slice(2)) - Number(b.slice(2));
    if (aNum) return -1;
    if (bNum) return 1;
    const sa = a.slice(2);
    const sb = b.slice(2);
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    return 0;
  });

  const map = new Map();
  for (let i = 0; i < sorted.length; i++) {
    map.set(sorted[i], `S${i + 1}`);
  }

  return { map, duplicates };
}

function getSubjectForIssue(subjects, issueId) {
  if (!subjects || !subjects.map) return null;
  const key = canonicalKey(issueId);
  return subjects.map.get(key) || null;
}

module.exports = { canonicalKey, buildSubjectMap, getSubjectForIssue };
