---
name: setup-opencode-bridge
description: Use when the user asks to set up or enable the OpenCode bridge target. Detects OpenCode, previews planned writes, and requires explicit approval before writing OpenCode global skills or bridge state.
---

<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.toolkit-local-bridge
Source: _projects/development/toolkit-local-bridge/curated_output_for_ai/skills/setup-opencode-bridge/SKILL.md
Update the curated output and run sync.
-->
# Setup OpenCode Bridge

Use this skill when the user asks to set up the OpenCode bridge.

1. Run a dry-run with the target enablement intent:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit --enable-target opencode
```

2. Show the planned hub path and OpenCode target path.
3. Confirm that OpenCode output will use the OpenCode global skills path, not `.agents/skills`.
4. Confirm that no project repo files, npm packages, pip packages, Codex install, or Claude Code install will be touched.
5. Ask for explicit approval before writing.
6. After approval, run:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --write --enable-target opencode
```

If the user provided a custom OpenCode config path, pass it with `--opencode-config-dir`.
