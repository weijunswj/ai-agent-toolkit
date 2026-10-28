#!/usr/bin/env node
'use strict';

// Claude Code PreToolUse hook for the Claude Projects thread launch tool (start_thread). It holds the coordinator to
// the pinned gate route when it starts a gate thread, so a tool default (a cloud thread at medium effort) never
// replaces the owner's project rules:
// - Gate line: a launch brief that runs a gate carries one line `Gate: <value>` (bold `**Gate:**` too, any case; the
//   first such line outside code fences counts). Values: G0, G1, G2 (also G2 recheck, recheck, re-check and delta
//   review, all G2, optionally naming `reviewer <id>`), design challenge, and none for a thread that runs no gate.
//   With no Gate line, a gate word in the title or brief (G0, G1 or G2, gate, recheck or re-check, and upper-case
//   DISCOVERY or BUILDER) refuses the launch until the brief says which gate it is, or none. A brief with neither
//   passes untouched.
// - Route: a gate maps to its stack registry route (G0 DISCOVERY, G1 BUILDER, G2 the profile's reviewer, design
//   challenge DESIGN_CHALLENGE) in the profile named by the project's `GATE ROUTE:` memory line,
//   `GATE ROUTE: profile <profile> placement <remote_control|cloud|any> [folder <path>]`. The launch must pass effort
//   equal to the route's reasoning and a model equal to the route's model (claude-opus-5-5, claude-opus-5-5[1m] and
//   opus-5.5 all match opus-5.5; an alias such as opus never does). Placement remote_control needs a Remote Control
//   device in the named folder (case and trailing separators ignored on Windows paths), cloud needs no device or a
//   files device, and any is not checked. A route whose provider is not anthropic cannot run as a Projects thread.
// - Memory line: read from this session's transcript, the newest line in a successful read_memory result or in a
//   successful update_memory input (old-text fields skipped), whichever came later. A gate launch is refused when the
//   session never read project memory, when memory has no line, when the line or its profile is unknown, and when
//   the bundled stack registry cannot be read.
// Every refusal names each failing field with the exact values to pass. Limits: a brief that says `Gate: none` on a
// real gate, a wrong GATE ROUTE line and launches by other tools are not seen, and the bundled registry is not
// compared with a pinned revision; the gate's own start-record check stays the second line. Other tools, input it
// cannot read and a crash pass, and the hook is registered without `onFailure: "block"` so a hook that cannot start
// never stops every thread launch. It reads only its input, the transcript and the bundled registry, and writes
// nothing but its decision.
const fs = require('node:fs');
const path = require('node:path');

const START_TOOL = 'mcp__hearthbot__start_thread';
const READ_MEMORY = 'mcp__hearthbot__read_memory';
const UPDATE_MEMORY = 'mcp__hearthbot__update_memory';
const REGISTRY = path.join(__dirname, '..', 'contracts', 'controller-kernel', 'stack-registry-v3.json');
const GATE_LINE = /^\s*(?:[-*]\s+)?(?:\*\*gate:\*\*|\*\*gate:|gate:)\s*(.*)$/i;
const GATE_WORDS = [/\bG[012]\b/, /\bgate\b/i, /\brecheck\b/i, /\bre-check\b/i, /\bDISCOVERY\b/, /\bBUILDER\b/];
const GATE_VALUES = 'G0, G1, G2 (or G2 recheck, recheck, delta review), design challenge, or none';
const ROUTE_LINE = /GATE ROUTE:/;
const ROUTE_FORMAT = 'GATE ROUTE: profile <profile> placement <remote_control|cloud|any> [folder <path>]';
// Fields of an edit that hold the text being replaced, never the new memory.
const OLD_FIELD = /^(?:old|old_?str(?:ing)?|old_?text|find|search|remove|delete)/i;

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

// The lines of a brief with fenced code (``` or ~~~ at a line start, to its closing fence or the end) blanked.
function linesOutsideFences(text) {
  const out = [];
  let fence = null;
  for (const line of textOf(text).split(/\r\n|\r|\n/)) {
    const marker = line.match(/^[ \t]{0,3}(```|~~~)/);
    if (fence) {
      if (marker && marker[1] === fence) fence = null;
      out.push('');
    } else if (marker) {
      fence = marker[1];
      out.push('');
    } else out.push(line);
  }
  return out;
}

// The gate a brief declares: { gate, reviewer } with gate one of G0, G1, G2, DESIGN_CHALLENGE or NONE, { unknown }
// for a Gate line with any other value, or null with no Gate line.
function gateDeclaration(instructions) {
  for (const line of linesOutsideFences(instructions)) {
    const match = line.match(GATE_LINE);
    if (!match) continue;
    const value = match[1].replace(/^\*\*\s*/, '').trim();
    const reviewer = value.match(/\breviewer\s+([A-Za-z0-9_.-]+)/i)?.[1] || null;
    if (/^G0\b/i.test(value)) return { gate: 'G0', reviewer: null };
    if (/^G1\b/i.test(value)) return { gate: 'G1', reviewer: null };
    if (/^(?:G2\b|re-?check\b|delta review\b)/i.test(value)) return { gate: 'G2', reviewer };
    if (/^design challenge\b/i.test(value)) return { gate: 'DESIGN_CHALLENGE', reviewer: null };
    if (/^none\b/i.test(value)) return { gate: 'NONE', reviewer: null };
    return { unknown: value.slice(0, 60) };
  }
  return null;
}

// The first gate word in a launch's title or brief, or ''.
function gateWord(title, instructions) {
  for (const text of [textOf(title), textOf(instructions)]) {
    for (const word of GATE_WORDS) {
      const found = text.match(word);
      if (found) return found[0];
    }
  }
  return '';
}

// A model name in one form: lower case, no claude- prefix, no [context] tag, dots as dashes.
function normaliseModel(model) {
  return textOf(model).trim().toLowerCase().replace(/^claude-/, '').replace(/\[[^\]]*\]$/, '').replace(/\./g, '-');
}

// The newest GATE ROUTE line in a text: { profile, placement, folder } (folder null when not named), { malformed }
// for a line that does not parse, or null when the text has none.
function gateRouteLine(text) {
  let found = null;
  for (const raw of textOf(text).split(/\r\n|\r|\n/)) {
    if (!ROUTE_LINE.test(raw)) continue;
    const line = raw.replace(/^.*?GATE ROUTE:/, 'GATE ROUTE:').replace(/[`\s]+$/, '');
    const match = line.match(/^GATE ROUTE:\s*profile\s+(\S+)\s+placement\s+(remote_control|cloud|any)(?:\s+folder\s+(\S.*))?$/);
    found = match ? { profile: match[1], placement: match[2], folder: match[3] ? match[3].trim() : null } : { malformed: line.slice(0, 120) };
  }
  return found;
}

function resultText(block) {
  if (typeof block.content === 'string') return block.content;
  if (!Array.isArray(block.content)) return '';
  return block.content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
}

// Every string in an update_memory input outside old-text fields, joined.
function newMemoryText(value, key = '') {
  if (OLD_FIELD.test(key)) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => newMemoryText(item)).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).map(([name, item]) => newMemoryText(item, name)).join('\n');
  return '';
}

// Walks the transcript: whether a read_memory call succeeded, and the newest GATE ROUTE line seen.
function readMemory(lines) {
  const pending = new Map();
  let read = false;
  let route = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (entry.type === 'assistant' && block?.type === 'tool_use' && (block.name === READ_MEMORY || block.name === UPDATE_MEMORY)) {
        pending.set(block.id, { name: block.name, input: block.input || {} });
      } else if (entry.type === 'user' && block?.type === 'tool_result' && pending.has(block.tool_use_id)) {
        const call = pending.get(block.tool_use_id);
        pending.delete(block.tool_use_id);
        if (block.is_error) continue;
        if (call.name === READ_MEMORY) read = true;
        const found = gateRouteLine(call.name === READ_MEMORY ? resultText(block) : newMemoryText(call.input));
        if (found) route = found;
      }
    }
  }
  return { read, route };
}

// A folder in one form for comparison: no trailing separators, and Windows paths in lower case with backslashes.
function normaliseFolder(folder) {
  const trimmed = textOf(folder).trim().replace(/[\\/]+$/, '');
  return /^[A-Za-z]:[\\/]|\\/.test(trimmed) ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed;
}

const GATE_NAMES = { G0: 'G0', G1: 'G1', G2: 'G2', DESIGN_CHALLENGE: 'design challenge' };
const ROLE = { G0: 'DISCOVERY', G1: 'BUILDER', DESIGN_CHALLENGE: 'DESIGN_CHALLENGE' };
const RULE = 'Toolkit Projects rule: gate route.';

// The route a gate takes in a registry profile, or a refusal reason.
function routeFor(declared, profileName, registry) {
  const profile = registry?.profiles?.[profileName];
  if (!profile || typeof profile !== 'object') {
    const known = Object.keys(registry?.profiles || {}).join(', ') || 'none';
    return { issue: `${RULE} The GATE ROUTE line names profile "${profileName}", which the stack registry does not have (known profiles: ${known}). Fix the GATE ROUTE line in project memory to name the project's pinned profile, then launch again.` };
  }
  if (declared.gate !== 'G2') {
    const route = profile.routes?.[ROLE[declared.gate]];
    return route ? { route, label: ROLE[declared.gate] } : { issue: `${RULE} Profile ${profileName} has no ${ROLE[declared.gate]} route in the stack registry, so this gate cannot start as a Projects thread. Run it in its own harness.` };
  }
  const reviewers = Array.isArray(profile.reviewers) ? profile.reviewers : [];
  const ids = reviewers.map(item => item?.reviewer_id).join(', ') || 'none';
  if (!reviewers.length) return { issue: `${RULE} Profile ${profileName} has no reviewer in the stack registry, so this G2 cannot start as a Projects thread.` };
  if (reviewers.length === 1) return { route: reviewers[0], label: `reviewer ${reviewers[0].reviewer_id}` };
  const named = reviewers.find(item => item?.reviewer_id === declared.reviewer);
  if (!named) return { issue: `${RULE} Profile ${profileName} has more than one reviewer (${ids}). Name the one this G2 runs on its Gate line, as \`Gate: G2 reviewer <id>\`, then launch again.` };
  return { route: named, label: `reviewer ${named.reviewer_id}` };
}

// The problems with a gate launch's fields, and the values that fix them.
function fieldIssues(input, route, line) {
  const wanted = { effort: route.reasoning, model: `claude-${textOf(route.model).replace(/\./g, '-')}` };
  const wrong = [];
  if (input.effort !== route.reasoning) wrong.push(`effort (got ${input.effort === undefined ? 'none' : JSON.stringify(input.effort)})`);
  if (input.model === undefined || normaliseModel(input.model) !== normaliseModel(route.model)) {
    wrong.push(`model (got ${input.model === undefined ? 'none' : JSON.stringify(input.model)})`);
  }
  const device = input.device && typeof input.device === 'object' ? input.device : null;
  const mode = device ? device.mode ?? 'files' : null;
  const got = device ? (mode === 'remote_control' ? `remote_control in ${JSON.stringify(device.folder ?? null)}` : mode) : 'cloud';
  let place = '';
  if (line.placement === 'remote_control') {
    const wantDevice = line.folder ? { mode: 'remote_control', folder: line.folder } : { mode: 'remote_control' };
    place = ` and device ${JSON.stringify(wantDevice)}`;
    const folderOk = !line.folder || normaliseFolder(device?.folder) === normaliseFolder(line.folder);
    if (mode !== 'remote_control' || !folderOk) wrong.push(`device (got ${got})`);
  } else if (line.placement === 'cloud') {
    place = ' and no device (a cloud thread)';
    if (device && mode !== 'files') wrong.push(`device (got ${got})`);
  }
  return { wrong, wanted, place };
}

function decide(input, { readLines = file => fs.readFileSync(file, 'utf8').split('\n'), readRegistry = () => JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) } = {}) {
  if (input?.tool_name !== START_TOOL) return '';
  const fields = input.tool_input;
  if (!fields || typeof fields !== 'object') return '';
  const declared = gateDeclaration(fields.instructions);
  if (declared?.unknown !== undefined) {
    return `${RULE} The brief's Gate line says "${declared.unknown}", which is not a gate value. Use one of ${GATE_VALUES}, then launch again.`;
  }
  if (!declared) {
    const word = gateWord(fields.title, fields.instructions);
    if (!word) return '';
    return `${RULE} The title or brief mentions "${word}" but the brief has no Gate line. Add one line \`Gate: <value>\` naming the gate this thread runs (${GATE_VALUES}), then launch again.`;
  }
  if (declared.gate === 'NONE') return '';
  let memory = { read: false, route: null };
  if (typeof input.transcript_path === 'string' && input.transcript_path) {
    try { memory = readMemory(readLines(input.transcript_path)); } catch { memory = { read: false, route: null }; }
  }
  const name = `This ${GATE_NAMES[declared.gate]}`;
  if (!memory.route && !memory.read) {
    return `${RULE} ${name} needs the project's GATE ROUTE line, and this session has not read project memory. Call read_memory, then launch again.`;
  }
  if (!memory.route) {
    return `${RULE} ${name} needs the project's GATE ROUTE line, and project memory has none. Add one line \`${ROUTE_FORMAT}\` with update_memory (it replaces the whole file, so keep every other line), taken from the project instructions' rule on where gates run and the project's pinned stack profile, then launch again.`;
  }
  if (memory.route.malformed !== undefined) {
    return `${RULE} The GATE ROUTE line "${memory.route.malformed}" does not read as \`${ROUTE_FORMAT}\`. Fix it with update_memory, then launch again.`;
  }
  let registry;
  try { registry = readRegistry(); } catch { registry = null; }
  if (!registry || typeof registry !== 'object' || !registry.profiles) {
    return `${RULE} The Toolkit stack registry bundled with this plugin cannot be read, so the route for this gate is unknown and the launch holds. Update or repair the Toolkit plugin, then launch again.`;
  }
  const { route, label, issue } = routeFor(declared, memory.route.profile, registry);
  if (issue) return issue;
  if (route.provider !== 'anthropic') {
    return `${RULE} ${name} (${label}, profile ${memory.route.profile}) runs on provider ${route.provider}, which cannot run as a Projects thread. Run it in its own harness.`;
  }
  const { wrong, wanted, place } = fieldIssues(fields, route, memory.route);
  if (!wrong.length) return '';
  return `${RULE} ${name} (${label}, profile ${memory.route.profile}) must start with effort ${JSON.stringify(wanted.effort)}, model ${JSON.stringify(wanted.model)}${place}. Missing or wrong: ${wrong.join(', ')}. The owner's project rules ask for these values on every gate. Pass those fields to start_thread and launch again.`;
}

function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); }
  catch { return 0; }
  let reason;
  try { reason = decide(input); }
  catch { return 0; }
  if (!reason) return 0;
  const decision = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.stderr.write(`${reason}\n`);
  return 2;
}

if (require.main === module) process.exitCode = main();

module.exports = { decide, gateDeclaration, normaliseModel, gateRouteLine };
