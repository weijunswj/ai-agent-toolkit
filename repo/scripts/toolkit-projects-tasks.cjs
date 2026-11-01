#!/usr/bin/env node
'use strict';

// Renders and checks the scheduled task prompts a Claude Projects coordinator runs (the daily
// check-in, the hourly nudge and the shell around a project's own tasks), and checks the two
// memory lines Toolkit defines. Read-only: it prints to stdout and never writes a prompt, a task
// or memory. A prompt has a Toolkit base (managed blocks) and a project layer (the params block
// and every line outside the blocks); a refresh replaces only the blocks.
//
//   --render <kind> --params <file> [--project-text <file>]   the full prompt
//   --name <kind> --params <file>                              the task name
//   --check <kind> <prompt-file>        current | outdated | edited | missing | misplaced | malformed
//   --refresh <kind> <prompt-file> [--params <file>] [--project-text <file>] [--session <bound|fresh>]
//                                       the refreshed prompt; a Toolkit task needs --session, the
//                                       session its replacement runs in, so a swap always sets it
//   --params-from <prompt-file>         the params block found in a prompt
//   --check-memory <memory-file>        current, or one MEMORY FORMAT line per faulty Toolkit line
//
// Exit 0 current or printed, 1 needs a change, 2 malformed input or bad arguments.
const fs = require('node:fs');
const path = require('node:path');
const { renderBlock, findBlocks, blockState, normalizeBody } = require('./toolkit-managed-block.cjs');

const TASKS_DIR = 'repo/contracts/claude-projects/web-controller-projects/tasks';
const VERSION_FILE = 'repo/contracts/toolkit-local-bridge/version.json';
const SOURCE = 'claude-projects';
const VERSION = /^\d+\.\d+\.\d+$/;
const FENCE_OPEN = /^```toolkit-task-params[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;

const KINDS = Object.freeze({
  'daily-check-in': { checks: { name: 'DAILY-CHECK-IN-CHECKS', file: 'daily-check-in.md' }, session: 'bound', title: 'Daily check-in', tier: 'mid' },
  'hourly-nudge': { checks: { name: 'HOURLY-NUDGE-CHECKS', file: 'hourly-nudge.md' }, session: 'bound', title: 'Hourly nudge', tier: 'small' },
  custom: { checks: null, session: null, title: null, tier: 'small' }
});
const SHELL = Object.freeze({
  setup: { name: 'TASK-RUN-SETUP', file: 'run-setup.md' },
  delivery: { name: 'TASK-DELIVERY', file: 'delivery.md' }
});
const OWN_NAMES = new Set([SHELL.setup.name, SHELL.delivery.name, ...Object.values(KINDS).filter(k => k.checks).map(k => k.checks.name)]);
const PROJECT_HEADING = 'Project additions (kept on every refresh; they override the Toolkit base where they differ):';
const KEPT_LABEL = '(kept from an edit inside the block)';

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

class TaskInputError extends Error {}

function kindOf(kind) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new TaskInputError('TASK_KIND');
  return KINDS[kind];
}

// Strict params: known keys only, string values, every value matched against its own pattern.
function validateParams(kind, raw) {
  kindOf(kind);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TaskInputError('TASK_PARAMS');
  const params = {};
  for (const key of Object.keys(raw)) {
    const rule = Object.hasOwn(PARAMS, key) ? PARAMS[key] : undefined;
    if (!rule || (rule.customOnly && kind !== 'custom') || typeof raw[key] !== 'string') throw new TaskInputError('TASK_PARAMS');
  }
  for (const [key, rule] of Object.entries(PARAMS)) {
    if (rule.customOnly && kind !== 'custom') continue;
    let fallback = key === 'session' && KINDS[kind].session ? KINDS[kind].session : rule.fallback;
    if (key === 'model') fallback = KINDS[kind].tier;
    const value = raw[key] === undefined ? fallback : raw[key];
    if (value === undefined && rule.required) throw new TaskInputError('TASK_PARAMS');
    if (value === undefined) continue;
    if (!rule.test(value)) throw new TaskInputError('TASK_PARAMS');
    if (key === 'session' && KINDS[kind].session && value === KINDS[kind].session) continue;
    params[key] = value;
  }
  // A step above the kind's default tier, or effort above medium, carries its written reason.
  const raised = TIERS.indexOf(params.model) > TIERS.indexOf(KINDS[kind].tier) || params.effort !== EFFORTS[0];
  if (raised && !params.raise_reason) throw new TaskInputError('TASK_PARAMS');
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

// The run stamp's file name under task-runs/: the task name for a Toolkit task, and the project
// plus its report folder for a custom one (whose name the prompt never carries), lower case with
// every other run of characters as one hyphen.
function taskSlug(kind, params) {
  const source = KINDS[kind].title ? taskName(kind, params) : `${params.project} ${path.posix.basename(params.report_dir)}`;
  return source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Template lines may start with a condition tag: [repo], [no-repo], [parent], [toolkit], [fresh], [bound], [raised].
// [toolkit] is the project whose repo is the Toolkit repo itself.
// Placeholders are {{name}}; an unknown placeholder or tag is a broken source.
function fill(template, kind, params) {
  const session = params.session || KINDS[kind].session;
  const values = {
    ...params,
    task_name: KINDS[kind].title ? taskName(kind, params) : 'this task',
    task_slug: taskSlug(kind, params),
    checkin_name: `${params.project}: ${KINDS['daily-check-in'].title}`,
    nudge_name: `${params.project}: ${KINDS['hourly-nudge'].title}`
  };
  const conditions = {
    repo: params.repo !== 'none', 'no-repo': params.repo === 'none', parent: params.parent_issue !== 'none',
    toolkit: params.repo === params.toolkit_repo,
    fresh: session === 'fresh', bound: session === 'bound', raised: Boolean(params.raise_reason)
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

  // The managed blocks this kind's prompt carries, in prompt order.
  expectedBlocks(kind, params) {
    const { checks } = kindOf(kind);
    const version = this.version();
    const parts = [SHELL.setup, ...(checks ? [checks] : []), SHELL.delivery];
    return parts.map(part => ({ source: SOURCE, name: part.name, version, body: fill(this.template(part.file), kind, params) }));
  }

  // fenceText keeps a live prompt's own params block, byte for byte, on a refresh.
  render(kind, params, projectText, fenceText = paramsFence(params)) {
    const [setup, ...rest] = this.expectedBlocks(kind, params).map(renderBlock);
    const delivery = rest.pop();
    const project = normalizeProjectText(kind, projectText);
    return [setup, '', fenceText, '', ...rest.flatMap(block => [block, '']), project, '', delivery, ''].join('\n');
  }

  check(kind, text) {
    return checkTask(kind, text, params => this.expectedBlocks(kind, params));
  }

  refresh(kind, text, { params: override, projectText, session } = {}) {
    const result = this.check(kind, text);
    if (result.state === 'malformed') throw new TaskInputError('TASK_MALFORMED');
    if (session !== undefined && (!KINDS[kind].session || !PARAMS.session.test(session))) throw new TaskInputError('TASK_ARGUMENTS');
    const withSession = params => (session === undefined ? params : validateParams(kind, { ...params, session }));
    if (result.state === 'missing') {
      if (!override) throw new TaskInputError('TASK_PARAMS');
      return this.render(kind, withSession(override), projectText);
    }
    if (override || projectText !== undefined) throw new TaskInputError('TASK_ARGUMENTS');
    const lf = lfText(text);
    const { params: stored, legacy } = storedParams(kind, lf);
    const params = withSession(stored);
    const expected = this.expectedBlocks(kind, params);
    const { blocks } = findBlocks(lf);
    const own = blocks.filter(block => block.source === SOURCE);
    const kept = [];
    for (const block of own) {
      const want = expected.find(entry => entry.name === block.name);
      if (blockState(block, want) !== 'tampered') continue;
      const base = new Set(normalizeBody(want.body).split('\n').map(line => line.trim()));
      for (const line of normalizeBody(block.body).split('\n')) if (line.trim() && !base.has(line.trim())) kept.push(line);
    }
    const fence = findParams(lf);
    let project = projectSegments(lf, own, fence).join('\n\n');
    if (kept.length) project = [project, KEPT_LABEL, ...kept].filter(Boolean).join('\n');
    // A session change or a legacy migration rewrites the params block; otherwise it is kept byte for byte.
    const fenceText = params.session === stored.session && !legacy ? lf.split('\n').slice(fence.startLine, fence.endLine + 1).join('\n') : paramsFence(params);
    return this.render(kind, params, project, fenceText);
  }
}

function normalizeProjectText(kind, projectText) {
  const text = projectText === undefined ? '' : lfText(projectText).replace(/^\n+|\n+$/g, '');
  if (findBlocks(text).blocks.length || findBlocks(text).errors.length) throw new TaskInputError('TASK_PROJECT_TEXT');
  if (text.split('\n').some(line => FENCE_OPEN.test(line))) throw new TaskInputError('TASK_PROJECT_TEXT');
  if (text) return text;
  if (kind === 'custom') throw new TaskInputError('TASK_PROJECT_TEXT');
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

const RANK = { current: 0, misplaced: 1, outdated: 2, edited: 3 };

// States, worst first: malformed, edited, outdated, misplaced, current. missing = no Toolkit
// blocks at all (a hand-written prompt).
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
  const names = new Set(expected.map(block => block.name));
  if (own.some(block => !names.has(block.name) || !OWN_NAMES.has(block.name))) return { state: 'malformed', exitCode: 2 };
  let state = 'current';
  for (const want of expected) {
    const found = own.find(block => block.name === want.name);
    const blockResult = { absent: 'edited', tampered: 'edited', stale: 'outdated', current: 'current' }[blockState(found, want)];
    if (RANK[blockResult] > RANK[state]) state = blockResult;
  }
  if (state === 'current' && !inOrder(lf, own, fence, expected)) state = 'misplaced';
  return { state, exitCode: state === 'current' ? 0 : 1 };
}

// Run setup first (only blank lines before it), then the params block, the task's checks,
// and delivery last (only blank lines after it).
function inOrder(lf, own, fence, expected) {
  const lineOf = offset => lf.slice(0, offset).split('\n').length - 1;
  const at = name => own.find(block => block.name === name);
  const setup = at(SHELL.setup.name);
  const delivery = at(SHELL.delivery.name);
  if (lf.slice(0, setup.start).trim() || lf.slice(delivery.end).trim()) return false;
  const order = [lineOf(setup.start), fence.startLine, ...expected.slice(1, -1).map(block => lineOf(at(block.name).start)), lineOf(delivery.start)];
  return order.every((line, index) => index === 0 || line > order[index - 1]);
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

function parseArgs(args) {
  const [mode, ...rest] = args;
  const options = {};
  const take = (allowed) => {
    const positional = [];
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg.startsWith('--')) {
        if (!allowed.includes(arg) || options[arg] !== undefined || !rest[index + 1] || rest[index + 1].startsWith('--')) throw new TaskInputError('TASK_ARGUMENTS');
        options[arg] = rest[index += 1];
      } else positional.push(arg);
    }
    return positional;
  };
  const kindArg = value => { kindOf(value); return value; };
  if (mode === '--render' || mode === '--name') {
    const positional = take(mode === '--render' ? ['--params', '--project-text'] : ['--params']);
    if (positional.length !== 1 || !options['--params']) throw new TaskInputError('TASK_ARGUMENTS');
    return { mode: mode.slice(2), kind: kindArg(positional[0]), params: options['--params'], projectText: options['--project-text'] };
  }
  if (mode === '--check' || mode === '--refresh') {
    const positional = take(mode === '--refresh' ? ['--params', '--project-text', '--session'] : []);
    if (positional.length !== 2) throw new TaskInputError('TASK_ARGUMENTS');
    const kind = kindArg(positional[0]);
    if (mode === '--refresh' && KINDS[kind].session && !options['--session']) throw new TaskInputError('TASK_ARGUMENTS');
    return { mode: mode.slice(2), kind, file: positional[1], params: options['--params'], projectText: options['--project-text'], session: options['--session'] };
  }
  if (mode === '--params-from' || mode === '--check-memory') {
    const positional = take([]);
    if (positional.length !== 1) throw new TaskInputError('TASK_ARGUMENTS');
    return { mode: mode.slice(2), file: positional[0] };
  }
  throw new TaskInputError('TASK_ARGUMENTS');
}

function readParamsFile(kind, file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new TaskInputError('TASK_PARAMS'); }
  return validateParams(kind, raw);
}

function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    const tasks = new ProjectsTasks();
    const read = file => (file === undefined ? undefined : fs.readFileSync(file, 'utf8'));
    let output;
    let exitCode = 0;
    if (options.mode === 'render') output = tasks.render(options.kind, readParamsFile(options.kind, options.params), read(options.projectText));
    else if (options.mode === 'name') output = `${taskName(options.kind, readParamsFile(options.kind, options.params))}\n`;
    else if (options.mode === 'check') {
      const result = tasks.check(options.kind, read(options.file));
      output = `${result.state}\n`;
      exitCode = result.exitCode;
    } else if (options.mode === 'refresh') {
      output = tasks.refresh(options.kind, read(options.file), {
        params: options.params === undefined ? undefined : readParamsFile(options.kind, options.params),
        projectText: read(options.projectText),
        session: options.session
      });
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
  } catch {
    process.stderr.write('Task prompt could not be processed (PROJECT_TASKS_INVALID).\n');
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = Object.freeze({ ProjectsTasks, KINDS, LEGACY_RAISE, PROJECT_HEADING, KEPT_LABEL, validateParams, taskName, checkTask, checkMemory, parseArgs, fill });
