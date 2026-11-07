#!/usr/bin/env node
'use strict';

// The only Toolkit code that creates, changes or removes Windows scheduled tasks. Run as
//   node <Toolkit checkout>/repo/scripts/toolkit-windows-tasks.cjs <command> [options]
//
//   list    [--repo-root <checkout>] [--json] lists recorded and live tasks without changes.
//   plan    [--repo-root <checkout>] [--folder <F>] [--json]
//           read-only: the tasks Toolkit would keep for the checkout, what each needs (create,
//           update, current or refused) and, when anything needs a change, the PowerShell line
//           to run under the Toolkit task standing approval, or with approval. Direct plan prints this.
//   apply   [--repo-root <checkout>] [--folder <F>] [--no-first-run] [--repair-owned] [--json]
//           creates or updates those tasks and records them in ~/.ai-agent-toolkit/user-state/tasks.json,
//           then starts a new or changed cleaner once and waits for its result. Agents may
//           run the exact default-folder command under the global Toolkit task standing approval.
//   remove  [--repo-root <checkout>] [--folder <F>] [--json]
//           records durable owner stops before removing only Toolkit's owned tasks,
//           retaining enrolment and baseline; removes the folder when empty.
//   adopt   --folder <F> --task <name> --id <id> --purpose <text> [--repository <owner/name>]
//           records a task you made yourself so `toolkit tasks` lists it as known; Toolkit never
//           changes or removes an adopted task.
//   apply --repair-owned needs explicit approval naming the affected fixed tasks, paths and changes.
//           It repairs owned same-repository enrolments and obsolete switch records towards fresh
//           governance; never an unowned task, owner-choice answer or corrupt registry.
//
// Tasks live in \<schedule_folder>\ (the merged binding's `schedule_folder`, else the repository
// name in capitals) and are named "<FOLDER> - <TASK>". A task is Toolkit's only when it is in that
// folder, its Description carries `[toolkit-task v1 id=<id> def=<digest>]` and its non-adopted registry
// entry agrees on identity. Standing apply also checks repository, canonical checkout/runner paths,
// owner stops and the full enrolled definition. --folder overrides need separate approval.
//
// Each task runs a surviving user-state launcher through headless conhost, then the job as you, only
// while you are logged on, with no stored password and no console window. Settings: start when
// available, a second start is ignored while one runs, a 30 minute limit, runs on battery. A headless
// console host does not pass the job's exit code on, so the job's own result is in its last-run file.
// On any computer but Windows every command reports `not-windows` and changes nothing.
//
// Exit 0 done (or nothing to do), 1 a task could not be changed or refused, 2 bad arguments.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tasks = require('./toolkit-tasks.cjs');
const scheduleOwner = require('./toolkit-task-schedule.cjs');
const taskPolicy = require('./toolkit-task-policy.cjs');

const FOLDER = /^[A-Z0-9][A-Z0-9-]{0,31}$/;
const MARKER = /\[toolkit-task v1 id=([a-z0-9][a-z0-9-]{0,79}) def=([0-9a-f]{12})\]/;
const STATUS_CONTROL_C_EXIT = 0xC000013A;
const FIRST_RUN_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 5000;

// Bind the bootstrap bytes for this invocation. A refresh during apply cannot
// change the installed payload after its content-addressed path was planned.
const LAUNCHER_SOURCE = fs.readFileSync(path.join(__dirname, 'toolkit-task-launcher.cjs'), 'utf8');
const LAUNCHER_HASH = crypto.createHash('sha256').update(LAUNCHER_SOURCE).digest('hex').slice(0, 16);

// Fixed job definitions; desiredTasks and WindowsTaskOwner select one cleaner.
const JOBS = Object.freeze({
  'task-health': {
    task: 'TASK HEALTH',
    schedule: Object.freeze({ kind: 'daily', at: '07:51' }),
    purpose: 'Checks scheduled jobs on this computer and shares a path-free health file with a verified evidence store. No AI.',
  },
  'programme-sweep': {
    task: 'PROGRAMME SWEEP',
    schedule: Object.freeze({ kind: 'hourly', at: '00:01', hours: 24 }),
    purpose: 'Cleans your own GitHub posts first, then brings programme pages and attention up to date under governance guards. No AI.',
  },
  'footer-sweep': {
    task: 'FOOTER SWEEP',
    schedule: Object.freeze({ kind: 'hourly', at: '00:01', hours: 24 }),
    purpose: 'Removes the cloud route footer from your own GitHub posts in this repository and its freshly verified evidence store. No AI.',
  },
  'shard-timings': {
    task: 'SHARD TIMINGS',
    schedule: Object.freeze({ kind: 'weekly', day: 'Monday', at: '08:01' }),
    purpose: 'Refreshes test times and opens a pull request when CI shards drift; no shards yet means no changes, and timing starts when the manifest becomes available in the registered checkout. No AI.',
  },
});

class WindowsTasksError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
}

// ---- names, folders and markers ---------------------------------------------------------------

// The default folder for a repository: its name in capitals, dots and underscores as hyphens.
function defaultFolder(repository) {
  const name = String(repository || '').split('/').pop().toUpperCase().replace(/[._]/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/^-+/, '').slice(0, 32);
  return FOLDER.test(name) ? name : null;
}

// Windows keeps each task as a file under System32\Tasks\<folder>\, so a name takes no character a
// file name refuses, and Task Scheduler refuses a leading or trailing space and "." or "..".
function nameProblem(name) {
  if (typeof name !== 'string' || !name) return 'is empty';
  if (/[\\/:*?"<>|]/.test(name)) return 'contains one of \\ / : * ? " < > |';
  if (/[\x00-\x1f]/.test(name)) return 'contains a control character';
  if (name.trim() !== name) return 'starts or ends with a space';
  if (name === '.' || name === '..') return 'is . or ..';
  if (name.length > 200) return 'is longer than 200 characters';
  return null;
}

function taskName(folder, job) { return `${folder} - ${JOBS[job].task}`; }
function taskId(folder, job) { return `${folder.toLowerCase()}-${job}`; }

function parseMarker(description) {
  const match = MARKER.exec(String(description || ''));
  return match ? { id: match[1], def: match[2] } : null;
}

function repositoryOf(identity) {
  if (identity?.valid !== true || !require('./toolkit-governance-state.cjs').isGitHubHost(identity.remote?.host)) return null;
  const slug = String(identity.remote.path || '').replace(/^\//, '').replace(/\/$/, '').replace(/\.git$/i, '');
  return /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(slug) && !['.', '..'].includes(slug.split('/')[1]) ? slug : null;
}

const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.win32.normalize(a).replace(/\\+$/, '').toLowerCase() === path.win32.normalize(b).replace(/\\+$/, '').toLowerCase();
const sameTaskName = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// Fixed local Git reads only. The first worktree is Git's primary working directory,
// irrespective of which branch it has checked out. Never redirect a linked invocation.
function mainCheckout(root, { run = spawnSync, realpath = fs.realpathSync } = {}) {
  if (typeof root !== 'string' || !(path.isAbsolute(root) || path.win32.isAbsolute(root)) || /[\x00-\x1f\x7f"\u0085\u2028\u2029\ufeff]/.test(root)) throw new WindowsTasksError('checkout identity needs a safe absolute path', 1);
  const canonical = realpath(root);
  const git = args => {
    const result = run('git', ['-C', canonical, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (result.error || result.status !== 0) throw new WindowsTasksError('local Git checkout identity could not be read', 1);
    return String(result.stdout).trim();
  };
  const top = realpath(git(['rev-parse', '--show-toplevel']));
  const common = realpath(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const gitDir = realpath(git(['rev-parse', '--absolute-git-dir']));
  const first = /^worktree ([^\0]+)\0/.exec(git(['worktree', 'list', '--porcelain', '-z']));
  if (!first || !samePath(canonical, top) || !samePath(canonical, realpath(first[1])) || !samePath(common, gitDir)) {
    const error = new WindowsTasksError('use the repository main checkout, never a linked worktree or subdirectory', 1);
    error.primaryCheckout = first ? realpath(first[1]) : null;
    throw error;
  }
  return canonical;
}

function readLocations({ checkout, toolkitRoot, home = os.homedir() }, deps = {}) {
  const read = deps.readFile || (file => fs.readFileSync(file, 'utf8'));
  const realpath = deps.realpath || fs.realpathSync;
  const primary = deps.mainCheckout || mainCheckout;
  const file = path.join(home, '.ai-agent-toolkit', 'current', 'state.json');
  let state;
  try { const text = read(file); if (Buffer.byteLength(text) > 512 * 1024) throw new Error('large'); state = JSON.parse(text); }
  catch { throw new WindowsTasksError('the recorded managed Toolkit checkout could not be read', 1); }
  if (typeof state?.repo_path !== 'string' || !(path.isAbsolute(state.repo_path) || path.win32.isAbsolute(state.repo_path))) throw new WindowsTasksError('the managed Toolkit repo_path is invalid', 1);
  const managed = primary(state.repo_path);
  let target;
  try { target = primary(checkout); }
  catch (error) { error.managedCheckout = managed; throw error; }
  let toolkit;
  try { toolkit = primary(toolkitRoot); }
  catch (error) {
    // A runner's Git error must not be mistaken for the target repository's path.
    error.managedCheckout = managed;
    error.primaryCheckout = target;
    throw error;
  }
  if (!samePath(managed, toolkit) || !samePath(realpath(toolkitRoot), managed)) {
    const error = new WindowsTasksError('invoke the recorded managed Toolkit checkout', 1);
    error.managedCheckout = managed;
    error.primaryCheckout = target;
    throw error;
  }
  // Inspect the source repository as well as its location; an arbitrary repository is not Toolkit.
  const result = (deps.run || spawnSync)('git', ['-C', toolkit, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.error || result.status !== 0 || !/^(?:https:\/\/github\.com\/|git@github\.com:)weijunswj\/ai-agent-toolkit(?:\.git)?\s*$/i.test(String(result.stdout))) throw new WindowsTasksError('the managed checkout is not the expected Toolkit repository', 1);
  return { toolkitRoot: toolkit, checkout: target };
}

// What the checkout's governance says: { root, repository, governanceState, binding }.
function readTaskObservation(identity, home = os.homedir(), now = new Date()) {
  const governance = require('./toolkit-governance-state.cjs');
  const cache = require('./toolkit-governance-binding.cjs');
  return governance.judgeMerged(cache.readBindingCache(identity, tasks.userStateDir(home)), identity, now);
}

function readCheckout(checkout, deps = {}) {
  const governance = deps.governance || require('./toolkit-governance-state.cjs');
  let identity;
  try { identity = governance.readIdentity(checkout); } catch { return { root: null, refusal: 'checkout identity could not be read' }; }
  const repository = repositoryOf(identity);
  if (!repository) return { root: null, repository: null, refusalCode: identity?.valid || identity?.reason === 'origin-unsupported' ? 'no-github-origin' : null, refusal: 'no usable github.com origin repository' };
  let status = null;
  let observation = null;
  try { status = governance.governanceState(identity.root); } catch { /* unreadable grants nothing */ }
  try { observation = (deps.readObservation || governance.readObservation || readTaskObservation)(identity, deps.home, deps.now ? deps.now() : new Date()); } catch { /* unreadable grants nothing */ }
  let binding = observation?.binding || null;
  if (binding) {
    if (String(binding.repository).toLowerCase() !== repository.toLowerCase()) throw new WindowsTasksError('origin identity and merged binding repository disagree', 1);
    let source = binding;
    if (source.schema === 'toolkit.programme-binding.v2') { const { parent_issue, record_prefix, writer_prefix, ...rest } = source; source = rest; }
    if (require('./toolkit-governance-state.cjs').bindingProblems(source, identity).length) { binding = null; observation = null; }
  }
  const merged = status?.merged;
  const certain = merged?.fresh === true && observation?.fresh === true && merged.status === observation.status
    && merged.commit === observation.commit
    && ((status.state === 'ENABLED' && observation.status === 'enabled' && binding)
      || (['DISABLED', 'UNDECIDED'].includes(status.state) && observation.status === 'none')
      || (status.state === 'DISABLED' && observation.status === 'disabled' && binding));
  return { root: identity.root, repository, governanceState: status?.state || null, binding, certain: Boolean(certain),
    enabled: status?.state === 'ENABLED' && merged?.status === 'enabled' && observation?.status === 'enabled' && Boolean(binding),
    revision: observation?.commit || null };
}

function folderForCheckout(checkout, deps = {}) {
  const read = readCheckout(checkout, deps);
  return (read.binding && read.binding.schedule_folder) || defaultFolder(read.repository);
}

// ---- describing live tasks --------------------------------------------------------------------

function durationText(iso) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(String(iso || ''));
  if (!match) return null;
  const parts = [];
  if (match[1]) parts.push(`${match[1]} hour${match[1] === '1' ? '' : 's'}`);
  if (match[2]) parts.push(`${match[2]} minute${match[2] === '1' ? '' : 's'}`);
  return parts.join(' ') || null;
}

const DAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
const timeOf = start => (/T(\d{2}:\d{2})/.exec(String(start || '')) || [])[1] || '?';

// One plain line for a task's triggers, such as "hourly, 00:00 to 23:59".
function describeTriggers(triggers) {
  const list = Array.isArray(triggers) ? triggers : triggers ? [triggers] : [];
  return list.map((trigger) => {
    const at = timeOf(trigger.start);
    const kind = String(trigger.kind || '');
    const every = durationText(trigger.interval);
    const durationHours = trigger.duration === 'P1D' ? 24 : /^PT\d+H$/.test(String(trigger.duration)) ? Number(/\d+/.exec(trigger.duration)[0]) : null;
    if (/Daily/.test(kind) && trigger.interval === 'PT1H' && durationHours !== null) {
      const [hours, minutes] = at.split(':').map(Number);
      const end = (hours + durationHours) * 60 + minutes - 1;
      return `hourly, ${at} to ${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    }
    if (/Daily/.test(kind)) return `daily at ${at}${every ? `, every ${every}` : ''}`;
    if (/Weekly/.test(kind)) {
      const days = DAYS.filter((_, index) => (Number(trigger.days_of_week) >> index) & 1);
      return `weekly, ${days.join(' and ') || 'no day'} ${at}`;
    }
    if (/Time/.test(kind)) return every ? `every ${every} from ${String(trigger.start).slice(0, 16).replace('T', ' ')}` : `once at ${String(trigger.start).slice(0, 16).replace('T', ' ')}`;
    if (/Logon/.test(kind)) return 'at log on';
    if (/Boot/.test(kind)) return 'at start-up';
    return kind.replace(/^MSFT_Task|Trigger$/g, '') || 'unknown trigger';
  }).join('; ');
}

function describeResult(code) {
  if (code === null || code === undefined) return null;
  const value = Number(code) >>> 0;
  if (value === 0) return 'ok';
  if (value === 0x41301) return 'running';
  if (value === 0x41303) return 'not run yet';
  if (value === STATUS_CONTROL_C_EXIT) return 'stopped when its console closed (0xC000013A)';
  return `0x${value.toString(16).toUpperCase()}`;
}

// ---- the tasks a checkout should have ---------------------------------------------------------

function quotePath(file, label) {
  if (typeof file !== 'string' || !path.win32.isAbsolute(file) || /[\x00-\x1f\x7f"\u0085\u2028\u2029\ufeff\u200b]/.test(file) || /\\$/.test(file)) throw new WindowsTasksError(`${label} ${JSON.stringify(file)} cannot be used in a task: it must be an absolute path with no quote mark or control character that does not end in a backslash`, 1);
  return `"${file}"`;
}

function definitionDigest(definition) {
  const { execute, arguments: args, working_directory: workingDirectory, schedule, purpose } = definition;
  return crypto.createHash('sha256').update(JSON.stringify({ execute, args, workingDirectory, schedule, purpose, settings: 'v1 interactive start-when-available ignore-new 30m battery' })).digest('hex').slice(0, 12);
}

// { folder, repository, wanted: [definitions], skipped: [{ job, reason }] } for a checkout.
function desiredTasks({ checkout, folder = null, toolkitRoot = path.resolve(__dirname, '..', '..'), nodePath = process.execPath, systemRoot = process.env.SystemRoot || 'C:\\Windows', home, checkoutRead = null, deps = {} }) {
  const identityReader = deps.identityReader || readLocations;
  const locations = identityReader({ checkout, toolkitRoot, home });
  checkout = locations.checkout;
  toolkitRoot = locations.toolkitRoot;
  const read = checkoutRead || readCheckout(checkout, { ...deps, home });
  if (!read.root) throw new WindowsTasksError(`${checkout} is not inside a git repository with an origin remote`);
  const chosen = folder || (read.binding && read.binding.schedule_folder) || defaultFolder(read.repository);
  if (!chosen || !FOLDER.test(chosen)) throw new WindowsTasksError(`no usable task folder for this repository (got ${JSON.stringify(chosen)}); set schedule_folder in its binding or pass --folder`);
  const wanted = [];
  const skipped = [];
  const definitions = [];
  const confirmed = require('./toolkit-task-shape.cjs').confirmedTaskShape({ certain: read.certain, governanceState: read.governanceState });
  for (const [job, spec] of Object.entries(JOBS)) {
    const name = taskName(chosen, job);
    const problem = nameProblem(name);
    if (problem) throw new WindowsTasksError(`task name ${JSON.stringify(name)} ${problem}`);
    const id = taskId(chosen, job);
    // Task definitions are Windows paths on every computer, so they read the same in tests anywhere.
    const launcher = launcherPath(home);
    const runner = path.win32.join(toolkitRoot, 'repo', 'scripts', 'toolkit-scheduled-job.cjs');
    const definition = {
      id, job, launcher, folder: chosen, name, repository: read.repository, checkout: read.root, toolkit_root: toolkitRoot, purpose: spec.purpose, schedule: spec.schedule, schedule_text: describeSchedule(spec.schedule),
      execute: path.win32.join(systemRoot, 'System32', 'conhost.exe'),
      arguments: ['--headless', quotePath(nodePath, 'node'), quotePath(launcher, 'the task launcher'), quotePath(toolkitRoot, 'the Toolkit checkout'), job, '--repo-root', quotePath(read.root, 'the checkout'), '--task-id', id].join(' '),
      working_directory: path.dirname(launcher),
    };
    quotePath(toolkitRoot, 'the Toolkit checkout');
    definition.def = definitionDigest(definition);
    definition.description = `${chosen}: ${spec.task}. ${spec.purpose} [toolkit-task v1 id=${id} def=${definition.def}]`;
    definitions.push(definition);
    const selected = confirmed ? confirmed.includes(job) : read.enabled && job !== 'footer-sweep';
    if (job === 'task-health') continue; // One computer-wide job, installed by the update owner.
    if (selected) wanted.push(definition);
    else if (!read.certain || job !== 'footer-sweep') skipped.push({ job, name, reason: read.certain ? 'governance is not enabled; the footer-only cleaner is selected' : 'fresh matching merged governance could not be verified; refresh governance status, then retry the task plan' });
  }
  return { folder: chosen, repository: read.repository, root: read.root, wanted, skipped, definitions, read, folderOverride: folder, checkoutDeps: deps, identityReader, locations: { checkout, toolkitRoot, home } };
}

function describeSchedule(schedule) {
  if (schedule.kind === 'hourly') return describeTriggers([{ kind: 'MSFT_TaskDailyTrigger', start: `2000-01-01T${schedule.at}:00`, interval: 'PT1H', duration: `PT${schedule.hours}H` }]);
  if (schedule.kind === 'daily') return `daily, ${schedule.at}`;
  return `weekly, ${schedule.day} ${schedule.at}`;
}

// ---- Task Scheduler through PowerShell ------------------------------------------------------

const PRELUDE = String.raw`$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$p = $env:TOOLKIT_TASK_PAYLOAD | ConvertFrom-Json
function When($d) { if ($d -and $d.Year -gt 2000) { $d.ToUniversalTime().ToString('o') } else { $null } }
function PathOf($folder) { if ($folder) { '\' + $folder + '\' } else { '\' } }
function ReadTasks($taskPath) {
  try { @(Get-ScheduledTask -TaskPath $taskPath -ErrorAction Stop) }
  catch { if ($_.FullyQualifiedErrorId -notlike 'CmdletizationQuery_NotFound*') { throw }; @() }
}
try {
`;
const POSTLUDE = String.raw`
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

const SCRIPTS = Object.freeze({
  list: String.raw`$path = PathOf $p.folder
$rows = New-Object System.Collections.ArrayList
foreach ($t in @(ReadTasks $path)) {
  if ($t.TaskPath -ne $path) { continue }
  $i = $null
  $i = Get-ScheduledTaskInfo -TaskPath $t.TaskPath -TaskName $t.TaskName -ErrorAction Stop
  $a = @($t.Actions)[0]
  $actions = @($t.Actions | ForEach-Object { @{ execute = [string]$_.Execute; arguments = [string]$_.Arguments; working_directory = [string]$_.WorkingDirectory } })
  $tr = New-Object System.Collections.ArrayList
  foreach ($x in @($t.Triggers)) { [void]$tr.Add([pscustomobject]@{ kind = [string]$x.CimClass.CimClassName; start = [string]$x.StartBoundary; end = [string]$x.EndBoundary; interval = [string]$x.Repetition.Interval; duration = [string]$x.Repetition.Duration; stop_at_duration_end = [bool]$x.Repetition.StopAtDurationEnd; days_of_week = $x.DaysOfWeek; weeks_interval = $x.WeeksInterval; days_interval = $x.DaysInterval; enabled = [bool]$x.Enabled }) }
  [void]$rows.Add([pscustomobject]@{ name = $t.TaskName; description = [string]$t.Description; state = [string]$t.State; execute = [string]$a.Execute; arguments = [string]$a.Arguments; working_directory = [string]$a.WorkingDirectory; actions = $actions; principal = @{ user_id = [string]$t.Principal.UserId; logon_type = [string]$t.Principal.LogonType; run_level = [string]$t.Principal.RunLevel }; settings = @{ enabled = [bool]$t.Settings.Enabled; start_when_available = [bool]$t.Settings.StartWhenAvailable; multiple_instances = [string]$t.Settings.MultipleInstances; execution_time_limit = [string]$t.Settings.ExecutionTimeLimit; disallow_start_if_on_batteries = [bool]$t.Settings.DisallowStartIfOnBatteries; stop_if_going_on_batteries = [bool]$t.Settings.StopIfGoingOnBatteries }; definition_xml = (Export-ScheduledTask -TaskPath $path -TaskName $t.TaskName); logon_type = [string]$t.Principal.LogonType; triggers = @($tr); last_run = $(if ($i) { When $i.LastRunTime } else { $null }); next_run = $(if ($i) { When $i.NextRunTime } else { $null }); last_result = $(if ($i) { [int64]$i.LastTaskResult } else { $null }) })
}
ConvertTo-Json -InputObject @($rows) -Depth 6 -Compress`,
  register: String.raw`$path = PathOf $p.folder
$existing = @(ReadTasks $path) | Where-Object { $_.TaskName -ieq $p.name }
if ($p.expected_xml) { if (-not $existing -or (Export-ScheduledTask -TaskPath $path -TaskName $p.name) -cne $p.expected_xml) { throw 'Task changed after preflight; nothing replaced.' } }
elseif ($p.expect_absent -and $existing) { throw 'Task appeared after preflight; nothing replaced.' }
if ($existing -and $existing.TaskPath -eq $path -and ([string]$existing.Description).IndexOf($p.marker_prefix) -lt 0 -and -not ($p.expected_xml -and [string]$existing.Description -ceq 'Disabled: Toolkit removed. Delete this task or re-run setup toolkit.')) { throw "A task with this name is already in $path and is not Toolkit's; it was left alone." }
$action = New-ScheduledTaskAction -Execute $p.execute -Argument $p.arguments -WorkingDirectory $p.working_directory
if ($p.schedule.kind -eq 'hourly') {
  $trigger = New-ScheduledTaskTrigger -Daily -At $p.schedule.at
  $trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $p.schedule.at -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Hours $p.schedule.hours)).Repetition
} elseif ($p.schedule.kind -eq 'daily') {
  $trigger = New-ScheduledTaskTrigger -Daily -At $p.schedule.at
} else {
  $trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $p.schedule.day -At $p.schedule.at
}
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $p.description
Register-ScheduledTask -TaskPath $path -TaskName $p.name -InputObject $task -Force | Out-Null
ConvertTo-Json -InputObject @{ registered = $true } -Compress`,
  unregister: String.raw`$path = PathOf $p.folder
$t = @(ReadTasks $path) | Where-Object { $_.TaskName -ieq $p.name }
if ($t -and $p.expected_xml -and (Export-ScheduledTask -TaskPath $path -TaskName $p.name) -cne $p.expected_xml) { throw 'Task changed before removal; left alone.' }
if (-not $t -or $t.TaskPath -ne $path) { ConvertTo-Json -InputObject @{ removed = $false } -Compress }
elseif (([string]$t.Description).IndexOf($p.marker) -lt 0) { throw "The task in $path no longer carries Toolkit's marker; it was left alone." }
else { Unregister-ScheduledTask -TaskPath $path -TaskName $p.name -Confirm:$false; ConvertTo-Json -InputObject @{ removed = $true } -Compress }`,
  restore: String.raw`$path = PathOf $p.folder
if ((Export-ScheduledTask -TaskPath $path -TaskName $p.name) -cne $p.expected_xml) { throw 'Task changed before restoration; left alone.' }
Register-ScheduledTask -TaskPath $path -TaskName $p.name -Xml $p.previous_xml -Force | Out-Null`,
  'remove-folder': String.raw`$svc = New-Object -ComObject Schedule.Service
$svc.Connect()
$f = $null
try { $f = $svc.GetFolder('\' + $p.folder) } catch { if ($_.Exception.HResult -notin @(-2147024894, -2147024893)) { throw } }
if (-not $f) { ConvertTo-Json -InputObject @{ folder = 'absent' } -Compress }
elseif ($f.GetTasks(1).Count -eq 0 -and $f.GetFolders(0).Count -eq 0) { $svc.GetFolder('\').DeleteFolder($p.folder, 0); ConvertTo-Json -InputObject @{ folder = 'removed' } -Compress }
else { ConvertTo-Json -InputObject @{ folder = 'kept' } -Compress }`,
  'marked-folders': String.raw`$names = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { ([string]$_.Description).Contains('[toolkit-task v1 ') -and $_.TaskPath -cmatch '^\\[A-Z0-9][A-Z0-9-]{0,31}\\$' } | ForEach-Object { $_.TaskPath.Trim('\') } | Sort-Object -Unique)
ConvertTo-Json -InputObject @($names) -Compress`,
  start: String.raw`Start-ScheduledTask -TaskPath (PathOf $p.folder) -TaskName $p.name
ConvertTo-Json -InputObject @{ started = $true } -Compress`,
  info: String.raw`$path = PathOf $p.folder
$t = Get-ScheduledTask -TaskPath $path -TaskName $p.name
$i = Get-ScheduledTaskInfo -TaskPath $path -TaskName $p.name
ConvertTo-Json -InputObject @{ state = [string]$t.State; last_run = (When $i.LastRunTime); last_result = [int64]$i.LastTaskResult } -Compress`,
});

function powerShellExe(systemRoot = process.env.SystemRoot || 'C:\\Windows') {
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function runPowerShell(op, payload, { run = spawnSync, timeout = 120000 } = {}) {
  if (payload.folder !== null && payload.folder !== undefined && !FOLDER.test(String(payload.folder))) throw new WindowsTasksError(`task folder ${JSON.stringify(payload.folder)} is not valid`, 1);
  if (payload.name !== undefined && nameProblem(payload.name)) throw new WindowsTasksError(`task name ${JSON.stringify(payload.name)} ${nameProblem(payload.name)}`, 1);
  const encoded = Buffer.from(PRELUDE + SCRIPTS[op] + POSTLUDE, 'utf16le').toString('base64');
  const result = run(powerShellExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    env: { ...process.env, TOOLKIT_TASK_PAYLOAD: JSON.stringify(payload) }, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new WindowsTasksError(`PowerShell could not run (${result.error.code || result.error.message})`, 1);
  if (result.status !== 0) throw new WindowsTasksError(String(result.stderr || '').trim().split(/\r?\n/)[0] || `PowerShell ${op} failed`, 1);
  const text = String(result.stdout || '').trim();
  return text ? JSON.parse(text) : null;
}

// The scheduler interface the commands use; tests pass a fake with the same methods.
function powerShellScheduler(options = {}) {
  const ps = (op, payload) => runPowerShell(op, payload, options);
  const asList = value => (Array.isArray(value) ? value : value ? [value] : []);
  return {
    list: folder => asList(ps('list', { folder })),
    markedFolders: () => asList(ps('marked-folders', {})),
    register: (definition, previous = null) => {
      if (previous && !previous.definition_xml) throw new WindowsTasksError('existing task has no exact XML readback; nothing replaced', 1);
      return ps('register', {
      folder: definition.folder, name: definition.name, execute: definition.execute, arguments: definition.arguments, working_directory: definition.working_directory,
      schedule: definition.schedule, description: definition.description, marker_prefix: `[toolkit-task v1 id=${definition.id} `, expected_xml: previous?.definition_xml || null, expect_absent: !previous,
      });
    },
    unregister: (folder, name, id, previous) => ps('unregister', { folder, name, marker: `[toolkit-task v1 id=${id} `, expected_xml: previous?.definition_xml || null }),
    restore: (definition, previous, written) => ps('restore', { folder: definition.folder, name: definition.name, previous_xml: previous.definition_xml, expected_xml: written.definition_xml }),
    removeFolderIfEmpty: folder => ps('remove-folder', { folder }),
    start: (folder, name) => ps('start', { folder, name }),
    info: (folder, name) => ps('info', { folder, name }),
  };
}

// ---- plan, apply, remove, adopt ---------------------------------------------------------------

// What each wanted task needs: create, update, current or refused.
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
function enrolledDefinition(live) {
  return ordered({ description: live.description, enabled: live.state !== 'Disabled',
    execute: live.execute, arguments: live.arguments, working_directory: live.working_directory,
    actions: Array.isArray(live.actions) ? live.actions : [],
    triggers: live.triggers || [], logon_type: live.logon_type || null, principal: live.principal || null, settings: live.settings || null, definition_xml: live.definition_xml || null });
}
const sameDefinition = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const safeAnswerRef = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value) && !tasks.looksSecret(value);

// Owns preflight, persistence and scheduler effects. Every command gets explicit boundaries;
// tests substitute all four effect/identity/clock dependencies, never the user's scheduler/home.
class WindowsTaskOwner {
  constructor({ scheduler, home, registry = tasks, identityReader, now = () => new Date(), repairOwned = false, firstRunOptions = null, takeLock = null, taskChoice = null, readRecord = null, writeRecord = null, computerId = null, allowIndependentChoice = false, preserveOwnerStops = false }) {
    const answers = taskChoice ? Array.isArray(taskChoice) ? taskChoice : [taskChoice] : [];
    for (const taskChoice of answers) if (!['keep', 'replace'].includes(taskChoice.outcome) || !tasks.ID.test(taskChoice.task || '') || !/^[a-f0-9]{64}$/.test(taskChoice.observed || '') || !safeAnswerRef(taskChoice.answer_ref)) throw new WindowsTasksError('task choice needs the exact observation and actual owner answer reference', 1);
    if (new Set(answers.map(a => a.task)).size !== answers.length || new Set(answers.map(a => a.answer_ref)).size !== answers.length) throw new WindowsTasksError('each task needs its own exact owner answer', 1);
    Object.assign(this, { preserveOwnerStops, allowIndependentChoice, scheduler, home, registry, identityReader, now, repairOwned, firstRunOptions, takeLock, answers, readRecord, writeRecord, computerId });
    this.explicitComputerId = computerId;
    this.computerId ||= tasks.computerIdentity(home)?.id || null;
    this.choiceAttempts = new Set();
  }
  // Discovery is shared only within this invocation. Every affected folder, registry and
  // governance observation is still read afresh by every pre-effect guard.
  discover(entries, folder) {
    if (!this.discovery) {
      const folders = new Set([...entries.filter(e => e.host === 'windows').map(e => e.folder), ...this.scheduler.markedFolders()]);
      this.discovery = new Map([...folders].filter(f => f !== folder).map(f => [f, this.scheduler.list(f)]));
    }
    return this.discovery;
  }
  plan(desired) {
    (this.identityReader || desired.identityReader || readLocations)({ ...desired.locations, home: this.home });
    const plannedRead = desired.read;
    const currentRead = desired.read ? readCheckout(desired.root, { ...desired.checkoutDeps, home: this.home }) : null;
    const read = currentRead || plannedRead;
    const registry = this.registry.readRegistry(this.home);
    const entries = registry.status === 'ok' ? registry.tasks : [];
    const assignment = scheduleOwner.assignment(entries, desired.repository, this.computerId, { recoverStopped: this.repairOwned });
    const ours = entries.filter(e => e.host === 'windows' && String(e.repository).toLowerCase() === desired.repository.toLowerCase());
    const cleaners = ours.filter(e => isCleaner(e.job));
    const selected = cleaners[0];
    const folder = selected && !desired.folderOverride ? selected.folder : desired.folder;
    const definitions = [...desired.wanted, ...(desired.definitions || []).filter(d => !desired.wanted.some(w => w.job === d.job))].filter(d => d.job !== 'task-health').map(definition => {
      const id = taskId(folder, definition.job);
      const schedule = sameDefinition(definition.schedule, JOBS[definition.job].schedule) ? scheduleOwner.scheduleFor(definition.job, assignment.minute || 1) : definition.schedule;
      if (definition.folder === folder && sameDefinition(schedule, definition.schedule)) return { ...definition, repo_minute: assignment.minute, job_owner: this.computerId };
      const updated = { ...definition, folder, name: taskName(folder, definition.job), id, schedule, schedule_text: describeSchedule(schedule),
        repo_minute: assignment.minute, job_owner: this.computerId, arguments: definition.arguments.replace(/--task-id [a-z0-9-]+$/, `--task-id ${id}`) };
      updated.def = definitionDigest(updated);
      updated.description = `${folder}: ${JOBS[updated.job].task}. ${updated.purpose} [toolkit-task v1 id=${id} def=${updated.def}]`;
      return updated;
    });
    const fresh = read?.certain;
    const confirmed = require('./toolkit-task-shape.cjs').confirmedTaskShape({ certain: fresh, governanceState: read?.governanceState });
    const desiredJob = confirmed ? confirmed[0]
      : selected?.job || (read?.enabled ? 'programme-sweep' : null);
    const source = cleaners.find(e => e.job !== desiredJob);
    const destination = cleaners.find(e => e.job === desiredJob);
    const relationships = ours.filter(e => e.replaces !== undefined);
    const relationshipOK = relationships.length === 1 && cleaners.length === 2
      && this.validMetadata(relationships[0]) && this.validReplacement(relationships[0].replaces, ours);
    const switching = Boolean(source || cleaners.length > 1 || fresh && desiredJob === 'footer-sweep' && ours.some(e => e.job === 'shard-timings'));
    const live = this.scheduler.list(folder);
    let conflict = null;
    if (ours.some(e => !this.validMetadata({ ...e, replaces: undefined }))) conflict = 'task choice metadata is invalid; exact owner inspection is required';
    if (!this.repairOwned && (relationships.length && !relationshipOK || cleaners.length > 1 && !relationshipOK)) conflict = 'conflicting or exhausted cleaner relationship metadata; explicit owner recovery is required';
    if (cleaners.some(e => e.folder !== folder)) conflict = 'cleaner folders differ; ask the owner to reconcile the recorded folders';
    if (read?.binding?.schedule_folder && read.binding.schedule_folder !== folder && !desired.folderOverride) conflict = `binding folder changed from ${folder} to ${read.binding.schedule_folder}; with explicit approval to keep the recorded folder, run ${applyCommand(desired, { toolkitRoot: desired.locations.toolkitRoot, folderOverride: folder })}; future applies need that override until the binding folder agrees`;
    for (const [otherFolder, rows] of new Map([...this.discover(entries, folder), [folder, live]])) for (const task of rows) {
      const missingRecord = entries.find(e => e.toolkit_missing && e.folder === otherFolder && e.name === task.name && task.state === 'Disabled' && sameDefinition(enrolledDefinition(task), e.enrolled));
      const marker = parseMarker(task.description) || (missingRecord ? { id: missingRecord.id } : null);
      if (!definitions.some(d => sameTaskName(task.name, taskName(otherFolder, d.job)) || marker?.id === taskId(otherFolder, d.job))) continue;
      const target = /--repo-root "([^"\r\n]+)"/.exec(String(task.arguments || ''))?.[1];
      let repository = null;
      try { if (target) repository = repositoryOf((desired.checkoutDeps?.governance || require('./toolkit-governance-state.cjs')).readIdentity(target)); } catch { /* unknown target cannot prove ownership */ }
      if (otherFolder !== folder && repository?.toLowerCase() !== desired.repository.toLowerCase()) continue;
      const record = entries.find(e => e.host === 'windows' && e.folder === otherFolder && e.name === task.name);
      if (!record || record.adopted || !marker || marker.id !== record.id) conflict = (marker && !record
        ? `"${task.name}" carries Toolkit's marker but this computer's task registry does not list it, so Toolkit leaves it alone`
        : `"${task.name}" is already in \\${otherFolder}\\ and is not Toolkit's (no matching ownership), so Toolkit leaves it alone`)
        + `; foreign or unrecorded task conflict; obtain approval for exact inspection/removal, then retry. Inspect Get-ScheduledTask -TaskPath '\\${otherFolder}\\' -TaskName '${task.name.replace(/'/g, "''")}'; only after approval: Unregister-ScheduledTask -TaskPath '\\${otherFolder}\\' -TaskName '${task.name.replace(/'/g, "''")}' -Confirm:$false`;
      else if (!ours.includes(record) || otherFolder !== folder) conflict = 'another cleaner is enrolled for this repository; explicit owner recovery is required';
    }
    const wanted = definitions.filter(d => confirmed ? confirmed.includes(d.job) : d.job === desiredJob || d.job === 'shard-timings' && read?.enabled && desiredJob === 'programme-sweep');
    // Retirement follows destination registration; shard effects come last.
    const ordered = [...wanted.filter(d => isCleaner(d.job)),
      ...definitions.filter(d => d.job === source?.job),
      ...definitions.filter(d => d.job === 'shard-timings' && (wanted.some(w => w.job === d.job) || fresh && ours.some(e => e.job === d.job)))];
    const items = ordered.map(definition => {
      const existing = live.find(task => sameTaskName(task.name, definition.name));
      const recorded = entries.find(entry => entry.id === definition.id);
      const retiring = definition.job === source?.job || definition.job === 'shard-timings' && desiredJob === 'footer-sweep';
      const refuse = reason => ({ definition, action: 'refused', reason });
      if (registry.status !== 'ok') return refuse('task registry could not be read');
      if (assignment.conflict) return refuse(assignment.conflict);
      if (conflict) return refuse(conflict);
      if (currentRead && !sameDefinition(currentRead, plannedRead)) return refuse('origin or governance changed after planning; refresh status and run a fresh plan');
      if (read && (!read.repository || read.repository.toLowerCase() !== definition.repository.toLowerCase())) return refuse('repository origin changed; left alone');
      if (!fresh && (switching || desiredJob !== 'programme-sweep' || !read?.enabled)) return refuse('fresh matching merged governance could not be verified; existing shape and folder retained; refresh governance status, then retry plan');
      if (recorded?.stopped_by_owner && (!this.repairOwned || this.preserveOwnerStops)) return refuse('stopped by owner');
      if (ours.some(e => e.job === definition.job && e.id !== definition.id)) return refuse('this repository already has this job enrolled in another folder; ask owner to reconcile it');
      if (recorded && (recorded.adopted || recorded.host !== 'windows' || recorded.folder !== definition.folder || recorded.name !== definition.name)) return refuse('adopted or unowned enrolment; Toolkit leaves it alone');
      if (recorded && String(recorded.repository).toLowerCase() !== definition.repository.toLowerCase()) return refuse('repository ownership differs; Toolkit leaves it alone');
      const missingDisabled = recorded?.toolkit_missing === true && existing?.state === 'Disabled'
        && existing.description === require('./toolkit-task-launcher.cjs').DISABLED_DESCRIPTION
        && sameDefinition(enrolledDefinition(existing), recorded.enrolled);
      if (this.preserveOwnerStops && existing?.state === 'Disabled' && !missingDisabled) return refuse('disabled by owner; left alone');
      const marker = existing && (parseMarker(existing.description) || (missingDisabled ? { id: recorded.id } : null));
      if (existing && existing.name !== definition.name) return refuse('task name differs from its fixed name; Toolkit leaves it alone');
      if (existing && (!marker || marker.id !== definition.id || !recorded)) return refuse('task is unowned or unrecorded; obtain approval for exact inspection/removal, then retry');
      if (!recorded) return { definition, action: 'create', observed: null, recorded: null };
      let reason = null;
      if (recorded.stopped_by_owner) reason = 'stopped by owner';
      else if (!existing) reason = 'unproven absence: enrolled task is missing; no deletion attribution or owner stop inferred';
      else if ((!recorded.checkout || !recorded.toolkit_root || !recorded.enrolled) && !recognisedEarlier(existing, recorded, definition)) reason = 'legacy enrolment cannot prove checkout or definition; ask owner';
      else if (recorded.checkout && !samePath(recorded.checkout, definition.checkout)) reason = 'checkout ownership differs; ask owner';
      else if (recorded.toolkit_root && !samePath(recorded.toolkit_root, definition.toolkit_root)) reason = 'Toolkit runner location differs; ask owner';
      else if (existing?.state === 'Disabled') reason = 'stopped by owner: disabled task';
      if (reason && !this.repairOwned) return refuse(reason);
      // Live participants retain their location guards even after a recorded stop. Explicit
      // repair may reconcile absent modern enrolments at the currently verified locations.
      // Legacy rows need approved removal first, recording a stop and independent absence.
      if (switching && this.repairOwned && existing && recorded.checkout && !samePath(recorded.checkout, definition.checkout)) return refuse('checkout ownership differs; ask owner');
      if (switching && this.repairOwned && existing && recorded.toolkit_root && !samePath(recorded.toolkit_root, definition.toolkit_root)) return refuse('Toolkit runner location differs; ask owner');
      if (switching && this.repairOwned && (!recorded.checkout || !recorded.toolkit_root || !recorded.enrolled)
        && !(recorded.stopped_by_owner && !existing)) return refuse('legacy enrolment needs approved scoped remove followed by apply --repair-owned');
      if (switching && existing?.state === 'Running') return refuse('a participating task is running; retry apply after it finishes');
      let choice = null;
      const observed = existing ? enrolledDefinition(existing) : null;
      if (switching && existing?.state === 'Disabled' && recorded.enrolled
        && !sameDefinition({ ...observed, enabled: recorded.enrolled.enabled }, recorded.enrolled)) return refuse('disabled participant also has an edited definition; approved scoped remove followed by repair is required');
      if (existing && switching && (!samePath(existing.working_directory, recorded.enrolled?.working_directory || recorded.toolkit_root)
        || !samePath(/--repo-root "([^"\r\n]+)"/.exec(existing.arguments || '')?.[1], definition.checkout))) return refuse('live checkout or Toolkit runner location differs; explicit owner recovery is required');
      if (existing && recorded.enrolled && !sameDefinition(observed, recorded.enrolled) && existing.state !== 'Disabled' && !(this.repairOwned && !switching && !this.allowIndependentChoice)) {
        if (definition.job === 'footer-sweep' && !this.allowIndependentChoice) reason = 'stopped by owner: hand-edited task definition';
        else if (!fresh) return refuse('modified governance task needs fresh status and the owner keep-or-replace answer');
        else {
          const fingerprint = digest({ repository: desired.repository, checkout: definition.checkout, folder, task: definition.id, revision: read.revision, binding: read.binding, observed });
          const changed = Object.keys(observed).filter(key => !sameDefinition(observed[key], recorded.enrolled[key]));
          choice = { task: definition.id, repository: desired.repository, folder, operation: retiring ? 'retire' : 'restore Toolkit definition', fingerprint, changed, last_choice: recorded.task_choices?.at(-1) || null,
            question: "Keep your changes or replace with Toolkit's original?" };
          const answer = this.answers.find(a => a.task === definition.id);
          if (!answer || answer.task !== definition.id || answer.observed !== fingerprint || !this.choiceAttempts.has(answer.answer_ref) && entries.some(e => (e.task_choices || []).some(c => c.answer_ref === answer.answer_ref))) {
            return { definition, action: 'owner-choice-required', reason: answer ? 'answer is stale, reused or for another task; ask the owner again' : choice.question, choice, observed, recorded };
          }
          choice = { ...choice, ...answer };
          if (answer.outcome === 'keep') return { definition, action: 'owner-choice-required', reason: 'owner kept the changes; the whole operation stays held', choice, observed, recorded };
        }
      }
      if (reason && (!this.repairOwned || switching && existing && reason === 'stopped by owner: hand-edited task definition')) return refuse(reason);
      return { definition, action: retiring ? 'retire' : reason || choice || !sameDefinition(observed, recorded.enrolled) || marker?.def !== definition.def || this.computerId && recorded.job_owner !== this.computerId ? 'update' : 'current', observed, recorded, ...(choice ? { choice } : {}), ...(reason ? { recovery: reason } : {}) };
    });
    // Historical shard stops also hold an ON switch before the destination is touched.
    if (this.answers.some(a => !items.some(i => i.choice?.outcome && i.choice.task === a.task))) {
      for (const item of items) Object.assign(item, { action: 'refused', reason: 'answer is stale, reused or no longer matches a modified governance task; ask the owner again' });
    }
    const held = items.find(item => ['refused', 'owner-choice-required'].includes(item.action));
    if (held) for (const item of items) if (!['refused', 'owner-choice-required'].includes(item.action)) Object.assign(item, { action: 'refused', reason: `all selected jobs held: ${held.reason}` });
    const command = applyCommand(desired, { toolkitRoot: desired.locations.toolkitRoot });
    const reset = `approved reset: ${command.replace(' apply ', ' remove ')}; then ${command} --repair-owned`;
    const resetRequired = switching && items.some(i => {
      const record = entries.find(e => e.id === i.definition.id);
      const task = live.find(t => sameTaskName(t.name, i.definition.name));
      return record && (task && (!samePath(record.checkout, i.definition.checkout) || !samePath(record.toolkit_root, i.definition.toolkit_root)
        || !samePath(task.working_directory, record.enrolled?.working_directory || record.toolkit_root) || !samePath(/--repo-root "([^"\r\n]+)"/.exec(task.arguments || '')?.[1], i.definition.checkout))
        || (!record.checkout || !record.toolkit_root || !record.enrolled) && !(record.stopped_by_owner && !task));
    });
    const recovery = `Explicit approval must name affected tasks, paths, recreation, obsolete-record removal and any owner-stop reactivation. ${resetRequired ? `Complete ${reset}; removal temporarily leaves no cleaner` : `Owner-authorised recovery: ${command} --repair-owned. If edits or legacy proof prevent that, ${reset}`}.`;
    const recoverable = held && /unproven absence|relationship metadata|stopped by owner|legacy enrolment|disabled participant also|checkout ownership differs|Toolkit runner location differs|live checkout or Toolkit runner location differs/.test(held.reason);
    const next = held ? !fresh && switching ? `Refresh governance status, then run a fresh task plan. ${held.reason}`
      : held.action === 'owner-choice-required' ? held.choice.question : `${held.reason}${recoverable && fresh ? `. ${recovery}` : ''}`
      : !items.length ? 'Refresh governance status, then run the task plan again.'
      : items.some(i => i.action !== 'current') ? 'Run apply from the recorded managed Toolkit checkout against this repository main checkout, then read back tasks and results.' : 'No task changes needed.';
    return { folder, repository: desired.repository, registry: registry.status, items, switching,
      source: source || null, destination: definitions.find(d => d.job === desiredJob),
      relationshipUpdate: Boolean(!destination ? relationships.length : source
        ? !relationshipOK || relationships[0].id !== destination.id || !sameDefinition(destination.replaces.cleaner, this.proof(source))
        : relationships.length),
      assignment,
      independent_jobs: taskPolicy.INDEPENDENT_JOBS,
      approval: items.length && !held ? desired.folderOverride || this.repairOwned ? 'explicit approval required' : taskPolicy.STANDING_APPROVAL : 'verification held; no standing action',
      coverage: read?.governanceState !== 'ENABLED' ? 'Programme refresh is not selected by current governance.' : live.some(t => t.name === taskName(folder, 'programme-sweep') && t.state !== 'Disabled') ? 'PROGRAMME SWEEP is present; check its result for programme coverage.' : 'Programme refresh coverage is missing.',
      next_step: next, skipped: items.length ? [] : desired.skipped };
  }
  validMetadata(entry) {
    if (entry.task_choices !== undefined && (!Array.isArray(entry.task_choices) || entry.task_choices.some(c => !c || !['keep', 'replace'].includes(c.outcome) || !safeAnswerRef(c.answer_ref) || !/^[a-f0-9]{64}$/.test(c.observed) || !tasks.ID.test(c.task)))) return false;
    if (entry.replaces !== undefined && (!isCleaner(entry.job) || !entry.replaces || Object.keys(entry.replaces).join() !== 'cleaner' || !this.validProof(entry.replaces.cleaner) || !isCleaner(entry.replaces.cleaner.job) || entry.replaces.cleaner.job === entry.job || entry.replaces.cleaner.id !== taskId(entry.folder, entry.replaces.cleaner.job))) return false;
    return true;
  }
  validProof(proof) { return proof && tasks.ID.test(proof.id) && Object.hasOwn(JOBS, proof.job) && /^[a-f0-9]{64}$/.test(proof.identity); }
  proof(entry) { return { id: entry.id, job: entry.job, identity: digest([entry.id, entry.job, entry.folder, entry.repository, entry.checkout, entry.toolkit_root, entry.enrolled]) }; }
  validReplacement(relation, entries) {
    const source = entries.find(e => e.id === relation?.cleaner?.id);
    return Boolean(source && sameDefinition(relation.cleaner, this.proof(source)));
  }
  apply(desired) {
    this.discovery = null;
    // Identity/ownership refusals precede even the local apply-lock write. Recheck under lock.
    const preview = this.plan(desired);
    if (preview.registry !== 'ok') throw new WindowsTasksError(`the task registry ${tasks.registryPath(this.home)} could not be read, so no task was changed`, 1);
    const kept = plan => plan.items.find(i => i.action === 'owner-choice-required' && i.choice?.outcome === 'keep');
    if (preview.skipped.length || preview.items.some(item => ['refused', 'owner-choice-required'].includes(item.action)) && !kept(preview)) return { ...preview, refused: true };
    const takeLock = this.takeLock || require('../../skills/github-program-reconciler/scripts/programme-lock.cjs').takeLock;
    const file = path.join(tasks.userStateDir(this.home), 'tasks', 'apply-registry.lock');
    const lock = takeLock(file);
    if (!lock) throw new WindowsTasksError('another task apply is running on this computer', 1);
    let footerLock = null;
    const releaseFooter = () => { if (footerLock) { const held = footerLock; footerLock = null; held.release(); } };
    try {
      this.computerId = this.explicitComputerId || tasks.computerIdentity(this.home, { create: true }).id;
      const guarded = this.plan(desired);
      if (kept(guarded)) {
        for (const item of guarded.items.filter(i => i.choice?.outcome)) this.consumeChoice(item);
        return { ...guarded, refused: true };
      }
      if (guarded.items.some(i => ['refused', 'owner-choice-required'].includes(i.action))) return { ...guarded, refused: true };
      if (guarded.switching) {
        footerLock = takeLock(require('./toolkit-scheduled-job.cjs').footerLockPath(desired.repository, this.home));
        if (!footerLock) return { ...guarded, refused: true, next_step: 'Footer cleaning is running; retry apply after it finishes.', items: guarded.items.map(i => ({ ...i, action: 'refused', reason: 'footer lock held; retry after the cleaner finishes' })) };
      }
      return this.applyLocked(desired, releaseFooter);
    } finally { releaseFooter(); lock.release(); this.discovery = null; }
  }
  consumeChoice(item) {
    const choice = item.choice;
    if (!choice || !safeAnswerRef(choice.answer_ref)) throw new Error('the actual owner answer reference is required');
    this.registry.updateRegistry(this.home, list => {
      const entry = list.find(e => e.id === item.definition.id);
      if (!sameDefinition(entry, item.recorded) || list.some(e => (e.task_choices || []).some(c => c.answer_ref === choice.answer_ref))) throw new Error('owner answer is stale or already consumed');
      return list.map(e => e !== entry ? e : { ...e, task_choices: [...(e.task_choices || []), { task: e.id, outcome: choice.outcome, observed: choice.fingerprint, answer_ref: choice.answer_ref, at: this.now().toISOString() }] });
    });
    this.choiceAttempts.add(choice.answer_ref);
  }
  copyHistory(source, destination, beforeWrite) {
    const runner = require('./toolkit-scheduled-job.cjs');
    const read = this.readRecord || (id => tasks.readLastRun(id, this.home) || (fs.existsSync(tasks.lastRunPath(id, this.home)) ? {} : null));
    const at = this.now();
    // An unenrolled destination's record belongs to a completed earlier stint. Only a
    // currently enrolled overlap can hold an independent pending retry boundary.
    const enrolled = this.registry.readRegistry(this.home);
    if (enrolled.status !== 'ok') throw new Error('history ownership could not be read');
    const participants = [source, ...(enrolled.tasks.some(e => e.id === destination.id) ? [destination] : [])];
    const histories = participants.map(d => runner.footerCursor(read(d.id), d, destination.repository, at));
    const since = histories.map(h => h.since).sort()[0];
    const record = { schema: 'toolkit.task-last-run.v1', id: destination.id, job: destination.job, repository: destination.repository, footer_sweep_since: since };
    beforeWrite();
    (this.writeRecord || ((id, value) => tasks.writeLastRun(id, value, this.home)))(destination.id, record);
    if (!sameDefinition(read(destination.id), record)) throw new Error('history readback failed; source retained');
    return histories.map(h => h.note).filter(Boolean);
  }
  applyLocked(desired, beforeFirstRun = () => {}) {
    let plan = this.plan(desired);
    if (plan.registry !== 'ok') throw new WindowsTasksError(`the task registry ${tasks.registryPath(this.home)} could not be read, so no task was changed`, 1);
    if (plan.skipped.length) return { ...plan, refused: true };
    if (plan.items.some(item => ['refused', 'owner-choice-required'].includes(item.action))) return { ...plan, refused: true };
    plan.next_step = 'Read the reported result; if apply failed, run a fresh task plan and inspect the failure before retrying.';
    // Consume the exact answer once, before any native effect. A failed attempt asks again.
    for (const answered of plan.items.filter(item => item.choice?.outcome === 'replace')) this.consumeChoice(answered);
    if (plan.relationshipUpdate) {
      const expected = this.registry.readRegistry(this.home);
      if (expected.status !== 'ok') throw new Error('relationship registry could not be read');
      this.registry.updateRegistry(this.home, list => {
        if (!sameDefinition(list, expected.tasks)) throw new Error('registry changed before relationship update');
        return list.map(entry => {
          if (entry.host !== 'windows' || String(entry.repository).toLowerCase() !== desired.repository.toLowerCase()) return entry;
          const { replaces, ...rest } = entry;
          return entry.id === plan.destination.id && plan.source ? { ...rest, replaces: { cleaner: this.proof(plan.source) } } : rest;
        });
      });
      plan = this.plan(desired);
      if (plan.items.some(i => ['refused', 'owner-choice-required'].includes(i.action)) || plan.relationshipUpdate) throw new Error('relationship readback failed; re-plan before effects');
      plan.next_step = 'Read the reported result; if apply failed, run a fresh task plan and inspect the failure before retrying.';
    }
    let historyNotes = [];
    if (plan.source) historyNotes = this.copyHistory(plan.source, plan.destination, () => {
      const fresh = this.plan(desired);
      if (fresh.items.some(i => ['refused', 'owner-choice-required'].includes(i.action))) throw new Error('tasks or governance changed before history copy; source retained');
    });
    const results = [];
    for (const item of plan.items) {
      const { definition } = item;
      if (item.action === 'current') { results.push({ ...item, done: true }); continue; }
      let backup = null;
      let previous = null;
      let written = null;
      try {
        // Recheck both jobs and the registry immediately before each effect. Do not restore over
        // an unexpected live definition: it may be an owner edit. The exact old XML stays backed up.
        const fresh = this.plan(desired);
        if (fresh.items.some(row => ['refused', 'owner-choice-required'].includes(row.action))) throw new Error('tasks changed after preflight; all selected jobs held');
        const expected = fresh.items.find(row => row.definition.id === definition.id);
        if (!expected) throw new Error('task selection changed after preflight');
        previous = this.scheduler.list(definition.folder).find(row => row.name === definition.name) || null;
        if (!sameDefinition(previous ? enrolledDefinition(previous) : null, expected.observed)) throw new Error('task changed after preflight; left alone');
        if (item.action === 'retire') {
          if (previous) {
            if (this.scheduler.unregister(definition.folder, definition.name, definition.id, previous)?.removed !== true) throw new Error('removal was not acknowledged; absence is unproven');
          } else if (!this.repairOwned) throw new Error('absence is unproven; owner-authorised recovery required');
          if (this.scheduler.list(definition.folder).some(row => sameTaskName(row.name, definition.name))) throw new Error('retirement readback failed; retry the verified remaining effect');
          this.registry.updateRegistry(this.home, list => {
            if (!sameDefinition(list.find(e => e.id === definition.id), expected.recorded)) throw new Error('registry changed before retirement cleanup');
            const choices = expected.recorded.task_choices || [];
            return list.filter(e => e.id !== definition.id).map(e => {
              if (e.id !== plan.destination.id) return e;
              const { replaces, ...rest } = e;
              return { ...rest, ...(choices.length ? { task_choices: [...(e.task_choices || []), ...choices] } : {}) };
            });
          });
          const saved = this.registry.readRegistry(this.home);
          if (saved.status !== 'ok' || saved.tasks.some(e => e.id === definition.id) || saved.tasks.find(e => e.id === plan.destination.id)?.replaces) throw new Error('retirement registry readback failed');
          this.answers = this.answers.filter(a => a.task !== definition.id);
          results.push({ ...item, done: true, ...(this.repairOwned ? { recovery: 'owner-authorised recovery; no deletion attribution inferred' } : {}) });
          continue;
        }
        if (previous) backup = this.registry.writeTaskBackup(this.home, definition.id, { task: previous, registry: expected.recorded });
        installLauncher(this.home);
        this.scheduler.register(definition, previous);
        const live = this.scheduler.list(definition.folder).find(row => row.name === definition.name);
        if (!verifiedDefinition(live, definition)) throw new Error('scheduler readback failed; registration is not verified; preserve the backup and inspect the live task');
        written = live;
        this.registry.updateRegistry(this.home, list => {
          const existing = list.find(entry => entry.id === definition.id);
          const planned = fresh.items.find(row => row.definition.id === definition.id);
          if (!planned || !sameDefinition(existing || null, expected.recorded)) throw new Error('registry changed after preflight; owner choices retained');
          const replacement = plan.source && isCleaner(definition.job) ? { cleaner: this.proof(plan.source) } : null;
          return [...list.filter(entry => entry.id !== definition.id), { ...registryEntry(definition, existing, this.now, live),
            ...(replacement ? { replaces: replacement } : {}), ...(existing?.task_choices ? { task_choices: existing.task_choices } : {}) }];
        });
        const saved = this.registry.readRegistry(this.home);
        if (saved.status !== 'ok' || !sameDefinition(saved.tasks.find(entry => entry.id === definition.id)?.enrolled, enrolledDefinition(live))) throw new Error('registry readback failed');
        this.answers = this.answers.filter(a => a.task !== definition.id);
        results.push({ ...item, done: true, ...(backup ? { backup } : {}) });
      } catch (error) {
        let restoration = 'not attempted: no verified replacement, or the registry already changed';
        // Only undo our verified replacement while the old registry still stands. Compare
        // again in the native adapter so a concurrent owner edit is never overwritten.
        const recorded = this.registry.readRegistry(this.home);
        const old = recorded.status === 'ok' && recorded.tasks.find(entry => entry.id === definition.id);
        const oldStillRecorded = recorded.status === 'ok' && (previous ? old && sameDefinition(old.enrolled, enrolledDefinition(previous)) : !old);
        if (!plan.switching && written && oldStillRecorded) {
          try {
            const current = this.scheduler.list(definition.folder).find(row => row.name === definition.name);
            if (!sameDefinition(enrolledDefinition(current || {}), enrolledDefinition(written))) throw new Error('concurrent task edit; left alone');
            if (previous) this.scheduler.restore(definition, previous, written);
            else this.scheduler.unregister(definition.folder, definition.name, definition.id, written);
            const restored = this.scheduler.list(definition.folder).find(row => row.name === definition.name);
            if (previous ? !restored || !sameDefinition(enrolledDefinition(restored), enrolledDefinition(previous)) : restored) throw new Error('restoration readback failed');
            restoration = previous ? 'previous definition restored and read back' : 'new registration removed and read back';
          } catch (restoreError) { restoration = `restoration held or failed: ${tasks.safeText(restoreError.message)}`; }
        }
        results.push({ ...item, done: false, error: tasks.safeText(error.message), restoration, ...(backup ? { backup } : {}) });
        for (const pending of plan.items.slice(results.length)) results.push({ ...pending, done: false, error: 'held after registration failure' });
        return { ...plan, items: results };
      }
    }
    beforeFirstRun();
    // All selected jobs have been registered and read back before the potentially ten-minute wait.
    const sweep = results.find(item => isCleaner(item.definition.job) && ['create', 'update'].includes(item.action));
    if (sweep && this.firstRunOptions) {
      try { sweep.first_run = firstRun(sweep.definition, { scheduler: this.scheduler, home: this.home, now: this.now, ...this.firstRunOptions,
        beforeStart: () => { if (this.plan(desired).items.some(item => item.action !== 'current')) throw new Error('task definition or owner choice changed; no first start'); },
      }); }
      catch (error) { sweep.first_run = { status: 'failed', detail: `registration verified; first-run check or wait interrupted: ${tasks.safeText(error.message)}` }; }
    }
    // A successful effect is not proof of the whole shape. Read native tasks and registry
    // independently again, including unwanted shards and any second cleaner.
    const complete = this.plan(desired);
    if (!complete.items.length || complete.items.some(i => i.action !== 'current') || complete.relationshipUpdate) return { ...plan, items: results, refused: true, next_step: `Final shape verification held: ${complete.next_step}` };
    return { ...plan, history_notes: historyNotes, items: results };
  }
  remove(folder = null, scope) {
    if (!scope?.repository || !scope.root) throw new WindowsTasksError('removal needs a verified repository main checkout; use remove --repo-root <primary-checkout>', 1);
    (this.identityReader || scope.identityReader || readLocations)({ ...scope.locations, home: this.home });
    const current = readCheckout(scope.root, { ...scope.checkoutDeps, home: this.home });
    if (current.repository?.toLowerCase() !== scope.repository.toLowerCase()) throw new WindowsTasksError('repository origin changed; no tasks removed', 1);
    const registry = this.registry.readRegistry(this.home);
    if (registry.status !== 'ok') throw new WindowsTasksError(`the task registry ${tasks.registryPath(this.home)} could not be read, so no task was removed`, 1);
    // Removal is explicitly approved and repository-scoped. The current primary checkout's
    // verified GitHub origin and the non-adopted registry repository prove the scope, even
    // before checkout was recorded or after it moved. Live marker + exact XML still guard deletion.
    const ours = registry.tasks.filter(entry => entry.host === 'windows' && !entry.adopted && String(entry.repository).toLowerCase() === scope.repository.toLowerCase() && (!folder || entry.folder === folder));
    const results = [];
    for (const entry of ours) {
      const live = this.scheduler.list(entry.folder).find(task => sameTaskName(task.name, entry.name));
      const marker = live && parseMarker(live.description);
      if (live && (live.name !== entry.name || !marker || marker.id !== entry.id)) { results.push({ ...entry, action: 'refused', reason: 'the task no longer carries Toolkit\'s marker; left alone' }); continue; }
      try {
        this.registry.updateRegistry(this.home, list => list.map(item => item.id === entry.id ? { ...item, stopped_by_owner: true, stopped_at: item.stopped_at || this.now().toISOString() } : item));
        const saved = this.registry.readRegistry(this.home);
        if (saved.status !== 'ok' || !saved.tasks.find(item => item.id === entry.id)?.stopped_by_owner) throw new Error('owner stop readback failed; live task retained');
        if (live && this.scheduler.unregister(entry.folder, entry.name, entry.id, live)?.removed !== true) throw new Error('removal was not acknowledged');
        if (this.scheduler.list(entry.folder).some(task => task.name === entry.name)) throw new Error('unregister readback failed; live task remains, stop retained');
        results.push({ ...entry, action: live ? 'removed' : 'stopped by owner (already absent)' });
      } catch (error) { results.push({ ...entry, action: 'failed', reason: `stop retained if saved; live task may remain: ${tasks.safeText(error.message)}` }); }
    }
    const folders = [];
    for (const name of [...new Set(ours.map(entry => entry.folder))].sort()) {
      if (results.some(row => row.folder === name && ['failed', 'refused'].includes(row.action))) continue;
      try { folders.push({ folder: name, result: this.scheduler.removeFolderIfEmpty(name)?.folder || 'kept' }); }
      catch (error) { folders.push({ folder: name, result: 'failed', reason: tasks.safeText(error.message) }); }
    }
    return { repository: scope.repository, checkout: scope.root, items: results, folders };
  }
}

function isCleaner(job) { return job === 'programme-sweep' || job === 'footer-sweep'; }

// Frozen published definitions: original daytime jobs, shard wording updates and full-day
// cleaners. An exact live shape plus enrolment and digest proves a baseline-less migration.
const EARLIER_JOBS = Object.freeze([
  { job: 'programme-sweep', schedule: { kind: 'hourly', at: '08:00', hours: 16 }, purpose: 'Brings the programme pages up to date, keeps the attention line and removes the cloud route footer from your own GitHub posts. No AI.', withoutPurpose: true },
  ...[
    'Refreshes the measured test times and opens a pull request when the CI shards drift. No AI.',
    'Refreshes test times and opens a pull request when CI shards drift; no shards yet means no changes, and timing starts automatically when shards appear. No AI.',
    'Refreshes test times and opens a pull request when CI shards drift; no shards yet means no changes, and timing starts when the manifest becomes available in the registered checkout. No AI.',
  ].map(purpose => ({ job: 'shard-timings', schedule: { kind: 'weekly', day: 'Monday', at: '09:15' }, purpose, withoutPurpose: true })),
  ...Object.entries({
    'programme-sweep': 'Cleans your own GitHub posts first, then brings programme pages and attention up to date under governance guards. No AI.',
    'footer-sweep': 'Removes the cloud route footer from your own GitHub posts in this repository and its freshly verified evidence store. No AI.',
    'shard-timings': 'Refreshes test times and opens a pull request when CI shards drift; no shards yet means no changes, and timing starts when the manifest becomes available in the registered checkout. No AI.',
  }).map(([job, purpose]) => ({ job, purpose, schedule: job === 'shard-timings' ? { kind: 'weekly', day: 'Monday', at: '09:15' } : { kind: 'hourly', at: '00:00', hours: 24 } })),
]);

function recognisedEarlier(live, recorded, definition) {
  if (!live || !recorded || recorded.adopted || recorded.stopped_by_owner || recorded.id !== definition.id
    || recorded.job !== definition.job || recorded.name !== definition.name || recorded.folder !== definition.folder) return false;
  if (recorded.enrolled) return false; // A stored baseline must always match independently.
  return EARLIER_JOBS.filter(old => old.job === definition.job).some(old => {
    const legacyRunner = path.win32.join(definition.toolkit_root, 'repo', 'scripts', 'toolkit-scheduled-job.cjs');
    const candidate = { ...definition, working_directory: definition.toolkit_root, purpose: old.purpose, schedule: old.schedule, arguments: definition.arguments.replace(`${quotePath(definition.launcher, 'launcher')} ${quotePath(definition.toolkit_root, 'root')}`, quotePath(legacyRunner, 'runner')) };
    const { execute, arguments: args, working_directory: workingDirectory, schedule } = candidate;
    candidate.def = old.withoutPurpose ? crypto.createHash('sha256').update(JSON.stringify({ execute, args, workingDirectory, schedule, settings: 'v1 interactive start-when-available ignore-new 30m battery' })).digest('hex').slice(0, 12) : definitionDigest(candidate);
    candidate.description = `${definition.folder}: ${JOBS[definition.job].task}. ${old.purpose} [toolkit-task v1 id=${definition.id} def=${candidate.def}]`;
    return recorded.definition === candidate.def && recorded.purpose === candidate.purpose
      && recorded.schedule === describeSchedule(candidate.schedule) && verifiedDefinition(live, candidate);
  });
}

function verifiedDefinition(live, definition) {
  if (!live || live.state === 'Disabled' || live.description !== definition.description) return false;
  const actions = enrolledDefinition(live).actions;
  if (actions.length !== 1 || actions[0].execute !== definition.execute || actions[0].arguments !== definition.arguments || actions[0].working_directory !== definition.working_directory) return false;
  if (live.execute !== actions[0].execute || live.arguments !== actions[0].arguments || live.working_directory !== actions[0].working_directory) return false;
  const triggers = live.triggers || [];
  if (triggers.length !== 1 || triggers[0].enabled === false || timeOf(triggers[0].start) !== definition.schedule.at) return false;
  const tr = triggers[0];
  if (live.principal && (live.principal.logon_type !== 'Interactive' || live.principal.run_level !== 'Limited')) return false;
  if (live.settings && (!live.settings.enabled || !live.settings.start_when_available || live.settings.multiple_instances !== 'IgnoreNew'
    || live.settings.execution_time_limit !== 'PT30M' || live.settings.disallow_start_if_on_batteries || live.settings.stop_if_going_on_batteries)) return false;
  return definition.schedule.kind === 'hourly' ? /Daily/.test(tr.kind) && tr.interval === 'PT1H' && (tr.duration === `PT${definition.schedule.hours}H` || definition.schedule.hours === 24 && tr.duration === 'P1D')
    : definition.schedule.kind === 'daily' ? /Daily/.test(tr.kind) && !tr.interval && (tr.days_interval === undefined || Number(tr.days_interval) === 1)
    : /Weekly/.test(tr.kind) && Number(tr.days_of_week) === 2 && (tr.weeks_interval === undefined || Number(tr.weeks_interval) === 1);
}

function planTasks(desired, options) { return new WindowsTaskOwner(options).plan(desired); }

function registryEntry(definition, existing, now, live) {
  return {
    id: definition.id, name: definition.name, host: 'windows', folder: definition.folder, schedule: definition.schedule_text, model: null, effort: null,
    purpose: definition.purpose, repository: definition.repository, created: existing ? existing.created : now().toISOString(), created_by: 'toolkit-windows-tasks apply',
    toolkit_version: JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/toolkit-local-bridge/version.json'), 'utf8')).version,
    job: definition.job, definition: definition.def, checkout: definition.checkout, toolkit_root: definition.toolkit_root, enrolled: enrolledDefinition(live),
    repo_minute: definition.repo_minute, job_owner: definition.job_owner, job_owner_label: os.hostname(),
  };
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Starts a task once and waits for it; one more start after 0xC000013A (a console close stopped it).
// Healthy only when the job's own last-run record, written after the start, says it ended well.
function firstRun(definition, { scheduler, home, now = () => new Date(), wait = sleep, waitMs = FIRST_RUN_WAIT_MS, pollMs = POLL_MS, beforeStart = () => {} }) {
  let restarted = false;
  for (;;) {
    beforeStart();
    const started = now();
    scheduler.start(definition.folder, definition.name);
    let info = null;
    for (let waited = 0; waited <= waitMs; waited += pollMs) {
      wait(pollMs);
      info = scheduler.info(definition.folder, definition.name);
      if (info && info.state !== 'Running' && info.last_run && Date.parse(info.last_run) >= started.getTime() - 2000) break;
    }
    if (info && info.state === 'Running') return { status: 'still running', detail: `it did not finish within ${Math.round(waitMs / 60000)} minutes; toolkit tasks shows its result when it ends` };
    if (!info || !info.last_run || Date.parse(info.last_run) < started.getTime() - 2000) return { status: 'failed', detail: 'Windows did not start it; open Task Scheduler and check the task' };
    if ((Number(info.last_result) >>> 0) === STATUS_CONTROL_C_EXIT && !restarted) { restarted = true; continue; }
    const last = tasks.readLastRun(definition.id, home);
    const fresh = last && Date.parse(last.started) >= started.getTime() - 2000;
    if (!fresh) return { status: 'failed', detail: `Windows reports ${describeResult(info.last_result)} but the job wrote no result${restarted ? ' (started twice after a console close)' : ''}` };
    const ok = last.exit === 0 && last.status === 'ok';
    return { status: ok ? 'ok' : last.status === 'deferred' ? 'deferred' : 'failed', detail: `${last.status}: ${(last.summary || []).slice(0, 3).join(' | ')}`, restarted };
  }
}

function applyTasks(desired, options) { return new WindowsTaskOwner(options).apply(desired); }

function removeTasks(options) { return new WindowsTaskOwner(options).remove(options.folder, options.scope); }

function adoptTask({ folder, task, id, purpose, repository = null }, { scheduler, home, now = () => new Date() }) {
  if (!FOLDER.test(String(folder))) throw new WindowsTasksError('--folder must be the folder name, such as TOOLKIT');
  if (nameProblem(task)) throw new WindowsTasksError(`--task ${nameProblem(task)}`);
  if (!tasks.ID.test(String(id))) throw new WindowsTasksError('--id must be lower-case letters, digits and hyphens');
  if (!purpose) throw new WindowsTasksError('--purpose is needed');
  const live = scheduler.list(folder).find(item => item.name === task);
  if (!live) throw new WindowsTasksError(`no task "${task}" in \\${folder}\\ to adopt`, 1);
  if (parseMarker(live.description)) throw new WindowsTasksError(`"${task}" carries Toolkit's marker; it is Toolkit's own, not one to adopt`, 1);
  const entry = { id, name: task, host: 'windows', folder, schedule: describeTriggers(live.triggers) || 'no trigger', model: null, effort: null, purpose, repository,
    created: now().toISOString(), created_by: 'toolkit-windows-tasks adopt', adopted: true };
  tasks.updateRegistry(home, list => {
    const clash = list.find(item => item.id === id || (item.host === 'windows' && item.folder === folder && item.name === task));
    if (clash && !clash.adopted) throw new WindowsTasksError(`${clash.id} is already recorded as Toolkit's own task`, 1);
    return [...list.filter(item => item !== clash), clash ? { ...entry, created: clash.created } : entry];
  });
  return entry;
}

// ---- output -------------------------------------------------------------------------------------

// Print literal managed paths so the same line is accepted by the hold on every host.
function powerShellPath(file) {
  quotePath(file, 'the command path');
  const literal = value => value.replace(/[`$]/g, character => '`' + character);
  return `"${literal(file)}"`;
}

function taskScriptPath(toolkitRoot) {
  return (path.isAbsolute(toolkitRoot) ? path : path.win32).join(toolkitRoot, 'repo', 'scripts', 'toolkit-windows-tasks.cjs');
}

function applyCommand(desired, { toolkitRoot = path.resolve(__dirname, '..', '..'), folderOverride = null } = {}) {
  return `node ${powerShellPath(taskScriptPath(toolkitRoot))} apply --repo-root ${powerShellPath(desired.root)}${folderOverride ? ` --folder ${folderOverride}` : ''}`;
}

const ACTION_TEXT = Object.freeze({ create: 'to create', update: 'to update in place', retire: 'to retire after replacement', 'owner-choice-required': 'owner choice required', current: 'up to date', refused: 'refused' });

function describePlan(plan, { command = null, applied = false, summaryOnly = false } = {}) {
  const lines = [`Windows scheduled tasks for ${plan.repository || 'this repository'} in \\${plan.folder}\\:`];
  if (plan.assignment?.collision) lines.push(`Minute ${String(plan.assignment.minute).padStart(2, '0')} is shared: more than nine repositories are enrolled on this computer.`);
  for (const item of plan.items) {
    const d = item.definition;
    const state = applied ? (['refused', 'owner-choice-required'].includes(item.action) ? ACTION_TEXT[item.action] : item.done === false ? `failed: ${item.error}` : item.action === 'current' ? 'up to date' : item.action === 'create' ? 'created' : item.action === 'retire' ? item.recovery ? 'reconciled by owner-authorised recovery' : 'retired by Toolkit' : 'updated') : ACTION_TEXT[item.action];
    lines.push(`- ${d.name} (${d.schedule_text}): ${state}. ${d.purpose}`);
    if (summaryOnly) continue;
    if (item.reason) lines.push(`  ${item.reason}`);
    if (item.choice) {
      lines.push(`  Task ${item.choice.task}; operation: ${item.choice.operation}; changed: ${item.choice.changed.join(', ')}; observation: ${item.choice.fingerprint}. Use --task-choice keep|replace --task ${item.choice.task} --observed ${item.choice.fingerprint} --answer-ref <actual-owner-answer-reference>. Flags attest an actual owner answer; they cannot prove who answered.`);
      if (item.choice.last_choice) lines.push(`  Earlier owner answer: ${item.choice.last_choice.outcome}; reference: ${item.choice.last_choice.answer_ref}. That answer grants no new attempt.`);
    }
    if (item.recovery) lines.push(`  Owner-authorised recovery: ${item.recovery}.`);
    if (item.restoration) lines.push(`  Recovery: ${item.restoration}.`);
    if (item.backup) lines.push(`  Previous task and enrolment backup: ${item.backup}`);
    if (item.first_run) lines.push(`  First run: ${item.first_run.status}${item.first_run.detail ? ` (${item.first_run.detail})` : ''}.`);
  }
  if (plan.coverage) lines.push(plan.coverage);
  if (plan.approval) lines.push(`Approval: ${plan.approval}.`);
  if (summaryOnly) lines.push('Next step: Run the direct task plan for details and commands.');
  else if (plan.next_step) lines.push(`Next step: ${plan.next_step}`);
  for (const note of plan.history_notes || []) lines.push(note);
  for (const item of plan.skipped) lines.push(`- ${item.name}: not registered, because ${item.reason}.`);
  if (!applied && command && / --(?:folder|repair-owned)\b/.test(command)) lines.push('This folder override or repair is outside standing approval. Explicit approval must name the affected fixed tasks, paths and changes.');
  if (!applied && command && plan.items.some(item => ['create', 'update', 'retire'].includes(item.action))) {
    lines.push('', 'An eligible local agent can register these fixed jobs from the recorded managed Toolkit checkout against this repository main checkout. Owner stops, edited tasks and host denials need the owner or host to resolve them. All selected jobs register first; the first cleaner can then take up to ten minutes. Registration alone does not prove a completed first run:', '', `    ${command}`);
  }
  return lines;
}

// ---- command line ------------------------------------------------------------------------------

const COMMANDS = Object.freeze(['plan', 'apply', 'remove', 'list', 'adopt']);
const VALUE_FLAGS = Object.freeze({ list: ['--repo-root'], plan: ['--repo-root', '--folder'], apply: ['--repo-root', '--folder', '--task-choice', '--task', '--observed', '--answer-ref'], remove: ['--repo-root', '--folder'], adopt: ['--folder', '--task', '--id', '--purpose', '--repository'] });
const USAGE = 'Usage: node repo/scripts/toolkit-windows-tasks.cjs plan|apply [--repo-root <checkout>] [--folder <F>] [--no-first-run] [--repair-owned] [--json]\n'
  + '       node repo/scripts/toolkit-windows-tasks.cjs list [--repo-root <checkout>] [--json]\n'
  + '       --repair-owned needs explicit approval naming the affected fixed tasks, paths and changes; it grants no native permission.\n'
  + '       Owner answer: --task-choice keep|replace --task <id> --observed <fingerprint> --answer-ref <actual-owner-answer-reference>\n'
  + '       node repo/scripts/toolkit-windows-tasks.cjs remove [--repo-root <primary-checkout>] [--folder <F>] [--json]\n'
  + '       node repo/scripts/toolkit-windows-tasks.cjs adopt --folder <F> --task <name> --id <id> --purpose <text> [--repository <owner/name>]\n';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new WindowsTasksError(`give a command: ${COMMANDS.join(', ')}`);
  const options = { command, json: false, firstRun: true };
  const choices = [];
  const choiceKeys = ['task_choice', 'task', 'observed', 'answer_ref'];
  const finishChoice = () => {
    if (!choiceKeys.some(key => options[key] !== undefined)) return;
    if (!['keep', 'replace'].includes(options.task_choice) || !tasks.ID.test(options.task || '') || !/^[a-f0-9]{64}$/.test(options.observed || '') || !safeAnswerRef(options.answer_ref)) throw new WindowsTasksError('task choice needs keep|replace, the exact task and observed fingerprint, and the actual owner answer reference');
    choices.push({ outcome: options.task_choice, task: options.task, observed: options.observed, answer_ref: options.answer_ref });
    for (const key of choiceKeys) delete options[key];
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--repair-owned' && command === 'apply') options.repairOwned = true;
    else if (arg === '--no-first-run' && command === 'apply') options.firstRun = false;
    else if (VALUE_FLAGS[command].includes(arg)) {
      if (command === 'apply' && arg === '--task-choice' && options.task_choice !== undefined) finishChoice();
      const value = rest[index += 1];
      if (value === undefined || value.startsWith('--')) throw new WindowsTasksError(`${arg} needs a value`);
      options[arg.slice(2).replace('-', '_')] = value;
    } else throw new WindowsTasksError(`unknown argument ${JSON.stringify(arg)} for ${command}`);
  }
  if (options.folder !== undefined && !FOLDER.test(options.folder)) throw new WindowsTasksError('--folder must be 1 to 32 capital letters, digits or hyphens, starting with a letter or digit');
  if (command === 'adopt') for (const key of ['folder', 'task', 'id', 'purpose']) if (!options[key]) throw new WindowsTasksError(`adopt needs --${key}`);
  if (command === 'apply') {
    finishChoice();
    if (choices.length) {
      if (options.repairOwned) throw new WindowsTasksError('same-job repair and governance-task choices are separate operations');
      options.taskChoices = choices;
    }
  }
  return options;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || (text => process.stdout.write(text));
  const err = deps.stderr || (text => process.stderr.write(text));
  const home = deps.home || os.homedir();
  const platform = deps.platform || process.platform;
  let options;
  try { options = parseArgs(argv); }
  catch (error) { err(`${error.message}\n${USAGE}`); return 2; }
  const print = (value, lines) => out(options.json ? `${JSON.stringify(value, null, 2)}\n` : `${lines.join('\n')}\n`);
  if (platform !== 'win32') { print({ status: 'not-windows' }, ['not-windows: Windows scheduled tasks exist only on Windows, so nothing was changed.']); return 0; }
  try {
    const scheduler = deps.scheduler || powerShellScheduler();
    const checkout = path.resolve(options.repo_root || deps.cwd || process.cwd());
    if (options.command === 'list') return tasks.main(options.json ? ['--json'] : [], { ...deps, cwd: checkout, home, scheduler });
    const desiredOptions = { checkout, home, folder: options.folder || null, deps: deps.checkoutDeps || {}, ...(deps.toolkitRoot ? { toolkitRoot: deps.toolkitRoot } : {}), ...(deps.nodePath ? { nodePath: deps.nodePath } : {}), ...(deps.systemRoot ? { systemRoot: deps.systemRoot } : {}) };
    if (options.command === 'plan') {
      const desired = desiredTasks(desiredOptions);
      const plan = planTasks(desired, { scheduler, home, registry: deps.registry, identityReader: deps.identityReader });
      const command = plan.items.some(item => ['create', 'update', 'retire'].includes(item.action)) ? applyCommand(desired, { toolkitRoot: deps.toolkitRoot, folderOverride: options.folder }) : null;
      print({ ...plan, command }, describePlan(plan, { command }));
      return !plan.items.length || plan.items.some(item => ['refused', 'owner-choice-required'].includes(item.action)) ? 1 : 0;
    }
    if (options.command === 'apply') {
      const desired = desiredTasks(desiredOptions);
      const result = applyTasks(desired, { scheduler, home, registry: deps.registry, identityReader: deps.identityReader, repairOwned: options.repairOwned, now: deps.now, firstRunOptions: options.firstRun ? (deps.firstRunOptions || {}) : null,
        taskChoice: options.taskChoices || null });
      if (!options.firstRun && result.approval === taskPolicy.STANDING_APPROVAL) result.approval = 'explicit approval required; first-result verification was skipped';
      print(result, describePlan(result, { applied: true }));
      return result.refused || result.items.some(item => item.action === 'refused' || item.done === false || (item.first_run && item.first_run.status === 'failed')) ? 1 : 0;
    }
    if (options.command === 'remove') {
      const scope = desiredTasks(desiredOptions);
      const result = removeTasks({ scope, folder: options.folder || null, scheduler, home, registry: deps.registry, now: deps.now });
      print(result, [
        `Removal scope: ${scope.repository}, verified repository origin, including legacy and moved-checkout enrolments.`,
        ...(result.items.length ? result.items.map(item => `- ${item.name} in \\${item.folder}\\: ${item.action}${item.reason ? ` (${item.reason})` : ''}`) : [`No Toolkit tasks match this repository${options.folder ? ' and folder' : ''}; other repositories are unchanged.`]),
        ...result.folders.map(item => `- folder \\${item.folder}\\: ${item.result === 'removed' ? 'removed (it was empty)' : item.result === 'kept' ? 'kept (other tasks are in it)' : item.result}`),
      ]);
      return result.items.some(item => item.action === 'refused' || item.action === 'failed') ? 1 : 0;
    }
    const entry = adoptTask(options, { scheduler, home, now: deps.now });
    print({ adopted: entry }, [`Recorded ${entry.name} in \\${entry.folder}\\ (${entry.schedule}) as adopted. Toolkit lists it and never changes it.`]);
    return 0;
  } catch (error) {
    err(`${error instanceof WindowsTasksError ? error.message : `Windows tasks failed: ${tasks.safeText(error.message)}`}\n`);
    if (options.command === 'remove') err(`Removal is repository-scoped. Use node ${powerShellPath(taskScriptPath(error.managedCheckout || deps.toolkitRoot || path.resolve(__dirname, '..', '..')))} remove --repo-root ${error.primaryCheckout ? powerShellPath(error.primaryCheckout) : '"<verified-primary-checkout>"'}.\n`);
    return error instanceof WindowsTasksError ? error.exitCode : 1;
  }
}

function launcherPath(home = os.homedir()) {
  return path.join(tasks.userStateDir(home), 'task-runners', `runner-${LAUNCHER_HASH}.cjs`);
}
function installLauncher(home) {
  const file = launcherPath(home), source = LAUNCHER_SOURCE;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, source, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (fs.readFileSync(file, 'utf8') !== source) throw new WindowsTasksError('Task launcher readback failed', 1);
  return file;
}
module.exports = { launcherPath, installLauncher,
  WindowsTaskOwner, repositoryOf, readTaskObservation, readLocations, mainCheckout, samePath, enrolledDefinition, verifiedDefinition, JOBS, FOLDER, MARKER, STATUS_CONTROL_C_EXIT, WindowsTasksError, defaultFolder, nameProblem, taskName, taskId, parseMarker, readCheckout, folderForCheckout,
  describeTriggers, describeResult, describeSchedule, desiredTasks, definitionDigest, powerShellScheduler, runPowerShell, SCRIPTS, planTasks, applyTasks, firstRun,
  removeTasks, adoptTask, applyCommand, powerShellPath, describePlan, parseArgs, main,
};

if (require.main === module) process.exitCode = main();
