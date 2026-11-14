#!/usr/bin/env node
'use strict';

// One read-only health check for a controller: it runs every existing Toolkit checker that fits
// where it runs and prints one combined attention list, so a controller works from the checkers'
// output rather than from memory. It reimplements nothing: each check is the existing script, run
// as a child process with the same Node, in its read-only mode.
//
// Where each check applies:
//   guidebook, instructions, memory, tasks   Claude Projects only
//   programme, traces                        only where the checkout's programme binding says
//                                            governance is enabled
//   ci, footer                               any controller
// The host is `projects` when the Projects library folder exists (only Claude Projects has
// /mnt/project-files), else `chat`; --host overrides it. A check outside its context, or missing its
// input, prints one SKIPPED line saying why or what to pass.
//
// Usage: node repo/scripts/toolkit-controller-check.cjs [--host projects|chat] [--checkout <dir>]
//          [--repo <owner/name>] [--guidebook <folder>] [--instructions <file>] [--memory <file>]
//          [--task <kind>=<prompt file>]... [--since <ISO time>] [--skip <name,...>] [--expand] [--json]
//   --checkout       a checkout of the controlled repository (CI check-up and the programme binding)
//   --repo           the GitHub repository for the footer scan (default: the binding's repository)
//   --guidebook      the Projects library copy of the skill (default on a Projects host:
//                    /mnt/project-files/toolkit/web-controller-projects)
//   --instructions   the project instructions, saved to a file
//   --memory         project memory (MEMORY.md), saved to a file
//   --task           a stored task prompt and its kind (daily-check-in or hourly-nudge); repeatable
//   --since          footer scan start (default: 26 hours ago)
//   --skip           checks the caller already ran elsewhere
//   --expand         every line of every check, passed and skipped ones included (default: one
//                    line when clear; otherwise each check that needs attention or could not run,
//                    with up to 3 detail lines and a count of the rest; programme findings are
//                    counted by code)
// Exit 0 clear, 1 something needs attention or could not run, 2 bad arguments.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LIBRARY = '/mnt/project-files/toolkit/web-controller-projects';
const BINDING_REL = '.github/toolkit-programme.json';
const CHECKS = ['guidebook', 'instructions', 'memory', 'tasks', 'programme', 'traces', 'ci', 'footer'];
const PROJECTS_ONLY = new Set(['guidebook', 'instructions', 'memory', 'tasks']);
const TASK_KINDS = new Set(['daily-check-in', 'hourly-nudge']);
// At most this many detail lines per check unless --expand, then a count and the command for the rest.
const COMPACT_LINES = 3;
const SCRIPTS = {
  guidebook: 'repo/scripts/toolkit-projects-guidebook.cjs',
  instructions: 'repo/scripts/toolkit-projects-instructions.cjs',
  tasks: 'repo/scripts/toolkit-projects-tasks.cjs',
  programme: 'skills/github-program-reconciler/scripts/programme.cjs',
  traces: 'skills/github-program-reconciler/scripts/decision-trace-audit.cjs',
  ci: 'skills/secure-ci-cd/scripts/ci-checkup.cjs',
  footer: 'repo/scripts/toolkit-github-footer-sweep.cjs',
};
const USAGE = 'Usage: toolkit-controller-check.cjs [--host projects|chat] [--expand] [--checkout <dir>] [--repo <owner/name>] [--guidebook <folder>] [--instructions <file>] [--memory <file>] [--task <kind>=<file>]... [--since <ISO time>] [--skip <name,...>] [--json]';

function parseArgs(argv) {
  const options = { host: null, checkout: null, repo: null, guidebook: null, instructions: null, memory: null, tasks: [], since: null, skip: new Set(), json: false, expand: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index += 1];
      if (!next || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--json') options.json = true;
    else if (arg === '--expand') options.expand = true;
    else if (arg === '--host') {
      options.host = value();
      if (!['projects', 'chat'].includes(options.host)) throw new Error('--host is projects or chat');
    } else if (arg === '--repo') {
      options.repo = value();
      if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error('--repo needs <owner/name>');
    } else if (arg === '--since') {
      options.since = value();
      if (Number.isNaN(Date.parse(options.since))) throw new Error('--since needs an ISO time');
    } else if (arg === '--task') {
      const match = /^([a-z-]+)=(.+)$/.exec(value());
      if (!match || !TASK_KINDS.has(match[1])) throw new Error('--task needs daily-check-in=<file> or hourly-nudge=<file>');
      options.tasks.push({ kind: match[1], file: match[2] });
    } else if (arg === '--skip') {
      for (const name of value().split(',').map(item => item.trim()).filter(Boolean)) {
        if (!CHECKS.includes(name)) throw new Error(`--skip names unknown check ${name}`);
        options.skip.add(name);
      }
    } else if (['--checkout', '--guidebook', '--instructions', '--memory'].includes(arg)) options[arg.slice(2)] = value();
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

function defaultRun(script, args, { cwd } = {}) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: cwd || ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { status: result.error ? null : result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), error: result.error ? result.error.message : null };
}

const linesOf = text => String(text || '').split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean);
const why = result => result.error || linesOf(result.stderr).at(-1) || linesOf(result.stdout).at(-1) || `exit ${result.status}`;

// The binding in the checkout; null when there is none or it cannot be read.
function readBinding(checkout) {
  if (!checkout) return null;
  try { return JSON.parse(fs.readFileSync(path.join(checkout, BINDING_REL), 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

// Exit 0 current, 1 needs a change, anything else could not run: the shape the Projects checkers share.
function projectsCheck(run, script, args, command) {
  const result = run(script, args);
  const lines = linesOf(result.stdout);
  if (result.status === 0) return { state: 'ok', lines: lines.length ? lines : ['current'] };
  if (result.status === 1) return { state: 'attention', lines, command };
  return { state: 'failed', lines: [why(result)] };
}

function checkTasks(run, tasks) {
  const results = tasks.map(task => ({ task, outcome: projectsCheck(run, SCRIPTS.tasks, ['--check', task.kind, task.file], `toolkit-projects-tasks.cjs --check ${task.kind}`) }));
  const lines = results.map(({ task, outcome }) => `${task.kind}: ${outcome.lines.join('; ')}`);
  const state = results.some(row => row.outcome.state === 'failed') ? 'failed' : results.some(row => row.outcome.state === 'attention') ? 'attention' : 'ok';
  return { state, lines, command: 'toolkit-projects-tasks.cjs --check <kind> <file>' };
}

function checkProgramme(run, checkout) {
  const result = run(SCRIPTS.programme, ['attention', '--repo-root', checkout], { cwd: checkout });
  const lines = linesOf(result.stdout);
  const first = lines[0] || '';
  if (!/^Attention: /.test(first) || /^Attention: unknown/.test(first)) return { state: 'failed', lines: [first || why(result)] };
  if (first === 'Attention: clear' && result.status === 0) return { state: 'ok', lines: [first] };
  // Findings counted by code, so the compact list still says what kind of work is waiting.
  const codes = {};
  for (const line of lines) {
    const match = /^- \S+ (?:(?:new|acknowledged) )?([A-Z][A-Z0-9_]+) /.exec(line);
    if (match) codes[match[1]] = (codes[match[1]] || 0) + 1;
  }
  const byCode = Object.entries(codes).sort((a, b) => b[1] - a[1]).map(([code, n]) => `${code} ${n}`).join(', ');
  return { state: 'attention', lines: [byCode ? `${first} (${byCode})` : first, ...lines.slice(1).filter(line => line.startsWith('- '))], command: 'programme.cjs attention' };
}

function checkTraces(run, repo, parents) {
  const lines = [];
  let state = 'ok';
  for (const parent of parents) {
    const args = ['--repo', repo, '--issue', String(parent.issue), ...(parent.record_prefix ? ['--record-prefix', parent.record_prefix] : [])];
    const result = run(SCRIPTS.traces, args);
    let report = null;
    try { report = JSON.parse(result.stdout); } catch { /* reported below */ }
    if (!report || ![0, 1].includes(result.status)) { state = 'failed'; lines.push(`#${parent.issue}: could not run: ${why(result)}`); continue; }
    if (report.ok) { lines.push(`#${parent.issue}: decision traces complete`); continue; }
    if (state === 'ok') state = 'attention';
    const count = key => (Array.isArray(report[key]) ? report[key].length : 0);
    const parts = [['unlinked decision comments', count('unlinked_decisions')], ['unknown SUPERSEDES records', count('unknown_supersedes')], ['superseded records not marked', count('superseded_unmarked')], ['index errors', count('index_errors')]]
      .filter(([, n]) => n).map(([label, n]) => `${n} ${label}`);
    if (report.over_threshold) parts.push('body at or over the size threshold');
    lines.push(`#${parent.issue}: ${parts.join(', ') || 'audit failed'} (decision-trace-audit.cjs --repo ${repo} --issue ${parent.issue} --repair --out <file> proposes the fix)`);
  }
  return { state, lines };
}

function checkCi(run, checkout) {
  const result = run(SCRIPTS.ci, ['--repo', checkout, '--json']);
  let report = null;
  try { report = JSON.parse(result.stdout); } catch { /* reported below */ }
  if (result.status !== 0 || !report || !Array.isArray(report.items)) return { state: 'failed', lines: [why(result)] };
  const gaps = report.items.filter(item => item.level === 'GAP');
  const checks = report.items.filter(item => item.level === 'CHECK').length;
  const summary = `${gaps.length} GAP, ${checks} CHECK (CHECK needs judgement: ci-checkup.cjs lists them)`;
  if (!gaps.length) return { state: 'ok', lines: [summary] };
  return { state: 'attention', lines: [summary, ...gaps.map(item => `${item.check || 'gap'} ${item.path || ''}: ${item.message || ''}`.replace(/\s+/g, ' ').trim())], command: 'ci-checkup.cjs' };
}

function checkFooter(run, repo, since) {
  const result = run(SCRIPTS.footer, ['--repo', repo, '--since', since]);
  const lines = linesOf(result.stdout);
  if (result.status === 0) return { state: 'ok', lines: [lines.at(-1) || 'no posts with the footer'] };
  if (result.status === 3) return { state: 'attention', lines, command: `toolkit-github-footer-sweep.cjs --repo ${repo}` };
  return { state: 'failed', lines: lines.length ? lines : [why(result)], command: `toolkit-github-footer-sweep.cjs --repo ${repo}` };
}

function controllerCheck(options, deps = {}) {
  const run = deps.run || defaultRun;
  const exists = deps.exists || (file => fs.existsSync(file));
  const now = deps.now ? deps.now() : new Date();
  const host = options.host || (exists(LIBRARY) ? 'projects' : 'chat');
  const binding = (deps.readBinding || readBinding)(options.checkout);
  const governed = binding && binding.governance === 'enabled';
  const repo = options.repo || (binding && typeof binding.repository === 'string' ? binding.repository : null);
  const parents = governed && Array.isArray(binding.parents) ? binding.parents.filter(parent => Number.isInteger(parent.issue)) : [];
  const guidebook = options.guidebook || (host === 'projects' ? LIBRARY : null);
  const since = options.since || new Date(now.getTime() - 26 * 3600000).toISOString();
  const checks = [];
  const skip = (name, reason) => checks.push({ name, state: 'skipped', lines: [reason] });
  for (const name of CHECKS) {
    if (options.skip.has(name)) { skip(name, 'run elsewhere by the caller'); continue; }
    if (PROJECTS_ONLY.has(name) && host !== 'projects') { skip(name, 'Claude Projects only'); continue; }
    let outcome;
    if (name === 'guidebook') outcome = projectsCheck(run, SCRIPTS.guidebook, ['--check', guidebook], 'toolkit-projects-guidebook.cjs --check');
    else if (name === 'instructions') {
      if (!options.instructions) { skip(name, 'pass --instructions <file> (the project instructions, saved)'); continue; }
      outcome = projectsCheck(run, SCRIPTS.instructions, ['--check', options.instructions], 'toolkit-projects-instructions.cjs --check');
    } else if (name === 'memory') {
      if (!options.memory) { skip(name, 'pass --memory <file> (MEMORY.md, saved)'); continue; }
      outcome = projectsCheck(run, SCRIPTS.tasks, ['--check-memory', options.memory], 'toolkit-projects-tasks.cjs --check-memory');
    } else if (name === 'tasks') {
      if (!options.tasks.length) { skip(name, 'pass --task <kind>=<file> (each stored task prompt)'); continue; }
      outcome = checkTasks(run, options.tasks);
    } else if (name === 'programme' || name === 'traces') {
      if (!options.checkout) { skip(name, 'pass --checkout <dir>'); continue; }
      if (!binding) { skip(name, 'no programme binding in the checkout'); continue; }
      if (!governed) { skip(name, 'governance off'); continue; }
      if (name === 'traces' && !repo) { skip(name, 'pass --repo <owner/name>'); continue; }
      outcome = name === 'programme' ? checkProgramme(run, options.checkout) : checkTraces(run, repo, parents);
    } else if (name === 'ci') {
      if (!options.checkout) { skip(name, 'pass --checkout <dir>'); continue; }
      outcome = checkCi(run, options.checkout);
    } else {
      if (!repo) { skip(name, 'pass --repo <owner/name>'); continue; }
      outcome = checkFooter(run, repo, since);
    }
    checks.push({ name, ...outcome });
  }
  const count = state => checks.filter(check => check.state === state).length;
  return { host, governed: Boolean(governed), repo, checks, attention: count('attention'), failed: count('failed'), skipped: count('skipped') };
}

// Compact by default, so a clean periodic run costs one short line: only what needs action is
// printed, and the checks that passed or were skipped appear as names on the first line.
function format(report, { expand = false } = {}) {
  const names = state => report.checks.filter(check => check.state === state).map(check => check.name).join(' ');
  const passed = names('ok'), skipped = names('skipped');
  const tail = `${passed ? `ok: ${passed}` : ''}${passed && skipped ? '; ' : ''}${skipped ? `skipped: ${skipped}` : ''}`;
  const lines = [report.attention || report.failed
    ? `CONTROLLER CHECK: ${report.attention} need attention, ${report.failed} could not run${tail ? ` (${tail})` : ''}`
    : `CONTROLLER CHECK: clear${tail ? ` (${tail})` : ''}`];
  const label = { attention: 'ATTENTION', failed: 'FAILED', ok: 'OK', skipped: 'SKIPPED' };
  // Attention first, then what could not run, so the list reads in the order it needs action.
  for (const state of expand ? ['attention', 'failed', 'ok', 'skipped'] : ['attention', 'failed']) {
    for (const check of report.checks.filter(item => item.state === state)) {
      const detail = check.lines.slice(1);
      const shown = expand ? detail : detail.slice(0, COMPACT_LINES);
      lines.push(`${label[state]} ${check.name}: ${check.lines[0]}`, ...shown.map(line => `  ${line}`));
      if (shown.length < detail.length) lines.push(`  ... ${detail.length - shown.length} more (--expand, or ${check.command || 'the check itself'})`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || (text => process.stdout.write(text));
  const err = deps.stderr || (text => process.stderr.write(text));
  let options;
  try { options = parseArgs(argv); } catch (error) { err(`${error.message}\n${USAGE}\n`); return 2; }
  const report = controllerCheck(options, deps);
  out(options.json ? `${JSON.stringify(report, null, 2)}\n` : format(report, options));
  return report.attention || report.failed ? 1 : 0;
}

module.exports = { parseArgs, controllerCheck, format, main, CHECKS, SCRIPTS };
if (require.main === module) process.exitCode = main();
