---
name: windows-localhost-workflows
description: start, relaunch, verify, and troubleshoot localhost development workflows on windows. use before starting localhost web apps, api servers, or development services on windows or in codex windows shells, and when debugging windows startup failures involving powershell scripts, execution policy, corepack, package managers, spawn eperm, duplicate path/path environment keys, port conflicts, detached background launch, non-persistent sandbox background processes, or empty log files. supports chatgpt, codex, claude, and claude code where shell access is available.
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

If the port is already bound, decide whether to reuse the running service, stop it, or choose a different port based on project requirements.

### 3. Resolve package-manager commands dynamically

Do not hardcode a user-specific path as the default. Find the package manager first:

```powershell
Get-Command pnpm.cmd -ErrorAction SilentlyContinue
Get-Command npm.cmd -ErrorAction SilentlyContinue
Get-Command yarn.cmd -ErrorAction SilentlyContinue
Get-Command bun.exe -ErrorAction SilentlyContinue
```

If a wrapper script fails, call the resolved executable directly:

```powershell
$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
& $pnpm dev
```

Use hardcoded paths only as a last-resort local fallback, and explain why.

### 4. Start in the foreground once when the failure mode is unknown

Run the project-native command directly first so the real error is visible.

Examples:

```powershell
npm run dev
pnpm dev
yarn dev
bun run dev
```

If a PowerShell helper script is the documented startup path, run it once to see whether it works. If it fails due to wrapper/tooling issues, stop retrying it and run the underlying command directly.

### 5. Switch to detached background launch after the command is known

Use this when the service is long-running and the working command is known. A reliable Windows launch pattern is:

1. Check the port.
2. Normalize duplicate process environment keys before `Start-Process`.
3. Start the server with stdout/stderr logs.
4. Poll a documented health endpoint such as `/api/health`, or the root URL when no health endpoint exists.
5. If a Codex sandbox launch does not persist after the shell command returns, retry with an escalated/unsandboxed launch when the environment supports it.
6. Report the exact URL, command, process id, and log paths.

```powershell
$app = Resolve-Path .
$port = 3000
$url = "http://localhost:$port/api/health"
$log = Join-Path $app 'dev-server.log'
$err = Join-Path $app 'dev-server.err.log'

$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { Get-Process -Id $conn.OwningProcess | Select-Object Id,ProcessName,Path }

$processEnv = [Environment]::GetEnvironmentVariables("Process")
if ($processEnv.Contains("Path") -and $processEnv.Contains("PATH")) {
  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
}

$cmd = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$startCommand = "Set-Location '$app'; & '$cmd' dev"
$proc = Start-Process -FilePath 'powershell.exe' `
  -ArgumentList "-NoProfile -Command `$ErrorActionPreference = 'Stop'; $startCommand" `
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

Replace `pnpm dev` with the project's actual working command. For Python or Node launches that pass arguments through `Start-Process -ArgumentList`, prefer a single quoted argument string once the command is known; array arguments can be mis-passed by wrappers in some Windows launch paths.

### 6. Verify from logs and HTTP

```powershell
Get-Content -Raw .\dev-server.log
Get-Content -Raw .\dev-server.err.log
Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 15
```

Prefer a documented health endpoint when available, such as:

```text
http://localhost:3000/health
http://localhost:8000/api/health
```

Treat setup as incomplete until the HTTP check succeeds or the user explicitly accepts a partial result.

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

### Sandbox `spawn EPERM`

If the dev server fails inside an agent sandbox with `spawn EPERM`, request elevated/unsandboxed execution if the environment supports it. Do not keep retrying the same command inside the same failing sandbox.

### Codex sandbox background process does not persist

In Codex sandboxed shells, background localhost servers may exit or be killed when the shell command returns. If the user needs the dev server to keep running after the command finishes, relaunch it with `sandbox_permissions: require_escalated` when available, then repeat the same log and HTTP health verification. Report that the escalation is for local process persistence, not for external network exposure.

Do not claim the service is running persistently until a follow-up port or HTTP check succeeds after the launch command has returned.

### Port conflict

If the target port is already bound, inspect the owning process. Reuse, stop, or change port only after understanding whether the process is the same app.

### Process exits immediately with empty logs

Re-run the exact command in the foreground with the real shell and capture stdout/stderr directly. Empty redirected logs often mean the wrapper process died before the app started.

## Reporting

When finishing localhost setup, include:

- whether the service is up.
- the URL checked.
- the exact command that worked.
- whether a workaround was needed for execution policy, Corepack, sandbox spawning, package-manager path, or port conflicts.
- where stdout/stderr logs live.
- any remaining manual steps.

Use this compact format:

```markdown
## Done

### Status
- Service: Up / Not up / Partially started.
- URL checked: <url>.
- Working command: `<command>`.

### Notes
- Workaround used: <none / details>.
- Logs: <paths>.
- Caveats: <anything unresolved>.
```

## Quality Checks

Before finalising:

- Confirm the app root.
- Confirm the intended port.
- Confirm the actual command used.
- Confirm logs were inspected if the process was detached.
- Confirm HTTP verification was attempted.
- Do not pretend the service is reachable if the HTTP check failed.
