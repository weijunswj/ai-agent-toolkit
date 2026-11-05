#!/usr/bin/env node
'use strict';

// The only Toolkit code that creates, changes or removes Windows scheduled tasks. Run as
//   node <Toolkit checkout>/repo/scripts/toolkit-windows-tasks.cjs <command> [options]
//
//   plan    [--repo-root <checkout>] [--folder <F>] [--json]
//           read-only: the tasks Toolkit would keep for the checkout, what each needs (create,
//           update, current or refused) and, when anything needs a change, the PowerShell line
//           to run under the Toolkit task standing approval, or with approval. Direct plan prints this.
//   apply   [--repo-root <checkout>] [--folder <F>] [--no-first-run] [--repair-owned] [--json]
//           creates or updates those tasks and records them in ~/.ai-agent-toolkit/user-state/tasks.json,
//           then starts a new or changed cleaner once and waits for its result. Agents may
//           run the exact default-folder command under the global Toolkit task standing approval.
//   remove  [--folder <F>] [--json]
//           records durable owner stops before removing only Toolkit's owned tasks,
//           retaining enrolment and baseline; removes the folder when empty.
//   adopt   --folder <F> --task <name> --id <id> --purpose <text> [--repository <owner/name>]
//           records a task you made yourself so `toolkit tasks` lists it as known; Toolkit never
//           changes or removes an adopted task.
//   apply --repair-owned needs explicit approval naming the affected fixed tasks, paths and changes.
//           It repairs owned same-repository enrolments only; never an unowned task or corrupt registry.
//
// Tasks live in \<schedule_folder>\ (the merged binding's `schedule_folder`, else the repository
// name in capitals) and are named "<FOLDER> - <TASK>". A task is Toolkit's only when it is in that
// folder, its Description carries `[toolkit-task v1 id=<id> def=<digest>]` and its non-adopted registry
// entry agrees on identity. Standing apply also checks repository, canonical checkout/runner paths,
// owner stops and the full enrolled definition. --folder overrides need separate approval.
//
// Each task runs `conhost.exe --headless node.exe toolkit-scheduled-job.cjs <job> ...` as you, only
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

const FOLDER = /^[A-Z0-9][A-Z0-9-]{0,31}$/;
const MARKER = /\[toolkit-task v1 id=([a-z0-9][a-z0-9-]{0,79}) def=([0-9a-f]{12})\]/;
const STATUS_CONTROL_C_EXIT = 0xC000013A;
const FIRST_RUN_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 5000;

// Fixed job definitions; desiredTasks and WindowsTaskOwner select one cleaner.
const JOBS = Object.freeze({
  'programme-sweep': {
    task: 'PROGRAMME SWEEP',
    schedule: Object.freeze({ kind: 'hourly', at: '00:00', hours: 24 }),
    purpose: 'Cleans your own GitHub posts first, then brings programme pages and attention up to date under governance guards. No AI.',
  },
  'footer-sweep': {
    task: 'FOOTER SWEEP',
    schedule: Object.freeze({ kind: 'hourly', at: '00:00', hours: 24 }),
    purpose: 'Removes the cloud route footer from your own GitHub posts in this repository and its freshly verified evidence store. No AI.',
  },
  'shard-timings': {
    task: 'SHARD TIMINGS',
    schedule: Object.freeze({ kind: 'weekly', day: 'Monday', at: '09:15' }),
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
  if (!first || !samePath(canonical, top) || !samePath(canonical, realpath(first[1])) || !samePath(common, gitDir)) throw new WindowsTasksError('use the repository main checkout, never a linked worktree or subdirectory', 1);
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
  const toolkit = primary(toolkitRoot);
  if (!samePath(managed, toolkit) || !samePath(realpath(toolkitRoot), managed)) throw new WindowsTasksError('invoke the recorded managed Toolkit checkout', 1);
  // Inspect the source repository as well as its location; an arbitrary repository is not Toolkit.
  const result = (deps.run || spawnSync)('git', ['-C', toolkit, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  const remote = require('./toolkit-repository-identity.cjs').validateRemoteIdentity(String(result.stdout || '').trim());
  if (result.error || result.status !== 0 || repositoryOf({ valid: remote.valid, remote })?.toLowerCase() !== 'weijunswj/ai-agent-toolkit') throw new WindowsTasksError('the managed checkout is not the expected Toolkit repository', 1);
  return { toolkitRoot: toolkit, checkout: primary(checkout) };
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
    && ((status.state === 'ENABLED' && observation.status === 'enabled' && binding)
      || (['DISABLED', 'UNDECIDED'].includes(status.state) && observation.status === 'none')
      || (status.state === 'DISABLED' && observation.status === 'disabled' && binding));
  return { root: identity.root, repository, governanceState: status?.state || null, binding, certain: Boolean(certain) };
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
  for (const [job, spec] of Object.entries(JOBS)) {
    const name = taskName(chosen, job);
    const problem = nameProblem(name);
    if (problem) throw new WindowsTasksError(`task name ${JSON.stringify(name)} ${problem}`);
    const id = taskId(chosen, job);
    // Task definitions are Windows paths on every computer, so they read the same in tests anywhere.
    const runner = path.win32.join(toolkitRoot, 'repo', 'scripts', 'toolkit-scheduled-job.cjs');
    const definition = {
      id, job, folder: chosen, name, repository: read.repository, checkout: read.root, toolkit_root: toolkitRoot, purpose: spec.purpose, schedule: spec.schedule, schedule_text: describeSchedule(spec.schedule),
      execute: path.win32.join(systemRoot, 'System32', 'conhost.exe'),
      arguments: ['--headless', quotePath(nodePath, 'node'), quotePath(runner, 'the job runner'), job, '--repo-root', quotePath(read.root, 'the checkout'), '--task-id', id].join(' '),
      working_directory: toolkitRoot,
    };
    quotePath(toolkitRoot, 'the Toolkit checkout');
    definition.def = definitionDigest(definition);
    definition.description = `${chosen}: ${spec.task}. ${spec.purpose} [toolkit-task v1 id=${id} def=${definition.def}]`;
    definitions.push(definition);
    const selected = read.certain && (read.governanceState === 'ENABLED' ? job !== 'footer-sweep' : job === 'footer-sweep');
    if (selected) wanted.push(definition);
    else if (job !== 'footer-sweep') skipped.push({ job, name, reason: read.certain ? 'governance is not enabled; the footer-only cleaner is selected' : 'fresh matching merged governance could not be verified; registration held' });
  }
  return { folder: chosen, repository: read.repository, root: read.root, wanted, skipped, definitions, read, folderOverride: folder, checkoutDeps: deps, identityReader, locations: { checkout, toolkitRoot, home } };
}

function describeSchedule(schedule) {
  if (schedule.kind === 'hourly') return describeTriggers([{ kind: 'MSFT_TaskDailyTrigger', start: `2000-01-01T${schedule.at}:00`, interval: 'PT1H', duration: `PT${schedule.hours}H` }]);
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
if ($existing -and $existing.TaskPath -eq $path -and ([string]$existing.Description).IndexOf($p.marker_prefix) -lt 0) { throw "A task with this name is already in $path and is not Toolkit's; it was left alone." }
$action = New-ScheduledTaskAction -Execute $p.execute -Argument $p.arguments -WorkingDirectory $p.working_directory
if ($p.schedule.kind -eq 'hourly') {
  $trigger = New-ScheduledTaskTrigger -Daily -At $p.schedule.at
  $trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $p.schedule.at -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Hours $p.schedule.hours)).Repetition
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

// Owns preflight, persistence and scheduler effects. Every command gets explicit boundaries;
// tests substitute all four effect/identity/clock dependencies, never the user's scheduler/home.
class WindowsTaskOwner {
  constructor({ scheduler, home, registry = tasks, identityReader, now = () => new Date(), repairOwned = false, firstRunOptions = null, takeLock = null }) {
    Object.assign(this, { scheduler, home, registry, identityReader, now, repairOwned, firstRunOptions, takeLock });
  }
  plan(desired) {
    (this.identityReader || desired.identityReader || readLocations)({ ...desired.locations, home: this.home });
    const plannedRead = desired.read;
    const currentRead = desired.read ? readCheckout(desired.root, { ...desired.checkoutDeps, home: this.home }) : null;
    desired = currentRead ? { ...desired, read: currentRead } : desired;
    const registry = this.registry.readRegistry(this.home);
    const entries = registry.status === 'ok' ? registry.tasks : [];
    // Choose an already enrolled shape before considering governance. Stops are enrolments too.
    const cleaners = entries.filter(entry => entry.host === 'windows' && isCleaner(entry.job)
      && String(entry.repository).toLowerCase() === desired.repository.toLowerCase());
    const selected = cleaners.length === 1 ? cleaners[0] : null;
    const folder = selected && !desired.folderOverride ? selected.folder : desired.folder;
    const definitions = [...desired.wanted, ...(desired.definitions || []).filter(d => !desired.wanted.some(w => w.job === d.job))];
    const build = definition => {
      if (definition.folder === folder) return definition;
      const name = taskName(folder, definition.job), id = taskId(folder, definition.job);
      const updated = { ...definition, folder, name, id, arguments: definition.arguments.replace(/--task-id [a-z0-9-]+$/, `--task-id ${id}`) };
      updated.def = definitionDigest(updated);
      updated.description = `${folder}: ${JOBS[updated.job].task}. ${updated.purpose} [toolkit-task v1 id=${id} def=${updated.def}]`;
      return updated;
    };
    const wanted = selected ? definitions.filter(d => d.job === selected.job || d.job === 'shard-timings' && desired.read?.certain && desired.read.governanceState === 'ENABLED').map(build) : desired.wanted;
    const live = this.scheduler.list(folder);
    // Search marked folders and recorded folders, never import/adopt a discovered task.
    const folders = new Set([folder, ...entries.filter(e => e.host === 'windows').map(e => e.folder), ...this.scheduler.markedFolders()]);
    let conflict = cleaners.length > 1 ? 'conflicting cleaner enrolments; explicit owner recovery is required' : null;
    for (const otherFolder of folders) for (const task of otherFolder === folder ? live : this.scheduler.list(otherFolder)) {
      const marker = parseMarker(task.description);
      const matched = definitions.find(d => isCleaner(d.job) && (sameTaskName(task.name, taskName(otherFolder, d.job)) || marker?.id === taskId(otherFolder, d.job)));
      if (!matched) continue;
      const target = /--repo-root "([^"\r\n]+)"/.exec(String(task.arguments || ''))?.[1];
      let repository = null;
      try { if (target) repository = repositoryOf((desired.checkoutDeps?.governance || require('./toolkit-governance-state.cjs')).readIdentity(target)); } catch { /* unknown target cannot prove this enrolment */ }
      const relevant = otherFolder === folder || repository?.toLowerCase() === desired.repository.toLowerCase();
      if (!relevant) continue;
      const record = entries.find(e => e.host === 'windows' && e.folder === otherFolder && e.name === task.name);
      if ((!record || record.adopted || !marker || marker.id !== record.id) && !wanted.some(d => d.folder === otherFolder && sameTaskName(d.name, task.name))) conflict = 'foreign or unrecorded cleaner conflict; left alone';
      else if (record && !wanted.some(d => d.id === record.id)) conflict = 'another cleaner is enrolled for this repository; explicit owner recovery is required';
    }
    const items = wanted.map(definition => {
      const existing = live.find(task => sameTaskName(task.name, definition.name));
      const recorded = entries.find(entry => entry.id === definition.id);
      const refuse = reason => ({ definition, action: 'refused', reason });
      if (registry.status !== 'ok') return refuse('task registry could not be read');
      if (conflict) return refuse(conflict);
      if (currentRead && JSON.stringify([currentRead.repository, currentRead.certain, currentRead.governanceState, currentRead.binding]) !== JSON.stringify([plannedRead.repository, plannedRead.certain, plannedRead.governanceState, plannedRead.binding])) return refuse('origin or governance changed after planning; run a fresh plan');
      if (currentRead && (!currentRead.repository || currentRead.repository.toLowerCase() !== definition.repository.toLowerCase())) return refuse('repository origin changed; left alone');
      if (recorded?.stopped_by_owner && !this.repairOwned) return refuse('stopped by owner');
      if (desired.read && !desired.read.certain) return refuse('fresh matching merged governance could not be verified; existing shape and folder retained');
      if (definition.job !== 'footer-sweep' && desired.read && desired.read.governanceState !== 'ENABLED') return refuse('governance is not enabled; installed programme cleaner retained without registration changes');
      if (entries.some(entry => entry.host === 'windows' && !entry.adopted && entry.job === definition.job
        && String(entry.repository).toLowerCase() === String(definition.repository).toLowerCase() && entry.id !== definition.id)) return refuse('this repository already has this job enrolled in another folder; ask owner to reconcile it');
      if (recorded && (recorded.adopted || recorded.host !== 'windows' || recorded.folder !== definition.folder || recorded.name !== definition.name)) return refuse('adopted or unowned enrolment; Toolkit leaves it alone');
      if (recorded && String(recorded.repository).toLowerCase() !== String(definition.repository).toLowerCase()) return refuse('repository ownership differs; Toolkit leaves it alone');
      const marker = existing && parseMarker(existing.description);
      if (existing && existing.name !== definition.name) return refuse('task name differs from its fixed name; Toolkit leaves it alone');
      if (existing && (!marker || marker.id !== definition.id || !recorded)) return refuse(marker && marker.id === definition.id
        ? `"${definition.name}" carries Toolkit's marker but this computer's task registry does not list it, so Toolkit leaves it alone`
        : `"${definition.name}" is already in \\${definition.folder}\\ and is not Toolkit's (no matching ownership), so Toolkit leaves it alone`);
      if (!recorded) return { definition, action: 'create', observed: null, recorded: null };
      let reason = null;
      if (recorded.stopped_by_owner) reason = 'stopped by owner';
      else if (!existing) reason = 'stopped by owner: enrolled task removed';
      else if (!recorded.checkout || !recorded.toolkit_root || !recorded.enrolled) reason = 'legacy enrolment cannot prove checkout or definition; ask owner';
      else if (!samePath(recorded.checkout, definition.checkout)) reason = 'checkout ownership differs; ask owner';
      else if (!samePath(recorded.toolkit_root, definition.toolkit_root)) reason = 'Toolkit runner location differs; ask owner';
      else if (existing.state === 'Disabled') reason = 'stopped by owner: disabled task';
      else if (!sameDefinition(enrolledDefinition(existing), recorded.enrolled)) reason = 'stopped by owner: hand-edited task definition';
      if (reason && !this.repairOwned) return refuse(reason);
      return { definition, action: reason || marker?.def !== definition.def ? 'update' : 'current', observed: existing ? enrolledDefinition(existing) : null, recorded, ...(reason ? { recovery: reason } : {}) };
    });
    // A conflict or stop on either fixed job holds the entire command, including current jobs.
    const blocked = items.find(item => item.action === 'refused');
    if (blocked) for (const item of items) if (item.action !== 'refused') Object.assign(item, { action: 'refused', reason: `all selected jobs held: ${blocked.reason}` });
    return { folder, repository: desired.repository, registry: registry.status, items,
      approval: items.length && !items.some(item => item.action === 'refused') ? desired.folderOverride || this.repairOwned ? 'explicit approval required' : 'standing approval with verified ownership' : 'verification held; no standing action',
      coverage: selected?.job === 'footer-sweep' && desired.read?.governanceState === 'ENABLED' ? 'Programme refresh coverage is missing; the installed footer-only cleaner stays selected.' : null,
      skipped: items.length ? [] : desired.skipped };
  }
  apply(desired) {
    // Identity/ownership refusals precede even the local apply-lock write. Recheck under lock.
    const preview = this.plan(desired);
    if (preview.registry !== 'ok') throw new WindowsTasksError(`the task registry ${tasks.registryPath(this.home)} could not be read, so no task was changed`, 1);
    if (preview.skipped.length || preview.items.some(item => item.action === 'refused')) return { ...preview, refused: true };
    const takeLock = this.takeLock || require('../../skills/github-program-reconciler/scripts/programme-lock.cjs').takeLock;
    const file = path.join(tasks.userStateDir(this.home), 'tasks', `apply-${crypto.createHash('sha256').update(desired.repository.toLowerCase()).digest('hex').slice(0, 20)}.lock`);
    const lock = takeLock(file);
    if (!lock) throw new WindowsTasksError('another task apply is running for this repository', 1);
    try { return this.applyLocked(desired); } finally { lock.release(); }
  }
  applyLocked(desired) {
    const plan = this.plan(desired);
    if (plan.registry !== 'ok') throw new WindowsTasksError(`the task registry ${tasks.registryPath(this.home)} could not be read, so no task was changed`, 1);
    if (plan.skipped.length) return { ...plan, refused: true };
    if (plan.items.some(item => item.action === 'refused')) return plan;
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
        if (fresh.items.some(row => row.action === 'refused')) throw new Error('tasks changed after preflight; both jobs held');
        const expected = fresh.items.find(row => row.definition.id === definition.id);
        previous = this.scheduler.list(definition.folder).find(row => row.name === definition.name) || null;
        if (!sameDefinition(previous ? enrolledDefinition(previous) : null, expected.observed)) throw new Error('task changed after preflight; left alone');
        if (previous) backup = this.registry.writeTaskBackup(this.home, definition.id, { task: previous, registry: expected.recorded });
        this.scheduler.register(definition, previous);
        const live = this.scheduler.list(definition.folder).find(row => row.name === definition.name);
        if (!verifiedDefinition(live, definition)) throw new Error('scheduler readback failed; registration is not verified; preserve the backup and inspect the live task');
        written = live;
        this.registry.updateRegistry(this.home, list => {
          const existing = list.find(entry => entry.id === definition.id);
          const planned = fresh.items.find(row => row.definition.id === definition.id);
          if (!planned || !sameDefinition(existing || null, expected.recorded)) throw new Error('registry changed after preflight; owner choices retained');
          return [...list.filter(entry => entry.id !== definition.id), registryEntry(definition, existing, this.now, live)];
        });
        const saved = this.registry.readRegistry(this.home);
        if (saved.status !== 'ok' || !sameDefinition(saved.tasks.find(entry => entry.id === definition.id)?.enrolled, enrolledDefinition(live))) throw new Error('registry readback failed');
        results.push({ ...item, done: true, ...(backup ? { backup } : {}) });
      } catch (error) {
        let restoration = 'not attempted: no verified replacement, or the registry already changed';
        // Only undo our verified replacement while the old registry still stands. Compare
        // again in the native adapter so a concurrent owner edit is never overwritten.
        const recorded = this.registry.readRegistry(this.home);
        const old = recorded.status === 'ok' && recorded.tasks.find(entry => entry.id === definition.id);
        const oldStillRecorded = recorded.status === 'ok' && (previous ? old && sameDefinition(old.enrolled, enrolledDefinition(previous)) : !old);
        if (written && oldStillRecorded) {
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
    // All selected jobs have been registered and read back before the potentially ten-minute wait.
    const sweep = results.find(item => isCleaner(item.definition.job) && item.action !== 'current');
    if (sweep && this.firstRunOptions) {
      try { sweep.first_run = firstRun(sweep.definition, { scheduler: this.scheduler, home: this.home, now: this.now, ...this.firstRunOptions,
        beforeStart: () => { if (this.plan(desired).items.some(item => item.action !== 'current')) throw new Error('task definition or owner choice changed; no first start'); },
      }); }
      catch (error) { sweep.first_run = { status: 'failed', detail: `registration verified; first-run check or wait interrupted: ${tasks.safeText(error.message)}` }; }
    }
    return { ...plan, items: results };
  }
  remove(folder = null) {
    const registry = this.registry.readRegistry(this.home);
    if (registry.status !== 'ok') throw new WindowsTasksError(`the task registry ${tasks.registryPath(this.home)} could not be read, so no task was removed`, 1);
    const ours = registry.tasks.filter(entry => entry.host === 'windows' && !entry.adopted && (!folder || entry.folder === folder));
    const results = [];
    for (const entry of ours) {
      const live = this.scheduler.list(entry.folder).find(task => sameTaskName(task.name, entry.name));
      const marker = live && parseMarker(live.description);
      if (live && (live.name !== entry.name || !marker || marker.id !== entry.id)) { results.push({ ...entry, action: 'refused', reason: 'the task no longer carries Toolkit\'s marker; left alone' }); continue; }
      try {
        this.registry.updateRegistry(this.home, list => list.map(item => item.id === entry.id ? { ...item, stopped_by_owner: true, stopped_at: item.stopped_at || this.now().toISOString() } : item));
        const saved = this.registry.readRegistry(this.home);
        if (saved.status !== 'ok' || !saved.tasks.find(item => item.id === entry.id)?.stopped_by_owner) throw new Error('owner stop readback failed; live task retained');
        if (live) this.scheduler.unregister(entry.folder, entry.name, entry.id, live);
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
    return { items: results, folders };
  }
}

function isCleaner(job) { return job === 'programme-sweep' || job === 'footer-sweep'; }

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
    : /Weekly/.test(tr.kind) && Number(tr.days_of_week) === 2 && (tr.weeks_interval === undefined || Number(tr.weeks_interval) === 1);
}

function planTasks(desired, options) { return new WindowsTaskOwner(options).plan(desired); }

function registryEntry(definition, existing, now, live) {
  return {
    id: definition.id, name: definition.name, host: 'windows', folder: definition.folder, schedule: definition.schedule_text, model: null, effort: null,
    purpose: definition.purpose, repository: definition.repository, created: existing ? existing.created : now().toISOString(), created_by: 'toolkit-windows-tasks apply',
    job: definition.job, definition: definition.def, checkout: definition.checkout, toolkit_root: definition.toolkit_root, enrolled: enrolledDefinition(live),
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
    return { status: ok ? 'ok' : 'failed', detail: `${last.status}: ${(last.summary || []).slice(0, 3).join(' | ')}`, restarted };
  }
}

function applyTasks(desired, options) { return new WindowsTaskOwner(options).apply(desired); }

function removeTasks(options) { return new WindowsTaskOwner(options).remove(options.folder); }

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

// A path for a PowerShell line: the profile folder as $env:USERPROFILE.
function powerShellPath(file, home = os.homedir()) {
  quotePath(file, 'the command path');
  const literal = value => value.replace(/[`$]/g, character => '`' + character);
  const lower = file.toLowerCase();
  const prefix = home.toLowerCase();
  return lower === prefix || lower.startsWith(`${prefix}\\`) ? `"$env:USERPROFILE${literal(file.slice(home.length))}"` : `"${literal(file)}"`;
}

function applyCommand(desired, { toolkitRoot = path.resolve(__dirname, '..', '..'), folderOverride = null, home } = {}) {
  const script = path.win32.join(toolkitRoot, 'repo', 'scripts', 'toolkit-windows-tasks.cjs');
  return `node ${powerShellPath(script, home)} apply --repo-root ${powerShellPath(desired.root, home)}${folderOverride ? ` --folder ${folderOverride}` : ''}`;
}

const ACTION_TEXT = Object.freeze({ create: 'to create', update: 'to update in place', current: 'up to date', refused: 'refused' });

function describePlan(plan, { command = null, applied = false } = {}) {
  const lines = [`Windows scheduled tasks for ${plan.repository || 'this repository'} in \\${plan.folder}\\:`];
  for (const item of plan.items) {
    const d = item.definition;
    const state = applied ? (item.action === 'refused' ? 'refused' : item.done === false ? `failed: ${item.error}` : item.action === 'current' ? 'up to date' : item.action === 'create' ? 'created' : 'updated') : ACTION_TEXT[item.action];
    lines.push(`- ${d.name} (${d.schedule_text}): ${state}. ${d.purpose}`);
    if (item.reason) lines.push(`  ${item.reason}`);
    if (item.restoration) lines.push(`  Recovery: ${item.restoration}.`);
    if (item.backup) lines.push(`  Previous task and enrolment backup: ${item.backup}`);
    if (item.first_run) lines.push(`  First run: ${item.first_run.status}${item.first_run.detail ? ` (${item.first_run.detail})` : ''}.`);
  }
  if (plan.coverage) lines.push(plan.coverage);
  if (plan.approval) lines.push(`Approval: ${plan.approval}.`);
  for (const item of plan.skipped) lines.push(`- ${item.name}: not registered, because ${item.reason}.`);
  if (!applied && command && / --(?:folder|repair-owned)\b/.test(command)) lines.push('This folder override or repair is outside standing approval. Explicit approval must name the affected fixed tasks, paths and changes.');
  if (!applied && command && plan.items.some(item => item.action === 'create' || item.action === 'update')) {
    lines.push('', 'An eligible local agent can register these fixed jobs from the recorded managed Toolkit checkout against this repository main checkout. Owner stops, edited tasks and host denials need the owner or host to resolve them. All selected jobs register first; the first cleaner can then take up to ten minutes. Registration alone does not prove a completed first run:', '', `    ${command}`);
  }
  return lines;
}

// ---- command line ------------------------------------------------------------------------------

const COMMANDS = Object.freeze(['plan', 'apply', 'remove', 'adopt']);
const VALUE_FLAGS = Object.freeze({ plan: ['--repo-root', '--folder'], apply: ['--repo-root', '--folder'], remove: ['--folder'], adopt: ['--folder', '--task', '--id', '--purpose', '--repository'] });
const USAGE = 'Usage: node repo/scripts/toolkit-windows-tasks.cjs plan|apply [--repo-root <checkout>] [--folder <F>] [--no-first-run] [--repair-owned] [--json]\n'
  + '       --repair-owned needs explicit approval naming the affected fixed tasks, paths and changes; it grants no native permission.\n'
  + '       node repo/scripts/toolkit-windows-tasks.cjs remove [--folder <F>] [--json]\n'
  + '       node repo/scripts/toolkit-windows-tasks.cjs adopt --folder <F> --task <name> --id <id> --purpose <text> [--repository <owner/name>]\n';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new WindowsTasksError(`give a command: ${COMMANDS.join(', ')}`);
  const options = { command, json: false, firstRun: true };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--repair-owned' && command === 'apply') options.repairOwned = true;
    else if (arg === '--no-first-run' && command === 'apply') options.firstRun = false;
    else if (VALUE_FLAGS[command].includes(arg)) {
      const value = rest[index += 1];
      if (value === undefined || value.startsWith('--')) throw new WindowsTasksError(`${arg} needs a value`);
      options[arg.slice(2).replace('-', '_')] = value;
    } else throw new WindowsTasksError(`unknown argument ${JSON.stringify(arg)} for ${command}`);
  }
  if (options.folder !== undefined && !FOLDER.test(options.folder)) throw new WindowsTasksError('--folder must be 1 to 32 capital letters, digits or hyphens, starting with a letter or digit');
  if (command === 'adopt') for (const key of ['folder', 'task', 'id', 'purpose']) if (!options[key]) throw new WindowsTasksError(`adopt needs --${key}`);
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
    const desiredOptions = { checkout, home, folder: options.folder || null, deps: deps.checkoutDeps || {}, ...(deps.toolkitRoot ? { toolkitRoot: deps.toolkitRoot } : {}), ...(deps.nodePath ? { nodePath: deps.nodePath } : {}), ...(deps.systemRoot ? { systemRoot: deps.systemRoot } : {}) };
    if (options.command === 'plan') {
      const desired = desiredTasks(desiredOptions);
      const plan = planTasks(desired, { scheduler, home, registry: deps.registry, identityReader: deps.identityReader });
      const command = plan.items.some(item => ['create', 'update'].includes(item.action)) ? applyCommand(desired, { toolkitRoot: deps.toolkitRoot, folderOverride: options.folder, home }) : null;
      print({ ...plan, command }, describePlan(plan, { command }));
      return plan.items.some(item => item.action === 'refused') ? 1 : 0;
    }
    if (options.command === 'apply') {
      const desired = desiredTasks(desiredOptions);
      const result = applyTasks(desired, { scheduler, home, registry: deps.registry, identityReader: deps.identityReader, repairOwned: options.repairOwned, now: deps.now, firstRunOptions: options.firstRun ? (deps.firstRunOptions || {}) : null });
      if (!options.firstRun && result.approval === 'standing approval with verified ownership') result.approval = 'explicit approval required; first-result verification was skipped';
      print(result, describePlan(result, { applied: true }));
      return result.refused || result.items.some(item => item.action === 'refused' || item.done === false || (item.first_run && item.first_run.status === 'failed')) ? 1 : 0;
    }
    if (options.command === 'remove') {
      const result = removeTasks({ folder: options.folder || null, scheduler, home, registry: deps.registry, now: deps.now });
      print(result, [
        ...(result.items.length ? result.items.map(item => `- ${item.name} in \\${item.folder}\\: ${item.action}${item.reason ? ` (${item.reason})` : ''}`) : ['No Toolkit tasks are recorded on this computer.']),
        ...result.folders.map(item => `- folder \\${item.folder}\\: ${item.result === 'removed' ? 'removed (it was empty)' : item.result === 'kept' ? 'kept (other tasks are in it)' : item.result}`),
      ]);
      return result.items.some(item => item.action === 'refused' || item.action === 'failed') ? 1 : 0;
    }
    const entry = adoptTask(options, { scheduler, home, now: deps.now });
    print({ adopted: entry }, [`Recorded ${entry.name} in \\${entry.folder}\\ (${entry.schedule}) as adopted. Toolkit lists it and never changes it.`]);
    return 0;
  } catch (error) {
    err(`${error instanceof WindowsTasksError ? error.message : `Windows tasks failed: ${tasks.safeText(error.message)}`}\n`);
    return error instanceof WindowsTasksError ? error.exitCode : 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  WindowsTaskOwner, repositoryOf, readTaskObservation, readLocations, mainCheckout, samePath, enrolledDefinition, verifiedDefinition, JOBS, FOLDER, MARKER, STATUS_CONTROL_C_EXIT, WindowsTasksError, defaultFolder, nameProblem, taskName, taskId, parseMarker, readCheckout, folderForCheckout,
  describeTriggers, describeResult, describeSchedule, desiredTasks, definitionDigest, powerShellScheduler, runPowerShell, SCRIPTS, planTasks, applyTasks, firstRun,
  removeTasks, adoptTask, applyCommand, powerShellPath, describePlan, parseArgs, main,
};
