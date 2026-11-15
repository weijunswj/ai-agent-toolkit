#!/usr/bin/env node
'use strict';

// The legacy Windows task cleaner. Toolkit no longer creates, updates or runs scheduled tasks on a
// computer (the cloud runs those jobs); this module only lets `remove toolkit` (toolkit-remove.cjs)
// find and remove the old Toolkit tasks an earlier release left behind, after the owner's OK.
//
// It reads Task Scheduler (one folder's tasks, and the folders holding Toolkit-marked tasks) and
// removes a task only while it still carries Toolkit's marker `[toolkit-task v1 id=<id> def=<digest>]`,
// or the fixed description an old launcher wrote when it disabled its task, and only while its
// exported definition is byte for byte the one the plan read. An empty Toolkit folder goes with its
// last task. A task the owner made, or one Toolkit only listed (adopted), is never removed.
//
// Removal condition: delete this module and the task part of toolkit-remove.cjs once no supported
// install can still carry an old Toolkit task (owner: the Toolkit controller).

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tasks = require('./toolkit-tasks.cjs');

const FOLDER = /^[A-Z0-9][A-Z0-9-]{0,31}$/;
const MARKER = /\[toolkit-task v1 id=([a-z0-9][a-z0-9-]{0,79}) def=([0-9a-f]{12})\]/;
// The description an old task launcher wrote when it disabled its own task after Toolkit was removed.
const DISABLED_DESCRIPTION = 'Disabled: Toolkit removed. Delete this task or re-run setup toolkit.';

class WindowsTasksError extends Error {
  constructor(message, exitCode = 2) { super(message); this.exitCode = exitCode; }
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

function parseMarker(description) {
  const match = MARKER.exec(String(description || ''));
  return match ? { id: match[1], def: match[2] } : null;
}

// The folder that held the old tasks' shared launcher copies, under Toolkit's user-state folder.
function runnersDir(home) { return path.join(tasks.userStateDir(home), 'task-runners'); }

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
  unregister: String.raw`$path = PathOf $p.folder
$t = @(@(ReadTasks $path) | Where-Object { $_.TaskName -ieq $p.name })
if ($t.Count -gt 1) { throw 'More than one task has this name; left alone.' }
if ($t -and $p.expected_xml -and (Export-ScheduledTask -InputObject $t[0]) -cne $p.expected_xml) { throw 'Task changed before removal; left alone.' }
if (-not $t -or $t[0].TaskPath -ne $path) { ConvertTo-Json -InputObject @{ removed = $false } -Compress }
elseif (([string]$t[0].Description).IndexOf($p.marker) -lt 0) { throw "The task in $path no longer carries Toolkit's marker; it was left alone." }
else { Unregister-ScheduledTask -InputObject $t[0] -Confirm:$false; ConvertTo-Json -InputObject @{ removed = $true } -Compress }`,
  'remove-folder': String.raw`$svc = New-Object -ComObject Schedule.Service
$svc.Connect()
$f = $null
try { $f = $svc.GetFolder('\' + $p.folder) } catch { if ($_.Exception.HResult -notin @(-2147024894, -2147024893)) { throw } }
if (-not $f) { ConvertTo-Json -InputObject @{ folder = 'absent' } -Compress }
elseif ($f.GetTasks(1).Count -eq 0 -and $f.GetFolders(0).Count -eq 0) { $svc.GetFolder('\').DeleteFolder($p.folder, 0); ConvertTo-Json -InputObject @{ folder = 'removed' } -Compress }
else { ConvertTo-Json -InputObject @{ folder = 'kept' } -Compress }`,
  'marked-folders': String.raw`$names = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { ([string]$_.Description).Contains('[toolkit-task v1 ') -and $_.TaskPath -cmatch '^\\[A-Z0-9][A-Z0-9-]{0,31}\\$' } | ForEach-Object { $_.TaskPath.Trim('\') } | Sort-Object -Unique)
ConvertTo-Json -InputObject @($names) -Compress`,
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

// The scheduler interface toolkit-remove.cjs uses; tests pass a fake with the same methods.
function powerShellScheduler(options = {}) {
  const ps = (op, payload) => runPowerShell(op, payload, options);
  const asList = value => (Array.isArray(value) ? value : value ? [value] : []);
  return {
    list: folder => asList(ps('list', { folder })),
    markedFolders: () => asList(ps('marked-folders', {})),
    unregister: (folder, name, id, previous) => ps('unregister', { folder, name, marker: `[toolkit-task v1 id=${id} `, expected_xml: previous?.definition_xml || null }),
    // A task the old launcher disabled carries its fixed description instead of the marker; it is
    // removed only while it is still exactly the recorded snapshot.
    unregisterDisabled: (folder, name, previous) => {
      if (!previous?.definition_xml) throw new WindowsTasksError('disabled task has no exact XML readback; left alone', 1);
      return ps('unregister', { folder, name, marker: DISABLED_DESCRIPTION, expected_xml: previous.definition_xml });
    },
    removeFolderIfEmpty: folder => ps('remove-folder', { folder }),
  };
}

// A live task's definition in a stable key order, compared against the recorded one.
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

module.exports = { FOLDER, MARKER, DISABLED_DESCRIPTION, SCRIPTS, WindowsTasksError, nameProblem, parseMarker, runnersDir,
  powerShellScheduler, runPowerShell, ordered, enrolledDefinition };
