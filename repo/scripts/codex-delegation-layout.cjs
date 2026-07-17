'use strict';

const {
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  CODEX_V2_ENABLEMENT_BEGIN,
  CODEX_V2_ENABLEMENT_END,
  CODEX_HELPER_CAPACITY_BEGIN,
  CODEX_HELPER_CAPACITY_END,
  CODEX_ROOT_GUIDANCE_BEGIN,
  CODEX_ROOT_GUIDANCE_END,
  CODEX_HELPER_GUIDANCE_BEGIN,
  CODEX_HELPER_GUIDANCE_END,
} = require('./codex-delegation-common.cjs');

function scanTomlLines(text) {
  const lines = [];
  let state = 'normal';
  let escaped = false;
  let current = '';
  let raw = '';
  let realComment = false;

  function finishLine(eol) {
    lines.push({ raw, structural: current, eol, realComment });
    current = '';
    raw = '';
    realComment = false;
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next2 = text.slice(index, index + 3);
    raw += char;

    if (char === '\r' && text[index + 1] === '\n') {
      raw += '\n';
      finishLine('\r\n');
      index += 1;
      if (state === 'comment') state = 'normal';
      escaped = false;
      continue;
    }
    if (char === '\n') {
      finishLine('\n');
      if (state === 'comment') state = 'normal';
      escaped = false;
      continue;
    }

    if (state === 'comment') {
      current += ' ';
      continue;
    }
    if (state === 'multibasic') {
      if (next2 === '"""' && !escaped) {
        current += '   ';
        raw += text[index + 1] + text[index + 2];
        index += 2;
        state = 'normal';
        escaped = false;
      } else {
        current += ' ';
        if (char === '\\') escaped = !escaped;
        else escaped = false;
      }
      continue;
    }
    if (state === 'multiliteral') {
      if (next2 === "'''") {
        current += '   ';
        raw += text[index + 1] + text[index + 2];
        index += 2;
        state = 'normal';
      } else {
        current += ' ';
      }
      continue;
    }
    if (state === 'basic') {
      current += ' ';
      if (char === '"' && !escaped) state = 'normal';
      if (char === '\\') escaped = !escaped;
      else escaped = false;
      continue;
    }
    if (state === 'literal') {
      current += ' ';
      if (char === "'") state = 'normal';
      continue;
    }

    if (next2 === '"""') {
      current += '   ';
      raw += text[index + 1] + text[index + 2];
      index += 2;
      state = 'multibasic';
      escaped = false;
    } else if (next2 === "'''") {
      current += '   ';
      raw += text[index + 1] + text[index + 2];
      index += 2;
      state = 'multiliteral';
    } else if (char === '"') {
      current += ' ';
      state = 'basic';
      escaped = false;
    } else if (char === "'") {
      current += ' ';
      state = 'literal';
    } else if (char === '#') {
      current += ' ';
      state = 'comment';
      realComment = true;
    } else {
      current += char;
    }
  }
  if (raw || current || text.length === 0) finishLine('');
  return { lines, terminalState: state };
}

function classifyStructuralLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'blank' };
  if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) {
    return { kind: 'array-table', name: trimmed.slice(2, -2).trim() };
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return { kind: 'table', name: trimmed.slice(1, -1).trim() };
  }
  let equals = -1;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;
    else if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    else if (char === '=' && bracketDepth === 0 && braceDepth === 0) {
      equals = index;
      break;
    }
  }
  if (equals >= 0) return { kind: 'assignment', key: trimmed.slice(0, equals).trim(), value: trimmed.slice(equals + 1).trim() };
  return { kind: 'other' };
}

function structuralLayout(text) {
  const scanned = scanTomlLines(text);
  if (!['normal', 'comment'].includes(scanned.terminalState)) {
    return { ok: false, detail: 'Codex config ends inside a TOML string and cannot be edited safely.' };
  }
  let offset = 0;
  const tables = [];
  const assignments = [];
  const beginMarkers = [];
  const endMarkers = [];
  const helperBeginMarkers = [];
  const helperEndMarkers = [];
  const enablementBeginMarkers = [];
  const enablementEndMarkers = [];
  const rootGuidanceBeginMarkers = [];
  const rootGuidanceEndMarkers = [];
  const helperGuidanceBeginMarkers = [];
  const helperGuidanceEndMarkers = [];
  const unknownToolkitDelegationMarkers = [];
  const recognizedToolkitDelegationMarkers = [];
  const markerDefinitions = [
    [CODEX_DELEGATION_BEGIN, 'legacy', 'legacy-limits', 'begin'],
    [CODEX_DELEGATION_END, 'legacy', 'legacy-limits', 'end'],
    [CODEX_V2_ENABLEMENT_BEGIN, 'v2', 'enablement', 'begin'],
    [CODEX_V2_ENABLEMENT_END, 'v2', 'enablement', 'end'],
    [CODEX_HELPER_CAPACITY_BEGIN, 'v2', 'helper-capacity', 'begin'],
    [CODEX_HELPER_CAPACITY_END, 'v2', 'helper-capacity', 'end'],
    [CODEX_ROOT_GUIDANCE_BEGIN, 'v2', 'root-guidance', 'begin'],
    [CODEX_ROOT_GUIDANCE_END, 'v2', 'root-guidance', 'end'],
    [CODEX_HELPER_GUIDANCE_BEGIN, 'v2', 'helper-guidance', 'begin'],
    [CODEX_HELPER_GUIDANCE_END, 'v2', 'helper-guidance', 'end'],
  ];
  for (let index = 0; index < scanned.lines.length; index += 1) {
    const entry = scanned.lines[index];
    const rawWithoutEol = entry.eol ? entry.raw.slice(0, -entry.eol.length) : entry.raw;
    const structural = entry.structural;
    const classified = classifyStructuralLine(structural);
    const start = offset;
    const end = offset + entry.raw.length;
    if (classified.kind === 'table' || classified.kind === 'array-table') {
      tables.push({ ...classified, index, start, end, raw: rawWithoutEol });
    } else if (classified.kind === 'assignment') {
      assignments.push({ ...classified, index, start, end });
    }
    const outsideStringComment = entry.realComment === true && structural.trim() === '' && rawWithoutEol.trim().startsWith('#');
    if (outsideStringComment) {
      const definition = markerDefinitions.find(([marker]) => marker === rawWithoutEol.trim());
      if (definition) {
        recognizedToolkitDelegationMarkers.push({
          index,
          start,
          end,
          family: definition[1],
          category: definition[2],
          boundary: definition[3],
          raw: rawWithoutEol,
        });
      }
    }
    if (outsideStringComment && rawWithoutEol.trim() === CODEX_DELEGATION_BEGIN) beginMarkers.push({ index, start, end });
    if (outsideStringComment && rawWithoutEol.trim() === CODEX_DELEGATION_END) endMarkers.push({ index, start, end });
    if (outsideStringComment && rawWithoutEol.trim() === CODEX_HELPER_CAPACITY_BEGIN) helperBeginMarkers.push({ index, start, end });
    if (outsideStringComment && rawWithoutEol.trim() === CODEX_HELPER_CAPACITY_END) helperEndMarkers.push({ index, start, end });
    if (outsideStringComment && rawWithoutEol.trim() === CODEX_V2_ENABLEMENT_BEGIN) enablementBeginMarkers.push({ index, start, end });
    if (outsideStringComment && rawWithoutEol.trim() === CODEX_V2_ENABLEMENT_END) enablementEndMarkers.push({ index, start, end });
    if (outsideStringComment && rawWithoutEol.trim() === CODEX_ROOT_GUIDANCE_BEGIN) rootGuidanceBeginMarkers.push({ index, start, end });
    if (outsideStringComment && rawWithoutEol.trim() === CODEX_ROOT_GUIDANCE_END) rootGuidanceEndMarkers.push({ index, start, end });
    if (outsideStringComment && rawWithoutEol.trim() === CODEX_HELPER_GUIDANCE_BEGIN) helperGuidanceBeginMarkers.push({ index, start, end });
    if (outsideStringComment && rawWithoutEol.trim() === CODEX_HELPER_GUIDANCE_END) helperGuidanceEndMarkers.push({ index, start, end });
    if (outsideStringComment
      && rawWithoutEol.trim().startsWith('# AI-AGENT-TOOLKIT:')
      && /CODEX-/.test(rawWithoutEol)
      && ![
        CODEX_DELEGATION_BEGIN, CODEX_DELEGATION_END,
        CODEX_V2_ENABLEMENT_BEGIN, CODEX_V2_ENABLEMENT_END,
        CODEX_HELPER_CAPACITY_BEGIN, CODEX_HELPER_CAPACITY_END,
        CODEX_ROOT_GUIDANCE_BEGIN, CODEX_ROOT_GUIDANCE_END,
        CODEX_HELPER_GUIDANCE_BEGIN, CODEX_HELPER_GUIDANCE_END,
      ].includes(rawWithoutEol.trim())) unknownToolkitDelegationMarkers.push({ index, start, end, raw: rawWithoutEol });
    offset = end;
  }
  const agentsTables = tables.filter((entry) => entry.kind === 'table' && entry.name === 'agents');
  const agentsChildren = tables.filter((entry) => entry.name.startsWith('agents.'));
  const featuresTables = tables.filter((entry) => entry.kind === 'table' && entry.name === 'features');
  const multiAgentV2Tables = tables.filter((entry) => entry.kind === 'table' && entry.name === 'features.multi_agent_v2');
  const multiAgentV2Children = tables.filter((entry) => entry.name.startsWith('features.multi_agent_v2.'));
  const unsupportedAssignments = assignments.filter((entry) => {
    const normalized = entry.key.replace(/\s+/g, '');
    return normalized === 'agents' || normalized.startsWith('agents.');
  });
  return {
    ok: true,
    lines: scanned.lines,
    tables,
    assignments,
    agentsTables,
    agentsChildren,
    featuresTables,
    unsupportedAssignments,
    beginMarkers,
    endMarkers,
    helperBeginMarkers,
    helperEndMarkers,
    enablementBeginMarkers,
    enablementEndMarkers,
    rootGuidanceBeginMarkers,
    rootGuidanceEndMarkers,
    helperGuidanceBeginMarkers,
    helperGuidanceEndMarkers,
    unknownToolkitDelegationMarkers,
    recognizedToolkitDelegationMarkers,
    multiAgentV2Tables,
    multiAgentV2Children,
  };
}

module.exports = { scanTomlLines, classifyStructuralLine, structuralLayout };
