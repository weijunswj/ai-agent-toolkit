---
name: setup-all-non-native-bridges
description: Use when the user asks to set up all non-native Toolkit bridge targets. Handles OpenCode and AG2 as separate opt-in targets and lets the user approve or skip each target.
---

# Setup All Non-Native Bridges

Use this skill when the user asks to set up every non-native bridge target.

1. Run a target-by-target dry-run:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit --enable-target opencode --enable-target ag2
```

2. Explain the OpenCode plan and the AG2 plan separately.
3. Confirm that Codex and Claude Code update natively and are not managed by the bridge.
4. Ask the user which targets to enable.
5. Run only the approved write commands.

OpenCode:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --write --enable-target opencode
```

AG2:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --write --enable-target ag2
```

Do not treat approval for one target as approval for the other.
