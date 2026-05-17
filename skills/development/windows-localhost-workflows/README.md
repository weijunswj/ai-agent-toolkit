# Windows Localhost Workflows

This skill helps an AI coding agent start, relaunch, verify, and troubleshoot localhost development apps on Windows.

It is best for Codex and Claude Code, but can also guide ChatGPT or Claude when they have shell/tool access.

## What this skill does

Use it when a user asks an agent to:

1. Start a local web app or API server.
2. Relaunch a broken localhost dev workflow.
3. Check whether a localhost URL is actually reachable.
4. Debug PowerShell startup scripts.
5. Fix package-manager launch issues on Windows.
6. Handle port conflicts.
7. Launch a long-running dev server in the background.
8. Inspect logs and report the exact working command.

## Required access

The agent needs:

1. Access to the project files.
2. Windows shell or PowerShell access.
3. Permission to run local development commands.
4. Permission to inspect local ports and logs.

If shell access is not available, the agent should give the user manual commands instead of claiming the server was started.

## Supported platforms

| Platform | Support notes |
|---|---|
| ChatGPT | Works when shell/tool access is available; otherwise use as a manual checklist. |
| Codex | Primary target. Use to start and verify local dev servers. |
| Claude | Works if Claude Skills and shell/tool access are available. |
| Claude Code | Copy the skill folder into `~/.claude/skills/` or `.claude/skills/`. |

## Files

```text
windows-localhost-workflows/
- README.md
- SKILL.md
- agents/
  - openai.yaml
```

## What counts as done

The task is only done when:

1. The working launch command is known.
2. The app responds on the expected localhost URL or health endpoint.
3. The agent reports the URL, command, workaround, and log paths.

## Important rule

Do not keep retrying the same broken command.

Diagnose once, switch to the direct underlying command, verify with HTTP, then report clearly.
