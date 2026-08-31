# Windows Command Hygiene

Use this when working on Windows, reading large or live files, inspecting logs, restarting localhost dev servers, or recovering from a command that appears stuck.

## File Inspection

- Prefer `rg`, `rg --files`, and targeted searches before reading whole files.
- Use bounded reads for normal file inspection:

```powershell
Get-Content -LiteralPath "file.md" -TotalCount 200
```

- Use bounded tails for logs and recent output:

```powershell
Get-Content -LiteralPath "log.txt" -Tail 120
```

- Avoid unbounded `Get-Content` on huge files, logs, generated files, binary-like files, locked files, or live outputs.
- Avoid `Get-Content -Wait` unless the human explicitly asked for a live tail.
- For agent command execution, use short timeouts for file reads, usually 5-10 seconds.
- If PowerShell reads are unreliable, use an explicit timeout wrapper or switch to another bounded inspection command.

## Log Reading

- Read logs with `-Tail`, not `-Wait`, unless a human explicitly wants a live tail.
- Do not stream logs indefinitely in an agent command expected to complete.
- Prefer bounded excerpts and targeted searches over full log dumps.

## Localhost Servers

- Before restarting a localhost server, inspect the port:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess
```

- Stop only the known owning PID when needed:

```powershell
Stop-Process -Id <PID> -Force
```

- Do not kill broad process names blindly.
- Start long-running dev servers in a controlled background process and write logs to a file.
- Do not leave foreground dev servers running in commands that the agent expects to complete.
- Avoid restart loops caused by duplicate watchers or occupied ports.

## Timeout Recovery

- Use short timeouts for file reads.
- Use bounded waits for server startup checks.
- If a command appears stuck, stop, inspect process, port, and log state, then choose a targeted recovery.
- Do not keep retrying the same long-running command blindly.
