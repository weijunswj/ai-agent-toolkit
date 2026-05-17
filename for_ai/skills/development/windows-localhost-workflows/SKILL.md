---
name: windows-localhost-workflows
description: start, relaunch, verify, and troubleshoot localhost development workflows on windows. use when an ai coding agent needs to get a local web app, api server, or development service running on localhost, verify it with logs and an http health check, or debug windows startup failures involving powershell scripts, execution policy, corepack, package managers, spawn eperm, port conflicts, detached background launch, or empty log files. supports chatgpt, codex, claude, and claude code where shell access is available.
---

# Windows Localhost Workflows

## Overview

Start the local service, prove it is reachable, and report the exact working launch path. Prefer fast diagnosis over repeating the same broken startup command.

This skill is most useful for Codex and Claude Code on Windows. It can also guide ChatGPT or Claude when shell access is unavailable by returning commands for the user to run manually.

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

Use this when the service is long-running and the working command is known.

```powershell
$app = Resolve-Path .
$log = Join-Path $app 'dev-server.log'
$err = Join-Path $app 'dev-server.err.log'
$cmd = (Get-Command pnpm.cmd -ErrorAction Stop).Source

Start-Process -FilePath 'powershell.exe' `
  -ArgumentList '-NoProfile','-Command',"Set-Location '$app'; & '$cmd' dev" `
  -WorkingDirectory $app `
  -RedirectStandardOutput $log `
  -RedirectStandardError $err
```

Replace `pnpm dev` with the project's actual working command.

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

### Sandbox `spawn EPERM`

If the dev server fails inside an agent sandbox with `spawn EPERM`, request elevated/unsandboxed execution if the environment supports it. Do not keep retrying the same command inside the same failing sandbox.

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
