#!/usr/bin/env node
'use strict';

// One read-only health check for a controller: it runs every existing Toolkit checker that fits
// where it runs and prints one combined attention list, so a controller works from the checkers'
// output rather than from memory. It reimplements nothing: each check is the existing script, run
// as a child process with the same Node, in its read-only mode.
//
// Where each check applies:
//   toolkit                                  chat only, where this computer has a managed Toolkit
//                                            checkout: it compares the checkout with its origin
//                                            branch (git directly), so a long-running controller
//                                            chat updates Toolkit and rereads its rules on its own
//   guidebook, instructions, memory, tasks   Claude Projects only
//   programme, traces, stale                 only where the checkout's programme binding says
//                                            governance is enabled; stale is the stale check, which the
//                                            governance session-start hook starts in the background and
//                                            a controller may run on demand: at most once per local date
//                                            per repository (a stamp file in the Toolkit user-state
//                                            folder, local bookkeeping only, never GitHub or repository
//                                            state), it lists rows for the controller: children to judge
//                                            and close, closes that need the owner's OK, duplicates to
//                                            fold, closed children to detach and a full polish child
//   ci, footer, refs                         any controller (refs checks this Toolkit copy: no
//                                            permission row or document names a retired or missing
//                                            script)
//   handoff                                  any controller given --handoff and --checkout: the
//                                            controller handoff snapshot against its live sources,
//                                            read-only (`toolkit-store.cjs handoff --check`); for a
//                                            session start, so periodic runs skip it
// Every check runs an existing script as a child process, except stale, which also reads the
// parents' sub-issues read-only with `gh api` (it needs a signed-in gh).
// The host is `projects` when the Projects library folder exists (only Claude Projects has
// /mnt/project-files), else `chat`; --host overrides it. A check outside its context, or missing its
// input, prints one SKIPPED line saying why or what to pass.
//
// Usage: node repo/scripts/toolkit-controller-check.cjs [--host projects|chat] [--checkout <dir>]
//          [--repo <owner/name>] [--guidebook <folder>] [--instructions <file>] [--memory <file>]
//          [--task <kind>=<prompt file>]... [--since <ISO time>] [--skip <name,...>]
//          [--handoff <folder>] [--expand] [--json]
//   --checkout       a checkout of the controlled repository (CI check-up and the programme binding)
//   --repo           the GitHub repository for the footer scan (default: the binding's repository)
//   --guidebook      the Projects library copy of the skill (default on a Projects host:
//                    /mnt/project-files/toolkit/web-controller-projects)
//   --instructions   the project instructions, saved to a file
//   --memory         project memory (MEMORY.md), saved to a file
//   --task           a stored task prompt and its kind (daily-check-in or hourly-nudge); repeatable
//   --since          footer scan start (default: 26 hours ago)
//   --skip           checks the caller already ran elsewhere
//   --handoff        the store checkout (or other folder) that holds the controller handoff snapshot
//   --expand         every line of every check, passed and skipped ones included (default: one
//                    line when clear; otherwise each check that needs attention or could not run,
//                    with up to 3 detail lines and a count of the rest; programme findings are
//                    counted by code)
// Exit 0 clear, 1 something needs attention, could not run, or nothing ran at all, 2 bad arguments.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LIBRARY = '/mnt/project-files/toolkit/web-controller-projects';
const BINDING_REL = '.github/toolkit-programme.json';
const CHECKS = ['toolkit', 'guidebook', 'instructions', 'memory', 'tasks', 'handoff', 'programme', 'traces', 'stale', 'ci', 'footer', 'refs'];
const PROJECTS_ONLY = new Set(['guidebook', 'instructions', 'memory', 'tasks']);
const TASK_KINDS = new Set(['daily-check-in', 'hourly-nudge']);
// At most this many detail lines per check unless --expand, then a count and the command for the rest.
const COMPACT_LINES = 3;
// The polish child's row cap, and the findings that fire when a child's PRs merged. Whether that
// child is done is the controller's judgement against its DONE WHEN, so they are JUDGE? rows, never CLOSE?.
const POLISH_CAP = 8;
const DONE_CODES = new Set(['READY_TO_CLOSE', 'TASK_MERGED_OPEN']);
// Checks whose every detail line prints even in compact output: the stale rows are the day's one list
// for the controller, and each row needs an answer.
const UNCUT = new Set(['stale']);
const DONE_WHEN = /^#{1,6} +DONE WHEN\b.*$/im;
// The reconciler writes this line under a child's PR GRAPH while the controller keeps it open on purpose.
const KEPT_OPEN = /^Kept open: /m;
const SCRIPTS = {
  guidebook: 'repo/scripts/toolkit-projects-guidebook.cjs',
  instructions: 'repo/scripts/toolkit-projects-instructions.cjs',
  tasks: 'repo/scripts/toolkit-projects-tasks.cjs',
  programme: 'skills/github-program-reconciler/scripts/programme.cjs',
  traces: 'skills/github-program-reconciler/scripts/decision-trace-audit.cjs',
  ci: 'skills/secure-ci-cd/scripts/ci-checkup.cjs',
  footer: 'repo/scripts/toolkit-github-footer-sweep.cjs',
  refs: 'repo/scripts/check-script-references.cjs',
  handoff: 'repo/scripts/toolkit-store.cjs',
};
const USAGE = 'Usage: toolkit-controller-check.cjs [--host projects|chat] [--expand] [--checkout <dir>] [--repo <owner/name>] [--guidebook <folder>] [--instructions <file>] [--memory <file>] [--task <kind>=<file>]... [--since <ISO time>] [--skip <name,...>] [--handoff <folder>] [--json]';

function parseArgs(argv) {
  const options = { host: null, checkout: null, repo: null, guidebook: null, instructions: null, memory: null, tasks: [], since: null, handoff: null, skip: new Set(), json: false, expand: false };
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
    } else if (['--checkout', '--guidebook', '--instructions', '--memory', '--handoff'].includes(arg)) options[arg.slice(2)] = value();
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

function defaultRun(script, args, { cwd } = {}) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: cwd || ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { status: result.error ? null : result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), error: result.error ? result.error.message : null };
}

function defaultGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { status: result.error ? null : result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), error: result.error ? result.error.message : null };
}

// The stale check's stamp, one file per repository in the Toolkit user-state folder (the attention
// cache module decides the path and writes it atomically). A missing or unreadable file is no stamp.
// The session-start line reads the same file (toolkit-governance-gate.cjs).
const defaultStamp = () => {
  const cache = require('../../skills/github-program-reconciler/scripts/programme-attention-cache.cjs');
  return { read: repo => cache.readStaleStamp(repo), write: (repo, record) => cache.writeStaleStamp(repo, record) };
};

function defaultGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30000, windowsHide: true });
  return { status: result.error ? null : result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), error: result.error ? result.error.message : null };
}

// The Toolkit Local Bridge's hub state on this computer; null when there is none.
function readHubState() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.ai-agent-toolkit', 'current', 'state.json'), 'utf8')); } catch { return null; }
}

const linesOf = text => String(text || '').split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean);
const why = result => result.error || linesOf(result.stderr).at(-1) || linesOf(result.stdout).at(-1) || `exit ${result.status}`;

// The binding in the checkout; null when there is none or it cannot be read.
function readBinding(checkout) {
  if (!checkout) return null;
  try { return JSON.parse(fs.readFileSync(path.join(checkout, BINDING_REL), 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

// Exit 0 current, 1 needs a change, anything else could not run: the shape the Projects checkers and
// the script-reference check share.
function statusCheck(run, script, args, command) {
  const result = run(script, args);
  const lines = linesOf(result.stdout);
  if (result.status === 0) return { state: 'ok', lines: lines.length ? lines : ['current'] };
  // A check that stops (exit 1, nothing on stdout) still says why: its Stopped line from stderr.
  if (result.status === 1) return { state: 'attention', lines: lines.length ? lines : [why(result)], command };
  return { state: 'failed', lines: [why(result)] };
}

// The managed checkout against its origin branch, the same comparison the bridge makes at a session
// start. A chat that runs for days never starts again, so its controller updates from here.
function checkToolkit(git, checkout, branch) {
  const head = git(checkout, ['rev-parse', 'HEAD']);
  if (head.status !== 0) return { state: 'failed', lines: [`cannot read the Toolkit checkout: ${why(head)}`] };
  const remote = git(checkout, ['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`]);
  if (remote.status !== 0) return { state: 'failed', lines: [`cannot read origin ${branch}: ${why(remote)}`] };
  const local = head.stdout.trim(), upstream = remote.stdout.trim().split(/\s+/)[0];
  if (local === upstream) return { state: 'ok', lines: [`this computer's Toolkit is current with origin ${branch} at ${local.slice(0, 7)}`] };
  const command = `node "${path.join(checkout, 'repo', 'scripts', 'toolkit-local-bridge.cjs').replace(/\\/g, '/')}" --repo-update-now --write`;
  return { state: 'attention', lines: [`this computer's Toolkit is at ${local.slice(0, 7)}, origin ${branch} is at ${upstream.slice(0, 7)}: run ${command}, then reread CONTROLLER.md and the global rules`], command };
}

function checkTasks(run, tasks) {
  const results = tasks.map(task => ({ task, outcome: statusCheck(run, SCRIPTS.tasks, ['--check', task.kind, task.file], `toolkit-projects-tasks.cjs --check ${task.kind}`) }));
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
  return { state: 'attention', lines: [byCode ? `${first} (${byCode})` : first, ...lines.slice(1).filter(line => line.startsWith('- '))], command: require('./toolkit-user-state.cjs').programmeCommand('attention') };
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

// The text under a heading, up to the next heading of the same or a higher level; null without it.
function sectionOf(body, heading) {
  const text = String(body || '').replace(/\r\n?/g, '\n');
  const start = heading.exec(text);
  if (!start) return null;
  const level = /^#+/.exec(start[0])[0].length;
  const rest = text.slice(start.index + start[0].length);
  const end = new RegExp(`^#{1,${level}} `, 'm').exec(rest);
  return { heading: start[0], text: end ? rest.slice(0, end.index) : rest };
}

// Polish rows are the checkboxes under the child's ROWS heading, else under DONE WHEN; the sweep
// says which it counted, so a body in another shape is visible rather than silently miscounted.
function polishRows(body) {
  for (const heading of [/^#{1,6} +ROWS\b.*$/im, DONE_WHEN]) {
    const found = sectionOf(body, heading);
    if (!found) continue;
    const rows = found.text.match(/^ {0,3}[-*+] \[[ xX]\] /gm) || [];
    return { rows: rows.length, under: /ROWS/i.test(found.heading) ? 'ROWS' : 'DONE WHEN' };
  }
  return { rows: 0, under: 'no ROWS or DONE WHEN heading' };
}

// Why a child holds open work whatever its findings say, or null: unread, closed, kept open or with
// an open sub-issue.
function childHold(child) {
  if (!child) return 'not a sub-issue of a registered parent';
  if (child.state !== 'open') return 'already closed';
  if (KEPT_OPEN.test(String(child.body || '').replace(/\r\n?/g, '\n'))) return 'Kept open line';
  const summary = child.sub_issues_summary;
  return summary && summary.total > summary.completed ? `${summary.total - summary.completed} open sub-issue(s)` : null;
}

// The unchecked DONE WHEN rows of a child, nested ones too.
function uncheckedRows(child) {
  const doneWhen = sectionOf(child.body, DONE_WHEN);
  return doneWhen ? (doneWhen.text.match(/^[ \t]*[-*+] \[ \] /gm) || []).length : 0;
}

// Why an owner-only hold still needs the controller's judgement, or '': no DONE WHEN heading to read,
// or an unchecked row under it.
function ownerOnlyDoubt(child) {
  if (!sectionOf(child.body, DONE_WHEN)) return 'no DONE WHEN heading';
  const unchecked = uncheckedRows(child);
  return unchecked ? `${unchecked} unchecked DONE WHEN row(s)` : '';
}

// Why a merged-PR finding's child is still live, or null when nothing says so. Programme findings fire
// on a merged PR whatever the child still owes, so only a new finding with no lapsed hold, on an open
// child the sweep read, not kept open, with no open sub-issue and no unchecked DONE WHEN row (nested
// ones too), becomes a JUDGE? row.
function heldBecause(finding, child) {
  if (finding.state !== 'new') return 'acknowledged';
  // An acknowledgement past its due turns new again but keeps its due and note: the hold still stands.
  if (finding.promised) return `hold lapsed at ${finding.due} (${finding.promised})`;
  const hold = childHold(child);
  if (hold) return hold;
  const unchecked = uncheckedRows(child);
  return unchecked ? `${unchecked} unchecked DONE WHEN row(s)` : null;
}

// A kept-open child's stall, as a row, or null. The sweep queues a merged task kept open on purpose
// (TASK_MERGED_OPEN) once nothing has worked it for KEPT_OPEN_IDLE_HOURS, so a new finding on a child
// whose page still shows its `Kept open:` line is that stall. A mark set since the finding was raised
// (its `since` time is under that window ago) is settled by the next sweep pass, so it stays held. A
// since time that cannot be read never holds the row.
function keptOpenStall(finding, child, now) {
  if (finding.code !== 'TASK_MERGED_OPEN' || finding.state !== 'new' || finding.promised || !child || child.state !== 'open') return null;
  const line = /^Kept open: .*$/m.exec(String(child.body || '').replace(/\r\n?/g, '\n'));
  if (!line) return null;
  const { KEPT_OPEN_IDLE_HOURS: hours } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
  const since = /\(since (\d{4}-\d\d-\d\d) (\d\d:\d\d)Z\)$/.exec(line[0]);
  const at = since ? Date.parse(`${since[1]}T${since[2]}:00Z`) : NaN;
  if (Number.isFinite(at) && now.getTime() - at < hours * 3600000) return null;
  return `KEPT OPEN? #${finding.issue} kept open${since ? ` since ${since[1]} ${since[2]}Z` : ''} with every PR merged, and no lane has worked it for over ${hours} hours: hand its next slice to a lane, close it if it is done, or dispose of the finding with a reason (TASK_MERGED_OPEN)`;
}

// What the stale check reads of a child page to see a merged PR whose rows stay unticked. A
// default-deny reader over this subset of GitHub's Markdown, and nothing else:
//   - lines split on LF only (CRLF counts as LF); no other character starts a line;
//   - a row is `- [ ] ` or `- [x] ` (`*` or `+` for `-`, X in either case) with 0 to 3 spaces before
//     it, under an ATX heading whose text starts `DONE WHEN` or `ROWS`, up to the next heading of the
//     same or a higher level; fenced code (``` or ~~~, to its closing fence or the end) and an HTML
//     comment block (a line starting `<!--`, to the line holding `-->`) hold no rows or headings;
//   - a merged PR is a row of the one STATE block the sweep draws (one BEGIN STATE line, then one END
//     STATE line) whose status cell starts MERGED and whose Merged SHA cell links a full commit.
// Only a row in that subset counts as ticked, and only such a STATE row as merged: a tab or deeper
// indent, a quote, another marker or check character, or any other shape is never read as either.
const ROWS_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/;
const CHECKBOX = /^ {0,3}[-*+] \[([ xX])\] /;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const STATE_BEGIN = /^<!-- AI-AGENT-TOOLKIT:programme-state:BEGIN STATE v\d+ .*-->$/;
const STATE_END = /^<!-- AI-AGENT-TOOLKIT:programme-state:END STATE -->$/;
const MERGED_ROW = /^\|.*\|#(\d+)\|MERGED(?: · [^|]*)?\|\[[0-9a-f]{7,40}\]\(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/[0-9a-f]{40}\)\|$/;
function rowTicks(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  let fence = null, comment = false, section = 0, ticked = 0, unticked = 0;
  const begins = [], ends = [];
  lines.forEach((line, index) => {
    if (fence) {
      if (new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`).test(line)) fence = null;
      return;
    }
    if (comment) {
      if (line.includes('-->')) comment = false;
      return;
    }
    if (STATE_BEGIN.test(line)) begins.push(index);
    if (STATE_END.test(line)) ends.push(index);
    const open = FENCE_OPEN.exec(line);
    if (open) { fence = open[1]; return; }
    if (/^ {0,3}<!--/.test(line)) {
      comment = !line.slice(line.indexOf('<!--') + 4).includes('-->');
      return;
    }
    const heading = ROWS_HEADING.exec(line);
    if (heading) {
      if (section && heading[1].length <= section) section = 0;
      if (/^(DONE WHEN|ROWS)\b/i.test(heading[2])) section = heading[1].length;
      return;
    }
    const row = section ? CHECKBOX.exec(line) : null;
    if (row && row[1] === ' ') unticked += 1;
    else if (row) ticked += 1;
  });
  const merged = begins.length === 1 && ends.length === 1 && begins[0] < ends[0]
    ? lines.slice(begins[0] + 1, ends[0]).map(line => MERGED_ROW.exec(line)).filter(Boolean).map(match => Number(match[1]))
    : [];
  return { ticked, unticked, merged: [...new Set(merged)].sort((a, b) => a - b) };
}

// The stamp's memory of unticked children it has already flagged: { "<issue>": { prs, flagged } }. An
// entry that is not that exact shape counts as none, so the child is flagged again.
function untickedMemory(last) {
  const kept = {};
  const memory = last && typeof last.unticked === 'object' && !Array.isArray(last.unticked) ? last.unticked : {};
  for (const [issue, entry] of Object.entries(memory)) {
    if (!/^[1-9]\d*$/.test(issue) || !entry || !Array.isArray(entry.prs) || !entry.prs.every(pr => Number.isInteger(pr) && pr > 0)) continue;
    if (!/^\d{4}-\d\d-\d\d$/.test(String(entry.flagged))) continue;
    kept[issue] = { prs: entry.prs, flagged: entry.flagged };
  }
  return kept;
}

// The local date (YYYY-MM-DD) of a time, which is the day the stamp counts in.
const localDate = time => `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, '0')}-${String(time.getDate()).padStart(2, '0')}`;

// The stale check, for the controller: children whose PRs merged, to judge done or not (JUDGE?) and
// close yourself when done; a merged child whose only step left is the owner's, after the agent's UAT
// PASSED and with no gate live on the task (OWNER OK?, for the controller's next ask to the owner, or a
// JUDGE? row when an unchecked DONE WHEN row says otherwise); new beside an open child with no reason
// (FOLD?, a duplicate the owner approves folding); closed while holding open work (MOVE?); kept open on
// purpose but stalled (KEPT OPEN?, see keptOpenStall); a merged PR on its page while none of its DONE WHEN
// or ROWS checkboxes is ticked (UNTICKED?, see rowTicks: a row once per new merged PR, then named on the
// held line until a row is ticked); and a full or over-cap polish child. Read only on GitHub; it writes
// its date stamp, with the day's rows and the unticked children it flagged, only after
// every read succeeded, so a same-day run shows them again with no read. A failed read records which
// read failed (a fixed word, never gh output) and keeps the last date, so the next start retries and
// the session-start line says the check is failing instead of staying silent.
function checkStale({ run, gh, stamp, checkout, repo, parents, now }) {
  const today = localDate(now);
  const head = (count, when) => `${count} row${count === 1 ? '' : 's'} (${when}): judge each JUDGE? against its child's DONE WHEN, PR GRAPH and notes, and close each child you judge done yourself with a closing comment; put each OWNER OK? row, each FOLD? (a duplicate) and any child you judge obsolete in your next ask to the owner; MOVE?, KEPT OPEN?, UNTICKED? and POLISH rows are yours`;
  const last = stamp.read(repo);
  if (last && last.date === today) {
    const kept = Array.isArray(last.rows) ? last.rows.filter(row => typeof row === 'string') : [];
    const heldAgain = typeof last.held === 'string' && last.held ? [last.held] : [];
    if (kept.length) return { state: 'attention', lines: [head(kept.length, `${today}, swept at ${last.at}, shown again`), ...kept, ...heldAgain] };
    return { state: 'ok', lines: [`ran today (${today})${heldAgain.length ? `; ${heldAgain[0]}` : ''}`] };
  }
  // Records which read failed, keeping the last good run's date and rows; a stamp that cannot be
  // written loses only the record.
  const failed = (check, line) => {
    try { stamp.write(repo, { ...(last && typeof last === 'object' ? last : {}), failed: { at: now.toISOString(), check } }); } catch { /* the line below still says it */ }
    return { state: 'failed', lines: [`${line}; no date stamped, so the next run checks again`] };
  };
  const attention = run(SCRIPTS.programme, ['attention', '--json', '--repo-root', checkout], { cwd: checkout });
  let report = null;
  try { report = JSON.parse(attention.stdout); } catch { /* reported below */ }
  if (!report || !Array.isArray(report.findings)) return failed('attention', `programme attention: ${report && report.line ? report.line : why(attention)}`);
  // A failed owner-wait read never hides an owner-OK close: the next run retries.
  if (!Array.isArray(report.owner_waits)) return failed('owner-waits', `owner waits unknown (${report.owner_waits_unknown || 'not in the attention report'})`);
  // Owner-OK closes: the agent's UAT PASSED and no gate is live on the task. Only gate_live false
  // admits one: a live gate (even blocked, or on a task waiting on the owner) or a report too old to
  // say keeps the judged path.
  const passed = new Map(report.owner_waits.filter(wait => wait && wait.agent_uat === 'PASSED' && !wait.after && wait.gate_live === false && Number.isInteger(wait.issue)).map(wait => [wait.issue, wait]));
  const children = [];
  for (const parent of parents) {
    const read = gh(['api', '--paginate', `repos/${repo}/issues/${parent.issue}/sub_issues?per_page=100`, '--jq', '.[] | {number, title, state, body, created_at, sub_issues_summary}']);
    if (read.status !== 0) return failed('sub-issues', `#${parent.issue} sub-issues: ${why(read)}`);
    try { for (const line of linesOf(read.stdout)) children.push({ parent: parent.issue, ...JSON.parse(line) }); } catch { return failed('sub-issues', `#${parent.issue} sub-issues: unreadable gh output`); }
  }
  const since = last && !Number.isNaN(Date.parse(last.at)) ? new Date(last.at) : new Date(now.getTime() - 26 * 3600000);
  const rows = [];
  const held = [];
  const done = new Set();
  // READY_TO_CLOSE first: of the two findings on one child, it is the stronger evidence.
  const doneFindings = report.findings.filter(finding => DONE_CODES.has(finding.code) && Number.isInteger(finding.issue));
  for (const finding of [...doneFindings.filter(f => f.code === 'READY_TO_CLOSE'), ...doneFindings.filter(f => f.code !== 'READY_TO_CLOSE')]) {
    if (done.has(finding.issue)) continue;
    done.add(finding.issue);
    const child = children.find(item => item.number === finding.issue);
    const wait = passed.get(finding.issue);
    if (wait && !childHold(child)) {
      const doubt = ownerOnlyDoubt(child);
      if (doubt) rows.push(`JUDGE? #${finding.issue} owner-only hold: agent UAT PASSED, but ${doubt}; judge it done before you ask the owner (${finding.code})`);
      else {
        // The row names the head the agent's UAT ran at (the owner's OK is recorded there), and shows
        // the controller's acknowledgement note so the owner reads it before saying ok.
        const pr = wait.pr ? `PR #${wait.pr}${wait.pr_state === 'MERGED' ? ' merged' : ''}, ` : '';
        const at = typeof wait.uat_head === 'string' && wait.uat_head ? ` at ${wait.uat_head.slice(0, 7)}` : '';
        rows.push(`OWNER OK? #${finding.issue} ${child.title}: ${pr}agent UAT PASSED${at}${finding.promised ? `; controller note: ${finding.promised}` : ''}; put "reply ok to close" in your next ask to the owner`);
      }
      continue;
    }
    // Any of the child's findings may be the kept-open stall: a READY_TO_CLOSE taken first never hides it.
    const stalled = doneFindings.filter(other => other.issue === finding.issue).map(other => keptOpenStall(other, child, now)).find(Boolean);
    if (stalled) { rows.push(stalled); continue; }
    const why = heldBecause(finding, child);
    if (why) held.push(`#${finding.issue} ${why}`);
    else rows.push(`JUDGE? #${finding.issue} PR merged: check its DONE WHEN, then close it yourself or keep it open (${finding.code})`);
  }
  const open = children.filter(child => child.state === 'open');
  for (const child of open) {
    if (Date.parse(child.created_at) > since.getTime() && !/Nearest child:/.test(child.body || '')) rows.push(`FOLD? #${child.number} new under #${child.parent} with no Nearest child: line`);
  }
  // Merged PRs with every row still unticked: a row the first time, and again when another PR merges;
  // in between the child is named on the held line, so it is never silent.
  const flagged = untickedMemory(last);
  const unticked = {};
  for (const child of open) {
    const read = rowTicks(child.body);
    if (!read.merged.length || read.ticked || !read.unticked) continue;
    const before = flagged[String(child.number)];
    const prs = read.merged.map(pr => `#${pr}`).join(', ');
    if (before && read.merged.every(pr => before.prs.includes(pr))) {
      unticked[child.number] = before;
      held.push(`#${child.number} ${read.unticked} row(s) unticked after PR ${prs} merged (flagged ${before.flagged})`);
      continue;
    }
    unticked[child.number] = { prs: read.merged, flagged: today };
    rows.push(`UNTICKED? #${child.number} PR ${prs} merged, but none of its ${read.unticked} DONE WHEN or ROWS checkbox row(s) is ticked: tick each row a merged PR delivered (the stale check counts and judges by them)`);
  }
  for (const child of children.filter(item => item.state === 'closed')) {
    const summary = child.sub_issues_summary;
    if (summary && summary.total > summary.completed) rows.push(`MOVE? #${child.number} closed under #${child.parent} with ${summary.total - summary.completed} open sub-issue(s): move them to the parent so it detaches`);
  }
  const polish = open.filter(child => /^Polish\b/i.test(child.title || ''));
  if (polish.length > 1) rows.push(`POLISH OVER CAP: ${polish.length} open polish children (${polish.map(child => `#${child.number}`).join(', ')}); keep one`);
  for (const child of polish) {
    const { rows: count, under } = polishRows(child.body);
    if (count > POLISH_CAP) rows.push(`POLISH OVER CAP #${child.number}: ${count} rows (${under}), cap ${POLISH_CAP}`);
    else if (count === POLISH_CAP) rows.push(`POLISH FULL #${child.number}: ${count} rows (${under}): ship it as one PR, then open a fresh one`);
  }
  const heldLine = held.length ? `held, not proposed: ${held.join(', ')}` : '';
  try { stamp.write(repo, { date: today, at: now.toISOString(), rows, ...(heldLine ? { held: heldLine } : {}), ...(Object.keys(unticked).length ? { unticked } : {}) }); } catch (error) {
    return { state: 'failed', lines: [`stamp not written (${error.message}); the next run sweeps again`, ...rows, ...(heldLine ? [heldLine] : [])] };
  }
  if (!rows.length) return { state: 'ok', lines: [`no stale children (${today}, ${children.length} children read)${heldLine ? `; ${heldLine}` : ''}`] };
  return { state: 'attention', lines: [head(rows.length, today), ...rows, ...(heldLine ? [heldLine] : [])] };
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
  const hub = (deps.readHubState || readHubState)();
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
    if (name === 'toolkit') {
      // A Projects controller runs Toolkit from the guidebook its cloud thread clones fresh.
      if (host === 'projects') { skip(name, 'chat only'); continue; }
      if (!hub || typeof hub.repo_path !== 'string' || !hub.repo_path) { skip(name, 'no managed Toolkit checkout on this computer (setup toolkit records one)'); continue; }
      outcome = checkToolkit(deps.git || defaultGit, hub.repo_path, hub.repo_branch || 'main');
    } else if (name === 'guidebook') outcome = statusCheck(run, SCRIPTS.guidebook, ['--check', guidebook], 'toolkit-projects-guidebook.cjs --check');
    else if (name === 'instructions') {
      if (!options.instructions) { skip(name, 'pass --instructions <file> (the project instructions, saved)'); continue; }
      outcome = statusCheck(run, SCRIPTS.instructions, ['--check', options.instructions], 'toolkit-projects-instructions.cjs --check');
    } else if (name === 'memory') {
      if (!options.memory) { skip(name, 'pass --memory <file> (MEMORY.md, saved)'); continue; }
      outcome = statusCheck(run, SCRIPTS.tasks, ['--check-memory', options.memory], 'toolkit-projects-tasks.cjs --check-memory');
    } else if (name === 'tasks') {
      if (!options.tasks.length) { skip(name, 'pass --task <kind>=<file> (each stored task prompt)'); continue; }
      outcome = checkTasks(run, options.tasks);
    } else if (name === 'programme' || name === 'traces' || name === 'stale') {
      if (!options.checkout) { skip(name, 'pass --checkout <dir>'); continue; }
      if (!binding) { skip(name, 'no programme binding in the checkout'); continue; }
      if (!governed) { skip(name, 'governance off'); continue; }
      if (name !== 'programme' && !repo) { skip(name, 'pass --repo <owner/name>'); continue; }
      if (name === 'stale') {
        const stamp = deps.stamp || defaultStamp();
        outcome = checkStale({ run, gh: deps.gh || defaultGh, stamp, checkout: options.checkout, repo, parents, now });
      } else outcome = name === 'programme' ? checkProgramme(run, options.checkout) : checkTraces(run, repo, parents);
    } else if (name === 'ci') {
      if (!options.checkout) { skip(name, 'pass --checkout <dir>'); continue; }
      outcome = checkCi(run, options.checkout);
    } else if (name === 'footer') {
      if (!repo) { skip(name, 'pass --repo <owner/name>'); continue; }
      outcome = checkFooter(run, repo, since);
    } else if (name === 'handoff') {
      if (!options.handoff || !options.checkout) { skip(name, 'pass --handoff <folder holding the snapshot> and --checkout <dir>'); continue; }
      outcome = statusCheck(run, SCRIPTS.handoff, ['handoff', '--check', '--store', options.handoff, '--repo-root', options.checkout], `toolkit-store.cjs handoff --store ${options.handoff} --repo-root ${options.checkout}`);
    } else outcome = statusCheck(run, SCRIPTS.refs, [], 'check-script-references.cjs');
    checks.push({ name, ...outcome });
  }
  const count = state => checks.filter(check => check.state === state).length;
  return { host, governed: Boolean(governed), repo, checks, attention: count('attention'), failed: count('failed'), skipped: count('skipped') };
}

// refs checks the Toolkit copy itself and needs no input, so it alone never makes a run clear: a
// caller that passed none of the controller's inputs ran nothing about the repository it controls.
const ranForController = report => report.checks.some(check => check.name !== 'refs' && check.state === 'ok');

// Compact by default, so a clean periodic run costs one short line: only what needs action is
// printed, and the checks that passed or were skipped appear as names on the first line.
function format(report, { expand = false } = {}) {
  const names = state => report.checks.filter(check => check.state === state).map(check => check.name).join(' ');
  const passed = names('ok'), skipped = names('skipped');
  const tail = `${passed ? `ok: ${passed}` : ''}${passed && skipped ? '; ' : ''}${skipped ? `skipped: ${skipped}` : ''}`;
  const lines = [report.attention || report.failed
    ? `CONTROLLER CHECK: ${report.attention} need attention, ${report.failed} could not run${tail ? ` (${tail})` : ''}`
    : ranForController(report) ? `CONTROLLER CHECK: clear (${tail})` : `CONTROLLER CHECK: nothing ran (${tail}): pass the inputs each skipped check names (--expand lists them)`];
  const label = { attention: 'ATTENTION', failed: 'FAILED', ok: 'OK', skipped: 'SKIPPED' };
  // Attention first, then what could not run, so the list reads in the order it needs action.
  for (const state of expand ? ['attention', 'failed', 'ok', 'skipped'] : ['attention', 'failed']) {
    for (const check of report.checks.filter(item => item.state === state)) {
      const detail = check.lines.slice(1);
      const shown = expand || UNCUT.has(check.name) ? detail : detail.slice(0, COMPACT_LINES);
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
  // Nothing run is never clear: a caller with no inputs must not read silence as health.
  return report.attention || report.failed || !ranForController(report) ? 1 : 0;
}

// The --skip value that leaves only the stale check, for the session-start hook's background run and
// the command its line names.
const staleOnlySkip = CHECKS.filter(name => name !== 'stale').join(',');

module.exports = { parseArgs, controllerCheck, format, main, polishRows, rowTicks, localDate, CHECKS, SCRIPTS, staleOnlySkip };
if (require.main === module) process.exitCode = main();
