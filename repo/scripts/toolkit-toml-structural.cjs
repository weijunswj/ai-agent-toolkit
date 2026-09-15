#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const CACHE = new Map();
const PYTHON_VALIDATE = String.raw`
import json, sys, tomllib
raw = sys.stdin.buffer.read()
try:
    text = raw.decode('utf-8')
    tomllib.loads(text)
except UnicodeDecodeError as exc:
    print(json.dumps({'ok': False, 'kind': 'encoding', 'detail': str(exc)}))
except Exception as exc:
    print(json.dumps({'ok': False, 'kind': 'parse', 'detail': str(exc)}))
else:
    print(json.dumps({'ok': True, 'kind': 'valid'}))
`;

function pythonCandidates() {
  const explicit = String(process.env.AI_AGENT_TOOLKIT_PYTHON || '').trim();
  const candidates = [];
  if (explicit) candidates.push({ command: explicit, args: [] });
  if (process.platform === 'win32') candidates.push({ command: 'python', args: [] }, { command: 'py', args: ['-3'] });
  else candidates.push({ command: 'python3', args: [] }, { command: 'python', args: [] });
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.command}\0${candidate.args.join('\0')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateToml(text) {
  const input = Buffer.from(String(text || ''), 'utf8');
  const key = crypto.createHash('sha256').update(input).digest('hex');
  if (CACHE.has(key)) return { ...CACHE.get(key) };
  const failures = [];
  for (const candidate of pythonCandidates()) {
    const result = spawnSync(candidate.command, [...candidate.args, '-c', PYTHON_VALIDATE], {
      input,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) {
      failures.push(`${candidate.command}: unavailable`);
      continue;
    }
    if (result.status !== 0) {
      failures.push(`${candidate.command}: parser failed`);
      continue;
    }
    try {
      const parsed = JSON.parse(String(result.stdout || '').trim());
      const value = { ...parsed, parser: `${candidate.command}${candidate.args.length ? ` ${candidate.args.join(' ')}` : ''} tomllib` };
      CACHE.set(key, value);
      return { ...value };
    } catch {
      failures.push(`${candidate.command}: invalid parser response`);
    }
  }
  return { ok: false, kind: 'parser-unavailable', detail: failures.join('; ') || 'no usable Python tomllib runtime' };
}

function lineRecords(text) {
  const records = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline + 1;
    const raw = text.slice(start, end);
    const eol = raw.endsWith('\r\n') ? '\r\n' : (raw.endsWith('\n') ? '\n' : '');
    records.push({ start, end, text: eol ? raw.slice(0, -eol.length) : raw, eol });
    start = end;
  }
  if (text.length === 0) records.push({ start: 0, end: 0, text: '', eol: '' });
  return records;
}

function decodeBasicString(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function parseDottedKey(raw) {
  const source = String(raw || '');
  const parts = [];
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] || '')) index += 1;
    if (index >= source.length) return null;
    let value = '';
    if (source[index] === '"') {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === '"') { index += 1; break; }
        index += 1;
      }
      if (source[index - 1] !== '"') return null;
      value = decodeBasicString(source.slice(start, index));
      if (value === null) return null;
    } else if (source[index] === "'") {
      const end = source.indexOf("'", index + 1);
      if (end === -1) return null;
      value = source.slice(index + 1, end);
      index = end + 1;
    } else {
      const match = source.slice(index).match(/^[A-Za-z0-9_-]+/);
      if (!match) return null;
      value = match[0];
      index += match[0].length;
    }
    parts.push(value);
    while (/\s/.test(source[index] || '')) index += 1;
    if (index === source.length) break;
    if (source[index] !== '.') return null;
    index += 1;
  }
  return parts;
}

function scanLexically(text) {
  const source = String(text || '');
  const spans = [];
  const comments = [];
  const lineDepths = new Map([[0, { square: 0, brace: 0, string: null }]]);
  let state = 'code';
  let spanStart = -1;
  let square = 0;
  let brace = 0;
  let index = 0;
  const closeSpan = (type, end) => {
    spans.push({ type, start: spanStart, end, text: source.slice(spanStart, end) });
    spanStart = -1;
  };
  while (index < source.length) {
    const char = source[index];
    if (state === 'comment') {
      if (char === '\n') {
        closeSpan('comment', index);
        state = 'code';
        lineDepths.set(index + 1, { square, brace, string: null });
      }
      index += 1;
      continue;
    }
    if (state === 'basic') {
      if (char === '\\') { index += Math.min(2, source.length - index); continue; }
      if (char === '"') { index += 1; closeSpan('basic-string', index); state = 'code'; continue; }
      index += 1;
      continue;
    }
    if (state === 'literal') {
      if (char === "'") { index += 1; closeSpan('literal-string', index); state = 'code'; continue; }
      index += 1;
      continue;
    }
    if (state === 'multiline-basic') {
      if (char === '\\') { index += Math.min(2, source.length - index); continue; }
      if (source.startsWith('"""', index)) { index += 3; closeSpan('multiline-basic-string', index); state = 'code'; continue; }
      if (char === '\n') lineDepths.set(index + 1, { square, brace, string: state });
      index += 1;
      continue;
    }
    if (state === 'multiline-literal') {
      if (source.startsWith("'''", index)) { index += 3; closeSpan('multiline-literal-string', index); state = 'code'; continue; }
      if (char === '\n') lineDepths.set(index + 1, { square, brace, string: state });
      index += 1;
      continue;
    }
    if (char === '#') {
      state = 'comment';
      spanStart = index;
      index += 1;
      continue;
    }
    if (source.startsWith('"""', index)) {
      state = 'multiline-basic'; spanStart = index; index += 3; continue;
    }
    if (source.startsWith("'''", index)) {
      state = 'multiline-literal'; spanStart = index; index += 3; continue;
    }
    if (char === '"') { state = 'basic'; spanStart = index; index += 1; continue; }
    if (char === "'") { state = 'literal'; spanStart = index; index += 1; continue; }
    if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') brace -= 1;
    if (char === '\n') lineDepths.set(index + 1, { square, brace, string: null });
    index += 1;
  }
  if (state === 'comment') closeSpan('comment', source.length);
  for (const span of spans) if (span.type === 'comment') comments.push(span);
  return { spans, comments, lineDepths, terminal: { state, square, brace } };
}

function structuralLine(record, lexical) {
  const depth = lexical.lineDepths.get(record.start) || { square: 0, brace: 0, string: null };
  const spans = lexical.spans.filter((span) => span.start < record.end && span.end > record.start);
  const firstNonWhitespace = record.start + (record.text.match(/^\s*/)?.[0].length || 0);
  const comment = spans.find((span) => span.type === 'comment' && span.start === firstNonWhitespace);
  const insideString = spans.some((span) => span.type.includes('string') && span.start <= firstNonWhitespace && span.end > firstNonWhitespace);
  const visible = [...record.text];
  for (const span of spans) {
    if (!span.type.includes('string')) continue;
    const start = Math.max(span.start, record.start) - record.start;
    const end = Math.min(span.end, record.start + record.text.length) - record.start;
    for (let index = start; index < end; index += 1) visible[index] = ' ';
  }
  return {
    ...record,
    top_level: depth.square === 0 && depth.brace === 0 && depth.string === null,
    inside_string: insideString || depth.string !== null,
    structural_comment: Boolean(comment && depth.square === 0 && depth.brace === 0 && depth.string === null),
    comment_text: comment ? comment.text : null,
    visible_text: visible.join(''),
  };
}

function codeBeforeComment(line, lineStart, lexical) {
  const comment = lexical.comments.find((span) => span.start >= lineStart && span.start < lineStart + line.length);
  return comment ? line.slice(0, comment.start - lineStart) : line;
}

function analyseToml(text) {
  const source = String(text || '');
  const validity = validateToml(source);
  const lexical = scanLexically(source);
  const lines = lineRecords(source).map((record) => structuralLine(record, lexical));
  const tables = [];
  const assignments = [];
  let currentTable = [];
  for (const line of lines) {
    if (!line.top_level || line.inside_string || line.structural_comment) continue;
    const code = codeBeforeComment(line.text, line.start, lexical).trim();
    if (!code) continue;
    const table = code.match(/^(\[\[?)([\s\S]*?)(\]\]?)$/);
    if (table && ((table[1] === '[' && table[3] === ']') || (table[1] === '[[' && table[3] === ']]'))) {
      const path = parseDottedKey(table[2]);
      if (path) {
        currentTable = path;
        tables.push({ path, array: table[1] === '[[', start: line.start, end: line.end, text: line.text });
      }
      continue;
    }
    let quote = null;
    let equals = -1;
    for (let offset = 0; offset < code.length; offset += 1) {
      const char = code[offset];
      if (quote === '"' && char === '\\') { offset += 1; continue; }
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '=') { equals = offset; break; }
    }
    if (equals === -1) continue;
    const key = parseDottedKey(code.slice(0, equals).trim());
    if (!key) continue;
    const rawValue = code.slice(equals + 1).trim();
    assignments.push({
      table_path: [...currentTable],
      key_path: key,
      value_kind: /^(?:true|false)$/.test(rawValue) ? 'boolean' : 'other',
      value: rawValue === 'true' ? true : (rawValue === 'false' ? false : null),
      raw_value: rawValue,
      start: line.start,
      end: line.end,
      text: line.text,
    });
  }
  return Object.freeze({ source, validity: Object.freeze(validity), lines: Object.freeze(lines), tables: Object.freeze(tables), assignments: Object.freeze(assignments), spans: Object.freeze(lexical.spans) });
}

function classifyOffset(analysis, offset) {
  const span = analysis.spans.find((candidate) => candidate.start <= offset && offset < candidate.end);
  if (span) return span.type === 'comment' ? 'toml-comment' : 'toml-string';
  const assignment = analysis.assignments.find((candidate) => candidate.start <= offset && offset < candidate.end);
  if (assignment) return 'toml-structural';
  const table = analysis.tables.find((candidate) => candidate.start <= offset && offset < candidate.end);
  if (table) return 'toml-table';
  return 'toml-structural';
}

module.exports = Object.freeze({
  analyseToml,
  classifyOffset,
  lineRecords,
  parseDottedKey,
  validateToml,
});
