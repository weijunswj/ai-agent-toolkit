#!/usr/bin/env node
'use strict';

// The only Toolkit code that creates, changes or removes Windows scheduled tasks. Run as
//   node <Toolkit checkout>/repo/scripts/toolkit-windows-tasks.cjs <command> [options]
//
//   plan    [--repo-root <checkout>] [--folder <F>] [--json]
//           read-only: the tasks Toolkit would keep for the checkout, what each needs (create,
//           update, current or refused) and, when anything needs a change, the PowerShell line
//           for you to paste. Setup prints this.
//   apply   [--repo-root <checkout>] [--folder <F>] [--no-first-run] [--json]
//           creates or updates those tasks and records them in ~/.ai-agent-toolkit/user-state/tasks.json,
//           then starts each new or changed hourly sweep once and waits for its result. You run it:
//           agents do not create scheduled tasks.
//   remove  [--folder <F>] [--json]
//           removes only Toolkit's own tasks (all three checks below) and their registry entries,
//           then the folder when it is empty.
//   adopt   --folder <F> --task <name> --id <id> --purpose <text> [--repository <owner/name>]
//           records a task you made yourself so `toolkit tasks` lists it as known; Toolkit never
//           changes or removes an adopted task.
//
// Tasks live in \<schedule_folder>\ (the merged binding's `schedule_folder`, else the repository
// name in capitals) and are named "<FOLDER> - <TASK>". A task is Toolkit's only when it is in that
// folder, its Description carries `[toolkit-task v1 id=<id> def=<digest>]` and the registry has that
// id; anything else is listed and never changed. --folder replaces the folder (a test folder).
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

// The jobs Toolkit registers. `applies` says whether a checkout gets the job, and why not.
const JOBS = Object.freeze({
  'programme-sweep': {
    task: 'PROGRAMME SWEEP',
    schedule: Object.freeze({ kind: 'hourly', at: '00:00', hours: 24 }),
    purpose: 'Cleans your own GitHub posts first, then brings programme pages and attention up to date under governance guards. No AI.',
    applies({ governanceState, binding }) {
      if (governanceState !== 'ENABLED') return `GitHub governance is ${governanceState || 'not readable'} here, so there is no programme to sweep`;
      if (!binding) return 'the binding merged on the default branch could not be read on this computer; run toolkit governance status online first';
      return null;
    },
  },
  'footer-sweep': {
    task: 'FOOTER SWEEP',
    schedule: Object.freeze({ kind: 'hourly', at: '00:00', hours: 24 }),
    purpose: 'Removes the cloud route footer from your own GitHub posts in this repository and its freshly verified evidence store. No AI.',
    applies() { return null; },
  },
  'shard-timings': {
    task: 'SHARD TIMINGS',
    schedule: Object.freeze({ kind: 'weekly', day: 'Monday', at: '09:15' }),
    purpose: 'Refreshes the measured test times and opens a pull request when the CI shards drift. No AI.',
    applies({ checkout }) {
      const needed = ['repo/contracts/ci/test-shards.json', 'repo/scripts/refresh-shard-timings.cjs'];
      return needed.every(file => fs.existsSync(path.join(checkout, ...file.split('/')))) ? null : 'only the Toolkit repository has CI shards to time';
    },
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

// A linked worktree is disposable. Only a proven primary checkout may own a task target.
// Submodules have a gitdir pointer but no commondir, and remain their own checkout.
function durableIdentity(checkout, governance) {
  const identity = governance.readIdentity(checkout);
  if (!repositoryOf(identity)) {
    const nonGitHubOrigin = identity.reason === 'origin-unsupported' || (identity.valid === true && !require('./toolkit-governance-state.cjs').isGitHubHost(identity.remote?.host));
    return { ...identity, refusalCode: nonGitHubOrigin ? 'no-github-origin' : null, refusal: 'no usable github.com origin repository; footer cleaning refused' };
  }
  const dotGit = path.join(identity.root, '.git');
  // Injected identity readers in pure tests need no filesystem. Real readers always have .git.
  if (governance.readIdentity !== require('./toolkit-governance-state.cjs').readIdentity) return identity;
  try {
    if (fs.lstatSync(dotGit).isDirectory()) return identity;
    const pointer = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!pointer) throw new Error();
    const gitDir = path.resolve(identity.root, pointer[1]);
    const commonFile = path.join(gitDir, 'commondir');
    if (!fs.existsSync(commonFile)) return identity;
    const common = fs.realpathSync(path.resolve(gitDir, fs.readFileSync(commonFile, 'utf8').trim()));
    const primary = path.dirname(common);
    const primaryGit = path.join(primary, '.git');
    if (!fs.lstatSync(primaryGit).isDirectory() || fs.realpathSync(primaryGit) !== common) throw new Error();
    const resolved = governance.readIdentity(primary);
    if (!repositoryOf(resolved) || resolved.repository_id !== identity.repository_id) throw new Error();
    return resolved;
  } catch { return { ...identity, valid: false, refusal: 'linked worktree has no verified primary checkout; scheduled tasks refused' }; }
}

// What the checkout's governance says: { root, repository, governanceState, binding }.
function readCheckout(checkout, deps = {}) {
  const governance = deps.governance || require('./toolkit-governance-state.cjs');
  let identity;
  try { identity = durableIdentity(checkout, governance); }
  catch { return { root: null, repository: null, refusal: 'checkout identity could not be read; scheduled tasks refused' }; }
  const repository = repositoryOf(identity);
  if (!repository) return { root: null, repository: null, governanceState: null, binding: null, refusal: identity.refusal, refusalCode: identity.refusalCode };
  let status = null;
  try { status = governance.governanceState(identity.root); } catch { /* uncertain read preserves the installed shape */ }
  const state = status?.state || null;
  let binding = null;
  try { binding = governance.mergedBinding(identity.root); } catch { /* planning can still offer origin cleaning */ }
  if (binding && String(binding.repository).toLowerCase() !== repository.toLowerCase()) binding = null;
  const certain = status?.merged?.fresh === true && ['enabled', 'disabled', 'none'].includes(status.merged.status)
    && ((state === 'ENABLED' && status.merged.status === 'enabled' && binding) || (['DISABLED', 'UNDECIDED'].includes(state) && ['disabled', 'none'].includes(status.merged.status)));
  return { root: identity.root, repository, governanceState: state, binding, certain: Boolean(certain) };
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
    // The native XML duration can spell 24 hours P1D: on Windows,
    // [System.Xml.XmlConvert]::ToString([TimeSpan]::FromHours(24)) returns P1D.
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
  if (!path.win32.isAbsolute(file) ||/["\r\n]/.test(file) || /\\$/.test(file)) throw new WindowsTasksError(`${label} ${JSON.stringify(file)} cannot be used in a task: it must be an absolute path with no quote mark that does not end in a backslash`, 1);
  return `"${file}"`;
}

function definitionDigest(definition) {
  const { execute, arguments: args, working_directory: workingDirectory, schedule } = definition;
  return crypto.createHash('sha256').update(JSON.stringify({ execute, args, workingDirectory, schedule, settings: 'v1 interactive start-when-available ignore-new 30m battery' })).digest('hex').slice(0, 12);
}

// { folder, repository, wanted: [definitions], skipped: [{ job, reason }] } for a checkout.
function desiredTasks({ checkout, folder = null, toolkitRoot = path.resolve(__dirname, '..', '..'), nodePath = process.execPath, systemRoot = process.env.SystemRoot || 'C:\\Windows', deps = {} }) {
  const read = readCheckout(checkout, deps);
  if (!read.root) throw new WindowsTasksError(`${checkout}: ${read.refusal || 'no usable github.com origin repository; footer cleaning refused'}`);
  const chosen = folder || (read.binding && read.binding.schedule_folder) || defaultFolder(read.repository);
  if (!chosen || !FOLDER.test(chosen)) throw new WindowsTasksError(`no usable task folder for this repository (got ${JSON.stringify(chosen)}); set schedule_folder in its binding or pass --folder`);
  const wanted = [];
  const skipped = [];
  const cleaners = [];
  const selected = read.certain && read.governanceState === 'ENABLED' ? 'programme-sweep' : 'footer-sweep';
  for (const [job, spec] of Object.entries(JOBS)) {
    const reason = spec.applies({ checkout: read.root, governanceState: read.governanceState, binding: read.binding });
    if (reason && !['programme-sweep', 'footer-sweep'].includes(job)) { skipped.push({ job, name: taskName(chosen, job), reason }); continue; }
    const name = taskName(chosen, job);
    const problem = nameProblem(name);
    if (problem) throw new WindowsTasksError(`task name ${JSON.stringify(name)} ${problem}`);
    const id = taskId(chosen, job);
    // Task definitions are Windows paths on every computer, so they read the same in tests anywhere.
    const runner = path.win32.join(toolkitRoot, 'repo', 'scripts', 'toolkit-scheduled-job.cjs');
    const definition = {
      id, job, folder: chosen, name, repository: read.repository, purpose: spec.purpose, schedule: spec.schedule, schedule_text: describeSchedule(spec.schedule),
      execute: path.win32.join(systemRoot, 'System32', 'conhost.exe'),
      arguments: ['--headless', quotePath(nodePath, 'node'), quotePath(runner, 'the job runner'), job, '--repo-root', quotePath(read.root, 'the checkout'), '--task-id', id].join(' '),
      working_directory: toolkitRoot,
    };
    quotePath(toolkitRoot, 'the Toolkit checkout');
    definition.def = definitionDigest(definition);
    definition.description = `${chosen}: ${spec.task}. ${spec.purpose} [toolkit-task v1 id=${id} def=${definition.def}]`;
    if (['programme-sweep', 'footer-sweep'].includes(job)) cleaners.push(definition);
    if (!['programme-sweep', 'footer-sweep'].includes(job) || job === selected) wanted.push(definition);
    else skipped.push({ job, name, reason: selected === 'programme-sweep' ? 'the programme task already performs footer cleaning' : reason || 'footer cleaning is selected until governance is freshly verified' });
  }
  return { folder: chosen, repository: read.repository, root: read.root, wanted, cleaners, skipped, certain: read.certain,
    readIdentity: (deps.governance || require('./toolkit-governance-state.cjs')).readIdentity };
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
try {
`;
const POSTLUDE = String.raw`
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

const SCRIPTS = Object.freeze({
  list: String.raw`$path = PathOf $p.folder
$rows = New-Object System.Collections.ArrayList
foreach ($t in @(Get-ScheduledTask -TaskPath $path -ErrorAction SilentlyContinue)) {
  if ($t.TaskPath -ne $path) { continue }
  $i = $null
  try { $i = Get-ScheduledTaskInfo -TaskPath $t.TaskPath -TaskName $t.TaskName -ErrorAction Stop } catch { }
  $a = @($t.Actions)[0]
  $tr = New-Object System.Collections.ArrayList
  foreach ($x in @($t.Triggers)) { [void]$tr.Add([pscustomobject]@{ kind = [string]$x.CimClass.CimClassName; start = [string]$x.StartBoundary; interval = [string]$x.Repetition.Interval; duration = [string]$x.Repetition.Duration; days_of_week = $x.DaysOfWeek; enabled = [bool]$x.Enabled }) }
  [void]$rows.Add([pscustomobject]@{ name = $t.TaskName; description = [string]$t.Description; state = [string]$t.State; execute = [string]$a.Execute; arguments = [string]$a.Arguments; working_directory = [string]$a.WorkingDirectory; logon_type = [string]$t.Principal.LogonType; triggers = @($tr); last_run = $(if ($i) { When $i.LastRunTime } else { $null }); next_run = $(if ($i) { When $i.NextRunTime } else { $null }); last_result = $(if ($i) { [int64]$i.LastTaskResult } else { $null }) })
}
ConvertTo-Json -InputObject @($rows) -Depth 6 -Compress`,
  register: String.raw`$path = PathOf $p.folder
$existing = Get-ScheduledTask -TaskPath $path -TaskName $p.name -ErrorAction SilentlyContinue
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
$task.Settings.Enabled = [bool]$p.enabled
Register-ScheduledTask -TaskPath $path -TaskName $p.name -InputObject $task -Force | Out-Null
ConvertTo-Json -InputObject @{ registered = $true } -Compress`,
  enabled: String.raw`$path = PathOf $p.folder
if ($p.enabled) { Enable-ScheduledTask -TaskPath $path -TaskName $p.name | Out-Null } else { Disable-ScheduledTask -TaskPath $path -TaskName $p.name | Out-Null }
ConvertTo-Json -InputObject @{ changed = $true } -Compress`,
  stop: String.raw`Stop-ScheduledTask -TaskPath (PathOf $p.folder) -TaskName $p.name
ConvertTo-Json -InputObject @{ stopped = $true } -Compress`,
  unregister: String.raw`$path = PathOf $p.folder
$t = Get-ScheduledTask -TaskPath $path -TaskName $p.name -ErrorAction SilentlyContinue
if (-not $t -or $t.TaskPath -ne $path) { ConvertTo-Json -InputObject @{ removed = $false } -Compress }
elseif (([string]$t.Description).IndexOf($p.marker) -lt 0) { throw "The task in $path no longer carries Toolkit's marker; it was left alone." }
else { Unregister-ScheduledTask -TaskPath $path -TaskName $p.name -Confirm:$false; ConvertTo-Json -InputObject @{ removed = $true } -Compress }`,
  'remove-folder': String.raw`$svc = New-Object -ComObject Schedule.Service
$svc.Connect()
$f = $null
try { $f = $svc.GetFolder('\' + $p.folder) } catch { }
if (-not $f) { ConvertTo-Json -InputObject @{ folder = 'absent' } -Compress }
elseif ($f.GetTasks(1).Count -eq 0 -and $f.GetFolders(0).Count -eq 0) { $svc.GetFolder('\').DeleteFolder($p.folder, 0); ConvertTo-Json -InputObject @{ folder = 'removed' } -Compress }
else { ConvertTo-Json -InputObject @{ folder = 'kept' } -Compress }`,
  'marked-folders': String.raw`$names = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { ([string]$_.Description).Contains('[toolkit-task v1 ') -and $_.TaskPath -cmatch '^\\[A-Z0-9][A-Z0-9-]{0,31}\\$' } | ForEach-Object { $_.TaskPath.Trim('\') } | Sort-Object -Unique)
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
    register: definition => ps('register', {
      folder: definition.folder, name: definition.name, execute: definition.execute, arguments: definition.arguments, working_directory: definition.working_directory,
      enabled: definition.enabled !== false, schedule: definition.schedule, description: definition.description, marker_prefix: `[toolkit-task v1 id=${definition.id} `,
    }),
    unregister: (folder, name, id) => ps('unregister', { folder, name, marker: `[toolkit-task v1 id=${id} ` }),
    removeFolderIfEmpty: folder => ps('remove-folder', { folder }),
    setEnabled: (folder, name, enabled) => ps('enabled', { folder, name, enabled }),
    stop: (folder, name) => ps('stop', { folder, name }),
    start: (folder, name) => ps('start', { folder, name }),
    info: (folder, name) => ps('info', { folder, name }),
  };
}

// ---- plan, apply, remove, adopt ---------------------------------------------------------------

const CLEANERS = new Set(['programme-sweep', 'footer-sweep']);
const sameRepo = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

function liveDefinition(live, entry) {
  const hours = tasks.installedHours(describeTriggers(live.triggers));
  const schedule = CLEANERS.has(entry.job) && hours ? { kind: 'hourly', at: `${String(hours.hour).padStart(2, '0')}:00`, hours: hours.hours }
    : entry.job === 'shard-timings' ? JOBS['shard-timings'].schedule : null;
  return schedule && { ...live, id: entry.id, folder: entry.folder, job: entry.job, repository: entry.repository, schedule };
}

// The selected repository is the only reconciliation scope. No runtime discovery or repair.
class WindowsTaskReconciliation {
  constructor(desired, { scheduler, home, now = () => new Date(), wait = sleep, takeLock, readRecord, writeRecord, writeRegistry } = {}) {
    this.desired = desired; this.scheduler = scheduler; this.home = home; this.now = now;
    this.takeLock = takeLock || require('../../skills/github-program-reconciler/scripts/programme-lock.cjs').takeLock;
    this.readRecord = readRecord || (id => tasks.readLastRun(id, home) || (fs.existsSync(tasks.lastRunPath(id, home)) ? {} : null));
    this.writeRecord = writeRecord || ((id, record) => tasks.writeLastRun(id, record, home));
    this.writeRegistry = writeRegistry || (rows => tasks.writeRegistry(home, rows));
    this.wait = wait;
  }

  inspect() {
    const registry = tasks.readRegistry(this.home);
    this.entries = registry.tasks || [];
    const folders = new Set([this.desired.folder, ...this.entries.filter(row => row.host === 'windows').map(row => row.folder), ...this.scheduler.markedFolders()]);
    this.live = [...folders].flatMap(folder => this.scheduler.list(folder).map(row => ({ ...row, folder })));
    const cleaners = this.live.filter(live => {
      const marker = parseMarker(live.description);
      const entry = this.entries.find(row => row.host === 'windows' && row.folder === live.folder && row.name === live.name);
      const target = /(?:programme-sweep|footer-sweep) --repo-root "([^"]+)" --task-id [a-z0-9-]+$/.exec(live.arguments || '');
      if (sameRepo(entry?.repository, this.desired.repository) && (CLEANERS.has(entry.job)
        || (entry.adopted && (target || / - (?:PROGRAMME|FOOTER) SWEEP$/.test(live.name))))) return true;
      // Unknown marked tasks still name their repository through the complete runner action.
      if (!marker || !target) return false;
      if (live.folder === this.desired.folder) return true;
      try { return sameRepo(repositoryOf(this.desired.readIdentity(target[1])), this.desired.repository); } catch { return false; }
    });
    const installed = cleaners.find(live => CLEANERS.has(this.entries.find(row => row.folder === live.folder && row.name === live.name)?.job));
    const installedJob = installed && this.entries.find(row => row.folder === installed.folder && row.name === installed.name).job;
    const wanted = this.desired.wanted.map(definition => !this.desired.certain && CLEANERS.has(definition.job) && installedJob
      ? this.desired.cleaners.find(row => row.job === installedJob) : definition);
    const items = wanted.map(definition => {
      const existing = this.live.find(row => row.folder === definition.folder && row.name === definition.name);
      const recorded = this.entries.find(row => row.id === definition.id);
      let reason = null;
      if (this.entries.some(row => row.host === 'windows' && row.folder === definition.folder && typeof row.repository === 'string' && !sameRepo(row.repository, definition.repository))) reason = 'the destination folder belongs to another repository; it was left alone';
      if (recorded && (!sameRepo(recorded.repository, definition.repository) || recorded.adopted)) reason = 'the destination ID belongs to another repository or an adopted task; it was left alone';
      const sources = CLEANERS.has(definition.job) ? cleaners.filter(row => row !== existing) : [];
      const retired = CLEANERS.has(definition.job) ? this.entries.filter(row => row.host === 'windows' && !row.adopted && CLEANERS.has(row.job)
        && row.id !== definition.id && sameRepo(row.repository, definition.repository) && !this.live.some(live => live.folder === row.folder && live.name === row.name)) : [];
      for (const live of [...sources, ...(existing ? [existing] : [])]) reason ||= this.ownershipProblem(live);
      if (registry.status !== 'ok') reason = 'the task registry could not be read; no task was changed';
      const same = existing && !recorded?.pending_definition && parseMarker(existing.description)?.def === definition.def && existing.execute === definition.execute
        && existing.arguments === definition.arguments && existing.working_directory === definition.working_directory
        && describeTriggers(existing.triggers) === definition.schedule_text;
      return { definition, action: reason ? 'refused' : sources.length || retired.length ? 'replace' : !existing ? 'create' : same ? 'current' : 'update',
        ...(reason ? { reason } : {}), existing, sources, retired };
    });
    return { folder: this.desired.folder, repository: this.desired.repository, registry: registry.status, items,
      skipped: this.desired.skipped.filter(row => !wanted.some(definition => definition.job === row.job)),
      ...(!this.desired.certain ? { note: 'Governance could not be freshly verified; preserving the installed cleaner shape, or offering footer cleaning if none exists.' } : {}) };
  }

  ownershipProblem(live) {
    const marker = parseMarker(live.description);
    const entry = this.entries.find(row => row.host === 'windows' && row.folder === live.folder && row.name === live.name);
    if (!marker || !entry || entry.adopted || marker.id !== entry.id) return marker
      ? `"${live.name}" carries Toolkit's marker but this computer's task registry does not list it as owned, so Toolkit leaves it alone.`
      : `"${live.name}" is already in \\${live.folder}\\ and is not Toolkit's (no Toolkit marker, or not in this computer's task registry), so Toolkit leaves it alone.`;
    const definition = liveDefinition(live, entry);
    if (!sameRepo(entry.repository, this.desired.repository)) return 'the destination belongs to another repository; it was left alone';
    if (!definition || ![entry.definition, entry.pending_definition].includes(marker.def) || definitionDigest(definition) !== marker.def) return 'the live task action or schedule changed outside apply; it was left alone';
    const target = new RegExp(`${entry.job} --repo-root "([^"]+)" --task-id ${entry.id}$`).exec(live.arguments || '');
    try { if (!target || !sameRepo(repositoryOf(this.desired.readIdentity(target[1])), entry.repository)) return 'the live task target no longer matches its recorded repository; it was left alone'; }
    catch { return 'the live task target could not be verified; it was left alone'; }
    if (!['Disabled', 'Ready', 'Running', 'Queued'].includes(live.state)) return 'the live task state could not be verified; it was left alone';
    return null;
  }

  verify(definition, disabled) {
    const live = this.scheduler.list(definition.folder).find(row => row.name === definition.name);
    if (!live || live.execute !== definition.execute || live.arguments !== definition.arguments || live.working_directory !== definition.working_directory
      || parseMarker(live.description)?.def !== definition.def || describeTriggers(live.triggers) !== describeSchedule(definition.schedule)
      || (disabled ? live.state !== 'Disabled' : !['Ready', 'Running', 'Queued'].includes(live.state))) throw new Error('task definition read-back failed');
  }

  quiesce(live) {
    this.scheduler.setEnabled(live.folder, live.name, false);
    const state = this.scheduler.info(live.folder, live.name);
    // Stop only the task being replaced, then prove it has stopped before cursor copying.
    if (['Running', 'Queued'].includes(state?.state)) this.scheduler.stop(live.folder, live.name);
    let after;
    for (let attempt = 0; attempt < 50; attempt++) {
      after = this.scheduler.info(live.folder, live.name);
      if (after?.state === 'Disabled') break;
      this.wait(100);
    }
    if (!after || after.state !== 'Disabled') throw new Error('source task did not stop in a disabled state');
  }

  recordTasks(rows) {
    this.writeRegistry(rows);
    const expected = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    const actual = tasks.readRegistry(this.home);
    if (actual.status !== 'ok' || JSON.stringify(actual.tasks) !== JSON.stringify(expected)) throw new Error('task registry read-back failed');
  }

  change(item) {
    const d = item.definition;
    const old = [...item.sources, ...(item.existing ? [item.existing] : [])];
    const entries = tasks.readRegistry(this.home).tasks.map(row => ({ ...row }));
    const backups = old.map(live => liveDefinition(live, entries.find(row => row.folder === live.folder && row.name === live.name)));
    const disabled = old.some(live => live.state === 'Disabled');
    const priorRecord = this.readRecord(d.id);
    let notes = [];
    try {
      if (item.existing && ['Running', 'Queued'].includes(item.existing.state)) this.quiesce(item.existing);
      // Record custody before registration so an interrupted prepare remains recognisable.
      const existingEntry = entries.find(row => row.id === d.id);
      // In-place replacement can be interrupted before or after native registration. Bind only
      // these two exact definitions until final read-back; no arbitrary changed action is owned.
      const preparing = item.existing ? { ...existingEntry, pending_definition: d.def } : registryEntry(d, existingEntry, this.now);
      this.recordTasks([...entries.filter(row => row.id !== d.id), preparing]);
      // Destination is born disabled, including an in-place schedule/action update.
      this.scheduler.register({ ...d, enabled: false });
      this.verify(d, true);
      for (const live of item.sources) this.quiesce(live);
      if (CLEANERS.has(d.job) && (item.sources.length || item.retired.length)) {
        const runner = require('./toolkit-scheduled-job.cjs');
        const now = this.now();
        const records = [...backups, ...item.retired].map(source => ({ record: this.readRecord(source.id), expected: source }));
        records.push({ record: priorRecord, expected: d });
        // A new destination has no history of its own; it must not widen a usable source cursor.
        const existingRecords = records.filter(row => row.record != null);
        const selected = (existingRecords.length ? existingRecords : records.slice(-1))
          .map(({ record, expected }) => runner.footerCursor(record, expected, d.repository, now));
        const since = selected.map(row => row.since).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
        notes = [...new Set(selected.map(row => row.note).filter(Boolean))];
        this.writeRecord(d.id, { schema: 'toolkit.task-last-run.v1', id: d.id, job: d.job, repository: d.repository,
          started: now.toISOString(), finished: null, status: 'held', exit: null, footer_sweep_since: since,
          summary: notes });
      }
      for (const source of backups.filter(row => row.id !== d.id)) this.scheduler.unregister(source.folder, source.name, source.id);
      this.recordTasks([...entries.filter(row => ![...backups, ...item.retired].some(source => source.id === row.id) && row.id !== d.id), registryEntry(d, entries.find(row => row.id === d.id), this.now)]);
      if (!disabled) this.scheduler.setEnabled(d.folder, d.name, true);
      this.verify(d, disabled);
      for (const source of backups.filter(row => row.id !== d.id)) if (this.scheduler.list(source.folder).some(row => row.name === source.name)) throw new Error('source task retirement read-back failed');
      return { ...item, done: true, disabled, notes };
    } catch (error) {
      let restored = false;
      try {
        // Keep every participant stopped while restoring the previous definitions and registry.
        const destination = this.scheduler.list(d.folder).find(row => row.name === d.name);
        if (destination) { this.quiesce({ ...destination, folder: d.folder }); this.scheduler.unregister(d.folder, d.name, d.id); }
        for (const source of backups) { this.scheduler.register({ ...source, enabled: false }); this.verify({ ...source, def: parseMarker(source.description).def }, true); }
        if (priorRecord) this.writeRecord(d.id, priorRecord);
        this.recordTasks(entries);
        for (let i = 0; i < backups.length; i++) {
          if (old[i].state !== 'Disabled') this.scheduler.setEnabled(backups[i].folder, backups[i].name, true);
          this.verify({ ...backups[i], def: parseMarker(backups[i].description).def }, old[i].state === 'Disabled');
        }
        restored = JSON.stringify(tasks.readRegistry(this.home).tasks) === JSON.stringify(entries);
      } catch { restored = false; }
      return { ...item, done: false, error: `${tasks.safeText(error.message)}; ${restored ? 'previous configuration restored and verified' : 'restoration incomplete; inspect the source and destination tasks and rerun apply'}` };
    }
  }

  apply(firstRunOptions) {
    const runner = require('./toolkit-scheduled-job.cjs');
    const lock = this.takeLock(runner.footerLockPath(this.desired.repository, this.home));
    if (!lock) throw new WindowsTasksError('another footer pass or apply is running; no task was changed', 1);
    let plan;
    try {
      plan = this.inspect();
      if (plan.registry !== 'ok') throw new WindowsTasksError('the task registry could not be read; no task was changed', 1);
      // An unknown cleaner blocks the whole transition, not just a competing destination.
      if (plan.items.some(item => CLEANERS.has(item.definition.job) && item.action === 'refused')) return plan;
      plan.items = plan.items.map(item => item.action === 'refused' ? item : item.action === 'current' ? { ...item, done: true }
        : this.change(item));
    } finally { lock.release(); }
    // First runs happen only after reconciliation and lock release.
    for (const item of plan.items) if (item.done && item.action !== 'current' && !item.disabled && CLEANERS.has(item.definition.job) && firstRunOptions)
      item.first_run = firstRun(item.definition, { scheduler: this.scheduler, home: this.home, now: this.now, ...firstRunOptions });
    return plan;
  }
}

function planTasks(desired, deps) { return new WindowsTaskReconciliation(desired, deps).inspect(); }

function registryEntry(definition, existing, now) {
  return {
    id: definition.id, name: definition.name, host: 'windows', folder: definition.folder, schedule: definition.schedule_text, model: null, effort: null,
    purpose: definition.purpose, repository: definition.repository, created: existing ? existing.created : now().toISOString(), created_by: 'toolkit-windows-tasks apply',
    job: definition.job, definition: definition.def,
  };
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Starts a task once and waits for it; one more start after 0xC000013A (a console close stopped it).
// Healthy only when the job's own last-run record, written after the start, says it ended well.
function firstRun(definition, { scheduler, home, now = () => new Date(), wait = sleep, waitMs = FIRST_RUN_WAIT_MS, pollMs = POLL_MS }) {
  let restarted = false;
  for (;;) {
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
    const ok = last.exit === 0;
    return { status: ok ? 'ok' : 'failed', detail: `${last.status}: ${(last.summary || []).slice(0, 3).join(' | ')}`, restarted };
  }
}

function applyTasks(desired, deps) {
  return new WindowsTaskReconciliation(desired, deps).apply(deps.firstRunOptions);
}

function removeTasks({ folder = null, scheduler, home }) {
  const registry = tasks.readRegistry(home);
  if (registry.status !== 'ok') throw new WindowsTasksError(`the task registry ${tasks.registryPath(home)} could not be read, so no task was removed`, 1);
  const ours = registry.tasks.filter(entry => entry.host === 'windows' && !entry.adopted && (!folder || entry.folder === folder));
  const results = [];
  const folders = new Set(ours.map(entry => entry.folder));
  for (const entry of ours) {
    const live = scheduler.list(entry.folder).find(task => task.name === entry.name);
    const marker = live ? parseMarker(live.description) : null;
    if (live && (!marker || marker.id !== entry.id)) { results.push({ id: entry.id, name: entry.name, folder: entry.folder, action: 'refused', reason: 'the task with that name no longer carries Toolkit\'s marker, so it was left alone' }); continue; }
    try {
      if (live) scheduler.unregister(entry.folder, entry.name, entry.id);
      tasks.updateRegistry(home, list => list.filter(item => item.id !== entry.id));
      results.push({ id: entry.id, name: entry.name, folder: entry.folder, action: live ? 'removed' : 'forgotten (it was already gone)' });
    } catch (error) {
      results.push({ id: entry.id, name: entry.name, folder: entry.folder, action: 'failed', reason: tasks.safeText(error.message) });
    }
  }
  const folderResults = [];
  for (const name of [...folders].sort()) {
    try { folderResults.push({ folder: name, result: (scheduler.removeFolderIfEmpty(name) || {}).folder || 'kept' }); }
    catch (error) { folderResults.push({ folder: name, result: 'failed', reason: tasks.safeText(error.message) }); }
  }
  return { items: results, folders: folderResults };
}

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
  const lower = file.toLowerCase();
  const prefix = home.toLowerCase();
  return lower === prefix || lower.startsWith(`${prefix}\\`) ? `"$env:USERPROFILE${file.slice(home.length)}"` : `"${file}"`;
}

function applyCommand(desired, { toolkitRoot = path.resolve(__dirname, '..', '..'), folderOverride = null, home } = {}) {
  const script = path.win32.join(toolkitRoot, 'repo', 'scripts', 'toolkit-windows-tasks.cjs');
  return `node ${powerShellPath(script, home)} apply --repo-root ${powerShellPath(desired.root, home)}${folderOverride ? ` --folder ${folderOverride}` : ''}`;
}

const ACTION_TEXT = Object.freeze({ create: 'to create', update: 'to update in place', replace: 'to replace the existing cleaner', current: 'up to date', refused: 'refused' });

function describePlan(plan, { command = null, applied = false } = {}) {
  const lines = [`Windows scheduled tasks for ${plan.repository || 'this repository'} in \\${plan.folder}\\:`];
  if (plan.note) lines.push(plan.note);
  for (const item of plan.items) {
    const d = item.definition;
    const state = applied ? (item.action === 'refused' ? 'refused' : item.done === false ? `failed: ${item.error}` : item.action === 'current' ? 'up to date' : item.action === 'create' ? 'created' : 'updated') : ACTION_TEXT[item.action];
    lines.push(`- ${d.name} (${d.schedule_text}): ${state}. ${d.purpose}`);
    if (item.reason) lines.push(`  ${item.reason}`);
    for (const note of item.notes || []) lines.push(`  ${note}`);
    if (item.first_run) lines.push(`  First run: ${item.first_run.status}${item.first_run.detail ? ` (${item.first_run.detail})` : ''}.`);
  }
  for (const item of plan.skipped) lines.push(`- ${item.name}: not registered, because ${item.reason}.`);
  if (!applied && command && plan.items.some(item => ['create', 'update', 'replace'].includes(item.action))) {
    const changed = plan.items.filter(item => ['create', 'update', 'replace'].includes(item.action)).map(item => item.definition.job);
    const effects = [];
    if (changed.includes('programme-sweep')) effects.push('starts the programme sweep immediately');
    if (changed.includes('footer-sweep')) effects.push("starts the footer sweep immediately, editing the signed-in account's own GitHub posts in this repository and, only when verified, its evidence store");
    else if (changed.includes('programme-sweep')) effects.push("the programme sweep cleans the signed-in account's own GitHub posts first, adding the evidence store only when verified");
    if (changed.includes('shard-timings')) effects.push('registers shard timings for its scheduled time without starting it immediately');
    lines.push('', `Agents do not create scheduled tasks, so paste this line into PowerShell yourself (it reconciles the tasks marked to create, update or replace, preserves disabled tasks, then ${effects.join('; ')} for changed enabled tasks only):`, '', `    ${command}`);
  }
  return lines;
}

// ---- command line ------------------------------------------------------------------------------

const COMMANDS = Object.freeze(['plan', 'apply', 'remove', 'adopt']);
const VALUE_FLAGS = Object.freeze({ plan: ['--repo-root', '--folder'], apply: ['--repo-root', '--folder'], remove: ['--folder'], adopt: ['--folder', '--task', '--id', '--purpose', '--repository'] });
const USAGE = 'Usage: node repo/scripts/toolkit-windows-tasks.cjs plan|apply [--repo-root <checkout>] [--folder <F>] [--no-first-run] [--json]\n'
  + '       node repo/scripts/toolkit-windows-tasks.cjs remove [--folder <F>] [--json]\n'
  + '       node repo/scripts/toolkit-windows-tasks.cjs adopt --folder <F> --task <name> --id <id> --purpose <text> [--repository <owner/name>]\n';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new WindowsTasksError(`give a command: ${COMMANDS.join(', ')}`);
  const options = { command, json: false, firstRun: true };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--json') options.json = true;
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
    const desiredOptions = { checkout, folder: options.folder || null, deps: deps.checkoutDeps || {}, ...(deps.toolkitRoot ? { toolkitRoot: deps.toolkitRoot } : {}), ...(deps.nodePath ? { nodePath: deps.nodePath } : {}), ...(deps.systemRoot ? { systemRoot: deps.systemRoot } : {}) };
    if (options.command === 'plan') {
      const desired = desiredTasks(desiredOptions);
      const plan = planTasks(desired, { scheduler, home });
      const command = applyCommand(desired, { toolkitRoot: deps.toolkitRoot, folderOverride: options.folder, home });
      print({ ...plan, command }, describePlan(plan, { command }));
      return plan.items.some(item => item.action === 'refused') ? 1 : 0;
    }
    if (options.command === 'apply') {
      const desired = desiredTasks(desiredOptions);
      const result = applyTasks(desired, { scheduler, home, now: deps.now, firstRunOptions: options.firstRun ? (deps.firstRunOptions || {}) : null });
      print(result, describePlan(result, { applied: true }));
      return result.items.some(item => item.action === 'refused' || item.done === false || (item.first_run && item.first_run.status === 'failed')) ? 1 : 0;
    }
    if (options.command === 'remove') {
      const result = removeTasks({ folder: options.folder || null, scheduler, home });
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
  JOBS, FOLDER, MARKER, STATUS_CONTROL_C_EXIT, WindowsTasksError, defaultFolder, nameProblem, taskName, taskId, parseMarker, repositoryOf, readCheckout, folderForCheckout,
  describeTriggers, describeResult, describeSchedule, desiredTasks, definitionDigest, powerShellScheduler, runPowerShell, SCRIPTS, planTasks, applyTasks, firstRun, WindowsTaskReconciliation,
  removeTasks, adoptTask, applyCommand, powerShellPath, describePlan, parseArgs, main,
};
