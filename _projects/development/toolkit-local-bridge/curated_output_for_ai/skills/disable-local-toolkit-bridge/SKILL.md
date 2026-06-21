---
name: disable-local-toolkit-bridge
description: Use when the user asks to disable Toolkit bridge auto-sync or disable OpenCode or AG2 bridge targets. Does not delete user files unless a separate explicit deletion request is made.
---

# Disable Local Toolkit Bridge

Use this skill when the user asks to disable auto-sync or bridge targets.

1. Run an audit first:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

2. Ask which setting to disable.
3. Explain that disabling does not delete user files.
4. After approval, run only the requested write command.

Disable auto-sync:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --write --disable-auto-sync
```

Disable OpenCode:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --write --disable-target opencode
```

Disable AG2:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --write --disable-target ag2
```

After disabling, run an audit again and report the resulting state. A disabled target must remain disabled during future native plugin hooks and manual `sync-enabled-bridges` runs. Do not remove the OpenCode global skill folder, AG2 adapter files, hub directory, lock file, or any user config unless the user separately asks for deletion and approves the exact paths. Treat disablement as a state change, not cleanup.

Do not delete bridge hub files or target files unless the user explicitly asks for deletion in the current turn.
