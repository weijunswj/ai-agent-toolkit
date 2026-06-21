---
name: setup-local-toolkit-bridge
description: Use when the user asks to set up, initialize, trust, or configure the AI Agent Toolkit local bridge hub or auto-sync. Requires explicit approval before writing user-level files or enabling auto-sync.
---

# Setup Local Toolkit Bridge

Use this skill when the user asks to set up or trust the Toolkit Local Bridge Hub.

1. Read [Toolkit Local Bridge V2](../../repo/docs/TOOLKIT-LOCAL-BRIDGE-V2.md) when available.
2. Run a dry-run audit first:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

3. Explain that the default hub is `%USERPROFILE%\.ai-agent-toolkit\current` on Windows and `~/.ai-agent-toolkit/current` on POSIX.
4. Explain that this setup does not install Codex, Claude Code, OpenCode, AG2, npm packages, or pip packages.
5. Ask for explicit approval before writing the hub, enabling auto-sync, or enabling a target.
6. After approval, use only the needed write command:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --write --enable-auto-sync
```

Do not enable OpenCode or AG2 from this skill unless the user explicitly asks for that target too.
