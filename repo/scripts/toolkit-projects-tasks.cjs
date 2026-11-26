#!/usr/bin/env node
'use strict';

// Renders and checks the scheduled task prompts a Claude Projects coordinator runs (the daily
// check-in, the hourly nudge and the shell around a project's own tasks), and checks the two
// memory lines Toolkit defines. Read-only: it prints to stdout and never writes a prompt, a task
// or memory.
// The two Toolkit tasks store a ping: one Toolkit block (TASK-PING) and the params block, nothing
// else. Each run stamps itself and posts one line, and the coordinator works the task's checklist
// from the guidebook copy; project additions live in <report_dir>/project-additions.md. A pointer
// or a full prompt from before pings checks outdated; --refresh turns it into the ping only once
// its project additions are saved (--additions-from prints them, --additions-saved proves the save).
// A hand-made prompt (no Toolkit blocks) has no project section the script can read back, so its saved
// file need only be non-empty.
// Until every project swaps, --expand for a Toolkit task prints the ping with a TASKS OUTDATED
// prefix, so an unswapped pointer runs as a ping and asks for its swap.
// A project's own (custom) task stores a pointer: one Toolkit block (TASK-POINTER), the params
// block and the project layer (every line outside the block). Each run loads its instructions with
// --expand from Toolkit main, so a release reaches it without touching its stored prompt.
// Both are checked by their text, not their version stamp.
//
//   --render <kind> --params <file> [--project-text <file>]   the stored prompt (custom: needs its text)
//   --expand <kind> --params <file>                            this run's Toolkit instructions
//   --name <kind> --params <file>                              the task name
//   --check <kind> <prompt-file>        current | outdated | edited | missing | misplaced | malformed
//   --refresh <kind> <prompt-file> [--params <file>] [--project-text <file>] [--session <bound|fresh>]
//             [--additions-saved <file>]
//                                       the refreshed prompt; a Toolkit task needs --session, the
//                                       session its replacement runs in, so a swap always sets it
//   --additions-from <kind> <prompt-file>   the project additions a Toolkit task's old prompt holds
//   --params-from <prompt-file>         the params block found in a prompt
//   --check-memory <memory-file>        current, or one MEMORY FORMAT line per faulty Toolkit line
//   --upgrade-plan <read-back-file> --memory <memory-file> [--additions-saved <file>]
//                                       a takeover's upgrade plan for every task read back (JSON)
//   --upgrade-verify <plan-file> <read-back-file> [--unpaused <id>[,<id>...]]
//                                       checks the read-back after the swaps against that plan
//
// Exit 0 current or printed (a plan with nothing to do, a verified check), 1 needs a change, 2 malformed
// input or bad arguments.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FORMAT, bodyDigest, renderBlock, findBlocks, normalizeBody } = require('./toolkit-managed-block.cjs');

const TASKS_DIR = 'repo/contracts/claude-projects/web-controller-projects/tasks';
const VERSION_FILE = 'repo/contracts/toolkit-local-bridge/version.json';
const SOURCE = 'claude-projects';
const VERSION = /^\d+\.\d+\.\d+$/;
const FENCE_OPEN = /^```toolkit-task-params[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;

const KINDS = Object.freeze({
  'daily-check-in': { checks: { name: 'DAILY-CHECK-IN-CHECKS', file: 'daily-check-in.md' }, session: 'bound', title: 'Daily check-in', tier: 'mid' },
  'hourly-nudge': { checks: { name: 'HOURLY-NUDGE-CHECKS', file: 'hourly-nudge.md' }, session: 'bound', title: 'Hourly nudge', tier: 'mid' },
  custom: { checks: null, session: null, title: null, tier: 'small' }
});
const SHELL = Object.freeze({
  setup: { name: 'TASK-RUN-SETUP', file: 'run-setup.md' },
  delivery: { name: 'TASK-DELIVERY', file: 'delivery.md' }
});
const POINTER = Object.freeze({ name: 'TASK-POINTER', file: 'pointer.md' });
const PING = Object.freeze({ name: 'TASK-PING', file: 'ping.md' });
const pinged = kind => Boolean(KINDS[kind].checks);
const CUSTOM_CHECKS = "CHECKS\n- This task's own steps are the project additions in its stored prompt. Run them in order.";
const PROJECT_HEADING = 'Project additions (kept on every refresh; they override the Toolkit base where they differ):';
const KEPT_LABEL = '(kept from an edit inside the block)';
const NO_PROJECT_TEXT = 'a Toolkit task takes no project text; its project lines go to project-additions.md';

const TIERS = Object.freeze(['small', 'mid', 'top']);
const EFFORTS = Object.freeze(['medium', 'high', 'xhigh', 'max']);
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
// A raise reason, in params and in memory alike: 3 to 200 printable ASCII characters with no
// | ; { } or backtick, no leading or trailing space, and nothing that reads as the owner's stop or
// schedule mark in any case or spacing.
const OWNER_MARK = /stopped\W*by\W*(?:the\W*)?owner|owner\W*schedule/i;
function isReason(value) {
  return /^[\x20-\x3a\x3c-\x5f\x61-\x7a\x7e]{3,200}$/.test(value) && value.trim() === value && !OWNER_MARK.test(value);
}

const PARAMS = Object.freeze({
  project: { required: true, test: v => /^[A-Z0-9][A-Z0-9 _-]{0,39}$/.test(v) && !/ $/.test(v) },
  repo: { required: true, test: v => v === 'none' || REPO.test(v) },
  toolkit_repo: { fallback: 'weijunswj/ai-agent-toolkit', test: v => REPO.test(v) },
  parent_issue: { fallback: 'none', test: v => v === 'none' || /^[1-9]\d{0,6}$/.test(v) },
  report_dir: { required: true, test: v => /^\/mnt\/project-files\/[A-Za-z0-9._/-]+$/.test(v) && !v.split('/').includes('..') && !v.endsWith('/') && !v.includes('//') },
  // Medium is the effort floor (agent-cost-control); anything above medium needs raise_reason.
  effort: { required: true, test: v => EFFORTS.includes(v) },
  // The model tier; left out, it is the kind's default tier.
  model: { test: v => TIERS.includes(v) },
  raise_reason: { test: v => isReason(v) },
  // A custom task defaults to a fresh session; the two Toolkit tasks default to bound and take
  // session fresh only as the fallback, which is then kept in their params.
  session: { fallback: 'fresh', test: v => v === 'fresh' || v === 'bound' }
});

// rule: the plain reason a refused refresh names on stderr. It never repeats the input's own text.
class TaskInputError extends Error {
  constructor(code, rule) {
    super(code);
    this.rule = rule;
  }
}

function kindOf(kind) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new TaskInputError('TASK_KIND');
  return KINDS[kind];
}

// Strict params: known keys only, string values, every value matched against its own pattern.
function validateParams(kind, raw) {
  kindOf(kind);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TaskInputError('TASK_PARAMS', 'the params must be one JSON object');
  const params = {};
  for (const key of Object.keys(raw)) {
    const rule = Object.hasOwn(PARAMS, key) ? PARAMS[key] : undefined;
    if (!rule || (rule.customOnly && kind !== 'custom') || typeof raw[key] !== 'string') throw new TaskInputError('TASK_PARAMS', 'the params hold an unknown key, or a value that is not a string');
  }
  for (const [key, rule] of Object.entries(PARAMS)) {
    if (rule.customOnly && kind !== 'custom') continue;
    let fallback = key === 'session' && KINDS[kind].session ? KINDS[kind].session : rule.fallback;
    if (key === 'model') fallback = KINDS[kind].tier;
    const value = raw[key] === undefined ? fallback : raw[key];
    if (value === undefined && rule.required) throw new TaskInputError('TASK_PARAMS', `a required param is missing: ${key}`);
    if (value === undefined) continue;
    if (!rule.test(value)) throw new TaskInputError('TASK_PARAMS', `the param ${key} has a value the params rules do not allow`);
    if (key === 'session' && KINDS[kind].session && value === KINDS[kind].session) continue;
    params[key] = value;
  }
  // A step above the kind's default tier, or effort above medium, carries its written reason.
  const raised = TIERS.indexOf(params.model) > TIERS.indexOf(KINDS[kind].tier) || params.effort !== EFFORTS[0];
  if (raised && !params.raise_reason) throw new TaskInputError('TASK_PARAMS', 'a model tier above the kind default, or an effort above medium, needs raise_reason');
  return params;
}

function paramsFence(params) {
  return ['```toolkit-task-params', JSON.stringify(params, null, 2), '```'].join('\n');
}

function taskName(kind, params) {
  const { title } = kindOf(kind);
  if (!title) throw new TaskInputError('TASK_KIND');
  return `${params.project}: ${title}`;
}

// Keep the kind visible and hash the complete identity, before any readable normalisation.
function taskSlug(kind, params) {
  const project = params.project.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const digest = createHash('sha256').update(JSON.stringify([kind, params.project, params.report_dir])).digest('hex').slice(0, 10);
  return `${kind}-${project}-${digest}`;
}

// Template lines may start with a condition tag: [repo], [no-repo], [parent], [toolkit], [fresh], [bound], [raised].
// [toolkit] is the project whose repo is the Toolkit repo itself.
// Placeholders are {{name}}; an unknown placeholder or tag is a broken source.
function fill(template, kind, params, extra = {}) {
  const session = params.session || KINDS[kind].session;
  const values = {
    ...params,
    kind,
    task_name: KINDS[kind].title ? taskName(kind, params) : 'this task',
    task_slug: taskSlug(kind, params),
    checkin_name: `${params.project}: ${KINDS['daily-check-in'].title}`,
    nudge_name: `${params.project}: ${KINDS['hourly-nudge'].title}`
  };
  const conditions = {
    repo: params.repo !== 'none', 'no-repo': params.repo === 'none', parent: params.parent_issue !== 'none',
    toolkit: params.repo === params.toolkit_repo,
    fresh: session === 'fresh', bound: session === 'bound', raised: Boolean(params.raise_reason),
    pointer: extra.pointer === true
  };
  const lines = [];
  for (const line of normalizeBody(template).split('\n')) {
    const tag = /^\[([a-z-]+)\]/.exec(line);
    if (tag) {
      if (!(tag[1] in conditions)) throw new Error('TASK_TEMPLATE');
      if (conditions[tag[1]]) lines.push(line.slice(tag[0].length));
      continue;
    }
    lines.push(line);
  }
  return lines.join('\n').replace(/\{\{([a-z_]+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error('TASK_TEMPLATE');
    return values[key];
  });
}

function lfText(text) {
  return String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

// The params fence: its lines, or null when absent. More than one, or an unclosed one, throws.
function findParams(text) {
  const lines = lfText(text).split('\n');
  const found = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!FENCE_OPEN.test(lines[index])) continue;
    const close = lines.findIndex((line, at) => at > index && FENCE_CLOSE.test(line));
    if (close === -1) throw new TaskInputError('TASK_PARAMS_FENCE');
    found.push({ startLine: index, endLine: close, json: lines.slice(index + 1, close).join('\n') });
    index = close;
  }
  if (found.length > 1) throw new TaskInputError('TASK_PARAMS_FENCE');
  return found[0] || null;
}

// A params block with no model key was rendered before tiers existed. It is migrated, not
// refused, so every live prompt still checks and refreshes: effort low rises to the medium floor,
// and effort above medium is kept with LEGACY_RAISE as its reason for the coordinator to confirm.
const LEGACY_RAISE = 'kept from the setting before tiers, confirm or lower it';

function migrateLegacy(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.hasOwn(raw, 'model')) return { raw, legacy: false };
  const next = { ...raw };
  if (next.effort === 'low') next.effort = EFFORTS[0];
  if (EFFORTS.slice(1).includes(next.effort) && next.raise_reason === undefined) next.raise_reason = LEGACY_RAISE;
  // Only a migration that changed a value rewrites the block; a medium prompt keeps it as it is.
  return { raw: next, legacy: next.effort !== raw.effort || next.raise_reason !== raw.raise_reason };
}

function storedParams(kind, text) {
  const fence = findParams(text);
  if (!fence) throw new TaskInputError('TASK_PARAMS_FENCE');
  let parsed;
  try { parsed = JSON.parse(fence.json); } catch { throw new TaskInputError('TASK_PARAMS'); }
  const { raw, legacy } = migrateLegacy(parsed);
  return { params: validateParams(kind, raw), legacy };
}

function parseParams(kind, text) {
  return storedParams(kind, text).params;
}

class ProjectsTasks {
  constructor({ root = path.resolve(__dirname, '../..'), readFile = fs.readFileSync } = {}) {
    this.root = root;
    this.readFile = readFile;
  }

  version() {
    const { version } = JSON.parse(this.readFile(path.join(this.root, VERSION_FILE), 'utf8'));
    if (!VERSION.test(version)) throw new Error('TASK_SOURCE');
    return version;
  }

  template(file) {
    const body = this.readFile(path.join(this.root, TASKS_DIR, file), 'utf8');
    const parsed = findBlocks(body);
    if (!body.trim() || parsed.blocks.length || parsed.errors.length) throw new Error('TASK_SOURCE');
    return body;
  }

  // The instructions each run loads (--expand), in order: run setup, the kind's checks, delivery.
  instructionBlocks(kind, params) {
    const { checks } = kindOf(kind);
    const version = this.version();
    const parts = [SHELL.setup, ...(checks ? [checks] : []), SHELL.delivery];
    return parts.map(part => ({ source: SOURCE, name: part.name, version, body: fill(this.template(part.file), kind, params) }));
  }

  pointerBlock(kind, params) {
    return { source: SOURCE, name: POINTER.name, version: this.version(), body: fill(this.template(POINTER.file), kind, params) };
  }

  pingBlock(kind, params) {
    return { source: SOURCE, name: PING.name, version: this.version(), body: fill(this.template(PING.file), kind, params) };
  }

  // The block a current stored prompt holds: the ping for a Toolkit task, the pointer for custom.
  storedBlock(kind, params) {
    return pinged(kind) ? this.pingBlock(kind, params) : this.pointerBlock(kind, params);
  }

  // The stored prompt. fenceText keeps a live prompt's own params block, byte for byte, on a refresh.
  // A ping carries no project text: its project additions live in <report_dir>/project-additions.md.
  render(kind, params, projectText, fenceText = paramsFence(params)) {
    if (pinged(kind)) {
      if (projectText !== undefined && lfText(projectText).trim()) throw new TaskInputError('TASK_PROJECT_TEXT', NO_PROJECT_TEXT);
      return [renderBlock(this.pingBlock(kind, params)), '', fenceText, ''].join('\n');
    }
    const project = normalizeProjectText(kind, projectText);
    return [renderBlock(this.pointerBlock(kind, params)), '', fenceText, '', project, ''].join('\n');
  }

  // What a run follows: plain text, no markers, read fresh from this checkout every run. A Toolkit
  // task only reaches this from an unswapped pointer, so it gets the ping, asking for its swap.
  expand(kind, params) {
    const label = KINDS[kind].title ? taskName(kind, params) : 'a project task';
    const header = `TOOLKIT TASK INSTRUCTIONS (${label}, toolkit ${this.version()})`;
    if (pinged(kind)) return [header, normalizeBody(fill(this.template(PING.file), kind, params, { pointer: true })).replace(/\n+$/, '')].join('\n\n') + '\n';
    const blocks = this.instructionBlocks(kind, params).map(block => normalizeBody(block.body).replace(/\n+$/, ''));
    blocks.splice(1, 0, CUSTOM_CHECKS);
    return [header, ...blocks].join('\n\n') + '\n';
  }

  check(kind, text) {
    return checkTask(kind, text, params => ({
      current: this.storedBlock(kind, params),
      legacy: [...(pinged(kind) ? [this.pointerBlock(kind, params)] : []), ...this.instructionBlocks(kind, params)]
    }));
  }

  // The project text of a stored prompt: every line outside the Toolkit blocks and the params block,
  // plus lines typed inside an edited block, labelled. An untouched default section counts as none.
  projectText(kind, lf, params) {
    const expected = [this.storedBlock(kind, params), this.pointerBlock(kind, params), ...this.instructionBlocks(kind, params)];
    const own = findBlocks(lf).blocks.filter(block => block.source === SOURCE);
    const kept = [];
    for (const block of own) {
      if (!tampered(block)) continue;
      const want = expected.find(entry => entry.name === block.name);
      const base = new Set(normalizeBody(want.body).split('\n').map(line => line.trim()));
      for (const line of normalizeBody(block.body).split('\n')) if (line.trim() && !base.has(line.trim())) kept.push(line);
    }
    let project = projectSegments(lf, own, findParams(lf)).join('\n\n');
    if (kept.length) project = [project, KEPT_LABEL, ...kept].filter(Boolean).join('\n');
    return project;
  }

  // The project additions a Toolkit task's stored prompt holds, to move into project-additions.md
  // before its swap: '' when there are none.
  additions(kind, text) {
    if (!pinged(kind)) throw new TaskInputError('TASK_KIND');
    const result = this.check(kind, text);
    if (result.state === 'malformed' || result.state === 'missing') throw new TaskInputError('TASK_MALFORMED');
    const lf = lfText(text);
    const project = this.projectText(kind, lf, storedParams(kind, lf).params);
    return project === `${PROJECT_HEADING}\n- none` ? '' : project;
  }

  // additions: the text of <report_dir>/project-additions.md as read back after the save. A Toolkit
  // task's prompt holding project additions refreshes only when that text holds them word for word; a
  // hand-made Toolkit prompt refreshes only with a non-empty saved file.
  refresh(kind, text, { params: override, projectText, session, additions } = {}) {
    const result = this.check(kind, text);
    if (result.state === 'malformed') throw new TaskInputError('TASK_MALFORMED', 'the prompt is malformed: a Toolkit block or the params block does not check');
    if (session !== undefined && (!KINDS[kind].session || !PARAMS.session.test(session))) throw new TaskInputError('TASK_ARGUMENTS', '--session applies to a Toolkit task only, and takes bound or fresh');
    if (additions !== undefined && !pinged(kind)) throw new TaskInputError('TASK_ARGUMENTS', '--additions-saved applies to a Toolkit task only');
    const withSession = params => (session === undefined ? params : validateParams(kind, { ...params, session }));
    if (result.state === 'missing') {
      if (!override) throw new TaskInputError('TASK_PARAMS', 'a prompt with no Toolkit blocks needs --params to render it');
      if (pinged(kind) && projectText !== undefined) throw new TaskInputError('TASK_ARGUMENTS', NO_PROJECT_TEXT);
      // A hand-made prompt has no project section to read back, so its saved file is checked for presence only.
      if (pinged(kind) && (additions === undefined || !lfText(additions).trim())) {
        throw new TaskInputError('TASK_ADDITIONS_UNSAVED', 'a hand-made Toolkit task needs project-additions.md saved first: write its project lines in it word for word, or the line "- none" when it has none; then pass that file as --additions-saved');
      }
      return this.render(kind, withSession(override), projectText);
    }
    if (override || projectText !== undefined) throw new TaskInputError('TASK_ARGUMENTS', '--params and --project-text apply only to a prompt with no Toolkit blocks');
    const lf = lfText(text);
    const { params: stored, legacy } = storedParams(kind, lf);
    const params = withSession(stored);
    let project = this.projectText(kind, lf, stored);
    if (pinged(kind)) {
      const moved = this.additions(kind, lf);
      if (moved && (additions === undefined || !lfText(additions).includes(moved))) throw new TaskInputError('TASK_ADDITIONS_UNSAVED', 'the saved additions file does not hold the project additions word for word');
      project = undefined;
    }
    const fence = findParams(lf);
    // A session change or a legacy migration rewrites the params block; otherwise it is kept byte for byte.
    const fenceText = params.session === stored.session && !legacy ? lf.split('\n').slice(fence.startLine, fence.endLine + 1).join('\n') : paramsFence(params);
    return this.render(kind, params, project, fenceText);
  }
}

// A v2 block whose body no longer matches its own digest was edited by hand.
function tampered(block) {
  return block.format >= 2 && block.digest !== bodyDigest(block.body);
}

function normalizeProjectText(kind, projectText) {
  const text = projectText === undefined ? '' : lfText(projectText).replace(/^\n+|\n+$/g, '');
  if (findBlocks(text).blocks.length || findBlocks(text).errors.length) throw new TaskInputError('TASK_PROJECT_TEXT', 'the project text holds a Toolkit block');
  if (text.split('\n').some(line => FENCE_OPEN.test(line))) throw new TaskInputError('TASK_PROJECT_TEXT', 'the project text holds a params block line');
  if (text) return text;
  if (kind === 'custom') throw new TaskInputError('TASK_PROJECT_TEXT', 'a custom task needs its own steps as project text');
  return `${PROJECT_HEADING}\n- none`;
}

// Every run of text outside the Toolkit blocks and the params fence, in order, without its
// surrounding blank lines. Bytes inside each run are kept as they are.
function projectSegments(lf, own, fence) {
  const lines = lf.split('\n');
  const skip = new Set();
  const lineOf = offset => lf.slice(0, offset).split('\n').length - 1;
  for (const block of own) for (let at = lineOf(block.start); at <= lineOf(block.end); at += 1) skip.add(at);
  if (fence) for (let at = fence.startLine; at <= fence.endLine; at += 1) skip.add(at);
  const segments = [];
  let current = [];
  lines.forEach((line, index) => {
    if (skip.has(index)) { segments.push(current); current = []; return; }
    current.push(line);
  });
  segments.push(current);
  return segments.map(segment => segment.join('\n').replace(/^\n+|\n+$/g, '')).filter(segment => segment.trim());
}

// States, worst first: malformed, edited, outdated, misplaced, current. missing = no Toolkit
// blocks at all (a hand-written prompt). The stored block (the ping, or a custom task's pointer) is
// current while its text matches main's, whatever release stamped it; an older shape is outdated
// (edited when touched), and so is a ping that still carries project text.
function checkTask(kind, text, expectedFor) {
  kindOf(kind);
  const lf = lfText(text);
  const { blocks, errors } = findBlocks(lf);
  const own = blocks.filter(block => block.source === SOURCE);
  if (errors.length) return { state: 'malformed', exitCode: 2 };
  let fence;
  try { fence = findParams(lf); } catch { return { state: 'malformed', exitCode: 2 }; }
  if (!own.length) return { state: 'missing', exitCode: 1 };
  if (!fence) return { state: 'malformed', exitCode: 2 };
  let expected;
  try { expected = expectedFor(parseParams(kind, lf)); } catch (error) {
    if (error instanceof TaskInputError) return { state: 'malformed', exitCode: 2 };
    throw error;
  }
  const legacyNames = new Set(expected.legacy.map(block => block.name));
  const stored = own.filter(block => block.name === expected.current.name);
  const legacy = own.filter(block => legacyNames.has(block.name));
  const pointers = own.filter(block => block.name === POINTER.name);
  if (stored.length + legacy.length !== own.length || stored.length > 1 || pointers.length > 1) return { state: 'malformed', exitCode: 2 };
  // A pointer that loads another kind's instructions, or a ping that stamps another kind's runs, is
  // another task's prompt, never this one's to refresh.
  const loads = pointers.length ? /toolkit-projects-tasks\.cjs --expand ([a-z-]+) /.exec(pointers[0].body) : null;
  if (loads && loads[1] !== kind) return { state: 'malformed', exitCode: 2 };
  if (stored.length && expected.current.name === PING.name && Object.keys(KINDS).some(other => other !== kind && stored[0].body.includes(`/task-runs/${other}-`))) return { state: 'malformed', exitCode: 2 };
  let state;
  if (own.some(tampered)) state = 'edited';
  else if (legacy.length || !stored.length || stored[0].format !== FORMAT || normalizeBody(stored[0].body) !== normalizeBody(expected.current.body)) state = 'outdated';
  else if (expected.current.name === PING.name && projectSegments(lf, own, fence).length) state = 'outdated';
  else state = inOrder(lf, stored[0], fence) ? 'current' : 'misplaced';
  return { state, exitCode: state === 'current' ? 0 : 1 };
}

// The stored block first (only blank lines before it), then the params block.
function inOrder(lf, pointer, fence) {
  const lineOf = offset => lf.slice(0, offset).split('\n').length - 1;
  return !lf.slice(0, pointer.start).trim() && fence.startLine > lineOf(pointer.end);
}

// The two memory lines Toolkit defines. Nothing else in memory is read.
const BINDING_LINE = /^[-*\s]*BINDING: [A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+ \S+ commit [0-9a-f]{40} CONTROLLER\.md blob [0-9a-f]{40} toolkit \d+\.\d+\.\d+ skill \S+ bound \S+\s*$/;
const TASK_ENTRY = /^(?<name>[^|;]+?) \| (?<id>trig_[A-Za-z0-9]+) \| (?<cron>[^|;]+?) \| (?<mode>fresh|local|device|bound home cmsg_[A-Za-z0-9]+ since \d{4}-\d{2}-\d{2})(?: \| owner schedule)?(?: \| raised (?:small|mid|top)\/(?:medium|high|xhigh|max) \d{4}-\d{2}-\d{2}: (?<reason>[\x20-\x3a\x3c-\x5f\x61-\x7a\x7e]+?))?(?: \| stopped by owner \d{4}-\d{2}-\d{2})?$/;

function validEntry(entry) {
  const match = TASK_ENTRY.exec(entry);
  return Boolean(match) && (match.groups.reason === undefined || isReason(match.groups.reason));
}

function checkMemory(text) {
  // Only LF and CRLF end a line: a lone CR or a Unicode line break stays inside its line and fails it.
  const lines = String(text).replace(/^\uFEFF/, '').split('\n').map(line => line.replace(/\r$/, ''));
  const faults = [];
  const binding = lines.filter(line => /^[-*\s]*BINDING:/.test(line));
  if (!binding.length) faults.push('MEMORY FORMAT: BINDING missing');
  else if (binding.length > 1) faults.push('MEMORY FORMAT: BINDING more than one line');
  else if (!BINDING_LINE.test(binding[0])) faults.push('MEMORY FORMAT: BINDING old format');
  const tasks = lines.filter(line => /^[-*\s]*SCHEDULED TASKS:/.test(line));
  if (!tasks.length) faults.push('MEMORY FORMAT: SCHEDULED TASKS missing');
  else if (tasks.length > 1) faults.push('MEMORY FORMAT: SCHEDULED TASKS more than one line');
  else {
    const entries = tasks[0].replace(/^[-*\s]*SCHEDULED TASKS:\s*/, '').trim().split(';').map(entry => entry.trim()).filter(Boolean);
    if (!entries.length || /[\r\u0085\u2028\u2029]/.test(tasks[0]) || entries.some(entry => !validEntry(entry))) faults.push('MEMORY FORMAT: SCHEDULED TASKS old format');
  }
  return faults.length ? { lines: faults, exitCode: 1 } : { lines: ['current'], exitCode: 0 };
}

// ---- The upgrade at a takeover ----
//
// A takeover reads the project's scheduled tasks back with the host's own tool (get_trigger for each,
// copied into one read-back file) and plans their upgrade here: per task current, outdated with the
// exact replacement prompt, waiting for its project additions to be saved first, hand-made, damaged,
// not Toolkit's, or stopped by the owner (never touched); and the paused ones, listed for one unpause
// question. The coordinator swaps in place as reference/recurring-tasks.md says (a paused task stays
// paused), unpauses only the ones the owner names, reads every task back again and checks that second
// read-back against the plan with --upgrade-verify. Nothing here calls the host or writes a task.

const READ_BACK_SCHEMA = 'toolkit.projects-task-read-back.v1';
const PLAN_SCHEMA = 'toolkit.projects-task-plan.v1';
const TASK_ID = /^trig_[A-Za-z0-9]{1,64}$/;
const MAX_TASKS = 50;
const MAX_PROMPT = 64 * 1024;
const READ_BACK_KEYS = Object.freeze(['id', 'name', 'enabled', 'cron', 'prompt']);
// A task the plan leaves as it is must read back with the same prompt (line ends aside).
const promptDigest = prompt => createHash('sha256').update(lfText(prompt)).digest('hex');
// Control, line-break and hidden (format) characters, and the spaces that look like a plain one: a reader
// could see a line or a mark here that another reader does not.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u;
const plainText = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max && value.trim() === value && !HIDDEN.test(value);

// The read-back, default-deny: one object with the schema and a list of tasks, each exactly the five
// keys with their own types, ids unique. Anything else refuses the whole file.
function readBack(raw) {
  const refuse = () => { throw new TaskInputError('TASK_READ_BACK', 'the read-back must be one JSON object with the schema and a tasks list, each task exactly id, name, enabled, cron and prompt, a name and cron with no control, line-break or hidden character'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join() !== 'schema,tasks' || raw.schema !== READ_BACK_SCHEMA || !Array.isArray(raw.tasks) || raw.tasks.length > MAX_TASKS) refuse();
  const seen = new Set();
  for (const task of raw.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task) || Object.keys(task).sort().join() !== [...READ_BACK_KEYS].sort().join()) refuse();
    if (!TASK_ID.test(task.id) || seen.has(task.id) || !plainText(task.name, 200) || typeof task.enabled !== 'boolean' || !plainText(task.cron, 100)
      || typeof task.prompt !== 'string' || task.prompt.length > MAX_PROMPT) refuse();
    seen.add(task.id);
  }
  return raw.tasks;
}

// The ids the SCHEDULED TASKS memory line marks stopped by owner. A line Toolkit cannot read stops the
// plan: a task the owner stopped must never be swapped by mistake.
function stoppedIds(memory) {
  if (memory === undefined) throw new TaskInputError('TASK_MEMORY', 'an upgrade plan needs the project memory (--memory), so a task the owner stopped is never planned as a swap');
  const lines = String(memory).replace(/^\uFEFF/, '').split('\n').map(line => line.replace(/\r$/, '')).filter(line => /^[-*\s]*SCHEDULED TASKS:/.test(line));
  if (lines.length !== 1) throw new TaskInputError('TASK_MEMORY', 'the memory file must hold exactly one SCHEDULED TASKS line');
  // What --check-memory accepts, less control, line-break and hidden characters, which could hide a stop mark.
  if (HIDDEN.test(lines[0].replace(/\t/g, ' '))) throw new TaskInputError('TASK_MEMORY', 'the SCHEDULED TASKS line holds a control, line-break or hidden character; retype it');
  const entries = lines[0].replace(/^[-*\s]*SCHEDULED TASKS:\s*/, '').split(';').map(entry => entry.trim()).filter(Boolean);
  if (entries.some(entry => !validEntry(entry))) throw new TaskInputError('TASK_MEMORY', 'the SCHEDULED TASKS line is not in the current format; fix it with --check-memory first');
  return new Set(entries.filter(entry => / \| stopped by owner \d{4}-\d{2}-\d{2}$/.test(entry)).map(entry => TASK_ENTRY.exec(entry).groups.id));
}

class TaskUpgradePlanner {
  #tasks;

  constructor({ tasks = new ProjectsTasks() } = {}) {
    this.#tasks = tasks;
  }

  // The kind a read-back task is, by its name for the two Toolkit tasks and by its pointer for a
  // project's own task; null when it is not Toolkit's.
  #kindOf(task) {
    for (const kind of ['daily-check-in', 'hourly-nudge']) if (task.name.endsWith(`: ${KINDS[kind].title}`)) return kind;
    return findBlocks(lfText(task.prompt)).blocks.some(block => block.source === SOURCE && block.name === POINTER.name) ? 'custom' : null;
  }

  // { schema, toolkit, tasks: [{ id, name, kind, state, paused, replacement?, additions?, why? }], unpause }
  // `additions` is the text of <report_dir>/project-additions.md as read back, when it was saved.
  plan(raw, { memory, additions } = {}) {
    const stopped = stoppedIds(memory);
    const rows = readBack(raw).map(task => {
      const row = { id: task.id, name: task.name, cron: task.cron, prompt_sha256: promptDigest(task.prompt), kind: this.#kindOf(task), paused: !task.enabled };
      if (stopped.has(task.id)) return { ...row, state: 'stopped', why: 'stopped by owner: never swapped, rebuilt or unpaused; only the owner restarts it' };
      if (!row.kind) return { ...row, state: 'not-toolkit', why: 'no Toolkit block: the project\'s own task, left as it is' };
      const { state } = this.#tasks.check(row.kind, task.prompt);
      if (state === 'current') return { ...row, state };
      if (state === 'malformed') return { ...row, state: 'damaged', why: 'a Toolkit block or the params block does not check: rebuild it by hand from --render' };
      if (state === 'missing') return { ...row, state: 'hand-made', why: 'no Toolkit block: render it with --refresh and its --params, after saving its project additions' };
      const lf = lfText(task.prompt);
      const moved = pinged(row.kind) ? this.#tasks.additions(row.kind, lf) : '';
      if (moved && (additions === undefined || !lfText(additions).includes(moved))) return { ...row, state: 'additions-unsaved', additions: moved, why: 'save these lines to <report_dir>/project-additions.md word for word, read it back, then plan again with --additions-saved' };
      const session = pinged(row.kind) ? storedParams(row.kind, lf).params.session || KINDS[row.kind].session : undefined;
      const replacement = this.#tasks.refresh(row.kind, task.prompt, { session, additions: moved ? additions : undefined });
      return { ...row, state: 'outdated', from: state, replacement };
    });
    const paused = rows.filter(row => row.paused && row.state !== 'stopped' && row.state !== 'not-toolkit');
    return {
      schema: PLAN_SCHEMA, toolkit: this.#tasks.version(), tasks: rows,
      unpause: paused.length ? { ids: paused.map(row => row.id), question: `Unpause ${paused.map(row => `"${row.name}"`).join(', ')}? ${paused.length === 1 ? 'It is' : 'They are'} paused now${rows.some(row => row.paused && row.replacement) ? ', and an upgrade keeps a paused task paused' : ''}. Reply with the ones to unpause, all, or none.` } : null,
    };
  }

  // Checks the second read-back, taken after the swaps and the owner's unpauses, against the plan:
  // every planned replacement is the stored prompt, every other prompt is as it was, nothing else moved, and a task is
  // enabled only where it was, or where the owner said to unpause it (`unpaused`, ids).
  verify(plan, raw, { unpaused = [] } = {}) {
    if (!plan || plan.schema !== PLAN_SCHEMA || !Array.isArray(plan.tasks)) throw new TaskInputError('TASK_PLAN', 'the plan file is not one --upgrade-plan wrote');
    const after = new Map(readBack(raw).map(task => [task.id, task]));
    const named = new Set(unpaused);
    for (const id of named) if (!plan.unpause || !plan.unpause.ids.includes(id)) throw new TaskInputError('TASK_ARGUMENTS', '--unpaused names only tasks the plan listed as paused');
    const rows = plan.tasks.map(row => {
      const task = after.get(row.id);
      const wrong = [];
      if (!task) wrong.push('it is not in the read-back');
      else {
        if (task.name !== row.name) wrong.push('its name changed');
        if (task.cron !== row.cron) wrong.push('its schedule changed');
        if (row.replacement !== undefined && lfText(task.prompt) !== lfText(row.replacement)) wrong.push('its prompt is not the planned replacement');
        // A hand-made or damaged task is rendered by hand (reference/recurring-tasks.md): it may change, to a prompt that checks current.
        const byHand = ['hand-made', 'damaged'].includes(row.state) && this.#tasks.check(row.kind, task.prompt).state === 'current';
        if (row.replacement === undefined && promptDigest(task.prompt) !== row.prompt_sha256 && !byHand) wrong.push(['hand-made', 'damaged'].includes(row.state) ? 'its prompt changed, and it does not check current' : 'its prompt changed, and the plan changes none here');
        const enabled = !row.paused || named.has(row.id);
        if (task.enabled !== enabled) wrong.push(enabled ? 'it is still paused' : 'it is no longer paused');
      }
      return { id: row.id, name: row.name, verified: !wrong.length, ...(wrong.length ? { why: wrong.join('; ') } : {}) };
    });
    // A task the plan does not hold (a create retried twice, say) is reported too: the read-back must hold exactly the plan.
    const planned = new Set(plan.tasks.map(row => row.id));
    for (const [id, task] of after) if (!planned.has(id)) rows.push({ id, name: task.name, verified: false, why: 'it is not in the plan' });
    return { verified: rows.every(row => row.verified), tasks: rows };
  }
}

function parseArgs(args) {
  const [mode, ...rest] = args;
  const options = {};
  const take = (allowed) => {
    const positional = [];
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg.startsWith('--')) {
        if (!allowed.includes(arg) || options[arg] !== undefined || !rest[index + 1] || rest[index + 1].startsWith('--')) throw new TaskInputError('TASK_ARGUMENTS', 'an option is unknown, repeated or has no value');
        options[arg] = rest[index += 1];
      } else positional.push(arg);
    }
    return positional;
  };
  const kindArg = value => { kindOf(value); return value; };
  if (mode === '--render' || mode === '--name' || mode === '--expand') {
    const positional = take(mode === '--render' ? ['--params', '--project-text'] : ['--params']);
    if (positional.length !== 1 || !options['--params']) throw new TaskInputError('TASK_ARGUMENTS');
    return { mode: mode.slice(2), kind: kindArg(positional[0]), params: options['--params'], projectText: options['--project-text'] };
  }
  if (mode === '--check' || mode === '--refresh' || mode === '--additions-from') {
    const positional = take(mode === '--refresh' ? ['--params', '--project-text', '--session', '--additions-saved'] : []);
    if (positional.length !== 2) throw new TaskInputError('TASK_ARGUMENTS', 'a refresh takes a task kind and one prompt file');
    const kind = kindArg(positional[0]);
    if (mode === '--refresh' && KINDS[kind].session && !options['--session']) throw new TaskInputError('TASK_ARGUMENTS', 'a Toolkit task refresh needs --session bound or fresh, the session its replacement runs in');
    return { mode: mode.slice(2), kind, file: positional[1], params: options['--params'], projectText: options['--project-text'], session: options['--session'], additions: options['--additions-saved'] };
  }
  if (mode === '--upgrade-plan') {
    const positional = take(['--memory', '--additions-saved']);
    if (positional.length !== 1) throw new TaskInputError('TASK_ARGUMENTS', 'an upgrade plan takes one read-back file');
    if (!options['--memory']) throw new TaskInputError('TASK_ARGUMENTS', 'an upgrade plan needs --memory with the project memory, so a task the owner stopped is never planned as a swap');
    return { mode: 'upgrade-plan', file: positional[0], memory: options['--memory'], additions: options['--additions-saved'] };
  }
  if (mode === '--upgrade-verify') {
    const positional = take(['--unpaused']);
    if (positional.length !== 2) throw new TaskInputError('TASK_ARGUMENTS', 'an upgrade check takes the plan file and the second read-back file');
    const unpaused = options['--unpaused'] === undefined ? [] : options['--unpaused'].split(',');
    if (unpaused.some(id => !TASK_ID.test(id))) throw new TaskInputError('TASK_ARGUMENTS', '--unpaused takes task ids, comma separated');
    return { mode: 'upgrade-verify', plan: positional[0], file: positional[1], unpaused };
  }
  if (mode === '--params-from' || mode === '--check-memory') {
    const positional = take([]);
    if (positional.length !== 1) throw new TaskInputError('TASK_ARGUMENTS');
    return { mode: mode.slice(2), file: positional[0] };
  }
  throw new TaskInputError('TASK_ARGUMENTS');
}

// A run's params file is copied from its stored prompt, which any older release may have written,
// while --expand always runs main's script. So --expand reads tolerantly: it migrates pre-tier params
// the way a refresh would and drops keys it no longer knows, then validates the rest as strictly as
// ever. Readers before writers: a new or renamed param must stay optional here (with a fallback) for
// as long as stored prompts may lack it, or every unswapped task fails to load.
function readParamsFile(kind, file, { tolerant = false } = {}) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new TaskInputError('TASK_PARAMS', 'the --params file could not be read as JSON'); }
  if (!tolerant) return validateParams(kind, raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TaskInputError('TASK_PARAMS');
  const known = Object.fromEntries(Object.entries(raw).filter(([key]) => Object.hasOwn(PARAMS, key)));
  return validateParams(kind, migrateLegacy(known).raw);
}

function readJson(file, code = 'TASK_READ_BACK') {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { throw new TaskInputError(code, 'the file could not be read as JSON'); }
}

const GENERIC_REFUSAL = 'Task prompt could not be processed (PROJECT_TASKS_INVALID).\n';

// A refused refresh also names its task (the kind, when it is a known one) and the rule it broke.
// Every other failure prints the generic line only.
// The task kind of a --refresh: its first positional argument, past any options and their values.
function refreshKind(args) {
  if (args[0] !== '--refresh') return undefined;
  for (let index = 1; index < args.length; index += 1) {
    if (!String(args[index]).startsWith('--')) return args[index];
    index += 1;
  }
  return undefined;
}

function refusal(args, error) {
  if (['--upgrade-plan', '--upgrade-verify'].includes(args[0]) && error instanceof TaskInputError && error.rule) return `${GENERIC_REFUSAL}Upgrade ${args[0] === '--upgrade-plan' ? 'plan' : 'check'} refused (${error.message}): ${error.rule}.
`;
  const kind = refreshKind(args);
  if (!(error instanceof TaskInputError) || !error.rule || !Object.hasOwn(KINDS, kind)) return GENERIC_REFUSAL;
  return `${GENERIC_REFUSAL}Refresh of ${kind} refused (${error.message}): ${error.rule}.\n`;
}

function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    const tasks = new ProjectsTasks();
    const read = file => (file === undefined ? undefined : fs.readFileSync(file, 'utf8'));
    let output;
    let exitCode = 0;
    if (options.mode === 'render') output = tasks.render(options.kind, readParamsFile(options.kind, options.params), read(options.projectText));
    else if (options.mode === 'expand') output = tasks.expand(options.kind, readParamsFile(options.kind, options.params, { tolerant: true }));
    else if (options.mode === 'name') output = `${taskName(options.kind, readParamsFile(options.kind, options.params))}\n`;
    else if (options.mode === 'check') {
      const result = tasks.check(options.kind, read(options.file));
      output = `${result.state}\n`;
      exitCode = result.exitCode;
    } else if (options.mode === 'refresh') {
      output = tasks.refresh(options.kind, read(options.file), {
        params: options.params === undefined ? undefined : readParamsFile(options.kind, options.params),
        projectText: read(options.projectText),
        session: options.session,
        additions: read(options.additions)
      });
    } else if (options.mode === 'additions-from') {
      const moved = tasks.additions(options.kind, read(options.file));
      output = moved ? `${moved}\n` : '';
    } else if (options.mode === 'upgrade-plan') {
      const plan = new TaskUpgradePlanner({ tasks }).plan(readJson(options.file), { memory: read(options.memory), additions: read(options.additions) });
      output = `${JSON.stringify(plan, null, 2)}
`;
      exitCode = plan.unpause || plan.tasks.some(row => !['current', 'stopped', 'not-toolkit'].includes(row.state)) ? 1 : 0;
    } else if (options.mode === 'upgrade-verify') {
      const result = new TaskUpgradePlanner({ tasks }).verify(readJson(options.plan, 'TASK_PLAN'), readJson(options.file), { unpaused: options.unpaused });
      output = `${JSON.stringify(result, null, 2)}
`;
      exitCode = result.verified ? 0 : 1;
    } else if (options.mode === 'params-from') {
      const fence = findParams(read(options.file));
      if (!fence) throw new TaskInputError('TASK_PARAMS_FENCE');
      let raw;
      try { raw = JSON.parse(fence.json); } catch { throw new TaskInputError('TASK_PARAMS'); }
      output = `${JSON.stringify(raw, null, 2)}\n`;
    } else {
      const result = checkMemory(read(options.file));
      output = `${result.lines.join('\n')}\n`;
      exitCode = result.exitCode;
    }
    process.stdout.write(output);
    return exitCode;
  } catch (error) {
    process.stderr.write(refusal(args, error));
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ ProjectsTasks, TaskUpgradePlanner, READ_BACK_SCHEMA, PLAN_SCHEMA, KINDS, LEGACY_RAISE, PROJECT_HEADING, KEPT_LABEL, validateParams, taskName, checkTask, checkMemory, parseArgs, fill });
