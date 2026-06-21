---
name: setup-ag2-bridge
description: Use when the user asks to set up or enable the AG2 bridge target. Detects Python and AG2 package presence, previews planned writes, and never installs Python packages by default.
---

# Setup AG2 Bridge

Use this skill when the user asks to set up the AG2 bridge.

1. Run a dry-run with the target enablement intent:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit --enable-target ag2
```

2. Show the planned hub path and AG2 adapter output path.
3. Confirm that AG2 output stays under the Toolkit Local Bridge Hub.
4. Confirm that no Python packages, pip packages, npm packages, Codex install, Claude Code install, or project repo files will be touched.
5. Ask for explicit approval before writing.
6. After approval, run:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --write --enable-target ag2
```

If Python detection needs a custom executable, pass it with `--python-command`.
