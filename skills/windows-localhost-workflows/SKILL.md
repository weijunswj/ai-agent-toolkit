---
name: windows-localhost-workflows
description: Use when starting, relaunching, verifying, or debugging Windows localhost web apps, API servers, or dev services, especially long-running dev servers, bounded readiness polling, PowerShell startup, execution policy, Corepack/package-manager, Python runtime, spawn EPERM, duplicate Path/PATH, port conflict, detached launch, sandbox persistence, or empty-log failures.
---

<!--
Generated from toolkit project source. Do not edit directly.
Project: development.windows-localhost-workflows
Source: _projects/development/windows-localhost-workflows/_main/skill/SKILL.md
Update the project source and run sync.
-->
# Windows Localhost Workflows

## Overview

Start the local service, prove it is reachable, and report the exact working launch path. Prefer fast diagnosis over repeating the same broken startup command.

This skill is most useful for Codex and Claude Code on Windows. Use it before attempting to start, restart, or verify a Windows localhost service so known Windows and sandbox launch failures are handled up front. It can also guide ChatGPT or Claude when shell access is unavailable by returning commands for the user to run manually.

## Platform Support

- ChatGPT: use when tool/shell access exists, or provide manual PowerShell steps.
- Codex: primary use case; run commands in the repo and verify localhost.
- Claude: use when Claude Skills and shell/tool access are available.
- Claude Code: copy the skill folder into `~/.claude/skills/` for personal use or `.claude/skills/` for project use.

If the platform cannot run shell commands, do not claim the service was started. Provide the exact commands and checks for the user to run.

## Core Rule

A localhost workflow is not done until both are true:

1. The launch command is known and repeatable.
2. The app responds on the expected localhost URL or health endpoint.

## Long-Running Localhost Server Rule

Do not run persistent server commands such as `npm run dev`, `npm run start`, `npm run platform:start`, `uvicorn`, `flask run`, `python -m http.server`, `pnpm dev`, `yarn dev`, or `bun run dev` in the foreground unless the user explicitly asks for an interactive foreground terminal.

Default behavior for persistent localhost servers:

1. Launch a detached/background process.
2. Redirect stdout/stderr to temporary or repo-approved local logs.
3. Run bounded readiness checks against an HTTP health URL, known app URL, or TCP port.
4. Return a concise status summary.
5. Never wait indefinitely.

If an agent must run a command that may be long-running, use one of:

- a timeout wrapper.
- a detached/background launch.
- an explicit user-approved foreground run.

If a command produces no readiness signal within the bounded wait, stop and summarize. Do not "just wait".

## Workflow

### 1. Discover the app root and native startup command

Inspect these files before running random commands:

- `package.json` scripts.
- README setup/start instructions.
- helper script files such as `start-local-dev.ps1`, `dev.ps1`, `dev.*`, or `start.*`.
- `.env`, `.env.local`, `.env.example`, and documented environment requirements.

Identify:

- expected host and port.
- package manager: npm, pnpm, yarn, bun, dotnet, python, etc.
- auth/dev mode.
- required `.env` source.

Reuse an existing `.env` when present. If the project expects one and it is missing, create it from `.env.example` only when safe and obvious.

### 2. Check whether the target port is already in use

Adjust the port number to match the project.

```powershell
$port = 3000
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { Get-Process -Id $conn.OwningProcess | Select-Object Id,ProcessName,Path }
```

Before launching, check whether the intended port is already listening. If the port is already listening, health-check it first.

- If health is OK, do not start another server.
- If a stale/broken process owns the port or a launcher is stale, ask before killing unless it is clearly created by the current run and safe to stop.
- Use process IDs in local notes.
- Do not over-log private command lines if they contain secrets.
- Reuse, stop, or change port only after understanding whether the process is the same app.

### 3. Resolve runtimes and package-manager commands dynamically

Do not hardcode a user-specific path as the default. Find the runtime or package manager first:

```powershell
Get-Command pnpm.cmd -ErrorAction SilentlyContinue
Get-Command npm.cmd -ErrorAction SilentlyContinue
Get-Command yarn.cmd -ErrorAction SilentlyContinue
Get-Command bun.exe -ErrorAction SilentlyContinue
Get-Command python.exe -ErrorAction SilentlyContinue
Get-Command py.exe -ErrorAction SilentlyContinue
```

For Python apps, check `python.exe`, then `py.exe`, then any platform-provided or bundled Python runtime exposed by the current agent environment. Use the platform/bundled runtime only as a discovered fallback, not as a hardcoded default. Explain which runtime was selected.

If a wrapper script fails, or PATH discovery does not find the expected command, call the resolved executable directly:

```powershell
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
& $pnpm dev
```

Use hardcoded paths only as a last-resort local fallback, and explain why.

### 4. Diagnose unknown failures with bounded commands

When the launch failure mode is unknown, run a short bounded diagnostic command so the real error is visible. Do not leave a persistent server command in the foreground without a timeout or explicit user-approved foreground run.

Examples:

```powershell
npm run dev
pnpm dev
yarn dev
bun run dev
```

If a PowerShell helper script is the documented startup path, run it once with a timeout wrapper or equivalent bounded shell execution to see whether it fails before binding the port. If it fails due to wrapper/tooling issues, stop retrying it and run the underlying command directly.

### 5. Start long-running servers detached

Use this when the service is long-running and the working command is known. A reliable launch pattern is:

1. Check the port.
2. Normalize duplicate process environment keys before `Start-Process`.
3. Start the server with stdout/stderr logs.
4. Poll a documented health endpoint such as `/api/health`, or the root URL when no health endpoint exists.
5. After the launch shell command returns, re-check the port or HTTP endpoint before claiming the server persists.
6. If a Codex sandbox launch does not persist after the shell command returns, retry with an escalated/unsandboxed launch when the environment supports it, then repeat the post-return port or HTTP check.
7. Report the exact URL, command, process id, and log paths.

Readiness checks must be bounded:

- Use a clear max wait, usually 60-120 seconds unless the user explicitly asks otherwise.
- Poll every 1-3 seconds.
- Success must be based on observable readiness: HTTP 200/expected status, TCP port listening, or a known health endpoint.
- Never rely only on `Start-Process` exit state as proof the app is running.
- If not ready by timeout, stop and report the command attempted, safe log tail, port status, process status, and next manual action. Do not keep waiting.

### 6. Preferred Windows-safe launcher example

Prefer a temporary `.ps1` launcher script when the startup logic contains quotes, `#`, `=`, `$`, JSON, `.IndexOf("=")`, `.StartsWith("#")`, environment parsing, or multiline script logic. Avoid deeply nested one-line PowerShell strings inside `Start-Process -ArgumentList` for those cases.

Good patterns:

- Write a temporary `.ps1` launcher script and call it with `Start-Process powershell.exe -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", "<launcher.ps1>")` when an interactive visible window is explicitly wanted.
- For automated agent launches, use `Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $launcher)` with `-WindowStyle Hidden` and redirected logs.
- Use `Start-Job` for short background setup only, not persistent server ownership unless logs/process lifecycle are clear.
- Use a simple `cmd /c` or PowerShell command only when no nested quoting is needed.

If a temporary launcher script is created:

- Place it in an ignored temp/logs folder when possible, such as `.tmp/localhost/`, `tmp/`, or another repo-approved local log folder.
- Avoid committing it unless intentionally added as repo tooling.
- Clean it up when no longer needed, or explain why it remains.

This example creates a temporary launcher file, sets environment variables without printing secrets, redirects logs, polls readiness, and fails fast after timeout with a safe log tail.

```powershell
$app = Resolve-Path .
$port = 3000
$url = "http://127.0.0.1:$port/health"
$runDir = Join-Path $app '.tmp/localhost'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$launcher = Join-Path $runDir 'dev-server.launch.ps1'
$log = Join-Path $runDir 'dev-server.out.log'
$err = Join-Path $runDir 'dev-server.err.log'

$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  try {
    Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null
    [pscustomobject]@{ Ready = $true; Url = $url; ReusedProcessId = $conn.OwningProcess }
    return
  } catch {
    Get-Process -Id $conn.OwningProcess | Select-Object Id,ProcessName,Path
    throw "Port $port is already listening but health failed. Ask before killing the owner."
  }
}

$processEnv = [Environment]::GetEnvironmentVariables("Process")
if ($processEnv.Contains("Path") -and $processEnv.Contains("PATH")) {
  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

@"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '$app'

# Set required non-secret dev env values here. Never print secrets.
`$env:NODE_ENV = 'development'
`$env:HOST = '127.0.0.1'
`$env:PORT = '$port'

& '$npm' run dev
"@ | Set-Content -LiteralPath $launcher -Encoding UTF8

$proc = Start-Process -FilePath 'powershell.exe' `
  -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcher) `
  -WorkingDirectory $app `
  -RedirectStandardOutput $log `
  -RedirectStandardError $err `
  -WindowStyle Hidden `
  -PassThru

$deadline = (Get-Date).AddSeconds(60)
do {
  Start-Sleep -Seconds 2
  try {
    Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null
    $ready = $true
  } catch {
    $tcp = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $ready = [bool]$tcp
  }
} until ($ready -or (Get-Date) -gt $deadline)

if (-not $ready) {
  $tail = @()
  foreach ($path in @($log, $err)) {
    if (Test-Path $path) { $tail += Get-Content -LiteralPath $path -Tail 40 }
  }
  $tcp = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  $procState = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,HasExited
  [pscustomobject]@{
    Ready = $false
    Url = $url
    CommandAttempted = "npm run dev"
    ProcessStatus = $procState
    PortStatus = $tcp
    SafeLogTail = ($tail -join "`n")
    NextManualAction = "Inspect sanitized logs and run the documented command manually if needed."
  }
  return
}

[pscustomobject]@{
  Ready = $ready
  Url = $url
  ProcessId = $proc.Id
  Stdout = $log
  Stderr = $err
}
```

Replace `npm run dev` with the project's actual working command. Keep sensitive values out of the launcher body when possible; prefer reading existing local `.env` through the app's normal config loader instead of echoing env values.

Avoid this fragile nested-quote anti-pattern:

```powershell
Start-Process powershell -ArgumentList "-Command", "<large quoted script with `$line.IndexOf("=")` and `$line.StartsWith("#")`>"
```

Python localhost apps need the same quoting discipline, especially when the repo path contains spaces:

```powershell
$app = Resolve-Path .
$server = Join-Path $app 'webapp/server.py'
$python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = (Get-Command py.exe -ErrorAction SilentlyContinue).Source }
# If PATH lookup fails, use the current agent/platform dependency locator to find a bundled Python,
# then assign that discovered absolute python.exe path to $python.
if (-not $python) { throw 'No Python runtime was found on PATH or through the current platform runtime discovery.' }

$port = 8765
$url = "http://localhost:$port"
$log = Join-Path $app 'python-server.log'
$err = Join-Path $app 'python-server.err.log'

$argumentString = "`"$server`" --host 127.0.0.1 --port $port"
$proc = Start-Process -FilePath $python `
  -ArgumentList $argumentString `
  -WorkingDirectory $app `
  -RedirectStandardOutput $log `
  -RedirectStandardError $err `
  -WindowStyle Hidden `
  -PassThru

$deadline = (Get-Date).AddSeconds(60)
do {
  Start-Sleep -Seconds 2
  try {
    Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null
    $ready = $true
  } catch {
    $ready = $false
  }
} until ($ready -or (Get-Date) -gt $deadline)

[pscustomobject]@{
  Ready = $ready
  Url = $url
  ProcessId = $proc.Id
  Stdout = $log
  Stderr = $err
}
```

If `python.exe` and `py.exe` are unavailable, substitute a discovered platform-provided Python executable for `$python` rather than hardcoding a user-specific path in reusable instructions.

### 7. Verify from logs and HTTP

```powershell
Get-Content -Tail 40 .\.tmp\localhost\dev-server.out.log
Get-Content -Tail 40 .\.tmp\localhost\dev-server.err.log
Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 15
```

Prefer a documented health endpoint when available, such as:

```text
http://localhost:3000/health
http://localhost:8000/api/health
```

Treat setup as incomplete until the HTTP check succeeds or the user explicitly accepts a partial result.

## Log Handling Rules

- Redirect stdout/stderr to local logs for server startup diagnosis.
- Tail only a small safe excerpt, for example the last 30-80 lines.
- Do not print secrets: DATABASE_URL, OAuth secrets, tokens, cookies, callback URLs with query params, launch tokens, private customer/profile/pricing data, generated quote contents, or raw private payloads.
- If logs may contain secrets, sanitize or report only safe categories such as "database connection error", "missing env var name", "port already bound", "migration failed", or "syntax error in launcher wrapper".

## Windows Failure Patterns

### PowerShell execution policy blocks `.ps1`

Use this only to diagnose the script itself:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local-dev.ps1
```

If the script still fails, stop retrying it and run the underlying start command directly.

### Corepack or OneDrive `.corepack` `EPERM`

If Corepack-managed launch fails on a `.corepack` path, bypass Corepack and call the installed package-manager binary directly, such as the `pnpm.cmd` returned by `Get-Command pnpm.cmd`.

### Duplicate `Path` and `PATH` environment keys

On Windows, `Start-Process` can fail with an error like `Item has already been added. Key in dictionary: 'Path' Key being added: 'PATH'` when the current process environment contains both `Path` and `PATH`. Normalize the duplicate process key before launching the server:

```powershell
$processEnv = [Environment]::GetEnvironmentVariables("Process")
if ($processEnv.Contains("Path") -and $processEnv.Contains("PATH")) {
  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
}
```

Do this only for the current process before `Start-Process`; do not edit machine or user environment variables for this workaround.

### Fragile nested PowerShell quoting

Avoid deeply nested one-line PowerShell strings inside `Start-Process -ArgumentList` when the command contains quotes, `#`, `=`, `$`, JSON, `.IndexOf("=")`, `.StartsWith("#")`, env parsing, or multiline script logic. Quote loss inside nested command strings can turn valid expressions into invalid parse fragments such as `$line.IndexOf(=)` or `$line.StartsWith(#)`.

Prefer the temporary `.ps1` launcher pattern above and call it through `-File`. Never rely only on `Start-Process` exit state as proof the app is running.

### Sandbox `spawn EPERM`

If the dev server fails inside an agent sandbox with `spawn EPERM`, request elevated/unsandboxed execution if the environment supports it. Do not keep retrying the same command inside the same failing sandbox.

### Codex sandbox background process does not persist

In Codex sandboxed shells, background localhost servers may exit or be killed when the shell command returns. If the user needs the dev server to keep running after the command finishes, relaunch it with `sandbox_permissions: require_escalated` when available, then repeat the same log and HTTP health verification. Report that the escalation is for local process persistence, not for external network exposure.

Even when a sandboxed background launch appears to work while the shell command is still running, do not claim the service is persistent until a follow-up port or HTTP check succeeds after that shell command has returned.

### Port conflict

If the target port is already bound, inspect the owning process. Reuse, stop, or change port only after understanding whether the process is the same app.

### Process exits immediately with empty logs

Re-run the exact command in the foreground with the real shell and capture stdout/stderr directly. Empty redirected logs often mean the wrapper process died before the app started.

## Local UAT Launcher Checklist

For a two-server local UAT such as a platform API plus an app:

1. Start dependency services first, such as Docker/Postgres.
2. Run DB preflight before migrations.
3. Run migrations before app start.
4. Start app servers separately.
5. Health-check each URL independently.
6. Use `127.0.0.1` consistently if the project requires it.
7. Return a compact status block with dependency status, app server status, health status, URLs, and what remains manual.

## Anti-patterns

Avoid:

- running a persistent server in the foreground and waiting indefinitely.
- nested PowerShell command strings with complex quotes.
- assuming successful process launch means server is ready.
- restarting a server repeatedly without checking if the port is already bound.
- printing full env or DB URLs during diagnosis.

## Reporting

When finishing localhost setup, include:

- dependency status, when dependency services were part of the task.
- app server status.
- health status and URL checked.
- the exact command that worked.
- whether a workaround was needed for execution policy, Corepack, sandbox spawning, package-manager path, port conflicts, or PowerShell launcher safety.
- where stdout/stderr logs live.
- any remaining manual steps.

Use this compact format:

```markdown
## Done

### Status
- Dependencies: Up / Not checked / Not required / Blocked.
- App server: Up / Not up / Partially started.
- Health: Passing / Failing / Timed out.
- URLs: <urls checked>.
- Working command: `<command>`.

### Notes
- Workaround used: <none / details>.
- Logs: <paths>.
- Manual remaining: <anything unresolved>.
```

## Quality Checks

Before finalising:

- Confirm the app root.
- Confirm the intended port.
- Confirm the actual command used.
- Confirm logs were inspected if the process was detached.
- Confirm HTTP verification was attempted.
- Do not pretend the service is reachable if the HTTP check failed.
